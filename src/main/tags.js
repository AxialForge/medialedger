'use strict';
// Tags that need no network: whether a title is subbed, dubbed or both, worked out from the
// audio and subtitle languages ffprobe already recorded. Only meaningful where Japanese audio
// is in play (anime, anime films); anything else returns null rather than a wrong guess.

const has = (langs, codes) => { const set = new Set(String(langs || '').toLowerCase().split(/[,\s|]+/).filter(Boolean)); return codes.some(c => set.has(c)); };
const JPN = ['jpn', 'ja', 'jp'], ENG = ['eng', 'en'];

/** One file: 'dual' | 'sub' | 'dub' | 'raw' | null */
function fileAudioType(audioLangs, subLangs, { anime = false } = {}) {
  const jpn = has(audioLangs, JPN), eng = has(audioLangs, ENG), engSub = has(subLangs, ENG);
  if (jpn && eng) return 'dual';
  if (jpn) return engSub ? 'sub' : 'raw';
  if (eng && anime) return 'dub';
  return null;
}

/** A title made of several files: the common type, or 'mixed' when files disagree. counts: { files, jpn, eng, engSub } */
function titleAudioType({ files, jpn, eng, dual = null }, { anime = false } = {}) {
  if (!files) return null;
  const both = dual != null ? dual : Math.min(jpn, eng);
  if (both === files) return 'dual';
  if (jpn === files && !eng) return 'sub';
  if (eng === files && !jpn) return anime ? 'dub' : null;
  if (jpn || (anime && eng)) return 'mixed';
  return null;
}

const AUDIO_LABEL = { dual: 'Dual audio', sub: 'Subbed', dub: 'Dubbed', raw: 'Raw (no English)', mixed: 'Mixed sub/dub' };

/** Genres from the online match plus AniList tags, deduplicated, in display order. */
function onlineTags(meta) {
  const parse = (v) => { if (!v) return []; if (Array.isArray(v)) return v; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };
  const out = []; const seen = new Set();
  for (const t of [...parse(meta && meta.genres), ...parse(meta && meta.online_tags)]) { const k = String(t).trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } }
  return out;
}

const normalizeTag = (t) => String(t || '').trim().replace(/\s+/g, ' ').slice(0, 40);

module.exports = { fileAudioType, titleAudioType, AUDIO_LABEL, onlineTags, normalizeTag };
