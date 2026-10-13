import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type Action,
  type Rule,
  VariableStore,
  normalizeRules,
  renameVariableInRules,
  runActions,
  runRules,
  variablesUsed,
} from '../src/core/logic';
import { boxMesh } from '../src/core/mesh';
import { PRESETS, presetRules, presetSounds, presetVariables } from '../src/core/presets';
import { builtInPrefab } from '../src/core/prefabs';
import { propModelId } from '../src/core/props';
import {
  type LevelBlock,
  type PlayerSettings,
  type Project,
  createBlock,
  createDefaultProject,
  createLevelData,
  defaultPlayer,
  ensurePresetAssets,
  newId,
  normalizeProject,
} from '../src/core/types';
import { Game } from '../src/runtime/game';
import { chooseAnimation } from '../src/runtime/avatar';
import { boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController } from '../src/runtime/player';
import { TextureLibrary } from '../src/runtime/textures';

const ids = () => newId();
const variable = (name: string, initial = 0) => ({ id: ids(), name, initial, min: null, max: null, hud: false, icon: '', label: '' });
const rule = (event: Rule['event'], actions: Action[], extra: Partial<Rule> = {}): Rule => ({ id: ids(), event, conditions: [], actions, ...extra });

describe('new actions as data', () => {
  it('normalizes chase, hurt, bounce, dialogue and choice', () => {
    const [r] = normalizeRules(
      [
        {
          event: 'start',
          actions: [
            { type: 'chase', speed: 500, range: -3 },
            { type: 'hurt' },
            { type: 'bounce', strength: 1 },
            { type: 'dialogue', speaker: 'Ana', lines: [] },
            {
              type: 'choice',
              question: 'Well?',
              options: [
                { label: 'Yes', actions: [{ type: 'add', variable: 'coins', value: 2 }, { type: 'choice' }] },
                { label: '', actions: [] },
                1,
                { label: 'c' },
                { label: 'd' },
                { label: 'e' },
              ],
            },
          ],
        },
      ],
      ids,
    );
    const a = r!.actions;
    expect(a[0]).toEqual({ type: 'chase', target: '', speed: 20, range: 1 });
    expect(a[1]).toEqual({ type: 'hurt', amount: 1, variable: 'health', knockback: 6 });
    expect(a[2]).toEqual({ type: 'bounce', strength: 2 });
    expect(a[3]).toEqual({ type: 'dialogue', speaker: 'Ana', lines: ['...'] });
    const choice = a[4]!;
    expect(choice.type === 'choice' && choice.options).toHaveLength(4);
    // a question inside an answer is dropped
    expect(choice.type === 'choice' && choice.options[0]!.actions).toEqual([{ type: 'add', variable: 'coins', value: 2 }]);
    expect(choice.type === 'choice' && choice.options[1]!.label).toBe('Answer');
  });

  it('texts show variables; answers keep their actions until picked', () => {
    const s = new VariableStore([variable('coins', 4)]);
    const fx = runActions(
      [
        { type: 'dialogue', speaker: 'Shop', lines: ['You have {coins}.', 'Bye'] },
        { type: 'choice', question: 'Buy for {coins}?', options: [{ label: 'Yes ({coins})', actions: [{ type: 'add', variable: 'coins', value: -3 }] }] },
      ],
      s,
    );
    expect(fx[0]).toEqual({ type: 'dialogue', speaker: 'Shop', lines: ['You have 4.', 'Bye'] });
    const ch = fx[1]!;
    expect(ch.type === 'choice' && ch.question).toBe('Buy for 4?');
    expect(ch.type === 'choice' && ch.options[0]!.label).toBe('Yes (4)');
    // nothing happened to the variables yet
    expect(s.get('coins')).toBe(4);
    if (ch.type === 'choice') runActions(ch.options[0]!.actions, s);
    expect(s.get('coins')).toBe(1);
  });

  it('renaming and usage reach hurt and the answers', () => {
    const r = rule('touch', [
      { type: 'hurt', amount: 1, variable: 'hp', knockback: 5 },
      { type: 'dialogue', speaker: '{hp}', lines: ['hp {hp}'] },
      { type: 'choice', question: '{hp}?', options: [{ label: '{hp}', actions: [{ type: 'add', variable: 'hp', value: 1 }] }] },
    ]);
    expect([...variablesUsed([r])].sort()).toEqual(['hp']);
    expect(renameVariableInRules([r], 'hp', 'life')).toBe(5);
    expect([...variablesUsed([r])]).toEqual(['life']);
    const d = r.actions[1]!;
    expect(d.type === 'dialogue' && d.lines).toEqual(['hp {life}']);
  });
});

