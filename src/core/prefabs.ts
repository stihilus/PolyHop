// Game objects as assets ("prefabs"): a ready-made level object (a coin, a door, a moving platform, or one
// of your own) that is placed from the Assets panel. The built-in ones are in every project and can be
// edited like any other asset. A prefab is only a template: placing it makes an ordinary level object,
// which remembers where it came from so it can be updated from the asset later.

import { ITEMS_ATLAS, ITEM_MODEL_IDS, type ItemKind, TILE } from './items';
import { boxMesh, cloneMesh, meshBounds } from './mesh';
import { PRESETS, type PresetKind, presetRules } from './presets';
import { propModelId } from './props';
import type { LevelBlock, LevelModelInstance, LevelObject, Prefab, TileRef, Vec3 } from './types';

/** The built-in model each pickup-like game object uses (null: it is a plain block). */
export const PRESET_ITEM: Record<PresetKind, ItemKind | null> = {
  coin: 'coin',
  key: 'key',
  apple: 'apple',
  checkpoint: 'flag',
  goal: 'trophy',
  door: null,
  hazard: null,
  exit: null,
  platform: null,
  sign: null,
  enemy: null,
  npc: null,
  water: null,
};

/** Built-in game objects that use a model of the props set (enemy, villager). */
export const PRESET_PROP: Partial<Record<PresetKind, string>> = {
  enemy: 'slime',
  npc: 'villager',
};

export const builtInPrefabId = (kind: PresetKind) => `prefab-${kind}`;

const MAIN_ATLAS = 'Textures-16.png';
const WOOD: TileRef = { texture: MAIN_ATLAS, col: 3, row: 13 };
const STONE: TileRef = { texture: MAIN_ATLAS, col: 7, row: 0 };

type Idgen = () => string;

function blockTemplate(name: string, size: Vec3, tile: TileRef, over: Partial<LevelBlock>, idGen: Idgen): LevelBlock {
  return {
    id: idGen(),
    name,
    kind: 'block',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    mesh: boxMesh(size),
    tile: { ...tile },
    color: '#ffffff',
    doubleSided: true,
    collide: true,
    rules: [],
    ...over,
  };
}

function modelTemplate(name: string, item: ItemKind, over: Partial<LevelModelInstance>, idGen: Idgen): LevelModelInstance {
  return {
    id: idGen(),
    name,
    kind: 'model',
    modelId: ITEM_MODEL_IDS[item],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    animation: 'spin',
    animationSpeed: 1,
    collide: false,
    rules: [],
    ...over,
  };
}

function propTemplate(name: string, prop: string, over: Partial<LevelModelInstance>, idGen: Idgen): LevelModelInstance {
  return {
    id: idGen(),
    name,
    kind: 'model',
    modelId: propModelId(prop),
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    animation: null,
    animationSpeed: 1,
    collide: false,
    rules: [],
    ...over,
  };
}

/** The factory version of a built-in game object. */
export function builtInPrefab(kind: PresetKind, idGen: Idgen): Prefab {
  const label = PRESETS.find((p) => p.kind === kind)!.label;
  const rules = presetRules(kind, idGen);
  let object: LevelObject;
  switch (kind) {
    case 'coin':
      object = modelTemplate(label, 'coin', { rules }, idGen);
      break;
    case 'key':
      object = modelTemplate(label, 'key', { rules }, idGen);
      break;
    case 'apple':
      object = modelTemplate(label, 'apple', { rules }, idGen);
      break;
    case 'checkpoint':
      object = modelTemplate(label, 'flag', { rules, animation: null }, idGen);
      break;
    case 'goal':
      object = modelTemplate(label, 'trophy', { rules, scale: [1.5, 1.5, 1.5] }, idGen);
      break;
    case 'door':
      object = blockTemplate(label, [2, 2.4, 0.3], WOOD, { rules }, idGen);
      break;
    case 'hazard':
      object = blockTemplate(label, [2, 0.12, 2], { texture: ITEMS_ATLAS, col: TILE.hazard, row: 0 }, { rules, collide: false }, idGen);
      break;
    case 'exit':
      object = blockTemplate(label, [2, 2.6, 0.3], STONE, { rules, color: '#9b6bff', collide: false }, idGen);
      break;
    case 'platform':
      object = blockTemplate(label, [3, 0.5, 3], STONE, { rules }, idGen);
      break;
    case 'sign':
      object = blockTemplate(label, [1.1, 1.4, 0.15], WOOD, { rules }, idGen);
      break;
    case 'water':
      object = blockTemplate(label, [8, 2, 8], { texture: 'Kit-16.png', col: 2, row: 4 }, { rules, collide: false, opacity: 0.7, liquid: true }, idGen);
      break;
    case 'enemy':
      object = propTemplate(label, PRESET_PROP.enemy!, { rules, animation: 'hop', collide: false }, idGen);
      break;
    case 'npc':
      object = propTemplate(label, PRESET_PROP.npc!, { rules, animation: 'idle', collide: true }, idGen);
      break;
  }
  return { id: builtInPrefabId(kind), name: label, base: kind, object };
}

