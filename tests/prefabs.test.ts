import { describe, expect, it } from 'vitest';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { boxMesh, meshBounds } from '../src/core/mesh';
import {
  applyPrefabTo,
  builtInPrefab,
  builtInPrefabId,
  builtInPrefabs,
  changePrefabLook,
  instantiatePrefab,
  newPrefab,
  placedFrom,
  prefabFromObject,
  savePrefabFrom,
} from '../src/core/prefabs';
import { PRESETS } from '../src/core/presets';
import { type LevelBlock, createBlock, createDefaultProject, normalizeProject } from '../src/core/types';
import { Store } from '../src/editor/store';

let n = 0;
const ids = () => `p${++n}`;

describe('built-in game objects as assets', () => {
  it('there is one for every preset, with its rules, in every new project', () => {
    const p = createDefaultProject();
    expect(p.prefabs.map((x) => x.id)).toEqual(PRESETS.map((x) => builtInPrefabId(x.kind)));
    for (const kind of PRESETS.map((x) => x.kind)) {
      const prefab = p.prefabs.find((x) => x.id === builtInPrefabId(kind))!;
      expect(prefab.base).toBe(kind);
      // water works by being a body of water; everything else is made of rules
      if (kind !== 'water') expect(prefab.object.rules.length).toBeGreaterThan(0);
    }
  });

  it('the pickups use the item models, the rest are blocks', () => {
    const coin = builtInPrefab('coin', ids).object;
    expect(coin.kind === 'model' && coin.modelId).toBe(ITEM_MODEL_IDS.coin);
    expect(coin.kind === 'model' && coin.animation).toBe('spin');
    expect(coin.collide).toBe(false);
    const goal = builtInPrefab('goal', ids).object;
    expect(goal.kind === 'model' && goal.scale).toEqual([1.5, 1.5, 1.5]);
    const door = builtInPrefab('door', ids).object;
    expect(door.kind).toBe('block');
    expect(door.collide).toBe(true);
    const flag = builtInPrefab('checkpoint', ids).object;
    expect(flag.kind === 'model' && flag.animation).toBeNull();
  });

  it('every template sits at the origin and carries no link', () => {
    for (const p of builtInPrefabs(ids)) {
      expect(p.object.position).toEqual([0, 0, 0]);
      expect(p.object.prefab).toBeUndefined();
    }
  });
});

describe('placing an asset', () => {
  it('makes a new object with its own ids, standing on the ground', () => {
    const door = builtInPrefab('door', ids);
    const a = instantiatePrefab(door, [3, 0, 4], ids) as LevelBlock;
    const b = instantiatePrefab(door, [3, 0, 8], ids) as LevelBlock;
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(door.object.id);
    expect(a.rules.map((r) => r.id)).not.toEqual(door.object.rules.map((r) => r.id));
    expect(a.rules).toHaveLength(door.object.rules.length);
    expect(a.prefab).toBe(door.id);
    expect(a.name).toBe('Door');
    // 2.4 m tall box: its middle is 1.2 m above the ground point
    expect(a.position).toEqual([3, 1.2, 4]);
    // the mesh is a copy
    a.mesh.verts[0]![0] += 5;
    expect((door.object as LevelBlock).mesh.verts[0]![0]).not.toBe(a.mesh.verts[0]![0]);
  });

  it('a model object stands with its feet on the ground point', () => {
    const coin = builtInPrefab('coin', ids);
    const c = instantiatePrefab(coin, [1, 2, 3], ids);
    expect(c.position).toEqual([1, 2, 3]);
  });

  it('editing what was placed does not touch the asset', () => {
    const door = builtInPrefab('door', ids);
    const a = instantiatePrefab(door, [0, 0, 0], ids);
    a.rules = [];
    a.collide = false;
    expect(door.object.rules.length).toBeGreaterThan(0);
    expect(door.object.collide).toBe(true);
  });
});

