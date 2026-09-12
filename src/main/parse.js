'use strict';
// Filename / folder parsing. Tuned to the layouts actually on the share:
//   TV:    Show/Show S1/Show S01E01 - 720p WEB-DL (Group).mp4
//   Anime: Show/Show S1/1 Show S1.mp4        (leading episode number, season from folder)
//          Show/Show S1/2Show S1.mp4         (number glued to the title)
//          Show/Show S1/Show_S01E01_Episode Title_.mp4
//          Show/Group_Romaji_Title_-_01_720p_SubsPlease.mp4
//          Show/1 Show.mp4                    (no season folder → season 1)
//          Show/Show - OVA.mp4, Special 01 - Title.mp4  (season 0)
//   Movie: Title (Year) [720p].mp4            (flat folder, [tag] marks alternate versions)

const RELEASE_TOKENS = /\b(2160p|1440p|1080p|720p|576p|480p|4k|uhd|web[-. ]?dl|webrip|hdtv|bluray|blu-ray|bdrip|brrip|dvdrip|hdrip|remux|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|dts|atmos|10bit|hdr|dv|amzn|nf|dsnp|hmax|proper|repack|subsplease|erai-raws|animepahe|horriblesubs)\b/i;

function clean(s) {
  return s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '').trim();
}

function seasonFromDir(dir) {
  if (!dir) return null;
  if (/\b(specials?|extras?|ova|ovas|movies?)\b/i.test(dir)) return 0;
  const m = dir.match(/(?:^|[\s._-])(?:S|Season)\s*(\d{1,3})(?![\d])/i);
  return m ? Number(m[1]) : null;
}

