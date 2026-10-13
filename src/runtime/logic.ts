import { type Action, type Effect, type Rule, type Variable, VariableStore, conditionsHold, runActions, runRule, runRules } from '../core/logic';
import { worldPoints } from '../core/shape';
import type { LevelObject, Model } from '../core/types';
import { modelInstanceBounds } from './modelRender';
import { type Box, boxFromPoints, overlaps } from './physics';

/** Something the game has to do because of a rule, and which object's rule it was. */
export interface LogicEffect {
  objectId: string;
  effect: Effect;
}

interface Trigger {
  id: string;
  rules: Rule[];
  box: Box;
  inside: boolean;
}

interface Timer {
  id: string;
  rule: Rule;
  /** Level time at which it fires next; Infinity once a one-shot has fired. */
  at: number;
}

interface Watcher {
  id: string;
  rule: Rule;
  /** The conditions held at the last check (a rule fires when they turn from false to true). */
  was: boolean;
}

/** The area where the player "touches" an object: the box around it. */
export function triggerBox(obj: LevelObject, getModel: (id: string) => Model | undefined): Box | null {
  if (obj.kind === 'block') return boxFromPoints(worldPoints(obj));
  const model = getModel(obj.modelId);
  return model ? modelInstanceBounds(model, obj) : null;
}

/**
 * Plays the rules of the level objects: keeps the variables, notices when the player starts touching
 * an object, counts the timers and says what the game has to do about it.
 */
export class LogicRuntime {
  readonly store = new VariableStore([]);
  private triggers: Trigger[] = [];
  private startRules: { id: string; rules: Rule[] }[] = [];
  private timers: Timer[] = [];
  private watchers: Watcher[] = [];
  private clock = 0;
  private variables: Variable[] = [];
  private objects: LevelObject[] = [];
  private getModel: (id: string) => Model | undefined = () => undefined;

  /**
   * Begin a level: triggers and timers armed for `objects`. `resetVariables` sets every variable back
   * to its start value (a new run); moving on to the next level keeps them. Returns the effects of
   * the "level starts" rules.
   */
  begin(
    variables: Variable[],
    objects: LevelObject[],
    getModel: (id: string) => Model | undefined,
    resetVariables: boolean,
  ): LogicEffect[] {
    this.variables = variables;
    this.objects = objects;
    this.getModel = getModel;
    if (resetVariables) this.store.load(variables);
    this.arm();
    return this.runStart();
  }

  private arm(): void {
    this.triggers = [];
    this.startRules = [];
    this.timers = [];
    this.watchers = [];
    this.clock = 0;
    for (const o of this.objects) {
      if (o.rules.length === 0) continue;
      this.startRules.push({ id: o.id, rules: o.rules });
      for (const rule of o.rules) {
        if (rule.event === 'timer') this.timers.push({ id: o.id, rule, at: Math.max(0.05, rule.seconds ?? 5) });
        else if (rule.event === 'when') this.watchers.push({ id: o.id, rule, was: false });
      }
      if (!o.rules.some((r) => r.event === 'touch' || r.event === 'interact' || r.event === 'stomp')) continue;
      const box = triggerBox(o, this.getModel);
      if (box) this.triggers.push({ id: o.id, rules: o.rules, box, inside: false });
    }
  }

  private runStart(): LogicEffect[] {
    const out: LogicEffect[] = [];
    for (const o of this.startRules) {
      for (const effect of runRules(o.rules, 'start', this.store)) out.push({ objectId: o.id, effect });
    }
    return out;
  }

  /** Back to the beginning of the run (the "restart" action): values reset, everything armed again. */
  restart(): LogicEffect[] {
    this.store.load(this.variables);
    this.arm();
    return this.runStart();
  }

  /** An object moved: its "touch" area goes with it. */
  shift(id: string, dx: number, dy: number, dz: number): void {
    const t = this.triggers.find((x) => x.id === id);
    if (!t) return;
    t.box = {
      minX: t.box.minX + dx,
      maxX: t.box.maxX + dx,
      minY: t.box.minY + dy,
      maxY: t.box.maxY + dy,
      minZ: t.box.minZ + dz,
      maxZ: t.box.maxZ + dz,
    };
  }

  /** Run actions of an object now (the answer a player picked in a conversation). */
  runActions(objectId: string, actions: Action[]): LogicEffect[] {
    return runActions(actions, this.store).map((effect) => ({ objectId, effect }));
  }

  /** The interact key was pressed: rules of objects the player is close to run. */
  interact(near: Box, removed: ReadonlySet<string>): LogicEffect[] {
    const out: LogicEffect[] = [];
    for (const t of this.triggers) {
      if (removed.has(t.id) || !overlaps(near, t.box)) continue;
      for (const effect of runRules(t.rules, 'interact', this.store)) out.push({ objectId: t.id, effect });
    }
    return out;
  }

  /** Is there something close that reacts to the interact key (the screen shows a hint)? */
  canInteract(near: Box, removed: ReadonlySet<string>): boolean {
    return this.triggers.some((t) => !removed.has(t.id) && t.rules.some((r) => r.event === 'interact') && overlaps(near, t.box));
  }

  /**
   * One frame: a "touch" rule fires when the player starts touching its object, a timer when its time
   * is up, a "conditions become true" rule when its conditions turn true.
   */
  update(player: Box, removed: ReadonlySet<string>, dt: number, fallSpeed = 0): LogicEffect[] {
    const out: LogicEffect[] = [];
    for (const t of this.triggers) {
      if (removed.has(t.id)) continue;
      const touching = overlaps(player, t.box);
      if (touching && !t.inside) {
        // coming down on something that has "jumped on" rules counts as a stomp, not as a touch
        const stomp =
          fallSpeed < -1 && player.minY >= t.box.maxY - 0.45 && t.rules.some((r) => r.event === 'stomp');
        for (const effect of runRules(t.rules, stomp ? 'stomp' : 'touch', this.store)) out.push({ objectId: t.id, effect });
      }
      t.inside = touching;
    }

    this.clock += dt;
    for (const t of this.timers) {
      if (removed.has(t.id) || this.clock < t.at) continue;
      for (const effect of runRule(t.rule, this.store)) out.push({ objectId: t.id, effect });
      t.at = t.rule.repeat ? t.at + Math.max(0.05, t.rule.seconds ?? 5) : Infinity;
    }

    for (const w of this.watchers) {
      if (removed.has(w.id)) continue;
      const holds = conditionsHold(w.rule, this.store);
      if (holds && !w.was) {
        for (const effect of runRule(w.rule, this.store)) out.push({ objectId: w.id, effect });
      }
      w.was = holds;
    }
    return out;
  }
}
