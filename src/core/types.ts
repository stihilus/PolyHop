// Project data model. Everything the editor edits and the runtime plays is plain JSON described here,
// so a project file stays human-readable and hand-editable.

import { packRects } from './atlasPack';
import { HUMANOID_FEMALE_ID, HUMANOID_ID, HUMANOID_IDS, OLD_HUMANOID_SKINS, createHumanoidModel, refreshHumanoidLayout } from './humanoid';
import { ITEMS_ATLAS, ITEM_MODEL_IDS, type ItemKind, TILE, createItemModel } from './items';
import { type Rule, type Variable, normalizeRules, normalizeVariables } from './logic';
import { PRESETS, type PresetKind, missingVariables, presetRules, presetSounds, presetVariables } from './presets';
import { PRESET_ITEM, PRESET_PROP, builtInPrefabs } from './prefabs';
import { rawAssetModels } from './assetModels';
import { type SplashScreen, normalizeSplash } from './splash';
import { KIT_KINDS, type KitKind, builtInKitModels, createKitModel, kitModelId } from './kit';
import { type LevelLook, normalizeLook } from './look';
import { PROP_KINDS, type PropKind, RETIRED_PROP_IDS, builtInPropModels, createPropModel, propModelId } from './props';
import { SOUND_IDS, type SoundAsset, builtInSound, normalizeSounds } from './sounds';
import {
  FACE_KEYS,
  type FaceKey,
  type MeshData,
  boxMesh,
  cloneMesh,
  isValidMesh,
  meshBounds,
  meshSize,
  rockMesh,
  sanitizeFaceTile,
  wedgeMesh,
} from './mesh';
import { PixelBuffer } from './pixels';
import { type TerrainInfo, isTerrainGrid, sanitizeTerrainInfo } from './terrain';
import { type UVPoly, rectUv } from './uv';

export { FACE_KEYS, type FaceKey };

export type Vec3 = [number, number, number];

/** The render scales the project settings offer. */
export const RENDER_SCALES: readonly number[] = [1, 0.5, 0.34, 0.25];

export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'run', 'crouch', 'interact'] as const;
export type Action = (typeof ACTIONS)[number];

/** Default texel density: pixels per meter. Equals the tile size of the stock atlas (1 m = 1 tile). */
export const TEXELS_PER_METER = 16;

/**
 * `chase`: the camera always sits behind the player and turns with them (A / D, the mouse or the
 * left stick steer the player, W / S move along where they face). `free`: the camera orbits on its
 * own and movement is relative to it.
 */
export type CameraMode = 'chase' | 'free';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'free'];

export interface PlayerSettings {
  color: string;
  /** Model used as the player's look, or null for the placeholder cube. */
  modelId: string | null;
  /** Texture drawn on the model instead of its own (a skin with the same layout), or null. */
  skin: string | null;
  /** Models fixed to a bone of the player's model (hat, hair, backpack); they follow its animation. */
  attachments: PlayerAttachment[];
  /** Sounds (ids) played on a jump, a jump in mid-air and a landing; null = silent. */
  soundJump: string | null;
  soundDoubleJump: string | null;
  soundLand: string | null;

  // size (meters)
  width: number;
  height: number;
  crouchHeight: number;

  // movement
  walkSpeed: number;
  runSpeed: number;
  crouchSpeed: number;
  acceleration: number;
  deceleration: number;
  airControl: number; // 0..1 multiplier on acceleration while airborne
  /** Steepest slope (degrees) the player can walk on; anything steeper is slid down like a wall. */
  maxSlope: number;
  /** Highest edge (m) the player walks up without jumping: stairs, curbs. */
  stepHeight: number;
  turnSpeed: number; // rad/s, free camera: how fast the player turns toward the move direction
  steerSpeed: number; // deg/s, chase camera: how fast A / D turn the player

  // jump
  jumpHeight: number;
  gravity: number;
  fallMultiplier: number;
  jumpCut: number; // velocity multiplier when jump is released early (1 = no variable jump height)
  coyoteTime: number;
  jumpBuffer: number;
  /** One extra jump in mid-air. */
  doubleJump: boolean;
  /** Hold jump while falling to glide down slowly (after letting go of it once in the air). */
  glide: boolean;
  /** Fall speed (m/s) while gliding. */
  glideFall: number;

  // camera
  cameraMode: CameraMode;
  cameraDistance: number;
  cameraHeight: number;
  cameraFov: number;
}

export interface PlayerAttachment {
  id: string;
  modelId: string;
  /** Name of the bone it hangs on, e.g. "Head". Names are shared by rigs, so a model swap keeps it. */
  bone: string;
  /** Offset from the bone's pivot (meters) in the rest pose, and extra rotation (degrees) / scale. */
  offset: Vec3;
  rotation: Vec3;
  scale: number;
}

export interface ProjectSettings {
  name: string;
  fullscreen: boolean;
  controls: Record<Action, string[]>; // KeyboardEvent.code values
  mouseSensitivity: number;
  invertY: boolean;
  gamepad: boolean;
  /** Background music: id of a music or file sound, or null. */
  music: string | null;
  /** Master volume of the whole game, 0..1. */
  volume: number;
  /**
   * How sharp the game is drawn while playing: 1 = full resolution, 0.5 = every game pixel is 2 x 2 screen
   * pixels, and so on (the chunky look of old games).
   */
  renderScale: number;
  /** A picture shown full screen when the exported game starts. */
  splash?: SplashScreen;
}

export interface TileRef {
  texture: string; // texture name, e.g. "Textures-16.png"
  col: number;
  row: number;
}

/**
 * An editable texture owned by the project. A project texture with the same name as a built-in
 * atlas replaces it everywhere (level blocks and models), which is how edits to a stock atlas work.
 */
export interface ProjectTexture {
  name: string;
  tileSize: number;
  pixels: PixelBuffer;
}

// ---------------------------------------------------------------- models

/** A joint of a rig. Pivots are in model space, rest pose; cubes are already in the rest pose too. */
export interface Bone {
  id: string;
  name: string; // unique within the model; animation clips refer to it
  parent: string | null; // bone id
  pivot: Vec3;
}

