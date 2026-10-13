import { describe, expect, it } from 'vitest';
import {
  type Rule,
  VariableStore,
  formatText,
  normalizeRules,
  renameVariableInRules,
  runRule,
  runRules,
} from '../src/core/logic';
import { ITEM_MODEL_IDS } from '../src/core/items';
import { presetRules, presetVariables } from '../src/core/presets';
import {
  PROJECT_VERSION,
  createBlock,
  createDefaultProject,
  createLevelData,
  defaultPlayer,
  ensurePresetAssets,
  normalizeProject,
} from '../src/core/types';
import { boxMesh } from '../src/core/mesh';
import { Store } from '../src/editor/store';
import { LogicRuntime } from '../src/runtime/logic';
import type { Box } from '../src/runtime/physics';

let n = 0;
const ids = () => `x${++n}`;
const rule = (r: Partial<Rule> & Pick<Rule, 'event' | 'actions'>): Rule => ({ id: ids(), conditions: [], ...r });
const variable = (name: string, initial = 0) => ({ id: ids(), name, initial, min: null, max: null, hud: false, icon: '', label: '' });
const at = (x: number, y = 0, z = 0): Box => ({ minX: x - 0.4, maxX: x + 0.4, minY: y, maxY: y + 1.8, minZ: z - 0.4, maxZ: z + 0.4 });
const none = () => undefined;

describe('levels in the project', () => {
  it('a new project has one level with its own spawn point', () => {
    const p = createDefaultProject();
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.levels).toHaveLength(1);
    expect(p.levels[0]!.spawn).toEqual([0, 0.05, 8]);
    expect('spawn' in p.player).toBe(false);
  });

  it('an older file with one level and a spawn on the player becomes level 1', () => {
    const old = normalizeProject({
      version: 4,
      player: { ...defaultPlayer(), spawn: [3, 1, 4], spawnYaw: 90 },
      level: { objects: [{ kind: 'block', name: 'Floor' }] },
    });
    expect(old.levels).toHaveLength(1);
    expect(old.levels[0]!.name).toBe('Level 1');
    expect(old.levels[0]!.spawn).toEqual([3, 1, 4]);
    expect(old.levels[0]!.spawnYaw).toBe(90);
    expect(old.levels[0]!.objects[0]!.name).toBe('Floor');
    expect('spawn' in old.player).toBe(false);
  });

  it('keeps several levels with unique ids through a save and a load', () => {
    const p = createDefaultProject();
    p.levels.push(createLevelData('Cave', [createBlock('Floor', [0, 0, 0], boxMesh([4, 1, 4]), null)], [1, 2, 3], 45));
    const dup = JSON.parse(JSON.stringify(p));
    dup.levels[1].id = dup.levels[0].id; // a hand-edited clash
    const back = normalizeProject(dup);
    expect(back.levels).toHaveLength(2);
    expect(back.levels[0]!.id).not.toBe(back.levels[1]!.id);
    expect(back.levels[1]!.name).toBe('Cave');
    expect(back.levels[1]!.spawn).toEqual([1, 2, 3]);
    expect(back.levels[1]!.spawnYaw).toBe(45);
  });

  it('a file without any level gets the starter one', () => {
    expect(normalizeProject({ levels: [] }).levels).toHaveLength(1);
  });

  it('the default level has a goal that ends the game', () => {
    const p = createDefaultProject();
    const goal = p.levels[0]!.objects.find((o) => o.name === 'Goal')!;
    expect(goal.kind === 'model' && goal.modelId).toBe(ITEM_MODEL_IDS.trophy);
    expect(goal.rules[0]!.actions.some((a) => a.type === 'end')).toBe(true);
    expect(p.models.some((m) => m.id === ITEM_MODEL_IDS.trophy)).toBe(true);
  });
});