describe('keeping objects in line with their asset', () => {
  it('update takes behavior and look but leaves place, turn, size and name', () => {
    const prefab = builtInPrefab('door', ids);
    const obj = instantiatePrefab(prefab, [5, 0, 5], ids) as LevelBlock;
    obj.name = 'Big door';
    obj.rotation = [0, 90, 0];
    obj.mesh = boxMesh([4, 5, 0.3]);
    // the asset changes
    const tpl = prefab.object as LevelBlock;
    tpl.color = '#ff0000';
    tpl.collide = false;
    tpl.tile = { texture: 'Seamless-16.png', col: 2, row: 2 };
    tpl.rules = [{ id: 'r', event: 'start', conditions: [], actions: [{ type: 'message', text: 'new', seconds: 1 }] }];
    applyPrefabTo(obj, prefab, ids);
    expect(obj.color).toBe('#ff0000');
    expect(obj.collide).toBe(false);
    expect(obj.tile).toEqual({ texture: 'Seamless-16.png', col: 2, row: 2 });
    expect(obj.rules[0]!.actions[0]).toEqual({ type: 'message', text: 'new', seconds: 1 });
    expect(obj.rules[0]!.id).not.toBe('r');
    expect(obj.name).toBe('Big door');
    expect(obj.rotation).toEqual([0, 90, 0]);
    expect(meshBounds(obj.mesh).max[1] - meshBounds(obj.mesh).min[1]).toBeCloseTo(5);
    expect(obj.position).toEqual([5, 1.2, 5]);
  });

  it('a model object takes the model and animation of its asset', () => {
    const prefab = builtInPrefab('coin', ids);
    const obj = instantiatePrefab(prefab, [0, 0, 0], ids);
    if (prefab.object.kind === 'model') {
      prefab.object.modelId = 'other-model';
      prefab.object.animation = 'wobble';
      prefab.object.animationSpeed = 2;
    }
    applyPrefabTo(obj, prefab, ids);
    expect(obj.kind === 'model' && [obj.modelId, obj.animation, obj.animationSpeed]).toEqual(['other-model', 'wobble', 2]);
  });

  it('an asset made of an object takes its shape; saving to it replaces it', () => {
    const b = createBlock('Pillar', [4, 3, 4], boxMesh([1, 6, 1]), null);
    b.rules = [{ id: 'x', event: 'touch', conditions: [], actions: [{ type: 'destroy' }] }];
    const asset = prefabFromObject(b, 'Pillar', ids);
    expect(asset.base).toBeNull();
    expect(asset.object.position).toEqual([0, 0, 0]);
    expect(asset.object.id).not.toBe(b.id);
    expect(asset.object.rules[0]!.id).not.toBe('x');
    expect(meshBounds((asset.object as LevelBlock).mesh).max[1]).toBeCloseTo(3);

    const taller = createBlock('Pillar', [0, 5, 0], boxMesh([1, 10, 1]), null);
    taller.prefab = 'whatever';
    savePrefabFrom(asset, taller, ids);
    expect(meshBounds((asset.object as LevelBlock).mesh).max[1]).toBeCloseTo(5);
    expect(asset.object.prefab).toBeUndefined();
    expect(asset.object.position).toEqual([0, 0, 0]);
  });
});

describe('assets in a project file', () => {
  it('an older project without assets gets the built-in ones', () => {
    const p = normalizeProject({ version: 5, levels: [{ name: 'A', objects: [] }] });
    expect(p.prefabs.map((x) => x.id)).toEqual(PRESETS.map((x) => builtInPrefabId(x.kind)));
  });

  it('keeps edits to a built-in one and your own assets, through a save and a load', () => {
    const p = createDefaultProject();
    const door = p.prefabs.find((x) => x.base === 'door')!;
    door.name = 'Gate';
    (door.object as LevelBlock).color = '#00ff00';
    const own = prefabFromObject(createBlock('Crate', [0, 0, 0], boxMesh([1, 1, 1]), null), 'Crate', ids);
    p.prefabs.push(own);
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.prefabs).toHaveLength(p.prefabs.length);
    const gate = back.prefabs.find((x) => x.base === 'door')!;
    expect(gate.name).toBe('Gate');
    expect((gate.object as LevelBlock).color).toBe('#00ff00');
    expect(back.prefabs.find((x) => x.id === own.id)!.base).toBeNull();
  });

  it('drops broken assets, zeroes template positions and forgets links to missing assets', () => {
    const p = createDefaultProject();
    const raw = JSON.parse(JSON.stringify(p));
    raw.prefabs.push({ id: 'junk' }, { id: 'bad', object: { kind: 'spaceship' } });
    const own = raw.prefabs.find((x: { base: string | null }) => x.base === 'sign');
    own.object.position = [9, 9, 9];
    raw.levels[0].objects[0].prefab = 'gone';
    raw.levels[0].objects[1].prefab = own.id;
    const back = normalizeProject(raw);
    expect(back.prefabs.some((x) => x.id === 'junk' || x.id === 'bad')).toBe(false);
    expect(back.prefabs.find((x) => x.base === 'sign')!.object.position).toEqual([0, 0, 0]);
    expect(back.levels[0]!.objects[0]!.prefab).toBeUndefined();
    expect(back.levels[0]!.objects[1]!.prefab).toBe(own.id);
  });

  it('a block placed from an asset keeps its link in the file', () => {
    const p = createDefaultProject();
    const obj = instantiatePrefab(p.prefabs.find((x) => x.base === 'door')!, [0, 0, 0], ids);
    p.levels[0]!.objects.push(obj);
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.levels[0]!.objects.at(-1)!.prefab).toBe('prefab-door');
  });
});

