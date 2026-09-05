'use strict';
const assert = require('assert');
const { parseEpisode, parseMovie } = require('../src/main/parse');
const E = String.raw;
const cases = [
  [E`3 Body Problem\3 Body Problem S01E01 - 720p WEB-DL (LiLTV).mp4`, ['3 Body Problem', 1, 1, null, null]],
  [E`A Certain Magical Index\A Certain Magical Index S1\1 A Certain Magical Index S1.mp4`, ['A Certain Magical Index', 1, 1, null, null]],
  [E`A Certain Magical Index\A Certain Magical Index S3\13 A Certain Magical Index S3.mp4`, ['A Certain Magical Index', 3, 13, null, null]],
  [E`4 Cut Hero\10 4 Cut Hero.mp4`, ['4 Cut Hero', 1, 10, null, null]],
  [E`A Couple of Cuckoos\A Couple of Cuckoos S1\A Couple of Cuckoos_S01E01_You're going to be my boyfriend_.mp4`, ['A Couple of Cuckoos', 1, 1, null, "You're going to be my boyfriend"]],
  [E`One Piece\One Piece S1 East Blue (1-61)\One Piece_S01E02_Enter the Great Swordsman!.mp4`, ['One Piece', 1, 2, null, 'Enter the Great Swordsman!']],
  [E`Adventure Time\Adventure Time S0\Adventure Time S00E03 - Special.mkv`, ['Adventure Time', 0, 3, null, 'Special']],
  [E`Attack on Titan\Attack on Titian S4\28 Attack on Titan S4.mp4`, ['Attack on Titan', 4, 28, null, null]],
  [E`Show\Season 02\Show - 2x05 - Title.mkv`, ['Show', 2, 5, null, 'Title']],
  [E`Show\Show S01E01E02.mkv`, ['Show', 1, 1, 2, null]],
  [E`Show\Show S01E01-02.mkv`, ['Show', 1, 1, 2, null]],
  [E`Show\Show Ep 12.mkv`, ['Show', 1, 12, null, null]],
  [E`The Boys\The Boys S3\4The Boys S3.mp4`, ['The Boys', 3, 4, null, null]],
  [E`Hero\AnimePahe_Mushoku_no_Eiyuu_-_Betsu_ni_Skill_-_03_720p_SubsPlease.mp4`, ['Hero', 1, 3, null, null]],
  [E`Angel Beats!\Angel Beats! - OVA.mp4`, ['Angel Beats!', 0, 1, null, null]],
  [E`Angel Beats!\Special 01 - Another Epilogue.mp4`, ['Angel Beats!', 0, 1, null, 'Another Epilogue']],
  [E`Gate\Gate S1\2Gate S1.mp4`, ['Gate', 1, 2, null, null]],
];
let fail = 0;
for (const [rel, exp] of cases) {
  const p = parseEpisode(rel);
  const got = [p.show_name, p.season, p.episode, p.episode_end, p.episode_title];
  try { assert.deepStrictEqual(got, exp); console.log('ok  ', rel.split(/[\\/]/).pop()); }
  catch { fail++; console.log('FAIL', rel, '\n     got', JSON.stringify(got), '\n     exp', JSON.stringify(exp)); }
}
const bad = parseEpisode(E`Show\readme.mp4`); assert.strictEqual(bad.parse_ok, 0); console.log('ok   unparseable flagged');
const movies = [
  ['101 Dalmatians 2 Patchs London Adventure (2002) [720p].mp4', ['101 Dalmatians 2 Patchs London Adventure', 2002, '720p']],
  ['1992 (2022) [4k].mp4', ['1992', 2022, '4k']],
  ['Pacific Rim (2013).mp4', ['Pacific Rim', 2013, null]],
  ['Pacific Rim (2013) [4k].mkv', ['Pacific Rim', 2013, '4k']],
  ['Blade Runner 2049 (2017) Directors Cut.mkv', ['Blade Runner 2049', 2017, 'directors cut']],
  ['Some.Movie.2019.1080p.BluRay.x264-GRP.mkv', ['Some Movie', 2019, null]],
  [E`Movie (2010)\Movie (2010) - Extended.mkv`, ['Movie', 2010, 'extended']],
];
for (const [rel, exp] of movies) {
  const p = parseMovie(rel); const got = [p.movie_title, p.movie_year, p.edition_tag];
  try { assert.deepStrictEqual(got, exp); console.log('ok  ', rel); } catch { fail++; console.log('FAIL', rel, JSON.stringify(got)); }
}
assert.strictEqual(parseMovie('Pacific Rim (2013).mp4').group_key, parseMovie('Pacific Rim (2013) [4k].mkv').group_key);
console.log(fail ? `${fail} FAILED` : 'all parser tests passed');
process.exit(fail ? 1 : 0);
