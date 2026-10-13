// Collision against triangle meshes: slopes, rotated blocks and irregular shapes. Level shapes that
// stay axis-aligned boxes keep the exact box collision of physics.ts; everything else is a list of
// world-space triangles that the player (a vertical capsule here) slides over.

import type { Vec3 } from '../core/types';
import type { Box } from './physics';

/** The triangles of one solid object (world space) and their bounds. */
export interface MeshCollider {
  /** 9 numbers per triangle: a, b, c. */
  tris: Float32Array;
  min: Vec3;
  max: Vec3;
}

/** Everything the player can stand on and bump into. */
export interface Colliders {
  /** Axis-aligned boxes (exact, flat-footed). */
  boxes: Box[];
  /** Everything else: slopes, rotated and irregular shapes. */
  meshes: MeshCollider[];
  /** Bodies of water: the player swims inside them (they are not solid). */
  liquids: Box[];
}

export const NO_COLLIDERS: Colliders = { boxes: [], meshes: [], liquids: [] };

export function meshColliderFromTriangles(tris: number[]): MeshCollider | null {
  if (tris.length < 9) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { tris: new Float32Array(tris), min, max };
}

/**
 * Split a big pile of triangles into spatial chunks (by the middle of each triangle on the ground plane),
 * each its own collider with tight bounds, so the player only tests the few chunks it is near.
 * Small piles stay one collider.
 */
