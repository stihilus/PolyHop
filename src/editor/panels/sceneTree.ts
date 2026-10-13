// The left-hand lists of the level editor: which level is being edited, and the objects in it.

import type { Store } from '../store';
import { clear, el } from '../ui/dom';
import { renameInline } from '../ui/rename';

/** The level list: pick the level to edit, add, copy, rename, delete and reorder. */
export function fillLevelBar(bar: HTMLElement, store: Store, playing: boolean): void {
  clear(bar);
  const levels = store.project.levels;
  const select = el('select', {
    class: 'level-select',
    disabled: playing,
    title: 'The level you are editing. Play starts here; an exported game starts at level 1.',
  });
  levels.forEach((l, i) => select.append(el('option', { value: String(i), text: `${i + 1}. ${l.name}` })));
  select.value = String(store.levelIndex);
  select.addEventListener('change', () => store.setLevel(parseInt(select.value, 10)));

  const small = (text: string, title: string, fn: () => void, disabled = false) =>
    el('button', { class: 'btn small', text, title, disabled: disabled || playing, onclick: fn });
  const sky = el('input', { type: 'color', value: store.level.sky, disabled: playing, title: 'Color of the sky and the distance fog in this level' });
  sky.addEventListener('input', () => store.setSky(sky.value));
  bar.append(
    select,
    el(
      'div',
      { class: 'level-buttons' },
      small('+ New', 'A new empty level after this one', () => store.addLevel()),
      small('Copy', 'Duplicate this level', () => store.duplicateLevel()),
      small('Rename', 'Rename this level', () =>
        renameInline(select, store.level.name, (name) => store.renameLevel(name)),
      ),
      small('Delete', 'Delete this level (a project keeps at least one)', () => {
        if (confirm(`Delete “${store.level.name}” and everything in it?`)) store.removeLevel();
      }, levels.length <= 1),
      small('◀', 'Play this level earlier', () => store.moveLevel(-1), store.levelIndex === 0),
      small('▶', 'Play this level later', () => store.moveLevel(1), store.levelIndex >= levels.length - 1),
    ),
    el('label', { class: 'level-sky' }, el('span', { class: 'muted', text: 'Sky' }), sky),
  );
}

export function fillHierarchy(tree: HTMLElement, store: Store): void {
  clear(tree);
  const sel = store.selection;
  const row = (icon: string, label: string, selected: boolean, onclick: (e: MouseEvent) => void, id?: string) =>
    el(
      'button',
      {
        class: `tree-item${selected ? ' selected' : ''}`,
        onclick,
        'data-object-id': id,
        title: id ? 'Double-click or F2 to rename · Shift / Ctrl+click selects several' : undefined,
      },
      el('span', { class: 'tree-icon', text: icon }),
      el('span', { class: 'tree-label', text: label }),
    );
  tree.append(
    row('◉', 'Player', sel.kind === 'player', () => store.select({ kind: 'player' })),
    el('div', { class: 'tree-group', text: 'Level' }),
  );
  for (const o of store.objects) {
    tree.append(
      row(
        o.rules.length > 0 ? '★' : o.kind === 'model' ? '◆' : '▣',
        o.name,
        store.isSelected(o.id),
        (e) => {
          if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleObject(o.id);
          else store.select({ kind: 'object', id: o.id });
        },
        o.id,
      ),
    );
  }
}
