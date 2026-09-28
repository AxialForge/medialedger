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
// State lives in <data>/portal.json (mode 0600): { enabled, port, bind, publicUrl, homeUrl, showRatings, invites, devices }.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { clientIp, forwardedProto } = require('./clientip');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n) => crypto.randomBytes(n).toString('base64url');
const DEVICE_DAYS = 180;
const PERMS = ['browse', 'tonight', 'request'];

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

const normTitle = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();

function createPortal({ svc, dataDir, log, audit, version }) {
  const file = path.join(dataDir, 'portal.json');
  const staticDir = path.join(__dirname, '..', 'portal');
  let state = { enabled: false, port: 8090, bind: '127.0.0.1', publicUrl: '', homeUrl: '', showRatings: true, invites: {}, devices: {} };
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
    save(); audit('portal_options', ip, `enabled=${state.enabled} port=${state.port}`, by);
    if (was.enabled !== state.enabled || was.port !== state.port || was.bind !== state.bind) restart();
    return status();
  }
  const status = () => ({ available: true, enabled: state.enabled, port: state.port, bind: state.bind, publicUrl: state.publicUrl, homeUrl: state.homeUrl, showRatings: state.showRatings, listening, error: lastError, lastVisit, invites: Object.entries(state.invites).map(publicInvite).sort((a, b) => a.name.localeCompare(b.name)) });

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

      // ---- the data API: GET /p/<name>, POST /p/requests
      if (url.pathname.startsWith('/p/')) {
        const v = visitor(req);
        if (!v) return json(res, 401, { ok: false, reason: 'invite', error: 'Open your invite link on this device' });
        if (!within('inv:' + v.id, 240, 60000)) { res.setHeader('retry-after', '60'); return json(res, 429, { ok: false, error: 'Too many requests; wait a minute' }); }
        touch(v, ip);
        const name = url.pathname.slice(3), q = url.searchParams;
        const need = (perm) => { if (!v.perms[perm]) { const e = new Error('Your invite does not include this'); e.code = 403; throw e; } };
        if (req.method === 'GET') {
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
      let rel = url.pathname === '/' ? '/index.html' : url.pathname;
      rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
      const abs = path.join(staticDir, rel);
      if (!abs.startsWith(staticDir + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(abs).pipe(res);
    } catch (e) {
      if (e.code === 403) return json(res, 403, { ok: false, error: e.message });
      log(`portal ${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Something went wrong' }); else res.end();
    }
  }

  // ---- listener ---------------------------------------------------------------------------------------
  function stop() { if (server) { try { server.close(); } catch { /* ignore */ } server = null; } listening = null; }
  function start() {
    stop(); lastError = null;
    if (!state.enabled) return;
    const s = http.createServer(handle);
    s.headersTimeout = 30000; s.requestTimeout = 60000; s.keepAliveTimeout = 65000;
    s.on('error', (e) => { lastError = e.code === 'EADDRINUSE' ? `port ${state.port} is already in use` : e.message; listening = null; log('portal: ' + lastError); });
    s.listen(state.port, state.bind, () => { listening = `${state.bind}:${state.port}`; log(`family portal on http://${listening} (${Object.values(state.invites).filter(live).length} active invites)`); });
    server = s;
  }
  const restart = () => setTimeout(start, 200);

  return { start, stop, status, setOptions, createInvite, renewInvite, revokeInvite, deleteInvite, handle, file };
}

module.exports = { createPortal, normTitle, projectSeries, projectMovie, projectEpisode, projectVersion, projectTonight, projectRequest, limiter };
