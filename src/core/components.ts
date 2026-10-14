// Components: a model that is a master. It is placed as linked instances that follow every change of it (its shapes,
// its look and, until an instance says otherwise, what it does). Like a prefab of Unity or a component of Figma.
//
//  - an ordinary object (yellow) belongs to one place in the level;
//  - a component (purple) is kept in the Assets and placed many times: its instances are the same object;
//  - the placement a component was made from is its master placement (a filled mark): its shape is edited there;
//  - a variant is a component made from another one: the same shapes, with a look and a behavior of its own;
//  - a component can hold other components (parts): a house made of walls, a roof and a door.
//
// This file is plain data and functions (no editor, no rendering), so the game and the tests use it too.

import { ITEMS_ATLAS, ITEM_MODEL_IDS, type ItemKind, TILE, createItemModel } from './items';
import { type MeshData, assignRect, boxMesh, cloneMesh } from './mesh';
import { PRESETS, type PresetKind, presetRules } from './presets';
import { createPropModel, propModelId } from './props';
import { degreesFromQuaternion, quaternionFromDegrees, worldPoints } from './shape';
import type {
  InstanceOverride,
  LevelBlock,
  LevelData,
  LevelModelInstance,
  Model,
  ModelCube,
  ModelDefaults,
  ModelLook,
  ModelMapping,
  ModelPart,
  TileRef,
  Vec3,
} from './types';
import type { Rule } from './logic';
import * as THREE from 'three';

type Idgen = () => string;

/** What an instance of a component may set by itself (the others follow the component). */
export const INSTANCE_OVERRIDES: readonly InstanceOverride[] = ['rules', 'collide', 'animation'];

// ---------------------------------------------------------------- what a model is, with the gaps filled

export const DEFAULT_LOOK: ModelLook = { tile: null, tint: '#ffffff', doubleSided: true };

/** The look of a model with everything filled in (a copy). */
export function modelLook(model: Model): ModelLook {
  const l = model.look;
  return {
    tile: l?.tile ? { col: l.tile.col, row: l.tile.row } : null,
    tint: typeof l?.tint === 'string' ? l.tint : DEFAULT_LOOK.tint,
    ...(typeof l?.opacity === 'number' && l.opacity < 1 ? { opacity: Math.max(0.05, l.opacity) } : {}),
    ...(l?.liquid === true ? { liquid: true } : {}),
    doubleSided: l?.doubleSided !== false,
  };
}

/** What a placement of the model does by default, with everything filled in (rules are not copied). */
export function modelDefaults(model: Model): ModelDefaults {
  const d = model.defaults;
  return {
    rules: d?.rules ?? [],
    collide: d?.collide ?? true,
    animation: d?.animation ?? null,
    animationSpeed: typeof d?.animationSpeed === 'number' && d.animationSpeed > 0 ? d.animationSpeed : 1,
    ...(d?.scale ? { scale: [...d.scale] as Vec3 } : {}),
  };
}

export const isTiled = (model: Model): boolean => model.mapping === 'tile';
export const isComponent = (model: Model | undefined): boolean => model?.component === true;

/** A copy of rules with new ids (an action's `target`, empty for "this object", is kept as it is). */
export function cloneRules(rules: Rule[], idGen: Idgen): Rule[] {
  const copy = structuredClone(rules);
  for (const r of copy) r.id = idGen();
  return copy;
}

/** How far a placement is lifted so that a block-like model (tile mapping) stands on the ground point. */
export function groundLift(model: Model, scale: Vec3 = [1, 1, 1]): number {
  if (!isTiled(model) || model.cubes.length === 0) return 0;
  let minY = Infinity;
  for (const c of model.cubes) for (const p of worldPoints(c)) minY = Math.min(minY, p[1]);
  return Number.isFinite(minY) ? -minY * scale[1] : 0;
}

// ---------------------------------------------------------------- placing

/** A new instance of the model standing on `at`, with the default look and behavior of the model. */
export function placeInstance(model: Model, at: Vec3, idGen: Idgen): LevelModelInstance {
  const d = modelDefaults(model);
  const scale: Vec3 = d.scale ? [...d.scale] : [1, 1, 1];
  return {
    id: idGen(),
    name: model.name,
    kind: 'model',
    modelId: model.id,
    position: [at[0], at[1] + groundLift(model, scale), at[2]],
    rotation: [0, 0, 0],
    scale,
    animation: d.animation,
    animationSpeed: d.animationSpeed,
    collide: d.collide,
    rules: cloneRules(d.rules, idGen),
  };
}

