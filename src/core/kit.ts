// The building kit and the modeled trees: walls, arches, stairs, towers, a house, bridges and trees made of
// real shapes (tapered trunks, round crowns, cones), not of stacked cubes. Tiles come from
// assets/textures/Kit-16.png (drawn by tools/make-kit.py). They are ordinary models after they are added.

import { type MeshData, assignRect, boxMesh, meshBounds, rockMesh, wedgeMesh } from './mesh';
import { archMesh, cylinderMesh, domeMesh, extrudeProfile, sphereMesh, stairsMesh, torusMesh } from './meshGen';
import { bevelMesh, smoothMesh } from './meshModify';
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

/** A shape with its hard edges chamfered a little: stone and wood look hewn, not extruded. */
function hewn(mesh: MeshData, amount = 0.04): MeshData {
  return bevelMesh(mesh, { amount });
}

const solidBox = (size: Vec3, tile: KitTile, amount = 0.04): MeshData => hewn(boxMesh(size, null, null, rectOf(tile)), amount);

// ---------------------------------------------------------------- tree parts

/** A trunk: wider at the foot, a flared base, tapering up. Returns the top height. */
function trunk(b: Builder, height: number, foot: number, top: number, bark: KitTile, cap: KitTile = 'trunk_cut'): void {
  const flare = cylinderMesh(8, foot * 1.5, foot, height * 0.2, rectOf(bark));
  b.spreadCaps(flare, foot * 1.5, cap, [0]);
  b.mesh('Roots', [0, height * 0.1, 0], flare);
  const body = cylinderMesh(8, foot, top, height * 0.85, rectOf(bark));
  b.spreadCaps(body, top, cap, [1]);
  b.mesh('Trunk', [0, height * 0.2 + (height * 0.85) / 2 - height * 0.05, 0], body);
}

/** A round clump of foliage, shaded smooth. */
function crown(b: Builder, name: string, center: Vec3, radius: number, tile: KitTile, rings = 5): void {
  b.mesh(name, center, sphereMesh(radius, 8, rings, rectOf(tile)), [0, 0, 0], null, true);
}

function leafyTree(b: Builder, bark: KitTile, leaves: KitTile): void {
  trunk(b, 2.6, 0.4, 0.24, bark);
  b.mesh('Branch', [0.45, 2.45, 0], cylinderMesh(6, 0.14, 0.07, 1.3, rectOf(bark)), [0, 0, -42]);
  b.mesh('Branch 2', [-0.42, 2.4, 0.1], cylinderMesh(6, 0.13, 0.07, 1.2, rectOf(bark)), [0, 0, 40]);
  crown(b, 'Crown', [0, 3.55, 0], 1.2, leaves);
  crown(b, 'Crown 2', [0.95, 3.1, 0.2], 0.9, leaves);
  crown(b, 'Crown 3', [-0.95, 3.0, -0.2], 0.85, leaves);
  crown(b, 'Crown 4', [0.1, 3.05, 0.95], 0.8, leaves);
  crown(b, 'Crown 5', [0.05, 4.4, -0.05], 0.75, leaves);
}

// ---------------------------------------------------------------- recipes

