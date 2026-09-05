'use strict';
// Headless metadata fill for a profile DB (no Electron window). Usage:
//   node test/metadata.fill.js <path-to-medialedger.db> [anime|tv]
const { Db } = require('../src/main/db');
const metadata = require('../src/main/metadata');
const db = new Db(process.argv[2]);
const types = process.argv[3] ? [process.argv[3]] : ['tv', 'anime'];
(async () => {
  let found = 0, missed = 0, failed = 0, n = 0;
  for (const t of types) {
    const have = db.allSeriesMeta(t);
    const series = db.all(`SELECT DISTINCT show_name FROM files WHERE library_type=? AND missing=0 AND ignored=0 AND show_name IS NOT NULL ORDER BY show_name`, t).map(r => r.show_name).filter(s => !have.has(s));
    console.log(`${t}: ${series.length} to look up`);
    for (const show of series) {
      try {
        const r = await metadata.lookupSeries(t, show);
        if (r.found) { found++; db.saveSeriesMeta({ library_type: t, show_name: show, source: r.source, source_id: r.source_id, matched_title: r.matched_title, status: r.status, seasons: r.seasons, total_episodes: r.total_episodes, url: r.url, fetched_at: new Date().toISOString(), locked: 0 }); }
        else { missed++; db.saveSeriesMeta({ library_type: t, show_name: show, source: 'none', fetched_at: new Date().toISOString(), locked: 0, note: r.candidates ? 'no confident match' : 'not found' }); }
      } catch (e) { failed++; console.log(`  ! ${show}: ${e.message}`); if (/429/.test(e.message)) await new Promise(r => setTimeout(r, 15000)); }
      if (++n % 25 === 0) console.log(`  ${n} done (${found} ok, ${missed} none, ${failed} err)`);
      await new Promise(r => setTimeout(r, t === 'anime' ? 900 : 550));
    }
  }
  console.log(`done: ${found} matched, ${missed} unmatched, ${failed} errors`);
  db.close();
})();