/** Bring an instance in line with its component: what it does not set itself follows the component. */
export function applyDefaults(inst: LevelModelInstance, model: Model, idGen: Idgen, only?: InstanceOverride): void {
  const d = modelDefaults(model);
  const own = new Set(inst.overrides ?? []);
  const wants = (key: InstanceOverride) => (only === undefined || only === key) && !own.has(key);
  if (wants('rules')) inst.rules = cloneRules(d.rules, idGen);
  if (wants('collide')) inst.collide = d.collide;
  if (wants('animation')) {
    inst.animation = d.animation;
    inst.animationSpeed = d.animationSpeed;
  }
}

/** Every instance of the component, in all levels, follows it again (what they set themselves stays). Returns them. */
export function syncInstances(levels: LevelData[], model: Model, idGen: Idgen): LevelModelInstance[] {
  const changed: LevelModelInstance[] = [];
  for (const l of levels) {
    for (const o of l.objects) {
      if (o.kind !== 'model' || o.modelId !== model.id) continue;
      applyDefaults(o, model, idGen);
      changed.push(o);
    }
  }
  return changed;
}

/** The instance sets this itself from now on. */
export function setOverride(inst: LevelModelInstance, key: InstanceOverride): void {
  if (!(inst.overrides ?? []).includes(key)) inst.overrides = [...(inst.overrides ?? []), key];
}

/** The instance follows its component again for this (or for everything). */
export function clearOverride(inst: LevelModelInstance, model: Model, idGen: Idgen, key?: InstanceOverride): void {
  const keys = key ? [key] : [...INSTANCE_OVERRIDES];
  inst.overrides = (inst.overrides ?? []).filter((k) => !keys.includes(k));
  if (inst.overrides.length === 0) delete inst.overrides;
  for (const k of keys) applyDefaults(inst, model, idGen, k);
}

export const isOverridden = (inst: LevelModelInstance, key?: InstanceOverride): boolean =>
  key ? (inst.overrides ?? []).includes(key) : (inst.overrides ?? []).length > 0;

/** The instances of a component, in all levels. */
export function instancesOf(levels: LevelData[], modelId: string): LevelModelInstance[] {
  const out: LevelModelInstance[] = [];
  for (const l of levels) for (const o of l.objects) if (o.kind === 'model' && o.modelId === modelId) out.push(o);
  return out;
}

// ---------------------------------------------------------------- making a component

/** A block of the level as a one-shape component with the block's look and behavior (its position is not part of it). */
export function modelFromBlock(block: LevelBlock, idGen: Idgen, id = idGen()): Model {
  const cube: ModelCube = { id: idGen(), name: 'Shape', position: [0, 0, 0], rotation: [0, 0, 0], mesh: cloneMesh(block.mesh), bone: null };
  if (block.smooth) cube.smooth = true;
  const look: ModelLook = {
    tile: block.tile ? { col: block.tile.col, row: block.tile.row } : null,
    tint: block.color,
    ...(typeof block.opacity === 'number' && block.opacity < 1 ? { opacity: block.opacity } : {}),
    ...(block.liquid ? { liquid: true } : {}),
    doubleSided: block.doubleSided,
  };
  return {
    id,
    name: block.name,
    texture: block.tile?.texture ?? null,
    cubes: [cube],
    bones: [],
    clips: [],
    component: true,
    mapping: 'tile',
    look,
    defaults: { rules: cloneRules(block.rules, idGen), collide: block.collide, animation: null, animationSpeed: 1 },
  };
}

/**
 * The block becomes a component (a master): the model that replaces it, and the placement that takes its place
 * (same position and turn, flagged as the master).
 */
export function componentFromBlock(block: LevelBlock, idGen: Idgen): { model: Model; instance: LevelModelInstance } {
  const model = modelFromBlock(block, idGen);
  const instance: LevelModelInstance = {
    id: block.id,
    name: block.name,
    kind: 'model',
    modelId: model.id,
    position: [...block.position],
    rotation: [...block.rotation],
    scale: [1, 1, 1],
    animation: null,
    animationSpeed: 1,
    collide: block.collide,
    rules: block.rules,
    master: true,
  };
  return { model, instance };
}

