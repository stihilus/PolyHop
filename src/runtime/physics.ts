import type { Vec3 } from '../core/types';

/** Axis-aligned box. All level collision in v1 is axis-aligned boxes. */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Penetration smaller than this is treated as "touching", which prevents snagging on seams. */
export const EPS = 1e-4;

export function boxFromCenterSize(center: Vec3, size: Vec3): Box {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size;
  return {
    minX: cx - sx / 2,
    maxX: cx + sx / 2,
    minY: cy - sy / 2,
    maxY: cy + sy / 2,
    minZ: cz - sz / 2,
    maxZ: cz + sz / 2,
  };
}

/** Smallest axis-aligned box containing all points. */
export function boxFromPoints(points: Vec3[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.minX < b.maxX - EPS &&
    a.maxX > b.minX + EPS &&
    a.minY < b.maxY - EPS &&
    a.maxY > b.minY + EPS &&
    a.minZ < b.maxZ - EPS &&
    a.maxZ > b.minZ + EPS
  );
}

/** Distance along the ray to the nearest box hit (slab method), or null. dir must be normalized. */
export function raycastBoxes(origin: Vec3, dir: Vec3, maxDist: number, boxes: Box[]): number | null {
  let best: number | null = null;
  for (const b of boxes) {
    let tMin = 0;
    let tMax = maxDist;
    const mins = [b.minX, b.minY, b.minZ];
    const maxs = [b.maxX, b.maxY, b.maxZ];
    let hit = true;
    for (let i = 0; i < 3; i++) {
      const o = origin[i]!;
      const d = dir[i]!;
      if (Math.abs(d) < 1e-9) {
        if (o < mins[i]! || o > maxs[i]!) {
          hit = false;
          break;
        }
      } else {
        let t1 = (mins[i]! - o) / d;
        let t2 = (maxs[i]! - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) {
          hit = false;
          break;
        }
      }
    }
    if (hit && (best === null || tMin < best)) best = tMin;
  }
  return best;
}

/** Height of the highest box top at or below `fromY` under the given footprint, or null. Used for the blob shadow. */
export function groundHeightBelow(x: number, z: number, halfW: number, fromY: number, boxes: Box[]): number | null {
  let best: number | null = null;
  for (const b of boxes) {
    if (x + halfW <= b.minX || x - halfW >= b.maxX || z + halfW <= b.minZ || z - halfW >= b.maxZ) continue;
    if (b.maxY > fromY + 0.01) continue;
    if (best === null || b.maxY > best) best = b.maxY;
  }
  return best;
}
