'use strict';
// Collection suggestions: sets the library seems to contain, from three free sources.
//
//   local     titles that share a franchise name ("Pirates of the Caribbean: …", "Rocky II", "Part 2");
//   anilist   a series' relations (sequels, prequels, side stories), using the match the episode lookup already made;
//   wikidata  "part of the series" (P179) for films and shows, through Wikidata's public API; no key, one query per title.
//
// Each suggestion lists the titles it would gather; nothing is created until the user says so.
const metadata = require('./metadata');

const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_SPARQL = 'https://query.wikidata.org/sparql';
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
/** The franchise part of a title: "Rocky IV" -> "rocky", "Pirates of the Caribbean: Dead Man's Chest" -> "pirates of caribbean". */
function stem(title) {
  let t = String(title || '');
  t = t.replace(/\s*[:\-–]\s+.*$/, '');                                   // "X: subtitle", "X - subtitle"
  t = t.replace(/\s+(part|chapter|volume|vol\.?|episode)\s+\S+$/i, '');  // "X Part 2"
  t = t.replace(/\s+(\d{1,2}|[ivx]{1,4})$/i, (m, n) => (ROMAN[n.toLowerCase()] || /^\d+$/.test(n)) ? '' : m); // "X 2", "X II"
  t = t.replace(/\s+(returns|reloaded|revolutions|resurrection|begins|rises|forever)$/i, '');
  return norm(t);
}

/** Groups by franchise stem, from the titles alone. items: [{ library_type, title_key, title, year }] */
function localGroups(items) {
  const by = new Map();
  for (const it of items) { const s = stem(it.title); if (s.length < 3) continue; if (!by.has(s)) by.set(s, []); by.get(s).push(it); }
  const out = [];
  for (const [s, list] of by) {
    const titles = new Set(list.map(i => norm(i.title))); if (titles.size < 2) continue;
    const name = list.map(i => i.title).sort((a, b) => a.length - b.length)[0].replace(/\s*[:\-–]\s+.*$/, '').replace(/\s+(part|chapter)\s+\S+$/i, '').replace(/\s+(\d{1,2}|[ivx]{1,4})$/i, '').trim();
    out.push({ source: 'local', name, why: `${list.length} titles share the name "${name}"`, items: list.slice().sort((a, b) => (a.year || 0) - (b.year || 0) || a.title.localeCompare(b.title)), key: 'local:' + s });
  }
  return out;
}

/** AniList relations for one matched anime: the related shows that are in the library too. */
async function anilistRelations(anilistId) {
  const d = await metadata.anilistById(Number(anilistId)).catch(() => null);
  const m = d && d.Media; if (!m) return null;
  const edges = (m.relations && m.relations.edges) || [];
  const keep = new Set(['SEQUEL', 'PREQUEL', 'SIDE_STORY', 'PARENT', 'ALTERNATIVE', 'SPIN_OFF', 'SUMMARY']);
  return { id: m.id, title: (m.title && (m.title.english || m.title.romaji)) || '', related: edges.filter(e => keep.has(e.relationType) && e.node && e.node.format !== 'MUSIC').map(e => ({ id: e.node.id, title: (e.node.title && (e.node.title.english || e.node.title.romaji)) || '', year: e.node.seasonYear, relation: e.relationType })) };
}

/** Wikidata: the series a film or show belongs to, and every member of that series with its year. */
async function wikidataSeries(title, year, kind) {
  const q = new URLSearchParams({ action: 'wbsearchentities', search: title, language: 'en', type: 'item', limit: '6', format: 'json' });
  const s = await metadata.getJson(`${WD_API}?${q}`).catch(() => null);
  const hits = (s && s.search) || []; if (!hits.length) return null;
  const ids = hits.map(h => h.id);
  const g = await metadata.getJson(`${WD_API}?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'en', format: 'json' })}`).catch(() => null);
  const ents = (g && g.entities) || {};
  const want = kind === 'movie' ? ['Q11424', 'Q24869', 'Q202866'] : ['Q5398426', 'Q1259759', 'Q63952888', 'Q581714', 'Q15416']; // film kinds / series kinds
  let pick = null;
  for (const id of ids) {
    const e = ents[id]; if (!e || !e.claims) continue;
    const inst = (e.claims.P31 || []).map(c => c.mainsnak.datavalue && c.mainsnak.datavalue.value.id);
    const date = ((e.claims.P577 || [])[0] || {}).mainsnak; const y = date && date.datavalue ? Number(String(date.datavalue.value.time).slice(1, 5)) : null;
    if (!inst.some(i => want.includes(i))) continue;
    if (year && y && Math.abs(y - year) > 1) continue;
    const series = (e.claims.P179 || []).map(c => c.mainsnak.datavalue && c.mainsnak.datavalue.value.id).filter(Boolean);
    if (series.length) { pick = { item: id, series: series[0] }; break; }
  }
  if (!pick) return null;
  const sparql = `SELECT ?item ?itemLabel ?date WHERE { ?item wdt:P179 wd:${pick.series} . OPTIONAL { ?item wdt:P577 ?date } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 60`;
  const r = await metadata.getJson(`${WD_SPARQL}?${new URLSearchParams({ query: sparql, format: 'json' })}`).catch(() => null);
  const lab = await metadata.getJson(`${WD_API}?${new URLSearchParams({ action: 'wbgetentities', ids: pick.series, props: 'labels', languages: 'en', format: 'json' })}`).catch(() => null);
  const name = lab && lab.entities && lab.entities[pick.series] && lab.entities[pick.series].labels && lab.entities[pick.series].labels.en ? lab.entities[pick.series].labels.en.value : title;
  const seen = new Map();
  for (const b of (r && r.results && r.results.bindings) || []) { const id = b.item.value.split('/').pop(); const y = b.date ? Number(b.date.value.slice(0, 4)) : null; if (!seen.has(id) || (y && !seen.get(id).year)) seen.set(id, { id, title: b.itemLabel ? b.itemLabel.value : id, year: y }); }
  return { series: pick.series, name, members: [...seen.values()].sort((a, b) => (a.year || 9999) - (b.year || 9999)) };
}

