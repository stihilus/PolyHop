import { describe, expect, it } from 'vitest';
import {
  PRESET_MODEL_ID,
  builtInComponent,
  clearOverride,
  componentFromBlock,
  componentFromInstance,
  cubesOfPart,
  dependenciesOf,
  dependentsOf,
  groundLift,
  isOverridden,
  makeVariant,
  makesCycle,
  modelDefaults,
  modelLook,
  modelSize,
  placeInstance,
  presetOfModel,
  resolveModel,
  setMapping,
  setOverride,
  syncInstances,
} from '../src/core/components';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { boxMesh } from '../src/core/mesh';
import { presetRules } from '../src/core/presets';
import {
  type LevelBlock,
  type LevelModelInstance,
  type Model,
  createBlock,
  createDefaultProject,
  createLevelData,
  createModel,
  normalizeModel,
  normalizeProject,
} from '../src/core/types';
import { Store } from '../src/editor/store';
import { buildColliders, instanceAsBlock, multiplyColors } from '../src/runtime/level';
import { buildModelGeometryData, modelInstanceBounds } from '../src/runtime/modelRender';

let n = 0;
const ids = () => `c${++n}`;

const crate = (): Model => {
  const m = createModel('Crate', 'Textures-16.png');
  m.cubes[0]!.mesh = boxMesh([1, 1, 1]);
  m.cubes[0]!.position = [0, 0.5, 0];
  return m;
};

const block = (): LevelBlock => {
  const b = createBlock('Wall', [2, 1, 3], boxMesh([4, 2, 0.5]), { texture: 'Textures-16.png', col: 3, row: 3 });
  b.color = '#ffcc88';
  b.rules = presetRules('hazard', ids);
  b.collide = false;
  return b;
};

describe('what a model is made of, with the gaps filled', () => {
  it('a model without look or defaults still has them', () => {
    const m = crate();
    expect(modelLook(m)).toEqual({ tile: null, tint: '#ffffff', doubleSided: true });
    const d = modelDefaults(m);
    expect(d.rules).toEqual([]);
    expect(d.collide).toBe(true);
    expect(d.animation).toBeNull();
    expect(d.animationSpeed).toBe(1);
  });

  it('is kept through saving, and cleaned when it is not valid', () => {
    const m = crate();
    m.component = true;
    m.mapping = 'tile';
    m.look = { tile: { col: 2, row: 3 }, tint: '#abcdef', opacity: 0.5, liquid: true, doubleSided: false };
    m.defaults = { rules: presetRules('coin', ids), collide: false, animation: 'spin', animationSpeed: 2, scale: [2, 2, 2] };
    m.variantOf = 'base';
    m.parts = [{ id: 'p', name: 'Part', modelId: 'other', position: [1, 0, 0], rotation: [0, 90, 0], scale: [1, 2, 1] }];
    const back = normalizeModel(JSON.parse(JSON.stringify(m)));
    expect(back.component).toBe(true);
    expect(back.mapping).toBe('tile');
    expect(back.look).toEqual(m.look);
    expect(back.defaults!.collide).toBe(false);
    expect(back.defaults!.rules).toHaveLength(m.defaults.rules.length);
    expect(back.defaults!.scale).toEqual([2, 2, 2]);
    expect(back.variantOf).toBe('base');
    expect(back.parts).toHaveLength(1);

    const bad = normalizeModel({ id: 'x', name: 'x', texture: null, cubes: [], bones: [], clips: [], mapping: 'weird' as never, look: { tint: 'red' } as never, parts: [{ modelId: '' }] as never });
    expect(bad.mapping).toBeUndefined();
    expect(bad.look!.tint).toBe('#ffffff');
    expect(bad.parts).toBeUndefined();
  });
});

