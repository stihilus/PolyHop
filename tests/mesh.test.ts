import { describe, expect, it } from 'vitest';
import {
  FACE_CORNERS,
  FACE_KEYS,
  boxMesh,
  cloneMesh,
  compactMesh,
  deleteFaces,
  deleteVertices,
  edgeRing,
  extrudeFaces,
  faceNormal,
  facesOutward,
  insetFaces,
  isValidMesh,
  loopCut,
  meshBounds,
  meshEdges,
  mergeVertices,
  prismMesh,
  recenterMesh,
  rockMesh,
  scaleMeshToSize,
  splitEdge,
  subdivideFaces,
  triangulateFace,
  uvFromRect,
  wedgeMesh,
} from '../src/core/mesh';
import type { MeshData } from '../src/core/mesh';

const unit = () => boxMesh([1, 1, 1]);

/** A closed manifold: every edge is used by exactly two faces. */
function closed(m: MeshData): boolean {
  return [...meshEdges(m).values()].every((e) => e.faces.length === 2);
}
function consistent(m: MeshData): boolean {
  // every face has matching uv count and valid indices
  return isValidMesh(m);
}
function volumeSign(m: MeshData): number {
  // signed volume via the divergence theorem; > 0 for outward-facing closed meshes
  let vol = 0;
  m.faces.forEach((_, fi) => {
    for (const [a, b, c] of triangulateFace(m, fi)) {
      const f = m.faces[fi]!;
      const p = m.verts[f.v[a!]!]!;
      const q = m.verts[f.v[b!]!]!;
      const r = m.verts[f.v[c!]!]!;
      vol += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }
  });
  return vol;
}

describe('box mesh', () => {
  it('has 8 vertices, 6 quads and is a closed, outward-facing manifold', () => {
    const m = unit();
    expect(m.verts).toHaveLength(8);
    expect(m.faces).toHaveLength(6);
    expect(closed(m)).toBe(true);
    expect(facesOutward(m)).toBe(true);
    expect(volumeSign(m)).toBeCloseTo(1, 5);
  });

  it('keeps the face order of FACE_KEYS and the normals pointing outward', () => {
    const m = unit();
    const expected = { pz: [0, 0, 1], nz: [0, 0, -1], px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0] };
    FACE_KEYS.forEach((k, i) => {
      expect(m.faces[i]!.v).toEqual([...FACE_CORNERS[k]]);
      const n = faceNormal(m, i);
      expect(n[0]).toBeCloseTo(expected[k][0]!);
      expect(n[1]).toBeCloseTo(expected[k][1]!);
      expect(n[2]).toBeCloseTo(expected[k][2]!);
    });
  });

  it('applies corner offsets', () => {
    const offsets = Array.from({ length: 8 }, (_, i) => (i === 7 ? [0, 1, 0] : [0, 0, 0])) as never;
    expect(boxMesh([1, 1, 1], offsets).verts[7]).toEqual([0.5, 1.5, 0.5]);
  });

  it('validates meshes', () => {
    expect(isValidMesh(unit())).toBe(true);
    expect(isValidMesh({ verts: [], faces: [] })).toBe(false);
    const bad = cloneMesh(unit());
    bad.faces[0]!.v[0] = 99;
    expect(isValidMesh(bad)).toBe(false);
    const badUv = cloneMesh(unit());
    badUv.faces[0]!.uv.pop();
    expect(isValidMesh(badUv)).toBe(false);
  });
});

describe('triangulation', () => {
  it('splits quads in two and triangles in one', () => {
    expect(triangulateFace(unit(), 0)).toHaveLength(2);
    expect(triangulateFace(wedgeMesh([1, 1, 1]), 3)).toHaveLength(1);
  });

  it('ear-clips a concave polygon without covering the notch', () => {
    // an L shape in the XY plane, counter-clockwise seen from +Z
    const m: MeshData = {
      verts: [
        [0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0],
      ],
      faces: [{ v: [0, 1, 2, 3, 4, 5], uv: Array.from({ length: 6 }, () => [0, 0] as [number, number]) }],
    };
    const tris = triangulateFace(m, 0);
    expect(tris).toHaveLength(4);
    // total area of the triangles equals the L's area (3)
    let area = 0;
    for (const [a, b, c] of tris) {
      const p = m.verts[a!]!;
      const q = m.verts[b!]!;
      const r = m.verts[c!]!;
      area += Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2;
    }
    expect(area).toBeCloseTo(3);
  });
});

