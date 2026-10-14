// Project data model. Everything the editor edits and the runtime plays is plain JSON described here,
// so a project file stays human-readable and hand-editable.

import { packRects } from './atlasPack';
import { HUMANOID_FEMALE_ID, HUMANOID_ID, HUMANOID_IDS, OLD_HUMANOID_SKINS, createHumanoidModel, refreshHumanoidLayout } from './humanoid';
import { LEGACY_MODEL_HASHES } from './legacyModels';
import { geometryHash } from './modelHash';
import { ITEM_MODEL_IDS, type ItemKind, createItemModel } from './items';
import { type Rule, type Variable, normalizeRules, normalizeVariables } from './logic';
import { PRESETS, type PresetKind, missingVariables, presetSounds, presetVariables } from './presets';
import { INSTANCE_OVERRIDES, PRESET_MODEL_ID, builtInComponent, builtInComponents, cloneRules, makeVariant, modelFromBlock } from './components';
import { type MenuScreen, normalizeMenu } from './menu';
import { type SplashScreen, normalizeSplash } from './splash';
import { type LevelLook, normalizeLook } from './look';
import { PROP_KINDS, type PropKind, RETIRED_PROP_IDS, createPropModel, propModelId } from './props';
import { SOUND_IDS, type SoundAsset, builtInSound, normalizeSounds } from './sounds';
import {
  FACE_KEYS,
  type FaceKey,
  type MeshData,
  boxMesh,
  cloneMesh,
  isValidMesh,
  meshSize,
  sanitizeFaceTile,
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
  /** Sounds (ids) played on a jump, a jump in mid-air, a landing and for every footstep; null = silent. */
  soundJump: string | null;
  soundDoubleJump: string | null;
  soundLand: string | null;
  soundStep: string | null;

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
  /** The menu screen of the exported game (logo, buttons). Left out: the plain one. */
  menu?: MenuScreen;
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

/** How the faces of a model take their picture from its texture. */
export type ModelMapping = 'uv' | 'tile';

/** What a tile-mapped model (and the tint of any model) looks like. */
export interface ModelLook {
  /** The tile of the model's texture that every face repeats, once per meter. Null: a plain color. */
  tile: { col: number; row: number } | null;
  /** Color the picture is multiplied with; '#ffffff' = none. */
  tint: string;
  /** 1 = solid; lower = see-through (glass, water). Tile-mapped models only. */
  opacity?: number;
  /** A body of water: the player swims in it. Tile-mapped models only. */
  liquid?: boolean;
  /** Drawn from both sides. Tile-mapped models only (a UV-mapped model is always drawn from both). */
  doubleSided: boolean;
}

/** What a placement of a model does until it says otherwise (see components.ts). */
export interface ModelDefaults {
  rules: Rule[];
  collide: boolean;
  animation: string | null;
  animationSpeed: number;
  /** The size a new placement starts at (the trophy is bigger than a coin). */
  scale?: Vec3;
}

/** A component placed inside another one (nested components). */
export interface ModelPart {
  id: string;
  name: string;
  /** The component placed here. It must use the same texture and mapping as the one that holds it. */
  modelId: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
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
  /**
   * A component (a master): it is placed from the Assets as linked instances that follow every change of it.
   * A model that is not one is an ordinary object that belongs to one place in the level.
   */
  component?: boolean;
  /** 'uv': every face has its own part of the texture (the default). 'tile': one tile repeated over every face. */
  mapping?: ModelMapping;
  look?: ModelLook;
  defaults?: ModelDefaults;
  /** A variant: its shapes, rig and animations are those of this component (its own look and behavior on top). */
  variantOf?: string;
  /** Components placed inside this one. */
  parts?: ModelPart[];
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
  /**
   * Of an instance of a component: the placement it was made from (purple, filled). Its shape can be edited in
   * place; the other instances only follow it.
   */
  master?: boolean;
  /** Which of `rules`, `collide` and `animation` this instance sets itself instead of following its component. */
  overrides?: InstanceOverride[];
  /** A color this instance is multiplied with, on top of its component's. */
  tint?: string;
}

/** What an instance of a component may set by itself instead of following the component. */
export type InstanceOverride = 'rules' | 'collide' | 'animation';

export type LevelObject = LevelBlock | LevelModelInstance;

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
    soundStep: SOUND_IDS.step,
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
    name: 'My Game',
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
    ...(model.component ? { component: true } : {}),
    ...(model.mapping ? { mapping: model.mapping } : {}),
    ...(model.look ? { look: structuredClone(model.look) } : {}),
    ...(model.defaults ? { defaults: { ...structuredClone(model.defaults), rules: cloneRules(model.defaults.rules, newId) } } : {}),
    ...(model.variantOf ? { variantOf: model.variantOf } : {}),
    ...(model.parts ? { parts: model.parts.map((p) => ({ ...structuredClone(p), id: newId() })) } : {}),
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
  const out: Model = {
    id: raw.id ?? newId(),
    name: raw.name ?? 'Model',
    texture: typeof raw.texture === 'string' ? raw.texture : null,
    cubes,
    bones,
    clips: Array.isArray(raw.clips) ? raw.clips.map((c) => normalizeClip(c)) : [],
  };
  if (raw.component === true) out.component = true;
  if (raw.mapping === 'tile') out.mapping = 'tile';
  const look = normalizeLookOfModel(raw.look);
  if (look) out.look = look;
  const defaults = normalizeDefaultsOfModel(raw.defaults);
  if (defaults) out.defaults = defaults;
  if (typeof raw.variantOf === 'string' && raw.variantOf) out.variantOf = raw.variantOf;
  const parts = normalizePartsOfModel(raw.parts);
  if (parts.length > 0) out.parts = parts;
  return out;
}

