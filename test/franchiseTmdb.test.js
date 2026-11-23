'use strict';
// Franchises and TMDB: a linked film series adds the films the built-in list does not know, corrects years, confirms
// timeline dates, never doubles a title the library or the built-in list already has, and is only fetched on request.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Db } = require('../src/main/db');
const { createCollections } = require('../src/main/collections');
const { createFranchises } = require('../src/main/franchiseSync');
const tmdb = require('../src/main/tmdb');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-frt-'));
const db = new Db(path.join(dir, 't.db'));
const file = (o) => db.run(`INSERT INTO files (root_id, rel_path, abs_path, file_name, library_type, show_name, season, episode, movie_title, movie_year, group_key, size, duration_s, resolution, plex_rating_key, plex_show_key, plex_view_count, plex_released, missing, ignored, adult, parse_ok, probe_ok) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,1,1)`,
  o.root || 'r', o.rel, 'X:\\' + o.rel, path.basename(o.rel), o.type, o.show || null, o.season || null, o.episode || null, o.title || null, o.year || null, o.group || null, o.size || 1e9, o.dur || 3600, o.res || '1080p', o.rk || null, o.sk || null, o.plays || 0, o.released || null);
// a TMDB that answers from this table, and counts what it was asked
const SERIES = {
  10: { id: 10, name: 'Star Wars Collection', parts: [{ id: 1, title: 'Star Wars: Episode I - The Phantom Menace', release_date: '1999-05-19' }, { id: 2, title: 'Star Wars: Episode II - Attack of the Clones', release_date: '2002-05-15' }, { id: 3, title: 'Star Wars: A Film Nobody Listed', release_date: '2031-01-01' }, { id: 4, title: 'Star Wars: Unscheduled', release_date: '' }] },
  20: { id: 20, name: 'Kill Bill Collection', parts: [{ id: 5, title: 'Kill Bill: Vol. 2', release_date: '2004-04-16' }, { id: 6, title: 'Kill Bill: Vol. 1', release_date: '2003-10-10' }] },
  30: { id: 30, name: 'Dune Collection', parts: [{ id: 7, title: 'Dune', release_date: '2021-10-22' }, { id: 8, title: 'Dune: Part Two', release_date: '2024-03-01' }, { id: 9, title: 'Dune: Part Three', release_date: '2027-12-17' }] },
};
let asked = [], status = 200;
const fetchFn = async (url) => {
  asked.push(url.replace(/^https:\/\/api\.themoviedb\.org\/3/, '').replace(/[?&]api_key=[^&]*/, ''));
  const reply = (body) => ({ status, ok: status === 200, headers: { get: () => null }, json: async () => body });
  const m = /\/collection\/(\d+)/.exec(url); if (m) return reply(SERIES[m[1]] || {});
  return reply({ results: Object.values(SERIES).map(s => ({ id: s.id, name: s.name, overview: 'x'.repeat(400) })) });
};
let theKey = 'k'.repeat(32);
const C = createCollections(db), FR = createFranchises(db, C, { key: () => theKey, fetchFn });
const col = (k) => { const c = db.get('SELECT id FROM collections WHERE plex_key=?', 'fr:' + k); return c ? C.get(c.id) : null; };
const missing = (k) => col(k).items.filter(i => !i.present).map(i => `${i.title} (${i.year || '?'})`);

file({ rel: 'Movies/Dune (2021)/Dune.mkv', type: 'movie', title: 'Dune', year: 2021, group: 'dune|2021' });
file({ rel: 'Movies/Kill Bill Vol 1 (2003)/a.mkv', type: 'movie', title: 'Kill Bill Vol 1', year: 2003, group: 'kill bill vol 1|2003' });
file({ rel: 'TV/Andor/S01E01.mkv', type: 'tv', show: 'Andor', season: 1, episode: 1 });

