'use strict';
// Discs: the physical media on the shelf, tracked by barcode.
//
// Three ideas, kept apart on purpose:
//   a RELEASE is a product (one barcode: "Alien, 4K UHD steelbook"),
//   a COPY is one of those you own, want, lent out or sold (a release can have several),
//   a TITLE link says which library title(s) a release contains (a box set links to many).
// "Ripped from disc" is not stored here: that is the root's `origin` (see ORIGIN() in service.js).
//
// Nothing is removed automatically. A copy changes status. Deleting a release is an explicit action and is
// refused while it still has copies unless forced. What you type is never overwritten by a lookup.
// Pure functions over a Db (all/get/run), no Electron, so the desktop and the Pi server share them.

const FORMATS = ['4K UHD', 'Blu-ray', 'DVD', '3D', 'HD DVD', 'other'];
const KINDS = ['movie', 'tv', 'collection'];
const STATUSES = ['owned', 'wishlist', 'sold', 'loaned'];
const CODES = ['none', 'unredeemed', 'redeemed'];
const LIBRARIES = ['movie', 'tv', 'anime'];
const HELD = "('owned','loaned')";   // a loaned disc is still yours

const now = () => new Date().toISOString();
const str = (v, max = 200) => { const s = v == null ? '' : String(v).trim().slice(0, max); return s || null; };
const int = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'yes' ? 1 : 0);
const oneOf = (v, list, what) => { if (!list.includes(v)) throw new Error(`Unknown ${what}: ${v}`); return v; };

/**
 * A barcode as the 13 digits of an EAN-13, or null when it is not one.
 * Accepts 12 digits (UPC-A, which is an EAN-13 with a leading 0) or 13, with any spaces or dashes, and checks the
 * check digit, so a mis-scan or a mistyped number is caught before it becomes a release.
 */