describe('placing a component', () => {
  it('an instance has what the component does by default, with rules of its own to change', () => {
    const coin = builtInComponent('coin', ids);
    const inst = placeInstance(coin, [1, 0, 2], ids);
    expect(inst.modelId).toBe(ITEM_MODEL_IDS.coin);
    expect(inst.collide).toBe(false);
    expect(inst.animation).toBe('spin');
    expect(inst.rules).toHaveLength(coin.defaults!.rules.length);
    expect(inst.rules[0]!.id).not.toBe(coin.defaults!.rules[0]!.id);
    // the goal starts bigger than the other pickups
    expect(placeInstance(builtInComponent('goal', ids), [0, 0, 0], ids).scale).toEqual([1.5, 1.5, 1.5]);
  });

  it('a block-like component stands on the ground point instead of sinking into it', () => {
    const door = builtInComponent('door', ids);
    expect(groundLift(door)).toBeCloseTo(1.2, 5);
    expect(placeInstance(door, [0, 0, 0], ids).position[1]).toBeCloseTo(1.2, 5);
    // a model with its origin at the feet is not lifted
    expect(groundLift(crate())).toBe(0);
    // and the scale of the placement counts
    expect(groundLift(door, [1, 2, 1])).toBeCloseTo(2.4, 5);
  });
});

describe('instances follow the component, except for what they set themselves', () => {
  const setup = () => {
    const project = createDefaultProject();
    const coin = project.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    const a = placeInstance(coin, [0, 0, 0], ids);
    const b = placeInstance(coin, [1, 0, 0], ids);
    project.levels[0]!.objects.push(a, b);
    return { project, coin, a, b };
  };

  it('a change of the default behavior reaches every instance', () => {
    const { project, coin, a, b } = setup();
    coin.defaults!.collide = true;
    coin.defaults!.animation = null;
    coin.defaults!.rules = presetRules('key', ids);
    syncInstances(project.levels, coin, ids);
    for (const o of [a, b]) {
      expect(o.collide).toBe(true);
      expect(o.animation).toBeNull();
      expect(o.rules.map((r) => r.actions.map((x) => x.type))).toEqual(presetRules('key', ids).map((r) => r.actions.map((x) => x.type)));
    }
  });

  it('what an instance sets itself stays, until it follows again', () => {
    const { project, coin, a, b } = setup();
    a.rules = [];
    setOverride(a, 'rules');
    coin.defaults!.collide = true;
    syncInstances(project.levels, coin, ids);
    expect(a.rules).toEqual([]); // set here
    expect(a.collide).toBe(true); // follows
    expect(b.rules.length).toBeGreaterThan(0);
    expect(isOverridden(a, 'rules')).toBe(true);
    expect(isOverridden(a, 'collide')).toBe(false);
    clearOverride(a, coin, ids, 'rules');
    expect(isOverridden(a)).toBe(false);
    expect(a.rules.length).toBeGreaterThan(0);
    expect(a.overrides).toBeUndefined();
  });

  it('normalizes the marks of an instance', () => {
    const { a } = setup();
    a.master = true;
    a.tint = '#112233';
    a.overrides = ['rules', 'collide'];
    const back = normalizeProject(JSON.parse(JSON.stringify({ ...createDefaultProject(), levels: [createLevelData('L', [a])] })));
    const o = back.levels[0]!.objects[0] as LevelModelInstance;
    expect(o.master).toBe(true);
    expect(o.tint).toBe('#112233');
    expect(o.overrides).toEqual(['rules', 'collide']);
    const junk = normalizeProject({ version: 17, levels: [{ name: 'A', objects: [{ kind: 'model', modelId: 'x', overrides: ['nope'], tint: 'bad' }] }] });
    const j = junk.levels[0]!.objects[0] as LevelModelInstance;
    expect(j.overrides).toBeUndefined();
    expect(j.tint).toBeUndefined();
  });
});

