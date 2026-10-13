// General polygon mesh used by level blocks and model cubes: vertices plus faces of three or more
// corners, with one UV point per face corner. A box is just the 8-vertex, 6-quad mesh. All mesh
// editing (extrude, inset, loop cut, ...) is plain functions on this structure, no rendering.

import type { Vec3 } from './types';
import { type UV, type UVPoly, cloneUv, rectUv, uvBounds } from './uv';

/** A tile of an atlas painted on one face of a level block (instead of the block's own tile). */
export interface FaceTile {
  texture: string;
  col: number;
  row: number;
  /** Quarter turns of the picture on the face (0-3). */
  rot?: number;
  /** Mirrored left to right. */
  flip?: boolean;
}

export interface MeshFace {
  /** Vertex indices, counter-clockwise when seen from outside. */
  v: number[];
  /** One UV point (texture pixels) per corner, same order as `v`. */
  uv: UV[];
  /** Level blocks only: a tile for this face alone. Model cubes use `uv` into the texture instead. */
  tile?: FaceTile;
}

/** `{ tile }` of a face to spread into a new face made from it (nothing when it has none). */
export function inheritTile(face: MeshFace): { tile?: FaceTile } {
  return face.tile ? { tile: { ...face.tile } } : {};
}

/** A tile of unknown origin made into a valid one, or undefined. */
export function sanitizeFaceTile(raw: unknown): FaceTile | undefined {
  const t = raw as Partial<FaceTile> | null | undefined;
  if (!t || typeof t !== 'object' || typeof t.texture !== 'string' || !t.texture) return undefined;
  if (!Number.isInteger(t.col) || !Number.isInteger(t.row) || t.col! < 0 || t.row! < 0) return undefined;
  const out: FaceTile = { texture: t.texture, col: t.col!, row: t.row! };
  const rot = typeof t.rot === 'number' && Number.isFinite(t.rot) ? ((Math.round(t.rot) % 4) + 4) % 4 : 0;
  if (rot) out.rot = rot;
  if (t.flip === true) out.flip = true;
  return out;
}

export interface MeshData {
  verts: Vec3[];
  faces: MeshFace[];
}

export const FACE_KEYS = ['pz', 'nz', 'px', 'nx', 'py', 'ny'] as const;
export type FaceKey = (typeof FACE_KEYS)[number];

/**
 * Corner index bits of a box: x = 1, y = 2, z = 4 (a set bit is the + side). Per face the four corners
 * are listed lower-left, lower-right, upper-right, upper-left as seen from outside.
 */
export const FACE_CORNERS: Record<FaceKey, [number, number, number, number]> = {
  pz: [4, 5, 7, 6],
  nz: [1, 0, 2, 3],
  px: [5, 1, 3, 7],
  nx: [0, 4, 6, 2],
  py: [6, 7, 3, 2],
  ny: [0, 1, 5, 4],
};

export function baseCorner(size: Vec3, i: number): Vec3 {
  return [(i & 1 ? 0.5 : -0.5) * size[0], (i & 2 ? 0.5 : -0.5) * size[1], (i & 4 ? 0.5 : -0.5) * size[2]];
}

const DEFAULT_TILE = { x: 0, y: 0, w: 16, h: 16 };

// ---------------------------------------------------------------- small vector helpers

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp2 = (a: UV, b: UV, t: number): UV => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// ---------------------------------------------------------------- construction and validation

export function cloneMesh(m: MeshData): MeshData {
  return {
    verts: m.verts.map((v) => [...v] as Vec3),
    faces: m.faces.map((f) => ({ v: [...f.v], uv: cloneUv(f.uv), ...inheritTile(f) })),
  };
}

export function isValidMesh(raw: unknown): raw is MeshData {
  const m = raw as MeshData | null;
  if (!m || !Array.isArray(m.verts) || !Array.isArray(m.faces)) return false;
  if (m.verts.length < 3 || m.faces.length < 1) return false;
  const vertsOk = m.verts.every((v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n)));
  if (!vertsOk) return false;
  return m.faces.every(
    (f) =>
      f &&
      Array.isArray(f.v) &&
      f.v.length >= 3 &&
      f.v.every((i) => Number.isInteger(i) && i >= 0 && i < m.verts.length) &&
      Array.isArray(f.uv) &&
      f.uv.length === f.v.length &&
      f.uv.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])),
  );
}

