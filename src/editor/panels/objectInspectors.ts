// The right-hand panel for objects: one or several selected, a block, a model, and game object assets.

import * as THREE from 'three';
import { changePrefabLook, placedFrom } from '../../core/prefabs';
import { recenterMesh, meshSize, scaleMeshToSize } from '../../core/mesh';
import { quaternionFromDegrees } from '../../core/shape';
import { type LevelBlock, type LevelModelInstance, type LevelObject, type Prefab, type Vec3, newId } from '../../core/types';
import { clear, el } from '../ui/dom';
import { type Field, buildForm } from '../ui/form';
import { buildTilePicker } from '../ui/tilePicker';
import { BLOCK_FIELDS } from './fields';
import type { PanelHost } from './host';
import { appConfirm } from '../ui/dialogs';

/** Several objects selected: what can be done to all of them at once. */
export function buildMultiInspector(host: PanelHost): void {
  const objs = host.store.selectedIds().map((id) => host.store.getObject(id)).filter((o): o is LevelObject => !!o);
  const changeAll = (fn: (o: LevelObject) => void) => {
    for (const o of objs) {
      fn(o);
      host.store.emit({ type: 'object-changed', id: o.id });
    }
    host.store.commitLevel('edit:multi');
    host.refreshInspector();
  };
  const solid = objs.filter((o) => o.collide).length;
  const list = el('div', { class: 'multi-list' });
  for (const o of objs.slice(0, 40)) list.append(el('div', { class: 'multi-item', text: o.name }));
  if (objs.length > 40) list.append(el('div', { class: 'multi-item muted', text: `… and ${objs.length - 40} more` }));
  host.inspector.append(
    el('div', { class: 'section-title', text: `${objs.length} objects selected` }),
    el('div', {
      class: 'empty muted',
      text: 'The gizmo moves, turns and scales them together. Shift / Ctrl+click adds or removes one, drag a rectangle in the view to select an area, Ctrl+A selects all.',
    }),
    list,
    el(
      'div',
      { class: 'button-stack row' },
      el('button', { class: 'btn', text: 'Duplicate', onclick: () => host.duplicateSelected() }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: () => host.deleteSelected() }),
    ),
    el('div', { class: 'form-section', text: 'All of them' }),
    el('div', { class: 'empty muted', text: `${solid} of ${objs.length} are solid.` }),
    el(
      'div',
      { class: 'button-stack row' },
      el('button', { class: 'btn', text: 'Make solid', onclick: () => changeAll((o) => (o.collide = true)) }),
      el('button', { class: 'btn', text: 'Not solid', onclick: () => changeAll((o) => (o.collide = false)) }),
    ),
    el(
      'div',
      { class: 'button-stack row' },
      el('button', {
        class: 'btn',
        text: 'Snap to grid',
        title: 'Round every position to 0.5 m',
        onclick: () => changeAll((o) => (o.position = o.position.map((n) => Math.round(n * 2) / 2) as Vec3)),
      }),
      el('button', { class: 'btn', text: 'Select none', onclick: () => host.store.select({ kind: 'none' }) }),
    ),
  );
}

