'use strict';
// End-to-end: scan two small real roots into a temp DB, twice, then export CSVs.
const path = require('path'); const fs = require('fs'); const os = require('os');
const { Db } = require('../src/main/db'); const { Scanner } = require('../src/main/scanner'); const { exportAll } = require('../src/main/exportCsv'); const { DEFAULTS } = require('../src/main/settings');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-'));
const cfg = structuredClone(DEFAULTS);
cfg.roots = [
  { id: 'tv', label: 'TV', path: '//192.168.1.204/Apocrypha_Media_Pool/TV_Shows', type: 'tv', enabled: true },
  { id: 'anime', label: 'Anime', path: '//192.168.1.204/Apocrypha_Media_Pool/Anime/4 Cut Hero', type: 'anime', enabled: true },
  { id: 'off', label: 'Offline', path: '//192.168.1.204/nope', type: 'movie', enabled: true },
];
cfg.probeConcurrency = 8; cfg.multiThreaded = true; cfg.scanThreads = 4;
const settings = { get: () => cfg };
const db = new Db(path.join(tmp, 't.db'));
const sc = new Scanner(db, settings);
sc.onProgress(p => { if (p.phase === 'probe' && p.done % 10 === 0 || p.phase === 'done') console.log('  ', p.phase, p.message); });
(async () => {
  console.time('scan1'); const r1 = await sc.scan('manual'); console.timeEnd('scan1'); console.log(r1);
  console.time('scan2'); const r2 = await sc.scan('manual'); console.timeEnd('scan2'); console.log(r2);
  console.log(db.all('SELECT show_name, season, episode, resolution, fps, video_codec, audio_langs, sub_count, has_captions, duration_s FROM files ORDER BY show_name, episode LIMIT 4'));
  console.log('changes:', db.all('SELECT kind, COUNT(*) n FROM changes GROUP BY kind'));
  const out = exportAll(db, path.join(tmp, 'exports'), r1.scanId); console.log(out);
  for (const f of ['tv_series.csv', 'anime_episodes.csv']) console.log('--', f, '\n' + fs.readFileSync(path.join(out.latest, f), 'utf8').split('\n').slice(0, 3).join('\n'));
  db.close();
})().catch(e => { console.error(e); process.exit(1); });
