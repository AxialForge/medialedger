'use strict';
// Live check against TVmaze and AniList (network). Not part of `npm test`.
const m = require('../src/main/metadata');
(async () => {
  const cases = [['tv', '3 Body Problem'], ['tv', 'The Boys'], ['tv', 'Attack on Titian'], ['anime', 'Attack on Titan'], ['anime', 'A Couple of Cuckoos'], ['anime', 'One Piece'], ['anime', '4 Cut Hero']];
  for (const [t, s] of cases) {
    const t0 = Date.now();
    try {
      const r = await m.lookupSeries(t, s);
      console.log(t, '|', s, '→', r.found ? `${r.matched_title} [${r.status}] seasons=${JSON.stringify(r.seasons)} total=${r.total_episodes}` : 'NOT FOUND ' + JSON.stringify(r.candidates || []).slice(0, 160), `${Date.now() - t0}ms`);
    } catch (e) { console.log(t, '|', s, 'ERR', e.message); }
    await new Promise(r => setTimeout(r, 800));
  }
})();