/**
 * Build suggestions. `lib`: { movies: [{ title_key, title, year }], series: [{ library_type, title_key, title, anilist_id }] }
 * `have`: set of 'type|key' already in some collection, to skip. `opts.web`: ask AniList and Wikidata (slow, capped).
 */
async function suggest(lib, have, opts = {}, onProgress = () => {}) {
  const items = [...lib.movies.map(m => ({ library_type: 'movie', title_key: m.title_key, title: m.title, year: m.year })), ...lib.series.map(s => ({ library_type: s.library_type, title_key: s.title_key, title: s.title, year: s.year || null }))];
  const inSet = (i) => have.has(i.library_type + '|' + i.title_key);
  const out = localGroups(items).filter(g => g.items.some(i => !inSet(i)));
  const covered = new Set(out.flatMap(g => g.items.map(i => i.library_type + '|' + i.title_key)));
  if (opts.web) {
    const byNorm = new Map(items.map(i => [norm(i.title), i]));
    const findLocal = (title, year, type) => { const n = norm(title); const hit = byNorm.get(n); if (hit && (!type || hit.library_type === type || type === 'any')) return hit; for (const i of items) { if ((type === 'any' || i.library_type === type) && (norm(i.title).startsWith(n) || n.startsWith(norm(i.title))) && (!year || !i.year || Math.abs(i.year - year) <= 1)) return i; } return null; };
    // AniList: one call per matched anime not already in a set (capped)
    const anime = lib.series.filter(s => s.library_type === 'anime' && s.anilist_id && !have.has('anime|' + s.title_key)).slice(0, opts.cap || 40);
    const seenAni = new Set(); let n = 0;
    for (const s of anime) {
      onProgress({ phase: 'anilist', done: ++n, total: anime.length, title: s.title });
      if (seenAni.has(String(s.anilist_id))) continue;
      const rel = await anilistRelations(s.anilist_id); if (!rel || !rel.related.length) continue;
      const members = [s, ...rel.related.map(r => findLocal(r.title, r.year, 'anime')).filter(Boolean)].filter((x, i, a) => a.findIndex(y => y.title_key === x.title_key) === i);
      [rel.id, ...rel.related.map(r => r.id)].forEach(id => seenAni.add(String(id)));
      if (members.length < 2) continue;
      const missing = rel.related.filter(r => !findLocal(r.title, r.year, 'anime')).map(r => ({ title: r.title, year: r.year, relation: r.relation }));
      out.push({ source: 'anilist', name: rel.title.replace(/\s*(season \d+|part \d+|2nd season|3rd season|\d+(st|nd|rd|th) season)$/i, ''), why: `AniList links these as sequels, prequels or side stories of ${rel.title}`, items: members.map(m => ({ library_type: 'anime', title_key: m.title_key, title: m.title, year: m.year || null })), missing, key: 'anilist:' + rel.id });
      await new Promise(r => setTimeout(r, 700)); // AniList allows ~90 requests a minute; stay well under
    }
    // Wikidata: films and TV that look like part of something, or that local grouping already found
    const cands = items.filter(i => i.library_type !== 'anime' && !inSet(i) && (covered.has(i.library_type + '|' + i.title_key) || /\b(part|chapter)\b|\b[ivx]{2,4}$|\s\d$|:/i.test(i.title))).slice(0, opts.cap || 40);
    const seenSeries = new Set(); n = 0;
    for (const c of cands) {
      onProgress({ phase: 'wikidata', done: ++n, total: cands.length, title: c.title });
      const w = await wikidataSeries(c.title, c.year, c.library_type === 'movie' ? 'movie' : 'tv'); if (!w || seenSeries.has(w.series)) continue; seenSeries.add(w.series);
      const members = w.members.map(m => findLocal(m.title, m.year, c.library_type === 'movie' ? 'movie' : 'any')).filter(Boolean).filter((x, i, a) => a.findIndex(y => y.title_key === x.title_key) === i);
      if (!members.some(m => m.title_key === c.title_key)) members.unshift(c);
      if (members.length < 2 && w.members.length < 2) continue;
      const missing = w.members.filter(m => !findLocal(m.title, m.year, c.library_type === 'movie' ? 'movie' : 'any')).map(m => ({ title: m.title, year: m.year }));
      out.push({ source: 'wikidata', name: w.name, why: `Wikidata lists ${w.members.length} titles in the series "${w.name}"`, items: members, missing, key: 'wikidata:' + w.series });
      await new Promise(r => setTimeout(r, 400));
    }
  }
  // the web sources know better than a shared name: drop a local group that a web group covers
  const webKeys = new Set(out.filter(g => g.source !== 'local').flatMap(g => g.items.map(i => i.library_type + '|' + i.title_key)));
  return out.filter(g => g.source !== 'local' || !g.items.every(i => webKeys.has(i.library_type + '|' + i.title_key))).map(g => ({ ...g, missing: g.missing || [] }));
}

module.exports = { suggest, localGroups, stem, wikidataSeries, anilistRelations, norm };
