import { describe, expect, it } from 'vitest';
import { wedgeMesh } from '../src/core/mesh';
import { type PlayerSettings, createBlock, defaultPlayer, normalizeObject } from '../src/core/types';
import {
  type MeshCollider,
  capsuleTriangleContact,
  closestPointOnTriangle,
  closestSegmentSegment,
  isAxisAlignedRotation,
  meshColliderFromTriangles,
  meshGroundBelow,
  raycastMeshes,
  segmentTriangleHit,
} from '../src/runtime/collision';
import { buildColliders } from '../src/runtime/level';
import { boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController, type PlayerInput } from '../src/runtime/player';

const DT = 1 / 120;
const ground = boxFromCenterSize([0, -0.5, 0], [200, 1, 200]);

/** A slab rising toward -Z from the ground at z = 0 with the given angle, `length` long and 20 wide. */
function slope(angleDeg: number, length = 14): MeshCollider {
  const a = (angleDeg * Math.PI) / 180;
  const dz = Math.cos(a) * length;
  const dy = Math.sin(a) * length;
  const x = 10;
  // two triangles: (-x,0,0) (x,0,0) (x,dy,-dz)  and  (-x,0,0) (x,dy,-dz) (-x,dy,-dz)
  const tris = [-x, 0, 0, x, 0, 0, x, dy, -dz, -x, 0, 0, x, dy, -dz, -x, dy, -dz];
  return meshColliderFromTriangles(tris)!;
}

/** Height of that slope at z (z <= 0). */
const slopeY = (angleDeg: number, z: number) => -z * Math.tan((angleDeg * Math.PI) / 180);

function make(over: Partial<PlayerSettings> = {}, spawn: [number, number, number] = [0, 0, 0]) {
  const p = new PlayerController({ ...defaultPlayer(), cameraMode: 'free', ...over }, spawn, 0);
  p.reset();
  return p;
}

function run(p: PlayerController, seconds: number, input: Partial<PlayerInput>, meshes: MeshCollider[], boxes = [ground]) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) p.update(DT, { ...NO_INPUT, ...input }, 0, boxes, meshes);
}

describe('triangle geometry', () => {
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [4, 0, 0];
  const c: [number, number, number] = [0, 0, 4];

  it('finds the closest point of a triangle', () => {
    expect(closestPointOnTriangle([1, 2, 1], a, b, c)).toEqual([1, 0, 1]); // above the face
    expect(closestPointOnTriangle([-3, 1, -3], a, b, c)).toEqual([0, 0, 0]); // beyond a corner
    const edge = closestPointOnTriangle([2, 1, 2], a, b, c);
    expect(edge[0]).toBeCloseTo(2);
    expect(edge[2]).toBeCloseTo(2);
  });

  it('closest points of two segments', () => {
    const { c1, c2 } = closestSegmentSegment([0, 0, 0], [4, 0, 0], [2, 3, -1], [2, 3, 5]);
    expect(c1).toEqual([2, 0, 0]);
    expect(c2).toEqual([2, 3, 0]);
  });

  it('segment through a triangle', () => {
    expect(segmentTriangleHit([1, -1, 1], [1, 1, 1], a, b, c)).toBeCloseTo(0.5);
    expect(segmentTriangleHit([3, -1, 3], [3, 1, 3], a, b, c)).toBeNull(); // outside the corner
  });

  it('a capsule resting on a floor touches it by its depth, one above does not', () => {
    const touch = capsuleTriangleContact([1, 0.25, 1], [1, 1.5, 1], 0.3, a, b, c);
    expect(touch!.depth).toBeCloseTo(0.05);
    expect(touch!.n[1]).toBeCloseTo(1);
    expect(capsuleTriangleContact([1, 0.4, 1], [1, 1.5, 1], 0.3, a, b, c)).toBeNull();
  });

  it('a capsule whose axis crosses the triangle is freed the short way', () => {
    const c0 = capsuleTriangleContact([1, -0.1, 1], [1, 1.5, 1], 0.3, a, b, c)!;
    expect(c0.n[1]).toBeCloseTo(1); // pushed up: 0.4 instead of 1.8 down
    expect(c0.depth).toBeCloseTo(0.4);
  });

  it('rays hit triangles and a ground height is read below a point', () => {
    const s = slope(30);
    const hit = raycastMeshes([0, 5, -2], [0, -1, 0], 20, [s])!;
    expect(5 - hit).toBeCloseTo(slopeY(30, -2), 3);
    expect(meshGroundBelow(0, -4, 6, [s])).toBeCloseTo(slopeY(30, -4), 3);
    expect(meshGroundBelow(50, -4, 6, [s])).toBeNull();
  });

  it('knows which rotations keep a box a box', () => {
    const e = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
    };
    expect(isAxisAlignedRotation(e(0))).toBe(true);
    expect(isAxisAlignedRotation(e(90))).toBe(true);
    expect(isAxisAlignedRotation(e(180))).toBe(true);
    expect(isAxisAlignedRotation(e(45))).toBe(false);
    expect(isAxisAlignedRotation(e(10))).toBe(false);
  });
});

