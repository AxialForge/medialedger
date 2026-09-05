'use strict';
// Two scheduling paths:
//   1. In-app timer: fires while MediaLedger is open.
//   2. Windows Task Scheduler: a daily task that launches the app with --scan,
//      which either runs headless or hands the request to the already-open window.
const { execFile } = require('child_process');
const path = require('path');

function schtasks(args) {
  return new Promise((resolve) => {
    execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err && err.message || '') });
    });
  });
}

function scanCommand(app) {
  // Packaged: "MediaLedger.exe" --scan.  Dev: "electron.exe" "<app dir>" --scan
  if (app.isPackaged) return `"${process.execPath}" --scan`;
  return `"${process.execPath}" "${app.getAppPath()}" --scan`;
}

class Scheduler {
  constructor(app, settings, runScan) {
    this.app = app;
    this.settings = settings;
    this.runScan = runScan;       // (trigger) => Promise
    this.timer = null;
    this.lastRun = 0;
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 60 * 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  noteRun() { this.lastRun = Date.now(); }

  async tick() {
    const s = this.settings.get().schedule;
    if (!s.inAppEnabled) return;
    const every = Math.max(0.25, Number(s.inAppIntervalHours) || 24) * 3600 * 1000;
    if (Date.now() - this.lastRun < every) return;
    this.lastRun = Date.now();
    try { await this.runScan('timer'); } catch { /* logged by scanner */ }
  }

  nextInAppRun() {
    const s = this.settings.get().schedule;
    if (!s.inAppEnabled) return null;
    const every = Math.max(0.25, Number(s.inAppIntervalHours) || 24) * 3600 * 1000;
    return new Date(this.lastRun + every).toISOString();
  }

  // ---- Windows Task Scheduler --------------------------------------------
  async taskStatus() {
    const name = this.settings.get().schedule.taskName;
    const r = await schtasks(['/Query', '/TN', name, '/FO', 'LIST', '/V']);
    if (!r.ok) return { exists: false };
    const pick = label => { const m = r.stdout.match(new RegExp('^' + label + ':\\s*(.+)$', 'mi')); return m ? m[1].trim() : null; };
    return { exists: true, status: pick('Status'), nextRun: pick('Next Run Time'), lastRun: pick('Last Run Time'), lastResult: pick('Last Result'), command: pick('Task To Run') };
  }

  async installTask() {
    const s = this.settings.get().schedule;
    const time = /^\d{2}:\d{2}$/.test(s.taskTime) ? s.taskTime : '03:00';
    const r = await schtasks(['/Create', '/F', '/TN', s.taskName, '/SC', 'DAILY', '/ST', time, '/TR', scanCommand(this.app)]);
    return { ok: r.ok, message: (r.stdout || r.stderr).trim(), command: scanCommand(this.app) };
  }

  async removeTask() {
    const s = this.settings.get().schedule;
    const r = await schtasks(['/Delete', '/F', '/TN', s.taskName]);
    return { ok: r.ok, message: (r.stdout || r.stderr).trim() };
  }

  async runTaskNow() {
    const s = this.settings.get().schedule;
    const r = await schtasks(['/Run', '/TN', s.taskName]);
    return { ok: r.ok, message: (r.stdout || r.stderr).trim() };
  }
}

module.exports = { Scheduler, scanCommand };
