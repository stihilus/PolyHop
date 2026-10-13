import { describe, expect, it } from 'vitest';
import { boxMesh, isValidMesh } from '../src/core/mesh';
import {
  PROPS_ATLAS,
  PROP_KINDS,
  PROP_TILE_NAMES,
  RETIRED_PROP_IDS,
  builtInPropModels,
  createPropModel,
  propModelId,
  propTilePos,
} from '../src/core/props';
import { createBlock, createDefaultProject, createModel, createModelInstance, normalizeModel, normalizeProject } from '../src/core/types';

let n = 0;
const ids = () => `q${++n}`;

const ATLAS_W = 256;
const ATLAS_H = 80;

describe('built-in props', () => {
  it('there is a good number of them, with unique ids and names', () => {
    const models = builtInPropModels(ids);
    expect(models.length).toBeGreaterThanOrEqual(40);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
    expect(new Set(models.map((m) => m.name)).size).toBe(models.length);
    expect(models.every((m) => m.id.startsWith('prop-'))).toBe(true);
  });

  it('every prop is a valid model on the props atlas, with all UVs inside it', () => {
    for (const kind of PROP_KINDS) {
      const m = createPropModel(kind, ids);
      expect(m.texture).toBe(PROPS_ATLAS);
      expect(m.cubes.length).toBeGreaterThan(0);
      for (const c of m.cubes) {
        expect(isValidMesh(c.mesh), `${kind} / ${c.name}`).toBe(true);
        for (const f of c.mesh.faces) {
          for (const [u, v] of f.uv) {
            expect(u, `${kind} u`).toBeGreaterThanOrEqual(0);
            expect(u, `${kind} u`).toBeLessThanOrEqual(ATLAS_W);
            expect(v, `${kind} v`).toBeGreaterThanOrEqual(0);
            expect(v, `${kind} v`).toBeLessThanOrEqual(ATLAS_H);
          }
        }
      }
    }
  });

  it('bones, cube bones and animation tracks belong together', () => {
    for (const kind of PROP_KINDS) {
      const m = createPropModel(kind, ids);
      const boneIds = new Set(m.bones.map((b) => b.id));
      const boneNames = new Set(m.bones.map((b) => b.name));
      expect(boneNames.size, `${kind}: bone names are unique`).toBe(m.bones.length);
      for (const c of m.cubes) if (c.bone) expect(boneIds.has(c.bone), `${kind}: ${c.name}`).toBe(true);
      for (const clip of m.clips) {
        expect(clip.duration).toBeGreaterThan(0);
        for (const bone of Object.keys(clip.tracks)) expect(boneNames.has(bone), `${kind}: track ${bone}`).toBe(true);
      }
    }
  });

  it('survives the same cleaning a saved model goes through', () => {
    for (const kind of PROP_KINDS) {
      const m = createPropModel(kind, ids);
      const back = normalizeModel(JSON.parse(JSON.stringify(m)));
      expect(back.cubes).toHaveLength(m.cubes.length);
      expect(back.bones).toHaveLength(m.bones.length);
      expect(back.clips).toHaveLength(m.clips.length);
    }
  });

  it('the animated ones have what they promise', () => {
    const chest = createPropModel('chest', ids);
    expect(chest.clips.map((c) => c.name)).toEqual(['open', 'close']);
    expect(chest.bones.map((b) => b.name)).toEqual(['Base', 'Lid']);
    expect(createPropModel('torch', ids).clips.map((c) => c.name)).toEqual(['flicker']);
    expect(createPropModel('campfire', ids).clips.map((c) => c.name)).toEqual(['flicker']);
    expect(createPropModel('banner', ids).clips.map((c) => c.name)).toEqual(['sway']);
    expect(createPropModel('ruby', ids).clips.map((c) => c.name)).toEqual(['spin']);
  });

  it('the tile list matches the atlas: 80 tiles, 16 to a row', () => {
    expect(PROP_TILE_NAMES).toHaveLength((ATLAS_W / 16) * (ATLAS_H / 16));
    expect(propTilePos('bark')).toEqual({ col: 0, row: 0 });
    expect(propTilePos('stone')).toEqual({ col: 0, row: 1 });
    expect(propTilePos('chest_front')).toEqual({ col: 0, row: 2 });
    expect(propTilePos('poppy')).toEqual({ col: 0, row: 4 });
  });
});

