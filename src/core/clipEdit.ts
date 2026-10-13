// Editing operations on animation clips. They change the clip in place and know nothing about the UI,
// so they are easy to test. Times are seconds; a "frame" is 1/30 s.

import { type BonePose, type Pose, sampleKeys } from './rig';
import type { AnimationClip, BoneKey, Vec3 } from './types';

export type Channel = 'rot' | 'pos';

export const FPS = 30;
export const FRAME = 1 / FPS;
const EPS = 1e-4;

export function snapTime(t: number, step = FRAME): number {
  return Math.round(t / step) * step;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function keysOf(clip: AnimationClip, bone: string, channel: Channel): BoneKey[] {
  return clip.tracks[bone]?.[channel] ?? [];
}

export function keyAt(clip: AnimationClip, bone: string, channel: Channel, t: number): BoneKey | undefined {
  return keysOf(clip, bone, channel).find((k) => Math.abs(k.t - t) < EPS);
}

/** The bone's pose at time `t`: its keys evaluated, rest (zero) where there are none. */
export function sampleBone(clip: AnimationClip, bone: string, t: number): BonePose {
  const track = clip.tracks[bone];
  const tt = clip.loop ? ((t % clip.duration) + clip.duration) % clip.duration : Math.min(Math.max(t, 0), clip.duration);
  const loop = clip.loop ? clip.duration : 0;
  const smooth = clip.smooth === true;
  return {
    rot: sampleKeys(track?.rot, tt, smooth, loop) ?? [0, 0, 0],
    pos: sampleKeys(track?.pos, tt, smooth, loop) ?? [0, 0, 0],
  };
}

function insert(keys: BoneKey[], t: number, v: Vec3): void {
  const existing = keys.find((k) => Math.abs(k.t - t) < EPS);
  if (existing) {
    existing.v = [...v];
    return;
  }
  keys.push({ t: r4(t), v: [...v] });
  keys.sort((a, b) => a.t - b.t);
}

/**
 * Put a key on a channel. The first key of a channel also pins the rest pose at the start (and at the
 * end of a loop) so the value does not leak over the whole clip. In a loop the end follows the start
 * while the two are equal; once the end has its own value (a spin that ends at 360 degrees) it stays.
 */
export function setKey(clip: AnimationClip, bone: string, channel: Channel, t: number, v: Vec3): void {
  const time = Math.min(Math.max(t, 0), clip.duration);
  const track = (clip.tracks[bone] ??= {});
  const keys = (track[channel] ??= []);
  if (keys.length === 0) {
    if (time > EPS) insert(keys, 0, [0, 0, 0]);
    if (clip.loop && time < clip.duration - EPS) insert(keys, clip.duration, [0, 0, 0]);
  }
  if (clip.loop && time < EPS) {
    const start = keys.find((k) => k.t < EPS);
    const end = keys.find((k) => k.t > clip.duration - EPS);
    const synced = !!end && (!start || start.v.every((x, i) => Math.abs(x - end.v[i]!) < 1e-6));
    insert(keys, time, v);
    if (synced) insert(keys, clip.duration, v);
    return;
  }
  insert(keys, time, v);
}

export function deleteKey(clip: AnimationClip, bone: string, channel: Channel, t: number): void {
  const track = clip.tracks[bone];
  if (!track?.[channel]) return;
  track[channel] = track[channel]!.filter((k) => Math.abs(k.t - t) >= EPS);
  if (track[channel]!.length === 0) delete track[channel];
  if (!track.rot && !track.pos) delete clip.tracks[bone];
}

/** Move a key to a new time (replacing a key that is already there). Returns the time it ended up at. */
export function moveKey(clip: AnimationClip, bone: string, channel: Channel, from: number, to: number): number {
  const key = keyAt(clip, bone, channel, from);
  if (!key) return from;
  const target = Math.min(Math.max(to, 0), clip.duration);
  if (Math.abs(target - from) < EPS) return from;
  // the first and last key of a loop mark its ends: they stay where they are
  if (clip.loop && (from < EPS || from > clip.duration - EPS)) return from;
  const keys = clip.tracks[bone]![channel]!;
  const value = [...key.v] as Vec3;
  clip.tracks[bone]![channel] = keys.filter((k) => k !== key && Math.abs(k.t - target) >= EPS);
  insert(clip.tracks[bone]![channel]!, target, value);
  return r4(target);
}

/** Change the length of a clip, stretching the keys with it (a longer clip plays slower). */
export function scaleDuration(clip: AnimationClip, duration: number): void {
  const d = Math.max(duration, FRAME);
  const k = d / clip.duration;
  for (const track of Object.values(clip.tracks)) {
    for (const ch of ['rot', 'pos'] as const) for (const key of track[ch] ?? []) key.t = r4(key.t * k);
  }
  clip.duration = r4(d);
}

/** Every bone's pose at time `t` (only bones that have keys). */
export function clipPoseAt(clip: AnimationClip, t: number): Pose {
  const pose: Pose = new Map();
  for (const bone of Object.keys(clip.tracks)) pose.set(bone, sampleBone(clip, bone, t));
  return pose;
}

/** `RightHand` <-> `LeftHand`; null for a bone that is not one of a pair. */
export function mirrorName(name: string): string | null {
  if (name.startsWith('Right')) return `Left${name.slice(5)}`;
  if (name.startsWith('Left')) return `Right${name.slice(4)}`;
  return null;
}

/**
 * A pose reflected left <-> right: each side's bones take the other side's values, and turns about the
 * forward and up axes (Y, Z) and sideways moves (X) are flipped. Bones in the middle flip in place.
 */
export function mirrorPose(pose: Pose): Pose {
  const out: Pose = new Map();
  for (const [name, p] of pose) {
    const target = mirrorName(name) ?? name;
    out.set(target, { rot: [p.rot[0], -p.rot[1], -p.rot[2]], pos: [-p.pos[0], p.pos[1], p.pos[2]] });
  }
  return out;
}

/** Write a pose into the clip at time `t` as keys (rotation always, position where it is not zero or has keys). */
export function applyPose(clip: AnimationClip, pose: Pose, t: number): void {
  for (const [bone, p] of pose) {
    setKey(clip, bone, 'rot', t, [...p.rot] as Vec3);
    const hasPos = keysOf(clip, bone, 'pos').length > 0;
    if (hasPos || p.pos.some((v) => Math.abs(v) > 1e-6)) setKey(clip, bone, 'pos', t, [...p.pos] as Vec3);
  }
}

/** Copy of a clip with a fresh id and name. */
export function duplicateClip(clip: AnimationClip, id: string, name: string): AnimationClip {
  return { ...structuredClone(clip), id, name };
}
