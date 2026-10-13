// Skeleton math shared by the editor and the runtime: sampling animation clips into poses, blending
// poses and turning a pose into one matrix per bone. Cubes are stored in the rest pose, so a bone's
// matrix is: parent matrix * translate(pivot + offset) * rotate(delta) * translate(-pivot).

import * as THREE from 'three';
import { eulerFromDegrees } from './shape';
import type { AnimationClip, Bone, BoneKey, Model, Vec3 } from './types';

/** How far a bone is from its rest pose: rotation in degrees (XYZ) and translation in meters. */
export interface BonePose {
  rot: Vec3;
  pos: Vec3;
}

/** Bone name -> pose. Missing bones are at rest. */
export type Pose = Map<string, BonePose>;

const ZERO: Vec3 = [0, 0, 0];

function tangent(keys: BoneKey[], i: number, loopDuration: number): Vec3 {
  const n = keys.length;
  const cur = keys[i]!;
  let prev = cur.v;
  let tPrev = cur.t;
  let next = cur.v;
  let tNext = cur.t;
  // a loop whose end differs from its start (a 0 -> 360 spin) keeps going: the wrapped neighbours
  // are shifted by that difference
  const first = keys[0]!.v;
  const last = keys[n - 1]!.v;
  const shift: Vec3 = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
  if (i > 0) {
    prev = keys[i - 1]!.v;
    tPrev = keys[i - 1]!.t;
  } else if (loopDuration > 0 && n > 2) {
    const k = keys[n - 2]!;
    prev = [k.v[0] - shift[0], k.v[1] - shift[1], k.v[2] - shift[2]];
    tPrev = k.t - loopDuration;
  }
  if (i < n - 1) {
    next = keys[i + 1]!.v;
    tNext = keys[i + 1]!.t;
  } else if (loopDuration > 0 && n > 2) {
    const k = keys[1]!;
    next = [k.v[0] + shift[0], k.v[1] + shift[1], k.v[2] + shift[2]];
    tNext = k.t + loopDuration;
  }
  const dt = tNext - tPrev;
  if (dt <= 1e-9) return [0, 0, 0];
  return [(next[0] - prev[0]) / dt, (next[1] - prev[1]) / dt, (next[2] - prev[2]) / dt];
}

/**
 * Value of a keyframe track at time `t` (clamped to the first / last key). Straight lines between
 * keys, or with `smooth` a Catmull-Rom curve through them; `loopDuration` > 0 makes the curve wrap.
 */
export function sampleKeys(keys: BoneKey[] | undefined, t: number, smooth = false, loopDuration = 0): Vec3 | null {
  if (!keys || keys.length === 0) return null;
  if (t <= keys[0]!.t || keys.length === 1) return [...keys[0]!.v];
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return [...last.v];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t > b.t) continue;
    const a = keys[i - 1]!;
    const h = b.t - a.t;
    const k = h > 0 ? (t - a.t) / h : 0;
    if (!smooth || h <= 0) {
      return [a.v[0] + (b.v[0] - a.v[0]) * k, a.v[1] + (b.v[1] - a.v[1]) * k, a.v[2] + (b.v[2] - a.v[2]) * k];
    }
    const ma = tangent(keys, i - 1, loopDuration);
    const mb = tangent(keys, i, loopDuration);
    const k2 = k * k;
    const k3 = k2 * k;
    const h00 = 2 * k3 - 3 * k2 + 1;
    const h10 = k3 - 2 * k2 + k;
    const h01 = -2 * k3 + 3 * k2;
    const h11 = k3 - k2;
    return [0, 1, 2].map((c) => h00 * a.v[c]! + h10 * h * ma[c]! + h01 * b.v[c]! + h11 * h * mb[c]!) as Vec3;
  }
  return [...last.v];
}

