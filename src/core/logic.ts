// Game logic as data: variables, and rules of the form "when this happens, if these hold, do these".
// The editor edits these plain objects and the runtime plays them; no scripting language is involved.

export type RuleEvent = 'touch' | 'stomp' | 'interact' | 'start' | 'timer' | 'when';
export type CompareOp = '>=' | '>' | '<=' | '<' | '==' | '!=';

export const RULE_EVENTS: { value: RuleEvent; label: string }[] = [
  { value: 'touch', label: 'the player touches this' },
  { value: 'stomp', label: 'the player jumps on top of this' },
  { value: 'interact', label: 'the player presses Interact near this' },
  { value: 'start', label: 'the level starts' },
  { value: 'timer', label: 'some seconds have passed' },
  { value: 'when', label: 'the conditions become true' },
];

type Vec3 = [number, number, number];

export const COMPARE_OPS: CompareOp[] = ['>=', '>', '<=', '<', '==', '!='];

export interface Condition {
  variable: string;
  op: CompareOp;
  value: number;
}

/** An action's `target` is the id of a level object; empty / missing = the object the rule belongs to. */
export type Action =
  /** variable = value */
  | { type: 'set'; variable: string; value: number }
  /** variable += value (negative to subtract); kept inside the variable's min / max */
  | { type: 'add'; variable: string; value: number }
  /** the object disappears (and stops being solid) until the game restarts */
  | { type: 'destroy'; target?: string }
  /** slides the object by an offset (meters) in some seconds; a solid object takes its collision along */
  | { type: 'move'; target: string; offset: Vec3; seconds: number }
  /** moves the object by an offset and back again, over and over (a moving platform, an enemy that patrols) */
  | { type: 'patrol'; target: string; offset: Vec3; seconds: number }
  /** the object plays one of its model's animations (looping); empty = stands still */
  | { type: 'animate'; target: string; animation: string }
  /** `{coins}` in the text shows the value of the variable of that name */
  | { type: 'message'; text: string; seconds: number }
  /** plays a sound of the project (by id) */
  | { type: 'sound'; sound: string }
  /** back to the last checkpoint (or the spawn point) */
  | { type: 'respawn' }
  /** the player's position becomes the respawn point */
  | { type: 'checkpoint' }
  /** the game stops and shows a full screen message (a win screen, or game over) */
  | { type: 'end'; title: string; text: string }
  /** go to another level of the project (empty = the next one) */
  | { type: 'level'; level: string }
  /** the object walks toward the player while the player is within `range` meters, at `speed` m/s */
  | { type: 'chase'; target: string; speed: number; range: number }
  /** takes `amount` off a variable (health), flings the player away from the object and makes them untouchable for a moment */
  | { type: 'hurt'; amount: number; variable: string; knockback: number }
  /** throws the player up (after jumping on an enemy, a spring) */
  | { type: 'bounce'; strength: number }
  /** a character talks: the game waits while the lines are read one by one (Interact / Jump / a click) */
  | { type: 'dialogue'; speaker: string; lines: string[]; voice?: string; pitch?: number; speed?: number }
  /** a question with up to four answers; the chosen answer runs its actions */
  | { type: 'choice'; question: string; options: ChoiceOption[]; speaker?: string; voice?: string; pitch?: number; speed?: number }
  /** variables back to their start values, objects back, player at the first spawn */
  | { type: 'restart' };

/** How fast the words of a conversation appear (letters per second); 0 shows a line at once. */
export const DEFAULT_TEXT_SPEED = 30;
export const MAX_TEXT_SPEED = 120;
/** The voice pitch range: 1 is the sound as it was made. */
export const MIN_VOICE_PITCH = 0.5;
export const MAX_VOICE_PITCH = 2;
/** `voice` value for a character that makes no sound while talking. */
export const SILENT_VOICE = 'none';

export interface ChoiceOption {
  label: string;
  actions: Action[];
}

export type ActionType = Action['type'];

export const ACTION_LABELS: Record<ActionType, string> = {
  set: 'Set variable',
  add: 'Change variable by',
  destroy: 'Remove object',
  move: 'Move object',
  patrol: 'Move back and forth',
  animate: 'Play animation',
  message: 'Show message',
  sound: 'Play sound',
  respawn: 'Respawn the player',
  checkpoint: 'Save checkpoint here',
  end: 'Show end screen',
  level: 'Go to level',
  chase: 'Chase the player',
  hurt: 'Hurt the player',
  bounce: 'Bounce the player up',
  dialogue: 'Talk (dialogue)',
  choice: 'Ask a question',
  restart: 'Restart the game',
};