describe('what is not in the set', () => {
  it('has no trees and no blocks made of plain cubes', () => {
    const names = builtInPropModels(ids).map((m) => m.name.toLowerCase());
    for (const word of ['oak', 'pine tree', 'birch', 'ore', 'obsidian', 'gold block', 'lava block']) {
      expect(names.some((n) => n.includes(word)), word).toBe(false);
    }
    for (const id of RETIRED_PROP_IDS) expect(PROP_KINDS.map(propModelId)).not.toContain(id);
    expect(RETIRED_PROP_IDS).toHaveLength(13);
  });

  it('keeps the atlas tiles, so they can still be painted on shapes', () => {
    expect(PROP_TILE_NAMES).toContain('iron_ore');
    expect(PROP_TILE_NAMES).toContain('leaves');
  });
});

describe('props in projects', () => {
  it('a new project has all of them in its Models', () => {
    const p = createDefaultProject();
    for (const kind of PROP_KINDS) expect(p.models.some((m) => m.id === propModelId(kind))).toBe(true);
  });

  it('an older project gets them once and keeps what it deleted afterwards', () => {
    const old = normalizeProject({ version: 5, models: [] });
    for (const kind of PROP_KINDS) expect(old.models.some((m) => m.id === propModelId(kind))).toBe(true);
    // saved again at the current version: a deleted prop is not brought back
    const pruned = JSON.parse(JSON.stringify(old));
    pruned.models = pruned.models.filter((m: { id: string }) => m.id !== propModelId('chest'));
    const back = normalizeProject(pruned);
    expect(back.models.some((m) => m.id === propModelId('chest'))).toBe(false);
    expect(back.models.some((m) => m.id === propModelId('barrel'))).toBe(true);
  });

  it('an older project loses the retired props it does not use, and keeps the ones it placed', () => {
    const tree = createModel('Oak tree', null);
    tree.id = 'prop-oak-tree';
    const ore = createModel('Gold ore', null);
    ore.id = 'prop-gold-ore';
    const mine = createModel('My own model', null);
    const placed = createModelInstance(ore, [0, 0, 0]);
    const raw = {
      version: 6,
      models: [tree, ore, mine],
      levels: [{ name: 'A', objects: [placed, createBlock('Floor', [0, 0, 0], boxMesh([1, 1, 1]), null)] }],
    };
    const p = normalizeProject(JSON.parse(JSON.stringify(raw)));
    const ids = p.models.map((m) => m.id);
    expect(ids).not.toContain('prop-oak-tree'); // not used: gone
    expect(ids).toContain('prop-gold-ore'); // placed in the level: stays
    expect(ids).toContain(mine.id);
    // a project already at the current version is left alone
    const current = normalizeProject({ version: 7, models: [tree], levels: [{ name: 'A', objects: [] }] });
    expect(current.models.map((m) => m.id)).toContain('prop-oak-tree');
  });

  it('edited props are not overwritten by the migration', () => {
    const old = normalizeProject({ version: 5, models: [] });
    old.models.find((m) => m.id === propModelId('crate'))!.name = 'My crate';
    old.version = 5; // pretend it was saved before the props existed
    const again = normalizeProject(JSON.parse(JSON.stringify(old)));
    expect(again.models.filter((m) => m.id === propModelId('crate'))).toHaveLength(1);
    expect(again.models.find((m) => m.id === propModelId('crate'))!.name).toBe('My crate');
  });
});
