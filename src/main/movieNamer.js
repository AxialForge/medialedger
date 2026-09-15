'use strict';
const { fileAudioType } = require('./tags');
// Movie naming engine — a pure function from a database row to a proposed name.
//
//   Title (Year) - Source Resolution HDR Codec [Audio] [{edition-…}].ext
//
// Rules agreed with the owner (2026-09-06):
//   * Title and year come from the parser + manual fixes; never re-guessed here.
//   * Source: "Web" if the ORIGINAL name carries (LiLTV) or a WEB marker,
//     "Rip" for BRrip/BluRay/BDRip/Remux/DVDRip. Otherwise the placeholder "Source".
//   * Resolution, HDR/SDR, codec and audio language come ONLY from ffprobe data.
//     Anything the probe cannot prove gets a placeholder word, never a guess.
//   * Placeholders ("Year", "Source", "Resolution") are deliberate, searchable
//     gaps for the owner to fill by hand; they do not block a rename.
//   * A file without a successful probe, without a title, or whose proposed
//     name collides with another file's is BLOCKED (never renamed).
//   * Audio token only when the audio is not plain English.
//   * Editions use Plex's native {edition-Name} suffix.
//   * Illegal Windows characters: ":" and "?" are dropped, "/" and "\" become
//     "-", '<>"|*' are dropped, trailing dots/spaces trimmed.

