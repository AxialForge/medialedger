'use strict';
// Discs: barcode normalising, the scan flows, the guards on deleting, and the v18 -> v19 carry-over.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Db } = require('../src/main/db');
const D = require('../src/main/discs');

// ---- normalizeUpc
assert.strictEqual(D.normalizeUpc('032886892905'), '0032886892905', 'a UPC-A becomes an EAN-13 with a leading 0');
assert.strictEqual(D.normalizeUpc('0 32886-89290 5'), '0032886892905', 'spaces and dashes are ignored');
assert.strictEqual(D.normalizeUpc('5051892226264'), '5051892226264', 'a valid EAN-13 is kept');
assert.strictEqual(D.normalizeUpc('032886892906'), null, 'a wrong check digit is refused');
assert.strictEqual(D.normalizeUpc('5051892226265'), null, 'a wrong EAN check digit is refused');
assert.strictEqual(D.normalizeUpc('03288689290'), null, '11 digits');
assert.strictEqual(D.normalizeUpc('00328868929055'), null, '14 digits');
assert.strictEqual(D.normalizeUpc('hello'), null);
assert.strictEqual(D.normalizeUpc(''), null);
assert.strictEqual(D.normalizeUpc(null), null);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-discs-'));
const db = new Db(path.join(dir, 't.db'));
assert.strictEqual(db.userVersion, 21, 'a fresh database is at the newest version');
assert.strictEqual(db.get("SELECT COUNT(*) n FROM sqlite_master WHERE name='discs'").n, 0, 'the v18 table is gone');
for (const t of ['disc_releases', 'disc_titles', 'disc_copies', 'disc_scans']) assert.strictEqual(db.get('SELECT COUNT(*) n FROM sqlite_master WHERE name=?', t).n, 1, t + ' exists');

// ---- scan: invalid, unknown, new copy, duplicate, forced second copy
assert.deepStrictEqual(D.scan(db, '12345'), { ok: false, invalid: true, raw: '12345' });
const unk = D.scan(db, '032886892905');
assert.strictEqual(unk.unknown, true); assert.strictEqual(unk.upc, '0032886892905');
assert.strictEqual(db.get('SELECT COUNT(*) n FROM disc_releases').n, 0, 'an unknown barcode creates nothing');

const rid = D.createRelease(db, { upc: '032886892905', title: 'Example Film', year: 2019, format: '4K UHD' });
assert.throws(() => D.createRelease(db, { upc: '0032886892905', title: 'Again' }), /already exists/, 'one release per barcode, in either spelling');
assert.throws(() => D.createRelease(db, { title: '  ' }), /needs a title/);
assert.throws(() => D.createRelease(db, { title: 'X', upc: '123' }), /not a valid/);
assert.throws(() => D.createRelease(db, { title: 'X', format: 'LaserDisc' }), /Unknown format/);

const first = D.scan(db, '032886892905', { location: 'Shelf A' });
assert.strictEqual(first.ok, true); assert.strictEqual(first.duplicate, false);
assert.strictEqual(D.get(db, rid).copies[0].location, 'Shelf A');
const dup = D.scan(db, '0032886892905');
assert.strictEqual(dup.ok, false); assert.strictEqual(dup.duplicate, true); assert.strictEqual(dup.owned, 1);
assert.strictEqual(D.get(db, rid).copies.length, 1, 'a duplicate scan adds nothing until confirmed');
const second = D.scan(db, '032886892905', { force: true });
assert.strictEqual(second.ok, true); assert.strictEqual(second.duplicate, true);
assert.strictEqual(D.get(db, rid).copies.length, 2);
assert.deepStrictEqual(D.recentScans(db).map(s => s.result), ['ok', 'duplicate', 'ok', 'unknown', 'invalid'], 'every scan is logged, newest first');

// ---- a wished-for release that is scanned becomes owned instead of gaining a second row
const wid = D.createRelease(db, { upc: '5051892226264', title: 'Wanted Film', format: 'Blu-ray' });
D.addCopy(db, wid, { status: 'wishlist' });
const got = D.scan(db, '5051892226264', { location: 'Shelf B' });
assert.strictEqual(got.fromWishlist, true);
assert.deepStrictEqual(D.get(db, wid).copies.map(c => [c.status, c.location]), [['owned', 'Shelf B']]);

// ---- copies: status changes, never removal
const [c1, c2] = D.get(db, rid).copies;
D.setCopyStatus(db, c2.id, 'loaned', { loaned_to: 'Sam' });
assert.strictEqual(D.get(db, rid).copies[1].loaned_to, 'Sam');
D.setCopyStatus(db, c2.id, 'owned');
assert.strictEqual(D.get(db, rid).copies[1].loaned_to, null, 'coming back clears who had it');
D.updateCopy(db, c1.id, { price: '19.99', digital_code: 'unredeemed' });
assert.strictEqual(D.get(db, rid).copies[0].price, 19.99);
assert.strictEqual(D.get(db, rid).copies[0].location, 'Shelf A', 'fields not sent are kept');
assert.throws(() => D.updateCopy(db, c1.id, { status: 'burned' }), /Unknown status/);
assert.throws(() => D.addCopy(db, 9999, {}), /No such release/);

