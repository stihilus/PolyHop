import * as THREE from 'three';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAMEPAD_HELP, PAD, Repeater, STICK_DEADZONE } from '../src/core/gamepad';
import { boxMesh } from '../src/core/mesh';
import { SOUND_IDS } from '../src/core/sounds';
import { type LevelBlock, createBlock, createDefaultProject, createLevelData, newId } from '../src/core/types';
import { Game } from '../src/runtime/game';
import { PadReader } from '../src/runtime/gamepad';
import { Input } from '../src/runtime/input';
import { TextureLibrary } from '../src/runtime/textures';

/** A controller with the standard layout, whose buttons and sticks the tests move. */
const fake = {
  connected: true,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};
const hold = (...buttons: number[]) => {
  fake.buttons.forEach((b, i) => {
    b.pressed = buttons.includes(i);
    b.value = b.pressed ? 1 : 0;
  });
};
const stick = (lx: number, ly: number, rx = 0, ry = 0) => {
  fake.axes = [lx, ly, rx, ry];
};
let present = true;

beforeAll(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
  vi.stubGlobal('navigator', { getGamepads: () => (present ? [fake] : []) });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  present = true;
  hold();
  stick(0, 0);
});

describe('the buttons of the pad, as they are listed', () => {
  it('has a line for every action a game has, in words', () => {
    const actions = GAMEPAD_HELP.map((h) => h.action.toLowerCase());
    for (const word of ['move', 'look', 'jump', 'run', 'crouch', 'interact', 'pause']) {
      expect(actions.some((a) => a.includes(word)), word).toBe(true);
    }
    for (const h of GAMEPAD_HELP) expect(h.buttons.length).toBeGreaterThan(0);
  });
});

describe('stepping through a menu with a held direction', () => {
  it('steps at once, waits, then repeats while it is held', () => {
    const r = new Repeater(0.4, 0.1);
    expect(r.step(1, 0.016)).toBe(1);
    expect(r.step(1, 0.2)).toBe(0);
    expect(r.step(1, 0.2)).toBe(1); // 0.4 s held
    expect(r.step(1, 0.05)).toBe(0);
    expect(r.step(1, 0.06)).toBe(1); // every 0.1 s after
    // letting go starts over
    expect(r.step(0, 0.016)).toBe(0);
    expect(r.step(-1, 0.016)).toBe(-1);
  });
});

describe('reading the pad', () => {
  it('sees a button go down once, and the D-pad and the stick step through a menu', () => {
    const pad = new PadReader();
    pad.poll(0.016);
    expect(pad.connected).toBe(true);
    expect(pad.pressed(PAD.cross)).toBe(false);
    hold(PAD.cross);
    pad.poll(0.016);
    expect(pad.pressed(PAD.cross)).toBe(true);
    expect(pad.active).toBe(true);
    pad.poll(0.016);
    expect(pad.pressed(PAD.cross)).toBe(false);
    expect(pad.down(PAD.cross)).toBe(true);
    hold(PAD.down);
    pad.poll(0.016);
    expect(pad.navY).toBe(1);
    pad.poll(0.016);
    expect(pad.navY).toBe(0);
    hold();
    stick(0, -0.9);
    pad.poll(0.016);
    expect(pad.navY).toBe(-1);
  });

  it('takes the dead zone out of a stick and sees a trigger by how far it is pressed', () => {
    const pad = new PadReader();
    stick(STICK_DEADZONE * 0.9, 0);
    pad.poll(0.016);
    expect(pad.stick(0, 1)).toEqual([0, 0]);
    stick(1, 0);
    pad.poll(0.016);
    expect(pad.stick(0, 1)[0]).toBeCloseTo(1, 5);
    stick(0, 0);
    fake.buttons[PAD.r2]!.value = 0.8;
    pad.poll(0.016);
    expect(pad.down(PAD.r2)).toBe(true);
    fake.buttons[PAD.r2]!.value = 0.1;
    pad.poll(0.016);
    expect(pad.down(PAD.r2)).toBe(false);
  });

  it('is not connected without a pad', () => {
    const pad = new PadReader();
    present = false;
    pad.poll(0.016);
    expect(pad.connected).toBe(false);
    expect(pad.active).toBe(false);
  });
});

