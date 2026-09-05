'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (fn) => { const l = (_e, p) => fn(p); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); };

contextBridge.exposeInMainWorld('ledger', {
  appInfo: invoke('app:info'),
  settings: { get: invoke('settings:get'), set: invoke('settings:set'), replace: invoke('settings:replace') },
  pickFolder: invoke('dialog:pickFolder'),
  pickFile: invoke('dialog:pickFile'),
  openPath: invoke('shell:open'),
  openExternal: invoke('shell:openExternal'),
  showItem: invoke('shell:showItem'),
  scan: { start: invoke('scan:start'), cancel: invoke('scan:cancel'), status: invoke('scan:status'), list: invoke('scan:list'), onProgress: listen('scan:progress') },
  exportCsv: invoke('export:run'),
  exportList: invoke('export:list'),
  schedule: { taskStatus: invoke('schedule:taskStatus'), installTask: invoke('schedule:installTask'), removeTask: invoke('schedule:removeTask'), runTaskNow: invoke('schedule:runTaskNow'), nextInApp: invoke('schedule:nextInApp') },
  ffmpeg: { download: invoke('ffmpeg:download'), onProgress: listen('ffmpeg:progress') },
  update: { check: invoke('update:check'), install: invoke('update:install'), status: invoke('update:status'), onStatus: listen('update:status') },
  db: { backup: invoke('db:backup'), backups: invoke('db:backups'), stats: invoke('db:stats') },
  plexTest: invoke('plex:test'),
  override: { list: invoke('override:list'), save: invoke('override:save'), delete: invoke('override:delete'), suggest: invoke('override:suggest') },
  data: {
    dashboard: invoke('data:dashboard'), series: invoke('data:series'), episodes: invoke('data:episodes'),
    movies: invoke('data:movies'), movieFiles: invoke('data:movieFiles'), changes: invoke('data:changes'), changeStats: invoke('data:changeStats'),
    search: invoke('data:search'), problems: invoke('data:problems'), purgeMissing: invoke('data:purgeMissing'),
  },
});