/** The pose of a clip at `time` seconds (wraps for looping clips, holds the end otherwise). */
export function sampleClip(clip: AnimationClip, time: number): Pose {
  const t = clip.loop ? ((time % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(time, 0), clip.duration);
  const smooth = clip.smooth === true;
  const loopDuration = clip.loop ? clip.duration : 0;
  const pose: Pose = new Map();
  for (const [bone, track] of Object.entries(clip.tracks)) {
    pose.set(bone, {
      rot: sampleKeys(track.rot, t, smooth, loopDuration) ?? [...ZERO],
      pos: sampleKeys(track.pos, t, smooth, loopDuration) ?? [...ZERO],
    });
  }
  return pose;
}

/** Blend two poses: weight 0 = `a`, weight 1 = `b`. */
export function blendPoses(a: Pose, b: Pose, weight: number): Pose {
  const out: Pose = new Map();
  const w = Math.min(1, Math.max(0, weight));
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    const pa = a.get(name);
    const pb = b.get(name);
    const lerp = (x: Vec3 | undefined, y: Vec3 | undefined): Vec3 => {
      const p = x ?? ZERO;
      const q = y ?? ZERO;
      return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w, p[2] + (q[2] - p[2]) * w];
    };
    out.set(name, { rot: lerp(pa?.rot, pb?.rot), pos: lerp(pa?.pos, pb?.pos) });
  }
  return out;
}

/** Bones sorted so every parent comes before its children (cycles and dangling parents are cut). */
export function orderedBones(bones: Bone[]): Bone[] {
  const byId = new Map(bones.map((b) => [b.id, b] as const));
  const out: Bone[] = [];
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const visit = (b: Bone) => {
    if (state.get(b.id) === 2) return;
    if (state.get(b.id) === 1) return; // cycle: stop here
    state.set(b.id, 1);
    const parent = b.parent ? byId.get(b.parent) : undefined;
    if (parent) visit(parent);
    state.set(b.id, 2);
    out.push(b);
  };
  bones.forEach(visit);
  return out;
}

const _q = new THREE.Quaternion();
const _t = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _p = new THREE.Matrix4();

/** One matrix per bone id (model space). `ordered` must come from `orderedBones`. */
export function boneMatrices(ordered: Bone[], pose: Pose, into = new Map<string, THREE.Matrix4>()): Map<string, THREE.Matrix4> {
  for (const bone of ordered) {
    const p = pose.get(bone.name);
    const m = into.get(bone.id) ?? new THREE.Matrix4();
    const parent = bone.parent ? into.get(bone.parent) : undefined;
    if (parent) m.copy(parent);
    else m.identity();
    const rot = p?.rot ?? ZERO;
    const pos = p?.pos ?? ZERO;
    _t.makeTranslation(bone.pivot[0] + pos[0], bone.pivot[1] + pos[1], bone.pivot[2] + pos[2]);
    _q.setFromEuler(eulerFromDegrees(rot));
    _r.makeRotationFromQuaternion(_q);
    _p.makeTranslation(-bone.pivot[0], -bone.pivot[1], -bone.pivot[2]);
    m.multiply(_t).multiply(_r).multiply(_p);
    into.set(bone.id, m);
  }
  return into;
}

/**
 * Where something worn on a bone naturally sits: the middle of the top of the bone's parts, as an
 * offset from the bone's pivot. A hat on the head ends up on top of the head.
 */
export function attachmentAnchor(model: Model, boneName: string): Vec3 {
  const bone = model.bones.find((b) => b.name === boneName);
  if (!bone) return [0, 0, 0];
  const q = new THREE.Quaternion();
  const pts: THREE.Vector3[] = [];
  for (const cube of model.cubes) {
    if (cube.bone !== bone.id) continue;
    q.setFromEuler(eulerFromDegrees(cube.rotation));
    for (const v of cube.mesh.verts) {
      pts.push(new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q).add(new THREE.Vector3(...cube.position)));
    }
  }
  if (pts.length === 0) return [0, 0, 0];
  const top = Math.max(...pts.map((p) => p.y));
  const high = pts.filter((p) => p.y >= top - 1e-4);
  const cx = high.reduce((a, p) => a + p.x, 0) / high.length;
  const cz = high.reduce((a, p) => a + p.z, 0) / high.length;
  return [cx - bone.pivot[0], top - bone.pivot[1], cz - bone.pivot[2]];
}

