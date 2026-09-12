'use strict';
// Movie rename batch executor. Turns a plan from movieNamer into journaled,
// verified file operations. Safety model (agreed 2026-09-06):
//
//   dry-run is the default   — a batch runs as a simulation unless `live: true`
//   pre-flight               — every item is checked BEFORE anything is touched;
//                              one failure aborts the whole batch (nothing renamed)
//   post-verify              — after each operation the target is re-stat'ed and
//                              its size compared; only then is the database updated
//   journal                  — every item is written to rename_items before and
//                              after; the batch can be undone item by item
//   lock                     — the caller holds an exclusive lock on the Movies
//                              root while a live batch runs (scanner + watcher wait)
//
// Layouts:
//   inplace  — rename within the current folder (fs.rename, atomic on the same volume)
//   folders  — move into "Title (Year)\" beneath the root: copy → verify size and
//              head/tail hash → delete source. Never a bare cross-folder move.
const fs = require('fs');
const path = require('path');
const { absOf } = require('./paths');
const crypto = require('crypto');

const SAMPLE = 4 * 1024 * 1024; // hash the first and last 4 MB (a 20 GB remux over SMB is not re-read in full)

function sampleHash(file, size) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(SAMPLE, size));
    fs.readSync(fd, head, 0, head.length, 0); h.update(head);
    if (size > SAMPLE) { const tail = Buffer.alloc(Math.min(SAMPLE, size - SAMPLE)); fs.readSync(fd, tail, 0, tail.length, size - tail.length); h.update(tail); }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function targetFor(item, layout, rootPath) {
  // item: { abs_path, rel_path, dir, name, tokens }
  if (layout === 'folders') {
    const folder = `${item.tokens.title} (${item.tokens.year})`;
    return { to_rel: folder + '\\' + item.name, to_abs: absOf(rootPath, folder + '\\' + item.name) };
  }
  return { to_rel: (item.dir ? item.dir + '\\' : '') + item.name, to_abs: path.join(path.dirname(item.abs_path), item.name) };
}

