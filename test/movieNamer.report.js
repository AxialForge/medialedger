'use strict';
// Dry report: run the movie naming engine over every movie row in a database
// and write a CSV + summary. Read-only. Usage: node test/movieNamer.report.js <db> <out.csv>
const fs = require('fs');
const { Db } = require('../src/main/db');
const { planMovieNames } = require('../src/main/movieNamer');

const db = new Db(process.argv[2]);
const rows = db.all(`SELECT * FROM files WHERE library_type='movie' AND missing=0 ORDER BY movie_title, file_name`);
const plan = planMovieNames(rows);
const csv = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const lines = ['status,current_name,proposed_name,flags,blocked_reason,title,year,source,resolution,hdr,codec,audio,edition'];
for (const p of plan) lines.push([p.unchanged ? 'unchanged' : p.ok ? 'ready' : 'blocked', p.from, p.name, p.flags.join(' '), p.blocked, p.tokens.title, p.tokens.year, p.tokens.source, p.tokens.resolution, p.tokens.hdr, p.tokens.codec, p.tokens.audio, p.tokens.edition].map(csv).join(','));
fs.writeFileSync(process.argv[3], '﻿' + lines.join('\r\n'), 'utf8');

const count = (fn) => plan.filter(fn).length;
const flagCounts = {};
for (const p of plan) for (const f of p.flags) { const k = f.split(':')[0]; flagCounts[k] = (flagCounts[k] || 0) + 1; }
console.log(`files: ${plan.length}`);
console.log(`ready: ${count(p => p.ok && !p.unchanged)}   unchanged: ${count(p => p.unchanged)}   blocked: ${count(p => !p.ok)}`);
console.log('blocked reasons:', Object.entries(plan.filter(p => !p.ok).reduce((a, p) => { const k = p.blocked.replace(/ \d+ other/, ' N other'); a[k] = (a[k] || 0) + 1; return a; }, {})));
console.log('flags:', flagCounts);
console.log('source:', Object.entries(plan.reduce((a, p) => { a[p.tokens.source] = (a[p.tokens.source] || 0) + 1; return a; }, {})));
console.log('--- samples:');
for (const p of plan.filter(p => p.ok && !p.unchanged).slice(0, 8)) console.log(`  ${p.from}\n    → ${p.name}${p.flags.length ? '   [' + p.flags.join(' ') + ']' : ''}`);
console.log('--- blocked samples:');
for (const p of plan.filter(p => !p.ok).slice(0, 6)) console.log(`  ${p.from}   (${p.blocked})`);
db.close();