/** One keyframe: time in seconds and a value (rotation in degrees, or position offset in meters). */
export interface BoneKey {
  t: number;
  v: Vec3;
}

export interface BoneTrack {
  /** Rotation relative to the rest pose, degrees, XYZ. */
  rot?: BoneKey[];
  /** Translation relative to the rest pose, meters. */
  pos?: BoneKey[];
}

export interface AnimationClip {
  id: string;
  name: string; // idle / walk / run / jump / fall / crouch / crouch_walk are played by the player
  duration: number;
  loop: boolean;
  /** Curved (Catmull-Rom) instead of straight lines between keys. New clips are smooth. */
  smooth?: boolean;
  /** Keyed by bone name, so a clip works on every rig that has bones with those names. */
  tracks: Record<string, BoneTrack>;
}

export interface ModelCube {
  id: string;
  name: string;
  position: Vec3; // origin, in model space (meters). The model origin is its "feet".
  rotation: Vec3; // degrees, XYZ
  /** Vertices and faces (a box to start with); every face corner has a UV point into the model's texture. */
  mesh: MeshData;
  /** The bone this part moves with (bone id), or null for a part that never animates. */
  bone: string | null;
  /** Shade it as one smooth surface instead of flat faces (sharp edges stay sharp). */
  smooth?: boolean;
}

export interface Model {
  id: string;
  name: string;
  /** Name of the texture (project or built-in) all faces of this model sample from. */
  texture: string | null;
  cubes: ModelCube[];
  /** Skeleton (empty for a plain static model) and its animations. */
  bones: Bone[];
  clips: AnimationClip[];
}

// ---------------------------------------------------------------- level

export interface LevelBlock {
  id: string;
  name: string;
  kind: 'block';
  position: Vec3; // origin
  rotation: Vec3; // degrees, XYZ
  /** Geometry. Faces are textured by repeating `tile` every meter (UVs in the mesh are not used). */
  mesh: MeshData;
  tile: TileRef | null;
  color: string; // tint, '#ffffff' = none
  /** Drawn from both sides. Needed for planes (grass, leaves) and for seeing into open shapes. */
  doubleSided: boolean;
  /** Shade round shapes as one smooth surface instead of flat faces (sharp edges stay sharp). */
  smooth?: boolean;
  /** Set when the mesh is a terrain grid (see terrain.ts): enables the sculpt brush. */
  terrain?: TerrainInfo;
  /** 1 = solid color; lower = see-through (glass, water). */
  opacity?: number;
  /** A body of water: the player swims inside it (it need not be solid). */
  liquid?: boolean;
  collide: boolean;
  /** Game logic of this object: what happens when the player touches it, and so on. */
  rules: Rule[];
  /** The asset (prefab) it was placed from, so it can be updated from it. */
  prefab?: string;
}

export interface LevelModelInstance {
  id: string;
  name: string;
  kind: 'model';
  modelId: string;
  position: Vec3; // where the model origin sits
  rotation: Vec3; // degrees, XYZ
  scale: Vec3;
  /** Name of the model's animation this instance plays (looping), or null for a still model. */
  animation: string | null;
  animationSpeed: number;
  collide: boolean;
  rules: Rule[];
  /** The asset (prefab) it was placed from. */
  prefab?: string;
}

export type LevelObject = LevelBlock | LevelModelInstance;

/**
 * A game object kept as an asset: a coin, a door, a moving platform or one of your own. Placing it makes
 * an ordinary level object. The built-in ones (`base` set) are in every project and can be edited.
 */
export interface Prefab {
  id: string;
  name: string;
  /** The built-in game object this one started as (it also brings the variables and sounds it needs). */
  base: PresetKind | null;
  /** The template, as it is placed. Its position is not used. */
  object: LevelObject;
}

/** The sky color of a level unless it picks another. */
export const DEFAULT_SKY = '#8fc0ee';

/** One level of the game: its objects and where the player starts. */
export interface LevelData {
  id: string;
  name: string;
  objects: LevelObject[];
  /** Where the player starts (feet position) and the direction they face, in degrees. */
  spawn: Vec3;
  spawnYaw: number;
  /** Color of the sky and the fog. */
  sky: string;
  /** Fog distances, sun, ambient light and shadows. */
  look: LevelLook;
}

export interface Project {
  version: number;
  settings: ProjectSettings;
  player: PlayerSettings;
  textures: ProjectTexture[];
  models: Model[];
  /** Numbers the game keeps track of (coins, keys, health, ...). */
  variables: Variable[];
  /** Sound effects, music loops and imported audio. */
  sounds: SoundAsset[];
  /** The levels of the game, played in this order; there is always at least one. */
  levels: LevelData[];
  /** Game objects kept as assets: the built-in ones (always there) and your own. */
  prefabs: Prefab[];
  /** Set in an exported game: the editor-only parts were left out, and must not be brought back. */
  exported?: boolean;
}

export type Selection = { kind: 'none' } | { kind: 'player' } | { kind: 'object'; id: string };

export const DEFAULT_CONTROLS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  run: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC'],
  interact: ['KeyE'],
};

export function defaultPlayer(): PlayerSettings {
  return {
    color: '#ff8a3d',
    modelId: HUMANOID_ID,
    skin: null,
    attachments: [],
    soundJump: SOUND_IDS.jump,
    soundDoubleJump: SOUND_IDS.jump2,
    soundLand: SOUND_IDS.land,
    width: 0.6,
    height: 1.8,
    crouchHeight: 1.1,
    walkSpeed: 4,
    runSpeed: 7,
    crouchSpeed: 2,
    acceleration: 60,
    deceleration: 50,
    airControl: 0.6,
    maxSlope: 50,
    stepHeight: 0.4,
    turnSpeed: 16,
    steerSpeed: 150,
    jumpHeight: 1.6,
    gravity: 35,
    fallMultiplier: 1.5,
    jumpCut: 0.5,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    doubleJump: true,
    glide: false,
    glideFall: 1.6,
    cameraMode: 'chase',
    cameraDistance: 6.5,
    cameraHeight: 0.8,
    cameraFov: 60,
  };
}

