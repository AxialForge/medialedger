'use strict';
// TMDB (themoviedb.org): optional, off until a key is typed into Settings. Free, but it needs an account,
// so nothing depends on it: with no key every function here is simply never called.
// Accepts either kind of credential TMDB hands out: the short v3 "API key" or the long v4 "read access token".
const API = 'https://api.themoviedb.org/3';
const UA = 'MediaLedger (https://github.com/AxialForge/medialedger)';

async function call(key, pathAndQuery, fetchFn = fetch) {
  key = String(key || '').trim();
  if (!key) throw new Error('No TMDB key set');
  const bearer = key.length > 40;
  const url = `${API}${pathAndQuery}${bearer ? '' : `${pathAndQuery.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`}`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...(bearer ? { Authorization: `Bearer ${key}` } : {}) }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401) throw new Error('TMDB did not accept that key');
  if (res.status === 429) { const e = new Error('TMDB asked to slow down'); e.retryAfter = Number(res.headers.get('retry-after')) || 10; throw e; }
  if (!res.ok) throw new Error(`HTTP ${res.status} from TMDB`);
  return res.json();
}
const yearOf = (d) => { const y = Number(String(d || '').slice(0, 4)); return y > 1800 ? y : null; };
const shape = (r, kind) => r ? { id: r.id, kind, title: kind === 'tv' ? r.name : r.title, year: yearOf(kind === 'tv' ? r.first_air_date : r.release_date), poster_path: r.poster_path || null } : null;

/** The best match for a film title (and year, when known), or null. */
async function searchMovie(key, title, year, fetchFn) {
  const q = `/search/movie?query=${encodeURIComponent(title)}&include_adult=false${year ? `&year=${Number(year)}` : ''}`;
  const j = await call(key, q, fetchFn);
  return shape((j.results || [])[0], 'movie');
}
async function searchTv(key, title, fetchFn) {
  const j = await call(key, `/search/tv?query=${encodeURIComponent(title)}&include_adult=false`, fetchFn);
  return shape((j.results || [])[0], 'tv');
}
const posterUrl = (posterPath, width = 300) => posterPath ? `https://image.tmdb.org/t/p/${width <= 185 ? 'w185' : width <= 342 ? 'w342' : 'w500'}${posterPath}` : null;
/** For the Settings "Test" button: says in words whether the key works. Never throws. */
async function test(key, fetchFn) {
  try { const r = await searchMovie(key, 'Alien', 1979, fetchFn); return { ok: true, message: r ? `Works: found ${r.title} (${r.year}).` : 'The key works.' }; }
  catch (e) { return { ok: false, message: e.message }; }
}

module.exports = { searchMovie, searchTv, posterUrl, test };
