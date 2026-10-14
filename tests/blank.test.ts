import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkModel } from '../src/core/hytaleStyle';
import { HUMANOID_FEMALE_ID, HUMANOID_ID } from '../src/core/humanoid';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { PRESET_MODEL_ID, isTiled, modelDefaults } from '../src/core/components';
import { PRESETS } from '../src/core/presets';
import { propModelId } from '../src/core/props';
import { SOUND_IDS } from '../src/core/sounds';
import { PROJECT_VERSION, builtInModelById, createDefaultProject, ensurePresetAssets, ensurePresetSupport, normalizeProject } from '../src/core/types';
import { Game } from '../src/runtime/game';
import { TextureLibrary } from '../src/runtime/textures';

describe('a new project is blank', () => {
  const p = createDefaultProject();

  it('is one level with a flat ground and nothing on it', () => {
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.settings.name).toBe('My Game');
    expect(p.levels).toHaveLength(1);
    expect(p.levels[0]!.objects.map((o) => o.name)).toEqual(['Ground']);
    expect(p.levels[0]!.spawn).toEqual([0, 0.05, 0]);
    expect(p.variables).toEqual([]);
    expect(p.textures).toEqual([]);
  });

  it('has in its Models the characters and the 13 game objects, all of them components', () => {
    expect(p.models.map((m) => m.id)).toEqual([HUMANOID_ID, HUMANOID_FEMALE_ID, ...PRESETS.map((x) => PRESET_MODEL_ID[x.kind])]);
    expect(p.models.every((m) => m.component === true)).toBe(true);
    expect(p.player.modelId).toBe(HUMANOID_ID);
    // no furniture, no plants, no building kit
    for (const m of p.models) expect(m.id.startsWith('kit-') || m.id.startsWith('demo-') || m.id === propModelId('chest')).toBe(false);
    // the pickups and the two characters of the old default are still there under their ids
    for (const id of Object.values(ITEM_MODEL_IDS)) expect(p.models.some((m) => m.id === id), id).toBe(true);
    for (const kind of ['slime', 'villager']) expect(p.models.some((m) => m.id === propModelId(kind)), kind).toBe(true);
  });

  it('every game object is a component of cubes that does something by default', () => {
    for (const { kind, label } of PRESETS) {
      const m = p.models.find((x) => x.id === PRESET_MODEL_ID[kind])!;
      expect(m, kind).toBeTruthy();
      expect(m.name, kind).toBe(label);
      expect(m.cubes.length, kind).toBeGreaterThan(0);
      expect(checkModel(m).problems, kind).toEqual([]);
      // water has no rules; everything else reacts to something
      if (kind !== 'water') expect(modelDefaults(m).rules.length, kind).toBeGreaterThan(0);
    }
    // the block-like ones are tile-mapped: a surface that repeats
    for (const kind of ['door', 'hazard', 'exit', 'platform', 'sign', 'water'] as const) {
      expect(isTiled(p.models.find((x) => x.id === PRESET_MODEL_ID[kind])!), kind).toBe(true);
    }
  });

  it('keeps every sound, the main theme included, and plays the theme', () => {
    const ids = p.sounds.map((s) => s.id);
    for (const id of Object.values(SOUND_IDS)) expect(ids, id).toContain(id);
    expect(p.settings.music).toBe(SOUND_IDS.theme);
  });

  it('has no separate list of game objects any more: they are components of Models', () => {
    expect((p as unknown as { prefabs?: unknown }).prefabs).toBeUndefined();
  });

  it('a game object brings its variables, its sounds and its model when it is placed, if the model was deleted', () => {
    for (const { kind } of PRESETS) {
      const copy = createDefaultProject();
      copy.models = copy.models.filter((m) => m.id !== PRESET_MODEL_ID[kind]);
      expect(ensurePresetAssets(copy, kind)).toBe(PRESET_MODEL_ID[kind]);
      expect(copy.models.some((m) => m.id === PRESET_MODEL_ID[kind]), kind).toBe(true);
    }
    const coin = createDefaultProject();
    coin.models = coin.models.filter((m) => m.id !== ITEM_MODEL_IDS.coin);
    expect(ensurePresetAssets(coin, 'coin')).toBe(ITEM_MODEL_IDS.coin);
    expect(coin.variables.map((v) => v.name)).toEqual(['coins']);
    // placing the same one again does not add it twice
    ensurePresetAssets(coin, 'coin');
    expect(coin.models.filter((m) => m.id === ITEM_MODEL_IDS.coin)).toHaveLength(1);
    // the variables and sounds alone, when the model is not wanted
    const door = createDefaultProject();
    ensurePresetSupport(door, 'door');
    expect(door.variables.map((v) => v.name)).toEqual(['keys']);
  });

  it('can make every built-in model again from its id (to put it back)', () => {
    for (const { kind } of PRESETS) {
      const model = builtInModelById(PRESET_MODEL_ID[kind]);
      expect(model, kind).not.toBeNull();
      expect(model!.id).toBe(PRESET_MODEL_ID[kind]);
      expect(model!.component).toBe(true);
    }
    expect(builtInModelById('kit-house')).toBeNull();
    expect(builtInModelById('nope')).toBeNull();
  });

  it('survives saving and loading as it is', () => {
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.models.map((m) => m.id)).toEqual(p.models.map((m) => m.id));
    expect(back.levels[0]!.objects.map((o) => o.name)).toEqual(['Ground']);
    expect(back.models.map((m) => m.component === true)).toEqual(p.models.map((m) => m.component === true));
    expect(back.variables).toEqual([]);
  });

  it('an empty file opens as the blank project too', () => {
    expect(normalizeProject(null).levels[0]!.objects.map((o) => o.name)).toEqual(['Ground']);
    // and a file from the first versions gets the same models as a new project, not the props that used to be added
    expect(normalizeProject({}).models.map((m) => m.id).sort()).toEqual(p.models.map((m) => m.id).sort());
  });
});