/** `asset`: the block is the template of a game object asset (no position or name of its own). */
export function buildBlockInspector(host: PanelHost, obj: LevelBlock, asset = false): void {
  // "Size" is derived from the mesh; editing it scales the vertices
  const view = {
    name: obj.name,
    position: obj.position,
    rotation: obj.rotation,
    size: meshSize(obj.mesh),
    color: obj.color,
    doubleSided: obj.doubleSided,
    smooth: obj.smooth === true,
    opacity: obj.opacity ?? 1,
    liquid: obj.liquid === true,
    collide: obj.collide,
  };
  const fields = asset ? BLOCK_FIELDS.filter((f) => !('key' in f) || (f.key !== 'position' && f.key !== 'name')) : BLOCK_FIELDS;
  const form = buildForm(fields, view as unknown as Record<string, unknown>, (key) => {
    if (key === 'size') scaleMeshToSize(obj.mesh, [Math.max(0.0625, view.size[0]), Math.max(0.0625, view.size[1]), Math.max(0.0625, view.size[2])]);
    else if (key === 'name') obj.name = view.name;
    else if (key === 'color') obj.color = view.color;
    else if (key === 'collide') obj.collide = view.collide;
    else if (key === 'doubleSided') obj.doubleSided = view.doubleSided;
    else if (key === 'smooth') {
      if (view.smooth) obj.smooth = true;
      else delete obj.smooth;
    } else if (key === 'opacity') {
      const o = Math.min(1, Math.max(0.05, view.opacity));
      if (o < 1) obj.opacity = o;
      else delete obj.opacity;
    } else if (key === 'liquid') {
      if (view.liquid) obj.liquid = true;
      else delete obj.liquid;
    }
    host.touch(obj);
  });
  host.inspector.append(
    ...(asset ? [] : [el('div', { class: 'section-title', text: `Block · ${obj.name}` })]),
    form,
    ...(obj.terrain
      ? [el('div', { class: 'empty muted', text: 'A terrain: Size stretches it. To add more ground and keep what you sculpted, use the Sculpt tool (G) > Size.' })]
      : []),
    el('div', { class: 'empty muted', text: `${obj.mesh.verts.length} vertices · ${obj.mesh.faces.length} faces` }),
    el(
      'div',
      { class: 'button-stack row' },
      el('button', {
        class: 'btn',
        text: 'Center origin',
        title: 'Move the shape’s origin to the middle of its bounds',
        onclick: () => {
          const shift = recenterMesh(obj.mesh);
          const d = new THREE.Vector3(...shift).applyQuaternion(quaternionFromDegrees(obj.rotation));
          obj.position = [obj.position[0] + d.x, obj.position[1] + d.y, obj.position[2] + d.z];
          host.touch(obj);
          host.refreshInspector();
        },
      }),
    ),
  );
  host.inspector.append(buildTileEditor(host, obj));
  host.inspector.append(host.behaviorEditor(obj, (kind) => host.applyPreset(obj, kind)));
  if (!asset) host.inspector.append(buildAssetLink(host, obj));
}

export function buildModelInstanceInspector(host: PanelHost, obj: LevelModelInstance, asset = false): void {
  const allFields: Field[] = [
    { kind: 'text', key: 'name', label: 'Name' },
    {
      kind: 'select',
      key: 'modelId',
      label: 'Model',
      options: host.store.project.models.map((m) => ({ value: m.id, label: m.name })),
    },
    { kind: 'vec3', key: 'position', label: 'Position', step: 0.5, unit: 'm' },
    { kind: 'vec3', key: 'rotation', label: 'Rotation', step: 15, unit: '°' },
    { kind: 'vec3', key: 'scale', label: 'Scale', step: 0.1 },
    {
      kind: 'select',
      key: 'animation',
      label: 'Animation',
      nullable: true,
      noneLabel: 'None (still)',
      options: (host.store.getModel(obj.modelId)?.clips ?? []).map((c) => ({ value: c.name, label: c.name })),
      hint: 'Plays this animation of the model, looping. Make animations in the Animate tab. The collision box does not move.',
    },
    { kind: 'number', key: 'animationSpeed', label: 'Anim speed', min: 0.1, max: 8, step: 0.1, unit: '×' },
    { kind: 'bool', key: 'collide', label: 'Solid', hint: 'Each cube of the model becomes a collision box' },
  ];
  // an asset has no place or name of its own, and its model is chosen at the top ("Looks like")
  const fields = asset ? allFields.filter((f) => !('key' in f) || (f.key !== 'position' && f.key !== 'name' && f.key !== 'modelId')) : allFields;
  host.inspector.append(
    ...(asset ? [] : [el('div', { class: 'section-title', text: `Model · ${obj.name}` })]),
    buildForm(fields, obj as unknown as Record<string, unknown>, (key) => {
      if (key === 'modelId') {
        obj.animation = null; // the other model has other animations
        host.touch(obj);
        host.refreshInspector();
        return;
      }
      host.touch(obj);
    }),
    el(
      'div',
      { class: 'button-stack' },
      el('button', {
        class: 'btn',
        text: 'Edit model',
        onclick: () => host.openModel(obj.modelId),
      }),
    ),
    host.behaviorEditor(obj, (kind) => host.applyPreset(obj, kind)),
    ...(asset ? [] : [buildAssetLink(host, obj)]),
  );
}