const DEG = 180 / Math.PI;

/**
 * A bone's rotation after the gizmo turned it by `worldDelta` (a rotation about world axes). The bone's
 * rotation lives in its parent's frame, so the delta is first expressed there. Angles stay on the same
 * turn as `current` (no jump by 360 degrees) so interpolation does not spin the long way round.
 */
export function rotateInParent(current: Vec3, parentRotation: THREE.Quaternion, worldDelta: THREE.Quaternion): Vec3 {
  const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(current));
  const local = parentRotation.clone().invert().multiply(worldDelta).multiply(parentRotation);
  const e = new THREE.Euler().setFromQuaternion(local.multiply(q), 'XYZ');
  return [e.x * DEG, e.y * DEG, e.z * DEG].map((v, i) => {
    let x = v;
    while (x - current[i]! > 180) x -= 360;
    while (x - current[i]! < -180) x += 360;
    return Math.round(x * 1000) / 1000 + 0;
  }) as Vec3;
}

/**
 * Give a bone a new name and carry it into every clip (clips refer to bones by name). Returns the old
 * name, or null when the name is empty or taken.
 */
export function renameBoneInModel(model: Model, boneId: string, name: string): string | null {
  const bone = model.bones.find((b) => b.id === boneId);
  const clean = name.trim();
  if (!bone || !clean || model.bones.some((b) => b !== bone && b.name === clean)) return null;
  const old = bone.name;
  if (old === clean) return old;
  for (const clip of model.clips) {
    const track = clip.tracks[old];
    if (track) {
      delete clip.tracks[old];
      clip.tracks[clean] = track;
    }
  }
  bone.name = clean;
  return old;
}

/**
 * Axis-aligned bounds, in model space, of the shapes that belong to a bone (all shapes when `boneId` is
 * null), or null when there are none.
 */
export function shapeBounds(model: Model, boneId: string | null): { min: Vec3; max: Vec3 } | null {
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const cube of model.cubes) {
    if (boneId !== null && cube.bone !== boneId) continue;
    q.setFromEuler(eulerFromDegrees(cube.rotation));
    for (const p of cube.mesh.verts) {
      v.set(p[0], p[1], p[2]).applyQuaternion(q);
      const w: Vec3 = [v.x + cube.position[0], v.y + cube.position[1], v.z + cube.position[2]];
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, w[i]!);
        max[i] = Math.max(max[i]!, w[i]!);
      }
      any = true;
    }
  }
  return any ? { min, max } : null;
}

/** Middle, top-middle or bottom-middle of the shapes of a bone (or of the whole model). */
export function boneAnchor(model: Model, boneId: string | null, where: 'center' | 'top' | 'bottom'): Vec3 | null {
  const b = shapeBounds(model, boneId);
  if (!b) return null;
  const cy = where === 'top' ? b.max[1] : where === 'bottom' ? b.min[1] : (b.min[1] + b.max[1]) / 2;
  return [(b.min[0] + b.max[0]) / 2, cy, (b.min[2] + b.max[2]) / 2];
}

/**
 * Give a model without a skeleton one: a single bone that moves everything, or one bone per shape, each
 * pivoting at its shape's origin. Returns the bones made.
 */
export function createSkeleton(model: Model, mode: 'single' | 'per-shape', idGen: () => string): Bone[] {
  const taken = new Set(model.bones.map((b) => b.name));
  const unique = (base: string) => {
    let name = base || 'Bone';
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    taken.add(name);
    return name;
  };
  const made: Bone[] = [];
  if (mode === 'single') {
    const pivot = boneAnchor(model, null, 'center') ?? [0, 0, 0];
    const bone: Bone = { id: idGen(), name: unique('Root'), parent: null, pivot };
    made.push(bone);
    for (const c of model.cubes) c.bone = bone.id;
  } else {
    for (const c of model.cubes) {
      const bone: Bone = { id: idGen(), name: unique(c.name), parent: null, pivot: [...c.position] };
      made.push(bone);
      c.bone = bone.id;
    }
  }
  model.bones.push(...made);
  return made;
}
