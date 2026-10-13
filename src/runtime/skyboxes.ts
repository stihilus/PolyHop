// The sky behind a level, drawn as one wide picture (an equirectangular panorama: the left and right edges meet,
// the top is straight up, the middle is the horizon, the bottom half is "below the horizon" and is fog colored).
// The generated styles are made here, with no picture files: gradient, clouds and stars.

import { mulberry } from '../core/sfx';

export type RGB = [number, number, number];

export const SKY_WIDTH = 1024;
export const SKY_HEIGHT = 512;

export function parseHex(hex: string, fallback: RGB = [143, 192, 238]): RGB {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/**
 * How much of the sky at an elevation (radians above the horizon, either side) the fog covers, 0..1. The fog is a
 * layer of "optical depth" `tau` straight up: a ray at a low angle goes through more of it, so the horizon is
 * always fully fogged and the sky clears toward the zenith, the way real haze does.
 */
export function skyCoverage(elevation: number, tau: number): number {
  if (tau <= 0) return 0;
  const s = Math.max(0.03, Math.abs(Math.sin(elevation)));
  return 1 - Math.exp(-tau / s);
}

/**
 * The optical depth of the fog over the sky: the level's "fog over the sky" setting, made stronger by thick fog
 * (a short far distance) and weaker by a far one, so a level without fog has no haze either.
 */
export function fogDepth(fogSky: number, fogFar: number): number {
  const density = Math.max(0, Math.min(1.5, 120 / Math.max(1, fogFar)));
  return 8 * Math.pow(Math.max(0, Math.min(1, fogSky)), 3) * density;
}

/**
 * Blend the fog color over a wide picture, row by row: the middle row is the horizon, the top is straight up and
 * the bottom straight down (both clear toward the ends, full fog at the horizon).
 */
export function fogOverPixels(data: Uint8ClampedArray, width: number, height: number, fog: RGB, tau: number): void {
  if (tau <= 0) return;
  for (let y = 0; y < height; y++) {
    const elevation = (0.5 - (y + 0.5) / height) * Math.PI;
    const c = skyCoverage(elevation, tau);
    if (c <= 0.002) continue;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = data[i]! + (fog[0] - data[i]!) * c;
      data[i + 1] = data[i + 1]! + (fog[1] - data[i + 1]!) * c;
      data[i + 2] = data[i + 2]! + (fog[2] - data[i + 2]!) * c;
    }
  }
}

