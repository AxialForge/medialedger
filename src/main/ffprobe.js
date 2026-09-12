'use strict';
// Locates ffprobe.exe and turns its JSON output into the flat record the DB stores.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findFfprobe(configured) {
  const candidates = [];
  if (configured) candidates.push(configured);
  if (process.platform !== 'win32') {
    for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', ...(process.env.PATH || '').split(path.delimiter)]) candidates.push(path.join(dir, 'ffprobe'));
    for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
    return null;
  }
  // Common Windows install spots
  const roots = ['C:\\ffmpeg', 'C:\\Program Files\\ffmpeg', 'C:\\Program Files (x86)\\ffmpeg', 'C:\\tools\\ffmpeg'];
  for (const r of roots) {
    try {
      candidates.push(path.join(r, 'bin', 'ffprobe.exe'));
      for (const d of fs.readdirSync(r, { withFileTypes: true })) {
        if (d.isDirectory()) candidates.push(path.join(r, d.name, 'bin', 'ffprobe.exe'));
      }
    } catch { /* not present */ }
  }
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'));
  candidates.push(path.join(os.homedir(), 'scoop', 'shims', 'ffprobe.exe'));
  for (const c of candidates) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  // Fall back to PATH
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const c = path.join(dir, 'ffprobe.exe');
    try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

function probe(ffprobePath, file, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file];
    execFile(ffprobePath, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ probe_ok: 0, probe_error: (stderr || err.message || 'ffprobe failed').trim().slice(0, 500) });
      try {
        resolve(normalise(JSON.parse(stdout)));
      } catch (e) {
        resolve({ probe_ok: 0, probe_error: 'bad ffprobe json: ' + e.message });
      }
    });
  });
}

function parseFps(s) {
  if (!s || s === '0/0') return null;
  const [a, b] = s.split('/').map(Number);
  if (!b) return a || null;
  return Math.round((a / b) * 1000) / 1000;
}

function resolutionLabel(w, h) {
  if (!w || !h) return null;
  if (w >= 3800 || h >= 2100) return '4K';
  if (w >= 2500 || h >= 1400) return '1440p';
  if (w >= 1900 || h >= 1000) return '1080p';
  if (w >= 1260 || h >= 700) return '720p';
  if (h >= 560) return '576p';
  if (h >= 470) return '480p';
  return 'SD';
}

function hdrLabel(v) {
  const t = (v.color_transfer || '').toLowerCase();
  const p = (v.color_primaries || '').toLowerCase();
  if (v.side_data_list && v.side_data_list.some(s => /dovi|dolby vision/i.test(s.side_data_type || ''))) return 'Dolby Vision';
  if (t === 'smpte2084') return 'HDR10';
  if (t === 'arib-std-b67') return 'HLG';
  if (p === 'bt2020') return 'BT.2020';
  return 'SDR';
}

function containerLabel(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('matroska')) return 'mkv';
  if (n.includes('mp4')) return 'mp4';
  if (n.includes('avi')) return 'avi';
  if (n.includes('mpegts')) return 'ts';
  if (n.includes('webm')) return 'webm';
  return n.split(',')[0];
}

function normalise(j) {
  const streams = j.streams || [];
  const fmt = j.format || {};
  const v = streams.find(s => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audio = streams.filter(s => s.codec_type === 'audio');
  const subs = streams.filter(s => s.codec_type === 'subtitle');

  const lang = s => (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und';
  const uniq = arr => [...new Set(arr.filter(Boolean))];

  const width = v ? Number(v.width) || null : null;
  const height = v ? Number(v.height) || null : null;
  const dur = Number(fmt.duration) || (v && Number(v.duration)) || null;

  return {
    probe_ok: 1,
    probe_error: null,
    container: containerLabel(fmt.format_name),
    duration_s: dur ? Math.round(dur * 100) / 100 : null,
    bitrate_kbps: fmt.bit_rate ? Math.round(Number(fmt.bit_rate) / 1000) : null,
    width, height,
    resolution: resolutionLabel(width, height),
    fps: v ? (parseFps(v.avg_frame_rate) || parseFps(v.r_frame_rate)) : null,
    video_codec: v ? v.codec_name : null,
    video_profile: v ? v.profile || null : null,
    bit_depth: v ? (Number(v.bits_per_raw_sample) || (/(10|12)(le|be)?$/.test(v.pix_fmt || '') ? Number(RegExp.$1) : 8)) : null,
    hdr: v ? hdrLabel(v) : null,
    audio_count: audio.length,
    audio_codecs: uniq(audio.map(a => a.codec_name)).join(';') || null,
    audio_langs: uniq(audio.map(lang)).join(';') || null,
    audio_channels: uniq(audio.map(a => a.channel_layout || String(a.channels))).join(';') || null,
    sub_count: subs.length,
    sub_codecs: uniq(subs.map(s => s.codec_name)).join(';') || null,
    sub_langs: uniq(subs.map(lang)).join(';') || null,
    sub_forced: subs.some(s => s.disposition && s.disposition.forced) ? 1 : 0,
  };
}

module.exports = { findFfprobe, probe, resolutionLabel };