export function defaultSettings(): ProjectSettings {
  return {
    name: 'My Platformer',
    fullscreen: false,
    controls: structuredClone(DEFAULT_CONTROLS),
    mouseSensitivity: 1,
    invertY: false,
    gamepad: true,
    music: SOUND_IDS.theme,
    volume: 0.8,
    renderScale: 1,
  };
}

let idCounter = 0;
export function newId(): string {
  idCounter++;
  return `obj_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(Math.random() * 1296).toString(36)}`;
}

const vec3 = (v: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)) ? ([...v] as Vec3) : [...fallback];

// ---------------------------------------------------------------- model helpers

type Rect = { x: number; y: number; w: number; h: number };
const DEFAULT_RECT: Rect = { x: 0, y: 0, w: 16, h: 16 };

/** A box cube whose six faces all show the given texture rectangle. */
export function createCube(name: string, position: Vec3, size: Vec3, rect: Rect = DEFAULT_RECT): ModelCube {
  return { id: newId(), name, position, rotation: [0, 0, 0], mesh: boxMesh(size, null, null, rect), bone: null };
}

/** A cube from an arbitrary mesh (primitives such as a wedge or a rock). */
export function createMeshCube(name: string, position: Vec3, mesh: MeshData): ModelCube {
  return { id: newId(), name, position, rotation: [0, 0, 0], mesh, bone: null };
}

export function createModel(name: string, texture: string | null, rect?: Rect): Model {
  return { id: newId(), name, texture, cubes: [createCube('Cube', [0, 0.5, 0], [1, 1, 1], rect)], bones: [], clips: [] };
}

export function cloneModel(model: Model): Model {
  // bones get new ids; cubes and parents are re-pointed at them
  const boneIds = new Map(model.bones.map((b) => [b.id, newId()] as const));
  return {
    id: newId(),
    name: `${model.name} copy`,
    texture: model.texture,
    cubes: model.cubes.map((c) => ({ ...cloneCube(c, c.name), bone: c.bone ? (boneIds.get(c.bone) ?? null) : null })),
    bones: model.bones.map((b) => ({
      id: boneIds.get(b.id)!,
      name: b.name,
      parent: b.parent ? (boneIds.get(b.parent) ?? null) : null,
      pivot: [...b.pivot],
    })),
    clips: model.clips.map((c) => structuredClone(c)),
  };
}

export function cloneCube(c: ModelCube, name: string): ModelCube {
  return {
    id: newId(),
    name,
    position: [...c.position],
    rotation: [...c.rotation],
    mesh: cloneMesh(c.mesh),
    bone: c.bone,
    ...(c.smooth ? { smooth: true } : {}),
  };
}

/** Raw (possibly old-format) object -> mesh: uses `mesh` when valid, else builds a box from size / offsets / uv. */
function meshFromRaw(raw: {
  mesh?: unknown;
  size?: unknown;
  offsets?: unknown;
  uv?: unknown;
}): MeshData {
  if (isValidMesh(raw.mesh)) {
    const mesh = cloneMesh(raw.mesh);
    // painted tiles of a hand-edited file: keep the good ones
    for (const f of mesh.faces) {
      const t = sanitizeFaceTile(f.tile);
      if (t) f.tile = t;
      else delete f.tile;
    }
    return mesh;
  }
  const size = vec3(raw.size, [1, 1, 1]);
  const off = raw.offsets;
  const offsets =
    Array.isArray(off) && off.length === 8 && off.every((o) => Array.isArray(o) && o.length === 3 && o.every((n) => Number.isFinite(n)))
      ? (off as Vec3[])
      : null;
  const uvRaw = raw.uv as Record<string, unknown> | undefined;
  const uv: Partial<Record<FaceKey, UVPoly>> = {};
  if (uvRaw && typeof uvRaw === 'object') {
    for (const k of FACE_KEYS) {
      const v = uvRaw[k];
      if (
        Array.isArray(v) &&
        v.length === 4 &&
        v.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      ) {
        uv[k] = v as UVPoly;
      }
    }
  }
  return boxMesh(size, offsets, uv);
}

function normalizeCube(raw: Partial<ModelCube> & { size?: unknown; offsets?: unknown; uv?: unknown }): ModelCube {
  return {
    id: raw.id ?? newId(),
    name: raw.name ?? 'Cube',
    position: vec3(raw.position, [0, 0.5, 0]),
    rotation: vec3(raw.rotation, [0, 0, 0]),
    mesh: meshFromRaw(raw),
    bone: typeof raw.bone === 'string' ? raw.bone : null,
    ...(raw.smooth === true ? { smooth: true } : {}),
  };
}

function normalizeKeys(raw: unknown): BoneKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const keys: BoneKey[] = [];
  for (const k of raw) {
    const t = (k as { t?: unknown })?.t;
    const v = (k as { v?: unknown })?.v;
    if (typeof t === 'number' && Number.isFinite(t) && Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))) {
      keys.push({ t, v: [...v] as Vec3 });
    }
  }
  return keys.length > 0 ? keys.sort((a, b) => a.t - b.t) : undefined;
}

export function normalizeClip(raw: Partial<AnimationClip>): AnimationClip {
  const tracks: Record<string, BoneTrack> = {};
  if (raw.tracks && typeof raw.tracks === 'object') {
    for (const [bone, t] of Object.entries(raw.tracks)) {
      const rot = normalizeKeys((t as BoneTrack)?.rot);
      const pos = normalizeKeys((t as BoneTrack)?.pos);
      if (rot || pos) tracks[bone] = { ...(rot ? { rot } : {}), ...(pos ? { pos } : {}) };
    }
  }
  const duration = typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : 1;
  return { id: raw.id ?? newId(), name: raw.name ?? 'clip', duration, loop: raw.loop ?? true, smooth: raw.smooth === true, tracks };
}

