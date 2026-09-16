// The one description of the `window.ledger` API the renderer uses.
//
// Leaves are channel names. A leaf starting with "!" is an event stream the
// UI subscribes to (onProgress / onStatus); everything else is a request.
// preload.js turns this into ipcRenderer calls for the desktop app and
// webbridge.js turns it into fetch + EventSource for the web server, so the
// renderer code is identical in both shells. test/service.test.js checks that
// every request channel here is served by the core or by a shell.
//
// Plain script on purpose: loaded with require() by preload.js and with a
// <script> tag by the browser build.
(function (root, shape) {
  if (typeof module !== 'undefined' && module.exports) module.exports = shape;
  else root.LEDGER_SHAPE = shape;
})(typeof self !== 'undefined' ? self : this, {
  appInfo: 'app:info',
  settings: { get: 'settings:get', set: 'settings:set', replace: 'settings:replace' },
  pickFolder: 'dialog:pickFolder',
  pickFile: 'dialog:pickFile',
  openPath: 'shell:open',
  openExternal: 'shell:openExternal',
  showItem: 'shell:showItem',
  scan: { start: 'scan:start', cancel: 'scan:cancel', status: 'scan:status', list: 'scan:list', onProgress: '!scan:progress' },
  exportCsv: 'export:run',
  exportSets: 'export:sets',
  exportList: 'export:list',
  schedule: { taskStatus: 'schedule:taskStatus', installTask: 'schedule:installTask', removeTask: 'schedule:removeTask', runTaskNow: 'schedule:runTaskNow', nextInApp: 'schedule:nextInApp' },
  watchStatus: 'watch:status',
  ffmpeg: { download: 'ffmpeg:download', onProgress: '!ffmpeg:progress' },
  update: { check: 'update:check', install: 'update:install', status: 'update:status', onStatus: '!update:status' },
  db: { backup: 'db:backup', backups: 'db:backups', stats: 'db:stats' },
  sys: { stats: 'sys:stats' },
  roots: { check: 'roots:check', listDirs: 'roots:listDirs', last: 'roots:last', onStatus: '!roots:status' },
  security: { me: 'security:me', status: 'security:status', changePassword: 'security:changePassword', totpSetup: 'security:totpSetup', totpEnable: 'security:totpEnable', totpDisable: 'security:totpDisable', setOptions: 'security:setOptions', revoke: 'security:revoke', revokeOthers: 'security:revokeOthers', users: 'security:users', addUser: 'security:addUser', setRole: 'security:setRole', resetPassword: 'security:resetPassword', deleteUser: 'security:deleteUser', tlsEnable: 'security:tlsEnable' },
  requests: { list: 'requests:list', add: 'requests:add', update: 'requests:update', delete: 'requests:delete' },
  plexTest: 'plex:test',
  plex: { sync: 'plex:sync', status: 'plex:status', onProgress: '!plex:progress', webhookInfo: 'plex:webhookInfo', webhookSet: 'plex:webhookSet' },
  override: { list: 'override:list', bulkSource: 'override:bulkSource', save: 'override:save', delete: 'override:delete', suggest: 'override:suggest' },
  meta: { refresh: 'meta:refresh', status: 'meta:status', get: 'meta:get', search: 'meta:search', setMatch: 'meta:setMatch', setManual: 'meta:setManual', setNone: 'meta:setNone', unlock: 'meta:unlock', onProgress: '!meta:progress' },
  dup: { keep: 'dup:keep', clear: 'dup:clear' },
  rename: { proposals: 'rename:proposals', apply: 'rename:apply', dry: 'rename:dry', history: 'rename:history' },
  adult: { status: 'adult:status', toggle: 'adult:toggle', dashboard: 'adult:dashboard' },
  ratings: { list: 'ratings:list', setUser: 'ratings:setUser' },
  tags: { list: 'tags:list', all: 'tags:all', get: 'tags:get', add: 'tags:add', remove: 'tags:remove' },
  tonight: 'data:tonight', storage: 'data:storage', backupTo: 'db:backupTo', airing: 'data:airing', upgrades: 'data:upgrades', notifyTest: 'notify:test', statusJson: 'data:status',
  status: { info: 'status:info', rotate: 'status:rotate' },
  prefs: { get: 'prefs:get', set: 'prefs:set' }, snapshots: 'data:snapshots', snapshotNow: 'data:snapshotNow',
  web: { channels: 'web:channels', videos: 'web:videos' },
  movie: { plan: 'movie:plan', run: 'movie:run', undo: 'movie:undo', batches: 'movie:batches', batchItems: 'movie:batchItems', onProgress: '!movie:progress' },
  data: {
    dashboard: 'data:dashboard', series: 'data:series', episodes: 'data:episodes',
    movies: 'data:movies', movieFiles: 'data:movieFiles', changes: 'data:changes', changeStats: 'data:changeStats',
    search: 'data:search', problems: 'data:problems', purgeMissing: 'data:purgeMissing',
    missing: 'data:missing', duplicates: 'data:duplicates', quality: 'data:quality',
  },
});
