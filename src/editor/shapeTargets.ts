import * as THREE from 'three';
import { type MeshData, meshBounds, meshEdges, triangulateFace } from '../core/mesh';
import { MIN_SHAPE_SIZE, type Shape, degreesFromQuaternion, quaternionFromDegrees, worldPoints } from '../core/shape';
import type { LevelObject, Vec3 } from '../core/types';
import type { TransformDelta, TransformTarget } from './gizmo';
import type { SubMode } from './meshOps';

export type { SubMode };

/** What the editor reacts to while a gizmo drag is in progress. */
export interface ShapeHooks {
  /** Position or rotation changed (no geometry rebuild needed). */
  onTransform(): void;
  /** Vertices moved. */
  onGeometry(): void;
  /** The drag ended: record an undo step. */
  onCommit(): void;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const isIdentityQuat = (q: THREE.Quaternion) => Math.abs(Math.abs(q.w) - 1) < 1e-9;
const isUnitScale = (s: THREE.Vector3) => Math.abs(s.x - 1) < 1e-9 && Math.abs(s.y - 1) < 1e-9 && Math.abs(s.z - 1) < 1e-9;

function sizeOf(mesh: MeshData): Vec3 {
  const { min, max } = meshBounds(mesh);
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Move / rotate / resize the whole shape around its origin. */
export function objectTarget(shape: Shape, hooks: ShapeHooks, sizeStep = 0): TransformTarget {
  let pos0: Vec3 = [0, 0, 0];
  let q0 = new THREE.Quaternion();
  let verts0: Vec3[] = [];
  let size0: Vec3 = [1, 1, 1];
  return {
    allow: { translate: true, rotate: true, scale: true },
    pivot: () => new THREE.Vector3(shape.position[0], shape.position[1], shape.position[2]),
    orientation: () => quaternionFromDegrees(shape.rotation),
    begin() {
      pos0 = [...shape.position];
      q0 = quaternionFromDegrees(shape.rotation);
      verts0 = shape.mesh.verts.map((v) => [...v] as Vec3);
      size0 = sizeOf(shape.mesh);
    },
    apply(d: TransformDelta) {
      let geometry = false;
      if (d.translate.lengthSq() > 0) {
        shape.position = [pos0[0] + d.translate.x, pos0[1] + d.translate.y, pos0[2] + d.translate.z];
      }
      if (!isIdentityQuat(d.rotate)) {
        shape.rotation = degreesFromQuaternion(d.rotate.clone().multiply(q0));
      }
      if (!isUnitScale(d.scale)) {
        // scale the vertices about the shape's origin; the snap applies to the resulting bounding size
        const ratio: Vec3 = [1, 1, 1];
        for (let i = 0; i < 3; i++) {
          if (size0[i]! < 1e-6) continue; // a flat shape (plane) has nothing to scale along that axis
          const cur = size0[i]!;
          let want = Math.max(MIN_SHAPE_SIZE, cur * d.scale.getComponent(i));
          if (sizeStep > 0) want = Math.max(sizeStep, Math.round(want / sizeStep) * sizeStep);
          ratio[i] = want / cur;
        }
        shape.mesh.verts = verts0.map((v) => [round(v[0] * ratio[0]), round(v[1] * ratio[1]), round(v[2] * ratio[2])] as Vec3);
        geometry = true;
      }
      if (geometry) hooks.onGeometry();
      else hooks.onTransform();
    },
    end() {
      hooks.onCommit();
    },
  };
}

export interface MultiHooks {
  /** Positions / rotations of these objects changed. */
  onTransform(objects: LevelObject[]): void;
  /** Their geometry or scale changed too (models are rebuilt, blocks re-meshed). */
  onGeometry(objects: LevelObject[]): void;
  /** The drag ended: record an undo step. */
  onCommit(): void;
}

/**
 * Move / rotate / scale several objects together about their center. The gizmo works along the world
 * axes; scaling also stretches each object's own size along its own axes.
 */
export function multiObjectTarget(objects: LevelObject[], hooks: MultiHooks): TransformTarget {
  interface Start {
    pos: Vec3;
    q: THREE.Quaternion;
    scale: Vec3;
    verts: Vec3[] | null;
  }
  let start: Start[] = [];
  let center = new THREE.Vector3();

  const centroid = () => {
    const c = new THREE.Vector3();
    for (const o of objects) c.add(new THREE.Vector3(o.position[0], o.position[1], o.position[2]));
    return c.divideScalar(Math.max(1, objects.length));
  };

  return {
    allow: { translate: true, rotate: true, scale: true },
    pivot: centroid,
    orientation: () => new THREE.Quaternion(),
    begin() {
      center = centroid();
      start = objects.map((o) => ({
        pos: [...o.position] as Vec3,
        q: quaternionFromDegrees(o.rotation),
        scale: o.kind === 'model' ? ([...o.scale] as Vec3) : [1, 1, 1],
        verts: o.kind === 'block' ? o.mesh.verts.map((v) => [...v] as Vec3) : null,
      }));
    },
    apply(d: TransformDelta) {
      const scaled = !isUnitScale(d.scale);
      const turned = !isIdentityQuat(d.rotate);
      const k = (n: number) => Math.max(0.01, n);
      objects.forEach((o, i) => {
        const s = start[i]!;
        const rel = new THREE.Vector3(s.pos[0] - center.x, s.pos[1] - center.y, s.pos[2] - center.z);
        if (scaled) rel.multiply(d.scale);
        if (turned) rel.applyQuaternion(d.rotate);
        o.position = [center.x + rel.x + d.translate.x, center.y + rel.y + d.translate.y, center.z + rel.z + d.translate.z];
        if (turned) o.rotation = degreesFromQuaternion(d.rotate.clone().multiply(s.q));
        if (scaled) {
          if (o.kind === 'model') {
            o.scale = [
              Math.max(0.05, round(s.scale[0] * d.scale.x)),
              Math.max(0.05, round(s.scale[1] * d.scale.y)),
              Math.max(0.05, round(s.scale[2] * d.scale.z)),
            ];
          } else if (s.verts) {
            const fx = k(d.scale.x);
            const fy = k(d.scale.y);
            const fz = k(d.scale.z);
            o.mesh.verts = s.verts.map((v) => [round(v[0] * fx), round(v[1] * fy), round(v[2] * fz)] as Vec3);
          }
        }
      });
      if (scaled) hooks.onGeometry(objects);
      else hooks.onTransform(objects);
    },
    end() {
      hooks.onCommit();
    },
  };
}

export interface VertexTargetOptions {
  /** When given, the gizmo axes follow this local-space direction (used for face editing: Z = normal). */
  normal?: () => Vec3 | null;
}

/** Move / rotate / scale a set of vertices around their centroid. */
export function vertexTarget(
  shape: Shape,
  indices: number[],
  hooks: ShapeHooks,
  opts: VertexTargetOptions = {},
): TransformTarget {
  let start: THREE.Vector3[] = [];
  let center = new THREE.Vector3();

  const centroidLocal = () => {
    const c = new THREE.Vector3();
    for (const i of indices) {
      const v = shape.mesh.verts[i];
      if (v) c.add(new THREE.Vector3(v[0], v[1], v[2]));
    }
    return c.divideScalar(Math.max(1, indices.length));
  };

  /** Gizmo orientation in world space (object rotation, or aligned to a normal when requested). */
  const gizmoQuat = (useNormal: boolean) => {
    const q = quaternionFromDegrees(shape.rotation);
    const n = useNormal ? opts.normal?.() : null;
    if (!n) return q;
    const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]).normalize());
    return q.multiply(qn);
  };

  return {
    allow: { translate: true, rotate: true, scale: true },
    pivot() {
      const q = quaternionFromDegrees(shape.rotation);
      return centroidLocal()
        .applyQuaternion(q)
        .add(new THREE.Vector3(shape.position[0], shape.position[1], shape.position[2]));
    },
    orientation: () => gizmoQuat(true),
    begin() {
      start = indices.map((i) => new THREE.Vector3(...(shape.mesh.verts[i] ?? [0, 0, 0])));
      center = centroidLocal();
    },
    apply(d: TransformDelta) {
      const q = quaternionFromDegrees(shape.rotation);
      const qi = q.clone().invert();
      const qg = gizmoQuat(true);
      const qgi = qg.clone().invert();
      const delta = d.translate.clone().applyQuaternion(qi);
      // the world rotation expressed in the shape's local frame
      const rot = qi.clone().multiply(d.rotate).multiply(q);
      indices.forEach((vi, k) => {
        const rel = start[k]!.clone().sub(center).applyQuaternion(rot);
        if (!isUnitScale(d.scale)) {
          // scale factors run along the gizmo axes: local -> world -> gizmo frame -> scale -> back
          rel.applyQuaternion(q).applyQuaternion(qgi).multiply(d.scale).applyQuaternion(qg).applyQuaternion(qi);
        }
        const p = center.clone().add(rel).add(delta);
        shape.mesh.verts[vi] = [round(p.x), round(p.y), round(p.z)];
      });
      hooks.onGeometry();
    },
    end() {
      hooks.onGeometry();
      hooks.onCommit();
    },
  };
}

