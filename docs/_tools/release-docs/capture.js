'use strict';
// Screenshot capture for the manual. Run with Electron (already a development dependency):
//
//   npx electron docs/_tools/release-docs/capture.js --data=<demo-data> --out=<dir> [--only=id,id] [--discover]
//
// It starts the real MediaLedger web server on the demo data, signs in with the demo account, walks every
// screen listed in screens.js, saves a clean PNG, and writes the position of every listed control to
// <out>/boxes.json. annotate.py draws the callouts from that file. --discover also writes discover.json, a
// list of every interactive element found on each screen, which is how the control lists were drawn up.
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..', '..');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const DATA = path.resolve(arg('data', path.join(__dirname, 'demo-data')));
const OUT = path.resolve(arg('out', path.join(__dirname, 'out')));
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const DISCOVER = process.argv.includes('--discover');
const PORT = Number(arg('port', 8197)), PPORT = PORT + 1;
const PASSWORD = 'Demo-Password-2026';   // the demo account made by make-demo-data; not a real credential
const BASE = `http://127.0.0.1:${PORT}`, PBASE = `http://127.0.0.1:${PPORT}`;
const W = 1440, H = 900, MAXH = 2600;
const KEEP = process.argv.includes('--keep-data');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');
app.disableHardwareAcceleration();