describe('making a component', () => {
  it('a block becomes a one-shape tile-mapped component, and a master placement takes its place', () => {
    const b = block();
    const { model, instance } = componentFromBlock(b, ids);
    expect(model.component).toBe(true);
    expect(model.mapping).toBe('tile');
    expect(model.cubes).toHaveLength(1);
    expect(modelSize(model)).toEqual([4, 2, 0.5]);
    expect(model.texture).toBe('Textures-16.png');
    expect(modelLook(model).tile).toEqual({ col: 3, row: 3 });
    expect(modelLook(model).tint).toBe('#ffcc88');
    expect(modelDefaults(model).collide).toBe(false);
    expect(modelDefaults(model).rules).toHaveLength(b.rules.length);
    // the object stays where it was, with the same id
    expect(instance.id).toBe(b.id);
    expect(instance.master).toBe(true);
    expect(instance.position).toEqual([2, 1, 3]);
    expect(instance.modelId).toBe(model.id);
  });

  it('a model placement makes its model a component with the placement as its default behavior', () => {
    const m = crate();
    const inst = placeInstance(m, [0, 0, 0], ids);
    inst.collide = false;
    inst.animation = null;
    componentFromInstance(m, inst, ids);
    expect(m.component).toBe(true);
    expect(modelDefaults(m).collide).toBe(false);
    expect(inst.master).toBe(true);
  });

  it('the store makes the block in the level a component, in one undo step, and keeps its id', () => {
    const project = createDefaultProject();
    const b = block();
    project.levels[0]!.objects.push(b);
    const store = new Store(project);
    const before = project.models.length;
    const modelId = store.makeComponent(b.id)!;
    expect(project.models.length).toBe(before + 1);
    const o = store.getObject(b.id)!;
    expect(o.kind).toBe('model');
    expect(o.kind === 'model' && o.modelId).toBe(modelId);
    expect(store.masterOf(modelId)?.id).toBe(b.id);
    store.undoLevel();
    expect(store.getObject(b.id)!.kind).toBe('block');
  });

  it('a sculpted terrain cannot be a component', () => {
    const project = createDefaultProject();
    const b = block();
    b.terrain = { cols: 2, rows: 2, size: [1, 1] } as unknown as LevelBlock['terrain'];
    project.levels[0]!.objects.push(b);
    expect(new Store(project).makeComponent(b.id)).toBeNull();
  });
});

describe('placing, copying and detaching in the store', () => {
  const stage = () => {
    const project = createDefaultProject();
    const store = new Store(project);
    return { project, store };
  };

  it('placing a component twice makes two instances of it; placing an ordinary object again copies its shapes', () => {
    const { project, store } = stage();
    const coin = ITEM_MODEL_IDS.coin;
    const one = store.placeModelAt(coin, [0, 0, 0])!;
    const two = store.placeModelAt(coin, [1, 0, 0])!;
    expect(one.modelId).toBe(coin);
    expect(two.modelId).toBe(coin);

    const plain = crate();
    store.addModel(plain);
    const first = store.placeModelAt(plain.id, [0, 0, 0])!;
    const second = store.placeModelAt(plain.id, [2, 0, 0])!;
    expect(first.modelId).toBe(plain.id);
    expect(second.modelId).not.toBe(plain.id);
    expect(project.models.filter((m) => m.name === 'Crate')).toHaveLength(2);
  });

  it('a copy of an instance is an instance, never a master; a copy of an ordinary object has shapes of its own', () => {
    const { project, store } = stage();
    const coin = project.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    const master = placeInstance(coin, [0, 0, 0], ids);
    master.master = true;
    store.addObject(master);
    store.duplicateObjects([master.id]);
    const copies = store.objects.filter((o) => o.id !== master.id && o.kind === 'model') as LevelModelInstance[];
    expect(copies).toHaveLength(1);
    expect(copies[0]!.modelId).toBe(coin.id);
    expect(copies[0]!.master).toBeUndefined();

    const plain = crate();
    store.addModel(plain);
    const obj = placeInstance(plain, [3, 0, 0], ids);
    store.addObject(obj);
    store.duplicateObjects([obj.id]);
    const dup = store.objects.filter((o) => o.kind === 'model' && o.modelId !== coin.id && o.id !== obj.id) as LevelModelInstance[];
    expect(dup).toHaveLength(1);
    expect(dup[0]!.modelId).not.toBe(plain.id);
  });

  it('detaching gives an instance shapes of its own, and it stops following', () => {
    const { project, store } = stage();
    const coin = project.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    const inst = placeInstance(coin, [0, 0, 0], ids);
    inst.overrides = ['rules'];
    store.addObject(inst);
    expect(store.detachInstance(inst.id)).toBe(true);
    const o = store.getObject(inst.id) as LevelModelInstance;
    expect(o.modelId).not.toBe(coin.id);
    const own = store.getModel(o.modelId)!;
    expect(own.component).toBeUndefined();
    expect(own.cubes.length).toBe(coin.cubes.length);
    expect(o.overrides).toBeUndefined();
  });

  it('deleting a model takes it out of the variants and holders made from it', () => {
    const { project, store } = stage();
    const base = crate();
    base.component = true;
    store.addModel(base);
    const v = makeVariant(base, ids);
    const holder = crate();
    holder.parts = [{ id: 'p', name: 'Part', modelId: base.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }];
    project.models.push(v, holder);
    store.removeModel(base.id);
    expect(project.models.find((m) => m.id === v.id)!.variantOf).toBeUndefined();
    expect(project.models.find((m) => m.id === holder.id)!.parts).toBeUndefined();
  });
});