/** "Game object asset" section of a placed object: update it from its asset, or make an asset of it. */
export function buildAssetLink(host: PanelHost, obj: LevelObject): HTMLElement {
  const root = el('div', { class: 'asset-link' });
  root.append(el('div', { class: 'form-section', text: 'Game object asset' }));
  const prefab = obj.prefab ? host.store.getPrefab(obj.prefab) : undefined;
  const buttons = el('div', { class: 'button-stack row' });
  if (prefab) {
    root.append(
      el('div', {
        class: 'empty muted',
        text: `Placed from “${prefab.name}”. The asset can be edited in Assets; its changes reach this object when you update it.`,
      }),
    );
    buttons.append(
      el('button', {
        class: 'btn',
        text: 'Update from asset',
        title: 'Take the behavior and look (rules, solid, texture, tint, model, animation) from the asset. Position, turn, size and name stay.',
        onclick: () => {
          host.store.updateFromPrefab(obj.id);
          host.refreshInspector();
        },
      }),
      el('button', {
        class: 'btn',
        text: 'Save to asset',
        title: 'The asset takes over everything of this object, including its shape and size. Objects placed later start like host.',
        onclick: () => {
          host.store.saveToPrefab(obj.id);
          host.refreshAssets();
        },
      }),
    );
  } else {
    root.append(el('div', { class: 'empty muted', text: 'Not made from an asset. Keep it as one to place more of it.' }));
  }
  buttons.append(
    el('button', {
      class: 'btn',
      text: 'Make an asset',
      title: 'Keep this object (shape, look and behavior) in Assets > Game objects as a new asset',
      onclick: () => {
        const id = host.store.makePrefab(obj.id);
        if (id) {
          host.setLeftTab('assets');
          host.selectAsset({ prefab: id });
        }
      },
    }),
  );
  root.append(buttons);
  return root;
}

/** "Looks like": what the asset is made of, a plain block or one of the models. */
export function buildLooksLike(host: PanelHost, prefab: Prefab): HTMLElement {
  const select = el('select', { title: 'What this game object looks like: a plain block, or one of your models' });
  select.append(el('option', { value: 'block', text: 'Plain block' }));
  const group = el('optgroup', { label: 'Model' });
  for (const m of host.store.project.models) group.append(el('option', { value: m.id, text: m.name }));
  if (group.childElementCount > 0) select.append(group);
  const o = prefab.object;
  const current = o.kind === 'block' ? 'block' : o.modelId;
  if (o.kind === 'model' && !host.store.getModel(o.modelId)) select.append(el('option', { value: o.modelId, text: `${o.modelId} (missing)` }));
  select.value = current;
  select.addEventListener('change', () => {
    if (select.value === 'block') {
      const tile = host.textures.atlasWithTile(7, 0) ?? host.textures.names()[0];
      changePrefabLook(prefab, { kind: 'block', tile: tile ? { texture: tile, col: 7, row: 0 } : null }, newId);
    } else {
      changePrefabLook(prefab, { kind: 'model', modelId: select.value }, newId);
    }
    host.store.prefabChanged(prefab.id);
    host.refreshAssets();
    host.refreshInspector();
  });
  return el(
    'label',
    { class: 'form-row' },
    el('span', { class: 'form-label', text: 'Looks like' }),
    el('span', { class: 'form-control' }, select),
  );
}

