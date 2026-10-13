// Built-in prop models (trees, ores, furniture, gems, ...) drawn with the tiles of assets/textures/Props-16.png
// (made by tools/make-props.py). They are in every project's Models list and are ordinary models after
// that: re-texture them, change their cubes, animate them.

import { meshBounds, rockMesh, tuftMesh } from './mesh';
import { cylinderMesh, domeMesh, sphereMesh } from './meshGen';
import { type Look as LookOf, ModelBuilder } from './modelBuilder';
import type { Model, Vec3 } from './types';

export const PROPS_ATLAS = 'Props-16.png';

/** The tiles of the atlas, row by row, 16 to a row. Keep in step with NAMES in tools/make-props.py. */
export const PROP_TILE_NAMES = [
  'bark', 'log_end', 'leaves', 'pine', 'birch_bark', 'birch_leaves', 'planks', 'planks_dark', 'mushroom_cap', 'mushroom_stem', 'pumpkin', 'pumpkin_top', 'cactus', 'hay', 'rope', 'moss',
  'stone', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'ruby_ore', 'copper_ore', 'cobble_mossy', 'brick_dark', 'obsidian', 'metal_plate', 'gold_block', 'dark_metal', 'gravestone', 'lava',
  'chest_front', 'chest_side', 'chest_top', 'barrel_side', 'barrel_top', 'crate', 'bookshelf', 'cloth_red', 'cloth_blue', 'cloth_green', 'torch_wood', 'flame', 'lantern', 'candle', 'pillow', 'blanket',
  'ruby', 'emerald', 'sapphire', 'amethyst', 'diamond', 'potion_red', 'potion_blue', 'potion_green', 'cork', 'water', 'slime', 'snow', 'ice', 'sand', 'dirt', 'wool_white',
  'poppy', 'cornflower', 'dandelion', 'daisy', 'tall_grass', 'fern', 'sapling', 'wheat', 'tulip', 'rose_bush', 'sunflower', 'lily', 'clover', 'reed', 'blank', 'blank',
] as const;
export type PropTile = (typeof PROP_TILE_NAMES)[number];

const COLS = 16;
const TILE = 16;

/** Column and row of a tile in the atlas. */
export function propTilePos(tile: PropTile): { col: number; row: number } {
  const i = PROP_TILE_NAMES.indexOf(tile);
  return { col: i % COLS, row: Math.floor(i / COLS) };
}

const rectOf = (tile: PropTile) => {
  const { col, row } = propTilePos(tile);
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
};

type Idgen = () => string;
type Builder = ModelBuilder<PropTile>;
type Look = LookOf<PropTile>;

/** Planes crossing like a "+", turned 45 degrees: a sprite that reads from every side. */
function sprite(b: Builder, name: string, tile: PropTile, size: number, height = size): void {
  const mesh = tuftMesh(size, rectOf(tile));
  if (height !== size) mesh.verts = mesh.verts.map((v) => [v[0], v[1] * (height / size), v[2]] as Vec3);
  b.mesh(name, [0, height / 2, 0], mesh, [0, 45, 0]);
}

/** A slow spin and bob for things that should catch the eye. */
function spinAll(b: Builder, seconds: number): void {
  const root = b.bone('Root', [0, 0.4, 0]);
  for (const c of b.cubes) c.bone = root;
  b.clip('spin', seconds, true, {
    Root: {
      rot: [
        { t: 0, v: [0, 0, 0] },
        { t: seconds / 2, v: [0, 180, 0] },
        { t: seconds, v: [0, 360, 0] },
      ],
      pos: [
        { t: 0, v: [0, 0, 0] },
        { t: seconds / 4, v: [0, 0.06, 0] },
        { t: seconds / 2, v: [0, 0, 0] },
        { t: (seconds * 3) / 4, v: [0, -0.06, 0] },
        { t: seconds, v: [0, 0, 0] },
      ],
    },
  });
}