describe('editing a component in the level', () => {
  it('resizing a one-shape master resizes the component, and undo gives the size back', () => {
    const project = createDefaultProject();
    const b = block();
    b.collide = true;
    project.levels[0]!.objects.push(b);
    const store = new Store(project);
    const id = store.makeComponent(b.id)!;
    const model = store.getModel(id)!;
    expect(modelSize(model)).toEqual([4, 2, 0.5]);
    expect(store.resizeComponent(id, [2, 2, 2])).toBe(true);
    expect(modelSize(model)[0]).toBeCloseTo(2, 5);
    store.undoLevel();
    expect(modelSize(store.getModel(id)!)[0]).toBeCloseTo(4, 5);
    store.redoLevel();
    expect(modelSize(store.getModel(id)!)[0]).toBeCloseTo(2, 5);
    // a model of several shapes is resized by scaling its placement instead
    const two = crate();
    two.cubes.push({ ...two.cubes[0]!, id: 'second' });
    store.addModel(two);
    expect(store.resizeComponent(two.id, [2, 2, 2])).toBe(false);
  });

  it('the default behavior of a component is an undo step of the level', () => {
    const project = createDefaultProject();
    const store = new Store(project);
    const coin = store.getModel(ITEM_MODEL_IDS.coin)!;
    const before = modelDefaults(coin).collide;
    coin.defaults!.collide = !before;
    store.componentChanged(coin.id);
    expect(modelDefaults(store.getModel(coin.id)!).collide).toBe(!before);
    store.undoLevel();
    expect(modelDefaults(store.getModel(coin.id)!).collide).toBe(before);
  });
});

