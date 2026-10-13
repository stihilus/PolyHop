import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK, SKY_PRESETS, SKY_STYLES, normalizeLook } from '../src/core/look';
import { createDefaultProject, normalizeProject } from '../src/core/types';
import { Store } from '../src/editor/store';
import { createEnvironment } from '../src/runtime/environment';
import { SKY_HEIGHT, SKY_WIDTH, fogDepth, fogOverPixels, parseHex, skyCoverage, skyPixels, toHex } from '../src/runtime/skyboxes';

const px = (data: Uint8ClampedArray, w: number, x: number, y: number) => [data[(y * w + x) * 4]!, data[(y * w + x) * 4 + 1]!, data[(y * w + x) * 4 + 2]!];

describe('sky and fog in the look of a level', () => {
  it('has defaults: a flat color sky and a fog that follows it', () => {
    const l = normalizeLook(undefined);
    expect(l.skyStyle).toBe('color');
    expect(l.fogColor).toBeNull();
    expect(l.fogSky).toBe(DEFAULT_LOOK.fogSky);
    expect(l.skyTexture).toBeNull();
    expect(l.skyTop).toBe(DEFAULT_LOOK.skyTop);
  });

  it('keeps a good style, texture and colors and drops bad ones', () => {
    const l = normalizeLook({ skyStyle: 'texture', skyTexture: 'Sky.png', skyTop: '#102030', fogColor: '#aa5522' });
    expect(l).toMatchObject({ skyStyle: 'texture', skyTexture: 'Sky.png', skyTop: '#102030', fogColor: '#aa5522' });
    const bad = normalizeLook({ skyStyle: 'rainbow', skyTexture: 5, skyTop: 'blue', fogColor: 'red' });
    expect(bad.skyStyle).toBe('color');
    expect(bad.skyTexture).toBeNull();
    expect(bad.skyTop).toBe(DEFAULT_LOOK.skyTop);
    expect(bad.fogColor).toBeNull();
    expect(normalizeLook({ fogSky: 7 }).fogSky).toBe(1);
    expect(normalizeLook({ fogSky: -1 }).fogSky).toBe(0);
    expect(SKY_STYLES.map((s) => s.value)).toEqual(['color', 'gradient', 'clouds', 'stars', 'texture']);
  });

  it('is kept by each level of a project', () => {
    const p = createDefaultProject();
    p.levels[0]!.look = { ...p.levels[0]!.look, skyStyle: 'stars', fogColor: '#334455' };
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.levels[0]!.look.skyStyle).toBe('stars');
    expect(back.levels[0]!.look.fogColor).toBe('#334455');
    // a project from before skies loads with the plain sky
    const old = normalizeProject({ levels: [{ name: 'A', objects: [], look: { fogNear: 10, fogFar: 40 } }] });
    expect(old.levels[0]!.look.skyStyle).toBe('color');
  });

  it('a time of day sets sky, style and light in one undo step', () => {
    const store = new Store(createDefaultProject());
    store.level.look.fogColor = '#ff0000';
    store.lookChanged();
    const before = JSON.stringify(store.level);
    const night = SKY_PRESETS.find((p) => p.id === 'night')!;
    store.applySkyPreset(night);
    expect(store.level.sky).toBe(night.sky);
    expect(store.level.look.skyStyle).toBe('stars');
    expect(store.level.look.sunIntensity).toBeCloseTo(0.55);
    // a time of day has its own fog: the one that was set is gone
    expect(store.level.look.fogColor).toBeNull();
    store.undoLevel();
    expect(JSON.stringify(store.level)).toBe(before);
  });

  it('every time of day is a valid look', () => {
    for (const p of SKY_PRESETS) {
      expect(/^#[0-9a-f]{6}$/i.test(p.sky)).toBe(true);
      const l = normalizeLook({ ...DEFAULT_LOOK, ...p.look });
      expect(l.skyStyle).toBe(p.look.skyStyle);
      expect(l.sunIntensity).toBe(p.look.sunIntensity);
    }
  });
});