function parseEpisode(relPath) {
  const parts = relPath.split(/[\\/]/);
  const fileName = parts[parts.length - 1];
  const base = fileName.replace(/\.[^.]+$/, '');
  const showDir = parts.length > 1 ? parts[0] : null;
  const seasonDir = parts.length > 2 ? parts[parts.length - 2] : null;

  let season = null, episode = null, episodeEnd = null, title = null, note = null;
  let rest = '';
  const isSpecial = /\b(ova|oad|ona|special|specials|omake|extra|movie)\b/i.test(base);

  let m;
  if ((m = base.match(/(?:^|[\s._-])S(\d{1,3})\s*[._ -]?E(\d{1,4})(?:\s*[-–]?\s*E(\d{1,4})|[-–](\d{1,4})(?![\dpxk]))?/i))) {
    season = Number(m[1]); episode = Number(m[2]); episodeEnd = m[3] ? Number(m[3]) : (m[4] ? Number(m[4]) : null);
    rest = base.slice(m.index + m[0].length);
  } else if ((m = base.match(/(?:^|[\s._-])(\d{1,3})x(\d{1,4})(?:\s*[-–]?\s*(\d{1,4}))?/i))) {
    season = Number(m[1]); episode = Number(m[2]); episodeEnd = m[3] ? Number(m[3]) : null;
    rest = base.slice(m.index + m[0].length);
  } else if ((m = base.match(/^(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?(?=[\s._-]|$)/))) {
    // "12 Show S1" — leading episode number
    episode = Number(m[1]); episodeEnd = m[2] ? Number(m[2]) : null;
    note = 'episode from leading number';
  } else if ((m = base.match(/^(\d{1,3})(?=[A-Za-z])/))) {
    // "2The Boys S3" — number glued to the title
    episode = Number(m[1]);
    note = 'episode from leading number (no space)';
  } else if ((m = base.match(/\b(?:Ep?|Episode)\s*\.?\s*(\d{1,4})\b/i))) {
    episode = Number(m[1]);
    note = 'episode from Ep token';
    rest = base.slice(m.index + m[0].length);
  } else if ((m = base.match(/\b(?:special|ova|oad|ona)\s*#?\s*(\d{1,3})\b/i))) {
    episode = Number(m[1]); season = 0;
    note = 'special from name';
    rest = base.slice(m.index + m[0].length);
  } else if ((m = base.match(/[-–_]\s*_?(\d{1,4})(?=[\s._(\[]|$)/))) {
    // "Title - 01_720p" / "Title_-_01"
    episode = Number(m[1]);
    note = 'episode from dash number';
    rest = base.slice(m.index + m[0].length);
  } else if (isSpecial) {
    // "Show - OVA.mp4": season 0, episode 1 unless there is any number in the name
    const n = base.match(/(\d{1,3})/);
    episode = n ? Number(n[1]) : 1; season = 0;
    note = 'special without number';
  }

  if (season == null) {
    season = seasonFromDir(seasonDir);
    if (season == null) {
      // Season tag on the file itself, e.g. "1 Show S1"
      const sm = base.match(/(?:^|[\s._-])S(\d{1,3})(?![\dE])/i);
      season = sm ? Number(sm[1]) : (episode != null ? 1 : null);
    }
  }

  if (rest) {
    let t = clean(rest.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, ' '));
    t = t.replace(/[-–_]\s*$/, '').trim();
    if (t && !RELEASE_TOKENS.test(t)) title = t;
  }

  let showName = showDir ? clean(showDir) : null;
  if (!showName) {
    const cut = base.search(/(?:^|[\s._-])(S\d{1,3}\s*E\d{1,4}|\d{1,3}x\d{1,4})/i);
    showName = clean(cut > 0 ? base.slice(0, cut) : base.replace(/^\d+\s*/, ''));
  }

  const ok = episode != null && season != null;
  return {
    parse_ok: ok ? 1 : 0,
    parse_note: ok ? note : 'could not find episode number',
    show_name: showName,
    season, episode, episode_end: episodeEnd,
    episode_title: title,
    edition_tag: (base.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1)).join(';') || null,
  };
}

function parseMovie(relPath) {
  const parts = relPath.split(/[\\/]/);
  const fileName = parts[parts.length - 1];
  const base = fileName.replace(/\.[^.]+$/, '');
  // If the movie sits in its own folder that carries the year, the folder is the better title source.
  const folder = parts.length > 1 ? parts[parts.length - 2] : null;
  const src = folder && /\(\d{4}\)/.test(folder) ? folder : base;

  const tags = (base.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1));
  let s = src.replace(/\[[^\]]*\]/g, ' ');
  let year = null;
  let m = s.match(/\((\d{4})\)/);
  if (m) { year = Number(m[1]); s = s.slice(0, m.index); }
  else if ((m = s.match(/(?:^|[\s._-])((?:19|20)\d{2})(?=[\s._-]|$)/))) { year = Number(m[1]); s = s.slice(0, m.index); }
  let title = clean(s);
  // Strip trailing release info that wasn't inside brackets
  const cut = title.search(RELEASE_TOKENS);
  if (cut > 0) title = clean(title.slice(0, cut));

  // Edition words in the file name (not the folder) distinguish versions
  const editionWords = [];
  const em = base.match(/\b(extended|director'?s cut|unrated|theatrical|remastered|imax|ultimate|special edition|final cut|criterion)\b/ig);
  if (em) editionWords.push(...em.map(x => x.toLowerCase()));
  if (folder && folder !== base && src === folder) {
    // Multiple files in one folder: use the file's own distinguishing text
    const extra = clean(base.replace(/\[[^\]]*\]/g, ' ').replace(/\(\d{4}\)/, '').replace(new RegExp(escapeRe(title), 'i'), ''));
    if (extra) editionWords.push(extra);
  }
  const seenEd = new Set();
  const edition = [...tags, ...editionWords].filter(Boolean).filter(x => { const k = x.toLowerCase(); if (seenEd.has(k)) return false; seenEd.add(k); return true; }).join(';') || null;

  return {
    parse_ok: title ? 1 : 0,
    parse_note: year ? null : 'no year found',
    movie_title: title || base,
    movie_year: year,
    edition_tag: edition,
    group_key: movieGroupKey(title, year),
  };
}

function movieGroupKey(title, year) {
  return String(title || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '') + '|' + (year || '');
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---- Web videos (yt-dlp style downloads) -------------------------------------------
//   Channel\Title [videoId].mp4, Channel\20240115 Title.mp4, or loose Title.mp4 at the root.
function parseWeb(relPath) {
  const parts = relPath.split(/[\\/]/);
  const fileName = parts[parts.length - 1];
  let base = fileName.replace(/\.[^.]+$/, '');
  const channel = parts.length > 1 ? clean(parts[0]) : null;
  let videoId = null, uploadDate = null, m;
  if ((m = base.match(/\s*\[([A-Za-z0-9_-]{11})\]\s*$/))) { videoId = m[1]; base = base.slice(0, m.index); }
  if ((m = base.match(/(?:^|[\s._-])((?:19|20)\d{2})[-.]?(\d{2})[-.]?(\d{2})(?=[\s._-]|$)/))) { uploadDate = `${m[1]}-${m[2]}-${m[3]}`; base = (base.slice(0, m.index) + ' ' + base.slice(m.index + m[0].length)); }
  const title = clean(base.replace(/\s{2,}/g, ' ')) || fileName;
  return { parse_ok: 1, parse_note: null, channel, movie_title: title, video_id: videoId, upload_date: uploadDate, group_key: (channel || '').toLowerCase() + '|' + title.toLowerCase().replace(/[^a-z0-9]+/g, '') };
}

// ---- Adult root: classify each file as anime / tv / movie from its path alone ----------
function classifyAdult(relPath) {
  const parts = relPath.split(/[\\/]/);
  const base = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  if (/(?:^|[\s._-])S\d{1,3}\s*[._ -]?E\d{1,4}/i.test(base) || /(?:^|[\s._-])\d{1,3}x\d{1,4}/i.test(base)) return 'tv';
  if (parts.length === 1 && /\((19|20)\d{2}\)/.test(base)) return 'movie';
  if (/^\d{1,4}(?=[\s._-]|[A-Za-z])/.test(base) || (parts.length > 2 && seasonFromDir(parts[parts.length - 2]) != null)) return 'anime';
  if (parts.length === 2 && /\((19|20)\d{2}\)/.test(parts[0] + base)) return 'movie';
  return 'anime';
}

// Single dispatch used by the scanner and worker. Returns parse fields + library_type + adult.
function parseFor(rootType, relPath, adultDefault = 'anime') {
  if (rootType === 'movie') return { library_type: 'movie', adult: 0, ...parseMovie(relPath) };
  if (rootType === 'web') return { library_type: 'web', adult: 0, ...parseWeb(relPath) };
  if (rootType === 'adult') {
    const sub = classifyAdult(relPath) || adultDefault;
    return { library_type: sub, adult: 1, ...(sub === 'movie' ? parseMovie(relPath) : parseEpisode(relPath)) };
  }
  return { library_type: rootType, adult: 0, ...parseEpisode(relPath) };
}

// Bump whenever parse rules change; main.js re-parses the whole DB on mismatch.
const PARSER_VERSION = 3;

module.exports = { parseEpisode, parseMovie, parseWeb, classifyAdult, parseFor, seasonFromDir, movieGroupKey, PARSER_VERSION };