// ---- loans carry a date, codes can be listed, a wish can arrive
{
  const today = new Date().toISOString().slice(0, 10);
  D.setCopyStatus(db, c2.id, 'loaned', { loaned_to: 'Sam' });
  assert.strictEqual(D.get(db, rid).copies[1].loaned_on, today, 'lending stamps the day');
  D.updateCopy(db, c2.id, { notes: 'asked twice' });
  assert.strictEqual(D.get(db, rid).copies[1].loaned_on, today, 'an edit while it is out keeps the day');
  D.updateCopy(db, c2.id, { status: 'loaned', loaned_to: 'Sam', loaned_on: '2026-01-05' });
  assert.deepStrictEqual(D.copies(db, { status: 'loaned' }).map(c => [c.title, c.loaned_to, c.loaned_on]), [['Example Film', 'Sam', '2026-01-05']]);
  D.setCopyStatus(db, c2.id, 'owned');
  assert.strictEqual(D.get(db, rid).copies[1].loaned_on, null, 'coming back clears the day');
  assert.deepStrictEqual(D.copies(db, { code: 'unredeemed' }).map(c => c.id), [c1.id]);
  assert.strictEqual(D.copies(db, { code: 'any' }).length, 1);
  const wish = D.createRelease(db, { title: 'Some Day', format: 'DVD', imax_var: true });
  D.addCopy(db, wish, { status: 'wishlist' });
  assert.ok(D.list(db, { status: 'wishlist' }).rows[0].since, 'the wishlist knows since when');
  D.gotIt(db, wish, 'Shelf C');
  assert.deepStrictEqual(D.get(db, wish).copies.map(c => [c.status, c.location]), [['owned', 'Shelf C']]);
  assert.throws(() => D.gotIt(db, wish), /not on the wishlist/);
  assert.deepStrictEqual(D.imaxTitles(db), []);
  D.linkTitle(db, wish, { library_type: 'movie', title_key: 'someday|2020' });
  assert.deepStrictEqual(D.imaxTitles(db).map(t => t.title_key), ['someday|2020']);
  D.deleteRelease(db, wish, { force: true });
}

// ---- links to library titles, and what the lists read
const l1 = D.linkTitle(db, rid, { library_type: 'movie', title_key: 'examplefilm|2019', title: 'Example Film', year: 2019 });
assert.strictEqual(D.linkTitle(db, rid, { library_type: 'movie', title_key: 'examplefilm|2019' }), l1, 'linking twice is one link');
const dvd = D.createRelease(db, { title: 'Example Film', format: 'DVD' });
D.addCopy(db, dvd, { location: 'Box 3' }); D.linkTitle(db, dvd, { library_type: 'movie', title_key: 'examplefilm|2019' });
assert.deepStrictEqual(D.ownedByTitle(db, 'movie').get('examplefilm|2019'), { format: '4K UHD', location: 'Shelf A' }, 'the best format held wins');
assert.deepStrictEqual(D.forTitle(db, 'movie', 'examplefilm|2019').map(r => r.format), ['4K UHD', '4K UHD', 'DVD']);
assert.strictEqual(D.ownedByTitle(db, 'tv').size, 0);
D.setCopyStatus(db, D.get(db, dvd).copies[0].id, 'sold');
assert.strictEqual(D.forTitle(db, 'movie', 'examplefilm|2019').length, 2, 'a sold copy is no longer held');
assert.throws(() => D.linkTitle(db, rid, { library_type: 'web', title_key: 'x' }), /Unknown library/);

// ---- gaps: the shelf against the library
{
  const lib = [
    { library_type: 'movie', title_key: 'examplefilm|2019', title: 'Example Film', year: 2019, origins: 'download' },   // disc held, only a download
    { library_type: 'movie', title_key: 'heat|1995', title: 'Heat', year: 1995, origins: 'disc' },                       // ripped, no disc recorded
    { library_type: 'movie', title_key: 'dune|2021', title: 'Dune', year: 2021, origins: 'disc,download' },              // both
    { library_type: 'movie', title_key: 'wantedfilm|2001', title: 'Wanted Film', year: 2001, origins: null },            // held but not linked yet
    { library_type: 'tv', title_key: 'Andor', title: 'Andor', year: null, origins: null },
  ];
  const ghost = D.createRelease(db, { title: 'Gone From The Library', format: 'Blu-ray' });
  D.addCopy(db, ghost, {}); D.linkTitle(db, ghost, { library_type: 'movie', title_key: 'gone|2000' });
  const g = D.gaps(db, lib);
  assert.deepStrictEqual(g.discNotRipped.map(t => [t.title, t.disc_format, t.disc_location]), [['Example Film', '4K UHD', 'Shelf A']]);
  assert.deepStrictEqual(g.ripNoDisc.map(t => t.title), ['Heat', 'Dune'], 'a title with a rip counts even when it also has a download');
  assert.deepStrictEqual(g.both.map(t => t.title), ['Dune']);
  assert.deepStrictEqual(g.noDisc.map(t => t.title), ['Heat', 'Dune', 'Wanted Film', 'Andor']);
  assert.deepStrictEqual(g.discOnly.map(r => [r.title, r.reason, r.candidate && r.candidate.title_key]), [['Gone From The Library', 'absent', null], ['Wanted Film', 'unlinked', 'wantedfilm|2001']], 'an unlinked disc names the one title it could be');
  D.deleteRelease(db, ghost, { force: true });
  assert.deepStrictEqual(D.locations(db), [{ location: 'Shelf A', copies: 1 }, { location: 'Shelf B', copies: 1 }]);
}

