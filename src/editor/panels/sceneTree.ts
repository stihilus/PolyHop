// The left-hand lists of the level editor: which level is being edited, and the objects in it.

import type { Store } from '../store';
import { clear, el } from '../ui/dom';
import { appConfirm } from '../ui/dialogs';
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
        const level = store.level;
        void appConfirm(`Delete “${level.name}” and everything in it?`, { title: 'Delete level', confirmLabel: 'Delete', danger: true }).then((ok) => {
          if (ok && store.level === level) store.removeLevel();
        });
      }, levels.length <= 1),
      small('◀', 'Play this level earlier', () => store.moveLevel(-1), store.levelIndex === 0),
      small('▶', 'Play this level later', () => store.moveLevel(1), store.levelIndex >= levels.length - 1),
    ),
    el('label', { class: 'level-sky' }, el('span', { class: 'muted', text: 'Sky' }), sky),
  );
}

/** Groups of repeated objects the user has opened (by the id of the first object of the run). */
const openRuns = new Set<string>();

/** Runs of at least this many objects in a row with the same name are folded into one row. */
const MIN_RUN = 3;

interface Run {
  start: number;
  end: number;
}

/** Consecutive objects that share a name (a row of fence posts, a trail of coins). */
function runsOf(objects: { name: string }[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < objects.length) {
    let j = i + 1;
    while (j < objects.length && objects[j]!.name === objects[i]!.name) j++;
    if (j - i >= MIN_RUN) runs.push({ start: i, end: j });
    i = j;
  }
  return runs;
}

/**
 * The objects of the level. With a filter only the objects whose name matches are listed; without one, a long row
 * of objects with the same name is folded into a single row that opens with a click (Shift + click selects them all).
 */
export function fillHierarchy(tree: HTMLElement, store: Store, filter = ''): void {
  clear(tree);
  const sel = store.selection;
  const row = (icon: string, label: string, selected: boolean, onclick: (e: MouseEvent) => void, id?: string, extra = '', iconClass = '') =>
    el(
      'button',
      {
        class: `tree-item${selected ? ' selected' : ''}${extra}`,
        onclick,
        'data-object-id': id,
        title: id ? 'Double-click or F2 to rename · Shift / Ctrl+click selects several' : undefined,
      },
      el('span', { class: `tree-icon${iconClass}`, text: icon }),
      el('span', { class: 'tree-label', text: label }),
    );
  tree.append(row('◉', 'Player', sel.kind === 'player', () => store.select({ kind: 'player' })));
  // ordinary objects are yellow (★ when they do something); an instance of a component is a purple hollow diamond (the
  // component itself is in the Assets and the Models)
  const iconOf = (o: (typeof store.objects)[number]): { text: string; cls: string } => {
    if (o.kind === 'model' && store.getModel(o.modelId)?.component) return { text: '◇', cls: ' icon-component' };
    return { text: o.rules.length > 0 ? '★' : '▣', cls: '' };
  };
  const objectRow = (o: (typeof store.objects)[number], extra = '') =>
    row(
      iconOf(o).text,
      o.name,
      store.isSelected(o.id),
      (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) store.toggleObject(o.id);
        else store.select({ kind: 'object', id: o.id });
      },
      o.id,
      extra,
      iconOf(o).cls,
    );

  const objects = store.objects;
  const query = filter.trim().toLowerCase();
  if (query) {
    const hits = objects.filter((o) => o.name.toLowerCase().includes(query));
    tree.append(el('div', { class: 'tree-group', text: `${hits.length} of ${objects.length}` }));
    if (hits.length === 0) tree.append(el('div', { class: 'empty muted', text: 'No object has that name.' }));
    for (const o of hits) tree.append(objectRow(o));
    return;
  }

  tree.append(el('div', { class: 'tree-group', text: `Level · ${objects.length}` }));
  const runs = new Map(runsOf(objects).map((r) => [r.start, r] as const));
  for (let i = 0; i < objects.length; i++) {
    const run = runs.get(i);
    if (!run) {
      tree.append(objectRow(objects[i]!));
      continue;
    }
    const members = objects.slice(run.start, run.end);
    const key = members[0]!.id;
    // a group with a selected object stays open, so the selection is never hidden
    const open = openRuns.has(key) || members.some((o) => store.isSelected(o.id));
    const allSelected = members.every((o) => store.isSelected(o.id));
    tree.append(
      el(
        'button',
        {
          class: `tree-item tree-run${allSelected ? ' selected' : ''}`,
          title: 'Click to open or close · Shift + click selects all of them',
          onclick: (e: MouseEvent) => {
            if (e.shiftKey) {
              store.selectObjects(members.map((o) => o.id));
              return;
            }
            if (openRuns.has(key)) openRuns.delete(key);
            else openRuns.add(key);
            fillHierarchy(tree, store, filter);
          },
        },
        el('span', { class: 'tree-icon', text: open ? '▾' : '▸' }),
        el('span', { class: 'tree-label', text: `${members[0]!.name} × ${members.length}` }),
      ),
    );
    if (open) for (const o of members) tree.append(objectRow(o, ' tree-child'));
    i = run.end - 1;
  }
}
