// The two projects of the start dialog.
//
// "Blank" is an empty level to start from. "Mossy Hills" is a small game made with everything the editor offers: two
// levels, a terrain valley with a pond and a village, floating ruins above the clouds, collectible star crystals,
// enemies, a villager who talks (with a voice), moving platforms, a spring mushroom, spikes, a key and a locked door,
// a checkpoint, water, a splash screen, the calm theme, a skin for the player and a sky and fog for each level.
// It is made of the same data as any project: open it, change it, learn from it.
//
// Level 1 teaches the controls and asks for three star crystals to open the old gate.
// Level 2 is harder: moving platforms, jumps that need a run and a double jump, a bounce, a glide, a key.

import { instantiatePrefab } from './prefabs';
import { type Action, type Condition, type Rule, type RuleEvent, type Variable } from './logic';
import { SKY_PRESETS } from './look';
import { type MeshData, assignRect, boxMesh, fixWinding, mulberry32 } from './mesh';
import { cylinderMesh } from './meshGen';
import { SOUND_IDS } from './sounds';
import { DEFAULT_SPLASH_SECONDS } from './splash';
import { type TerrainInfo, generateHills, terrainHeightAt, terrainMesh } from './terrain';
import {
  type LevelBlock,
  type LevelModelInstance,
  type LevelObject,
  type Model,
  type PlayerSettings,
  type Project,
  type TileRef,
  type Vec3,
  createBlock,
  createDefaultProject,
  createLevelData,
  createModelInstance,
  defaultPlayer,
  emptyLevelObjects,
  newId,
} from './types';
import { DEMO_SPLASH_IMAGE } from './demoAssets';
import { HUMANOID_EXPLORER, HUMANOID_IDS } from './humanoid';
import { type PresetKind, presetRules } from './presets';
import { kitModelId } from './kit';
import { propModelId } from './props';

// ---------------------------------------------------------------- blank

/**
 * An empty project: one flat ground and the player on it. The game objects (coin, door, slime ...) and the
 * variables they use are there, and so are their models (to edit them) and the two characters; the rest of the
 * props and the building kit is added when something that needs one is placed, so the Models list stays short.
 */
export function createBlankProject(): Project {
  const p = createDefaultProject();
  p.settings.name = 'My Game';
  // the two characters, and the models the game objects are made of: a game object's model has to be there to be edited
  const needed = new Set<string>(HUMANOID_IDS);
  for (const prefab of p.prefabs) if (prefab.object.kind === 'model') needed.add(prefab.object.modelId);
  p.models = p.models.filter((m) => needed.has(m.id));
  p.levels = [createLevelData('Level 1', emptyLevelObjects(), [0, 0.05, 0], 180)];
  return p;
}

// ---------------------------------------------------------------- the demo: tiles and small helpers

const MAIN = 'Textures-16.png';
const DEMO = 'Demo-16.png';
const tile = (col: number, row: number, texture = MAIN): TileRef => ({ texture, col, row });
const T = {
  grass: tile(3, 16),
  grassDark: tile(2, 16),
  dirt: tile(3, 6),
  sand: tile(1, 6),
  rock: tile(3, 2),
  mossBrick: tile(3, 4),
  brick: tile(1, 4),
  cobble: tile(8, 0),
  wood: tile(3, 13),
  portal: tile(11, 10),
  ruin: tile(4, 0, DEMO),
  ruinRune: tile(5, 0, DEMO),
  moss: tile(0, 1, DEMO),
};

/** The hero skin of the demo (a texture in assets/textures). */
export const HERO_SKIN = HUMANOID_EXPLORER;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rule(event: RuleEvent, actions: Action[], conditions: Condition[] = [], extra: Partial<Rule> = {}): Rule {
  return { id: newId(), event, conditions, actions, ...extra };
}

/** Variables the demo uses, shown on the screen. */
function demoVariables(): Variable[] {
  const v = (name: string, initial: number, max: number | null, icon: string, label: string): Variable => ({
    id: newId(),
    name,
    initial,
    min: 0,
    max,
    hud: true,
    icon,
    label,
  });
  return [v('coins', 0, null, '🪙', 'Coins'), v('stars', 0, null, '⭐', 'Stars'), v('keys', 0, null, '🔑', 'Keys'), v('health', 3, 3, '❤', 'Health')];
}

/** Size of a model from its cubes (rotations and bone poses ignored): the foot is at y = min. */
function boundsOf(model: Model): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const c of model.cubes) {
    for (const v of c.mesh.verts) {
      for (let i = 0; i < 3; i++) {
        const w = v[i]! + c.position[i]!;
        min[i] = Math.min(min[i]!, w);
        max[i] = Math.max(max[i]!, w);
      }
    }
  }
  return { min, max };
}

class Scene {
  readonly objects: LevelObject[] = [];
  constructor(private project: Project) {}

  private modelOf(id: string): Model {
    const m = this.project.models.find((x) => x.id === id);
    if (!m) throw new Error(`demo: the model "${id}" is missing`);
    return m;
  }