// ---- lists and counts
assert.deepStrictEqual(D.list(db).rows.map(r => [r.title, r.copies]), [['Example Film', 2], ['Wanted Film', 1]]);
assert.deepStrictEqual(D.list(db, { status: 'sold' }).rows.map(r => r.format), ['DVD']);
assert.strictEqual(D.list(db, { status: 'all' }).rows.length, 3);
assert.strictEqual(D.list(db, { q: '0032886' }).rows.length, 1, 'the filter reads barcodes too');
assert.deepStrictEqual((({ owned, sold, wishlist, releases, unredeemed }) => ({ owned, sold, wishlist, releases, unredeemed }))(D.counts(db)), { owned: 3, sold: 1, wishlist: 0, releases: 3, unredeemed: 1 });

// ---- editing keeps what is not sent, and a barcode cannot be taken twice
D.updateRelease(db, rid, { edition: 'Steelbook' });
assert.strictEqual(D.get(db, rid).release.title, 'Example Film');
assert.strictEqual(D.get(db, rid).release.upc, '0032886892905');
assert.throws(() => D.updateRelease(db, dvd, { upc: '032886892905' }), /Another release/);

// ---- export: one row per copy
const csv = D.exportCsvText(db);
assert.strictEqual(csv.rows, 4);
assert.ok(csv.csv.startsWith('title,year,kind,format,'));
assert.ok(/Example Film,2019,movie,4K UHD,Steelbook,0032886892905/.test(csv.csv));
const { exportAll } = require('../src/main/exportCsv');
const out = exportAll(db, path.join(dir, 'out'), null, { thresholds: {} }, { sets: ['discs'] });
assert.deepStrictEqual(out.files, ['discs.csv']);
assert.ok(fs.readFileSync(path.join(out.latest, 'discs.csv'), 'utf8').includes('Wanted Film'));

// ---- deleting is explicit and guarded
assert.throws(() => D.deleteRelease(db, rid), /still has 2 copies/);
assert.strictEqual(D.deleteRelease(db, rid, { force: true }), true);
assert.strictEqual(D.get(db, rid), null);
assert.strictEqual(db.get('SELECT COUNT(*) n FROM disc_titles WHERE release_id=?', rid).n, 0);
assert.strictEqual(db.get('SELECT COUNT(*) n FROM disc_scans').n, 6, 'the scan log outlives the release');
db.close();

// ---- a database that already ran v18 (the one-row-per-title table) carries its rows into v19
{
  const file = path.join(dir, 'old.db');
  const seed = new Db(file); seed.close();                       // build the full schema, then wind it back to v18
  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE disc_releases; DROP TABLE disc_titles; DROP TABLE disc_copies; DROP TABLE disc_scans;');
  raw.exec("CREATE TABLE discs (library_type TEXT NOT NULL, title_key TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'bluray', note TEXT, updated TEXT NOT NULL, PRIMARY KEY (library_type, title_key))");
  raw.exec("INSERT INTO discs VALUES ('movie', 'alien|1979', 'uhd', 'steelbook', '2026-10-31T00:00:00.000Z'), ('tv', 'Andor', 'bluray', NULL, '2026-10-31T00:00:00.000Z')");
  raw.exec('PRAGMA user_version = 18'); raw.close();
  const up = new Db(file);
  assert.strictEqual(up.userVersion, 21);
  assert.ok(fs.readdirSync(file + '.backups').some(f => f.includes('pre-migration-v18')), 'a backup is taken before migrating');
  assert.deepStrictEqual(up.all('SELECT title, kind, format, notes, lookup_source FROM disc_releases ORDER BY title').map(r => Object.values(r)), [['Andor', 'tv', 'Blu-ray', null, 'manual'], ['alien|1979', 'movie', '4K UHD', 'steelbook', 'manual']]);
  assert.deepStrictEqual(D.ownedByTitle(up, 'movie').get('alien|1979'), { format: '4K UHD', location: null });
  assert.strictEqual(D.forTitle(up, 'tv', 'Andor').length, 1);
  assert.strictEqual(up.get("SELECT COUNT(*) n FROM sqlite_master WHERE name='discs'").n, 0);
  up.close();
}
console.log('discs tests passed');