export interface Rule {
  id: string;
  event: RuleEvent;
  /** `timer`: seconds after the level started (or between repeats). */
  seconds?: number;
  /** `timer`: fire again every `seconds`. */
  repeat?: boolean;
  /** All of them must hold. */
  conditions: Condition[];
  actions: Action[];
}

export interface Variable {
  id: string;
  /** Rules refer to it by this name. */
  name: string;
  initial: number;
  min: number | null;
  max: number | null;
  /** Shown on the screen while playing. */
  hud: boolean;
  /** A short symbol in front of the value on the screen (an emoji works). */
  icon: string;
  /** Text shown before the value; empty = the name. */
  label: string;
}

// ---------------------------------------------------------------- variable values at run time

/** The current values of the variables. Writes are kept inside each variable's min / max. */
export class VariableStore {
  private values = new Map<string, number>();
  private defs = new Map<string, Variable>();
  /** Counts changes; the HUD redraws when it moves. */
  version = 0;

  constructor(variables: Variable[]) {
    this.load(variables);
  }

  load(variables: Variable[]): void {
    this.defs = new Map(variables.map((v) => [v.name, v] as const));
    this.reset();
  }

  /** Every variable back to its start value. */
  reset(): void {
    this.values.clear();
    for (const v of this.defs.values()) this.values.set(v.name, this.clamp(v, v.initial));
    this.version++;
  }

  private clamp(def: Variable | undefined, n: number): number {
    if (!def) return n;
    let v = n;
    if (def.min !== null && v < def.min) v = def.min;
    if (def.max !== null && v > def.max) v = def.max;
    return v;
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  get(name: string): number {
    return this.values.get(name) ?? 0;
  }

  set(name: string, value: number): void {
    const next = this.clamp(this.defs.get(name), value);
    if (this.values.get(name) === next) return;
    this.values.set(name, next);
    this.version++;
  }

  add(name: string, delta: number): void {
    this.set(name, this.get(name) + delta);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }
}

// ---------------------------------------------------------------- rules

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '<':
      return a < b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
  }
}

/** What running rules asks the game to do besides changing variables (texts are already filled in). */
export type Effect = Exclude<Action, { type: 'set' } | { type: 'add' }>;

/** Replace `{name}` by the value of the variable of that name; other braces are left alone. */
export function formatText(text: string, store: VariableStore): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, raw: string) => {
    const name = raw.trim();
    if (!store.has(name)) return whole;
    const v = store.get(name);
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  });
}

/** Do the conditions of a rule hold right now? */
export function conditionsHold(rule: Rule, store: VariableStore): boolean {
  return rule.conditions.every((c) => compare(store.get(c.variable), c.op, c.value));
}

/** Do a list of actions now: variables change at once, the rest is returned for the game to carry out. */
export function runActions(actions: Action[], store: VariableStore): Effect[] {
  const effects: Effect[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'set':
        store.set(a.variable, a.value);
        break;
      case 'add':
        store.add(a.variable, a.value);
        break;
      case 'message':
        effects.push({ type: 'message', text: formatText(a.text, store), seconds: a.seconds });
        break;
      case 'end':
        effects.push({ type: 'end', title: formatText(a.title, store), text: formatText(a.text, store) });
        break;
      case 'sound':
        if (a.sound) effects.push({ type: 'sound', sound: a.sound });
        break;
      case 'destroy':
        effects.push(a.target ? { type: 'destroy', target: a.target } : { type: 'destroy' });
        break;
      case 'move':
      case 'patrol':
        effects.push({ ...a, offset: [...a.offset] });
        break;
      case 'dialogue':
        effects.push({
          type: 'dialogue',
          speaker: formatText(a.speaker, store),
          lines: a.lines.map((l) => formatText(l, store)),
          ...(a.voice ? { voice: a.voice } : {}),
          ...(a.pitch !== undefined ? { pitch: a.pitch } : {}),
          ...(a.speed !== undefined ? { speed: a.speed } : {}),
        });
        break;
      case 'choice':
        // the answers keep their own actions; they run when one is picked
        effects.push({
          type: 'choice',
          question: formatText(a.question, store),
          options: a.options.map((o) => ({ label: formatText(o.label, store), actions: o.actions })),
          ...(a.speaker ? { speaker: formatText(a.speaker, store) } : {}),
          ...(a.voice ? { voice: a.voice } : {}),
          ...(a.pitch !== undefined ? { pitch: a.pitch } : {}),
          ...(a.speed !== undefined ? { speed: a.speed } : {}),
        });
        break;
      default:
        effects.push({ ...a });
    }
  }
  return effects;
}

/** Run one rule if its conditions hold: variables change now, the rest is returned. */
export function runRule(rule: Rule, store: VariableStore): Effect[] {
  if (!conditionsHold(rule, store)) return [];
  return runActions(rule.actions, store);
}

