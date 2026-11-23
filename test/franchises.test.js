'use strict';
// Franchises: the grouping engine. Known titles land in the right franchise, false positives stay out, copies of one
// title merge while same-name titles stay apart, and Missing and timeline ownership follow what is owned.
// The full library parity check against the Python prototype is run by hand (see CLAUDE.md), not from here:
// its input is the owner's whole library list and this repository is public.
const assert = require('assert');
const F = require('../src/main/franchises');
const data = F.loadData();
const fr = (title, media = 'Movie') => F.franchiseOf(title, media, data);
const sub = (title, media = 'Movie', genres = '') => F.subgroupOf(fr(title, media) || '', title, media, genres, data.subgroups);

// ---- every regex in the data compiles, and the shapes are what the engine reads
assert.ok(data.rules.length > 200 && data.rules.every(([n, re]) => typeof n === 'string' && re instanceof RegExp));
for (const [name, list] of Object.entries(data.canon)) for (const e of list) { assert.strictEqual(e.length, 4, `canon ${name}: [title, media, year, regex]`); assert.ok(['Movie', 'TV', 'Anime'].includes(e[1]), `canon ${name} ${e[0]}: media`); new RegExp(e[3].replace(/-/g, ' ')); }
for (const [name, t] of Object.entries(data.timelines)) for (const e of t.entries) { assert.ok(e.era >= 0 && e.era < t.eras.length, `timeline ${name} ${e.title}: era`); assert.ok(/^\d{4}-\d\d-\d\d$/.test(e.rel), `timeline ${name} ${e.title}: release date`); new RegExp(e.regex.replace(/-/g, ' ')); }
assert.ok(!/forge/i.test(JSON.stringify([data.block, data.subgroups, data.canon, data.timelines])));

// ---- nz: what canon and timeline regexes are matched against
assert.strictEqual(F.nz('Star Wars: Episode IV - A New Hope'), 'star wars episode iv a new hope');
assert.strictEqual(F.nz("  Ender's   Game (2013) "), 'enders game 2013');
assert.strictEqual(F.nz('Fast & Furious 6'), 'fast & furious 6');

// ---- (a) known titles land in the right franchise, and the right corner of it
for (const [title, media, franchise, universe] of [
  ['Star Wars: Episode IV - A New Hope', 'Movie', 'Star Wars', ''],
  ['Andor', 'TV', 'Star Wars', ''],
  ['The Mandalorian', 'TV', 'Star Wars', ''],
  ['Thor: Ragnarok', 'Movie', 'Marvel (MCU & Marvel)', 'MCU'],
  ['Venom', 'Movie', 'Marvel (MCU & Marvel)', 'Sony Spider-Man Universe'],
  ['X-Men', 'Movie', 'Marvel (MCU & Marvel)', 'Fox X-Men Universe'],
  ['The Batman', 'Movie', 'DC', 'DC Live-Action Films'],
  ['Arrow', 'TV', 'DC', 'Arrowverse & Related'],
  ['Titans', 'TV', 'DC', 'Other DC TV'],
  ['Dune', 'Movie', 'Dune', ''],
  ['Dune Prophecy', 'TV', 'Dune', ''],
  ['Blade Runner 2049', 'Movie', 'Blade Runner', ''],
  ['Alien', 'Movie', 'Alien / Predator', ''],
  ['Fate/Zero', 'Anime', 'Fate', ''],
  ['Avatar', 'Movie', 'Avatar (Cameron)', ''],
  ['Avatar The Last Airbender', 'TV', 'Avatar: The Last Airbender', ''],
]) { assert.strictEqual(fr(title, media), franchise, title); assert.strictEqual(sub(title, media), universe, title + ' sub-universe'); }
assert.strictEqual(sub('Batman: Under the Red Hood', 'Movie', 'Animation; Action'), 'DC Animated Films', 'DC films split on the Animation genre');

// ---- (b) false positives stay out
for (const [title, media] of [['After Earth', 'Movie'], ['Remember the Titans', 'Movie'], ['Aliens in the Attic', 'Movie'], ['The Marvelous Mrs Maisel', 'TV'], ['Planet Earth II', 'TV'], ['Wrath of the Titans', 'Movie']]) assert.strictEqual(fr(title, media), null, title + ' is blocked');
assert.ok(!['Alien / Predator', 'DC', 'Marvel (MCU & Marvel)'].includes(fr('Blade Runner 2049')), 'Blade Runner is not Marvel\'s Blade');
assert.strictEqual(fr('Blade'), 'Marvel (MCU & Marvel)');
assert.strictEqual(fr('Overlord', 'Movie'), null, 'a block can be for one medium: the 2018 film');
assert.strictEqual(fr('Overlord', 'Anime'), 'Overlord', '...while the anime of the same name is a franchise');

// ---- the owner's own decisions come first and never touch the shipped files
{
  const mine = F.loadData(undefined, { rules: [['Planet Earth', '^planet earth']], block: [{ title: 'Venom', media: 'Movie' }] });
  assert.strictEqual(F.franchiseOf('Planet Earth', 'TV', mine), 'Planet Earth', 'a rule added by hand assigns a title');
  assert.strictEqual(F.franchiseOf('Venom', 'Movie', mine), null, 'a block added by hand removes one');
  assert.strictEqual(fr('Venom'), 'Marvel (MCU & Marvel)', 'the shipped data is unchanged');
}

