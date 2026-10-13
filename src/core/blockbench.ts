// Importer for rigged "blockymodel" JSON as written by Blockbench's Hytale rigs (HyRig): a tree of
// boxes, each with `from` / `to`, an optional `rotationOrigin` + `rotationX/Y/Z` and per-face pixel
// UVs. Children are positioned relative to the min corner of their parent and turn with it.
//
// File space: +Y up, the character looks toward -X, its right hand is toward -Z.
// Our space: +Y up, the character looks toward +Z, its right hand is toward -X (see docs in README).
// The conversion is a quarter turn about Y: x' = z, z' = -x.

import * as THREE from 'three';
import { type FaceKey, type MeshData, boxMesh, compactMesh } from './mesh';
import { degreesFromQuaternion } from './shape';
import type { Bone, Model, ModelCube, Vec3 } from './types';
import { type UVPoly, rectUv, rotateUvCW } from './uv';

export interface ImportOptions {
  /** Meters per file unit. */
  scale?: number;
  /** Instead of `scale`: size the model so that it is this many meters tall. */
  fitHeight?: number;
  /** Generates ids for the model, its bones and its cubes. */
  idGen: () => string;
  name?: string;
  /** Name of the texture the model uses. */
  texture?: string | null;
  /** Element whose horizontal center becomes the model's origin (default: the middle of the bounds). */
  originElement?: string;
}

export interface ImportResult {
  model: Model;
  /** Pixel size of the texture the UVs were written for (from the file, default 256 x 256). */
  textureWidth: number;
  textureHeight: number;
  warnings: string[];
}

interface RawFace {
  uv?: number[];
  rotation?: number;
}
interface RawElement {
  name?: string;
  from?: number[];
  to?: number[];
  rotationOrigin?: number[];
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  faces?: Record<string, RawFace | undefined>;
  children?: RawElement[];
}

interface Node {
  name: string;
  from: Vec3;
  to: Vec3;
  origin: Vec3;
  rot: Vec3; // degrees
  faces: Record<string, RawFace | undefined>;
  parent: Node | null;
  children: Node[];
  boneId: string;
}

// file face name -> our face key. In these files "south" is the side the character looks at (-X in
// file space, +Z for us), "north" its back, "east" is its left (+Z in file space, +X for us), "west" its
// right. Checked against the layout of real skins: the eye holes of the head are in the "south" face.
const FACE_MAP: Record<string, FaceKey> = {
  south: 'pz',
  north: 'nz',
  east: 'px',
  west: 'nx',
  up: 'py',
  down: 'ny',
};
const FILE_FACES = Object.keys(FACE_MAP);

const DEG = Math.PI / 180;
const isVec3 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Quarter turn about Y that takes file space to our space (x' = z, z' = -x). */
const Q_FILE_TO_OURS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const Q_OURS_TO_FILE = Q_FILE_TO_OURS.clone().invert();

function toOurs(p: THREE.Vector3): Vec3 {
  return [p.z, p.y, -p.x];
}

