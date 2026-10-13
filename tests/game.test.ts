import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Action, Rule, RuleEvent } from '../src/core/logic';
import { boxMesh } from '../src/core/mesh';
import {
  type LevelBlock,
  type Project,
  createBlock,
  createDefaultProject,
  createLevelData,
  newId,
} from '../src/core/types';
import { Game } from '../src/runtime/game';
import { TextureLibrary } from '../src/runtime/textures';

beforeAll(() => {
  // the game only needs a few browser objects when no sound, HUD or textures are involved
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
});
afterAll(() => vi.unstubAllGlobals());

const rule = (event: RuleEvent, actions: Action[], extra: Partial<Rule> = {}): Rule => ({ id: newId(), event, conditions: [], actions, ...extra });

function block(name: string, pos: [number, number, number], size: [number, number, number], rules: Rule[] = [], collide = true): LevelBlock {
  const b = createBlock(name, pos, boxMesh(size), null);
  b.rules = rules;
  b.collide = collide;
  return b;
}

/** A bare project: no player model, no sounds, no textures, so it runs without a browser. */
function bare(levels: ReturnType<typeof createLevelData>[]): Project {
  const p = createDefaultProject();
  p.player.modelId = null;
  p.player.cameraMode = 'free';
  p.sounds = [];
  p.settings.music = null;
  p.player.soundJump = p.player.soundDoubleJump = p.player.soundLand = null;
  p.variables = [];
  p.levels = levels;
  return p;
}

function start(project: Project, level = 0): Game {
  const canvas = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
  const game = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, new TextureLibrary(), project);
  game.startPlay(level);
  return game;
}

const run = (game: Game, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60);
};
const ground = () => block('Ground', [0, -0.5, 0], [100, 1, 100]);
const pos = (game: Game) => game.controller.pos.map((n) => +n.toFixed(2));

describe('Game: levels and the end screen', () => {
  it('starts at the spawn of the chosen level and carries on to the next through an exit', () => {
    const exit = block('Exit', [0, 1, 3], [2, 2, 0.5], [rule('touch', [{ type: 'level', level: '' }])], false);
    const l1 = createLevelData('One', [ground(), exit], [0, 0.05, 0], 0);
    const l2 = createLevelData('Two', [ground()], [20, 0.05, -5], 90);
    const game = start(bare([l1, l2]));
    expect(game.currentLevelIndex).toBe(0);
    expect(pos(game)).toEqual([0, 0.05, 0]);
    game.controller.pos = [0, 0, 3];
    run(game, 0.2);
    expect(game.currentLevelIndex).toBe(1);
    expect(game.ended).toBe(false);
    run(game, 0.1);
    expect(pos(game)[0]).toBeCloseTo(20, 0);
  });

  it('carries variables to the next level but not into a new run', () => {
    const exit = block('Exit', [0, 1, 3], [2, 2, 0.5], [rule('touch', [{ type: 'add', variable: 'coins', value: 5 }, { type: 'level', level: '' }])], false);
    const project = bare([createLevelData('One', [ground(), exit], [0, 0.05, 0], 0), createLevelData('Two', [ground()])]);
    project.variables = [{ id: 'v1', name: 'coins', initial: 1, min: null, max: null, hud: false, icon: '', label: '' }];
    const game = start(project);
    expect(game.logic.store.get('coins')).toBe(1);
    game.controller.pos = [0, 0, 3];
    run(game, 0.2);
    expect(game.currentLevelIndex).toBe(1);
    expect(game.logic.store.get('coins')).toBe(6);
    game.restartRun();
    expect(game.currentLevelIndex).toBe(0);
    expect(game.logic.store.get('coins')).toBe(1);
  });

  it('after the last level the game ends; Play again starts over', () => {
    const exit = block('Exit', [0, 1, 3], [2, 2, 0.5], [rule('touch', [{ type: 'level', level: '' }])], false);
    const game = start(bare([createLevelData('Only', [ground(), exit], [0, 0.05, 0], 0)]));
    game.controller.pos = [0, 0, 3];
    run(game, 0.2);
    expect(game.ended).toBe(true);
    // frozen: the player cannot be moved while the end screen is up
    const frozen = pos(game);
    run(game, 0.5);
    expect(pos(game)).toEqual(frozen);
    game.restartRun();
    expect(game.ended).toBe(false);
    expect(pos(game)).toEqual([0, 0.05, 0]);
  });

  it('an end action stops the game with its title', () => {
    const goal = block('Goal', [0, 1, 3], [2, 2, 0.5], [rule('touch', [{ type: 'end', title: 'Done', text: 'x' }])], false);
    const game = start(bare([createLevelData('A', [ground(), goal], [0, 0.05, 0], 0)]));
    game.controller.pos = [0, 0, 3];
    run(game, 0.2);
    expect(game.ended).toBe(true);
  });

  it('a level that sends the player to itself in a start rule does not hang', () => {
    const loop = block('Loop', [50, 1, 50], [1, 1, 1], [rule('start', [{ type: 'restart' }])], false);
    const game = start(bare([createLevelData('A', [ground(), loop])]));
    run(game, 0.1);
    expect(game.playing).toBe(true);
  });

  it('stopping gives the level back as it was edited', () => {
    const door = block('Door', [0, 1, 3], [2, 2, 0.4], [rule('touch', [{ type: 'move', target: '', offset: [0, 5, 0], seconds: 0.2 }])]);
    const coin = block('Coin', [3, 0.5, 0], [0.5, 0.5, 0.5], [rule('touch', [{ type: 'destroy' }])], false);
    const project = bare([createLevelData('A', [ground(), door, coin], [0, 0.05, 0], 0)]);
    const game = start(project);
    game.controller.pos = [3, 0, 0];
    run(game, 0.1);
    game.controller.pos = [0, 0, 2.4];
    run(game, 0.6);
    expect(game.level.getMesh(coin.id)).toBeUndefined();
    expect(game.level.getMesh(door.id)!.position.y).toBeCloseTo(6, 1);
    // the project's own objects were never touched
    expect(door.position[1]).toBe(1);
    game.stopPlay();
    expect(game.level.getMesh(coin.id)).toBeDefined();
    expect(game.level.getMesh(door.id)!.position.y).toBeCloseTo(1);
  });
});