function writeProbe(dir) {
  const p = path.join(dir, `.medialedger-write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(p, 'ok'); fs.unlinkSync(p);
}

/**
 * Pre-flight every item. Returns { ok, problems: [{id, from, reason}] }. Touches nothing except a write test.
 */
function preflight(items, rootPath, layout) {
  const problems = [];
  const targets = new Set();
  try { writeProbe(rootPath); } catch (e) { return { ok: false, problems: [{ id: null, from: rootPath, reason: 'root is not writable: ' + e.message }] }; }
  for (const it of items) {
    const { to_abs } = targetFor(it, layout, rootPath);
    let st;
    try { st = fs.statSync(it.abs_path); } catch { problems.push({ id: it.id, from: it.from, reason: 'source no longer exists' }); continue; }
    if (!st.isFile()) { problems.push({ id: it.id, from: it.from, reason: 'source is not a file' }); continue; }
    if (it.size != null && st.size !== it.size) { problems.push({ id: it.id, from: it.from, reason: `size changed since last scan (${it.size} → ${st.size}); rescan first` }); continue; }
    if (to_abs.toLowerCase() === it.abs_path.toLowerCase()) { problems.push({ id: it.id, from: it.from, reason: 'already has the proposed name' }); continue; }
    if (fs.existsSync(to_abs)) { problems.push({ id: it.id, from: it.from, reason: 'target already exists on disk' }); continue; }
    const key = to_abs.toLowerCase();
    if (targets.has(key)) { problems.push({ id: it.id, from: it.from, reason: 'two items in this batch share a target' }); continue; }
    targets.add(key);
    if (to_abs.length > 255) { problems.push({ id: it.id, from: it.from, reason: 'target path longer than 255 characters' }); continue; }
  }
  return { ok: problems.length === 0, problems };
}

function moveVerified(from, to, size) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  const st = fs.statSync(to);
  if (st.size !== size) { fs.unlinkSync(to); throw new Error(`copy size mismatch (${size} → ${st.size})`); }
  if (sampleHash(from, size) !== sampleHash(to, size)) { fs.unlinkSync(to); throw new Error('copy hash mismatch'); }
  fs.unlinkSync(from);
}

/**
 * Run a batch. items come from movieNamer.planMovieNames() filtered to ok && !unchanged.
 * opts: { live: boolean, layout: 'inplace'|'folders', rootPath, limit, log, onProgress }
 * Returns { batchId, mode, status, done, failed, problems, results }
 */
function runBatch(db, items, opts) {
  const { live = false, layout = 'inplace', rootPath, limit = 200, log = () => {}, onProgress = () => {} } = opts;
  if (!rootPath) throw new Error('rootPath required');
  if (items.length > limit) throw new Error(`Batch has ${items.length} files; the limit is ${limit}. Select fewer files or raise the limit in the tab.`);
  const mode = live ? 'live' : 'dry';
  const pf = preflight(items, rootPath, layout);
  const batchId = db.createBatch(mode, layout, pf.ok ? null : 'aborted in pre-flight');
  const results = [];
  if (!pf.ok) {
    for (const it of items) { const t = targetFor(it, layout, rootPath); db.addBatchItem({ batch_id: batchId, file_id: it.id, root_id: it.root_id, from_rel: it.rel_path, to_rel: t.to_rel, from_abs: it.abs_path, to_abs: t.to_abs, size: it.size, status: 'aborted', error: (pf.problems.find(p => p.id === it.id) || {}).reason || null }); }
    db.finishBatch(batchId, { status: 'aborted', planned: items.length, done: 0, failed: pf.problems.length });
    log(`movie rename batch #${batchId} (${mode}) aborted in pre-flight: ${pf.problems.length} problem(s)`);
    return { batchId, mode, status: 'aborted', done: 0, failed: pf.problems.length, problems: pf.problems, results };
  }
  let done = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const t = targetFor(it, layout, rootPath);
    const itemId = db.addBatchItem({ batch_id: batchId, file_id: it.id, root_id: it.root_id, from_rel: it.rel_path, to_rel: t.to_rel, from_abs: it.abs_path, to_abs: t.to_abs, size: it.size, status: live ? 'pending' : 'simulated' });
    if (!live) { done++; results.push({ id: it.id, from: it.from, to: t.to_rel, ok: true, simulated: true }); continue; }
    try {
      if (layout === 'folders' && path.dirname(t.to_abs).toLowerCase() !== path.dirname(it.abs_path).toLowerCase()) moveVerified(it.abs_path, t.to_abs, it.size);
      else fs.renameSync(it.abs_path, t.to_abs);
      // post-verify
      const st = fs.statSync(t.to_abs);
      if (st.size !== it.size) throw new Error(`post-rename size mismatch (${it.size} → ${st.size})`);
      if (fs.existsSync(it.abs_path) && it.abs_path.toLowerCase() !== t.to_abs.toLowerCase()) throw new Error('source still exists after rename');
      db.transaction(() => {
        db.run('UPDATE files SET rel_path=?, abs_path=?, file_name=? WHERE id=?', t.to_rel, t.to_abs, it.name, it.id);
        db.run('UPDATE overrides SET rel_path=? WHERE root_id=? AND rel_path=?', t.to_rel, it.root_id, it.rel_path);
        db.updateBatchItem(itemId, { status: 'done', ts: new Date().toISOString() });
      });
      done++;
      results.push({ id: it.id, from: it.from, to: t.to_rel, ok: true });
      log(`renamed "${it.rel_path}" → "${t.to_rel}"`);
    } catch (e) {
      failed++;
      db.updateBatchItem(itemId, { status: 'failed', error: e.message, ts: new Date().toISOString() });
      results.push({ id: it.id, from: it.from, to: t.to_rel, ok: false, error: e.message });
      log(`rename FAILED "${it.rel_path}": ${e.message}`);
      // A failure mid-batch stops the batch: the remaining items are left untouched and marked.
      for (const rest of items.slice(i + 1)) { const rt = targetFor(rest, layout, rootPath); db.addBatchItem({ batch_id: batchId, file_id: rest.id, root_id: rest.root_id, from_rel: rest.rel_path, to_rel: rt.to_rel, from_abs: rest.abs_path, to_abs: rt.to_abs, size: rest.size, status: 'skipped', error: 'batch stopped after an earlier failure' }); }
      break;
    }
    if (i % 5 === 0) onProgress({ done, total: items.length, current: it.from });
  }
  const status = failed ? 'stopped' : 'done';
  db.finishBatch(batchId, { status, planned: items.length, done, failed });
  log(`movie rename batch #${batchId} (${mode}, ${layout}): ${done} ${live ? 'renamed' : 'simulated'}, ${failed} failed`);
  return { batchId, mode, status, done, failed, problems: [], results };
}

