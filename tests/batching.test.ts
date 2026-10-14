import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Action, Rule } from '../src/core/logic';
import { boxMesh } from '../src/core/mesh';
import {
  type LevelBlock,
  type LevelModelInstance,
  createBlock,
  createMeshCube,
  createModel,
  createModelInstance,
  newId,
} from '../src/core/types';
import { collidersNear } from '../src/runtime/game';
import { Level, dynamicObjectIds } from '../src/runtime/level';
import { ModelLibrary } from '../src/runtime/modelRender';
import { TextureLibrary } from '../src/runtime/textures';
import type { Colliders } from '../src/runtime/collision';
import type { Model } from '../src/core/types';

const rule = (actions: Action[]): Rule => ({ id: newId(), event: 'touch', conditions: [], actions });

function setup(models: Model[] = []) {
  const textures = new TextureLibrary();
  const lib = new ModelLibrary((id) => models.find((m) => m.id === id), textures);
  return new Level(textures, lib);
}

const box = (x: number, z: number, color = '#ffffff') => {
  const b = createBlock('B', [x, 0.5, z], boxMesh([1, 1, 1]), null);
  b.color = color;
  return b;
};

const batchCount = (level: Level) => level.group.children.length;
const triangles = (level: Level) => {
  let n = 0;
  level.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) n += (m.geometry.index?.count ?? 0) / 3;
  });
  return n;
};

describe('which objects are left alone', () => {
  it('rules and the targets of rules stay individual', () => {
    const a = box(0, 0);
    const b = box(2, 0);
    const c = box(4, 0);
    const d = box(6, 0);
    a.rules = [rule([{ type: 'destroy' }])];
    b.rules = [rule([{ type: 'move', target: c.id, offset: [0, 1, 0], seconds: 1 }])];
    d.rules = [
      rule([{ type: 'choice', question: '?', options: [{ label: 'x', actions: [{ type: 'destroy', target: a.id }, { type: 'patrol', target: '', offset: [1, 0, 0], seconds: 1 }] }] }]),
    ];
    const ids = dynamicObjectIds([a, b, c, d, box(8, 0)]);
    expect([...ids].sort()).toEqual([a.id, b.id, c.id, d.id].sort());
  });
});

