import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { poseQuaternion, viewAngles } from '../src/editor/cameraNav';

/** Where the camera sits relative to its pivot for a given pose, and which way its up vector points. */
function pose(yaw: number, pitch: number) {
  const q = poseQuaternion(yaw, pitch);
  return {
    eye: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    forward: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
  };
}

const near = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 5);
  expect(v.y).toBeCloseTo(y, 5);
  expect(v.z).toBeCloseTo(z, 5);
};

describe('editor camera poses', () => {
  it('front view: camera on +Z looking toward -Z', () => {
    const a = viewAngles('front');
    const p = pose(a.yaw, a.pitch);
    near(p.eye, 0, 0, 1);
    near(p.forward, 0, 0, -1);
    near(p.up, 0, 1, 0);
  });

  it('rear, right and left views sit on -Z, +X and -X', () => {
    near(pose(viewAngles('back').yaw, 0).eye, 0, 0, -1);
    near(pose(viewAngles('right').yaw, 0).eye, 1, 0, 0);
    near(pose(viewAngles('left').yaw, 0).eye, -1, 0, 0);
  });

  it('top view looks straight down with -Z at the top of the screen (like Godot)', () => {
    const a = viewAngles('top');
    const p = pose(a.yaw, a.pitch);
    near(p.eye, 0, 1, 0);
    near(p.forward, 0, -1, 0);
    near(p.up, 0, 0, -1);
  });

  it('bottom view looks straight up', () => {
    const a = viewAngles('bottom');
    near(pose(a.yaw, a.pitch).forward, 0, 1, 0);
  });

  it('positive pitch puts the camera above the pivot', () => {
    expect(pose(0.3, 0.5).eye.y).toBeGreaterThan(0);
    expect(pose(0.3, -0.5).eye.y).toBeLessThan(0);
  });

  it('top and bottom views always start with X to the right (yaw 0), like Godot', () => {
    expect(viewAngles('top').yaw).toBe(0);
    expect(viewAngles('bottom').yaw).toBe(0);
    near(pose(0, viewAngles('top').pitch).up, 0, 0, -1);
  });

  it('the camera always looks at the pivot', () => {
    const p = pose(2.1, 0.7);
    // forward is exactly the negated eye direction
    near(p.forward.clone().add(p.eye), 0, 0, 0);
  });
});
