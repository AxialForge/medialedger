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
const bridge = new Set([...read('preload.js').matchAll(/(?:invoke|listen)\('([a-zA-Z]+:[a-zA-Z]+)'\)/g)].map(m => m[1]));
const events = new Set([...read('preload.js').matchAll(/listen\('([a-zA-Z]+:[a-zA-Z]+)'\)/g)].map(m => m[1]));
const electronOnly = new Set([...read('main/main.js').matchAll(/^\s*h\('([a-zA-Z]+:[a-zA-Z]+)'/gm)].map(m => m[1]));
const served = new Set([...svc.handlers.keys(), ...electronOnly]);
for (const ch of bridge) if (!events.has(ch)) assert.ok(served.has(ch), `bridge calls ${ch} but nothing serves it`);
for (const ch of served) assert.ok(bridge.has(ch), `${ch} is served but the bridge never calls it`);

console.log(`service tests passed (${svc.handlers.size} core handlers, ${electronOnly.size} electron-only, ${events.size} events)`);