/** A box mesh (8 vertices, 6 quads in FACE_KEYS order), optionally with moved corners and per-face UVs. */
export function boxMesh(
  size: Vec3,
  offsets?: Vec3[] | null,
  uvByFace?: Partial<Record<FaceKey, UVPoly>> | null,
  tile = DEFAULT_TILE,
): MeshData {
  const verts: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const b = baseCorner(size, i);
    const o = offsets?.[i];
    verts.push(o ? [b[0] + o[0], b[1] + o[1], b[2] + o[2]] : b);
  }
  const faces: MeshFace[] = FACE_KEYS.map((k) => ({
    v: [...FACE_CORNERS[k]],
    uv: cloneUv(uvByFace?.[k] ?? rectUv(tile.x, tile.y, tile.w, tile.h)),
  }));
  return { verts, faces };
}

// ---------------------------------------------------------------- queries

export function meshBounds(m: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of m.verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i]! < min[i]!) min[i] = v[i]!;
      if (v[i]! > max[i]!) max[i] = v[i]!;
    }
  }
  if (m.verts.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function meshSize(m: MeshData): Vec3 {
  const { min, max } = meshBounds(m);
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Unit normal of a polygon given its corners, by Newell's method (+Y for degenerate polygons). */
export function newellNormal(points: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  return len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 1, 0];
}

/** Face normal (unit length; +Y for degenerate faces). */
export function faceNormal(m: MeshData, fi: number): Vec3 {
  return newellNormal(m.faces[fi]!.v.map((i) => m.verts[i]!));
}

export function faceCentroid(m: MeshData, fi: number): Vec3 {
  const f = m.faces[fi]!;
  const c: Vec3 = [0, 0, 0];
  for (const i of f.v) {
    const p = m.verts[i]!;
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const k = 1 / f.v.length;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Every distinct edge with the faces (and corner slots) that use it. */
export function meshEdges(m: MeshData): Map<string, { a: number; b: number; faces: { face: number; slot: number }[] }> {
  const edges = new Map<string, { a: number; b: number; faces: { face: number; slot: number }[] }>();
  m.faces.forEach((f, fi) => {
    const n = f.v.length;
    for (let s = 0; s < n; s++) {
      const a = f.v[s]!;
      const b = f.v[(s + 1) % n]!;
      const key = edgeKey(a, b);
      let e = edges.get(key);
      if (!e) {
        e = { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
        edges.set(key, e);
      }
      e.faces.push({ face: fi, slot: s });
    }
  });
  return edges;
}

/**
 * Split a face into triangles. Returns triples of corner slots (indices into face.v / face.uv).
 * Quads use one diagonal; larger polygons use ear clipping in the plane of the face.
 */
export function triangulateFace(m: MeshData, fi: number): number[][] {
  const f = m.faces[fi]!;
  const n = f.v.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) return [
    [0, 1, 2],
    [0, 2, 3],
  ];

  const pts = f.v.map((i) => m.verts[i]!);
  const nrm = faceNormal(m, fi);
  const ax = [Math.abs(nrm[0]), Math.abs(nrm[1]), Math.abs(nrm[2])];
  const drop = ax[0]! >= ax[1]! && ax[0]! >= ax[2]! ? 0 : ax[1]! >= ax[2]! ? 1 : 2;
  const p2 = pts.map((p) => (drop === 0 ? [p[1], p[2]] : drop === 1 ? [p[2], p[0]] : [p[0], p[1]]) as [number, number]);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = p2[i]!;
    const b = p2[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  // points on the border count as inside, so an ear never swallows a reflex corner lying on its edge
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) =>
    sign * cross(a, b, p) >= -1e-12 && sign * cross(b, c, p) >= -1e-12 && sign * cross(c, a, p) >= -1e-12;
  const same = (p: [number, number], q: [number, number]) => Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;

  const idx = Array.from({ length: n }, (_, i) => i);
  const tris: number[][] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]!;
      const ib = idx[k]!;
      const ic = idx[(k + 1) % idx.length]!;
      if (sign * cross(p2[ia]!, p2[ib]!, p2[ic]!) <= 1e-12) continue; // reflex or flat corner
      let ear = true;
      for (const other of idx) {
        if (other === ia || other === ib || other === ic) continue;
        const o = p2[other]!;
        if (same(o, p2[ia]!) || same(o, p2[ib]!) || same(o, p2[ic]!)) continue;
        if (inside(o, p2[ia]!, p2[ib]!, p2[ic]!)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0]!, idx[1]!, idx[2]!]);
  else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0]!, idx[i]!, idx[i + 1]!]); // fallback fan
  return tris;
}

