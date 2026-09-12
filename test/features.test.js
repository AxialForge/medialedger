'use strict';
const assert = require('assert');
const { missingEpisodes, cleanTitle, similarity } = require('../src/main/metadata');
const { proposeName } = require('../src/main/renamer');

// ---- missing episodes ----
const have = [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 4 }, { season: 2, episode: 1, episode_end: 2 }];
let r = missingEpisodes(have, { 1: 4, 2: 3, 0: 5 });
assert.strictEqual(r.expectedTotal, 7);              // specials (season 0) not counted
assert.strictEqual(r.missingCount, 2);               // S1E3, S2E3
assert.deepStrictEqual(r.missing, [{ season: 1, missing: [3], expected: 4 }, { season: 2, missing: [3], expected: 3 }]);
assert.strictEqual(r.haveTotal, 5);
// absolute numbering guard: S2 on disk numbered 62..77 while AniList says S2 has 16 → skipped, not "16 missing"
r = missingEpisodes([{ season: 2, episode: 62 }, { season: 2, episode: 77 }], { 2: 16 });
assert.strictEqual(r.absolute, true); assert.strictEqual(r.missingCount, 0);
r = missingEpisodes(have, null); assert.strictEqual(r.expectedTotal, 0);
r = missingEpisodes(have, '{"1": 4}'); assert.strictEqual(r.missingCount, 1);

// ---- title cleaning / similarity ----
assert.strictEqual(cleanTitle('Attack on Titan (2013) [1080p]'), 'Attack on Titan');
assert.ok(similarity('3 Body Problem', '3 Body Problem') === 1);
assert.ok(similarity('The Boys', 'The Boys Presents: Diabolical') >= 0.5);
assert.ok(similarity('Gate', 'Frieren') < 0.5);

// ---- rename proposals ----
assert.strictEqual(proposeName({ library_type: 'tv', parse_ok: 1, file_name: '4The Boys S3.mp4', show_name: 'The Boys', season: 3, episode: 4 }), 'The Boys - S03E04.mp4');
assert.strictEqual(proposeName({ library_type: 'anime', parse_ok: 1, file_name: 'x.mkv', show_name: 'One Piece', season: 1, episode: 2, episode_title: 'Enter the Great Swordsman! Pirate Hunter: Zoro?' }), 'One Piece - S01E02 - Enter the Great Swordsman! Pirate Hunter Zoro.mkv');
assert.strictEqual(proposeName({ library_type: 'tv', parse_ok: 1, file_name: 'x.mkv', show_name: 'Show', season: 1, episode: 1, episode_end: 2 }), 'Show - S01E01-E02.mkv');
assert.strictEqual(proposeName({ library_type: 'movie', parse_ok: 1, file_name: 'Pacific Rim (2013) [4k].mkv', movie_title: 'Pacific Rim', movie_year: 2013, edition_tag: '4k' }), 'Pacific Rim (2013) - 4k.mkv');
assert.strictEqual(proposeName({ library_type: 'tv', parse_ok: 0, file_name: 'x.mkv' }), null);
assert.strictEqual(proposeName({ library_type: 'tv', parse_ok: 1, ignored: 1, file_name: 'x.mkv', show_name: 'S', season: 1, episode: 1 }), null);

console.log('feature tests passed');

// ---- adult classification + web parsing (appended 0.5.0) ----
{
  const { parseFor, parseWeb, classifyAdult } = require('../src/main/parse');
  const E = String.raw;
  let p = parseFor('adult', E`Aesthetica of a Rogue Hero\1 Aesthetica of a Rogue Hero.mp4`);
  assert.strictEqual(p.library_type, 'anime'); assert.strictEqual(p.adult, 1); assert.strictEqual(p.episode, 1); assert.strictEqual(p.show_name, 'Aesthetica of a Rogue Hero');
  assert.strictEqual(classifyAdult(E`Show\Show S01E02.mkv`), 'tv');
  assert.strictEqual(classifyAdult('Some Film (2019).mp4'), 'movie');
  assert.strictEqual(parseFor('adult', 'Some Film (2019).mp4').movie_title, 'Some Film');
  p = parseWeb(E`Kurzgesagt – In a Nutshell\20240115 The Egg [dQw4w9WgXcQ].mp4`);
  assert.strictEqual(p.channel, 'Kurzgesagt – In a Nutshell'); assert.strictEqual(p.video_id, 'dQw4w9WgXcQ'); assert.strictEqual(p.upload_date, '2024-01-15'); assert.strictEqual(p.movie_title, 'The Egg');
  p = parseWeb('Animation vs. Math.mp4'); assert.strictEqual(p.channel, null); assert.strictEqual(p.movie_title, 'Animation vs Math'); assert.strictEqual(p.parse_ok, 1);
  assert.strictEqual(parseFor('web', 'x.mp4').library_type, 'web');
  assert.strictEqual(parseFor('tv', E`Show\Show S01E01.mkv`).adult, 0);
  console.log('adult/web parse tests passed');
}
