'use strict';
// Settings live in a JSON file under the Electron userData folder.
// Nothing here touches the network or a server; it is plain file IO.
const fs = require('fs');
const path = require('path');

// Windows talks to the share by UNC path; the Linux server sees it where fstab mounted it.
const SHARE = process.platform === 'win32' ? '\\\\192.168.1.204\\Apocrypha_Media_Pool\\' : '/mnt/media/';
const DEFAULTS = {
  roots: [
    { id: 'movies', label: 'Movies', path: SHARE + 'Movies', type: 'movie', enabled: true },
    { id: 'anime', label: 'Anime', path: SHARE + 'Anime', type: 'anime', enabled: true },
    { id: 'tv', label: 'TV Shows', path: SHARE + 'TV_Shows', type: 'tv', enabled: true },
  ],
  adult: { exportCsv: false, defaultSubtype: 'anime' }, // adult roots: hidden by default (runtime toggle), kept out of CSVs unless allowed
  ffprobePath: '',            // empty = auto-detect
  probeConcurrency: 8,        // parallel ffprobe processes (SMB is the bottleneck)
  reprobeUnchanged: false,    // true = re-run ffprobe even if size+mtime unchanged
  multiThreaded: true,        // walk roots with worker threads (scanThreads of them)
  scanThreads: 0,             // 0 = auto (CPU count - 1, min 2, max 32)
  updates: { enabled: true }, // silent auto-update from GitHub Releases (installed app only)
  metadata: {                 // expected episode counts (free, keyless APIs)
    enabled: true,
    tvSource: 'tvmaze',       // TV shows → TVmaze
    animeSource: 'anilist',   // Anime → AniList
    refreshDays: 14,          // re-fetch series that are still airing after this many days
  },
  rootCheckMinutes: 5,        // periodic reachability check of every enabled root; 0 = off (Settings badge + toast when one disappears)
  rootCheckMinutes: 5,        // periodic reachability check of every enabled root; 0 = off (Settings badge + toast when one disappears)
  watchFolders: false,        // fs.watch on each root; triggers a scan after changes settle
  watchSettleSeconds: 90,
  renaming: { enabled: false, template: 'plex' }, // opt-in rename tool for TV/anime (writes to the share!)
  movieRename: {              // movie naming engine tab
    enabled: false,           // "Allow live renames" switch; dry runs always work
    layout: 'inplace',        // inplace | folders
    batchLimit: 200,
    truth: 'parser',          // parser | plex  — where Title/Year come from
  },
  quality: {                  // low-bitrate thresholds in kbps by resolution label
    minKbps: { '4K': 6000, '1440p': 3000, '1080p': 1500, '720p': 700, '576p': 400, '480p': 350, SD: 250 },
  },
  githubToken: '',            // only needed while the GitHub repo is private
  videoExtensions: ['mp4', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'ts', 'webm', 'flv', 'mpg', 'mpeg'],
  subtitleExtensions: ['srt', 'ass', 'ssa', 'sub', 'idx', 'vtt', 'sup'],
  ignorePatterns: ['*.crdownload', '*.part', '*.!qb', 'Thumbs.db', 'desktop.ini', '.DS_Store'],
  export: { sets: ['tv', 'anime', 'movies', 'web', 'changes'], zip: false, zipMin: 4 }, // which CSV sets an export writes; zip them when at least zipMin files were written
  csvOutputDir: '',           // empty = <userData>/exports
  autoExportAfterScan: true,
  schedule: {
    inAppEnabled: false,
    inAppIntervalHours: 24,
    taskSchedulerEnabled: false,
    taskTime: '03:00',        // HH:MM local, daily
    taskName: 'MediaLedger Scan',
  },
  plex: {
    enabled: false,           // sync after every scan
    baseUrl: 'http://192.168.1.204:32400',
    token: '',
    pathMap: [],              // [{ plex: '/media', local: '\\\\nas\\share' }]; derived automatically on first sync
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