// ---------------------------------------------------------------- planar texture mapping

/** The texture axes of a face by its dominant normal axis (the same orientation boxes always used). */
export function planarAxes(n: Vec3): { u: Vec3; v: Vec3 } {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return n[1] >= 0 ? { u: [1, 0, 0], v: [0, 0, -1] } : { u: [1, 0, 0], v: [0, 0, 1] };
  if (az >= ax) return n[2] >= 0 ? { u: [1, 0, 0], v: [0, 1, 0] } : { u: [-1, 0, 0], v: [0, 1, 0] };
  return n[0] >= 0 ? { u: [0, 0, -1], v: [0, 1, 0] } : { u: [0, 0, 1], v: [0, 1, 0] };
}

/** Planar (u, v) coordinates in meters of a face's corners, measured from the face's own minimum. */
export function planarCoords(m: MeshData, fi: number): { coords: UV[]; width: number; height: number } {
  const f = m.faces[fi]!;
  const { u, v } = planarAxes(faceNormal(m, fi));
  const raw = f.v.map((i) => [dot(m.verts[i]!, u), dot(m.verts[i]!, v)] as UV);
  const minU = Math.min(...raw.map((p) => p[0]));
  const minV = Math.min(...raw.map((p) => p[1]));
  const coords = raw.map((p) => [p[0] - minU, p[1] - minV] as UV);
  return {
    coords,
    width: Math.max(...coords.map((p) => p[0])),
    height: Math.max(...coords.map((p) => p[1])),
  };
}

/** Map a face's shape onto a texture rectangle (stretched, upright). Quads become the exact rectangle. */
export function uvFromRect(m: MeshData, fi: number, rect: { x: number; y: number; w: number; h: number }): UV[] {
  const { coords, width, height } = planarCoords(m, fi);
  const w = width > 1e-9 ? width : 1;
  const h = height > 1e-9 ? height : 1;
  return coords.map(([cu, cv]) => [rect.x + (cu / w) * rect.w, rect.y + rect.h - (cv / h) * rect.h] as UV);
}

// ---------------------------------------------------------------- editing operations (in place)

function rectFor(face: MeshFace): { x: number; y: number; w: number; h: number } {
  const b = uvBounds(face.uv);
  return { x: b.minX, y: b.minY, w: Math.max(1, b.maxX - b.minX), h: Math.max(1, b.maxY - b.minY) };
}

/**
 * Extrude faces: their vertices are duplicated, the faces move to the copies and walls close the gap
 * along the selection's boundary. Nothing moves yet; the caller drags the returned faces.
 * Returns the (unchanged) indices of the faces that were extruded.
 */
