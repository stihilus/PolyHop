// Ready-made shapes: the list offered by "+ Add shape…" in the level and in the model editor, and the
// generators behind it. All of them are plain polygon meshes (see mesh.ts), centered on the origin.

import {
  type MeshData,
  type MeshFace,
  assignRect,
  boxMesh,
  faceCentroid,
  faceNormal,
  fixWinding,
  meshBounds,
  planeMesh,
  prismMesh,
  rockMesh,
  triangulateFace,
  tuftMesh,
  wedgeMesh,
} from './mesh';
import type { Vec3 } from './types';

type Rect = { x: number; y: number; w: number; h: number };
const DEFAULT_TILE: Rect = { x: 0, y: 0, w: 16, h: 16 };

export type PrimitiveKind =
  | 'cube'
  | 'ramp'
  | 'stairs'
  | 'arch'
  | 'cylinder'
  | 'cone'
  | 'sphere'
  | 'dome'
  | 'ring'
  | 'rock'
  | 'plane'
  | 'tuft';

export interface PrimitiveInfo {
  kind: PrimitiveKind;
  label: string;
  /** Whether the shape stops the player when it is added to a level. */
  solid: boolean;
  /** Rotation (degrees) a new shape of this kind starts with. */
  rotation?: Vec3;
  /** Thin shape meant for textures with transparent pixels (grass, leaves, fences). */
  cutout?: boolean;
  /** Round shapes look best smooth shaded. */
  smooth?: boolean;
}

export const PRIMITIVES: PrimitiveInfo[] = [
  { kind: 'cube', label: 'Cube', solid: true },
  { kind: 'ramp', label: 'Ramp', solid: true },
  { kind: 'stairs', label: 'Stairs', solid: true },
  { kind: 'arch', label: 'Arch', solid: true },
  { kind: 'cylinder', label: 'Cylinder', solid: true },
  { kind: 'cone', label: 'Cone', solid: true },
  { kind: 'sphere', label: 'Sphere', solid: true, smooth: true },
  { kind: 'dome', label: 'Dome', solid: true, smooth: true },
  { kind: 'ring', label: 'Ring', solid: true, smooth: true },
  { kind: 'rock', label: 'Rock', solid: true },
  { kind: 'plane', label: 'Plane', solid: false, cutout: true },
  // two crossing planes, turned 45 degrees so both show from the usual camera directions
  { kind: 'tuft', label: 'Grass tuft', solid: false, rotation: [0, 45, 0], cutout: true },
];

// ---------------------------------------------------------------- helpers

/** Signed volume of a closed mesh (positive when the faces point outward). */
export function signedVolume(m: MeshData): number {
  let vol = 0;
  m.faces.forEach((f, fi) => {
    for (const [a, b, c] of triangulateFace(m, fi)) {
      const p = m.verts[f.v[a!]!]!;
      const q = m.verts[f.v[b!]!]!;
      const r = m.verts[f.v[c!]!]!;
      vol += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }
  });
  return vol;
}

/** Turn every face around when the mesh is inside out (works for concave shapes too). */
export function fixWindingByVolume(m: MeshData): void {
  if (signedVolume(m) >= 0) return;
  for (const f of m.faces) {
    f.v.reverse();
    f.uv.reverse();
  }
}

/**
 * A prism made by pulling a closed 2D outline straight out. The outline is given in the x-y plane and
 * pulled along z ('xy'), or in the (z, y) plane and pulled along x ('zy', for things like stairs that
 * are described by their side view). The shape is centered on the origin. Concave outlines work.
 */
export function extrudeProfile(points: [number, number][], depth: number, plane: 'xy' | 'zy' = 'xy', tile: Rect = DEFAULT_TILE): MeshData {
  const n = points.length;
  const h = depth / 2;
  const place = (a: number, b: number, c: number): Vec3 => (plane === 'xy' ? [a, b, c] : [c, b, a]);
  const verts: Vec3[] = [];
  for (const [a, b] of points) verts.push(place(a, b, h));
  for (const [a, b] of points) verts.push(place(a, b, -h));
  const faces: MeshFace[] = [];
  faces.push({ v: Array.from({ length: n }, (_, i) => i), uv: [] });
  faces.push({ v: Array.from({ length: n }, (_, i) => 2 * n - 1 - i), uv: [] });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ v: [i, n + i, n + j, j], uv: [] });
  }
  const m: MeshData = { verts, faces };
  fixWindingByVolume(m);
  assignRect(
    m,
    faces.map((_, i) => i),
    tile,
  );
  return m;
}

