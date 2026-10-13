import { describe, expect, it } from 'vitest';
import { KIT_ATLAS, KIT_KINDS, KIT_TILE_NAMES, builtInKitModels, createKitModel, kitModelId, kitTilePos } from '../src/core/kit';
import { isValidMesh } from '../src/core/mesh';
import { createDefaultProject, normalizeModel, normalizeProject } from '../src/core/types';
import { modelBounds } from '../src/runtime/modelRender';

let n = 0;
const ids = () => `k${++n}`;
const ATLAS_W = 256;
const ATLAS_H = 80;

describe('building kit and modeled trees', () => {
  it('there are plenty, with unique ids and names', () => {
    const models = builtInKitModels(ids);
    expect(models.length).toBeGreaterThanOrEqual(30);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
    expect(new Set(models.map((m) => m.name)).size).toBe(models.length);
    expect(models.every((m) => m.id.startsWith('kit-') && m.texture === KIT_ATLAS)).toBe(true);
  });

  it('every model is valid, inside the atlas, and stands on the ground', () => {
    for (const kind of KIT_KINDS) {
      const m = createKitModel(kind, ids);
      expect(m.cubes.length, kind).toBeGreaterThan(0);
      for (const c of m.cubes) {
        expect(isValidMesh(c.mesh), `${kind} / ${c.name}`).toBe(true);
        for (const f of c.mesh.faces) {
          for (const [u, v] of f.uv) {
            expect(u, `${kind} u`).toBeGreaterThanOrEqual(-1e-6);
            expect(u, `${kind} u`).toBeLessThanOrEqual(ATLAS_W + 1e-6);
            expect(v, `${kind} v`).toBeGreaterThanOrEqual(-1e-6);
            expect(v, `${kind} v`).toBeLessThanOrEqual(ATLAS_H + 1e-6);
          }
        }
      }
      // the lowest point is at the ground (scenery that floats or sinks is a mistake)
      const b = modelBounds(m);
      expect(b.min[1], `${kind} sits on the ground`).toBeGreaterThan(-0.2);
      expect(b.min[1], `${kind} sits on the ground`).toBeLessThan(0.2);
      expect(b.max[1] - b.min[1], `${kind} has a height`).toBeGreaterThan(0.1);
    }
  });

  it('bones and animations belong together', () => {
    for (const kind of KIT_KINDS) {
      const m = createKitModel(kind, ids);
      const boneIds = new Set(m.bones.map((b) => b.id));
      const names = new Set(m.bones.map((b) => b.name));
      for (const c of m.cubes) if (c.bone) expect(boneIds.has(c.bone), kind).toBe(true);
      for (const clip of m.clips) for (const bone of Object.keys(clip.tracks)) expect(names.has(bone), `${kind}: ${bone}`).toBe(true);
    }
    expect(createKitModel('windmill', ids).clips.map((c) => c.name)).toEqual(['turn']);
  });

  it('round things are shaded smooth and survive saving', () => {
    const oak = createKitModel('oak-tree', ids);
    expect(oak.cubes.filter((c) => c.smooth).length).toBeGreaterThanOrEqual(5);
    const back = normalizeModel(JSON.parse(JSON.stringify(oak)));
    expect(back.cubes.filter((c) => c.smooth).length).toBe(oak.cubes.filter((c) => c.smooth).length);
    // a wall is hewn (bevelled): more faces than a plain box
    const wall = createKitModel('stone-wall', ids);
    expect(wall.cubes[0]!.mesh.faces.length).toBeGreaterThan(6);
  });

  it('the trees are not made of boxes', () => {
    for (const kind of ['oak-tree', 'pine-tree', 'birch-tree', 'palm-tree', 'cherry-tree', 'autumn-tree', 'dead-tree']) {
      const m = createKitModel(kind, ids);
      // a box has 8 vertices and 6 faces; every part of a tree is rounder than that
      expect(m.cubes.every((c) => c.mesh.faces.length > 6 || c.mesh.verts.length !== 8), kind).toBe(true);
    }
  });

  it('the tile list matches the atlas', () => {
    expect(KIT_TILE_NAMES).toHaveLength((ATLAS_W / 16) * (ATLAS_H / 16));
    expect(kitTilePos('stone_brick')).toEqual({ col: 0, row: 0 });
    expect(kitTilePos('roof_red')).toEqual({ col: 0, row: 1 });
    expect(kitTilePos('bark_oak')).toEqual({ col: 0, row: 3 });
  });

  it('new projects have them, older ones get them once', () => {
    const p = createDefaultProject();
    for (const kind of KIT_KINDS) expect(p.models.some((m) => m.id === kitModelId(kind))).toBe(true);
    const old = normalizeProject({ version: 7, models: [] });
    for (const kind of KIT_KINDS) expect(old.models.some((m) => m.id === kitModelId(kind))).toBe(true);
    // a deleted one stays deleted once the project is at the current version
    const pruned = JSON.parse(JSON.stringify(old));
    pruned.models = pruned.models.filter((m: { id: string }) => m.id !== kitModelId('house'));
    expect(normalizeProject(pruned).models.some((m) => m.id === kitModelId('house'))).toBe(false);
  });
});
