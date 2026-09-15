#!/usr/bin/env node
'use strict';
// MediaLedger web shell: the same core as the desktop app, served over HTTP(S)
// on the LAN (built for a Raspberry Pi, runs anywhere Node 22 does).
//
//   node src/server/server.js [--data=<dir>] [--port=8080] [--host=0.0.0.0]
//   node src/server/server.js --set-password        (create/reset the "admin" account; reads MEDIALEDGER_PASSWORD or prompts)
//
// Zero dependencies beyond Node: node:http(s) serves src/renderer as static
// files, POST /api/<channel> calls a core handler with a JSON array of
// arguments, and GET /api/events is a server-sent-events stream carrying every
// progress event the desktop app would receive over IPC.
//
// Access (see security.js): user accounts with admin / standard roles, an
// optional no-login guest mode, scrypt passwords, HttpOnly SameSite=Strict
// cookie sessions with idle timeout, per-IP lockout, LAN-only by default,
// TOTP two-factor for admins, re-authentication within 5 minutes for actions
// that touch the share, same-origin API, strict CSP, audit log.
// HTTPS: put cert.pem + key.pem in <data>/tls/ and the server switches to TLS.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createService } = require('../main/service');
const { createSecurity } = require('./security');
const plex = require('../main/plex');
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
  const finish = (pw) => { try { sec.setPassword(pw); } catch (e) { console.error(e.message); process.exit(2); } console.log('Password for user "admin" saved; all sessions signed out.'); process.exit(0); };
  if (process.env.MEDIALEDGER_PASSWORD) finish(process.env.MEDIALEDGER_PASSWORD);
  else if (!process.stdin.isTTY) { let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => finish(s.trim())); }
  else { const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout }); rl.question('New password for user "admin": ', pw => { console.log(); rl.close(); finish(pw); }); rl._writeToOutput = s => { if (/password/i.test(s)) rl.output.write(s); }; }
  return;
}

// ---- TLS (optional) ------------------------------------------------------------------
const tlsDir = path.join(dataDir, 'tls');
let tls = null;
try { tls = { cert: fs.readFileSync(path.join(tlsDir, 'cert.pem')), key: fs.readFileSync(path.join(tlsDir, 'key.pem')) }; } catch { /* plain http */ }
// A port-80 install that turns on HTTPS serves on 443 and leaves a redirect on 80, so http://name keeps working.
const servePort = tls && port === 80 ? 443 : port;

// ---- core ------------------------------------------------------------------------------
const clients = new Set(); // SSE responses
const send = (channel, payload) => { const data = `data: ${JSON.stringify({ channel, payload })}\n\n`; for (const res of clients) { try { res.write(data); } catch { clients.delete(res); } } };
const svc = createService({ userData: dataDir, log, send, host: { isPackaged: true, getAppPath: () => path.join(__dirname, '..', '..') } });
svc.init();

// ---- roles ---------------------------------------------------------------------------------
// What a guest (no account) may call: read-only library statistics, plus filing a media request.
const GUEST = new Set(['app:info', 'security:me', 'data:dashboard', 'data:series', 'data:episodes', 'data:movies', 'data:movieFiles', 'data:search', 'web:channels', 'web:videos', 'ratings:list', 'meta:get', 'scan:status', 'scan:list', 'update:status', 'adult:status', 'requests:list', 'requests:add', 'roots:last', 'tags:list', 'tags:all', 'tags:get', 'data:tonight', 'data:storage', 'data:airing']);
// A standard user: everything a guest may, plus the review pages, own ratings, the adult switch for their own session.
const STANDARD = new Set([...GUEST, 'data:problems', 'data:duplicates', 'data:missing', 'data:quality', 'data:changes', 'data:changeStats', 'movie:plan', 'movie:batches', 'movie:batchItems', 'rename:proposals', 'rename:history', 'export:list', 'override:list', 'override:suggest', 'meta:status', 'plex:status', 'watch:status', 'schedule:nextInApp', 'db:stats', 'settings:get', 'adult:toggle', 'ratings:setUser', 'security:changePassword', 'tags:add', 'tags:remove', 'data:upgrades']);
// Admins: every channel. Actions that write to the share or throw data away also need a fresh password (re-auth).
const SENSITIVE = new Set(['security:tlsEnable', 'status:rotate', 'plex:webhookSet', 'movie:run', 'movie:undo', 'rename:apply', 'data:purgeMissing', 'security:changePassword', 'security:totpSetup', 'security:totpEnable', 'security:totpDisable', 'security:setOptions', 'security:revokeOthers', 'security:addUser', 'security:setRole', 'security:resetPassword', 'security:deleteUser']);
const isSensitive = (ch, args) => ch === 'movie:run' ? !!(args[1] && args[1].live) : SENSITIVE.has(ch);
const allowed = (role, ch) => role === 'admin' || (role === 'standard' ? STANDARD.has(ch) : GUEST.has(ch));
// Settings hold secrets (Plex token, GitHub token); a standard user sees them blanked.
const redactSettings = (s) => ({ ...s, plex: { ...(s.plex || {}), token: s.plex && s.plex.token ? '••••' : '' }, githubToken: s.githubToken ? '••••' : '' });

