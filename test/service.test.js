'use strict';
// Guards the shell/core split:
//   1. the core (service.js and everything it requires) never touches Electron;
//   2. every channel the renderer bridge (preload.js) invokes is served either by
//      the core or by the short Electron-only list in main.js, and vice versa.
// Runs in plain node, so a broken split fails `npm test` before it reaches CI.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 1. No Electron in the core
const coreFiles = fs.readdirSync(path.join(root, 'main')).filter(f => f.endsWith('.js') && !['main.js', 'updater.js', 'ffmpegdl.js'].includes(f));
for (const f of coreFiles) {
  const s = read(path.join('main', f));
  assert.ok(!/require\(['"]electron(-updater)?['"]\)/.test(s), `${f} must not require electron`);
}
const { createService } = require('../src/main/service');
const svc = createService({ userData: fs.mkdtempSync(path.join(require('os').tmpdir(), 'ml-svc-')), log: () => {}, send: () => {}, host: { isPackaged: false, getAppPath: () => '.' } });
assert.ok(svc.handlers.size > 50, 'core exposes its handlers before init');

// 2. Bridge ⇄ handlers agree
const shape = require('../src/renderer/bridge-shape.js');
const leaves = []; (function walk(n) { for (const v of Object.values(n)) typeof v === 'string' ? leaves.push(v) : walk(v); })(shape);
const bridge = new Set(leaves.map(l => l.replace(/^!/, '')));
const events = new Set(leaves.filter(l => l.startsWith('!')).map(l => l.slice(1)));
const electronOnly = new Set([...read('main/main.js').matchAll(/h\('([a-zA-Z]+:[a-zA-Z]+)'/g)].map(m => m[1]));
for (const m of read('main/main.js').matchAll(/'(security:[a-zA-Z]+)'/g)) electronOnly.add(m[1]);
const webOnly = new Set([...read('server/server.js').matchAll(/(?:^\s*\[|webHandlers\.set\()'([a-zA-Z]+:[a-zA-Z]+)', /gm)].map(m => m[1]));
// The web shell must serve every Electron-only channel; anything else it declares must be an override of a core channel (per-session state).
for (const ch of electronOnly) assert.ok(webOnly.has(ch), `web shell must serve ${ch}`);
for (const ch of webOnly) assert.ok(electronOnly.has(ch) || svc.handlers.has(ch), `web handler ${ch} is neither Electron-only nor a core override`);
const served = new Set([...svc.handlers.keys(), ...electronOnly]);
for (const ch of bridge) if (!events.has(ch)) assert.ok(served.has(ch), `bridge calls ${ch} but nothing serves it`);
for (const ch of served) assert.ok(bridge.has(ch), `${ch} is served but the bridge never calls it`);

// 3. preload.js's only project require must resolve; a sandboxed preload cannot load it at all (see CLAUDE.md gotchas)
assert.ok(/require\('\.\/renderer\/bridge-shape\.js'\)/.test(read('preload.js')), 'preload builds from bridge-shape.js');
assert.ok(/sandbox: false/.test(read('main/main.js')), 'BrowserWindow must set sandbox: false while preload.js requires a project file');
console.log(`service tests passed (${svc.handlers.size} core handlers, ${electronOnly.size} electron-only, ${events.size} events)`);
