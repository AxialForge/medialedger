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

// ---- Reclaim candidates: big titles nobody has played for a long time. Read-only: MediaLedger never deletes media.
//   reclaim(db, { months, minGb, adultFilter }) → { months, minGb, totalBytes, neverPlayed, candidates: [...] }
// A title qualifies when it was added more than `months` ago and its last play by ANY account (Plex's own
// last-viewed on the files, or a history row) is older than that, or it was never played. Titles you rated
// 4 stars or higher are protected.
function reclaim(db, opts = {}) {
  const months = Math.max(1, Number(opts.months) || 12), minGb = Math.max(0, opts.minGb != null ? Number(opts.minGb) : 2);
  const cutoff = new Date(Date.now() - months * 30.44 * 86400000).toISOString();
  const adult = opts.adultFilter ? ' AND f.adult = 0' : '';
  const KEY = a => `CASE WHEN ${a}.library_type = 'movie' THEN ${a}.group_key ELSE ${a}.show_name END`;
  const rows = db.all(`
    SELECT f.library_type, ${KEY('f')} title_key,
           MAX(CASE WHEN f.library_type = 'movie' THEN f.movie_title ELSE f.show_name END) title, MAX(f.movie_year) year,
           COUNT(*) files, SUM(f.size) bytes, MIN(f.first_seen) seen, MAX(f.mtime_ms) newest_ms, SUM(COALESCE(f.plex_view_count, 0)) owner_plays,
           MAX(f.plex_last_viewed) owner_last, SUM(CASE WHEN f.plex_rating_key IS NOT NULL THEN 1 ELSE 0 END) linked
    FROM files f WHERE f.missing = 0 AND f.ignored = 0 AND f.library_type IN ('tv','anime','movie')${adult}
    GROUP BY f.library_type, title_key HAVING bytes >= ?`, minGb * 1073741824);
  const hist = new Map(db.all(`SELECT f.library_type lt, ${KEY('f')} k, MAX(h.viewed_at) last, COUNT(*) plays FROM plex_history h JOIN files f ON f.id = h.file_id GROUP BY 1, 2`).map(r => [r.lt + '|' + r.k, r]));
  const stars = new Map(db.all('SELECT library_type, title_key, stars FROM user_ratings').map(r => [r.library_type + '|' + r.title_key, r.stars]));
  const candidates = [];
  for (const r of rows) {
    // "Added" is the newest file's own date when it is older than the day MediaLedger first saw the title (a young ledger has seen everything recently).
    const fileDate = r.newest_ms ? new Date(r.newest_ms).toISOString() : null;
    const added = fileDate && (!r.seen || fileDate < r.seen) ? fileDate : r.seen;
    if (!added || added >= cutoff) continue;
    const h = hist.get(r.library_type + '|' + r.title_key);
    const last = [r.owner_last, h && h.last].filter(Boolean).sort().pop() || null;
    if (last && last >= cutoff) continue;
    const mine = stars.get(r.library_type + '|' + r.title_key) || null;
    if (mine && mine >= 4) continue;
    candidates.push({ library_type: r.library_type, key: r.title_key, title: r.title, year: r.year, files: r.files, bytes: r.bytes, added, last_played: last, plays: Math.max(r.owner_plays || 0, h ? h.plays : 0), in_plex: r.linked > 0, my_rating: mine });
  }
  candidates.sort((a, b) => b.bytes - a.bytes);
  return { months, minGb, totalBytes: candidates.reduce((a, c) => a + c.bytes, 0), neverPlayed: candidates.filter(c => !c.last_played).length, candidates: candidates.slice(0, 1000) };
}

// ---- Next up: for each person and each show they watched recently, the episode after their furthest one.
//   nextUp(db, { days, account, adultFilter }) → [{ who, account_id, library_type, show, last: {season, episode, at}, next: {...} | null, left }]
// next is null when nothing later is on disk (caught up); next.gap marks a hole right after the last one watched.
function nextUp(db, opts = {}) {
  const since = new Date(Date.now() - (Number(opts.days) || 60) * 86400000).toISOString();
  const args = [since]; let acc = '';
  if (opts.account) { acc = ' AND h.account_id = ?'; args.push(Number(opts.account)); }
  const adult = opts.adultFilter ? ' AND f.adult = 0' : '';
  const plays = db.all(`SELECT h.account_id, h.account_name who, f.library_type, f.show_name show, f.season, f.episode, h.viewed_at
    FROM plex_history h JOIN files f ON f.id = h.file_id
    WHERE h.viewed_at >= ?${acc}${adult} AND f.library_type IN ('tv','anime') AND f.season IS NOT NULL AND f.episode IS NOT NULL ORDER BY h.viewed_at`, ...args);
  const latest = new Map();
  for (const p of plays) {
    const k = `${p.account_id}|${p.library_type}|${p.show}`; const cur = latest.get(k);
    const further = !cur || p.season > cur.season || (p.season === cur.season && p.episode > cur.episode);
    latest.set(k, { ...(further ? p : cur), at: p.viewed_at });
  }
  const eps = db.prep(`SELECT id, season, episode, episode_title FROM files WHERE library_type = ? AND show_name = ? AND missing = 0 AND ignored = 0 AND season > 0 AND episode IS NOT NULL AND (season > ? OR (season = ? AND episode > ?)) ORDER BY season, episode`);
  const out = [];
  for (const l of latest.values()) {
    const after = eps.all(l.library_type, l.show, l.season, l.season, l.episode);
    const n = after[0];
    const contiguous = n && ((n.season === l.season && n.episode === l.episode + 1) || (n.season === l.season + 1 && n.episode === 1));
    out.push({ who: l.who, account_id: l.account_id, library_type: l.library_type, show: l.show, last: { season: l.season, episode: l.episode, at: l.at },
      next: n ? { season: n.season, episode: n.episode, title: n.episode_title || null, file_id: n.id, gap: !contiguous } : null, left: after.length });
  }
  return out.sort((a, b) => (b.last.at || '').localeCompare(a.last.at || ''));
}

module.exports = { report, bingeSessions, reclaim, nextUp, WEEKDAYS };