/** Every built-in game object, in the order of the presets. */
export function builtInPrefabs(idGen: Idgen): Prefab[] {
  return PRESETS.map((p) => builtInPrefab(p.kind, idGen));
}

/** A copy of an object with new ids (and new ids for its rules). */
export function cloneObject<T extends LevelObject>(obj: T, idGen: Idgen): T {
  const copy = structuredClone(obj);
  copy.id = idGen();
  for (const r of copy.rules) r.id = idGen();
  return copy;
}

/** How far a block's origin has to be lifted so the shape sits on the ground point. */
function groundOffset(obj: LevelObject): number {
  return obj.kind === 'block' ? -meshBounds(obj.mesh).min[1] : 0;
}

/** A new level object made from the asset, standing on the ground point `at`. */
export function instantiatePrefab(prefab: Prefab, at: Vec3, idGen: Idgen): LevelObject {
  const obj = cloneObject(prefab.object, idGen);
  obj.name = prefab.name;
  obj.position = [at[0], at[1] + groundOffset(obj), at[2]];
  obj.prefab = prefab.id;
  return obj;
}

/**
 * Bring a placed object back in line with its asset: behavior, solidity and look. Its place, turn, size
 * and name stay as they are.
 */
export function applyPrefabTo(obj: LevelObject, prefab: Prefab, idGen: Idgen): void {
  const src = prefab.object;
  obj.collide = src.collide;
  obj.rules = structuredClone(src.rules);
  for (const r of obj.rules) r.id = idGen();
  if (obj.kind === 'block' && src.kind === 'block') {
    obj.color = src.color;
    obj.tile = src.tile ? { ...src.tile } : null;
    obj.doubleSided = src.doubleSided;
    if (src.smooth) obj.smooth = true;
    else delete obj.smooth;
    if (src.opacity !== undefined) obj.opacity = src.opacity;
    else delete obj.opacity;
    if (src.liquid) obj.liquid = true;
    else delete obj.liquid;
  } else if (obj.kind === 'model' && src.kind === 'model') {
    obj.modelId = src.modelId;
    obj.animation = src.animation;
    obj.animationSpeed = src.animationSpeed;
  }
}

/** A new asset from an object of the level (its shape, look and behavior). */
export function prefabFromObject(obj: LevelObject, name: string, idGen: Idgen): Prefab {
  const object = cloneObject(obj, idGen);
  object.position = [0, 0, 0];
  delete object.prefab;
  return { id: idGen(), name, base: null, object };
}

/** The asset takes over everything of this object (also its shape and size). */
export function savePrefabFrom(prefab: Prefab, obj: LevelObject, idGen: Idgen): void {
  const object = cloneObject(obj, idGen);
  object.position = [0, 0, 0];
  object.name = prefab.name;
  delete object.prefab;
  if (object.kind === 'block') object.mesh = cloneMesh(object.mesh);
  prefab.object = object;
}

/** The objects of a level list that were placed from this asset. */
export function placedFrom(objects: LevelObject[], prefabId: string): LevelObject[] {
  return objects.filter((o) => o.prefab === prefabId);
}

/**
 * Change what an asset is made of: a plain block (1 m, with `blockTile`) or a model. Its behavior, whether it
 * is solid and its turn are kept. Switching between two models only swaps the model.
 */
export function changePrefabLook(
  prefab: Prefab,
  look: { kind: 'block'; tile: TileRef | null } | { kind: 'model'; modelId: string },
  idGen: Idgen,
): void {
  const old = prefab.object;
  if (look.kind === 'model') {
    if (old.kind === 'model') {
      if (old.modelId === look.modelId) return;
      old.modelId = look.modelId;
      old.animation = null; // the other model has other animations
      return;
    }
    prefab.object = {
      id: idGen(),
      name: old.name,
      kind: 'model',
      modelId: look.modelId,
      position: [0, 0, 0],
      rotation: [...old.rotation],
      scale: [1, 1, 1],
      animation: null,
      animationSpeed: 1,
      collide: old.collide,
      rules: old.rules,
    };
    return;
  }
  if (old.kind === 'block') return;
  prefab.object = {
    id: idGen(),
    name: old.name,
    kind: 'block',
    position: [0, 0, 0],
    rotation: [...old.rotation],
    mesh: boxMesh([1, 1, 1]),
    tile: look.tile ? { ...look.tile } : null,
    color: '#ffffff',
    doubleSided: true,
    collide: old.collide,
    rules: old.rules,
  };
}

/** A brand new asset: a block, or a model, with no rules yet. */
export function newPrefab(
  look: { kind: 'block'; tile: TileRef | null } | { kind: 'model'; modelId: string },
  name: string,
  idGen: Idgen,
): Prefab {
  const seed: LevelBlock = {
    id: idGen(),
    name,
    kind: 'block',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    mesh: boxMesh([1, 1, 1]),
    tile: look.kind === 'block' && look.tile ? { ...look.tile } : null,
    color: '#ffffff',
    doubleSided: true,
    collide: true,
    rules: [],
  };
  const prefab: Prefab = { id: idGen(), name, base: null, object: seed };
  if (look.kind === 'model') changePrefabLook(prefab, look, idGen);
  return prefab;
}
