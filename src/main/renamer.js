'use strict';
// Opt-in rename tool. Proposes Plex-standard file names from what MediaLedger
// already knows (parser result + manual fixes) and applies only the ones the
// user ticks. Files are renamed in place — never moved between folders — and
// every attempt is written to the renames table. This is the ONLY code path
// that writes to the share; it is gated by settings.renaming.enabled.
const fs = require('fs');
const path = require('path');
const { fileAudioType } = require('./tags');
const { codecToken } = require('./movieNamer');

// What may follow "Show - S01E02". 'title' is on by default; the rest are opt-in like the movie parts.
const EP_DEFAULT_PARTS = ['title'];
const EP_ALL_PARTS = new Set(['title', 'resolution', 'codec', 'dubsub']);
const normalizeEpParts = (parts) => Array.isArray(parts) ? parts.filter((p, i, a) => EP_ALL_PARTS.has(p) && a.indexOf(p) === i) : EP_DEFAULT_PARTS.slice();

const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const safe = s => String(s).replace(ILLEGAL, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
const pad2 = n => String(n).padStart(2, '0');

// Plex naming: "Show - S01E02 - Title.ext" / "Show - S01E02-E03 - Title.ext"; movies "Title (Year) - Edition.ext"
function proposeName(f) {
  if (f.ignored || !f.parse_ok) return null;
  const ext = path.extname(f.file_name);
  if (f.library_type === 'movie') {
    if (!f.movie_title) return null;
    const year = f.movie_year ? ` (${f.movie_year})` : '';
    // Only keep tags that distinguish versions (resolution words / editions); "[720p]" style tags stay in brackets.
    const tag = f.edition_tag ? ` - ${f.edition_tag.split(';').map(t => t.trim()).filter(Boolean).join(' ')}` : '';
    return safe(`${f.movie_title}${year}${tag}`) + ext;
  }
  return proposeSegments(f, f.parts) ? proposeSegments(f, f.parts).name : null;
}

// Episode name as labelled segments (so the UI can show where each piece came from and toggle parts by clicking).
function proposeSegments(f, parts) {
  if (f.ignored || !f.parse_ok || f.library_type === 'movie') return null;
  if (!f.show_name || f.season == null || f.episode == null) return null;
  const ext = path.extname(f.file_name);
  const p = normalizeEpParts(parts);
  const range = f.episode_end && f.episode_end !== f.episode ? `-E${pad2(f.episode_end)}` : '';
  const tokens = { show: safe(f.show_name), code: `S${pad2(f.season)}E${pad2(f.episode)}${range}`, title: f.episode_title ? safe(f.episode_title) : null, resolution: f.resolution || null, codec: codecToken(f.video_codec) || null };
  const at = fileAudioType(f.audio_langs, f.sub_langs, { anime: f.library_type === 'anime' });
  tokens.dubsub = at === 'dual' ? 'Dual' : at === 'sub' ? 'Sub' : at === 'dub' ? 'Dub' : null;
  const segments = [{ part: 'show', text: tokens.show }, { part: 'code', text: ` - ${tokens.code}` }];
  if (p.includes('title') && tokens.title) segments.push({ part: 'title', text: ` - ${tokens.title}` });
  const extra = p.filter(x => x !== 'title' && tokens[x]);
  extra.forEach((x, i) => segments.push({ part: x, text: (i === 0 ? ' [' : ' ') + tokens[x] + (i === extra.length - 1 ? ']' : '') }));
  segments.push({ part: 'ext', text: ext });
  return { name: segments.map(x => x.text).join(''), segments, tokens };
}

// Build the proposal list: every non-missing file whose current name differs from the proposal.
function proposals(db, { type, show, onlyProblems, parts } = {}) {
  // Movies have their own engine (movieNamer / movieRename); this tool covers TV and anime only.
  const where = ['missing=0', 'ignored=0', "library_type IN ('tv','anime')"];
  const args = [];
  if (type && type !== 'movie') { where.push('library_type=?'); args.push(type); }
  if (show) { where.push('show_name=?'); args.push(show); }
  const rows = db.all(`SELECT id, root_id, library_type, rel_path, abs_path, file_name, size, resolution, video_codec, audio_langs, sub_langs, show_name, season, episode, episode_end, episode_title, movie_title, movie_year, edition_tag, parse_ok, parse_note, ignored, has_override FROM files WHERE ${where.join(' AND ')} ORDER BY library_type, show_name, season, episode, file_name`, ...args);
  const out = [];
  for (const f of rows) {
    const ps = proposeSegments(f, parts);
    const to = ps ? ps.name : null;
    if (!to || to === f.file_name) continue;
    if (onlyProblems && !(f.has_override || f.parse_note)) continue;
    const dir = f.rel_path.includes('\\') ? f.rel_path.slice(0, f.rel_path.lastIndexOf('\\')) : '';
    out.push({ id: f.id, root_id: f.root_id, library_type: f.library_type, rel_path: f.rel_path, abs_path: f.abs_path, from: f.file_name, to, name: to, dir, size: f.size, tokens: ps.tokens, segments: ps.segments, has_override: f.has_override, parse_note: f.parse_note, show_name: f.show_name, movie_title: f.movie_title });
  }
  return out;
}

// Apply renames for the given file ids. Returns per-file results. Never overwrites.
function applyRenames(db, ids, log = () => {}) {
  const results = [];
  for (const id of ids) {
    const f = db.get('SELECT * FROM files WHERE id=?', id);
    if (!f) { results.push({ id, ok: false, error: 'not in database' }); continue; }
    const to = proposeName(f);
    if (!to || to === f.file_name) { results.push({ id, ok: false, error: 'nothing to rename' }); continue; }
    const dir = path.dirname(f.abs_path);
    const dest = path.join(dir, to);
    const relDir = f.rel_path.includes('\\') ? f.rel_path.slice(0, f.rel_path.lastIndexOf('\\') + 1) : '';
    const toRel = relDir + to;
    let ok = false, error = null;
    try {
      if (!fs.existsSync(f.abs_path)) throw new Error('source no longer exists');
      if (fs.existsSync(dest) && dest.toLowerCase() !== f.abs_path.toLowerCase()) throw new Error('target already exists');
      fs.renameSync(f.abs_path, dest);
      ok = true;
      db.transaction(() => {
        db.run('UPDATE files SET rel_path=?, abs_path=?, file_name=? WHERE id=?', toRel, dest, to, id);
        // Carry the manual fix and any duplicate decision along with the new name.
        db.run('UPDATE overrides SET rel_path=? WHERE root_id=? AND rel_path=?', toRel, f.root_id, f.rel_path);
      });
      log(`renamed "${f.rel_path}" → "${toRel}"`);
    } catch (e) {
      error = e.message;
      log(`rename FAILED "${f.rel_path}": ${error}`);
    }
    db.addRename({ root_id: f.root_id, from_rel: f.rel_path, to_rel: toRel, ok, error });
    results.push({ id, ok, error, from: f.file_name, to });
  }
  return results;
}

module.exports = { proposeName, proposeSegments, proposals, applyRenames, EP_DEFAULT_PARTS, normalizeEpParts };
