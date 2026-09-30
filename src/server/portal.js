'use strict';
// The family portal: a second listener that serves a small read-only site plus media requests to people
// holding an invite. It is a separate front door on purpose:
//
//   * its own short list of routes (below). Sign-in, settings, scans, renames and logs do not exist here;
//   * every reply is built by projection: only named fields are copied, so file paths, NAS names, ids,
//     Plex keys, watch history and notes cannot leak even when the core grows new fields;
//   * adult titles are never included (the core's adult switch is forced off for every call);
//   * it serves src/portal/, never the admin renderer.
//
// Invites: the link carries `<id>.<secret>`; only sha256(secret) is stored. Opening the link sets a
// device cookie (only its hash is stored) and redirects to `/`. Revoking an invite kills its devices.
//
// Admin from outside (off by default): /admin on the same listener signs in with a web *admin* account (password,
// lockout and 2FA come from security.js `verify`) and gets a second short allow-list under /a/: invites, media
// requests, a status card, the jobs table and two portal options. Admin sessions are the portal's own (cookie
// `mla`, twelve hours, an hour idle) so a portal sign-in never becomes a web-app session; the switch itself can
// only be flipped from the desktop or the web app, never from the portal.
//
// State lives in <data>/portal.json (mode 0600): { enabled, port, bind, publicUrl, homeUrl, showRatings, admin, invites, devices, adminSessions }.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clientIp, forwardedProto } = require('./clientip');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n) => crypto.randomBytes(n).toString('base64url');
const DEVICE_DAYS = 180;
const PERMS = ['browse', 'tonight', 'request'];
const ADMIN_HOURS = 12, ADMIN_IDLE_MINUTES = 60;
// Jobs an admin may start from outside: each only reads the share or talks to a service the server already uses.
const REMOTE_JOBS = ['scan', 'plex', 'metadata', 'posters', 'snapshot', 'summary', 'backup', 'portal'];

// ---- rate limits: fixed windows kept in memory ----------------------------------------------------
function limiter() {
  const hits = new Map();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.until < now) hits.delete(k); }, 60000); if (sweep.unref) sweep.unref();
  /** true when the call is within `max` per `ms` for this key */
  return (key, max, ms) => { const now = Date.now(); let h = hits.get(key); if (!h || h.until < now) { h = { n: 0, until: now + ms }; hits.set(key, h); } h.n++; return h.n <= max; };
}

// ---- projections: the only fields that ever leave the portal ----------------------------------------
const arr = (v) => Array.isArray(v) ? v.map(String).slice(0, 40) : [];
const csv = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const num = (v) => (v == null || isNaN(v) ? null : Number(v));
const RES_ORDER = ['4K', '1440p', '1080p', '720p', '576p', '480p', 'SD'];
const bestRes = (v) => { const have = csv(v); return RES_ORDER.find(r => have.includes(r)) || have[0] || null; };

const projectSeries = (type, showRatings) => (s) => ({
  type, key: String(s.show_name), title: String(s.show_name), episodes: num(s.episodes), seasons: num(s.seasons),
  best: bestRes(s.resolutions), audio_type: s.audio_type || null, genres: arr(s.genres), tags: arr(s.tags),
  expected: num(s.expected) || null, missing: s.expected ? num(s.missing_count) : null, status: s.meta_status || null,
  online_rating: num(s.online_rating), my_rating: showRatings ? num(s.my_rating) : null, minutes: s.episodes && s.seconds ? Math.round(s.seconds / s.episodes / 60) : null,
});
const projectMovie = (showRatings) => (m) => ({
  type: 'movie', key: String(m.group_key), title: String(m.title || ''), year: num(m.year), versions: num(m.files),
  best: bestRes(m.resolutions), hdr: m.hdr && m.hdr !== 'SDR' ? String(m.hdr) : null, editions: csv(m.editions),
  genres: arr(m.genres && m.genres.length ? m.genres : m.plex_genres), tags: arr(m.tags), minutes: m.seconds && m.files ? Math.round(m.seconds / m.files / 60) : null,
  online_rating: num(m.online_rating), my_rating: showRatings ? num(m.my_rating) : null,
});
const projectEpisode = (f) => ({ season: num(f.season), episode: num(f.episode), episode_end: num(f.episode_end), title: f.episode_title ? String(f.episode_title) : null, resolution: f.resolution || null, minutes: f.duration_s ? Math.round(f.duration_s / 60) : null, audio: csv(f.audio_langs), subs: csv(f.sub_langs) });
const projectVersion = (f) => ({ resolution: f.resolution || null, codec: f.video_codec || null, hdr: f.hdr && f.hdr !== 'SDR' ? String(f.hdr) : null, edition: f.edition_tag ? String(f.edition_tag) : null, minutes: f.duration_s ? Math.round(f.duration_s / 60) : null, audio: csv(f.audio_langs), subs: csv(f.sub_langs), gb: f.size ? Math.round(f.size / 1073741824 * 10) / 10 : null });
const projectTonight = (showRatings) => (t) => ({ kind: t.kind === 'movie' ? 'movie' : 'series', type: String(t.type), key: String(t.key), title: String(t.title), year: num(t.year), episodes: num(t.episodes), minutes: num(t.minutes), unwatched: num(t.unwatched), complete: t.complete == null ? null : !!t.complete, genres: arr(t.genres), tags: arr(t.tags), audio_type: t.audio_type || null, best: t.resolution || null, online_rating: num(t.online_rating), my_rating: showRatings ? num(t.my_rating) : null, added: t.last_added ? String(t.last_added).slice(0, 10) : null });
const projectRequest = (r) => ({ id: r.id, title: String(r.title), year: num(r.year), kind: String(r.kind), note: r.note ? String(r.note) : null, status: String(r.status), reply: r.admin_note ? String(r.admin_note) : null, created: r.created, updated: r.updated });
// Job notes can name a file ("Backup copied to \\nas\Pool\x.db"): only the file's own name leaves the portal.
// A path starts with a drive, a UNC prefix or a root slash (never the // of a URL) and runs to the end of its
// clause, so folder names with spaces survive intact and get dropped as a whole.
const noPaths = (s) => String(s).replace(/(^|\s)((?:[A-Za-z]:[\\/]|\\\\|(?<!:)\/)[^\n·;]*?)(?=\s*(?:$|·|;|\n))/g, (m, pre, p) => pre + (p.trim().split(/[\\/]/).filter(Boolean).pop() || ''));
const projectAdminRequest = (r) => ({ ...projectRequest(r), by: r.requested_by ? String(r.requested_by) : null });