export function extrudeFaces(m: MeshData, faces: number[]): number[] {
  const sel = [...new Set(faces)].filter((f) => f >= 0 && f < m.faces.length);
  if (sel.length === 0) return [];
  const used = new Set<number>();
  for (const f of sel) for (const v of m.faces[f]!.v) used.add(v);
  const map = new Map<number, number>();
  for (const v of used) {
    map.set(v, m.verts.length);
    m.verts.push([...m.verts[v]!] as Vec3);
  }

  const edgeUse = new Map<string, number>();
  for (const f of sel) {
    const fv = m.faces[f]!.v;
    for (let i = 0; i < fv.length; i++) {
      const k = edgeKey(fv[i]!, fv[(i + 1) % fv.length]!);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }

  const walls: MeshFace[] = [];
  for (const f of sel) {
    const face = m.faces[f]!;
    const n = face.v.length;
    const rect = rectFor(face);
    const wallUv = rectUv(rect.x, rect.y, rect.w, rect.h);
    for (let i = 0; i < n; i++) {
      const a = face.v[i]!;
      const b = face.v[(i + 1) % n]!;
      if (edgeUse.get(edgeKey(a, b)) !== 1) continue; // interior edge of the selection
      walls.push({ v: [a, b, map.get(b)!, map.get(a)!], uv: cloneUv(wallUv), ...inheritTile(face) });
    }
  }
  for (const f of sel) {
    const face = m.faces[f]!;
    face.v = face.v.map((v) => map.get(v)!);
  }
  m.faces.push(...walls);
  return sel;
}

/** Inset faces individually: a ring of quads around a smaller copy of each face. Returns the inner faces. */
export function insetFaces(m: MeshData, faces: number[], amount = 0.25): number[] {
  const t = Math.min(0.9, Math.max(0.02, amount));
  const sel = [...new Set(faces)].filter((f) => f >= 0 && f < m.faces.length);
  const walls: MeshFace[] = [];
  for (const f of sel) {
    const face = m.faces[f]!;
    const n = face.v.length;
    const c = faceCentroid(m, f);
    const uvc: UV = [0, 0];
    for (const p of face.uv) {
      uvc[0] += p[0] / n;
      uvc[1] += p[1] / n;
    }
    const inner = face.v.map((vi) => {
      const idx = m.verts.length;
      m.verts.push(lerp3(m.verts[vi]!, c, t));
      return idx;
    });
    const innerUv = face.uv.map((p) => lerp2(p, uvc, t));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      walls.push({
        v: [face.v[i]!, face.v[j]!, inner[j]!, inner[i]!],
        uv: [[...face.uv[i]!], [...face.uv[j]!], [...innerUv[j]!], [...innerUv[i]!]] as UV[],
        ...inheritTile(face),
      });
    }
    face.v = inner;
    face.uv = innerUv;
  }
  m.faces.push(...walls);
  return sel;
}

/** Insert `vertex` into every face that has the edge (a, b), with UVs interpolated from that face's corners. */
function insertIntoFaces(m: MeshData, a: number, b: number, vertex: number, t: number, skip?: Set<number>): void {
  for (let fi = 0; fi < m.faces.length; fi++) {
    if (skip?.has(fi)) continue;
    const f = m.faces[fi]!;
    const n = f.v.length;
    for (let s = 0; s < n; s++) {
      const p = f.v[s]!;
      const q = f.v[(s + 1) % n]!;
      if ((p === a && q === b) || (p === b && q === a)) {
        // t runs from a to b; flip it when the face walks the edge the other way
        const tt = p === a ? t : 1 - t;
        const uvMid = lerp2(f.uv[s]!, f.uv[(s + 1) % n]!, tt);
        f.v.splice(s + 1, 0, vertex);
        f.uv.splice(s + 1, 0, uvMid);
        break;
      }
    }
  }
}

/** Split the edge (a, b) at parameter t. Every face using the edge gets the new corner. Returns the new vertex. */
export function splitEdge(m: MeshData, a: number, b: number, t = 0.5): number {
  const idx = m.verts.length;
  m.verts.push(lerp3(m.verts[a]!, m.verts[b]!, t));
  insertIntoFaces(m, a, b, idx, t);
  return idx;
}

/**
 * Subdivide faces: each becomes one quad per corner around a new center vertex, using edge midpoints.
 * Neighbouring faces that share a subdivided edge receive the midpoint too (no cracks).
 * Returns the indices of all faces created from the selection.
 */
