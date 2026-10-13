import { describe, expect, it } from 'vitest';
import { type MeshData, boxMesh, isValidMesh, meshBounds, meshEdges, wedgeMesh } from '../src/core/mesh';
import { signedVolume, sphereMesh, stairsMesh } from '../src/core/meshGen';
import { bevelMesh, defaultBevel, faceCornerNormals, smoothMesh } from '../src/core/meshModify';
import type { Vec3 } from '../src/core/types';

const closed = (m: MeshData) => [...meshEdges(m).values()].every((e) => e.faces.length === 2);

describe('bevel', () => {
  it('a cube gets 6 faces, 12 strips and 8 corners', () => {
    const m = bevelMesh(boxMesh([1, 1, 1]), { amount: 0.1 });
    expect(isValidMesh(m)).toBe(true);
    expect(m.faces).toHaveLength(26);
    expect(m.verts).toHaveLength(24);
    expect(closed(m)).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0);
    // it lost a little at the edges and corners
    expect(signedVolume(m)).toBeLessThan(1);
    expect(signedVolume(m)).toBeGreaterThan(0.9);
    // the outside did not grow
    const b = meshBounds(m);
    expect(b.max[0]).toBeCloseTo(0.5);
    expect(b.min[1]).toBeCloseTo(-0.5);
  });

  it('the chamfer is as wide as asked', () => {
    const m = bevelMesh(boxMesh([2, 2, 2]), { amount: 0.25 });
    // top face shrank from 2 to 1.5 on a side
    const topY = m.verts.filter((v) => Math.abs(v[1] - 1) < 1e-6);
    expect(Math.max(...topY.map((v) => v[0]))).toBeCloseTo(0.75);
    expect(Math.min(...topY.map((v) => v[0]))).toBeCloseTo(-0.75);
  });

  it('is limited by the size of the faces', () => {
    const m = bevelMesh(boxMesh([1, 1, 1]), { amount: 5 });
    expect(isValidMesh(m)).toBe(true);
    expect(closed(m)).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0.05);
  });

  it('works on a wedge and on stairs, and keeps them closed', () => {
    for (const mesh of [wedgeMesh([2, 1, 3]), stairsMesh([2, 1, 3], 3)]) {
      const m = bevelMesh(mesh, { amount: 0.05 });
      expect(isValidMesh(m)).toBe(true);
      expect(closed(m)).toBe(true);
      expect(signedVolume(m)).toBeGreaterThan(0);
      expect(signedVolume(m)).toBeLessThan(signedVolume(mesh));
    }
  });

  it('leaves soft edges alone: a subdivided flat face does not get strips', () => {
    // a smooth ball: neighbouring faces turn by less than the limit everywhere
    const ball = sphereMesh(1, 12, 8);
    const m = bevelMesh(ball, { amount: 0.05, minAngle: 60 });
    expect(m.faces).toHaveLength(ball.faces.length);
    expect(m.verts).toHaveLength(ball.verts.length);
  });

  it('a mesh without hard edges comes back as a copy', () => {
    const m = boxMesh([1, 1, 1]);
    const same = bevelMesh(m, { amount: 0 });
    expect(same.faces).toHaveLength(6);
    expect(same.verts).not.toBe(m.verts);
  });

  it('suggests a width that fits the size of the shape', () => {
    expect(defaultBevel(boxMesh([4, 4, 4]))).toBeCloseTo(0.12);
    expect(defaultBevel(boxMesh([0.2, 0.2, 0.2]))).toBeCloseTo(0.03);
  });
});

describe('smooth (Catmull-Clark)', () => {
  it('a cube becomes 24 quads on a closed rounded surface', () => {
    const m = smoothMesh(boxMesh([1, 1, 1]));
    expect(m.faces).toHaveLength(24);
    expect(m.verts).toHaveLength(26);
    expect(closed(m)).toBe(true);
    expect(isValidMesh(m)).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0);
    // rounder: corners pulled in, so less volume than the box
    expect(signedVolume(m)).toBeLessThan(1);
    // the farthest point from the middle got closer than the corner of the box
    const far = Math.max(...m.verts.map((v) => Math.hypot(...v)));
    expect(far).toBeLessThan(Math.hypot(0.5, 0.5, 0.5));
  });

  it('keeps going: each round has four times the faces', () => {
    let m = boxMesh([1, 1, 1]);
    m = smoothMesh(m);
    m = smoothMesh(m);
    expect(m.faces).toHaveLength(96);
    expect(closed(m)).toBe(true);
  });

  it('carries texture coordinates and painted tiles over', () => {
    const src = boxMesh([1, 1, 1], null, null, { x: 16, y: 32, w: 16, h: 16 });
    src.faces[4]!.tile = { texture: 'a.png', col: 1, row: 2 };
    const m = smoothMesh(src);
    for (const f of m.faces) {
      for (const [u, v] of f.uv) {
        expect(u).toBeGreaterThanOrEqual(16 - 1e-9);
        expect(u).toBeLessThanOrEqual(32 + 1e-9);
        expect(v).toBeGreaterThanOrEqual(32 - 1e-9);
        expect(v).toBeLessThanOrEqual(48 + 1e-9);
      }
    }
    expect(m.faces.filter((f) => f.tile)).toHaveLength(4);
  });

  it('a single flat face keeps its outline', () => {
    const plane: MeshData = {
      verts: [
        [0, 0, 0],
        [2, 0, 0],
        [2, 2, 0],
        [0, 2, 0],
      ],
      faces: [{ v: [0, 1, 2, 3], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] }],
    };
    const m = smoothMesh(plane);
    expect(m.faces).toHaveLength(4);
    const b = meshBounds(m);
    expect(b.min[2]).toBeCloseTo(0);
    expect(b.max[2]).toBeCloseTo(0);
    expect(b.max[0]).toBeLessThanOrEqual(2 + 1e-9);
  });
});

describe('normals for shading', () => {
  const pts = (m: MeshData): Vec3[] => m.verts;

  it('flat shading gives every corner of a face the face normal', () => {
    const m = boxMesh([1, 1, 1]);
    const n = faceCornerNormals(m, pts(m), null);
    for (const corner of n[4]!) expect(corner).toEqual([0, 1, 0]);
  });

  it('a cube stays crisp with the default angle', () => {
    const m = boxMesh([1, 1, 1]);
    const n = faceCornerNormals(m, pts(m), 60);
    for (const corner of n[4]!) {
      expect(corner[1]).toBeCloseTo(1);
    }
  });

  it('a ball is shaded as one surface', () => {
    const m = sphereMesh(1, 10, 6);
    const n = faceCornerNormals(m, pts(m), 60);
    m.faces.forEach((f, fi) => {
      f.v.forEach((vi, k) => {
        const p = m.verts[vi]!;
        const r = Math.hypot(...p);
        const nn = n[fi]![k]!;
        // close to pointing away from the center
        expect((p[0] * nn[0] + p[1] * nn[1] + p[2] * nn[2]) / r).toBeGreaterThan(0.95);
      });
    });
  });

  it('shared corners of neighbouring faces get the same normal when smooth', () => {
    const m = sphereMesh(1, 12, 8);
    const n = faceCornerNormals(m, pts(m), 60);
    const seen = new Map<number, Vec3>();
    m.faces.forEach((f, fi) =>
      f.v.forEach((vi, k) => {
        const prev = seen.get(vi);
        if (prev) {
          expect(n[fi]![k]![0]).toBeCloseTo(prev[0], 5);
          expect(n[fi]![k]![1]).toBeCloseTo(prev[1], 5);
        }
        seen.set(vi, n[fi]![k]!);
      }),
    );
  });
});
