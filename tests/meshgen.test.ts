import { describe, expect, it } from 'vitest';
import { isValidMesh, meshBounds, meshEdges, meshSize } from '../src/core/mesh';
import {
  PRIMITIVES,
  archMesh,
  cylinderMesh,
  domeMesh,
  extrudeProfile,
  groundMesh,
  primitiveMesh,
  signedVolume,
  sphereMesh,
  stairsMesh,
  torusMesh,
} from '../src/core/meshGen';
import type { MeshData } from '../src/core/mesh';

/** Every edge is used by exactly two faces: a closed surface with no holes. */
const closed = (m: MeshData) => [...meshEdges(m).values()].every((e) => e.faces.length === 2);

describe('ready-made shapes', () => {
  it('every shape in the list is a valid mesh', () => {
    for (const p of PRIMITIVES) {
      const m = primitiveMesh(p.kind);
      expect(isValidMesh(m), p.kind).toBe(true);
      expect(m.faces.length, p.kind).toBeGreaterThan(0);
    }
  });

  it('the solid ones are closed and point outward', () => {
    for (const p of PRIMITIVES.filter((x) => x.solid && x.kind !== 'rock')) {
      const m = primitiveMesh(p.kind);
      expect(closed(m), `${p.kind} closed`).toBe(true);
      expect(signedVolume(m), `${p.kind} volume`).toBeGreaterThan(0);
    }
  });

  it('a profile pulled out keeps its outline and its depth', () => {
    // an L shape: concave
    const m = extrudeProfile(
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2],
      ],
      0.5,
    );
    expect(closed(m)).toBe(true);
    // area 3 m2 pulled 0.5 m
    expect(signedVolume(m)).toBeCloseTo(1.5);
    expect(meshSize(m)).toEqual([2, 2, 0.5]);
    // the same outline given clockwise comes out the same
    const cw = extrudeProfile(
      [
        [0, 2],
        [1, 2],
        [1, 1],
        [2, 1],
        [2, 0],
        [0, 0],
      ],
      0.5,
    );
    expect(signedVolume(cw)).toBeCloseTo(1.5);
  });

  it('stairs have a tread per step and the right size', () => {
    const m = stairsMesh([2, 1.2, 3], 4);
    expect(meshSize(m)).toEqual([2, 1.2, 3]);
    expect(closed(m)).toBe(true);
    // volume of a staircase: width * depth/n * h/n * (1 + 2 + ... + n)
    const n = 4;
    expect(signedVolume(m)).toBeCloseTo(2 * (3 / n) * (1.2 / n) * ((n * (n + 1)) / 2), 3);
    // the rise is toward -z
    const b = meshBounds(m);
    expect(b.max[1]).toBeCloseTo(0.6);
    const top = m.verts.filter((v) => v[1] > 0.59).map((v) => v[2]);
    expect(Math.max(...top)).toBeCloseTo(-0.75); // the highest tread is the back quarter
  });

  it('an arch is a wall with an opening that reaches the ground', () => {
    const m = archMesh([3, 3, 0.6], 1.4, 2.2, 8);
    expect(meshSize(m)).toEqual([3, 3, 0.6]);
    expect(closed(m)).toBe(true);
    // less volume than the full wall, and the opening is open at the bottom: no vertex in the middle of
    // the opening at the bottom edge
    expect(signedVolume(m)).toBeLessThan(3 * 3 * 0.6);
    const bottomMiddle = m.verts.filter((v) => Math.abs(v[1] + 1.5) < 1e-6 && Math.abs(v[0]) < 0.69);
    expect(bottomMiddle).toHaveLength(0);
    // the opening has a round top at the requested height
    const top = Math.max(...m.verts.filter((v) => Math.abs(v[0]) < 0.71 && v[1] < 1.4).map((v) => v[1]));
    expect(top).toBeCloseTo(-1.5 + 2.2, 2);
  });

  it('cone and cylinder differ by their top', () => {
    const cone = cylinderMesh(8, 0.5, 0, 1);
    const cyl = cylinderMesh(8, 0.5, 0.5, 1);
    expect(cone.verts).toHaveLength(9);
    expect(cone.faces).toHaveLength(9);
    expect(cyl.verts).toHaveLength(16);
    expect(cyl.faces).toHaveLength(10);
    expect(closed(cone)).toBe(true);
    expect(closed(cyl)).toBe(true);
    // a frustum
    const tapered = cylinderMesh(6, 0.5, 0.25, 2);
    expect(signedVolume(tapered)).toBeGreaterThan(0);
  });

  it('a sphere is round and closed', () => {
    const m = sphereMesh(1, 8, 6);
    expect(closed(m)).toBe(true);
    for (const v of m.verts) expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    // an inscribed polyhedron holds less than the ball
    expect(signedVolume(m)).toBeGreaterThan(2.5);
    expect(signedVolume(m)).toBeLessThan((4 / 3) * Math.PI);
  });

  it('a dome has a flat bottom and rests centered', () => {
    const m = domeMesh(1, 8, 3);
    expect(closed(m)).toBe(true);
    const b = meshBounds(m);
    expect(b.max[1] - b.min[1]).toBeCloseTo(1);
    expect(b.max[1] + b.min[1]).toBeCloseTo(0);
  });

  it('a ring has a hole in the middle', () => {
    const m = torusMesh(0.6, 0.18, 12, 6);
    expect(closed(m)).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0);
    for (const v of m.verts) expect(Math.hypot(v[0], v[2])).toBeGreaterThan(0.4);
  });

  it('can be put on the ground', () => {
    const m = sphereMesh(0.5);
    const lift = groundMesh(m);
    expect(lift).toBeCloseTo(0.5);
    expect(meshBounds(m).min[1]).toBeCloseTo(0);
  });
});
