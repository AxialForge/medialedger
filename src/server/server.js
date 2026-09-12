#!/usr/bin/env node
'use strict';
// MediaLedger web shell: the same core as the desktop app, served over HTTP on
// the LAN (built for a Raspberry Pi, runs anywhere Node 22 does).
//
//   node src/server/server.js [--data=<dir>] [--port=8080] [--host=0.0.0.0]
//   node src/server/server.js --set-password        (reads MEDIALEDGER_PASSWORD or prompts)
//
// Zero dependencies beyond Node: node:http serves src/renderer as static files,
// POST /api/<channel> calls a core handler with a JSON array of arguments, and
// GET /api/events is a server-sent-events stream carrying every progress event
// the desktop app would receive over IPC. One shared password, cookie session.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createService } = require('../main/service');
const pkg = require('../../package.json');

// ---- options -----------------------------------------------------------------------
const arg = (name, dflt) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const dataDir = path.resolve(arg('data', process.env.MEDIALEDGER_DATA || (process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'MediaLedger-web') : path.join(os.homedir(), '.local', 'share', 'medialedger'))));
const port = Number(arg('port', process.env.MEDIALEDGER_PORT || 8080));
const bindHost = arg('host', process.env.MEDIALEDGER_HOST || '0.0.0.0');
fs.mkdirSync(dataDir, { recursive: true });

const logFile = path.join(dataDir, 'medialedger.log');
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`; try { fs.appendFileSync(logFile, line); } catch { /* ignore */ } process.stdout.write(line); };

// ---- web.json: password hash + sessions (kept apart from settings.json, which the UI can replace wholesale) ----
const webFile = path.join(dataDir, 'web.json');
const readWeb = () => { try { return JSON.parse(fs.readFileSync(webFile, 'utf8')); } catch { return { sessions: {} }; } };
const writeWeb = (w) => { fs.writeFileSync(webFile, JSON.stringify(w, null, 2), { mode: 0o600 }); try { fs.chmodSync(webFile, 0o600); } catch { /* windows */ } };
const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkPassword = (pw, stored) => { if (!stored) return false; const [salt, hex] = stored.split(':'); const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(pw, salt, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };

if (process.argv.includes('--set-password')) {
  const finish = (pw) => { if (!pw || pw.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(2); } const w = readWeb(); w.passwordHash = hashPassword(pw); w.sessions = {}; writeWeb(w); console.log(`Password saved to ${webFile}; existing sessions signed out.`); process.exit(0); };
  if (process.env.MEDIALEDGER_PASSWORD) finish(process.env.MEDIALEDGER_PASSWORD);
  else if (!process.stdin.isTTY) { let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => finish(s.trim())); }
  else { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); rl.stdoutMuted = true; rl.question('New MediaLedger password: ', pw => { console.log(); rl.close(); finish(pw); }); rl._writeToOutput = s => { if (/password/i.test(s)) rl.output.write(s); }; }
  return;
}

// ---- core ------------------------------------------------------------------------------
const clients = new Set(); // SSE responses
const send = (channel, payload) => { const data = `data: ${JSON.stringify({ channel, payload })}\n\n`; for (const res of clients) { try { res.write(data); } catch { clients.delete(res); } } };
const svc = createService({ userData: dataDir, log, send, host: { isPackaged: true, getAppPath: () => path.join(__dirname, '..', '..') } });
svc.init();

// Shell-specific handlers the desktop app implements with Electron dialogs / shell / updater.
const webHandlers = new Map([
  ['app:info', async () => ({
    version: pkg.version, electron: null, node: process.versions.node, chrome: null, web: true,
    platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length, userData: dataDir, logFile, dbFile: svc.db.file, exportDir: svc.exportDir(),
    ffprobe: svc.ffprobePath(), ffprobeVersion: await require('../main/ffmpegdl').ffprobeVersion(svc.ffprobePath()), packaged: false, repo: 'https://github.com/AxialForge/medialedger',
    updateStatus: { state: 'idle' }, db: svc.db.stats(), watch: svc.watcher.status(), metaJob: svc.metaJob,
  })],
  ['dialog:pickFolder', () => null], // the browser cannot open a server-side folder picker; type the path
  ['dialog:pickFile', () => null],
  ['shell:open', () => false],
  ['shell:openExternal', () => false], // the renderer falls back to a normal link when this returns false
  ['shell:showItem', () => false],
  ['update:check', () => ({ state: 'error', message: 'On the server, update with: sudo medialedger-update' })],
  ['update:install', () => ({ ok: false })],
  ['update:status', () => ({ state: 'idle' })],
]);
const handlers = new Map([...svc.handlers, ...webHandlers]);

// ---- sessions ---------------------------------------------------------------------------
const SESSION_DAYS = 30;
const failures = new Map(); // ip -> [timestamps]
function sessionOf(req) {
  const m = /(?:^|;\s*)ml_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const w = readWeb(); const s = w.sessions && w.sessions[m[1]];
  if (!s || s.expires < Date.now()) return null;
  return m[1];
}
function newSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  const w = readWeb(); w.sessions = w.sessions || {};
  for (const [k, v] of Object.entries(w.sessions)) if (v.expires < Date.now()) delete w.sessions[k];
  w.sessions[token] = { created: Date.now(), expires: Date.now() + SESSION_DAYS * 86400000 };
  writeWeb(w);
  res.setHeader('Set-Cookie', `ml_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
}
function tooManyFailures(ip) { const now = Date.now(); const list = (failures.get(ip) || []).filter(t => now - t < 60000); failures.set(ip, list); return list.length >= 5; }

