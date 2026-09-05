'use strict';
// Downloads a Windows ffmpeg build and extracts ffprobe.exe (and ffmpeg.exe) into
// <userData>\tools. Used when no ffprobe is found on the machine. Extraction uses
// PowerShell's Expand-Archive so no zip library is needed.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// BtbN's GitHub builds are the canonical "latest static win64" ffmpeg.
const FFMPEG_ZIP_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';

function toolsDir(userData) { return path.join(userData, 'tools'); }
function installedFfprobe(userData) {
  const p = path.join(toolsDir(userData), 'ffprobe.exe');
  try { return fs.statSync(p).isFile() ? p : null; } catch { return null; }
}

function ps(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', args], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 400)));
      resolve(String(stdout));
    });
  });
}

async function downloadFfmpeg(userData, onProgress = () => {}) {
  const dir = toolsDir(userData);
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, 'ffmpeg.zip');
  const extractDir = path.join(dir, '_extract');

  onProgress({ phase: 'download', percent: 0, message: 'Contacting GitHub…' });
  const res = await fetch(FFMPEG_ZIP_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, lastPct = -1;
  const out = fs.createWriteStream(zip);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
    const pct = total ? Math.floor(got / total * 100) : 0;
    if (pct !== lastPct) { lastPct = pct; onProgress({ phase: 'download', percent: pct, message: `Downloading ffmpeg… ${(got / 1048576).toFixed(0)} MB${total ? ' / ' + (total / 1048576).toFixed(0) + ' MB' : ''}` }); }
  }
  await new Promise((r, j) => out.end(err => err ? j(err) : r()));

  onProgress({ phase: 'extract', percent: 100, message: 'Extracting…' });
  fs.rmSync(extractDir, { recursive: true, force: true });
  await ps(`Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`);

  const found = {};
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/^ff(probe|mpeg)\.exe$/i.test(e.name)) found[e.name.toLowerCase()] = p; } };
  walk(extractDir);
  if (!found['ffprobe.exe']) throw new Error('ffprobe.exe not found inside the archive');
  for (const name of Object.keys(found)) fs.copyFileSync(found[name], path.join(dir, name));
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  onProgress({ phase: 'done', percent: 100, message: 'ffprobe installed' });
  return path.join(dir, 'ffprobe.exe');
}

function ffprobeVersion(ffprobePath) {
  return new Promise(resolve => {
    if (!ffprobePath) return resolve(null);
    execFile(ffprobePath, ['-version'], { windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).split('\n')[0].trim()));
  });
}

module.exports = { downloadFfmpeg, installedFfprobe, ffprobeVersion, FFMPEG_ZIP_URL, toolsDir };
