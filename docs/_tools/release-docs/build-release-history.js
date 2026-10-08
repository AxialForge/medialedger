'use strict';
// Builds RELEASE_HISTORY.docx: every release, what it added, changed and fixed. Generated from CHANGELOG.md and
// the release commits, so nothing in it is written twice.
//
//   node docs/_tools/release-docs/build-release-history.js <release-package-dir>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./docx-lib.js');
const { H1, H2, H3, P, note, bullets, table, cover, toc, write } = L;

const OUT = path.resolve(process.argv[2]);
const V = require(path.join(L.REPO, 'package.json')).version;
const BUILD = process.env.BUILD_DATE || '2026-09-30';
const DOC = new Date().toISOString().slice(0, 10);

// ---- CHANGELOG.md -> [{ version, date, intro, groups: { Added: [..], Changed: [..], Fixed: [..] } }]
const text = fs.readFileSync(path.join(L.REPO, 'CHANGELOG.md'), 'utf8').replace(/\r/g, '');
const releases = [];
let cur = null, group = null, item = null;
const flush = () => { if (item != null && cur && group) { cur.groups[group].push(item.trim().replace(/\s+/g, ' ')); } item = null; };
for (const line of text.split('\n')) {
  const h = /^## \[(\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?/.exec(line);
  if (h) { flush(); cur = { version: h[1], date: h[2] || '', intro: [], groups: {} }; group = null; releases.push(cur); continue; }
  if (/^## /.test(line)) { flush(); cur = null; continue; }
  if (!cur) continue;
  const g = /^### (.+)/.exec(line);
  if (g) { flush(); group = g[1].trim(); cur.groups[group] = cur.groups[group] || []; continue; }
  if (/^- /.test(line)) { flush(); item = line.slice(2); continue; }
  if (item != null && /^\s+\S/.test(line)) { item += ' ' + line.trim(); continue; }
  if (item != null && !line.trim()) { flush(); continue; }
  if (!group && line.trim()) cur.intro.push(line.trim());
}
flush();

// ---- the one-line summary of each release, from its release commit
const subjects = {};
try {
  for (const l of execFileSync('git', ['-C', L.REPO, 'log', '--format=%s'], { encoding: 'utf8' }).split('\n')) { const m = /^Release (\d+\.\d+\.\d+):\s*(.+)$/.exec(l); if (m && !subjects[m[1]]) subjects[m[1]] = m[2]; }
} catch { /* not a git checkout */ }
const tags = new Set(); try { for (const t of execFileSync('git', ['-C', L.REPO, 'tag'], { encoding: 'utf8' }).split('\n')) if (t.trim()) tags.add(t.trim().replace(/^v/, '')); } catch { /* none */ }
const firstBold = (r) => { for (const g of ['Added', 'Changed', 'Fixed']) for (const i of (r.groups[g] || [])) { const m = /\*\*([^*]+)\*\*/.exec(i); if (m) return m[1].replace(/[.:]$/, ''); } const any = Object.values(r.groups).flat()[0]; return any ? any.split(/[.:]/)[0].slice(0, 110) : ''; };
const firstItem = (r) => { const any = Object.values(r.groups).flat()[0] || r.intro.join(' '); return any.replace(/\*\*/g, '').split(/(?<=[a-z)])[.:;] /)[0].slice(0, 140); };
const summary = (r) => { let s = subjects[r.version] || firstBold(r); if (s.replace(/[^A-Za-z]/g, '').length < 12) s = firstItem(r); return s.charAt(0).toUpperCase() + s.slice(1); };
// Markdown the Word helper does not know: links become their text, emphasis is dropped, code and bold are kept.
const clean = (t) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1$2').replace(/<[^>]+>/g, '');
const count = (r, g) => (r.groups[g] || []).length;

