'use strict';
// Worker thread: walks one or more directories (readdir + stat) and parses the
// file names, returning plain objects to the main thread. Several of these run
// in parallel so SMB round-trips overlap instead of queueing behind one thread.
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { parseFor } = require('./parse');

const { videoExt, subExt, ignore, statConcurrency } = workerData;
const videoSet = new Set(videoExt);
const subSet = new Set(subExt);
const ignoreRes = ignore.map(g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));

async function walkJob(job) {
  // job: { rootPath, rootType, startRel }  → walks rootPath\startRel recursively
  const videos = [], sidecars = [], errors = [];
  const dirs = [job.startRel];
  const pending = [];
  const statOne = async (abs, rel, name, ext) => {
    try {
      const st = await fsp.stat(abs);
      const parsed = parseFor(job.rootType, rel, workerData.adultDefault);
      videos.push({ rel, abs, ext, name, size: st.size, mtime: Math.floor(st.mtimeMs), parsed });
    } catch (e) { errors.push({ rel, message: 'stat failed: ' + e.message }); }
  };
  let active = 0; const queue = [];
  const schedule = fn => new Promise(res => { const run = async () => { active++; try { await fn(); } finally { active--; res(); if (queue.length) queue.shift()(); } }; if (active < statConcurrency) run(); else queue.push(run); });

  if (job.files) {
    // Explicit list of loose files directly under the root (flat Movies folder).
    for (const name of job.files) {
      const ext = path.extname(name).slice(1).toLowerCase();
      if (videoSet.has(ext)) pending.push(schedule(() => statOne(path.join(job.rootPath, name), name, name, ext)));
      else if (subSet.has(ext)) { const base = name.replace(/\.[^.]+$/, ''); sidecars.push({ key: ('|' + base.replace(/\.(eng|en|jpn|ja|jp|spa|es|fre|fr|ger|de|forced|sdh|cc)(\.[a-z]{2,6})*$/i, '')).toLowerCase(), name }); }
    }
    dirs.length = 0;
  }
  while (dirs.length) {
    const rel = dirs.shift();
    const abs = rel ? path.join(job.rootPath, rel) : job.rootPath;
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); }
    catch (e) { errors.push({ rel, message: 'readdir failed: ' + e.message }); continue; }
    for (const d of entries) {
      if (ignoreRes.some(re => re.test(d.name))) continue;
      const r = rel ? rel + '\\' + d.name : d.name;
      if (d.isDirectory()) { dirs.push(r); continue; }
      if (!d.isFile()) continue;
      const ext = path.extname(d.name).slice(1).toLowerCase();
      if (videoSet.has(ext)) pending.push(schedule(() => statOne(path.join(abs, d.name), r, d.name, ext)));
      else if (subSet.has(ext)) {
        const base = d.name.replace(/\.[^.]+$/, '');
        const stem = base.replace(/\.(eng|en|jpn|ja|jp|spa|es|fre|fr|ger|de|forced|sdh|cc)(\.[a-z]{2,6})*$/i, '');
        sidecars.push({ key: (rel + '|' + stem).toLowerCase(), name: d.name });
      }
    }
    if (videos.length && videos.length % 200 === 0) parentPort.postMessage({ type: 'progress', count: videos.length });
  }
  await Promise.all(pending);
  return { videos, sidecars, errors };
}

parentPort.on('message', async (msg) => {
  if (msg.type === 'walk') {
    try { const r = await walkJob(msg.job); parentPort.postMessage({ type: 'result', id: msg.id, ...r }); }
    catch (e) { parentPort.postMessage({ type: 'result', id: msg.id, videos: [], sidecars: [], errors: [{ rel: msg.job.startRel, message: e.message }] }); }
  } else if (msg.type === 'exit') {
    process.exit(0);
  }
});
