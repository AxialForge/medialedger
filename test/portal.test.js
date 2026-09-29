'use strict';
// The family portal from the outside: what gets in, what comes back, and what does not exist there.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { createPortal, normTitle } = require('../src/server/portal');
const { clientIp, forwardedProto } = require('../src/server/clientip');

// ---- who is calling
{
  const r = (sock, h) => ({ socket: { remoteAddress: sock }, headers: h || {} });
  assert.strictEqual(clientIp(r('::ffff:192.168.1.50')), '192.168.1.50');
  assert.strictEqual(clientIp(r('192.168.1.50', { 'x-forwarded-for': '8.8.8.8' })), '192.168.1.50', 'a LAN client cannot forge the header');
  assert.strictEqual(clientIp(r('127.0.0.1', { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' })), '203.0.113.7', 'the last entry is the one our proxy wrote');
  assert.strictEqual(clientIp(r('::1', { 'x-forwarded-for': '203.0.113.7:51234' })), '203.0.113.7');
  assert.strictEqual(clientIp(r('127.0.0.1', { 'x-forwarded-for': 'junk' })), '127.0.0.1');
  assert.strictEqual(forwardedProto(r('127.0.0.1', { 'x-forwarded-proto': 'https' })), 'https');
  assert.strictEqual(forwardedProto(r('10.0.0.2', { 'x-forwarded-proto': 'https' })), null);
  assert.strictEqual(normTitle('The Lord of the Rings: The Two Towers'), normTitle('lord of the rings - two towers'));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-portal-'));
const port = 20000 + Math.floor(Math.random() * 20000);
fs.writeFileSync(path.join(dir, 'portal.json'), JSON.stringify({ enabled: true, port, bind: '127.0.0.1', publicUrl: 'https://example.ts.net', showRatings: true }));

// A fake core that returns rows shaped like the real ones, secrets included.
const adultCalls = []; const added = []; const audits = [];
const SECRET = '\\\\192.168.1.204\\Apocrypha_Media_Pool\\Movies\\Alien (1979)\\Alien.mkv';
const handlers = new Map([
  ['data:movies', () => [{ group_key: 'alien|1979', title: 'Alien', year: 1979, files: 1, bytes: 9e9, seconds: 7020, resolutions: '1080p,4K', codecs: 'hevc', hdr: 'HDR10', genres: ['Horror'], tags: ['classics'], my_rating: 5, online_rating: 8.5, plex_user: 9, plex_linked: 1, watched_count: 3, abs_path: SECRET }]],
  ['data:series', (type) => [{ show_name: type === 'tv' ? 'Andor' : 'Frieren', episodes: 12, seasons: 1, resolutions: '1080p', audio_type: 'sub', genres: ['Drama'], tags: [], expected: 12, missing_count: 2, meta_status: 'Ended', online_rating: 8.4, my_rating: 4, seconds: 12 * 1500, plex_show_key: '55', watched: 7, last_seen: 'x' }]],
  ['data:episodes', () => ({ tags: [], genres: ['Drama'], files: [{ id: 7, root_id: 'tv', rel_path: 'Andor\\S01E02.mkv', abs_path: SECRET, file_name: 'S01E02.mkv', season: 1, episode: 2, episode_title: 'Two', resolution: '1080p', duration_s: 1500, audio_langs: 'eng', sub_langs: 'eng', plex_rating_key: '901', plex_view_count: 4, missing: 0 }, { id: 8, abs_path: SECRET, file_name: 'gone.mkv', season: 1, episode: 9, missing: 1 }], missing: { show_name: 'Andor', missing_count: 2, missing: [{ season: 1, missing: [1, 3], expected: 12 }] } })],
  ['data:movieFiles', (key) => key === 'alien|1979' ? [{ id: 3, abs_path: SECRET, rel_path: 'x', movie_title: 'Alien', movie_year: 1979, resolution: '4K', video_codec: 'hevc', hdr: 'HDR10', duration_s: 7020, size: 9e9, audio_langs: 'eng', sub_langs: 'eng,spa' }] : []],
  ['data:tonight', () => [{ kind: 'movie', type: 'movie', key: 'alien|1979', title: 'Alien', year: 1979, minutes: 117, unwatched: 0, genres: ['Horror'], tags: [], my_rating: 5, online_rating: 8.5, plex_user: 9, resolution: '4K', last_added: '2026-01-02T03:04:05Z' }]],
  ['requests:list', () => [...added, { id: 99, title: 'Someone else', kind: 'movie', status: 'pending', requested_by: 'family: Other', created: 'x', updated: 'x' }]],
  ['requests:add', (r) => { const row = { id: added.length + 1, status: 'pending', admin_note: null, created: new Date().toISOString(), updated: new Date().toISOString(), ...r }; added.push(row); return row; }],
]);
const svc = { handlers, setShowAdult: (v) => adultCalls.push(v) };
const notes = [];
const portal = createPortal({ svc, dataDir: dir, log: () => {}, audit: (...a) => audits.push(a), version: 'test', notify: async (...a) => { notes.push(a); } });

const call = (method, p, { cookie, body, headers } = {}) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...(headers || {}) } }, res => {
    let s = ''; res.on('data', d => { s += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(s); } catch { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text: s, json: j }); });
  });
  req.on('error', reject); if (data) req.write(data); req.end();
});