/** A flame that jumps about: turns a little and bobs. `flame` is the bone of the fire cube. */
function flicker(b: Builder, bone: string): void {
  b.clip('flicker', 0.8, true, {
    [b.bones.find((x) => x.id === bone)!.name]: {
      rot: [
        { t: 0, v: [0, 0, 0] },
        { t: 0.2, v: [0, 40, 0] },
        { t: 0.4, v: [0, 90, 0] },
        { t: 0.6, v: [0, 50, 0] },
        { t: 0.8, v: [0, 0, 0] },
      ],
      pos: [
        { t: 0, v: [0, 0, 0] },
        { t: 0.2, v: [0, 0.025, 0] },
        { t: 0.4, v: [0, -0.01, 0] },
        { t: 0.6, v: [0, 0.03, 0] },
        { t: 0.8, v: [0, 0, 0] },
      ],
    },
  });
}

/** The recipes. Origin = the middle of the feet, +Z = the front. Sizes are in meters. */
const RECIPES: Record<string, { name: string; build: (b: Builder) => void }> = {
  // ---------------------------------------------------------------- characters
  slime: {
    name: 'Slime',
    build: (b) => {
      // a wobbling blob with eyes: the body squashes and stretches (position bob) in a loop
      const body = b.bone('Body', [0, 0, 0]);
      b.mesh('Body', [0, 0.1, 0], domeMesh(0.5, 10, 4, rectOf('slime')), [0, 0, 0], body, true);
      b.box('Eye', [-0.17, 0.32, 0.4], [0.12, 0.14, 0.06], 'snow', [0, 0, 0], body);
      b.box('Eye 2', [0.17, 0.32, 0.4], [0.12, 0.14, 0.06], 'snow', [0, 0, 0], body);
      b.box('Pupil', [-0.17, 0.3, 0.44], [0.06, 0.08, 0.03], 'dark_metal', [0, 0, 0], body);
      b.box('Pupil 2', [0.17, 0.3, 0.44], [0.06, 0.08, 0.03], 'dark_metal', [0, 0, 0], body);
      b.clip('hop', 0.9, true, {
        Body: {
          pos: [
            { t: 0, v: [0, 0, 0] },
            { t: 0.25, v: [0, 0.18, 0] },
            { t: 0.45, v: [0, 0, 0] },
            { t: 0.9, v: [0, 0, 0] },
          ],
          rot: [
            { t: 0, v: [0, 0, 0] },
            { t: 0.25, v: [-8, 0, 0] },
            { t: 0.45, v: [6, 0, 0] },
            { t: 0.9, v: [0, 0, 0] },
          ],
        },
      });
    },
  },
  villager: {
    name: 'Villager',
    build: (b) => {
      const sway = b.bone('Body', [0, 0, 0]);
      b.mesh('Robe', [0, 0.55, 0], cylinderMesh(10, 0.42, 0.27, 1.1, rectOf('cloth_blue')), [0, 0, 0], sway);
      b.mesh('Head', [0, 1.38, 0], sphereMesh(0.24, 8, 5, rectOf('wool_white')), [0, 0, 0], sway, true);
      b.box('Nose', [0, 1.35, 0.25], [0.07, 0.1, 0.1], 'sand', [0, 0, 0], sway);
      b.box('Eye', [-0.09, 1.42, 0.21], [0.05, 0.05, 0.03], 'dark_metal', [0, 0, 0], sway);
      b.box('Eye 2', [0.09, 1.42, 0.21], [0.05, 0.05, 0.03], 'dark_metal', [0, 0, 0], sway);
      b.mesh('Hat', [0, 1.68, 0], cylinderMesh(8, 0.26, 0, 0.5, rectOf('cloth_red')), [0, 0, 0], sway);
      b.box('Brim', [0, 1.45, 0], [0.62, 0.05, 0.62], 'cloth_red', [0, 0, 0], sway);
      b.box('Arm', [-0.4, 0.95, 0.05], [0.14, 0.5, 0.14], 'cloth_blue', [0, 0, 15], sway);
      b.box('Arm 2', [0.4, 0.95, 0.05], [0.14, 0.5, 0.14], 'cloth_blue', [0, 0, -15], sway);
      b.clip('idle', 2.4, true, {
        Body: {
          rot: [
            { t: 0, v: [0, 0, 0] },
            { t: 0.6, v: [0, 0, 2] },
            { t: 1.8, v: [0, 0, -2] },
            { t: 2.4, v: [0, 0, 0] },
          ],
          pos: [
            { t: 0, v: [0, 0, 0] },
            { t: 1.2, v: [0, 0.02, 0] },
            { t: 2.4, v: [0, 0, 0] },
          ],
        },
      });
    },
  },

  // ---------------------------------------------------------------- nature
  bush: {
    name: 'Bush',
    build: (b) => {
      b.box('Leaves', [0, 0.4, 0], [1.1, 0.8, 1.1], 'leaves');
      b.box('Leaves 2', [0.25, 0.9, 0.1], [0.6, 0.4, 0.6], 'leaves');
    },
  },
  mushroom: {
    name: 'Mushroom',
    build: (b) => {
      b.box('Stem', [0, 0.25, 0], [0.22, 0.5, 0.22], 'mushroom_stem');
      b.box('Cap', [0, 0.6, 0], [0.8, 0.2, 0.8], 'mushroom_cap');
      b.box('Cap top', [0, 0.78, 0], [0.5, 0.16, 0.5], 'mushroom_cap');
    },
  },
  cactus: {
    name: 'Cactus',
    build: (b) => {
      b.box('Body', [0, 0.8, 0], [0.5, 1.6, 0.5], 'cactus');
      b.box('Arm', [0.4, 0.75, 0], [0.3, 0.3, 0.3], 'cactus');
      b.box('Arm up', [0.5, 1.05, 0], [0.3, 0.6, 0.3], 'cactus');
    },
  },
  pumpkin: {
    name: 'Pumpkin',
    build: (b) => {
      b.box('Body', [0, 0.4, 0], [0.9, 0.8, 0.9], { side: 'pumpkin', top: 'pumpkin_top', bottom: 'pumpkin_top' });
      b.box('Stem', [0, 0.9, 0], [0.14, 0.2, 0.14], 'bark');
    },
  },
  'hay-bale': {
    name: 'Hay bale',
    build: (b) => {
      b.box('Bale', [0, 0.4, 0], [1.1, 0.8, 0.8], 'hay');
    },
  },
  boulder: {
    name: 'Boulder',
    build: (b) => {
      const mesh = rockMesh(7, 1.3, rectOf('stone'));
      b.mesh('Rock', [0, -meshBounds(mesh).min[1], 0], mesh);
    },
  },
  'mossy-boulder': {
    name: 'Mossy boulder',
    build: (b) => {
      const mesh = rockMesh(3, 1.1, rectOf('cobble_mossy'));
      b.mesh('Rock', [0, -meshBounds(mesh).min[1], 0], mesh);
    },
  },
  poppy: { name: 'Poppy', build: (b) => sprite(b, 'Flower', 'poppy', 0.8) },
  cornflower: { name: 'Cornflower', build: (b) => sprite(b, 'Flower', 'cornflower', 0.8) },
  dandelion: { name: 'Dandelion', build: (b) => sprite(b, 'Flower', 'dandelion', 0.8) },
  daisy: { name: 'Daisy', build: (b) => sprite(b, 'Flower', 'daisy', 0.8) },
  tulip: { name: 'Tulip', build: (b) => sprite(b, 'Flower', 'tulip', 0.8) },
  sunflower: { name: 'Sunflower', build: (b) => sprite(b, 'Flower', 'sunflower', 1.3) },
  'tall-grass': { name: 'Tall grass', build: (b) => sprite(b, 'Grass', 'tall_grass', 1.0) },
  fern: { name: 'Fern', build: (b) => sprite(b, 'Fern', 'fern', 1.0) },
  sapling: { name: 'Sapling', build: (b) => sprite(b, 'Sapling', 'sapling', 0.9) },
  wheat: { name: 'Wheat', build: (b) => sprite(b, 'Wheat', 'wheat', 1.0) },
  'rose-bush': { name: 'Rose bush', build: (b) => sprite(b, 'Bush', 'rose_bush', 1.0) },
  reeds: { name: 'Reeds', build: (b) => sprite(b, 'Reeds', 'reed', 1.4) },

  // ---------------------------------------------------------------- furniture and props
  crate: {
    name: 'Crate',
    build: (b) => {
      b.box('Crate', [0, 0.45, 0], [0.9, 0.9, 0.9], 'crate');
    },
  },
  barrel: {
    name: 'Barrel',
    build: (b) => {
      b.prism('Barrel', [0, 0.45, 0], 8, 0.42, 0.9, 'barrel_side', 'barrel_top');
    },
  },
  chest: {
    name: 'Chest',
    build: (b) => {
      const root = b.bone('Base', [0, 0, 0]);
      const lid = b.bone('Lid', [0, 0.5, -0.3], root);
      const look: Look = { front: 'chest_front', side: 'chest_side', top: 'chest_top', bottom: 'planks_dark' };
      b.box('Base', [0, 0.25, 0], [0.9, 0.5, 0.6], look, [0, 0, 0], root);
      b.box('Lid', [0, 0.65, 0], [0.9, 0.3, 0.6], look, [0, 0, 0], lid);
      b.clip('open', 0.6, false, {
        Lid: {
          rot: [
            { t: 0, v: [0, 0, 0] },
            { t: 0.6, v: [-100, 0, 0] },
          ],
        },
      });
      b.clip('close', 0.5, false, {
        Lid: {
          rot: [
            { t: 0, v: [-100, 0, 0] },
            { t: 0.5, v: [0, 0, 0] },
          ],
        },
      });
    },
  },
  torch: {
    name: 'Torch',
    build: (b) => {
      b.box('Stick', [0, 0.35, 0], [0.12, 0.7, 0.12], 'torch_wood');
      const flame = b.bone('Flame', [0, 0.82, 0]);
      b.box('Flame', [0, 0.82, 0], [0.22, 0.24, 0.22], 'flame', [0, 0, 0], flame);
      flicker(b, flame);
    },
  },
  lantern: {
    name: 'Lantern',
    build: (b) => {
      b.box('Base', [0, 0.03, 0], [0.34, 0.06, 0.34], 'dark_metal');
      b.box('Glass', [0, 0.26, 0], [0.3, 0.4, 0.3], 'lantern');
      b.box('Cap', [0, 0.49, 0], [0.34, 0.06, 0.34], 'dark_metal');
      b.box('Handle', [0, 0.58, 0], [0.04, 0.12, 0.04], 'dark_metal');
    },
  },
  campfire: {
    name: 'Campfire',
    build: (b) => {
      for (const a of [0, 60, 120]) b.box('Log', [0, 0.1, 0], [1.0, 0.18, 0.18], { side: 'bark', top: 'log_end', bottom: 'bark' }, [0, a, 0]);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        b.box('Stone', [Math.cos(ang) * 0.6, 0.09, Math.sin(ang) * 0.6], [0.24, 0.18, 0.24], 'stone', [0, (i * 37) % 90, 0]);
      }
      b.box('Embers', [0, 0.2, 0], [0.34, 0.1, 0.34], 'lava');
      const flame = b.bone('Flame', [0, 0.45, 0]);
      b.box('Flame', [0, 0.45, 0], [0.4, 0.5, 0.4], 'flame', [0, 0, 0], flame);
      flicker(b, flame);
    },
  },
  fence: {
    name: 'Fence',
    build: (b) => {
      b.box('Post', [0, 0.5, 0], [0.18, 1.0, 0.18], 'planks_dark');
      b.box('Rail', [0, 0.78, 0], [1.0, 0.1, 0.08], 'planks');
      b.box('Rail 2', [0, 0.4, 0], [1.0, 0.1, 0.08], 'planks');
    },
  },
  bench: {
    name: 'Bench',
    build: (b) => {
      b.box('Seat', [0, 0.42, 0], [1.3, 0.1, 0.42], 'planks');
      b.box('Leg', [-0.55, 0.2, 0], [0.1, 0.4, 0.36], 'planks_dark');
      b.box('Leg 2', [0.55, 0.2, 0], [0.1, 0.4, 0.36], 'planks_dark');
      b.box('Back', [0, 0.75, -0.17], [1.3, 0.35, 0.07], 'planks');
    },
  },
  table: {
    name: 'Table',
    build: (b) => {
      b.box('Top', [0, 0.75, 0], [1.2, 0.1, 0.8], 'planks');
      for (const [x, z] of [
        [-0.5, -0.3],
        [0.5, -0.3],
        [-0.5, 0.3],
        [0.5, 0.3],
      ] as const) {
        b.box('Leg', [x, 0.35, z], [0.1, 0.7, 0.1], 'planks_dark');
      }
    },
  },
  bookshelf: {
    name: 'Bookshelf',
    build: (b) => {
      b.box('Shelf', [0, 0.9, 0], [0.9, 1.8, 0.4], { front: 'bookshelf', side: 'planks_dark', top: 'planks', bottom: 'planks' });
    },
  },
  well: {
    name: 'Well',
    build: (b) => {
      b.box('Wall', [0, 0.35, 0.5], [1.2, 0.7, 0.2], 'cobble_mossy');
      b.box('Wall 2', [0, 0.35, -0.5], [1.2, 0.7, 0.2], 'cobble_mossy');
      b.box('Wall 3', [-0.5, 0.35, 0], [0.2, 0.7, 0.8], 'cobble_mossy');
      b.box('Wall 4', [0.5, 0.35, 0], [0.2, 0.7, 0.8], 'cobble_mossy');
      b.box('Water', [0, 0.5, 0], [0.8, 0.04, 0.8], 'water');
      b.box('Post', [-0.5, 1.2, 0], [0.1, 1.0, 0.1], 'planks_dark');
      b.box('Post 2', [0.5, 1.2, 0], [0.1, 1.0, 0.1], 'planks_dark');
      b.box('Roof', [0, 1.75, 0], [1.5, 0.12, 0.9], 'planks_dark');
      b.box('Roof top', [0, 1.87, 0], [1.0, 0.12, 0.6], 'planks_dark');
    },
  },
  anvil: {
    name: 'Anvil',
    build: (b) => {
      b.box('Base', [0, 0.1, 0], [0.5, 0.2, 0.35], 'dark_metal');
      b.box('Waist', [0, 0.3, 0], [0.28, 0.2, 0.28], 'dark_metal');
      b.box('Top', [0, 0.52, 0], [0.8, 0.24, 0.36], 'dark_metal');
      b.box('Horn', [0.5, 0.52, 0], [0.25, 0.14, 0.2], 'dark_metal');
    },
  },
  gravestone: {
    name: 'Gravestone',
    build: (b) => {
      b.box('Base', [0, 0.1, 0.05], [0.9, 0.2, 0.5], 'stone');
      b.box('Slab', [0, 0.65, 0], [0.7, 1.1, 0.2], 'gravestone');
      b.box('Moss', [0.2, 1.0, 0.11], [0.25, 0.2, 0.02], 'moss');
    },
  },
  banner: {
    name: 'Banner',
    build: (b) => {
      b.box('Pole', [0, 1.3, 0], [0.1, 2.6, 0.1], 'planks_dark');
      b.box('Bar', [0, 2.45, 0], [0.9, 0.08, 0.08], 'planks_dark');
      const cloth = b.bone('Cloth', [0, 2.4, 0]);
      b.box('Cloth', [0, 1.85, 0], [0.8, 1.1, 0.03], 'cloth_red', [0, 0, 0], cloth);
      b.clip('sway', 3, true, {
        Cloth: {
          rot: [
            { t: 0, v: [0, 0, 0] },
            { t: 0.75, v: [6, 0, 2] },
            { t: 1.5, v: [0, 0, 0] },
            { t: 2.25, v: [-6, 0, -2] },
            { t: 3, v: [0, 0, 0] },
          ],
        },
      });
    },
  },
  signpost: {
    name: 'Signpost',
    build: (b) => {
      b.box('Pole', [0, 0.8, 0], [0.14, 1.6, 0.14], { side: 'bark', top: 'log_end', bottom: 'log_end' });
      b.box('Board', [0.2, 1.35, 0.1], [0.9, 0.3, 0.06], 'planks');
      b.box('Board 2', [-0.2, 0.98, 0.1], [0.9, 0.3, 0.06], 'planks', [0, 8, 0]);
    },
  },
  'potion-red': { name: 'Red potion', build: (b) => potion(b, 'potion_red') },
  'potion-blue': { name: 'Blue potion', build: (b) => potion(b, 'potion_blue') },
  'potion-green': { name: 'Green potion', build: (b) => potion(b, 'potion_green') },
  bed: {
    name: 'Bed',
    build: (b) => {
      b.box('Frame', [0, 0.2, 0], [1.0, 0.25, 1.9], 'planks_dark');
      b.box('Mattress', [0, 0.37, 0], [0.9, 0.1, 1.8], 'pillow');
      b.box('Blanket', [0, 0.44, -0.25], [0.92, 0.1, 1.15], 'blanket');
      b.box('Pillow', [0, 0.46, 0.68], [0.6, 0.12, 0.35], 'pillow');
      b.box('Headboard', [0, 0.55, 0.97], [1.0, 0.7, 0.1], 'planks');
    },
  },
  candle: {
    name: 'Candle',
    build: (b) => {
      b.box('Wax', [0, 0.15, 0], [0.12, 0.3, 0.12], 'candle');
      const flame = b.bone('Flame', [0, 0.36, 0]);
      b.box('Flame', [0, 0.36, 0], [0.09, 0.12, 0.09], 'flame', [0, 0, 0], flame);
      flicker(b, flame);
    },
  },
  ruby: { name: 'Ruby crystals', build: (b) => crystals(b, 'ruby') },
  emerald: { name: 'Emerald crystals', build: (b) => crystals(b, 'emerald') },
  sapphire: { name: 'Sapphire crystals', build: (b) => crystals(b, 'sapphire') },
  amethyst: { name: 'Amethyst crystals', build: (b) => crystals(b, 'amethyst') },
  diamond: { name: 'Diamond crystals', build: (b) => crystals(b, 'diamond') },
  'lamp-post': {
    name: 'Lamp post',
    build: (b) => {
      b.box('Base', [0, 0.1, 0], [0.3, 0.2, 0.3], 'dark_metal');
      b.box('Pole', [0, 1.2, 0], [0.12, 2.4, 0.12], 'dark_metal');
      b.box('Arm', [0.2, 2.35, 0], [0.5, 0.08, 0.08], 'dark_metal');
      b.box('Lantern', [0.42, 2.15, 0], [0.22, 0.3, 0.22], 'lantern');
    },
  },
  snowman: {
    name: 'Snowman',
    build: (b) => {
      b.box('Body', [0, 0.4, 0], [0.9, 0.8, 0.9], 'snow');
      b.box('Chest', [0, 1.05, 0], [0.7, 0.55, 0.7], 'snow');
      b.box('Head', [0, 1.55, 0], [0.5, 0.45, 0.5], 'snow');
      b.box('Eye', [-0.12, 1.62, 0.26], [0.07, 0.07, 0.04], 'dark_metal');
      b.box('Eye 2', [0.12, 1.62, 0.26], [0.07, 0.07, 0.04], 'dark_metal');
      b.box('Nose', [0, 1.5, 0.36], [0.08, 0.08, 0.2], 'pumpkin');
      b.box('Arm', [-0.55, 1.15, 0], [0.5, 0.06, 0.06], 'torch_wood', [0, 0, 20]);
      b.box('Arm 2', [0.55, 1.15, 0], [0.5, 0.06, 0.06], 'torch_wood', [0, 0, -20]);
    },
  },
  scarecrow: {
    name: 'Scarecrow',
    build: (b) => {
      b.box('Post', [0, 0.9, 0], [0.12, 1.8, 0.12], 'planks_dark');
      b.box('Arms', [0, 1.35, 0], [1.3, 0.1, 0.1], 'planks_dark');
      b.box('Body', [0, 1.05, 0.02], [0.4, 0.6, 0.25], 'hay');
      b.box('Head', [0, 1.7, 0.02], [0.34, 0.34, 0.34], { side: 'pumpkin', top: 'pumpkin_top', bottom: 'pumpkin_top' });
      b.box('Hat brim', [0, 1.93, 0.02], [0.55, 0.05, 0.55], 'planks_dark');
      b.box('Hat', [0, 2.03, 0.02], [0.28, 0.16, 0.28], 'planks_dark');
    },
  },
};

