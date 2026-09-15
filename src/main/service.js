'use strict';
// MediaLedger core: everything the app does that is not "be a window".
//
// Both shells build on this: the Electron desktop app (main.js) and the web
// server for the Raspberry Pi (server/). Nothing in here may require Electron.
// The shell supplies the platform facts it owns:
//   userData  data folder (settings.json, medialedger.db, log, exports)
//   log       (…parts) => void
//   send      (channel, payload) => void   progress events to the UI
//   host      { isPackaged, getAppPath() } for the Windows Task Scheduler command
//
// createService() returns `handlers`, a Map of channel name → function. The
// Electron shell registers each with ipcMain.handle; the web shell mounts each
// as an HTTP route. Same names, same arguments, same results.
const { titleAudioType, onlineTags, normalizeTag } = require('./tags');
const os = require('os');
const { createNotifier } = require('./notify');
const { upgradeScore, upgradeReasons, RES_RANK } = require('./upgrades');
const path = require('path');
const fs = require('fs');
const { Settings } = require('./settings');
const { Db } = require('./db');
const { Scanner } = require('./scanner');
const { Scheduler } = require('./scheduler');
const { Watcher } = require('./watcher');
const { exportAll } = require('./exportCsv');
const { findFfprobe } = require('./ffprobe');
const { PARSER_VERSION } = require('./parse');
const ffmpegdl = require('./ffmpegdl');
const metadata = require('./metadata');
const renamer = require('./renamer');
const { planMovieNames } = require('./movieNamer');
const movieRename = require('./movieRename');
const plex = require('./plex');
const sysmon = require('./sysmon');
const rootcheck = require('./rootcheck');

