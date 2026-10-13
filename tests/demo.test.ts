import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RUIN_ROUTE, createBlankProject, createDemoProject, type RuinStop } from '../src/core/demo';
import { type Action, type Rule, normalizeRules, variablesUsed } from '../src/core/logic';
import { SOUND_IDS } from '../src/core/sounds';
import { HUMANOID_FEMALE_ID, HUMANOID_ID } from '../src/core/humanoid';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { builtInModelById, createLevelData, defaultPlayer, ensurePresetAssets, normalizeProject } from '../src/core/types';
import { Game, levelFloor } from '../src/runtime/game';
import { boxFromCenterSize } from '../src/runtime/physics';
import { NO_INPUT, PlayerController, type PlayerInput } from '../src/runtime/player';
import { TextureLibrary } from '../src/runtime/textures';

const demo = createDemoProject();

/** Every action of a rule list, answers of questions included. */
function allActions(rules: Rule[]): Action[] {
  const out: Action[] = [];
  const visit = (list: Action[]) => {
    for (const a of list) {
      out.push(a);
      if (a.type === 'choice') for (const o of a.options) visit(o.actions);
    }
  };
  for (const r of rules) visit(r.actions);
  return out;
}

describe('the blank project', () => {
  it('is one empty level with a floor, the game objects and their variables, and no models but the two characters', () => {
    const p = createBlankProject();
    expect(p.levels).toHaveLength(1);
    expect(p.levels[0]!.objects.map((o) => o.name)).toEqual(['Ground']);
    expect(p.settings.name).toBe('My Game');
    // the game objects are all there, with the variables they count in
    expect(p.prefabs).toHaveLength(13);
    expect(p.variables.map((v) => v.name).sort()).toEqual(['coins', 'health', 'keys']);
    // the Models list is the two characters only
    expect(p.models.map((m) => m.id)).toEqual([HUMANOID_ID, HUMANOID_FEMALE_ID]);
    expect(p.player.modelId).toBe(HUMANOID_ID);
  });

  it('a game object brings its model when it is placed, and has a picture to show before that', () => {
    const p = createBlankProject();
    expect(p.models.some((m) => m.id === ITEM_MODEL_IDS.coin)).toBe(false);
    expect(ensurePresetAssets(p, 'coin')).toBe(ITEM_MODEL_IDS.coin);
    expect(p.models.some((m) => m.id === ITEM_MODEL_IDS.coin)).toBe(true);
    // every model a game object uses can be made again from its id (for the picture in the Assets list)
    const blank = createBlankProject();
    for (const prefab of blank.prefabs) {
      if (prefab.object.kind !== 'model') continue;
      const model = builtInModelById(prefab.object.modelId);
      expect(model, prefab.name).not.toBeNull();
      expect(model!.id).toBe(prefab.object.modelId);
    }
    expect(builtInModelById('nope')).toBeNull();
  });

  it('survives saving and loading as it is', () => {
    const p = createBlankProject();
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.models.map((m) => m.id)).toEqual([HUMANOID_ID, HUMANOID_FEMALE_ID]);
    expect(back.prefabs).toHaveLength(13);
  });
});

