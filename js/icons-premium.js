/*
 * Bibliotheque visuelle ClicChantier : pictogrammes 3D premium.
 * Aucun comportement applicatif : uniquement des SVG decoratifs.
 */
(function (root) {
  "use strict";

  let uid = 0;

  const GLYPHS = {
    planning: '<rect x="8" y="9.5" width="16" height="14" rx="3"/><path d="M8 14h16M12 7.5v4M20 7.5v4"/><path class="accent" d="M11.5 17.5h3v3h-3z"/>',
    equipe: '<circle cx="13" cy="12.5" r="3.4"/><path d="M7.8 23c.5-4 2.4-6 5.2-6s4.7 2 5.2 6"/><circle class="accent" cx="21.5" cy="13.5" r="2.4"/><path class="accent-stroke" d="M19.4 18.1c2.8-.7 4.8 1 5.3 4.1"/>',
    tournee: '<path d="M23 13.2c0 5.8-7 11.5-7 11.5S9 19 9 13.2a7 7 0 1 1 14 0Z"/><circle class="accent" cx="16" cy="13" r="2.5"/>',
    plus: '<path d="M16 8v16M8 16h16"/><circle class="accent-stroke" cx="16" cy="16" r="10"/>',
    back: '<path d="m19.5 8-8 8 8 8"/><path class="accent-stroke" d="M12 16h11"/>',
    forward: '<path d="m12.5 8 8 8-8 8"/><path class="accent-stroke" d="M20 16H9"/>',
    phone: '<path d="M10.2 8.2 13 12l-2 2.2c1.6 3 3.8 5.2 6.8 6.8l2.2-2 3.8 2.8-.7 3c-.2.9-1 1.5-2 1.4C13.4 25.3 6.7 18.6 5.8 11c-.1-1 .5-1.8 1.4-2Z"/><path class="accent-stroke" d="M18 7c3.7.6 6.4 3.3 7 7"/>',
    map: '<path d="m6.5 9 6-3 7 3 6-3v17l-6 3-7-3-6 3Z"/><path d="M12.5 6v17M19.5 9v17"/><circle class="accent" cx="16" cy="14" r="2.2"/>',
    note: '<path d="M9 5.8h10l5 5V26H9Z"/><path d="M19 5.8V11h5M12.5 16h8M12.5 20h6"/><circle class="accent" cx="22.5" cy="23.5" r="2"/>',
    mic: '<rect x="12" y="5.5" width="8" height="14" rx="4"/><path d="M8.5 15.5a7.5 7.5 0 0 0 15 0M16 23v4M12 27h8"/><circle class="accent" cx="16" cy="10" r="1.5"/>',
    spark: '<path d="m16 4 2.5 7.5L26 14l-7.5 2.5L16 24l-2.5-7.5L6 14l7.5-2.5Z"/><path class="accent-stroke" d="m24.5 5 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
    gear: '<circle cx="16" cy="16" r="4"/><path d="M16 5.5v3M16 23.5v3M5.5 16h3M23.5 16h3M8.6 8.6l2.1 2.1M21.3 21.3l2.1 2.1M23.4 8.6l-2.1 2.1M10.7 21.3l-2.1 2.1"/><circle class="accent-stroke" cx="16" cy="16" r="8.5"/>',
    trash: '<path d="M8.5 10h15l-1 16h-13ZM6.5 10h19M12 10V6.5h8V10M13 14v8M19 14v8"/>',
    metier: '<path d="M21.8 7.2a6 6 0 0 0-8 7.7L6 22.7a2.3 2.3 0 0 0 3.3 3.3l7.8-7.8a6 6 0 0 0 7.7-8l-4 4-3.1-.9-.9-3.1Z"/><circle class="accent" cx="8" cy="24" r="1.2"/>',
    wrench: '<path d="M21.8 7.2a6 6 0 0 0-8 7.7L6 22.7a2.3 2.3 0 0 0 3.3 3.3l7.8-7.8a6 6 0 0 0 7.7-8l-4 4-3.1-.9-.9-3.1Z"/><circle class="accent" cx="8" cy="24" r="1.2"/>',
    flame: '<path d="M16 5c5.4 4.5 7.2 8.2 6.5 12.4-.6 4.3-3.1 7.6-6.5 7.6s-6-2.7-6.5-6.4c-.3-2.4.5-4.6 2.2-6.6.2 3.2 1.7 4.1 2.8 4.4-.8-3.8.3-7.3 1.5-11.4Z"/><path class="accent-stroke" d="M16.3 17c1.6 1.7 2.1 3 1.6 4.3-.3 1-1 1.7-2 1.7-1.4 0-2.3-1.2-2-2.6.3-1.2 1.2-1.9 2.4-3.4Z"/>',
    list: '<path d="M12 9h13M12 16h13M12 23h13"/><circle class="accent" cx="7" cy="9" r="1.7"/><circle class="accent" cx="7" cy="16" r="1.7"/><circle class="accent" cx="7" cy="23" r="1.7"/>',
    file: '<path d="M9 5.8h10l5 5V26H9Z"/><path d="M19 5.8V11h5M12.5 16h8M12.5 20h6"/><circle class="accent" cx="22.5" cy="23.5" r="2"/>',
    bell: '<path d="M9 22h14c-2-2.3-2.2-4.8-2.2-8a4.8 4.8 0 0 0-9.6 0c0 3.2-.2 5.7-2.2 8Z"/><path d="M14 25a2.2 2.2 0 0 0 4 0"/><circle class="accent" cx="23" cy="9" r="2.2"/>',
    calendar: '<rect x="8" y="9.5" width="16" height="14" rx="3"/><path d="M8 14h16M12 7.5v4M20 7.5v4"/><path class="accent" d="M11.5 17.5h3v3h-3z"/>',
    edit: '<path d="m9 22 1-5 10-10a2.4 2.4 0 0 1 3.4 3.4l-10 10Z"/><path d="m18.5 8.5 3 3M8 26h16"/><circle class="accent" cx="9.8" cy="21.3" r="1.5"/>',
    check: '<path d="m7 16 5.5 5.5L25 8.5"/><circle class="accent-stroke" cx="16" cy="16" r="10"/>',
    building: '<rect x="8" y="5" width="16" height="22" rx="2"/><path d="M13 27v-5h6v5M12 10h2M18 10h2M12 15h2M18 15h2"/><path class="accent-stroke" d="M24 12h3v15h-3"/>',
    bolt: '<path d="m18 4-10 14h7l-1 10 10-15h-7Z"/><path class="accent-stroke" d="M22 6.5 25 9"/>',
    calc: '<rect x="8" y="4.5" width="16" height="23" rx="3"/><path d="M11 8h10v4H11Z"/><circle class="accent" cx="12" cy="17" r="1.2"/><circle class="accent" cx="16" cy="17" r="1.2"/><circle class="accent" cx="20" cy="17" r="1.2"/><circle class="accent" cx="12" cy="22" r="1.2"/><circle class="accent" cx="16" cy="22" r="1.2"/><circle class="accent" cx="20" cy="22" r="1.2"/>',
    panel: '<rect x="8" y="5" width="16" height="22" rx="3"/><path d="M11 10h10M11 15h10M11 20h6"/><circle class="accent" cx="21" cy="22" r="1.8"/>',
    plug: '<path d="M11 5v7M21 5v7M8 12h16v3a8 8 0 0 1-16 0ZM16 23v5"/><circle class="accent" cx="16" cy="16" r="2"/>',
    roller: '<rect x="6" y="7" width="16" height="7" rx="2"/><path d="M22 10h4v5h-10v4M16 19v8"/><path class="accent" d="M7 9h14v3H7z"/>',
    ruler: '<path d="m7 21 14-14 5 5-14 14Z"/><path d="m19 9 2 2M16 12l2 2M13 15l2 2M10 18l2 2"/><circle class="accent" cx="9" cy="24" r="1.3"/>',
    wall: '<rect x="5" y="7" width="22" height="18" rx="2"/><path d="M5 13h22M5 19h22M12 7v6M20 13v6M12 19v6"/><path class="accent" d="M6.5 8.5h4v3h-4z"/>',
    trowel: '<path d="m6 20 8-8 7 7-8 8Z"/><path d="m19 13 4-4a2.2 2.2 0 0 1 3 3l-4 4"/><circle class="accent" cx="10" cy="23" r="1.5"/>',
    paint: '<rect x="7" y="6" width="15" height="8" rx="2"/><path d="M22 10h4v5H16v4M16 19v8"/><path class="accent" d="M8.5 8h12v4h-12z"/>',
    paper: '<path d="M8 6h12a3 3 0 0 1 3 3v17H11a3 3 0 0 1-3-3Z"/><path d="M23 10h3v13M12 12h7M12 17h7M12 22h5"/><circle class="accent" cx="24.5" cy="25" r="1.5"/>'
  };

  const PALETTES = {
    cyan: ["#35d8ff", "#087fae", "#9ff3ff"],
    violet: ["#a99aff", "#5442bd", "#e3dcff"],
    amber: ["#ffc45b", "#b75a0c", "#fff0ba"],
    green: ["#62ebae", "#078f6a", "#c9ffe7"],
    red: ["#ff8192", "#a72d4d", "#ffd6dc"]
  };

  function paletteFor(name) {
    if (/equipe|mic|spark/.test(name)) return PALETTES.violet;
    if (/metier|wrench|flame|roller|ruler|trowel|paint/.test(name)) return PALETTES.amber;
    if (/phone|check/.test(name)) return PALETTES.green;
    if (/trash/.test(name)) return PALETTES.red;
    return PALETTES.cyan;
  }

  function icon3D(name) {
    const glyph = GLYPHS[name] || GLYPHS.spark;
    const p = paletteFor(name);
    const id = "cc3d-" + (++uid);
    return '<svg class="icon-3d icon-3d-' + name + '" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="' + id + '-bg" x1="4" y1="3" x2="27" y2="29" gradientUnits="userSpaceOnUse">' +
          '<stop stop-color="' + p[0] + '"/><stop offset=".52" stop-color="' + p[1] + '"/><stop offset="1" stop-color="#06101d"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + id + '-rim" x1="8" y1="5" x2="25" y2="27" gradientUnits="userSpaceOnUse">' +
          '<stop stop-color="#fff" stop-opacity=".78"/><stop offset=".35" stop-color="' + p[2] + '" stop-opacity=".35"/><stop offset="1" stop-color="' + p[0] + '" stop-opacity=".08"/>' +
        '</linearGradient>' +
        '<filter id="' + id + '-shadow" x="-30%" y="-30%" width="160%" height="180%">' +
          '<feDropShadow dx="0" dy="2.2" stdDeviation="1.8" flood-color="#000" flood-opacity=".58"/>' +
        '</filter>' +
      '</defs>' +
      '<rect x="2.2" y="3.2" width="27.6" height="27" rx="8.5" fill="#000" opacity=".42"/>' +
      '<rect x="2.2" y="1.8" width="27.6" height="27" rx="8.5" fill="url(#' + id + '-bg)" stroke="url(#' + id + '-rim)" stroke-width="1"/>' +
      '<path d="M5.5 10.5C8 5.7 13 3.6 21.5 4.3c3.1.3 4.9 1.5 5.8 3.6-6.4-1.2-14.4.2-21.8 2.6Z" fill="#fff" opacity=".17"/>' +
      '<g class="icon-3d-glyph" fill="none" stroke="#f8fcff" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" filter="url(#' + id + '-shadow)">' +
        glyph +
      '</g>' +
      '<circle cx="25.5" cy="24.8" r="2.1" fill="' + p[2] + '" opacity=".88"/>' +
    '</svg>';
  }

  root.ClicChantierIcons3D = icon3D;
})(window);