export function normalizeModel(raw: Partial<Model>): Model {
  const cubes = Array.isArray(raw.cubes) ? raw.cubes.map((c) => normalizeCube(c)) : [];
  const bones: Bone[] = [];
  const seen = new Set<string>();
  for (const b of Array.isArray(raw.bones) ? raw.bones : []) {
    if (!b || typeof b.id !== 'string' || typeof b.name !== 'string' || seen.has(b.id)) continue;
    seen.add(b.id);
    bones.push({ id: b.id, name: b.name, parent: typeof b.parent === 'string' ? b.parent : null, pivot: vec3(b.pivot, [0, 0, 0]) });
  }
  // a parent or a cube that points at a missing bone falls back to "none"
  for (const b of bones) if (b.parent && !seen.has(b.parent)) b.parent = null;
  for (const c of cubes) if (c.bone && !seen.has(c.bone)) c.bone = null;
  return {
    id: raw.id ?? newId(),
    name: raw.name ?? 'Model',
    texture: typeof raw.texture === 'string' ? raw.texture : null,
    cubes,
    bones,
    clips: Array.isArray(raw.clips) ? raw.clips.map((c) => normalizeClip(c)) : [],
  };
}

/**
 * Earlier model files stored one bitmap per cube face. Pack those bitmaps into a new project
 * texture and point the faces at it, so old projects keep looking the same.
 */
function migrateLegacyModel(
  raw: { id?: string; name?: string; cubes?: { id?: string; name?: string; position?: Vec3; size?: Vec3; faces?: Record<string, unknown> }[] },
  takenNames: Set<string>,
): { model: Model; texture: ProjectTexture } {
  const cubes = raw.cubes ?? [];
  const items: { key: string; w: number; h: number; buf: PixelBuffer }[] = [];
  cubes.forEach((c, ci) => {
    for (const key of FACE_KEYS) {
      const buf = PixelBuffer.from(c.faces?.[key], 16, 16);
      items.push({ key: `${ci}:${key}`, w: buf.w, h: buf.h, buf });
    }
  });
  const layout = packRects(items);
  const pixels = new PixelBuffer(layout.width, layout.height);
  for (const it of items) {
    const r = layout.rects.get(it.key)!;
    pixels.blit(it.buf, r.x, r.y);
  }

  const baseName = `${raw.name ?? 'Model'} texture`;
  let name = baseName;
  for (let n = 2; takenNames.has(name); n++) name = `${baseName} ${n}`;
  takenNames.add(name);

  const model: Model = {
    id: raw.id ?? newId(),
    name: raw.name ?? 'Model',
    texture: name,
    cubes: cubes.map((c, ci) => {
      const uv: Partial<Record<FaceKey, UVPoly>> = {};
      for (const key of FACE_KEYS) {
        const r = layout.rects.get(`${ci}:${key}`)!;
        uv[key] = rectUv(r.x, r.y, r.w, r.h);
      }
      return {
        id: c.id ?? newId(),
        name: c.name ?? 'Cube',
        position: vec3(c.position, [0, 0.5, 0]),
        rotation: [0, 0, 0],
        mesh: boxMesh(vec3(c.size, [1, 1, 1]), null, uv),
        bone: null,
      };
    }),
    bones: [],
    clips: [],
  };
  return { model, texture: { name, tileSize: 16, pixels } };
}

function isLegacyModel(raw: unknown): boolean {
  const cubes = (raw as { cubes?: unknown[] } | null)?.cubes;
  if (!Array.isArray(cubes) || cubes.length === 0) return false;
  return cubes.some((c) => c && typeof c === 'object' && 'faces' in c && !('uv' in c) && !('mesh' in c));
}

/** Bounding-box size of a shape's mesh (what the inspector shows as "Size"). */
export function shapeSize(shape: { mesh: MeshData }): Vec3 {
  return meshSize(shape.mesh);
}

// ---------------------------------------------------------------- level helpers

const ATLAS = 'Textures-16.png';

function block(
  name: string,
  position: Vec3,
  size: Vec3,
  tile: [number, number] | null,
  collide = true,
): LevelBlock {
  return {
    id: newId(),
    name,
    kind: 'block',
    position,
    rotation: [0, 0, 0],
    mesh: boxMesh(size),
    tile: tile ? { texture: ATLAS, col: tile[0], row: tile[1] } : null,
    color: '#ffffff',
    doubleSided: true,
    collide,
    rules: [],
  };
}

/** A new box-shaped level block. */
export function createBlock(name: string, position: Vec3, mesh: MeshData, tile: TileRef | null): LevelBlock {
  return { id: newId(), name, kind: 'block', position, rotation: [0, 0, 0], mesh, tile, color: '#ffffff', doubleSided: true, collide: true, rules: [] };
}

export function createModelInstance(model: Model, position: Vec3): LevelModelInstance {
  return {
    id: newId(),
    name: model.name,
    kind: 'model',
    modelId: model.id,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    animation: null,
    animationSpeed: 1,
    collide: true,
    rules: [],
  };
}

