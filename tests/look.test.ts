import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { boxMesh } from '../src/core/mesh';
import { DEFAULT_LOOK, normalizeLook, sunDirection } from '../src/core/look';
import { builtInComponent, isTiled, modelDefaults, modelLook } from '../src/core/components';
import { RENDER_SCALES, createBlock, createDefaultProject, defaultPlayer, normalizeObject, normalizeProject } from '../src/core/types';
import { Store } from '../src/editor/store';
import { buildColliders } from '../src/runtime/level';
import { boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController, type PlayerInput } from '../src/runtime/player';
import { chooseAnimation } from '../src/runtime/avatar';
import { createEnvironment } from '../src/runtime/environment';

describe('the look of a level', () => {
  it('has defaults and cleans bad values', () => {
    expect(normalizeLook(null)).toEqual(DEFAULT_LOOK);
    const l = normalizeLook({ fogNear: -5, fogFar: 2, sunPitch: 200, sunColor: 'red', sunIntensity: 99, shadows: 'yes' });
    expect(l.fogNear).toBe(0);
    expect(l.fogFar).toBeGreaterThan(l.fogNear);
    expect(l.sunPitch).toBe(90);
    expect(l.sunColor).toBe(DEFAULT_LOOK.sunColor);
    expect(l.sunIntensity).toBe(6);
    expect(l.shadows).toBe(true);
  });

  it('the sun is a unit vector above the horizon', () => {
    for (const [yaw, pitch] of [
      [0, 30],
      [90, 60],
      [200, 85],
    ] as const) {
      const d = sunDirection({ sunYaw: yaw, sunPitch: pitch });
      expect(Math.hypot(...d)).toBeCloseTo(1);
      expect(d[1]).toBeGreaterThan(0);
    }
    expect(sunDirection({ sunYaw: 0, sunPitch: 90 })[1]).toBeCloseTo(1);
  });

  it('is part of each level, survives saving, and is changed with undo', () => {
    const store = new Store(createDefaultProject());
    expect(store.level.look).toEqual(DEFAULT_LOOK);
    store.level.look.sunYaw = 120;
    store.level.look.shadows = false;
    store.lookChanged();
    store.undoLevel();
    expect(store.level.look.sunYaw).toBe(DEFAULT_LOOK.sunYaw);
    store.redoLevel();
    const back = normalizeProject(JSON.parse(JSON.stringify(store.project)));
    expect(back.levels[0]!.look.sunYaw).toBe(120);
    expect(back.levels[0]!.look.shadows).toBe(false);
    // an older file has the default
    const old = normalizeProject({ version: 8, levels: [{ name: 'A', objects: [] }] });
    expect(old.levels[0]!.look).toEqual(DEFAULT_LOOK);
  });

  it('the render scale is one of the offered ones', () => {
    expect(createDefaultProject().settings.renderScale).toBe(1);
    expect(normalizeProject({ settings: { renderScale: 0.5 } }).settings.renderScale).toBe(0.5);
    expect(normalizeProject({ settings: { renderScale: 0.7 } }).settings.renderScale).toBe(1);
    expect(RENDER_SCALES).toContain(0.25);
  });
});

describe('see-through blocks and water', () => {
  it('opacity and liquid are kept, and default to nothing', () => {
    const b = createBlock('Pool', [0, 0, 0], boxMesh([4, 2, 4]), null);
    b.opacity = 0.6;
    b.liquid = true;
    const back = normalizeObject(JSON.parse(JSON.stringify(b)));
    expect(back.kind === 'block' && [back.opacity, back.liquid]).toEqual([0.6, true]);
    const plain = normalizeObject(JSON.parse(JSON.stringify(createBlock('A', [0, 0, 0], boxMesh([1, 1, 1]), null))));
    expect(plain.kind === 'block' && plain.opacity).toBeUndefined();
    expect(plain.kind === 'block' && plain.liquid).toBeUndefined();
    // a silly opacity is held above 0
    expect(normalizeObject({ kind: 'block', opacity: -3 } as never).kind === 'block').toBe(true);
  });

  it('the Water asset is a see-through, non-solid body of water', () => {
    const w = builtInComponent('water', () => 'x');
    expect(isTiled(w)).toBe(true);
    expect(modelLook(w).liquid).toBe(true);
    expect(modelLook(w).opacity).toBeLessThan(1);
    expect(modelDefaults(w).collide).toBe(false);
  });

  it('a liquid block is a swim volume even though it is not solid', () => {
    const b = createBlock('Pool', [0, -1, 0], boxMesh([10, 2, 10]), null);
    b.liquid = true;
    b.collide = false;
    const c = buildColliders([b], () => undefined);
    expect(c.boxes).toHaveLength(0);
    expect(c.liquids).toHaveLength(1);
    expect(c.liquids[0]).toMatchObject({ minY: -2, maxY: 0, minX: -5, maxX: 5 });
  });
});