export function subdivideFaces(m: MeshData, faces: number[]): number[] {
  const sel = [...new Set(faces)].filter((f) => f >= 0 && f < m.faces.length).sort((a, b) => a - b);
  if (sel.length === 0) return [];
  const selected = new Set(sel);
  const mid = new Map<string, number>();
  const midVert = (a: number, b: number) => {
    const k = edgeKey(a, b);
    let idx = mid.get(k);
    if (idx === undefined) {
      idx = m.verts.length;
      m.verts.push(lerp3(m.verts[a]!, m.verts[b]!, 0.5));
      mid.set(k, idx);
    }
    return idx;
  };

  const created: number[] = [];
  const appended: MeshFace[] = [];
  const replacements = new Map<number, MeshFace>();
  for (const f of sel) {
    const face = m.faces[f]!;
    const n = face.v.length;
    const center = faceCentroid(m, f);
    const ci = m.verts.length;
    m.verts.push(center);
    const uvc: UV = [0, 0];
    for (const p of face.uv) {
      uvc[0] += p[0] / n;
      uvc[1] += p[1] / n;
    }
    const mids = face.v.map((v, i) => midVert(v, face.v[(i + 1) % n]!));
    const midUv = face.uv.map((p, i) => lerp2(p, face.uv[(i + 1) % n]!, 0.5));
    const quads: MeshFace[] = [];
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n;
      quads.push({
        v: [face.v[i]!, mids[i]!, ci, mids[prev]!],
        uv: [[...face.uv[i]!], [...midUv[i]!], [...uvc], [...midUv[prev]!]] as UV[],
        ...inheritTile(face),
      });
    }
    replacements.set(f, quads[0]!);
    for (let i = 1; i < quads.length; i++) appended.push(quads[i]!);
  }
  // neighbours that touch a new midpoint get it inserted (they become polygons with more corners)
  for (let fi = 0; fi < m.faces.length; fi++) {
    if (selected.has(fi)) continue;
    const f = m.faces[fi]!;
    const n = f.v.length;
    const nv: number[] = [];
    const nuv: UV[] = [];
    for (let s = 0; s < n; s++) {
      nv.push(f.v[s]!);
      nuv.push(f.uv[s]!);
      const k = edgeKey(f.v[s]!, f.v[(s + 1) % n]!);
      const mi = mid.get(k);
      if (mi !== undefined) {
        nv.push(mi);
        nuv.push(lerp2(f.uv[s]!, f.uv[(s + 1) % n]!, 0.5));
      }
    }
    f.v = nv;
    f.uv = nuv;
  }
  for (const [f, quad] of replacements) {
    m.faces[f] = quad;
    created.push(f);
  }
  const base = m.faces.length;
  m.faces.push(...appended);
  for (let i = 0; i < appended.length; i++) created.push(base + i);
  return created;
}

export interface EdgeRing {
  /** Crossing edges in order (vertex index pairs). */
  edges: [number, number][];
  /** Faces the cut passes through, with the slot of the crossing edge in each. */
  faces: { face: number; slot: number }[];
  closed: boolean;
}

/**
 * Find the ring of quads reached by walking across opposite edges, starting at the edge that begins at
 * corner `slot` of face `fi`. The cut of a loop cut runs through the middle of those edges.
 */
export function edgeRing(m: MeshData, fi: number, slot: number): EdgeRing | null {
  const start = m.faces[fi];
  if (!start || start.v.length !== 4) return null;
  const edges = meshEdges(m);
  const ringFaces: { face: number; slot: number }[] = [];
  const seen = new Set<number>();

  const walk = (face: number, s: number, dir: 1 | -1): { face: number; slot: number }[] => {
    const out: { face: number; slot: number }[] = [];
    let cf = face;
    let cs = s;
    // dir 1 leaves through the edge opposite the entry edge; dir -1 leaves through the entry edge
    for (let guard = 0; guard < 10000; guard++) {
      const f = m.faces[cf]!;
      if (f.v.length !== 4) break;
      const exitSlot = dir === 1 ? (cs + 2) % 4 : cs;
      const a = f.v[exitSlot]!;
      const b = f.v[(exitSlot + 1) % 4]!;
      const e = edges.get(edgeKey(a, b));
      const next = e?.faces.find((x) => x.face !== cf);
      if (!next) break;
      const nf = m.faces[next.face]!;
      if (nf.v.length !== 4) break;
      if (next.face === face) {
        // came all the way around
        return [...out, { face: -1, slot: -1 }];
      }
      if (seen.has(next.face)) break;
      seen.add(next.face);
      out.push({ face: next.face, slot: next.slot });
      cf = next.face;
      cs = next.slot;
      dir = 1;
    }
    return out;
  };

  seen.add(fi);
  const forward = walk(fi, slot, 1);
  const closed = forward.length > 0 && forward[forward.length - 1]!.face === -1;
  const fwd = closed ? forward.slice(0, -1) : forward;
  const backward = closed ? [] : walk(fi, slot, -1);

  // order: backward (reversed) ... start ... forward
  for (let i = backward.length - 1; i >= 0; i--) ringFaces.push(backward[i]!);
  ringFaces.push({ face: fi, slot });
  ringFaces.push(...fwd);

  // each ring face is crossed through the edge at its slot and the opposite one
  const crossing: [number, number][] = [];
  const keys = new Set<string>();
  const pushEdge = (a: number, b: number) => {
    const k = edgeKey(a, b);
    if (!keys.has(k)) {
      keys.add(k);
      crossing.push([a, b]);
    }
  };
  for (const rf of ringFaces) {
    const f = m.faces[rf.face]!;
    pushEdge(f.v[rf.slot]!, f.v[(rf.slot + 1) % 4]!);
    pushEdge(f.v[(rf.slot + 2) % 4]!, f.v[(rf.slot + 3) % 4]!);
  }
  return { edges: crossing, faces: ringFaces, closed };
}