describe('the level list in the editor', () => {
  it('adds, switches, renames, reorders and deletes levels', () => {
    const store = new Store(createDefaultProject());
    expect(store.levelIndex).toBe(0);
    store.addLevel('Second');
    expect(store.project.levels.map((l) => l.name)).toEqual(['Level 1', 'Second']);
    expect(store.levelIndex).toBe(1);
    expect(store.objects.length).toBe(1); // a ground
    store.renameLevel('Cave');
    expect(store.level.name).toBe('Cave');
    store.moveLevel(-1);
    expect(store.project.levels.map((l) => l.name)).toEqual(['Cave', 'Level 1']);
    expect(store.levelIndex).toBe(0);
    store.setLevel(1);
    expect(store.level.name).toBe('Level 1');
    expect(store.removeLevel()).toBe(true);
    expect(store.project.levels).toHaveLength(1);
    expect(store.removeLevel()).toBe(false); // the last one stays
  });

  it('a copied level has its own object ids and its rules point inside the copy', () => {
    const store = new Store(createDefaultProject());
    const door = store.objects.find((o) => o.name === 'Door')!;
    const lever = store.objects.find((o) => o.name === 'Coin 1')!;
    lever.rules = [rule({ event: 'touch', actions: [{ type: 'move', target: door.id, offset: [0, 1, 0], seconds: 1 }] })];
    store.duplicateLevel();
    expect(store.levelIndex).toBe(1);
    const copyLever = store.objects.find((o) => o.name === 'Coin 1')!;
    const copyDoor = store.objects.find((o) => o.name === 'Door')!;
    expect(copyLever.id).not.toBe(lever.id);
    expect(copyDoor.id).not.toBe(door.id);
    const a = copyLever.rules[0]!.actions[0]!;
    expect(a.type === 'move' && a.target).toBe(copyDoor.id);
  });

  it('undo goes back across a level being added', () => {
    const store = new Store(createDefaultProject());
    store.addLevel('Two');
    expect(store.project.levels).toHaveLength(2);
    store.undoLevel();
    expect(store.project.levels).toHaveLength(1);
    expect(store.levelIndex).toBe(0);
    store.redoLevel();
    expect(store.project.levels).toHaveLength(2);
  });

  it('a variable rename reaches the rules of every level', () => {
    const store = new Store(createDefaultProject());
    store.addLevel();
    store.objects.push(createBlock('Sign', [0, 0, 0], boxMesh([1, 1, 1]), null));
    store.objects[store.objects.length - 1]!.rules = [
      rule({ event: 'touch', conditions: [{ variable: 'coins', op: '>=', value: 1 }], actions: [{ type: 'message', text: 'You have {coins}', seconds: 2 }] }),
    ];
    const v = store.project.variables.find((x) => x.name === 'coins')!;
    store.setLevel(0);
    expect(store.renameVariable(v.id, 'gold')).toBe(true);
    const sign = store.project.levels[1]!.objects.find((o) => o.name === 'Sign')!;
    expect(sign.rules[0]!.conditions[0]!.variable).toBe('gold');
    const msg = sign.rules[0]!.actions[0]!;
    expect(msg.type === 'message' && msg.text).toBe('You have {gold}');
  });

  it('deleting a level sends exits that led there to the next one', () => {
    const store = new Store(createDefaultProject());
    store.addLevel('B');
    store.addLevel('C');
    const b = store.project.levels[1]!;
    store.setLevel(0);
    const obj = store.objects[0]!;
    obj.rules = [rule({ event: 'touch', actions: [{ type: 'level', level: b.id }] })];
    store.setLevel(1);
    store.removeLevel();
    const a = store.project.levels[0]!.objects[0]!.rules[0]!.actions[0]!;
    expect(a.type === 'level' && a.level).toBe('');
  });
});

describe('texts with variables', () => {
  it('fills in {name} and leaves unknown braces alone', () => {
    const s = new VariableStore([variable('coins', 7), variable('time', 2.5)]);
    expect(formatText('You have {coins} coins', s)).toBe('You have 7 coins');
    expect(formatText('{ coins } / {time}s', s)).toBe('7 / 2.5s');
    expect(formatText('{nothing} and {}', s)).toBe('{nothing} and {}');
  });

  it('message and end effects come out with the values in', () => {
    const s = new VariableStore([variable('coins', 3)]);
    const r = rule({
      event: 'touch',
      actions: [
        { type: 'message', text: '{coins} so far', seconds: 1 },
        { type: 'end', title: 'Done', text: 'Coins: {coins}' },
      ],
    });
    expect(runRule(r, s)).toEqual([
      { type: 'message', text: '3 so far', seconds: 1 },
      { type: 'end', title: 'Done', text: 'Coins: 3' },
    ]);
  });

  it('renaming a variable renames it in texts', () => {
    const r = rule({ event: 'touch', actions: [{ type: 'end', title: '{a}', text: 'x {a} y' }] });
    expect(renameVariableInRules([r], 'a', 'b')).toBe(1);
    const e = r.actions[0]!;
    expect(e.type === 'end' && [e.title, e.text]).toEqual(['{b}', 'x {b} y']);
  });
});