// Shell-specific handlers the desktop app implements with Electron dialogs / shell / updater, plus security and per-session state.
// Handlers listed in CTX_HANDLERS receive { session, ip, role } as their first argument.
const webHandlers = new Map([
  ['app:info', async () => ({
    version: pkg.version, electron: null, node: process.versions.node, chrome: null, web: true, https: !!tls,
    platform: `${os.type()} ${os.release()} (${os.arch()})`, cpus: os.cpus().length, userData: dataDir, logFile, dbFile: svc.db.file, exportDir: svc.exportDir(),
    ffprobe: svc.ffprobePath(), ffprobeVersion: await require('../main/ffmpegdl').ffprobeVersion(svc.ffprobePath()), packaged: false, repo: 'https://github.com/AxialForge/medialedger',
    updateStatus: { state: 'idle' }, db: svc.db.stats(), watch: svc.watcher.status(), metaJob: svc.metaJob,
  })],
  ['dialog:pickFolder', () => null], // the browser cannot open a server-side folder picker; the renderer uses roots:listDirs instead
  ['dialog:pickFile', () => null],
  ['shell:open', () => false],
  ['shell:openExternal', () => false],
  ['shell:showItem', () => false],
  ['update:check', async () => {
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
    try {
      const r = await fetch('https://api.github.com/repos/AxialForge/medialedger/releases/latest', { headers: { 'user-agent': 'medialedger-server', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const latest = String((await r.json()).tag_name || '').replace(/^v/, '');
      return newer(latest, pkg.version) ? { state: 'available', version: latest, message: `Version ${latest} is available. On the Pi run: sudo medialedger-update` } : { state: 'current', version: latest, message: `You are on the latest version (${pkg.version}).` };
    } catch (e) { return { state: 'error', message: 'Could not reach GitHub: ' + e.message }; }
  }],
  ['update:install', () => ({ ok: false })],
  ['update:status', () => ({ state: 'idle' })],
  // per-session state
  ['settings:get', (ctx) => ctx.role === 'admin' ? svc.settings.get() : redactSettings(svc.settings.get())],
  ['adult:status', (ctx) => { const base = svc.handlers.get('adult:status')(); return { ...base, showAdult: ctx.role === 'guest' ? false : !!ctx.session.showAdult, canToggle: ctx.role !== 'guest' }; }],
  ['adult:toggle', (ctx, on) => { if (ctx.role === 'guest') throw new Error('Sign in to see adult content'); sec.setSessionFlag(ctx.session.id, 'showAdult', !!on); svc.setShowAdult(!!on); return { ...svc.handlers.get('adult:status')(), showAdult: !!on, canToggle: true }; }],
  ['requests:add', (ctx, r) => svc.handlers.get('requests:add')({ ...(r || {}), requested_by: ctx.role === 'guest' ? `guest: ${String((r || {}).requested_by || 'anonymous').slice(0, 40)}` : ctx.session.user })],
  // security
  ['security:me', (ctx) => ({ available: true, guest: ctx.role === 'guest', username: ctx.session ? ctx.session.user : null, role: ctx.role, guestEnabled: sec.guestEnabled(), hasUsers: sec.hasPassword() })],
  ['security:status', (ctx) => sec.status(ctx.session, { available: true, https: !!tls, port: servePort, tlsPort: port === 80 ? 443 : port, bindHost, dataDir, checks: posture(), opensslAvailable: hasOpenssl() })],
  // Creates a self-signed certificate for every name this Pi answers to, then exits so systemd restarts the service on HTTPS.
  ['security:tlsEnable', (ctx) => {
    if (tls) return { ok: true, already: true, port: servePort };
    if (!hasOpenssl()) throw new Error('openssl is not installed on this server (sudo apt install openssl)');
    fs.mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
    const isIp = (h) => /^\d+(\.\d+){3}$/.test(h);
    const names = new Set(), ips = new Set();
    const hostHdr = String(ctx.req.headers.host || '').replace(/:\d+$/, '');
    for (const h of [hostHdr, os.hostname() + '.local', os.hostname()]) if (h) (isIp(h) ? ips : names).add(h.toLowerCase());
    try { const d = fs.readFileSync('/etc/medialedger-domain', 'utf8').trim(); if (d) names.add(d.toLowerCase()); } catch { /* no custom domain */ }
    for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && !i.internal) ips.add(i.address);
    const san = [...names].map(n => 'DNS:' + n).concat([...ips].map(i => 'IP:' + i)).join(',');
    const cn = [...names][0] || [...ips][0];
    const r = require('child_process').spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=' + cn, '-addext', 'subjectAltName=' + san, '-keyout', path.join(tlsDir, 'key.pem'), '-out', path.join(tlsDir, 'cert.pem')], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) { try { fs.rmSync(path.join(tlsDir, 'key.pem'), { force: true }); fs.rmSync(path.join(tlsDir, 'cert.pem'), { force: true }); } catch { /* ignore */ } throw new Error('openssl failed: ' + ((r.stderr || '').trim().split('\n').pop() || (r.error && r.error.message) || 'unknown')); }
    try { fs.chmodSync(path.join(tlsDir, 'key.pem'), 0o600); fs.chmodSync(path.join(tlsDir, 'cert.pem'), 0o600); } catch { /* windows */ }
    sec.audit('tls_enabled', ctx.ip, san, ctx.session.user);
    log(`HTTPS certificate created for ${san}; restarting`);
    setTimeout(() => process.exit(0), 1500);
    return { ok: true, san, port: port === 80 ? 443 : port };
  }],
  ['security:changePassword', (ctx, current, next) => { sec.changePassword(ctx.session, current, next, ctx.ip); return true; }],
  ['security:totpSetup', () => sec.totpSetup(`${os.hostname()} admin`)],
  ['security:totpEnable', (ctx, code) => sec.totpEnable(code, ctx.ip, ctx.session.user)],
  ['security:totpDisable', (ctx, password) => sec.totpDisable(ctx.session, password, ctx.ip)],
  ['security:setOptions', (ctx, opts) => { sec.setOptions(opts || {}, ctx.ip, ctx.session.user); return true; }],
  ['security:revoke', (ctx, id) => sec.revoke(id, ctx.session, ctx.ip)],
  ['security:revokeOthers', (ctx) => sec.revokeOthers(ctx.session, ctx.ip)],
  ['security:users', () => sec.listUsers()],
  ['security:addUser', (ctx, name, password, role) => sec.addUser(name, password, role, ctx.ip, ctx.session.user)],
  ['security:setRole', (ctx, name, role) => sec.setRole(name, role, ctx.ip, ctx.session.user)],
  ['security:resetPassword', (ctx, name, password) => sec.resetPassword(name, password, ctx.ip, ctx.session.user)],
  ['security:deleteUser', (ctx, name) => sec.deleteUser(name, ctx.ip, ctx.session.user)],
]);
// Plex webhook status/controls (admin). The URL includes the key; the Settings → Plex section shows it.
const webhookEvents = []; // last 50 events received
let webhookScanTimer = null;
const webhookUrl = (req) => { const w = sec.webhook(); if (!w.key) return null; const host = req && req.headers.host ? req.headers.host : `${os.hostname()}.local:${port}`; return `${tls ? 'https' : 'http'}://${host}/api/plex/webhook?key=${w.key}`; };
webHandlers.set('status:info', (ctx) => { const key = sec.statusKey(false, ctx.ip, ctx.session && ctx.session.user); const host = ctx.req && ctx.req.headers.host ? ctx.req.headers.host : `${os.hostname()}.local:${servePort}`; return { available: true, url: `${tls ? 'https' : 'http'}://${host}/api/status?key=${key}` }; });
webHandlers.set('status:rotate', (ctx) => { sec.statusKey(true, ctx.ip, ctx.session.user); return webHandlers.get('status:info')(ctx); });
webHandlers.set('plex:webhookInfo', (ctx) => ({ available: true, enabled: sec.webhook().enabled, url: webhookUrl(ctx.req), events: webhookEvents.slice().reverse() }));
webHandlers.set('plex:webhookSet', (ctx, opts) => { sec.webhookSet(opts || {}, ctx.ip, ctx.session.user); return { enabled: sec.webhook().enabled, url: webhookUrl(ctx.req) }; });
const CTX_HANDLERS = new Set([...webHandlers.keys()].filter(k => k.startsWith('security:') || ['settings:get', 'adult:status', 'adult:toggle', 'requests:add', 'plex:webhookInfo', 'plex:webhookSet', 'status:info', 'status:rotate'].includes(k)));
const handlers = new Map([...svc.handlers, ...webHandlers]);

const hasOpenssl = () => { try { return require('child_process').spawnSync('openssl', ['version'], { encoding: 'utf8', timeout: 5000 }).status === 0; } catch { return false; } };

// Security posture checklist shown at the top of the Security tab.
function posture() {
  const st = sec.state;
  const checks = [];
  const add = (ok, name, detail, level = 'warn') => checks.push({ ok, name, detail, level: ok ? 'ok' : level });
  const admins = Object.values(st.users).filter(u => u.role === 'admin').length;
  add(admins > 0, 'Admin account', admins ? `${admins} admin, ${Object.keys(st.users).length - admins} standard user(s); scrypt-hashed in web.json` : 'Run: sudo medialedger --set-password', 'bad');
  add(st.totp.enabled, 'Two-factor codes for admins', st.totp.enabled ? 'a phone code is required at admin sign-in' : 'optional: turn on below so a leaked admin password alone is not enough');
  add(st.lanOnly, 'LAN-only access', st.lanOnly ? 'connections from outside private address ranges are refused' : 'off: any address that can reach the port may try to sign in');
  add(!st.guestEnabled, 'Guest access', st.guestEnabled ? 'on: anyone on the LAN sees library statistics without signing in (never adult content, never controls)' : 'off: every page needs an account');
  add(!!tls, 'HTTPS', tls ? `serving TLS on port ${servePort} from <data>/tls` : 'plain HTTP: fine on a trusted LAN; turn it on below');
  add(process.getuid ? process.getuid() !== 0 : true, 'Not running as root', process.getuid && process.getuid() === 0 ? 'the service runs as root; use the installer\'s medialedger user' : 'service user has no shell and no sudo', 'bad');
  try { const m = fs.statSync(path.join(dataDir, 'web.json')).mode & 0o777; add(process.platform === 'win32' || m === 0o600, 'Secrets file permissions', `web.json mode ${m.toString(8)}`); } catch { /* none */ }
  try { const m = fs.statSync('/etc/medialedger-cifs.cred').mode & 0o777; add(m === 0o600, 'Share credentials file', `/etc/medialedger-cifs.cred mode ${m.toString(8)}, root only`); } catch { /* not the Pi install */ }
  add(st.idleMinutes > 0, 'Idle sign-out', st.idleMinutes ? `sessions end after ${st.idleMinutes} idle minutes` : 'optional: sessions last 30 days unless signed out');
  add(!svc.settings.get().movieRename.enabled && !svc.settings.get().renaming.enabled, 'Renaming switched off', 'live renames need the switch on, then a password re-entry per batch');
  return checks;
}

// ---- http --------------------------------------------------------------------------------
const rendererDir = path.join(__dirname, '..', 'renderer');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const SEC_HEADERS = {
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cross-origin-opener-policy': 'same-origin',
  ...(tls ? { 'strict-transport-security': 'max-age=15552000' } : {}),
};
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 4 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(s)); req.on('error', reject); });
const clientIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const readRaw = (req, max = 8 * 1024 * 1024) => new Promise((resolve, reject) => { const chunks = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { reject(new Error('body too large')); req.destroy(); } else chunks.push(d); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); });