/** Unique vertex indices of a set of faces. */
export function verticesOfFaces(mesh: MeshData, faces: number[]): number[] {
  const out = new Set<number>();
  for (const f of faces) for (const v of mesh.faces[f]?.v ?? []) out.add(v);
  return [...out];
}

/** Local-space average normal of a set of faces, or null when empty. */
export function averageFaceNormal(mesh: MeshData, faces: number[]): Vec3 | null {
  if (faces.length === 0) return null;
  const n: Vec3 = [0, 0, 0];
  for (const fi of faces) {
    const f = mesh.faces[fi];
    if (!f) continue;
    // Newell, accumulated unnormalized so bigger faces weigh more
    const k = f.v.length;
    for (let i = 0; i < k; i++) {
      const a = mesh.verts[f.v[i]!]!;
      const b = mesh.verts[f.v[(i + 1) % k]!]!;
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
  }
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : null;
}

/** Visuals for editing one mesh: edges, translucent fill, selected faces, vertex handles, tool previews. */
export class ShapeVisuals {
  readonly group = new THREE.Group();
  private edges: THREE.LineSegments;
  private fill: THREE.Mesh;
  private faceSel: THREE.Mesh;
  private points: THREE.Points;
  private previewLines: THREE.LineSegments;
  private previewPoints: THREE.Points;
  private readonly tmp = new THREE.Vector3();

  private topoKey = '';
  private selKey = '';
  private edgePairs: [number, number][] = [];
  private faceTris: number[][] = []; // per face: flat triples of vertex indices

  constructor(scene: THREE.Scene) {
    const mkGeo = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      return g;
    };
    this.edges = new THREE.LineSegments(mkGeo(), new THREE.LineBasicMaterial({ color: '#ffd34d', depthTest: false }));
    this.fill = new THREE.Mesh(
      mkGeo(),
      new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.faceSel = new THREE.Mesh(
      mkGeo(),
      new THREE.MeshBasicMaterial({ color: '#ffb23e', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    const ptsGeo = mkGeo();
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.points = new THREE.Points(
      ptsGeo,
      new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, depthTest: false }),
    );
    this.previewLines = new THREE.LineSegments(mkGeo(), new THREE.LineBasicMaterial({ color: '#5be37d', depthTest: false }));
    this.previewPoints = new THREE.Points(
      mkGeo(),
      new THREE.PointsMaterial({ color: '#5be37d', size: 12, sizeAttenuation: false, depthTest: false }),
    );

    for (const o of [this.edges, this.fill, this.faceSel, this.points, this.previewLines, this.previewPoints]) {
      o.frustumCulled = false;
      o.renderOrder = 20;
      this.group.add(o);
    }
    this.previewLines.visible = false;
    this.previewPoints.visible = false;
    this.group.visible = false;
    scene.add(this.group);
  }

  /** A float attribute of exactly `count` items; reused between frames so no GPU buffers leak. */
  private attr(g: THREE.BufferGeometry, name: string, count: number, size = 3): THREE.BufferAttribute {
    let a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a || a.count !== Math.max(1, count)) {
      a = new THREE.BufferAttribute(new Float32Array(Math.max(1, count) * size), size);
      g.setAttribute(name, a);
    }
    return a;
  }

  /** Write positions; for non-indexed objects the draw range is limited to the points given. */
  private setPositions(obj: THREE.Mesh | THREE.Points | THREE.LineSegments, pts: Vec3[], limitRange = true): void {
    const g = obj.geometry;
    const a = this.attr(g, 'position', pts.length);
    pts.forEach((p, i) => a.setXYZ(i, p[0], p[1], p[2]));
    a.needsUpdate = true;
    if (limitRange) g.setDrawRange(0, pts.length);
  }

  private rebuildTopology(mesh: MeshData): void {
    this.edgePairs = [...meshEdges(mesh).values()].map((e) => [e.a, e.b] as [number, number]);
    this.faceTris = mesh.faces.map((f, fi) => {
      const out: number[] = [];
      for (const [a, b, c] of triangulateFace(mesh, fi)) out.push(f.v[a!]!, f.v[b!]!, f.v[c!]!);
      return out;
    });
    const allTris = this.faceTris.flat();
    this.fill.geometry.setIndex(allTris);
  }

  /** `shape` null hides everything. `showFaces` draws the selected faces even outside Face mode. */
  update(shape: Shape | null, sub: SubMode, faces: number[], vertices: number[], showFaces: boolean): void {
    if (!shape) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const mesh = shape.mesh;

    let h = mesh.verts.length * 7919 + mesh.faces.length;
    for (const f of mesh.faces) for (const v of f.v) h = (h * 31 + v + 1) | 0;
    const key = `${mesh.verts.length}|${mesh.faces.length}|${h}`;
    if (key !== this.topoKey) {
      this.topoKey = key;
      this.rebuildTopology(mesh);
    }

    const pts = worldPoints(shape);

    // edges
    const edgePts: Vec3[] = [];
    for (const [a, b] of this.edgePairs) edgePts.push(pts[a]!, pts[b]!);
    this.setPositions(this.edges, edgePts);

    // translucent fill shares the vertex positions (indexed, so no draw range)
    this.setPositions(this.fill, pts, false);

    // selected faces
    const show = (sub === 'face' || showFaces) && faces.length > 0;
    this.faceSel.visible = show;
    if (show) {
      this.setPositions(this.faceSel, pts, false);
      const selKey = `${this.topoKey}#${faces.join(',')}`;
      if (selKey !== this.selKey) {
        this.selKey = selKey;
        const idx: number[] = [];
        for (const f of faces) if (this.faceTris[f]) idx.push(...this.faceTris[f]!);
        this.faceSel.geometry.setIndex(idx);
      }
    }

    // vertex handles
    this.points.visible = sub === 'vertex';
    if (sub === 'vertex') {
      this.setPositions(this.points, pts);
      const col = this.attr(this.points.geometry, 'color', pts.length);
      const sel = new Set(vertices);
      pts.forEach((_, i) => {
        const s = sel.has(i);
        col.setXYZ(i, s ? 1 : 0.95, s ? 0.5 : 0.95, s ? 0.1 : 0.95);
      });
      col.needsUpdate = true;
    }
  }

  /** World-space preview of a tool (loop cut line, edge to split). Empty arrays clear it. */
  setPreview(segments: [Vec3, Vec3][], markers: Vec3[]): void {
    this.previewLines.visible = segments.length > 0;
    this.previewPoints.visible = markers.length > 0;
    if (segments.length > 0) this.setPositions(this.previewLines, segments.flat());
    if (markers.length > 0) this.setPositions(this.previewPoints, markers);
  }

  /** Nearest vertex handle within `radius` screen pixels, or null. */
  pickVertex(shape: Shape, camera: THREE.Camera, rect: DOMRect, clientX: number, clientY: number, radius = 14): number | null {
    let best: number | null = null;
    let bestD = radius;
    worldPoints(shape).forEach((p, i) => {
      this.tmp.set(p[0], p[1], p[2]).project(camera);
      if (this.tmp.z > 1) return;
      const sx = rect.left + ((this.tmp.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - this.tmp.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }
}
