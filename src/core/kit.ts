// The building kit and the trees: walls, arches, stairs, towers, a house, bridges and trees. Like every built-in
// model they follow the Hytale modeling guide (see hytaleStyle.ts): cubes and quads only, chunky and iconic;
// angles come from turning cubes (a roof is two turned slabs, a crown of leaves is a clump of turned cubes), and
// round things are two cubes, one turned 45 degrees. Tiles come from assets/textures/Kit-16.png (drawn by
// tools/make-kit.py). They are ordinary models after they are added.

import { type MeshData, assignRect } from './mesh';
import { ModelBuilder } from './modelBuilder';
import type { Model, Vec3 } from './types';

export const KIT_ATLAS = 'Kit-16.png';

/** The tiles of the atlas, row by row, 16 to a row. Keep in step with NAMES in tools/make-kit.py. */
export const KIT_TILE_NAMES = [
  'stone_brick', 'stone_brick_dark', 'stone_block', 'plaster', 'plaster_aged', 'timber', 'timber_h', 'timber_brace', 'brick_red', 'cobble', 'cobble_dark', 'rubble', 'slate_wall', 'sandstone', 'marble', 'stone_brick_moss',
  'roof_red', 'roof_slate', 'roof_thatch', 'roof_wood', 'roof_copper', 'roof_ridge', 'floor_wood', 'floor_flagstone', 'floor_checker', 'path_cobble', 'path_dirt', 'floor_stone', 'carpet_red', 'carpet_blue', 'grass', 'gravel',
  'door_wood', 'door_iron', 'window', 'shutter', 'iron_bars', 'trim_stone', 'trim_wood', 'beam_end', 'plank_bridge', 'chain', 'lattice', 'stripes', 'canvas', 'canvas_stripes', 'metal_rust', 'lamp_glow',
  'bark_oak', 'bark_pine', 'bark_birch', 'bark_dead', 'leaves_oak', 'leaves_light', 'leaves_pine', 'leaves_autumn', 'leaves_cherry', 'leaves_palm', 'moss', 'vines', 'root', 'trunk_cut', 'grass_blades', 'meadow',
  'mush_cap', 'mush_stem', 'water', 'foam', 'dirt', 'stone', 'snow', 'banner_red', 'banner_blue', 'wax', 'glass', 'straw', 'sand', 'ivy', 'blank', 'blank',
] as const;
export type KitTile = (typeof KIT_TILE_NAMES)[number];

const COLS = 16;
const TILE = 16;

export function kitTilePos(tile: KitTile): { col: number; row: number } {
  const i = KIT_TILE_NAMES.indexOf(tile);
  return { col: i % COLS, row: Math.floor(i / COLS) };
}

const rectOf = (tile: KitTile) => {
  const { col, row } = kitTilePos(tile);
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
};

type Builder = ModelBuilder<KitTile>;
type Idgen = () => string;

const DEG = Math.PI / 180;

/** Turn the points of a mesh: first about X, then about Y (degrees). Used to aim fronds and the like. */
function aim(mesh: MeshData, pitch: number, yaw: number): MeshData {
  const cx = Math.cos(pitch * DEG);
  const sx = Math.sin(pitch * DEG);
  const cy = Math.cos(yaw * DEG);
  const sy = Math.sin(yaw * DEG);
  mesh.verts = mesh.verts.map(([x, y, z]) => {
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    return [x * cy + z1 * sy, y1, -x * sy + z1 * cy] as Vec3;
  });
  return mesh;
}

/** A flat leaf lying in the x-z plane, pointing along +z from the origin. */
function leafMesh(width: number, length: number, tile: KitTile): MeshData {
  const m: MeshData = {
    verts: [
      [-width / 2, 0, 0],
      [width / 2, 0, 0],
      [width / 2, 0, length],
      [-width / 2, 0, length],
    ],
    faces: [{ v: [3, 2, 1, 0], uv: [] }],
  };
  assignRect(m, [0], rectOf(tile));
  return m;
}

