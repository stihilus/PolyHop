// UV helpers. A face's UV is one point per face corner, in *texture pixel* space (origin top-left,
// y down). The points are in the same order as the face's vertex indices. For the six faces of a box
// that order is: lower-left, lower-right, upper-right, upper-left as seen from outside.

export type UV = [number, number];
export type UVPoly = UV[];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** UV that shows the rectangle upright and unmirrored on a quad (lower-left, lower-right, upper-right, upper-left). */
export function rectUv(x: number, y: number, w: number, h: number): UVPoly {
  return [
    [x, y + h],
    [x + w, y + h],
    [x + w, y],
    [x, y],
  ];
}

export function cloneUv(uv: UVPoly): UVPoly {
  return uv.map((p) => [p[0], p[1]] as UV);
}

export function uvBounds(uv: UVPoly): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of uv) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Rotate the picture on the face by one corner step, clockwise. */
export function rotateUvCW(uv: UVPoly): UVPoly {
  const n = uv.length;
  return uv.map((_, i) => [...uv[(i + 1) % n]!] as UV);
}

export function rotateUvCCW(uv: UVPoly): UVPoly {
  const n = uv.length;
  return uv.map((_, i) => [...uv[(i + n - 1) % n]!] as UV);
}

/** Mirror the UV left-right inside its own bounds (for an upright quad: the picture flips left-right). */
export function flipUvH(uv: UVPoly): UVPoly {
  const b = uvBounds(uv);
  return uv.map(([x, y]) => [b.minX + b.maxX - x, y] as UV);
}

/** Mirror the UV top-bottom inside its own bounds. */
export function flipUvV(uv: UVPoly): UVPoly {
  const b = uvBounds(uv);
  return uv.map(([x, y]) => [x, b.minY + b.maxY - y] as UV);
}

export function translateUv(uv: UVPoly, dx: number, dy: number): UVPoly {
  return uv.map((p) => [p[0] + dx, p[1] + dy] as UV);
}

/**
 * The move (dx, dy) of a group of UV quads, cut back so that none of them leaves the texture: the group keeps its
 * shape, it only stops at the edge as a whole.
 */
export function clampGroupMove(uvs: readonly UVPoly[], dx: number, dy: number, w: number, h: number): [number, number] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const uv of uvs) {
    for (const p of uv) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  if (!Number.isFinite(minX)) return [dx, dy];
  const fx = minX + dx < 0 ? 0 - minX : maxX + dx > w ? w - maxX : dx;
  const fy = minY + dy < 0 ? 0 - minY : maxY + dy > h ? h - maxY : dy;
  return [fx, fy];
}

export function clampUv(uv: UVPoly, w: number, h: number): UVPoly {
  return uv.map((p) => [Math.min(w, Math.max(0, p[0])), Math.min(h, Math.max(0, p[1]))] as UV);
}

/** Point-in-polygon, edges inclusive. */
export function pointInPoly(x: number, y: number, uv: UVPoly): boolean {
  const n = uv.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = uv[i]!;
    const [xj, yj] = uv[j]!;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) {
      return true;
    }
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (in texture px) vertices are pulled toward the face center so neighbours never bleed in. */
const INSET_PX = 0.01;

/**
 * Normalized texture coordinates for rendering: [u0, v0, u1, v1, ...] with v flipped so that image
 * row 0 is the top (three.js textures use flipY).
 */
export function uvToRenderCoords(uv: UVPoly, texW: number, texH: number): number[] {
  const n = uv.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of uv) {
    cx += x;
    cy += y;
  }
  cx /= n;
  cy /= n;
  const out: number[] = [];
  for (const [x, y] of uv) {
    const dx = cx - x;
    const dy = cy - y;
    const len = Math.hypot(dx, dy);
    const k = len > 1e-9 ? Math.min(INSET_PX, len * 0.5) / len : 0;
    out.push((x + dx * k) / texW, 1 - (y + dy * k) / texH);
  }
  return out;
}
