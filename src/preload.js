'use strict';
// Desktop bridge: builds window.ledger from bridge-shape.js over Electron IPC.
// The web server builds the same object from the same shape in renderer/webbridge.js.
const { contextBridge, ipcRenderer } = require('electron');
const shape = require('./renderer/bridge-shape.js');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (fn) => { const l = (_e, p) => fn(p); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); };

function build(node) {
  if (typeof node === 'string') return node.startsWith('!') ? listen(node.slice(1)) : invoke(node);
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = build(v);
  return out;
}

contextBridge.exposeInMainWorld('ledger', build(shape));