/** Value noise that wraps around horizontally (so the panorama has no seam). */
function makeNoise(seed: number, periodX: number, rows: number): (x: number, y: number) => number {
  const rnd = mulberry(seed);
  const table = Array.from({ length: periodX * (rows + 1) }, () => rnd());
  const at = (ix: number, iy: number) => table[Math.max(0, Math.min(rows, iy)) * periodX + (((ix % periodX) + periodX) % periodX)]!;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
    const b = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

/**
 * RGBA pixels of a generated sky. `horizon` is the color of the sky near the horizon, `top` straight up, and `fog`
 * the color below the horizon and in the last band above it (so distant, fogged things melt into the sky).
 */
export function skyPixels(
  style: 'gradient' | 'clouds' | 'stars',
  width: number,
  height: number,
  horizon: RGB,
  top: RGB,
  fog: RGB,
  seed = 1,
  /** The fog over the sky (see `fogDepth`): clouds and stars are covered too. */
  tau = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const half = height / 2;
  const rowColor: RGB[] = [];
  for (let y = 0; y < height; y++) {
    let c: RGB;
    if (y >= half) c = fog;
    else {
      const t = y / half; // 0 straight up .. 1 at the horizon
      c = mix(top, horizon, smooth(t));
      // the last stretch before the horizon is the fog color
      c = mix(c, fog, smooth((t - 0.82) / 0.18));
    }
    rowColor.push(c);
  }
  for (let y = 0; y < height; y++) {
    const c = rowColor[y]!;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }

  if (style === 'clouds') {
    const rows = 4;
    const cols = 10;
    const noise = makeNoise(seed * 13 + 3, cols, rows + 2);
    const fbm = (x: number, y: number) => {
      let sum = 0;
      let amp = 0.55;
      let norm = 0;
      let fx = 1;
      for (let o = 0; o < 3; o++) {
        sum += noise((x * fx) % (cols * fx), y * fx) * amp;
        norm += amp;
        amp *= 0.5;
        fx *= 2;
      }
      return sum / norm;
    };
    const white: RGB = mix([255, 255, 255], horizon, 0.18);
    const shade: RGB = mix(white, top, 0.38);
    const threshold = 0.53;
    for (let y = 0; y < half; y++) {
      const v = y / half; // 0 up .. 1 horizon
      // clouds hang in the middle band of the sky: not at the zenith, not in the haze at the horizon
      const band = smooth((v - 0.1) / 0.18) * (1 - smooth((v - 0.62) / 0.28));
      if (band <= 0) continue;
      for (let x = 0; x < width; x++) {
        const u = (x / width) * cols;
        const f = fbm(u, v * rows) * band;
        if (f < threshold) continue;
        // lit on the upper edge, shaded below
        const above = fbm(u, (v - 0.035) * rows) * band;
        const c = above < threshold ? white : mix(white, shade, smooth((f - threshold) / 0.12));
        const alpha = smooth((f - threshold) / 0.04);
        const i = (y * width + x) * 4;
        out[i] = out[i]! + (c[0] - out[i]!) * alpha;
        out[i + 1] = out[i + 1]! + (c[1] - out[i + 1]!) * alpha;
        out[i + 2] = out[i + 2]! + (c[2] - out[i + 2]!) * alpha;
      }
    }
  } else if (style === 'stars') {
    const rnd = mulberry(seed * 7 + 1);
    const stars = Math.round((width * height) / 380);
    for (let n = 0; n < stars; n++) {
      // an even spread over the upper half of the sphere (the panorama crowds the top, so the latitude is chosen first)
      const u = rnd();
      const lat = Math.asin(rnd() * 0.97); // 0 at the horizon .. up
      const v = 0.5 - lat / Math.PI;
      const x = Math.floor(u * width);
      const y = Math.floor(v * height);
      const bright = 0.45 + rnd() * 0.55;
      const tint: RGB = rnd() < 0.2 ? [255, 214, 170] : rnd() < 0.3 ? [180, 205, 255] : [255, 255, 255];
      const size = rnd() < 0.12 ? 2 : 1;
      // fade out toward the horizon, so stars do not sit in the haze
      const fade = smooth((0.5 - v) / 0.12);
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const px = (x + dx) % width;
          const py = Math.min(height - 1, y + dy);
          const i = (py * width + px) * 4;
          const a = bright * fade;
          out[i] = out[i]! + (tint[0] - out[i]!) * a;
          out[i + 1] = out[i + 1]! + (tint[1] - out[i + 1]!) * a;
          out[i + 2] = out[i + 2]! + (tint[2] - out[i + 2]!) * a;
        }
      }
    }
  }
  fogOverPixels(out, width, height, fog, tau);
  return out;
}

/**
 * A wide picture with the fog laid over it, as a canvas (null where there is no canvas, or the picture cannot be read).
 * Pictures wider than 2048 are made smaller.
 */
export function fogPicture(
  image: CanvasImageSource & { width?: number; height?: number },
  fog: RGB,
  tau: number,
): HTMLCanvasElement | null {
  try {
    const iw = Number(image.width) || 0;
    const ih = Number(image.height) || 0;
    if (!iw || !ih || typeof document === 'undefined') return null;
    const scale = Math.min(1, 2048 / iw);
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h);
    fogOverPixels(pixels.data, w, h, fog, tau);
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

/** The average color of the middle rows of a wide picture: what its horizon looks like (the fog follows it). */
export function horizonOf(image: CanvasImageSource & { width?: number; height?: number }): string | null {
  try {
    const w = Math.max(1, Math.min(128, Number(image.width) || 0));
    const h = Math.max(1, Number(image.height) || 0);
    if (!image.width || !image.height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = 3;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // three rows around the middle of the picture
    ctx.drawImage(image, 0, Math.max(0, h / 2 - 1.5), Number(image.width), 3, 0, 0, w, 3);
    const data = ctx.getImageData(0, 0, w, 3).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 16) continue;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }
    return n > 0 ? toHex([r / n, g / n, b / n]) : null;
  } catch {
    return null;
  }
}
