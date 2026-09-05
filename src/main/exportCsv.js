'use strict';
// CSV export. Writes a timestamped folder plus a "latest" copy so a spreadsheet
// can always point at the same file name.
const fs = require('fs');
const path = require('path');

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map(h => csvCell(r[h])).join(','));
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}
const mb = b => b == null ? null : Math.round(b / 1048576 * 10) / 10;
const gb = b => b == null ? null : Math.round(b / 1073741824 * 100) / 100;
const min = s => s == null ? null : Math.round(s / 60 * 10) / 10;

const TECH_COLS = ['size_mb', 'duration_min', 'container', 'resolution', 'width', 'height', 'fps', 'video_codec', 'video_profile', 'bit_depth', 'hdr', 'bitrate_kbps',
  'audio_count', 'audio_codecs', 'audio_langs', 'audio_channels', 'sub_count', 'sub_codecs', 'sub_langs', 'sub_forced', 'sidecar_subs', 'has_captions', 'probe_ok', 'probe_error', 'missing', 'last_seen'];

function techFields(r) {
  return {
    size_mb: mb(r.size), duration_min: min(r.duration_s), container: r.container, resolution: r.resolution, width: r.width, height: r.height, fps: r.fps,
    video_codec: r.video_codec, video_profile: r.video_profile, bit_depth: r.bit_depth, hdr: r.hdr, bitrate_kbps: r.bitrate_kbps,
    audio_count: r.audio_count, audio_codecs: r.audio_codecs, audio_langs: r.audio_langs, audio_channels: r.audio_channels,
    sub_count: r.sub_count, sub_codecs: r.sub_codecs, sub_langs: r.sub_langs, sub_forced: r.sub_forced, sidecar_subs: r.sidecar_subs,
    has_captions: r.has_captions == null ? '' : (r.has_captions ? 'yes' : 'no'), probe_ok: r.probe_ok ? 'yes' : 'no', probe_error: r.probe_error,
    missing: r.missing ? 'yes' : 'no', last_seen: r.last_seen,
  };
}

function episodeGaps(rows) {
  // rows for one show, returns "S1: 5,7; S2: 12"
  const bySeason = new Map();
  for (const r of rows) {
    if (r.season == null || r.episode == null) continue;
    if (!bySeason.has(r.season)) bySeason.set(r.season, new Set());
    const set = bySeason.get(r.season);
    const end = r.episode_end || r.episode;
    for (let e = r.episode; e <= end; e++) set.add(e);
  }
  const out = [];
  for (const [s, set] of [...bySeason].sort((a, b) => a[0] - b[0])) {
    if (s === 0) continue;
    const nums = [...set].sort((a, b) => a - b);
    const missing = [];
    for (let e = nums[0]; e <= nums[nums.length - 1]; e++) if (!set.has(e)) missing.push(e);
    if (missing.length) out.push(`S${s}: ${missing.length > 12 ? missing.slice(0, 12).join(',') + ',…' : missing.join(',')}`);
  }
  return out.join('; ');
}