/** A small test level: ground, stairs, floating platforms, crates, a crouch tunnel and a tall wall. */
export function defaultLevel(): LevelObject[] {
  const GRASS: [number, number] = [3, 16];
  const STONE: [number, number] = [7, 0];
  const BRICK: [number, number] = [3, 3];
  const CRATE: [number, number] = [2, 14];
  const WOOD: [number, number] = [3, 13];

  const objects: LevelObject[] = [];
  objects.push(block('Ground', [0, -0.5, 0], [40, 1, 40], GRASS));

  // stairs, each step 0.6 m higher
  for (let i = 1; i <= 5; i++) {
    objects.push(block(`Step ${i}`, [-6 + i * 2, 0.3 * i, -3], [2, 0.6 * i, 3], BRICK));
  }

  // floating platforms: jump up / run-jump gaps
  const platforms: Vec3[] = [
    [8, 1.0, -4],
    [11.5, 2.0, -6],
    [8, 3.0, -9],
    [4, 4.0, -9],
  ];
  platforms.forEach((p, i) => objects.push(block(`Platform ${i + 1}`, p, [3, 0.5, 3], STONE)));

  // crates
  objects.push(block('Crate 1', [-3, 0.5, 4], [1, 1, 1], CRATE));
  objects.push(block('Crate 2', [-4, 0.5, 4], [1, 1, 1], CRATE));
  objects.push(block('Crate 3', [-3.5, 1.5, 4], [1, 1, 1], CRATE));

  // crouch tunnel: 1.3 m clearance (standing height is 1.8, crouch height 1.1)
  objects.push(block('Tunnel wall L', [-8.25, 0.9, 8], [0.5, 1.8, 3], WOOD));
  objects.push(block('Tunnel wall R', [-5.75, 0.9, 8], [0.5, 1.8, 3], WOOD));
  objects.push(block('Tunnel roof', [-7, 1.55, 8], [3, 0.5, 3], WOOD));

  // a ramp to walk up (the player follows slopes up to its Max slope) and a rock to climb around
  const stone = { texture: ATLAS, col: STONE[0], row: STONE[1] };
  objects.push(createBlock('Ramp', [4, 0.9, 5], wedgeMesh([3, 1.8, 6]), stone));
  const rock = rockMesh(5, 2.6);
  objects.push(createBlock('Rock', [-12, -meshBounds(rock).min[1], 0], rock, stone));

  // tall wall (camera collision test)
  objects.push(block('Wall', [0, 3, -14], [10, 6, 1], STONE));

  // a lift that rides 4 m up and down, with a ledge to step off onto
  const lift = block('Lift', [-15, 0.25, -5], [3, 0.5, 3], STONE);
  lift.rules = presetRules('platform', newId);
  const ride = lift.rules[0]!.actions[0]!;
  if (ride.type === 'patrol') ride.offset = [0, 4, 0];
  objects.push(lift);
  objects.push(block('Ledge', [-18, 2.25, -5], [3, 0.5, 3], STONE));

  // ---- game logic: coins to collect, a key, a locked door, an apple, a checkpoint and a hazard
  const pickup = (kind: ItemKind, preset: PresetKind, name: string, position: Vec3): LevelModelInstance => ({
    id: newId(),
    name,
    kind: 'model',
    modelId: ITEM_MODEL_IDS[kind],
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    animation: kind === 'flag' ? null : 'spin',
    animationSpeed: 1,
    collide: false,
    rules: presetRules(preset, newId),
  });
  for (const [i, z] of [5, 3.2, 1.4].entries()) objects.push(pickup('coin', 'coin', `Coin ${i + 1}`, [0, 0, z]));
  objects.push(pickup('coin', 'coin', 'Coin 4', [8, 1.25, -4]));
  objects.push(pickup('coin', 'coin', 'Coin 5', [11.5, 2.25, -6]));
  objects.push(pickup('coin', 'coin', 'Coin 6', [8, 3.25, -9]));
  objects.push(pickup('key', 'key', 'Key', [4, 4.25, -9]));
  objects.push(pickup('apple', 'apple', 'Apple', [-10, 0, 4]));
  objects.push(pickup('flag', 'checkpoint', 'Checkpoint', [-3, 0, 1]));

  // the goal: one more platform above the last one, with a trophy on it
  objects.push(block('Platform 5', [0, 5, -10.5], [3, 0.5, 3], STONE));
  const goal = pickup('trophy', 'goal', 'Goal', [0, 5.25, -10.5]);
  goal.scale = [1.5, 1.5, 1.5];
  objects.push(goal);

  // the tunnel's far end is closed by a door that wants a key; three coins wait behind it
  const door = block('Door', [-7, 0.65, 6.4], [2, 1.3, 0.3], WOOD);
  door.rules = presetRules('door', newId);
  objects.push(door);
  for (const [i, z] of [4.5, 3.5, 2.5].entries()) objects.push(pickup('coin', 'coin', `Coin ${i + 7}`, [-7, 0, z]));

  // a sign by the start that explains the game when Interact (E) is pressed next to it
  const sign = block('Sign', [2.5, 0.7, 6.5], [1.1, 1.4, 0.15], WOOD);
  sign.rules = presetRules('sign', newId);
  const say = sign.rules[0]!.actions[0]!;
  if (say.type === 'message') {
    say.text = 'Collect the coins and the key, open the door and reach the trophy on top!';
    say.seconds = 6;
  }
  objects.push(sign);

  const hazard = block('Hazard', [6, 0.06, 2], [2, 0.12, 2], null, false);
  hazard.tile = { texture: ITEMS_ATLAS, col: TILE.hazard, row: 0 };
  hazard.rules = presetRules('hazard', newId);
  objects.push(hazard);
  return objects;
}

/**
 * 2: the player is the built-in humanoid by default. 3: the humanoid's skin has its own layout.
 * 4: the player is 1.8 m tall by default. 5: a project has a list of levels, each with its own spawn.
 * 6: the built-in prop models (furniture, gems, plants, ...) are in every project. 7: the trees and ore
 * blocks of the first prop set were taken out again. 8: the building kit and the modeled trees are in
 * every project. 9: the Slime and Villager models, and a glide pose for the humanoid. 10: the models that
 * come as files (assets/models) are in every project. 11: the humanoid was rebuilt (new parts, bone names and skins).
 * 12: the humanoid has no nose and its hair is a part of its own; there is a female build as well.
 * 13: the characters got a smaller, squarer head (a new layout, so the skins changed too).
 */
export const PROJECT_VERSION = 13;

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    settings: defaultSettings(),
    player: defaultPlayer(),
    textures: [],
    models: [
      createHumanoidModel(newId),
      createHumanoidModel(newId, HUMANOID_FEMALE_ID),
      createItemModel('coin', newId),
      createItemModel('key', newId),
      createItemModel('apple', newId),
      createItemModel('flag', newId),
      createItemModel('trophy', newId),
      ...builtInPropModels(newId),
      ...builtInKitModels(newId),
      ...builtInAssetModels(),
    ],
    variables: [
      ...missingVariables([], presetVariables('coin'), newId),
      ...missingVariables([], presetVariables('key'), newId),
      ...missingVariables([], presetVariables('apple'), newId),
    ],
    sounds: Object.values(SOUND_IDS)
      .map((id) => builtInSound(id))
      .filter((s): s is SoundAsset => s !== null),
    levels: [createLevelData('Level 1', defaultLevel(), [0, 0.05, 8], 180)],
    prefabs: builtInPrefabs(newId),
  };
}

