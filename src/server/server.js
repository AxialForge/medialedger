#!/usr/bin/env node
'use strict';
// MediaLedger web shell: the same core as the desktop app, served over HTTP(S)
// on the LAN (built for a Raspberry Pi, runs anywhere Node 22 does).
//
//   node src/server/server.js [--data=<dir>] [--port=8080] [--host=0.0.0.0]
//   node src/server/server.js --set-password        (reads MEDIALEDGER_PASSWORD or prompts)
//
// Zero dependencies beyond Node: node:http(s) serves src/renderer as static
// files, POST /api/<channel> calls a core handler with a JSON array of
// arguments, and GET /api/events is a server-sent-events stream carrying every
// progress event the desktop app would receive over IPC.
//
// Security (see security.js): scrypt password, HttpOnly SameSite=Strict cookie
// sessions with idle timeout, per-IP lockout, LAN-only by default, optional
// TOTP two-factor, re-authentication within 5 minutes for actions that touch
// the share, same-origin API, strict CSP and security headers, audit log.
// HTTPS: put cert.pem + key.pem in <data>/tls/ and the server switches to TLS.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createService } = require('../main/service');
const { createSecurity } = require('./security');
const pkg = require('../../package.json');

// ---- options -----------------------------------------------------------------------
const arg = (name, dflt) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const dataDir = path.resolve(arg('data', process.env.MEDIALEDGER_DATA || (process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'MediaLedger-web') : path.join(os.homedir(), '.local', 'share', 'medialedger'))));
const port = Number(arg('port', process.env.MEDIALEDGER_PORT || 8080));
const bindHost = arg('host', process.env.MEDIALEDGER_HOST || '0.0.0.0');
fs.mkdirSync(dataDir, { recursive: true });

