'use strict';
// Upgrade candidates: which titles are worth replacing with a better copy, and which are not worth the disk.
// The service builds one summary per title; this module ranks them.

const RES_RANK = { SD: 0, '480p': 1, '576p': 2, '720p': 3, '1080p': 4, '1440p': 5, '4K': 6 };

/**
 * One title's facts, all already known to the ledger:
 *   t.kind          'series' | 'movie'
 *   t.best          best resolution on disk ('720p', '1080p', '4K' …) — RES_RANK[t.best] gives 0..6
 *   t.plays         total Plex play count across the title's files (0 when never played or not in Plex)
 *   t.watched_pct   0..100, share of the files Plex marks watched
 *   t.my_rating     your stars 0..5 or null
 *   t.online_rating online average out of 10 (TVmaze / AniList / Plex audience) or null
 *   t.low_bitrate   number of files under the bitrate threshold for their resolution
 *   t.files         number of files
 *   t.hdr           true when any file is HDR
 *   t.gb            size in gigabytes
 *
 * Return a number: higher = more worth upgrading. 0 or less = not a candidate.
 */
function upgradeScore(t) {
  // Already the best we store? Done, whatever else is true.
  const rank = RES_RANK[t.best] != null ? RES_RANK[t.best] : 0;
  if (rank >= RES_RANK['4K'] || t.hdr) return 0;
  // How much the copy falls short: 1080p = 1, 720p = 2, SD = 5. Low bitrate adds up to +1 even at 1080p.
  const gap = RES_RANK['1080p'] - rank + 1;
  const bitrate = t.files ? Math.min(1, (t.low_bitrate || 0) / t.files) : 0;
  const shortfall = gap + bitrate;
  // How much you care: plays saturate at 10, your stars count double, a strong online rating nudges.
  const plays = Math.min(10, t.plays || 0) / 10;
  const mine = t.my_rating ? t.my_rating / 5 : 0;
  const online = t.online_rating ? Math.max(0, t.online_rating - 6) / 4 : 0;
  const interest = plays + 2 * mine + 0.5 * online;
  if (!interest && !bitrate) return 0; // never played, unrated, fine bitrate: not worth the bytes
  return Math.round(shortfall * (0.25 + interest) * 100) / 100;
}

/** Plain-English reasons shown next to the score. */
function upgradeReasons(t) {
  const r = [];
  const rank = RES_RANK[t.best] ?? -1;
  if (rank >= 0 && rank <= 3) r.push(`${t.best} copy`);
  if (t.low_bitrate) r.push(`${t.low_bitrate} low-bitrate file${t.low_bitrate === 1 ? '' : 's'}`);
  if (t.plays) r.push(`played ${t.plays}×`);
  if (t.my_rating >= 4) r.push(`you rate it ${t.my_rating}★`);
  if (t.online_rating >= 8) r.push(`rated ${Number(t.online_rating).toFixed(1)} online`);
  if (!t.plays && !t.my_rating) r.push('never played, unrated');
  return r;
}

module.exports = { upgradeScore, upgradeReasons, RES_RANK };
