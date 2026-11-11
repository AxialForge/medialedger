'use strict';
// Disc lookup: reading a shop's product title, the cache, the rate limit, and that a lookup only ever suggests.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Db } = require('../src/main/db');
const D = require('../src/main/discs');
const { createDiscLookup, parseProduct } = require('../src/main/discLookup');
const tmdb = require('../src/main/tmdb');

// ---- parseProduct: real strings and the traps
const P = (s, c) => parseProduct(s, c);
assert.deepStrictEqual(P('The Spiderwick Chronicles (Blu-ray) (Widescreen)'), { title: 'The Spiderwick Chronicles', year: null, format: 'Blu-ray', edition: null, discs_count: null, kind: 'movie', season: null, isDisc: true });
assert.strictEqual(P('Blade Runner 2049 [Blu-ray]').title, 'Blade Runner 2049', 'a number in the name is not a year');
assert.strictEqual(P('Blade Runner 2049 [Blu-ray]').year, null);
assert.deepStrictEqual((({ title, year, format, discs_count }) => ({ title, year, format, discs_count }))(P('Inception (Blu-ray/DVD, 2010, 3-Disc Set)')), { title: 'Inception', year: 2010, format: 'Blu-ray', discs_count: 3 });
assert.deepStrictEqual((({ title, format, edition }) => ({ title, format, edition }))(P('Dune (4K Ultra HD + Blu-ray + Digital) Steelbook')), { title: 'Dune', format: '4K UHD', edition: 'Steelbook' });
assert.deepStrictEqual((({ title, format, edition }) => ({ title, format, edition }))(P("Alien - Director's Cut DVD")), { title: 'Alien', format: 'DVD', edition: "Director's Cut" });
assert.strictEqual(P('Avatar Blu-ray 3D').format, '3D');
assert.strictEqual(P('Planet Earth HD DVD').format, 'HD DVD');
assert.deepStrictEqual((({ title, kind, season }) => ({ title, kind, season }))(P('Breaking Bad: The Complete Second Season (Blu-ray)')), { title: 'Breaking Bad', kind: 'tv', season: 2 });
assert.deepStrictEqual((({ title, kind, season }) => ({ title, kind, season }))(P('The Wire: Season 3 [DVD]')), { title: 'The Wire', kind: 'tv', season: 3 });
assert.strictEqual(P('Firefly: The Complete Series (Blu-ray)').title, 'Firefly');
assert.strictEqual(P('The Dark Knight Trilogy (Blu-ray)').kind, 'collection');
assert.strictEqual(P('Seven Samurai (The Criterion Collection) [Blu-ray]').kind, 'movie', 'Criterion is an edition, not a box set');
assert.strictEqual(P('Seven Samurai (The Criterion Collection) [Blu-ray]').edition, 'Criterion');
assert.strictEqual(P('Jaws 45th Anniversary Limited Edition (4K Ultra HD + Blu-ray)').edition, 'Limited Edition, 45th Anniversary');
// not discs
assert.strictEqual(P('Southwire 22965858 500 ft. 12 White Stranded CU THHN Wire', 'Hardware > Power & Electrical Supplies').isDisc, false);
assert.strictEqual(P('Samsung 55" Class 4K Smart TV', 'Electronics > Televisions').isDisc, false, '"4K" alone is not a disc');
assert.strictEqual(P('Southwire 22965858 500 ft. 12 White Stranded CU THHN Wire').title, 'Southwire 22965858 500 ft. 12 White Stranded CU THHN Wire', 'nothing recognised: the raw text stays');
assert.strictEqual(P('').title, '');