/** Signed area of a 2D outline (positive = counter-clockwise). */
function outlineArea(points: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// ---------------------------------------------------------------- shapes

/**
 * Stairs rising toward -Z (like the ramp): `steps` treads over a box of width x height x depth. The player
 * walks up steps that are not too high.
 */
export function stairsMesh(size: Vec3, steps = 5, tile: Rect = DEFAULT_TILE): MeshData {
  const [w, h, d] = size;
  const n = Math.max(2, Math.floor(steps));
  const pts: [number, number][] = [[d / 2, -h / 2]];
  for (let i = 0; i < n; i++) {
    const top = -h / 2 + ((i + 1) * h) / n;
    pts.push([d / 2 - (i * d) / n, top]);
    pts.push([d / 2 - ((i + 1) * d) / n, top]);
  }
  pts.push([-d / 2, -h / 2]);
  return extrudeProfile(pts, w, 'zy', tile);
}

/**
 * A wall with an arched opening that goes down to the ground: `size` is the whole wall (width, height,
 * thickness), the opening is `openWidth` wide and `openHeight` tall, with a round top.
 */
export function archMesh(size: Vec3, openWidth = 1.4, openHeight = 2.2, segments = 8, tile: Rect = DEFAULT_TILE): MeshData {
  const [w, h, d] = size;
  const ow = Math.min(openWidth, w - 0.2);
  const r = ow / 2;
  const oh = Math.min(Math.max(openHeight, r + 0.1), h - 0.1);
  const spring = oh - r; // where the round part starts
  const bottom = -h / 2;
  const pts: [number, number][] = [
    [-w / 2, bottom],
    [-r, bottom],
    [-r, bottom + spring],
  ];
  for (let i = 1; i < segments; i++) {
    const a = Math.PI - (i / segments) * Math.PI;
    pts.push([Math.cos(a) * r, bottom + spring + Math.sin(a) * r]);
  }
  pts.push([r, bottom + spring], [r, bottom], [w / 2, bottom], [w / 2, h / 2], [-w / 2, h / 2]);
  if (outlineArea(pts) < 0) pts.reverse();
  return extrudeProfile(pts, d, 'xy', tile);
}

/**
 * A cylinder with different radii at the bottom and top (a cone when the top radius is 0), standing on
 * its center. `startAngle` turns the outline (a 4-sided cone turned by 45 degrees is a square pyramid).
 */
export function cylinderMesh(sides: number, bottomRadius: number, topRadius: number, height: number, tile: Rect = DEFAULT_TILE, startAngle = 0): MeshData {
  const n = Math.max(3, Math.floor(sides));
  const pointed = topRadius <= 1e-6;
  const verts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + (i / n) * Math.PI * 2;
    verts.push([Math.cos(a) * bottomRadius, -height / 2, Math.sin(a) * bottomRadius]);
  }
  if (pointed) {
    verts.push([0, height / 2, 0]);
  } else {
    for (let i = 0; i < n; i++) {
      const a = startAngle + (i / n) * Math.PI * 2;
      verts.push([Math.cos(a) * topRadius, height / 2, Math.sin(a) * topRadius]);
    }
  }
  const faces: MeshFace[] = [];
  faces.push({ v: Array.from({ length: n }, (_, i) => i), uv: [] });
  if (!pointed) faces.push({ v: Array.from({ length: n }, (_, i) => n + i), uv: [] });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push(pointed ? { v: [i, j, n], uv: [] } : { v: [i, j, n + j, n + i], uv: [] });
  }
  const m: MeshData = { verts, faces };
  fixWinding(m);
  assignRect(
    m,
    faces.map((_, i) => i),
    tile,
  );
  return m;
}

/** A low-poly ball: `segments` around, `rings` from pole to pole. */
export function sphereMesh(radius = 0.5, segments = 8, rings = 5, tile: Rect = DEFAULT_TILE): MeshData {
  const n = Math.max(3, Math.floor(segments));
  const r = Math.max(2, Math.floor(rings));
  const verts: Vec3[] = [[0, radius, 0]];
  for (let j = 1; j < r; j++) {
    const phi = (j / r) * Math.PI;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      verts.push([Math.sin(phi) * Math.cos(th) * radius, Math.cos(phi) * radius, Math.sin(phi) * Math.sin(th) * radius]);
    }
  }
  verts.push([0, -radius, 0]);
  const bottom = verts.length - 1;
  const ring = (j: number, i: number) => 1 + (j - 1) * n + (i % n);
  const faces: MeshFace[] = [];
  for (let i = 0; i < n; i++) faces.push({ v: [0, ring(1, i + 1), ring(1, i)], uv: [] });
  for (let j = 1; j < r - 1; j++) {
    for (let i = 0; i < n; i++) faces.push({ v: [ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)], uv: [] });
  }
  for (let i = 0; i < n; i++) faces.push({ v: [ring(r - 1, i), ring(r - 1, i + 1), bottom], uv: [] });
  const m: MeshData = { verts, faces };
  fixWindingByVolume(m);
  assignRect(
    m,
    faces.map((_, i) => i),
    tile,
  );
  return m;
}

