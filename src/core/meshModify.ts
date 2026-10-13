// Whole-mesh operations that round and soften shapes: Catmull-Clark smoothing, bevelling the hard edges,
// and the per-corner normals used for smooth shading. Plain functions on mesh data, no rendering.

import {
  type FaceTile,
  type MeshData,
  type MeshFace,
  edgeKey,
  faceCentroid,
  inheritTile,
  meshBounds,
  meshEdges,
  newellNormal,
} from './mesh';
import type { Vec3 } from './types';
import type { UV } from './uv';

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};
const mid2 = (a: UV, b: UV): UV => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function avg(points: Vec3[]): Vec3 {
  const s: Vec3 = [0, 0, 0];
  for (const p of points) {
    s[0] += p[0];
    s[1] += p[1];
    s[2] += p[2];
  }
  return scale(s, 1 / Math.max(1, points.length));
}

function avgUv(uvs: UV[]): UV {
  let u = 0;
  let v = 0;
  for (const p of uvs) {
    u += p[0];
    v += p[1];
  }
  const k = 1 / Math.max(1, uvs.length);
  return [u * k, v * k];
}

// ---------------------------------------------------------------- Catmull-Clark

/**
 * One round of Catmull-Clark subdivision: every face becomes one quad per corner and the surface is
 * pulled toward the smooth limit shape, so boxes turn into soft, rounded forms. Texture coordinates and
 * painted tiles are carried over. Returns a new mesh.
 */
export function smoothMesh(m: MeshData): MeshData {
  const facePoint: Vec3[] = m.faces.map((f) => avg(f.v.map((i) => m.verts[i]!)));
  const faceUv: UV[] = m.faces.map((f) => avgUv(f.uv));
  const edges = meshEdges(m);

  const edgePoint = new Map<string, Vec3>();
  for (const [key, e] of edges) {
    const a = m.verts[e.a]!;
    const b = m.verts[e.b]!;
    if (e.faces.length === 2) {
      edgePoint.set(key, scale(add(add(a, b), add(facePoint[e.faces[0]!.face]!, facePoint[e.faces[1]!.face]!)), 0.25));
    } else {
      edgePoint.set(key, scale(add(a, b), 0.5));
    }
  }

  // adjacency of the original vertices
  const vertFaces: number[][] = m.verts.map(() => []);
  const vertEdges: string[][] = m.verts.map(() => []);
  m.faces.forEach((f, fi) => f.v.forEach((v) => vertFaces[v]!.push(fi)));
  for (const [key, e] of edges) {
    vertEdges[e.a]!.push(key);
    vertEdges[e.b]!.push(key);
  }

  const moved: Vec3[] = m.verts.map((p, vi) => {
    const fs = vertFaces[vi]!;
    const es = vertEdges[vi]!;
    if (fs.length === 0 || es.length === 0) return p;
    const boundary = es.filter((k) => edges.get(k)!.faces.length !== 2);
    if (boundary.length === 0) {
      const n = es.length;
      const F = avg(fs.map((f) => facePoint[f]!));
      const R = avg(
        es.map((k) => {
          const e = edges.get(k)!;
          return scale(add(m.verts[e.a]!, m.verts[e.b]!), 0.5);
        }),
      );
      return scale(add(add(F, scale(R, 2)), scale(p, n - 3)), 1 / n);
    }
    if (boundary.length === 2) {
      const others = boundary.map((k) => {
        const e = edges.get(k)!;
        return m.verts[e.a === vi ? e.b : e.a]!;
      });
      return scale(add(add(scale(p, 6), others[0]!), others[1]!), 1 / 8);
    }
    return p; // a corner or a pinched vertex stays where it is
  });

  const verts: Vec3[] = [...moved];
  const facePointIndex = m.faces.map((_, fi) => {
    verts.push(facePoint[fi]!);
    return verts.length - 1;
  });
  const edgePointIndex = new Map<string, number>();
  for (const [key, p] of edgePoint) {
    verts.push(p);
    edgePointIndex.set(key, verts.length - 1);
  }

  const faces: MeshFace[] = [];
  m.faces.forEach((f, fi) => {
    const n = f.v.length;
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n;
      const next = (i + 1) % n;
      const eNext = edgePointIndex.get(edgeKey(f.v[i]!, f.v[next]!))!;
      const ePrev = edgePointIndex.get(edgeKey(f.v[prev]!, f.v[i]!))!;
      faces.push({
        v: [f.v[i]!, eNext, facePointIndex[fi]!, ePrev],
        uv: [[...f.uv[i]!], mid2(f.uv[i]!, f.uv[next]!), [...faceUv[fi]!], mid2(f.uv[prev]!, f.uv[i]!)],
        ...inheritTile(f),
      });
    }
  });
  return { verts, faces };
}

