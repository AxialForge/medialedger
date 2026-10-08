'use strict';
// Builds a fictional MediaLedger data folder for screenshots. Every title, person and address is invented;
// nothing is read from a real library. Run with:  node docs/_tools/release-docs/make-demo-data.js <out-dir>
//
// Produces: medialedger.db, settings.json, a small library folder tree (empty files) so roots are reachable,
// a posters folder with generated images (see make-demo-posters.py), and a backups folder with two sets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { Db } = require(path.join(REPO, 'src/main/db'));

const out = path.resolve(process.argv[2] || path.join(__dirname, 'demo-data'));
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

// A fixed seed, so two runs give the same screenshots.
let seed = 20260928;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const iso = (daysAgo, h = 12) => { const d = new Date(Date.UTC(2026, 8, 28, h, int(0, 59), 0)); d.setUTCDate(d.getUTCDate() - daysAgo); return d.toISOString(); };

const A = ['Amber', 'Silent', 'Hollow', 'Crimson', 'Northern', 'Paper', 'Iron', 'Velvet', 'Distant', 'Golden', 'Broken', 'Winter', 'Electric', 'Quiet', 'Lost', 'Seventh', 'Glass', 'Midnight', 'Salt', 'Copper'];
const N = ['Harbor', 'Lantern', 'Orchard', 'Meridian', 'Compass', 'Garden', 'Signal', 'Kingdom', 'River', 'Station', 'Archive', 'Circuit', 'Horizon', 'Parade', 'Foundry', 'Tide', 'Atlas', 'Monarch', 'Canyon', 'Observatory'];
const titles = new Set();
const title = (suffixes = ['']) => { for (;;) { const t = `${pick(A)} ${pick(N)}${pick(suffixes)}`.trim(); if (!titles.has(t)) { titles.add(t); return t; } } };

const lib = path.join(out, 'library');
const roots = [
  { id: 'tv', label: 'TV Shows', type: 'tv', path: path.join(lib, 'TV Shows'), enabled: true },
  { id: 'anime', label: 'Anime', type: 'anime', path: path.join(lib, 'Anime'), enabled: true },
  { id: 'movies', label: 'Movies', type: 'movie', path: path.join(lib, 'Movies'), enabled: true },
  { id: 'web', label: 'Web videos', type: 'web', path: path.join(lib, 'Web videos'), enabled: true },
];
for (const r of roots) fs.mkdirSync(r.path, { recursive: true });