/**
 * Loop cut: add a vertex on every crossing edge of the ring at parameter `t` and split the ring's quads
 * in two. Returns the new vertices (the cut loop), or null if the face is not a quad.
 */
export function loopCut(m: MeshData, fi: number, slot: number, t = 0.5): number[] | null {
  const ring = edgeRing(m, fi, slot);
  if (!ring || ring.faces.length === 0) return null;

  // one new vertex per crossing edge, parameterized from the edge's smaller index to its larger
  const mids = new Map<string, number>();
  for (const [a, b] of ring.edges) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const idx = m.verts.length;
    m.verts.push(lerp3(m.verts[lo]!, m.verts[hi]!, t));
    mids.set(edgeKey(a, b), idx);
  }
  const param = (a: number, b: number) => (a < b ? t : 1 - t); // t measured from a toward b

  const inRing = new Set(ring.faces.map((r) => r.face));
  const additions: MeshFace[] = [];
  for (const rf of ring.faces) {
    const f = m.faces[rf.face]!;
    const s = rf.slot;
    const v = [f.v[s]!, f.v[(s + 1) % 4]!, f.v[(s + 2) % 4]!, f.v[(s + 3) % 4]!];
    const uv = [f.uv[s]!, f.uv[(s + 1) % 4]!, f.uv[(s + 2) % 4]!, f.uv[(s + 3) % 4]!];
    const mab = mids.get(edgeKey(v[0]!, v[1]!))!;
    const mcd = mids.get(edgeKey(v[2]!, v[3]!))!;
    const uab = lerp2(uv[0]!, uv[1]!, param(v[0]!, v[1]!));
    // the edge c -> d: the shared midpoint is measured from the smaller index
    const ucd = lerp2(uv[2]!, uv[3]!, param(v[2]!, v[3]!));
    f.v = [v[0]!, mab, mcd, v[3]!];
    f.uv = [[...uv[0]!], uab, ucd, [...uv[3]!]] as UV[];
    additions.push({ v: [mab, v[1]!, v[2]!, mcd], uv: [[...uab], [...uv[1]!], [...uv[2]!], [...ucd]] as UV[], ...inheritTile(f) });
  }
  // faces outside the ring that touch a crossing edge need the midpoint, or the mesh would crack
  for (const [a, b] of ring.edges) {
    const idx = mids.get(edgeKey(a, b))!;
    insertIntoFaces(m, Math.min(a, b), Math.max(a, b), idx, t, inRing);
  }
  m.faces.push(...additions);
  return [...mids.values()];
}

/** Remove vertices no face uses and renumber. */
export function compactMesh(m: MeshData): void {
  const used = new Set<number>();
  for (const f of m.faces) for (const v of f.v) used.add(v);
  const remap = new Map<number, number>();
  const verts: Vec3[] = [];
  m.verts.forEach((v, i) => {
    if (used.has(i)) {
      remap.set(i, verts.length);
      verts.push(v);
    }
  });
  m.verts = verts;
  for (const f of m.faces) f.v = f.v.map((v) => remap.get(v)!);
}

export function deleteFaces(m: MeshData, faces: number[]): void {
  const doomed = new Set(faces);
  m.faces = m.faces.filter((_, i) => !doomed.has(i));
  compactMesh(m);
}

/** Delete vertices together with every face that uses them. */
export function deleteVertices(m: MeshData, verts: number[]): void {
  const doomed = new Set(verts);
  m.faces = m.faces.filter((f) => !f.v.some((v) => doomed.has(v)));
  compactMesh(m);
}

