'use strict';
// Pure Plex helpers: path mapping, mapping derivation, matching, flattening. No network.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { mapPath, deriveMapping, matchItems, flattenVideo, applyWebhookEvent, historyKeyOf } = require('../src/main/plex');
const watched = require('../src/main/watched');
const { Db } = require('../src/main/db');

const plexFile = "/media/Anime/My Status as an Assassin Obviously Exceeds the Hero's/My Status as an Assassin Obviously Exceeds the Hero's_S01E06_The Assassin Fights a Demon.mp4";
const local = "\\\\192.168.1.204\\Apocrypha_Media_Pool\\Anime\\My Status as an Assassin Obviously Exceeds the Hero's\\My Status as an Assassin Obviously Exceeds the Hero's_S01E06_The Assassin Fights a Demon.mp4";

const m = deriveMapping(plexFile, local);
assert.deepStrictEqual(m, { plex: '/media', local: '\\\\192.168.1.204\\Apocrypha_Media_Pool' });
assert.strictEqual(mapPath(plexFile, [m]), local);
assert.strictEqual(mapPath('/other/x.mp4', [m]), null);
assert.strictEqual(deriveMapping('/a/b.mp4', 'C:\\z\\c.mp4'), null, 'no shared tail → no mapping');

// flattenVideo against the shape Plex returns (JSON form of the XML the owner pasted)
const v = flattenVideo({ ratingKey: 36490, type: 'episode', title: 'The Assassin Fights a Demon', year: 2025, guid: 'plex://episode/x', Guid: [{ id: 'imdb://tt38909189' }, { id: 'tmdb://6600161' }], audienceRating: 6.5, viewOffset: 669000, lastViewedAt: 1789175629, duration: 1430101, addedAt: 1764208089, grandparentTitle: "My Status as an Assassin Obviously Exceeds the Hero's", grandparentRatingKey: 36028, parentIndex: 1, index: 6, Media: [{ Part: [{ file: plexFile }] }] }, { key: '1', title: 'Anime' });
assert.strictEqual(v.file, plexFile); assert.strictEqual(v.showKey, '36028'); assert.deepStrictEqual(v.guids, ['imdb://tt38909189', 'tmdb://6600161']); assert.strictEqual(v.userRating, null); assert.strictEqual(v.viewCount, 0);

// matching
const files = new Map([[local.toLowerCase(), { id: 7, abs_path: local }]]);
const r = matchItems([v, { ...v, ratingKey: '2', file: '/media/Anime/Missing/1.mp4' }, { ...v, ratingKey: '3', file: null }], files, [m]);
assert.strictEqual(r.matched.length, 1); assert.strictEqual(r.matched[0].file.id, 7);
assert.deepStrictEqual(r.unmatched.map(u => u.reason), ['not in MediaLedger', 'no file part']);

// migration v5 applies cleanly to a fresh db
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-plex-'));
const db = new Db(path.join(tmp, 't.db'));
assert.ok(db.userVersion >= 5);
db.run("INSERT INTO plex_shows (rating_key, title, user_rating) VALUES ('1','X',8)");
assert.strictEqual(db.get('SELECT user_rating FROM plex_shows').user_rating, 8);
db.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log('plex tests passed');


// ---- play history: webhook attribution, report shapes, dedupe key
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-hist-'));
  const db = new Db(path.join(dir, 'h.db'));
  db.run("INSERT INTO files (id, root_id, rel_path, abs_path, file_name, library_type, show_name, group_key, duration_s, plex_rating_key, adult) VALUES (1, 'r1', 'a.mkv', 'x-a.mkv', 'a.mkv', 'anime', 'Show A', 'show a', 1440, '501', 0)");
  const ev = (acc, i) => applyWebhookEvent(db, { event: 'media.scrobble', Account: { id: acc, title: acc === 1 ? 'Joe' : 'Sam' }, Player: { title: 'Shield TV' }, Metadata: { ratingKey: '501', type: 'episode', title: 'Ep ' + i, grandparentTitle: 'Show A', parentIndex: 1, index: i } });
  for (let i = 1; i <= 4; i++) { const r = ev(1, i); assert.strictEqual(r.who, 'Joe'); }
  ev(2, 1);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plex_history').n, 5, 'five scrobbles recorded');
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plex_accounts').n, 2);
  const r = watched.report(db, { days: 30 });
  assert.strictEqual(r.totals.plays, 5); assert.strictEqual(r.totals.people, 2); assert.strictEqual(r.totals.seconds, 5 * 1440);
  assert.deepStrictEqual(r.accounts.map(a => a.name), ['Joe', 'Sam']);
  assert.strictEqual(r.byPerson.find(x => x.k === 'Joe').n, 4);
  assert.strictEqual(r.byLibrary[0].library_type, 'anime');
  assert.strictEqual(r.top.series[0].title, 'Show A'); assert.strictEqual(r.top.series[0].people, 2);
  assert.strictEqual(r.recent[0].show_name, 'Show A', 'recent rows join the matched file');
  assert.strictEqual(watched.report(db, { days: 30, account: 2 }).totals.plays, 1, 'person filter');
  assert.strictEqual(watched.report(db, { days: 30, adultFilter: ' AND adult=0' }).totals.plays, 5, 'adult filter keeps non-adult files');
  db.run('UPDATE files SET adult=1 WHERE id=1');
  assert.strictEqual(watched.report(db, { days: 30, adultFilter: ' AND adult=0' }).totals.plays, 0, 'adult filter hides adult plays');
  assert.strictEqual(historyKeyOf({ historyKey: '/status/sessions/history/77' }), '77');
  assert.strictEqual(historyKeyOf({ ratingKey: '5', accountID: 1, viewedAt: 9 }), '5-1-9');
  assert.ok(Array.isArray(watched.bingeSessions(r.recent)));
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('plex history tests passed');
}
