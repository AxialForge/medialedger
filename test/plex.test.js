'use strict';
// Pure Plex helpers: path mapping, mapping derivation, matching, flattening. No network.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { mapPath, deriveMapping, matchItems, flattenVideo } = require('../src/main/plex');
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
