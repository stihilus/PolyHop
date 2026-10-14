// A project for the tests that need something to stand on and walk through: the default project (a blank one) with a
// small test level in place of its empty one, and the pickup models and counters that level uses.

import { ITEMS_ATLAS, ITEM_MODEL_IDS, type ItemKind, TILE, createItemModel } from '../src/core/items';
import { boxMesh, meshBounds, rockMesh, wedgeMesh } from '../src/core/mesh';
import { type PresetKind, missingVariables, presetRules, presetVariables } from '../src/core/presets';
import {
  type LevelModelInstance,
  type LevelObject,
  type Project,
  type TileRef,
  type Vec3,
  createBlock,
  createDefaultProject,
  createLevelData,
  newId,
} from '../src/core/types';

const ATLAS = 'Textures-16.png';

function block(name: string, position: Vec3, size: Vec3, tile: [number, number] | null, collide = true) {
  const t: TileRef | null = tile ? { texture: ATLAS, col: tile[0], row: tile[1] } : null;
  const b = createBlock(name, position, boxMesh(size), t);
  b.collide = collide;
  return b;
}

/** A small test level: ground, stairs, floating platforms, crates, a crouch tunnel and a tall wall. */
export function testLevel(): LevelObject[] {
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

/** The default project with the test level (spawn 8 m back, looking at the stairs) as its only level. */
export function createTestProject(): Project {
  const p = createDefaultProject();
  p.models.push(
    createItemModel('coin', newId),
    createItemModel('key', newId),
    createItemModel('apple', newId),
    createItemModel('flag', newId),
    createItemModel('trophy', newId),
  );
  for (const kind of ['coin', 'key', 'apple'] as const) p.variables.push(...missingVariables(p.variables, presetVariables(kind), newId));
  p.levels = [createLevelData('Level 1', testLevel(), [0, 0.05, 8], 180)];
  return p;
}

