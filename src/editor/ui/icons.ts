// Small line icons (24x24, drawn with currentColor) for the toolbars. Each entry is the inner SVG markup.
// `fill` marks shapes that are filled with the current color instead of stroked.

const ICONS = {
  select: '<path d="M5 3.5l13 7.5-5.6 1.6L9.8 18z"/>',
  move:
    '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v4h-4"/>',
  scale:
    '<path d="M14 4h6v6M20 4l-7 7"/><path d="M10 20H4v-6M4 20l7-7"/>',
  object:
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  face:
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/><path class="fill" d="M12 12l8-4.5v9L12 21z"/>',
  vertex:
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" opacity=".55"/><circle class="fill" cx="12" cy="3" r="1.9"/><circle class="fill" cx="20" cy="7.5" r="1.9"/><circle class="fill" cx="20" cy="16.5" r="1.9"/><circle class="fill" cx="12" cy="21" r="1.9"/><circle class="fill" cx="4" cy="16.5" r="1.9"/><circle class="fill" cx="4" cy="7.5" r="1.9"/>',
  extrude:
    '<path d="M4 14h16v6H4z"/><path d="M6 14V9h12v5" opacity=".55"/><path d="M12 8V2M9 5l3-3 3 3"/>',
  inset: '<path d="M3.5 3.5h17v17h-17z"/><path d="M8.5 8.5h7v7h-7z"/><path d="M3.5 3.5l5 5M20.5 3.5l-5 5M3.5 20.5l5-5M20.5 20.5l-5-5" opacity=".55"/>',
  loopcut:
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" opacity=".6"/><path d="M4 12l8 4.5 8-4.5-8-4.5z" stroke-dasharray="0"/>',
  subdivide: '<path d="M3.5 3.5h17v17h-17z"/><path d="M12 3.5v17M3.5 12h17"/>',
  addvertex:
    '<path d="M3 18L21 6"/><circle class="fill" cx="12" cy="12" r="2.6"/><path d="M18 19h4M20 17v4"/>',
  sculpt: '<path d="M3 19l5-8 3 4 3-6 7 10z"/><path d="M9 6a2 2 0 1 0 0 .01" opacity=".55"/>',
  bevel: '<path d="M8 4h8l4 4v8l-4 4H8l-4-4V8z"/><path d="M8 4l-4 4M16 4l4 4M8 20l-4-4M16 20l4-4" opacity=".55"/>',
  smooth: '<path d="M12 4c5.5 0 8 3 8 8s-2.5 8-8 8-8-3-8-8 2.5-8 8-8z"/><path d="M8.5 11c0-2 1.2-3 3.5-3" opacity=".6"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  merge:
    '<circle cx="4.5" cy="12" r="1.8"/><circle cx="19.5" cy="12" r="1.8"/><circle class="fill" cx="12" cy="12" r="2.6"/><path d="M7.5 12h2M16.5 12h-2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12H8"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h6"/>',
  world:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  local: '<path d="M6 18V5M6 18h13M6 18l7-7"/><path d="M4 7l2-2 2 2M17 16l2 2-2 2" opacity=".6"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  view:
    '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  place: '<path d="M4 4h10M4 4v16h16V10"/><path d="M11 13l9-9M14 4h6v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  paint: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/>',
  save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
} as const;

export type IconName = keyof typeof ICONS;

/** An inline SVG icon element. */
export function icon(name: IconName, size = 20): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}