describe('the enemy and the villager presets', () => {
  it('the enemy chases, can be stomped, hurts and ends the game at 0 health', () => {
    const rules = presetRules('enemy', ids);
    expect(rules.map((r) => r.event)).toEqual(['start', 'stomp', 'touch', 'when']);
    expect(rules[0]!.actions[0]!.type).toBe('chase');
    const s = new VariableStore([variable('health', 3)]);
    const touch = runRules(rules, 'touch', s).map((e) => e.type);
    expect(touch).toEqual(['hurt', 'sound']);
    const stomp = runRules(rules, 'stomp', s).map((e) => e.type);
    expect(stomp).toEqual(['sound', 'bounce', 'destroy']);
    s.set('health', 0);
    expect(runRules(rules, 'when', s).map((e) => e.type)).toEqual(['message', 'restart']);
    expect(presetVariables('enemy').map((v) => v.name)).toEqual(['health']);
    expect(presetSounds('enemy')).toHaveLength(2);
  });

  it('both are assets whose models come with them', () => {
    expect(PRESETS.map((p) => p.kind)).toContain('enemy');
    const enemy = builtInPrefab('enemy', ids).object;
    expect(enemy.kind === 'model' && enemy.modelId).toBe(propModelId('slime'));
    expect(enemy.kind === 'model' && enemy.animation).toBe('hop');
    const npc = builtInPrefab('npc', ids).object;
    expect(npc.kind === 'model' && npc.modelId).toBe(propModelId('villager'));
    expect(npc.collide).toBe(true);
    const p = normalizeProject({ version: 9, models: [] });
    expect(ensurePresetAssets(p, 'enemy')).toBe(propModelId('slime'));
    expect(p.models.some((m) => m.id === propModelId('slime'))).toBe(true);
    expect(ensurePresetAssets(p, 'enemy')).toBe(propModelId('slime'));
    expect(p.models.filter((m) => m.id === propModelId('slime'))).toHaveLength(1);
  });

  it('older projects get the characters and the glide pose once', () => {
    const old = normalizeProject({ version: 8, models: [] });
    expect(old.models.some((m) => m.id === propModelId('slime'))).toBe(true);
    expect(old.models.some((m) => m.id === propModelId('villager'))).toBe(true);
    const human = old.models.find((m) => m.id === 'humanoid')!;
    expect(human.clips.map((c) => c.name)).toContain('glide');
  });
});

describe('gliding', () => {
  const ground = boxFromCenterSize([0, -0.5, 0], [200, 1, 200]);
  const make = (over: Partial<PlayerSettings> = {}) => {
    const p = new PlayerController({ ...defaultPlayer(), cameraMode: 'free', ...over }, [0, 80, 0], 0);
    p.reset();
    return p;
  };
  const step = (p: PlayerController, seconds: number, jumpHeld: boolean) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) p.update(1 / 120, { ...NO_INPUT, jumpHeld }, 0, [ground], []);
  };

  it('does nothing unless it is switched on', () => {
    const p = make();
    step(p, 0.3, false); // let go in the air
    step(p, 0.6, true);
    expect(p.gliding).toBe(false);
    expect(p.vel[1]).toBeLessThan(-8);
  });

  it('slows the fall when jump is held after having been let go', () => {
    const p = make({ glide: true, glideFall: 1.5 });
    step(p, 0.3, false);
    step(p, 0.8, true);
    expect(p.gliding).toBe(true);
    expect(p.vel[1]).toBeCloseTo(-1.5, 1);
    // letting go drops it again
    step(p, 0.5, false);
    expect(p.gliding).toBe(false);
    expect(p.vel[1]).toBeLessThan(-5);
  });

  it('holding jump from the very start of a fall does not glide until released once', () => {
    const p = make({ glide: true });
    step(p, 0.5, true);
    expect(p.gliding).toBe(false);
    step(p, 0.1, false);
    step(p, 0.3, true);
    expect(p.gliding).toBe(true);
  });

  it('shows the glide pose, falling back to the fall pose without it', () => {
    const base = { walkSpeed: 4, runSpeed: 7, crouchSpeed: 2 };
    expect(chooseAnimation({ grounded: false, crouching: false, speed: 2, vy: -1, gliding: true }, base).clip).toBe('glide');
    expect(chooseAnimation({ grounded: false, crouching: false, speed: 2, vy: -1 }, base).clip).toBe('fall');
  });

  it('a bounce throws the player up and gives back the double jump', () => {
    const p = make({ doubleJump: true });
    step(p, 0.1, false);
    p.launch(11);
    expect(p.vel[1]).toBe(11);
    expect(p.grounded).toBe(false);
  });
});