const series = [...new Set(releases.map(r => r.version.split('.').slice(0, 1).join('.')))];
const body = [];
body.push(cover('Release History', 'Every release, and what each one added, changed and fixed', V, { build: BUILD, doc: DOC }, [
  `${releases.length} releases, from ${releases[releases.length - 1].version} on ${releases[releases.length - 1].date} to ${releases[0].version} on ${releases[0].date}.`,
  'Written from the project change log (CHANGELOG.md) and the release commits. Newest first.',
]));
body.push(toc());

body.push(H1('1. How to read this'));
body.push(P('Versions have three numbers: **major.minor.patch**. The first changes when the program changes in a way that needs attention (a new database layout, a new way of working). The second changes when features are added. The third changes for corrections only.'));
body.push(table(['Heading', 'Meaning'], [['Added', 'Something the program could not do before.'], ['Changed', 'Something that works differently than before.'], ['Fixed', 'Something that was wrong and is now right.'], ['Removed', 'Something taken out.'], ['Security', 'A change that affects who can reach or do what.']], [2200, 7160], { size: 18 }));
body.push(P('Updating always keeps your data. The database is upgraded automatically the first time a newer version opens it, after a backup copy is made beside it.'));
const num = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
const newestTag = Math.max(0, ...[...tags].filter(t => /^\d+\.\d+\.\d+$/.test(t)).map(num));
const untagged = releases.filter(r => tags.size && num(r.version) > newestTag).map(r => r.version); // newer than anything published
if (untagged.length) body.push(note(`At the time this document was built, ${untagged.length === 1 ? 'version' : 'versions'} ${untagged.join(', ')} ${untagged.length === 1 ? 'was' : 'were'} committed but not yet tagged and published on GitHub.`));

body.push(H1('2. All releases at a glance'));
body.push(table(['Version', 'Date', 'In one line', 'Added', 'Changed', 'Fixed'], releases.map(r => [`**${r.version}**`, r.date, clean(summary(r)), String(count(r, 'Added') || '–'), String(count(r, 'Changed') || '–'), String(count(r, 'Fixed') || '–')]), [900, 1150, 4960, 700, 900, 750], { size: 16 }));
const tot = (g) => releases.reduce((a, r) => a + count(r, g), 0);
body.push(P(`In total: ${tot('Added')} additions, ${tot('Changed')} changes and ${tot('Fixed')} corrections across ${releases.length} releases.`));

body.push(H1('3. The milestones'));
const milestones = releases.filter(r => /\.0$/.test(r.version) && (r.version.endsWith('.0.0') || count(r, 'Added') >= 3));
body.push(table(['Version', 'Date', 'What it brought'], milestones.map(r => [`**${r.version}**`, r.date, clean(summary(r))]), [1000, 1300, 7060], { size: 17 }));

let chapter = 3;
for (const major of series) {
  const list = releases.filter(r => r.version.split('.')[0] === major);
  body.push(H1(`${++chapter}. Version ${major}${major === '0' ? ' (before the first stable release)' : ''}`));
  body.push(P(`${list.length} release${list.length === 1 ? '' : 's'}, ${list[list.length - 1].date} to ${list[0].date}.`));
  list.forEach((r, i) => {
    body.push(H2(`${chapter}.${i + 1} Version ${r.version}${r.date ? ', ' + r.date : ''}`));
    body.push(P(`**${clean(summary(r))}.**`));
    for (const p of r.intro.join(' ').split(/(?<=\.)\s{2,}/).filter(Boolean)) body.push(P(clean(p)));
    const order = ['Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'];
    for (const g of [...order.filter(x => r.groups[x]), ...Object.keys(r.groups).filter(x => !order.includes(x))]) {
      if (!r.groups[g].length) continue;
      body.push(H3(g), ...bullets(r.groups[g].map(clean)));
    }
  });
}

write(path.join(OUT, 'RELEASE_HISTORY.docx'), body, { title: `MediaLedger ${V} Release History`, header: `MediaLedger ${V} · Release History` })
  .then(() => console.log(`${releases.length} releases, ${tot('Added')} added, ${tot('Changed')} changed, ${tot('Fixed')} fixed; untagged: ${untagged.join(', ') || 'none'}`));