describe('assets in the editor store', () => {
  const place = (store: Store, kind: 'door' | 'coin', x: number) => {
    const prefab = store.project.prefabs.find((p) => p.base === kind)!;
    const obj = instantiatePrefab(prefab, [x, 0, 0], ids);
    store.addObject(obj);
    return obj;
  };

  it('updating the placed copies reaches every level', () => {
    const store = new Store(createDefaultProject());
    const a = place(store, 'door', 1);
    store.addLevel('Two');
    const b = place(store, 'door', 2);
    const prefab = store.getPrefab('prefab-door')!;
    (prefab.object as LevelBlock).color = '#123456';
    expect(store.updatePlacedCopies('prefab-door')).toBe(2);
    expect((a as LevelBlock).color).toBe('#123456');
    expect((b as LevelBlock).color).toBe('#123456');
    expect(placedFrom(store.objects, 'prefab-door')).toHaveLength(1);
  });

  it('makes an asset of an object and links it back', () => {
    const store = new Store(createDefaultProject());
    const door = place(store, 'door', 0);
    door.rules = [];
    const id = store.makePrefab(door.id)!;
    expect(store.getPrefab(id)!.base).toBeNull();
    expect(store.getObject(door.id)!.prefab).toBe(id);
    // undo takes the asset away again
    store.undoLevel();
    expect(store.getPrefab(id)).toBeUndefined();
  });

  it('only your own assets can be deleted, and placed objects stay without the link', () => {
    const store = new Store(createDefaultProject());
    expect(store.removePrefab('prefab-coin')).toBe(false);
    const door = place(store, 'door', 0);
    const id = store.makePrefab(door.id)!;
    expect(store.removePrefab(id)).toBe(true);
    expect(store.getObject(door.id)!.prefab).toBeUndefined();
  });

  it('a built-in one can be reset', () => {
    const store = new Store(createDefaultProject());
    const prefab = store.getPrefab('prefab-door')!;
    prefab.name = 'Gate';
    prefab.object.rules = [];
    expect(store.resetPrefab('prefab-door')).toBe(true);
    const back = store.getPrefab('prefab-door')!;
    expect(back.name).toBe('Door');
    expect(back.object.rules.length).toBeGreaterThan(0);
    expect(store.resetPrefab('nope')).toBe(false);
  });

  it('save to asset and update from asset work on one object', () => {
    const store = new Store(createDefaultProject());
    const door = place(store, 'door', 0) as LevelBlock;
    door.mesh = boxMesh([3, 3, 3]);
    door.color = '#abcdef';
    expect(store.saveToPrefab(door.id)).toBe(true);
    const asset = store.getPrefab('prefab-door')!.object as LevelBlock;
    expect(asset.color).toBe('#abcdef');
    expect(meshBounds(asset.mesh).max[1]).toBeCloseTo(1.5);
    door.color = '#000000';
    expect(store.updateFromPrefab(door.id)).toBe(true);
    expect(door.color).toBe('#abcdef');
  });

  it('deleting a model takes your own assets of it away but keeps the built-in ones', () => {
    const store = new Store(createDefaultProject());
    const coin = place(store, 'coin', 0);
    const own = store.makePrefab(coin.id)!;
    expect(store.getPrefab(own)).toBeDefined();
    store.removeModel(ITEM_MODEL_IDS.coin);
    expect(store.getPrefab(own)).toBeUndefined();
    expect(store.getPrefab('prefab-coin')).toBeDefined();
  });
});

describe('what a new asset is made of', () => {
  it('a new asset can be a plain block or a model', () => {
    const tile = { texture: 'Textures-16.png', col: 7, row: 0 };
    const block = newPrefab({ kind: 'block', tile }, 'New object', ids);
    expect(block.object.kind).toBe('block');
    expect(block.base).toBeNull();
    expect(block.object.rules).toEqual([]);
    expect(block.object.kind === 'block' && block.object.tile).toEqual(tile);

    const crate = newPrefab({ kind: 'model', modelId: 'm-crate' }, 'Crate', ids);
    expect(crate.object.kind).toBe('model');
    expect(crate.object.kind === 'model' && crate.object.modelId).toBe('m-crate');
    expect(crate.name).toBe('Crate');
    expect(crate.object.position).toEqual([0, 0, 0]);
    // it is placed like any other
    const placed = instantiatePrefab(crate, [1, 0, 2], ids);
    expect(placed.kind === 'model' && placed.modelId).toBe('m-crate');
    expect(placed.prefab).toBe(crate.id);
  });

  it('changing what it looks like keeps rules, solid and turn', () => {
    const prefab = builtInPrefab('door', ids);
    prefab.object.rotation = [0, 45, 0];
    prefab.object.collide = false;
    const rules = prefab.object.rules;
    changePrefabLook(prefab, { kind: 'model', modelId: 'm-gate' }, ids);
    expect(prefab.object.kind).toBe('model');
    expect(prefab.object.rules).toBe(rules);
    expect(prefab.object.collide).toBe(false);
    expect(prefab.object.rotation).toEqual([0, 45, 0]);
    // swap the model, the animation of the old one does not carry over
    if (prefab.object.kind === 'model') prefab.object.animation = 'swing';
    changePrefabLook(prefab, { kind: 'model', modelId: 'm-other' }, ids);
    expect(prefab.object.kind === 'model' && [prefab.object.modelId, prefab.object.animation]).toEqual(['m-other', null]);
    // and back to a block
    changePrefabLook(prefab, { kind: 'block', tile: { texture: 'Textures-16.png', col: 1, row: 1 } }, ids);
    expect(prefab.object.kind).toBe('block');
    expect(prefab.object.rules).toBe(rules);
    expect(prefab.object.kind === 'block' && prefab.object.tile).toEqual({ texture: 'Textures-16.png', col: 1, row: 1 });
  });
});
