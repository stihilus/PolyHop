import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneForExport } from '../src/core/exportProject';
import {
  DEFAULT_MENU,
  MAX_LABEL_CHARS,
  MAX_LOGO_SIZE,
  MIN_LOGO_SIZE,
  normalizeMenu,
  resolveMenu,
  textOn,
} from '../src/core/menu';
import { fitWithin } from '../src/core/splash';
import { createDefaultProject, normalizeProject } from '../src/core/types';
import { menuBackdrop, menuContent } from '../src/runtime/menu';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('menu screen data', () => {
  it('says nothing when it is the plain menu, so projects that never touched it stay as they were', () => {
    expect(normalizeMenu(undefined)).toBeUndefined();
    expect(normalizeMenu({})).toBeUndefined();
    expect(normalizeMenu({ ...DEFAULT_MENU })).toBeUndefined();
    expect(resolveMenu(undefined)).toEqual(DEFAULT_MENU);
  });

  it('keeps a logo (a picture data URL only) and cleans every number, color and word', () => {
    const m = normalizeMenu({ logo: PNG, logoSize: 400, background: 'color', backgroundColor: '#ABCDEF', accent: 'red', startLabel: '  Play   now  ', settingsLabel: '' })!;
    expect(m.logo).toBe(PNG);
    expect(m.logoSize).toBe(MAX_LOGO_SIZE);
    expect(m.background).toBe('color');
    expect(m.backgroundColor).toBe('#abcdef');
    expect(m.accent).toBe(DEFAULT_MENU.accent);
    expect(m.startLabel).toBe('Play now');
    expect(m.settingsLabel).toBe(DEFAULT_MENU.settingsLabel);
    expect(normalizeMenu({ logo: PNG, logoSize: -3 })!.logoSize).toBe(MIN_LOGO_SIZE);
    expect(normalizeMenu({ startLabel: 'x'.repeat(100) })!.startLabel).toHaveLength(MAX_LABEL_CHARS);
    // anything that is not a picture is dropped
    expect(normalizeMenu({ logo: '<script>alert(1)</script>', startLabel: 'Go' })!.logo).toBeUndefined();
    expect(normalizeMenu({ logo: 'data:image/svg+xml;base64,AAAA', startLabel: 'Go' })!.logo).toBeUndefined();
  });

  it('a picture background needs its picture', () => {
    expect(normalizeMenu({ background: 'picture', accent: '#112233' })!.background).toBe('dim');
    const m = normalizeMenu({ background: 'picture', backgroundImage: PNG })!;
    expect(m.background).toBe('picture');
    expect(m.backgroundImage).toBe(PNG);
  });

  it('is part of the project settings, survives a save and goes into an export', () => {
    const p = createDefaultProject();
    expect(p.settings.menu).toBeUndefined();
    p.settings.menu = { ...DEFAULT_MENU, logo: PNG, startLabel: 'Play' };
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.settings.menu).toEqual(p.settings.menu);
    expect(pruneForExport(p).settings.menu).toEqual(p.settings.menu);
    expect(normalizeProject({ settings: { menu: { logo: 'nope' } } }).settings.menu).toBeUndefined();
  });

  it('picks text that can be read on the color of a button', () => {
    expect(textOn('#ffb23e')).toBe('#1b1e25');
    expect(textOn('#ffffff')).toBe('#1b1e25');
    expect(textOn('#102040')).toBe('#ffffff');
    expect(textOn('not a color')).toBe('#1b1e25');
  });

  it('brings a picture down to a box and never makes it bigger', () => {
    expect(fitWithin(500, 200, 1024, 512)).toEqual({ width: 500, height: 200 });
    expect(fitWithin(2048, 512, 1024, 512)).toEqual({ width: 1024, height: 256 });
    expect(fitWithin(0, 10, 100, 100)).toEqual({ width: 1, height: 1 });
  });
});

describe('the menu screen of the game', () => {
  interface FakeNode {
    tag: string;
    style: Record<string, string>;
    children: (FakeNode | string)[];
    listeners: Record<string, (() => void)[]>;
    textContent: string;
    naturalWidth?: number;
    src?: string;
    alt?: string;
    append(...n: (FakeNode | string)[]): void;
    addEventListener(type: string, fn: () => void): void;
  }
  const node = (tag = 'div'): FakeNode => ({
    tag,
    style: {},
    children: [],
    listeners: {},
    textContent: '',
    append(...n) {
      this.children.push(...n);
    },
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
  });
  const texts = (n: FakeNode | string): string[] =>
    typeof n === 'string' ? [n] : [...(n.textContent ? [n.textContent] : []), ...n.children.flatMap(texts)];
  const find = (n: FakeNode | string, pred: (x: FakeNode) => boolean): FakeNode[] =>
    typeof n === 'string' ? [] : [...(pred(n) ? [n] : []), ...n.children.flatMap((c) => find(c, pred))];

  beforeEach(() => {
    vi.stubGlobal('document', { createElement: (tag: string) => node(tag) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the title when there is no logo, then Start game and Settings', () => {
    const start = vi.fn();
    const settings = vi.fn();
    const root = menuContent({ menu: resolveMenu(undefined), title: 'My Quest', paused: false, onStart: start, onSettings: settings }) as unknown as FakeNode;
    expect(texts(root)).toEqual(['My Quest', 'Start game', 'Settings']);
    const buttons = find(root, (n) => n.tag === 'button');
    expect(buttons).toHaveLength(2);
    buttons[0]!.listeners.click![0]!();
    buttons[1]!.listeners.click![0]!();
    expect(start).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('shows the logo instead of the title, with the labels and the color the author chose', () => {
    const menu = resolveMenu({ logo: PNG, logoSize: 60, accent: '#3366cc', startLabel: 'Play', settingsLabel: 'Options' });
    const root = menuContent({ menu, title: 'My Quest', paused: false, onStart: () => undefined, onSettings: () => undefined, onFullscreen: () => undefined }) as unknown as FakeNode;
    const img = find(root, (n) => n.tag === 'img')[0]!;
    expect(img.src).toBe(PNG);
    expect(img.style.width).toBe('60%');
    expect(texts(root)).not.toContain('My Quest');
    expect(texts(root)).toEqual(['Play', 'Options', 'Fullscreen']);
    const first = find(root, (n) => n.tag === 'button')[0]!;
    expect(first.style.background).toBe('#3366cc');
    expect(first.style.color).toBe('#ffffff');
  });

  it('says Continue and Paused when the game is paused', () => {
    const root = menuContent({ menu: resolveMenu(undefined), title: 'G', paused: true, onStart: () => undefined, onSettings: () => undefined }) as unknown as FakeNode;
    expect(texts(root)).toContain('Continue');
    expect(texts(root)).toContain('Paused');
    expect(texts(root)).not.toContain('Start game');
  });

  it('sits on the dimmed game, a color or a picture; a paused game is always dimmed', () => {
    const dim = 'rgba(20, 22, 27, 0.86)';
    expect(menuBackdrop(resolveMenu(undefined), false).background).toBe(dim);
    const color = resolveMenu({ background: 'color', backgroundColor: '#224466' });
    expect(menuBackdrop(color, false).background).toBe('#224466');
    expect(menuBackdrop(color, true).background).toBe(dim);
    const picture = resolveMenu({ background: 'picture', backgroundImage: PNG, backgroundColor: '#000000' });
    expect(menuBackdrop(picture, false).background).toContain(`url("${PNG}")`);
    expect(menuBackdrop(picture, true).background).toBe(dim);
  });
});