describe('the pad in the game', () => {
  const settings = createDefaultProject().settings;
  const canvas = {} as unknown as HTMLElement;

  it('walks with the left stick and the D-pad, looks with the right stick', () => {
    const input = new Input(canvas);
    stick(0, -1);
    let f = input.poll(settings, 0.016);
    expect(f.moveY).toBeGreaterThan(0.9); // stick up = forward
    stick(0, 0);
    hold(PAD.right);
    f = input.poll(settings, 0.016);
    expect(f.moveX).toBe(1);
    hold();
    stick(0, 0, 1, 0);
    f = input.poll(settings, 0.1);
    expect(f.lookX).toBeGreaterThan(10);
  });

  it('jumps on Cross (once), runs on Square or R2, ducks on Circle, uses things on Triangle', () => {
    const input = new Input(canvas);
    hold(PAD.cross);
    let f = input.poll(settings, 0.016);
    expect(f.jumpPressed && f.jumpHeld).toBe(true);
    f = input.poll(settings, 0.016);
    expect(f.jumpPressed).toBe(false);
    expect(f.jumpHeld).toBe(true);
    hold(PAD.square);
    expect(input.poll(settings, 0.016).run).toBe(true);
    hold(PAD.r2);
    expect(input.poll(settings, 0.016).run).toBe(true);
    hold(PAD.circle);
    expect(input.poll(settings, 0.016).crouch).toBe(true);
    hold(PAD.triangle);
    expect(input.poll(settings, 0.016).interactPressed).toBe(true);
    expect(input.padActive).toBe(true);
  });

  it('ignores the pad when the project turns it off', () => {
    const input = new Input(canvas);
    hold(PAD.cross);
    stick(1, 0);
    const f = input.poll({ ...settings, gamepad: false }, 0.016);
    expect(f.jumpPressed).toBe(false);
    expect(f.moveX).toBe(0);
  });

  function questionGame(): Game {
    const npc: LevelBlock = createBlock('Npc', [0, 0.9, 3], boxMesh([0.6, 1.8, 0.6]), null);
    npc.collide = false;
    npc.rules = [
      {
        id: newId(),
        event: 'start',
        conditions: [],
        actions: [
          {
            type: 'choice',
            speaker: 'Ana',
            question: 'Pick one',
            speed: 0,
            options: [
              { label: 'First', actions: [{ type: 'sound', sound: SOUND_IDS.coin }] },
              { label: 'Second', actions: [{ type: 'sound', sound: SOUND_IDS.door }] },
              { label: 'Third', actions: [{ type: 'sound', sound: SOUND_IDS.hit }] },
            ],
          },
        ],
      },
    ];
    const floor = createBlock('Ground', [0, -0.5, 0], boxMesh([100, 1, 100]), null);
    const p = createDefaultProject();
    p.player.modelId = null;
    p.player.cameraMode = 'free';
    p.settings.music = null;
    p.player.soundJump = p.player.soundDoubleJump = p.player.soundLand = null;
    p.levels = [createLevelData('A', [floor, npc], [0, 0.05, 0], 0)];
    const c = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
    const g = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), c, new TextureLibrary(), p);
    g.startPlay(0);
    return g;
  }
  const frames = (g: Game, n: number) => {
    for (let i = 0; i < n; i++) g.update(1 / 60);
  };

  it('answers a question with the D-pad and Cross', () => {
    const g = questionGame();
    const play = vi.spyOn(g.audio, 'play');
    expect(g.isTalking).toBe(true);
    frames(g, 30);
    // down, down, up: the second answer is marked
    for (const button of [PAD.down, PAD.down, PAD.up]) {
      hold(button);
      frames(g, 1);
      hold();
      frames(g, 3);
    }
    expect(g.isTalking).toBe(true);
    hold(PAD.cross);
    frames(g, 1);
    hold();
    frames(g, 2);
    expect(g.isTalking).toBe(false);
    expect(play.mock.calls.map((c) => c[0])).toContain(SOUND_IDS.door);
    expect(play.mock.calls.map((c) => c[0])).not.toContain(SOUND_IDS.coin);
  });

  it('picks the first answer when Cross is pressed at once, and the marker wraps round', () => {
    const g = questionGame();
    const play = vi.spyOn(g.audio, 'play');
    frames(g, 30);
    hold(PAD.up);
    frames(g, 1);
    hold();
    frames(g, 3);
    hold(PAD.cross);
    frames(g, 1);
    hold();
    frames(g, 2);
    // up from the first goes to the last
    expect(play.mock.calls.map((c) => c[0])).toContain(SOUND_IDS.hit);
  });
});
