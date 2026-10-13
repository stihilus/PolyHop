import {
  type MeshData,
  cloneMesh,
  deleteFaces,
  deleteVertices,
  edgeRing,
  extrudeFaces,
  insetFaces,
  isValidMesh,
  mergeVertices,
  subdivideFaces,
} from '../core/mesh';
import { bevelMesh, defaultBevel, smoothMesh } from '../core/meshModify';
import type { Vec3 } from '../core/types';

export type SubMode = 'object' | 'face' | 'vertex';
export type MeshOpName = 'extrude' | 'inset' | 'subdivide' | 'delete' | 'merge' | 'bevel' | 'smooth';

export interface MeshSelection {
  sub: SubMode;
  faces: number[];
  vertices: number[];
}

export interface MeshOpResult {
  ok: boolean;
  /** Why nothing happened (shown to the user). */
  reason?: string;
  selection: MeshSelection;
  /** Gizmo mode that makes sense right after the operation. */
  tool?: 'translate' | 'scale';
  /** Gizmo axes that make sense right after the operation ('local' = along the face normal). */
  space?: 'local';
}

const INSET_AMOUNT = 0.25;

/**
 * Run one mesh operation on the selection. The mesh is only changed when the result is a valid mesh.
 * After a successful operation `selection` is what should be selected next.
 */
export function runMeshOp(op: MeshOpName, mesh: MeshData, sel: MeshSelection): MeshOpResult {
  const fail = (reason: string): MeshOpResult => ({ ok: false, reason, selection: sel });
  const work = cloneMesh(mesh);
  const commit = (selection: MeshSelection, extra: Partial<MeshOpResult> = {}): MeshOpResult => {
    if (!isValidMesh(work) || work.faces.length === 0) return fail('The operation would leave nothing of the shape.');
    mesh.verts = work.verts;
    mesh.faces = work.faces;
    return { ok: true, selection, ...extra };
  };
  const hasFaces = sel.sub === 'face' && sel.faces.length > 0;

  switch (op) {
    case 'extrude': {
      if (!hasFaces) return fail('Select a face first (Face mode, key 2), then extrude it.');
      const faces = extrudeFaces(work, sel.faces);
      return commit({ sub: 'face', faces, vertices: [] }, { tool: 'translate', space: 'local' });
    }
    case 'inset': {
      if (!hasFaces) return fail('Select a face first (Face mode, key 2), then inset it.');
      const faces = insetFaces(work, sel.faces, INSET_AMOUNT);
      return commit({ sub: 'face', faces, vertices: [] }, { tool: 'scale' });
    }
    case 'subdivide': {
      const target = hasFaces ? sel.faces : work.faces.map((_, i) => i);
      const faces = subdivideFaces(work, target);
      return commit({ sub: 'face', faces, vertices: [] });
    }
    case 'delete': {
      if (hasFaces) {
        deleteFaces(work, sel.faces);
        return commit({ sub: 'face', faces: [], vertices: [] });
      }
      if (sel.sub === 'vertex' && sel.vertices.length > 0) {
        deleteVertices(work, sel.vertices);
        return commit({ sub: 'vertex', faces: [], vertices: [] });
      }
      return fail('Select faces or vertices to delete.');
    }
    case 'bevel': {
      // the whole shape: every hard edge gets a small chamfer
      const out = bevelMesh(work, { amount: defaultBevel(work) });
      if (out.faces.length === work.faces.length) return fail('There are no hard edges to bevel.');
      work.verts = out.verts;
      work.faces = out.faces;
      return commit({ sub: 'object', faces: [], vertices: [] });
    }
    case 'smooth': {
      // the whole shape: one round of Catmull-Clark, so boxes turn soft and round
      if (work.faces.length > 600) return fail('The shape is already very detailed; smoothing it again would be too heavy.');
      const out = smoothMesh(work);
      work.verts = out.verts;
      work.faces = out.faces;
      return commit({ sub: 'object', faces: [], vertices: [] });
    }
    case 'merge': {
      if (sel.sub !== 'vertex' || sel.vertices.length < 2) return fail('Select two or more vertices (Vertex mode, key 3, Shift-click) to merge.');
      const idx = mergeVertices(work, sel.vertices);
      return commit({ sub: 'vertex', faces: [], vertices: idx >= 0 ? [idx] : [] }, { tool: 'translate' });
    }
  }
}

export interface EdgeHit {
  /** Corner slot in the face the edge starts at. */
  slot: number;
  a: number;
  b: number;
  /** Parameter along a -> b of the point closest to the cursor, kept away from the ends. */
  t: number;
  dist: number;
}

/** The edge of face `fi` closest to point `p` (mesh space). */
export function nearestEdge(mesh: MeshData, fi: number, p: Vec3): EdgeHit | null {
  const f = mesh.faces[fi];
  if (!f) return null;
  const n = f.v.length;
  let best: EdgeHit | null = null;
  for (let s = 0; s < n; s++) {
    const a = f.v[s]!;
    const b = f.v[(s + 1) % n]!;
    const pa = mesh.verts[a]!;
    const pb = mesh.verts[b]!;
    const ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ap = [p[0] - pa[0], p[1] - pa[1], p[2] - pa[2]];
    const len2 = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!;
    const raw = len2 > 1e-12 ? (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / len2 : 0.5;
    const t = Math.min(0.95, Math.max(0.05, raw));
    const q = [pa[0] + ab[0]! * t, pa[1] + ab[1]! * t, pa[2] + ab[2]! * t];
    const dist = Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!);
    if (!best || dist < best.dist) best = { slot: s, a, b, t, dist };
  }
  return best;
}

/** Line segments (mesh space) through the middle of every quad of the ring a loop cut would use. */
export function ringPreviewSegments(mesh: MeshData, fi: number, slot: number): [Vec3, Vec3][] | null {
  const ring = edgeRing(mesh, fi, slot);
  if (!ring) return null;
  const mid = (a: number, b: number): Vec3 => {
    const pa = mesh.verts[a]!;
    const pb = mesh.verts[b]!;
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
  };
  return ring.faces.map((rf) => {
    const f = mesh.faces[rf.face]!;
    const s = rf.slot;
    return [mid(f.v[s]!, f.v[(s + 1) % 4]!), mid(f.v[(s + 2) % 4]!, f.v[(s + 3) % 4]!)] as [Vec3, Vec3];
  });
}