/** A model becomes a component, with what the placement it is made from does as its default. */
export function componentFromInstance(model: Model, inst: LevelModelInstance, idGen: Idgen): void {
  model.component = true;
  model.defaults = {
    rules: cloneRules(inst.rules, idGen),
    collide: inst.collide,
    animation: inst.animation,
    animationSpeed: inst.animationSpeed,
    ...(inst.scale.some((n) => n !== 1) ? { scale: [...inst.scale] as Vec3 } : {}),
  };
  inst.master = true;
  delete inst.overrides;
}

/** A variant of a component: the same shapes, a new name, its own look and behavior (a copy of the component's). */
export function makeVariant(base: Model, idGen: Idgen, name = `${base.name} variant`): Model {
  const d = modelDefaults(base);
  return {
    id: idGen(),
    name,
    texture: null,
    cubes: [],
    bones: [],
    clips: [],
    component: true,
    variantOf: base.id,
    look: base.look ? structuredClone(base.look) : undefined,
    defaults: { ...d, rules: cloneRules(d.rules, idGen) },
  };
}

// ---------------------------------------------------------------- tile or UV

/**
 * Switch how the faces of a model take their picture. To 'tile' every face repeats the tile of the model's look (the
 * tile its first face showed, when the model has none yet). To 'uv' every face gets its own UV rectangle: the tile
 * it showed, stretched over the face, because a UV cannot repeat (a face of one meter looks the same).
 * `tileSize` is the size in pixels of a tile of the model's texture.
 */
export function setMapping(model: Model, mapping: ModelMapping, tileSize: number): void {
  if ((model.mapping ?? 'uv') === mapping) return;
  if (mapping === 'tile') {
    model.mapping = 'tile';
    const look = modelLook(model);
    if (!look.tile) {
      const uv = model.cubes[0]?.mesh.faces[0]?.uv;
      if (uv && uv.length > 0 && tileSize > 0) {
        const cx = uv.reduce((a, p) => a + p[0], 0) / uv.length;
        const cy = uv.reduce((a, p) => a + p[1], 0) / uv.length;
        look.tile = { col: Math.max(0, Math.floor(cx / tileSize)), row: Math.max(0, Math.floor(cy / tileSize)) };
      } else {
        look.tile = { col: 0, row: 0 };
      }
    }
    model.look = look;
    return;
  }
  const look = modelLook(model);
  for (const cube of model.cubes) {
    cube.mesh.faces.forEach((face, fi) => {
      // a face painted with a tile of its own shows that one
      const own = face.tile && face.tile.texture === model.texture ? face.tile : null;
      const tile = own ?? look.tile;
      if (!tile) return;
      assignRect(cube.mesh, [fi], { x: tile.col * tileSize, y: tile.row * tileSize, w: tileSize, h: tileSize });
    });
  }
  delete model.mapping;
}

// ---------------------------------------------------------------- variants and nested components

const MAX_DEPTH = 8;

/**
 * The model as it is drawn and collides: a variant takes the shapes, rig and animations of its component, and
 * the parts placed inside it are added as shapes. A model that is neither is returned as it is (the same object).
 * Cycles and a part that does not fit (another texture or mapping) are left out.
 */
export function resolveModel(model: Model, getModel: (id: string) => Model | undefined, depth = 0, seen: Set<string> = new Set()): Model {
  const hasParts = (model.parts?.length ?? 0) > 0;
  if (!model.variantOf && !hasParts) return model;
  if (depth > MAX_DEPTH || seen.has(model.id)) return model;
  const here = new Set(seen).add(model.id);

  let result: Model = model;
  if (model.variantOf) {
    const base = getModel(model.variantOf);
    if (base && !here.has(base.id)) {
      const b = resolveModel(base, getModel, depth + 1, here);
      const look = { ...(b.look ?? {}), ...(model.look ?? {}) } as ModelLook;
      result = {
        ...b,
        id: model.id,
        name: model.name,
        texture: model.texture ?? b.texture,
        // the variant's own shapes (it may have some) come first, so the editor finds them where it expects them
        cubes: [...model.cubes, ...b.cubes],
        component: model.component,
        look: b.look || model.look ? look : undefined,
        defaults: model.defaults ?? b.defaults,
        variantOf: model.variantOf,
        parts: model.parts,
      };
    }
  }

  if (hasParts) {
    const cubes = [...result.cubes];
    let texture = result.texture;
    for (const part of result.parts ?? []) {
      const child = getModel(part.modelId);
      if (!child || here.has(child.id)) continue;
      const c = resolveModel(child, getModel, depth + 1, here);
      // the shapes share one texture and one way of using it: a part that does not fit is left out
      if (texture === null) texture = c.texture;
      else if (c.texture !== texture) continue;
      if ((c.mapping ?? 'uv') !== (result.mapping ?? 'uv')) continue;
      cubes.push(...cubesOfPart(c, part));
    }
    result = { ...result, cubes, texture };
  }
  return result;
}