describe('the demo project', () => {
  it('has two levels, a hero skin, a splash screen and a calm theme', () => {
    expect(demo.settings.name).toBe('Mossy Hills');
    expect(demo.levels.map((l) => l.name)).toEqual(['Meadow', 'Sky Ruins']);
    expect(demo.player.skin).toBe('Character-Explorer.png');
    expect(demo.player.glide).toBe(true);
    expect(demo.settings.splash?.image.startsWith('data:image/png;base64,')).toBe(true);
    expect(demo.settings.music).toBe(SOUND_IDS.theme);
    // each level has a sky of its own
    expect(demo.levels[0]!.look.skyStyle).toBe('clouds');
    expect(demo.levels[1]!.look.skyStyle).toBe('clouds');
    expect(demo.levels[0]!.sky).not.toBe(demo.levels[1]!.sky);
  });

  it('survives saving and loading', () => {
    const back = normalizeProject(JSON.parse(JSON.stringify(demo)));
    expect(back.levels.map((l) => l.objects.length)).toEqual(demo.levels.map((l) => l.objects.length));
    expect(back.settings.splash?.image).toBe(demo.settings.splash?.image);
    expect(back.levels[0]!.objects.find((o) => o.kind === 'block' && o.terrain)).toBeTruthy();
    // the rules (talk with answers included) are kept as they are
    const npc = back.levels[0]!.objects.find((o) => o.name === 'Old Moss')!;
    expect(normalizeRules(JSON.parse(JSON.stringify(npc.rules)), () => 'x').map((r) => r.actions.map((a) => a.type))).toEqual(
      npc.rules.map((r) => r.actions.map((a) => a.type)),
    );
  });

  it('only uses what the project has: models, textures, sounds and variables', () => {
    const models = new Set(demo.models.map((m) => m.id));
    const textureFiles = new Set(Object.keys(import.meta.glob('/assets/textures/*.png', { query: '?url' })).map((path) => path.split('/').pop()!));
    const sounds = new Set(demo.sounds.map((s) => s.id));
    const vars = new Set(demo.variables.map((v) => v.name));
    const needTextures = new Set<string>();
    for (const m of demo.models) if (m.texture) needTextures.add(m.texture);
    if (demo.player.skin) needTextures.add(demo.player.skin);
    for (const level of demo.levels) {
      for (const o of level.objects) {
        if (o.kind === 'model') expect(models.has(o.modelId), `${o.name} uses ${o.modelId}`).toBe(true);
        else {
          if (o.tile) needTextures.add(o.tile.texture);
          for (const f of o.mesh.faces) if (f.tile) needTextures.add(f.tile.texture);
        }
        for (const a of allActions(o.rules)) {
          if (a.type === 'sound') expect(sounds.has(a.sound), `${o.name} plays ${a.sound}`).toBe(true);
          if ((a.type === 'dialogue' || a.type === 'choice') && a.voice) expect(sounds.has(a.voice)).toBe(true);
        }
        for (const name of variablesUsed(o.rules)) expect(vars.has(name), `${o.name} uses ${name}`).toBe(true);
      }
    }
    for (const t of needTextures) expect(textureFiles.has(t), `texture ${t}`).toBe(true);
  });

  it('has a way through: a gate that needs three stars and three stars to find, then a key and a door', () => {
    const meadow = demo.levels[0]!.objects;
    expect(meadow.filter((o) => o.name.startsWith('Star crystal'))).toHaveLength(3);
    const gate = meadow.find((o) => o.name === 'Old gate')!;
    const open = gate.rules.find((r) => r.event === 'when')!;
    expect(open.conditions).toEqual([{ variable: 'stars', op: '>=', value: 3 }]);
    expect(meadow.find((o) => o.name === 'Portal')!.rules[0]!.actions.some((a) => a.type === 'level')).toBe(true);
    const ruins = demo.levels[1]!.objects;
    expect(ruins.find((o) => o.name === 'Temple key')).toBeTruthy();
    expect(ruins.find((o) => o.name === 'Temple door')).toBeTruthy();
    const trophy = ruins.find((o) => o.name === 'Trophy')!;
    expect(trophy.rules.some((r) => r.actions.some((a) => a.type === 'end'))).toBe(true);
  });

  it('shows what the editor offers: enemies, a villager with a question, moving platforms, a spring, spikes, water, terrain', () => {
    const used = new Set<string>();
    const names = new Set<string>();
    for (const level of demo.levels) {
      for (const o of level.objects) {
        names.add(o.name);
        if (o.kind === 'block' && o.terrain) used.add('terrain');
        if (o.kind === 'block' && o.liquid) used.add('water');
        for (const a of allActions(o.rules)) used.add(a.type);
        for (const r of o.rules) used.add(`event:${r.event}`);
      }
    }
    for (const t of ['terrain', 'water', 'chase', 'hurt', 'bounce', 'patrol', 'choice', 'dialogue', 'checkpoint', 'level', 'end', 'move', 'destroy', 'sound', 'message']) {
      expect(used.has(t), t).toBe(true);
    }
    for (const e of ['touch', 'start', 'interact', 'stomp', 'when']) expect(used.has(`event:${e}`), e).toBe(true);
    for (const n of ['Old Moss', 'Slime', 'Spring mushroom', 'Spikes', 'Lily platform', 'Moving platform', 'Checkpoint', 'Temple key']) expect(names.has(n), n).toBe(true);
  });
});