const normTitle = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();

function createPortal({ svc, dataDir, log, audit, version, notify, sec }) {
  const file = path.join(dataDir, 'portal.json');
  const staticDir = path.join(__dirname, '..', 'portal');
  let state = { enabled: false, port: 8090, bind: '127.0.0.1', publicUrl: '', homeUrl: '', showRatings: true, checkMinutes: 15, admin: false, invites: {}, devices: {}, adminSessions: {} };
  const instance = rand(9); // /health echoes it, so a check knows it reached THIS portal and not something else on that name
  try { state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  const save = () => { fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 }); try { fs.chmodSync(file, 0o600); } catch { /* windows */ } };
  const within = limiter();
  let server = null, listening = null, lastError = null, lastVisit = null;

  // ---- invites (admin side) -----------------------------------------------------------------------
  const live = (inv) => inv && !inv.revoked && (!inv.expires || new Date(inv.expires) > new Date());
  const publicInvite = ([id, inv]) => ({ id, name: inv.name, created: inv.created, expires: inv.expires || null, revoked: !!inv.revoked, active: live(inv), perms: inv.perms, lastSeen: inv.lastSeen || null, requests: inv.requests || 0, devices: Object.values(state.devices).filter(d => d.invite === id).length });
  const linksFor = (id, secret) => { const tail = `/i/${id}.${secret}`; return { public: state.publicUrl ? state.publicUrl.replace(/\/+$/, '') + tail : null, home: state.homeUrl ? state.homeUrl.replace(/\/+$/, '') + tail : null, path: tail }; };
  function createInvite({ name, days, perms }, by, ip) {
    const n = String(name || '').trim().slice(0, 40); if (!n) throw new Error('Give the invite a name');
    if (!state.publicUrl && !state.homeUrl) throw new Error('Set a public or home address first (under Addresses), then create the invite: the link is built from it');
    if (Object.values(state.invites).some(i => live(i) && i.name.toLowerCase() === n.toLowerCase())) throw new Error(`${n} already has an active invite; use New link on it`);
    const id = rand(6), secret = rand(24);
    const p = Object.fromEntries(PERMS.map(k => [k, !perms || perms[k] !== false]));
    state.invites[id] = { name: n, hash: sha(secret), created: new Date().toISOString(), expires: Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null, perms: p, revoked: false, requests: 0 };
    save(); audit('portal_invite_created', ip, `${n}${days ? `, ${days} days` : ''}`, by);
    return { invite: publicInvite([id, state.invites[id]]), links: linksFor(id, secret) };
  }
  function renewInvite(id, by, ip) {
    const inv = state.invites[id]; if (!inv) throw new Error('No such invite');
    const secret = rand(24); inv.hash = sha(secret); inv.revoked = false;
    for (const [k, d] of Object.entries(state.devices)) if (d.invite === id) delete state.devices[k];
    save(); audit('portal_invite_renewed', ip, inv.name, by);
    return { invite: publicInvite([id, inv]), links: linksFor(id, secret) };
  }
  function revokeInvite(id, by, ip) {
    const inv = state.invites[id]; if (!inv) throw new Error('No such invite');
    inv.revoked = true; for (const [k, d] of Object.entries(state.devices)) if (d.invite === id) delete state.devices[k];
    save(); audit('portal_invite_revoked', ip, inv.name, by); return true;
  }
  function deleteInvite(id, by, ip) { const inv = state.invites[id]; if (!inv) return false; revokeInvite(id, by, ip); delete state.invites[id]; save(); return true; }
  function setOptions(o, by, ip) {
    const was = { enabled: state.enabled, port: state.port, bind: state.bind };
    if (typeof o.enabled === 'boolean') state.enabled = o.enabled;
    if (o.port != null) { const p = Number(o.port); if (!(p >= 1024 && p <= 65535)) throw new Error('Port must be between 1024 and 65535'); state.port = p; }
    if (o.bind != null) { if (!['127.0.0.1', '0.0.0.0'].includes(o.bind)) throw new Error('Bind must be 127.0.0.1 or 0.0.0.0'); state.bind = o.bind; }
    for (const k of ['publicUrl', 'homeUrl']) if (o[k] != null) { const v = String(o[k]).trim(); if (v && !/^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(v)) throw new Error(`${k === 'publicUrl' ? 'Public' : 'Home'} address must look like https://name.example`); state[k] = v.replace(/\/+$/, ''); }
    if (typeof o.showRatings === 'boolean') state.showRatings = o.showRatings;
    if (typeof o.admin === 'boolean') { if (o.admin && !sec) throw new Error('Admin sign-in needs the web server'); if (state.admin && !o.admin) state.adminSessions = {}; state.admin = o.admin; }
    if (o.checkMinutes != null) { const m = Number(o.checkMinutes); if (!(m === 0 || (m >= 1 && m <= 1440))) throw new Error('Check interval must be 0 (off) or 1 to 1440 minutes'); state.checkMinutes = m; }
    save(); audit('portal_options', ip, `enabled=${state.enabled} port=${state.port}`, by);
    if (was.enabled !== state.enabled || was.port !== state.port || was.bind !== state.bind) restart();
    armChecks(); setTimeout(() => checkNow().catch(() => {}), 1500);
    return status();
  }
  const status = () => ({ available: true, enabled: state.enabled, port: state.port, bind: state.bind, publicUrl: state.publicUrl, homeUrl: state.homeUrl, showRatings: state.showRatings, checkMinutes: state.checkMinutes, admin: !!state.admin, adminSessions: Object.values(state.adminSessions).filter(adminLive).length, totp: !!(sec && sec.totpEnabled && sec.totpEnabled()), checks: { public: checks.public, home: checks.home, next: nextCheck }, listening, error: lastError, lastVisit, invites: Object.entries(state.invites).map(publicInvite).sort((a, b) => a.name.localeCompare(b.name)) });

  // ---- visitors -------------------------------------------------------------------------------------
  const cookieOf = (req) => { const m = /(?:^|;\s*)mlp=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || ''); return m ? m[1] : null; };
  function visitor(req) {
    const c = cookieOf(req); if (!c) return null;
    const d = state.devices[sha(c)]; if (!d || new Date(d.expires) < new Date()) return null;
    const inv = state.invites[d.invite]; if (!live(inv)) return null;
    return { id: d.invite, name: inv.name, perms: inv.perms, device: sha(c) };
  }
  let dirty = false;
  const touch = (v, ip) => { const now = new Date().toISOString(); const inv = state.invites[v.id]; if (!inv.lastSeen || now.slice(0, 16) !== inv.lastSeen.slice(0, 16)) { inv.lastSeen = now; if (state.devices[v.device]) state.devices[v.device].lastSeen = now; dirty = true; } lastVisit = { at: now, name: v.name, ip }; };
  const flush = setInterval(() => { if (dirty) { dirty = false; try { save(); } catch (e) { log('portal: could not save ' + e.message); } } }, 60000); if (flush.unref) flush.unref();

  // ---- the admin from outside ------------------------------------------------------------------------
  const adminLive = (s) => !!s && new Date(s.expires) > new Date() && Date.now() - new Date(s.lastSeen).getTime() < ADMIN_IDLE_MINUTES * 60000;
  const adminCookieOf = (req) => { const m = /(?:^|;\s*)mla=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || ''); return m ? m[1] : null; };
  function admin(req) {
    if (!state.admin || !sec) return null;
    const c = adminCookieOf(req); if (!c) return null;
    const k = sha(c), s = state.adminSessions[k];
    if (!adminLive(s)) { if (s) { delete state.adminSessions[k]; dirty = true; } return null; }
    if (Date.now() - new Date(s.lastSeen).getTime() > 60000) { s.lastSeen = new Date().toISOString(); dirty = true; }
    return { user: s.user, key: k };
  }
  const adminCookie = (token, secure, clear) => `mla=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : ADMIN_HOURS * 3600}${secure ? '; Secure' : ''}`;
  function adminLogin(req, ip, body) {
    for (const k of Object.keys(state.adminSessions)) if (!adminLive(state.adminSessions[k])) delete state.adminSessions[k];
    const v = sec.verify(ip, { username: body.username, password: body.password, code: body.code });
    if (!v.ok) return v;
    if (v.role !== 'admin') { audit('portal_admin_refused', ip, `${v.username} is not an admin`); return { ok: false, reason: 'role' }; }
    const token = rand(32);
    state.adminSessions[sha(token)] = { user: v.username, created: new Date().toISOString(), lastSeen: new Date().toISOString(), expires: new Date(Date.now() + ADMIN_HOURS * 3600000).toISOString(), ip, agent: String(req.headers['user-agent'] || '').slice(0, 120) };
    save(); audit('portal_admin_login', ip, v.twoFactor ? 'with 2FA' : 'password only', v.username);
    return { ok: true, token, user: v.username };
  }
  const allJobs = async () => [...(await svc.handlers.get('jobs:list')()), job()];

  // ---- replies --------------------------------------------------------------------------------------
  const HEADERS = { 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'x-robots-tag': 'noindex, nofollow' };
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const page = (res, code, title, text) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><body style="font:16px system-ui;background:#0f1115;color:#e6e8ec;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#9aa3b2">${text}</p></div>`); };
  const readBody = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 16 * 1024) { reject(new Error('body too large')); req.destroy(); } }); req.on('end', () => resolve(s)); req.on('error', reject); });
  const core = (name, ...args) => { svc.setShowAdult(false); return svc.handlers.get(name)(...args); };
  const who = (v) => `family: ${v.name}`;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = clientIp(req);
    for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
    try {
      if (!within('ip:' + ip, 600, 60000)) { res.setHeader('retry-after', '60'); return json(res, 429, { ok: false, error: 'Too many requests; wait a minute' }); }
      // Nothing private: the checker (and anyone) may ask whether this is the portal and whether it is up.
      if (url.pathname === '/health') return json(res, 200, { ok: true, app: 'medialedger-portal', version, instance });
      if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }

      // ---- opening an invite link
      const m = /^\/i\/([A-Za-z0-9_-]{4,16})\.([A-Za-z0-9_-]{20,64})$/.exec(url.pathname);
      if (m) {
        if (!within('open:' + ip, 10, 15 * 60000)) { audit('portal_invite_blocked', ip, 'too many attempts'); return page(res, 429, 'Too many attempts', 'Wait fifteen minutes and try the link again.'); }
        const inv = state.invites[m[1]];
        const good = inv && inv.hash.length === sha(m[2]).length && crypto.timingSafeEqual(Buffer.from(inv.hash), Buffer.from(sha(m[2])));
        if (!good || !live(inv)) { audit('portal_invite_refused', ip, good ? `${inv.name}: ${inv.revoked ? 'revoked' : 'expired'}` : 'unknown link'); return page(res, 403, 'This link no longer works', 'Ask for a new invite link.'); }
        const token = rand(32);
        state.devices[sha(token)] = { invite: m[1], created: new Date().toISOString(), expires: new Date(Date.now() + DEVICE_DAYS * 86400000).toISOString(), agent: String(req.headers['user-agent'] || '').slice(0, 120) };
        save(); audit('portal_device_added', ip, inv.name);
        const secure = forwardedProto(req) === 'https';
        res.writeHead(302, { location: '/', 'set-cookie': `mlp=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_DAYS * 86400}${secure ? '; Secure' : ''}`, 'cache-control': 'no-store' });
        return res.end();
      }

      // ---- the admin from outside: POST /a/login, then GET or POST /a/<name>
      if (url.pathname.startsWith('/a/')) {
        if (!state.admin || !sec) return json(res, 404, { ok: false, error: 'not found' });
        const name = url.pathname.slice(3);
        const post = req.method === 'POST';
        if (post) {
          const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) { audit('portal_cross_origin', ip, origin); return json(res, 403, { ok: false, error: 'cross-origin request refused' }); }
          if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'JSON body required' });
        } else if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        const body = post ? JSON.parse(await readBody(req) || '{}') : {};
        const secure = forwardedProto(req) === 'https';
        if (name === 'login' && post) {
          if (!within('alogin:' + ip, 12, 15 * 60000)) { audit('portal_admin_blocked', ip, 'too many attempts'); res.setHeader('retry-after', '900'); return json(res, 429, { ok: false, reason: 'locked', error: 'Too many attempts; wait fifteen minutes' }); }
          const r = adminLogin(req, ip, body);
          if (!r.ok) return json(res, ({ locked: 429, nopassword: 503 })[r.reason] || 401, { ok: false, reason: r.reason, error: ({ locked: 'Too many failed attempts; this address is locked for 15 minutes', nopassword: 'No account exists on the server yet', totp: 'Enter the code from your authenticator app', totp_bad: 'Wrong code', role: 'Only an admin account can sign in here', password: 'Wrong username or password' })[r.reason] || 'Sign-in refused' });
          res.setHeader('set-cookie', adminCookie(r.token, secure));
          return json(res, 200, { ok: true, result: { user: r.user } });
        }
        const a = admin(req);
        if (!a) return json(res, 401, { ok: false, reason: 'login', error: 'Sign in with an admin account' });
        if (!within('adm:' + a.key, 240, 60000)) { res.setHeader('retry-after', '60'); return json(res, 429, { ok: false, error: 'Too many requests; wait a minute' }); }
        if (name === 'logout' && post) { delete state.adminSessions[a.key]; save(); audit('portal_admin_logout', ip, '', a.user); res.setHeader('set-cookie', adminCookie('', secure, true)); return json(res, 200, { ok: true }); }
        if (name === 'me' && !post) return json(res, 200, { ok: true, result: { user: a.user, twoFactor: !!(sec.totpEnabled && sec.totpEnabled()), version, showRatings: !!state.showRatings, checkMinutes: state.checkMinutes, publicUrl: state.publicUrl, homeUrl: state.homeUrl, sessions: Object.values(state.adminSessions).filter(adminLive).length } });
        if (name === 'invites' && !post) return json(res, 200, { ok: true, result: status().invites });
        if (name === 'invites' && post) return json(res, 200, { ok: true, result: createInvite({ name: body.name, days: body.days, perms: body.perms }, a.user, ip) });
        if (name === 'invites/renew' && post) return json(res, 200, { ok: true, result: renewInvite(String(body.id || ''), a.user, ip) });
        if (name === 'invites/revoke' && post) return json(res, 200, { ok: true, result: revokeInvite(String(body.id || ''), a.user, ip) });
        if (name === 'invites/delete' && post) return json(res, 200, { ok: true, result: deleteInvite(String(body.id || ''), a.user, ip) });
        if (name === 'requests' && !post) return json(res, 200, { ok: true, result: (await core('requests:list')).map(projectAdminRequest) });
        if (name === 'requests/update' && post) {
          const patch = {}; if (body.status != null) { if (!['pending', 'approved', 'added', 'rejected'].includes(body.status)) return json(res, 400, { ok: false, error: 'Bad status' }); patch.status = body.status; } if (body.reply !== undefined) patch.admin_note = body.reply == null ? '' : String(body.reply).slice(0, 1000);
          const row = await core('requests:update', Number(body.id), patch); audit('portal_admin_request', ip, `#${body.id}: ${patch.status || 'reply'}`, a.user);
          return json(res, 200, { ok: true, result: row ? projectAdminRequest(row) : null });
        }
        if (name === 'requests/delete' && post) { await core('requests:delete', Number(body.id)); audit('portal_admin_request', ip, `#${body.id}: deleted`, a.user); return json(res, 200, { ok: true }); }
        if (name === 'status' && !post) {
          const st = await core('data:status');
          return json(res, 200, { ok: true, result: { files: num(st.files), bytes: num(st.bytes), free_bytes: num(st.free_bytes), months_left: num(st.months_left), pending_requests: num(st.pending_requests), missing_episodes: num(st.missing_episodes), airing_this_week: num(st.airing_this_week), scanning: !!st.scanning, last_scan: st.last_scan || null, checks: { public: checks.public, home: checks.home }, jobs: (await allJobs()).map(j => ({ id: String(j.id), label: String(j.label), enabled: !!j.enabled, when: j.when || null, last: j.last || null, lastNote: j.lastNote ? noPaths(j.lastNote) : null, next: j.next || null, running: !!j.running, overdue: !!j.overdue, overdueWhy: j.overdueWhy ? noPaths(j.overdueWhy) : null, remote: REMOTE_JOBS.includes(j.id) })) } });
        }
        if (name === 'jobs/run' && post) {
          const id = String(body.id || ''); if (!REMOTE_JOBS.includes(id)) return json(res, 400, { ok: false, error: 'That job cannot be started from outside' });
          audit('portal_admin_job', ip, id, a.user);
          if (id === 'portal') { const r = await checkNow(); const c = [r.public, r.home].filter(Boolean); return json(res, 200, { ok: true, result: { done: true, message: c.length ? c.map(x => `${x.url}: ${x.ok ? 'working' : x.error}`).join(' · ') : 'No address is set' } }); }
          const r = await svc.handlers.get('jobs:run')(id); return json(res, 200, { ok: true, result: { started: !!r.started, done: !!r.done, message: String(r.message || '') } });
        }
        if (name === 'options' && post) { const o = {}; if (typeof body.showRatings === 'boolean') o.showRatings = body.showRatings; if (body.checkMinutes != null) o.checkMinutes = body.checkMinutes; setOptions(o, a.user, ip); return json(res, 200, { ok: true, result: { showRatings: state.showRatings, checkMinutes: state.checkMinutes } }); }
        return json(res, 404, { ok: false, error: 'not found' });
      }

      // ---- the data API: GET /p/<name>, POST /p/requests
      if (url.pathname.startsWith('/p/')) {
        const v = visitor(req);
        if (!v) return json(res, 401, { ok: false, reason: 'invite', error: 'Open your invite link on this device' });
        if (!within('inv:' + v.id, 240, 60000)) { res.setHeader('retry-after', '60'); return json(res, 429, { ok: false, error: 'Too many requests; wait a minute' }); }
        touch(v, ip);
        const name = url.pathname.slice(3), q = url.searchParams;
        const need = (perm) => { if (!v.perms[perm]) { const e = new Error('Your invite does not include this'); e.code = 403; throw e; } };
        if (req.method === 'GET') {
          if (name === 'posters') { need('browse'); return json(res, 200, { ok: true, result: svc.posters ? svc.posters.index() : {} }); }
          if (name === 'poster') {
            need('browse');
            const type = q.get('type'), f = ['movie', 'tv', 'anime'].includes(type) && svc.posters ? svc.posters.fileOf(type, String(q.get('key') || '').slice(0, 300)) : null;
            if (!f) { res.writeHead(404, { 'cache-control': 'no-store' }); return res.end('no poster'); }
            if (req.headers['if-none-match'] === `"${f.stamp}"`) { res.writeHead(304); return res.end(); }
            res.writeHead(200, { 'content-type': f.mime, 'cache-control': 'private, max-age=604800', etag: `"${f.stamp}"` });
            return fs.createReadStream(f.abs).pipe(res);
          }
          if (name === 'me') return json(res, 200, { ok: true, result: { name: v.name, perms: v.perms, showRatings: !!state.showRatings, app: 'MediaLedger', version } });
          if (name === 'library') {
            need('browse');
            const type = q.get('type');
            if (type === 'movie') return json(res, 200, { ok: true, result: (await core('data:movies')).map(projectMovie(state.showRatings)) });
            if (type === 'tv' || type === 'anime') return json(res, 200, { ok: true, result: (await core('data:series', type)).map(projectSeries(type, state.showRatings)) });
            return json(res, 400, { ok: false, error: 'type must be tv, anime or movie' });
          }
          if (name === 'title') {
            need('browse');
            const type = q.get('type'), key = String(q.get('key') || '').slice(0, 300);
            if (!key) return json(res, 400, { ok: false, error: 'key required' });
            if (type === 'movie') { const files = await core('data:movieFiles', key); if (!files || !files.length) return json(res, 404, { ok: false, error: 'Not in the library' }); return json(res, 200, { ok: true, result: { type, key, title: String(files[0].movie_title || ''), year: num(files[0].movie_year), versions: files.map(projectVersion) } }); }
            if (type === 'tv' || type === 'anime') {
              const e = await core('data:episodes', type, key); const files = ((e && e.files) || []).filter(f => !f.missing);
              if (!files.length) return json(res, 404, { ok: false, error: 'Not in the library' });
              // The core returns the series' missing summary: { missing: [{ season, missing: [episodes] }], ... } with the collecting policy applied.
              const gaps = e.missing && Array.isArray(e.missing.missing) ? e.missing.missing : [];
              const missing = gaps.map(x => ({ season: num(x.season), episodes: Array.isArray(x.missing) ? x.missing.map(Number).slice(0, 2000) : [] }));
              return json(res, 200, { ok: true, result: { type, key, title: key, genres: arr(e.genres), tags: arr(e.tags), episodes: files.map(projectEpisode).sort((a, b) => (a.season - b.season) || (a.episode - b.episode)), missing } });
            }
            return json(res, 400, { ok: false, error: 'type must be tv, anime or movie' });
          }
          if (name === 'tonight') { need('tonight'); return json(res, 200, { ok: true, result: (await core('data:tonight')).map(projectTonight(state.showRatings)) }); }
          if (name === 'requests') { need('request'); return json(res, 200, { ok: true, result: (await core('requests:list')).filter(r => r.requested_by === who(v)).map(projectRequest) }); }
          return json(res, 404, { ok: false, error: 'not found' });
        }
        if (req.method === 'POST' && name === 'requests') {
          need('request');
          const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) { audit('portal_cross_origin', ip, origin); return json(res, 403, { ok: false, error: 'cross-origin request refused' }); }
          if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, error: 'JSON body required' });
          const b = JSON.parse(await readBody(req) || '{}');
          const title = String(b.title || '').trim().slice(0, 120); if (title.length < 2) return json(res, 400, { ok: false, error: 'Type the title' });
          const kind = ['movie', 'tv', 'anime', 'other'].includes(b.kind) ? b.kind : 'other';
          const year = Number(b.year) >= 1900 && Number(b.year) <= 2100 ? Number(b.year) : null;
          // "You already have this": an exact normalised match stops the request unless they insist.
          if (!b.force) {
            const want = normTitle(title);
            const have = [...(await core('data:movies')).map(x => ({ type: 'movie', key: x.group_key, title: x.title, year: x.year })), ...(await core('data:series', 'tv')).map(x => ({ type: 'tv', key: x.show_name, title: x.show_name })), ...(await core('data:series', 'anime')).map(x => ({ type: 'anime', key: x.show_name, title: x.show_name }))]
              .filter(x => { const t = normTitle(x.title); return (t === want || (want.length >= 6 && t.includes(want)) || (t.length >= 6 && want.includes(t))) && (!year || !x.year || x.year === year); }).sort((a, b) => Number(normTitle(b.title) === want) - Number(normTitle(a.title) === want)).slice(0, 5);
            if (have.length) return json(res, 200, { ok: true, result: { exists: have.map(x => ({ type: x.type, key: String(x.key), title: String(x.title), year: num(x.year) })) } });
          }
          if (!within('req:' + v.id, 6, 3600000) || !within('reqday:' + v.id, 25, 86400000)) { audit('portal_request_limited', ip, v.name); res.setHeader('retry-after', '3600'); return json(res, 429, { ok: false, error: 'That is a lot of requests; try again in an hour' }); }
          const row = await core('requests:add', { title, year, kind, note: b.note ? String(b.note).slice(0, 400) : null, requested_by: who(v) });
          state.invites[v.id].requests = (state.invites[v.id].requests || 0) + 1; dirty = true;
          audit('portal_request', ip, `${v.name}: ${title}`);
          return json(res, 200, { ok: true, result: { added: projectRequest(row) } });
        }
        if (req.method === 'POST' && name === 'leave') { delete state.devices[v.device]; save(); res.setHeader('set-cookie', 'mlp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); return json(res, 200, { ok: true }); }
        return json(res, 405, { ok: false, error: 'method not allowed' });
      }

      // ---- the site itself: static files from src/portal only
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      if (url.pathname === '/qr.js') { res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' }); return req.method === 'HEAD' ? res.end() : fs.createReadStream(path.join(__dirname, '..', 'renderer', 'qr.js')).pipe(res); }
      let rel = url.pathname === '/' ? '/index.html' : url.pathname === '/admin' || url.pathname === '/admin/' ? '/admin.html' : url.pathname;
      rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
      const abs = path.join(staticDir, rel);
      if (!abs.startsWith(staticDir + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(abs).pipe(res);
    } catch (e) {
      if (e.code === 403) return json(res, 403, { ok: false, error: e.message });
      if (url.pathname.startsWith('/a/') && admin(req) && !res.headersSent && !/SQLITE|ENOENT|EACCES/.test(String(e.code || '')) && !(e instanceof SyntaxError)) return json(res, 400, { ok: false, error: e.message }); // validation messages are written for people
      log(`portal ${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Something went wrong' }); else res.end();
    }
  }

  // ---- is the address working? The server opens its own public and home address the way a visitor would ----
  // A check passes when the name resolves, the connection and the certificate are good, and /health answers
  // with this portal's instance id. The home address may use Caddy's own certificate authority, which Node
  // does not know, so there the certificate is not verified (the result says so).
  const checks = { public: null, home: null };
  let checkTimer = null, nextCheck = null;
  function probe(base, { verify }) {
    return new Promise((resolve) => {
      const started = Date.now();
      let u; try { u = new URL('/health', base); } catch { return resolve({ ok: false, error: 'not a valid address' }); }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, { method: 'GET', timeout: 12000, headers: { accept: 'application/json', 'user-agent': 'MediaLedger-portal-check' }, ...(u.protocol === 'https:' ? { rejectUnauthorized: !!verify } : {}) }, (res) => {
        let body = ''; res.setEncoding('utf8'); res.on('data', d => { if (body.length < 4096) body += d; });
        res.on('end', () => {
          const ms = Date.now() - started; let j = null; try { j = JSON.parse(body); } catch { /* not ours */ }
          const cert = res.socket && typeof res.socket.getPeerCertificate === 'function' ? res.socket.getPeerCertificate() : null;
          const certDays = cert && cert.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000) : null;
          if (res.statusCode !== 200 || !j || j.app !== 'medialedger-portal') return resolve({ ok: false, ms, status: res.statusCode, error: res.statusCode === 200 ? 'something else answers on this address' : `the address answered ${res.statusCode}`, certDays });
          if (j.instance !== instance) return resolve({ ok: false, ms, status: 200, error: 'a different MediaLedger portal answers on this address', certDays });
          resolve({ ok: true, ms, status: 200, certDays, verified: u.protocol === 'https:' ? !!verify : null });
        });
      });
      req.on('timeout', () => req.destroy(new Error('no answer within 12 seconds')));
      req.on('error', (e) => resolve({ ok: false, ms: Date.now() - started, error: ({ ENOTFOUND: 'the name does not resolve (DNS)', EAI_AGAIN: 'the name does not resolve (DNS)', ECONNREFUSED: 'connection refused', ECONNRESET: 'connection reset', ETIMEDOUT: 'timed out', CERT_HAS_EXPIRED: 'the certificate has expired', DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed certificate', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the certificate is not trusted', ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate is for another name' })[e.code] || e.message }));
      req.end();
    });
  }
  async function checkOne(which, base, opts) {
    if (!base) { checks[which] = null; return null; }
    const prev = checks[which]; const r = await probe(base, opts); const now = new Date().toISOString();
    const next = { ...r, url: base, at: now, since: prev && prev.ok === r.ok ? prev.since : now, fails: r.ok ? 0 : ((prev && prev.fails) || 0) + 1 };
    checks[which] = next;
    // One slow answer is not an outage: tell the owner on the second failure in a row, and once when it comes back.
    if (!r.ok && next.fails === 2) { log(`portal check: ${which} address ${base} is not working: ${r.error}`); audit('portal_check_failed', '-', `${base}: ${r.error}`); if (notify) notify('portalDown', 'Family portal is not reachable', `${base}\n${r.error}\nChecked from the server itself. Open Family portal in MediaLedger for details.`, { address: base, error: r.error }).catch(() => {}); }
    if (r.ok && prev && !prev.ok && prev.fails >= 2) { log(`portal check: ${which} address ${base} works again after ${Math.round((Date.now() - new Date(prev.since)) / 60000)} min`); if (notify) notify('portalDown', 'Family portal is reachable again', `${base}\nAnswered in ${r.ms} ms.`, { address: base, recovered: true }).catch(() => {}); }
    if (r.ok && r.certDays != null && r.certDays < 10 && (!prev || prev.certDays == null || prev.certDays >= 10)) log(`portal check: the certificate on ${base} runs out in ${r.certDays} days`);
    return next;
  }
  // One check at a time: a second caller waits for the one in flight instead of counting the same outage twice.
  let inFlight = null;
  function checkNow() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (!state.enabled) { checks.public = checks.home = null; return { public: null, home: null }; }
      await Promise.all([checkOne('public', state.publicUrl, { verify: true }), checkOne('home', state.homeUrl, { verify: false })]);
      return { public: checks.public, home: checks.home };
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  function armChecks() {
    if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } nextCheck = null;
    const m = Number(state.checkMinutes) || 0; if (!m || !state.enabled) return;
    const tick = () => { nextCheck = new Date(Date.now() + m * 60000).toISOString(); checkNow().catch(e => log('portal check failed: ' + e.message)); };
    checkTimer = setInterval(tick, m * 60000); if (checkTimer.unref) checkTimer.unref();
    nextCheck = new Date(Date.now() + m * 60000).toISOString();
  }
  /** The row the Schedules table shows. */
  const job = () => { const c = [checks.public, checks.home].filter(Boolean); const bad = c.filter(x => !x.ok && x.fails >= 2); const last = c.map(x => x.at).sort().pop() || null;
    return { id: 'portal', label: 'Family portal address check', enabled: !!(state.enabled && state.checkMinutes && (state.publicUrl || state.homeUrl)), when: state.enabled ? (state.checkMinutes ? `every ${state.checkMinutes} min` : 'off') : 'portal is off', last, lastNote: c.length ? c.map(x => `${x.url.replace(/^https?:\/\//, '')}: ${x.ok ? 'working, ' + x.ms + ' ms' : x.error}`).join(' · ') : null, next: nextCheck, running: false, overdue: bad.length > 0, overdueWhy: bad.length ? bad.map(x => `${x.url} is not reachable (${x.error})`).join('; ') : null }; };

  // ---- listener ---------------------------------------------------------------------------------------
  function stop() { if (checkTimer) { clearInterval(checkTimer); checkTimer = null; } if (server) { try { server.close(); } catch { /* ignore */ } server = null; } listening = null; }
  function start() {
    stop(); lastError = null;
    if (!state.enabled) return;
    const s = http.createServer(handle);
    s.headersTimeout = 30000; s.requestTimeout = 60000; s.keepAliveTimeout = 65000;
    s.on('error', (e) => { lastError = e.code === 'EADDRINUSE' ? `port ${state.port} is already in use` : e.message; listening = null; log('portal: ' + lastError); });
    s.listen(state.port, state.bind, () => { armChecks(); setTimeout(() => checkNow().catch(() => {}), 5000); listening = `${state.bind}:${state.port}`; log(`family portal on http://${listening} (${Object.values(state.invites).filter(live).length} active invites)`); });
    server = s;
  }
  const restart = () => setTimeout(start, 200);

  return { checkNow, job, start, stop, status, setOptions, createInvite, renewInvite, revokeInvite, deleteInvite, handle, file };
}

module.exports = { createPortal, normTitle, noPaths, projectSeries, projectMovie, projectEpisode, projectVersion, projectTonight, projectRequest, limiter };