describe('new actions and events in data', () => {
  it('normalizes move, animate, end, level, timer and when', () => {
    const rules = normalizeRules(
      [
        { event: 'timer', seconds: 0, repeat: true, actions: [{ type: 'move', offset: [1, 'x', 3], seconds: -2 }, { type: 'end' }] },
        { event: 'when', conditions: [{ variable: 'coins', op: '>=', value: 3 }], actions: [{ type: 'level', level: 7 }, { type: 'animate', target: 'o1', animation: 'open' }] },
        { event: 'whenever', actions: [] },
      ],
      ids,
    );
    expect(rules).toHaveLength(2);
    expect(rules[0]!.seconds).toBeGreaterThan(0);
    expect(rules[0]!.repeat).toBe(true);
    expect(rules[0]!.actions[0]).toEqual({ type: 'move', target: '', offset: [0, 2, 0], seconds: 0 });
    expect(rules[0]!.actions[1]).toEqual({ type: 'end', title: 'The end', text: '' });
    expect(rules[1]!.actions).toEqual([
      { type: 'level', level: '' },
      { type: 'animate', target: 'o1', animation: 'open' },
    ]);
  });

  it('keeps the target of a destroy, and a plain destroy stays plain', () => {
    const rules = normalizeRules([{ event: 'touch', actions: [{ type: 'destroy', target: 'o9' }, { type: 'destroy' }] }], ids);
    expect(rules[0]!.actions).toEqual([{ type: 'destroy', target: 'o9' }, { type: 'destroy' }]);
  });

  it('the goal preset ends the game and shows the coins', () => {
    const s = new VariableStore([variable('coins', 4)]);
    const fx = runRules(presetRules('goal', ids), 'touch', s).filter((e) => e.type !== 'sound');
    expect(fx).toEqual([{ type: 'end', title: 'You win!', text: 'Coins: 4' }]);
    expect(presetVariables('goal').map((v) => v.name)).toEqual(['coins']);
  });

  it('the exit preset goes to the next level', () => {
    const s = new VariableStore([]);
    const fx = runRules(presetRules('exit', ids), 'touch', s).filter((e) => e.type !== 'sound');
    expect(fx).toEqual([{ type: 'level', level: '' }]);
  });

  it('a goal brings its trophy model', () => {
    const p = normalizeProject({ version: 5, models: [], variables: [] });
    expect(ensurePresetAssets(p, 'goal')).toBe(ITEM_MODEL_IDS.trophy);
    expect(p.models.some((m) => m.id === ITEM_MODEL_IDS.trophy)).toBe(true);
  });
});

describe('timers and "becomes true" rules at run time', () => {
  const thing = (rules: Rule[]) => {
    const b = createBlock('Thing', [100, 0, 100], boxMesh([1, 1, 1]), null);
    b.rules = rules;
    return b;
  };
  const begin = (rt: LogicRuntime, vars: ReturnType<typeof variable>[], o: ReturnType<typeof createBlock>[]) =>
    rt.begin(vars, o, none, true);

  it('a timer fires once after its seconds', () => {
    const b = thing([rule({ event: 'timer', seconds: 2, actions: [{ type: 'message', text: 'tick', seconds: 1 }] })]);
    const rt = new LogicRuntime();
    begin(rt, [], [b]);
    expect(rt.update(at(0), new Set(), 1.5)).toEqual([]);
    const fx = rt.update(at(0), new Set(), 0.6);
    expect(fx.map((f) => f.effect.type)).toEqual(['message']);
    expect(rt.update(at(0), new Set(), 5)).toEqual([]);
  });

  it('a repeating timer keeps firing', () => {
    const b = thing([rule({ event: 'timer', seconds: 1, repeat: true, actions: [{ type: 'add', variable: 'n', value: 1 }] })]);
    const rt = new LogicRuntime();
    begin(rt, [variable('n')], [b]);
    for (let i = 0; i < 35; i++) rt.update(at(0), new Set(), 0.1);
    expect(rt.store.get('n')).toBe(3);
  });

  it('a timer of a removed object does not fire', () => {
    const b = thing([rule({ event: 'timer', seconds: 1, actions: [{ type: 'add', variable: 'n', value: 1 }] })]);
    const rt = new LogicRuntime();
    begin(rt, [variable('n')], [b]);
    rt.update(at(0), new Set([b.id]), 2);
    expect(rt.store.get('n')).toBe(0);
  });

  it('"conditions become true" fires on the change, not while it stays true', () => {
    const b = thing([
      rule({ event: 'when', conditions: [{ variable: 'coins', op: '>=', value: 2 }], actions: [{ type: 'message', text: 'two!', seconds: 1 }] }),
    ]);
    const rt = new LogicRuntime();
    begin(rt, [variable('coins')], [b]);
    expect(rt.update(at(0), new Set(), 0.1)).toEqual([]);
    rt.store.set('coins', 2);
    expect(rt.update(at(0), new Set(), 0.1).map((f) => f.effect.type)).toEqual(['message']);
    rt.store.set('coins', 3);
    expect(rt.update(at(0), new Set(), 0.1)).toEqual([]);
    // drops below and comes back: fires again
    rt.store.set('coins', 0);
    rt.update(at(0), new Set(), 0.1);
    rt.store.set('coins', 2);
    expect(rt.update(at(0), new Set(), 0.1)).toHaveLength(1);
  });

  it('moving an object takes its touch area along', () => {
    const b = createBlock('Pad', [0, 0.5, 0], boxMesh([2, 1, 2]), null);
    b.rules = [rule({ event: 'touch', actions: [{ type: 'message', text: 'hi', seconds: 1 }] })];
    const rt = new LogicRuntime();
    begin(rt, [], [b]);
    rt.shift(b.id, 10, 0, 0);
    expect(rt.update(at(0, 0.2, 0), new Set(), 0)).toEqual([]); // it is no longer there
    expect(rt.update(at(10, 0.2, 0), new Set(), 0)).toHaveLength(1);
  });

  it('level change keeps the variables, a new run resets them', () => {
    const rt = new LogicRuntime();
    const vars = [variable('coins')];
    begin(rt, vars, []);
    rt.store.set('coins', 5);
    rt.begin(vars, [], none, false);
    expect(rt.store.get('coins')).toBe(5);
    rt.begin(vars, [], none, true);
    expect(rt.store.get('coins')).toBe(0);
  });
});