// ---------------------------------------------------------------- the running game

beforeAll(() => {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
  vi.stubGlobal('navigator', { getGamepads: () => [] });
});
afterAll(() => vi.unstubAllGlobals());

function block(name: string, pos: [number, number, number], size: [number, number, number], rules: Rule[] = [], collide = true): LevelBlock {
  const b = createBlock(name, pos, boxMesh(size), null);
  b.rules = rules;
  b.collide = collide;
  return b;
}

function bare(objects: LevelBlock[], vars = [variable('health', 3)]): Project {
  const p = createDefaultProject();
  p.player.modelId = null;
  p.player.cameraMode = 'free';
  p.sounds = [];
  p.settings.music = null;
  p.player.soundJump = p.player.soundDoubleJump = p.player.soundLand = null;
  p.variables = vars;
  p.levels = [createLevelData('A', objects, [0, 0.05, 0], 0)];
  return p;
}

function start(project: Project): Game {
  const canvas = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
  const game = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, new TextureLibrary(), project);
  game.startPlay(0);
  return game;
}
const run = (game: Game, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60);
};
const ground = () => block('Ground', [0, -0.5, 0], [100, 1, 100]);

describe('Game: enemies, damage and conversations', () => {
  it('a chaser walks toward the player along the ground and stops when close', () => {
    const slime = block('Slime', [8, 0.4, 0], [0.8, 0.8, 0.8], [rule('start', [{ type: 'chase', target: '', speed: 3, range: 20 }])], false);
    const game = start(bare([ground(), slime]));
    run(game, 1);
    const mesh = game.level.getMesh(slime.id)!;
    expect(mesh.position.x).toBeLessThan(6);
    expect(mesh.position.x).toBeGreaterThan(4);
    // its own y stays on the ground
    expect(mesh.position.y).toBeCloseTo(0.4, 1);
    run(game, 4);
    expect(mesh.position.x).toBeLessThan(1.5);
    expect(mesh.position.x).toBeGreaterThan(0.3);
    // the project's own object did not move
    expect(slime.position[0]).toBe(8);
  });

  it('a chaser does not move when the player is out of range', () => {
    const slime = block('Slime', [30, 0.4, 0], [0.8, 0.8, 0.8], [rule('start', [{ type: 'chase', target: '', speed: 3, range: 10 }])], false);
    const game = start(bare([ground(), slime]));
    run(game, 1);
    expect(game.level.getMesh(slime.id)!.position.x).toBeCloseTo(30, 1);
  });

  it('a chaser falls off a ledge and carries on at the lower level', () => {
    const ledge = block('Ledge', [4, 1.5, 0], [4, 1, 4], []);
    const slime = block('Slime', [4, 2.4, 0], [0.8, 0.8, 0.8], [rule('start', [{ type: 'chase', target: '', speed: 2, range: 30 }])], false);
    const project = bare([ground(), ledge, slime]);
    project.levels[0]!.spawn = [-8, 0.05, 0];
    const game = start(project);
    run(game, 4);
    expect(game.level.getMesh(slime.id)!.position.y).toBeLessThan(1.0);
  });

  it('hurt takes health, flings the player and gives a moment of peace', () => {
    const spikes = block('Spikes', [0, 0.3, 2], [2, 0.6, 1], [rule('touch', [{ type: 'hurt', amount: 1, variable: 'health', knockback: 6 }])], false);
    const game = start(bare([ground(), spikes]));
    game.controller.pos = [0, 0, 1.6];
    run(game, 0.2);
    expect(game.logic.store.get('health')).toBe(2);
    // pushed away from the spikes (toward -z) and up
    expect(game.controller.vel[2]).toBeLessThan(0);
    // standing in them again right away does not hurt twice
    game.controller.pos = [0, 0, 1.6];
    run(game, 0.3);
    expect(game.logic.store.get('health')).toBe(2);
    // after the moment of peace it does
    run(game, 1.4);
    game.controller.pos = [0, 0, 5];
    run(game, 0.1);
    game.controller.pos = [0, 0, 1.6];
    run(game, 0.2);
    expect(game.logic.store.get('health')).toBe(1);
  });

  it('landing on top triggers the stomp rules and not the touch rules', () => {
    const slime = block(
      'Slime',
      [0, 0.4, 3],
      [1, 0.8, 1],
      [rule('stomp', [{ type: 'add', variable: 'health', value: 10 }, { type: 'destroy' }]), rule('touch', [{ type: 'add', variable: 'health', value: -1 }])],
      false,
    );
    const stompGame = start(bare([ground(), slime]));
    stompGame.controller.pos = [0, 1.3, 3];
    stompGame.controller.vel = [0, -6, 0];
    run(stompGame, 0.4);
    expect(stompGame.logic.store.get('health')).toBe(13);
    expect(stompGame.level.getMesh(slime.id)).toBeUndefined();

    // walking into the side is a plain touch
    const sideGame = start(bare([ground(), { ...slime, id: newId(), rules: slime.rules.map((r) => ({ ...r })) } as LevelBlock]));
    sideGame.controller.pos = [0, 0, 2.0];
    sideGame.controller.vel = [0, 0, 5];
    run(sideGame, 0.5);
    expect(sideGame.logic.store.get('health')).toBe(2);
  });

  it('a conversation holds the game and reads line by line', () => {
    const npc = block('Npc', [0, 0.9, 3], [0.6, 1.8, 0.6], [rule('start', [{ type: 'dialogue', speaker: 'Ana', lines: ['One', 'Two'] }])], false);
    const game = start(bare([ground(), npc]));
    expect(game.isTalking).toBe(true);
    const frozen = game.controller.pos.map((n) => +n.toFixed(3));
    run(game, 0.5);
    expect(game.controller.pos.map((n) => +n.toFixed(3))).toEqual(frozen);
    // the first line has been typed by now: a press reads on, and the next line types itself
    game.advanceTalk();
    expect(game.isTalking).toBe(true);
    expect(game.isTyping).toBe(true);
    // a press while it types shows it at once, the next one closes the conversation
    game.advanceTalk();
    expect(game.isTyping).toBe(false);
    expect(game.isTalking).toBe(true);
    game.advanceTalk();
    expect(game.isTalking).toBe(false);
  });

  it('the answer picked runs its own actions', () => {
    const npc = block(
      'Npc',
      [0, 0.9, 3],
      [0.6, 1.8, 0.6],
      [
        rule('start', [
          {
            type: 'choice',
            question: 'Deal?',
            options: [
              { label: 'Yes', actions: [{ type: 'add', variable: 'health', value: 5 }] },
              { label: 'No', actions: [{ type: 'add', variable: 'health', value: -2 }] },
            ],
          },
        ]),
      ],
      false,
    );
    const game = start(bare([ground(), npc]));
    expect(game.isTalking).toBe(true);
    expect(game.logic.store.get('health')).toBe(3);
    game.chooseAnswer(1);
    expect(game.isTalking).toBe(false);
    expect(game.logic.store.get('health')).toBe(1);
  });
});