function normalizeLookOfModel(raw: unknown): ModelLook | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Partial<ModelLook>;
  const tile =
    l.tile && typeof l.tile.col === 'number' && typeof l.tile.row === 'number'
      ? { col: Math.max(0, Math.floor(l.tile.col)), row: Math.max(0, Math.floor(l.tile.row)) }
      : null;
  return {
    tile,
    tint: typeof l.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.tint) ? l.tint : '#ffffff',
    ...(typeof l.opacity === 'number' && l.opacity < 1 ? { opacity: Math.max(0.05, l.opacity) } : {}),
    ...(l.liquid === true ? { liquid: true } : {}),
    doubleSided: l.doubleSided !== false,
  };
}

function normalizeDefaultsOfModel(raw: unknown): ModelDefaults | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<ModelDefaults>;
  return {
    rules: normalizeRules(d.rules, newId),
    collide: d.collide !== false,
    animation: typeof d.animation === 'string' && d.animation ? d.animation : null,
    animationSpeed: typeof d.animationSpeed === 'number' && d.animationSpeed > 0 ? d.animationSpeed : 1,
    ...(Array.isArray(d.scale) ? { scale: vec3(d.scale, [1, 1, 1]) } : {}),
  };
}

function normalizePartsOfModel(raw: unknown): ModelPart[] {
  if (!Array.isArray(raw)) return [];
  const out: ModelPart[] = [];
  const seen = new Set<string>();
  for (const p of raw as Partial<ModelPart>[]) {
    if (!p || typeof p.modelId !== 'string' || !p.modelId) continue;
    let id = typeof p.id === 'string' && p.id ? p.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    out.push({
      id,
      name: typeof p.name === 'string' && p.name ? p.name : 'Part',
      modelId: p.modelId,
      position: vec3(p.position, [0, 0, 0]),
      rotation: vec3(p.rotation, [0, 0, 0]),
      scale: vec3(p.scale, [1, 1, 1]),
    });
  }
  return out;
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

/**
 * 2: the player is the built-in humanoid by default. 3: the humanoid's skin has its own layout.
 * 4: the player is 1.8 m tall by default. 5: a project has a list of levels, each with its own spawn.
 * 6: the built-in prop models (furniture, gems, plants, ...) are in every project. 7: the trees and ore
 * blocks of the first prop set were taken out again. 8: the building kit and the modeled trees are in
 * every project. 9: the Slime and Villager models, and a glide pose for the humanoid. 10: the models that
 * come as files (assets/models) are in every project. 11: the humanoid was rebuilt (new parts, bone names and skins).
 * (Of all the models of versions 6 to 10 only the Slime and the Villager are still built in: a new project
 * is blank, and the props, the kit and the models of files are not added to older projects any more.)
 * 12: the humanoid has no nose and its hair is a part of its own; there is a female build as well.
 * 13: the characters got a smaller, squarer head (a new layout, so the skins changed too).
 * 14: the built-in models were redrawn as cubes and quads only (the Hytale modeling guide); the characters too.
 * 15: a new project is blank; the pickups (coin, key, apple, flag, trophy) are in Models next to the characters.
 * 16: the player has a footstep sound; the built-in one is added to older projects.
 * 17: game objects are components (see components.ts): the assets (prefabs) became models, with a behavior of their own.
 */
export const PROJECT_VERSION = 17;

export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    settings: defaultSettings(),
    player: defaultPlayer(),
    textures: [],
    // the two characters and the built-in game objects as components (coin, key, apple, checkpoint, goal, Slime,
    // Villager, door, hazard, exit, moving platform, sign, water): the pieces to build a game from, to look at and edit
    models: [
      { ...createHumanoidModel(newId), component: true },
      { ...createHumanoidModel(newId, HUMANOID_FEMALE_ID), component: true },
      ...builtInComponents(newId),
    ],
    variables: [],
    sounds: Object.values(SOUND_IDS)
      .map((id) => builtInSound(id))
      .filter((s): s is SoundAsset => s !== null),
    levels: [createLevelData('Level 1', emptyLevelObjects())],
  };
}