const SOURCE_WEB = /liltv|web[-. ]?dl|web[-. ]?rip|\bweb\b|amzn|nf\b|dsnp|hmax|atvp|pcok/i;
const SOURCE_RIP = /br[-. ]?rip|bd[-. ]?rip|blu[-. ]?ray|blueray|remux|dvd[-. ]?rip|\bdvd\b|hdrip|\brip\b/i;
const EDITION_WORDS = /\b(extended(?: cut| edition| collector'?s edition)?|director'?s cut|unrated|theatrical(?: cut)?|remastered|imax|ultimate(?: edition| cut)?|special edition|final cut|criterion(?: collection)?|collector'?s edition|anniversary edition|uncut|redux|open matte|black and chrome)\b/i;
const RES_ORDER = ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD'];

function cleanTitle(t) {
  return String(t || '')
    .replace(/[:?]/g, '')
    .replace(/[\\/]/g, '-')
    .replace(/[<>"|*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
}

function detectSource(originalName, editionTag) {
  const hay = `${originalName || ''} ${editionTag || ''}`;
  if (/liltv/i.test(hay)) return { source: 'Web', from: 'LiLTV marker' };
  if (SOURCE_WEB.test(hay)) return { source: 'Web', from: 'web marker' };
  if (SOURCE_RIP.test(hay)) return { source: 'Rip', from: 'rip marker' };
  return { source: 'Source', from: null };
}

function claimedResolution(originalName) {
  const m = String(originalName || '').match(/\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p)\b/i);
  if (!m) return null;
  const v = m[1].toLowerCase();
  return v === '2160p' || v === 'uhd' ? '4K' : v === '4k' ? '4K' : v;
}

function codecToken(c) {
  const m = { h264: 'H264', avc: 'H264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1', mpeg4: 'MPEG4', mpeg2video: 'MPEG2', vc1: 'VC1', vp9: 'VP9', wmv3: 'WMV', msmpeg4v3: 'DIVX' };
  if (!c) return null;
  return m[String(c).toLowerCase()] || String(c).toUpperCase();
}

function audioToken(audioLangs) {
  if (!audioLangs) return { token: null, flag: 'audio_unknown' };
  const langs = [...new Set(String(audioLangs).split(';').map(s => s.trim().toLowerCase()).filter(Boolean))];
  if (!langs.length) return { token: null, flag: 'audio_unknown' };
  if (langs.every(l => l === 'und')) return { token: null, flag: 'audio_und' };
  const real = langs.filter(l => l !== 'und');
  if (real.length === 1 && real[0] === 'eng') return { token: null, flag: null };
  // English first, then the rest in probed order
  const ordered = [...real.filter(l => l === 'eng'), ...real.filter(l => l !== 'eng')];
  return { token: ordered.map(l => l.toUpperCase()).join('+'), flag: langs.includes('und') ? 'audio_partly_und' : null };
}

function editionToken(editionTag, originalName) {
  const hay = `${editionTag || ''} ${originalName || ''}`;
  const m = hay.match(EDITION_WORDS);
  if (!m) return null;
  // Title-case the phrase as written ("director's cut" → "Director's Cut")
  const phrase = m[1].replace(/\b\w/g, ch => ch.toUpperCase()).replace(/'S\b/g, "'s");
  return `{edition-${phrase}}`;
}

/**
 * @param {object} f  a row from the files table (parsed + probed + override-merged)
 * @returns {{ ok: boolean, blocked: string|null, name: string|null, tokens: object, flags: string[] }}
 */
// Which parts follow "Title (Year) -", in order. Settings → Movie names lets the user switch parts off or reorder them.
const DEFAULT_PARTS = ['source', 'resolution', 'hdr', 'codec', 'audio', 'edition'];
// 'dubsub' (Sub / Dub / Dual from the probed languages) is opt-in: it is never in DEFAULT_PARTS.
const ALL_PARTS = new Set([...DEFAULT_PARTS, 'dubsub']);
const normalizeParts = (parts) => Array.isArray(parts) ? parts.filter((p, i, a) => ALL_PARTS.has(p) && a.indexOf(p) === i) : DEFAULT_PARTS.slice();

function proposeMovieName(f) {
  const parts_ = normalizeParts(f.parts);
  const want = (p) => parts_.includes(p);
  const flags = [];
  const tokens = {};
  const ext = (f.file_name || '').match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';

  if (f.ignored) return { ok: false, blocked: 'ignored', name: null, tokens, flags };
  if (f.library_type !== 'movie') return { ok: false, blocked: 'not a movie', name: null, tokens, flags };

  // Truth source: parser (+ manual fixes) by default; 'plex' uses Plex's matched title/year when the file is linked.
  const usePlex = f.truth === 'plex' && f.plex_rating_key && f.plex_title;
  const srcTitle = usePlex ? f.plex_title : f.movie_title;
  const srcYear = usePlex ? (f.plex_year || f.movie_year) : f.movie_year;
  if (f.truth === 'plex' && !usePlex) flags.push('plex_unlinked');
  if (usePlex && cleanTitle(f.plex_title) !== cleanTitle(f.movie_title)) flags.push('plex_title_differs');
  tokens.title = cleanTitle(srcTitle);
  if (!tokens.title) return { ok: false, blocked: 'no title', name: null, tokens, flags };

  if (srcYear && Number(srcYear) >= 1880 && Number(srcYear) <= 2100) tokens.year = String(srcYear);
  else { tokens.year = 'Year'; flags.push('no_year'); }

  // A manual fix can state the source outright (Web / Rip); it beats any marker in the name.
  const src = /^(web|rip)$/i.test(f.source_override || '') ? { source: f.source_override[0].toUpperCase() + f.source_override.slice(1).toLowerCase(), from: 'manual fix' } : detectSource(f.file_name, f.edition_tag);
  tokens.source = src.source;
  if (!src.from && want('source')) flags.push('no_source');

  if (!f.probe_ok) {
    return { ok: false, blocked: f.probed_at ? 'probe failed' : 'not probed yet', name: null, tokens, flags };
  }
  tokens.resolution = f.resolution && RES_ORDER.includes(f.resolution) ? f.resolution : null;
  if (!tokens.resolution) return { ok: false, blocked: 'no resolution from probe', name: null, tokens, flags };
  const claimed = claimedResolution(f.file_name);
  if (claimed && claimed !== tokens.resolution) flags.push(`res_mismatch:${claimed}→${tokens.resolution}`);

  const hdr = String(f.hdr || 'SDR');
  if (/HDR10|Dolby Vision|HLG/i.test(hdr)) tokens.hdr = 'HDR';
  else if (/BT\.2020/i.test(hdr)) { tokens.hdr = 'HDR'; flags.push('hdr_uncertain'); }
  else tokens.hdr = 'SDR';
  if (/hdr|dolby|\bdv\b/i.test(f.file_name || '') && tokens.hdr === 'SDR') flags.push('hdr_claimed_but_sdr');

  tokens.codec = codecToken(f.video_codec);
  if (!tokens.codec) return { ok: false, blocked: 'no codec from probe', name: null, tokens, flags };

  const a = audioToken(f.audio_langs);
  tokens.audio = a.token;
  if (a.flag) flags.push(a.flag);

  tokens.edition = editionToken(f.edition_tag, f.file_name);
  const at = fileAudioType(f.audio_langs, f.sub_langs, { anime: false });
  tokens.dubsub = at === 'dual' ? 'Dual' : at === 'sub' ? 'Sub' : at === 'dub' ? 'Dub' : null;

  // Segments let the UI show which part of the name came from where (and toggle parts by clicking them).
  const segments = [{ part: 'title', text: tokens.title }, { part: 'year', text: ` (${tokens.year})` }];
  const tail = parts_.filter(p => tokens[p]).map(p => ({ part: p, text: tokens[p] }));
  tail.forEach((t, i) => { t.text = (i === 0 ? ' - ' : ' ') + t.text; segments.push(t); });
  segments.push({ part: 'ext', text: ext });
  const name = segments.map(x => x.text).join('');
  return { ok: true, blocked: null, name, tokens, flags, segments };
}

// Plan a whole set: adds collision blocking (same folder + same proposed name, case-insensitive).
function planMovieNames(rows) {
  const out = rows.map(f => {
    const p = proposeMovieName(f);
    const dir = f.rel_path.includes('\\') ? f.rel_path.slice(0, f.rel_path.lastIndexOf('\\')) : '';
    return { id: f.id, root_id: f.root_id, rel_path: f.rel_path, abs_path: f.abs_path, from: f.file_name, dir, size: f.size, ...p, unchanged: p.ok && p.name === f.file_name };
  });
  const byTarget = new Map();
  for (const p of out) if (p.ok) { const k = (p.dir + '|' + p.name).toLowerCase(); if (!byTarget.has(k)) byTarget.set(k, []); byTarget.get(k).push(p); }
  for (const group of byTarget.values()) if (group.length > 1) for (const p of group) { p.ok = false; p.blocked = `collision with ${group.length - 1} other file(s)`; }
  return out;
}

module.exports = { DEFAULT_PARTS, normalizeParts, proposeMovieName, planMovieNames, cleanTitle, detectSource, claimedResolution, codecToken, audioToken, editionToken };
