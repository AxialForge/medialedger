'use strict';
/* MediaLedger predates the Bracket kit, so its helpers live inside app.js rather than in a shared UI
   module. dash.js (vendored from the kit) expects window.UI. This file provides that surface: the
   stateless helpers are defined here, and the ones that belong to the app (toast, modals, the bridge,
   who is signed in) are forwarded to window.__ml, which app.js fills in before its first route().
   Load order: ui-shim.js, dash.js, app.js. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The period of trend cards. MediaLedger's history is one snapshot a day, so periods are in days.
  const RANGE_LABEL = { '30d': 'last 30 days', '90d': 'last 90 days', '1y': 'last year', all: 'all time' };
  const RANGE_DAYS = { '30d': 30, '90d': 90, '1y': 365, all: 36500 };
  const rangePicker = (cur) => `<select id="rangeSel" class="small">${Object.entries(RANGE_LABEL).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  const store = {
    get(key, dflt) { let v = null; try { v = localStorage.getItem('medialedger.dash.' + key); } catch { /* storage blocked */ } if (key === 'range') return RANGE_LABEL[v] ? v : '90d'; return v == null ? dflt : v; },
    set(key, value) { try { localStorage.setItem('medialedger.dash.' + key, String(value)); } catch { /* storage blocked */ } },
  };
  const app = () => window.__ml || {};
  window.UI = {
    $, esc, store, RANGE_LABEL, RANGE_DAYS, rangePicker,
    toast: (...a) => app().toast(...a),
    openModal: (...a) => app().openModal(...a),
    closeModal: (...a) => app().closeModal(...a),
    api: () => app().api,
    isGuest: () => !!(app().isGuest && app().isGuest()),
    view: () => $('#view'),
    level: () => (app().level ? app().level() : 'standard'),
    setLevel: (l) => app().setLevel && app().setLevel(l),
  };
})();