describe('Game: moving objects', () => {
  it('a door that moves takes its collision with it', () => {
    const make = (rules: Rule[]) => {
      const door = block('Door', [0, 1, -2], [4, 2, 0.5], rules);
      return { door, game: start(bare([createLevelData('A', [ground(), door], [0, 0.05, 5], 0)])) };
    };
    // run at the door from in front of it with a big push
    const charge = (game: Game) => {
      game.controller.pos = [0, 0, -1];
      game.controller.vel = [0, 0, -30];
      run(game, 0.5);
      return game.controller.pos[2]!;
    };
    // a door that stays where it is stops the player
    expect(charge(make([]).game)).toBeGreaterThan(-1.7);
    // the same door raised 5 m is no obstacle any more
    const lifted = make([rule('start', [{ type: 'move', target: '', offset: [0, 5, 0], seconds: 0.5 }])]);
    run(lifted.game, 1);
    expect(lifted.game.level.getMesh(lifted.door.id)!.position.y).toBeCloseTo(6, 1);
    expect(charge(lifted.game)).toBeLessThan(-2.5);
  });

  it('a patrolling platform goes back and forth and carries the player', () => {
    const lift = block('Lift', [0, 0.25, 0], [3, 0.5, 3], [rule('start', [{ type: 'patrol', target: '', offset: [6, 0, 0], seconds: 2 }])]);
    const game = start(bare([createLevelData('A', [ground(), lift], [0, 0.5, 0], 0)]));
    // the player starts on the platform
    run(game, 0.3);
    expect(game.controller.grounded).toBe(true);
    const x0 = game.controller.pos[0];
    run(game, 1);
    const platformX = game.level.getMesh(lift.id)!.position.x;
    expect(platformX).toBeGreaterThan(2);
    // the player went along (within the platform's width), and still stands on it
    expect(game.controller.pos[0]).toBeGreaterThan(x0 + 1.5);
    expect(Math.abs(game.controller.pos[0] - platformX)).toBeLessThan(1.6);
    expect(game.controller.pos[1]).toBeCloseTo(0.5, 1);
    // it turns around: after 4 s it is back where it began
    run(game, 3);
    expect(game.level.getMesh(lift.id)!.position.x).toBeLessThan(1);
    // and the project's block did not move
    expect(lift.position[0]).toBe(0);
  });

  it('a rule can start a move on another object', () => {
    const gate = block('Gate', [10, 1, 0], [1, 2, 4], []);
    const button = block('Button', [0, 0.1, 3], [1, 0.2, 1], [rule('touch', [{ type: 'move', target: gate.id, offset: [0, 4, 0], seconds: 0.3 }])], false);
    const game = start(bare([createLevelData('A', [ground(), gate, button], [0, 0.05, 0], 0)]));
    expect(game.level.getMesh(gate.id)!.position.y).toBeCloseTo(1);
    game.controller.pos = [0, 0, 3];
    run(game, 0.6);
    expect(game.level.getMesh(gate.id)!.position.y).toBeCloseTo(5, 1);
  });

  it('a timer rule can remove an object after a while', () => {
    const bridge = block('Bridge', [0, 0.25, 6], [3, 0.5, 3], []);
    const trap = block('Trap', [30, 1, 0], [1, 1, 1], [rule('timer', [{ type: 'destroy', target: bridge.id }], { seconds: 1 })], false);
    const game = start(bare([createLevelData('A', [ground(), bridge, trap], [0, 0.05, 0], 0)]));
    run(game, 0.5);
    expect(game.level.getMesh(bridge.id)).toBeDefined();
    run(game, 1);
    expect(game.level.getMesh(bridge.id)).toBeUndefined();
  });
});