function normalizeUpc(raw) {
  const d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.length !== 12 && d.length !== 13) return null;
  const e = d.length === 12 ? '0' + d : d;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(e[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(e[12]) ? e : null;
}

// ---- releases --------------------------------------------------------------------------------
function releaseFields(o, cur = {}) {
  const pick = (k, fn) => (k in o ? fn(o[k]) : cur[k] === undefined ? fn(undefined) : cur[k]);
  const title = pick('title', v => str(v, 300));
  if (!title) throw new Error('A release needs a title');
  let upc = cur.upc || null;
  if ('upc' in o) { if (o.upc == null || String(o.upc).trim() === '') upc = null; else { upc = normalizeUpc(o.upc); if (!upc) throw new Error('That barcode is not a valid UPC or EAN'); } }
  return {
    upc, title, year: pick('year', int),
    kind: oneOf(pick('kind', v => v || 'movie'), KINDS, 'kind'), format: oneOf(pick('format', v => v || 'Blu-ray'), FORMATS, 'format'),
    edition: pick('edition', str), region: pick('region', v => str(v, 40)), studio: pick('studio', str),
    discs_count: pick('discs_count', int), packaging: pick('packaging', str), slipcover: pick('slipcover', flag),
    hdr: pick('hdr', v => str(v, 60)), audio: pick('audio', v => str(v, 120)), imax_var: pick('imax_var', flag),
    notes: pick('notes', v => str(v, 2000)), lookup_source: pick('lookup_source', v => str(v, 60) || 'manual'),
  };
}
const R_COLS = ['upc', 'title', 'year', 'kind', 'format', 'edition', 'region', 'studio', 'discs_count', 'packaging', 'slipcover', 'hdr', 'audio', 'imax_var', 'notes', 'lookup_source'];

function createRelease(db, o = {}) {
  const f = releaseFields(o);
  if (f.upc && db.get('SELECT id FROM disc_releases WHERE upc=?', f.upc)) throw new Error('A release with that barcode already exists');
  const r = db.run(`INSERT INTO disc_releases (${R_COLS.join(', ')}, created) VALUES (${R_COLS.map(() => '?').join(',')}, ?)`, ...R_COLS.map(c => f[c]), now());
  return Number(r.lastInsertRowid);
}
function updateRelease(db, id, o = {}) {
  const cur = db.get('SELECT * FROM disc_releases WHERE id=?', Number(id));
  if (!cur) throw new Error('No such release');
  const f = releaseFields(o, cur);
  if (f.upc && db.get('SELECT id FROM disc_releases WHERE upc=? AND id<>?', f.upc, cur.id)) throw new Error('Another release already has that barcode');
  db.run(`UPDATE disc_releases SET ${R_COLS.map(c => c + '=?').join(', ')} WHERE id=?`, ...R_COLS.map(c => f[c]), cur.id);
  return cur.id;
}
/** Explicit only. Refused while copies exist unless `force`, which removes the copies and links with it. */
function deleteRelease(db, id, { force = false } = {}) {
  id = Number(id);
  if (!db.get('SELECT id FROM disc_releases WHERE id=?', id)) throw new Error('No such release');
  const copies = db.get('SELECT COUNT(*) n FROM disc_copies WHERE release_id=?', id).n;
  if (copies && !force) throw new Error(`This release still has ${copies} cop${copies === 1 ? 'y' : 'ies'}. Remove it anyway to delete them too.`);
  db.run('DELETE FROM disc_copies WHERE release_id=?', id);
  db.run('DELETE FROM disc_titles WHERE release_id=?', id);
  db.run('UPDATE disc_scans SET release_id=NULL, copy_id=NULL WHERE release_id=?', id);
  db.run('DELETE FROM disc_releases WHERE id=?', id);
  return true;
}

// ---- copies ----------------------------------------------------------------------------------
function copyFields(o, cur = {}) {
  const pick = (k, fn) => (k in o ? fn(o[k]) : cur[k] === undefined ? fn(undefined) : cur[k]);
  return {
    status: oneOf(pick('status', v => v || 'owned'), STATUSES, 'status'), location: pick('location', v => str(v, 120)), condition: pick('condition', v => str(v, 60)),
    purchase_date: pick('purchase_date', v => str(v, 10)), price: pick('price', num), store: pick('store', v => str(v, 120)),
    loaned_to: pick('loaned_to', v => str(v, 120)), digital_code: oneOf(pick('digital_code', v => v || 'none'), CODES, 'digital code state'), notes: pick('notes', v => str(v, 2000)),
  };
}
const C_COLS = ['status', 'location', 'condition', 'purchase_date', 'price', 'store', 'loaned_to', 'digital_code', 'notes'];

function addCopy(db, releaseId, o = {}) {
  releaseId = Number(releaseId);
  if (!db.get('SELECT id FROM disc_releases WHERE id=?', releaseId)) throw new Error('No such release');
  const f = copyFields(o);
  const r = db.run(`INSERT INTO disc_copies (release_id, ${C_COLS.join(', ')}, added) VALUES (?, ${C_COLS.map(() => '?').join(',')}, ?)`, releaseId, ...C_COLS.map(c => f[c]), now());
  return Number(r.lastInsertRowid);
}
function updateCopy(db, id, o = {}) {
  const cur = db.get('SELECT * FROM disc_copies WHERE id=?', Number(id));
  if (!cur) throw new Error('No such copy');
  const f = copyFields(o, cur);
  db.run(`UPDATE disc_copies SET ${C_COLS.map(c => c + '=?').join(', ')} WHERE id=?`, ...C_COLS.map(c => f[c]), cur.id);
  return cur.id;
}
function setCopyStatus(db, id, status, extra = {}) {
  const o = { status };
  if ('loaned_to' in extra) o.loaned_to = extra.loaned_to;
  if (status !== 'loaned' && !('loaned_to' in extra)) o.loaned_to = null;   // back on the shelf, sold or wished for: nobody has it
  return updateCopy(db, id, o);
}

// ---- which library titles a release contains ---------------------------------------------------
function linkTitle(db, releaseId, t = {}) {
  releaseId = Number(releaseId);
  if (!db.get('SELECT id FROM disc_releases WHERE id=?', releaseId)) throw new Error('No such release');
  const type = oneOf(t.library_type, LIBRARIES, 'library'); const key = str(t.title_key, 400);
  if (!key) throw new Error('A link needs a title');
  const season = int(t.season);
  // UNIQUE does not treat two NULL seasons as equal, so look first.
  const had = db.get('SELECT id FROM disc_titles WHERE release_id=? AND library_type=? AND title_key=? AND season IS ?', releaseId, type, key, season);
  if (had) return had.id;
  return Number(db.run('INSERT INTO disc_titles (release_id, library_type, title_key, title, year, season) VALUES (?,?,?,?,?,?)', releaseId, type, key, str(t.title, 300), int(t.year), season).lastInsertRowid);
}
function unlinkTitle(db, id) { return db.run('DELETE FROM disc_titles WHERE id=?', Number(id)).changes > 0; }

// ---- reading ---------------------------------------------------------------------------------
function get(db, id) {
  const release = db.get('SELECT * FROM disc_releases WHERE id=?', Number(id));
  if (!release) return null;
  return {
    release,
    copies: db.all('SELECT * FROM disc_copies WHERE release_id=? ORDER BY id', release.id),
    titles: db.all('SELECT * FROM disc_titles WHERE release_id=? ORDER BY title COLLATE NOCASE, season', release.id),
  };
}
/**
 * One row per release. `status`: 'owned' (on the shelf or lent out), 'wishlist', 'sold', or 'all' (every release,
 * including one with no copies left). `q` filters on title, edition and barcode.
 */
function list(db, { status = 'owned', q = '' } = {}) {
  const set = status === 'owned' ? HELD : status === 'all' ? null : `('${oneOf(status, STATUSES, 'status')}')`;
  const inSet = set ? `AND c.status IN ${set}` : '';
  const like = `%${String(q || '').trim()}%`;
  const rows = db.all(`SELECT r.*,
      (SELECT COUNT(*) FROM disc_copies c WHERE c.release_id=r.id ${inSet}) copies,
      (SELECT GROUP_CONCAT(DISTINCT c.location) FROM disc_copies c WHERE c.release_id=r.id ${inSet} AND c.location IS NOT NULL) locations,
      (SELECT COUNT(*) FROM disc_copies c WHERE c.release_id=r.id AND c.status='loaned') loaned,
      (SELECT COUNT(*) FROM disc_titles t WHERE t.release_id=r.id) titles
    FROM disc_releases r
    WHERE (r.title LIKE ? OR COALESCE(r.edition,'') LIKE ? OR COALESCE(r.upc,'') LIKE ?)
      ${set ? `AND EXISTS (SELECT 1 FROM disc_copies c WHERE c.release_id=r.id ${inSet})` : ''}
    ORDER BY r.title COLLATE NOCASE, r.year`, like, like, like);
  return { rows, counts: counts(db) };
}
function counts(db) {
  const by = Object.fromEntries(db.all('SELECT status, COUNT(*) n FROM disc_copies GROUP BY status').map(r => [r.status, r.n]));
  return { owned: by.owned || 0, loaned: by.loaned || 0, wishlist: by.wishlist || 0, sold: by.sold || 0, releases: db.get('SELECT COUNT(*) n FROM disc_releases').n, unredeemed: db.get("SELECT COUNT(*) n FROM disc_copies WHERE digital_code='unredeemed'").n };
}
const RANK = Object.fromEntries(FORMATS.map((f, i) => [f, i]));
/** The discs you hold for one library title: [{ release_id, title, format, edition, copy_id, status, location }], best format first. */
function forTitle(db, type, key) {
  return db.all(`SELECT r.id release_id, r.title, r.format, r.edition, c.id copy_id, c.status, c.location, c.loaned_to
    FROM disc_titles t JOIN disc_releases r ON r.id=t.release_id JOIN disc_copies c ON c.release_id=r.id
    WHERE t.library_type=? AND t.title_key=? AND c.status IN ${HELD}`, type, key).sort((a, b) => RANK[a.format] - RANK[b.format]);
}
/** For the lists: title_key -> { format, location } of the best disc held, for every title of one library. */
function ownedByTitle(db, type) {
  const m = new Map();
  for (const r of db.all(`SELECT t.title_key k, r.format, c.location FROM disc_titles t JOIN disc_releases r ON r.id=t.release_id JOIN disc_copies c ON c.release_id=r.id WHERE t.library_type=? AND c.status IN ${HELD}`, type)) {
    const cur = m.get(r.k);
    if (!cur || RANK[r.format] < RANK[cur.format]) m.set(r.k, { format: r.format, location: r.location });
  }
  return m;
}

// ---- scanning --------------------------------------------------------------------------------
const logScan = (db, upc, result, releaseId = null, copyId = null) => { db.run('INSERT INTO disc_scans (upc, ts, result, release_id, copy_id) VALUES (?,?,?,?,?)', upc, now(), result, releaseId, copyId); };
/**
 * One barcode from the scanner.
 *   not a barcode            -> { ok:false, invalid:true }
 *   no release has it        -> { ok:false, unknown:true, upc }      (nothing is created: the page asks what it is)
 *   on the wishlist          -> the wished-for copy becomes owned    { ok:true, fromWishlist:true }
 *   already held, no `force` -> { ok:false, duplicate:true, owned }  (the page asks before adding a second copy)
 *   otherwise                -> a new owned copy                     { ok:true, duplicate: had one already }
 * Every scan is logged, whatever came of it.
 */
function scan(db, raw, { location = null, force = false } = {}) {
  const upc = normalizeUpc(raw);
  if (!upc) { logScan(db, String(raw == null ? '' : raw).replace(/[^\x20-\x7e]/g, '').slice(0, 40), 'invalid'); return { ok: false, invalid: true, raw: String(raw == null ? '' : raw).slice(0, 40) }; }
  const release = db.get('SELECT * FROM disc_releases WHERE upc=?', upc);
  if (!release) { logScan(db, upc, 'unknown'); return { ok: false, unknown: true, upc }; }
  const loc = str(location, 120);
  const wished = db.get("SELECT id FROM disc_copies WHERE release_id=? AND status='wishlist' ORDER BY id LIMIT 1", release.id);
  const owned = db.get(`SELECT COUNT(*) n FROM disc_copies WHERE release_id=? AND status IN ${HELD}`, release.id).n;
  if (wished && !owned) {
    updateCopy(db, wished.id, loc ? { status: 'owned', location: loc } : { status: 'owned' });
    logScan(db, upc, 'ok', release.id, wished.id);
    return { ok: true, upc, release, copy_id: wished.id, duplicate: false, fromWishlist: true };
  }
  if (owned && !force) { logScan(db, upc, 'duplicate', release.id); return { ok: false, duplicate: true, upc, release, owned }; }
  const copyId = addCopy(db, release.id, { status: 'owned', location: loc });
  logScan(db, upc, 'ok', release.id, copyId);
  return { ok: true, upc, release, copy_id: copyId, duplicate: owned > 0 };
}
function recentScans(db, limit = 50) {
  return db.all('SELECT s.id, s.upc, s.ts, s.result, s.release_id, s.copy_id, r.title, r.format FROM disc_scans s LEFT JOIN disc_releases r ON r.id=s.release_id ORDER BY s.id DESC LIMIT ?', Math.max(1, Math.min(500, Number(limit) || 50)));
}

// ---- export: one row per copy ------------------------------------------------------------------
const EXPORT_HEADER = ['title', 'year', 'kind', 'format', 'edition', 'upc', 'region', 'studio', 'discs_count', 'packaging', 'slipcover', 'hdr', 'audio', 'imax_var', 'status', 'location', 'condition', 'purchase_date', 'price', 'store', 'loaned_to', 'digital_code', 'library_titles', 'release_notes', 'copy_notes', 'added'];
function exportRows(db) {
  const linked = new Map();
  for (const t of db.all('SELECT release_id, title, title_key, season FROM disc_titles ORDER BY title COLLATE NOCASE, season')) { if (!linked.has(t.release_id)) linked.set(t.release_id, []); linked.get(t.release_id).push((t.title || t.title_key) + (t.season != null ? ` S${t.season}` : '')); }
  return db.all('SELECT r.*, c.status, c.location, c.condition, c.purchase_date, c.price, c.store, c.loaned_to, c.digital_code, c.notes copy_notes, c.added FROM disc_copies c JOIN disc_releases r ON r.id=c.release_id ORDER BY r.title COLLATE NOCASE, r.year, c.id')
    .map(r => ({ ...r, slipcover: r.slipcover ? 'yes' : '', imax_var: r.imax_var ? 'yes' : '', release_notes: r.notes, library_titles: (linked.get(r.id) || []).join('; ') }));
}
function exportCsvText(db) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = exportRows(db);
  return { filename: 'discs.csv', rows: rows.length, csv: [EXPORT_HEADER.join(','), ...rows.map(r => EXPORT_HEADER.map(h => q(r[h])).join(','))].join('\r\n') + '\r\n' };
}

module.exports = { FORMATS, KINDS, STATUSES, CODES, EXPORT_HEADER, normalizeUpc, createRelease, updateRelease, deleteRelease, addCopy, updateCopy, setCopyStatus, linkTitle, unlinkTitle, get, list, counts, forTitle, ownedByTitle, scan, recentScans, exportRows, exportCsvText };