/** The cubes of a component placed as a part: moved, turned and scaled into the model that holds it. */
export function cubesOfPart(child: Model, part: ModelPart): ModelCube[] {
  const q = quaternionFromDegrees(part.rotation);
  return child.cubes.map((cube, i) => {
    const mesh: MeshData = cloneMesh(cube.mesh);
    // the scale applies in the cube's own axes (exact for a part that is not turned oddly)
    mesh.verts = mesh.verts.map((v) => [v[0] * part.scale[0], v[1] * part.scale[1], v[2] * part.scale[2]] as Vec3);
    const p = new THREE.Vector3(cube.position[0] * part.scale[0], cube.position[1] * part.scale[1], cube.position[2] * part.scale[2]).applyQuaternion(q);
    const turned = q.clone().multiply(quaternionFromDegrees(cube.rotation));
    return {
      id: `${part.id}:${cube.id}:${i}`,
      name: cube.name,
      position: [part.position[0] + p.x, part.position[1] + p.y, part.position[2] + p.z] as Vec3,
      rotation: degreesFromQuaternion(turned),
      mesh,
      bone: null,
      ...(cube.smooth ? { smooth: true } : {}),
    };
  });
}

/** Ids of the models this one is made from: its component (variant) and the components placed inside it, all the way down. */
export function dependenciesOf(model: Model, getModel: (id: string) => Model | undefined): string[] {
  const out = new Set<string>();
  const visit = (m: Model, depth: number) => {
    if (depth > MAX_DEPTH) return;
    const ids = [...(m.variantOf ? [m.variantOf] : []), ...(m.parts ?? []).map((p) => p.modelId)];
    for (const id of ids) {
      if (out.has(id) || id === model.id) continue;
      out.add(id);
      const next = getModel(id);
      if (next) visit(next, depth + 1);
    }
  };
  visit(model, 0);
  return [...out];
}

/** Ids of the models that are made from this one (variants, and models that hold it as a part), all the way up. */
export function dependentsOf(models: Model[], id: string): string[] {
  const out = new Set<string>();
  const visit = (target: string) => {
    for (const m of models) {
      if (out.has(m.id) || m.id === id) continue;
      if (m.variantOf === target || (m.parts ?? []).some((p) => p.modelId === target)) {
        out.add(m.id);
        visit(m.id);
      }
    }
  };
  visit(id);
  return [...out];
}

/** Would placing `childId` inside `holderId` make a cycle? */
export function makesCycle(models: Model[], holderId: string, childId: string): boolean {
  return childId === holderId || dependentsOf(models, holderId).includes(childId);
}

// ---------------------------------------------------------------- the built-in game objects

/** The component each built-in game object (coin, door, ...) is. */
export const PRESET_MODEL_ID: Record<PresetKind, string> = {
  coin: ITEM_MODEL_IDS.coin,
  key: ITEM_MODEL_IDS.key,
  apple: ITEM_MODEL_IDS.apple,
  checkpoint: ITEM_MODEL_IDS.flag,
  goal: ITEM_MODEL_IDS.trophy,
  enemy: propModelId('slime'),
  npc: propModelId('villager'),
  door: 'obj-door',
  hazard: 'obj-hazard',
  exit: 'obj-exit',
  platform: 'obj-platform',
  sign: 'obj-sign',
  water: 'obj-water',
};

const PRESET_OF_MODEL = new Map<string, PresetKind>(Object.entries(PRESET_MODEL_ID).map(([k, v]) => [v, k as PresetKind]));

/** The built-in game object a model is, or null. */
export const presetOfModel = (modelId: string): PresetKind | null => PRESET_OF_MODEL.get(modelId) ?? null;

const MAIN_ATLAS = 'Textures-16.png';
const WOOD: TileRef = { texture: MAIN_ATLAS, col: 3, row: 13 };
const STONE: TileRef = { texture: MAIN_ATLAS, col: 7, row: 0 };
const WATER: TileRef = { texture: 'Kit-16.png', col: 2, row: 4 };
const HAZARD: TileRef = { texture: ITEMS_ATLAS, col: TILE.hazard, row: 0 };

