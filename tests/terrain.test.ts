import { describe, expect, it } from 'vitest';
import { isValidMesh, meshBounds, meshEdges } from '../src/core/mesh';
import { signedVolume } from '../src/core/meshGen';
import {
  MAX_TERRAIN_CELLS,
  brushWeight,
  flattenTerrain,
  generateHills,
  isTerrainGrid,
  resizeTerrain,
  sanitizeTerrainInfo,
  sculpt,
  terrainFrame,
  terrainHeightAt,
  terrainMesh,
  terrainRange,
} from '../src/core/terrain';
import { createBlock, normalizeObject } from '../src/core/types';
import { buildColliders } from '../src/runtime/level';

const info = { cols: 8, rows: 6, cell: 1 };

describe('terrain mesh', () => {
  it('is a grid of quads facing up, centered on the origin', () => {
    const m = terrainMesh(info);
    expect(isValidMesh(m)).toBe(true);
    expect(m.verts).toHaveLength(9 * 7);
    expect(m.faces).toHaveLength(8 * 6);
    const b = meshBounds(m);
    expect(b.min).toEqual([-4, 0, -3]);
    expect(b.max).toEqual([4, 0, 3]);
    // every face points up
    for (const f of m.faces) {
      const [a, b2, c] = f.v.map((i) => m.verts[i]!);
      const u = [b2![0] - a![0], b2![1] - a![1], b2![2] - a![2]];
      const v = [c![0] - b2![0], c![1] - b2![1], c![2] - b2![2]];
      const ny = u[2]! * v[0]! - u[0]! * v[2]!;
      expect(ny).toBeGreaterThan(0);
    }
    expect(isTerrainGrid(m, info)).toBe(true);
    // only the outside edges are open
    const open = [...meshEdges(m).values()].filter((e) => e.faces.length === 1).length;
    expect(open).toBe(2 * (8 + 6));
  });

  it('reads the height anywhere inside, bilinear', () => {
    const m = terrainMesh(info);
    // make one vertex a peak: the middle vertex (4, 3) of the grid is at x = 0, z = 0
    m.verts[3 * 9 + 4]![1] = 2;
    expect(terrainHeightAt(m, info, 0, 0)).toBeCloseTo(2);
    expect(terrainHeightAt(m, info, 0.5, 0)).toBeCloseTo(1);
    expect(terrainHeightAt(m, info, 2, 0)).toBeCloseTo(0);
    expect(terrainHeightAt(m, info, 10, 0)).toBeNull();
  });

  it('knows whether the mesh is still the grid', () => {
    const m = terrainMesh(info);
    expect(isTerrainGrid(m, { cols: 4, rows: 4, cell: 1 })).toBe(false);
    m.faces.pop();
    expect(isTerrainGrid(m, info)).toBe(false);
  });

  it('cleans terrain info of unknown origin', () => {
    expect(sanitizeTerrainInfo({ cols: 8, rows: 6, cell: 1 })).toEqual({ cols: 8, rows: 6, cell: 1 });
    expect(sanitizeTerrainInfo({ cols: 0, rows: 6, cell: 1 })).toBeUndefined();
    expect(sanitizeTerrainInfo({ cols: MAX_TERRAIN_CELLS + 1, rows: 6, cell: 1 })).toBeUndefined();
    expect(sanitizeTerrainInfo({ cols: 8, rows: 6, cell: 0.01 })).toBeUndefined();
    expect(sanitizeTerrainInfo(null)).toBeUndefined();
  });
});

