// The built-in character props (Slime, Villager), drawn with the tiles of assets/textures/Props-16.png
// (made by tools/make-props.py). The atlas itself stays, with all its tiles, for anyone to build with. The two
// models are in every new project's Models (and are made again when their Enemy / NPC game object is placed, see
// ensurePresetAssets) and are ordinary models after that: re-texture them, change their cubes, animate them. Like
// all built-in models they are made of cubes and quads only, as the Hytale modeling guide asks (see hytaleStyle.ts).

import { ModelBuilder } from './modelBuilder';
import type { Model } from './types';

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

/** The recipes. Origin = the middle of the feet, +Z = the front. Sizes are in meters. */
const RECIPES: Record<string, { name: string; build: (b: Builder) => void }> = {
  // ---------------------------------------------------------------- characters
  slime: {
    name: 'Slime',
    build: (b) => {
      // a wobbling jelly with eyes: the body squashes and stretches (position bob) in a loop
      const body = b.bone('Body', [0, 0, 0]);
      b.box('Body', [0, 0.1, 0], [1.0, 0.5, 0.95], 'slime', [0, 0, 0], body);
      b.box('Top', [0, 0.36, -0.02], [0.64, 0.22, 0.6], 'slime', [0, 12, 0], body);
      b.box('Eye', [-0.17, 0.2, 0.48], [0.14, 0.16, 0.06], 'snow', [0, 0, 0], body);
      b.box('Eye 2', [0.17, 0.2, 0.48], [0.14, 0.16, 0.06], 'snow', [0, 0, 0], body);
      b.box('Pupil', [-0.17, 0.18, 0.51], [0.07, 0.09, 0.04], 'dark_metal', [0, 0, 0], body);
      b.box('Pupil 2', [0.17, 0.18, 0.51], [0.07, 0.09, 0.04], 'dark_metal', [0, 0, 0], body);
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
      b.box('Robe', [0, 0.3, 0], [0.72, 0.6, 0.56], 'cloth_blue', [0, 0, 0], sway);
      b.box('Robe 2', [0, 0.82, 0], [0.58, 0.5, 0.46], 'cloth_blue', [0, 0, 0], sway);
      b.box('Head', [0, 1.3, 0], [0.5, 0.5, 0.5], 'wool_white', [0, 0, 0], sway);
      b.box('Nose', [0, 1.26, 0.28], [0.09, 0.12, 0.1], 'sand', [0, 0, 0], sway);
      b.box('Eye', [-0.11, 1.35, 0.26], [0.07, 0.07, 0.04], 'dark_metal', [0, 0, 0], sway);
      b.box('Eye 2', [0.11, 1.35, 0.26], [0.07, 0.07, 0.04], 'dark_metal', [0, 0, 0], sway);
      b.box('Brim', [0, 1.57, 0], [0.7, 0.07, 0.7], 'cloth_red', [0, 0, 0], sway);
      b.box('Hat', [0, 1.74, 0], [0.46, 0.28, 0.46], 'cloth_red', [0, 0, 0], sway);
      b.box('Hat top', [0, 1.98, 0], [0.26, 0.22, 0.26], 'cloth_red', [0, 12, 0], sway);
      b.box('Arm', [-0.44, 0.85, 0.05], [0.16, 0.55, 0.16], 'cloth_blue', [0, 0, 15], sway);
      b.box('Arm 2', [0.44, 0.85, 0.05], [0.16, 0.55, 0.16], 'cloth_blue', [0, 0, -15], sway);
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
};

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