// Plex → us. No session: the key in the URL is the credential (LAN-only still applies). Plex sends multipart with a JSON "payload" part and sometimes a thumbnail.
async function handlePlexWebhook(req, res, url, ip) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  if (!sec.webhookOk(url.searchParams.get('key') || '')) { sec.audit('webhook_refused', ip, 'bad or missing key'); res.writeHead(403); return res.end('bad key'); }
  const payload = plex.parseWebhookBody(req.headers['content-type'], await readRaw(req));
  if (!payload) { res.writeHead(400); return res.end('no payload'); }
  const r = plex.applyWebhookEvent(svc.db, payload);
  webhookEvents.push({ ts: new Date().toISOString(), ...r, account: payload.Account && payload.Account.title || null, player: payload.Player && payload.Player.title || null }); if (webhookEvents.length > 50) webhookEvents.shift();
  log(`plex webhook: ${r.event}${r.title ? ' ' + r.title : ''}${r.updated ? ' → ' + r.updated : ''}${r.scan ? ' → scan queued' : ''}`);
  if (r.scan) { clearTimeout(webhookScanTimer); webhookScanTimer = setTimeout(() => svc.runScan('plex-webhook').catch(e => log('webhook scan: ' + e.message)), 120000); }
  if (r.updated) send('plex:progress', { running: false, message: `Plex: ${r.title} ${r.updated === 'watched' ? 'watched' : 'rated'}` });
  res.writeHead(200); res.end('ok');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const ip = clientIp(req);
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  try {
    if (!sec.isAllowedIp(ip)) { sec.audit('refused_non_lan', ip, url.pathname); res.writeHead(403); return res.end('LAN only'); }
    if (url.pathname === '/api/plex/webhook') return handlePlexWebhook(req, res, url, ip);
    // Read-only status JSON for Home Assistant: GET /api/status?key=<status key>. No session, LAN-only still applies.
    if (url.pathname === '/api/status') {
      if (!sec.statusOk(url.searchParams.get('key') || '')) { sec.audit('status_refused', ip, 'bad key'); return json(res, 401, { ok: false, error: 'bad key' }); }
      return json(res, 200, handlers.get('data:status')());
    }
    // The phone-sized request page.
    if (url.pathname === '/request' || url.pathname === '/request/') { url.pathname = '/request.html'; }
    if (url.pathname.startsWith('/api/')) {
      const ch = decodeURIComponent(url.pathname.slice(5));
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { sec.audit('cross_origin_refused', ip, origin); return json(res, 403, { ok: false, error: 'cross-origin request refused' }); }
      if (req.method !== 'GET' && !/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'JSON body required' });

      if (ch === 'login' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const r = sec.login(ip, req.headers['user-agent'], body);
        if (r.ok) { res.setHeader('Set-Cookie', sec.cookieFor(r.id, !!tls)); return json(res, 200, { ok: true, username: r.username, role: r.role }); }
        const status = { locked: 429, nopassword: 503, totp: 401, totp_bad: 401, password: 401 }[r.reason] || 401;
        return json(res, status, { ok: false, reason: r.reason, error: { locked: 'Too many failed attempts; this address is locked for 15 minutes', nopassword: 'No account exists yet. On the server run: sudo medialedger --set-password', totp: 'Enter the code from your authenticator app', totp_bad: 'Wrong code', password: 'Wrong username or password' }[r.reason] });
      }
      const session = sec.sessionOf(req.headers.cookie);
      const role = session ? session.role : (sec.guestEnabled() ? 'guest' : null);
      if (!role) return json(res, 401, { ok: false, reason: 'login', error: 'sign in required' });
      if (ch === 'logout') { if (session) { sec.logout(session, ip); res.setHeader('Set-Cookie', sec.clearCookie); } return json(res, 200, { ok: true }); }
      if (ch === 'reauth' && req.method === 'POST') { if (!session) return json(res, 401, { ok: false, reason: 'login', error: 'sign in required' }); const { password } = JSON.parse(await readBody(req) || '{}'); return sec.reauth(session, password, ip) ? json(res, 200, { ok: true }) : json(res, 401, { ok: false, reason: 'reauth_bad', error: 'Wrong password' }); }
      if (ch === 'events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(': connected\n\n'); clients.add(res);
        const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closing */ } }, 25000);
        req.on('close', () => { clearInterval(ka); clients.delete(res); });
        return;
      }
      const fn = handlers.get(ch);
      if (!fn || req.method !== 'POST') return json(res, 404, { ok: false, error: `unknown channel ${ch}` });
      if (!allowed(role, ch)) { if (!session) return json(res, 401, { ok: false, reason: 'login', error: 'sign in required' }); sec.audit('forbidden', ip, ch, session.user); return json(res, 403, { ok: false, reason: 'forbidden', error: 'Your account is not allowed to do that' }); }
      const args = JSON.parse(await readBody(req) || '[]');
      if (!Array.isArray(args)) return json(res, 400, { ok: false, error: 'arguments must be an array' });
      if (isSensitive(ch, args)) { if (sec.needsReauth(session)) return json(res, 401, { ok: false, reason: 'reauth', error: 'Please re-enter your password for this action' }); sec.audit('sensitive_action', ip, ch, session.user); }
      // Adult visibility is per session: apply this caller's choice to the core before every call.
      svc.setShowAdult(!!(session && session.showAdult));
      const ctx = { session, ip, role, req };
      const result = CTX_HANDLERS.has(ch) ? await fn(ctx, ...args) : await fn(...args);
      return json(res, 200, { ok: true, result: result === undefined ? null : result });
    }

    // The public half of the self-signed certificate, for installing on phones and PCs (any signed-in session). Served as .crt so Windows opens the certificate installer on double-click.
    if (url.pathname === '/tls/cert.pem' || url.pathname === '/tls/medialedger-cert.crt') {
      if (!tls || !sec.sessionOf(req.headers.cookie)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="medialedger-cert.crt"', 'cache-control': 'no-store' });
      return fs.createReadStream(path.join(tlsDir, 'cert.pem')).pipe(res);
    }
    // Export downloads (admin session): /exports/<folder>/<file.csv> or /exports/<file.zip> from the export directory.
    if (url.pathname.startsWith('/exports/')) {
      const session = sec.sessionOf(req.headers.cookie);
      if (!session || session.role !== 'admin') { res.writeHead(401); return res.end('sign in as admin'); }
      const base = path.resolve(svc.exportDir());
      const target = path.resolve(base, decodeURIComponent(url.pathname.slice('/exports/'.length)));
      if (!target.startsWith(base + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': target.endsWith('.zip') ? 'application/zip' : 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${path.basename(target)}"`, 'cache-control': 'no-store' });
      return fs.createReadStream(target).pipe(res);
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

server.listen(servePort, bindHost, () => {
  log(`MediaLedger ${pkg.version} web server on ${tls ? 'https' : 'http'}://${bindHost}:${servePort} (data: ${dataDir}, LAN-only: ${sec.state.lanOnly}, guest: ${sec.guestEnabled()})`);
  if (servePort !== port) {
    http.createServer((req, res) => { res.writeHead(301, { location: `https://${String(req.headers.host || os.hostname() + '.local').replace(/:\d+$/, '')}${req.url}` }); res.end(); }).listen(port, bindHost, () => log(`http://:${port} redirects to https`));
  }
  if (!sec.hasPassword()) log('No account yet: run with --set-password to create "admin" before anyone can sign in.');
  svc.scheduler.start(); svc.watcher.apply();
  const s = svc.settings.get();
  if (s.metadata.enabled) setTimeout(() => svc.refreshMetadata({ onlyNew: true }).catch(e => log('metadata: ' + e.message)), 4000);
});

const stop = (sig) => { log(`${sig}: shutting down`); server.close(); for (const c of clients) { try { c.end(); } catch { /* ignore */ } } svc.shutdown(); process.exit(0); };
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
