import { describe, expect, it } from 'vitest';
import { type PlayerSettings, defaultPlayer } from '../src/core/types';
import { boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController, type PlayerInput } from '../src/runtime/player';

const DT = 1 / 120;
const ground = boxFromCenterSize([0, -0.5, 0], [100, 1, 100]);

/** `free` camera by default: moves are relative to `camYaw`. The chase camera has its own tests below. */
function make(spawn: [number, number, number] = [0, 0, 0], over: Partial<PlayerSettings> = {}) {
  const settings: PlayerSettings = { ...defaultPlayer(), cameraMode: 'free', ...over };
  const p = new PlayerController(settings, spawn, 0);
  p.reset();
  return p;
}

function run(p: PlayerController, seconds: number, input: Partial<PlayerInput>, boxes = [ground], camYaw = 0) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    p.update(DT, { ...NO_INPUT, ...input }, camYaw, boxes);
  }
}

describe('PlayerController', () => {
  it('rests on the ground without sinking or flickering', () => {
    const p = make([0, 0.5, 0]);
    run(p, 1, {});
    expect(p.pos[1]).toBeCloseTo(0, 3);
    expect(p.grounded).toBe(true);
    for (let i = 0; i < 100; i++) {
      p.update(DT, NO_INPUT, 0, [ground]);
      expect(p.grounded).toBe(true);
    }
  });

  it('jumps to roughly the configured jump height', () => {
    const p = make();
    run(p, 0.2, {});
    let max = 0;
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    for (let i = 0; i < 240; i++) {
      p.update(DT, { ...NO_INPUT, jumpHeld: true }, 0, [ground]);
      max = Math.max(max, p.pos[1]);
    }
    expect(max).toBeGreaterThan(p.settings.jumpHeight * 0.97);
    expect(max).toBeLessThan(p.settings.jumpHeight * 1.03);
  });

  it('jumps lower when the button is released early', () => {
    const p = make();
    run(p, 0.2, {});
    let max = 0;
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    for (let i = 0; i < 240; i++) {
      p.update(DT, NO_INPUT, 0, [ground]);
      max = Math.max(max, p.pos[1]);
    }
    expect(max).toBeLessThan(p.settings.jumpHeight * 0.6);
    expect(max).toBeGreaterThan(0.1);
  });

  it('walks at walk speed and runs faster', () => {
    const walk = make();
    run(walk, 1, { moveY: 1 }); // camYaw 0 => forward is -z
    const run1 = make();
    run(run1, 1, { moveY: 1, run: true });
    expect(walk.pos[2]).toBeLessThan(-3);
    expect(run1.pos[2]).toBeLessThan(walk.pos[2] - 2);
  });

  it('is stopped by a wall and does not tunnel through it', () => {
    const wall = boxFromCenterSize([0, 1, -5], [10, 2, 1]);
    const p = make();
    run(p, 3, { moveY: 1, run: true }, [ground, wall]);
    expect(p.pos[2]).toBeCloseTo(-4.5 + p.settings.width / 2, 2);
  });

  it('slides along a wall when moving diagonally', () => {
    const wall = boxFromCenterSize([0, 1, -5], [40, 2, 1]);
    const p = make();
    run(p, 2, { moveY: 1, moveX: 1, run: true }, [ground, wall]);
    expect(p.pos[0]).toBeGreaterThan(5);
    expect(p.pos[2]).toBeCloseTo(-4.5 + p.settings.width / 2, 2);
  });

  it('cannot stand up under a low ceiling and stands once clear', () => {
    const p0 = make([0, 0, 0]);
    const low = p0.settings.crouchHeight + 0.2; // room to crouch, not to stand
    const ceiling = boxFromCenterSize([0, low + 0.25, 0], [3, 0.5, 20]);
    const p = make([0, 0, 0]);
    run(p, 0.1, { crouch: true }, [ground, ceiling]);
    expect(p.crouching).toBe(true);
    expect(p.height).toBeCloseTo(p.settings.crouchHeight);
    run(p, 0.3, {}, [ground, ceiling]);
    expect(p.crouching).toBe(true);
    run(p, 0.1, {}, [ground]);
    expect(p.crouching).toBe(false);
    expect(p.height).toBeCloseTo(p.settings.height);
  });

  it('allows a jump shortly after walking off a ledge (coyote time)', () => {
    const ledge = boxFromCenterSize([0, -0.5, 0], [4, 1, 4]); // x in [-2, 2]
    const p = make([1.5, 0, 0]);
    run(p, 0.1, {}, [ledge]);
    // walk off the +x edge (camYaw 0: right = +x)
    let steps = 0;
    while (p.grounded || steps === 0) {
      p.update(DT, { ...NO_INPUT, moveX: 1 }, 0, [ledge]);
      steps++;
      if (steps > 600) throw new Error('never left the ledge');
    }
    run(p, 0.04, { moveX: 1 }, [ledge]);
    const before = p.vel[1];
    p.update(DT, { ...NO_INPUT, moveX: 1, jumpPressed: true, jumpHeld: true }, 0, [ledge]);
    expect(p.vel[1]).toBeGreaterThan(before + 5);
  });

  it('buffers a jump pressed just before landing', () => {
    const p = make([0, 0.3, 0]);
    // press jump while still in the air; it should fire on landing
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    let jumped = false;
    for (let i = 0; i < 120; i++) {
      p.update(DT, { ...NO_INPUT, jumpHeld: true }, 0, [ground]);
      if (p.vel[1] > 5) {
        jumped = true;
        break;
      }
    }
    expect(jumped).toBe(true);
  });

  it('has a double jump by default', () => {
    expect(defaultPlayer().doubleJump).toBe(true);
    const p = make();
    run(p, 0.2, {});
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    run(p, 0.3, { jumpHeld: true });
    const yBefore = p.pos[1];
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    expect(p.vel[1]).toBeGreaterThan(5);
    run(p, 0.3, { jumpHeld: true });
    expect(p.pos[1]).toBeGreaterThan(yBefore);
  });

  it('allows only one jump in mid-air and gives it back on landing', () => {
    const p = make();
    run(p, 0.2, {});
    const press = () => p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    press(); // ground jump
    run(p, 0.2, { jumpHeld: true });
    press(); // double jump
    run(p, 0.1, { jumpHeld: true });
    const vy = p.vel[1];
    press(); // a third press in the air does nothing
    expect(p.vel[1]).toBeLessThan(vy);
    for (let i = 0; i < 600 && !p.grounded; i++) p.update(DT, NO_INPUT, 0, [ground]);
    expect(p.grounded).toBe(true);
    run(p, 0.2, {});
    press();
    run(p, 0.2, { jumpHeld: true });
    press();
    expect(p.vel[1]).toBeGreaterThan(5);
  });

  it('cannot double jump when it is switched off', () => {
    const p = make([0, 0, 0], { doubleJump: false });
    run(p, 0.2, {});
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    run(p, 0.3, { jumpHeld: true });
    const vy = p.vel[1];
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground]);
    expect(p.vel[1]).toBeLessThan(vy);
  });

  it('bonks its head on a ceiling', () => {
    const ceiling = boxFromCenterSize([0, 2.25, 0], [10, 0.5, 10]); // bottom at 2.0
    const p = make();
    run(p, 0.2, {}, [ground, ceiling]);
    p.update(DT, { ...NO_INPUT, jumpPressed: true, jumpHeld: true }, 0, [ground, ceiling]);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      p.update(DT, { ...NO_INPUT, jumpHeld: true }, 0, [ground, ceiling]);
      max = Math.max(max, p.pos[1] + p.height);
    }
    expect(max).toBeLessThanOrEqual(2.0 + 1e-3);
  });
});