// ---- http --------------------------------------------------------------------------------
const rendererDir = path.join(__dirname, '..', 'renderer');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 4 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(s)); req.on('error', reject); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress;
  try {
    if (url.pathname.startsWith('/api/')) {
      const ch = decodeURIComponent(url.pathname.slice(5));
      // Same-origin only: a page on another site cannot drive the API even with the cookie (SameSite=Strict is the second lock).
      const origin = req.headers.origin; const host = req.headers.host;
      if (origin && new URL(origin).host !== host) return json(res, 403, { ok: false, error: 'cross-origin request refused' });

      if (ch === 'login' && req.method === 'POST') {
        if (tooManyFailures(ip)) return json(res, 429, { ok: false, error: 'too many attempts' });
        const { password } = JSON.parse(await readBody(req) || '{}');
        const w = readWeb();
        if (!w.passwordHash) return json(res, 503, { ok: false, error: 'No password set on the server. Run: medialedger --set-password' });
        if (!checkPassword(String(password || ''), w.passwordHash)) { failures.get(ip).push(Date.now()); log(`login failed from ${ip}`); return json(res, 401, { ok: false, error: 'wrong password' }); }
        newSession(res); log(`login from ${ip}`); return json(res, 200, { ok: true });
      }
      if (!sessionOf(req)) return json(res, 401, { ok: false, error: 'sign in required' });
      if (ch === 'logout') { const w = readWeb(); delete w.sessions[sessionOf(req)]; writeWeb(w); res.setHeader('Set-Cookie', 'ml_session=; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (ch === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': connected\n\n'); clients.add(res);
        const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closing */ } }, 25000);
        req.on('close', () => { clearInterval(ka); clients.delete(res); });
        return;
      }
      const fn = handlers.get(ch);
      if (!fn || req.method !== 'POST') return json(res, 404, { ok: false, error: `unknown channel ${ch}` });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'JSON body required' });
      const args = JSON.parse(await readBody(req) || '[]');
      if (!Array.isArray(args)) return json(res, 400, { ok: false, error: 'arguments must be an array' });
      const result = await fn(...args);
      return json(res, 200, { ok: true, result: result === undefined ? null : result });
    }

    // Static renderer files. Everything the desktop app loads from disk is served from here.
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(rendererDir, file);
    if (!abs.startsWith(rendererDir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    log(`${req.method} ${url.pathname}: ${e.message}`);
    if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
    else res.end();
  }
});
server.requestTimeout = 0;       // a scan request legitimately runs for minutes
server.headersTimeout = 60000;
server.keepAliveTimeout = 65000;

server.listen(port, bindHost, () => {
  log(`MediaLedger ${pkg.version} web server on http://${bindHost}:${port} (data: ${dataDir})`);
  if (!readWeb().passwordHash) log('No password set yet: run with --set-password before anyone can sign in.');
  svc.scheduler.start(); svc.watcher.apply();
  const s = svc.settings.get();
  if (s.metadata.enabled) setTimeout(() => svc.refreshMetadata({ onlyNew: true }).catch(e => log('metadata: ' + e.message)), 4000);
});

const stop = (sig) => { log(`${sig}: shutting down`); server.close(); for (const c of clients) { try { c.end(); } catch { /* ignore */ } } svc.shutdown(); process.exit(0); };
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