(async () => {
  FR.sync({ year: 2026 });
  const KB = 'Kill Bill / Tarantino';
  assert.deepStrictEqual(missing(KB), [], 'a franchise with no built-in list has nothing to call missing');
  assert.ok(missing('Dune').includes('Dune: Part Three (2026)'));
  assert.deepStrictEqual(asked, [], 'a sync never touches the network');

  // ---- search and link
  const hits = await FR.tmdbSearch('kill bill');
  assert.strictEqual(hits.length, 3); assert.strictEqual(hits[0].overview.length, 220, 'long text is cut');
  assert.deepStrictEqual(await FR.tmdbLink(col(KB).id, 20), { franchise: KB, name: 'Kill Bill Collection', films: 2 });
  await FR.tmdbLink(col(KB).id, 20);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM franchise_tmdb').n, 1, 'linking the same series twice keeps one row');
  await FR.tmdbLink(col('Dune').id, 30); await FR.tmdbLink(col('Star Wars').id, 10);
  await assert.rejects(FR.tmdbLink(C.save({ name: 'Mine' }), 20), /not a franchise/);
  const before = asked.length; FR.sync({ year: 2026 }); assert.strictEqual(asked.length, before);

  // ---- what the link changes
  assert.deepStrictEqual(missing(KB), ['Kill Bill: Vol. 2 (2004)'], 'the film you lack appears; the one you have is recognised despite the punctuation');
  const dune = missing('Dune');
  assert.ok(dune.includes('Dune: Part Three (2027)') && !dune.includes('Dune: Part Three (2026)'), 'the year follows TMDB, on the same row');
  assert.ok(dune.includes('Dune (1984) (1984)') && dune.includes('Dune: Part Two (2024)') && dune.length === 4, 'no title is listed twice: ' + dune.join(', '));
  assert.ok(!dune.some(t => /^Dune \(2021\)/.test(t)), 'the film you own is not missing');
  const sw = missing('Star Wars');
  assert.ok(sw.includes('Star Wars: A Film Nobody Listed (2031)') && sw.includes('Star Wars: Unscheduled (?)'), 'films the built-in list lacks are added, dated or not');
  assert.ok(!sw.some(t => /Episode I /.test(t)) && sw.includes('The Phantom Menace (1999)'), 'a film the built-in list knows keeps the built-in name');

  // ---- the page: links, and timeline dates TMDB confirms or corrects
  const v = FR.view(col('Star Wars').id);
  assert.deepStrictEqual(v.tmdb.map(l => [l.name, l.films]), [['Star Wars Collection', 4]]);
  const pm = v.timeline.find(e => e.title === 'The Phantom Menace'), ac = v.timeline.find(e => e.title === 'Attack of the Clones'), rs = v.timeline.find(e => e.title === 'Revenge of the Sith');
  assert.deepStrictEqual([pm.checked, pm.rel, pm.was], [true, '1999-05-19', null], 'a date TMDB agrees with is marked checked');
  assert.deepStrictEqual([ac.checked, ac.rel, ac.was], [true, '2002-05-15', '2002-05-16'], 'a date TMDB disagrees with is replaced, and the old one kept for the tooltip');
  assert.strictEqual(rs.checked, false, 'a film TMDB did not return stays unchecked');
  assert.ok(v.timeline.filter(e => e.media === 'TV').every(e => !e.checked), 'television is never marked checked');

  // ---- hiding one TMDB film, and unlinking
  FR.block({ kind: 'missing', title: 'Star Wars: Unscheduled', media: 'Movie', franchise: 'Star Wars' }); FR.sync({ year: 2026 });
  assert.ok(!missing('Star Wars').includes('Star Wars: Unscheduled (?)'));
  FR.tmdbUnlink(db.get('SELECT id FROM franchise_tmdb WHERE tmdb_id=20').id); FR.sync({ year: 2026 });
  assert.deepStrictEqual(missing(KB), [], 'unlinking takes back what the link added');

  // ---- refresh: only what is stale, stop at the first failure, nothing without a key
  asked = []; assert.deepStrictEqual(await FR.tmdbRefresh(), { due: 0, done: 0 }, 'fresh rows are left alone');
  db.run("UPDATE franchise_tmdb SET fetched='2026-01-01T00:00:00.000Z' WHERE tmdb_id=30");
  assert.deepStrictEqual(await FR.tmdbRefresh(), { due: 1, done: 1 }); assert.deepStrictEqual(asked, ['/collection/30']);
  status = 429; const r = await FR.tmdbRefresh({ maxAgeDays: 0 });
  assert.deepStrictEqual([r.due, r.done, r.error], [2, 0, 'TMDB asked to slow down'], 'a refusal stops the run and keeps what was stored');
  assert.strictEqual(FR.view(col('Dune').id).tmdb[0].films, 3);
  status = 401; await assert.rejects(FR.tmdbSearch('x'), /did not accept/); status = 200;
  theKey = ''; asked = []; assert.deepStrictEqual(await FR.tmdbRefresh({ maxAgeDays: 0 }), { skipped: 'no key' }); assert.deepStrictEqual(asked, []);
  await assert.rejects(FR.tmdbSearch('x'), /No TMDB key/);
  FR.sync({ year: 2026 }); assert.ok(missing('Dune').includes('Dune: Part Three (2027)'), 'what was fetched still counts with the key gone');

  // ---- the two calls themselves
  assert.deepStrictEqual((await tmdb.collection('k'.repeat(32), 20, fetchFn)).parts.map(p => p.title), ['Kill Bill: Vol. 1', 'Kill Bill: Vol. 2'], 'films come back in release order');
  assert.strictEqual((await tmdb.collection('k'.repeat(32), 10, fetchFn)).parts.pop().date, null, 'no date yet sorts last');

  db.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('franchise TMDB tests passed');
})().catch(e => { console.error(e); process.exit(1); });
