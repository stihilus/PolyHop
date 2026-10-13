import { describe, expect, it } from 'vitest';
import { FRAME, applyPose, deleteKey, duplicateClip, keyAt, keysOf, mirrorPose, moveKey, sampleBone, scaleDuration, setKey, snapTime } from '../src/core/clipEdit';
import { sampleKeys } from '../src/core/rig';
import type { AnimationClip } from '../src/core/types';

const clip = (over: Partial<AnimationClip> = {}): AnimationClip => ({ id: 'c', name: 'c', duration: 1, loop: false, tracks: {}, ...over });

describe('keys', () => {
  it('the first key also pins the rest pose at the start', () => {
    const c = clip();
    setKey(c, 'Arm', 'rot', 0.5, [30, 0, 0]);
    expect(keysOf(c, 'Arm', 'rot').map((k) => k.t)).toEqual([0, 0.5]);
    expect(sampleBone(c, 'Arm', 0.25).rot[0]).toBeCloseTo(15);
    expect(sampleBone(c, 'Arm', 0).rot[0]).toBe(0);
  });

  it('replaces a key at the same time and keeps them sorted', () => {
    const c = clip();
    setKey(c, 'A', 'rot', 0, [0, 0, 0]);
    setKey(c, 'A', 'rot', 0.8, [8, 0, 0]);
    setKey(c, 'A', 'rot', 0.4, [4, 0, 0]);
    setKey(c, 'A', 'rot', 0.4, [5, 0, 0]);
    expect(keysOf(c, 'A', 'rot').map((k) => [k.t, k.v[0]])).toEqual([[0, 0], [0.4, 5], [0.8, 8]]);
  });

  it('a loop starts and ends at rest and its end follows the start while they are equal', () => {
    const c = clip({ loop: true, duration: 2 });
    setKey(c, 'A', 'rot', 1, [20, 0, 0]);
    expect(keysOf(c, 'A', 'rot').map((k) => [k.t, k.v[0]])).toEqual([[0, 0], [1, 20], [2, 0]]);
    setKey(c, 'A', 'rot', 0, [10, 0, 0]);
    expect(keyAt(c, 'A', 'rot', 2)!.v[0]).toBe(10);
  });

  it('the end of a loop can have its own value, e.g. a full turn', () => {
    const c = clip({ loop: true, duration: 2 });
    setKey(c, 'A', 'rot', 1, [180, 0, 0]);
    setKey(c, 'A', 'rot', 2, [360, 0, 0]);
    expect(keyAt(c, 'A', 'rot', 0)!.v[0]).toBe(0);
    expect(keyAt(c, 'A', 'rot', 2)!.v[0]).toBe(360);
    // now the start no longer drags the end along
    setKey(c, 'A', 'rot', 0, [5, 0, 0]);
    expect(keyAt(c, 'A', 'rot', 2)!.v[0]).toBe(360);
  });

  it('deleting a key removes only that key; the last one removes the track', () => {
    const c = clip({ loop: true, duration: 1 });
    setKey(c, 'A', 'rot', 0.5, [10, 0, 0]);
    deleteKey(c, 'A', 'rot', 0);
    expect(keysOf(c, 'A', 'rot').map((k) => k.t)).toEqual([0.5, 1]);
    deleteKey(c, 'A', 'rot', 0.5);
    deleteKey(c, 'A', 'rot', 1);
    expect(c.tracks.A).toBeUndefined();
  });

  it('moves a key, replacing one that is in the way, and clamps to the clip', () => {
    const c = clip();
    setKey(c, 'A', 'rot', 0.2, [2, 0, 0]);
    setKey(c, 'A', 'rot', 0.6, [6, 0, 0]);
    expect(moveKey(c, 'A', 'rot', 0.2, 0.6)).toBe(0.6);
    expect(keysOf(c, 'A', 'rot').map((k) => [k.t, k.v[0]])).toEqual([[0, 0], [0.6, 2]]);
    expect(moveKey(c, 'A', 'rot', 0.6, 5)).toBe(1);
  });

  it('rotation and position are separate channels', () => {
    const c = clip();
    setKey(c, 'Root', 'pos', 0.5, [0, 0.1, 0]);
    expect(c.tracks.Root!.rot).toBeUndefined();
    expect(sampleBone(c, 'Root', 0.5).pos[1]).toBeCloseTo(0.1);
  });

  it('stretches the keys when the duration changes', () => {
    const c = clip({ duration: 1 });
    setKey(c, 'A', 'rot', 0.5, [10, 0, 0]);
    scaleDuration(c, 2);
    expect(c.duration).toBe(2);
    expect(keysOf(c, 'A', 'rot').map((k) => k.t)).toEqual([0, 1]);
  });

  it('snaps to frames', () => {
    expect(snapTime(0.51)).toBeCloseTo(15 * FRAME);
    expect(snapTime(0.01)).toBe(0);
  });

  it('duplicates without sharing keys', () => {
    const c = clip();
    setKey(c, 'A', 'rot', 0.5, [10, 0, 0]);
    const d = duplicateClip(c, 'd', 'copy');
    setKey(d, 'A', 'rot', 0.5, [99, 0, 0]);
    expect(keyAt(c, 'A', 'rot', 0.5)!.v[0]).toBe(10);
    expect(d.name).toBe('copy');
  });
});

