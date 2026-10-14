// The look of a model: how its faces take their picture from the texture (one tile repeated, or every face with its
// own UV), and the tint. Shared by the component panel of the Level and the model editor.

import { isTiled, modelLook, setMapping } from '../../core/components';
import type { Model, ModelLook } from '../../core/types';
import type { TextureLibrary } from '../../runtime/textures';
import { el } from './dom';
import { buildTilePicker } from './tilePicker';

export interface ModelLookOptions {
  model: Model;
  textures: TextureLibrary;
  /** What changed: the mapping (the model is drawn another way), or something of its look. */
  onChange: (what: 'mapping' | 'look') => void;
  /** Redraw the panel (the mapping decides what is shown). */
  rerender: () => void;
}

/** A line saying what a model or a placement is: a master or a variant, an instance, or an ordinary object. */
export function componentBadge(text: string, kind: 'master' | 'instance' | 'object'): HTMLElement {
  const mark = kind === 'master' ? '◆' : kind === 'instance' ? '◇' : '▣';
  return el('div', { class: `component-badge component-${kind}` }, el('span', { class: 'component-mark', text: mark }), el('span', { text }));
}

const row = (label: string, ...controls: HTMLElement[]) =>
  el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, ...controls));

/** The panel: mapping switch, then the tile and tint (tile mapping) or only the tint (UV). */
export function buildModelLookEditor(opts: ModelLookOptions): HTMLElement {
  const { model, textures } = opts;
  const root = el('div', { class: 'model-look' });
  const tiled = isTiled(model);
  const info = model.texture ? textures.get(model.texture) : null;
  const tileSize = info?.tileSize ?? 16;
  const rigged = model.bones.length > 0;

  const look = (): ModelLook => {
    if (!model.look) model.look = modelLook(model);
    return model.look;
  };

  const mapping = el('select', { title: 'How the faces get their picture' });
  mapping.append(
    el('option', { value: 'tile', text: 'Tile: one tile repeated over every face' }),
    el('option', { value: 'uv', text: 'UV: every face has its own part of the texture' }),
  );
  mapping.value = tiled ? 'tile' : 'uv';
  mapping.disabled = rigged;
  mapping.addEventListener('change', () => {
    setMapping(model, mapping.value === 'tile' ? 'tile' : 'uv', tileSize);
    opts.onChange('mapping');
    opts.rerender();
  });
  root.append(row('Mapping', mapping));
  root.append(
    el('div', {
      class: 'empty muted',
      text: rigged
        ? 'A model with bones uses UV: every part has its own picture.'
        : tiled
          ? 'The picture is repeated once per meter, and keeps its size when the object is made bigger: walls, floors, boxes. Use UV to paint every face on its own.'
          : 'Every face shows its own part of the texture, as you set it in the UV panel. Use Tile for a surface that repeats.',
    }),
  );

  const tint = el('input', { type: 'color', value: modelLook(model).tint });
  tint.addEventListener('input', () => {
    look().tint = tint.value;
    opts.onChange('look');
  });
  root.append(row('Tint', tint));

  if (!tiled) return root;

  const l = look();
  const textureSelect = el('select', {});
  for (const n of textures.names()) textureSelect.append(el('option', { value: n, text: n, selected: n === model.texture }));
  if (!model.texture) textureSelect.prepend(el('option', { value: '', text: 'None (plain color)', selected: true }));
  textureSelect.addEventListener('change', () => {
    model.texture = textureSelect.value || null;
    opts.onChange('look');
    opts.rerender();
  });
  root.append(row('Texture', textureSelect));

  const picker = buildTilePicker({
    textures,
    get: () => (model.texture && l.tile ? { texture: model.texture, col: l.tile.col, row: l.tile.row } : null),
    onPick: (t) => {
      model.texture = t.texture;
      l.tile = { col: t.col, row: t.row };
      opts.onChange('look');
    },
    zoom: 2,
    maxHeight: 240,
  });
  root.append(picker.el);

  const opacity = el('input', { type: 'number', min: '0.05', max: '1', step: '0.05', value: String(l.opacity ?? 1) });
  opacity.addEventListener('change', () => {
    const v = Math.min(1, Math.max(0.05, parseFloat(opacity.value) || 1));
    if (v < 1) l.opacity = v;
    else delete l.opacity;
    opacity.value = String(v);
    opts.onChange('look');
  });
  root.append(row('Opacity', opacity));

  const water = el('input', { type: 'checkbox', checked: l.liquid === true });
  water.addEventListener('change', () => {
    if (water.checked) l.liquid = true;
    else delete l.liquid;
    opts.onChange('look');
  });
  root.append(row('Water (swim)', water));

  const both = el('input', { type: 'checkbox', checked: l.doubleSided !== false });
  both.addEventListener('change', () => {
    l.doubleSided = both.checked;
    opts.onChange('look');
  });
  root.append(row('Both sides', both));
  return root;
}
