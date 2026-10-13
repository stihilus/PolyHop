// What a player of an exported game can change for themselves: volume, mouse, keys and resolution.
// Kept in the browser's localStorage, per game. The author's settings are the defaults.

import { ACTIONS, type Action, type ProjectSettings, RENDER_SCALES } from '../core/types';

export type Controls = Record<Action, string[]>;

/** Only the fields the player changed are present. */
export interface PlayerPrefs {
  /** Master volume, 0..1. */
  volume?: number;
  muted?: boolean;
  /** 1 = as the author set it. */
  mouseSensitivity?: number;
  invertY?: boolean;
  renderScale?: number;
  controls?: Partial<Controls>;
}

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;

/** Keys that keep their meaning in every game (pause, mute, answers in a conversation). */
export const RESERVED_KEYS: readonly string[] = ['Escape', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Whatever was stored, as prefs: unknown or broken fields are dropped. */
export function normalizePrefs(raw: unknown): PlayerPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: PlayerPrefs = {};
  if (typeof r.volume === 'number' && Number.isFinite(r.volume)) out.volume = clamp(r.volume, 0, 1);
  if (typeof r.muted === 'boolean') out.muted = r.muted;
  if (typeof r.mouseSensitivity === 'number' && Number.isFinite(r.mouseSensitivity)) {
    out.mouseSensitivity = clamp(r.mouseSensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX);
  }
  if (typeof r.invertY === 'boolean') out.invertY = r.invertY;
  if (typeof r.renderScale === 'number' && RENDER_SCALES.includes(r.renderScale)) out.renderScale = r.renderScale;
  if (r.controls && typeof r.controls === 'object') {
    const src = r.controls as Record<string, unknown>;
    const controls: Partial<Controls> = {};
    for (const action of ACTIONS) {
      const keys = src[action];
      if (!Array.isArray(keys)) continue;
      const codes = keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length < 32 && !RESERVED_KEYS.includes(k));
      if (codes.length > 0) controls[action] = [...new Set(codes)].slice(0, 3);
    }
    if (Object.keys(controls).length > 0) out.controls = controls;
  }
  return out;
}

/** The author's settings with the player's choices on top. */
export function resolveSettings(settings: ProjectSettings, prefs: PlayerPrefs): ProjectSettings {
  const controls = structuredClone(settings.controls) as Controls;
  for (const action of ACTIONS) {
    const keys = prefs.controls?.[action];
    if (keys && keys.length > 0) controls[action] = [...keys];
  }
  return {
    ...settings,
    controls,
    volume: prefs.volume ?? settings.volume,
    mouseSensitivity: prefs.mouseSensitivity ?? settings.mouseSensitivity,
    invertY: prefs.invertY ?? settings.invertY,
    renderScale: prefs.renderScale ?? settings.renderScale,
  };
}

/**
 * Give `action` the key `code`. A key does one thing: an action that had it before takes over the key
 * `action` gave up, so no action is left without a key.
 */
export function rebindKey(controls: Controls, action: Action, code: string): Controls {
  const next = structuredClone(controls) as Controls;
  const given = controls[action].filter((c) => c !== code);
  next[action] = [code];
  for (const other of ACTIONS) {
    if (other === action || !next[other].includes(code)) continue;
    const rest = next[other].filter((c) => c !== code);
    if (rest.length === 0 && given.length > 0) rest.push(given[0]!);
    next[other] = rest;
  }
  return next;
}

/** Only what differs from the author's keys (so a later change of the defaults still reaches the player). */
export function controlsDiff(defaults: Controls, controls: Controls): Partial<Controls> {
  const out: Partial<Controls> = {};
  for (const action of ACTIONS) {
    const a = defaults[action];
    const b = controls[action];
    if (a.length !== b.length || a.some((c, i) => c !== b[i])) out[action] = [...b];
  }
  return out;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage, or null where the browser does not give it out (private mode, sandboxed frames). */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function prefsKey(gameName: string): string {
  return `polyhop:prefs:${gameName}`;
}

export function loadPrefs(storage: KeyValueStorage | null, key: string): PlayerPrefs {
  try {
    const text = storage?.getItem(key);
    return text ? normalizePrefs(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

export function savePrefs(storage: KeyValueStorage | null, key: string, prefs: PlayerPrefs): void {
  try {
    if (Object.keys(prefs).length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(prefs));
  } catch {
    // storage full or blocked: the settings simply last until the page is closed
  }
}