/**
 * A fresh copy of a built-in model by its id (the humanoids, a pickup, a prop, a piece of the kit or a model of
 * assets/models), or null when there is no such model. For previews of game objects whose model is not in the
 * project yet.
 */
export function builtInModelById(id: string): Model | null {
  if (HUMANOID_IDS.includes(id)) return createHumanoidModel(newId, id);
  for (const kind of Object.keys(ITEM_MODEL_IDS) as ItemKind[]) {
    if (ITEM_MODEL_IDS[kind] === id) return createItemModel(kind, newId);
  }
  const prop = PROP_KINDS.find((k) => propModelId(k) === id);
  if (prop) return createPropModel(prop as PropKind, newId);
  const kit = KIT_KINDS.find((k) => kitModelId(k) === id);
  if (kit) return createKitModel(kit as KitKind, newId);
  return builtInAssetModels().find((m) => m.id === id) ?? null;
}

/** The models of assets/models, made valid. */
export function builtInAssetModels(): Model[] {
  return rawAssetModels().map((raw) => normalizeModel(raw as Partial<Model>));
}

export function createLevelData(name: string, objects: LevelObject[], spawn: Vec3 = [0, 0.05, 0], spawnYaw = 180, sky = DEFAULT_SKY): LevelData {
  return { id: newId(), name, objects, spawn: [...spawn], spawnYaw, sky, look: normalizeLook(null) };
}

/** A new empty level: a flat ground to stand on. */
export function emptyLevelObjects(): LevelObject[] {
  return [block('Ground', [0, -0.5, 0], [30, 1, 30], [3, 16])];
}


/**
 * Make sure the project has what a preset needs: its variables and, for pickups, its model. Returns the
 * id of the model to use (null for presets that are plain blocks).
 */
export function ensurePresetAssets(project: Project, kind: PresetKind): string | null {
  project.variables.push(...missingVariables(project.variables, presetVariables(kind), newId));
  for (const id of presetSounds(kind)) {
    const sound = builtInSound(id);
    if (sound && !project.sounds.some((s) => s.id === id)) project.sounds.push(sound);
  }
  const prop = PRESET_PROP[kind];
  if (prop) {
    const pid = propModelId(prop);
    if (!project.models.some((m) => m.id === pid)) project.models.push(createPropModel(prop, newId));
    return pid;
  }
  const itemKind = PRESET_ITEM[kind];
  if (!itemKind) return null;
  const id = ITEM_MODEL_IDS[itemKind];
  if (!project.models.some((m) => m.id === id)) project.models.push(createItemModel(itemKind, newId));
  return id;
}

export function normalizeObject(o: Partial<LevelObject> & { kind?: string; size?: unknown; offsets?: unknown }): LevelObject {
  if (o.kind === 'model') {
    // earlier files had `rotationY` (degrees) and a single `scale` number
    const m = o as Partial<LevelModelInstance> & { rotationY?: number; scale?: unknown };
    const s = typeof m.scale === 'number' ? ([m.scale, m.scale, m.scale] as Vec3) : vec3(m.scale, [1, 1, 1]);
    const rot = Array.isArray(m.rotation) ? vec3(m.rotation, [0, 0, 0]) : ([0, m.rotationY ?? 0, 0] as Vec3);
    return {
      id: m.id ?? newId(),
      name: m.name ?? 'Model',
      kind: 'model',
      modelId: m.modelId ?? '',
      position: vec3(m.position, [0, 0, 0]),
      rotation: rot,
      scale: s,
      animation: typeof m.animation === 'string' && m.animation ? m.animation : null,
      animationSpeed: typeof m.animationSpeed === 'number' && m.animationSpeed > 0 ? m.animationSpeed : 1,
      collide: m.collide ?? true,
      rules: normalizeRules(m.rules, newId),
      ...(typeof m.prefab === 'string' && m.prefab ? { prefab: m.prefab } : {}),
    };
  }
  const b = o as Partial<LevelBlock> & { size?: unknown; offsets?: unknown };
  const tile = b.tile && typeof b.tile === 'object' && typeof b.tile.texture === 'string' ? b.tile : null;
  const mesh = meshFromRaw(b);
  const terrain = sanitizeTerrainInfo(b.terrain);
  return {
    id: b.id ?? newId(),
    name: b.name ?? 'Block',
    kind: 'block',
    position: vec3(b.position, [0, 0, 0]),
    rotation: vec3(b.rotation, [0, 0, 0]),
    mesh,
    ...(terrain && isTerrainGrid(mesh, terrain) ? { terrain } : {}),
    tile,
    color: typeof b.color === 'string' ? b.color : '#ffffff',
    doubleSided: typeof b.doubleSided === 'boolean' ? b.doubleSided : true,
    ...(b.smooth === true ? { smooth: true } : {}),
    ...(typeof b.opacity === 'number' && b.opacity < 1 ? { opacity: Math.max(0.05, b.opacity) } : {}),
    ...(b.liquid === true ? { liquid: true } : {}),
    collide: b.collide ?? true,
    rules: normalizeRules(b.rules, newId),
    ...(typeof b.prefab === 'string' && b.prefab ? { prefab: b.prefab } : {}),
  };
}

function normalizeTexture(raw: Partial<ProjectTexture> | undefined): ProjectTexture | null {
  if (!raw || typeof raw.name !== 'string') return null;
  const tileSize = typeof raw.tileSize === 'number' && raw.tileSize > 0 ? Math.floor(raw.tileSize) : 16;
  return { name: raw.name, tileSize, pixels: PixelBuffer.from(raw.pixels, 64, 64) };
}

function normalizeAttachments(raw: unknown): PlayerAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayerAttachment[] = [];
  for (const a of raw as Partial<PlayerAttachment>[]) {
    if (!a || typeof a.modelId !== 'string' || typeof a.bone !== 'string') continue;
    out.push({
      id: typeof a.id === 'string' ? a.id : newId(),
      modelId: a.modelId,
      bone: a.bone,
      offset: vec3(a.offset, [0, 0, 0]),
      rotation: vec3(a.rotation, [0, 0, 0]),
      scale: typeof a.scale === 'number' && a.scale > 0 ? a.scale : 1,
    });
  }
  return out;
}

