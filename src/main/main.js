'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpegdl = require('./ffmpegdl');
const updater = require('./updater');
const { createService } = require('./service');

const HEADLESS = process.argv.includes('--scan');
const urlArg = (process.argv.find(a => a.startsWith('--url=')) || '').slice('--url='.length);
// `--profile=<dir>`: use a separate data folder (dev/testing next to an installed copy).
const profileArg = process.argv.find(a => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', profileArg.slice('--profile='.length));
const gotLock = app.requestSingleInstanceLock({ scan: HEADLESS });

if (!gotLock) {
  // Another instance is open; it receives our argv via 'second-instance' and runs the scan itself.
  app.quit();
} else {
  let win = null;
  let settings, db, scanner, scheduler, watcher;
  let updateStatus = { state: 'idle' };
  const userData = app.getPath('userData');
  const logFile = path.join(userData, 'medialedger.log');
  const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`; try { fs.appendFileSync(logFile, line); } catch { /* ignore */ } if (!app.isPackaged) process.stdout.write(line); };
  const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

  // Everything that is not window management lives in the shared core (also used by the web server).
  const svc = createService({ userData, log, send, host: app });
  const runScan = (trigger) => svc.runScan(trigger);
  const refreshMetadata = (opts) => svc.refreshMetadata(opts);
  const exportDir = () => svc.exportDir();
  const ffprobePath = () => svc.ffprobePath();

  // Point electron-updater at the private API when a token is set, or back at the public feed when it is not.
  // Called at launch and again on every manual check so a token pasted into Settings works without a restart.
  function applyUpdateFeed() {
    try {
      const { autoUpdater } = require('electron-updater');
      const token = settings.get().githubToken;
      const feed = { provider: 'github', owner: 'AxialForge', repo: 'medialedger' };
      autoUpdater.setFeedURL(token ? { ...feed, private: true, token } : feed);
    } catch (e) { log('feed url: ' + e.message); }
  }

  // A private repository answers 404 to the update feed; say what to do instead of the generic message.
  function explainUpdateError(msg) {
    if (!/No update information|404/i.test(msg || '')) return msg;
    return settings.get().githubToken
      ? 'GitHub answered 404 to the update check. The token is rejected or lacks read access to AxialForge/medialedger (fine-grained token, repository permission "Contents: read").'
      : 'The update feed is not reachable: the GitHub repository is private and no token is set. Add a read-only token under Settings → Updates, or make the repository public.';
  }

function createWindow() {
    win = new BrowserWindow({
      width: 1400, height: 900, minWidth: 980, minHeight: 620,
      title: 'MediaLedger',
      backgroundColor: '#0f1115',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
      // `--url=<http://…>` renders the web server's UI (no preload, so the browser bridge is used) — for documentation screenshots.
      // sandbox must be false: the preload requires renderer/bridge-shape.js, which a sandboxed preload cannot load (it dies silently and the page shows "Failed to fetch").
      webPreferences: { preload: urlArg ? undefined : path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    if (urlArg) win.loadURL(urlArg); else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('closed', () => { win = null; });
  }

  let promotedToGui = false;
  app.on('second-instance', (_e, argv, _cwd, extra) => {
    const wantsScan = (extra && extra.scan) || (argv || []).includes('--scan');
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    else if (!wantsScan) { promotedToGui = true; createWindow(); scheduler.start(); watcher.apply(); }
    if (wantsScan) runScan('task').catch(e => log('task scan failed: ' + e.message));
  });

  app.whenReady().then(async () => {
    svc.init();
    ({ settings, db, scanner, scheduler, watcher } = svc);

    if (HEADLESS) {
      try { await runScan('task'); } catch (e) { log('headless scan failed: ' + e.message); }
      if (!promotedToGui) app.quit();
      return;
    }

    createWindow();
    const shotArg = process.argv.find(a => a.startsWith('--screenshots='));
    if (shotArg) { captureScreenshots(shotArg.slice('--screenshots='.length)).then(() => app.quit()); return; }
    scheduler.start();
    watcher.apply();
    const s = settings.get();
    applyUpdateFeed();
    updater.start({ enabled: s.updates.enabled, onStatus: st => {
      if (st.state === 'error') st = { ...st, message: explainUpdateError(st.message) };
      updateStatus = st; log('update: ' + JSON.stringify(st)); send('update:status', st);
    } });
    // First-time metadata fill runs in the background once the window is up.
    if (s.metadata.enabled) setTimeout(() => refreshMetadata({ onlyNew: true }).catch(e => log('metadata: ' + e.message)), 4000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // `--screenshots=<dir>`: render each view with the live database and save PNGs (used for the README).
  async function captureScreenshots(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // An occluded window stops painting and capturePage() returns stale frames; keep it painting and in front for the run.
    win.webContents.setBackgroundThrottling(false); win.setAlwaysOnTop(true);
    const shots = [
      ['dashboard', '#dashboard'], ['tv', '#tv'], ['anime', '#anime'], ['movies', '#movies'],
      ['episodes', '#anime/' + encodeURIComponent('One Piece')], ['movie-versions', '#movies/' + encodeURIComponent('pacificrim|2013')],
      ['missing', '#missing'], ['duplicates', '#duplicates'], ['movienames', '#movienames'], ['web', '#web'], ['ratings', '#ratings'], ['quality', '#quality'], ['rename', '#rename'],
      ['changes', '#changes'], ['issues', '#issues/problems'], ['problems', '#problems'], ['requests', '#requests'], ['tonight', '#tonight'], ['export', '#export'], ['system', '#system'], ['settings', '#settings'], ['about', '#about'],
    ];
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await sleep(1500);
    // `--size=WxH` renders at another viewport (e.g. 375x812 for the phone layout).
    const size = (process.argv.find(a => a.startsWith('--size=')) || '').slice('--size='.length);
    if (/^\d+x\d+$/.test(size)) { const [w, hh] = size.split('x').map(Number); win.setMinimumSize(200, 200); win.setContentSize(w, hh); await sleep(800); }
    if (urlArg) {
      // Web build: capture the sign-in dialog, sign in with MEDIALEDGER_SHOT_PASSWORD, then the web-only screens.
      await sleep(1500);
      const img0 = await win.webContents.capturePage(); if (!img0.isEmpty()) { fs.writeFileSync(path.join(dir, 'web-login.png'), img0.toPNG()); log('screenshot web-login'); }
      await win.webContents.executeJavaScript(`(() => { const f = document.querySelector('.webauth form'); if (!f) return false; f.elements.password.value = ${JSON.stringify(process.env.MEDIALEDGER_SHOT_PASSWORD || '')}; f.querySelector('button[type=submit]').click(); return true; })()`);
      await sleep(2500);
      for (const [name, hash] of [['web-security', '#security'], ['web-system', '#system'], ['web-about', '#about'], ['web-dashboard', '#dashboard'], ['web-tv', '#tv'], ['web-movienames', '#movienames'], ['web-settings', '#settings']]) {
        await win.webContents.executeJavaScript(`(() => { document.querySelector('#view').textContent = 'Loading…'; if (location.hash === ${JSON.stringify(hash)}) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = ${JSON.stringify(hash)}; })()`);
        for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(`location.hash === ${JSON.stringify(hash)} && !document.querySelector('#view')?.textContent.startsWith('Loading')`)) break; await sleep(100); }
        // A resized window may not repaint on its own; force a frame and take the second capture (the first can be the previous page).
        await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(500);
        const im = await win.webContents.capturePage(); if (!im.isEmpty()) { fs.writeFileSync(path.join(dir, `${name}.png`), im.toPNG()); log('screenshot ' + name); }
      }
      return;
    }
    const social = (process.argv.find(a => a.startsWith('--social=')) || '').slice('--social='.length);
    if (/^\d+x\d+$/.test(social)) {
      const [w, hgt] = social.split('x').map(Number);
      win.setContentSize(w, hgt); await sleep(1500);
      fs.writeFileSync(path.join(dir, `social-preview-${w}x${hgt}.png`), (await win.webContents.capturePage()).resize({ width: w, height: hgt, quality: 'best' }).toPNG());
      log('screenshot social preview'); return;
    }
    const settle = async (hash) => {
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
    await settle('#problems');
    const opened = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('.fixbtn'); if (!b) return false; b.click(); return true; })()`);
    if (opened) { await sleep(1200); await capture(path.join(dir, 'fix-modal.png')); log('screenshot fix-modal'); }
  }

  app.on('window-all-closed', () => { app.quit(); });
  app.on('before-quit', () => svc.shutdown());

  // ---- IPC ---------------------------------------------------------------------
  const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => fn(...args));

  h('app:info', async () => ({
    version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome,
    platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length, userData, logFile, dbFile: db.file, exportDir: exportDir(),
    ffprobe: ffprobePath(), ffprobeVersion: await ffmpegdl.ffprobeVersion(ffprobePath()), packaged: app.isPackaged, repo: 'https://github.com/AxialForge/medialedger',
    updateStatus, db: db.stats(), watch: watcher.status(), metaJob: svc.metaJob,
  }));
  h('dialog:pickFolder', async (initial) => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: initial || undefined }); return r.canceled ? null : r.filePaths[0]; });
  h('dialog:pickFile', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'ffprobe', extensions: ['exe'] }] }); return r.canceled ? null : r.filePaths[0]; });
  h('shell:open', (p) => shell.openPath(p));
  h('shell:openExternal', (u) => /^https:\/\//.test(u) ? shell.openExternal(u) : false);
  h('shell:showItem', (p) => shell.showItemInFolder(p));
  h('update:install', () => updater.installNow());
  h('update:status', () => updateStatus);
  h('update:check', async () => {
    if (!app.isPackaged) return { state: 'error', message: 'Updates only run in the installed app.' };
    applyUpdateFeed(); // pick up a token typed into Settings since launch
    try { const { autoUpdater } = require('electron-updater'); await autoUpdater.checkForUpdates(); return updateStatus; }
    catch (e) { updateStatus = { state: 'error', message: explainUpdateError(updater.friendlyError(e)) }; return updateStatus; }
  });

  // Security controls belong to the web server (sessions, 2FA, lockout). The desktop app has no login, so it only reports that.
  h('security:status', () => ({ available: false }));
  h('security:me', () => ({ available: false, guest: false, username: null, role: 'admin' })); // the desktop user owns the machine
  h('plex:webhookInfo', () => ({ available: false })); // Plex can only call an always-on server
  h('plex:webhookSet', () => { throw new Error('Only available on the web server'); });
  for (const ch of ['security:changePassword', 'security:totpSetup', 'security:totpEnable', 'security:totpDisable', 'security:setOptions', 'security:revoke', 'security:revokeOthers', 'security:users', 'security:addUser', 'security:setRole', 'security:resetPassword', 'security:deleteUser', 'security:tlsEnable']) h(ch, () => { throw new Error('Only available on the web server'); });

  // Everything else comes from the core, unchanged in name and signature.
  for (const [ch, fn] of svc.handlers) h(ch, fn);
}