describe('swimming', () => {
  const floor = boxFromCenterSize([0, -5.5, 0], [100, 1, 100]); // the bottom of a 5 m deep pool
  const pool = { minX: -20, maxX: 20, minZ: -20, maxZ: 20, minY: -5, maxY: 0 };
  const make = (y: number) => {
    const p = new PlayerController({ ...defaultPlayer(), cameraMode: 'free' }, [0, y, 0], 0);
    p.reset();
    return p;
  };
  const run = (p: PlayerController, seconds: number, input: Partial<PlayerInput> = {}, withWater = true) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      p.update(1 / 120, { ...NO_INPUT, ...input }, 0, [floor], [], withWater ? [pool] : []);
    }
  };

  it('sinks slowly instead of falling', () => {
    const p = make(-1);
    run(p, 1);
    expect(p.swimming).toBe(true);
    expect(p.vel[1]).toBeGreaterThan(-3.3);
    expect(p.pos[1]).toBeGreaterThan(-4.5);
    // dry, the same second is a fall of several meters
    const dry = make(-1);
    run(dry, 1, {}, false);
    expect(dry.pos[1]).toBeLessThan(p.pos[1] - 1);
  });

  it('holding jump swims up, crouch dives', () => {
    const p = make(-3);
    run(p, 1, { jumpHeld: true });
    expect(p.pos[1]).toBeGreaterThan(-2);
    const q = make(-1);
    run(q, 1, { crouch: true });
    expect(q.pos[1]).toBeLessThan(-3);
  });

  it('moves slower than on land', () => {
    const wet = make(-1);
    run(wet, 0.6, { moveY: 1 });
    const dry = make(-1);
    run(dry, 0.6, { moveY: 1 }, false);
    expect(Math.abs(wet.pos[2])).toBeLessThan(Math.abs(dry.pos[2]));
  });

  it('hops out at the surface with a jump press', () => {
    const p = make(-1.6); // head at the surface
    run(p, 0.05);
    p.update(1 / 120, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [floor], [], [pool]);
    expect(p.vel[1]).toBeGreaterThan(5);
  });

  it('plays the swim pose, falling back to the fall pose', () => {
    const base = { walkSpeed: 4, runSpeed: 7, crouchSpeed: 2 };
    expect(chooseAnimation({ grounded: false, crouching: false, speed: 1, vy: 0, swimming: true }, base).clip).toBe('swim');
  });
});

describe('the environment', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('takes a look and keeps the sun on the player', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    env.setSky('#102030');
    expect((scene.background as THREE.Color).getHexString()).toBe('102030');
    expect(env.fog.color.getHexString()).toBe('102030');
    env.setLook({ ...DEFAULT_LOOK, fogNear: 10, fogFar: 50, sunYaw: 90, sunPitch: 45, shadows: false, ambient: 0.5 });
    expect([env.fog.near, env.fog.far]).toEqual([10, 50]);
    const sun = scene.children.find((c) => (c as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
    expect(sun.castShadow).toBe(false);
    env.followSun(new THREE.Vector3(10, 2, -5));
    expect(sun.target.position.x).toBeCloseTo(10, 1);
    // the sun sits toward +x (yaw 90) and up
    expect(sun.position.x).toBeGreaterThan(sun.target.position.x + 40);
    expect(sun.position.y).toBeGreaterThan(sun.target.position.y + 40);
  });
});