// ---------------------------------------------------------------- bevel

export interface BevelOptions {
  /** Width of the chamfer measured on each face. */
  amount: number;
  /** Edges whose faces turn by less than this many degrees are left alone (coplanar and soft edges). */
  minAngle?: number;
}

/**
 * Chamfer every hard edge: faces shrink a little and the gaps become flat strips along the edges and
 * small polygons at the corners. Works on closed surfaces; an open fan of faces is left unfilled.
 * Returns a new mesh.
 */
export function bevelMesh(m: MeshData, opts: BevelOptions): MeshData {
  const { amount } = opts;
  const cosLimit = Math.cos(((opts.minAngle ?? 20) * Math.PI) / 180);
  const normals = m.faces.map((_, fi) => newellNormal(m.faces[fi]!.v.map((i) => m.verts[i]!)));
  const edges = meshEdges(m);

  // which edges are hard: two faces that meet at a real angle
  const hard = new Map<string, [{ face: number; slot: number }, { face: number; slot: number }]>();
  for (const [key, e] of edges) {
    if (e.faces.length !== 2) continue;
    const [f, g] = e.faces as [{ face: number; slot: number }, { face: number; slot: number }];
    if (dot(normals[f.face]!, normals[g.face]!) < cosLimit) hard.set(key, [f, g]);
  }
  if (hard.size === 0 || amount <= 0) {
    return { verts: m.verts.map((v) => [...v] as Vec3), faces: m.faces.map((f) => ({ v: [...f.v], uv: f.uv.map((u) => [...u] as UV), ...inheritTile(f) })) };
  }

  // corners: one new vertex for every (face, corner); corners that meet along a soft edge share one
  const cornerId = (f: number, slot: number) => {
    let id = 0;
    for (let i = 0; i < f; i++) id += m.faces[i]!.v.length;
    return id + slot;
  };
  const cornerCount = m.faces.reduce((n, f) => n + f.v.length, 0);
  const parent = Array.from({ length: cornerCount }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const slotOf = (face: number, vertex: number) => m.faces[face]!.v.indexOf(vertex);
  for (const [key, e] of edges) {
    if (e.faces.length !== 2 || hard.has(key)) continue;
    const [f, g] = e.faces;
    for (const vtx of [e.a, e.b]) union(cornerId(f!.face, slotOf(f!.face, vtx)), cornerId(g!.face, slotOf(g!.face, vtx)));
  }

  // where each corner goes: moved inward along the face by `amount` (mitered at the corner)
  const cornerPos: Vec3[] = new Array(cornerCount);
  const cornerUv: UV[] = new Array(cornerCount);
  m.faces.forEach((f, fi) => {
    const n = f.v.length;
    const pts = f.v.map((i) => m.verts[i]!);
    const nrm = normals[fi]!;
    const c = faceCentroid(m, fi);
    const cUv = avgUv(f.uv);
    // how far inward is possible before the face folds over: the nearest edge to the middle
    let room = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const e = unit(sub(b, a));
      const toC = sub(c, a);
      const dist = len(sub(toC, scale(e, dot(toC, e))));
      room = Math.min(room, dist);
    }
    const d = Math.min(amount, room * 0.45);
    for (let i = 0; i < n; i++) {
      const p = pts[i]!;
      const prev = pts[(i + n - 1) % n]!;
      const next = pts[(i + 1) % n]!;
      const e1 = unit(sub(p, prev));
      const e2 = unit(sub(next, p));
      // inward in-plane normals of the two edges at this corner
      const n1 = unit(cross(nrm, e1));
      const n2 = unit(cross(nrm, e2));
      const k = 1 + dot(n1, n2);
      const offset = k > 1e-6 ? scale(add(n1, n2), d / k) : scale(n1, d);
      const pos = add(p, offset);
      const id = cornerId(fi, i);
      cornerPos[id] = pos;
      const ratio = Math.min(0.45, len(offset) / Math.max(1e-9, len(sub(c, p))));
      cornerUv[id] = [f.uv[i]![0] + (cUv[0] - f.uv[i]![0]) * ratio, f.uv[i]![1] + (cUv[1] - f.uv[i]![1]) * ratio];
    }
  });

  // one output vertex per group of shared corners (positions averaged)
  const groupIndex = new Map<number, number>();
  const groupPos: Vec3[][] = [];
  const verts: Vec3[] = [];
  for (let id = 0; id < cornerCount; id++) {
    const root = find(id);
    let g = groupIndex.get(root);
    if (g === undefined) {
      g = groupPos.length;
      groupIndex.set(root, g);
      groupPos.push([]);
    }
    groupPos[g]!.push(cornerPos[id]!);
  }
  for (const list of groupPos) verts.push(avg(list));
  const vertexOf = (f: number, slot: number) => groupIndex.get(find(cornerId(f, slot)))!;

  const faces: MeshFace[] = [];
  // the shrunken faces
  m.faces.forEach((f, fi) => {
    faces.push({
      v: f.v.map((_, i) => vertexOf(fi, i)),
      uv: f.v.map((_, i) => [...cornerUv[cornerId(fi, i)]!] as UV),
      ...inheritTile(f),
    });
  });

  // strips along the hard edges
  for (const [key, pair] of hard) {
    const e = edges.get(key)!;
    const [f, g] = pair;
    const a = e.a;
    const b = e.b;
    // the face that walks the edge as a -> b goes first, so the strip winds against both faces
    const fab = m.faces[f.face]!;
    const forward = fab.v[f.slot] === a ? f : g;
    const back = forward === f ? g : f;
    const fa = slotOf(forward.face, a);
    const fb = slotOf(forward.face, b);
    const ga = slotOf(back.face, a);
    const gb = slotOf(back.face, b);
    const quad = [vertexOf(forward.face, fb), vertexOf(forward.face, fa), vertexOf(back.face, ga), vertexOf(back.face, gb)];
    const uv = [
      cornerUv[cornerId(forward.face, fb)]!,
      cornerUv[cornerId(forward.face, fa)]!,
      cornerUv[cornerId(back.face, ga)]!,
      cornerUv[cornerId(back.face, gb)]!,
    ].map((u) => [...u] as UV);
    // a strip that shrank to a line (shared corners on both sides) is not a face
    if (new Set(quad).size >= 3) faces.push({ v: quad, uv, ...inheritTile(m.faces[forward.face]!) });
  }

  // corners: where all the faces around an original vertex meet, a small polygon closes the gap
  const vertFaces: { face: number; slot: number }[][] = m.verts.map(() => []);
  m.faces.forEach((f, fi) => f.v.forEach((v, slot) => vertFaces[v]!.push({ face: fi, slot })));
  m.verts.forEach((_, vi) => {
    const ring = fanAround(m, vi, vertFaces[vi]!, edges);
    if (!ring) return;
    const corners = ring.map((r) => ({ id: cornerId(r.face, r.slot), v: vertexOf(r.face, r.slot) }));
    // drop repeats (corners merged along soft edges)
    const poly: typeof corners = [];
    for (const c of corners) {
      if (poly.length === 0 || poly[poly.length - 1]!.v !== c.v) poly.push(c);
    }
    while (poly.length > 1 && poly[0]!.v === poly[poly.length - 1]!.v) poly.pop();
    if (new Set(poly.map((c) => c.v)).size < 3) return;
    // wind it like the surface: its normal has to agree with the faces around
    const around = avg(ring.map((r) => normals[r.face]!));
    const polyPts = poly.map((c) => verts[c.v]!);
    if (dot(newellNormal(polyPts), around) < 0) poly.reverse();
    faces.push({ v: poly.map((c) => c.v), uv: poly.map((c) => [...cornerUv[c.id]!] as UV), ...inheritTile(m.faces[ring[0]!.face]!) });
  });

  return { verts, faces };
}

