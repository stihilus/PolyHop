import { describe, expect, it } from 'vitest';
import {
  type Rule,
  type Variable,
  VariableStore,
  compare,
  hudText,
  normalizeRules,
  normalizeVariables,
  renameVariableInRules,
  runRules,
  variablesUsed,
} from '../src/core/logic';
import { ITEM_MODEL_IDS, createItemModel } from '../src/core/items';
import { PRESETS, type PresetKind, missingVariables, presetRules, presetVariables } from '../src/core/presets';
import { type Project, createDefaultProject, ensurePresetAssets, normalizeProject } from '../src/core/types';
import { LogicRuntime, triggerBox } from '../src/runtime/logic';
import type { Box } from '../src/runtime/physics';

let n = 0;
const ids = () => `i${++n}`;

const variable = (over: Partial<Variable> & { name: string }): Variable => ({
  id: ids(),
  initial: 0,
  min: null,
  max: null,
  hud: false,
  icon: '',
  label: '',
  ...over,
});

describe('variables', () => {
  it('start at their initial value, clamp writes and reset', () => {
    const s = new VariableStore([variable({ name: 'health', initial: 3, min: 0, max: 3 }), variable({ name: 'coins' })]);
    expect(s.get('health')).toBe(3);
    s.add('health', 5);
    expect(s.get('health')).toBe(3);
    s.add('health', -10);
    expect(s.get('health')).toBe(0);
    s.add('coins', 4);
    expect(s.get('coins')).toBe(4);
    s.reset();
    expect([s.get('health'), s.get('coins')]).toEqual([3, 0]);
  });

  it('counts changes so the display knows when to redraw', () => {
    const s = new VariableStore([variable({ name: 'a' })]);
    const v0 = s.version;
    s.set('a', 0); // same value: nothing changed
    expect(s.version).toBe(v0);
    s.set('a', 2);
    expect(s.version).toBeGreaterThan(v0);
  });

  it('reads an unknown variable as 0 and keeps writes to it', () => {
    const s = new VariableStore([]);
    expect(s.get('ghost')).toBe(0);
    s.add('ghost', 2);
    expect(s.get('ghost')).toBe(2);
  });

  it('formats the HUD line', () => {
    expect(hudText(variable({ name: 'coins', icon: '🪙', label: 'Coins' }), 3)).toBe('🪙 Coins: 3');
    expect(hudText(variable({ name: 'health', max: 3 }), 2)).toBe('health: 2 / 3');
    expect(hudText(variable({ name: 'x' }), 1.25)).toBe('x: 1.3');
  });
});

describe('rules', () => {
  const store = () => new VariableStore([variable({ name: 'keys', min: 0 }), variable({ name: 'coins' })]);
  const rule = (r: Omit<Rule, 'id'>): Rule => ({ id: ids(), ...r });

  it('compares', () => {
    expect(compare(2, '>=', 2)).toBe(true);
    expect(compare(2, '>', 2)).toBe(false);
    expect(compare(1, '!=', 2)).toBe(true);
    expect(compare(1, '==', 2)).toBe(false);
  });

  it('runs the actions of a rule whose event and conditions fit, in order', () => {
    const s = store();
    const rules = [
      rule({
        event: 'touch',
        conditions: [],
        actions: [{ type: 'add', variable: 'coins', value: 2 }, { type: 'message', text: 'hi', seconds: 1 }, { type: 'destroy' }],
      }),
      rule({ event: 'start', conditions: [], actions: [{ type: 'set', variable: 'coins', value: 99 }] }),
    ];
    const fx = runRules(rules, 'touch', s);
    expect(s.get('coins')).toBe(2);
    expect(fx).toEqual([{ type: 'message', text: 'hi', seconds: 1 }, { type: 'destroy' }]);
  });

  it('skips a rule whose conditions do not hold', () => {
    const s = store();
    const rules = [rule({ event: 'touch', conditions: [{ variable: 'keys', op: '>=', value: 1 }], actions: [{ type: 'destroy' }] })];
    expect(runRules(rules, 'touch', s)).toEqual([]);
    s.set('keys', 1);
    expect(runRules(rules, 'touch', s)).toEqual([{ type: 'destroy' }]);
  });

  it('later rules see what earlier ones did (game over after the last heart)', () => {
    const s = new VariableStore([variable({ name: 'health', initial: 1, min: 0, max: 3 })]);
    const rules = [
      rule({ event: 'touch', conditions: [], actions: [{ type: 'add', variable: 'health', value: -1 }, { type: 'respawn' }] }),
      rule({ event: 'touch', conditions: [{ variable: 'health', op: '<=', value: 0 }], actions: [{ type: 'restart' }] }),
    ];
    expect(runRules(rules, 'touch', s)).toEqual([{ type: 'respawn' }, { type: 'restart' }]);
  });

  it('survives hand-edited junk when loading', () => {
    const rules = normalizeRules(
      [
        { event: 'touch', conditions: [{ variable: 'a', op: '>>', value: 1 }, { variable: 'b', op: '<', value: 'x' }], actions: [{ type: 'explode' }, { type: 'add', variable: 'a' }, { type: 'message' }] },
        { event: 'sometimes' },
        null,
      ],
      ids,
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]!.conditions).toEqual([{ variable: 'b', op: '<', value: 0 }]);
    expect(rules[0]!.actions).toEqual([
      { type: 'add', variable: 'a', value: 0 },
      { type: 'message', text: '', seconds: 2 },
    ]);
    expect(normalizeVariables([{ name: 'a' }, { name: 'a' }, { name: ' ' }, 5], ids)).toHaveLength(1);
  });

  it('renames a variable in every place a rule mentions it', () => {
    const rules = presetRules('door', ids);
    expect(renameVariableInRules(rules, 'keys', 'gold keys')).toBe(3);
    expect([...variablesUsed(rules)]).toEqual(['gold keys']);
  });
});