  size(modelId: string): Vec3 {
    const b = boundsOf(this.modelOf(modelId));
    return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  }

  add<T extends LevelObject>(obj: T): T {
    this.objects.push(obj);
    return obj;
  }

  /** A model of the project placed with its feet at `at`. */
  model(
    modelId: string,
    at: Vec3,
    opts: { name?: string; rot?: number; scale?: number; collide?: boolean; animation?: string | null; rules?: Rule[] } = {},
  ): LevelModelInstance {
    const inst = createModelInstance(this.modelOf(modelId), [at[0], at[1], at[2]]);
    if (opts.name) inst.name = opts.name;
    if (opts.rot) inst.rotation = [0, opts.rot, 0];
    if (opts.scale) inst.scale = [opts.scale, opts.scale, opts.scale];
    inst.collide = opts.collide ?? false;
    inst.animation = opts.animation ?? null;
    if (opts.rules) inst.rules = opts.rules;
    return this.add(inst);
  }

  /** A game object asset placed on the point `at`. */
  prefab(kind: PresetKind, at: Vec3, over: Partial<LevelObject> = {}): LevelObject {
    const prefab = this.project.prefabs.find((p) => p.base === kind);
    if (!prefab) throw new Error(`demo: no game object "${kind}"`);
    const obj = instantiatePrefab(prefab, at, newId);
    Object.assign(obj, over);
    return this.add(obj);
  }

  /** A block with its own mesh, centered on `position`. */
  block(name: string, position: Vec3, mesh: MeshData, tileRef: TileRef | null, over: Partial<LevelBlock> = {}): LevelBlock {
    const b = createBlock(name, [position[0], position[1], position[2]], mesh, tileRef);
    Object.assign(b, over);
    return this.add(b);
  }
}

/** Index of the top face of the shapes made by boxMesh ('py') and cylinderMesh (the second cap). */
const BOX_TOP = 4;
const CYLINDER_TOP = 1;

/** A flat slab with a top of another tile. */
function slab(s: Scene, name: string, center: [number, number], topY: number, size: [number, number, number], topTile: TileRef, sideTile: TileRef, rot = 0): LevelBlock {
  const mesh = boxMesh(size);
  mesh.faces[BOX_TOP]!.tile = { ...topTile };
  return s.block(name, [center[0], topY - size[1] / 2, center[1]], mesh, sideTile, { rotation: [0, rot, 0] });
}

/** A round standing stone that gets narrower toward the bottom, a little irregular. */
function pillar(s: Scene, name: string, center: [number, number], topY: number, radius: number, height: number, seed: number, topTile: TileRef, sideTile: TileRef): LevelBlock {
  const mesh = cylinderMesh(9, radius * 0.55, radius, height);
  const rnd = mulberry32(seed);
  for (const v of mesh.verts) {
    const k = 1 + (rnd() - 0.5) * 0.18;
    v[0] *= k;
    v[2] *= k;
  }
  mesh.faces[CYLINDER_TOP]!.tile = { ...topTile };
  return s.block(name, [center[0], topY - height / 2, center[1]], mesh, sideTile);
}

/**
 * A floating island: a flat irregular top that narrows into a rocky point. Faces[0] is the top (walkable, flat at
 * y = 0 in its own space); the block's origin is the top.
 */
function islandMesh(radius: number, depth: number, sides: number, seed: number): MeshData {
  const rnd = mulberry32(seed);
  const verts: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const r = radius * (0.88 + rnd() * 0.24);
    verts.push([Math.cos(a) * r, 0, Math.sin(a) * r]);
  }
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = radius * (0.5 + rnd() * 0.24);
    verts.push([Math.cos(a) * r, -depth * (0.3 + rnd() * 0.2), Math.sin(a) * r]);
  }
  verts.push([(rnd() - 0.5) * radius * 0.3, -depth, (rnd() - 0.5) * radius * 0.3]);
  const apex = verts.length - 1;
  const faces: MeshData['faces'] = [{ v: Array.from({ length: sides }, (_, i) => i), uv: [] }];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push({ v: [i, j, sides + j, sides + i], uv: [] });
    faces.push({ v: [sides + i, sides + j, apex], uv: [] });
  }
  const m: MeshData = { verts, faces };
  fixWinding(m);
  assignRect(m, faces.map((_, i) => i), { x: 0, y: 0, w: 16, h: 16 });
  return m;
}

function island(s: Scene, name: string, center: [number, number], topY: number, radius: number, depth: number, seed: number): LevelBlock {
  const mesh = islandMesh(radius, depth, 10, seed);
  mesh.faces[0]!.tile = { ...T.grass };
  return s.block(name, [center[0], topY, center[1]], mesh, T.rock);
}

// ---------------------------------------------------------------- actions used again and again

const SND = SOUND_IDS;
const say = (text: string, seconds = 3): Action => ({ type: 'message', text, seconds });
const sound = (id: string): Action => ({ type: 'sound', sound: id });