function potion(b: Builder, tile: PropTile): void {
  b.box('Bottle', [0, 0.14, 0], [0.26, 0.28, 0.26], tile);
  b.box('Neck', [0, 0.34, 0], [0.12, 0.12, 0.12], tile);
  b.box('Cork', [0, 0.43, 0], [0.12, 0.07, 0.12], 'cork');
}

/** A cluster of three crystals on a bit of rock, turning slowly. */
function crystals(b: Builder, tile: PropTile): void {
  b.box('Rock', [0, 0.05, 0], [0.7, 0.1, 0.7], 'stone');
  b.prism('Crystal', [0, 0.5, 0], 6, 0.16, 0.8, tile, tile);
  b.prism('Crystal 2', [0.24, 0.32, 0.1], 6, 0.11, 0.5, tile, tile);
  b.cubes[b.cubes.length - 1]!.rotation = [0, 0, -18];
  b.prism('Crystal 3', [-0.22, 0.26, -0.12], 6, 0.09, 0.4, tile, tile);
  b.cubes[b.cubes.length - 1]!.rotation = [0, 0, 16];
  spinAll(b, 8);
}

/**
 * Props that shipped once and were taken out again (trees and ore blocks built from plain cubes). Projects
 * that have them and do not use them lose them when opened; used ones stay.
 */
export const RETIRED_PROP_IDS: readonly string[] = [
  'oak-tree',
  'pine-tree',
  'birch-tree',
  'coal-ore',
  'iron-ore',
  'copper-ore',
  'gold-ore',
  'diamond-ore',
  'emerald-ore',
  'ruby-ore',
  'gold-block',
  'obsidian',
  'lava-block',
].map((k) => `prop-${k}`);

export type PropKind = keyof typeof RECIPES;

export const PROP_KINDS = Object.keys(RECIPES) as PropKind[];
export const propModelId = (kind: string) => `prop-${kind}`;

/** The built-in prop model of a kind. */
export function createPropModel(kind: PropKind, idGen: Idgen): Model {
  const recipe = RECIPES[kind]!;
  const b: Builder = new ModelBuilder<PropTile>(idGen, rectOf, 'stone');
  recipe.build(b);
  return b.toModel(propModelId(kind), recipe.name, PROPS_ATLAS);
}

/** Every built-in prop model. */
export function builtInPropModels(idGen: Idgen): Model[] {
  return PROP_KINDS.map((k) => createPropModel(k, idGen));
}
