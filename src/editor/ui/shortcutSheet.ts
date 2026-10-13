// The keyboard shortcuts of the level editor, as a sheet that opens over the view (the "?" button or the ? key).

import { el } from './dom';

interface Group {
  title: string;
  rows: [string, string][];
}

const GROUPS: Group[] = [
  {
    title: 'Move around',
    rows: [
      ['Orbit', 'Middle mouse (Alt + left on a trackpad)'],
      ['Pan', 'Shift + middle mouse'],
      ['Zoom', 'Wheel'],
      ['Fly', 'Hold right mouse + W A S D Q E (Shift = faster)'],
      ['Focus the selection', 'F'],
      ['Front / side / top view', 'Numpad 1 / 3 / 7 (Ctrl = opposite side)'],
      ['Perspective / flat', 'Numpad 5'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      ['Select · Move · Rotate · Scale', 'Q · W · E · R'],
      ['Object · Face · Vertex', '1 · 2 · 3'],
      ['World / local axes', 'X'],
      ['Sculpt terrain · Paint tiles', 'G · P'],
    ],
  },
  {
    title: 'Shape',
    rows: [
      ['Extrude · Inset', 'T · I'],
      ['Loop cut · Add vertex', 'L · V'],
      ['Subdivide · Merge', 'U · M'],
      ['Bevel · Smooth', 'B · H'],
      ['Delete faces / vertices / object', 'Delete'],
    ],
  },
  {
    title: 'Project',
    rows: [
      ['Undo · Redo', 'Ctrl/Cmd + Z · Shift + Ctrl/Cmd + Z'],
      ['Duplicate · Select all', 'Ctrl/Cmd + D · Ctrl/Cmd + A'],
      ['Rename', 'F2 (or double-click in the list)'],
      ['Save', 'Ctrl/Cmd + S'],
    ],
  },
];

/** The sheet itself; the caller puts it in the page and shows or hides it. */
export function shortcutSheet(onClose: () => void): HTMLElement {
  const sheet = el('div', { class: 'shortcut-sheet hidden', role: 'dialog', 'aria-label': 'Keyboard shortcuts' });
  sheet.append(
    el(
      'div',
      { class: 'shortcut-head' },
      el('span', { text: 'Keyboard shortcuts' }),
      el('button', { class: 'icon-btn', text: '×', title: 'Close (Esc)', 'aria-label': 'Close', onclick: onClose }),
    ),
  );
  for (const g of GROUPS) {
    const list = el('div', { class: 'shortcut-group' }, el('div', { class: 'form-section', text: g.title }));
    for (const [what, keys] of g.rows) list.append(el('div', { class: 'shortcut-row' }, el('span', { text: what }), el('kbd', { text: keys })));
    sheet.append(list);
  }
  return sheet;
}