/**
 * The faces around a vertex in order, as (face, corner slot) pairs, or null when the fan is open or
 * not a single loop (a boundary or a pinched vertex).
 */
function fanAround(
  m: MeshData,
  vertex: number,
  around: { face: number; slot: number }[],
  edges: ReturnType<typeof meshEdges>,
): { face: number; slot: number }[] | null {
  if (around.length < 3) return null;
  const start = around[0]!;
  const out: { face: number; slot: number }[] = [];
  let cur = start;
  for (let guard = 0; guard < around.length + 1; guard++) {
    out.push(cur);
    const f = m.faces[cur.face]!;
    const next = f.v[(cur.slot + 1) % f.v.length]!;
    const e = edges.get(edgeKey(vertex, next));
    if (!e || e.faces.length !== 2) return null;
    const other = e.faces[0]!.face === cur.face ? e.faces[1]! : e.faces[0]!;
    const g = m.faces[other.face]!;
    const slot = g.v.indexOf(vertex);
    if (slot < 0) return null;
    cur = { face: other.face, slot };
    if (cur.face === start.face) break;
  }
  if (cur.face !== start.face || out.length !== around.length) return null;
  return out;
}

/** A sensible bevel width for a mesh of this size (about a tenth of its smallest side, at most 12 cm). */
export function defaultBevel(m: MeshData): number {
  const b = meshBounds(m);
  const sizes = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].filter((s) => s > 0.01);
  const smallest = sizes.length > 0 ? Math.min(...sizes) : 1;
  return Math.min(0.12, smallest * 0.15);
}