/** The two slabs of a gable roof (ridge along x), with the cubes that fill the triangle of each end wall. */
function gableRoof(b: Builder, opts: { length: number; halfSpan: number; rise: number; base: number; thick: number; roof: KitTile; end: KitTile; ridge?: boolean }): void {
  const { length, halfSpan, rise, base, thick, roof, end } = opts;
  const angle = Math.atan2(rise, halfSpan) / DEG;
  const slope = Math.hypot(halfSpan, rise) + 0.12;
  const mid = (halfSpan / 2) + Math.sin(angle * DEG) * (thick / 2);
  const up = base + rise / 2 + Math.cos(angle * DEG) * (thick / 2);
  b.box('Roof', [0, up, mid], [length, thick, slope], roof, [angle, 0, 0]);
  b.box('Roof 2', [0, up, -mid], [length, thick, slope], roof, [-angle, 0, 0]);
  if (opts.ridge !== false) b.box('Ridge', [0, base + rise + 0.04, 0], [length + 0.1, 0.14, 0.3], 'roof_ridge');
  // the end walls: steps of plaster under the slabs
  const stepH = rise / 4.5;
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const top = (i + 1) * stepH;
      const half = halfSpan * (1 - top / rise) - thick * 0.9;
      if (half < 0.12) break;
      b.box('Gable', [sign * (length / 2 - 0.35), base + i * stepH + stepH / 2, 0], [0.22, stepH, half * 2], end);
    }
  }
}

/** Cubes going up in steps toward -Z, like the old stairs mesh: `n` treads over a width x height x depth space. */
function steps(b: Builder, name: string, size: Vec3, n: number, tile: KitTile): void {
  const [w, h, d] = size;
  for (let i = 0; i < n; i++) {
    const top = ((i + 1) * h) / n;
    b.box(`${name} ${i + 1}`, [0, top / 2, d / 2 - ((i + 0.5) * d) / n], [w, top, d / n], tile);
  }
}

// ---------------------------------------------------------------- tree parts

/** A trunk: a flared foot of two turned cubes, and a thinner column above it. */
function trunk(b: Builder, height: number, foot: number, top: number, bark: KitTile): void {
  b.round('Roots', [0, height * 0.1, 0], [foot * 2.8, height * 0.2, foot * 2.8], bark);
  const body = height * 0.85;
  const y0 = height * 0.15;
  const parts = 2;
  for (let i = 0; i < parts; i++) {
    const t0 = i / parts;
    const w = (foot + (top - foot) * (t0 + 0.5 / parts)) * 2;
    b.box(i === 0 ? 'Trunk' : `Trunk ${i + 1}`, [0, y0 + body * (t0 + 0.5 / parts), 0], [w, body / parts + 0.02, w], bark);
  }
}

/** A clump of foliage. */
function crown(b: Builder, name: string, center: Vec3, size: number, tile: KitTile, seed: number): void {
  b.clump(name, center, [size, size * 0.8, size], tile, seed, 2);
}

function leafyTree(b: Builder, bark: KitTile, leaves: KitTile): void {
  trunk(b, 2.9, 0.34, 0.24, bark);
  b.box('Branch', [0.55, 2.55, 0], [0.2, 1.3, 0.2], bark, [0, 0, -42]);
  b.box('Branch 2', [-0.5, 2.5, 0.1], [0.2, 1.2, 0.2], bark, [0, 0, 40]);
  crown(b, 'Crown', [0, 3.75, 0], 2.1, leaves, 1);
  crown(b, 'Crown 2', [1.0, 3.2, 0.2], 1.6, leaves, 2);
  crown(b, 'Crown 3', [-1.0, 3.1, -0.2], 1.55, leaves, 3);
  crown(b, 'Crown 4', [0.1, 3.15, 1.0], 1.4, leaves, 4);
  crown(b, 'Crown 5', [0.05, 4.5, -0.05], 1.4, leaves, 5);
}


// ---------------------------------------------------------------- recipes

