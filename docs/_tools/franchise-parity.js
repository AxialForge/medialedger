'use strict';
// Parity check: src/main/franchises.js against the Python prototype's output (franchise-pack/sample_output).
// Run it by hand after changing the engine. The sample output is the owner's whole library list, so it is passed in
// as a path and never committed: this repository is public.
const fs = require('fs'), path = require('path');
const F = require('../../src/main/franchises.js');
const S = process.argv[2];
if (!S || !fs.existsSync(path.join(S, 'items.json'))) { console.error('usage: node docs/_tools/franchise-parity.js <the prototype's sample_output folder>'); process.exit(2); }
const golden = JSON.parse(fs.readFileSync(path.join(S, 'items.json'), 'utf8'));
const un = fs.readFileSync(path.join(S, 'unassigned.csv'), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).filter(Boolean).map(l => { const i = l.indexOf(','); let t = l.slice(i + 1); if (t.startsWith('"')) t = t.slice(1, -1).replace(/""/g, '"'); return { media: l.slice(0, i), title: t }; });
const html = fs.readFileSync(path.join(S, 'index.html'), 'utf8');
const grab = (start, end) => { const i = html.indexOf(start) + start.length; return JSON.parse(html.slice(i, html.indexOf(end, i))); };
const TL = grab('const TL=', ',TLE=');

const data = F.loadData();
const gOwned = golden.filter(o => o.status === 'Owned'), gMissing = golden.filter(o => o.status !== 'Owned');
const input = [...gOwned.map(o => ({ media: o.media, title: o.title, year: o.year, seasons: o.seasons, episodes: o.episodes, size_gb: o.size_gb, runtime_min: o.runtime_min, rating: o.rating, res: o.res, genres: o.genres })), ...un];
const out = F.build(input, data, { year: 2026 });
const key = o => `${o.media}|${o.title}|${o.year || ''}`;

let bad = 0; const say = (...a) => { bad++; if (bad <= 25) console.log(...a); };
console.log('golden: owned', gOwned.length, 'missing', gMissing.length, 'unassigned', un.length, '| port:', JSON.stringify(out.stats));
// 1. every owned title lands in the same franchise and sub-universe
const mine = new Map(out.items.filter(o => o.status === 'Owned').map(o => [key(o), o]));
for (const g of gOwned) { const m = mine.get(key(g)); if (!m) say('OWNED LOST', key(g), '(golden:', g.franchise + ')'); else if (m.franchise !== g.franchise || m.sub !== g.sub) say('DIFFERENT', key(g), 'golden', g.franchise, '/', g.sub, 'port', m.franchise, '/', m.sub); }
if (mine.size !== gOwned.length) say('owned count', mine.size, 'vs', gOwned.length);
// 2. every unassigned title stays unassigned
const stillUn = new Set(out.unassigned.map(o => o.media + '|' + o.title));
for (const u of un) if (!stillUn.has(u.media + '|' + u.title)) say('NOW ASSIGNED', u.media, u.title, '->', F.franchiseOf(u.title, u.media, data));
// 3. the same missing titles, with the same status
const mk = o => `${o.franchise}|${o.media}|${o.title}|${o.year}|${o.status}`;
const gm = new Set(gMissing.map(mk)), pm = new Set(out.items.filter(o => o.status !== 'Owned').map(mk));
for (const k of gm) if (!pm.has(k)) say('MISSING not reported by port:', k);
for (const k of pm) if (!gm.has(k)) say('MISSING only in port:', k);
// 4. the same display order
const go = golden.map(o => o.franchise + '|' + o.status + '|' + o.title + '|' + o.year), po = out.items.map(o => o.franchise + '|' + o.status + '|' + o.title + '|' + o.year);
let orderDiff = 0; for (let i = 0; i < Math.max(go.length, po.length); i++) if (go[i] !== po[i]) orderDiff++;
if (orderDiff) say('ORDER differs at', orderDiff, 'positions; first:', go.find((g, i) => g !== po[i]), 'vs', po.find((p, i) => p !== go[i]));
// 5. timelines: same entries, same owned flags
let tlFile = 0;
for (const fr of Object.keys(TL)) {
  const a = TL[fr], b = out.timelines[fr] || [];
  if (a.length !== b.length) say('TIMELINE length', fr, a.length, b.length);
  a.forEach((e, i) => { const p = b[i] || {}; if (e.title !== p.title || e.owned !== p.owned || e.rel !== p.rel || e.chron !== p.chron || e.era !== p.era) say('TIMELINE', fr, e.title, 'golden owned', e.owned, 'port', p.owned); else if (e.file !== p.file) tlFile++; });
}
console.log('timeline entries where a different copy was picked as the owned file (input order differs, not a logic difference):', tlFile);
console.log(bad ? `PARITY FAILED: ${bad} difference(s)` : 'PARITY OK: identical franchises, sub-universes, missing titles, order and timeline ownership');
process.exit(bad ? 1 : 0);