/**
 * Run the rules that listen for `event`. Rules and their actions run in order, and each rule looks at
 * the variables as the earlier ones left them. Returns what the game has to do (remove the object,
 * show a message, ...).
 */
export function runRules(rules: Rule[], event: RuleEvent, store: VariableStore): Effect[] {
  const effects: Effect[] = [];
  for (const rule of rules) {
    if (rule.event === event) effects.push(...runRule(rule, store));
  }
  return effects;
}

// ---------------------------------------------------------------- loading

const OPS = new Set<string>(COMPARE_OPS);
const EVENTS = new Set<string>(RULE_EVENTS.map((e) => e.value));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function normalizeVariables(raw: unknown, idGen: () => string): Variable[] {
  if (!Array.isArray(raw)) return [];
  const out: Variable[] = [];
  const seen = new Set<string>();
  for (const v of raw as Partial<Variable>[]) {
    if (!v || typeof v.name !== 'string' || !v.name.trim() || seen.has(v.name)) continue;
    seen.add(v.name);
    out.push({
      id: typeof v.id === 'string' ? v.id : idGen(),
      name: v.name,
      initial: num(v.initial, 0),
      min: typeof v.min === 'number' && Number.isFinite(v.min) ? v.min : null,
      max: typeof v.max === 'number' && Number.isFinite(v.max) ? v.max : null,
      hud: v.hud === true,
      icon: typeof v.icon === 'string' ? v.icon : '',
      label: typeof v.label === 'string' ? v.label : '',
    });
  }
  return out;
}

/** The optional voice fields of a dialogue or a question: left out they mean the default voice, pitch and speed. */
function voiceFields(x: Record<string, unknown>): { voice?: string; pitch?: number; speed?: number } {
  const out: { voice?: string; pitch?: number; speed?: number } = {};
  if (typeof x.voice === 'string' && x.voice) out.voice = x.voice;
  if (typeof x.pitch === 'number' && Number.isFinite(x.pitch) && x.pitch !== 1) out.pitch = Math.min(MAX_VOICE_PITCH, Math.max(MIN_VOICE_PITCH, x.pitch));
  if (typeof x.speed === 'number' && Number.isFinite(x.speed) && x.speed !== DEFAULT_TEXT_SPEED) out.speed = Math.min(MAX_TEXT_SPEED, Math.max(0, x.speed));
  return out;
}

function normalizeAction(a: unknown): Action | null {
  const x = a as Partial<Action> & Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (x?.type) {
    case 'set':
    case 'add':
      return typeof x.variable === 'string' ? { type: x.type, variable: x.variable, value: num(x.value, 0) } : null;
    case 'message':
      return { type: 'message', text: str(x.text), seconds: Math.max(0.2, num(x.seconds, 2)) };
    case 'sound':
      return { type: 'sound', sound: str(x.sound) };
    case 'destroy':
      return typeof x.target === 'string' && x.target ? { type: 'destroy', target: x.target } : { type: 'destroy' };
    case 'move':
    case 'patrol': {
      const o = Array.isArray(x.offset) && x.offset.length === 3 && x.offset.every((n) => Number.isFinite(n)) ? (x.offset as Vec3) : [0, 2, 0];
      const offset: Vec3 = [o[0]!, o[1]!, o[2]!];
      // a patrol needs time to go anywhere; a move may be instant
      return x.type === 'patrol'
        ? { type: 'patrol', target: str(x.target), offset, seconds: Math.max(0.2, num(x.seconds, 3)) }
        : { type: 'move', target: str(x.target), offset, seconds: Math.max(0, num(x.seconds, 1)) };
    }
    case 'animate':
      return { type: 'animate', target: str(x.target), animation: str(x.animation) };
    case 'end':
      return { type: 'end', title: str(x.title) || 'The end', text: str(x.text) };
    case 'level':
      return { type: 'level', level: str(x.level) };
    case 'chase':
      return { type: 'chase', target: str(x.target), speed: Math.min(20, Math.max(0.1, num(x.speed, 2.5))), range: Math.min(80, Math.max(1, num(x.range, 10))) };
    case 'hurt':
      return {
        type: 'hurt',
        amount: Math.max(0, num(x.amount, 1)),
        variable: str(x.variable) || 'health',
        knockback: Math.min(30, Math.max(0, num(x.knockback, 6))),
      };
    case 'bounce':
      return { type: 'bounce', strength: Math.min(30, Math.max(2, num(x.strength, 10))) };
    case 'dialogue': {
      const lines = Array.isArray(x.lines) ? x.lines.filter((l): l is string => typeof l === 'string') : [];
      return { type: 'dialogue', speaker: str(x.speaker), lines: lines.length > 0 ? lines : ['...'], ...voiceFields(x) };
    }
    case 'choice': {
      const options: ChoiceOption[] = [];
      for (const o of Array.isArray(x.options) ? (x.options as Partial<ChoiceOption>[]) : []) {
        if (!o || typeof o !== 'object' || options.length >= 4) continue;
        const inner = (Array.isArray(o.actions) ? o.actions : []).map(normalizeAction).filter((a): a is Action => a !== null && a.type !== 'choice');
        options.push({ label: str(o.label) || 'Answer', actions: inner });
      }
      return {
        type: 'choice',
        question: str(x.question),
        options: options.length > 0 ? options : [{ label: 'OK', actions: [] }],
        ...(str(x.speaker) ? { speaker: str(x.speaker) } : {}),
        ...voiceFields(x),
      };
    }
    case 'respawn':
    case 'checkpoint':
    case 'restart':
      return { type: x.type };
    default:
      return null;
  }
}