describe('sculpting', () => {
  it('the brush is strongest in the middle and gone at the edge', () => {
    expect(brushWeight(0, 3)).toBe(1);
    expect(brushWeight(1.5, 3)).toBeCloseTo(0.5);
    expect(brushWeight(3, 3)).toBe(0);
    expect(brushWeight(9, 3)).toBe(0);
  });

  it('raise lifts the middle most and leaves far points alone', () => {
    const m = terrainMesh({ cols: 20, rows: 20, cell: 1 });
    const g = { cols: 20, rows: 20, cell: 1 };
    const moved = sculpt(m, g, 0, 0, { mode: 'raise', radius: 3, strength: 1 });
    expect(moved).toBeGreaterThan(10);
    expect(terrainHeightAt(m, g, 0, 0)).toBeCloseTo(0.25);
    expect(terrainHeightAt(m, g, 2, 0)!).toBeGreaterThan(0);
    expect(terrainHeightAt(m, g, 2, 0)!).toBeLessThan(0.25);
    expect(terrainHeightAt(m, g, 6, 0)).toBe(0);
  });

  it('lower digs, and many applications add up', () => {
    const g = { cols: 20, rows: 20, cell: 1 };
    const m = terrainMesh(g);
    for (let i = 0; i < 8; i++) sculpt(m, g, 0, 0, { mode: 'lower', radius: 4, strength: 1 });
    expect(terrainHeightAt(m, g, 0, 0)).toBeCloseTo(-2);
    expect(terrainRange(m).min).toBeCloseTo(-2);
  });

  it('flatten pulls toward a level', () => {
    const g = { cols: 20, rows: 20, cell: 1 };
    const m = terrainMesh(g);
    for (const v of m.verts) v[1] = Math.sin(v[0]) * 2;
    for (let i = 0; i < 40; i++) sculpt(m, g, 0, 0, { mode: 'flatten', radius: 5, strength: 1, level: 1 });
    expect(terrainHeightAt(m, g, 0, 0)).toBeCloseTo(1, 1);
    expect(terrainHeightAt(m, g, 1, 1)).toBeCloseTo(1, 1);
  });

  it('smooth takes the spikes off', () => {
    const g = { cols: 20, rows: 20, cell: 1 };
    const m = terrainMesh(g);
    m.verts[10 * 21 + 10]![1] = 3;
    for (let i = 0; i < 6; i++) sculpt(m, g, 0, 0, { mode: 'smooth', radius: 4, strength: 1 });
    expect(m.verts[10 * 21 + 10]![1]).toBeLessThan(1);
    // the volume that left the peak went to its neighbours
    expect(m.verts[10 * 21 + 11]![1]).toBeGreaterThan(0.1);
  });

  it('works at the border of the grid without going outside it', () => {
    const g = { cols: 10, rows: 10, cell: 1 };
    const m = terrainMesh(g);
    expect(() => sculpt(m, g, -5, -5, { mode: 'raise', radius: 4, strength: 1 })).not.toThrow();
    expect(() => sculpt(m, g, 40, 40, { mode: 'raise', radius: 4, strength: 1 })).not.toThrow();
    expect(m.verts.length).toBe(121);
  });
});

describe('hills', () => {
  it('are deterministic for a seed, different for another, and stay inside the height', () => {
    const g = { cols: 24, rows: 24, cell: 1 };
    const a = terrainMesh(g);
    const b = terrainMesh(g);
    const c = terrainMesh(g);
    generateHills(a, { seed: 3, height: 4, scale: 8 });
    generateHills(b, { seed: 3, height: 4, scale: 8 });
    generateHills(c, { seed: 4, height: 4, scale: 8 });
    expect(a.verts).toEqual(b.verts);
    expect(a.verts).not.toEqual(c.verts);
    const r = terrainRange(a);
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.max).toBeLessThanOrEqual(4);
    expect(r.max - r.min).toBeGreaterThan(0.5);
    flattenTerrain(a, 1);
    expect(terrainRange(a)).toEqual({ min: 1, max: 1 });
  });
});

describe('terrain as a block', () => {
  it('survives saving; the flag is dropped when the grid was edited', () => {
    const g = { cols: 8, rows: 6, cell: 1 };
    const b = createBlock('Terrain', [0, 0, 0], terrainMesh(g), null);
    b.terrain = g;
    const back = normalizeObject(JSON.parse(JSON.stringify(b)));
    expect(back.kind === 'block' && back.terrain).toEqual(g);
    const edited = JSON.parse(JSON.stringify(b));
    edited.mesh.faces.pop();
    const lost = normalizeObject(edited);
    expect(lost.kind === 'block' && lost.terrain).toBeUndefined();
  });

  it('is collided in chunks that cover the whole surface', () => {
    const g = { cols: 40, rows: 40, cell: 1 };
    const mesh = terrainMesh(g);
    const b = createBlock('Terrain', [0, 0, 0], mesh, null);
    const { boxes, meshes } = buildColliders([b], () => undefined);
    expect(boxes).toHaveLength(0);
    expect(meshes.length).toBeGreaterThan(10);
    const tris = meshes.reduce((n, m) => n + m.tris.length / 9, 0);
    expect(tris).toBe(40 * 40 * 2);
    // each chunk is small
    for (const m of meshes) expect(m.max[0] - m.min[0]).toBeLessThanOrEqual(6.01);
    expect(signedVolume(mesh)).toBeDefined();
  });
});