export function chunkedColliders(tris: number[], chunk = 6, smallest = 120): MeshCollider[] {
  const count = tris.length / 9;
  if (count <= smallest) {
    const m = meshColliderFromTriangles(tris);
    return m ? [m] : [];
  }
  const groups = new Map<string, number[]>();
  for (let i = 0; i < tris.length; i += 9) {
    const cx = (tris[i]! + tris[i + 3]! + tris[i + 6]!) / 3;
    const cz = (tris[i + 2]! + tris[i + 5]! + tris[i + 8]!) / 3;
    const key = `${Math.floor(cx / chunk)}:${Math.floor(cz / chunk)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    for (let k = 0; k < 9; k++) g.push(tris[i + k]!);
  }
  const out: MeshCollider[] = [];
  for (const g of groups.values()) {
    const m = meshColliderFromTriangles(g);
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- small vector helpers (tuples)

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function closestPointOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, mul(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, mul(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, mul(sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(mul(ab, vb * denom), mul(ac, vc * denom)));
}

/** Closest points of two segments (Ericson, Real-Time Collision Detection 5.1.9). */
export function closestSegmentSegment(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { c1: Vec3; c2: Vec3 } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-12;
  let s: number;
  let t: number;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return { c1: add(p1, mul(d1, s)), c2: add(p2, mul(d2, t)) };
}

/** Parameter along the segment p -> q where it crosses the triangle, or null. */
export function segmentTriangleHit(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const dir = sub(q, p);
  const h = cross(dir, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det;
  const s = sub(p, a);
  const u = f * dot(s, h);
  if (u < 0 || u > 1) return null;
  const qv = cross(s, e1);
  const v = f * dot(dir, qv);
  if (v < 0 || u + v > 1) return null;
  const t = f * dot(e2, qv);
  return t >= 0 && t <= 1 ? t : null;
}

export interface Contact {
  /** Unit normal pointing from the triangle toward the capsule. */
  n: Vec3;
  /** How far the capsule reaches into the triangle (meters). */
  depth: number;
}

function triNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const n = cross(sub(b, a), sub(c, a));
  const l = len(n);
  return l < 1e-9 ? null : mul(n, 1 / l);
}

/**
 * Overlap of a capsule (segment p -> q, radius r) with one triangle, or null. The normal points out of
 * the triangle toward the capsule, so the capsule is freed by moving it along it by `depth`.
 */
export function capsuleTriangleContact(p: Vec3, q: Vec3, r: number, a: Vec3, b: Vec3, c: Vec3): Contact | null {
  const nTri = triNormal(a, b, c);
  if (!nTri) return null;

  const cross0 = segmentTriangleHit(p, q, a, b, c);
  if (cross0 !== null) {
    // the axis goes through the triangle: leave on whichever side takes less movement
    const dp = dot(sub(p, a), nTri);
    const dq = dot(sub(q, a), nTri);
    const up = r - Math.min(dp, dq); // push along +n until both ends are r in front
    const down = r + Math.max(dp, dq); // or along -n
    return up <= down ? { n: nTri, depth: up } : { n: mul(nTri, -1), depth: down };
  }

  // otherwise the closest pair of points is on an end of the segment or on a triangle edge
  let bestSeg = p;
  let bestTri = closestPointOnTriangle(p, a, b, c);
  let best = len(sub(bestSeg, bestTri));
  const consider = (onSeg: Vec3, onTri: Vec3) => {
    const d = len(sub(onSeg, onTri));
    if (d < best) {
      best = d;
      bestSeg = onSeg;
      bestTri = onTri;
    }
  };
  consider(q, closestPointOnTriangle(q, a, b, c));
  for (const [u, v] of [
    [a, b],
    [b, c],
    [c, a],
  ] as [Vec3, Vec3][]) {
    const { c1, c2 } = closestSegmentSegment(p, q, u, v);
    consider(c1, c2);
  }
  if (best >= r) return null;
  if (best < 1e-7) {
    // touching exactly: use the face normal on the side of the segment's middle
    const mid = mul(add(p, q), 0.5);
    const side = dot(sub(mid, a), nTri);
    return { n: side >= 0 ? nTri : mul(nTri, -1), depth: r };
  }
  return { n: mul(sub(bestSeg, bestTri), 1 / best), depth: r - best };
}

/** Distance along the ray to the nearest triangle, or null. `dir` must be normalized. */
export function raycastMeshes(origin: Vec3, dir: Vec3, maxDist: number, meshes: MeshCollider[]): number | null {
  let best: number | null = null;
  for (const m of meshes) {
    // ray vs the object's bounds first (slab test)
    let tMin = 0;
    let tMax = best ?? maxDist;
    let hit = true;
    for (let i = 0; i < 3 && hit; i++) {
      const o = origin[i]!;
      const d = dir[i]!;
      if (Math.abs(d) < 1e-9) {
        if (o < m.min[i]! || o > m.max[i]!) hit = false;
      } else {
        let t1 = (m.min[i]! - o) / d;
        let t2 = (m.max[i]! - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) hit = false;
      }
    }
    if (!hit) continue;
    const T = m.tris;
    for (let i = 0; i < T.length; i += 9) {
      const e1x = T[i + 3]! - T[i]!;
      const e1y = T[i + 4]! - T[i + 1]!;
      const e1z = T[i + 5]! - T[i + 2]!;
      const e2x = T[i + 6]! - T[i]!;
      const e2y = T[i + 7]! - T[i + 1]!;
      const e2z = T[i + 8]! - T[i + 2]!;
      // h = dir x e2
      const hx = dir[1] * e2z - dir[2] * e2y;
      const hy = dir[2] * e2x - dir[0] * e2z;
      const hz = dir[0] * e2y - dir[1] * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      const sx = origin[0] - T[i]!;
      const sy = origin[1] - T[i + 1]!;
      const sz = origin[2] - T[i + 2]!;
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = f * (dir[0] * qx + dir[1] * qy + dir[2] * qz);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t >= 0 && t <= maxDist && (best === null || t < best)) best = t;
    }
  }
  return best;
}

/** Height of the surface straight below (x, fromY, z): the highest triangle hit by a downward ray, or null. */
export function meshGroundBelow(x: number, z: number, fromY: number, meshes: MeshCollider[]): number | null {
  const t = raycastMeshes([x, fromY + 0.01, z], [0, -1, 0], 200, meshes);
  return t === null ? null : fromY + 0.01 - t;
}

// ---------------------------------------------------------------- classification

/** True when the 3x3 part of a rotation only permutes (and possibly flips) the axes: multiples of 90 degrees. */
export function isAxisAlignedRotation(m: ArrayLike<number>, tolerance = 1e-4): boolean {
  // m: three.js Matrix4 elements (column-major) or a 3x3 in the same order; only the 3x3 block is read
  const cols = m.length === 9 ? 3 : 4;
  for (let c = 0; c < 3; c++) {
    let ones = 0;
    for (let r = 0; r < 3; r++) {
      const v = Math.abs(m[c * cols + r]!);
      if (Math.abs(v - 1) < tolerance) ones++;
      else if (v > tolerance) return false;
    }
    if (ones !== 1) return false;
  }
  return true;
}