describe('presets', () => {
  // sounds are checked in audio.test.ts; here only what changes the game
  const run = (kind: PresetKind, store: VariableStore) =>
    runRules(presetRules(kind, ids), 'touch', store).filter((e) => e.type !== 'sound');
  const world = () =>
    new VariableStore([
      variable({ name: 'coins' }),
      variable({ name: 'keys', min: 0 }),
      variable({ name: 'health', initial: 3, min: 0, max: 3 }),
    ]);

  it('a coin adds one and goes away', () => {
    const s = world();
    expect(run('coin', s)).toEqual([{ type: 'destroy' }]);
    expect(s.get('coins')).toBe(1);
  });

  it('a key adds one and says so', () => {
    const s = world();
    const fx = run('key', s);
    expect(s.get('keys')).toBe(1);
    expect(fx.map((e) => e.type)).toEqual(['message', 'destroy']);
  });

  it('an apple heals but is not wasted at full health', () => {
    const s = world();
    expect(run('apple', s)).toEqual([]);
    s.set('health', 1);
    expect(run('apple', s)).toEqual([{ type: 'destroy' }]);
    expect(s.get('health')).toBe(2);
  });

  it('a door is locked without a key and opens (using the key) with one', () => {
    const s = world();
    const locked = run('door', s);
    expect(locked).toEqual([{ type: 'message', text: 'It is locked. Find a key.', seconds: 2 }]);
    s.set('keys', 1);
    const open = run('door', s);
    // exactly one thing happens: the door opens and uses the key, and does not also say it is locked
    expect(open).toEqual([
      { type: 'message', text: 'The door opens', seconds: 2 },
      { type: 'move', target: '', offset: [0, 3, 0], seconds: 1 },
    ]);
    expect(s.get('keys')).toBe(0);
  });

  it('a hazard costs a heart and sends the player back; the last heart restarts the game', () => {
    const s = world();
    expect(run('hazard', s).map((e) => e.type)).toEqual(['message', 'respawn']);
    expect(s.get('health')).toBe(2);
    s.set('health', 1);
    expect(run('hazard', s).map((e) => e.type)).toEqual(['message', 'respawn', 'message', 'restart']);
  });

  it('a checkpoint saves the position', () => {
    expect(run('checkpoint', world()).map((e) => e.type)).toEqual(['checkpoint', 'message']);
  });

  it('every preset lists what it needs and the list is complete', () => {
    for (const p of PRESETS) {
      const have = missingVariables([], presetVariables(p.kind), ids).map((v) => v.name);
      const used = [...variablesUsed(presetRules(p.kind, ids))];
      for (const name of used) expect(have).toContain(name);
    }
  });
});