(async () => {
  portal.start();
  for (let i = 0; i < 50 && !portal.status().listening; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(portal.status().listening, 'portal listens');

  // nothing without an invite; the admin surface does not exist here
  assert.strictEqual((await call('GET', '/p/library?type=movie')).status, 401);
  for (const p of ['/api/login', '/api/settings:get', '/api/security:status', '/exports/x.csv', '/app.js', '/webbridge.js', '/request.html'])
    assert.strictEqual((await call(p.startsWith('/api/') ? 'POST' : 'GET', p, { body: p.startsWith('/api/') ? [] : null })).status, p.startsWith('/api/') ? 405 : 404, `${p} must not exist on the portal`);
  for (const p of ['/../server/security.js', '/..%2f..%2fserver%2fportal.js', '/%2e%2e/renderer/app.js']) assert.ok([400, 404].includes((await call('GET', p)).status), `${p} must not escape the portal folder`);
  assert.strictEqual((await call('GET', '/portal.js')).status, 200);
  assert.ok(/noindex/.test((await call('GET', '/')).headers['x-robots-tag']));

  // the address checker: /health is public and says nothing private; a check must reach THIS portal
  const hz = await call('GET', '/health'); assert.strictEqual(hz.status, 200); assert.deepStrictEqual(Object.keys(hz.json).sort(), ['app', 'instance', 'ok', 'version']);
  portal.setOptions({ homeUrl: `http://127.0.0.1:${port}`, publicUrl: 'https://example.ts.net', checkMinutes: 0 }, 'admin', 'x');
  let c = await portal.checkNow();
  assert.strictEqual(c.home.ok, true, 'the home address reaches this portal'); assert.ok(c.home.ms >= 0);
  assert.strictEqual(portal.job().overdue, false, 'one failure is not an outage');
  const other = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ ok: true, app: 'medialedger-portal', instance: 'someone-else' })); }).listen(port + 1, '127.0.0.1');
  portal.setOptions({ homeUrl: `http://127.0.0.1:${port + 1}` }, 'admin', 'x');
  c = await portal.checkNow(); assert.strictEqual(c.home.ok, false); assert.ok(/different/.test(c.home.error));
  c = await portal.checkNow(); assert.ok(c.home.fails >= 2, 'failures in a row are counted');
  assert.ok(notes.some(n => n[0] === 'portalDown' && /not reachable/.test(n[1])), 'two failures in a row notify');
  assert.strictEqual(portal.job().overdue, true); assert.ok(/not reachable/.test(portal.job().overdueWhy));
  other.close();
  portal.setOptions({ homeUrl: `http://127.0.0.1:${port}` }, 'admin', 'x');
  c = await portal.checkNow(); assert.strictEqual(c.home.ok, true);
  assert.ok(notes.some(n => /reachable again/.test(n[1])), 'recovery notifies once');
  assert.throws(() => portal.setOptions({ checkMinutes: -5 }, 'admin', 'x'), /interval/);
  portal.setOptions({ homeUrl: '', publicUrl: '' }, 'admin', 'x');
  assert.throws(() => portal.createInvite({ name: 'Nobody' }, 'admin', 'x'), /address first/, 'no address, no invite');
  portal.setOptions({ publicUrl: 'https://example.ts.net' }, 'admin', 'x');

  // invites
  const mom = portal.createInvite({ name: 'Mom', days: 30 }, 'admin', '127.0.0.1');
  assert.ok(mom.links.public.startsWith('https://example.ts.net/i/'));
  assert.ok(!JSON.stringify(portal.status()).includes(mom.links.path.split('.')[1]), 'the secret is never listed');
  assert.ok(!fs.readFileSync(path.join(dir, 'portal.json'), 'utf8').includes(mom.links.path.split('.')[1]), 'only a hash is stored');
  assert.throws(() => portal.createInvite({ name: 'mom' }, 'admin', 'x'), /already has/);
  assert.strictEqual((await call('GET', mom.links.path.slice(0, -3) + 'abc')).status, 403, 'a wrong secret is refused');
  const open = await call('GET', mom.links.path, { headers: { 'x-forwarded-proto': 'https' } });
  assert.strictEqual(open.status, 302); assert.strictEqual(open.headers.location, '/');
  const set = String(open.headers['set-cookie']); assert.ok(/HttpOnly/.test(set) && /Secure/.test(set) && /SameSite=Lax/.test(set));
  const cookie = set.split(';')[0];

  // what comes back
  const me = await call('GET', '/p/me', { cookie }); assert.strictEqual(me.json.result.name, 'Mom');
  const movies = await call('GET', '/p/library?type=movie', { cookie });
  assert.deepStrictEqual(Object.keys(movies.json.result[0]).sort(), ['best', 'editions', 'genres', 'hdr', 'key', 'minutes', 'my_rating', 'online_rating', 'tags', 'title', 'type', 'versions', 'year']);
  assert.strictEqual(movies.json.result[0].best, '4K');
  const series = await call('GET', '/p/library?type=anime', { cookie }); assert.strictEqual(series.json.result[0].missing, 2);
  const ep = await call('GET', '/p/title?type=tv&key=Andor', { cookie });
  assert.deepStrictEqual(ep.json.result.missing, [{ season: 1, episodes: [1, 3] }]);
  assert.deepStrictEqual(ep.json.result.episodes.map(x => x.episode), [2], 'files that vanished from the share are not listed');
  const film = await call('GET', '/p/title?type=movie&key=' + encodeURIComponent('alien|1979'), { cookie });
  const tonight = await call('GET', '/p/tonight', { cookie });
  for (const r of [movies, series, ep, film, tonight]) {
    assert.strictEqual(r.status, 200);
    for (const bad of ['192.168', 'Apocrypha', 'abs_path', 'rel_path', 'root_id', 'file_name', 'plex_', '.mkv', 'watched_count', '"id"']) assert.ok(!r.text.includes(bad), `reply must not contain ${bad}: ${r.text.slice(0, 200)}`);
  }
  assert.strictEqual((await call('GET', '/p/title?type=movie&key=nope', { cookie })).status, 404);
  assert.ok(adultCalls.length > 0 && adultCalls.every(v => v === false), 'the adult switch is forced off for every call');

  // requests: already in the library, then a real one, attributed; other people's requests are not shown
  const dup = await call('POST', '/p/requests', { cookie, body: { title: 'alien', kind: 'movie' } });
  assert.strictEqual(dup.json.result.exists[0].title, 'Alien'); assert.strictEqual(added.length, 0);
  const ok = await call('POST', '/p/requests', { cookie, body: { title: 'Dune Part Two', kind: 'movie', year: 2024, requested_by: 'admin', status: 'added' } });
  assert.strictEqual(ok.json.result.added.title, 'Dune Part Two');
  assert.strictEqual(added[0].requested_by, 'family: Mom', 'the name comes from the invite, not the body'); assert.strictEqual(added[0].status, 'pending');
  assert.strictEqual((await call('POST', '/p/requests', { cookie, body: { title: 'x' } })).status, 400);
  assert.strictEqual((await call('POST', '/p/requests', { cookie, body: { title: 'Cross site' }, headers: { origin: 'https://evil.example' } })).status, 403);
  const mine = await call('GET', '/p/requests', { cookie }); assert.deepStrictEqual(mine.json.result.map(r => r.title), ['Dune Part Two']);
  let limited = 0; for (let i = 0; i < 8; i++) { const r = await call('POST', '/p/requests', { cookie, body: { title: 'Flood ' + i, force: true } }); if (r.status === 429) limited++; }
  assert.ok(limited >= 3 && added.length === 6, `request filing is rate limited (${limited} refused, ${added.length} stored)`);

  // permissions
  const kid = portal.createInvite({ name: 'Kid', perms: { request: false } }, 'admin', 'x');
  const kc = String((await call('GET', kid.links.path)).headers['set-cookie']).split(';')[0];
  assert.ok(!/Secure/.test(String((await call('GET', portal.renewInvite(kid.invite.id, 'admin', 'x').links.path)).headers['set-cookie'])), 'plain http gets a plain cookie');
  assert.strictEqual((await call('GET', '/p/me', { cookie: kc })).status, 401, 'a new link retires the old devices');
  const kid2 = portal.renewInvite(kid.invite.id, 'admin', 'x'); const kc2 = String((await call('GET', kid2.links.path)).headers['set-cookie']).split(';')[0];
  assert.strictEqual((await call('GET', '/p/library?type=tv', { cookie: kc2 })).status, 200);
  assert.strictEqual((await call('POST', '/p/requests', { cookie: kc2, body: { title: 'Not allowed' } })).status, 403);

  // revoke, expiry, switch off
  portal.revokeInvite(mom.invite.id, 'admin', 'x');
  assert.strictEqual((await call('GET', '/p/me', { cookie })).status, 401);
  assert.strictEqual((await call('GET', mom.links.path)).status, 403);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'portal.json'), 'utf8')); state.invites[kid.invite.id].expires = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(path.join(dir, 'portal.json'), JSON.stringify(state));
  const again = createPortal({ svc, dataDir: dir, log: () => {}, audit: () => {}, version: 'test' });
  assert.strictEqual(again.status().invites.find(i => i.name === 'Kid').active, false, 'an expired invite is not active');
  let tooMany = 0; for (let i = 0; i < 14; i++) if ((await call('GET', '/i/abcdef.' + 'x'.repeat(30))).status === 429) tooMany++;
  assert.ok(tooMany >= 2, 'guessing links is rate limited');
  assert.ok(audits.some(a => a[0] === 'portal_invite_refused') && audits.some(a => a[0] === 'portal_request'));
  portal.setOptions({ enabled: false }, 'admin', 'x');
  await new Promise(r => setTimeout(r, 500));
  await assert.rejects(call('GET', '/p/me', { cookie }), /ECONNREFUSED|socket hang up|ECONNRESET/);

  portal.stop(); again.stop(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('portal tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