const RECIPES: Record<string, { name: string; build: (b: Builder) => void }> = {
  // ---------------------------------------------------------------- walls and pieces
  'stone-wall': {
    name: 'Stone wall',
    build: (b) => {
      b.mesh('Wall', [0, 1.0, 0], solidBox([2, 2, 0.5], 'stone_brick'));
      b.mesh('Cap', [0, 2.1, 0], solidBox([2.1, 0.2, 0.66], 'trim_stone', 0.03));
    },
  },
  'stone-pillar': {
    name: 'Stone pillar',
    build: (b) => {
      b.mesh('Plinth', [0, 0.15, 0], solidBox([0.9, 0.3, 0.9], 'stone_block'));
      const shaft = cylinderMesh(10, 0.34, 0.3, 2.4, rectOf('stone_brick'));
      b.spreadCaps(shaft, 0.34, 'stone_block');
      b.mesh('Shaft', [0, 1.5, 0], shaft);
      b.mesh('Capital', [0, 2.85, 0], solidBox([0.9, 0.3, 0.9], 'stone_block'));
    },
  },
  archway: {
    name: 'Archway',
    build: (b) => {
      b.mesh('Wall', [0, 1.6, 0], hewn(archMesh([3, 3.2, 0.7], 1.5, 2.4, 10, rectOf('stone_block')), 0.03));
      b.mesh('Keystone', [0, 2.62, 0], solidBox([0.34, 0.42, 0.8], 'trim_stone', 0.03));
      b.mesh('Plinth', [-1.1, 0.12, 0], solidBox([0.8, 0.24, 0.82], 'trim_stone', 0.03));
      b.mesh('Plinth 2', [1.1, 0.12, 0], solidBox([0.8, 0.24, 0.82], 'trim_stone', 0.03));
    },
  },
  'stone-stairs': {
    name: 'Stone stairs',
    build: (b) => {
      b.mesh('Stairs', [0, 0.8, 0], stairsMesh([2, 1.6, 3], 8, rectOf('stone_block')));
    },
  },
  'wood-stairs': {
    name: 'Wooden stairs',
    build: (b) => {
      b.mesh('Stairs', [0, 0.6, 0], stairsMesh([1.4, 1.2, 2.4], 6, rectOf('trim_wood')));
    },
  },
  'floor-slab': {
    name: 'Flagstone slab',
    build: (b) => {
      b.mesh('Slab', [0, 0.08, 0], solidBox([2, 0.16, 2], 'floor_flagstone', 0.025));
    },
  },
  'cobble-path': {
    name: 'Cobble path',
    build: (b) => {
      b.mesh('Path', [0, 0.06, 0], solidBox([2, 0.12, 2], 'path_cobble', 0.02));
    },
  },
  'gate': {
    name: 'Iron gate',
    build: (b) => {
      b.mesh('Post', [-1.15, 1.25, 0], solidBox([0.5, 2.5, 0.5], 'stone_brick', 0.04));
      b.mesh('Post 2', [1.15, 1.25, 0], solidBox([0.5, 2.5, 0.5], 'stone_brick', 0.04));
      b.mesh('Post cap', [-1.15, 2.6, 0], solidBox([0.62, 0.2, 0.62], 'trim_stone', 0.03));
      b.mesh('Post cap 2', [1.15, 2.6, 0], solidBox([0.62, 0.2, 0.62], 'trim_stone', 0.03));
      b.box('Bars', [0, 1.1, 0], [1.8, 2.0, 0.05], 'iron_bars');
      b.box('Top bar', [0, 2.15, 0], [1.8, 0.1, 0.1], 'door_iron');
    },
  },
  'wood-fence': {
    name: 'Wooden fence',
    build: (b) => {
      b.mesh('Post', [0, 0.5, 0], solidBox([0.16, 1.0, 0.16], 'trim_wood', 0.02));
      b.mesh('Post point', [0, 1.1, 0], cylinderMesh(4, 0.14, 0, 0.2, rectOf('trim_wood'), Math.PI / 4));
      b.box('Rail', [0, 0.78, 0], [1.0, 0.1, 0.07], 'trim_wood');
      b.box('Rail 2', [0, 0.36, 0], [1.0, 0.1, 0.07], 'trim_wood');
    },
  },

  // ---------------------------------------------------------------- buildings
  'round-tower': {
    name: 'Round tower',
    build: (b) => {
      const body = cylinderMesh(12, 1.7, 1.5, 5, rectOf('stone_brick'));
      b.mesh('Tower', [0, 2.5, 0], body);
      b.mesh('Eaves', [0, 5.05, 0], cylinderMesh(12, 2.0, 2.0, 0.18, rectOf('roof_wood')));
      b.mesh('Roof', [0, 6.2, 0], cylinderMesh(12, 1.95, 0, 2.2, rectOf('roof_slate')));
      b.mesh('Door', [0, 0.85, 1.66], hewn(archMesh([1.0, 1.7, 0.18], 0.8, 1.5, 6, rectOf('door_wood')), 0.02));
      b.box('Window', [0, 3.4, 1.58], [0.5, 0.8, 0.14], 'window');
      b.box('Window 2', [1.2, 3.4, 1.1], [0.5, 0.8, 0.14], 'window', [0, 47, 0]);
      b.box('Window 3', [-1.2, 3.4, 1.1], [0.5, 0.8, 0.14], 'window', [0, -47, 0]);
    },
  },
  house: {
    name: 'Cottage',
    build: (b) => {
      b.mesh('Foundation', [0, 0.2, 0], solidBox([4.3, 0.4, 3.7], 'stone_block', 0.04));
      b.box('Walls', [0, 1.6, 0], [4, 2.4, 3.4], { side: 'plaster', top: 'plaster', bottom: 'plaster' });
      // timber frame
      for (const [x, z] of [
        [-2.0, 1.7],
        [2.0, 1.7],
        [-2.0, -1.7],
        [2.0, -1.7],
      ] as const) {
        b.mesh('Post', [x, 1.6, z], solidBox([0.22, 2.44, 0.22], 'timber', 0.02));
      }
      b.mesh('Beam', [0, 2.35, 1.72], solidBox([4.2, 0.2, 0.14], 'timber_h', 0.02));
      b.mesh('Beam 2', [0, 2.35, -1.72], solidBox([4.2, 0.2, 0.14], 'timber_h', 0.02));
      b.mesh('Beam 3', [2.02, 2.35, 0], solidBox([0.14, 0.2, 3.5], 'timber_h', 0.02));
      b.mesh('Beam 4', [-2.02, 2.35, 0], solidBox([0.14, 0.2, 3.5], 'timber_h', 0.02));
      // gable roof, ridge along x, the end faces plaster
      const roof = extrudeProfile(
        [
          [-2.1, 0],
          [2.1, 0],
          [0, 1.7],
        ],
        4.7,
        'zy',
        rectOf('roof_red'),
      );
      assignRect(roof, [0, 1], rectOf('plaster'));
      b.mesh('Roof', [0, 2.8 + 0.0, 0], roof, [0, 0, 0]);
      b.box('Ridge', [0, 4.52, 0], [4.8, 0.12, 0.26], 'roof_ridge');
      // door and windows on the front (+z)
      b.box('Door frame', [0.0, 1.35, 1.72], [1.15, 1.9, 0.1], 'trim_wood');
      b.mesh('Door', [0, 1.3, 1.78], hewn(archMesh([0.95, 1.75, 0.1], 0.8, 1.6, 6, rectOf('door_wood')), 0.015));
      b.box('Window', [-1.3, 1.9, 1.74], [0.8, 0.8, 0.1], 'window');
      b.box('Shutter', [-1.85, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Shutter 2', [-0.75, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Window 2', [1.3, 1.9, 1.74], [0.8, 0.8, 0.1], 'window');
      b.box('Shutter 3', [0.75, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.box('Shutter 4', [1.85, 1.9, 1.78], [0.3, 0.8, 0.06], 'shutter');
      b.mesh('Chimney', [1.35, 3.9, -0.5], solidBox([0.55, 1.9, 0.55], 'brick_red', 0.03));
      b.mesh('Step', [0, 0.45, 2.0], solidBox([1.3, 0.12, 0.5], 'stone_block', 0.02));
    },
  },
  'roof-gable': {
    name: 'Roof piece',
    build: (b) => {
      const roof = extrudeProfile(
        [
          [-2.0, 0],
          [2.0, 0],
          [0, 1.6],
        ],
        3,
        'zy',
        rectOf('roof_red'),
      );
      assignRect(roof, [0, 1], rectOf('plaster'));
      b.mesh('Roof', [0, 0, 0], roof);
      b.box('Ridge', [0, 1.62, 0], [3.1, 0.12, 0.26], 'roof_ridge');
    },
  },
  chimney: {
    name: 'Chimney',
    build: (b) => {
      b.mesh('Shaft', [0, 0.9, 0], solidBox([0.6, 1.8, 0.6], 'brick_red', 0.03));
      b.mesh('Top', [0, 1.85, 0], solidBox([0.76, 0.14, 0.76], 'trim_stone', 0.02));
    },
  },
  'stone-bridge': {
    name: 'Stone bridge',
    build: (b) => {
      b.mesh('Body', [0, 0.9, 0], hewn(archMesh([4.4, 1.8, 1.8], 2.4, 1.4, 10, rectOf('stone_block')), 0.03));
      b.mesh('Deck', [0, 1.9, 0], solidBox([4.8, 0.2, 2.0], 'floor_stone', 0.03));
      b.mesh('Parapet', [0, 2.3, 0.88], solidBox([4.8, 0.6, 0.24], 'stone_brick', 0.03));
      b.mesh('Parapet 2', [0, 2.3, -0.88], solidBox([4.8, 0.6, 0.24], 'stone_brick', 0.03));
    },
  },
  'wood-bridge': {
    name: 'Wooden bridge',
    build: (b) => {
      for (let i = 0; i < 8; i++) {
        b.box('Plank', [-1.75 + i * 0.5, 0.55, 0], [0.44, 0.1, 1.4], 'plank_bridge');
      }
      b.mesh('Beam', [0, 0.42, 0.62], solidBox([4.2, 0.16, 0.16], 'timber_h', 0.02));
      b.mesh('Beam 2', [0, 0.42, -0.62], solidBox([4.2, 0.16, 0.16], 'timber_h', 0.02));
      for (const x of [-1.9, 1.9]) {
        for (const z of [-0.66, 0.66]) b.mesh('Post', [x, 0.7, z], solidBox([0.16, 1.4, 0.16], 'trim_wood', 0.02));
      }
      b.box('Rail', [0, 1.28, 0.66], [4.0, 0.08, 0.08], 'trim_wood');
      b.box('Rail 2', [0, 1.28, -0.66], [4.0, 0.08, 0.08], 'trim_wood');
    },
  },
  'market-stall': {
    name: 'Market stall',
    build: (b) => {
      b.mesh('Counter', [0, 0.45, 0.3], solidBox([1.8, 0.9, 0.7], 'trim_wood', 0.03));
      b.box('Goods', [0, 0.98, 0.3], [1.4, 0.12, 0.5], 'straw');
      for (const [x, z] of [
        [-0.85, -0.45],
        [0.85, -0.45],
        [-0.85, 0.6],
        [0.85, 0.6],
      ] as const) {
        b.mesh('Post', [x, 1.1, z], solidBox([0.1, 2.2, 0.1], 'timber', 0.015));
      }
      // an awning sloping down to the front
      b.mesh('Awning', [0, 2.25, 0.1], wedgeMesh([2.2, 0.5, 1.6], rectOf('canvas_stripes')), [0, 180, 0]);
    },
  },
  windmill: {
    name: 'Windmill',
    build: (b) => {
      b.mesh('Base', [0, 0.3, 0], cylinderMesh(8, 1.6, 1.5, 0.6, rectOf('stone_block')));
      b.mesh('Tower', [0, 2.4, 0], cylinderMesh(8, 1.4, 0.95, 3.6, rectOf('plaster')));
      b.mesh('Roof', [0, 4.7, 0], cylinderMesh(8, 1.2, 0, 1.5, rectOf('roof_thatch')));
      b.mesh('Door', [0, 0.9, 1.45], hewn(archMesh([0.9, 1.7, 0.16], 0.7, 1.5, 6, rectOf('door_wood')), 0.02));
      b.box('Window', [0, 2.8, 1.16], [0.45, 0.6, 0.12], 'window');
      const sails = b.bone('Sails', [0, 3.5, 1.2]);
      b.box('Hub', [0, 3.5, 1.2], [0.3, 0.3, 0.4], 'timber', [0, 0, 0], sails);
      b.mesh('Beam', [0, 3.5, 1.3], solidBox([0.14, 3.4, 0.08], 'timber', 0.01), [0, 0, 0], sails);
      b.mesh('Beam 2', [0, 3.5, 1.3], solidBox([3.4, 0.14, 0.08], 'timber', 0.01), [0, 0, 0], sails);
      // four arms with a sail on each, turning together about the hub
      for (let k = 0; k < 4; k++) {
        const a = k * 90 * DEG;
        const arm: [number, number] = [-Math.sin(a), Math.cos(a)];
        const side: [number, number] = [Math.cos(a), Math.sin(a)];
        b.box(
          'Sail',
          [arm[0] * 1.15 + side[0] * 0.3, 3.5 + arm[1] * 1.15 + side[1] * 0.3, 1.36],
          [0.5, 1.1, 0.03],
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
      b.mesh('Foot', [0, 0.25, 0], cylinderMesh(12, 1.8, 1.7, 0.5, rectOf('stone_block')));
      b.mesh('Band', [0, 1.5, 0], cylinderMesh(12, 1.5, 1.3, 2, rectOf('plaster')));
      b.mesh('Band 2', [0, 3.5, 0], cylinderMesh(12, 1.3, 1.1, 2, rectOf('brick_red')));
      b.mesh('Band 3', [0, 5.5, 0], cylinderMesh(12, 1.1, 0.95, 2, rectOf('plaster')));
      b.mesh('Gallery', [0, 6.6, 0], cylinderMesh(12, 1.3, 1.3, 0.25, rectOf('trim_stone')));
      b.mesh('Lamp', [0, 7.25, 0], cylinderMesh(8, 0.55, 0.55, 1.0, rectOf('lamp_glow')));
      b.mesh('Roof', [0, 8.1, 0], cylinderMesh(8, 0.85, 0, 0.8, rectOf('roof_copper')));
      b.mesh('Door', [0, 0.85, 1.74], hewn(archMesh([0.9, 1.6, 0.16], 0.7, 1.4, 6, rectOf('door_wood')), 0.02));
    },
  },
  boulder: {
    name: 'Large boulder',
    build: (b) => {
      const mesh = smoothMesh(rockMesh(21, 2.4, rectOf('stone')));
      b.mesh('Rock', [0, -meshBounds(mesh).min[1], 0], mesh, [0, 0, 0], null, true);
    },
  },
  'ring-stone': {
    name: 'Standing ring',
    build: (b) => {
      b.mesh('Ring', [0, 1.1, 0], torusMesh(0.9, 0.22, 14, 7, rectOf('stone')), [90, 0, 0], null, true);
      b.mesh('Base', [0, 0.15, 0], solidBox([1.3, 0.3, 0.7], 'stone_block', 0.03));
    },
  },

  // ---------------------------------------------------------------- trees and plants
  'oak-tree': { name: 'Oak tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_oak') },
  'cherry-tree': { name: 'Cherry tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_cherry') },
  'autumn-tree': { name: 'Autumn tree', build: (b) => leafyTree(b, 'bark_oak', 'leaves_autumn') },
  'pine-tree': {
    name: 'Pine tree',
    build: (b) => {
      trunk(b, 2.0, 0.32, 0.18, 'bark_pine');
      const tiers: [number, number, number][] = [
        [1.45, 1.5, 1.9],
        [1.15, 1.4, 2.7],
        [0.88, 1.3, 3.4],
        [0.62, 1.2, 4.05],
      ];
      for (const [r, h, y] of tiers) b.mesh('Tier', [0, y, 0], cylinderMesh(9, r, 0, h, rectOf('leaves_pine')));
    },
  },
  'birch-tree': {
    name: 'Birch tree',
    build: (b) => {
      trunk(b, 3.2, 0.24, 0.15, 'bark_birch');
      crown(b, 'Crown', [0, 3.5, 0], 0.95, 'leaves_light');
      crown(b, 'Crown 2', [0.55, 3.0, 0.3], 0.7, 'leaves_light');
      crown(b, 'Crown 3', [-0.45, 3.15, -0.3], 0.65, 'leaves_light');
    },
  },
  'palm-tree': {
    name: 'Palm tree',
    build: (b) => {
      // a trunk that leans and bends: segments, each a little more tilted than the one below
      let x = 0;
      let y = 0;
      let angle = 4;
      for (let i = 0; i < 6; i++) {
        const len = 0.8;
        const r0 = 0.26 - i * 0.025;
        const r1 = r0 - 0.025;
        const cx = x + Math.sin(angle * DEG) * (len / 2);
        const cy = y + Math.cos(angle * DEG) * (len / 2);
        b.mesh('Trunk', [cx, cy, 0], cylinderMesh(8, r0, r1, len, rectOf('bark_pine')), [0, 0, -angle]);
        x += Math.sin(angle * DEG) * len;
        y += Math.cos(angle * DEG) * len;
        angle += 3.5;
      }
      for (let k = 0; k < 7; k++) {
        const yaw = (k / 7) * 360;
        const frond = aim(leafMesh(0.9, 1.9, 'leaves_palm'), 18 + (k % 2) * 10, yaw);
        b.mesh('Frond', [x, y + 0.05, 0], frond);
      }
      b.mesh('Coconut', [x, y - 0.1, 0.12], sphereMesh(0.12, 6, 4, rectOf('bark_oak')), [0, 0, 0], null, true);
    },
  },
  'dead-tree': {
    name: 'Dead tree',
    build: (b) => {
      trunk(b, 3.0, 0.34, 0.14, 'bark_dead');
      b.mesh('Branch', [0.55, 2.2, 0], cylinderMesh(6, 0.12, 0.04, 1.5, rectOf('bark_dead')), [0, 0, -50]);
      b.mesh('Branch 2', [-0.5, 2.6, 0.1], cylinderMesh(6, 0.1, 0.04, 1.3, rectOf('bark_dead')), [0, 0, 55]);
      b.mesh('Branch 3', [0.15, 3.0, 0.45], cylinderMesh(6, 0.09, 0.03, 1.1, rectOf('bark_dead')), [55, 0, -10]);
    },
  },
  'round-bush': {
    name: 'Round bush',
    build: (b) => {
      crown(b, 'Leaves', [0, 0.45, 0], 0.55, 'leaves_oak');
      crown(b, 'Leaves 2', [0.4, 0.35, 0.2], 0.4, 'leaves_oak');
      crown(b, 'Leaves 3', [-0.35, 0.35, -0.15], 0.42, 'leaves_light');
    },
  },
  hedge: {
    name: 'Hedge',
    build: (b) => {
      b.mesh('Hedge', [0, 0.5, 0], smoothMesh(boxMesh([2, 1.0, 0.8], null, null, rectOf('leaves_oak'))), [0, 0, 0], null, true);
    },
  },
  stump: {
    name: 'Tree stump',
    build: (b) => {
      const top = cylinderMesh(9, 0.42, 0.36, 0.6, rectOf('bark_oak'));
      b.spreadCaps(top, 0.42, 'trunk_cut', [1]);
      b.mesh('Stump', [0, 0.3, 0], top);
      b.mesh('Root', [0.4, 0.1, 0.1], cylinderMesh(5, 0.12, 0.05, 0.5, rectOf('root')), [0, 0, -75]);
      b.mesh('Root 2', [-0.2, 0.1, 0.38], cylinderMesh(5, 0.12, 0.05, 0.5, rectOf('root')), [70, 0, 10]);
    },
  },
  log: {
    name: 'Fallen log',
    build: (b) => {
      const log = cylinderMesh(9, 0.3, 0.27, 2.2, rectOf('bark_oak'));
      b.spreadCaps(log, 0.3, 'trunk_cut');
      b.mesh('Log', [0, 0.3, 0], log, [0, 0, 90]);
    },
  },
  'big-mushroom': {
    name: 'Giant mushroom',
    build: (b) => {
      b.mesh('Stem', [0, 0.5, 0], cylinderMesh(8, 0.2, 0.15, 1.0, rectOf('mush_stem')));
      b.mesh('Cap', [0, 1.28, 0], domeMesh(0.8, 10, 3, rectOf('mush_cap')), [0, 0, 0], null, true);
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