describe('poses', () => {
  it('mirrors left and right and flips the turn axes', () => {
    const pose = new Map([
      ['RightShoulder', { rot: [30, 10, -20] as [number, number, number], pos: [0.1, 0, 0.2] as [number, number, number] }],
      ['Head', { rot: [5, 15, 0] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }],
    ]);
    const m = mirrorPose(pose);
    expect(m.get('LeftShoulder')!.rot).toEqual([30, -10, 20]);
    expect(m.get('LeftShoulder')!.pos).toEqual([-0.1, 0, 0.2]);
    expect(m.get('Head')!.rot).toEqual([5, -15, -0]);
    expect(m.has('RightShoulder')).toBe(false);
  });

  it('writes a whole pose as keys', () => {
    const c = clip({ loop: false });
    applyPose(c, new Map([['A', { rot: [1, 2, 3] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }]]), 0.5);
    expect(keyAt(c, 'A', 'rot', 0.5)!.v).toEqual([1, 2, 3]);
    expect(c.tracks.A!.pos).toBeUndefined(); // zero position needs no track
  });
});

describe('smooth curves', () => {
  const keys = [
    { t: 0, v: [0, 0, 0] as [number, number, number] },
    { t: 1, v: [10, 0, 0] as [number, number, number] },
    { t: 2, v: [0, 0, 0] as [number, number, number] },
  ];
  it('passes through the keys', () => {
    expect(sampleKeys(keys, 1, true)![0]).toBeCloseTo(10);
    expect(sampleKeys(keys, 0, true)![0]).toBeCloseTo(0);
    expect(sampleKeys(keys, 2, true)![0]).toBeCloseTo(0);
  });
  it('rounds the peak instead of a corner: lines would give 5 at t=0.5, the curve a bit less or more', () => {
    const lin = sampleKeys(keys, 0.5, false)![0];
    const cur = sampleKeys(keys, 0.5, true)![0];
    expect(lin).toBeCloseTo(5);
    expect(cur).not.toBeCloseTo(5, 2);
  });
  it('wraps smoothly across a loop', () => {
    const loop = [
      { t: 0, v: [0, 0, 0] as [number, number, number] },
      { t: 1, v: [10, 0, 0] as [number, number, number] },
      { t: 2, v: [0, 0, 0] as [number, number, number] },
    ];
    // just before the end and just after the start are close to each other
    const a = sampleKeys(loop, 1.999, true, 2)![0];
    const b = sampleKeys(loop, 0.001, true, 2)![0];
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});

describe('continuous spins', () => {
  it('a smooth loop from 0 to 360 turns at a constant speed', () => {
    const keys = [
      { t: 0, v: [0, 0, 0] as [number, number, number] },
      { t: 0.5, v: [180, 0, 0] as [number, number, number] },
      { t: 1, v: [360, 0, 0] as [number, number, number] },
    ];
    for (const t of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      expect(sampleKeys(keys, t, true, 1)![0]).toBeCloseTo(360 * t, 3);
    }
  });
});