/** Fill in anything missing from an older or hand-edited project file. */
export function normalizeProject(raw: unknown): Project {
  const base = createDefaultProject();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Project>;
  const settings: ProjectSettings = { ...base.settings, ...(r.settings ?? {}) };
  settings.controls = { ...base.settings.controls, ...(r.settings?.controls ?? {}) };
  // `airJumps` was replaced by the `doubleJump` switch (on for everyone, it is the new default)
  // and the spawn point moved from the player to the level it belongs to
  const {
    airJumps: _legacyAirJumps,
    spawn: legacySpawn,
    spawnYaw: legacyYaw,
    ...storedPlayer
  } = (r.player ?? {}) as Partial<PlayerSettings> & { airJumps?: unknown; spawn?: unknown; spawnYaw?: unknown };
  const player: PlayerSettings = { ...base.player, ...storedPlayer };
  player.skin = typeof player.skin === 'string' ? player.skin : null;
  player.attachments = normalizeAttachments(player.attachments);
  if (typeof player.doubleJump !== 'boolean') player.doubleJump = base.player.doubleJump;
  if (typeof player.glide !== 'boolean') player.glide = base.player.glide;
  if (typeof player.glideFall !== 'number' || !(player.glideFall >= 0.2 && player.glideFall <= 10)) player.glideFall = base.player.glideFall;
  if (!CAMERA_MODES.includes(player.cameraMode)) player.cameraMode = base.player.cameraMode;
  if (typeof player.maxSlope !== 'number' || !(player.maxSlope >= 5 && player.maxSlope <= 85)) player.maxSlope = base.player.maxSlope;
  if (typeof player.stepHeight !== 'number' || !(player.stepHeight >= 0 && player.stepHeight <= 1.5)) player.stepHeight = base.player.stepHeight;

  const textures: ProjectTexture[] = [];
  for (const t of Array.isArray(r.textures) ? r.textures : []) {
    const tex = normalizeTexture(t);
    if (tex) textures.push(tex);
  }

  const takenNames = new Set(textures.map((t) => t.name));
  const models: Model[] = [];
  for (const m of Array.isArray(r.models) ? r.models : []) {
    if (isLegacyModel(m)) {
      const migrated = migrateLegacyModel(m as Parameters<typeof migrateLegacyModel>[0], takenNames);
      models.push(migrated.model);
      textures.push(migrated.texture);
    } else {
      models.push(normalizeModel(m));
    }
  }

  // projects made before version 2 played a cube: give them the humanoid (once) and a fitting body size
  const rawVersion = typeof r.version === 'number' ? r.version : 1;
  if (rawVersion < 2 && player.modelId === null) {
    player.modelId = HUMANOID_ID;
    if (player.width === 0.8) player.width = base.player.width;
    if (player.crouchHeight === 0.5) player.crouchHeight = base.player.crouchHeight;
  }
  if (player.modelId === HUMANOID_ID && !models.some((m) => m.id === HUMANOID_ID)) models.push(createHumanoidModel(newId));
  if (rawVersion < 3) {
    const saved = models.find((m) => m.id === HUMANOID_ID);
    if (saved) refreshHumanoidLayout(saved, createHumanoidModel(newId));
  }
  // versions 11 to 13: the humanoid was rebuilt from scratch (other parts, bone names, skins; then no nose and the hair as
  // parts of its own; then a smaller head): a saved one is replaced by the current one, and the female build is added
  if (rawVersion < 13) {
    const at = models.findIndex((m) => m.id === HUMANOID_ID);
    if (at >= 0) models[at] = createHumanoidModel(newId);
    const femaleAt = models.findIndex((m) => m.id === HUMANOID_FEMALE_ID);
    if (femaleAt >= 0) models[femaleAt] = createHumanoidModel(newId, HUMANOID_FEMALE_ID);
    else if (rawVersion < 12 && r.exported !== true) models.splice(at >= 0 ? at + 1 : models.length, 0, createHumanoidModel(newId, HUMANOID_FEMALE_ID));
    // a skin by an old name is the same skin in the new layout
    if (player.skin && player.skin in OLD_HUMANOID_SKINS) player.skin = OLD_HUMANOID_SKINS[player.skin] ?? null;
    // the nose is gone: something worn on it sits on the head now
    for (const a of player.attachments) if (a.bone === 'Nose') a.bone = 'Head';
  }
  if (rawVersion < 11) {
    // things worn on a bone of the old rig follow the bone that took its place
    const renamed: Record<string, string> = {
      RightShoulder: 'RightUpperArm',
      LeftShoulder: 'LeftUpperArm',
      RightLeg: 'RightShin',
      LeftLeg: 'LeftShin',
      Pelvis: 'Hips',
      Body: 'Waist',
      HyRoot: 'Root',
    };
    for (const a of player.attachments) a.bone = renamed[a.bone] ?? a.bone;
  }
  // the player grew to 1.8 m: take over the new body size where the old default was never changed
  if (rawVersion < 4) {
    if (player.height === 1) player.height = base.player.height;
    if (player.width === 0.5) player.width = base.player.width;
    if (player.crouchHeight === 0.65) player.crouchHeight = base.player.crouchHeight;
    if (player.cameraDistance === 4.5) player.cameraDistance = base.player.cameraDistance;
  }

  // the built-in props arrived with version 6: older projects get them once (and may delete them again)
  if (rawVersion < 6) {
    const have = new Set(models.map((m) => m.id));
    for (const m of builtInPropModels(newId)) if (!have.has(m.id)) models.push(m);
  }

  // the building kit and modeled trees arrived with version 8
  if (rawVersion < 8) {
    const have = new Set(models.map((m) => m.id));
    for (const m of builtInKitModels(newId)) if (!have.has(m.id)) models.push(m);
  }

  // version 10: the models that come as files
  if (rawVersion < 10) {
    const have = new Set(models.map((m) => m.id));
    for (const m of builtInAssetModels()) if (!have.has(m.id)) models.push(m);
  }

  // version 9: the characters of the prop set, and a gliding pose for the built-in humanoid
  if (rawVersion < 9) {
    const have = new Set(models.map((m) => m.id));
    for (const kind of ['slime', 'villager']) {
      if (!have.has(propModelId(kind))) models.push(createPropModel(kind, newId));
    }
    const human = models.find((m) => m.id === HUMANOID_ID);
    if (human) {
      const fresh = createHumanoidModel(newId);
      for (const name of ['glide', 'swim']) {
        const clip = fresh.clips.find((c) => c.name === name);
        if (clip && !human.clips.some((c) => c.name === name)) human.clips.push(clip);
      }
    }
  }

  const levels = normalizeLevels(r, vec3(legacySpawn, base.levels[0]!.spawn), typeof legacyYaw === 'number' ? legacyYaw : base.levels[0]!.spawnYaw, base);
  // projects without variables or sounds simply have none (the starter ones belong to the starter level)
  const variables = r.variables !== undefined ? normalizeVariables(r.variables, newId) : [];
  const sounds = r.sounds !== undefined ? normalizeSounds(r.sounds, newId) : [];
  const known = new Set(sounds.map((s) => s.id));
  // a reference to a sound that does not exist is just silence
  if (settings.music !== null && (typeof settings.music !== 'string' || !known.has(settings.music))) settings.music = null;
  for (const k of ['soundJump', 'soundDoubleJump', 'soundLand'] as const) {
    if (player[k] !== null && (typeof player[k] !== 'string' || !known.has(player[k]!))) player[k] = null;
  }
  settings.volume = typeof settings.volume === 'number' ? Math.min(1, Math.max(0, settings.volume)) : base.settings.volume;
  settings.renderScale = RENDER_SCALES.includes(settings.renderScale) ? settings.renderScale : base.settings.renderScale;
  const splash = normalizeSplash((r.settings as { splash?: unknown } | undefined)?.splash);
  if (splash) settings.splash = splash;
  else delete settings.splash;
  const exported = r.exported === true;
  const prefabs = exported ? [] : normalizePrefabs(r.prefabs);
  if (rawVersion < 7) dropRetiredProps(models, levels, prefabs, player);
  // a link to an asset that is gone is just forgotten
  const prefabIds = new Set(prefabs.map((p) => p.id));
  for (const l of levels) for (const o of l.objects) if (o.prefab && !prefabIds.has(o.prefab)) delete o.prefab;
  return { version: PROJECT_VERSION, settings, player, textures, models, variables, sounds, levels, prefabs, ...(exported ? { exported } : {}) };
}

