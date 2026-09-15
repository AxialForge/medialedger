'use strict';
const assert = require('assert');
const { proposeMovieName, planMovieNames, cleanTitle } = require('../src/main/movieNamer');

const base = { library_type: 'movie', root_id: 'movies', rel_path: 'x.mp4', abs_path: 'x', probe_ok: 1, probed_at: 't', resolution: '1080p', hdr: 'SDR', video_codec: 'h264', audio_langs: 'eng', size: 1 };
const n = (over) => proposeMovieName({ ...base, ...over });

// Straight case: LiLTV → Web, probed 1080p, SDR, H264, English audio omitted
let p = n({ file_name: 'A Breed Apart 2025 - 1080p WEB-DL (LiLTV).mp4', movie_title: 'A Breed Apart', movie_year: 2025 });
assert.strictEqual(p.name, 'A Breed Apart (2025) - Web 1080p SDR H264.mp4'); assert.deepStrictEqual(p.flags, []);

// Rip marker + 4K HDR from probe + HEVC + edition
p = n({ file_name: 'Avatar (2009) - Extended Collector\'s Edition HDR.mkv', movie_title: 'Avatar', movie_year: 2009, edition_tag: "extended collector's edition", resolution: '4K', hdr: 'HDR10', video_codec: 'hevc' });
assert.strictEqual(p.name, "Avatar (2009) - Source 4K HDR HEVC {edition-Extended Collector's Edition}.mkv");
assert.ok(p.flags.includes('no_source'));

// Claimed [720p] but probe says 1080p → flag, probe wins
p = n({ file_name: 'Old Movie (1999) [720p].mp4', movie_title: 'Old Movie', movie_year: 1999, edition_tag: '720p' });
assert.strictEqual(p.tokens.resolution, '1080p'); assert.ok(p.flags.some(f => f.startsWith('res_mismatch')));

// No year → placeholder, not blocked
p = n({ file_name: 'NoYearMovie.mp4', movie_title: 'NoYearMovie', movie_year: null });
assert.strictEqual(p.ok, true); assert.strictEqual(p.name, 'NoYearMovie (Year) - Source 1080p SDR H264.mp4'); assert.ok(p.flags.includes('no_year'));

// Not probed → blocked
p = n({ file_name: 'X (2001).mp4', movie_title: 'X', movie_year: 2001, probe_ok: 0, probed_at: null });
assert.strictEqual(p.ok, false); assert.strictEqual(p.blocked, 'not probed yet');

// Audio: dual audio → token, English first; und-only → omitted with flag
p = n({ file_name: 'Anime Movie (2016) [1080p].mkv', movie_title: 'Anime Movie', movie_year: 2016, audio_langs: 'jpn;eng' });
assert.strictEqual(p.tokens.audio, 'ENG+JPN');
p = n({ file_name: 'Y (2001).mp4', movie_title: 'Y', movie_year: 2001, audio_langs: 'und' });
assert.strictEqual(p.tokens.audio, null); assert.ok(p.flags.includes('audio_und'));

// Illegal characters
assert.strictEqual(cleanTitle('Mission: Impossible - Dead Reckoning Part One?'), 'Mission Impossible - Dead Reckoning Part One');
assert.strictEqual(cleanTitle('Face/Off'), 'Face-Off');
assert.strictEqual(cleanTitle("A Writer's Odyssey & Co."), "A Writer's Odyssey & Co");

// Remux counts as Rip; Web Remux counts as Web
assert.strictEqual(n({ file_name: 'Z (2010) [1080p Remux].mkv', movie_title: 'Z', movie_year: 2010 }).tokens.source, 'Rip');
assert.strictEqual(n({ file_name: 'Z (2010) [4K HDR Web Remux].mkv', movie_title: 'Z', movie_year: 2010 }).tokens.source, 'Web');

// Collision: two files that would get the same name are both blocked
const plan = planMovieNames([
  { ...base, id: 1, file_name: 'Pacific Rim (2013).mp4', movie_title: 'Pacific Rim', movie_year: 2013 },
  { ...base, id: 2, file_name: 'Pacific Rim (2013) [1080p].mp4', movie_title: 'Pacific Rim', movie_year: 2013, edition_tag: '1080p' },
  { ...base, id: 3, file_name: 'Pacific Rim (2013) [4k].mkv', movie_title: 'Pacific Rim', movie_year: 2013, resolution: '4K', hdr: 'HDR10', video_codec: 'hevc' },
]);
assert.strictEqual(plan[0].ok, false); assert.match(plan[0].blocked, /collision/);
assert.strictEqual(plan[1].ok, false);
assert.strictEqual(plan[2].ok, true); assert.strictEqual(plan[2].name, 'Pacific Rim (2013) - Source 4K HDR HEVC.mkv');

// Already correct name → unchanged
const same = planMovieNames([{ ...base, id: 9, file_name: 'Done (2020) - Web 1080p SDR H264.mp4', movie_title: 'Done', movie_year: 2020 }]);
assert.strictEqual(same[0].unchanged, true);

// Name parts: optional and ordered; Source off removes the placeholder and its flag.
{
  const base = { file_name: 'Avatar.2009.mkv', library_type: 'movie', movie_title: 'Avatar', movie_year: 2009, probe_ok: true, resolution: '4K', hdr: 'HDR10', video_codec: 'hevc', audio_langs: 'eng', rel_path: 'Avatar.2009.mkv' };
  assert.strictEqual(proposeMovieName(base).name, 'Avatar (2009) - Source 4K HDR HEVC.mkv');
  assert.ok(proposeMovieName(base).flags.includes('no_source'));
  const noSrc = proposeMovieName({ ...base, parts: ['resolution', 'hdr', 'codec', 'audio', 'edition'] });
  assert.strictEqual(noSrc.name, 'Avatar (2009) - 4K HDR HEVC.mkv'); assert.ok(!noSrc.flags.includes('no_source'));
  assert.strictEqual(proposeMovieName({ ...base, parts: ['codec', 'resolution'] }).name, 'Avatar (2009) - HEVC 4K.mkv');
  assert.strictEqual(proposeMovieName({ ...base, parts: [] }).name, 'Avatar (2009).mkv');
  assert.strictEqual(proposeMovieName({ ...base, parts: ['bogus', 'resolution', 'resolution'] }).name, 'Avatar (2009) - 4K.mkv');
  assert.deepStrictEqual(proposeMovieName(base).segments.map(x => x.part), ['title', 'year', 'source', 'resolution', 'hdr', 'codec', 'ext']);
}
console.log('movie namer tests passed');
