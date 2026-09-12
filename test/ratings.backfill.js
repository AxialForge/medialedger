'use strict';
// Backfill online ratings for series matched before ratings were stored. Network. Usage: node test/ratings.backfill.js <db>
const { Db } = require('../src/main/db');
const metadata = require('../src/main/metadata');
const db = new Db(process.argv[2]);
(async () => {
  const rows = db.all("SELECT * FROM series_meta WHERE rating IS NULL AND source IN ('tvmaze','anilist') AND source_id IS NOT NULL");
  console.log(rows.length, 'to backfill');
  let n = 0, ok = 0;
  for (const m of rows) {
    try {
      const r = await metadata.fetchById(m.source, m.source_id);
      if (r.found && r.rating != null) { ok++; db.run('UPDATE series_meta SET rating=?, rating_votes=? WHERE id=?', r.rating, r.rating_votes ?? null, m.id); }
    } catch (e) { console.log('  !', m.show_name, e.message); if (/429/.test(e.message)) await new Promise(r => setTimeout(r, 15000)); }
    if (++n % 50 === 0) console.log(`  ${n} done, ${ok} rated`);
    await new Promise(r => setTimeout(r, m.source === 'anilist' ? 900 : 550));
  }
  console.log(`done: ${ok} of ${rows.length} got a rating`);
  db.close();
})();