describe('a running level', () => {
  it('merges static blocks into a few meshes with the same triangles', () => {
    const level = setup();
    const blocks: LevelBlock[] = [];
    for (let i = 0; i < 60; i++) blocks.push(box(i * 0.5, 0, i % 2 ? '#ff0000' : '#00ff00'));
    level.rebuild(blocks, false);
    expect(batchCount(level)).toBe(60);
    const flat = triangles(level);
    level.rebuild(blocks, true);
    // two colors, all in one 32 m cell or two: a handful of meshes instead of 60
    expect(batchCount(level)).toBeLessThanOrEqual(6);
    expect(triangles(level)).toBe(flat);
  });

  it('keeps the blocks where they are (rotation and position are baked in)', () => {
    const level = setup();
    const b = createBlock('B', [5, 2, -3], boxMesh([2, 1, 1]), null);
    b.rotation = [0, 90, 0];
    level.rebuild([b], true);
    const mesh = level.group.children[0] as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    // 2 x 1 x 1 turned a quarter about Y: 1 wide in x, 2 deep in z, around (5, 2, -3)
    expect(bb.min.x).toBeCloseTo(4.5);
    expect(bb.max.x).toBeCloseTo(5.5);
    expect(bb.min.z).toBeCloseTo(-4);
    expect(bb.max.z).toBeCloseTo(-2);
    expect(bb.min.y).toBeCloseTo(1.5);
  });

  it('leaves dynamic and flowing objects as their own meshes, reachable by id', () => {
    const level = setup();
    const still = box(0, 0);
    const door = box(3, 0);
    door.rules = [rule([{ type: 'move', target: '', offset: [0, 2, 0], seconds: 1 }])];
    const water = box(6, 0);
    water.liquid = true;
    level.rebuild([still, door, water], true);
    expect(level.getMesh(door.id)).toBeDefined();
    expect(level.getMesh(water.id)).toBeDefined();
    expect(level.getMesh(still.id)).toBeUndefined();
    expect(batchCount(level)).toBe(3);
  });

  it('draws still model instances instanced, and animated ones on their own', () => {
    const crate = createModel('Crate', null);
    crate.cubes = [createMeshCube('c', [0, 0.5, 0], boxMesh([1, 1, 1]))];
    const level = setup([crate]);
    const objs: LevelModelInstance[] = [];
    for (let i = 0; i < 25; i++) objs.push(createModelInstance(crate, [i * 2, 0, 0]));
    // one that plays an animation (kept apart even without bones the flag matters)
    const animated = createModelInstance(crate, [0, 0, 6]);
    animated.animation = 'spin';
    level.rebuild([...objs, animated], true);
    const instanced = level.group.children.filter((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    expect(instanced.reduce((n, m) => n + m.count, 0)).toBe(25);
    expect(instanced.length).toBeLessThanOrEqual(3); // by 32 m cell
    expect(level.getMesh(animated.id)).toBeDefined();
  });

  it('a missing model is not batched', () => {
    const level = setup();
    const ghost = createModelInstance(createModel('Gone', null), [0, 0, 0]);
    level.rebuild([ghost], true);
    expect(level.getMesh(ghost.id)).toBeDefined();
  });

  it('rebuilding again replaces the batches', () => {
    const level = setup();
    level.rebuild([box(0, 0), box(1, 0)], true);
    level.rebuild([box(0, 0)], true);
    expect(batchCount(level)).toBe(1);
    level.rebuild([], true);
    expect(batchCount(level)).toBe(0);
  });
});

describe('what is near the player', () => {
  it('keeps the colliders around a point and drops the rest', () => {
    const c: Colliders = {
      boxes: [
        { minX: -1, maxX: 1, minY: 0, maxY: 1, minZ: -1, maxZ: 1 },
        { minX: 50, maxX: 52, minY: 0, maxY: 1, minZ: 0, maxZ: 2 },
        { minX: 7, maxX: 9, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
      ],
      meshes: [
        { tris: new Float32Array(9), min: [0, 0, 0], max: [3, 1, 3] },
        { tris: new Float32Array(9), min: [100, 0, 100], max: [104, 1, 104] },
      ],
      liquids: [{ minX: -100, maxX: 100, minY: -3, maxY: 0, minZ: -100, maxZ: 100 }],
    };
    const near = collidersNear(c, 0, 0, 8);
    expect(near.boxes).toHaveLength(2);
    expect(near.meshes).toHaveLength(1);
    expect(near.liquids).toHaveLength(1);
    expect(collidersNear(c, 51, 1, 3).boxes).toHaveLength(1);
  });
});

describe('a tile-mapped model that is animated', () => {
  it('is drawn from its rig and plays its clip, while a still one is drawn like a block', () => {
    const wheel = createModel('Wheel', 'Textures-16.png');
    wheel.mapping = 'tile';
    wheel.look = { tile: { col: 3, row: 3 }, tint: '#ffffff', doubleSided: true };
    const bone = { id: 'b1', name: 'Root', parent: null, pivot: [0, 0, 0] as [number, number, number] };
    wheel.bones = [bone];
    wheel.cubes[0]!.bone = 'b1';
    wheel.clips = [
      {
        id: 'c1',
        name: 'spin',
        duration: 2,
        loop: true,
        tracks: {
          Root: {
            rot: [
              { t: 0, v: [0, 0, 0] },
              { t: 1, v: [0, 180, 0] },
              { t: 2, v: [0, 360, 0] },
            ],
          },
        },
      },
    ];
    const level = setup([wheel]);
    const still = createModelInstance(wheel, [0, 0, 0]);
    const spinning = { ...createModelInstance(wheel, [4, 0, 0]), animation: 'spin' };
    level.rebuild([still, spinning]);
    const stillMesh = level.getMesh(still.id)!;
    const spinMesh = level.getMesh(spinning.id)!;
    // the still one is a block: its scale is in its points; the spinning one has a rig that animate() poses
    expect(stillMesh.userData.bakedScale).toBeDefined();
    expect(stillMesh.userData.rig).toBeUndefined();
    expect(spinMesh.userData.rig).toBeDefined();
    expect(spinMesh.userData.animation).toBe('spin');
    const rig = spinMesh.userData.rig as { root: THREE.Group };
    const before = rig.root.children[0]!.matrix.clone();
    level.animate(0.5);
    const after = rig.root.children[0]!.matrix;
    expect(after.equals(before)).toBe(false);
    // batched in a running game: the animated one stays out of the batches
    level.rebuild([still, spinning], true);
    expect(level.getMesh(spinning.id)).toBeDefined();
  });
});
