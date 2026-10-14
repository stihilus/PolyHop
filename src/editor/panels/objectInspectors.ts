// The right-hand panel for objects: one or several selected, a block, an instance of a component, and a component
// (an asset) selected in the Assets.

import * as THREE from 'three';
import { instancesOf, isComponent, isOverridden, modelDefaults, modelLook, modelSize } from '../../core/components';
import { recenterMesh, meshSize, scaleMeshToSize } from '../../core/mesh';
import { quaternionFromDegrees } from '../../core/shape';
import { type LevelBlock, type LevelModelInstance, type LevelObject, type Model, type Vec3 } from '../../core/types';
import { clear, el } from '../ui/dom';
import { type Field, buildForm } from '../ui/form';
import { buildModelLookEditor, componentBadge } from '../ui/modelLook';
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

/** A block: an ordinary object of the level (yellow), edited here with every tool. */
export function buildBlockInspector(host: PanelHost, obj: LevelBlock): void {
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
  const form = buildForm(BLOCK_FIELDS, view as unknown as Record<string, unknown>, (key) => {
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
    el('div', { class: 'section-title', text: `Object · ${obj.name}` }),
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
  host.inspector.append(buildMakeComponent(host, obj));
}

/** "Component" section of an ordinary object: make it a component (a master) to place linked copies of it. */
export function buildMakeComponent(host: PanelHost, obj: LevelObject): HTMLElement {
  const root = el('div', { class: 'component-link' });
  root.append(el('div', { class: 'form-section', text: 'Component' }));
  const isTerrain = obj.kind === 'block' && !!obj.terrain;
  root.append(
    el('div', {
      class: 'empty muted',
      text: isTerrain
        ? 'A sculpted terrain belongs to its place and cannot be a component.'
        : 'An ordinary object. Make it a component to keep it in the Assets and place more of it: they all follow every change you make to it.',
    }),
    el(
      'div',
      { class: 'button-stack row' },
      el('button', {
        class: 'btn component-btn',
        text: 'Make component',
        disabled: isTerrain,
        title: 'It stays here as the master (purple); the component is in the Assets',
        onclick: () => host.makeComponent(obj.id),
      }),
    ),
  );
  return root;
}

/** A model placed in the level: an instance of a component, its master placement, or an ordinary object of shapes. */
export function buildModelInstanceInspector(host: PanelHost, obj: LevelModelInstance): void {
  const { store } = host;
  const model = store.getModel(obj.modelId);
  const comp = isComponent(model);
  const master = comp && obj.master === true;
  const defaults = model ? modelDefaults(model) : null;
  const size = model ? modelSize(model) : ([1, 1, 1] as Vec3);
  const tinted = model ? modelLook(model).tint : '#ffffff';

  // what an instance sets itself is marked; the master edits the component
  const own = (key: 'rules' | 'collide' | 'animation') => comp && !master && isOverridden(obj, key);
  const followsLabel = (label: string, key: 'rules' | 'collide' | 'animation') => (own(key) ? `${label} (set here)` : label);

  const view = {
    name: obj.name,
    position: obj.position,
    rotation: obj.rotation,
    scale: obj.scale,
    size: [size[0] * obj.scale[0], size[1] * obj.scale[1], size[2] * obj.scale[2]] as Vec3,
    tint: obj.tint ?? tinted,
    animation: obj.animation,
    animationSpeed: obj.animationSpeed,
    collide: obj.collide,
  };
  const fields: Field[] = [
    { kind: 'text', key: 'name', label: 'Name' },
    { kind: 'vec3', key: 'position', label: 'Position', step: 0.5, unit: 'm' },
    { kind: 'vec3', key: 'rotation', label: 'Rotation', step: 15, unit: '°' },
    { kind: 'vec3', key: 'scale', label: 'Scale', step: 0.1 },
    ...(model && model.cubes.length > 0
      ? [
          {
            kind: 'vec3',
            key: 'size',
            label: 'Size',
            step: 0.5,
            unit: 'm',
            hint: master ? 'The size of the component: every instance follows.' : 'The size in meters: it sets the scale of this placement.',
          } as Field,
        ]
      : []),
    { kind: 'color', key: 'tint', label: 'Tint', hint: 'Colors this placement; the component keeps its own look' },
    {
      kind: 'select',
      key: 'animation',
      label: followsLabel('Animation', 'animation'),
      nullable: true,
      noneLabel: 'None (still)',
      options: (model?.clips ?? []).map((c) => ({ value: c.name, label: c.name })),
      hint: 'Plays this animation of the model, looping. Make animations in the Animate tab. The collision box does not move.',
    },
    { kind: 'number', key: 'animationSpeed', label: 'Anim speed', min: 0.1, max: 8, step: 0.1, unit: '×' },
    { kind: 'bool', key: 'collide', label: followsLabel('Solid', 'collide'), hint: 'Each shape of the model becomes a collision box' },
  ];

  const mark = (key: 'rules' | 'collide' | 'animation') => {
    if (!comp) return;
    if (master) store.componentChanged(obj.modelId, `edit:${key}`);
  };

  host.inspector.append(
    el('div', { class: 'section-title', text: `${comp ? 'Component' : 'Object'} · ${obj.name}` }),
    comp
      ? componentBadge(
          master ? `Master of “${model?.name}”. Its shapes are edited here or in Models; every instance follows it.` : `Instance of “${model?.name}”. It follows the component; its shapes are edited in the master.`,
          master ? 'master' : 'instance',
        )
      : componentBadge('An ordinary object made of shapes of its own.', 'object'),
    buildForm(fields, view as unknown as Record<string, unknown>, (key) => {
      switch (key) {
        case 'name':
          obj.name = view.name;
          break;
        case 'size': {
          // the master of a one-shape component: its size is the size of the component (every instance follows)
          if (master && model && model.cubes.length === 1 && obj.scale.every((n) => n === 1)) {
            store.resizeComponent(model.id, [Math.max(0.0625, view.size[0]), Math.max(0.0625, view.size[1]), Math.max(0.0625, view.size[2])]);
            host.refreshAssets();
            host.refreshInspector();
            return;
          }
          // the size of the placement: the scale that makes the component this big
          const s: Vec3 = [
            size[0] > 1e-6 ? Math.max(0.01, view.size[0] / size[0]) : 1,
            size[1] > 1e-6 ? Math.max(0.01, view.size[1] / size[1]) : 1,
            size[2] > 1e-6 ? Math.max(0.01, view.size[2] / size[2]) : 1,
          ];
          obj.scale = s;
          view.scale = obj.scale;
          break;
        }
        case 'tint':
          if (view.tint.toLowerCase() === tinted.toLowerCase()) delete obj.tint;
          else obj.tint = view.tint;
          break;
        case 'animation':
        case 'animationSpeed':
          obj.animation = view.animation;
          obj.animationSpeed = view.animationSpeed;
          if (comp && !master) store.overrideInstance(obj.id, 'animation');
          else mark('animation');
          break;
        case 'collide':
          obj.collide = view.collide;
          if (comp && !master) store.overrideInstance(obj.id, 'collide');
          else mark('collide');
          break;
        default:
          break;
      }
      host.touch(obj);
      if (key === 'size' || key === 'animation' || key === 'collide') host.refreshInspector();
    }),
  );

  const row = (...children: HTMLElement[]) => el('div', { class: 'button-stack row' }, ...children);
  if (comp && model) {
    const level = store.project.levels;
    const count = instancesOf(level, model.id).length;
    const master2 = store.masterOf(model.id);
    host.inspector.append(
      el('div', { class: 'form-section', text: 'Component' }),
      el('div', { class: 'empty muted', text: `${count} placement${count === 1 ? '' : 's'} in the game follow “${model.name}”.` }),
      row(
        el('button', { class: 'btn component-btn', text: 'Open master in Models', title: 'Edit the shapes of the component', onclick: () => host.openModel(model.id) }),
        ...(master || !master2 ? [] : [el('button', { class: 'btn', text: 'Select master', onclick: () => host.selectObject(master2.id) })]),
      ),
      row(
        el('button', {
          class: 'btn',
          text: 'Detach',
          title: 'Make this an ordinary object with shapes of its own: it stops following the component',
          onclick: async () => {
            const ok = await appConfirm(`Detach this from “${model.name}”? It becomes an object with shapes of its own and no longer follows the component.`, {
              title: 'Detach instance',
              confirmLabel: 'Detach',
            });
            if (ok) {
              store.detachInstance(obj.id);
              host.refreshAssets();
              host.refreshInspector();
            }
          },
        }),
        ...(!master && isOverridden(obj)
          ? [
              el('button', {
                class: 'btn',
                text: 'Reset to component',
                title: 'Take the behavior (rules, solid, animation) of the component again',
                onclick: () => {
                  store.resetInstance(obj.id);
                  host.refreshInspector();
                },
              }),
            ]
          : []),
      ),
    );
  } else {
    host.inspector.append(
      el('div', { class: 'button-stack' }, el('button', { class: 'btn', text: 'Edit model', onclick: () => host.openModel(obj.modelId) })),
    );
  }

  host.inspector.append(host.behaviorEditor(obj, (kind) => host.applyPreset(obj, kind)));
  if (!comp) host.inspector.append(buildMakeComponent(host, obj));
  if (comp && !master && defaults && own('rules')) {
    host.inspector.append(
      el('div', { class: 'empty muted', text: 'The rules of this placement are set here, not by the component.' }),
      el(
        'div',
        { class: 'button-stack' },
        el('button', {
          class: 'btn',
          text: 'Use the rules of the component',
          onclick: () => {
            store.resetInstance(obj.id, 'rules');
            host.refreshInspector();
          },
        }),
      ),
    );
  }
}

/**
 * A model selected in the Assets: its look (mapping, tile, tint), what a placement does by default and what to do
 * with it. A component's instances follow every change made here.
 */
export function buildComponentInspector(host: PanelHost, model: Model): void {
  const { store } = host;
  const comp = isComponent(model);
  const placed = instancesOf(store.project.levels, model.id).length;
  const defaults = modelDefaults(model);
  const dependents = store.dependents(model.id);
  const isVariant = !!model.variantOf;
  const base = isVariant ? store.getModel(model.variantOf!) : undefined;

  host.inspector.append(
    el('div', { class: 'section-title', text: `${comp ? 'Component' : 'Object'} · ${model.name}` }),
    comp
      ? componentBadge(
          isVariant
            ? `A variant of “${base?.name ?? 'a missing component'}”: its shapes, with a look and a behavior of its own.`
            : 'A component: place it from here, and every instance follows what you change in it.',
          'master',
        )
      : componentBadge('An ordinary model. Make it a component to place linked instances of it.', 'object'),
    buildForm([{ kind: 'text', key: 'name', label: 'Name' }], model as unknown as Record<string, unknown>, () => {
      store.componentChanged(model.id, 'edit:name');
      host.refreshAssets();
    }),
  );

  const row = (...children: HTMLElement[]) => el('div', { class: 'button-stack row' }, ...children);
  host.inspector.append(
    row(
      el('button', { class: 'btn primary', text: 'Place in level', onclick: () => host.placeModel(model.id, host.viewport.viewCenterPoint()) }),
      el('button', { class: 'btn component-btn', text: 'Edit in Models', onclick: () => host.openModel(model.id) }),
    ),
  );

  if (comp) {
    const body = el('div', {});
    const render = () => {
      clear(body);
      body.append(
        buildModelLookEditor({
          model,
          textures: host.textures,
          onChange: (what) => {
            store.componentLookChanged(model.id);
            host.refreshAssets();
            if (what === 'mapping') host.refreshInspector();
          },
          rerender: () => host.refreshInspector(),
        }),
      );
    };
    render();
    host.inspector.append(el('div', { class: 'form-section', text: 'Look' }), body);

    // what a placement does until it says otherwise
    const view = { collide: defaults.collide, animation: defaults.animation, animationSpeed: defaults.animationSpeed };
    const ensureDefaults = () => {
      model.defaults = { ...defaults, rules: model.defaults?.rules ?? defaults.rules, ...view };
    };
    host.inspector.append(
      el('div', { class: 'form-section', text: 'Placements start like this' }),
      buildForm(
        [
          { kind: 'bool', key: 'collide', label: 'Solid' },
          {
            kind: 'select',
            key: 'animation',
            label: 'Animation',
            nullable: true,
            noneLabel: 'None (still)',
            options: model.clips.map((c) => ({ value: c.name, label: c.name })),
          },
          { kind: 'number', key: 'animationSpeed', label: 'Anim speed', min: 0.1, max: 8, step: 0.1, unit: '×' },
        ],
        view as unknown as Record<string, unknown>,
        () => {
          ensureDefaults();
          store.componentChanged(model.id, 'edit:defaults');
        },
      ),
      host.componentBehaviorEditor(model),
    );
  } else {
    host.inspector.append(
      el('div', { class: 'button-stack' }, el('button', { class: 'btn component-btn', text: 'Make component', onclick: () => host.setComponent(model.id, true) })),
    );
  }

  const info: string[] = [];
  info.push(`${placed} placement${placed === 1 ? '' : 's'} in the game`);
  if (dependents.length > 0) info.push(`${dependents.length} variant${dependents.length === 1 ? '' : 's'} / holders made from it`);
  host.inspector.append(
    el('div', { class: 'form-section', text: 'Asset' }),
    el('div', { class: 'empty muted', text: info.join(' · ') }),
    row(
      ...(comp
        ? [
            el('button', {
              class: 'btn',
              text: 'Make variant',
              title: 'A new component with the same shapes, and a look and a behavior of its own',
              onclick: () => {
                const id = store.addVariant(model.id);
                if (id) host.selectAsset(id);
              },
            }),
          ]
        : []),
      el('button', {
        class: 'btn',
        text: 'Duplicate',
        onclick: () => host.duplicateModel(model.id),
      }),
    ),
    row(
      ...(comp && store.canResetBuiltIn(model.id)
        ? [
            el('button', {
              class: 'btn danger',
              text: 'Reset',
              title: 'Put this built-in component back as it came',
              onclick: async () => {
                const ok = await appConfirm(`Put “${model.name}” back as it came?`, { title: 'Reset component', confirmLabel: 'Reset', danger: true });
                if (ok) {
                  store.resetBuiltIn(model.id);
                  host.refreshAssets();
                  host.refreshInspector();
                }
              },
            }),
          ]
        : []),
      el('button', {
        class: 'btn danger',
        text: 'Delete',
        title: 'Delete this model and every placement of it',
        onclick: async () => {
          const ok = await appConfirm(
            placed > 0 ? `Delete “${model.name}”? Its ${placed} placement${placed === 1 ? '' : 's'} in the game will be removed too.` : `Delete “${model.name}”?`,
            { title: 'Delete model', confirmLabel: 'Delete', danger: true },
          );
          if (ok) {
            store.removeModel(model.id);
            host.selectAsset(null);
          }
        },
      }),
      ...(comp
        ? [
            el('button', {
              class: 'btn',
              text: 'Not a component',
              title: 'Back to an ordinary model: its placements stay, but they no longer follow it',
              onclick: () => {
                store.setComponent(model.id, false);
                host.refreshAssets();
                host.refreshInspector();
              },
            }),
          ]
        : []),
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