/**
 * A fresh copy of a built-in model by its id (the humanoids, a pickup, the Slime or the Villager), or null when
 * there is no such model. For previews of game objects whose model is not in the project yet.
 */
export function builtInModelById(id: string): Model | null {
  if (HUMANOID_IDS.includes(id)) return createHumanoidModel(newId, id);
  const preset = PRESETS.find((p) => PRESET_MODEL_ID[p.kind] === id);
  if (preset) return builtInComponent(preset.kind, newId);
  for (const kind of Object.keys(ITEM_MODEL_IDS) as ItemKind[]) {
    if (ITEM_MODEL_IDS[kind] === id) return createItemModel(kind, newId);
  }
  const prop = PROP_KINDS.find((k) => propModelId(k) === id);
  if (prop) return createPropModel(prop as PropKind, newId);
  return null;
}

export function createLevelData(name: string, objects: LevelObject[], spawn: Vec3 = [0, 0.05, 0], spawnYaw = 180, sky = DEFAULT_SKY): LevelData {
  return { id: newId(), name, objects, spawn: [...spawn], spawnYaw, sky, look: normalizeLook(null) };
}

/** A new empty level: just a flat ground to stand on, and nothing else. */
export function emptyLevelObjects(): LevelObject[] {
  return [block('Ground', [0, -0.5, 0], [30, 1, 30], [3, 16])];
}

/** Make sure the project has the variables and the sounds the rules of a preset use. */
export function ensurePresetSupport(project: Project, kind: PresetKind): void {
  project.variables.push(...missingVariables(project.variables, presetVariables(kind), newId));
  for (const id of presetSounds(kind)) {
    const sound = builtInSound(id);
    if (sound && !project.sounds.some((s) => s.id === id)) project.sounds.push(sound);
  }
}