function countLabel(vals) {
  const m = new Map();
  for (const v of vals) { const k = v || 'unknown'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join(' ');
}
function unionList(vals) {
  const s = new Set();
  for (const v of vals) if (v) for (const p of String(v).split(';')) if (p) s.add(p);
  return [...s].join(';');
}

function exportEpisodes(db, type, dir, prefix) {
  const rows = db.all('SELECT * FROM files WHERE library_type = ? AND ignored=0 ORDER BY show_name, season, episode, file_name', type);
  const header = ['show', 'season', 'episode', 'episode_end', 'episode_title', 'file_name', 'rel_path', 'edition_tag', 'parse_ok', 'parse_note', ...TECH_COLS];
  writeCsv(path.join(dir, `${prefix}_episodes.csv`), header, rows.map(r => ({
    show: r.show_name, season: r.season, episode: r.episode, episode_end: r.episode_end, episode_title: r.episode_title,
    file_name: r.file_name, rel_path: r.rel_path, edition_tag: r.edition_tag, parse_ok: r.parse_ok ? 'yes' : 'no', parse_note: r.parse_note, ...techFields(r),
  })));

  const byShow = new Map();
  for (const r of rows) { if (r.missing) continue; if (!byShow.has(r.show_name)) byShow.set(r.show_name, []); byShow.get(r.show_name).push(r); }
  const summary = [];
  for (const [show, list] of byShow) {
    const seasons = new Set(list.map(r => r.season).filter(s => s != null));
    const probed = list.filter(r => r.probe_ok);
    const withCaps = list.filter(r => r.has_captions === 1).length;
    summary.push({
      show, seasons: seasons.size, season_list: [...seasons].sort((a, b) => a - b).join(';'), episodes: list.length,
      unparsed_files: list.filter(r => !r.parse_ok).length,
      total_duration_h: Math.round(list.reduce((a, r) => a + (r.duration_s || 0), 0) / 3600 * 10) / 10,
      total_size_gb: gb(list.reduce((a, r) => a + (r.size || 0), 0)),
      avg_episode_min: probed.length ? min(probed.reduce((a, r) => a + (r.duration_s || 0), 0) / probed.length) : null,
      resolutions: countLabel(list.map(r => r.resolution)),
      video_codecs: countLabel(list.map(r => r.video_codec)),
      audio_langs: unionList(list.map(r => r.audio_langs)),
      sub_langs: unionList(list.map(r => r.sub_langs)),
      captions_pct: probed.length ? Math.round(withCaps / list.length * 100) : null,
      episode_gaps: episodeGaps(list),
      probe_errors: list.filter(r => r.probe_ok === 0 && r.probed_at).length,
    });
  }
  writeCsv(path.join(dir, `${prefix}_series.csv`), ['show', 'seasons', 'season_list', 'episodes', 'unparsed_files', 'total_duration_h', 'total_size_gb', 'avg_episode_min', 'resolutions', 'video_codecs', 'audio_langs', 'sub_langs', 'captions_pct', 'episode_gaps', 'probe_errors'], summary);
  return [`${prefix}_episodes.csv`, `${prefix}_series.csv`];
}

function exportMovies(db, dir) {
  const rows = db.all('SELECT * FROM files WHERE library_type = ? AND ignored=0 ORDER BY movie_title, movie_year, file_name', 'movie');
  const groups = new Map();
  for (const r of rows) { if (r.missing) continue; if (!groups.has(r.group_key)) groups.set(r.group_key, []); groups.get(r.group_key).push(r); }
  const header = ['title', 'year', 'edition_tag', 'file_name', 'rel_path', 'versions_of_title', 'is_multiple', 'parse_note', ...TECH_COLS];
  writeCsv(path.join(dir, 'movies.csv'), header, rows.map(r => {
    const n = (groups.get(r.group_key) || []).length;
    return { title: r.movie_title, year: r.movie_year, edition_tag: r.edition_tag, file_name: r.file_name, rel_path: r.rel_path,
      versions_of_title: n, is_multiple: n > 1 ? 'yes' : 'no', parse_note: r.parse_note, ...techFields(r) };
  }));
  const order = ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD'];
  const titles = [];
  for (const list of groups.values()) {
    const res = list.map(r => r.resolution).filter(Boolean);
    const best = order.find(o => res.includes(o)) || null;
    titles.push({
      title: list[0].movie_title, year: list[0].movie_year, file_count: list.length, is_multiple: list.length > 1 ? 'yes' : 'no',
      versions: list.map(r => `${r.resolution || '?'}${r.edition_tag ? ' [' + r.edition_tag + ']' : ''} ${r.ext}`).join(' | '),
      best_resolution: best, total_size_gb: gb(list.reduce((a, r) => a + (r.size || 0), 0)),
      duration_min: min(Math.max(...list.map(r => r.duration_s || 0)) || null),
      audio_langs: unionList(list.map(r => r.audio_langs)), sub_langs: unionList(list.map(r => r.sub_langs)),
      has_captions: list.some(r => r.has_captions === 1) ? 'yes' : 'no', files: list.map(r => r.file_name).join(' | '),
    });
  }
  titles.sort((a, b) => a.title.localeCompare(b.title) || (a.year || 0) - (b.year || 0));
  writeCsv(path.join(dir, 'movies_titles.csv'), ['title', 'year', 'file_count', 'is_multiple', 'versions', 'best_resolution', 'total_size_gb', 'duration_min', 'audio_langs', 'sub_langs', 'has_captions', 'files'], titles);
  writeCsv(path.join(dir, 'movies_multiples.csv'), ['title', 'year', 'file_count', 'versions', 'best_resolution', 'total_size_gb', 'files'], titles.filter(t => t.file_count > 1));
  return ['movies.csv', 'movies_titles.csv', 'movies_multiples.csv'];
}

function exportChanges(db, dir, scanId) {
  const rows = scanId ? db.changesForScan(scanId) : db.recentChanges(5000);
  writeCsv(path.join(dir, 'changes.csv'), ['ts', 'scan_id', 'kind', 'library_type', 'path', 'detail'], rows.map(r => ({ ts: r.ts, scan_id: r.scan_id, kind: r.kind, library_type: r.library_type, path: r.path, detail: r.detail })));
  return ['changes.csv'];
}

function exportAll(db, outDir, scanId) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
  const dir = path.join(outDir, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const written = [
    ...exportEpisodes(db, 'tv', dir, 'tv'),
    ...exportEpisodes(db, 'anime', dir, 'anime'),
    ...exportMovies(db, dir),
    ...exportChanges(db, dir, scanId),
  ];
  const latest = path.join(outDir, 'latest');
  fs.mkdirSync(latest, { recursive: true });
  for (const f of written) fs.copyFileSync(path.join(dir, f), path.join(latest, f));
  const rows = db.get('SELECT COUNT(*) n FROM files WHERE ignored=0').n;
  return { dir, latest, files: written, rows };
}

module.exports = { exportAll, episodeGaps };
