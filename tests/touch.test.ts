import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '../src/core/types';
import { Input } from '../src/runtime/input';
import { TouchState, stickVector } from '../src/runtime/touch';

describe('touch stick', () => {
  it('is still inside the dead zone and full at the radius', () => {
    expect(stickVector(0, 0, 50)).toEqual({ x: 0, y: 0 });
    expect(stickVector(3, 3, 50)).toEqual({ x: 0, y: 0 });
    const full = stickVector(50, 0, 50);
    expect(full.x).toBeCloseTo(1, 5);
    expect(full.y).toBeCloseTo(0, 5);
    // beyond the radius it stays at length 1
    const far = stickVector(300, 400, 50);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(1, 5);
  });

  it('grows smoothly between the dead zone and the radius', () => {
    const a = stickVector(15, 0, 50).x;
    const b = stickVector(30, 0, 50).x;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });
});

describe('touch state', () => {
  it('dragging the move stick up is forward, to the right is right', () => {
    const t = new TouchState();
    t.down(1, 100, 300, 'move');
    t.move(1, 100, 240); // 60 px up
    let s = t.sample();
    expect(s.moveY).toBeGreaterThan(0.9);
    expect(Math.abs(s.moveX)).toBeLessThan(0.01);
    t.move(1, 160, 300);
    s = t.sample();
    expect(s.moveX).toBeGreaterThan(0.9);
    expect(Math.abs(s.moveY)).toBeLessThan(0.01);
    t.up(1);
    expect(t.sample().moveX).toBe(0);
    expect(t.stick()).toBeNull();
  });

  it('looking collects the pixels once and then starts again from zero', () => {
    const t = new TouchState();
    t.lookScale = 2;
    t.down(7, 500, 200, 'look');
    t.move(7, 510, 195);
    t.move(7, 530, 195);
    const s = t.sample();
    expect(s.lookX).toBe(60);
    expect(s.lookY).toBe(-10);
    expect(t.sample().lookX).toBe(0);
  });

  it('buttons are held while a finger is on them, and fingers do not mix', () => {
    const t = new TouchState();
    t.down(1, 0, 0, 'move');
    t.down(2, 0, 0, 'jump');
    t.down(3, 0, 0, 'run');
    let s = t.sample();
    expect(s.jump && s.run).toBe(true);
    expect(s.crouch || s.interact).toBe(false);
    t.up(2);
    s = t.sample();
    expect(s.jump).toBe(false);
    expect(s.run).toBe(true);
    t.release();
    s = t.sample();
    expect(s.run).toBe(false);
  });

  it('a new finger on the stick takes it over', () => {
    const t = new TouchState();
    t.down(1, 100, 100, 'move');
    t.down(2, 300, 100, 'move');
    t.move(2, 300, 40);
    expect(t.sample().moveY).toBeGreaterThan(0.9);
    t.up(1); // the old finger is gone already
    expect(t.sample().moveY).toBeGreaterThan(0.9);
  });
});

describe('touch in the input', () => {
  const settings = { ...createDefaultProject().settings, gamepad: false };
  const input = () => new Input({} as HTMLElement);

  it('moves, looks and holds buttons like the keyboard does', () => {
    const i = input();
    const t = new TouchState();
    i.touch = t;
    t.down(1, 100, 300, 'move');
    t.move(1, 100, 240);
    t.down(2, 0, 0, 'run');
    t.down(3, 600, 100, 'look');
    t.move(3, 620, 100);
    const f = i.poll(settings, 0.016);
    expect(f.moveY).toBeGreaterThan(0.9);
    expect(f.run).toBe(true);
    expect(f.lookX).toBeGreaterThan(0);
  });

  it('a jump press is one edge, not one every frame', () => {
    const i = input();
    const t = new TouchState();
    i.touch = t;
    t.down(1, 0, 0, 'jump');
    const first = i.poll(settings, 0.016);
    expect(first.jumpPressed).toBe(true);
    expect(first.jumpHeld).toBe(true);
    const second = i.poll(settings, 0.016);
    expect(second.jumpPressed).toBe(false);
    expect(second.jumpHeld).toBe(true);
    t.up(1);
    t.down(2, 0, 0, 'jump');
    expect(i.poll(settings, 0.016).jumpPressed).toBe(true);
  });

  it('a tap that is over before the next frame is still a jump', () => {
    const i = input();
    const t = new TouchState();
    i.touch = t;
    t.down(1, 0, 0, 'jump');
    t.up(1);
    const f = i.poll(settings, 0.016);
    expect(f.jumpPressed).toBe(true);
    expect(f.jumpHeld).toBe(true);
    expect(i.poll(settings, 0.016).jumpHeld).toBe(false);
  });

  it('interact is an edge too, and the diagonal stays within unit length', () => {
    const i = input();
    const t = new TouchState();
    i.touch = t;
    t.down(1, 0, 0, 'interact');
    expect(i.poll(settings, 0.016).interactPressed).toBe(true);
    expect(i.poll(settings, 0.016).interactPressed).toBe(false);
    t.down(2, 100, 300, 'move');
    t.move(2, 160, 240);
    const f = i.poll(settings, 0.016);
    expect(Math.hypot(f.moveX, f.moveY)).toBeLessThanOrEqual(1.0001);
  });

  it('without touch the input is unchanged', () => {
    const f = input().poll(settings, 0.016);
    expect(f.moveX).toBe(0);
    expect(f.moveY).toBe(0);
    expect(f.jumpPressed).toBe(false);
  });
});