/** Weld vertices into one at their center. Returns the surviving vertex index (valid after compaction too). */
export function mergeVertices(m: MeshData, verts: number[]): number {
  const set = [...new Set(verts)].filter((v) => v >= 0 && v < m.verts.length).sort((a, b) => a - b);
  if (set.length < 2) return set[0] ?? -1;
  const target = set[0]!;
  const c: Vec3 = [0, 0, 0];
  for (const v of set) {
    c[0] += m.verts[v]![0];
    c[1] += m.verts[v]![1];
    c[2] += m.verts[v]![2];
  }
  m.verts[target] = [c[0] / set.length, c[1] / set.length, c[2] / set.length];
  const merged = new Set(set);
  const kept: MeshFace[] = [];
  for (const f of m.faces) {
    const v: number[] = [];
    const uv: UV[] = [];
    f.v.forEach((idx, i) => {
      const nv = merged.has(idx) ? target : idx;
      if (v.length > 0 && v[v.length - 1] === nv) return; // collapsed edge
      v.push(nv);
      uv.push(f.uv[i]!);
    });
    if (v.length > 1 && v[0] === v[v.length - 1]) {
      v.pop();
      uv.pop();
    }
    if (new Set(v).size >= 3 && v.length >= 3) kept.push({ v, uv, ...inheritTile(f) });
  }
  m.faces = kept;
  // compaction renumbers; report where the target ended up
  const before = new Set<number>();
  for (const f of m.faces) for (const x of f.v) before.add(x);
  const order = [...before].sort((a, b) => a - b);
  const result = order.indexOf(target);
  compactMesh(m);
  return result;
}

/** Move the geometry so its bounds are centered on the origin. Returns the shift that was applied. */
export function recenterMesh(m: MeshData): Vec3 {
  const { min, max } = meshBounds(m);
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  for (const v of m.verts) {
    v[0] -= c[0];
    v[1] -= c[1];
    v[2] -= c[2];
  }
  return c;
}

/** Scale the mesh about its bounds center so its bounding box becomes `size`. */
export function scaleMeshToSize(m: MeshData, size: Vec3): void {
  const { min, max } = meshBounds(m);
  const cur: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const k: Vec3 = [
    cur[0] > 1e-9 ? size[0] / cur[0] : 1,
    cur[1] > 1e-9 ? size[1] / cur[1] : 1,
    cur[2] > 1e-9 ? size[2] / cur[2] : 1,
  ];
  for (const v of m.verts) {
    v[0] = c[0] + (v[0] - c[0]) * k[0];
    v[1] = c[1] + (v[1] - c[1]) * k[1];
    v[2] = c[2] + (v[2] - c[2]) * k[2];
  }
}

/** Reassign the UVs of a set of faces so each one shows the given texture rectangle (stretched). */
export function assignRect(m: MeshData, faces: number[], rect: { x: number; y: number; w: number; h: number }): void {
  for (const f of faces) {
    if (f >= 0 && f < m.faces.length) m.faces[f]!.uv = uvFromRect(m, f, rect);
  }
}

// ---------------------------------------------------------------- primitives

/** Mirror image check helper for tests and callers: is the face normal pointing away from the mesh center? */
export function facesOutward(m: MeshData): boolean {
  const { min, max } = meshBounds(m);
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return m.faces.every((_, fi) => dot(faceNormal(m, fi), sub(faceCentroid(m, fi), c)) > -1e-6);
}

/** A ramp: the box [w, h, d] cut diagonally, rising toward -Z. */
export function wedgeMesh(size: Vec3, tile = DEFAULT_TILE): MeshData {
  const [w, h, d] = size;
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const verts: Vec3[] = [
    [-x, -y, z], // 0 front bottom left
    [x, -y, z], // 1 front bottom right
    [-x, -y, -z], // 2 back bottom left
    [x, -y, -z], // 3 back bottom right
    [-x, y, -z], // 4 back top left
    [x, y, -z], // 5 back top right
  ];
  const quad = (v: number[]): MeshFace => ({ v, uv: [] });
  const faces: MeshFace[] = [
    quad([0, 1, 5, 4]), // slope (normal up and toward +Z)
    quad([2, 4, 5, 3]), // back
    quad([0, 2, 3, 1]), // bottom
    quad([0, 4, 2]), // left triangle
    quad([1, 3, 5]), // right triangle
  ];
  const m: MeshData = { verts, faces };
  fixWinding(m);
  assignRect(m, faces.map((_, i) => i), tile);
  return m;
}