function createService({ userData, log, send, host }) {
  let settings, db, scanner, scheduler, watcher;
  let metaJob = { running: false, done: 0, total: 0, message: '' };
  const handlers = new Map();
  const h = (ch, fn) => handlers.set(ch, fn);

  function exportDir() { return settings.get().csvOutputDir || path.join(userData, 'exports'); }
  function ffprobePath() { return findFfprobe(settings.get().ffprobePath) || ffmpegdl.installedFfprobe(userData); }

  function runExport(scanId, trigger, opts) {
    const cfg = settings.get().export || {};
    const out = exportAll(db, exportDir(), scanId, settings.get(), { sets: (opts && opts.sets) || cfg.sets, zip: opts && opts.zip != null ? !!opts.zip : !!cfg.zip, zipMin: opts && opts.zipMin != null ? opts.zipMin : cfg.zipMin });
    db.addExport({ scan_id: scanId, dir: out.dir, files: out.files, rows: out.rows, trigger, zip: out.zip });
    return out;
  }

  // Adult content is hidden from every query unless the sidebar switch is on. Resets each launch.
  let showAdult = false;
  const AF = (alias = '') => showAdult ? '' : ` AND ${alias}adult=0`;

  // Exclusive lock held while a live movie-rename batch runs; scans and the watcher back off.
  let renameLock = null; // { rootId, since }

  async function runScan(trigger) {
    if (scanner.running) return { skipped: true, reason: 'already running' };
    if (renameLock) { log(`scan (${trigger}) skipped: rename batch in progress on ${renameLock.rootId}`); return { skipped: true, reason: 'a rename batch is running; try again when it finishes' }; }
    log(`scan start (${trigger})`);
    const result = await scanner.scan(trigger);
    scheduler.noteRun();
    log(`scan ${result.status} in ${Math.round(result.duration_ms / 1000)}s: seen=${result.files_seen} added=${result.added} removed=${result.removed} modified=${result.modified} probed=${result.probed} errors=${result.errors}`);
    if (result.status === 'done' && settings.get().metadata.enabled) {
      try { await refreshMetadata({ onlyNew: true }); } catch (e) { log('metadata failed: ' + e.message); }
    }
    if (result.status === 'done' && settings.get().plex.enabled && settings.get().plex.token) {
      try { await runPlexSync(trigger); } catch { /* logged */ }
    }
    if (settings.get().autoExportAfterScan && result.status === 'done') {
      try { const out = runExport(result.scanId, trigger); log('exported to ' + out.dir); result.export = out; }
      catch (e) { log('export failed: ' + e.message); }
    }
    db.checkpoint();
    return result;
  }

  // ---- Plex sync ---------------------------------------------------------------------
  let plexJob = { running: false, message: '' };
  async function runPlexSync(trigger = 'manual') {
    if (plexJob.running) return { skipped: true };
    const cfg = settings.get().plex;
    if (!cfg.token) throw new Error('No Plex token set (Settings → Plex)');
    plexJob = { running: true, message: 'Connecting to Plex…' }; send('plex:progress', plexJob);
    try {
      const r = await plex.syncLibrary(db, cfg, { log, onProgress: p => { plexJob = { running: true, ...p }; send('plex:progress', plexJob); } });
      if (r.mappingSuggested && !(cfg.pathMap || []).length) settings.set({ plex: { pathMap: [r.mappingSuggested] } });
      db.run('INSERT INTO plex_syncs (ts, sections, items, matched, unmatched, note) VALUES (?,?,?,?,?,?)', r.synced_at, r.sections, r.items, r.matched, r.unmatched, trigger);
      plexJob = { running: false, message: `Plex sync: ${r.matched.toLocaleString()} of ${r.items.toLocaleString()} items matched`, result: r }; send('plex:progress', plexJob);
      log(`plex sync (${trigger}): ${r.matched}/${r.items} matched, ${r.unmatched} unmatched, ${r.shows} shows`);
      return r;
    } catch (e) {
      plexJob = { running: false, message: 'Plex sync failed: ' + e.message, error: e.message }; send('plex:progress', plexJob);
      log('plex sync failed: ' + e.message);
      throw e;
    }
  }

  // ---- series metadata (expected episode counts) ---------------------------------
  async function refreshMetadata({ onlyNew = true, type = null, shows = null } = {}) {
    if (metaJob.running) return { skipped: true };
    const cfg = settings.get().metadata;
    const types = type ? [type] : ['tv', 'anime'];
    const todo = [];
    const staleBefore = new Date(Date.now() - (Number(cfg.refreshDays) || 14) * 86400000).toISOString();
    for (const t of types) {
      const have = db.allSeriesMeta(t);
      // Adult-root series are never looked up: AniList refuses them (403) and the titles should not leave this machine.
      const series = db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND adult=0 AND show_name IS NOT NULL ORDER BY show_name`, t).map(r => r.show_name);
      for (const s of series) {
        if (shows && !shows.includes(s)) continue;
        const m = have.get(s);
        if (m && m.locked) continue;
        // A matched series without genres yet (looked up before 1.4) is fetched once more to fill them in.
        const needsGenres = m && (m.source === 'tvmaze' || m.source === 'anilist') && m.genres == null;
        const aired = m && m.next_airing && m.next_airing < new Date().toISOString().slice(0, 10); // the expected episode is out: fetch the next one
        if (onlyNew && m && m.fetched_at && !needsGenres && !aired && !(m.status && /running|releasing|airing/i.test(m.status) && m.fetched_at < staleBefore)) continue;
        todo.push({ type: t, show: s });
      }
    }
    metaJob = { running: true, done: 0, total: todo.length, message: 'Looking up expected episode counts…' };
    send('meta:progress', metaJob);
    let found = 0, missed = 0, failed = 0;
    try {
      for (const { type: t, show } of todo) {
        try {
          const r = await metadata.lookupSeries(t, show);
          if (r.found) { found++; db.saveSeriesMeta({ library_type: t, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, rating: r.rating ?? null, rating_votes: r.rating_votes ?? null, genres: r.genres || [], online_tags: r.online_tags || [], next_airing: r.next_airing || null, next_episode: r.next_episode || null, fetched_at: new Date().toISOString(), locked: 0 }); }
          else { missed++; db.saveSeriesMeta({ library_type: t, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 0, note: r.candidates ? 'no confident match' : 'not found' }); }
        } catch (e) { failed++; log(`metadata ${t} "${show}": ${e.message}`); if (/HTTP 429/.test(e.message)) await new Promise(r => setTimeout(r, 10000)); }
        metaJob.done++; metaJob.message = `Looking up ${t === 'anime' ? 'AniList' : 'TVmaze'}: ${show}`;
        if (metaJob.done % 3 === 0 || metaJob.done === metaJob.total) send('meta:progress', metaJob);
        await new Promise(r => setTimeout(r, t === 'anime' ? 800 : 550)); // stay under both rate limits
      }
    } finally {
      metaJob = { running: false, done: metaJob.done, total: metaJob.total, message: `Done: ${found} matched, ${missed} unmatched, ${failed} errors` };
      send('meta:progress', metaJob);
      log(`metadata: ${found} matched, ${missed} unmatched, ${failed} errors of ${todo.length}`);
    }
    return { found, missed, failed, total: todo.length };
  }

  // Missing-episode summary for every series of a type (used by dashboard, series list, CSV, Missing view).
  function missingSummary(type) {
    const metas = db.allSeriesMeta(type);
    const rows = db.all(`SELECT show_name, season, episode, episode_end FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} AND parse_ok=1`, type);
    const byShow = new Map();
    for (const r of rows) { if (!byShow.has(r.show_name)) byShow.set(r.show_name, []); byShow.get(r.show_name).push(r); }
    const out = [];
    for (const [show, list] of byShow) {
      const m = metas.get(show);
      const res = m && m.seasons ? metadata.missingEpisodes(list, m.seasons) : { missing: [], missingCount: 0, expectedTotal: 0, haveTotal: 0, absolute: false };
      out.push({ library_type: type, show_name: show, source: m ? m.source : null, matched_title: m ? m.matched_title : null, status: m ? m.status : null, url: m ? m.url : null, locked: m ? m.locked : 0, note: m ? m.note : null,
        expected: res.expectedTotal, have: res.haveTotal, missing_count: res.missingCount, missing: res.missing, absolute: res.absolute, seasons: m && m.seasons ? JSON.parse(m.seasons) : null });
    }
    return out.sort((a, b) => b.missing_count - a.missing_count || a.show_name.localeCompare(b.show_name));
  }

  function qualityReport() {
    const thr = settings.get().quality.minKbps || {};
    const mixed = db.all(`SELECT library_type, show_name, COUNT(*) files, COUNT(DISTINCT resolution) res_n, GROUP_CONCAT(DISTINCT resolution) resolutions, COUNT(DISTINCT video_codec) codec_n, GROUP_CONCAT(DISTINCT video_codec) codecs
      FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name HAVING res_n > 1 ORDER BY res_n DESC, files DESC`);
    const perSeasonMixed = db.all(`SELECT library_type, show_name, season, COUNT(*) files, GROUP_CONCAT(DISTINCT resolution) resolutions FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND library_type IN ('tv','anime') GROUP BY library_type, show_name, season HAVING COUNT(DISTINCT resolution) > 1 ORDER BY show_name, season`);
    const all = db.all(`SELECT id, root_id, library_type, rel_path, file_name, show_name, movie_title, movie_year, resolution, bitrate_kbps, video_codec, duration_s, size FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND bitrate_kbps IS NOT NULL AND resolution IS NOT NULL`);
    const low = all.filter(f => thr[f.resolution] && f.bitrate_kbps < thr[f.resolution]).sort((a, b) => (a.bitrate_kbps / thr[a.resolution]) - (b.bitrate_kbps / thr[b.resolution]));
    const undAudio = db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND (audio_langs IS NULL OR audio_langs='und') GROUP BY library_type`);
    const short = db.all(`SELECT id, root_id, library_type, rel_path, file_name, duration_s, size FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND duration_s < 120 ORDER BY duration_s LIMIT 500`);
    const noAudio = db.all(`SELECT id, root_id, library_type, rel_path, file_name FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND (audio_count IS NULL OR audio_count=0) LIMIT 500`);
    return { thresholds: thr, mixed, perSeasonMixed, low: low.slice(0, 2000), lowTotal: low.length, undAudio, short, noAudio };
  }

  // Background reachability check of the enabled roots. Emits 'roots:status' whenever the set of unreachable roots changes.
  let rootsLast = { ts: null, roots: [], problems: [] };
  let rootsTimer = null;
  async function checkRootsNow() {
    const enabled = (settings.get().roots || []).filter(r => r.enabled && r.path);
    const roots = await rootcheck.checkRoots(enabled);
    const problems = roots.filter(r => r.status !== 'ok').map(r => ({ id: r.id, label: r.label, status: r.status, detail: r.detail }));
    const changed = JSON.stringify(problems.map(p => p.id + p.status)) !== JSON.stringify(rootsLast.problems.map(p => p.id + p.status));
    rootsLast = { ts: new Date().toISOString(), roots, problems };
    if (changed) { send('roots:status', rootsLast); log(problems.length ? `roots: ${problems.map(p => `${p.label} ${p.status} (${p.detail})`).join('; ')}` : 'roots: all reachable'); }
    return rootsLast;
  }
  function scheduleRootChecks() {
    clearInterval(rootsTimer); rootsTimer = null;
    const min = Number(settings.get().rootCheckMinutes) || 0;
    if (min > 0) { rootsTimer = setInterval(() => checkRootsNow().catch(() => {}), min * 60000); if (rootsTimer.unref) rootsTimer.unref(); }
  }

  // Open settings and the database, wire the scanner and re-parse if the parser changed. Call once.
  function init() {
    settings = new Settings(userData);
    db = new Db(path.join(userData, 'medialedger.db'), { log });
    scanner = new Scanner(db, settings, { log });
    scheduler = new Scheduler(host, settings, runScan);
    watcher = new Watcher(settings, runScan, log);
    scanner.onProgress(p => send('scan:progress', p));
    sysmon.start({ settings, userData, get scanner() { return scanner; }, get db() { return db; } });
    scheduleRootChecks(); setTimeout(() => checkRootsNow().catch(() => {}), 3000);
    if (settings.get().parserVersion !== PARSER_VERSION) {
      const n = scanner.reparseAll();
      settings.set({ parserVersion: PARSER_VERSION });
      log(`parser v${PARSER_VERSION}: re-parsed ${n} indexed files`);
    }
  }

  function shutdown() {
    clearInterval(rootsTimer); sysmon.stop(); scheduler && scheduler.stop(); watcher && watcher.stop();
    try { db && db.close(); } catch { /* ignore */ }
  }

  // ---- handlers (shared by every shell) ----------------------------------------------
  h('sys:stats', () => sysmon.stats({ settings, userData, scanner, db }));
  // Reachability of library roots (saved ones by default, or an unsaved list from the Settings form), the last background result, and a server-side folder browser.
  h('roots:check', (roots) => rootcheck.checkRoots(roots && roots.length ? roots : settings.get().roots));
  h('roots:last', () => rootsLast);
  h('roots:listDirs', (p) => rootcheck.listDirs(p || ''));
  h('settings:get', () => settings.get());
  h('settings:set', (patch) => { const s = settings.set(patch); watcher.apply(); scheduleRootChecks(); return s; });
  h('settings:replace', (next) => { const s = settings.replace(next); watcher.apply(); scheduleRootChecks(); return s; });

  h('scan:start', (trigger) => runScan(trigger || 'manual'));
  h('scan:cancel', () => { scanner.cancel(); return true; });
  h('scan:status', () => ({ running: scanner.running, progress: scanner.progress }));
  h('scan:list', (limit) => db.recentScans(limit || 30));

  h('export:run', (opts) => runExport(null, 'manual', opts || {}));
  h('export:sets', () => Object.entries(require('./exportCsv').SETS).map(([key, v]) => ({ key, label: v.label, files: v.files })));
  h('export:list', () => db.listExports(50));

  h('schedule:taskStatus', () => scheduler.taskStatus());
  h('schedule:installTask', async () => { const r = await scheduler.installTask(); if (r.ok) settings.set({ schedule: { taskSchedulerEnabled: true } }); return r; });
  h('schedule:removeTask', async () => { const r = await scheduler.removeTask(); settings.set({ schedule: { taskSchedulerEnabled: false } }); return r; });
  h('schedule:runTaskNow', () => scheduler.runTaskNow());
  h('schedule:nextInApp', () => scheduler.nextInAppRun());
  h('watch:status', () => watcher.status());

  h('ffmpeg:download', async () => {
    const p = await ffmpegdl.downloadFfmpeg(userData, prog => send('ffmpeg:progress', prog));
    settings.set({ ffprobePath: p });
    return { ok: true, path: p, version: await ffmpegdl.ffprobeVersion(p) };
  });


  h('db:backup', () => db.backup('manual'));
  h('db:backups', () => db.listBackups());
  h('db:stats', () => db.stats());

  h('plex:test', (cfg) => plex.testConnection(cfg || settings.get().plex));
  h('plex:sync', () => runPlexSync('manual'));
  h('plex:status', () => {
    const last = db.get('SELECT * FROM plex_syncs ORDER BY id DESC LIMIT 1');
    const linked = db.get('SELECT COUNT(*) n FROM files WHERE plex_rating_key IS NOT NULL AND missing=0').n;
    const total = db.get('SELECT COUNT(*) n FROM files WHERE missing=0 AND ignored=0').n;
    const watched = db.get('SELECT COUNT(*) n FROM files WHERE plex_view_count > 0 AND missing=0').n;
    const rated = db.get('SELECT COUNT(*) n FROM files WHERE plex_user_rating IS NOT NULL AND missing=0').n + db.get('SELECT COUNT(*) n FROM plex_shows WHERE user_rating IS NOT NULL').n;
    const unlinked = db.all(`SELECT library_type, show_name, movie_title, movie_year, rel_path FROM files WHERE plex_rating_key IS NULL AND missing=0 AND ignored=0 AND library_type IN ('tv','anime','movie')${AF()} ORDER BY library_type, rel_path LIMIT 300`);
    return { job: plexJob, last, linked, total, watched, rated, unlinked, pathMap: settings.get().plex.pathMap || [] };
  });

  // ---- overrides (manual fixes) --------------------------------------------------
  h('override:list', () => db.listOverrides());
  h('override:save', (o) => { const saved = db.saveOverride(o); const file = scanner.reapplyOverride(o.root_id, o.rel_path); return { override: saved, file }; });
  h('override:delete', (id) => { const ov = db.get('SELECT * FROM overrides WHERE id=?', id); if (!ov) return false; db.deleteOverride(id); scanner.reapplyOverride(ov.root_id, ov.rel_path); return true; });
  h('override:suggest', (rootId, relPath) => {
    const f = db.getFileByPath(rootId, relPath);
    if (!f) return null;
    return { file: f, override: db.getOverride(rootId, relPath), shows: db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND show_name IS NOT NULL ORDER BY show_name`, f.library_type).map(r => r.show_name) };
  });

  // ---- expected episodes / missing ------------------------------------------------
  h('meta:refresh', (opts) => refreshMetadata(opts || {}));
  h('meta:status', () => metaJob);
  h('meta:get', (type, show) => db.getSeriesMeta(type, show));
  h('meta:search', (type, q) => metadata.searchCandidates(type, q));
  h('meta:setMatch', async (type, show, source, id) => {
    const r = await metadata.fetchById(source, id);
    if (!r.found) throw new Error('That entry could not be loaded');
    return db.saveSeriesMeta({ library_type: type, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, rating: r.rating ?? null, rating_votes: r.rating_votes ?? null, genres: r.genres || [], online_tags: r.online_tags || [], next_airing: r.next_airing || null, next_episode: r.next_episode || null, fetched_at: new Date().toISOString(), locked: 1 });
  });
  h('meta:setManual', (type, show, seasons, note) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'manual', seasons, total_episodes: Object.entries(seasons).filter(([s]) => s !== '0').reduce((a, [, n]) => a + Number(n || 0), 0), fetched_at: new Date().toISOString(), locked: 1, note }));
  h('meta:setNone', (type, show) => db.saveSeriesMeta({ library_type: type, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 1, note: 'no expected counts' }));
  h('meta:unlock', (type, show) => { db.deleteSeriesMeta(type, show); return true; });
  h('data:missing', (type) => type ? missingSummary(type) : [...missingSummary('tv'), ...missingSummary('anime')]);

  // ---- duplicates review -------------------------------------------------------------
  h('data:duplicates', () => {
    const groups = db.all(`SELECT library_type, show_name, season, episode, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING n>1 ORDER BY show_name, season, episode`);
    const out = [];
    for (const g of groups) {
      const files = db.all(`SELECT f.id, f.root_id, f.rel_path, f.abs_path, f.file_name, f.size, f.resolution, f.width, f.height, f.video_codec, f.bit_depth, f.hdr, f.bitrate_kbps, f.duration_s, f.audio_langs, f.audio_codecs, f.sub_count, f.sub_langs, f.ext, o.keep
        FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type=? AND f.show_name=? AND f.season=? AND f.episode=? AND f.missing=0 AND f.ignored=0 ORDER BY f.size DESC`, g.library_type, g.show_name, g.season, g.episode);
      out.push({ ...g, decided: files.some(f => f.keep === 1), files });
    }
    return out;
  });
  h('dup:keep', (rootId, relPath, keepId) => {
    // Mark one file as keep=1 and the rest of its group keep=0 (nothing is deleted).
    const f = db.getFileByPath(rootId, relPath); if (!f) return false;
    const group = db.all(`SELECT id, root_id, rel_path, library_type FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0${AF()}`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path) || { root_id: g.root_id, rel_path: g.rel_path, library_type: g.library_type }; db.saveOverride({ ...ov, keep: g.id === keepId ? 1 : 0 }); } });
    return true;
  });
  h('dup:clear', (rootId, relPath) => {
    const f = db.getFileByPath(rootId, relPath); if (!f) return false;
    const group = db.all(`SELECT id, root_id, rel_path FROM files WHERE library_type=? AND show_name=? AND season=? AND episode=? AND missing=0 AND ignored=0${AF()}`, f.library_type, f.show_name, f.season, f.episode);
    db.transaction(() => { for (const g of group) { const ov = db.getOverride(g.root_id, g.rel_path); if (ov) db.saveOverride({ ...ov, keep: null }); } });
    return true;
  });

  // ---- quality ------------------------------------------------------------------------
  h('data:quality', () => qualityReport());

  // Per-title language counts for the sub/dub tag (see tags.js). LIKE is enough: ffprobe writes ISO codes separated by commas.
  const AUDIO_COUNTS = `SUM(CASE WHEN probe_ok=1 AND audio_langs IS NOT NULL AND audio_langs<>'' THEN 1 ELSE 0 END) probed_audio, SUM(CASE WHEN audio_langs LIKE '%jpn%' OR audio_langs LIKE '%ja%' THEN 1 ELSE 0 END) jpn_files, SUM(CASE WHEN audio_langs LIKE '%eng%' OR audio_langs LIKE '%en,%' OR audio_langs='en' THEN 1 ELSE 0 END) eng_files, SUM(CASE WHEN (audio_langs LIKE '%jpn%' OR audio_langs LIKE '%ja%') AND (audio_langs LIKE '%eng%' OR audio_langs LIKE '%en,%' OR audio_langs='en') THEN 1 ELSE 0 END) dual_files`;

  // ---- movie naming engine ---------------------------------------------------------------
  function moviePlan() {
    const mr = settings.get().movieRename || {};
    const truth = mr.truth || 'parser', parts = mr.parts;
    const rows = db.all(`SELECT f.*, o.source AS source_override FROM files f LEFT JOIN overrides o ON o.root_id=f.root_id AND o.rel_path=f.rel_path WHERE f.library_type='movie' AND f.missing=0${AF('f.')} ORDER BY f.movie_title COLLATE NOCASE, f.file_name`);
    return planMovieNames(rows.map(r => ({ ...r, truth, parts })));
  }
  h('movie:plan', () => ({ plan: moviePlan(), lock: renameLock, settings: settings.get().movieRename }));
  h('movie:run', async (ids, opts) => {
    const cfg = settings.get();
    if (opts.live && !cfg.movieRename.enabled) throw new Error('Live renaming is switched off in this tab. Turn on "Allow live renames" first.');
    if (renameLock) throw new Error('Another rename batch is still running');
    if (scanner.running) throw new Error('A scan is running; wait for it to finish before renaming');
    const wanted = new Set(ids);
    const items = moviePlan().filter(p => wanted.has(p.id) && p.ok && !p.unchanged);
    if (!items.length) throw new Error('Nothing selected is ready to rename');
    const rootIds = [...new Set(items.map(i => i.root_id))];
    if (rootIds.length !== 1) throw new Error('A batch must stay within one root');
    const root = cfg.roots.find(r => r.id === rootIds[0]);
    if (!root) throw new Error('Root not found in settings');
    if (opts.live) renameLock = { rootId: root.id, since: new Date().toISOString() };
    try {
      return movieRename.runBatch(db, items, { live: !!opts.live, layout: opts.layout || cfg.movieRename.layout || 'inplace', rootPath: root.path, limit: Number(cfg.movieRename.batchLimit) || 200, log, onProgress: p => send('movie:progress', p) });
    } finally { renameLock = null; db.checkpoint(); }
  });
  h('movie:undo', (batchId) => {
    if (renameLock) throw new Error('Another rename batch is still running');
    renameLock = { rootId: 'undo', since: new Date().toISOString() };
    try { return movieRename.undoBatch(db, batchId, log); } finally { renameLock = null; db.checkpoint(); }
  });
  h('movie:batches', () => db.listBatches(50));
  h('movie:batchItems', (id) => db.batchItems(id));

  // ---- adult visibility -------------------------------------------------------------------
  const adultCount = () => db.get('SELECT COUNT(*) n FROM files WHERE adult=1 AND missing=0 AND ignored=0').n;
  h('adult:status', () => ({ showAdult, count: adultCount(), rootConfigured: (settings.get().roots || []).some(r => r.type === 'adult' && r.enabled) }));
  h('adult:toggle', (on) => { showAdult = !!on; return { showAdult, count: adultCount() }; });

  // ---- media requests (anyone may file one; the web shell fills requested_by from the account) ----
  const KINDS = ['movie', 'tv', 'anime', 'other'];
  h('requests:list', () => db.listRequests());
  h('requests:add', (r) => {
    const title = String((r || {}).title || '').trim().slice(0, 200);
    if (title.length < 2) throw new Error('Give the title');
    const kind = KINDS.includes((r || {}).kind) ? r.kind : 'other';
    const year = Number((r || {}).year) >= 1880 && Number((r || {}).year) <= 2100 ? Number(r.year) : null;
    const row = db.addRequest({ title, kind, year, note: String((r || {}).note || '').trim().slice(0, 1000) || null, requested_by: String((r || {}).requested_by || 'desktop').slice(0, 60) });
    notifier.send('request', `New request: ${title}${year ? ` (${year})` : ''}`, `${row.requested_by || 'someone'} asked for ${kind === 'other' ? '' : kind + ' '}${title}${year ? ` (${year})` : ''}${row.note ? `\n${row.note}` : ''}\nPending requests: ${db.pendingRequests()}`, { kind, year, requested_by: row.requested_by }).catch(() => {});
    return row;
  });
  h('requests:update', (id, patch) => { const st = (patch || {}).status; if (st && !['pending', 'approved', 'added', 'rejected'].includes(st)) throw new Error('Bad status'); return db.updateRequest(Number(id), { status: st, admin_note: (patch || {}).admin_note !== undefined ? String(patch.admin_note || '').slice(0, 1000) : undefined }); });
  h('requests:delete', (id) => db.deleteRequest(Number(id)));
  h('adult:dashboard', () => ({
    byType: db.all(`SELECT library_type, COUNT(*) files, SUM(size) bytes, SUM(duration_s) seconds, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed FROM files WHERE adult=1 AND missing=0 AND ignored=0 GROUP BY library_type`),
    series: db.all(`SELECT library_type, show_name, COUNT(*) episodes, COUNT(DISTINCT season) seasons, SUM(size) bytes, SUM(duration_s) seconds, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY show_name COLLATE NOCASE`),
    movies: db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, GROUP_CONCAT(DISTINCT resolution) resolutions FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND library_type='movie' GROUP BY group_key ORDER BY title COLLATE NOCASE`),
    resolution: db.all(`SELECT library_type, resolution k, COUNT(*) n FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, resolution ORDER BY n DESC`),
    recent: db.all(`SELECT library_type, show_name, movie_title, season, episode, file_name, first_seen FROM files WHERE adult=1 AND missing=0 AND ignored=0 ORDER BY first_seen DESC, id DESC LIMIT 12`),
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, parse_note FROM files WHERE adult=1 AND missing=0 AND ignored=0 AND parse_ok=0 ORDER BY rel_path LIMIT 500`),
  }));

  // ---- web videos ---------------------------------------------------------------------------
  h('web:channels', () => db.all(`SELECT COALESCE(channel,'(no channel)') channel, COUNT(*) videos, SUM(size) bytes, SUM(duration_s) seconds, MIN(upload_date) first_upload, MAX(upload_date) last_upload, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, MAX(first_seen) last_added FROM files WHERE library_type='web' AND missing=0 AND ignored=0${AF()} GROUP BY COALESCE(channel,'(no channel)') ORDER BY channel COLLATE NOCASE`));
  h('web:videos', (channel) => db.all(`SELECT * FROM files WHERE library_type='web' AND ignored=0 AND COALESCE(channel,'(no channel)')=?${AF()} ORDER BY missing, upload_date DESC, movie_title`, channel));

  // ---- ratings ------------------------------------------------------------------------------
  h('ratings:list', () => {
    const ur = new Map(db.userRatings().map(u => [u.library_type + '|' + u.title_key, u]));
    const out = [];
    const plexShows = new Map(db.all('SELECT rating_key, user_rating, audience_rating, rating, leaf_count, viewed_leaf_count FROM plex_shows').map(s => [s.rating_key, s]));
    for (const t of ['tv', 'anime']) {
      const metas = db.allSeriesMeta(t);
      for (const r of db.all(`SELECT show_name, COUNT(*) files, SUM(size) bytes, MAX(plex_show_key) plex_show_key, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} GROUP BY show_name`, t)) {
        const m = metas.get(r.show_name), u = ur.get(t + '|' + r.show_name), ps = r.plex_show_key ? plexShows.get(r.plex_show_key) : null;
        out.push({ library_type: t, key: r.show_name, title: r.show_name, files: r.files, bytes: r.bytes, online: m ? m.rating : null, online_source: m && m.rating != null ? m.source : null, online_votes: m ? m.rating_votes : null, url: m ? m.url : null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null,
          plex_user: ps ? ps.user_rating : null, plex_audience: ps ? (ps.audience_rating ?? ps.rating) : null, watched: r.watched, plex_linked: !!r.plex_show_key });
      }
    }
    for (const r of db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(plex_user_rating) plex_user, MAX(plex_audience_rating) plex_audience, MAX(plex_view_count) watched, MAX(plex_rating_key) plex_key FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key`)) {
      const u = ur.get('movie|' + r.group_key);
      out.push({ library_type: 'movie', key: r.group_key, title: r.year ? `${r.title} (${r.year})` : r.title, files: r.files, bytes: r.bytes, online: null, online_source: null, online_votes: null, url: null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null,
        plex_user: r.plex_user, plex_audience: r.plex_audience, watched: r.watched ? 1 : 0, plex_linked: !!r.plex_key });
    }
    for (const r of db.all(`SELECT COALESCE(channel,'(no channel)') channel, COUNT(*) files, SUM(size) bytes FROM files WHERE library_type='web' AND missing=0 AND ignored=0${AF()} GROUP BY COALESCE(channel,'(no channel)')`)) {
      const u = ur.get('web|' + r.channel);
      out.push({ library_type: 'web', key: r.channel, title: r.channel, files: r.files, bytes: r.bytes, online: null, online_source: null, online_votes: null, url: null, stars: u ? u.stars : null, note: u ? u.note : null, updated: u ? u.updated : null });
    }
    return out;
  });
  h('ratings:setUser', (type, key, title, stars, note) => db.setUserRating(type, key, title, stars == null || stars === '' ? null : Number(stars), note || null));

  // ---- bulk source for the movie naming engine ----------------------------------------------
  h('override:bulkSource', (ids, source) => {
    if (!/^(web|rip|)$/i.test(source || '')) throw new Error('Source must be web, rip or empty');
    const rows = db.all(`SELECT id, root_id, rel_path, library_type FROM files WHERE id IN (${ids.map(() => '?').join(',')}) AND library_type='movie'`, ...ids);
    db.transaction(() => { for (const f of rows) { const ov = db.getOverride(f.root_id, f.rel_path) || { root_id: f.root_id, rel_path: f.rel_path, library_type: 'movie' }; db.saveOverride({ ...ov, source: source ? source.toLowerCase() : null }); } });
    return rows.length;
  });

  // ---- rename tool (opt-in) -------------------------------------------------------------
  h('rename:proposals', (opts) => { const cfg = settings.get().renaming; if (!cfg.enabled) return { disabled: true, list: [], parts: cfg.parts }; return { list: renamer.proposals(db, { ...(opts || {}), parts: cfg.parts }), parts: renamer.normalizeEpParts(cfg.parts), lock: renameLock }; });
  // Episodes go through the same batch engine as movies (pre-flight, verified rename, journal, undo). One root per batch, in place only.
  function episodeBatch(ids, live) {
    const cfg = settings.get();
    if (!cfg.renaming.enabled) throw new Error('Renaming is disabled in Settings');
    if (renameLock) throw new Error('Another rename batch is still running');
    if (scanner.running) throw new Error('A scan is running; wait for it to finish before renaming');
    const wanted = new Set(ids);
    const items = renamer.proposals(db, { parts: cfg.renaming.parts }).filter(p => wanted.has(p.id));
    if (!items.length) throw new Error('Nothing selected has a proposed name');
    const rootIds = [...new Set(items.map(i => i.root_id))];
    if (rootIds.length !== 1) throw new Error('A batch must stay within one root');
    const root = cfg.roots.find(r => r.id === rootIds[0]);
    if (!root) throw new Error('Root not found in settings');
    if (live) renameLock = { rootId: root.id, since: new Date().toISOString() };
    try {
      const r = movieRename.runBatch(db, items, { live, layout: 'episodes', rootPath: root.path, limit: Number(cfg.renaming.batchLimit) || 200, log, onProgress: p => send('movie:progress', p) });
      // Same shape the Rename tab always had: one result per file; a pre-flight abort reports each problem as a failure.
      const results = r.status === 'aborted' ? items.map(it => { const pr = r.problems.find(x => x.id === it.id) || r.problems[0]; return { id: it.id, ok: false, error: pr ? pr.reason : 'pre-flight failed', from: it.from, to: it.to }; }) : r.results;
      return { batchId: r.batchId, status: r.status, results };
    } finally { if (live) renameLock = null; db.checkpoint(); }
  }
  h('rename:apply', (ids) => episodeBatch(ids, true).results);
  h('rename:dry', (ids) => episodeBatch(ids, false));
  h('rename:history', () => db.listRenames(500));

  // ---- data queries ------------------------------------------------------------------
  h('data:dashboard', () => {
    const byType = db.all(`SELECT library_type, COUNT(*) files, SUM(size) bytes, SUM(duration_s) seconds,
        SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned,
        SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed, SUM(CASE WHEN probed_at IS NOT NULL AND probe_ok=0 THEN 1 ELSE 0 END) probe_errors,
        AVG(bitrate_kbps) avg_kbps, AVG(duration_s) avg_seconds
      FROM files WHERE missing=0 AND ignored=0${AF()} GROUP BY library_type`);
    const titles = {
      tv: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='tv' AND missing=0 AND ignored=0${AF()}`).n,
      anime: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='anime' AND missing=0 AND ignored=0${AF()}`).n,
      movie: db.get(`SELECT COUNT(DISTINCT group_key) n FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()}`).n,
    };
    const multiples = db.get(`SELECT COUNT(*) n, COALESCE(SUM(c-1),0) extra, COALESCE(SUM(b),0) bytes FROM (SELECT group_key, COUNT(*) c, SUM(size) b FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key HAVING c>1)`);
    const breakdown = (col) => db.all(`SELECT library_type, ${col} k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, ${col} ORDER BY n DESC`);
    const missing = [...missingSummary('tv'), ...missingSummary('anime')];
    const q = qualityReport();
    const dups = db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n;
    return {
      byType, titles, multiples,
      resolution: breakdown('resolution'), videoCodec: breakdown('video_codec'), container: breakdown('ext'),
      audioCodec: breakdown('audio_codecs'), hdr: breakdown('hdr'), fps: breakdown('ROUND(fps)'),
      audioLang: db.all(`SELECT library_type, COALESCE(NULLIF(audio_langs,'und'),'undefined') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, k ORDER BY n DESC LIMIT 40`),
      subLang: db.all(`SELECT library_type, COALESCE(sub_langs,'none') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 GROUP BY library_type, sub_langs ORDER BY n DESC LIMIT 40`),
      lastScans: db.recentScans(8),
      recentChanges: db.recentChanges(25),
      missingFiles: db.get('SELECT COUNT(*) n FROM files WHERE missing=1').n,
      overrides: db.get('SELECT COUNT(*) n FROM overrides').n,
      biggestShows: db.all(`SELECT library_type, show_name, COUNT(*) episodes, SUM(size) bytes, SUM(duration_s) seconds FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY bytes DESC LIMIT 10`),
      biggestMovies: db.all(`SELECT movie_title, movie_year, size, resolution, video_codec FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type='movie' ORDER BY size DESC LIMIT 10`),
      recentlyAdded: db.all(`SELECT library_type, show_name, movie_title, movie_year, season, episode, file_name, first_seen, size FROM files WHERE missing=0 AND ignored=0${AF()} ORDER BY first_seen DESC, id DESC LIMIT 12`),
      lowRes: db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0${AF()} AND probe_ok=1 AND resolution IN ('SD','480p','576p') GROUP BY library_type`),
      missingEpisodes: { series: missing.filter(m => m.missing_count > 0).length, episodes: missing.reduce((a, m) => a + m.missing_count, 0), matched: missing.filter(m => m.expected > 0).length, unmatched: missing.filter(m => m.source === 'none').length, pending: missing.filter(m => !m.source).length, top: missing.filter(m => m.missing_count > 0).slice(0, 12) },
      quality: { mixedSeries: q.mixed.length, lowBitrate: q.lowTotal, undAudio: q.undAudio.reduce((a, r) => a + r.n, 0), short: q.short.length, noAudio: q.noAudio.length },
      duplicates: dups,
      lastExport: db.listExports(1)[0] || null,
      watch: watcher.status(),
    };
  });

  h('data:series', (type) => {
    const rows = db.all(`SELECT show_name, COUNT(*) episodes, COUNT(DISTINCT season) seasons, MIN(season) min_season, MAX(season) max_season,
      SUM(size) bytes, SUM(duration_s) seconds, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed,
      SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(last_seen) last_seen, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched, MAX(plex_show_key) plex_show_key, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) plex_linked,
      ${AUDIO_COUNTS}
    FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} GROUP BY show_name ORDER BY show_name COLLATE NOCASE`, type);
    const plexShows = new Map(db.all('SELECT rating_key, user_rating, genres FROM plex_shows').map(s => [s.rating_key, s]));
    const tagMap = db.tagsFor(type);
    const miss = new Map(missingSummary(type).map(m => [m.show_name, m]));
    const metas = db.allSeriesMeta(type);
    const ur = new Map(db.userRatings(type).map(u => [u.title_key, u]));
    return rows.map(r => { const m = miss.get(r.show_name); const sm = metas.get(r.show_name); const u = ur.get(r.show_name); const ps = r.plex_show_key ? plexShows.get(r.plex_show_key) : null; return { ...r, expected: m ? m.expected : 0, missing_count: m ? m.missing_count : 0, meta_source: m ? m.source : null, meta_status: m ? m.status : null, online_rating: sm ? sm.rating : null, my_rating: u ? u.stars : null, plex_user: ps ? ps.user_rating : null, genres: onlineTags(sm).length ? onlineTags(sm) : onlineTags({ genres: ps && ps.genres }), audio_type: titleAudioType({ files: r.probed_audio, jpn: r.jpn_files, eng: r.eng_files, dual: r.dual_files }, { anime: type === 'anime' }), tags: tagMap.get(r.show_name) || [] }; });
  });
  h('data:episodes', (type, show) => ({ tags: db.tagsOf(type, show), genres: onlineTags(db.getSeriesMeta(type, show)), files: db.all(`SELECT * FROM files WHERE library_type=? AND show_name=? AND ignored=0${AF()} ORDER BY missing, season, episode, file_name`, type, show), missing: missingSummary(type).find(m => m.show_name === show) || null }));
  h('data:movies', () => { const movieTags = db.tagsFor('movie'); return db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(duration_s) seconds,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(has_captions) has_captions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, GROUP_CONCAT(edition_tag, ' | ') editions, MAX(plex_genres) plex_genres,
      MAX(plex_view_count) watched_count, MAX(plex_user_rating) plex_user, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) plex_linked, MAX(hdr) hdr,
      ${AUDIO_COUNTS}
    FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key ORDER BY title COLLATE NOCASE, year`).map(r => ({ ...r, genres: onlineTags({ genres: r.plex_genres }), audio_type: titleAudioType({ files: r.probed_audio, jpn: r.jpn_files, eng: r.eng_files, dual: r.dual_files }), tags: movieTags.get(r.group_key) || [] })); });
  h('data:movieFiles', (groupKey) => db.all(`SELECT * FROM files WHERE library_type='movie' AND group_key=?${AF()} ORDER BY missing, file_name`, groupKey));
  // ---- storage: how fast the library grows (from first_seen) and how long the free space lasts ----
  h('data:storage', () => {
    const months = db.all(`SELECT substr(first_seen,1,7) ym, SUM(size) bytes, COUNT(*) files FROM files WHERE first_seen IS NOT NULL AND ignored=0${AF()} GROUP BY ym ORDER BY ym DESC LIMIT 13`).reverse();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const full = months.filter(m => m.ym < thisMonth).slice(-3); // last three complete months
    const perMonth = full.length ? full.reduce((a, m) => a + m.bytes, 0) / full.length : 0;
    const total = db.get(`SELECT SUM(size) b FROM files WHERE missing=0 AND ignored=0${AF()}`).b || 0;
    const roots = (settings.get().roots || []).filter(r => r.enabled);
    const seen = new Set(); const disks = [];
    for (const r of roots) { try { const st = fs.statfsSync(r.path); const key = `${st.blocks}-${st.bsize}`; /* same volume = same size; free blocks drift between calls on a busy NAS */ if (seen.has(key)) continue; seen.add(key); disks.push({ label: r.label || r.id, total: st.blocks * st.bsize, free: st.bavail * st.bsize }); } catch { /* unreachable root */ } }
    const free = disks.reduce((a, d) => a + d.free, 0), capacity = disks.reduce((a, d) => a + d.total, 0);
    const monthsLeft = perMonth > 0 && disks.length ? free / perMonth : null;
    return { months, perMonth, total, free, capacity, disks, monthsLeft, basis: full.length };
  });

  // ---- tonight: everything worth watching, one row per title, for the Watch tonight page ----
  h('data:tonight', () => {
    const out = [];
    for (const type of ['tv', 'anime']) {
      const tagMap = db.tagsFor(type), metas = db.allSeriesMeta(type), ur = new Map(db.userRatings(type).map(u => [u.title_key, u]));
      const miss = new Map(missingSummary(type).map(m => [m.show_name, m]));
      const plexShows = new Map(db.all('SELECT rating_key, user_rating, genres FROM plex_shows').map(x => [x.rating_key, x]));
      for (const r of db.all(`SELECT show_name, COUNT(*) episodes, SUM(duration_s) seconds, AVG(duration_s) avg_seconds, MAX(resolution) resolution, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) plex_linked, MAX(plex_show_key) plex_show_key, MAX(first_seen) last_added, ${AUDIO_COUNTS} FROM files WHERE library_type=? AND missing=0 AND ignored=0${AF()} GROUP BY show_name`, type)) {
        const sm = metas.get(r.show_name), m = miss.get(r.show_name), u = ur.get(r.show_name), ps = r.plex_show_key ? plexShows.get(r.plex_show_key) : null;
        out.push({ kind: 'series', type, key: r.show_name, title: r.show_name, episodes: r.episodes, minutes: Math.round((r.avg_seconds || 0) / 60), total_minutes: Math.round((r.seconds || 0) / 60), watched: r.watched, unwatched: r.plex_linked ? r.episodes - r.watched : null, complete: m && m.expected ? m.missing_count === 0 : null, genres: onlineTags(sm).length ? onlineTags(sm) : onlineTags({ genres: ps && ps.genres }), audio_type: titleAudioType({ files: r.probed_audio, jpn: r.jpn_files, eng: r.eng_files, dual: r.dual_files }, { anime: type === 'anime' }), tags: tagMap.get(r.show_name) || [], my_rating: u ? u.stars : null, online_rating: sm ? sm.rating : null, plex_user: ps ? ps.user_rating : null, resolution: r.resolution, last_added: r.last_added });
      }
    }
    const mt = db.tagsFor('movie'), mur = new Map(db.userRatings('movie').map(u => [u.title_key, u]));
    for (const r of db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, MAX(duration_s) seconds, MAX(resolution) resolution, MAX(plex_view_count) watched_count, MAX(plex_user_rating) plex_user, MAX(plex_audience_rating) plex_audience, SUM(CASE WHEN plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) plex_linked, MAX(plex_genres) plex_genres, MAX(first_seen) last_added, ${AUDIO_COUNTS} FROM files WHERE library_type='movie' AND missing=0 AND ignored=0${AF()} GROUP BY group_key`)) {
      const u = mur.get(r.group_key);
      out.push({ kind: 'movie', type: 'movie', key: r.group_key, title: r.title, year: r.year, minutes: Math.round((r.seconds || 0) / 60), total_minutes: Math.round((r.seconds || 0) / 60), watched: r.watched_count > 0 ? 1 : 0, unwatched: r.plex_linked ? (r.watched_count > 0 ? 0 : 1) : null, complete: true, genres: onlineTags({ genres: r.plex_genres }), audio_type: titleAudioType({ files: r.probed_audio, jpn: r.jpn_files, eng: r.eng_files, dual: r.dual_files }), tags: mt.get(r.group_key) || [], my_rating: u ? u.stars : null, online_rating: r.plex_audience != null ? r.plex_audience : null, plex_user: r.plex_user, resolution: r.resolution, last_added: r.last_added });
    }
    return out;
  });

  // ---- backup to a folder (the NAS): local backup first, then a dated copy, newest `keep` kept ----
  function backupTo(dir, keep, label = 'nightly') {
    if (!dir) throw new Error('No backup folder set');
    const local = db.backup(label);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `medialedger-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`);
    fs.copyFileSync(local, dest);
    const st = fs.statSync(dest); if (!st.size) throw new Error('Copied backup is empty');
    const olds = fs.readdirSync(dir).filter(f => /^medialedger-.*\.db$/.test(f)).sort().reverse().slice(Math.max(1, Number(keep) || 7));
    for (const f of olds) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
    settings.set({ backup: { ...(settings.get().backup || {}), lastRun: new Date().toISOString(), lastFile: dest, lastError: null } });
    log(`backup: ${dest} (${(st.size / 1048576).toFixed(1)} MB)`);
    return dest;
  }
  let lastBackupDay = null;
  const backupTick = () => {
    const b = settings.get().backup || {};
    if (!b.enabled || !b.dir) return;
    const now = new Date(); const [hh, mm] = String(b.time || '03:30').split(':').map(Number);
    const today = now.toISOString().slice(0, 10);
    if (lastBackupDay === today || (b.lastRun || '').slice(0, 10) === today) { lastBackupDay = today; return; }
    if (now.getHours() < hh || (now.getHours() === hh && now.getMinutes() < mm)) return;
    if (!!scanner.running) return; // wait for a quiet moment
    lastBackupDay = today;
    try { backupTo(b.dir, b.keep); } catch (e) { log('backup failed: ' + e.message); settings.set({ backup: { ...b, lastError: e.message } }); notifier.send('backupFailed', 'Nightly backup failed', `${e.message}\nFolder: ${b.dir}`).catch(() => {}); }
  };
  const backupTimer = setInterval(backupTick, 60000); if (backupTimer.unref) backupTimer.unref();
  h('db:backupTo', (dir, keep) => backupTo(dir || (settings.get().backup || {}).dir, keep || (settings.get().backup || {}).keep, 'manual'));

  // ---- airing: what the online match says comes next, and series that finished but are still incomplete ----
  function airingReport() {
    const today = new Date().toISOString().slice(0, 10), week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const miss = new Map([...missingSummary('tv'), ...missingSummary('anime')].map(m => [m.library_type + '|' + m.show_name, m]));
    const upcoming = db.all("SELECT library_type, show_name, matched_title, status, url, next_airing, next_episode FROM series_meta WHERE next_airing IS NOT NULL AND next_airing >= ? ORDER BY next_airing, show_name", today)
      .map(r => { const m = miss.get(r.library_type + '|' + r.show_name); return { ...r, missing_count: m ? m.missing_count : 0, expected: m ? m.expected : 0, this_week: r.next_airing <= week }; });
    const finished = [...miss.values()].filter(m => m.expected > 0 && m.missing_count > 0 && /ended|finished|cancelled/i.test(m.status || '')).map(m => ({ library_type: m.library_type, show_name: m.show_name, status: m.status, missing_count: m.missing_count, expected: m.expected }));
    return { today, upcoming, thisWeek: upcoming.filter(u => u.this_week).length, finished };
  }
  h('data:airing', () => airingReport());

  // ---- upgrades: which titles deserve a better copy (ranked in upgrades.js) ----
  h('data:upgrades', () => {
    const thr = settings.get().quality.minKbps || {};
    const lowSql = Object.entries(thr).map(([res, k]) => `(resolution='${res.replace(/'/g, '')}' AND bitrate_kbps IS NOT NULL AND bitrate_kbps < ${Number(k) || 0})`).join(' OR ') || '0';
    const out = [];
    for (const type of ['tv', 'anime']) {
      const metas = db.allSeriesMeta(type), ur = new Map(db.userRatings(type).map(u => [u.title_key, u]));
      for (const r of db.all(`SELECT show_name, COUNT(*) files, SUM(size) bytes, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(COALESCE(plex_view_count,0)) plays, SUM(CASE WHEN plex_view_count>0 THEN 1 ELSE 0 END) watched, SUM(CASE WHEN ${lowSql} THEN 1 ELSE 0 END) low_bitrate, MAX(CASE WHEN hdr LIKE '%HDR%' OR hdr LIKE '%Dolby%' THEN 1 ELSE 0 END) hdr FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND probe_ok=1${AF()} GROUP BY show_name`, type)) {
        const sm = metas.get(r.show_name), u = ur.get(r.show_name);
        const best = (r.resolutions || '').split(',').filter(Boolean).sort((a, b) => (RES_RANK[b] ?? -1) - (RES_RANK[a] ?? -1))[0] || null;
        const t = { kind: 'series', type, key: r.show_name, title: r.show_name, best, files: r.files, gb: (r.bytes || 0) / 1e9, plays: r.plays || 0, watched_pct: r.files ? Math.round(100 * r.watched / r.files) : 0, my_rating: u ? u.stars : null, online_rating: sm ? sm.rating : null, low_bitrate: r.low_bitrate || 0, hdr: !!r.hdr };
        out.push({ ...t, score: upgradeScore(t), reasons: upgradeReasons(t) });
      }
    }
    const mur = new Map(db.userRatings('movie').map(u => [u.title_key, u]));
    for (const r of db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, GROUP_CONCAT(DISTINCT resolution) resolutions, SUM(COALESCE(plex_view_count,0)) plays, MAX(plex_audience_rating) audience, SUM(CASE WHEN ${lowSql} THEN 1 ELSE 0 END) low_bitrate, MAX(CASE WHEN hdr LIKE '%HDR%' OR hdr LIKE '%Dolby%' THEN 1 ELSE 0 END) hdr FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 AND probe_ok=1${AF()} GROUP BY group_key`)) {
      const u = mur.get(r.group_key);
      const best = (r.resolutions || '').split(',').filter(Boolean).sort((a, b) => (RES_RANK[b] ?? -1) - (RES_RANK[a] ?? -1))[0] || null;
      const t = { kind: 'movie', type: 'movie', key: r.group_key, title: r.title, year: r.year, best, files: r.files, gb: (r.bytes || 0) / 1e9, plays: r.plays || 0, watched_pct: r.plays > 0 ? 100 : 0, my_rating: u ? u.stars : null, online_rating: r.audience != null ? r.audience : null, low_bitrate: r.low_bitrate || 0, hdr: !!r.hdr };
      out.push({ ...t, score: upgradeScore(t), reasons: upgradeReasons(t) });
    }
    return out.sort((a, b) => b.score - a.score || b.plays - a.plays);
  });

  // ---- status: one small JSON for Home Assistant / dashboards (served by the web shell at /api/status?key=…) ----
  h('data:status', () => {
    const c = db.get(`SELECT COUNT(*) files, SUM(size) bytes FROM files WHERE missing=0 AND ignored=0 AND adult=0`);
    const last = db.get('SELECT started, finished, status, added, removed, files_seen FROM scans ORDER BY id DESC LIMIT 1');
    const air = airingReport();
    const st = handlers.get('data:storage')();
    return { app: 'MediaLedger', files: c.files || 0, bytes: c.bytes || 0, free_bytes: st.free, months_left: st.monthsLeft != null ? Math.round(st.monthsLeft * 10) / 10 : null, pending_requests: db.pendingRequests(), missing_episodes: [...missingSummary('tv'), ...missingSummary('anime')].reduce((a, m) => a + m.missing_count, 0), airing_this_week: air.thisWeek, next_airing: air.upcoming[0] ? { show: air.upcoming[0].show_name, date: air.upcoming[0].next_airing, episode: air.upcoming[0].next_episode } : null, scanning: !!scanner.running, last_scan: last ? { finished: last.finished, status: last.status, added: last.added, removed: last.removed } : null, at: new Date().toISOString() };
  });

  // ---- notifications ----
  const notifier = createNotifier(() => settings.get().notify, log);
  h('notify:test', async () => { const r = await notifier.send('test', 'MediaLedger test', `This is a test from ${os.hostname()}. If you can read it, notifications work.`); if (r.skipped) throw new Error(r.skipped); if (!r.webhook && !r.email) throw new Error('Nothing configured: set a webhook URL or e-mail first, then Save settings'); const bad = [r.webhook, r.email].find(x => x && !x.ok); if (bad) throw new Error(bad.error || `HTTP ${bad.status}`); return r; });
  let lastSummaryDay = null;
  const summaryTick = () => {
    const n = settings.get().notify || {};
    if (!(n.webhookUrl || (n.email && n.email.enabled)) || (n.events && n.events.dailySummary === false)) return;
    const now = new Date(); const [hh, mm] = String(n.dailyTime || '08:00').split(':').map(Number);
    const today = now.toISOString().slice(0, 10);
    if (lastSummaryDay === today || (n.lastSummary || '').slice(0, 10) === today) { lastSummaryDay = today; return; }
    if (now.getHours() < hh || (now.getHours() === hh && now.getMinutes() < mm)) return;
    lastSummaryDay = today;
    try {
      const st = handlers.get('data:status')(); const air = airingReport();
      const lines = [`Files: ${st.files.toLocaleString()} (${(st.bytes / 1e12).toFixed(2)} TB)`, `Free on the share: ${(st.free_bytes / 1e12).toFixed(2)} TB${st.months_left != null ? ` (about ${st.months_left} months at the current rate)` : ''}`, `Pending requests: ${st.pending_requests}`, `Missing episodes: ${st.missing_episodes}`];
      if (st.last_scan) lines.push(`Last scan: ${st.last_scan.status}, +${st.last_scan.added} / -${st.last_scan.removed}`);
      if (air.upcoming.length) lines.push('', 'Airing this week:', ...air.upcoming.filter(u => u.this_week).slice(0, 15).map(u => `  ${u.next_airing}  ${u.show_name} ${u.next_episode || ''}`));
      if (air.finished.length) lines.push('', `Finished airing but incomplete: ${air.finished.slice(0, 10).map(f => `${f.show_name} (${f.missing_count} missing)`).join(', ')}${air.finished.length > 10 ? '…' : ''}`);
      notifier.send('dailySummary', `Daily summary: ${st.pending_requests} request${st.pending_requests === 1 ? '' : 's'}, ${air.thisWeek} airing this week`, lines.join('\n'), { pending_requests: st.pending_requests, airing_this_week: air.thisWeek, free_bytes: st.free_bytes }).catch(() => {});
      settings.set({ notify: { ...n, lastSummary: new Date().toISOString() } });
    } catch (e) { log('daily summary failed: ' + e.message); }
  };
  const summaryTimer = setInterval(summaryTick, 60000); if (summaryTimer.unref) summaryTimer.unref();

  // ---- tags: your own words per title; genres come with the online match / Plex, sub/dub from the probe ----
  h('tags:list', (type) => Object.fromEntries(db.tagsFor(type)));
  h('tags:all', () => db.allTags());
  h('tags:get', (type, key) => db.tagsOf(type, key));
  h('tags:add', (type, key, tag) => { const t = normalizeTag(tag); if (!t) throw new Error('Empty tag'); return db.addTag(type, key, t); });
  h('tags:remove', (type, key, tag) => db.removeTag(type, key, tag));

  h('data:changes', (scanId, limit) => scanId ? db.changesForScan(scanId, limit || 5000) : db.recentChanges(limit || 500));
  h('data:changeStats', () => ({
    byKind: db.all(`SELECT kind, COUNT(*) n FROM changes GROUP BY kind`),
    last7: db.all(`SELECT kind, COUNT(*) n FROM changes WHERE ts >= datetime('now','-7 days') GROUP BY kind`),
    perDay: db.all(`SELECT substr(ts,1,10) day, SUM(kind='added') added, SUM(kind='removed') removed, SUM(kind='modified') modified FROM changes WHERE ts >= datetime('now','-30 days') GROUP BY day ORDER BY day`),
    scans: db.get(`SELECT COUNT(*) n, AVG(duration_ms) avg_ms, MAX(finished) last FROM scans WHERE status='done' AND duration_ms IS NOT NULL`),
  }));
  h('data:search', (q) => db.all(`SELECT id, library_type, show_name, season, episode, movie_title, movie_year, file_name, rel_path, resolution, duration_s, size, missing FROM files
      WHERE (file_name LIKE ? OR show_name LIKE ? OR movie_title LIKE ?)${AF()} ORDER BY missing, library_type, file_name LIMIT 300`, `%${q}%`, `%${q}%`, `%${q}%`));
  h('data:problems', () => ({
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, file_name, parse_note, show_name, season, episode, movie_title, movie_year FROM files WHERE missing=0 AND ignored=0${AF()} AND parse_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    probeErrors: db.all(`SELECT id, root_id, library_type, rel_path, probe_error FROM files WHERE missing=0 AND ignored=0${AF()} AND probed_at IS NOT NULL AND probe_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    missing: db.all(`SELECT id, root_id, library_type, rel_path, last_seen FROM files WHERE missing=1 ORDER BY last_seen DESC LIMIT 2000`),
    duplicates: db.get(`SELECT COUNT(*) n FROM (SELECT 1 FROM files WHERE missing=0 AND ignored=0${AF()} AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING COUNT(*)>1)`).n,
    ignored: db.all(`SELECT id, root_id, library_type, rel_path FROM files WHERE ignored=1 ORDER BY rel_path LIMIT 2000`),
    overrides: db.listOverrides(),
  }));
  h('data:purgeMissing', () => db.run('DELETE FROM files WHERE missing=1').changes);

  return {
    init, shutdown, handlers, runScan, refreshMetadata, runPlexSync, exportDir, ffprobePath, setShowAdult: (v) => { showAdult = !!v; },
    get settings() { return settings; }, get db() { return db; }, get scanner() { return scanner; },
    get scheduler() { return scheduler; }, get watcher() { return watcher; }, get metaJob() { return metaJob; },
  };
}

module.exports = { createService };
