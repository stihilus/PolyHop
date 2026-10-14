// Models of the built-in pickups, drawn with the tiles of assets/textures/Items-16.png. They are made
// the first time a Coin, Key, Apple, Checkpoint or Goal is added, and are ordinary models after that. Cubes only
// (a coin is two thin cubes, one turned 45 degrees), as the Hytale modeling guide asks (see hytaleStyle.ts).

import { type MeshData, boxMesh } from './mesh';
import type { Model, ModelCube, Vec3 } from './types';

export const ITEMS_ATLAS = 'Items-16.png';

/** Column of each tile in the atlas (row 0). */
export const TILE = { coin: 0, coinEdge: 1, key: 2, apple: 3, stem: 4, leaf: 5, hazard: 6, flag: 7 } as const;

const rect = (col: number) => ({ x: col * 16, y: 0, w: 16, h: 16 });

export type ItemKind = 'coin' | 'key' | 'apple' | 'flag' | 'trophy';

export const ITEM_MODEL_IDS: Record<ItemKind, string> = {
  coin: 'item-coin',
  key: 'item-key',
  apple: 'item-apple',
  flag: 'item-flag',
  trophy: 'item-trophy',
};

type Idgen = () => string;

function cube(idGen: Idgen, name: string, position: Vec3, mesh: MeshData, rotation: Vec3 = [0, 0, 0], bone: string | null = null): ModelCube {
  return { id: idGen(), name, position, rotation, mesh, bone };
}

/** One bone that turns the whole item, with a looping spin (and a gentle bob). */
function spinning(idGen: Idgen, cubes: ModelCube[], center: Vec3, seconds: number): Pick<Model, 'bones' | 'clips'> {
  const boneId = idGen();
  for (const c of cubes) c.bone = boneId;
  return {
    bones: [{ id: boneId, name: 'Root', parent: null, pivot: center }],
    clips: [
      {
        id: idGen(),
        name: 'spin',
        duration: seconds,
        loop: true,
        smooth: true,
        tracks: {
          Root: {
            rot: [
              { t: 0, v: [0, 0, 0] },
              { t: seconds / 2, v: [0, 180, 0] },
              { t: seconds, v: [0, 360, 0] },
            ],
            pos: [
              { t: 0, v: [0, 0, 0] },
              { t: seconds / 4, v: [0, 0.05, 0] },
              { t: seconds / 2, v: [0, 0, 0] },
              { t: (seconds * 3) / 4, v: [0, -0.05, 0] },
              { t: seconds, v: [0, 0, 0] },
            ],
          },
        },
      },
    ],
  };
}

export function createItemModel(kind: ItemKind, idGen: Idgen): Model {
  const base = { id: ITEM_MODEL_IDS[kind], texture: ITEMS_ATLAS };
  switch (kind) {
    case 'coin': {
      // a disc: a thin cube and a second one turned 45 degrees (an eight-sided coin), standing on its edge
      const parts = [
        cube(idGen, 'Coin', [0, 0.5, 0], boxMesh([0.46, 0.46, 0.07], null, null, rect(TILE.coin))),
        cube(idGen, 'Coin turned', [0, 0.5, 0], boxMesh([0.46, 0.46, 0.06], null, null, rect(TILE.coin)), [0, 0, 45]),
      ];
      return { ...base, name: 'Coin', cubes: parts, ...spinning(idGen, parts, [0, 0.5, 0], 1.4) };
    }
    case 'key': {
      const parts = [
        cube(idGen, 'Ring', [0, 0.78, 0], boxMesh([0.22, 0.22, 0.06], null, null, rect(TILE.key))),
        cube(idGen, 'Shaft', [0, 0.5, 0], boxMesh([0.07, 0.4, 0.06], null, null, rect(TILE.key))),
        cube(idGen, 'Tooth', [0.08, 0.36, 0], boxMesh([0.1, 0.07, 0.06], null, null, rect(TILE.key))),
        cube(idGen, 'Tooth 2', [0.07, 0.27, 0], boxMesh([0.08, 0.07, 0.06], null, null, rect(TILE.key))),
      ];
      return { ...base, name: 'Key', cubes: parts, ...spinning(idGen, parts, [0, 0.52, 0], 1.6) };
    }
    case 'apple': {
      const parts = [
        cube(idGen, 'Apple', [0, 0.34, 0], boxMesh([0.46, 0.4, 0.46], null, null, rect(TILE.apple)), [0, 20, 0]),
        cube(idGen, 'Apple top', [0, 0.58, 0], boxMesh([0.4, 0.16, 0.4], null, null, rect(TILE.apple)), [0, 50, 0]),
        cube(idGen, 'Apple bottom', [0, 0.17, 0], boxMesh([0.34, 0.14, 0.34], null, null, rect(TILE.apple)), [0, 35, 0]),
        cube(idGen, 'Stem', [0, 0.72, 0], boxMesh([0.06, 0.14, 0.06], null, null, rect(TILE.stem))),
        cube(idGen, 'Leaf', [0.1, 0.74, 0], boxMesh([0.16, 0.04, 0.09], null, null, rect(TILE.leaf)), [0, 0, 18]),
      ];
      return { ...base, name: 'Apple', cubes: parts, ...spinning(idGen, parts, [0, 0.4, 0], 3) };
    }
    case 'trophy': {
      // a golden cup on a small base, slowly turning: the goal of a level
      const parts = [
        cube(idGen, 'Base', [0, 0.06, 0], boxMesh([0.5, 0.12, 0.5], null, null, rect(TILE.coinEdge))),
        cube(idGen, 'Stem', [0, 0.28, 0], boxMesh([0.12, 0.32, 0.12], null, null, rect(TILE.coin))),
        cube(idGen, 'Cup foot', [0, 0.5, 0], boxMesh([0.3, 0.14, 0.3], null, null, rect(TILE.coin))),
        cube(idGen, 'Cup', [0, 0.69, 0], boxMesh([0.5, 0.26, 0.5], null, null, rect(TILE.coin))),
        cube(idGen, 'Handle', [0.33, 0.64, 0], boxMesh([0.1, 0.22, 0.06], null, null, rect(TILE.coinEdge))),
        cube(idGen, 'Handle 2', [-0.33, 0.64, 0], boxMesh([0.1, 0.22, 0.06], null, null, rect(TILE.coinEdge))),
      ];
      return { ...base, name: 'Goal', cubes: parts, ...spinning(idGen, parts, [0, 0.4, 0], 4) };
    }
    case 'flag': {
      const parts = [
        cube(idGen, 'Pole', [0, 0.8, 0], boxMesh([0.08, 1.6, 0.08], null, null, rect(TILE.stem))),
        cube(idGen, 'Cloth', [0.3, 1.4, 0], boxMesh([0.5, 0.32, 0.04], null, null, rect(TILE.flag))),
      ];
      return { ...base, name: 'Checkpoint', cubes: parts, bones: [], clips: [] };
    }
  }
}
