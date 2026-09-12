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
  watchStatus: invoke('watch:status'),
  ffmpeg: { download: invoke('ffmpeg:download'), onProgress: listen('ffmpeg:progress') },
  update: { check: invoke('update:check'), install: invoke('update:install'), status: invoke('update:status'), onStatus: listen('update:status') },
  db: { backup: invoke('db:backup'), backups: invoke('db:backups'), stats: invoke('db:stats') },
  plexTest: invoke('plex:test'),
  override: { list: invoke('override:list'), bulkSource: invoke('override:bulkSource'), save: invoke('override:save'), delete: invoke('override:delete'), suggest: invoke('override:suggest') },
  meta: { refresh: invoke('meta:refresh'), status: invoke('meta:status'), get: invoke('meta:get'), search: invoke('meta:search'), setMatch: invoke('meta:setMatch'), setManual: invoke('meta:setManual'), setNone: invoke('meta:setNone'), unlock: invoke('meta:unlock'), onProgress: listen('meta:progress') },
  dup: { keep: invoke('dup:keep'), clear: invoke('dup:clear') },
  rename: { proposals: invoke('rename:proposals'), apply: invoke('rename:apply'), history: invoke('rename:history') },
  adult: { status: invoke('adult:status'), toggle: invoke('adult:toggle'), dashboard: invoke('adult:dashboard') },
  ratings: { list: invoke('ratings:list'), setUser: invoke('ratings:setUser') },
  web: { channels: invoke('web:channels'), videos: invoke('web:videos') },
  movie: { plan: invoke('movie:plan'), run: invoke('movie:run'), undo: invoke('movie:undo'), batches: invoke('movie:batches'), batchItems: invoke('movie:batchItems'), onProgress: listen('movie:progress') },
  data: {
    dashboard: invoke('data:dashboard'), series: invoke('data:series'), episodes: invoke('data:episodes'),
    movies: invoke('data:movies'), movieFiles: invoke('data:movieFiles'), changes: invoke('data:changes'), changeStats: invoke('data:changeStats'),
    search: invoke('data:search'), problems: invoke('data:problems'), purgeMissing: invoke('data:purgeMissing'),
    missing: invoke('data:missing'), duplicates: invoke('data:duplicates'), quality: invoke('data:quality'),
  },
});