/** The upper half of a ball with a flat bottom. */
export function domeMesh(radius = 0.5, segments = 8, rings = 3, tile: Rect = DEFAULT_TILE): MeshData {
  const n = Math.max(3, Math.floor(segments));
  const r = Math.max(1, Math.floor(rings));
  const verts: Vec3[] = [[0, radius, 0]];
  for (let j = 1; j <= r; j++) {
    const phi = (j / r) * (Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      verts.push([Math.sin(phi) * Math.cos(th) * radius, Math.cos(phi) * radius, Math.sin(phi) * Math.sin(th) * radius]);
    }
  }
  const ring = (j: number, i: number) => 1 + (j - 1) * n + (i % n);
  const faces: MeshFace[] = [];
  for (let i = 0; i < n; i++) faces.push({ v: [0, ring(1, i + 1), ring(1, i)], uv: [] });
  for (let j = 1; j < r; j++) {
    for (let i = 0; i < n; i++) faces.push({ v: [ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)], uv: [] });
  }
  faces.push({ v: Array.from({ length: n }, (_, i) => ring(r, i)), uv: [] });
  const m: MeshData = { verts, faces };
  fixWindingByVolume(m);
  // center the half on its middle height, like the other shapes
  for (const v of m.verts) v[1] -= radius / 2;
  assignRect(
    m,
    faces.map((_, i) => i),
    tile,
  );
  return m;
}

/** A donut lying flat: `majorRadius` from the center to the middle of the tube, `minorRadius` the tube. */
export function torusMesh(majorRadius = 0.4, minorRadius = 0.12, majorSegments = 10, minorSegments = 6, tile: Rect = DEFAULT_TILE): MeshData {
  const M = Math.max(3, Math.floor(majorSegments));
  const N = Math.max(3, Math.floor(minorSegments));
  const verts: Vec3[] = [];
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2;
    for (let j = 0; j < N; j++) {
      const b = (j / N) * Math.PI * 2;
      const rr = majorRadius + Math.cos(b) * minorRadius;
      verts.push([Math.cos(a) * rr, Math.sin(b) * minorRadius, Math.sin(a) * rr]);
    }
  }
  const idx = (i: number, j: number) => (i % M) * N + (j % N);
  const faces: MeshFace[] = [];
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < N; j++) faces.push({ v: [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)], uv: [] });
  }
  const m: MeshData = { verts, faces };
  fixWindingByVolume(m);
  assignRect(
    m,
    faces.map((_, i) => i),
    tile,
  );
  return m;
}

/** Move a mesh so its lowest point is at y = 0 (it then stands on the ground at the origin). */
export function groundMesh(m: MeshData): number {
  const lift = -meshBounds(m).min[1];
  for (const v of m.verts) v[1] += lift;
  return lift;
}

/** The mean of the face centers (a quick "middle" of a mesh). */
export function meshCenter(m: MeshData): Vec3 {
  const c: Vec3 = [0, 0, 0];
  m.faces.forEach((_, fi) => {
    const p = faceCentroid(m, fi);
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  });
  const k = 1 / Math.max(1, m.faces.length);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Do all faces point away from the middle of the mesh? (Not meaningful for flat shapes.) */
export function pointsOutward(m: MeshData): boolean {
  const c = meshCenter(m);
  return m.faces.every((_, fi) => {
    const n = faceNormal(m, fi);
    const p = faceCentroid(m, fi);
    return n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]) > -1e-6;
  });
}

/** A ready-made mesh centered on the origin, textured with the given tile rectangle. */
export function primitiveMesh(kind: PrimitiveKind, tile: Rect = DEFAULT_TILE, seed = 1): MeshData {
  switch (kind) {
    case 'cube':
      return boxMesh([1, 1, 1], null, null, tile);
    case 'ramp':
      return wedgeMesh([1.5, 1, 2], tile);
    case 'stairs':
      return stairsMesh([2, 1.2, 3], 5, tile);
    case 'arch':
      return archMesh([3, 3, 0.6], 1.4, 2.2, 8, tile);
    case 'cylinder':
      return prismMesh(8, 0.5, 1, tile);
    case 'cone':
      return cylinderMesh(8, 0.6, 0, 1.2, tile);
    case 'sphere':
      return sphereMesh(0.6, 8, 5, tile);
    case 'dome':
      return domeMesh(0.8, 8, 3, tile);
    case 'ring':
      return torusMesh(0.6, 0.18, 12, 6, tile);
    case 'rock':
      return rockMesh(seed, 1.3, tile);
    case 'plane':
      return planeMesh(1, 1, tile);
    case 'tuft':
      return tuftMesh(1, tile);
  }
}
