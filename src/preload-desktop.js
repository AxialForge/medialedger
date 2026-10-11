'use strict';
// Preload for the desktop window when it shows a server's pages (connect-to-server mode). The page itself comes
// from the Pi and builds window.ledger over HTTP as a browser would; this adds the few things only a desktop can
// do: open a file's folder in Explorer (with the server's path mapped to one this PC can reach), and switch the
// window between the server and this computer's own library. Nothing else from Electron reaches the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ledgerDesktop', {
  reveal: (p) => ipcRenderer.invoke('desktop:reveal', String(p || '')),
  open: (p) => ipcRenderer.invoke('desktop:open', String(p || '')),
  client: { get: () => ipcRenderer.invoke('client:get'), set: (o) => ipcRenderer.invoke('client:set', o) },
});