/**
 * Make sure the project has what a built-in game object needs: its variables, its sounds and its component (the
 * model it is made of, with its default behavior). Returns the id of that model.
 */
export function ensurePresetAssets(project: Project, kind: PresetKind): string {
  ensurePresetSupport(project, kind);
  const id = PRESET_MODEL_ID[kind];
  if (!project.models.some((m) => m.id === id)) project.models.push(builtInComponent(kind, newId));
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
      ...(m.master === true ? { master: true } : {}),
      ...(Array.isArray(m.overrides) && m.overrides.some((k) => INSTANCE_OVERRIDES.includes(k))
        ? { overrides: INSTANCE_OVERRIDES.filter((k) => (m.overrides as string[]).includes(k)) }
        : {}),
      ...(typeof m.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.tint) && m.tint.toLowerCase() !== '#ffffff' ? { tint: m.tint } : {}),
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
  // versions 11 to 14: the humanoid was rebuilt from scratch (other parts, bone names, skins; then no nose and the hair as
  // parts of its own; then a smaller head; then plain cubes): a saved one is replaced by the current one, and the
  // female build is added
  if (rawVersion < 14) {
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
  // version 14: the built-in models were redrawn as cubes and quads only. A saved copy
  // that is still exactly the old built-in one (same shapes, same texture) is replaced; one the user changed stays.
  if (rawVersion < 14) {
    for (let i = 0; i < models.length; i++) {
      const saved = models[i]!;
      const was = LEGACY_MODEL_HASHES[saved.id];
      if (!was || geometryHash(saved) !== was) continue;
      const fresh = builtInModelById(saved.id);
      // only a model that was really redrawn is swapped (a built-in one that did not change is left as it is)
      if (!fresh || fresh.texture !== saved.texture || geometryHash(fresh) === was) continue;
      fresh.name = saved.name;
      models[i] = fresh;
    }
  }
  // the player grew to 1.8 m: take over the new body size where the old default was never changed
  if (rawVersion < 4) {
    if (player.height === 1) player.height = base.player.height;
    if (player.width === 0.5) player.width = base.player.width;
    if (player.crouchHeight === 0.65) player.crouchHeight = base.player.crouchHeight;
    if (player.cameraDistance === 4.5) player.cameraDistance = base.player.cameraDistance;
  }

  // version 15: the pickups that the game objects are made of are in Models (an exported game has only what it uses)
  if (rawVersion < 15 && r.exported !== true) {
    const have = new Set(models.map((m) => m.id));
    for (const kind of Object.keys(ITEM_MODEL_IDS) as ItemKind[]) {
      if (!have.has(ITEM_MODEL_IDS[kind])) models.push(createItemModel(kind, newId));
    }
  }

  // version 9: the characters of the prop set, and a gliding pose for the built-in humanoid. (The props, the
  // building kit and the models of files that older versions put in every project are not added any more.)
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
  // version 16: the footstep sound that the player uses by default (a project without sounds, and an exported game
  // that has only what it uses, are left as they are)
  if (rawVersion < 16 && r.exported !== true && sounds.length > 0 && !sounds.some((s) => s.id === SOUND_IDS.step)) {
    const step = builtInSound(SOUND_IDS.step);
    if (step) sounds.push(step);
  }
  const known = new Set(sounds.map((s) => s.id));
  // a reference to a sound that does not exist is just silence
  if (settings.music !== null && (typeof settings.music !== 'string' || !known.has(settings.music))) settings.music = null;
  for (const k of ['soundJump', 'soundDoubleJump', 'soundLand', 'soundStep'] as const) {
    if (player[k] !== null && (typeof player[k] !== 'string' || !known.has(player[k]!))) player[k] = null;
  }
  settings.volume = typeof settings.volume === 'number' ? Math.min(1, Math.max(0, settings.volume)) : base.settings.volume;
  settings.renderScale = RENDER_SCALES.includes(settings.renderScale) ? settings.renderScale : base.settings.renderScale;
  const splash = normalizeSplash((r.settings as { splash?: unknown } | undefined)?.splash);
  if (splash) settings.splash = splash;
  else delete settings.splash;
  const menu = normalizeMenu((r.settings as { menu?: unknown } | undefined)?.menu);
  if (menu) settings.menu = menu;
  else delete settings.menu;
  const exported = r.exported === true;
  if (rawVersion < 7) dropRetiredProps(models, levels, player);
  // version 17: the game objects (assets) are components, and a model that is placed is one too
  if (rawVersion < 17 && !exported) migrateToComponents((r as { prefabs?: unknown }).prefabs, models, levels);
  return { version: PROJECT_VERSION, settings, player, textures, models, variables, sounds, levels, ...(exported ? { exported } : {}) };
}