describe('extrude', () => {
  it('adds a cap, four walls and keeps the mesh closed and outward', () => {
    const m = unit();
    const top = 4; // 'py'
    const before = m.verts.length;
    const out = extrudeFaces(m, [top]);
    expect(out).toEqual([top]);
    expect(m.verts).toHaveLength(before + 4);
    expect(m.faces).toHaveLength(6 + 4);
    expect(closed(m)).toBe(true);
    expect(consistent(m)).toBe(true);
    // pull the cap up by 1: the volume grows by exactly 1 and stays outward
    for (const v of m.faces[top]!.v) m.verts[v]![1] += 1;
    expect(volumeSign(m)).toBeCloseTo(2, 5);
    expect(facesOutward(m)).toBe(true);
  });

  it('extrudes several faces as one region (no walls between them)', () => {
    const m = unit();
    subdivideFaces(m, [4]); // top becomes four quads
    const quads = [4, ...Array.from({ length: 3 }, (_, i) => 6 + i)];
    const walls0 = m.faces.length;
    extrudeFaces(m, quads);
    // only the outer boundary of the 2x2 patch gets walls: 8 edges
    expect(m.faces.length - walls0).toBe(8);
    expect(closed(m)).toBe(true);
  });
});

describe('inset', () => {
  it('creates a ring of quads around a smaller face', () => {
    const m = unit();
    const out = insetFaces(m, [4], 0.25);
    expect(out).toEqual([4]);
    expect(m.faces).toHaveLength(6 + 4);
    expect(closed(m)).toBe(true);
    const inner = m.faces[4]!;
    // inner corners are pulled toward the center: |x| = 0.5 * 0.75
    for (const v of inner.v) {
      expect(Math.abs(m.verts[v]![0])).toBeCloseTo(0.375);
      expect(m.verts[v]![1]).toBeCloseTo(0.5);
    }
    expect(volumeSign(m)).toBeCloseTo(1, 5);
  });

  it('keeps the texture continuous (inner uv sits between the corner and the face center)', () => {
    const m = unit();
    const before = m.faces[4]!.uv.map((p) => [...p]);
    insetFaces(m, [4], 0.5);
    const inner = m.faces[4]!.uv;
    const cx = before.reduce((s, p) => s + p[0]!, 0) / 4;
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(inner[i]![0]! - cx)).toBeLessThan(Math.abs(before[i]![0]! - cx) + 1e-9);
    }
  });
});

describe('split edge and subdivide', () => {
  it('inserts a vertex into both faces of an edge', () => {
    const m = unit();
    const e = [...meshEdges(m).values()][0]!;
    const idx = splitEdge(m, e.a, e.b, 0.5);
    expect(m.verts).toHaveLength(9);
    const users = m.faces.filter((f) => f.v.includes(idx));
    expect(users).toHaveLength(2);
    expect(users.every((f) => f.v.length === 5 && f.uv.length === 5)).toBe(true);
    expect(closed(m)).toBe(true);
  });

  it('subdivides a quad into four and fixes neighbours', () => {
    const m = unit();
    const created = subdivideFaces(m, [4]);
    expect(created).toHaveLength(4);
    expect(m.faces).toHaveLength(6 - 1 + 4);
    expect(m.verts).toHaveLength(8 + 4 + 1);
    // the four side faces touching the top each gained a midpoint (5 corners)
    const fivers = m.faces.filter((f) => f.v.length === 5);
    expect(fivers).toHaveLength(4);
    expect(closed(m)).toBe(true);
    expect(volumeSign(m)).toBeCloseTo(1, 5);
  });
});

