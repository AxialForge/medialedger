'use strict';
// Applies the colour theme saved in this browser before the first paint, so pages never flash the default.
// The palettes live in styles.css (html[data-theme="…"]); the picker is under Settings → Appearance.
(function () {
  try { const t = localStorage.getItem('medialedger.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage blocked: default theme */ }
})();