describe('fog over the sky', () => {
  it('is full at the horizon and clears toward straight up', () => {
    const tau = 0.4;
    expect(skyCoverage(0, tau)).toBeGreaterThan(0.99);
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const c10 = skyCoverage(rad(10), tau);
    const c30 = skyCoverage(rad(30), tau);
    const c90 = skyCoverage(rad(90), tau);
    expect(c10).toBeGreaterThan(c30);
    expect(c30).toBeGreaterThan(c90);
    expect(c90).toBeGreaterThan(0);
    expect(c90).toBeLessThan(0.5);
    // below the horizon is the same as above it
    expect(skyCoverage(-rad(30), tau)).toBeCloseTo(c30, 9);
    expect(skyCoverage(rad(45), 0)).toBe(0);
  });

  it('grows with the setting and with thicker fog, and a faraway fog is almost none', () => {
    expect(fogDepth(0, 100)).toBe(0);
    expect(fogDepth(0.6, 100)).toBeGreaterThan(fogDepth(0.3, 100));
    expect(fogDepth(0.3, 20)).toBeGreaterThan(fogDepth(0.3, 160));
    expect(fogDepth(0.3, 100000)).toBeLessThan(0.001);
    expect(fogDepth(9, 50)).toBe(fogDepth(1, 50));
    // 1 hides the whole sky
    expect(skyCoverage((80 * Math.PI) / 180, fogDepth(1, 100))).toBeGreaterThan(0.99);
  });

  it('colors the rows of a picture toward the fog, most at the middle', () => {
    const w = 4;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    fogOverPixels(data, w, h, [200, 100, 50], 0.3);
    const red = (y: number) => data[(y * w) * 4]!;
    // the rows next to the horizon (3 and 4) have gone furthest, the outer rows least
    expect(red(3)).toBeGreaterThan(red(1));
    expect(red(1)).toBeGreaterThan(red(0));
    expect(red(4)).toBe(red(3));
    expect(red(7)).toBe(red(0));
    expect(data[3]).toBe(255);
  });

  it('a generated sky is covered up to the clouds and the stars', () => {
    const horizon = parseHex('#bfe0f5');
    const top = parseHex('#2040a0');
    const clear = skyPixels('gradient', 64, 64, horizon, top, horizon, 1, 0);
    const hazy = skyPixels('gradient', 64, 64, horizon, top, horizon, 1, 0.5);
    // at the very top the clear sky is the top color and the hazy one has moved toward the fog
    expect(clear[0]).toBe(top[0]);
    expect(hazy[0]).toBeGreaterThan(clear[0]!);
    expect(hazy[0]).toBeLessThanOrEqual(horizon[0]);
  });
});

describe('generated skies', () => {
  const horizon = parseHex('#ffd7b0');
  const top = parseHex('#2040a0');
  const fog = parseHex('#ffd7b0');

  it('colors convert both ways', () => {
    expect(toHex(parseHex('#12ab9f'))).toBe('#12ab9f');
    expect(parseHex('nonsense')).toHaveLength(3);
  });

  it('a gradient goes from the top color to the horizon and is fog colored below it', () => {
    const d = skyPixels('gradient', SKY_WIDTH, SKY_HEIGHT, horizon, top, fog);
    expect(px(d, SKY_WIDTH, 5, 0)).toEqual(top);
    // brighter toward the horizon (red grows from the top color's red)
    const mid = px(d, SKY_WIDTH, 5, SKY_HEIGHT / 4)[0]!;
    expect(mid).toBeGreaterThan(top[0]);
    expect(mid).toBeLessThan(horizon[0]);
    // just above the horizon: it has become the fog
    const near = px(d, SKY_WIDTH, 5, SKY_HEIGHT / 2 - 1);
    expect(Math.abs(near[0]! - fog[0])).toBeLessThan(6);
    // below the horizon: fog
    expect(px(d, SKY_WIDTH, 5, SKY_HEIGHT - 1)).toEqual(fog);
    expect(px(d, SKY_WIDTH, 100, SKY_HEIGHT - 1)).toEqual(fog);
    expect(d[3]).toBe(255);
  });

  it('a gradient is the same all the way round', () => {
    const d = skyPixels('gradient', 64, 32, horizon, top, fog);
    for (let y = 0; y < 32; y++) expect(px(d, 64, 0, y)).toEqual(px(d, 64, 63, y));
  });

  it('clouds are white patches on the gradient, in the middle band, and wrap around', () => {
    const plain = skyPixels('gradient', SKY_WIDTH, SKY_HEIGHT, horizon, top, fog, 4);
    const clouds = skyPixels('clouds', SKY_WIDTH, SKY_HEIGHT, horizon, top, fog, 4);
    let changed = 0;
    let rows = new Set<number>();
    for (let y = 0; y < SKY_HEIGHT; y++) {
      for (let x = 0; x < SKY_WIDTH; x++) {
        const i = (y * SKY_WIDTH + x) * 4;
        if (plain[i] !== clouds[i] || plain[i + 2] !== clouds[i + 2]) {
          changed++;
          rows.add(y);
        }
      }
    }
    // some of the sky is cloud, but not most of it
    expect(changed / (SKY_WIDTH * SKY_HEIGHT / 2)).toBeGreaterThan(0.03);
    expect(changed / (SKY_WIDTH * SKY_HEIGHT / 2)).toBeLessThan(0.6);
    // none right at the top or below the horizon
    expect(rows.has(0)).toBe(false);
    expect(Math.max(...rows)).toBeLessThan(SKY_HEIGHT / 2);
    // the seam: what is at the right edge continues into the left edge
    let jump = 0;
    for (let y = 0; y < SKY_HEIGHT / 2; y++) jump = Math.max(jump, Math.abs(px(clouds, SKY_WIDTH, 0, y)[0]! - px(clouds, SKY_WIDTH, SKY_WIDTH - 1, y)[0]!));
    expect(jump).toBeLessThan(120);
    // deterministic
    expect(Array.from(skyPixels('clouds', SKY_WIDTH, SKY_HEIGHT, horizon, top, fog, 4))).toEqual(Array.from(clouds));
  });

  it('stars are bright dots in the upper half only', () => {
    const night: [number, number, number] = [10, 14, 30];
    const d = skyPixels('stars', SKY_WIDTH, SKY_HEIGHT, parseHex('#1c2540'), night, parseHex('#1c2540'), 2);
    let bright = 0;
    for (let y = 0; y < SKY_HEIGHT; y++) {
      for (let x = 0; x < SKY_WIDTH; x++) {
        if (px(d, SKY_WIDTH, x, y)[0]! > 120) {
          bright++;
          expect(y).toBeLessThan(SKY_HEIGHT / 2);
        }
      }
    }
    expect(bright).toBeGreaterThan(40);
    expect(bright).toBeLessThan(2000);
  });
});

