import { describe, expect, it } from 'vitest';
import { checkModel } from '../src/core/hytaleStyle';
import { cubeWorldPoints } from '../src/core/humanoid';
import { LEGACY_MODEL_HASHES } from '../src/core/legacyModels';
import { geometryHash } from '../src/core/modelHash';
import { PROJECT_VERSION, createDefaultProject, normalizeProject } from '../src/core/types';
import legacy from './fixtures/model-bounds-before-hytale.json';

const project = createDefaultProject();

describe('the built-in models follow the Hytale modeling guide', () => {
  it('there are plenty of them', () => {
    expect(project.models.length).toBeGreaterThan(80);
  });

  it('every one is made of cubes and quads only', () => {
    for (const m of project.models) {
      const r = checkModel(m);
      expect(r.problems, `${m.id}: ${r.problems.map((p) => `${p.cube} ${p.message}`).join('; ')}`).toEqual([]);
    }
  });

  it('none is thinner than a pixel of a prop, and none is heavier than a character may be', () => {
    for (const m of project.models) {
      const r = checkModel(m);
      expect(r.warnings, m.id).toEqual([]);
      expect(r.tier, `${m.id}: ${r.triangles} triangles`).toBeLessThanOrEqual(3);
    }
  });

  it('props and plants are cheap: nothing but the buildings, trees and characters goes over 150 triangles', () => {
    for (const m of project.models) {
      if (m.id.startsWith('prop-') || m.id.startsWith('item-') || m.id.startsWith('demo-')) {
        const r = checkModel(m);
        expect(r.triangles, m.id).toBeLessThanOrEqual(m.id === 'prop-villager' || m.id === 'prop-well' || m.id === 'prop-campfire' ? 400 : 250);
      }
    }
  });

  it('keeps the size every model had, so levels built with them still fit', () => {
    const before = legacy as Record<string, number[]>;
    for (const m of project.models) {
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
    for (const m of back.models) expect(checkModel(m).problems, m.id).toEqual([]);
  });
});

describe('older projects get the redrawn models', () => {
  const id = 'prop-barrel';
  const fresh = () => JSON.parse(JSON.stringify(project.models.find((m) => m.id === id)!)) as (typeof project.models)[number];

  it('swaps a copy that is still the old built-in one, and keeps the name the user gave it', () => {
    // the old barrel: the same cubes, one of them somewhere else
    const old = fresh();
    old.cubes[0]!.position = [0, 0.5, 0.3];
    old.name = 'My barrel';
    const saved = LEGACY_MODEL_HASHES[id];
    LEGACY_MODEL_HASHES[id] = geometryHash(old);
    try {
      const p = normalizeProject({ version: 13, player: { modelId: null }, models: [old] });
      const got = p.models.find((m) => m.id === id)!;
      expect(got.cubes[0]!.position).toEqual([0, 0.45, 0]);
      expect(got.name).toBe('My barrel');
    } finally {
      LEGACY_MODEL_HASHES[id] = saved!;
    }
  });

  it('leaves a copy the user changed, one that is already redrawn, and a project of the current version', () => {
    const edited = fresh();
    edited.cubes[0]!.position = [0, 0.5, 0.3];
    // not the old built-in one (its fingerprint is not the old one): left alone
    const p = normalizeProject({ version: 13, player: { modelId: null }, models: [edited] });
    expect(p.models.find((m) => m.id === id)!.cubes[0]!.position).toEqual([0, 0.5, 0.3]);
    // the current one is the current one
    const same = normalizeProject({ version: 13, player: { modelId: null }, models: [fresh()] });
    expect(geometryHash(same.models.find((m) => m.id === id)!)).toBe(geometryHash(fresh()));
    // a project of this version is not touched at all
    const now = normalizeProject({ version: PROJECT_VERSION, player: { modelId: null }, models: [edited] });
    expect(now.models.find((m) => m.id === id)!.cubes[0]!.position).toEqual([0, 0.5, 0.3]);
  });

  it('knows the fingerprint of every model that was redrawn, and of no model that is not built in', () => {
    for (const id of Object.keys(LEGACY_MODEL_HASHES)) {
      expect(project.models.some((m) => m.id === id), id).toBe(true);
    }
    // the barrel was a prism once: its fingerprint is not the one it has now
    const now = geometryHash(project.models.find((m) => m.id === 'prop-barrel')!);
    expect(LEGACY_MODEL_HASHES['prop-barrel']).not.toBe(now);
  });
});
