import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultPlayer } from '../src/core/types';
import { CameraRig } from '../src/runtime/cameraRig';

const feet: [number, number, number] = [3, 0, -2];

function settle(rig: CameraRig, cam: THREE.PerspectiveCamera, facing: number, seconds: number, mode: 'chase' | 'free') {
  const s = { ...defaultPlayer(), cameraMode: mode };
  for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60, cam, feet, facing, 1, s, []);
}

/** Positive when the camera is behind the player (opposite to where they face). */
function behindness(cam: THREE.PerspectiveCamera, facing: number): number {
  const dx = feet[0] - cam.position.x;
  const dz = feet[2] - cam.position.z;
  return (dx * Math.sin(facing) + dz * Math.cos(facing)) / Math.hypot(dx, dz);
}

describe('CameraRig', () => {
  it('starts behind the player and stays there while they turn (chase)', () => {
    const rig = new CameraRig();
    const cam = new THREE.PerspectiveCamera();
    rig.reset(0.3);
    settle(rig, cam, 0.3, 0.1, 'chase');
    expect(behindness(cam, 0.3)).toBeGreaterThan(0.99);

    for (const facing of [1.4, -2.0, 3.0, -0.2]) {
      settle(rig, cam, facing, 2, 'chase');
      expect(behindness(cam, facing)).toBeGreaterThan(0.999);
    }
  });

  it('swings around the short way and trails a little while turning', () => {
    const rig = new CameraRig();
    const cam = new THREE.PerspectiveCamera();
    rig.reset(3.0);
    settle(rig, cam, 3.0, 0.1, 'chase');
    const before = rig.yaw;
    // facing wraps from +3.0 to -3.0, a 0.28 rad turn, not 6 rad the long way
    settle(rig, cam, -3.0, 1 / 60, 'chase');
    expect(Math.abs(Math.atan2(Math.sin(rig.yaw - before), Math.cos(rig.yaw - before)))).toBeLessThan(0.3);
    expect(behindness(cam, -3.0)).toBeLessThan(0.9999); // not instant
    settle(rig, cam, -3.0, 2, 'chase');
    expect(behindness(cam, -3.0)).toBeGreaterThan(0.9999);
  });

  it('mouse look only changes the pitch in chase mode and orbits in free mode', () => {
    const rig = new CameraRig();
    rig.reset(0);
    const yaw = rig.yaw;
    const pitch = rig.pitch;
    rig.look(100, 40, 1, false, false);
    expect(rig.yaw).toBe(yaw);
    expect(rig.pitch).toBeGreaterThan(pitch);
    rig.look(100, 0, 1, false, true);
    expect(rig.yaw).toBeLessThan(yaw);
  });

  it('the free camera does not follow the player', () => {
    const rig = new CameraRig();
    const cam = new THREE.PerspectiveCamera();
    rig.reset(0);
    settle(rig, cam, 1.5, 2, 'free');
    expect(behindness(cam, 1.5)).toBeLessThan(0.5);
  });
});
