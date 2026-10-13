import { describe, expect, it } from 'vitest';
import { stairsMesh } from '../src/core/meshGen';
import { type PlayerSettings, createBlock, defaultPlayer } from '../src/core/types';
import { buildColliders } from '../src/runtime/level';
import { type Box, boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController, type PlayerInput } from '../src/runtime/player';
import type { MeshCollider } from '../src/runtime/collision';

const DT = 1 / 120;
const ground = boxFromCenterSize([0, -0.5, 0], [200, 1, 200]);

function make(over: Partial<PlayerSettings> = {}, spawn: [number, number, number] = [0, 0, 0]) {
  const p = new PlayerController({ ...defaultPlayer(), cameraMode: 'free', ...over }, spawn, 0);
  p.reset();
  return p;
}

function run(p: PlayerController, seconds: number, input: Partial<PlayerInput>, boxes: Box[] = [ground], meshes: MeshCollider[] = []) {
  for (let i = 0; i < Math.round(seconds / DT); i++) p.update(DT, { ...NO_INPUT, ...input }, 0, boxes, meshes);
}

describe('stepping up', () => {
  it('walks up onto a low box in the way', () => {
    const curb = boxFromCenterSize([0, 0.15, -6], [6, 0.3, 10]); // z from -11 to -1
    const p = make();
    run(p, 0.2, {}, [ground, curb]);
    run(p, 1.2, { moveY: 1 }, [ground, curb]); // forward is -z
    expect(p.pos[2]).toBeLessThan(-3);
    expect(p.pos[1]).toBeCloseTo(0.3, 2);
    expect(p.grounded).toBe(true);
  });

  it('a box higher than the step is a wall', () => {
    const wall = boxFromCenterSize([0, 0.3, -3], [6, 0.6, 2]);
    const p = make();
    run(p, 0.2, {}, [ground, wall]);
    run(p, 1.5, { moveY: 1 }, [ground, wall]);
    expect(p.pos[2]).toBeGreaterThan(-1.8);
    expect(p.pos[1]).toBeCloseTo(0, 2);
  });

  it('a step height of 0 turns it off', () => {
    const curb = boxFromCenterSize([0, 0.15, -3], [6, 0.3, 2]);
    const p = make({ stepHeight: 0 });
    run(p, 0.2, {}, [ground, curb]);
    run(p, 1.5, { moveY: 1 }, [ground, curb]);
    expect(p.pos[2]).toBeGreaterThan(-1.8);
  });

  it('a larger step height lets it climb higher edges', () => {
    const wall = boxFromCenterSize([0, 0.3, -6], [6, 0.6, 10]);
    const p = make({ stepHeight: 0.7 });
    run(p, 0.2, {}, [ground, wall]);
    run(p, 1.2, { moveY: 1 }, [ground, wall]);
    expect(p.pos[1]).toBeCloseTo(0.6, 2);
  });

  it('does not step into a space with a low ceiling', () => {
    const curb = boxFromCenterSize([0, 0.15, -3], [6, 0.3, 2]);
    // a ceiling 1.5 m above the ground: there is not room for 1.8 m on top of the 0.3 m curb
    const ceiling = boxFromCenterSize([0, 1.75, -3], [6, 0.5, 2]);
    const p = make();
    run(p, 0.2, {}, [ground, curb, ceiling]);
    run(p, 1.5, { moveY: 1 }, [ground, curb, ceiling]);
    expect(p.pos[2]).toBeGreaterThan(-1.8);
    expect(p.pos[1]).toBeCloseTo(0, 2);
  });

  it('keeps walking up a long flight of modeled stairs', () => {
    // 8 treads of 0.2 m, rising toward -z, 3 m deep: the tread depth is 0.375 m
    const stairs = createBlock('Stairs', [0, 0.8, -3], stairsMesh([3, 1.6, 3], 8), null);
    const { boxes, meshes } = buildColliders([stairs], () => undefined);
    expect(meshes.length).toBeGreaterThan(0);
    const p = make({}, [0, 0, 0]);
    run(p, 0.3, {}, [ground, ...boxes], meshes);
    // the stairs run from z = -1.5 to -4.5 (the top is 1.6 m up); about a second of walking gets near the end
    run(p, 1.05, { moveY: 1 }, [ground, ...boxes], meshes);
    expect(p.pos[1]).toBeGreaterThan(1.2);
    expect(p.pos[2]).toBeLessThan(-3.5);
    expect(p.grounded).toBe(true);
  });

  it('still stops at the side wall of a flight of stairs', () => {
    const stairs = createBlock('Stairs', [0, 0.8, -3], stairsMesh([3, 1.6, 3], 8), null);
    const { boxes, meshes } = buildColliders([stairs], () => undefined);
    const p = make({}, [3, 0, -3]);
    run(p, 0.3, {}, [ground, ...boxes], meshes);
    run(p, 1, { moveX: -1 }, [ground, ...boxes], meshes);
    // walking left (-x) into the side of the staircase from the right: blocked by the side wall at x = 1.5
    // after the first low tread; it climbs only the low ones along the side, never ending up high
    expect(p.pos[0]).toBeGreaterThan(1.3);
  });
});