describe('stretched and resized terrain', () => {
  const stretched = () => {
    const t = { cols: 16, rows: 16, cell: 1 };
    const mesh = terrainMesh(t);
    // what the Size field does: 16 m -> 32 m
    for (const v of mesh.verts) {
      v[0] *= 2;
      v[2] *= 2;
    }
    return { t, mesh };
  };

  it('finds its grid from the vertices, so a stretched terrain is still sculptable', () => {
    const { t, mesh } = stretched();
    const f = terrainFrame(mesh, t);
    expect(f.dx).toBeCloseTo(2, 6);
    expect(f.x0).toBeCloseTo(-16, 6);
    // a brush at x = 12 m, z = -10 m raises ground there and nowhere near the old, unstretched spot
    const moved = sculpt(mesh, t, 12, -10, { mode: 'raise', radius: 3, strength: 1 });
    expect(moved).toBeGreaterThan(0);
    expect(terrainHeightAt(mesh, t, 12, -10)!).toBeGreaterThan(0.1);
    expect(terrainHeightAt(mesh, t, -12, 10)!).toBe(0);
    expect(terrainHeightAt(mesh, t, 6, -5)!).toBe(0); // where an unaware brush would have landed
  });

  it('growing keeps the old heights where they were and adds flat ground around them', () => {
    const t = { cols: 8, rows: 8, cell: 1 };
    const mesh = terrainMesh(t);
    generateHills(mesh, { seed: 3, height: 3, scale: 5 });
    const before = mesh.verts.map((v) => [...v] as [number, number, number]);
    const out = resizeTerrain(mesh, t, { cols: 40, rows: 36 });
    expect(out.info).toEqual({ cols: 40, rows: 36, cell: 1 });
    expect(isTerrainGrid(out.mesh, out.info)).toBe(true);
    expect(isValidMesh(out.mesh)).toBe(true);
    // the old surface is the same at the old grid points
    for (const v of before) {
      expect(terrainHeightAt(out.mesh, out.info, v[0], v[2])!).toBeCloseTo(v[1], 3);
    }
    // far outside it has settled at the level of the old border (no cliff, no streak)
    const far = out.mesh.verts.filter((v) => Math.abs(v[0]) > 4 + 8 || Math.abs(v[2]) > 4 + 8);
    expect(far.length).toBeGreaterThan(0);
    const level = far[0]![1];
    for (const v of far) expect(v[1]).toBeCloseTo(level, 3);
    // the original is untouched
    expect(mesh.verts).toHaveLength(81);
  });

  it('the ground that was there stays under the same world spot when it grows on one side only', () => {
    const t = { cols: 4, rows: 4, cell: 2 };
    const mesh = terrainMesh(t);
    sculpt(mesh, t, 0, 0, { mode: 'raise', radius: 3, strength: 1 });
    const h = terrainHeightAt(mesh, t, 0, 0)!;
    // 4 -> 7 cells: an odd number more, so one side gets one cell more than the other
    const out = resizeTerrain(mesh, t, { cols: 7, rows: 7 });
    expect(terrainHeightAt(out.mesh, out.info, 0, 0)!).toBeCloseTo(h, 3);
    const f = terrainFrame(out.mesh, out.info);
    expect(f.dx).toBeCloseTo(2, 6);
    // and it can still be sculpted
    expect(sculpt(out.mesh, out.info, 5, 5, { mode: 'raise', radius: 2, strength: 1 })).toBeGreaterThan(0);
  });

  it('another cell size keeps the middle and about the same shape', () => {
    const t = { cols: 8, rows: 8, cell: 2 };
    const mesh = terrainMesh(t);
    generateHills(mesh, { seed: 5, height: 4, scale: 8 });
    const out = resizeTerrain(mesh, t, { cols: 16, rows: 16, cell: 1 });
    expect(out.info).toEqual({ cols: 16, rows: 16, cell: 1 });
    const b = meshBounds(out.mesh);
    expect(b.min[0]).toBeCloseTo(-8, 6);
    expect(b.max[0]).toBeCloseTo(8, 6);
    for (const [x, z] of [[0, 0], [3, -2], [-5.5, 4.25]] as const) {
      expect(terrainHeightAt(out.mesh, out.info, x, z)!).toBeCloseTo(terrainHeightAt(mesh, t, x, z)!, 1);
    }
  });

  it('paint stays and spreads to new ground', () => {
    const t = { cols: 4, rows: 4, cell: 1 };
    const mesh = terrainMesh(t);
    for (const f of mesh.faces) f.tile = { texture: 'A', col: 1, row: 2 };
    mesh.faces[5]!.tile = { texture: 'A', col: 9, row: 9 };
    const out = resizeTerrain(mesh, t, { cols: 8, rows: 8 });
    expect(out.mesh.faces.every((f) => !!f.tile)).toBe(true);
    // the special cell: old cell (1, 1) -> new cell (3, 3)
    expect(out.mesh.faces[3 * 8 + 3]!.tile).toMatchObject({ col: 9, row: 9 });
    expect(out.mesh.faces[0]!.tile).toMatchObject({ col: 1, row: 2 });
  });

  it('cuts down and never goes over the limit', () => {
    const t = { cols: 8, rows: 8, cell: 1 };
    const mesh = terrainMesh(t);
    const small = resizeTerrain(mesh, t, { cols: 4, rows: 3 });
    expect(small.mesh.verts).toHaveLength(5 * 4);
    const huge = resizeTerrain(mesh, t, { cols: 5000, rows: 0 });
    expect(huge.info.cols).toBe(MAX_TERRAIN_CELLS);
    expect(huge.info.rows).toBe(1);
  });
});