describe('level 2 can be played', () => {
  const DT = 1 / 120;

  /** A box standing in for a stop of the route (the top is what the player lands on). */
  const boxOf = (s: RuinStop, dz = 0) => boxFromCenterSize([s.x, s.top - 0.5, s.z + dz], [s.radius * 2, 1, s.radius * 2]);

  /**
   * Try to get from one stop to the next the way a person would: walk or run at it and jump from the edge, with or
   * without a second jump. Returns true when the player ends up standing on the next one.
   */
  function canJump(a: RuinStop, b: RuinStop, aDz = 0, bDz = 0): boolean {
    const dx = b.x - a.x;
    const dz = b.z + bDz - (a.z + aDz);
    const len = Math.hypot(dx, dz);
    const dir = [dx / len, dz / len];
    for (const run of [false, true]) {
      for (const second of [false, true]) {
        for (const early of [0.5, 1.0]) {
          const settings = { ...defaultPlayer(), cameraMode: 'free' as const };
          // start inside the edge that faces the next stop
          const start: [number, number, number] = [a.x + dir[0]! * (a.radius - 0.5), a.top, a.z + aDz + dir[1]! * (a.radius - 0.5)];
          const p = new PlayerController(settings, start, 0);
          p.reset();
          const boxes = [boxOf(a, aDz), boxOf(b, bDz)];
          const move = { moveX: dir[0]!, moveY: -dir[1]!, run };
          let jumped = false;
          let secondDone = false;
          for (let t = 0; t < 4; t += DT) {
            const edge = Math.hypot(p.pos[0] - a.x, p.pos[2] - (a.z + aDz));
            const input: Partial<PlayerInput> = { ...move, jumpHeld: p.vel[1] > 0 };
            if (!jumped && edge >= a.radius - 0.15) {
              input.jumpPressed = true;
              input.jumpHeld = true;
              jumped = true;
            } else if (jumped && second && !secondDone && p.vel[1] < -early) {
              input.jumpPressed = true;
              input.jumpHeld = true;
              secondDone = true;
            }
            p.update(DT, { ...NO_INPUT, ...input }, 0, boxes);
            if (jumped && p.grounded && t > 0.3) {
              const onB = Math.hypot(p.pos[0] - b.x, p.pos[2] - (b.z + bDz)) < b.radius * 1.1 && Math.abs(p.pos[1] - b.top) < 0.15;
              if (onB) return true;
              break;
            }
          }
        }
      }
    }
    return false;
  }

  it('every jump of the route is possible with a run and a double jump', () => {
    // the one big gap is for gliding: it is checked on its own
    const glidePair = ['High ledge', 'Temple island'];
    const failures: string[] = [];
    for (let i = 0; i < RUIN_ROUTE.length - 1; i++) {
      const a = RUIN_ROUTE[i]!;
      const b = RUIN_ROUTE[i + 1]!;
      if (glidePair.includes(a.name) && glidePair.includes(b.name)) continue;
      // the bounce mushroom throws the player from Island 2 to the High ledge
      if (a.name === 'Island 2' && b.name === 'High ledge') continue;
      // a moving platform: both ends count
      const aEnds = a.moves ? [0, a.moves] : [0];
      const bEnds = b.moves ? [0, b.moves] : [0];
      const ok = aEnds.some((ad) => bEnds.some((bd) => canJump(a, b, ad, bd)));
      if (!ok) failures.push(`${a.name} -> ${b.name}`);
    }
    expect(failures).toEqual([]);
  });

  it('the high ledge is out of reach for a jump, so gliding (and the bounce) are really needed', () => {
    const ledge = RUIN_ROUTE.find((r) => r.name === 'High ledge')!;
    const temple = RUIN_ROUTE.find((r) => r.name === 'Temple island')!;
    const gap = Math.hypot(ledge.x - temple.x, ledge.z - temple.z) - ledge.radius - temple.radius;
    // the farthest a run and a double jump goes is about 7.7 m, with a drop of a few meters
    expect(gap).toBeGreaterThan(8);
    expect(demo.player.glide).toBe(true);
    const isl2 = RUIN_ROUTE.find((r) => r.name === 'Island 2')!;
    // more than a double jump can climb (3.2 m) without the spring
    expect(ledge.top - isl2.top).toBeGreaterThan(3.2);
  });

  it('the spring mushroom stands on the island, near the edge that faces the high ledge', () => {
    const level = demo.levels[1]!.objects;
    const mushroom = level.find((o) => o.name === 'Spring mushroom')!;
    const isl = RUIN_ROUTE.find((r) => r.name === 'Island 2')!;
    const ledge = RUIN_ROUTE.find((r) => r.name === 'High ledge')!;
    expect(Math.hypot(mushroom.position[0] - isl.x, mushroom.position[2] - isl.z)).toBeLessThan(isl.radius - 0.5);
    expect(mushroom.position[1]).toBeCloseTo(isl.top, 1);
    // within reach of a bounce (about 5 m at a run) from the mushroom to the near edge of the ledge
    const toLedge = mushroom.position[2] - (ledge.z + ledge.radius);
    expect(toLedge).toBeGreaterThan(2);
    expect(toLedge).toBeLessThan(7);
    // the throw is high enough: v^2 / 2g is more than the climb
    const bounce = allActions(mushroom.rules).find((a) => a.type === 'bounce');
    expect(bounce && bounce.type === 'bounce' ? (bounce.strength * bounce.strength) / (2 * defaultPlayer().gravity) : 0).toBeGreaterThan(ledge.top - isl.top);
  });

  it('every star and coin of the meadow is above the ground and not buried', () => {
    const level = demo.levels[0]!.objects;
    const terrain = level.find((o) => o.kind === 'block' && o.terrain)!;
    expect(terrain.kind).toBe('block');
    for (const o of level) {
      if (o.kind !== 'model') continue;
      if (!/^Star crystal|^Coin$/.test(o.name)) continue;
      expect(Number.isFinite(o.position[1])).toBe(true);
      expect(o.position[1]).toBeGreaterThan(-3);
    }
  });

  it('a fall puts the player back at the checkpoint instead of falling for ever', () => {
    const level = demo.levels[1]!;
    expect(levelFloor(level.objects)).toBeLessThan(-5);
  });
});

