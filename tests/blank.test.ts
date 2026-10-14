import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkModel } from '../src/core/hytaleStyle';
import { HUMANOID_FEMALE_ID, HUMANOID_ID } from '../src/core/humanoid';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { PRESETS } from '../src/core/presets';
import { propModelId } from '../src/core/props';
import { SOUND_IDS } from '../src/core/sounds';
import { PROJECT_VERSION, builtInModelById, createDefaultProject, ensurePresetAssets, normalizeProject } from '../src/core/types';
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

  it('has in its Models only what the game objects are made of: the humanoids, the pickups, the Slime and the Villager', () => {
    expect(p.models.map((m) => m.id)).toEqual([
      HUMANOID_ID,
      HUMANOID_FEMALE_ID,
      ITEM_MODEL_IDS.coin,
      ITEM_MODEL_IDS.key,
      ITEM_MODEL_IDS.apple,
      ITEM_MODEL_IDS.flag,
      ITEM_MODEL_IDS.trophy,
      propModelId('slime'),
      propModelId('villager'),
    ]);
    expect(p.player.modelId).toBe(HUMANOID_ID);
    // no furniture, no plants, no building kit
    for (const m of p.models) expect(m.id.startsWith('kit-') || m.id.startsWith('demo-') || m.id === propModelId('chest')).toBe(false);
  });

  it('every game object made of a model has that model in Models', () => {
    const have = new Set(p.models.map((m) => m.id));
    const used = p.prefabs.flatMap((x) => (x.object.kind === 'model' ? [x.object.modelId] : []));
    expect(used).toHaveLength(7);
    for (const id of used) expect(have.has(id), id).toBe(true);
  });

  it('every game object is made of cubes: a box block, or a model built of cubes', () => {
    for (const prefab of p.prefabs) {
      const o = prefab.object;
      if (o.kind === 'block') {
        expect(o.mesh.faces.length, prefab.name).toBe(6);
        expect(o.mesh.verts.length, prefab.name).toBe(8);
      } else {
        const model = p.models.find((m) => m.id === o.modelId)!;
        expect(model.cubes.length, prefab.name).toBeGreaterThan(0);
        expect(checkModel(model).problems, prefab.name).toEqual([]);
      }
    }
  });

  it('keeps every sound, the main theme included, and plays the theme', () => {
    const ids = p.sounds.map((s) => s.id);
    for (const id of Object.values(SOUND_IDS)) expect(ids, id).toContain(id);
    expect(p.settings.music).toBe(SOUND_IDS.theme);
  });

  it('has the 13 game objects ready', () => {
    expect(p.prefabs).toHaveLength(13);
    expect(p.prefabs.map((x) => x.base).sort()).toEqual(PRESETS.map((x) => x.kind).sort());
  });

  it('a game object brings its variables and its model when it is placed, if the model was deleted', () => {
    for (const { kind } of PRESETS) {
      const copy = createDefaultProject();
      copy.models = copy.models.filter((m) => !m.id.startsWith('item-') && !m.id.startsWith('prop-'));
      const modelId = ensurePresetAssets(copy, kind);
      if (modelId) expect(copy.models.some((m) => m.id === modelId), kind).toBe(true);
    }
    const coin = createDefaultProject();
    coin.models = coin.models.filter((m) => m.id !== ITEM_MODEL_IDS.coin);
    expect(ensurePresetAssets(coin, 'coin')).toBe(ITEM_MODEL_IDS.coin);
    expect(coin.models.some((m) => m.id === ITEM_MODEL_IDS.coin)).toBe(true);
    expect(coin.variables.map((v) => v.name)).toEqual(['coins']);
    // placing the same one again does not add it twice
    ensurePresetAssets(coin, 'coin');
    expect(coin.models.filter((m) => m.id === ITEM_MODEL_IDS.coin)).toHaveLength(1);
  });

  it('can picture the model of every game object from its id (for the Assets list)', () => {
    for (const prefab of p.prefabs) {
      if (prefab.object.kind !== 'model') continue;
      const model = builtInModelById(prefab.object.modelId);
      expect(model, prefab.name).not.toBeNull();
      expect(model!.id).toBe(prefab.object.modelId);
    }
    expect(builtInModelById('kit-house')).toBeNull();
    expect(builtInModelById('nope')).toBeNull();
  });

  it('survives saving and loading as it is', () => {
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.models.map((m) => m.id)).toEqual(p.models.map((m) => m.id));
    expect(back.levels[0]!.objects.map((o) => o.name)).toEqual(['Ground']);
    expect(back.prefabs).toHaveLength(13);
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