// Demo data is rebuilt on every run, so two runs give the same pictures and nothing a previous run did lingers.
function rebuildDemo() {
  if (KEEP && fs.existsSync(path.join(DATA, 'medialedger.db'))) return;
  const { execFileSync } = require('child_process');
  const node = 'node';
  execFileSync(node, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'make-demo-data.js'), DATA], { stdio: 'inherit' });
  execFileSync('python', [path.join(__dirname, 'make-demo-posters.py'), DATA], { stdio: 'inherit' });
  execFileSync(node, ['--disable-warning=ExperimentalWarning', path.join(REPO, 'src/server/server.js'), `--data=${DATA}`, '--set-password'], { stdio: 'ignore', env: { ...process.env, MEDIALEDGER_PASSWORD: PASSWORD } });
}
// Details of the computer the pictures are made on do not belong in a manual: its name, its addresses and the
// names of its network adapters are replaced in the page before the picture is taken.
const os = require('os');
const REAL = (() => { const out = [[os.hostname(), 'media-server']]; let n = 0; for (const [name, list] of Object.entries(os.networkInterfaces())) { out.push([name, n++ ? 'Wi-Fi' : 'Ethernet']); for (const a of list) if (!a.internal && a.family === 'IPv4') out.push([a.address, '192.0.2.10']); } const cpu = (os.cpus()[0] || {}).model; if (cpu) out.push([cpu.trim(), 'Example processor']); return out.filter(x => x[0] && String(x[0]).length > 2).sort((a, b) => b[0].length - a[0].length); })();
const MASK = `const pairs = ${JSON.stringify(REAL)}; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode); for (const t of nodes) { let v = t.nodeValue; if (!v || v.length < 3) continue; let c = v; for (const [a, b] of pairs) if (c.includes(a)) c = c.split(a).join(b); c = c.replace(/(Ethernet|Wi-Fi)(, (Ethernet|Wi-Fi))+/g, 'Ethernet, Wi-Fi'); if (c !== v) t.nodeValue = c; }`;
let server = null;
function startServer() {
  // The family portal needs to be on, with an address, before an invite can be made.
  fs.writeFileSync(path.join(DATA, 'portal.json'), JSON.stringify({ admin: true, enabled: true, port: PPORT, bind: '127.0.0.1', publicUrl: 'https://library.example.invalid', homeUrl: PBASE, showRatings: true, checkMinutes: 0, invites: {}, devices: {} }));
  server = spawn(process.execPath.includes('electron') ? 'node' : process.execPath, ['--disable-warning=ExperimentalWarning', path.join(REPO, 'src/server/server.js'), `--data=${DATA}`, `--port=${PORT}`, '--host=127.0.0.1'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  server.stdout.on('data', () => {}); server.stderr.on('data', d => process.stderr.write('[server] ' + d));
}
const up = () => new Promise((resolve) => { const t = Date.now(); const tick = () => { http.get(BASE + '/index.html', r => { r.resume(); resolve(true); }).on('error', () => Date.now() - t > 20000 ? resolve(false) : setTimeout(tick, 250)); }; tick(); });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  rebuildDemo();
  startServer();
  if (!await up()) throw new Error('the server did not start');
  const screens = require('./screens.js').screens.filter(s => !ONLY.length || ONLY.includes(s.id));

  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
  const load = async (url) => { await win.loadURL(url); await sleep(400); };
  const size = async (w, h) => { win.setContentSize(w, h); await sleep(250); };
  const settle = async () => { await js(`await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const imgs = [...document.images].filter(i => i.src && !i.complete); await Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))), new Promise(r => setTimeout(r, 2500))]);`); await sleep(350); };

  // ---- sign in once; the session cookie carries through
  await load(BASE + '/');
  await sleep(1200);
  await js(`const f = document.querySelector('.webauth form'); if (f) { f.elements.username.value = 'admin'; f.elements.password.value = ${JSON.stringify(PASSWORD)}; f.querySelector('button[type=submit]').click(); }`);
  await sleep(2500);
  // ---- an invite, so the portal screens can be opened
  const invite = await js(`const r = await fetch('/api/portal:invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ name: 'Alex', days: 30 }]) }).then(r => r.json()); return r;`);
  const inviteLink = invite && invite.ok ? invite.result.links.home : null;
  if (!inviteLink) console.error('no invite link: ' + JSON.stringify(invite).slice(0, 200));
  await js(`await fetch('/api/portal:invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ name: 'Sam', days: 0, perms: { request: false } }]) });`);

  const boxes = {}, discover = {}, problems = [];
  let portalOpen = false, adminOpen = false;
  for (const s of screens) {
    try {
      const [w, h] = s.size || [W, H];
      await size(w, h);
      if (s.login) { await js(`await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });`); }
      if (s.portalAdmin) {
        if (!adminOpen) { await load(PBASE + '/admin'); await sleep(800); const lr = await js(`const r = await fetch("/a/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: ${JSON.stringify(PASSWORD)} }) }); return r.status + " " + (await r.text()).slice(0, 160);`); console.log("portal admin sign-in: " + lr); adminOpen = true; }
        await load(PBASE + '/admin' + (s.url || ''));
        win.webContents.reload(); await sleep(1800); // a change of #tab alone does not re-run the page's sign-in check
      } else if (s.portal) {
        if (!portalOpen) { await load(inviteLink); portalOpen = true; await sleep(1200); }
        await load(PBASE + '/' + (s.url || ''));
        await js(`window.dispatchEvent(new HashChangeEvent('hashchange'));`);
      } else if (s.path) { await load(BASE + s.path); }
      else {
        const cur = win.webContents.getURL();
        if (!cur.startsWith(BASE + '/') || cur.includes('/request')) await load(BASE + '/');
        await js(`try { localStorage.setItem('medialedger.wall', ${JSON.stringify(s.wall ? '1' : '0')}); ${s.theme ? `localStorage.setItem('medialedger.theme', ${JSON.stringify(s.theme)}); document.documentElement.dataset.theme = ${JSON.stringify(s.theme)};` : `localStorage.removeItem('medialedger.theme'); delete document.documentElement.dataset.theme;`} } catch (e) {}
          const m = document.querySelector('#modal'); if (m) m.hidden = true;
          document.querySelector('#view').textContent = 'Loading…';
          if (location.hash === ${JSON.stringify(s.url)}) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = ${JSON.stringify(s.url)};`);
        for (let i = 0; i < 120; i++) { if (await js(`return !document.querySelector('#view').textContent.startsWith('Loading');`)) break; await sleep(100); }
      }
      await sleep(s.wait || 700);
      if (s.login) await sleep(1200);
      if (s.before) { await js(s.before); await sleep(s.afterWait || 700); }
      await settle();
      await js(MASK);

      // ---- grow the window to the page so nothing is cut off, up to a limit
      const full = await js(`const m = document.scrollingElement; const main = document.querySelector('main') || document.body; return Math.max(document.documentElement.scrollHeight, main.scrollHeight + (main.getBoundingClientRect().top || 0), document.body.scrollHeight);`);
      const modalOpen = await js(`const m = document.querySelector('#modal'); return !!(m && !m.hidden);`);
      const tall = s.fixedHeight || modalOpen ? h : Math.min(s.maxHeight || MAXH, Math.max(h, full));
      if (tall !== h) { await size(w, tall); await settle(); }
      if (s.scrollTo) { await js(`const e = document.querySelector(${JSON.stringify(s.scrollTo)}); if (e) e.scrollIntoView({ block: 'start' });`); await sleep(400); }

      // ---- where each control is
      const found = await js(`const out = []; const specs = ${JSON.stringify((s.controls || []).map(c => ({ sel: c.sel, nth: c.nth || 0, text: c.text || null })))};
        for (const c of specs) { let els = [...document.querySelectorAll(c.sel)]; if (c.text) els = els.filter(e => (e.innerText || e.value || e.placeholder || '').trim().toLowerCase().includes(c.text.toLowerCase())); els = els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); const e = els[c.nth]; if (!e) { out.push(null); continue; } const r = e.getBoundingClientRect(); out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }); }
        return out;`);
      let crop = null;
      if (s.crop && s.crop.from) crop = await js(`const a = document.querySelector(${JSON.stringify(s.crop.from)}), b = document.querySelector(${JSON.stringify(s.crop.to || s.crop.from)}); if (!a || !b) return null; const main = (document.querySelector('main') || document.body).getBoundingClientRect(); const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return { x: Math.max(0, Math.round(main.left)), y: Math.max(0, Math.round(ra.top - 14)), w: Math.round(Math.min(innerWidth, main.right) - Math.max(0, main.left)), h: Math.round(rb.bottom - ra.top + 28) };`);
      if (s.crop && s.crop.h2From) crop = await js(`const hs = [...document.querySelectorAll('#view h2')]; const find = (t) => hs.find(h => h.textContent.trim().toLowerCase().startsWith(String(t).toLowerCase())); const a = find(${JSON.stringify(s.crop.h2From)}); const b = ${JSON.stringify(s.crop.h2To || null)} ? find(${JSON.stringify(s.crop.h2To || '')}) : null; const endSel = ${JSON.stringify(s.crop.to || null)}; const end = endSel ? document.querySelector(endSel) : null; if (!a) return null; const main = (document.querySelector('main') || document.body).getBoundingClientRect(); const top = a.getBoundingClientRect().top; const bottom = b ? b.getBoundingClientRect().top - 6 : (end ? end.getBoundingClientRect().bottom + 16 : document.documentElement.scrollHeight); return { x: Math.max(0, Math.round(main.left)), y: Math.max(0, Math.round(top - 14)), w: Math.round(Math.min(innerWidth, main.right) - Math.max(0, main.left)), h: Math.round(bottom - top + 14) };`);
      if (s.cropModal) crop = await js(`const c = document.querySelector('#modalCard, .modal-card'); if (!c) return null; const r = c.getBoundingClientRect(); const p = 60; return { x: Math.max(0, Math.round(r.left - p)), y: Math.max(0, Math.round(r.top - p)), w: Math.round(Math.min(innerWidth, r.right + p) - Math.max(0, r.left - p)), h: Math.round(Math.min(innerHeight, r.bottom + p) - Math.max(0, r.top - p)) };`);

      let img = await win.webContents.capturePage();
      if (img.isEmpty()) { await sleep(600); img = await win.webContents.capturePage(); }
      if (crop && crop.w > 50 && crop.h > 50) { const sz = img.getSize(); crop.w = Math.min(crop.w, sz.width - crop.x); crop.h = Math.min(crop.h, sz.height - crop.y); img = img.crop({ x: crop.x, y: crop.y, width: crop.w, height: crop.h }); }
      fs.writeFileSync(path.join(OUT, `${s.id}_clean.png`), img.toPNG());
      const sz = img.getSize();
      boxes[s.id] = { name: s.name, width: sz.width, height: sz.height, controls: (s.controls || []).map((c, i) => { const b = found[i]; if (!b) { problems.push(`${s.id}: control ${i + 1} "${c.name}" not found (${c.sel}${c.text ? ' ~ ' + c.text : ''})`); return { n: i + 1, name: c.name, missing: true }; } const x = b.x - (crop ? crop.x : 0), y = b.y - (crop ? crop.y : 0); if (x + b.w < 0 || y + b.h < 0 || x > sz.width || y > sz.height) { problems.push(`${s.id}: control ${i + 1} "${c.name}" is outside the image`); return { n: i + 1, name: c.name, missing: true }; } return { n: i + 1, name: c.name, x, y, w: b.w, h: b.h }; }) };

      if (DISCOVER) discover[s.id] = await js(`const seen = new Set(); const out = []; const scope = (document.querySelector('#modal') && !document.querySelector('#modal').hidden) ? document.querySelector('#modalCard') : (document.querySelector('#view') || document.body);
        for (const e of scope.querySelectorAll('button, input, select, textarea, a[href], th, .tile, .chip, .seg button, summary, .card > h3, [data-act]')) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; const key = (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '')) + '|' + (e.innerText || e.placeholder || e.value || '').trim().slice(0, 40); if (seen.has(key)) continue; seen.add(key); out.push({ sel: e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : ''), type: e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), text: (e.innerText || e.placeholder || e.value || e.title || '').trim().replace(/\\s+/g, ' ').slice(0, 70) }); if (out.length > 140) break; }
        return out;`);
      console.log(`captured ${s.id} ${sz.width}x${sz.height}${(s.controls || []).length ? ` · ${(s.controls || []).length} controls` : ''}`);
      if (s.after) { await js(s.after); await sleep(300); }
      if (s.login) { await js(`const f = document.querySelector('.webauth form'); if (f) { f.elements.username.value = 'admin'; f.elements.password.value = ${JSON.stringify(PASSWORD)}; f.querySelector('button[type=submit]').click(); }`); await sleep(2500); }
    } catch (e) { problems.push(`${s.id}: ${e.message}`); console.error(`FAILED ${s.id}: ${e.message}`); }
  }
  fs.writeFileSync(path.join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 1));
  if (DISCOVER) fs.writeFileSync(path.join(OUT, 'discover.json'), JSON.stringify(discover, null, 1));
  fs.writeFileSync(path.join(OUT, 'capture-problems.txt'), problems.join('\n') + (problems.length ? '\n' : ''));
  console.log(`${Object.keys(boxes).length} screens captured, ${problems.length} problems`);
  for (const p of problems) console.log('  ! ' + p);
}

app.whenReady().then(main).catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { try { server && server.kill(); } catch { /* gone */ } setTimeout(() => app.exit(process.exitCode || 0), 300); });
