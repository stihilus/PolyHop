import { describe, expect, it } from 'vitest';
import { pruneForExport } from '../src/core/exportProject';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { boxMesh } from '../src/core/mesh';
import { makeVariant, placeInstance } from '../src/core/components';
import { parseProjectText, serializeProject } from '../src/core/projectFile';
import { SOUND_IDS } from '../src/core/sounds';
import {
  PROJECT_VERSION,
  createBlock,
  createDefaultProject,
  createModelInstance,
  normalizeProject,
} from '../src/core/types';

let n = 0;
const ids = () => `x${++n}`;

describe('export pruning', () => {
  it('leaves the game assets out and keeps everything the game plays', () => {
    const p = createDefaultProject();
    const before = p.models.length;
    const out = pruneForExport(p);
    expect(out.exported).toBe(true);
    expect(out.models.length).toBeLessThan(before);
    // the player's body stays
    expect(out.models.some((m) => m.id === p.player.modelId)).toBe(true);
    // the level is untouched
    expect(out.levels.map((l) => l.objects.length)).toEqual(p.levels.map((l) => l.objects.length));
  });

  it('does not change the project it was given', () => {
    const p = createDefaultProject();
    const json = JSON.stringify(p);
    pruneForExport(p);
    expect(JSON.stringify(p)).toBe(json);
  });

  it('keeps a model only when it is placed, worn or played', () => {
    const p = createDefaultProject();
    const placed = p.models.find((m) => m.id !== p.player.modelId)!;
    p.levels[0]!.objects.push(createModelInstance(placed, [0, 0, 0]));
    const out = pruneForExport(p);
    expect(out.models.some((m) => m.id === placed.id)).toBe(true);
    // a prefab-only item model is gone
    expect(out.models.some((m) => m.id === ITEM_MODEL_IDS.coin)).toBe(p.levels.some((l) => l.objects.some((o) => o.kind === 'model' && o.modelId === ITEM_MODEL_IDS.coin)));
  });

  it('leaves the editor-only marks of components out, and keeps what the game plays', () => {
    const p = createDefaultProject();
    const coinModel = p.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    const coin = placeInstance(coinModel, [1, 1, 1], ids);
    coin.master = true;
    coin.overrides = ['rules'];
    p.levels[0]!.objects.push(coin);
    const out = pruneForExport(p);
    const kept = out.levels[0]!.objects.find((o) => o.id === coin.id)!;
    expect(kept.kind === 'model' && kept.master).toBeUndefined();
    expect(kept.kind === 'model' && kept.overrides).toBeUndefined();
    // the coin itself is still there, with its rules, and its model without the default behavior
    expect(kept.rules.length).toBeGreaterThan(0);
    const model = out.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    expect(model.cubes.length).toBeGreaterThan(0);
    expect(model.defaults).toBeUndefined();
    expect(model.component).toBeUndefined();
    // the project itself is untouched
    expect(coinModel.defaults).toBeDefined();
  });

  it('keeps what a variant and a component with parts are made of', () => {
    const p = createDefaultProject();
    const coin = p.models.find((m) => m.id === ITEM_MODEL_IDS.coin)!;
    const variant = makeVariant(coin, ids, 'Gold coin');
    p.models.push(variant);
    p.levels[0]!.objects.push(placeInstance(variant, [0, 0, 0], ids));
    const out = pruneForExport(p);
    expect(out.models.some((m) => m.id === variant.id)).toBe(true);
    expect(out.models.some((m) => m.id === coin.id)).toBe(true);
  });

  it('keeps the sounds that rules, the player and the music use, and drops the rest', () => {
    const p = createDefaultProject();
    const block = createBlock('Pad', [0, 0, 0], boxMesh([1, 1, 1]), null);
    block.rules.push({
      id: 'r1',
      event: 'touch',
      conditions: [],
      actions: [{ type: 'choice', question: 'Pick', options: [{ label: 'A', actions: [{ type: 'sound', sound: SOUND_IDS.door }] }] }],
    });
    p.levels[0]!.objects = [block];
    p.settings.music = SOUND_IDS.theme;
    p.player.soundJump = SOUND_IDS.jump;
    p.player.soundDoubleJump = null;
    p.player.soundLand = null;
    const out = pruneForExport(p);
    const have = new Set(out.sounds.map((s) => s.id));
    expect(have.has(SOUND_IDS.door)).toBe(true);
    expect(have.has(SOUND_IDS.theme)).toBe(true);
    expect(have.has(SOUND_IDS.jump)).toBe(true);
    expect(have.has(SOUND_IDS.coin)).toBe(false);
    expect(out.sounds.length).toBeLessThan(p.sounds.length);
  });

  it('keeps the atlases the blocks and the kept models use', () => {
    const p = createDefaultProject();
    const out = pruneForExport(p);
    const names = new Set(out.textures.map((t) => t.name));
    for (const t of names) expect(p.textures.some((x) => x.name === t)).toBe(true);
    for (const m of out.models) if (m.texture && p.textures.some((x) => x.name === m.texture)) expect(names.has(m.texture)).toBe(true);
  });

  it('is smaller as text and the player reads it back as it is', () => {
    const p = createDefaultProject();
    const full = serializeProject(p, () => null);
    const slim = serializeProject(pruneForExport(p), () => null);
    expect(slim.length).toBeLessThan(full.length);

    const back = normalizeProject(parseProjectText(slim));
    expect(back.version).toBe(PROJECT_VERSION);
    expect(back.exported).toBe(true);
    // the built-in game objects are not brought back, and no built-in model is re-added
    expect(back.models.map((m) => m.id).sort()).toEqual(pruneForExport(p).models.map((m) => m.id).sort());
    expect(back.levels[0]!.objects.length).toBe(p.levels[0]!.objects.length);
  });

  it('a normal project still gets its built-in assets back', () => {
    const p = createDefaultProject();
    const text = serializeProject(p, () => null);
    const back = normalizeProject(parseProjectText(text));
    expect(back.exported).toBeUndefined();
    expect(back.models.map((m) => m.id)).toEqual(p.models.map((m) => m.id));
  });
});