function starRules(total: string): Rule[] {
  return [
    rule('touch', [
      { type: 'add', variable: 'stars', value: 1 },
      sound(SND.powerup),
      say(`Star crystal! ${total}`, 2.2),
      { type: 'destroy' },
    ]),
  ];
}

// ---------------------------------------------------------------- level 1: the meadow

const L1_PATH: [number, number][] = [
  [0, 22],
  [0, 15],
  [-4, 8],
  [-8, 2],
  [-9, -6],
  [-5, -14],
  [-1, -22],
  [0, -29],
];
const L1 = {
  spawn: [0, 22] as [number, number],
  village: [-8, 2] as [number, number],
  pond: [17, 4] as [number, number],
  hill: [-22, -20] as [number, number],
  gate: [0, -31] as [number, number],
  tower: [-17, -4] as [number, number],
};

function distToPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < L1_PATH.length - 1; i++) {
    const [ax, az] = L1_PATH[i]!;
    const [bx, bz] = L1_PATH[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

const dist2 = (x: number, z: number, c: [number, number]) => Math.hypot(x - c[0], z - c[1]);

/** The shape of the valley: rolling hills, flat ground along the path and in the village, a pond, a big hill, a rim. */
function valleyHeight(x: number, z: number, noise: number): number {
  let h = noise * 0.55;
  h = lerp(h, 0.3, 1 - smooth(1.5, 6, distToPath(x, z)));
  h = lerp(h, 0.25, 1 - smooth(6, 11, dist2(x, z, L1.village)));
  h = lerp(h, 0.5, 1 - smooth(4, 8, dist2(x, z, L1.spawn)));
  // the big hill and the pond
  h += 8 * Math.pow(Math.max(0, 1 - dist2(x, z, L1.hill) / 15), 1.35);
  h -= 2.3 * (1 - smooth(0, 7.5, dist2(x, z, L1.pond)));
  // a steep rim all around keeps the player inside the valley
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += 10 * smooth(27, 34, edge);
  // a calm shelf in front of the gate
  h = lerp(h, 1, 1 - smooth(4, 8, dist2(x, z, L1.gate)));
  return Math.round(h * 100) / 100;
}

function buildMeadow(project: Project): ReturnType<typeof createLevelData> {
  const s = new Scene(project);
  const rnd = mulberry32(2024);

  // ---- the terrain
  const info: TerrainInfo = { cols: 72, rows: 72, cell: 1 };
  const mesh = terrainMesh(info);
  generateHills(mesh, { seed: 4, height: 3.2, scale: 15 });
  for (const v of mesh.verts) v[1] = valleyHeight(v[0], v[2], v[1]);
  // paint it: a dirt path, sand around the pond, bare rock where it is steep
  mesh.faces.forEach((f) => {
    let cx = 0;
    let cz = 0;
    let cy = 0;
    for (const vi of f.v) {
      cx += mesh.verts[vi]![0];
      cy += mesh.verts[vi]![1];
      cz += mesh.verts[vi]![2];
    }
    cx /= f.v.length;
    cy /= f.v.length;
    cz /= f.v.length;
    if (distToPath(cx, cz) < 1.3) f.tile = { ...T.dirt };
    else if (dist2(cx, cz, L1.pond) < 9.5 && cy < 0.35) f.tile = { ...T.sand };
    else if (cy > 6.2) f.tile = { ...T.rock };
    else if ((Math.floor(cx * 0.37) + Math.floor(cz * 0.41)) % 5 === 0) f.tile = { ...T.grassDark };
  });
  const terrain = s.block('Valley', [0, 0, 0], mesh, T.grass, { terrain: info, smooth: true });
  const groundAt = (x: number, z: number) => terrainHeightAt(terrain.mesh, info, x, z) ?? 0;
  const at = (x: number, z: number, lift = 0): Vec3 => [x, groundAt(x, z) + lift, z];

  // ---- the pond: water you can swim in, an island with a star, and a platform that carries you over
  const pond = L1.pond;
  s.block('Pond', [pond[0], 0.45 - 1, pond[1]], boxMesh([15, 2, 15]), tile(2, 4, 'Kit-16.png'), { collide: false, opacity: 0.72, liquid: true });
  // a rocky islet that stands out of the water (the surface is at y = 0.45), with a star on it
  const waterTop = 0.45;
  const isletTop = waterTop + 0.5;
  const islet = s.block('Islet', [pond[0] + 0.5, isletTop - 1.1, pond[1]], cylinderMesh(8, 1.6, 1.0, 2.2), T.grass);
  islet.mesh.faces[CYLINDER_TOP]!.tile = { ...T.grass };
  s.model('demo-star-crystal', [pond[0] + 0.5, isletTop + 0.2, pond[1]], { name: 'Star crystal (pond)', animation: 'spin', rules: starRules('{stars} / 3') });
  // a platform that goes from the shore toward the islet and back
  const lily = s.prefab('platform', [pond[0] - 7.2, waterTop - 0.25, pond[1]], {
    name: 'Lily platform',
    rules: [rule('start', [{ type: 'patrol', target: '', offset: [6, 0, 0], seconds: 5 }])],
  });
  if (lily.kind === 'block') lily.color = '#9fe28a';

  // ---- the village
  const [vx, vz] = L1.village;
  const houseSize = s.size(kitModelId('house'));
  s.model(kitModelId('house'), at(vx - 7.5, vz - 5), { name: 'House', rot: 90, collide: true });
  s.model(kitModelId('house'), at(vx + 6.5, vz - 7.5), { name: 'House', rot: -90, collide: true, scale: 0.9 });
  s.model(kitModelId('windmill'), at(vx - 11, vz + 7), { name: 'Windmill', collide: true });
  s.model(propModelId('well'), at(vx + 1.5, vz + 3.5), { name: 'Well', collide: true });
  s.model(propModelId('bench'), at(vx + 3.5, vz - 1.2), { name: 'Bench', rot: 90 });
  s.model(propModelId('barrel'), at(vx - 2.2, vz - 3.4), { name: 'Barrel', collide: true });
  s.model(propModelId('crate'), at(vx - 3.1, vz - 3.2), { name: 'Crate', collide: true });
  s.model(propModelId('lamp-post'), at(vx + 4.5, vz + 1.8), { name: 'Lamp post' });
  s.model(propModelId('signpost'), at(1.5, 12.5), { name: 'Signpost', rot: -20 });
  for (let i = 0; i < 10; i++) s.model(kitModelId('wood-fence'), at(vx - 4.5 + i * 0.9, vz + 10.5), { name: 'Fence', scale: 0.9 });
  void houseSize;

  // ---- the villager, who asks for three stars and answers questions
  const npc = s.prefab('npc', at(vx, vz + 1), { name: 'Old Moss', rotation: [0, 160, 0] });
  const voice = { voice: SND.talkDeep, pitch: 0.82 };
  npc.rules = [
    rule(
      'interact',
      [
        {
          type: 'choice',
          speaker: 'Old Moss',
          question: 'Well, a visitor in Mossy Hills! The old gate in the north is asleep. Three star crystals would wake it up. Can I help you?',
          ...voice,
          options: [
            {
              label: 'Where are the stars?',
              actions: [
                {
                  type: 'dialogue',
                  speaker: 'Old Moss',
                  lines: [
                    'One shines on a little island in the pond. Swim, or ride the green platform.',
                    'One waits at the top of the big hill, past the slimes.',
                    'And one sits on the ruin tower west of here. Jump from stone to stone!',
                  ],
                  ...voice,
                },
              ],
            },
            {
              label: 'How do I jump?',
              actions: [
                {
                  type: 'dialogue',
                  speaker: 'Old Moss',
                  lines: ['Press Space. Press it again in the air for a second jump.', 'Hold Shift to run. And jump on a slime to squash it!'],
                  ...voice,
                },
              ],
            },
            { label: 'I am fine, thanks.', actions: [say('Good luck, traveler!', 2)] },
          ],
        },
      ],
      [{ variable: 'stars', op: '<', value: 3 }],
    ),
    rule(
      'interact',
      [{ type: 'dialogue', speaker: 'Old Moss', lines: ['You found all three! The gate is awake.', 'Go north, past the path. The next ruins are harder, so take care.'], ...voice }],
      [{ variable: 'stars', op: '>=', value: 3 }],
    ),
  ];

  // ---- the player's start, with a sign that explains the controls
  const sign = s.prefab('sign', at(2.8, 19.5), { name: 'Sign' });
  sign.rules = [
    rule('start', [say('Find 3 star crystals to wake the old gate in the north!', 5)]),
    rule('interact', [say('Move: W A S D · Jump: Space (twice in the air) · Run: Shift · Talk and read: E', 6)]),
    rule('when', [say('Ten coins! The villagers will call you rich.', 3)], [{ variable: 'coins', op: '>=', value: 10 }]),
  ];

  // ---- checkpoint near the village
  s.prefab('checkpoint', at(-1.5, 6.5), { name: 'Checkpoint' });

  // ---- slimes: one on the road to the hill, one in the meadow
  s.prefab('enemy', at(-17, -9), { name: 'Slime' });
  s.prefab('enemy', at(-19, -14), { name: 'Slime' });
  s.prefab('enemy', at(9, 15), { name: 'Slime' });

  // ---- the hill: a star on top, a bounce mushroom at its foot to reach a ledge of coins
  const [hx, hz] = L1.hill;
  s.model('demo-star-crystal', at(hx - 1, hz - 1, 0.35), { name: 'Star crystal (hill)', animation: 'spin', rules: starRules('{stars} / 3') });
  s.model('demo-crystal-cluster', at(hx + 1.6, hz + 0.5), { name: 'Crystals', scale: 1.1 });
  s.model(kitModelId('ring-stone'), at(hx + 3.5, hz + 2.5), { name: 'Ring stone', scale: 1.0 });

  // ---- the ruin tower: stone to stone up to a star
  const [tx, tz] = L1.tower;
  const g = groundAt(tx, tz);
  slab(s, 'Ruin step 1', [tx, tz], g + 1.0, [2.6, 0.5, 2.6], T.moss, T.mossBrick);
  slab(s, 'Ruin step 2', [tx - 3, tz - 2], g + 2.0, [2.4, 0.5, 2.4], T.moss, T.mossBrick, 12);
  slab(s, 'Ruin step 3', [tx, tz - 4.2], g + 3.0, [2.4, 0.5, 2.4], T.moss, T.mossBrick, -10);
  slab(s, 'Ruin step 4', [tx - 3.2, tz - 6.4], g + 4.0, [3, 0.5, 3], T.moss, T.mossBrick, 8);
  s.model('demo-ruin-column', at(tx + 2.8, tz - 3), { name: 'Ruin column', scale: 1.1, collide: false });
  s.model('demo-star-crystal', [tx - 3.2, g + 4.25 + 0.2, tz - 6.4], { name: 'Star crystal (tower)', animation: 'spin', rules: starRules('{stars} / 3') });
  s.prefab('apple', [tx, g + 1.25, tz]);

  // ---- a spring mushroom on the meadow to bounce up to a ledge with coins
  const [mx, mz] = [10, -10];
  s.model(kitModelId('big-mushroom'), at(mx, mz), {
    name: 'Spring mushroom',
    collide: false,
    scale: 1.3,
    rules: [rule('touch', [{ type: 'bounce', strength: 17 }, sound(SND.jump2)])],
  });
  const ledgeY = groundAt(mx + 3, mz - 6) + 3.4;
  slab(s, 'Coin ledge', [mx + 3, mz - 6], ledgeY, [4, 0.6, 4], T.grass, T.dirt);
  for (let i = 0; i < 4; i++) s.prefab('coin', [mx + 1.8 + i * 0.8, ledgeY + 0.6, mz - 6 + (i % 2) * 0.6]);

  // ---- coins along the path and around
  const pathCoins: [number, number][] = [
    [0, 19], [0, 17], [0, 15], [-1.5, 11], [-3, 9], [-5.5, 5.5], [-8, -2], [-9, -4], [-8, -9], [-6.5, -12], [-3.5, -17], [-1.5, -21], [-0.4, -25],
  ];
  for (const [x, z] of pathCoins) s.prefab('coin', at(x, z, 0.9));
  for (let i = 0; i < 5; i++) s.prefab('coin', at(pond[0] - 8 + i * 1.5, pond[1] - 7.5 + i * 0.9, 0.9));
  s.prefab('coin', at(hx + 6, hz + 9, 0.9));
  s.prefab('coin', at(hx + 9, hz + 6, 0.9));

  // ---- the old gate: an arch in the wall of the valley, a stone door that wakes up with three stars, and a portal
  const [gx, gz] = L1.gate;
  const gy = groundAt(gx, gz);
  s.model(kitModelId('archway'), [gx, gy, gz], { name: 'Old arch', collide: true, scale: 1.4 });
  s.block('Portal', [gx, gy + 1.5, gz - 0.9], boxMesh([2.2, 3, 0.2]), T.portal, { collide: false, opacity: 0.85, rules: [rule('touch', [sound(SND.checkpoint), { type: 'level', level: '' }])] });
  const gate = s.block('Old gate', [gx, gy + 1.6, gz + 0.1], boxMesh([2.6, 3.2, 0.5]), T.mossBrick, {
    name: 'Old gate',
    rules: [
      rule('when', [sound(SND.door), say('The old gate wakes up!', 3), { type: 'move', target: '', offset: [0, 4.2, 0], seconds: 2.5 }], [{ variable: 'stars', op: '>=', value: 3 }]),
      rule('touch', [say('The gate sleeps. It needs three star crystals.', 3)], [{ variable: 'stars', op: '<', value: 3 }]),
    ],
  });
  void gate;
  s.model('demo-crystal-cluster', at(gx - 3.2, gz + 4), { name: 'Crystals', scale: 0.9 });
  s.model(propModelId('torch'), at(gx - 2.4, gz + 1.5), { name: 'Torch' });
  s.model(propModelId('torch'), at(gx + 2.4, gz + 1.5), { name: 'Torch' });

  // ---- nature: trees, bushes, flowers and stones, kept off the path, the village, the pond and the gate
  const free = (x: number, z: number, margin = 0) => {
    const h = groundAt(x, z);
    return (
      h > 0.05 &&
      h < 4.2 &&
      distToPath(x, z) > 3 + margin &&
      dist2(x, z, L1.village) > 10 + margin &&
      dist2(x, z, L1.pond) > 9.5 + margin &&
      dist2(x, z, L1.spawn) > 5 &&
      dist2(x, z, L1.gate) > 8 &&
      dist2(x, z, L1.tower) > 5 &&
      dist2(x, z, [10, -10]) > 4
    );
  };
  const trees = [kitModelId('oak-tree'), kitModelId('birch-tree'), kitModelId('pine-tree'), kitModelId('cherry-tree'), kitModelId('autumn-tree')];
  const taken: [number, number][] = [];
  let tries = 0;
  while (taken.length < 34 && tries++ < 3000) {
    const x = (rnd() * 2 - 1) * 31;
    const z = (rnd() * 2 - 1) * 31;
    if (!free(x, z, 1.8) || taken.some(([a, b]) => Math.hypot(a - x, b - z) < 4)) continue;
    taken.push([x, z]);
    const kind = trees[Math.floor(rnd() * trees.length)]!;
    s.model(kind, at(x, z), { name: 'Tree', rot: rnd() * 360, scale: 0.9 + rnd() * 0.55 });
  }
  const small = [kitModelId('round-bush'), propModelId('mushroom'), kitModelId('boulder'), propModelId('fern'), kitModelId('stump')];
  const flowers = [propModelId('poppy'), propModelId('daisy'), propModelId('tulip'), propModelId('dandelion'), propModelId('cornflower'), propModelId('sunflower')];
  for (let i = 0, n = 0; n < 26 && i < 2000; i++) {
    const x = (rnd() * 2 - 1) * 31;
    const z = (rnd() * 2 - 1) * 31;
    if (!free(x, z)) continue;
    n++;
    s.model(small[Math.floor(rnd() * small.length)]!, at(x, z), { name: 'Decoration', rot: rnd() * 360, scale: 0.8 + rnd() * 0.5 });
  }
  for (let i = 0, n = 0; n < 70 && i < 3000; i++) {
    const x = (rnd() * 2 - 1) * 31;
    const z = (rnd() * 2 - 1) * 31;
    if (!free(x, z, -1.5)) continue;
    n++;
    s.model(flowers[Math.floor(rnd() * flowers.length)]!, at(x, z), { name: 'Flower', rot: rnd() * 360, scale: 0.9 + rnd() * 0.4 });
  }

  const level = createLevelData('Meadow', s.objects, [0, groundAt(0, 22) + 0.05, 22], 180);
  const day = SKY_PRESETS.find((p) => p.id === 'day')!;
  level.sky = day.sky;
  Object.assign(level.look, day.look, { fogNear: 45, fogFar: 150 });
  return level;
}

// ---------------------------------------------------------------- level 2: the sky ruins

/**
 * The places the player has to stand on, in order, in level 2. `gap` is the open distance (m) from the edge of the
 * one before and `rise` how much higher the top is. The tests check these against what the player can jump.
 */
export interface RuinStop {
  name: string;
  /** Center and the radius (round) or half sizes (box). */
  x: number;
  z: number;
  top: number;
  radius: number;
  /** A moving platform: it slides by this much (z) back and forth. */
  moves?: number;
}

export const RUIN_ROUTE: RuinStop[] = [
  { name: 'Start island', x: 0, z: 0, top: 0, radius: 5 },
  { name: 'Stone 1', x: 0, z: -8.1, top: 0.7, radius: 1.5 },
  { name: 'Stone 2', x: 3.8, z: -11.4, top: 1.5, radius: 1.5 },
  { name: 'Stone 3', x: 0.5, z: -14.9, top: 2.3, radius: 1.5 },
  { name: 'Moving platform', x: 0.5, z: -20.2, top: 2.3, radius: 2, moves: -9 },
  { name: 'Island 1', x: 0.5, z: -37, top: 2.3, radius: 5.5 },
  { name: 'Pillar 1', x: -9, z: -40, top: 3.1, radius: 1.5 },
  { name: 'Pillar 2', x: -14, z: -44, top: 3.9, radius: 1.4 },
  { name: 'Pillar 3', x: -19, z: -41, top: 4.7, radius: 1.4 },
  { name: 'Pillar 4', x: -24, z: -36, top: 5.5, radius: 1.6 },
  { name: 'Island 2', x: -29, z: -31, top: 5.5, radius: 4 },
  { name: 'High ledge', x: -29, z: -42, top: 9.4, radius: 2.5 },
  { name: 'Temple island', x: -29, z: -72, top: 5, radius: 7 },
];

function buildRuins(project: Project): ReturnType<typeof createLevelData> {
  const s = new Scene(project);
  const stop = (name: string) => RUIN_ROUTE.find((r) => r.name === name)!;
  const top = (name: string): Vec3 => {
    const r = stop(name);
    return [r.x, r.top, r.z];
  };

  // ---- the islands and stones
  const start = stop('Start island');
  island(s, 'Start island', [start.x, start.z], start.top, start.radius, 6, 11);
  slab(s, 'Stone 1', [stop('Stone 1').x, stop('Stone 1').z], stop('Stone 1').top, [3, 0.7, 3], T.moss, T.ruin, 6);
  slab(s, 'Stone 2', [stop('Stone 2').x, stop('Stone 2').z], stop('Stone 2').top, [3, 0.7, 3], T.moss, T.ruin, -8);
  slab(s, 'Stone 3', [stop('Stone 3').x, stop('Stone 3').z], stop('Stone 3').top, [3, 0.7, 3], T.moss, T.ruin, 10);

  const mover = stop('Moving platform');
  const platform = slab(s, 'Moving platform', [mover.x, mover.z], mover.top, [4, 0.6, 4], T.ruinRune, T.ruin);
  platform.rules = [rule('start', [{ type: 'patrol', target: '', offset: [0, 0, mover.moves ?? -9], seconds: 4 }])];

  const i1 = stop('Island 1');
  island(s, 'Island 1', [i1.x, i1.z], i1.top, i1.radius, 7, 22);
  for (const name of ['Pillar 1', 'Pillar 2', 'Pillar 3', 'Pillar 4']) {
    const r = stop(name);
    pillar(s, name, [r.x, r.z], r.top, r.radius, 5, r.x * 3 + r.z, T.moss, T.ruin);
  }
  const i2 = stop('Island 2');
  island(s, 'Island 2', [i2.x, i2.z], i2.top, i2.radius, 6, 33);
  const ledge = stop('High ledge');
  island(s, 'High ledge', [ledge.x, ledge.z], ledge.top, ledge.radius, 5, 44);
  const temple = stop('Temple island');
  island(s, 'Temple island', [temple.x, temple.z], temple.top, temple.radius, 8, 55);

  // ---- the temple: walls around the door, and a trophy inside
  const wall = (name: string, cx: number, cz: number, w: number, d: number, h = 3.4) =>
    slab(s, name, [cx, cz], temple.top + h, [w, h, d], T.ruin, T.ruin);
  const backZ = temple.z - 6.3;
  const frontZ = temple.z - 2.4;
  wall('Temple back', temple.x, backZ, 7, 0.7);
  wall('Temple left', temple.x - 3.4, (backZ + frontZ) / 2, 0.7, frontZ - backZ);
  wall('Temple right', temple.x + 3.4, (backZ + frontZ) / 2, 0.7, frontZ - backZ);
  wall('Temple front left', temple.x - 2.2, frontZ, 2.6, 0.7);
  wall('Temple front right', temple.x + 2.2, frontZ, 2.6, 0.7);
  wall('Temple lintel', temple.x, frontZ, 2.0, 0.7, 1.0).position[1] += 2.4;
  s.prefab('door', [temple.x, temple.top, frontZ], { name: 'Temple door' });
  s.prefab('goal', [temple.x, temple.top + 0.1, temple.z - 4.6], { name: 'Trophy' });
  s.model('demo-ruin-column', [temple.x - 4.8, temple.top, temple.z + 1.5], { name: 'Ruin column', scale: 1.3, collide: false });
  s.model('demo-ruin-column', [temple.x + 4.8, temple.top, temple.z + 1.5], { name: 'Ruin column', scale: 1.1, collide: false, rot: 90 });
  s.model(kitModelId('archway'), [temple.x, temple.top, frontZ + 0.9], { name: 'Arch', scale: 1.0, collide: false });

  // ---- start island: the player, a sign, scenery
  const sign = s.prefab('sign', [start.x + 2.6, start.top, start.z + 0.5], { name: 'Sign' });
  sign.rules = [
    rule('start', [say('Sky Ruins: reach the temple. Run with Shift and use both jumps!', 5)]),
    rule('interact', [say('Moving platforms carry you. Spikes hurt. Slimes can be stomped. Falling sends you back to the checkpoint.', 6)]),
  ];
  s.model('demo-crystal-cluster', [start.x - 3, start.top, start.z + 1.6], { name: 'Crystals', scale: 1.2 });
  s.model('demo-ruin-column', [start.x - 3.4, start.top, start.z - 1.8], { name: 'Ruin column', scale: 1.0, rot: 30 });
  s.model(kitModelId('pine-tree'), [start.x + 3, start.top, start.z + 2.2], { name: 'Tree', scale: 1.0 });
  s.model(propModelId('banner'), [start.x, start.top, start.z - 3.4], { name: 'Banner', rot: 180 });

  // ---- island 1: a checkpoint, a slime and two patches of spikes between you and the pillars
  s.prefab('checkpoint', [i1.x + 1.5, i1.top, i1.z + 3], { name: 'Checkpoint' });
  s.prefab('enemy', [i1.x - 1.5, i1.top, i1.z - 0.5], { name: 'Slime' });
  const spikes = (x: number, z: number, top: number, name = 'Spikes') =>
    s.model('demo-spikes', [x, top, z], { name, scale: 1.1, rules: presetRules('hazard', newId) });
  spikes(i1.x + 3.2, i1.z - 2.4, i1.top);
  spikes(i1.x - 3.2, i1.z + 0.5, i1.top);
  s.model('demo-crystal-cluster', [i1.x + 3, i1.top, i1.z + 1], { name: 'Crystals', scale: 1.0 });
  s.model('demo-star-crystal', [i1.x + 0.5, i1.top + 0.3, i1.z + 4.5], { name: 'Star crystal (bonus)', animation: 'spin', rules: starRules('{stars}') });

  // ---- island 2: a slime and the spring mushroom that throws you to the high ledge
  s.prefab('enemy', [i2.x + 0.5, i2.top, i2.z + 1.5], { name: 'Slime' });
  // on the edge of the island that faces the high ledge
  s.model(kitModelId('big-mushroom'), [ledge.x, i2.top, i2.z - 3.0], {
    name: 'Spring mushroom',
    scale: 1.4,
    rules: [rule('touch', [{ type: 'bounce', strength: 18 }, sound(SND.jump2)])],
  });
  s.model(propModelId('banner'), [i2.x - 2.5, i2.top, i2.z + 1.5], { name: 'Banner', rot: 90 });
  s.model('demo-star-crystal', [stop('Pillar 3').x, stop('Pillar 3').top + 1.8, stop('Pillar 3').z], {
    name: 'Star crystal (bonus)',
    animation: 'spin',
    rules: starRules('{stars}'),
  });

  // ---- the high ledge: the key, a checkpoint and a sign about gliding
  s.prefab('key', [ledge.x, ledge.top + 0.2, ledge.z - 0.4], { name: 'Temple key' });
  s.prefab('checkpoint', [ledge.x + 1.6, ledge.top, ledge.z + 0.8], { name: 'Checkpoint' });
  const glideSign = s.prefab('sign', [ledge.x - 1.6, ledge.top, ledge.z - 1.2], { name: 'Glide sign' });
  glideSign.rules = [rule('interact', [say('The temple is far. Jump, let go, then HOLD Jump while falling to glide.', 6)])];
  s.prefab('apple', [ledge.x, ledge.top, ledge.z + 1.8]);

  // ---- coins in arcs over the jumps
  const arc = (a: Vec3, b: Vec3, n: number, peak: number) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / (n + 1);
      s.prefab('coin', [lerp(a[0], b[0], t), lerp(a[1], b[1], t) + 0.9 + Math.sin(Math.PI * t) * peak, lerp(a[2], b[2], t)]);
    }
  };
  arc(top('Start island'), top('Stone 1'), 3, 0.5);
  arc(top('Stone 1'), top('Stone 2'), 2, 0.6);
  arc(top('Stone 2'), top('Stone 3'), 2, 0.6);
  arc(top('Island 1'), top('Pillar 1'), 3, 1.0);
  arc(top('Pillar 1'), top('Pillar 2'), 3, 1.0);
  arc(top('Pillar 2'), top('Pillar 3'), 3, 1.0);
  arc(top('Pillar 3'), top('Pillar 4'), 3, 1.0);
  arc([ledge.x, ledge.top, ledge.z - 2.4], [temple.x, temple.top + 3, temple.z + 7], 6, 0.4);
  s.prefab('coin', [temple.x - 1.4, temple.top, temple.z + 2.4]);
  s.prefab('coin', [temple.x + 1.4, temple.top, temple.z + 2.4]);
  s.model('demo-star-crystal', [temple.x + 3.4, temple.top + 0.3, temple.z + 4.2], {
    name: 'Star crystal (bonus)',
    animation: 'spin',
    rules: starRules('{stars}'),
  });

  // ---- the end screen of the game is the trophy: its text shows what was collected
  const trophy = s.objects.find((o) => o.name === 'Trophy')!;
  trophy.rules = [
    rule('touch', [sound(SND.powerup), { type: 'end', title: 'You made it!', text: 'Coins: {coins}   Star crystals: {stars}\nThank you for playing Mossy Hills.' }]),
  ];

  // ---- far below: some drifting rocks, so the void is not empty
  const rnd = mulberry32(77);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 18 + rnd() * 50;
    s.model(kitModelId('boulder'), [-10 + Math.cos(a) * d, -9 - rnd() * 14, -36 + Math.sin(a) * d], { name: 'Floating rock', scale: 1.5 + rnd() * 3, rot: rnd() * 360 });
  }

  const level = createLevelData('Sky Ruins', s.objects, [start.x, start.top + 0.05, start.z + 2], 180);
  const sunset = SKY_PRESETS.find((p) => p.id === 'sunset')!;
  level.sky = sunset.sky;
  Object.assign(level.look, sunset.look, { fogNear: 30, fogFar: 125 });
  return level;
}

// ---------------------------------------------------------------- the whole demo

export function createDemoProject(): Project {
  const p = createDefaultProject();
  p.settings.name = 'Mossy Hills';
  p.settings.splash = { image: DEMO_SPLASH_IMAGE, seconds: DEFAULT_SPLASH_SECONDS, background: '#0c1020' };
  p.variables = demoVariables();
  const player: PlayerSettings = { ...defaultPlayer(), skin: HERO_SKIN, glide: true, cameraDistance: 7 };
  p.player = player;
  p.levels = [buildMeadow(p), buildRuins(p)];
  return p;
}
