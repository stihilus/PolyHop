import { describe, expect, it } from 'vitest';
import { checkModel } from '../src/core/hytaleStyle';
import { cubeWorldPoints } from '../src/core/humanoid';
import { LEGACY_MODEL_HASHES } from '../src/core/legacyModels';
import { geometryHash } from '../src/core/modelHash';
import { ITEM_MODEL_IDS, type ItemKind, createItemModel } from '../src/core/items';
import { PROJECT_VERSION, builtInModelById, createDefaultProject, newId, normalizeProject } from '../src/core/types';
import legacy from './fixtures/model-bounds-before-hytale.json';

const project = createDefaultProject();
// every model that is built in: the ones in a new project and the pickups, which come with their game objects
const builtIn = [...project.models, ...(Object.keys(ITEM_MODEL_IDS) as ItemKind[]).map((k) => createItemModel(k, newId))];

describe('the built-in models follow the Hytale modeling guide', () => {
  it('there are the two humanoids, the Slime and the Villager, and the five pickups', () => {
    expect(project.models.map((m) => m.id)).toEqual(['humanoid', 'humanoid-female', 'prop-slime', 'prop-villager']);
    expect(builtIn.map((m) => m.id).slice(4)).toEqual(Object.values(ITEM_MODEL_IDS));
    for (const m of builtIn) expect(builtInModelById(m.id)?.id, m.id).toBe(m.id);
  });

  it('every one is made of cubes and quads only', () => {
    for (const m of builtIn) {
      const r = checkModel(m);
      expect(r.problems, `${m.id}: ${r.problems.map((p) => `${p.cube} ${p.message}`).join('; ')}`).toEqual([]);
    }
  });

  it('none is thinner than a pixel of a prop, and none is heavier than a character may be', () => {
    for (const m of builtIn) {
      const r = checkModel(m);
      expect(r.warnings, m.id).toEqual([]);
      expect(r.tier, `${m.id}: ${r.triangles} triangles`).toBeLessThanOrEqual(3);
    }
  });

  it('the pickups and the small characters are cheap', () => {
    for (const m of builtIn) {
      if (m.id.startsWith('prop-') || m.id.startsWith('item-')) {
        const r = checkModel(m);
        expect(r.triangles, m.id).toBeLessThanOrEqual(m.id === 'prop-villager' ? 400 : 250);
      }
    }
  });

  it('keeps the size every model had, so levels built with them still fit', () => {
    const before = legacy as Record<string, number[]>;
    for (const m of builtIn) {
      const old = before[m.id];
      if (!old) continue;
      const pts = m.cubes.flatMap((c) => cubeWorldPoints(c));
      const size = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]!)) - Math.min(...pts.map((p) => p[i]!)));
      for (let i = 0; i < 3; i++) {
        const was = old[i + 3]! - old[i]!;
        if (was < 0.15) continue; // a thin sheet may get a little thicker
        expect(size[i]! / was, `${m.id} axis ${i}`).toBeGreaterThan(0.6);
        expect(size[i]! / was, `${m.id} axis ${i}`).toBeLessThan(1.7);
      }
      // it still stands where it stood
      const low = Math.min(...pts.map((p) => p[1]));
      expect(Math.abs(low - old[1]!), `${m.id} feet`).toBeLessThan(0.2);
    }
  });

  it('survives saving and loading as it is', () => {
    const back = normalizeProject(JSON.parse(JSON.stringify(project)));
    expect(back.models.map((m) => m.id)).toEqual(project.models.map((m) => m.id));
    for (const m of back.models) expect(checkModel(m).problems, m.id).toEqual([]);
  });
});

describe('older projects get the redrawn models', () => {
  const id = 'prop-slime';
  const fresh = () => JSON.parse(JSON.stringify(project.models.find((m) => m.id === id)!)) as (typeof project.models)[number];

  it('swaps a copy that is still the old built-in one, and keeps the name the user gave it', () => {
    // the old slime: the same cubes, one of them somewhere else
    const old = fresh();
    old.cubes[0]!.position = [0, 0.3, 0.3];
    old.name = 'My slime';
    const saved = LEGACY_MODEL_HASHES[id];
    LEGACY_MODEL_HASHES[id] = geometryHash(old);
    try {
      const p = normalizeProject({ version: 13, player: { modelId: null }, models: [old] });
      const got = p.models.find((m) => m.id === id)!;
      expect(got.cubes[0]!.position).toEqual([0, 0.1, 0]);
      expect(got.name).toBe('My slime');
    } finally {
      LEGACY_MODEL_HASHES[id] = saved!;
    }
  });

  it('leaves a copy the user changed, one that is already redrawn, and a project of the current version', () => {
    const edited = fresh();
    edited.cubes[0]!.position = [0, 0.3, 0.3];
    // not the old built-in one (its fingerprint is not the old one): left alone
    const p = normalizeProject({ version: 13, player: { modelId: null }, models: [edited] });
    expect(p.models.find((m) => m.id === id)!.cubes[0]!.position).toEqual([0, 0.3, 0.3]);
    // the current one is the current one
    const same = normalizeProject({ version: 13, player: { modelId: null }, models: [fresh()] });
    expect(geometryHash(same.models.find((m) => m.id === id)!)).toBe(geometryHash(fresh()));
    // a project of this version is not touched at all
    const now = normalizeProject({ version: PROJECT_VERSION, player: { modelId: null }, models: [edited] });
    expect(now.models.find((m) => m.id === id)!.cubes[0]!.position).toEqual([0, 0.3, 0.3]);
  });

  it('knows the fingerprint of every model that was redrawn, and of no model that is not built in', () => {
    for (const id of Object.keys(LEGACY_MODEL_HASHES)) {
      expect(builtIn.some((m) => m.id === id), id).toBe(true);
    }
    // the slime was drawn differently once: its fingerprint is not the one it has now
    const now = geometryHash(project.models.find((m) => m.id === 'prop-slime')!);
    expect(LEGACY_MODEL_HASHES['prop-slime']).not.toBe(now);
  });
});