const db = new Db(path.join(out, 'medialedger.db'));
const cols = db.all('PRAGMA table_info(files)').map(c => c.name).filter(c => c !== 'id');
const insFile = db.prep(`INSERT INTO files (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
let nextPlex = 1000;
const RES = [['4K', 3840, 2160, 14000], ['1080p', 1920, 1080, 4200], ['1080p', 1920, 1080, 3100], ['720p', 1280, 720, 1700], ['480p', 720, 480, 900]];
const GENRES = ['Drama', 'Comedy', 'Mystery', 'Science Fiction', 'Adventure', 'Crime', 'Fantasy', 'Thriller', 'Family', 'Documentary', 'Romance', 'Action'];
const touch = (abs) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ''); };

function addFile(o) {
  const res = o.res || pick(RES);
  const low = o.lowBitrate ? 0.35 : 1;
  const row = {
    root_id: o.root.id, library_type: o.root.type, rel_path: o.rel, abs_path: path.join(o.root.path, o.rel), file_name: path.basename(o.rel), ext: path.extname(o.rel).slice(1),
    size: Math.round((o.minutes * 60 * res[3] * low * 125) * (0.9 + rnd() * 0.2)), mtime_ms: Date.now() - int(30, 900) * 86400000, first_seen: iso(o.addedDays != null ? o.addedDays : int(3, 140)), last_seen: iso(0, 3),
    missing: o.missing ? 1 : 0, parse_ok: o.unparsed ? 0 : 1, parse_note: o.unparsed ? 'no season or episode found in the name' : null,
    show_name: o.show || null, season: o.season != null ? o.season : null, episode: o.episode != null ? o.episode : null, episode_end: null, episode_title: o.epTitle || null,
    movie_title: o.movie || null, movie_year: o.year || null, edition_tag: o.edition || null, group_key: o.group || null,
    probed_at: iso(1), probe_ok: o.probeError ? 0 : 1, probe_error: o.probeError || null, container: path.extname(o.rel).slice(1), duration_s: o.minutes * 60 + int(0, 59), bitrate_kbps: Math.round(res[3] * low), width: res[1], height: res[2], resolution: res[0], fps: pick([23.976, 23.976, 24, 25, 29.97]),
    video_codec: o.codec || pick(['h264', 'h264', 'hevc', 'hevc', 'av1']), video_profile: 'High', bit_depth: res[0] === '4K' ? 10 : 8, hdr: res[0] === '4K' ? pick(['HDR10', 'HDR10', 'Dolby Vision', 'SDR']) : 'SDR',
    audio_count: o.audio ? o.audio.split(',').length : 1, audio_codecs: pick(['aac', 'ac3', 'eac3', 'aac', 'dts']), audio_langs: o.audio || 'eng', audio_channels: pick(['stereo', '5.1', '5.1', '7.1']),
    sub_count: o.subs ? o.subs.split(',').length : 0, sub_codecs: o.subs ? 'subrip' : null, sub_langs: o.subs || null, sub_forced: 0, sidecar_subs: 0, has_captions: o.subs ? 1 : 0, has_override: 0, ignored: 0, adult: 0,
    channel: o.channel || null, video_id: o.videoId || null, upload_date: o.upload || null,
    plex_rating_key: o.plex ? String(nextPlex++) : null, plex_title: o.plex ? (o.show || o.movie) : null, plex_year: o.year || null, plex_show_key: o.plexShow || null, plex_guids: null,
    plex_user_rating: o.plex && rnd() < 0.15 ? pick([6, 8, 10]) : null, plex_audience_rating: o.plex ? Math.round((6 + rnd() * 3) * 10) / 10 : null, plex_view_count: o.watched ? int(1, 4) : 0, plex_last_viewed: o.watched ? iso(int(1, 200), 20) : null, plex_view_offset_ms: null,
    plex_section: o.plex ? o.root.label : null, plex_synced_at: o.plex ? iso(0, 6) : null, plex_genres: o.root.type === 'movie' && o.genres ? JSON.stringify(o.genres) : null,
  };
  insFile.run(...cols.map(c => row[c] === undefined ? null : row[c]));
  if (!o.missing) touch(row.abs_path);
  return row;
}

const series = [];
db.transaction(() => {
  // ---- series
  for (const [root, count, anime] of [[roots[0], 34, false], [roots[1], 38, true]]) {
    for (let i = 0; i < count; i++) {
      const show = title(anime ? ['', '', ' Chronicle', ' Academy', ' Frontier'] : ['', '', ' Street', ' Division', ' & Sons']);
      const seasons = int(1, anime ? 3 : 6); const per = anime ? pick([12, 12, 13, 24]) : pick([8, 10, 13, 22]);
      const res = pick(RES.slice(1)); const audio = anime ? pick(['jpn', 'jpn', 'eng', 'jpn,eng']) : 'eng'; const subs = anime ? (audio === 'eng' ? null : 'eng') : (rnd() < 0.3 ? 'eng' : null);
      const plexShow = rnd() < 0.9 ? String(nextPlex++) : null; const genres = [pick(GENRES), pick(GENRES), pick(GENRES)].filter((g, k, a) => a.indexOf(g) === k);
      const gaps = rnd() < 0.35 ? int(1, 5) : 0; const watchedUpTo = rnd() < 0.6 ? int(0, seasons * per) : 0; let n = 0; const expected = {};
      const mixed = rnd() < 0.15;
      for (let s = 1; s <= seasons; s++) {
        expected[s] = per;
        for (let e = 1; e <= per; e++) {
          n++;
          if (gaps && s === seasons && e > per - gaps) continue;                 // the last few episodes are missing
          addFile({ root, rel: path.join(show, `Season ${String(s).padStart(2, '0')}`, `${show} - S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')} - Episode ${e}.mkv`), show, season: s, episode: e, epTitle: `${pick(A)} ${pick(N)}`, minutes: anime ? 24 : pick([22, 43, 52]), res: mixed && e % 5 === 0 ? RES[3] : res, audio, subs, plex: !!plexShow, plexShow, watched: n <= watchedUpTo, lowBitrate: rnd() < 0.04, genres });
        }
      }
      const ended = rnd() < 0.6;
      db.run(`INSERT INTO series_meta (library_type, show_name, source, source_id, matched_title, status, seasons, total_episodes, url, fetched_at, locked, rating, rating_votes, genres, online_tags, next_airing, next_episode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        root.type, show, anime ? 'anilist' : 'tvmaze', String(int(1000, 99999)), show, ended ? (anime ? 'FINISHED' : 'Ended') : (anime ? 'RELEASING' : 'Running'), JSON.stringify(expected), seasons * per, 'https://example.invalid/demo', iso(int(0, 10)), 0, Math.round((6 + rnd() * 3) * 10) / 10, int(200, 9000), JSON.stringify(genres), JSON.stringify(anime ? [pick(['School', 'Isekai', 'Mecha', 'Slice of Life'])] : []), ended ? null : iso(-int(1, 9)).slice(0, 10), ended ? null : `S${String(seasons).padStart(2, '0')}E${String(per - gaps + 1).padStart(2, '0')}`);
      if (plexShow) db.run('INSERT INTO plex_shows (rating_key, section, title, year, leaf_count, viewed_leaf_count, synced_at, genres) VALUES (?,?,?,?,?,?,?,?)', plexShow, root.label, show, int(2005, 2026), seasons * per - gaps, Math.min(watchedUpTo, seasons * per - gaps), iso(0, 6), JSON.stringify(genres));
      series.push({ type: root.type, show, plexShow });
    }
  }
  // two duplicate episodes, two unparsed names, one unreadable file, one that vanished from the share
  const s0 = series[0];
  addFile({ root: roots[0], rel: path.join(s0.show, 'Season 01', `${s0.show} - S01E02 - Episode 2 (copy).mkv`), show: s0.show, season: 1, episode: 2, minutes: 43, res: RES[3] });
  addFile({ root: roots[0], rel: path.join(s0.show, 'Season 01', `${s0.show} - S01E03 - Episode 3 720p.mp4`), show: s0.show, season: 1, episode: 3, minutes: 43, res: RES[3] });
  addFile({ root: roots[0], rel: path.join(series[1].show, 'extras', 'behind the scenes.mkv'), show: series[1].show, minutes: 12, unparsed: true });
  addFile({ root: roots[1], rel: path.join(series[40].show, 'special preview.mkv'), show: series[40].show, minutes: 3, unparsed: true });
  addFile({ root: roots[0], rel: path.join(series[2].show, 'Season 01', `${series[2].show} - S01E01 - Episode 1 (damaged).mkv`), show: series[2].show, season: 1, episode: 1, minutes: 43, probeError: 'moov atom not found' });
  addFile({ root: roots[0], rel: path.join(series[3].show, 'Season 01', `${series[3].show} - S01E09 - Episode 9.mkv`), show: series[3].show, season: 1, episode: 9, minutes: 43, missing: true });

  // ---- movies
  for (let i = 0; i < 140; i++) {
    const t = title(['', '', '', ' Returns', ' Part Two', ' - The Long Night']); const year = int(1968, 2026); const group = `${t.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${year}`;
    const genres = [pick(GENRES), pick(GENRES)].filter((g, k, a) => a.indexOf(g) === k); const plex = rnd() < 0.92; const watched = rnd() < 0.45; const old = rnd() < 0.5;
    const tidy = rnd() < 0.55;  // the rest carry release-style names the naming engine would clean up
    const name = tidy ? `${t} (${year}).mkv` : `${t.replace(/ /g, '.')}.${year}.${pick(['1080p', '720p', '2160p'])}.${pick(['BluRay', 'WEB-DL', 'HDTV'])}.x264.mkv`;
    addFile({ root: roots[2], rel: path.join(tidy ? `${t} (${year})` : t, name), movie: t, year, group, minutes: int(82, 168), plex, watched, genres, addedDays: old ? int(380, 900) : int(2, 200), subs: rnd() < 0.4 ? 'eng' : null, lowBitrate: rnd() < 0.05 });
    if (i % 17 === 0) addFile({ root: roots[2], rel: path.join(`${t} (${year})`, `${t} (${year}) - Extended.mkv`), movie: t, year, group, edition: 'Extended', minutes: int(120, 190), res: RES[0], plex, genres, addedDays: int(2, 90) });
  }
  addFile({ root: roots[2], rel: path.join('Unsorted', `${series[5].show} S01E01.mkv`), movie: `${series[5].show} S01E01`, group: `${series[5].show.toLowerCase().replace(/[^a-z0-9]+/g, '')}s01e01|`, minutes: 43 });

  // ---- web videos
  for (const ch of ['Workshop Notes', 'Trail Diaries', 'Kitchen Bench']) for (let i = 0; i < 9; i++) { const vt = `${pick(A)} ${pick(N)} ${pick(['Build', 'Review', 'Walkthrough', 'Part ' + int(1, 5)])}`; addFile({ root: roots[3], rel: path.join(ch, `${vt} [${crypto.randomBytes(5).toString('hex')}].mp4`), channel: ch, videoId: crypto.randomBytes(5).toString('hex'), upload: iso(int(5, 700)).slice(0, 10), movie: vt, minutes: int(6, 48), res: RES[pick([1, 3])] }); }

  // ---- scans, changes, exports
  for (let i = 9; i >= 0; i--) db.run('INSERT INTO scans (started, finished, status, trigger, files_seen, added, removed, modified, probed, errors, duration_ms, threads) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', iso(i * 3, 3), iso(i * 3, 3), 'done', i % 3 ? 'timer' : 'manual', 6000 - i * 40, i === 9 ? 5600 : int(0, 45), int(0, 3), int(0, 6), int(0, 45), i === 4 ? 1 : 0, int(40000, 190000), 4);
  const scanId = db.get('SELECT MAX(id) n FROM scans').n;
  for (const f of db.all('SELECT library_type, rel_path FROM files ORDER BY first_seen DESC LIMIT 60')) db.run('INSERT INTO changes (scan_id, ts, kind, library_type, path, detail) VALUES (?,?,?,?,?,?)', int(1, scanId), iso(int(0, 28)), pick(['added', 'added', 'added', 'modified', 'removed', 'renamed']), f.library_type, f.rel_path, null);
  db.run('INSERT INTO exports (ts, scan_id, dir, files, rows, trigger) VALUES (?,?,?,?,?,?)', iso(1, 4), scanId, path.join(out, 'exports', '2026-09-27_0400'), JSON.stringify(['tv_series.csv', 'anime_series.csv', 'movies.csv', 'missing_episodes.csv', 'quality.csv']), 7420, 'scan');

  // ---- your own data: ratings, tags, fixes, collecting choices, requests
  for (const s of series.slice(0, 18)) db.run('INSERT INTO user_ratings (library_type, title_key, title, stars, note, updated) VALUES (?,?,?,?,?,?)', s.type, s.show, s.show, int(2, 5), rnd() < 0.3 ? 'Worth a rewatch' : null, iso(int(1, 60)));
  for (const s of series.slice(4, 22)) db.run('INSERT OR IGNORE INTO title_tags (library_type, title_key, tag, created) VALUES (?,?,?,?)', s.type, s.show, pick(['rewatch', 'family night', 'background', 'finish this']), iso(int(1, 60)));
  db.run('INSERT INTO series_prefs (library_type, show_name, mute, from_season, from_episode, note, updated_at) VALUES (?,?,?,?,?,?,?)', series[6].type, series[6].show, 0, 2, 1, 'joined at season two', iso(5));
  db.run('INSERT INTO series_prefs (library_type, show_name, mute, from_season, from_episode, note, updated_at) VALUES (?,?,?,?,?,?,?)', series[44].type, series[44].show, 1, null, null, null, iso(5));
  db.run('INSERT INTO overrides (root_id, rel_path, library_type, show_name, season, episode, note, created, updated, keep, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)', 'tv', path.join(series[1].show, 'extras', 'featurette.mkv'), 'tv', series[1].show, 0, 1, 'a special', iso(20), iso(20), 0, 'manual');
  const REQ = [['Paper Lantern Returns', 'movie', 2024, 'The extended cut if there is one', 'family: Alex', 'pending', null], ['Quiet Foundry', 'tv', null, null, 'family: Sam', 'approved', 'Looking for the full series'], ['Glass Atlas Academy', 'anime', 2025, 'Subtitled please', 'guest: Visitor', 'added', 'Added on Tuesday'], ['Salt Canyon', 'movie', 1999, null, 'admin', 'rejected', 'Not available in a good copy'], ['Copper Tide Division', 'tv', 2023, null, 'family: Alex', 'pending', null]];
  REQ.forEach((r, i) => db.run('INSERT INTO requests (created, title, kind, year, note, requested_by, status, admin_note, updated) VALUES (?,?,?,?,?,?,?,?,?)', iso(12 - i * 2), r[0], r[1], r[2], r[3], r[4], r[5], r[6], iso(11 - i * 2)));

  // ---- Plex: accounts, play history, last sync
  const people = [[1, 'Owner'], [2, 'Alex'], [3, 'Sam'], [4, 'Guest room']];
  for (const [id, name] of people) db.run('INSERT INTO plex_accounts (id, name, synced_at) VALUES (?,?,?)', id, name, iso(0, 6));
  const playable = db.all("SELECT id, plex_rating_key rk, library_type lt, show_name, movie_title, season, episode, episode_title, duration_s FROM files WHERE plex_rating_key IS NOT NULL AND missing=0 ORDER BY id");
  for (let i = 0; i < 520; i++) { const f = playable[int(0, playable.length - 1)]; const [aid, name] = people[pick([0, 0, 0, 1, 1, 2, 3])]; db.run('INSERT OR IGNORE INTO plex_history (history_key, rating_key, account_id, account_name, device, type, title, show_title, season, episode, section, viewed_at, duration_s, file_id, library_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', String(50000 + i), f.rk, aid, name, pick(['Living room TV', 'Tablet', 'Phone', 'Bedroom TV']), f.lt === 'movie' ? 'movie' : 'episode', f.lt === 'movie' ? f.movie_title : (f.episode_title || `Episode ${f.episode}`), f.lt === 'movie' ? null : f.show_name, f.season, f.episode, null, iso(int(0, 85), pick([18, 19, 20, 20, 21, 21, 22, 14])), f.duration_s, f.id, f.lt); }
  db.run('INSERT INTO plex_syncs (ts, sections, items, matched, unmatched, note, detail) VALUES (?,?,?,?,?,?,?)', iso(0, 6), 3, playable.length + 12, playable.length, 12, 'timer', JSON.stringify([{ section: 'Movies', type: 'movie', items: 131, matched: 131, unmatched: 0, reasons: {} }, { section: 'TV Shows', type: 'show', items: 2900, matched: 2900, unmatched: 0, reasons: {} }, { section: 'Anime', type: 'show', items: 2400, matched: 2388, unmatched: 12, reasons: { 'not in MediaLedger': 12 }, sample: { file: '/media/Anime/Example Show/Example Show - S01E01.mkv', local: path.join(lib, 'Anime', 'Example Show', 'Example Show - S01E01.mkv') } }]));

  // ---- a rename batch with an undo available
  db.run("INSERT INTO rename_batches (ts, mode, layout, status, planned, done, failed, undone, finished, note) VALUES (?,?,?,?,?,?,?,?,?,?)", iso(6), 'dry', 'inplace', 'done', 12, 12, 0, 0, iso(6), null);
  db.run("INSERT INTO rename_batches (ts, mode, layout, status, planned, done, failed, undone, finished, note) VALUES (?,?,?,?,?,?,?,?,?,?)", iso(5), 'live', 'inplace', 'done', 10, 10, 0, 0, iso(5), null);
  db.run("INSERT INTO rename_batches (ts, mode, layout, status, planned, done, failed, undone, finished, note) VALUES (?,?,?,?,?,?,?,?,?,?)", iso(3), 'live', 'episodes', 'done', 8, 8, 0, 0, iso(3), null);

  // ---- ninety daily snapshots for the trend cards
  const total = db.get('SELECT COUNT(*) n, SUM(size) b FROM files WHERE missing=0');
  for (let d = 90; d >= 0; d--) db.run('INSERT INTO snapshots (day, ts, files, bytes, free_bytes, series_tv, series_anime, movies, missing_episodes, watched_files, linked_files, pending_requests, tagged, captioned) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', iso(d).slice(0, 10), iso(d, 3), total.n - d * 9 - int(0, 4), total.b - d * 9 * 1.4e9, 9.5e12 - (90 - d) * 1.3e10, 34, 38, 140 - Math.floor(d / 3), 60 + Math.floor(d / 4), 2000 + (90 - d) * 6, playable.length, d % 9 === 0 ? 3 : 2, 18, 1400);
});
db.close();

// ---- settings: fictional addresses only
const settings = {
  roots, csvOutputDir: '', autoExportAfterScan: true, probeConcurrency: 8, multiThreaded: true, scanThreads: 4, reprobeUnchanged: false,
  metadata: { enabled: false, tvSource: 'tvmaze', animeSource: 'anilist', refreshDays: 14 },
  schedule: { inAppEnabled: false, inAppIntervalHours: 24, taskSchedulerEnabled: false, taskTime: '03:00', taskName: 'MediaLedger Scan' },
  plex: { enabled: true, everyHours: 6, baseUrl: 'http://plex.example.invalid:32400', token: '', pathMap: [{ plex: '/media', local: lib }] },
  backup: { enabled: true, dir: path.join(out, 'nas-backups'), time: '03:30', keep: 7, lastRun: iso(0, 3), lastFile: path.join(out, 'nas-backups', 'medialedger-2026-09-28T03-30-00.db'), lastError: null },
  posters: { enabled: true, dir: path.join(out, 'posters'), width: 300, online: false, lastRun: iso(0, 6) },
  snapshot: { time: '03:05' }, notify: { webhookUrl: 'https://home.example.invalid/api/webhook/medialedger', email: { enabled: false, host: 'smtp.example.invalid', port: 587, user: 'ledger@example.invalid', pass: '', to: 'owner@example.invalid' }, events: { request: true, dailySummary: true, backupFailed: true, airing: true, jobStale: true, portalDown: true }, dailyTime: '08:00', lastSummary: iso(0, 8) },
  renaming: { enabled: true, parts: ['title'], batchLimit: 200 }, movieRename: { enabled: true, layout: 'inplace', batchLimit: 200, parts: ['title', 'year', 'resolution'] },
  updates: { enabled: false }, githubToken: '', watchFolders: false, rootCheckMinutes: 0,
  ui: { theme: 'dark', prefs: { editorLevel: 'advanced' } },
};
fs.writeFileSync(path.join(out, 'settings.json'), JSON.stringify(settings, null, 2));

// ---- two backup sets so the Restore dialog has something to list
fs.mkdirSync(settings.backup.dir, { recursive: true });
for (const stamp of ['2026-09-27T03-30-00', '2026-09-28T03-30-00']) { fs.copyFileSync(path.join(out, 'medialedger.db'), path.join(settings.backup.dir, `medialedger-${stamp}.db`)); fs.copyFileSync(path.join(out, 'settings.json'), path.join(settings.backup.dir, `medialedger-${stamp}.settings.json`)); }

// ---- the titles that should get a generated poster (see make-demo-posters.py)
const db2 = new Db(path.join(out, 'medialedger.db'));
const want = [...db2.all("SELECT 'movie' type, group_key key, MIN(movie_title) title FROM files WHERE library_type='movie' AND group_key IS NOT NULL GROUP BY group_key"), ...db2.all("SELECT library_type type, show_name key, show_name title FROM files WHERE library_type IN ('tv','anime') GROUP BY library_type, show_name")]
  .filter((_, i) => i % 11 !== 0)   // leave some without art, as in a real library
  .map(t => ({ ...t, file: `${t.type}/${crypto.createHash('sha1').update(String(t.key)).digest('hex')}.png` }));
fs.writeFileSync(path.join(out, 'posters-wanted.json'), JSON.stringify(want));
const c = db2.get('SELECT COUNT(*) n FROM files'); db2.close();
console.log(`demo data in ${out}: ${c.n} files, ${series.length} series, 140 movies, ${want.length} posters wanted`);