/**
 * Undo a live batch: reverse each 'done' item whose target still exists with the recorded size
 * and whose original path is free. Never overwrites. Returns per-item results.
 */
function undoBatch(db, batchId, log = () => {}) {
  const batch = db.getBatch(batchId);
  if (!batch) throw new Error('No such batch');
  if (batch.mode !== 'live') throw new Error('Only live batches can be undone');
  const items = db.batchItems(batchId).filter(i => i.status === 'done').reverse();
  const results = [];
  let undone = 0;
  for (const it of items) {
    try {
      let st; try { st = fs.statSync(it.to_abs); } catch { throw new Error('renamed file no longer exists'); }
      if (it.size != null && st.size !== it.size) throw new Error(`size changed since the rename (${it.size} → ${st.size})`);
      if (fs.existsSync(it.from_abs) && it.from_abs.toLowerCase() !== it.to_abs.toLowerCase()) throw new Error('original name is now taken');
      if (path.dirname(it.from_abs).toLowerCase() !== path.dirname(it.to_abs).toLowerCase()) moveVerified(it.to_abs, it.from_abs, it.size);
      else fs.renameSync(it.to_abs, it.from_abs);
      const back = fs.statSync(it.from_abs);
      if (back.size !== it.size) throw new Error('post-undo size mismatch');
      const fromName = path.basename(it.from_abs);
      db.transaction(() => {
        db.run('UPDATE files SET rel_path=?, abs_path=?, file_name=? WHERE id=?', it.from_rel, it.from_abs, fromName, it.file_id);
        db.run('UPDATE overrides SET rel_path=? WHERE root_id=? AND rel_path=?', it.from_rel, it.root_id, it.to_rel);
        db.updateBatchItem(it.id, { status: 'undone', undone_ts: new Date().toISOString() });
      });
      // Remove an emptied "Title (Year)" folder created by the folders layout
      try { const d = path.dirname(it.to_abs); if (d !== path.dirname(it.from_abs) && fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* leave it */ }
      undone++; results.push({ id: it.id, ok: true, to: it.from_rel });
      log(`undo "${it.to_rel}" → "${it.from_rel}"`);
    } catch (e) {
      db.updateBatchItem(it.id, { error: 'undo failed: ' + e.message });
      results.push({ id: it.id, ok: false, error: e.message });
      log(`undo FAILED "${it.to_rel}": ${e.message}`);
    }
  }
  const remaining = db.batchItems(batchId).filter(i => i.status === 'done').length;
  db.finishBatch(batchId, { status: remaining ? 'partially undone' : 'undone', undone: (batch.undone || 0) + undone });
  return { batchId, undone, failed: results.filter(r => !r.ok).length, results };
}

module.exports = { runBatch, undoBatch, preflight, targetFor, sampleHash };
