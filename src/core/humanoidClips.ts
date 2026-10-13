// Procedural animations for the built-in humanoid, written out as plain keyframes (so they are data
// like any clip a user makes). Bone names are the ones of the humanoid rig (Root, Hips, Waist, Chest, Neck, Head, the arms and the legs).
//
// Axes (model space: +Z forward, +X the character's left, +Y up):
//   rotation about X: a hanging limb swings BACK for positive values and forward for negative ones;
//                     a standing body leans forward for positive values.
//   rotation about Z: a left limb moves outward for positive values, a right limb for negative ones.

import type { AnimationClip, BoneKey, BoneTrack, Vec3 } from './types';

type Fn = (phase: number) => Vec3;

const TAU = Math.PI * 2;
const r3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

function keys(duration: number, steps: number, fn: Fn): BoneKey[] {
  const out: BoneKey[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const v = fn(u * TAU);
    out.push({ t: r3(u * duration), v: [r3(v[0]), r3(v[1]), r3(v[2])] });
  }
  return out;
}

const still = (v: Vec3): Fn => () => v;

type Tracks = Record<string, BoneTrack>;

function clip(id: string, name: string, duration: number, loop: boolean, steps: number, rot: Record<string, Fn>, pos: Record<string, Fn> = {}): AnimationClip {
  const tracks: Tracks = {};
  for (const [bone, fn] of Object.entries(rot)) tracks[bone] = { rot: keys(duration, steps, fn) };
  for (const [bone, fn] of Object.entries(pos)) tracks[bone] = { ...(tracks[bone] ?? {}), pos: keys(duration, steps, fn) };
  return { id, name, duration, loop, tracks };
}

const sin = Math.sin;
const cos = Math.cos;
const pos = (n: number) => Math.max(0, n);

interface Gait {
  duration: number;
  thigh: number; // degrees of hip swing
  knee: number; // knee bend while the leg swings forward
  arm: number; // shoulder swing
  elbow: number; // forearm bend
  lean: number; // forward lean of the body
  bob: number; // meters
  twist: number; // chest twist
}

function gait(id: string, name: string, g: Gait): AnimationClip {
  const leg = (side: 1 | -1) => (p: number) => -side * g.thigh * sin(p); // right = 1 swings forward when sin > 0
  const knee = (side: 1 | -1) => (p: number) => g.knee * pos(side * cos(p)) + 3;
  return clip(
    id,
    name,
    g.duration,
    true,
    16,
    {
      RightThigh: (p) => [leg(1)(p), 0, 0],
      LeftThigh: (p) => [leg(-1)(p), 0, 0],
      RightShin: (p) => [knee(1)(p), 0, 0],
      LeftShin: (p) => [knee(-1)(p), 0, 0],
      RightFoot: (p) => [-0.5 * knee(1)(p), 0, 0],
      LeftFoot: (p) => [-0.5 * knee(-1)(p), 0, 0],
      RightUpperArm: (p) => [g.arm * sin(p), 0, 0],
      LeftUpperArm: (p) => [-g.arm * sin(p), 0, 0],
      RightForearm: (p) => [-(g.elbow + 0.25 * g.arm * (0.5 - 0.5 * sin(p))), 0, 0],
      LeftForearm: (p) => [-(g.elbow + 0.25 * g.arm * (0.5 + 0.5 * sin(p))), 0, 0],
      Hips: (p) => [0, 0.45 * g.twist * sin(p), 0],
      Waist: (p) => [g.lean * 0.5, 0, 0].map((v, i) => (i === 1 ? -0.3 * g.twist * sin(p) : v)) as Vec3,
      Chest: (p) => [g.lean * 0.5, -0.55 * g.twist * sin(p), 0],
      Head: (p) => [-g.lean * 0.9, 0.35 * g.twist * sin(p), 0],
    },
    { Root: (p) => [0, g.bob * cos(2 * p), 0] },
  );
}

