'use strict';
// Plex integration placeholder. Kept deliberately small: a connection test so the
// settings page can validate a URL + token now, and a documented seam for later
// (matching Plex library items to files, watched state, Plex titles).
async function testConnection(plexCfg) {
  if (!plexCfg || !plexCfg.baseUrl) return { ok: false, message: 'No Plex URL configured' };
  if (!plexCfg.token) return { ok: false, message: 'No Plex token configured' };
  try {
    const url = plexCfg.baseUrl.replace(/\/$/, '') + '/identity';
    const res = await fetch(url, { headers: { 'X-Plex-Token': plexCfg.token, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, message: `Plex answered HTTP ${res.status}` };
    const j = await res.json();
    const mc = j.MediaContainer || {};
    return { ok: true, message: `Connected: Plex ${mc.version || '?'} (machine ${String(mc.machineIdentifier || '').slice(0, 8)}…)` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Plex: ' + e.message };
  }
}

module.exports = { testConnection };