describe('the interact event', () => {
  const sign = () => {
    const b = createBlock('Sign', [0, 0.7, 0], boxMesh([1, 1.4, 0.2]), null);
    b.rules = [rule({ event: 'interact', actions: [{ type: 'message', text: 'Hi', seconds: 2 }] })];
    return b;
  };
  const start = (rt: LogicRuntime, o: ReturnType<typeof createBlock>[]) => rt.begin([], o, none, true);

  it('only fires for objects the player is next to, and not when merely touching', () => {
    const b = sign();
    const rt = new LogicRuntime();
    start(rt, [b]);
    // walking into it does nothing
    expect(rt.update(at(0, 0, 0), new Set(), 0)).toEqual([]);
    expect(rt.interact(at(0, 0, 0), new Set()).map((e) => e.effect.type)).toEqual(['message']);
    expect(rt.interact(at(10, 0, 0), new Set())).toEqual([]);
    expect(rt.interact(at(0, 0, 0), new Set([b.id]))).toEqual([]);
  });

  it('knows when a hint should be shown', () => {
    const b = sign();
    const rt = new LogicRuntime();
    start(rt, [b]);
    expect(rt.canInteract(at(0.2, 0, 0), new Set())).toBe(true);
    expect(rt.canInteract(at(5, 0, 0), new Set())).toBe(false);
    expect(rt.canInteract(at(0, 0, 0), new Set([b.id]))).toBe(false);
  });

  it('an object with only touch rules is not interactive', () => {
    const b = createBlock('Pad', [0, 0.5, 0], boxMesh([1, 1, 1]), null);
    b.rules = [rule({ event: 'touch', actions: [{ type: 'message', text: 'x', seconds: 1 }] })];
    const rt = new LogicRuntime();
    start(rt, [b]);
    expect(rt.canInteract(at(0, 0, 0), new Set())).toBe(false);
    expect(rt.interact(at(0, 0, 0), new Set())).toEqual([]);
  });

  it('older projects get the default key for it, and the sign preset speaks', () => {
    const p = normalizeProject({ settings: { controls: { forward: ['KeyZ'] } } });
    expect(p.settings.controls.interact).toEqual(['KeyE']);
    expect(p.settings.controls.forward).toEqual(['KeyZ']);
    const s = new VariableStore([]);
    expect(runRules(presetRules('sign', ids), 'interact', s).map((e) => e.type)).toEqual(['message']);
    expect(runRules(presetRules('sign', ids), 'touch', s)).toEqual([]);
  });
});

describe('the sky of a level', () => {
  it('has a default, survives a save and is changed with undo support', () => {
    const store = new Store(createDefaultProject());
    expect(store.level.sky).toBe('#8fc0ee');
    store.setSky('#202840');
    expect(store.level.sky).toBe('#202840');
    store.undoLevel();
    expect(store.level.sky).toBe('#8fc0ee');
    store.redoLevel();
    const back = normalizeProject(JSON.parse(JSON.stringify(store.project)));
    expect(back.levels[0]!.sky).toBe('#202840');
  });

  it('a file without a sky or with nonsense gets the default', () => {
    const p = normalizeProject({ levels: [{ name: 'A', objects: [] }, { name: 'B', objects: [], sky: 'blue' }] });
    expect(p.levels.map((l) => l.sky)).toEqual(['#8fc0ee', '#8fc0ee']);
  });
});