export function importRigJson(raw: unknown, opts: ImportOptions): ImportResult {
  const warnings: string[] = [];
  const doc = (raw && typeof raw === 'object' ? raw : {}) as { elements?: RawElement[]; textureWidth?: number; textureHeight?: number };
  if (!Array.isArray(doc.elements) || doc.elements.length === 0) throw new Error('no elements found: this does not look like a rig file');

  // ---- build the node tree
  const usedNames = new Set<string>();
  const all: Node[] = [];
  const build = (e: RawElement, parent: Node | null): Node => {
    const from = isVec3(e.from) ? (e.from as Vec3) : ([0, 0, 0] as Vec3);
    const to = isVec3(e.to) ? (e.to as Vec3) : from;
    const rot: Vec3 = [e.rotationX ?? 0, e.rotationY ?? 0, e.rotationZ ?? 0];
    const rotated = rot.some((r) => Math.abs(r) > 1e-9);
    let origin: Vec3;
    if (isVec3(e.rotationOrigin)) origin = e.rotationOrigin as Vec3;
    else if (rotated) origin = [0, 0, 0];
    else origin = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    let name = typeof e.name === 'string' && e.name ? e.name : 'Part';
    for (let n = 2; usedNames.has(name); n++) name = `${e.name ?? 'Part'}_${n}`;
    usedNames.add(name);
    const node: Node = { name, from, to, origin, rot, faces: e.faces ?? {}, parent, children: [], boneId: opts.idGen() };
    all.push(node);
    for (const c of e.children ?? []) node.children.push(build(c, node));
    return node;
  };
  const roots = doc.elements.map((e) => build(e, null));

  // ---- matrices in file space.  W(n) = A(n) * T(from(n)) maps coordinates relative to n's min corner
  // into n's own frame; Up(child) = Up(parent) * W(parent); the box of n sits at Up(n) * A(n).
  const up = new Map<Node, THREE.Matrix4>();
  const own = new Map<Node, THREE.Matrix4>(); // Up(n) * A(n)
  const visit = (n: Node, upMatrix: THREE.Matrix4) => {
    up.set(n, upMatrix);
    const o = new THREE.Vector3(...n.origin);
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(n.rot[0] * DEG, n.rot[1] * DEG, n.rot[2] * DEG, 'ZYX'));
    const a = new THREE.Matrix4()
      .makeTranslation(o.x, o.y, o.z)
      .multiply(r)
      .multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
    own.set(n, upMatrix.clone().multiply(a));
    const w = a.clone().multiply(new THREE.Matrix4().makeTranslation(n.from[0], n.from[1], n.from[2]));
    for (const c of n.children) visit(c, upMatrix.clone().multiply(w));
  };
  roots.forEach((r) => visit(r, new THREE.Matrix4()));

  // ---- cubes and bones (model space, file units)
  interface Built {
    node: Node;
    cube: ModelCube | null;
    pivot: Vec3;
    size: Vec3;
  }
  const built: Built[] = [];
  for (const n of all) {
    const m = own.get(n)!;
    const pivot = toOurs(new THREE.Vector3(...n.origin).applyMatrix4(m));
    const sizeFile: Vec3 = [Math.abs(n.to[0] - n.from[0]), Math.abs(n.to[1] - n.from[1]), Math.abs(n.to[2] - n.from[2])];
    const sizeOurs: Vec3 = [sizeFile[2], sizeFile[1], sizeFile[0]];

    let cube: ModelCube | null = null;
    if (sizeFile.some((s) => s > 1e-9)) {
      const mesh = buildMesh(n, sizeOurs, warnings);
      if (mesh.faces.length > 0) {
        const mq = new THREE.Quaternion();
        m.decompose(new THREE.Vector3(), mq, new THREE.Vector3());
        const q = Q_FILE_TO_OURS.clone().multiply(mq).multiply(Q_OURS_TO_FILE);
        cube = { id: opts.idGen(), name: n.name, position: pivot, rotation: degreesFromQuaternion(q), mesh, bone: n.boneId };
      }
    }
    built.push({ node: n, cube, pivot, size: sizeOurs });
  }

  // ---- put the model on the ground (y = 0) with its origin in the middle, then scale to meters
  const pts: Vec3[] = [];
  for (const b of built) {
    if (!b.cube) continue;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.cube.rotation[0] * DEG, b.cube.rotation[1] * DEG, b.cube.rotation[2] * DEG, 'XYZ'));
    for (const v of b.cube.mesh.verts) {
      const w = new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q);
      pts.push([w.x + b.pivot[0], w.y + b.pivot[1], w.z + b.pivot[2]]);
    }
  }
  if (pts.length === 0) throw new Error('the file has no visible parts');
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i]!, p[i]!);
    max[i] = Math.max(max[i]!, p[i]!);
  }
  let cx = (min[0] + max[0]) / 2;
  let cz = (min[2] + max[2]) / 2;
  const ref = opts.originElement ? built.find((b) => b.node.name === opts.originElement) : undefined;
  if (ref?.cube) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ref.cube.rotation[0] * DEG, ref.cube.rotation[1] * DEG, ref.cube.rotation[2] * DEG, 'XYZ'));
    const c = new THREE.Vector3();
    for (const v of ref.cube.mesh.verts) c.add(new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q));
    c.divideScalar(ref.cube.mesh.verts.length);
    cx = c.x + ref.pivot[0];
    cz = c.z + ref.pivot[2];
  }
  const s = opts.fitHeight && max[1] > min[1] ? opts.fitHeight / (max[1] - min[1]) : (opts.scale ?? 1 / 16);
  const place = (p: Vec3): Vec3 => [(p[0] - cx) * s, (p[1] - min[1]) * s, (p[2] - cz) * s];

  const bones: Bone[] = [];
  const cubes: ModelCube[] = [];
  for (const b of built) {
    bones.push({ id: b.node.boneId, name: b.node.name, parent: b.node.parent?.boneId ?? null, pivot: place(b.pivot) });
    if (b.cube) {
      b.cube.position = place(b.cube.position);
      b.cube.mesh.verts = b.cube.mesh.verts.map((v) => [v[0]! * s, v[1]! * s, v[2]! * s] as Vec3);
      cubes.push(b.cube);
    }
  }

  const model: Model = {
    id: opts.idGen(),
    name: opts.name ?? 'Imported rig',
    texture: opts.texture ?? null,
    cubes,
    bones,
    clips: [],
  };
  return {
    model,
    textureWidth: typeof doc.textureWidth === 'number' ? doc.textureWidth : 256,
    textureHeight: typeof doc.textureHeight === 'number' ? doc.textureHeight : 256,
    warnings,
  };
}