/**
 * Projects before version 17 kept game objects as assets (prefabs), apart from the models. Now both are components:
 * a model asset becomes a variant of its model (the built-in ones set the behavior of the model itself), a block
 * asset a one-shape component, and every model that is placed or built in a component. Objects that were placed
 * keep what they have: nothing in a level changes.
 */
function migrateToComponents(rawPrefabs: unknown, models: Model[], levels: LevelData[]): void {
  const kinds = new Set<string>(PRESETS.map((p) => p.kind));
  const find = (id: string) => models.find((m) => m.id === id);
  for (const p of Array.isArray(rawPrefabs) ? (rawPrefabs as { id?: unknown; name?: unknown; base?: unknown; object?: unknown }[]) : []) {
    if (!p || typeof p.id !== 'string' || !p.object || typeof p.object !== 'object') continue;
    const kind = (p.object as { kind?: unknown }).kind;
    if (kind !== 'block' && kind !== 'model') continue;
    const object = normalizeObject(p.object as Partial<LevelObject>);
    const base = typeof p.base === 'string' && kinds.has(p.base) ? (p.base as PresetKind) : null;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name : object.name;
    if (object.kind === 'block') {
      const id = base ? PRESET_MODEL_ID[base] : newId();
      if (find(id)) continue;
      const m = modelFromBlock(object, newId, id);
      m.name = name;
      models.push(m);
      continue;
    }
    const model = find(object.modelId);
    const defaults: ModelDefaults = {
      rules: cloneRules(object.rules, newId),
      collide: object.collide,
      animation: object.animation,
      animationSpeed: object.animationSpeed,
      ...(object.scale.some((n) => n !== 1) ? { scale: [...object.scale] as Vec3 } : {}),
    };
    if (base && PRESET_MODEL_ID[base] === object.modelId) {
      // a built-in game object: what it was changed to is the behavior of its model now
      const target = model ?? builtInComponent(base, newId);
      if (!model) models.push(target);
      target.component = true;
      target.defaults = defaults;
    } else if (model) {
      const v = makeVariant(model, newId, name);
      v.defaults = defaults;
      models.push(v);
    }
  }
  // the built-in game objects that are still missing
  for (const preset of PRESETS) {
    if (!find(PRESET_MODEL_ID[preset.kind])) models.push(builtInComponent(preset.kind, newId));
  }
  // a model that is placed (or is one of the characters) is a master; its instances keep their own behavior
  const placed = new Set<string>();
  for (const l of levels) {
    for (const o of l.objects) {
      if (o.kind !== 'model') continue;
      placed.add(o.modelId);
      o.overrides = [...INSTANCE_OVERRIDES];
    }
  }
  for (const m of models) if (placed.has(m.id) || HUMANOID_IDS.includes(m.id)) m.component = true;
}

/** Remove the retired prop models a project does not use anywhere (a placed one is the user's choice). */
function dropRetiredProps(models: Model[], levels: LevelData[], player: PlayerSettings): void {
  const used = new Set<string>();
  for (const l of levels) for (const o of l.objects) if (o.kind === 'model') used.add(o.modelId);
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