export function normalizeRules(raw: unknown, idGen: () => string): Rule[] {
  if (!Array.isArray(raw)) return [];
  const out: Rule[] = [];
  for (const r of raw as Partial<Rule>[]) {
    if (!r || !EVENTS.has(r.event as string)) continue;
    const conditions: Condition[] = [];
    for (const c of Array.isArray(r.conditions) ? r.conditions : []) {
      if (c && typeof c.variable === 'string' && OPS.has(c.op as string)) {
        conditions.push({ variable: c.variable, op: c.op, value: num(c.value, 0) });
      }
    }
    const actions = (Array.isArray(r.actions) ? r.actions : []).map(normalizeAction).filter((a): a is Action => a !== null);
    const rule: Rule = { id: typeof r.id === 'string' ? r.id : idGen(), event: r.event as RuleEvent, conditions, actions };
    if (r.event === 'timer') {
      rule.seconds = Math.max(0.1, num(r.seconds, 5));
      if (r.repeat === true) rule.repeat = true;
    }
    out.push(rule);
  }
  return out;
}

/** Rename a variable in a list of actions (and in the actions of answers). Returns how many references changed. */
function renameInActions(actions: Action[], from: string, to: string): number {
  let n = 0;
  const token = `{${from}}`;
  const swap = (text: string) => text.split(token).join(`{${to}}`);
  const has = (text: string) => text.includes(token);
  for (const a of actions) {
    if ((a.type === 'set' || a.type === 'add') && a.variable === from) {
      a.variable = to;
      n++;
    } else if (a.type === 'hurt' && a.variable === from) {
      a.variable = to;
      n++;
    } else if (a.type === 'message' && has(a.text)) {
      a.text = swap(a.text);
      n++;
    } else if (a.type === 'end' && (has(a.text) || has(a.title))) {
      a.text = swap(a.text);
      a.title = swap(a.title);
      n++;
    } else if (a.type === 'dialogue' && (has(a.speaker) || a.lines.some(has))) {
      a.speaker = swap(a.speaker);
      a.lines = a.lines.map(swap);
      n++;
    } else if (a.type === 'choice') {
      if (has(a.question)) {
        a.question = swap(a.question);
        n++;
      }
      if (a.speaker && has(a.speaker)) {
        a.speaker = swap(a.speaker);
        n++;
      }
      for (const o of a.options) {
        if (has(o.label)) {
          o.label = swap(o.label);
          n++;
        }
        n += renameInActions(o.actions, from, to);
      }
    }
  }
  return n;
}

/** Rename a variable everywhere rules mention it. Returns how many references changed. */
export function renameVariableInRules(rules: Rule[], from: string, to: string): number {
  let n = 0;
  for (const r of rules) {
    for (const c of r.conditions) {
      if (c.variable === from) {
        c.variable = to;
        n++;
      }
    }
    n += renameInActions(r.actions, from, to);
  }
  return n;
}

/** Names of the variables a rule list reads or writes. */
export function variablesUsed(rules: Rule[]): Set<string> {
  const out = new Set<string>();
  const visit = (actions: Action[]) => {
    for (const a of actions) {
      if (a.type === 'set' || a.type === 'add' || a.type === 'hurt') out.add(a.variable);
      else if (a.type === 'choice') for (const o of a.options) visit(o.actions);
    }
  };
  for (const r of rules) {
    for (const c of r.conditions) out.add(c.variable);
    visit(r.actions);
  }
  return out;
}

/** The text of a variable on the HUD: "🪙 Coins 3" (with "/ max" when there is a max). */
export function hudText(v: Variable, value: number): string {
  const name = v.label.trim() || v.name;
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const max = v.max !== null ? ` / ${Number.isInteger(v.max) ? v.max : v.max.toFixed(1)}` : '';
  return `${v.icon ? `${v.icon} ` : ''}${name}: ${shown}${max}`;
}