describe('older projects', () => {
  it('a project saved before the pickups were in Models gets them once', () => {
    const old = normalizeProject({ version: 14, models: [], levels: [{ name: 'A', objects: [] }] });
    for (const id of Object.values(ITEM_MODEL_IDS)) expect(old.models.some((m) => m.id === id), id).toBe(true);
    // saved at the current version, a deleted pickup stays deleted
    const pruned = JSON.parse(JSON.stringify(old));
    pruned.models = pruned.models.filter((m: { id: string }) => m.id !== ITEM_MODEL_IDS.coin);
    const back = normalizeProject(pruned);
    expect(back.models.some((m) => m.id === ITEM_MODEL_IDS.coin)).toBe(false);
    expect(back.models.some((m) => m.id === ITEM_MODEL_IDS.key)).toBe(true);
  });

  it('an exported game keeps only what it uses', () => {
    const game = normalizeProject({ version: 14, exported: true, models: [], levels: [{ name: 'A', objects: [] }] });
    expect(game.models.some((m) => m.id.startsWith('item-'))).toBe(false);
  });
});

describe('playing the blank project', () => {
  beforeAll(() => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('document', { pointerLockElement: null, exitPointerLock() {} });
    vi.stubGlobal('navigator', { getGamepads: () => [] });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('the player stands on the ground and does not fall', () => {
    const project = createDefaultProject();
    const canvas = { parentElement: null, addEventListener() {}, removeEventListener() {} } as unknown as HTMLElement;
    const game = new Game(new THREE.Scene(), new THREE.PerspectiveCamera(), canvas, new TextureLibrary(), project);
    game.startPlay(0);
    for (let i = 0; i < 120; i++) game.update(1 / 60);
    expect(game.controller.grounded).toBe(true);
    expect(Math.abs(game.controller.pos[1])).toBeLessThan(0.3);
  });
});