describe('variants and nested components', () => {
  const lib = (models: Model[]) => (id: string) => models.find((m) => m.id === id);

  it('a variant is drawn with the shapes of its component and a look of its own', () => {
    const base = crate();
    base.texture = 'Textures-16.png';
    const v = makeVariant(base, ids, 'Red crate');
    v.look = { tile: null, tint: '#ff0000', doubleSided: true };
    const r = resolveModel(v, lib([base, v]));
    expect(r.id).toBe(v.id);
    expect(r.name).toBe('Red crate');
    expect(r.cubes).toHaveLength(base.cubes.length);
    expect(r.texture).toBe('Textures-16.png');
    expect(modelLook(r).tint).toBe('#ff0000');
    // a model with neither is returned as it is
    expect(resolveModel(base, lib([base]))).toBe(base);
  });

  it('a variant may have another texture of the same layout (a skin)', () => {
    const base = crate();
    base.texture = 'Character-Skin.png';
    const v = makeVariant(base, ids);
    v.texture = 'Character-Explorer.png';
    expect(resolveModel(v, lib([base, v])).texture).toBe('Character-Explorer.png');
  });

  it('a component holds others as parts, placed, turned and scaled', () => {
    const wall = crate();
    wall.texture = 'Textures-16.png';
    const house = createModel('House', 'Textures-16.png');
    house.cubes = [];
    house.parts = [
      { id: 'a', name: 'Wall', modelId: wall.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'b', name: 'Wall 2', modelId: wall.id, position: [3, 0, 0], rotation: [0, 90, 0], scale: [2, 1, 1] },
    ];
    const r = resolveModel(house, lib([wall, house]));
    expect(r.cubes).toHaveLength(2);
    expect(r.cubes[1]!.position[0]).toBeCloseTo(3, 5);
    expect(r.cubes[1]!.rotation[1]).toBeCloseTo(90, 3);
    // the scale is in the mesh of the cube
    expect(Math.max(...r.cubes[1]!.mesh.verts.map((v) => v[0])) - Math.min(...r.cubes[1]!.mesh.verts.map((v) => v[0]))).toBeCloseTo(2, 5);
    // the model that holds it is not changed
    expect(house.cubes).toHaveLength(0);
  });

  it('a part with another texture or mapping is left out, and a cycle does not run away', () => {
    const wall = crate();
    wall.texture = 'Textures-16.png';
    const other = crate();
    other.texture = 'Plants-16.png';
    const tiled = crate();
    tiled.texture = 'Textures-16.png';
    tiled.mapping = 'tile';
    const house = createModel('House', 'Textures-16.png');
    house.cubes = [];
    house.parts = ['wall', 'other', 'tiled', 'self'].map((k, i) => ({
      id: String(i),
      name: k,
      modelId: k === 'wall' ? wall.id : k === 'other' ? other.id : k === 'tiled' ? tiled.id : house.id,
      position: [i, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }));
    const r = resolveModel(house, lib([wall, other, tiled, house]));
    expect(r.cubes).toHaveLength(1);
    // a model inside itself, and the one that holds it inside it: loops
    expect(makesCycle([wall, house], house.id, house.id)).toBe(true);
    expect(makesCycle([wall, house], wall.id, house.id)).toBe(true);
    // the wall inside the house is fine
    expect(makesCycle([wall, house], house.id, wall.id)).toBe(false);
  });

  it('knows what a model is made from and what is made from it', () => {
    const base = crate();
    const v = makeVariant(base, ids);
    const v2 = makeVariant(v, ids);
    const models = [base, v, v2];
    expect(dependenciesOf(v2, lib(models)).sort()).toEqual([base.id, v.id].sort());
    expect(dependentsOf(models, base.id).sort()).toEqual([v.id, v2.id].sort());
    expect(dependentsOf(models, v2.id)).toEqual([]);
  });

  it('the cubes of a part have ids that do not clash', () => {
    const wall = crate();
    const a = cubesOfPart(wall, { id: 'a', name: 'A', modelId: wall.id, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const b = cubesOfPart(wall, { id: 'b', name: 'B', modelId: wall.id, position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    expect(new Set([...a, ...b].map((c) => c.id)).size).toBe(a.length + b.length);
  });
});

describe('tile or UV', () => {
  it('switching to tile keeps the tile the first face showed; switching back gives every face its own rectangle', () => {
    const m = crate();
    m.texture = 'Textures-16.png';
    // the first face shows the tile at column 2, row 1 of a 16 px atlas
    m.cubes[0]!.mesh.faces[0]!.uv = [
      [32, 16],
      [48, 16],
      [48, 32],
      [32, 32],
    ];
    setMapping(m, 'tile', 16);
    expect(m.mapping).toBe('tile');
    expect(modelLook(m).tile).toEqual({ col: 2, row: 1 });
    setMapping(m, 'uv', 16);
    expect(m.mapping).toBeUndefined();
    for (const f of m.cubes[0]!.mesh.faces) {
      const xs = f.uv.map((p) => p[0]);
      const ys = f.uv.map((p) => p[1]);
      expect(Math.min(...xs)).toBe(32);
      expect(Math.max(...xs)).toBe(48);
      expect(Math.min(...ys)).toBe(16);
      expect(Math.max(...ys)).toBe(32);
    }
  });

  it('a tile-mapped model has planar tile coordinates: one tile per meter, from the corner of each face', () => {
    const m = crate();
    m.mapping = 'tile';
    m.cubes[0]!.mesh = boxMesh([2, 1, 1]);
    const data = buildModelGeometryData(m, 64, 64);
    expect(data.tileUvs).toBeDefined();
    const uvs = data.tileUvs!;
    let widest = 0;
    for (let i = 0; i < uvs.length / 2; i++) widest = Math.max(widest, Math.abs(uvs[i * 2]!), Math.abs(uvs[i * 2 + 1]!));
    // the 2 m wide faces run to 2 tiles
    expect(widest).toBeCloseTo(2, 5);
    // a uv-mapped model has none
    const plain = crate();
    expect(buildModelGeometryData(plain, 64, 64).tileUvs).toBeUndefined();
  });
});

describe('a tile-mapped component in the level', () => {
  it('is drawn as a block: the scale of the instance is in its points, so a tile keeps its size', () => {
    const door = builtInComponent('door', ids);
    const inst = placeInstance(door, [0, 0, 0], ids);
    inst.scale = [2, 1, 1];
    const b = instanceAsBlock(inst, door);
    const xs = b.mesh.verts.map((v) => v[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 5);
    expect(b.tile).toEqual({ texture: 'Textures-16.png', col: 3, row: 13 });
    expect(b.doubleSided).toBe(true);
    expect(b.id).toBe(inst.id);
  });

  it('takes the tint of the instance on top of its own', () => {
    expect(multiplyColors('#ffffff', undefined)).toBe('#ffffff');
    expect(multiplyColors('#ff8000', '#ffffff')).toBe('#ff8000');
    expect(multiplyColors('#ff8000', '#808080')).toBe('#804000');
  });

  it('is solid like a block, and water is a swim volume that is not solid', () => {
    const wall = builtInComponent('platform', ids);
    const w = placeInstance(wall, [0, 0, 0], ids);
    const water = builtInComponent('water', ids);
    const pool = placeInstance(water, [10, 0, 0], ids);
    const models = [wall, water];
    const got = buildColliders([w, pool], (id) => models.find((m) => m.id === id));
    expect(got.boxes).toHaveLength(1);
    expect(got.liquids).toHaveLength(1);
    const b = modelInstanceBounds(water, pool)!;
    expect(b.maxX - b.minX).toBeCloseTo(8, 5);
  });
});

describe('the built-in components', () => {
  it('know which game object they are', () => {
    expect(presetOfModel('obj-door')).toBe('door');
    expect(presetOfModel(ITEM_MODEL_IDS.coin)).toBe('coin');
    expect(presetOfModel('prop-slime')).toBe('enemy');
    expect(presetOfModel('nobody')).toBeNull();
    expect(new Set(Object.values(PRESET_MODEL_ID)).size).toBe(13);
  });
});

describe('older projects', () => {
  it('assets become components; objects that were placed keep what they have', () => {
    const coinRules = presetRules('coin', ids);
    const raw = {
      version: 16,
      models: [],
      levels: [
        {
          name: 'A',
          objects: [
            { kind: 'model', id: 'o1', name: 'Coin', modelId: ITEM_MODEL_IDS.coin, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: 'spin', animationSpeed: 1, collide: false, rules: coinRules, prefab: 'prefab-coin' },
            { kind: 'block', id: 'b1', name: 'Wall', position: [0, 0, 0], rotation: [0, 0, 0], prefab: 'mine', rules: [], collide: true },
          ],
        },
      ],
      prefabs: [
        { id: 'prefab-coin', name: 'Coin', base: 'coin', object: { kind: 'model', modelId: ITEM_MODEL_IDS.coin, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], animation: 'spin', animationSpeed: 1, collide: false, rules: coinRules } },
        { id: 'mine', name: 'My wall', base: null, object: { kind: 'block', mesh: boxMesh([5, 1, 1]), tile: { texture: 'Textures-16.png', col: 1, row: 1 }, color: '#ffffff', doubleSided: true, collide: true, rules: [], position: [0, 0, 0], rotation: [0, 0, 0] } },
      ],
    };
    const p = normalizeProject(JSON.parse(JSON.stringify(raw)));
    expect((p as unknown as { prefabs?: unknown }).prefabs).toBeUndefined();
    // the built-in game objects are all there, as components
    for (const id of Object.values(PRESET_MODEL_ID)) expect(p.models.some((m) => m.id === id), id).toBe(true);
    const coin = p.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    expect(coin.component).toBe(true);
    expect(modelDefaults(coin).rules.length).toBeGreaterThan(0);
    // the block asset is a one-shape component of its own
    const mine = p.models.find((m) => m.name === 'My wall')!;
    expect(mine.component).toBe(true);
    expect(mine.mapping).toBe('tile');
    expect(modelSize(mine)).toEqual([5, 1, 1]);
    // nothing in the level changed: the instance keeps its own behavior, the block stays a block
    const inst = p.levels[0]!.objects[0] as LevelModelInstance;
    expect(inst.rules.length).toBe(coinRules.length);
    expect(inst.overrides).toEqual(['rules', 'collide', 'animation']);
    expect(p.levels[0]!.objects[1]!.kind).toBe('block');
    expect((p.levels[0]!.objects[1] as unknown as { prefab?: string }).prefab).toBeUndefined();
  });

  it('an exported game does not get the editor components back', () => {
    const game = normalizeProject({ version: 16, exported: true, models: [], levels: [{ name: 'A', objects: [] }] });
    expect(game.models.every((m) => m.id === 'humanoid')).toBe(true);
  });
});