describe('loop cut', () => {
  it('finds a closed ring of four quads around a box', () => {
    const m = unit();
    // front face (pz = 0), its first edge runs along x: the ring goes around the box through the sides
    const ring = edgeRing(m, 0, 0);
    expect(ring).not.toBeNull();
    expect(ring!.faces).toHaveLength(4);
    expect(ring!.edges).toHaveLength(4);
    expect(ring!.closed).toBe(true);
  });

  it('cuts a box into two stacked layers', () => {
    const m = unit();
    const loop = loopCut(m, 0, 0, 0.5)!;
    expect(loop).toHaveLength(4);
    expect(m.verts).toHaveLength(12);
    expect(m.faces).toHaveLength(10); // 4 ring quads became 8, plus top and bottom caps
    expect(closed(m)).toBe(true);
    expect(consistent(m)).toBe(true);
    expect(facesOutward(m)).toBe(true);
    expect(volumeSign(m)).toBeCloseTo(1, 5);
    // the first edge of the front face runs along x, so the loop goes around the box in the plane x = 0
    for (const v of loop) expect(Math.abs(m.verts[v]![0])).toBeLessThan(1e-9);
  });

  it('cutting a box at 0.25 puts the loop a quarter of the way along the edges', () => {
    const m = unit();
    const loop = loopCut(m, 0, 0, 0.25)!;
    // t is measured from the lower vertex index of each edge (the -x end), so x = -0.5 + 0.25
    expect(loop).toHaveLength(4);
    for (const v of loop) expect(m.verts[v]![0]).toBeCloseTo(-0.25);
  });

  it('stops at a non-quad neighbour and fixes it', () => {
    const m = unit();
    splitEdge(m, 4, 5, 0.5); // makes two pentagons (front and top)
    const ring = edgeRing(m, 2, 0); // some other quad
    expect(ring).not.toBeNull();
    const before = m.verts.length;
    expect(loopCut(m, 2, 0, 0.5)).not.toBeNull();
    expect(m.verts.length).toBeGreaterThan(before);
    expect(closed(m)).toBe(true);
  });

  it('refuses faces that are not quads', () => {
    const m = wedgeMesh([1, 1, 1]);
    const tri = m.faces.findIndex((f) => f.v.length === 3);
    expect(loopCut(m, tri, 0)).toBeNull();
  });
});

describe('delete and merge', () => {
  it('deleting a face leaves an open mesh and drops unused vertices', () => {
    const m = unit();
    deleteFaces(m, [4]);
    expect(m.faces).toHaveLength(5);
    expect(m.verts).toHaveLength(8); // all corners are still used by other faces
    expect(closed(m)).toBe(false);
  });

  it('deleting a vertex removes the faces around it', () => {
    const m = unit();
    deleteVertices(m, [7]);
    expect(m.faces).toHaveLength(3);
    expect(m.verts).toHaveLength(7);
    expect(consistent(m)).toBe(true);
  });

  it('merging two corners of a face collapses it and keeps a valid mesh', () => {
    const m = unit();
    extrudeFaces(m, [4]);
    insetFaces(m, [4], 0.3);
    const n = m.verts.length;
    const idx = mergeVertices(m, [0, 1]);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(m.verts.length).toBeLessThan(n);
    expect(consistent(m)).toBe(true);
  });

  it('compact renumbers indices', () => {
    const m = unit();
    m.verts.push([9, 9, 9]);
    compactMesh(m);
    expect(m.verts).toHaveLength(8);
  });
});

describe('sizing', () => {
  it('recenters and scales to a size', () => {
    const m = boxMesh([2, 2, 2]);
    for (const v of m.verts) v[1] += 5;
    const shift = recenterMesh(m);
    expect(shift[1]).toBeCloseTo(5);
    expect(meshBounds(m).min[1]).toBeCloseTo(-1);
    scaleMeshToSize(m, [4, 1, 2]);
    const b = meshBounds(m);
    expect(b.max[0] - b.min[0]).toBeCloseTo(4);
    expect(b.max[1] - b.min[1]).toBeCloseTo(1);
    expect(b.max[2] - b.min[2]).toBeCloseTo(2);
  });
});

describe('uv from a rectangle', () => {
  it('maps a box face exactly onto the rectangle', () => {
    const m = unit();
    const uv = uvFromRect(m, 0, { x: 16, y: 32, w: 16, h: 16 });
    // the lower-left corner of the front face shows the rectangle's lower-left
    expect(uv[0]).toEqual([16, 48]);
    expect(uv[1]).toEqual([32, 48]);
    expect(uv[2]).toEqual([32, 32]);
    expect(uv[3]).toEqual([16, 32]);
  });
});

describe('primitives', () => {
  it('wedge, prism and rock are closed outward meshes', () => {
    for (const m of [wedgeMesh([2, 1, 3]), prismMesh(6, 0.5, 1), rockMesh(7, 1.2)]) {
      expect(isValidMesh(m)).toBe(true);
      expect(closed(m)).toBe(true);
      expect(volumeSign(m)).toBeGreaterThan(0);
    }
  });

  it('rocks are deterministic per seed and differ between seeds', () => {
    const a = rockMesh(3);
    const b = rockMesh(3);
    const c = rockMesh(4);
    expect(a.verts).toEqual(b.verts);
    expect(a.verts).not.toEqual(c.verts);
  });
});