/** A prism with `sides` rectangular faces and n-gon caps (a low-poly cylinder). */
export function prismMesh(sides: number, radius: number, height: number, tile = DEFAULT_TILE): MeshData {
  const n = Math.max(3, Math.floor(sides));
  const verts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    verts.push([Math.cos(a) * radius, -height / 2, Math.sin(a) * radius]);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    verts.push([Math.cos(a) * radius, height / 2, Math.sin(a) * radius]);
  }
  const faces: MeshFace[] = [];
  const bottom = Array.from({ length: n }, (_, i) => i);
  const top = Array.from({ length: n }, (_, i) => n + i);
  faces.push({ v: top, uv: [] });
  faces.push({ v: bottom, uv: [] });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push({ v: [i, j, n + j, n + i], uv: [] });
  }
  const m: MeshData = { verts, faces };
  fixWinding(m);
  assignRect(m, faces.map((_, i) => i), tile);
  return m;
}

/** Make every face point away from the mesh center (fixes primitives written with arbitrary winding). */
export function fixWinding(m: MeshData): void {
  const { min, max } = meshBounds(m);
  const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  m.faces.forEach((f, fi) => {
    if (dot(faceNormal(m, fi), sub(faceCentroid(m, fi), c)) < 0) {
      f.v.reverse();
      f.uv.reverse();
    }
  });
}

/**
 * A flat rectangle standing upright, facing +Z (width x height meters, centered on the origin). It has
 * no thickness and a single face; renderers show it from both sides.
 */
export function planeMesh(width = 1, height = 1, tile = DEFAULT_TILE): MeshData {
  const x = width / 2;
  const y = height / 2;
  const m: MeshData = {
    verts: [
      [-x, -y, 0],
      [x, -y, 0],
      [x, y, 0],
      [-x, y, 0],
    ],
    faces: [{ v: [0, 1, 2, 3], uv: [] }],
  };
  assignRect(m, [0], tile);
  return m;
}

/** Two upright planes crossing at their middle (a "+" seen from above): the classic grass sprite. */
export function tuftMesh(size = 1, tile = DEFAULT_TILE): MeshData {
  const h = size / 2;
  const m: MeshData = {
    verts: [
      // facing +Z
      [-h, -h, 0],
      [h, -h, 0],
      [h, h, 0],
      [-h, h, 0],
      // facing +X
      [0, -h, h],
      [0, -h, -h],
      [0, h, -h],
      [0, h, h],
    ],
    faces: [
      { v: [0, 1, 2, 3], uv: [] },
      { v: [4, 5, 6, 7], uv: [] },
    ],
  };
  assignRect(m, [0, 1], tile);
  return m;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rough boulder: a subdivided box pushed in and out at random. Deterministic for a seed. */
export function rockMesh(seed = 1, size = 1, tile = DEFAULT_TILE): MeshData {
  const rand = mulberry32(seed);
  const m = boxMesh([size, size, size], null, null, tile);
  subdivideFaces(m, m.faces.map((_, i) => i));
  const radius = size / 2;
  m.verts = m.verts.map((v) => {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    // push toward a rounded shape, then roughen
    const target = radius * 1.12;
    const k = 0.45 + rand() * 0.25; // how much of the way to a sphere
    const rough = 0.82 + rand() * 0.36;
    const sx = 1 + (rand() - 0.5) * 0.35;
    const sz = 1 + (rand() - 0.5) * 0.35;
    const toward: Vec3 = [(v[0] / len) * target, (v[1] / len) * target, (v[2] / len) * target];
    const p = lerp3(v, toward, k);
    return [p[0] * rough * sx, p[1] * rough * 0.85, p[2] * rough * sz] as Vec3;
  });
  // flatten the bottom so it sits on the ground
  const { min } = meshBounds(m);
  const floor = min[1] + (meshBounds(m).max[1] - min[1]) * 0.18;
  m.verts = m.verts.map((v) => (v[1] < floor ? ([v[0], floor, v[2]] as Vec3) : v));
  return m;
}