// ---------------------------------------------------------------- shading normals

/**
 * Normals for every corner of every face. Without `smoothAngle` each face is flat. With it, corners
 * share a normal with the neighbouring faces that turn away by less than that many degrees: round
 * things look round and sharp edges stay sharp. `points` are the (already placed) vertex positions.
 */
export function faceCornerNormals(m: MeshData, points: Vec3[], smoothAngle: number | null): Vec3[][] {
  const faceN = m.faces.map((f) => {
    // not normalized: its length is twice the area, which is what a vertex normal should weigh by
    const pts = f.v.map((i) => points[i]!);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [nx, ny, nz] as Vec3;
  });
  const faceUnit = faceN.map((n) => {
    const l = len(n);
    return l > 1e-12 ? scale(n, 1 / l) : ([0, 1, 0] as Vec3);
  });
  if (smoothAngle === null) return m.faces.map((f, fi) => f.v.map(() => faceUnit[fi]!));

  const cosLimit = Math.cos((smoothAngle * Math.PI) / 180);
  const vertFaces: number[][] = m.verts.map(() => []);
  m.faces.forEach((f, fi) => f.v.forEach((v) => vertFaces[v]!.push(fi)));
  return m.faces.map((f, fi) =>
    f.v.map((v) => {
      let sum: Vec3 = [0, 0, 0];
      for (const g of vertFaces[v]!) {
        if (dot(faceUnit[g]!, faceUnit[fi]!) >= cosLimit) sum = add(sum, faceN[g]!);
      }
      const l = len(sum);
      return l > 1e-12 ? scale(sum, 1 / l) : faceUnit[fi]!;
    }),
  );
}

/** The default angle (degrees) up to which faces are shaded as one smooth surface. */
export const SMOOTH_ANGLE = 60;

export type { FaceTile };
