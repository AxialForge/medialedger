'use strict';
// Settings live in a JSON file under the Electron userData folder.
// Nothing here touches the network or a server; it is plain file IO.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  roots: [
    { id: 'movies', label: 'Movies', path: '\\\\192.168.1.204\\Apocrypha_Media_Pool\\Movies', type: 'movie', enabled: true },
    { id: 'anime', label: 'Anime', path: '\\\\192.168.1.204\\Apocrypha_Media_Pool\\Anime', type: 'anime', enabled: true },
    { id: 'tv', label: 'TV Shows', path: '\\\\192.168.1.204\\Apocrypha_Media_Pool\\TV_Shows', type: 'tv', enabled: true },
  ],
  ffprobePath: '',            // empty = auto-detect
  probeConcurrency: 8,        // parallel ffprobe processes (SMB is the bottleneck)
  reprobeUnchanged: false,    // true = re-run ffprobe even if size+mtime unchanged
  multiThreaded: true,        // walk roots with worker threads (scanThreads of them)
  scanThreads: 0,             // 0 = auto (CPU count - 1, min 2, max 32)
  updates: { enabled: true }, // silent auto-update from GitHub Releases (installed app only)
  githubToken: '',            // only needed while the GitHub repo is private
  videoExtensions: ['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm', 'flv', 'mpg', 'mpeg'],
  subtitleExtensions: ['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'sup'],
  ignorePatterns: ['*.crdownload', '*.part', '*.!qb', 'Thumbs.db', 'desktop.ini', '.DS_Store'],
  csvOutputDir: '',           // empty = <userData>/exports
  autoExportAfterScan: true,
  schedule: {
    inAppEnabled: false,
    inAppIntervalHours: 24,
    taskSchedulerEnabled: false,
    taskTime: '03:00',        // HH:MM local, daily
    taskName: 'MediaLedger Scan',
  },
  plex: {                     // reserved for the later Plex integration
    enabled: false,
    baseUrl: 'http://127.0.0.1:32400',
    token: '',
  },
  ui: { theme: 'dark' },
};

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.data = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return deepMerge(structuredClone(DEFAULTS), raw);
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  get() { return this.data; }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }

  replace(next) {
    this.data = deepMerge(structuredClone(DEFAULTS), next);
    this.save();
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object') {
    const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
    for (const k of Object.keys(patch)) out[k] = deepMerge(out[k], patch[k]);
    return out;
  }
  return patch === undefined ? base : patch;
}

module.exports = { Settings, DEFAULTS };
