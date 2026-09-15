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
  // TODO(human): rank the title. Ideas: low resolution matters more the more it is played or the higher you rate it;
  // low bitrate is a reason even at 1080p; something never played and unrated is barely worth a byte;
  // 4K/HDR copies are done. Keep it monotonic and cheap: this runs for ~2,000 titles on every page open.
  return 0;
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