describe('the demo runs in the game', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
    vi.stubGlobal('navigator', { getGamepads: () => [] });
  });
  afterAll(() => vi.unstubAllGlobals());

  const start = () => {
    const project = createDemoProject();
    const canvas = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
    const game = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, new TextureLibrary(), project);
    game.startPlay(0);
    return { game, project };
  };
  const run = (game: Game, seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) game.update(1 / 60);
  };

  it('starts on the ground of the meadow with nothing collected', () => {
    const { game, project } = start();
    run(game, 1);
    const spawn = project.levels[0]!.spawn;
    expect(game.controller.grounded).toBe(true);
    expect(Math.abs(game.controller.pos[1] - spawn[1])).toBeLessThan(0.6);
    expect(game.logic.store.get('stars')).toBe(0);
    expect(game.logic.store.get('health')).toBe(3);
  });

  it('the old gate opens with three stars and the portal leads to the ruins', () => {
    const { game, project } = start();
    run(game, 0.5);
    const gate = project.levels[0]!.objects.find((o) => o.name === 'Old gate')!;
    const before = gate.position[1];
    game.logic.store.set('stars', 3);
    run(game, 3.5);
    const moved = game.level.getMesh(gate.id)!.position.y;
    expect(moved).toBeGreaterThan(before + 3);
    // walk into the portal
    const portal = project.levels[0]!.objects.find((o) => o.name === 'Portal')!;
    game.controller.pos = [portal.position[0], portal.position[1] - 1.4, portal.position[2] + 0.2];
    game.controller.vel = [0, 0, 0];
    run(game, 0.5);
    expect(game.currentLevelIndex).toBe(1);
  });

  it('level 2 starts on its island, and falling off comes back to the start', () => {
    const { game, project } = start();
    run(game, 0.2);
    // jump straight to the second level
    game.startPlay(1);
    run(game, 1);
    const spawn = project.levels[1]!.spawn;
    expect(game.controller.grounded).toBe(true);
    // off the island and far down: the checkpoint (the spawn) takes the player back
    game.controller.pos = [40, spawn[1] - 5, 40];
    run(game, 4);
    expect(Math.hypot(game.controller.pos[0] - spawn[0], game.controller.pos[2] - spawn[2])).toBeLessThan(1);
    expect(game.controller.pos[1]).toBeGreaterThan(spawn[1] - 1);
  });

  it('the temple door needs the key', () => {
    const { game, project } = start();
    game.startPlay(1);
    run(game, 0.5);
    const door = project.levels[1]!.objects.find((o) => o.name === 'Temple door')!;
    // without a key it stays shut
    game.controller.pos = [door.position[0], door.position[1] - 0.8, door.position[2] + 0.5];
    run(game, 1);
    expect(game.level.getMesh(door.id)!.position.y).toBeCloseTo(door.position[1], 1);
    // with a key (the door reacts when the player walks into it)
    game.logic.store.set('keys', 1);
    game.controller.pos = [door.position[0], door.position[1] - 0.8, door.position[2] + 8];
    run(game, 0.5);
    game.controller.pos = [door.position[0], door.position[1] - 0.8, door.position[2] + 0.5];
    game.controller.vel = [0, 0, 0];
    run(game, 3);
    expect(game.level.getMesh(door.id)!.position.y).toBeGreaterThan(door.position[1] + 1);
  });
});

describe('levels need a floor to fall to', () => {
  it('an empty level has a floor of 0', () => {
    expect(levelFloor([])).toBe(0);
    const level = createLevelData('A', []);
    expect(levelFloor(level.objects)).toBe(0);
  });
});