const logFile = path.join(dataDir, 'medialedger.log');
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`; try { fs.appendFileSync(logFile, line); } catch { /* ignore */ } process.stdout.write(line); };
const sec = createSecurity({ dataDir, log });

if (process.argv.includes('--set-password')) {
  const finish = (pw) => { try { sec.setPassword(pw); } catch (e) { console.error(e.message); process.exit(2); } console.log(`Password saved; all sessions signed out.`); process.exit(0); };
  if (process.env.MEDIALEDGER_PASSWORD) finish(process.env.MEDIALEDGER_PASSWORD);
  else if (!process.stdin.isTTY) { let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => finish(s.trim())); }
  else { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); rl.question('New MediaLedger password: ', pw => { console.log(); rl.close(); finish(pw); }); rl._writeToOutput = s => { if (/password/i.test(s)) rl.output.write(s); }; }
  return;
}

// ---- TLS (optional) ------------------------------------------------------------------
const tlsDir = path.join(dataDir, 'tls');
let tls = null;
try { tls = { cert: fs.readFileSync(path.join(tlsDir, 'cert.pem')), key: fs.readFileSync(path.join(tlsDir, 'key.pem')) }; } catch { /* plain http */ }

// ---- core ------------------------------------------------------------------------------
const clients = new Set(); // SSE responses
const send = (channel, payload) => { const data = `data: ${JSON.stringify({ channel, payload })}\n\n`; for (const res of clients) { try { res.write(data); } catch { clients.delete(res); } } };
const svc = createService({ userData: dataDir, log, send, host: { isPackaged: true, getAppPath: () => path.join(__dirname, '..', '..') } });
svc.init();

// Actions that write to the share or throw data away: the session must have re-entered the password within 5 minutes.
const SENSITIVE = new Set(['movie:run', 'movie:undo', 'rename:apply', 'data:purgeMissing', 'security:changePassword', 'security:totpSetup', 'security:totpEnable', 'security:totpDisable', 'security:setOptions', 'security:revokeOthers']);
const isSensitive = (ch, args) => ch === 'movie:run' ? !!(args[1] && args[1].live) : SENSITIVE.has(ch);

// Shell-specific handlers the desktop app implements with Electron dialogs / shell / updater, plus the security tab.
// Security handlers receive the request context as the last argument (see call site).
const webHandlers = new Map([
  ['app:info', async () => ({
    version: pkg.version, electron: null, node: process.versions.node, chrome: null, web: true, https: !!tls,
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
  ['security:status', (ctx) => sec.status(ctx.session.id, {
    available: true, https: !!tls, port, bindHost, dataDir,
    checks: posture(),
  })],
  ['security:changePassword', (ctx, current, next) => { sec.changePassword(current, next, ctx.session.id, ctx.ip); return true; }],
  ['security:totpSetup', (ctx) => sec.totpSetup(`${os.hostname()}`)],
  ['security:totpEnable', (ctx, code) => sec.totpEnable(code, ctx.ip)],
  ['security:totpDisable', (ctx, password) => sec.totpDisable(password, ctx.ip)],
  ['security:setOptions', (ctx, opts) => { sec.setOptions(opts || {}, ctx.ip); return true; }],
  ['security:revoke', (ctx, id) => sec.revoke(id, ctx.session.id, ctx.ip)],
  ['security:revokeOthers', (ctx) => sec.revokeOthers(ctx.session.id, ctx.ip)],
]);
const CTX_HANDLERS = new Set([...webHandlers.keys()].filter(k => k.startsWith('security:')));
const handlers = new Map([...svc.handlers, ...webHandlers]);

// Security posture checklist shown at the top of the Security tab.
function posture() {
  const st = sec.state;
  const checks = [];
  const add = (ok, name, detail, level = 'warn') => checks.push({ ok, name, detail, level: ok ? 'ok' : level });
  add(!!st.passwordHash, 'Password set', st.passwordHash ? 'scrypt-hashed in web.json (mode 0600)' : 'Run: sudo medialedger --set-password', 'bad');
  add(st.totp.enabled, 'Two-factor codes', st.totp.enabled ? 'a phone code is required at sign-in' : 'optional: turn on below so a leaked password alone is not enough');
  add(st.lanOnly, 'LAN-only access', st.lanOnly ? 'connections from outside private address ranges are refused' : 'off: any address that can reach the port may try to sign in');
  add(!!tls, 'HTTPS', tls ? 'serving TLS from <data>/tls' : 'plain HTTP: fine on a trusted LAN; see the Pi guide to enable TLS');
  add(process.getuid ? process.getuid() !== 0 : true, 'Not running as root', process.getuid && process.getuid() === 0 ? 'the service runs as root; use the installer\'s medialedger user' : 'service user has no shell and no sudo', 'bad');
  try { const m = fs.statSync(path.join(dataDir, 'web.json')).mode & 0o777; add(process.platform === 'win32' || m === 0o600, 'Secrets file permissions', `web.json mode ${m.toString(8)}`); } catch { /* none */ }
  try { const m = fs.statSync('/etc/medialedger-cifs.cred').mode & 0o777; add(m === 0o600, 'Share credentials file', `/etc/medialedger-cifs.cred mode ${m.toString(8)}, root only`); } catch { /* not the Pi install */ }
  add(st.idleMinutes > 0, 'Idle sign-out', st.idleMinutes ? `sessions end after ${st.idleMinutes} idle minutes` : 'optional: sessions last 30 days unless signed out');
  add(!svc.settings.get().movieRename.enabled && !svc.settings.get().renaming.enabled, 'Renaming switched off', 'live renames need the switch on, then a password re-entry per batch');
  return checks;
}

// ---- http --------------------------------------------------------------------------------
const rendererDir = path.join(__dirname, '..', 'renderer');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const SEC_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cross-origin-opener-policy': 'same-origin',
  ...(tls ? { 'strict-transport-security': 'max-age=15552000' } : {}),
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 4 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(s)); req.on('error', reject); });
const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  try {
    if (!sec.isAllowedIp(ip)) { sec.audit('refused_non_lan', ip, url.pathname); res.writeHead(403); return res.end('LAN only'); }
    if (url.pathname.startsWith('/api/')) {
      const ch = decodeURIComponent(url.pathname.slice(5));
      // Same-origin only: a page on another site cannot drive the API even with the cookie (SameSite=Strict is the second lock).
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { sec.audit('cross_origin_refused', ip, origin); return json(res, 403, { ok: false, error: 'cross-origin request refused' }); }
      if (req.method !== 'GET' && !/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'JSON body required' });

      if (ch === 'login' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const r = sec.login(ip, req.headers['user-agent'], body);
        if (r.ok) { res.setHeader('Set-Cookie', sec.cookieFor(r.id, !!tls)); return json(res, 200, { ok: true }); }
        const status = { locked: 429, nopassword: 503, totp: 401, totp_bad: 401, password: 401 }[r.reason] || 401;
        return json(res, status, { ok: false, reason: r.reason, error: { locked: 'Too many failed attempts; this address is locked for 15 minutes', nopassword: 'No password set on the server. Run: sudo medialedger --set-password', totp: 'Enter the code from your authenticator app', totp_bad: 'Wrong code', password: 'Wrong password' }[r.reason] });
      }
      const session = sec.sessionOf(req.headers.cookie);
      if (!session) return json(res, 401, { ok: false, reason: 'login', error: 'sign in required' });
      if (ch === 'logout') { sec.logout(session.id, ip); res.setHeader('Set-Cookie', sec.clearCookie); return json(res, 200, { ok: true }); }
      if (ch === 'reauth' && req.method === 'POST') { const { password } = JSON.parse(await readBody(req) || '{}'); return sec.reauth(session, password, ip) ? json(res, 200, { ok: true }) : json(res, 401, { ok: false, reason: 'reauth_bad', error: 'Wrong password' }); }
      if (ch === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': connected\n\n'); clients.add(res);
        const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closing */ } }, 25000);
        req.on('close', () => { clearInterval(ka); clients.delete(res); });
        return;
      }
      const fn = handlers.get(ch);
      if (!fn || req.method !== 'POST') return json(res, 404, { ok: false, error: `unknown channel ${ch}` });
      const args = JSON.parse(await readBody(req) || '[]');
      if (!Array.isArray(args)) return json(res, 400, { ok: false, error: 'arguments must be an array' });
      if (isSensitive(ch, args) && sec.needsReauth(session)) return json(res, 401, { ok: false, reason: 'reauth', error: 'Please re-enter your password for this action' });
      if (isSensitive(ch, args)) sec.audit('sensitive_action', ip, ch);
      const result = CTX_HANDLERS.has(ch) ? await fn({ session, ip }, ...args) : await fn(...args);
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
}

const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
server.requestTimeout = 0;       // a scan request legitimately runs for minutes
server.headersTimeout = 60000;
server.keepAliveTimeout = 65000;

server.listen(port, bindHost, () => {
  log(`MediaLedger ${pkg.version} web server on ${tls ? 'https' : 'http'}://${bindHost}:${port} (data: ${dataDir}, LAN-only: ${sec.state.lanOnly})`);
  if (!sec.hasPassword()) log('No password set yet: run with --set-password before anyone can sign in.');
  svc.scheduler.start(); svc.watcher.apply();
  const s = svc.settings.get();
  if (s.metadata.enabled) setTimeout(() => svc.refreshMetadata({ onlyNew: true }).catch(e => log('metadata: ' + e.message)), 4000);
});

const stop = (sig) => { log(`${sig}: shutting down`); server.close(); for (const c of clients) { try { c.end(); } catch { /* ignore */ } } svc.shutdown(); process.exit(0); };
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