describe('the project', () => {
  it('starts with items, variables and a level that uses them', () => {
    const p = createDefaultProject();
    expect(p.variables.map((v) => v.name).sort()).toEqual(['coins', 'health', 'keys']);
    for (const id of Object.values(ITEM_MODEL_IDS)) expect(p.models.some((m) => m.id === id)).toBe(true);
    const withRules = p.levels[0]!.objects.filter((o) => o.rules.length > 0);
    expect(withRules.filter((o) => o.name.startsWith('Coin')).length).toBeGreaterThanOrEqual(5);
    expect(withRules.some((o) => o.name === 'Key')).toBe(true);
    expect(withRules.some((o) => o.name === 'Door')).toBe(true);
    // every rule refers to a variable that exists
    const names = new Set(p.variables.map((v) => v.name));
    for (const o of withRules) for (const v of variablesUsed(o.rules)) expect(names.has(v)).toBe(true);
    // pickups point at models the project has
    for (const o of p.levels[0]!.objects) if (o.kind === 'model') expect(p.models.some((m) => m.id === o.modelId)).toBe(true);
  });

  it('keeps rules and variables through a save and a load', () => {
    const p = createDefaultProject();
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.variables).toEqual(p.variables);
    expect(back.levels[0]!.objects.find((o) => o.name === 'Door')!.rules).toEqual(p.levels[0]!.objects.find((o) => o.name === 'Door')!.rules);
  });

  it('an older project has no variables and its objects no rules', () => {
    const old = normalizeProject({ version: 4, level: { objects: [{ kind: 'block' }] } });
    expect(old.variables).toEqual([]);
    expect(old.levels[0]!.objects[0]!.rules).toEqual([]);
  });

  it('adding a pickup brings its model and variables, once', () => {
    const p = normalizeProject({ version: 4, models: [], variables: [] });
    expect(ensurePresetAssets(p, 'coin')).toBe(ITEM_MODEL_IDS.coin);
    expect(ensurePresetAssets(p, 'coin')).toBe(ITEM_MODEL_IDS.coin);
    expect(p.models.filter((m) => m.id === ITEM_MODEL_IDS.coin)).toHaveLength(1);
    expect(p.variables.map((v) => v.name)).toEqual(['coins']);
    expect(ensurePresetAssets(p, 'door')).toBeNull();
    expect(p.variables.map((v) => v.name).sort()).toEqual(['coins', 'keys']);
  });

  it('item models are valid: bones, a spin clip and UVs inside the atlas', () => {
    for (const kind of ['coin', 'key', 'apple'] as const) {
      const m = createItemModel(kind, ids);
      expect(m.bones).toHaveLength(1);
      expect(m.clips.map((c) => c.name)).toContain('spin');
      expect(m.cubes.every((c) => c.bone === m.bones[0]!.id)).toBe(true);
      for (const c of m.cubes) for (const f of c.mesh.faces) for (const [u, v] of f.uv) {
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(128);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(16);
      }
    }
  });
});

/** Begin the first level of a project the way the game does. */
function begin(rt: LogicRuntime, p: Project) {
  return rt.begin(p.variables, p.levels[0]!.objects, (id) => p.models.find((m) => m.id === id), true);
}

describe('LogicRuntime', () => {
  const player = (x: number, y = 0, z = 0): Box => ({ minX: x - 0.4, maxX: x + 0.4, minY: y, maxY: y + 1.8, minZ: z - 0.4, maxZ: z + 0.4 });

  it('fires a pickup once when the player reaches it', () => {
    const p = createDefaultProject();
    p.levels[0]!.objects = p.levels[0]!.objects.filter((o) => o.name === 'Coin 1');
    const coin = p.levels[0]!.objects[0]!;
    const rt = new LogicRuntime();
    begin(rt, p);
    const [x, y, z] = coin.position;
    expect(rt.update(player(50), new Set(), 0)).toEqual([]);
    const fx = rt.update(player(x, y, z), new Set(), 0);
    expect(fx.map((f) => f.effect.type)).toEqual(['sound', 'destroy']);
    expect(fx.every((f) => f.objectId === coin.id)).toBe(true);
    expect(rt.store.get('coins')).toBe(1);
    expect(rt.store.get('coins')).toBe(1);
    // standing in it does not fire again
    expect(rt.update(player(x, y, z), new Set(), 0)).toEqual([]);
    // leaving and coming back does (a door, a checkpoint, a hazard want that)
    rt.update(player(50), new Set(), 0);
    expect(rt.update(player(x, y, z), new Set(), 0).map((f) => f.effect.type)).toEqual(['sound', 'destroy']);
  });

  it('ignores objects that are already gone', () => {
    const p = createDefaultProject();
    const coin = p.levels[0]!.objects.find((o) => o.name === 'Coin 1')!;
    const rt = new LogicRuntime();
    begin(rt, p);
    expect(rt.update(player(coin.position[0], coin.position[1], coin.position[2]), new Set([coin.id]), 0)).toEqual([]);
  });

  it('runs "game starts" rules at the start', () => {
    const p = createDefaultProject();
    p.levels[0]!.objects = [];
    const b = normalizeProject({
      level: { objects: [{ kind: 'block', rules: [{ event: 'start', actions: [{ type: 'set', variable: 'coins', value: 5 }, { type: 'message', text: 'Go!' }] }] }] },
      variables: [{ name: 'coins' }],
    });
    const rt = new LogicRuntime();
    const fx = begin(rt, b);
    expect(rt.store.get('coins')).toBe(5);
    expect(fx).toHaveLength(1);
    expect(fx[0]!.effect.type).toBe('message');
  });

  it('the touch area of a block is its box and of a model its cubes', () => {
    const p = createDefaultProject();
    const door = p.levels[0]!.objects.find((o) => o.name === 'Door')!;
    const box = triggerBox(door, () => undefined)!;
    expect(box.maxX - box.minX).toBeCloseTo(2);
    const coin = p.levels[0]!.objects.find((o) => o.name === 'Coin 1')!;
    const cb = triggerBox(coin, (id) => p.models.find((m) => m.id === id))!;
    expect(cb.maxY - cb.minY).toBeGreaterThan(0.4);
  });

  it('restart brings the values and the triggers back', () => {
    const p = createDefaultProject();
    const rt = new LogicRuntime();
    begin(rt, p);
    rt.store.set('coins', 7);
    rt.restart();
    expect(rt.store.get('coins')).toBe(0);
  });
});