/** The properties of a game object asset: look, behavior, and what to do with the objects placed from it. */
export function buildPrefabInspector(host: PanelHost, prefab: Prefab): void {
  const placed = host.store.project.levels.reduce((n, l) => n + placedFrom(l.objects, prefab.id).length, 0);
  host.inspector.append(el('div', { class: 'section-title', text: `Game object · ${prefab.name}` }));
  host.inspector.append(
    el('div', {
      class: 'empty muted',
      text: prefab.base
        ? 'One of the built-in game objects. Change it as you like: what you place from now on follows it. “Reset” puts it back as it came.'
        : 'Your own game object. What you place from now on follows it.',
    }),
    buildForm([{ kind: 'text', key: 'name', label: 'Name' }], prefab as unknown as Record<string, unknown>, () => {
      host.store.prefabChanged(prefab.id);
      host.refreshAssets();
    }),
    buildLooksLike(host, prefab),
  );

  const obj = prefab.object;
  if (obj.kind === 'block') buildBlockInspector(host, obj, true);
  else buildModelInstanceInspector(host, obj, true);

  const row = (...children: HTMLElement[]) => el('div', { class: 'button-stack row' }, ...children);
  host.inspector.append(
    el('div', { class: 'form-section', text: 'Asset' }),
    row(
      el('button', { class: 'btn primary', text: 'Place in level', onclick: () => host.placePrefab(prefab.id, host.viewport.viewCenterPoint()) }),
      el('button', {
        class: 'btn',
        text: placed > 0 ? `Update ${placed} placed` : 'Update placed',
        disabled: placed === 0,
        title: 'Bring every object already placed from this asset (in all levels) in line with it: behavior, solid, texture, tint, model and animation. Their position, turn, size and name stay.',
        onclick: () => {
          host.store.updatePlacedCopies(prefab.id);
          host.refreshInspector();
        },
      }),
    ),
    row(
      el('button', {
        class: 'btn',
        text: 'Duplicate',
        onclick: () => {
          const id = host.store.duplicatePrefab(prefab.id);
          if (id) host.selectAsset({ prefab: id });
        },
      }),
      prefab.base
        ? el('button', {
            class: 'btn danger',
            text: 'Reset',
            title: 'Put this built-in game object back as it came',
            onclick: async () => {
              if (!(await appConfirm(`Put “${prefab.name}” back as it came?`, { title: 'Reset game object', confirmLabel: 'Reset', danger: true }))) return;
              host.store.resetPrefab(prefab.id);
              host.refreshInspector();
            },
          })
        : el('button', {
            class: 'btn danger',
            text: 'Delete',
            title: 'Delete this asset (objects already placed stay in the level)',
            onclick: async () => {
              if (!(await appConfirm(`Delete the game object “${prefab.name}”? Objects already placed stay.`, { title: 'Delete game object', confirmLabel: 'Delete', danger: true }))) return;
              host.store.removePrefab(prefab.id);
              host.selectedPrefabId = null;
              host.refreshAssets();
              host.refreshInspector();
            },
          }),
    ),
  );
}

export function buildTileEditor(host: PanelHost, obj: LevelBlock): HTMLElement {
  const wrap = el('div', { class: 'form' });
  wrap.append(el('div', { class: 'form-section', text: 'Texture' }));
  const names = host.textures.names();
  const body = el('div', {});

  const render = () => {
    clear(body);
    const toggle = el('input', { type: 'checkbox', checked: !!obj.tile });
    toggle.addEventListener('change', () => {
      const atlas = host.textures.atlasWithTile(7, 0) ?? names[0];
      obj.tile = toggle.checked && atlas ? { texture: atlas, col: 7, row: 0 } : null;
      host.touch(obj);
      render();
    });
    body.append(
      el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Textured' }), el('span', { class: 'form-control' }, toggle)),
    );
    if (!obj.tile) return;
    const picker = buildTilePicker({
      textures: host.textures,
      get: () => obj.tile,
      onPick: (t) => {
        obj.tile = t;
        host.touch(obj);
      },
      zoom: 2,
      maxHeight: 280,
    });
    body.append(picker.el);
  };
  render();
  wrap.append(body);
  return wrap;
}
