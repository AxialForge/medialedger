'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Settings } = require('./settings');
const { Db } = require('./db');
const { Scanner } = require('./scanner');
const { Scheduler } = require('./scheduler');
const { exportAll } = require('./exportCsv');
const { findFfprobe } = require('./ffprobe');
const { PARSER_VERSION } = require('./parse');
const ffmpegdl = require('./ffmpegdl');
const updater = require('./updater');
const plex = require('./plex');

const HEADLESS = process.argv.includes('--scan');
const gotLock = app.requestSingleInstanceLock({ scan: HEADLESS });

if (!gotLock) {
  // Another instance is open; it receives our argv via 'second-instance' and runs the scan itself.
  app.quit();
} else {
  let win = null;
  let settings, db, scanner, scheduler;
  let updateStatus = { state: 'idle' };
  const userData = app.getPath('userData');
  const logFile = path.join(userData, 'medialedger.log');
  const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`; try { fs.appendFileSync(logFile, line); } catch { /* ignore */ } if (!app.isPackaged) process.stdout.write(line); };
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

  function exportDir() { return settings.get().csvOutputDir || path.join(userData, 'exports'); }
  function ffprobePath() { return findFfprobe(settings.get().ffprobePath) || ffmpegdl.installedFfprobe(userData); }

  function runExport(scanId, trigger) {
    const out = exportAll(db, exportDir(), scanId);
    db.addExport({ scan_id: scanId, dir: out.dir, files: out.files, rows: out.rows, trigger });
    return out;
  }

  async function runScan(trigger) {
    if (scanner.running) return { skipped: true, reason: 'already running' };
    log(`scan start (${trigger})`);
    const result = await scanner.scan(trigger);
    scheduler.noteRun();
    log(`scan ${result.status} in ${Math.round(result.duration_ms / 1000)}s: seen=${result.files_seen} added=${result.added} removed=${result.removed} modified=${result.modified} probed=${result.probed} errors=${result.errors}`);
    if (settings.get().autoExportAfterScan && result.status === 'done') {
      try { const out = runExport(result.scanId, trigger); log('exported to ' + out.dir); result.export = out; }
      catch (e) { log('export failed: ' + e.message); }
    }
    db.checkpoint();
    return result;
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1400, height: 900, minWidth: 980, minHeight: 620,
      title: 'MediaLedger',
      backgroundColor: '#0f1115',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
  }

  let promotedToGui = false;
  app.on('second-instance', (_e, argv, _cwd, extra) => {
    const wantsScan = (extra && extra.scan) || (argv || []).includes('--scan');
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    else if (!wantsScan) { promotedToGui = true; createWindow(); scheduler.start(); }
    if (wantsScan) runScan('task').catch(e => log('task scan failed: ' + e.message));
  });

  app.whenReady().then(async () => {
    settings = new Settings(userData);
    db = new Db(path.join(userData, 'medialedger.db'), { log });
    scanner = new Scanner(db, settings, { log });
    scheduler = new Scheduler(app, settings, runScan);
    scanner.onProgress(p => send('scan:progress', p));
    if (settings.get().parserVersion !== PARSER_VERSION) {
      const n = scanner.reparseAll();
      settings.set({ parserVersion: PARSER_VERSION });
      log(`parser v${PARSER_VERSION}: re-parsed ${n} indexed files`);
    }

    if (HEADLESS) {
      try { await runScan('task'); } catch (e) { log('headless scan failed: ' + e.message); }
      if (!promotedToGui) app.quit();
      return;
    }

    createWindow();
    const shotArg = process.argv.find(a => a.startsWith('--screenshots='));
    if (shotArg) { captureScreenshots(shotArg.slice('--screenshots='.length)).then(() => app.quit()); return; }
    scheduler.start();
    // Silent auto-update (installed builds only). A manual "check now" lives on the About page.
    const s = settings.get();
    if (s.githubToken) { try { const { autoUpdater } = require('electron-updater'); autoUpdater.setFeedURL({ provider: 'github', owner: 'AxialForge', repo: 'medialedger', private: true, token: s.githubToken }); } catch (e) { log('feed url: ' + e.message); } }
    updater.start({ enabled: s.updates.enabled, onStatus: st => { updateStatus = st; log('update: ' + JSON.stringify(st)); send('update:status', st); } });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // `--screenshots=<dir>`: render each view with the live database and save PNGs (used for the README).
  async function captureScreenshots(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const shots = [
      ['dashboard', '#dashboard'], ['tv', '#tv'], ['anime', '#anime'], ['movies', '#movies'],
      ['episodes', '#anime/' + encodeURIComponent('One Piece')], ['movie-versions', '#movies/' + encodeURIComponent('pacificrim|2013')],
      ['changes', '#changes'], ['problems', '#problems'], ['export', '#export'], ['settings', '#settings'], ['about', '#about'],
    ];
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await sleep(1500);
    // `--social=WxH`: one dashboard capture at that exact size (GitHub social preview is 1280x640).
    const social = (process.argv.find(a => a.startsWith('--social=')) || '').slice('--social='.length);
    if (/^\d+x\d+$/.test(social)) {
      const [w, hgt] = social.split('x').map(Number);
      win.setContentSize(w, hgt); await sleep(1500);
      // capturePage returns device pixels; resize so the file is exactly WxH regardless of display scaling.
      fs.writeFileSync(path.join(dir, `social-preview-${w}x${hgt}.png`), (await win.webContents.capturePage()).resize({ width: w, height: hgt, quality: 'best' }).toPNG());
      log('screenshot social preview'); return;
    }
    // Wait until the router has swapped the hash in and the view is no longer "Loading…", then let two frames paint.
    const settle = async (hash) => {
      // Blank the view first so the old page can't be mistaken for the new one, then navigate
      // (dispatching hashchange by hand when the hash is already the target).
      await win.webContents.executeJavaScript(`(() => { document.querySelector('#view').textContent = 'Loading…'; if (location.hash === ${JSON.stringify(hash)}) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = ${JSON.stringify(hash)}; })()`);
      for (let i = 0; i < 100; i++) {
        const ok = await win.webContents.executeJavaScript(`location.hash === ${JSON.stringify(hash)} && !document.querySelector('#view')?.textContent.startsWith('Loading')`);
        if (ok) break;
        await sleep(100);
      }
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
      await sleep(400);
    };
    const capture = async (file) => {
      for (let i = 0; i < 5; i++) {
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) { fs.writeFileSync(file, img.toPNG()); return true; }
        await sleep(300);
      }
      log('screenshot FAILED (empty capture): ' + file); return false;
    };
    for (const [name, hash] of shots) {
      await settle(hash);
      if (await capture(path.join(dir, `${name}.png`))) log('screenshot ' + name);
    }
    // Fix modal on top of the Problems view
    await settle('#problems');
    const opened = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('.fixbtn'); if (!b) return false; b.click(); return true; })()`);
    if (opened) { await sleep(1200); await capture(path.join(dir, 'fix-modal.png')); log('screenshot fix-modal'); }
  }

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', () => { scheduler && scheduler.stop(); try { db && db.close(); } catch { /* ignore */ } });

  // ---- IPC ---------------------------------------------------------------------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => fn(...args));

  h('app:info', async () => ({
    version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length, userData, logFile, dbFile: db.file, exportDir: exportDir(),
    ffprobe: ffprobePath(), ffprobeVersion: await ffmpegdl.ffprobeVersion(ffprobePath()), packaged: app.isPackaged, repo: 'https://github.com/AxialForge/medialedger',
    updateStatus, db: db.stats(),
  }));
  h('settings:get', () => settings.get());
  h('settings:set', (patch) => settings.set(patch));
  h('settings:replace', (next) => settings.replace(next));
  h('dialog:pickFolder', async (initial) => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: initial || undefined }); return r.canceled ? null : r.filePaths[0]; });
  h('dialog:pickFile', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'ffprobe', extensions: ['exe'] }] }); return r.canceled ? null : r.filePaths[0]; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:openExternal', (u) => /^https:\/\//.test(u) ? shell.openExternal(u) : false);
  h('shell:showItem', (p) => shell.showItemInFolder(p));

  h('scan:start', (trigger) => runScan(trigger || 'manual'));
  h('scan:cancel', () => { scanner.cancel(); return true; });
  h('scan:status', () => ({ running: scanner.running, progress: scanner.progress }));
  h('scan:list', (limit) => db.recentScans(limit || 30));

  h('export:run', () => runExport(null, 'manual'));
  h('export:list', () => db.listExports(50));

  h('schedule:taskStatus', () => scheduler.taskStatus());
  h('schedule:installTask', async () => { const r = await scheduler.installTask(); if (r.ok) settings.set({ schedule: { taskSchedulerEnabled: true } }); return r; });
  h('schedule:removeTask', async () => { const r = await scheduler.removeTask(); settings.set({ schedule: { taskSchedulerEnabled: false } }); return r; });
  h('schedule:runTaskNow', () => scheduler.runTaskNow());
  h('schedule:nextInApp', () => scheduler.nextInAppRun());

  h('ffmpeg:download', async () => {
    const p = await ffmpegdl.downloadFfmpeg(userData, prog => send('ffmpeg:progress', prog));
    settings.set({ ffprobePath: p });
    return { ok: true, path: p, version: await ffmpegdl.ffprobeVersion(p) };
  });

  h('update:check', async () => {
    if (!app.isPackaged) return { state: 'error', message: 'Updates only run in the installed app.' };
    try { const { autoUpdater } = require('electron-updater'); await autoUpdater.checkForUpdates(); return updateStatus; }
    catch (e) { updateStatus = { state: 'error', message: e.message }; return updateStatus; }
  });
  h('update:install', () => updater.installNow());
  h('update:status', () => updateStatus);

  h('db:backup', () => db.backup('manual'));
  h('db:backups', () => db.listBackups());
  h('db:stats', () => db.stats());

  h('plex:test', (cfg) => plex.testConnection(cfg || settings.get().plex));

  // ---- overrides (manual fixes) --------------------------------------------------
  h('override:list', () => db.listOverrides());
  h('override:save', (o) => { const saved = db.saveOverride(o); const file = scanner.reapplyOverride(o.root_id, o.rel_path); return { override: saved, file }; });
  h('override:delete', (id) => { const ov = db.get('SELECT * FROM overrides WHERE id=?', id); if (!ov) return false; db.deleteOverride(id); scanner.reapplyOverride(ov.root_id, ov.rel_path); return true; });
  h('override:suggest', (rootId, relPath) => {
    // What the parser thinks, so the fix form can be pre-filled with the current guess.
    const f = db.getFileByPath(rootId, relPath);
    if (!f) return null;
    return { file: f, override: db.getOverride(rootId, relPath), shows: db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND show_name IS NOT NULL ORDER BY show_name`, f.library_type).map(r => r.show_name) };
  });

  // ---- data queries ------------------------------------------------------------------
  h('data:dashboard', () => {
    const byType = db.all(`SELECT library_type, COUNT(*) files, SUM(size) bytes, SUM(duration_s) seconds,
        SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned,
        SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed, SUM(CASE WHEN probed_at IS NOT NULL AND probe_ok=0 THEN 1 ELSE 0 END) probe_errors,
        AVG(bitrate_kbps) avg_kbps, AVG(duration_s) avg_seconds
      FROM files WHERE missing=0 AND ignored=0 GROUP BY library_type`);
    const titles = {
      tv: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='tv' AND missing=0 AND ignored=0`).n,
      anime: db.get(`SELECT COUNT(DISTINCT show_name) n FROM files WHERE library_type='anime' AND missing=0 AND ignored=0`).n,
      movie: db.get(`SELECT COUNT(DISTINCT group_key) n FROM files WHERE library_type='movie' AND missing=0 AND ignored=0`).n,
    };
    const multiples = db.get(`SELECT COUNT(*) n, COALESCE(SUM(c-1),0) extra, COALESCE(SUM(b),0) bytes FROM (SELECT group_key, COUNT(*) c, SUM(size) b FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 GROUP BY group_key HAVING c>1)`);
    const breakdown = (col) => db.all(`SELECT library_type, ${col} k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, ${col} ORDER BY n DESC`);
    return {
      byType, titles, multiples,
      resolution: breakdown('resolution'), videoCodec: breakdown('video_codec'), container: breakdown('ext'),
      audioCodec: breakdown('audio_codecs'), hdr: breakdown('hdr'), fps: breakdown('ROUND(fps)'),
      audioLang: db.all(`SELECT library_type, audio_langs k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, audio_langs ORDER BY n DESC LIMIT 40`),
      subLang: db.all(`SELECT library_type, COALESCE(sub_langs,'none') k, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 GROUP BY library_type, sub_langs ORDER BY n DESC LIMIT 40`),
      lastScans: db.recentScans(8),
      recentChanges: db.recentChanges(25),
      missingFiles: db.get('SELECT COUNT(*) n FROM files WHERE missing=1').n,
      overrides: db.get('SELECT COUNT(*) n FROM overrides').n,
      biggestShows: db.all(`SELECT library_type, show_name, COUNT(*) episodes, SUM(size) bytes, SUM(duration_s) seconds FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') GROUP BY library_type, show_name ORDER BY bytes DESC LIMIT 10`),
      biggestMovies: db.all(`SELECT movie_title, movie_year, size, resolution, video_codec FROM files WHERE missing=0 AND ignored=0 AND library_type='movie' ORDER BY size DESC LIMIT 10`),
      recentlyAdded: db.all(`SELECT library_type, show_name, movie_title, movie_year, season, episode, file_name, first_seen, size FROM files WHERE missing=0 AND ignored=0 ORDER BY first_seen DESC, id DESC LIMIT 12`),
      lowRes: db.all(`SELECT library_type, COUNT(*) n FROM files WHERE missing=0 AND ignored=0 AND probe_ok=1 AND resolution IN ('SD','480p','576p') GROUP BY library_type`),
      gaps: db.all(`SELECT library_type, show_name, season, COUNT(*) have, MIN(episode) mn, MAX(episode) mx FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') AND season>0 AND episode IS NOT NULL GROUP BY library_type, show_name, season HAVING (mx-mn+1) > have ORDER BY (mx-mn+1)-have DESC LIMIT 12`),
      lastExport: db.listExports(1)[0] || null,
    };
  });

  h('data:series', (type) => db.all(`SELECT show_name, COUNT(*) episodes, COUNT(DISTINCT season) seasons, MIN(season) min_season, MAX(season) max_season,
      SUM(size) bytes, SUM(duration_s) seconds, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed,
      SUM(CASE WHEN has_captions=1 THEN 1 ELSE 0 END) captioned, SUM(CASE WHEN parse_ok=0 THEN 1 ELSE 0 END) unparsed,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(last_seen) last_seen
    FROM files WHERE library_type=? AND missing=0 AND ignored=0 GROUP BY show_name ORDER BY show_name COLLATE NOCASE`, type));
  h('data:episodes', (type, show) => db.all(`SELECT * FROM files WHERE library_type=? AND show_name=? AND ignored=0 ORDER BY missing, season, episode, file_name`, type, show));
  h('data:movies', () => db.all(`SELECT group_key, MIN(movie_title) title, MIN(movie_year) year, COUNT(*) files, SUM(size) bytes, MAX(duration_s) seconds,
      GROUP_CONCAT(DISTINCT resolution) resolutions, GROUP_CONCAT(DISTINCT video_codec) codecs, GROUP_CONCAT(DISTINCT audio_langs) audio_langs, GROUP_CONCAT(DISTINCT sub_langs) sub_langs,
      MAX(has_captions) has_captions, SUM(CASE WHEN probe_ok=1 THEN 1 ELSE 0 END) probed, GROUP_CONCAT(edition_tag, ' | ') editions
    FROM files WHERE library_type='movie' AND missing=0 AND ignored=0 GROUP BY group_key ORDER BY title COLLATE NOCASE, year`));
  h('data:movieFiles', (groupKey) => db.all(`SELECT * FROM files WHERE library_type='movie' AND group_key=? ORDER BY missing, file_name`, groupKey));

  h('data:changes', (scanId, limit) => scanId ? db.changesForScan(scanId, limit || 5000) : db.recentChanges(limit || 500));
  h('data:changeStats', () => ({
    byKind: db.all(`SELECT kind, COUNT(*) n FROM changes GROUP BY kind`),
    last7: db.all(`SELECT kind, COUNT(*) n FROM changes WHERE ts >= datetime('now','-7 days') GROUP BY kind`),
    perDay: db.all(`SELECT substr(ts,1,10) day, SUM(kind='added') added, SUM(kind='removed') removed, SUM(kind='modified') modified FROM changes WHERE ts >= datetime('now','-30 days') GROUP BY day ORDER BY day`),
    scans: db.get(`SELECT COUNT(*) n, AVG(duration_ms) avg_ms, MAX(finished) last FROM scans WHERE status='done'`),
  }));
  h('data:search', (q) => db.all(`SELECT id, library_type, show_name, season, episode, movie_title, movie_year, file_name, rel_path, resolution, duration_s, size, missing FROM files
      WHERE file_name LIKE ? OR show_name LIKE ? OR movie_title LIKE ? ORDER BY missing, library_type, file_name LIMIT 300`, `%${q}%`, `%${q}%`, `%${q}%`));
  h('data:problems', () => ({
    unparsed: db.all(`SELECT id, root_id, library_type, rel_path, file_name, parse_note, show_name, season, episode, movie_title, movie_year FROM files WHERE missing=0 AND ignored=0 AND parse_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    probeErrors: db.all(`SELECT id, root_id, library_type, rel_path, probe_error FROM files WHERE missing=0 AND ignored=0 AND probed_at IS NOT NULL AND probe_ok=0 ORDER BY library_type, rel_path LIMIT 2000`),
    missing: db.all(`SELECT id, root_id, library_type, rel_path, last_seen FROM files WHERE missing=1 ORDER BY last_seen DESC LIMIT 2000`),
    duplicates: db.all(`SELECT library_type, show_name, season, episode, COUNT(*) n, GROUP_CONCAT(rel_path, ' | ') paths FROM files WHERE missing=0 AND ignored=0 AND library_type IN ('tv','anime') AND parse_ok=1 GROUP BY library_type, show_name, season, episode HAVING n>1 ORDER BY show_name LIMIT 2000`),
    ignored: db.all(`SELECT id, root_id, library_type, rel_path FROM files WHERE ignored=1 ORDER BY rel_path LIMIT 2000`),
    overrides: db.listOverrides(),
  }));
  h('data:purgeMissing', () => db.run('DELETE FROM files WHERE missing=1').changes);
}