const RECIPES: Record<string, { name: string; build: (b: Builder) => void }> = {
  // ---------------------------------------------------------------- walls and pieces
  'stone-wall': {
    name: 'Stone wall',
    build: (b) => {
      b.box('Wall', [0, 1.0, 0], [2, 2, 0.5], 'stone_brick');
      b.box('Cap', [0, 2.1, 0], [2.1, 0.2, 0.66], 'trim_stone');
      // two blocks that stand out of the face
      b.box('Block', [-0.55, 0.55, 0], [0.5, 0.4, 0.58], 'stone_brick_dark');
      b.box('Block 2', [0.5, 1.4, 0], [0.45, 0.4, 0.58], 'stone_brick_dark');
    },
  },
  'stone-pillar': {
    name: 'Stone pillar',
    build: (b) => {
      b.box('Plinth', [0, 0.15, 0], [0.9, 0.3, 0.9], 'stone_block');
      b.round('Shaft', [0, 1.5, 0], [0.66, 2.4, 0.66], 'stone_brick');
      b.box('Capital', [0, 2.85, 0], [0.9, 0.3, 0.9], 'stone_block');
    },
  },
  archway: {
    name: 'Archway',
    build: (b) => {
      // two piers and a lintel, with a block in each upper corner of the opening: the arch is stepped
      b.box('Pier', [-1.125, 1.6, 0], [0.75, 3.2, 0.7], 'stone_block');
      b.box('Pier 2', [1.125, 1.6, 0], [0.75, 3.2, 0.7], 'stone_block');
      b.box('Lintel', [0, 2.8, 0], [3.0, 0.8, 0.7], 'stone_block');
      b.box('Corner', [-0.58, 2.22, 0], [0.34, 0.34, 0.7], 'stone_block');
      b.box('Corner 2', [0.58, 2.22, 0], [0.34, 0.34, 0.7], 'stone_block');
      b.box('Keystone', [0, 2.6, 0], [0.34, 0.42, 0.8], 'trim_stone');
      b.box('Plinth', [-1.1, 0.12, 0], [0.8, 0.24, 0.82], 'trim_stone');
      b.box('Plinth 2', [1.1, 0.12, 0], [0.8, 0.24, 0.82], 'trim_stone');
    },
  },
  'stone-stairs': {
    name: 'Stone stairs',
    build: (b) => steps(b, 'Step', [2, 1.6, 3], 8, 'stone_block'),
  },
  'wood-stairs': {
    name: 'Wooden stairs',
    build: (b) => steps(b, 'Step', [1.4, 1.2, 2.4], 6, 'trim_wood'),
  },
  'floor-slab': {
    name: 'Flagstone slab',
    build: (b) => {
      b.box('Slab', [0, 0.08, 0], [2, 0.16, 2], 'floor_flagstone');
    },
  },
  'cobble-path': {
    name: 'Cobble path',
    build: (b) => {
      b.box('Path', [0, 0.06, 0], [2, 0.12, 2], 'path_cobble');
    },
  },
  gate: {
    name: 'Iron gate',
    build: (b) => {
      b.box('Post', [-1.15, 1.25, 0], [0.5, 2.5, 0.5], 'stone_brick');
      b.box('Post 2', [1.15, 1.25, 0], [0.5, 2.5, 0.5], 'stone_brick');
      b.box('Post cap', [-1.15, 2.6, 0], [0.62, 0.2, 0.62], 'trim_stone');
      b.box('Post cap 2', [1.15, 2.6, 0], [0.62, 0.2, 0.62], 'trim_stone');
      b.box('Bars', [0, 1.1, 0], [1.8, 2.0, 0.1], 'iron_bars');
      b.box('Top bar', [0, 2.15, 0], [1.8, 0.14, 0.14], 'door_iron');
    },
  },
  'wood-fence': {
    name: 'Wooden fence',
    build: (b) => {
      b.box('Post', [0, 0.5, 0], [0.16, 1.0, 0.16], 'trim_wood');
      b.box('Post point', [0, 1.08, 0], [0.11, 0.16, 0.11], 'trim_wood', [0, 45, 0]);
      b.box('Rail', [0, 0.78, 0], [1.0, 0.1, 0.08], 'trim_wood');
      b.box('Rail 2', [0, 0.36, 0], [1.0, 0.1, 0.08], 'trim_wood');
    },
  },

  // ---------------------------------------------------------------- buildings
  'round-tower': {
    name: 'Round tower',
    build: (b) => {
      b.round('Tower', [0, 2.5, 0], [3.05, 5, 3.05], 'stone_brick');
      b.round('Eaves', [0, 5.09, 0], [3.7, 0.18, 3.7], 'roof_wood');
      // the roof: tiers that get narrower, each two cubes
      const tiers: [number, number][] = [
        [3.2, 5.45],
        [2.5, 5.95],
        [1.8, 6.45],
        [1.1, 6.95],
      ];
      for (const [w, y] of tiers) b.round('Roof', [0, y, 0], [w, 0.56, w], 'roof_slate');
      b.box('Door', [0, 0.85, 1.7], [1.0, 1.7, 0.2], 'door_wood');
      b.box('Window', [0, 3.4, 1.62], [0.5, 0.8, 0.14], 'window');
      b.box('Window 2', [1.2, 3.4, 1.14], [0.5, 0.8, 0.14], 'window', [0, 47, 0]);
      b.box('Window 3', [-1.2, 3.4, 1.14], [0.5, 0.8, 0.14], 'window', [0, -47, 0]);
    },
  },
  house: {
    name: 'Cottage',
    build: (b) => {
      b.box('Foundation', [0, 0.2, 0], [4.3, 0.4, 3.7], 'stone_block');
      b.box('Walls', [0, 1.6, 0], [4, 2.4, 3.4], 'plaster');
      // timber frame
      for (const [x, z] of [
        [-2.0, 1.7],
        [2.0, 1.7],
        [-2.0, -1.7],
        [2.0, -1.7],
      ] as const) {
        b.box('Post', [x, 1.6, z], [0.22, 2.44, 0.22], 'timber');
      }
      b.box('Beam', [0, 2.35, 1.72], [4.2, 0.2, 0.14], 'timber_h');
      b.box('Beam 2', [0, 2.35, -1.72], [4.2, 0.2, 0.14], 'timber_h');
      b.box('Beam 3', [2.02, 2.35, 0], [0.14, 0.2, 3.5], 'timber_h');
      b.box('Beam 4', [-2.02, 2.35, 0], [0.14, 0.2, 3.5], 'timber_h');
      // gable roof, ridge along x: two slabs, and steps of plaster in the end walls
      gableRoof(b, { length: 4.7, halfSpan: 2.1, rise: 1.7, base: 2.8, thick: 0.2, roof: 'roof_red', end: 'plaster' });
      // door and windows on the front (+z)
      b.box('Door frame', [0.0, 1.35, 1.72], [1.15, 1.9, 0.1], 'trim_wood');
      b.box('Door', [0, 1.3, 1.78], [0.95, 1.75, 0.1], 'door_wood');
      b.box('Window', [-1.3, 1.9, 1.74], [0.8, 0.8, 0.1], 'window');
      b.box('Shutter', [-1.85, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Shutter 2', [-0.75, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Window 2', [1.3, 1.9, 1.74], [0.8, 0.8, 0.1], 'window');
      b.box('Shutter 3', [0.75, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Shutter 4', [1.85, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Chimney', [1.35, 3.75, -0.5], [0.55, 2.1, 0.55], 'brick_red');
      b.box('Chimney top', [1.35, 4.82, -0.5], [0.7, 0.14, 0.7], 'trim_stone');
      b.box('Step', [0, 0.45, 2.0], [1.3, 0.12, 0.5], 'stone_block');
    },
  },
  'roof-gable': {
    name: 'Roof piece',
    build: (b) => {
      gableRoof(b, { length: 3.0, halfSpan: 2.0, rise: 1.6, base: 0, thick: 0.18, roof: 'roof_red', end: 'plaster' });
    },
  },
  chimney: {
    name: 'Chimney',
    build: (b) => {
      b.box('Shaft', [0, 0.9, 0], [0.6, 1.8, 0.6], 'brick_red');
      b.box('Top', [0, 1.85, 0], [0.76, 0.14, 0.76], 'trim_stone');
    },
  },
  'stone-bridge': {
    name: 'Stone bridge',
    build: (b) => {
      b.box('Pier', [-1.7, 0.9, 0], [1.0, 1.8, 1.8], 'stone_block');
      b.box('Pier 2', [1.7, 0.9, 0], [1.0, 1.8, 1.8], 'stone_block');
      b.box('Arch', [0, 1.6, 0], [2.4, 0.4, 1.8], 'stone_block');
      b.box('Corner', [-1.05, 1.25, 0], [0.3, 0.3, 1.8], 'stone_block');
      b.box('Corner 2', [1.05, 1.25, 0], [0.3, 0.3, 1.8], 'stone_block');
      b.box('Deck', [0, 1.9, 0], [4.8, 0.2, 2.0], 'floor_stone');
      b.box('Parapet', [0, 2.3, 0.88], [4.8, 0.6, 0.24], 'stone_brick');
      b.box('Parapet 2', [0, 2.3, -0.88], [4.8, 0.6, 0.24], 'stone_brick');
    },
  },
  'wood-bridge': {
    name: 'Wooden bridge',
    build: (b) => {
      for (let i = 0; i < 8; i++) {
        b.box('Plank', [-1.75 + i * 0.5, 0.55, 0], [0.44, 0.1, 1.4], 'plank_bridge');
      }
      b.box('Beam', [0, 0.42, 0.62], [4.2, 0.16, 0.16], 'timber_h');
      b.box('Beam 2', [0, 0.42, -0.62], [4.2, 0.16, 0.16], 'timber_h');
      for (const x of [-1.9, 1.9]) {
        for (const z of [-0.66, 0.66]) b.box('Post', [x, 0.7, z], [0.16, 1.4, 0.16], 'trim_wood');
      }
      b.box('Rail', [0, 1.28, 0.66], [4.0, 0.1, 0.1], 'trim_wood');
      b.box('Rail 2', [0, 1.28, -0.66], [4.0, 0.1, 0.1], 'trim_wood');
    },
  },
  'market-stall': {
    name: 'Market stall',
    build: (b) => {
      b.box('Counter', [0, 0.45, 0.3], [1.8, 0.9, 0.7], 'trim_wood');
      b.box('Goods', [0, 0.98, 0.3], [1.4, 0.12, 0.5], 'straw');
      for (const [x, z] of [
        [-0.85, -0.45],
        [0.85, -0.45],
        [-0.85, 0.6],
        [0.85, 0.6],
      ] as const) {
        b.box('Post', [x, 1.1, z], [0.12, 2.2, 0.12], 'timber');
      }
      // an awning sloping down to the front
      b.box('Awning', [0, 2.3, 0.1], [2.2, 0.1, 1.7], 'canvas_stripes', [14, 0, 0]);
      b.box('Valance', [0, 2.12, 0.95], [2.2, 0.22, 0.08], 'canvas_stripes');
    },
  },
  windmill: {
    name: 'Windmill',
    build: (b) => {
      b.box('Base', [0, 0.3, 0], [3.2, 0.6, 3.2], 'stone_block');
      // the tower narrows in steps
      b.box('Tower', [0, 1.2, 0], [2.7, 1.2, 2.7], 'plaster');
      b.box('Tower 2', [0, 2.4, 0], [2.4, 1.2, 2.4], 'plaster');
      b.box('Tower 3', [0, 3.6, 0], [2.1, 1.2, 2.1], 'plaster');
      b.box('Roof', [0, 4.41, 0], [2.7, 0.42, 2.7], 'roof_thatch');
      b.box('Roof 2', [0, 4.83, 0], [1.9, 0.42, 1.9], 'roof_thatch');
      b.box('Roof 3', [0, 5.25, 0], [1.1, 0.42, 1.1], 'roof_thatch');
      b.box('Door', [0, 0.9, 1.42], [0.9, 1.7, 0.2], 'door_wood');
      b.box('Window', [0, 2.8, 1.25], [0.45, 0.6, 0.12], 'window');
      const sails = b.bone('Sails', [0, 3.5, 1.2]);
      b.box('Hub', [0, 3.5, 1.2], [0.3, 0.3, 0.4], 'timber', [0, 0, 0], sails);
      b.box('Beam', [0, 3.5, 1.3], [0.14, 3.4, 0.08], 'timber', [0, 0, 0], sails);
      b.box('Beam 2', [0, 3.5, 1.3], [3.4, 0.14, 0.08], 'timber', [0, 0, 0], sails);
      // four arms with a sail on each, turning together about the hub
      for (let k = 0; k < 4; k++) {
        const a = k * 90 * DEG;
        const arm: [number, number] = [-Math.sin(a), Math.cos(a)];
        const side: [number, number] = [Math.cos(a), Math.sin(a)];
        b.box(
          'Sail',
          [arm[0] * 1.15 + side[0] * 0.3, 3.5 + arm[1] * 1.15 + side[1] * 0.3, 1.36],
          [0.5, 1.1, 0.04],
          'canvas',
          [0, 0, k * 90],
          sails,
        );
      }
      b.clip('turn', 10, true, {
        Sails: {
          rot: [
            { t: 0, v: [0, 0, 0] },
            { t: 5, v: [0, 0, -180] },
            { t: 10, v: [0, 0, -360] },
          ],
        },
      });
    },
  },
  lighthouse: {
    name: 'Lighthouse',
    build: (b) => {
      b.box('Foot', [0, 0.25, 0], [3.6, 0.5, 3.6], 'stone_block');
      b.box('Band', [0, 1.5, 0], [3.0, 2.0, 3.0], 'plaster');
      b.box('Band 2', [0, 3.5, 0], [2.6, 2.0, 2.6], 'brick_red');
      b.box('Band 3', [0, 5.5, 0], [2.2, 2.0, 2.2], 'plaster');
      b.box('Gallery', [0, 6.6, 0], [2.7, 0.25, 2.7], 'trim_stone');
      b.round('Lamp', [0, 7.25, 0], [1.1, 1.0, 1.1], 'lamp_glow');
      b.round('Roof', [0, 7.95, 0], [1.7, 0.4, 1.7], 'roof_copper');
      b.round('Roof 2', [0, 8.3, 0], [1.0, 0.4, 1.0], 'roof_copper');
      b.box('Door', [0, 0.8, 1.55], [0.9, 1.5, 0.2], 'door_wood');
    },
  },
  boulder: {
    name: 'Large boulder',
    build: (b) => {
      // a heap of big stones, each a turned cube
      b.box('Rock', [0, 0.55, 0], [2.0, 1.1, 1.8], 'stone', [0, 18, 0]);
      b.box('Rock 2', [0.75, 0.95, 0.15], [1.2, 1.2, 1.1], 'stone', [10, 40, -8]);
      b.box('Rock 3', [-0.7, 0.8, -0.2], [1.1, 1.0, 1.2], 'stone', [-6, 62, 10]);
      b.box('Rock 4', [0.1, 1.3, -0.35], [0.9, 0.7, 0.8], 'stone', [8, 12, 12]);
      b.box('Rock 5', [-0.2, 0.3, 0.9], [1.1, 0.6, 0.8], 'stone', [0, -25, 0]);
    },
  },
  'ring-stone': {
    name: 'Standing ring',
    build: (b) => {
      // eight blocks in a ring, standing in the XY plane
      b.ringOf('Ring', [0, 1.1, 0], 0.9, 8, [0.38, 0.66, 0.7], 'stone', true);
      b.box('Base', [0, 0.15, 0], [1.3, 0.3, 0.7], 'stone_block');
    },
  },

  // ---------------------------------------------------------------- trees and plants
  'oak-tree': { name: 'Oak tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_oak') },
  'cherry-tree': { name: 'Cherry tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_cherry') },
  'autumn-tree': { name: 'Autumn tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_autumn') },
  'pine-tree': {
    name: 'Pine tree',
    build: (b) => {
      trunk(b, 2.0, 0.3, 0.2, 'bark_pine');
      // tiers of two turned slabs with a smaller block on top, each narrower than the one below
      const tiers: [number, number, number][] = [
        [2.6, 1.5, 1.9],
        [2.05, 1.4, 2.7],
        [1.55, 1.3, 3.4],
        [1.1, 1.2, 4.05],
      ];
      for (const [w, h, y] of tiers) {
        b.round('Tier', [0, y - h * 0.22, 0], [w, h * 0.55, w], 'leaves_pine', null, 0.8);
        b.box('Tier top', [0, y + h * 0.27, 0], [w * 0.55, h * 0.45, w * 0.55], 'leaves_pine', [0, 20, 0]);
      }
      b.box('Tip', [0, 4.55, 0], [0.26, 0.36, 0.26], 'leaves_pine', [0, 45, 0]);
    },
  },
  'birch-tree': {
    name: 'Birch tree',
    build: (b) => {
      trunk(b, 3.2, 0.2, 0.14, 'bark_birch');
      crown(b, 'Crown', [0, 3.6, 0], 1.8, 'leaves_light', 7);
      crown(b, 'Crown 2', [0.6, 3.0, 0.3], 1.3, 'leaves_light', 8);
      crown(b, 'Crown 3', [-0.5, 3.15, -0.3], 1.25, 'leaves_light', 9);
    },
  },
  'palm-tree': {
    name: 'Palm tree',
    build: (b) => {
      // a trunk that leans and bends: cubes, each a little more tilted than the one below
      let x = 0;
      let y = 0;
      let angle = 4;
      for (let i = 0; i < 6; i++) {
        const len = 0.8;
        const w = 0.5 - i * 0.04;
        const cx = x + Math.sin(angle * DEG) * (len / 2);
        const cy = y + Math.cos(angle * DEG) * (len / 2);
        b.box('Trunk', [cx, cy, 0], [w, len + 0.08, w], 'bark_pine', [0, 0, -angle]);
        x += Math.sin(angle * DEG) * len;
        y += Math.cos(angle * DEG) * len;
        angle += 3.5;
      }
      for (let k = 0; k < 7; k++) {
        const yaw = (k / 7) * 360;
        const frond = aim(leafMesh(0.9, 1.9, 'leaves_palm'), 18 + (k % 2) * 10, yaw);
        b.mesh('Frond', [x, y + 0.05, 0], frond);
      }
      b.box('Coconut', [x, y - 0.1, 0.14], [0.24, 0.24, 0.24], 'bark_oak', [0, 30, 0]);
    },
  },
  'dead-tree': {
    name: 'Dead tree',
    build: (b) => {
      trunk(b, 3.0, 0.3, 0.14, 'bark_dead');
      b.box('Branch', [0.6, 2.2, 0], [0.18, 1.5, 0.18], 'bark_dead', [0, 0, -50]);
      b.box('Branch 2', [-0.55, 2.6, 0.1], [0.16, 1.3, 0.16], 'bark_dead', [0, 0, 55]);
      b.box('Branch 3', [0.15, 3.0, 0.5], [0.14, 1.1, 0.14], 'bark_dead', [55, 0, -10]);
    },
  },
  'round-bush': {
    name: 'Round bush',
    build: (b) => {
      crown(b, 'Leaves', [0, 0.5, 0], 1.1, 'leaves_oak', 11);
      crown(b, 'Leaves 2', [0.45, 0.38, 0.2], 0.8, 'leaves_oak', 12);
      crown(b, 'Leaves 3', [-0.4, 0.38, -0.15], 0.8, 'leaves_light', 13);
    },
  },
  hedge: {
    name: 'Hedge',
    build: (b) => {
      b.box('Hedge', [0, 0.45, 0], [2, 0.9, 0.8], 'leaves_oak');
      b.box('Tuft', [-0.5, 0.95, 0], [0.7, 0.2, 0.6], 'leaves_oak', [0, 8, 0]);
      b.box('Tuft 2', [0.45, 0.97, 0], [0.8, 0.22, 0.64], 'leaves_light', [0, -10, 0]);
    },
  },
  stump: {
    name: 'Tree stump',
    build: (b) => {
      b.round('Stump', [0, 0.3, 0], [0.82, 0.6, 0.82], { side: 'bark_oak', top: 'trunk_cut', bottom: 'bark_oak' });
      b.box('Root', [0.45, 0.1, 0.1], [0.5, 0.16, 0.2], 'root', [0, 0, -12]);
      b.box('Root 2', [-0.2, 0.1, 0.42], [0.5, 0.16, 0.2], 'root', [0, 70, 10]);
    },
  },
  log: {
    name: 'Fallen log',
    build: (b) => {
      b.box('Log', [0, 0.3, 0], [2.2, 0.58, 0.58], 'bark_oak');
      b.box('Log turned', [0, 0.3, 0], [2.16, 0.52, 0.52], 'bark_oak', [45, 0, 0]);
    },
  },
  'big-mushroom': {
    name: 'Giant mushroom',
    build: (b) => {
      b.box('Stem', [0, 0.5, 0], [0.4, 1.0, 0.4], 'mush_stem');
      b.round('Cap', [0, 1.15, 0], [1.5, 0.34, 1.5], 'mush_cap');
      b.round('Cap top', [0, 1.45, 0], [1.0, 0.28, 1.0], 'mush_cap');
      b.box('Cap crown', [0, 1.64, 0], [0.5, 0.16, 0.5], 'mush_cap', [0, 20, 0]);
    },
  },
};

export type KitKind = keyof typeof RECIPES;

export const KIT_KINDS = Object.keys(RECIPES) as KitKind[];
export const kitModelId = (kind: string) => `kit-${kind}`;

/** The built-in kit model of a kind. */
export function createKitModel(kind: KitKind, idGen: Idgen): Model {
  const recipe = RECIPES[kind]!;
  const b: Builder = new ModelBuilder<KitTile>(idGen, rectOf, 'stone');
  recipe.build(b);
  return b.toModel(kitModelId(kind), recipe.name, KIT_ATLAS);
}

/** Every built-in kit model. */
export function builtInKitModels(idGen: Idgen): Model[] {
  return KIT_KINDS.map((k) => createKitModel(k, idGen));
}
