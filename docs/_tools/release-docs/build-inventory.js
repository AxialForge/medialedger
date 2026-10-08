'use strict';
// Writes ui_inventory.json: every window, page, section, dialog and control, with the file and line where it is
// defined. The line is found by searching the source for the text given in each screen's `src`, so the inventory
// follows the code when lines move.
//
//   node docs/_tools/release-docs/build-inventory.js <out-file> [<boxes.json>]
const fs = require('fs');
const path = require('path');
const { screens, REPO } = require('./screens.js');
const extra = require('./uncaptured.js');

const out = path.resolve(process.argv[2]);
const boxes = process.argv[3] && fs.existsSync(process.argv[3]) ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : {};
const cache = new Map();
const lines = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(REPO, f), 'utf8').split('\n')); return cache.get(f); };
const unverified = [];
function where(src, label) {
  if (!src) { unverified.push(`${label}: no source given`); return { file: null, line: null, verified: false }; }
  const [file, find] = src; const i = lines(file).findIndex(l => l.includes(find));
  if (i < 0) { unverified.push(`${label}: "${find}" not found in ${file}`); return { file, line: null, verified: false }; }
  return { file, line: i + 1, verified: true };
}
// Where one control is defined: its id or class, searched in the renderer sources.
const SOURCES = ['src/renderer/app-core.js', 'src/renderer/views-library.js', 'src/renderer/views-review.js', 'src/renderer/views-maintenance.js', 'src/renderer/views-app.js', 'src/renderer/app-router.js', 'src/renderer/dash.js', 'src/renderer/index.html', 'src/renderer/webbridge.js', 'src/renderer/cards.js', 'src/renderer/request.html', 'src/renderer/request.js', 'src/portal/portal.js', 'src/portal/index.html'];
// Controls drawn by a shared helper have no id of their own; they are defined where the helper is.
const HELPERS = [
  [/thead th|tbody tr|td:first-child/, 'src/renderer/app-core.js', 'function makeTable('],
  [/\.pbig|td\.ptitle|\.pthumb/, 'src/renderer/app-core.js', 'const posterTag ='],
  [/\.webauth/, 'src/renderer/webbridge.js', 'webauth'],
];
const PORTAL_HELPERS = [[/\.pbig|\.pthumb/, 'src/portal/portal.js', 'const poster = (r, cls'], [/main h1|main p a/, 'src/portal/portal.js', 'async function title(type, key)']];
function whereControl(sel, prefer) {
  for (const [re, f, find] of (String(prefer).includes('portal') ? PORTAL_HELPERS : HELPERS)) if (re.test(sel)) { const i = lines(f).findIndex(l => l.includes(find)); if (i >= 0) return { file: f, line: i + 1, via: 'helper' }; }
  const tokens = [...String(sel).matchAll(/#([A-Za-z][\w-]*)|\.([A-Za-z][\w-]*)|\[name=([\w-]+)\]|\[data-act=([\w-]+)\]|\[data-view=([\w-]+)\]/g)].map(m => m[1] ? [`id="${m[1]}"`, `'#${m[1]}'`, `id=${m[1]}`] : m[2] ? [`class="${m[2]}`, ` ${m[2]}"`, ` ${m[2]} `, `"${m[2]} `, `.${m[2]}`] : m[3] ? [`name: '${m[3]}'`, `name="${m[3]}"`] : m[4] ? [`data-act="${m[4]}"`] : [`data-view="${m[5]}"`]);
  const files = [prefer, ...SOURCES.filter(f => f !== prefer)].filter(Boolean);
  for (const needles of tokens) for (const f of files) { if (!fs.existsSync(path.join(REPO, f))) continue; const ls = lines(f); for (const n of needles) { const i = ls.findIndex(l => l.includes(n)); if (i >= 0) return { file: f, line: i + 1 }; } }
  return null;
}

const items = [];
const add = (s, captured) => {
  const at = where(s.src, s.id);
  const bx = boxes[s.id] ? boxes[s.id].controls : [];
  items.push({
    id: s.id, name: s.name, kind: s.kind, parent: s.parent || null, defined_at: at.file ? `${at.file}:${at.line || '?'}` : null, verified: at.verified,
    reached_by: s.portal ? `family portal ${s.url}` : s.path ? s.path : s.url || null, screenshot: captured ? { clean: `screenshots/${s.id}_clean.png`, annotated: `screenshots/${s.id}_annotated.png` } : null, reachable: !s.unreachable,
    controls: (s.controls || []).map((c, i) => { const w = whereControl(c.sel, at.file); if (!w) unverified.push(`${s.id}.${i + 1} "${c.name}": selector ${c.sel} not found in the renderer sources`); const b = bx.find(x => x.n === i + 1); return { id: `${s.id}.${i + 1}`, callout: captured ? i + 1 : null, name: c.name, type: c.type, selector: c.sel, defined_at: w ? `${w.file}:${w.line}` : null, located_in_screenshot: captured ? !!(b && !b.missing) : null }; }),
  });
};
for (const s of screens) add(s, true);
add(extra.sidebar, false);
for (const d of extra.dialogs) add(d, false);

const inventory = {
  project: 'MediaLedger', version: require(path.join(REPO, 'package.json')).version, generated: new Date().toISOString(), generated_by: 'docs/_tools/release-docs/build-inventory.js',
  counts: { items: items.length, windows: items.filter(i => i.kind === 'window').length, pages: items.filter(i => i.kind === 'page').length, sections: items.filter(i => i.kind === 'section').length, modes: items.filter(i => i.kind === 'mode').length, dialogs: items.filter(i => i.kind === 'dialog').length, controls: items.reduce((a, i) => a + i.controls.length, 0) },
  shells: [{ id: 'desktop', name: 'Desktop application (Electron)', entry: 'src/main/main.js' }, { id: 'web', name: 'Web server', entry: 'src/server/server.js' }, { id: 'portal', name: 'Family portal', entry: 'src/server/portal.js' }],
  items,
  keyboard_shortcuts: extra.shortcuts.map(k => { const at = where(k.src, 'shortcut ' + k.keys + ' / ' + k.where); return { keys: k.keys, where: k.where, does: k.does, defined_at: at.file ? `${at.file}:${at.line || '?'}` : null }; }),
  not_present: extra.absent,
  unverified,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(inventory, null, 2));
console.log(`inventory: ${inventory.counts.items} items, ${inventory.counts.controls} controls, ${unverified.length} unverified`);
for (const u of unverified) console.log('  ? ' + u);