/** The box of one element in its own space (centered on its rotation origin), file units, our axes. */
function buildMesh(n: Node, sizeOurs: Vec3, warnings: string[]): MeshData {
  const mesh = boxMesh(sizeOurs);
  // shift the centered box so that it sits where the element is relative to its rotation origin
  const centerFile = new THREE.Vector3(
    (n.from[0] + n.to[0]) / 2 - n.origin[0],
    (n.from[1] + n.to[1]) / 2 - n.origin[1],
    (n.from[2] + n.to[2]) / 2 - n.origin[2],
  );
  const c = toOurs(centerFile);
  mesh.verts = mesh.verts.map((v) => [v[0]! + c[0], v[1]! + c[1], v[2]! + c[2]] as Vec3);

  // faces: UV from the file; faces without area (a plane has no sides) are dropped
  const keys: FaceKey[] = ['pz', 'nz', 'px', 'nx', 'py', 'ny'];
  const area = (k: FaceKey): number => {
    if (k === 'pz' || k === 'nz') return sizeOurs[0] * sizeOurs[1];
    if (k === 'px' || k === 'nx') return sizeOurs[2] * sizeOurs[1];
    return sizeOurs[0] * sizeOurs[2];
  };
  const keep = new Set<FaceKey>(keys.filter((k) => area(k) > 1e-9));

  // a flat element has two coincident faces; keep the one that carries a real UV, not the (0,0) dummy
  const flat = sizeOurs.findIndex((s) => s < 1e-9);
  if (flat === 2) {
    const real = n.faces.north?.uv;
    const other = n.faces.south?.uv;
    const isDummy = (uv?: number[]) => !uv || (uv[0] === 0 && uv[1] === 0);
    // two coincident faces: keep one, drawn from both sides by the renderer
    if (isDummy(real) && !isDummy(other)) keep.delete('nz');
    else keep.delete('pz');
  } else if (flat === 0) {
    keep.delete('nx');
  } else if (flat === 1) {
    keep.delete('ny');
  }

  const faceOfKey = new Map<FaceKey, number>();
  const kept: typeof mesh.faces = [];
  keys.forEach((k, i) => {
    const face = mesh.faces[i]!;
    if (!keep.has(k)) return;
    const fileName = FILE_FACES.find((f) => FACE_MAP[f] === k)!;
    const raw = n.faces[fileName];
    face.uv = faceUv(raw, warnings, n.name);
    faceOfKey.set(k, kept.length);
    kept.push(face);
  });
  mesh.faces = kept;
  compactMesh(mesh);
  return mesh;
}

function faceUv(raw: RawFace | undefined, warnings: string[], name: string): UVPoly {
  const uv = raw?.uv;
  if (!uv || uv.length !== 4 || uv.some((v) => typeof v !== 'number')) {
    warnings.push(`${name}: face without a UV rectangle`);
    return rectUv(0, 0, 1, 1);
  }
  let poly = rectUv(uv[0]!, uv[1]!, uv[2]! - uv[0]!, uv[3]! - uv[1]!);
  const steps = ((Math.round((raw?.rotation ?? 0) / 90) % 4) + 4) % 4;
  for (let i = 0; i < steps; i++) poly = rotateUvCW(poly);
  return poly;
}