describe('chase camera controls', () => {
  const chase = (over: Partial<PlayerSettings> = {}) => make([0, 0, 0], { cameraMode: 'chase', ...over });

  it('W walks along where the player faces and ignores the camera angle', () => {
    const p = chase();
    run(p, 1, { moveY: 1 }, [ground], 2.1); // camYaw is meaningless here
    expect(p.pos[2]).toBeGreaterThan(3); // facing 0 => +z
    expect(Math.abs(p.pos[0])).toBeLessThan(1e-6);
    expect(p.facing).toBeCloseTo(0);
  });

  it('A / D turn the player on the spot at the steering speed', () => {
    const p = chase({ steerSpeed: 90 });
    run(p, 1, { moveX: 1 }); // right
    expect(p.facing).toBeCloseTo(-Math.PI / 2, 2);
    expect(Math.hypot(p.pos[0], p.pos[2])).toBeLessThan(1e-6);
    run(p, 2, { moveX: -1 }); // left, back past the start
    expect(p.facing).toBeCloseTo(Math.PI / 2, 2);
  });

  it('walking forward after turning right goes to the right of the original heading', () => {
    const p = chase({ steerSpeed: 90 });
    run(p, 1, { moveX: 1 });
    run(p, 0.5, { moveY: 1 });
    expect(p.pos[0]).toBeLessThan(-1); // facing -90 deg => -x
  });

  it('S walks backwards, slower, without turning around', () => {
    const fwd = chase();
    run(fwd, 1, { moveY: 1 });
    const back = chase();
    run(back, 1, { moveY: -1 });
    expect(back.pos[2]).toBeLessThan(-1);
    expect(Math.abs(back.pos[2])).toBeLessThan(Math.abs(fwd.pos[2]));
    expect(back.facing).toBeCloseTo(0);
  });

  it('turnRight (mouse) rotates the player and wraps the angle', () => {
    const p = chase();
    p.turnRight(0.5);
    expect(p.facing).toBeCloseTo(-0.5);
    p.turnRight(Math.PI * 2 + 0.25);
    expect(p.facing).toBeCloseTo(-0.75);
    expect(Math.abs(p.facing)).toBeLessThanOrEqual(Math.PI);
  });

  it('the free camera still turns the player toward the walking direction', () => {
    const p = make([0, 0, 0], { cameraMode: 'free' });
    run(p, 0.5, { moveX: 1 }, [ground], 0); // right of camYaw 0 is +x
    expect(p.facing).toBeCloseTo(Math.PI / 2, 2);
  });
});


describe('older projects', () => {
  it('turn the double jump and the chase camera on, and drop the old air jump count', async () => {
    const { normalizeProject } = await import('../src/core/types');
    const old = { player: { ...defaultPlayer(), airJumps: 0, cameraMode: undefined, doubleJump: undefined } };
    const p = normalizeProject(old).player;
    expect(p.doubleJump).toBe(true);
    expect(p.cameraMode).toBe('chase');
    expect('airJumps' in p).toBe(false);
    expect(normalizeProject({ player: { doubleJump: false, cameraMode: 'free' } }).player).toMatchObject({
      doubleJump: false,
      cameraMode: 'free',
    });
    expect(normalizeProject({ player: { cameraMode: 'sideways' } }).player.cameraMode).toBe('chase');
  });
});
