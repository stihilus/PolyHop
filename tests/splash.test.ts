import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SPLASH_SECONDS,
  MAX_SPLASH_SECONDS,
  MIN_SPLASH_SECONDS,
  SPLASH_MAX_HEIGHT,
  SPLASH_MAX_WIDTH,
  fitSplash,
  isImageDataUrl,
  normalizeSplash,
} from '../src/core/splash';
import { createDefaultProject, normalizeProject } from '../src/core/types';
import { pruneForExport } from '../src/core/exportProject';
import { showSplash } from '../src/runtime/splash';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('splash screen data', () => {
  it('accepts a picture as a data URL and cleans the numbers', () => {
    expect(isImageDataUrl(PNG)).toBe(true);
    expect(isImageDataUrl('https://example.com/a.png')).toBe(false);
    expect(isImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isImageDataUrl('data:image/svg+xml;base64,AAAA')).toBe(false);
    const s = normalizeSplash({ image: PNG, seconds: 99, background: 'red' })!;
    expect(s.seconds).toBe(MAX_SPLASH_SECONDS);
    expect(s.background).toBe('#000000');
    expect(normalizeSplash({ image: PNG, seconds: 0 })!.seconds).toBe(MIN_SPLASH_SECONDS);
    expect(normalizeSplash({ image: PNG })!.seconds).toBe(DEFAULT_SPLASH_SECONDS);
    expect(normalizeSplash({ image: PNG, background: '#112233' })!.background).toBe('#112233');
    expect(normalizeSplash({ image: 'nope' })).toBeUndefined();
    expect(normalizeSplash(null)).toBeUndefined();
  });

  it('makes big pictures fit and leaves small ones alone', () => {
    expect(fitSplash(640, 360)).toEqual({ width: 640, height: 360 });
    const big = fitSplash(3840, 2160);
    expect(big.width).toBeLessThanOrEqual(SPLASH_MAX_WIDTH);
    expect(big.height).toBeLessThanOrEqual(SPLASH_MAX_HEIGHT);
    expect(big.width / big.height).toBeCloseTo(16 / 9, 1);
    const tall = fitSplash(500, 4000);
    expect(tall.height).toBe(SPLASH_MAX_HEIGHT);
  });

  it('is part of the project settings, survives a save, and goes into an export', () => {
    const p = createDefaultProject();
    expect(p.settings.splash).toBeUndefined();
    p.settings.splash = { image: PNG, seconds: 4, background: '#223344' };
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.settings.splash).toEqual(p.settings.splash);
    expect(pruneForExport(p).settings.splash).toEqual(p.settings.splash);
    // a broken picture in a file is dropped, not kept
    const bad = normalizeProject({ settings: { splash: { image: '<script>', seconds: 2 } } });
    expect(bad.settings.splash).toBeUndefined();
  });
});

describe('showing the splash screen', () => {
  interface FakeNode {
    style: Record<string, string>;
    children: FakeNode[];
    listeners: Record<string, (() => void)[]>;
    naturalWidth?: number;
    removed?: boolean;
    src?: string;
    append(...n: FakeNode[]): void;
    remove(): void;
    addEventListener(type: string, fn: () => void): void;
  }
  const node = (): FakeNode => ({
    style: {},
    children: [],
    listeners: {},
    append(...n) {
      this.children.push(...n);
    },
    remove() {
      this.removed = true;
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
  });
  let windowListeners: Record<string, ((e?: unknown) => void)[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    windowListeners = {};
    vi.stubGlobal('document', { createElement: () => node() });
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16),
      addEventListener: (type: string, fn: () => void) => (windowListeners[type] ??= []).push(fn),
      removeEventListener: (type: string, fn: () => void) => {
        windowListeners[type] = (windowListeners[type] ?? []).filter((f) => f !== fn);
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays for the time of the splash and then is gone', () => {
    const parent = node();
    const done = vi.fn();
    showSplash(parent as unknown as HTMLElement, { image: PNG, seconds: 2, background: '#102030' }, done);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]!.style.background).toBe('#102030');
    vi.advanceTimersByTime(2000);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(parent.children[0]!.removed).toBe(true);
  });

  it('is skipped by a click or a key, once', () => {
    const parent = node();
    const done = vi.fn();
    showSplash(parent as unknown as HTMLElement, { image: PNG, seconds: 8, background: '#000000' }, done);
    vi.advanceTimersByTime(300);
    // a key press
    for (const fn of windowListeners.keydown ?? []) fn();
    for (const fn of parent.children[0]!.listeners.pointerdown ?? []) fn();
    vi.advanceTimersByTime(1000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(windowListeners.keydown ?? []).toHaveLength(0);
  });

  it('the function it returns ends it at once', () => {
    const parent = node();
    const done = vi.fn();
    const end = showSplash(parent as unknown as HTMLElement, { image: PNG, seconds: 8, background: '#000000' }, done);
    end();
    vi.advanceTimersByTime(600);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
