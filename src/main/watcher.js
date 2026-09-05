'use strict';
// Watch each enabled root with fs.watch (recursive works on Windows, including
// UNC paths) and trigger a scan once changes have settled for N seconds.
// Off by default; a setting turns it on. A watcher that dies (share offline)
// is retried every minute.
const fs = require('fs');

class Watcher {
  constructor(settings, runScan, log) {
    this.settings = settings;
    this.runScan = runScan;
    this.log = log || (() => {});
    this.watchers = new Map();   // root.id -> fs.FSWatcher
    this.timer = null;
    this.retry = null;
    this.pending = 0;
    this.lastEvent = null;
    this.videoExt = null;
  }

  status() {
    const s = this.settings.get();
    return { enabled: !!s.watchFolders, roots: [...this.watchers.keys()], pending: this.pending, lastEvent: this.lastEvent, settleSeconds: s.watchSettleSeconds };
  }

  apply() {
    const s = this.settings.get();
    if (!s.watchFolders) { this.stop(); return; }
    this.videoExt = new Set(s.videoExtensions.map(e => '.' + e.toLowerCase()));
    const want = new Map(s.roots.filter(r => r.enabled).map(r => [r.id, r]));
    for (const id of [...this.watchers.keys()]) if (!want.has(id)) this._close(id);
    for (const [id, root] of want) if (!this.watchers.has(id)) this._open(root);
    if (!this.retry) this.retry = setInterval(() => this.apply(), 60 * 1000);
  }

  stop() {
    for (const id of [...this.watchers.keys()]) this._close(id);
    if (this.retry) clearInterval(this.retry); this.retry = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
  }

  _open(root) {
    try {
      const w = fs.watch(root.path, { recursive: true, persistent: false }, (_ev, name) => this._onEvent(root, name));
      w.on('error', e => { this.log(`watch ${root.label} error: ${e.message}`); this._close(root.id); });
      this.watchers.set(root.id, w);
      this.log(`watching ${root.label}`);
    } catch (e) {
      this.log(`watch ${root.label} failed: ${e.message}`);
    }
  }
  _close(id) { const w = this.watchers.get(id); if (w) { try { w.close(); } catch { /* ignore */ } } this.watchers.delete(id); }

  _onEvent(root, name) {
    if (!name) return;
    const lower = String(name).toLowerCase();
    // Only care about video files (and their folders appearing); ignore posters, nfo, partial downloads.
    if (/\.(crdownload|part|!qb|tmp|jpg|png|nfo|txt|srt|ass)$/i.test(lower)) return;
    const dot = lower.lastIndexOf('.');
    if (dot > -1 && this.videoExt && !this.videoExt.has(lower.slice(dot)) && lower.slice(dot).length <= 5) return;
    this.pending++;
    this.lastEvent = { ts: new Date().toISOString(), root: root.label, name: String(name) };
    const settle = Math.max(15, Number(this.settings.get().watchSettleSeconds) || 90) * 1000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const n = this.pending; this.pending = 0;
      this.log(`watch: ${n} change(s) settled, starting scan`);
      this.runScan('watch').catch(e => this.log('watch scan failed: ' + e.message));
    }, settle);
  }
}

module.exports = { Watcher };
