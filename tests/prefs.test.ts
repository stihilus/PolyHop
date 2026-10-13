import { describe, expect, it } from 'vitest';
import {
  type KeyValueStorage,
  type PlayerPrefs,
  RESERVED_KEYS,
  SENSITIVITY_MAX,
  controlsDiff,
  loadPrefs,
  normalizePrefs,
  prefsKey,
  rebindKey,
  resolveSettings,
  savePrefs,
} from '../src/runtime/prefs';
import { DEFAULT_CONTROLS, createDefaultProject } from '../src/core/types';

const memory = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

describe('player preferences', () => {
  it('drops what is broken and clamps what is out of range', () => {
    const prefs = normalizePrefs({
      volume: 7,
      muted: 'yes',
      mouseSensitivity: 100,
      invertY: true,
      renderScale: 0.77,
      controls: { jump: ['KeyZ'], forward: [], run: 5, bogus: ['KeyQ'] },
    });
    expect(prefs.volume).toBe(1);
    expect(prefs.muted).toBeUndefined();
    expect(prefs.mouseSensitivity).toBe(SENSITIVITY_MAX);
    expect(prefs.invertY).toBe(true);
    expect(prefs.renderScale).toBeUndefined();
    expect(prefs.controls).toEqual({ jump: ['KeyZ'] });
    expect(normalizePrefs(null)).toEqual({});
    expect(normalizePrefs('x')).toEqual({});
  });

  it('keys that always mean something are not accepted', () => {
    const prefs = normalizePrefs({ controls: { jump: ['Escape', 'KeyM', 'Digit2'], run: ['Escape', 'KeyX'] } });
    expect(prefs.controls).toEqual({ run: ['KeyX'] });
    for (const k of RESERVED_KEYS) expect(DEFAULT_CONTROLS.jump).not.toContain(k);
  });

  it('lays the choices over the settings of the author', () => {
    const base = createDefaultProject().settings;
    const prefs: PlayerPrefs = { volume: 0.25, mouseSensitivity: 2, invertY: true, renderScale: 0.5, controls: { jump: ['KeyJ'] } };
    const s = resolveSettings(base, prefs);
    expect(s.volume).toBe(0.25);
    expect(s.mouseSensitivity).toBe(2);
    expect(s.invertY).toBe(true);
    expect(s.renderScale).toBe(0.5);
    expect(s.controls.jump).toEqual(['KeyJ']);
    expect(s.controls.forward).toEqual(base.controls.forward);
    // the author's settings are not touched
    expect(base.controls.jump).toEqual(DEFAULT_CONTROLS.jump);
    expect(resolveSettings(base, {})).toEqual(base);
  });

  it('a key moved to another action leaves no action without a key', () => {
    const c = structuredClone(DEFAULT_CONTROLS);
    const next = rebindKey(c, 'jump', 'KeyE');
    expect(next.jump).toEqual(['KeyE']);
    // interact had E: it takes the key jump gave up
    expect(next.interact).toEqual(['Space']);
    for (const key of Object.keys(next) as (keyof typeof next)[]) expect(next[key].length).toBeGreaterThan(0);
    // the input was not changed
    expect(c.jump).toEqual(['Space']);
  });

  it('a key that was one of two keys of another action just leaves it', () => {
    const next = rebindKey(structuredClone(DEFAULT_CONTROLS), 'jump', 'ArrowUp');
    expect(next.forward).toEqual(['KeyW']);
    expect(next.jump).toEqual(['ArrowUp']);
  });

  it('rebinding to a key the action has keeps nothing else of it', () => {
    const next = rebindKey(structuredClone(DEFAULT_CONTROLS), 'forward', 'ArrowUp');
    expect(next.forward).toEqual(['ArrowUp']);
  });

  it('stores only the differing controls', () => {
    const next = rebindKey(structuredClone(DEFAULT_CONTROLS), 'crouch', 'KeyX');
    expect(controlsDiff(DEFAULT_CONTROLS, next)).toEqual({ crouch: ['KeyX'] });
    expect(controlsDiff(DEFAULT_CONTROLS, DEFAULT_CONTROLS)).toEqual({});
  });

  it('saves, loads and forgets', () => {
    const storage = memory();
    const key = prefsKey('My Game');
    savePrefs(storage, key, { volume: 0.4, invertY: true });
    expect(loadPrefs(storage, key)).toEqual({ volume: 0.4, invertY: true });
    savePrefs(storage, key, {});
    expect(storage.data.size).toBe(0);
    expect(loadPrefs(storage, key)).toEqual({});
  });

  it('works without storage and with garbage in it', () => {
    expect(loadPrefs(null, 'k')).toEqual({});
    expect(() => savePrefs(null, 'k', { volume: 1 })).not.toThrow();
    const storage = memory();
    storage.setItem('k', '{not json');
    expect(loadPrefs(storage, 'k')).toEqual({});
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(loadPrefs(throwing, 'k')).toEqual({});
    expect(() => savePrefs(throwing, 'k', { volume: 1 })).not.toThrow();
  });
});