export function humanoidClips(idGen: () => string): AnimationClip[] {
  const idle = clip(idGen(), 'idle', 3, true, 12, {
    Chest: (p) => [1.4 * sin(p), 0, 0],
    Head: (p) => [-1.2 * sin(p - 0.7), 2 * sin(p / 1 - 1.5) * 0.5, 0],
    RightUpperArm: (p) => [-1 * sin(p - 0.5), 0, -1.6 * sin(p)],
    LeftUpperArm: (p) => [-1 * sin(p - 0.5), 0, 1.6 * sin(p)],
    RightForearm: still([-6, 0, 0]),
    LeftForearm: still([-6, 0, 0]),
  }, { Root: (p) => [0, 0.004 * sin(p), 0] });

  const walk = gait(idGen(), 'walk', { duration: 0.8, thigh: 30, knee: 40, arm: 26, elbow: 12, lean: 3, bob: 0.012, twist: 8 });
  const run = gait(idGen(), 'run', { duration: 0.5, thigh: 52, knee: 78, arm: 48, elbow: 75, lean: 14, bob: 0.032, twist: 14 });

  const jump = clip(idGen(), 'jump', 0.4, true, 2, {
    RightUpperArm: still([-125, 0, -22]),
    LeftUpperArm: still([-125, 0, 22]),
    RightForearm: still([-25, 0, 0]),
    LeftForearm: still([-25, 0, 0]),
    RightThigh: still([-32, 0, 0]),
    LeftThigh: still([10, 0, 0]),
    RightShin: still([55, 0, 0]),
    LeftShin: still([30, 0, 0]),
    RightFoot: still([-10, 0, 0]),
    LeftFoot: still([-5, 0, 0]),
    Waist: still([6, 0, 0]),
    Head: still([-8, 0, 0]),
  });

  const fall = clip(idGen(), 'fall', 0.4, true, 2, {
    RightUpperArm: still([-30, 0, -62]),
    LeftUpperArm: still([-30, 0, 62]),
    RightForearm: still([-22, 0, 0]),
    LeftForearm: still([-22, 0, 0]),
    RightThigh: still([-14, 0, 0]),
    LeftThigh: still([8, 0, 0]),
    RightShin: still([30, 0, 0]),
    LeftShin: still([22, 0, 0]),
    Waist: still([4, 0, 0]),
    Head: still([-5, 0, 0]),
  });

  const glide = clip(idGen(), 'glide', 0.6, true, 4, {
    RightUpperArm: (p) => [-10, 0, -78 + 5 * sin(p)],
    LeftUpperArm: (p) => [-10, 0, 78 - 5 * sin(p)],
    RightForearm: still([-8, 0, 0]),
    LeftForearm: still([-8, 0, 0]),
    RightThigh: still([12, 0, 0]),
    LeftThigh: still([14, 0, 0]),
    RightShin: still([22, 0, 0]),
    LeftShin: still([26, 0, 0]),
    RightFoot: still([-8, 0, 0]),
    LeftFoot: still([-8, 0, 0]),
    Waist: still([14, 0, 0]),
    Head: still([-12, 0, 0]),
  });

  // a front crawl: the body leans far forward, the arms turn over and the legs flutter
  const swim = clip(idGen(), 'swim', 0.9, true, 12, {
    RightUpperArm: (p) => [-150 + 70 * sin(p), 0, -10],
    LeftUpperArm: (p) => [-150 - 70 * sin(p), 0, 10],
    RightForearm: (p) => [-15 - 15 * cos(p), 0, 0],
    LeftForearm: (p) => [-15 + 15 * cos(p), 0, 0],
    RightThigh: (p) => [10 + 22 * sin(p * 2), 0, 0],
    LeftThigh: (p) => [10 - 22 * sin(p * 2), 0, 0],
    RightShin: still([14, 0, 0]),
    LeftShin: still([14, 0, 0]),
    Waist: still([62, 0, 0]),
    Head: still([-48, 0, 0]),
  });

  const crouchPose = (sway: (p: number) => number): Record<string, Fn> => ({
    RightThigh: (p) => [-68 + sway(p), 0, 0],
    LeftThigh: (p) => [-68 - sway(p), 0, 0],
    RightShin: (p) => [118 + 0.5 * sway(p), 0, 0],
    LeftShin: (p) => [118 - 0.5 * sway(p), 0, 0],
    RightFoot: (p) => [-50 - 0.5 * sway(p), 0, 0],
    LeftFoot: (p) => [-50 + 0.5 * sway(p), 0, 0],
    Hips: still([-8, 0, 0]),
    Waist: still([20, 0, 0]),
    Chest: still([10, 0, 0]),
    Head: still([-26, 0, 0]),
    RightUpperArm: (p) => [-34 + 0.5 * sway(p), 0, 0],
    LeftUpperArm: (p) => [-34 - 0.5 * sway(p), 0, 0],
    RightForearm: still([-34, 0, 0]),
    LeftForearm: still([-34, 0, 0]),
  });
  const crouch = clip(idGen(), 'crouch', 1, true, 2, crouchPose(() => 0), { Root: still([0, -0.165, 0]) });
  const crouchWalk = clip(idGen(), 'crouch_walk', 0.9, true, 16, crouchPose((p) => 16 * sin(p)), {
    Root: (p) => [0, -0.165 + 0.012 * cos(2 * p), 0],
  });

  return [idle, walk, run, jump, fall, glide, swim, crouch, crouchWalk];
}