// ---- lookup, against a pretend service
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-lookup-'));
const db = new Db(path.join(dir, 't.db'));
assert.strictEqual(db.userVersion, 21);
const cfg = { discs: { lookup: true }, tmdb: { key: '' } };
const settings = { get: () => cfg };
let calls = [], next = null, time = Date.parse('2026-11-11T12:00:00Z');
const reply = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => (k.toLowerCase() in headers ? String(headers[k.toLowerCase()]) : null) }, json: async () => body });
const fetchFn = async (url) => { calls.push(url); if (next instanceof Error) throw next; return typeof next === 'function' ? next(url) : next; };
const L = createDiscLookup({ db, settings, fetchFn, clock: () => time });
const found = (title, extra = {}) => reply(200, { code: 'OK', total: 1, items: [{ ean: 'x', title, brand: 'Paramount', category: 'Media > DVDs & Videos', images: ['https://img.example/a.jpg'], ...extra }] }, { 'x-ratelimit-remaining': 93, 'x-ratelimit-limit': 100 });

(async () => {
  assert.deepStrictEqual(await L.lookup('123'), { status: 'invalid' });
  assert.strictEqual(calls.length, 0, 'a bad barcode never reaches the network');

  // a library to match against
  const ins = (type, show, title, year, key) => db.run("INSERT INTO files (root_id, library_type, rel_path, abs_path, file_name, show_name, movie_title, movie_year, group_key, missing, ignored, adult, first_seen, last_seen) VALUES ('r', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'x', 'x')", type, (title || show) + (year || '') + type, (title || show) + (year || '') + type, 'f.mkv', show, title, year, key);
  ins('movie', null, 'The Spiderwick Chronicles', 2008, 'thespiderwickchronicles|2008');
  ins('movie', null, 'Dune', 1984, 'dune|1984'); ins('movie', null, 'Dune', 2021, 'dune|2021');
  ins('tv', 'Breaking Bad', null, null, null);

  next = found('The Spiderwick Chronicles (Blu-ray) (Widescreen)');
  const a = await L.lookup('883929301348');
  assert.strictEqual(a.status, 'found'); assert.strictEqual(a.cached, false); assert.strictEqual(a.isDisc, true);
  assert.deepStrictEqual(a.release, { title: 'The Spiderwick Chronicles', year: null, kind: 'movie', format: 'Blu-ray', edition: null, discs_count: null, studio: 'Paramount' });
  assert.deepStrictEqual(a.link, { library_type: 'movie', title_key: 'thespiderwickchronicles|2008', title: 'The Spiderwick Chronicles', year: 2008 });
  assert.deepStrictEqual(a.quota, { remaining: 93, limit: 100 });
  assert.ok(calls[0].endsWith('upc=0883929301348'));
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM disc_releases').n, 0, 'a lookup creates no release');

  const b = await L.lookup('0883929301348');
  assert.strictEqual(b.cached, true); assert.strictEqual(calls.length, 1, 'the second ask is answered from the cache');

  // two films called Dune: no year on the disc means no guess
  next = found('Dune (4K Ultra HD + Blu-ray)');
  assert.strictEqual((await L.lookup('032886892905')).link, null, 'an ambiguous title is not linked');
  next = found('Dune (Blu-ray, 2021)');
  assert.strictEqual((await L.lookup('5051892226264')).link.title_key, 'dune|2021', 'the year settles it');

  // not a disc: said so, nothing prefilled as a film
  next = found('Southwire 500 ft. 12 White Stranded CU THHN Wire', { category: 'Hardware > Electrical Wires & Cable', brand: 'Southwire' });
  const w = await L.lookup('012345678905');
  assert.strictEqual(w.isDisc, false); assert.strictEqual(w.link, null); assert.strictEqual(w.release.studio, null);

  // unknown to the service: remembered, so it is not asked again for a month
  const before = calls.length;
  next = reply(200, { code: 'OK', total: 0, items: [] });
  assert.strictEqual((await L.lookup('036000291452')).status, 'none');
  assert.strictEqual((await L.lookup('036000291452')).cached, true);
  assert.strictEqual(calls.length, before + 1);
  time += 31 * 86400000;
  await L.lookup('036000291452');
  assert.strictEqual(calls.length, before + 2, 'asked again once the month is up');

  // too fast: rest until their reset time without touching the network, then carry on
  const resetAt = Math.floor(time / 1000) + 40;
  next = reply(429, { code: 'TOO_FAST' }, { 'x-ratelimit-remaining': 0, 'x-ratelimit-limit': 6, 'x-ratelimit-reset': resetAt });
  const lim = await L.lookup('042100005264');
  assert.strictEqual(lim.status, 'limited'); assert.strictEqual(lim.retryAt, new Date(resetAt * 1000).toISOString());
  const n = calls.length;
  assert.strictEqual((await L.lookup('042100005264')).status, 'limited');
  assert.strictEqual(calls.length, n, 'no request while resting');
  assert.strictEqual((await L.lookup('883929301348')).status, 'found', 'the cache still answers while resting');
  assert.ok(L.state().pausedUntil);
  time += 41000; next = found('Heat (DVD)');
  assert.strictEqual((await L.lookup('042100005264')).status, 'found');

  // the network failing is an answer, not an exception
  next = new Error('getaddrinfo ENOTFOUND');
  assert.deepStrictEqual(await L.lookup('078000082166'), { status: 'error', upc: '0078000082166', message: 'Could not reach the lookup service' });
  next = reply(500, {});
  assert.strictEqual((await L.lookup('078000082166')).status, 'error');

  // switched off: the cache and your own releases still answer, the network is not asked
  cfg.discs.lookup = false; const m = calls.length;
  assert.strictEqual((await L.lookup('078000082166')).status, 'off');
  assert.strictEqual((await L.lookup('883929301348')).status, 'found');
  assert.strictEqual(calls.length, m);
  cfg.discs.lookup = true;

  // a release you already described wins over everything
  D.createRelease(db, { upc: '883929301348', title: 'My own name for it', format: 'DVD' });
  const loc = await L.lookup('883929301348');
  assert.strictEqual(loc.status, 'local'); assert.strictEqual(loc.release.title, 'My own name for it', 'what you typed is never replaced by a lookup');

  // TMDB tidies the name and adds the year, only when it plainly means the same film
  cfg.tmdb.key = 'k'.repeat(32);
  next = (url) => url.includes('themoviedb') ? reply(200, { results: [{ id: 9, title: 'Heat', release_date: '1995-12-15', poster_path: '/h.jpg' }] }) : found('Heat (DVD)');
  const h = await L.lookup('042100005264');
  assert.deepStrictEqual([h.release.title, h.release.year, h.tmdb], ['Heat', 1995, { id: 9, kind: 'movie' }]);
  assert.ok(calls[calls.length - 1].includes('api_key=' + 'k'.repeat(32)) && calls[calls.length - 1].includes('query=Heat'));
  next = (url) => url.includes('themoviedb') ? reply(200, { results: [{ id: 1, title: 'Something Else Entirely', release_date: '2001-01-01' }] }) : found('Heat (DVD)');
  assert.strictEqual((await L.lookup('042100005264')).release.year, null, 'a different film from TMDB is ignored');
  next = () => reply(401, {});
  assert.strictEqual((await L.lookup('042100005264')).status, 'found', 'a bad TMDB key does not break the lookup');
  assert.deepStrictEqual(await tmdb.test('bad', async () => reply(401, {})), { ok: false, message: 'TMDB did not accept that key' });
  // the long v4 token goes in a header, not the address
  let seen = null; await tmdb.searchMovie('t'.repeat(180), 'Heat', 1995, async (url, o) => { seen = { url, auth: o.headers.Authorization }; return reply(200, { results: [] }); });
  assert.ok(!seen.url.includes('api_key') && seen.auth === 'Bearer ' + 't'.repeat(180) && seen.url.includes('year=1995'));
  assert.strictEqual(tmdb.posterUrl('/h.jpg', 300), 'https://image.tmdb.org/t/p/w342/h.jpg');

  db.close();
  console.log('disc lookup tests passed');
})().catch(e => { console.error(e); process.exit(1); });