function blockModel(
  id: string,
  name: string,
  size: Vec3,
  tile: TileRef,
  look: Partial<ModelLook>,
  defaults: Omit<ModelDefaults, 'rules'> & { rules: Rule[] },
  idGen: Idgen,
): Model {
  return {
    id,
    name,
    texture: tile.texture,
    cubes: [{ id: idGen(), name: 'Block', position: [0, 0, 0], rotation: [0, 0, 0], mesh: boxMesh(size), bone: null }],
    bones: [],
    clips: [],
    component: true,
    mapping: 'tile',
    look: { tile: { col: tile.col, row: tile.row }, tint: '#ffffff', doubleSided: true, ...look },
    defaults,
  };
}

/** A built-in game object as a component: its model (made again from scratch) and what it does by default. */
export function builtInComponent(kind: PresetKind, idGen: Idgen): Model {
  const label = PRESETS.find((p) => p.kind === kind)!.label;
  const rules = presetRules(kind, idGen);
  const item = (k: ItemKind, defaults: Partial<ModelDefaults>): Model => {
    const m = createItemModel(k, idGen);
    m.name = label;
    m.component = true;
    m.defaults = { rules, collide: false, animation: 'spin', animationSpeed: 1, ...defaults };
    return m;
  };
  switch (kind) {
    case 'coin':
      return item('coin', {});
    case 'key':
      return item('key', {});
    case 'apple':
      return item('apple', {});
    case 'checkpoint':
      return item('flag', { animation: null });
    case 'goal':
      return item('trophy', { scale: [1.5, 1.5, 1.5] });
    case 'enemy': {
      const m = createPropModel('slime', idGen);
      m.component = true;
      m.defaults = { rules, collide: false, animation: 'hop', animationSpeed: 1 };
      return m;
    }
    case 'npc': {
      const m = createPropModel('villager', idGen);
      m.component = true;
      m.defaults = { rules, collide: true, animation: 'idle', animationSpeed: 1 };
      return m;
    }
    case 'door':
      return blockModel(PRESET_MODEL_ID.door, label, [2, 2.4, 0.3], WOOD, {}, { rules, collide: true, animation: null, animationSpeed: 1 }, idGen);
    case 'hazard':
      return blockModel(PRESET_MODEL_ID.hazard, label, [2, 0.12, 2], HAZARD, {}, { rules, collide: false, animation: null, animationSpeed: 1 }, idGen);
    case 'exit':
      return blockModel(PRESET_MODEL_ID.exit, label, [2, 2.6, 0.3], STONE, { tint: '#9b6bff' }, { rules, collide: false, animation: null, animationSpeed: 1 }, idGen);
    case 'platform':
      return blockModel(PRESET_MODEL_ID.platform, label, [3, 0.5, 3], STONE, {}, { rules, collide: true, animation: null, animationSpeed: 1 }, idGen);
    case 'sign':
      return blockModel(PRESET_MODEL_ID.sign, label, [1.1, 1.4, 0.15], WOOD, {}, { rules, collide: true, animation: null, animationSpeed: 1 }, idGen);
    case 'water':
      return blockModel(PRESET_MODEL_ID.water, label, [8, 2, 8], WATER, { opacity: 0.7, liquid: true }, { rules, collide: false, animation: null, animationSpeed: 1 }, idGen);
  }
}

/** Every built-in game object as a component, in the order of the presets. */
export function builtInComponents(idGen: Idgen): Model[] {
  return PRESETS.map((p) => builtInComponent(p.kind, idGen));
}

/** The lowest and highest point of a model's shapes (for sizes and for standing it on the ground). */
export function modelExtent(model: Model): { min: Vec3; max: Vec3 } | null {
  if (model.cubes.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of model.cubes) {
    for (const p of worldPoints(c)) {
      for (let i = 0; i < 3; i++) {
        if (p[i]! < min[i]!) min[i] = p[i]!;
        if (p[i]! > max[i]!) max[i] = p[i]!;
      }
    }
  }
  return { min, max };
}

/** Size of the model in meters at scale 1. */
export function modelSize(model: Model): Vec3 {
  const e = modelExtent(model);
  return e ? [e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]] : [0, 0, 0];
}