/** The prefab list of a raw project: its own assets, and every built-in one (added when missing). */
export function normalizePrefabs(raw: unknown): Prefab[] {
  const out: Prefab[] = [];
  const seen = new Set<string>();
  const kinds = new Set<string>(PRESETS.map((p) => p.kind));
  for (const p of Array.isArray(raw) ? (raw as Partial<Prefab>[]) : []) {
    if (!p || typeof p.id !== 'string' || !p.id || seen.has(p.id) || !p.object || typeof p.object !== 'object') continue;
    const kind = (p.object as { kind?: unknown }).kind;
    if (kind !== 'block' && kind !== 'model') continue;
    seen.add(p.id);
    const object = normalizeObject(p.object as Partial<LevelObject>);
    object.position = [0, 0, 0];
    delete object.prefab;
    out.push({
      id: p.id,
      name: typeof p.name === 'string' && p.name.trim() ? p.name : object.name,
      base: typeof p.base === 'string' && kinds.has(p.base) ? (p.base as PresetKind) : null,
      object,
    });
  }
  for (const builtIn of builtInPrefabs(newId)) if (!seen.has(builtIn.id)) out.push(builtIn);
  return out;
}

/** Remove the retired prop models a project does not use anywhere (a placed one is the user's choice). */
function dropRetiredProps(models: Model[], levels: LevelData[], prefabs: Prefab[], player: PlayerSettings): void {
  const used = new Set<string>();
  for (const l of levels) for (const o of l.objects) if (o.kind === 'model') used.add(o.modelId);
  for (const p of prefabs) if (p.object.kind === 'model') used.add(p.object.modelId);
  if (player.modelId) used.add(player.modelId);
  for (const a of player.attachments) used.add(a.modelId);
  const retired = new Set(RETIRED_PROP_IDS);
  for (let i = models.length - 1; i >= 0; i--) {
    const id = models[i]!.id;
    if (retired.has(id) && !used.has(id)) models.splice(i, 1);
  }
}

/** The level list of a raw project: the new format, or the single `level` of older files. */
function normalizeLevels(raw: Partial<Project> & { level?: { objects?: unknown } }, spawn: Vec3, yaw: number, base: Project): LevelData[] {
  const seen = new Set<string>();
  const out: LevelData[] = [];
  if (Array.isArray(raw.levels)) {
    for (const l of raw.levels as Partial<LevelData>[]) {
      if (!l || typeof l !== 'object') continue;
      let id = typeof l.id === 'string' && l.id ? l.id : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      out.push({
        id,
        name: typeof l.name === 'string' && l.name.trim() ? l.name : `Level ${out.length + 1}`,
        objects: Array.isArray(l.objects) ? l.objects.map((o) => normalizeObject(o as Partial<LevelObject>)) : [],
        spawn: vec3(l.spawn, [0, 0.05, 0]),
        spawnYaw: typeof l.spawnYaw === 'number' && Number.isFinite(l.spawnYaw) ? l.spawnYaw : 180,
        sky: typeof l.sky === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.sky) ? l.sky : DEFAULT_SKY,
        look: normalizeLook(l.look),
      });
    }
  }
  if (out.length > 0) return out;
  if (Array.isArray(raw.level?.objects)) {
    return [createLevelData('Level 1', raw.level.objects.map((o) => normalizeObject(o as Partial<LevelObject>)), spawn, yaw)];
  }
  return base.levels;
}