describe('the environment takes a level', () => {
  const canvases: object[] = [];
  beforeAll(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('document', {
      createElement: () => {
        const c = {
          width: 0,
          height: 0,
          getContext: () => ({
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
            putImageData: () => undefined,
          }),
        };
        canvases.push(c);
        return c;
      },
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  it('a flat sky is a color and the fog follows it, or has its own', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    env.setLevel({ sky: '#102030', look: { ...DEFAULT_LOOK } });
    expect((scene.background as THREE.Color).getHexString()).toBe('102030');
    expect(env.fog.color.getHexString()).toBe('102030');
    env.setLevel({ sky: '#102030', look: { ...DEFAULT_LOOK, fogColor: '#aa5522', fogSky: 0 } });
    expect((scene.background as THREE.Color).getHexString()).toBe('102030');
    expect(env.fog.color.getHexString()).toBe('aa5522');
  });

  it('a fog of its own color is laid over a flat sky too: it becomes a gradient down into the fog', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    env.setLevel({ sky: '#102030', look: { ...DEFAULT_LOOK, fogColor: '#aa5522', fogSky: 0.5 } });
    expect((scene.background as THREE.Texture).isTexture).toBe(true);
    expect(env.fog.color.getHexString()).toBe('aa5522');
    // no fog over the sky, or a fog like the sky: nothing to lay over it
    env.setLevel({ sky: '#102030', look: { ...DEFAULT_LOOK, fogSky: 0.5 } });
    expect(scene.background instanceof THREE.Color).toBe(true);
  });

  it('a level without fog has no haze either, and thick fog covers more', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    const base = { ...DEFAULT_LOOK, skyStyle: 'gradient' as const, skyTop: '#2040a0', fogSky: 0.5 };
    env.setLevel({ sky: '#bfe0f5', look: base });
    const a = scene.background as THREE.Texture;
    env.setLevel({ sky: '#bfe0f5', look: { ...base, fogNear: 1, fogFar: 15 } });
    const b = scene.background as THREE.Texture;
    expect(b).not.toBe(a);
  });

  it('a generated sky is a wide picture behind the world, made once for the same colors', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    const level = { sky: '#ffd7b0', look: { ...DEFAULT_LOOK, skyStyle: 'clouds' as const, skyTop: '#2040a0' } };
    env.setLevel(level);
    const bg = scene.background as THREE.Texture;
    expect(bg.isTexture).toBe(true);
    expect(bg.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(env.fog.color.getHexString()).toBe('ffd7b0');
    const made = canvases.length;
    env.setLevel(level);
    expect(scene.background).toBe(bg);
    expect(canvases.length).toBe(made);
    // another top color makes another sky; a fog color of its own is where the sky melts into
    env.setLevel({ ...level, look: { ...level.look, fogColor: '#334455' } });
    expect(scene.background).not.toBe(bg);
    expect(env.fog.color.getHexString()).toBe('334455');
    // and a flat sky again takes the picture away
    env.setLevel({ sky: '#000000', look: { ...DEFAULT_LOOK } });
    expect(scene.background instanceof THREE.Color).toBe(true);
  });

  it('a picture sky uses a texture of the project, and falls back to the color without one', () => {
    const scene = new THREE.Scene();
    const env = createEnvironment(scene);
    const tex = new THREE.Texture();
    const level = { sky: '#8fc0ee', look: { ...DEFAULT_LOOK, skyStyle: 'texture' as const, skyTexture: 'Sky.png', fogColor: '#445566' } };
    env.setLevel(level, { get: (n) => (n === 'Sky.png' ? { texture: tex } : null) });
    const bg = scene.background as THREE.Texture;
    expect(bg.isTexture).toBe(true);
    expect(bg).not.toBe(tex); // a copy: the mapping of the original is not touched
    expect(bg.mapping).toBe(THREE.EquirectangularReflectionMapping);
    expect(tex.mapping).not.toBe(THREE.EquirectangularReflectionMapping);
    expect(env.fog.color.getHexString()).toBe('445566');
    // the picture is gone: the sky color, with the fog laid down into it
    env.setLevel(level, { get: () => null });
    expect((scene.background as THREE.Texture).isTexture).toBe(true);
    expect(env.fog.color.getHexString()).toBe('445566');
    env.setLevel({ ...level, look: { ...level.look, fogSky: 0 } }, { get: () => null });
    expect((scene.background as THREE.Color).getHexString()).toBe('8fc0ee');
  });
});
