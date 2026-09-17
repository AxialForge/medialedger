'use strict';
// Who watched what: reads plex_history (filled by plex.syncHistory and scrobble webhooks) and shapes it
// for the Watched tab. Pure SQL over the Db wrapper; no network. Exported for tests.
//
//   report(db, { days, account, adultFilter }) → {
//     days, accounts: [{ id, name, plays }], totals: { plays, seconds, titles, people, first, last },
//     byPerson, byLibrary, byWeekday, byHour, byDevice   (rows for Cards.bars: { k, n, library_type })
//     perDay: [{ day, plays }], top: { series: [...], movies: [...] }, recent: [...], binge: [...]
//   }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function whereClause(opts) {
  const w = ['1=1'], args = [];
  if (opts.days) { w.push('h.viewed_at >= ?'); args.push(new Date(Date.now() - Number(opts.days) * 86400000).toISOString()); }
  if (opts.account) { w.push('h.account_id = ?'); args.push(Number(opts.account)); }
  if (opts.adultFilter) w.push('(h.file_id IS NULL OR EXISTS (SELECT 1 FROM files f WHERE f.id = h.file_id AND f.adult = 0))');
  return { where: w.join(' AND '), args };
}

// Library of a play: the linked file's library when known, else a guess from Plex's item type.
const LIB = "COALESCE(h.library_type, CASE h.type WHEN 'movie' THEN 'movie' WHEN 'episode' THEN 'tv' ELSE 'other' END)";

function report(db, opts = {}) {
  const days = opts.days === 'all' || opts.days === 0 ? 0 : Number(opts.days) || 30;
  const o = { ...opts, days };
  const { where, args } = whereClause(o);
  const accounts = db.all(`SELECT a.id, a.name, COUNT(h.history_key) plays FROM plex_accounts a LEFT JOIN plex_history h ON h.account_id = a.id GROUP BY a.id ORDER BY plays DESC, a.name`);
  const totals = db.get(`SELECT COUNT(*) plays, COALESCE(SUM(h.duration_s),0) seconds, COUNT(DISTINCT COALESCE(h.show_title, h.title)) titles, COUNT(DISTINCT h.account_id) people, MIN(h.viewed_at) first, MAX(h.viewed_at) last FROM plex_history h WHERE ${where}`, ...args);
  const byPerson = db.all(`SELECT h.account_name k, ${LIB} library_type, COUNT(*) n FROM plex_history h WHERE ${where} GROUP BY h.account_id, ${LIB} ORDER BY n DESC`, ...args);
  const byLibrary = db.all(`SELECT ${LIB} k, ${LIB} library_type, COUNT(*) n FROM plex_history h WHERE ${where} GROUP BY 1`, ...args);
  const byWeekday = db.all(`SELECT CAST(strftime('%w', h.viewed_at, 'localtime') AS INTEGER) d, ${LIB} library_type, COUNT(*) n FROM plex_history h WHERE ${where} GROUP BY 1, 2`, ...args).map(r => ({ k: WEEKDAYS[r.d], library_type: r.library_type, n: r.n }));
  const byHour = db.all(`SELECT CAST(strftime('%H', h.viewed_at, 'localtime') AS INTEGER) hr, ${LIB} library_type, COUNT(*) n FROM plex_history h WHERE ${where} GROUP BY 1, 2`, ...args).map(r => ({ k: String(r.hr).padStart(2, '0') + ':00', library_type: r.library_type, n: r.n }));
  const byDevice = db.all(`SELECT COALESCE(h.device, 'unknown') k, ${LIB} library_type, COUNT(*) n FROM plex_history h WHERE ${where} GROUP BY 1, 2 ORDER BY n DESC`, ...args);
  const perDay = db.all(`SELECT substr(h.viewed_at, 1, 10) day, COUNT(*) plays, COUNT(DISTINCT h.account_id) people FROM plex_history h WHERE ${where} GROUP BY 1 ORDER BY 1`, ...args);
  const top = {
    series: db.all(`SELECT h.show_title title, ${LIB} library_type, COUNT(*) plays, COUNT(DISTINCT h.account_id) people, GROUP_CONCAT(DISTINCT h.account_name) who, MAX(h.viewed_at) last, COALESCE(SUM(h.duration_s),0) seconds FROM plex_history h WHERE ${where} AND h.show_title IS NOT NULL GROUP BY h.show_title ORDER BY plays DESC LIMIT 25`, ...args),
    movies: db.all(`SELECT h.title, 'movie' library_type, COUNT(*) plays, COUNT(DISTINCT h.account_id) people, GROUP_CONCAT(DISTINCT h.account_name) who, MAX(h.viewed_at) last, COALESCE(SUM(h.duration_s),0) seconds FROM plex_history h WHERE ${where} AND h.type = 'movie' GROUP BY h.rating_key ORDER BY plays DESC LIMIT 25`, ...args),
  };
  const recent = db.all(`SELECT h.history_key, h.account_name who, h.device, h.type, h.title, h.show_title, h.season, h.episode, h.viewed_at, h.duration_s, h.file_id, ${LIB} library_type, f.show_name, f.group_key, f.movie_title FROM plex_history h LEFT JOIN files f ON f.id = h.file_id WHERE ${where} ORDER BY h.viewed_at DESC LIMIT 500`, ...args);
  const binge = bingeSessions(recent);
  return { days, accounts, totals, byPerson, byLibrary, byWeekday, byHour, byDevice, perDay, top, recent, binge };
}

// A "binge" is one person watching several episodes of the same show close together.
// rows come newest first from `recent`. Returns [{ who, show, episodes, start, end }], longest first.
function bingeSessions(rows) {
  // TODO(human): group `rows` (newest first, fields who, show_title, viewed_at, duration_s) into sessions
  // where the same person watches the same show with gaps under some limit, keep sessions of 3+ episodes,
  // and return up to 10 as { who, show, episodes, start, end } sorted by episodes descending.
  return [];
}

module.exports = { report, bingeSessions, WEEKDAYS };