// ---- (c) copies of one title merge, same-name titles stay apart
const lib = [
  { media: 'Movie', title: 'Dune', year: 1984, size_gb: 8.1, key: 'dune|1984' },
  { media: 'Movie', title: 'Dune', year: 2021, size_gb: 22.4, key: 'dune|2021' },
  { media: 'Movie', title: 'Dune (2021)', year: 2021, size_gb: 60.2, key: 'dune|2021-uhd' },     // a second copy of the 2021 film
  { media: 'Movie', title: 'Dune Part Two', year: 2024, size_gb: 30 },
  { media: 'TV', title: 'Avatar The Last Airbender', seasons: 3, episodes: 61, size_gb: 40 },
  { media: 'TV', title: 'Avatar The Last Airbender (2024)', seasons: 1, episodes: 8, size_gb: 25 },
  { media: 'TV', title: 'Doctor Who (2005)', seasons: 13, episodes: 153, size_gb: 300 },
  { media: 'TV', title: 'Doctor Who (2023)', seasons: 2, episodes: 16, size_gb: 60 },
  { media: 'Movie', title: 'Star Wars: Episode IV - A New Hope', year: 1977, size_gb: 20 },
  { media: 'TV', title: 'Andor', seasons: 2, episodes: 24, size_gb: 90 },
  { media: 'Movie', title: 'After Earth', year: 2013, size_gb: 9 },
  { media: 'Movie', title: 'Some Film Nobody Grouped', year: 2001, size_gb: 4 },
];
const out = F.build(lib, data, { year: 2026 });
const owned = out.items.filter(o => o.status === 'Owned');
const dunes = owned.filter(o => o.franchise === 'Dune' && o.media === 'Movie').map(o => [o.title, o.year, o.size_gb, o.dupes]);
assert.deepStrictEqual(dunes, [['Dune', '1984', 8.1, 0], ['Dune (2021)', '2021', 60.2, 1], ['Dune Part Two', '2024', 30, 0]], 'the two 2021 copies merge (the larger stays, one duplicate counted); 1984 stays its own film');
assert.strictEqual(owned.find(o => o.title === 'Dune (2021)').key, 'dune|2021-uhd', 'whatever came in with a title rides along');
assert.strictEqual(owned.filter(o => /^Avatar The Last Airbender/.test(o.title)).length, 2, 'a series and its remake are two titles');
assert.strictEqual(owned.filter(o => /^Doctor Who/.test(o.title)).length, 2, 'Doctor Who 2005 and 2023 are two titles');
assert.deepStrictEqual(out.unassigned.map(u => u.title), ['After Earth', 'Some Film Nobody Grouped'], 'blocked and unmatched titles are reported, not dropped');
assert.deepStrictEqual(out.stats, { franchises: new Set(out.items.map(o => o.franchise)).size, owned: owned.length, missing: out.items.length - owned.length, upcoming: out.items.filter(o => o.status === 'Missing (upcoming)').length, unassigned: 2 });

// ---- (d) Missing follows what is owned
const gaps = (f) => out.items.filter(o => o.franchise === f && o.status !== 'Owned').map(o => o.title);
assert.deepStrictEqual(gaps('Dune'), ['Dune: Prophecy', 'Dune: Part Three'].sort(), 'owned Dune titles are not missing; the rest of the canon is');
assert.ok(gaps('Star Wars').includes('The Empire Strikes Back') && !gaps('Star Wars').includes('A New Hope') && !gaps('Star Wars').includes('Andor'));
assert.strictEqual(out.items.filter(o => o.franchise === 'Middle-earth').length, 0, 'a franchise with nothing owned lists nothing as missing');
assert.ok(out.items.every(o => o.status !== 'Owned' ? o.size_gb === 0 && o.dupes === 0 : true));
// a canon title due after this year is upcoming, not a gap. The year is passed in, never hard-coded.
{
  const future = { ...data, canon: { Dune: [...data.canon.Dune, ['Dune: Part Nine', 'Movie', '2031', 'part nine']] } };
  const st = (year) => F.missing(owned, future, { year }).find(o => o.title === 'Dune: Part Nine').status;
  assert.strictEqual(st(2026), 'Missing (upcoming)'); assert.strictEqual(st(2031), 'Missing'); assert.strictEqual(st(2040), 'Missing');
}
// items come out in display order: franchise, owned before missing
for (let i = 1; i < out.items.length; i++) { const a = out.items[i - 1], b = out.items[i]; assert.ok(a.franchise < b.franchise || (a.franchise === b.franchise && !(a.status !== 'Owned' && b.status === 'Owned')), 'order at ' + i); }

// ---- timelines: every entry carries both orders, and owned follows the library
const sw = out.timelines['Star Wars'];
assert.strictEqual(sw.length, data.timelines['Star Wars'].entries.length);
assert.strictEqual(sw.find(e => e.title === 'Andor').owned, true);
assert.strictEqual(sw.find(e => e.title === 'Andor').file, 'Andor');
assert.strictEqual(sw.find(e => e.title === 'Andor').eps, 24);
assert.strictEqual(sw.find(e => /New Hope/.test(e.title)).owned, true);
assert.strictEqual(sw.find(e => e.title === 'The Acolyte').owned, false);
assert.strictEqual(sw.find(e => e.title === 'The Acolyte').chron, -132, 'in-universe years before the battle of Yavin are negative');
assert.deepStrictEqual(out.eras['Star Wars'], data.timelines['Star Wars'].eras);
assert.ok(out.timelines['Marvel (MCU & Marvel)'].every(e => e.owned === false), 'nothing Marvel in this library');

console.log('franchises tests passed');