describe('walking on slopes', () => {
  it('walks up a 30 degree ramp and keeps standing on it', () => {
    const s = slope(30);
    const p = make({}, [0, 0, 1]);
    run(p, 0.3, {}, [s]);
    run(p, 2.5, { moveY: 1 }, [s]); // forward is -z
    expect(p.pos[2]).toBeLessThan(-4);
    expect(p.pos[1]).toBeCloseTo(slopeY(30, p.pos[2]) , 1);
    expect(p.grounded).toBe(true);
  });

  it('stands still on a slope instead of creeping down it', () => {
    const s = slope(35);
    const z = -6;
    const p = make({}, [0, slopeY(35, z) + 0.01, z]);
    run(p, 0.2, {}, [s]);
    const [x0, y0, z0] = p.pos;
    run(p, 3, {}, [s]);
    expect(Math.hypot(p.pos[0] - x0, p.pos[1] - y0, p.pos[2] - z0)).toBeLessThan(0.03);
    expect(p.grounded).toBe(true);
  });

  it('cannot walk up a slope steeper than the maximum, and slides down it', () => {
    const s = slope(70);
    const p = make({ maxSlope: 50 }, [0, 0, 1]);
    run(p, 0.3, {}, [s]);
    run(p, 2, { moveY: 1, run: true }, [s]);
    expect(p.pos[1]).toBeLessThan(0.6); // blocked at the foot
    // dropped onto the steep face high up it slides back down (the slope is 14 m long, ending at z = -4.8)
    const q = make({ maxSlope: 50 }, [0, slopeY(70, -4) + 0.05, -4]);
    run(q, 1.5, {}, [s]);
    expect(q.pos[1]).toBeLessThan(slopeY(70, -4) - 0.5);
    expect(q.pos[2]).toBeGreaterThan(-4); // it went down along the slope, not through it
  });

  it('a higher maximum lets it climb the same slope', () => {
    const s = slope(60);
    const p = make({ maxSlope: 70 }, [0, 0, 1]);
    run(p, 0.3, {}, [s]);
    run(p, 2, { moveY: 1 }, [s]);
    expect(p.pos[1]).toBeGreaterThan(2);
  });

  it('stays on the ground walking down a slope', () => {
    const s = slope(30);
    const z = -9;
    const p = make({}, [0, slopeY(30, z) + 0.01, z]);
    run(p, 0.3, {}, [s]);
    let air = 0;
    let steps = 0;
    for (let i = 0; i < 360; i++) {
      p.update(DT, { ...NO_INPUT, moveY: -1, run: true }, 0, [ground], [s]);
      steps++;
      if (!p.grounded) air++;
    }
    expect(p.pos[2]).toBeGreaterThan(z + 6);
    expect(air / steps).toBeLessThan(0.03);
  });

  it('can jump off a slope', () => {
    const s = slope(30);
    const z = -5;
    const p = make({}, [0, slopeY(30, z) + 0.01, z]);
    run(p, 0.3, {}, [s]);
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground], [s]);
    expect(p.vel[1]).toBeGreaterThan(5);
    let maxY = p.pos[1];
    for (let i = 0; i < 100; i++) {
      p.update(DT, { ...NO_INPUT, jumpHeld: true }, 0, [ground], [s]);
      maxY = Math.max(maxY, p.pos[1]);
    }
    expect(maxY).toBeGreaterThan(slopeY(30, z) + 1);
  });

  it('can jump while sliding down a slope that is too steep to stand on', () => {
    const s = slope(70);
    const z = -3; // the slope is 14 m long: it reaches z = -4.8
    const p = make({ maxSlope: 50, doubleJump: false }, [0, slopeY(70, z) + 0.05, z]);
    run(p, 0.25, {}, [s]); // lands on the face and starts to slide
    expect(p.grounded).toBe(false);
    expect(p.vel[1]).toBeLessThanOrEqual(0.5);
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground], [s]);
    expect(p.vel[1]).toBeGreaterThan(5);
  });

  it('a steep slope does not give a free double jump or endless jumps in the air', () => {
    const s = slope(70);
    const z = -3;
    const p = make({ maxSlope: 50, doubleJump: false }, [0, slopeY(70, z) + 0.05, z]);
    run(p, 0.25, {}, [s]);
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground], [s]);
    const vy = p.vel[1];
    expect(vy).toBeGreaterThan(5);
    // a second press right after, while still moving up, does nothing
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground], [s]);
    expect(p.vel[1]).toBeLessThan(vy);
  });

  it('is stopped by the side of a rotated block', () => {
    // a long wall turned by 30 degrees: it cannot be walked around
    const b = normalizeObject({ kind: 'block', position: [0, 1.5, -5], size: [60, 3, 1], rotation: [0, 30, 0] } as never);
    const { meshes } = buildColliders([b], () => undefined);
    expect(meshes).toHaveLength(1);
    const p = make({}, [0, 0, 0]);
    run(p, 4, { moveY: 1, run: true }, meshes);
    // it ends in front of the wall (a plane turned 30 degrees about Y), never inside or behind it,
    // having slid along it
    const wallZ = -5 - Math.tan((30 * Math.PI) / 180) * p.pos[0];
    expect(p.pos[2]).toBeGreaterThan(wallZ + 0.3);
    expect(Math.abs(p.pos[0])).toBeGreaterThan(0.5);
    expect(p.pos[1]).toBeLessThan(0.05); // and it did not climb it
  });

  it('walks up the Ramp shape of the shape menu', () => {
    const ramp = createBlock('Ramp', [0, 0.9, -3], wedgeMesh([3, 1.8, 6]), null); // low at +z, high at -z
    const { meshes, boxes } = buildColliders([ramp], () => undefined);
    expect(boxes).toHaveLength(0);
    const p = make({}, [0, 0, 1]);
    run(p, 0.3, {}, meshes);
    run(p, 1.7, { moveY: 1 }, meshes); // up to the top, 6 m long at 4 m/s takes 1.9 s
    expect(p.pos[1]).toBeGreaterThan(1.2);
    expect(p.grounded).toBe(true);
    // keep going: it walks off the high end and falls back to the floor
    run(p, 2, { moveY: 1 }, meshes);
    expect(p.pos[1]).toBeCloseTo(0, 1);
  });

  it('crouches under a sloped ceiling and refuses to stand up into it', () => {
    const s = slope(0.001, 8); // an almost flat ceiling
    // lift it to 1.4 m and flip the sense: a flat ceiling at 1.4 made of triangles
    const y = 1.4;
    const tris = [-5, y, -5, 5, y, -5, 5, y, 5, -5, y, -5, 5, y, 5, -5, y, 5];
    const ceiling = meshColliderFromTriangles(tris)!;
    void s;
    const p = make({}, [0, 0, 0]);
    run(p, 0.2, { crouch: true }, [ceiling]);
    expect(p.crouching).toBe(true);
    run(p, 0.5, {}, [ceiling]);
    expect(p.crouching).toBe(true); // 1.8 m does not fit under 1.4 m
    run(p, 0.2, {}, []);
    expect(p.crouching).toBe(false);
  });
});

describe('body size', () => {
  it('is 1.8 m tall by default', () => {
    const p = defaultPlayer();
    expect(p.height).toBe(1.8);
    expect(p.crouchHeight).toBeLessThan(p.height);
    expect(p.width).toBeGreaterThan(0.3);
  });
});
