import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../src/core/mesh';
import { type LevelObject, createBlock, createModel, createModelInstance } from '../src/core/types';
import { Store } from '../src/editor/store';
import { multiObjectTarget } from '../src/editor/shapeTargets';
import type { TransformDelta } from '../src/editor/gizmo';
import { createTestProject } from './helpers';

const delta = (over: Partial<TransformDelta> = {}): TransformDelta => ({
  translate: new THREE.Vector3(),
  rotate: new THREE.Quaternion(),
  scale: new THREE.Vector3(1, 1, 1),
  ...over,
});
const hooks = () => {
  const calls = { transform: 0, geometry: 0, commit: 0 };
  return {
    calls,
    h: {
      onTransform: () => void calls.transform++,
      onGeometry: () => void calls.geometry++,
      onCommit: () => void calls.commit++,
    },
  };
};

describe('selecting several objects', () => {
  const make = () => {
    const store = new Store(createTestProject());
    return { store, ids: store.objects.slice(0, 5).map((o) => o.id) };
  };

  it('toggles objects in and out; the one clicked last is the active one', () => {
    const { store, ids } = make();
    store.select({ kind: 'object', id: ids[0]! });
    store.toggleObject(ids[1]!);
    store.toggleObject(ids[2]!);
    expect(store.selectedIds()).toEqual([ids[2], ids[1], ids[0]]);
    expect(store.selection).toEqual({ kind: 'object', id: ids[2] });
    store.toggleObject(ids[0]!);
    expect(store.selectedIds().sort()).toEqual([ids[1]!, ids[2]!].sort());
    store.toggleObject(ids[1]!);
    store.toggleObject(ids[2]!);
    expect(store.selection.kind).toBe('none');
    expect(store.selectedIds()).toEqual([]);
  });

  it('selects a list, ignoring ids that do not exist, and a plain select starts over', () => {
    const { store, ids } = make();
    store.selectObjects([ids[3]!, 'nope', ids[1]!, ids[3]!]);
    expect(store.selectedIds()).toEqual([ids[3], ids[1]]);
    expect(store.isSelected(ids[1]!)).toBe(true);
    store.select({ kind: 'object', id: ids[0]! });
    expect(store.selectedIds()).toEqual([ids[0]]);
    expect(store.isSelected(ids[1]!)).toBe(false);
  });

  it('removes all selected objects in one undo step', () => {
    const { store, ids } = make();
    const before = store.objects.length;
    store.selectObjects(ids.slice(0, 3));
    store.removeObjects(store.selectedIds());
    expect(store.objects).toHaveLength(before - 3);
    expect(store.selection.kind).toBe('none');
    store.undoLevel();
    expect(store.objects).toHaveLength(before);
  });

  it('duplicates all of them, selects the copies and keeps rules pointing inside the copies', () => {
    const store = new Store(createTestProject());
    const door = store.objects.find((o) => o.name === 'Door')!;
    const coin = store.objects.find((o) => o.name === 'Coin 1')!;
    coin.rules = [{ id: 'r1', event: 'touch', conditions: [], actions: [{ type: 'move', target: door.id, offset: [0, 1, 0], seconds: 1 }] }];
    const before = store.objects.length;
    store.duplicateObjects([door.id, coin.id]);
    expect(store.objects).toHaveLength(before + 2);
    const ids = store.selectedIds();
    expect(ids).toHaveLength(2);
    const copyCoin = store.objects.find((o) => ids.includes(o.id) && o.name === 'Coin 1 copy')!;
    const copyDoor = store.objects.find((o) => ids.includes(o.id) && o.name === 'Door copy')!;
    const a = copyCoin.rules[0]!.actions[0]!;
    expect(a.type === 'move' && a.target).toBe(copyDoor.id);
    // the original still points at the original door
    const orig = coin.rules[0]!.actions[0]!;
    expect(orig.type === 'move' && orig.target).toBe(door.id);
  });

  it('switching level drops the multi selection', () => {
    const { store, ids } = make();
    store.selectObjects(ids);
    store.addLevel();
    expect(store.selectedIds()).toEqual([]);
  });
});

describe('moving several objects together', () => {
  const objects = (): LevelObject[] => [
    createBlock('A', [0, 0, 0], boxMesh([2, 2, 2]), null),
    createBlock('B', [4, 0, 0], boxMesh([2, 2, 2]), null),
    createModelInstance(createModel('M', null), [2, 0, 4]),
  ];

  it('the gizmo sits in the middle and translation moves all', () => {
    const objs = objects();
    const { h, calls } = hooks();
    const t = multiObjectTarget(objs, h);
    expect(t.pivot().toArray()).toEqual([2, 0, 4 / 3]);
    t.begin();
    t.apply(delta({ translate: new THREE.Vector3(1, 2, 3) }));
    expect(objs.map((o) => o.position)).toEqual([
      [1, 2, 3],
      [5, 2, 3],
      [3, 2, 7],
    ]);
    t.end();
    expect(calls).toEqual({ transform: 1, geometry: 0, commit: 1 });
  });

  it('rotating turns the group around its center and each object by the same angle', () => {
    const objs = [createBlock('A', [-2, 0, 0], boxMesh([1, 1, 1]), null), createBlock('B', [2, 0, 0], boxMesh([1, 1, 1]), null)];
    const { h } = hooks();
    const t = multiObjectTarget(objs, h);
    t.begin();
    t.apply(delta({ rotate: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) }));
    // a quarter turn about Y sends +x to -z
    expect(objs[1]!.position[0]).toBeCloseTo(0);
    expect(objs[1]!.position[2]).toBeCloseTo(-2);
    expect(objs[0]!.position[2]).toBeCloseTo(2);
    expect(objs[0]!.rotation[1]).toBeCloseTo(90);
    expect(objs[1]!.rotation[1]).toBeCloseTo(90);
  });

  it('scaling spreads the group and stretches each object', () => {
    const objs = objects();
    const { h, calls } = hooks();
    const t = multiObjectTarget(objs, h);
    t.begin();
    t.apply(delta({ scale: new THREE.Vector3(2, 2, 2) }));
    expect(calls.geometry).toBe(1);
    const a = objs[0]!;
    const b = objs[1]!;
    expect(b.position[0] - a.position[0]).toBeCloseTo(8);
    expect(a.kind === 'block' && Math.max(...a.mesh.verts.map((v) => v[0]))).toBeCloseTo(2);
    const m = objs[2]!;
    expect(m.kind === 'model' && m.scale).toEqual([2, 2, 2]);
  });

  it('applying again from the start of a drag does not add up', () => {
    const objs = objects();
    const { h } = hooks();
    const t = multiObjectTarget(objs, h);
    t.begin();
    t.apply(delta({ translate: new THREE.Vector3(1, 0, 0) }));
    t.apply(delta({ translate: new THREE.Vector3(1, 0, 0) }));
    expect(objs[0]!.position[0]).toBe(1);
  });
});
