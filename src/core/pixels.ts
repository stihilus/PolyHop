// Pixel buffers and the pixel-art operations used by the texture painter. Pure data code, no DOM.

import { deflateSync, inflateSync } from 'fflate';

export type RGBA = [number, number, number, number];

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * RGBA image, row 0 at the top. Serializes through JSON.stringify to {w, h, z} where z is the
 * deflate-compressed pixel data in base64 (pixel art compresses extremely well). The older
 * uncompressed form {w, h, data} is still accepted when reading.
 */
export class PixelBuffer {
  data: Uint8ClampedArray<ArrayBuffer>;

  constructor(
    public w: number,
    public h: number,
    data?: Uint8ClampedArray<ArrayBuffer>,
  ) {
    this.data = data ?? new Uint8ClampedArray(w * h * 4);
  }

  clone(): PixelBuffer {
    return new PixelBuffer(this.w, this.h, this.data.slice());
  }

  /** Fraction (0..1) of the pixels of a rectangle that are mostly opaque (alpha above half). */
  coverage(x: number, y: number, w: number, h: number): number {
    let opaque = 0;
    let total = 0;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inside(xx, yy)) continue;
        total++;
        if (this.data[(yy * this.w + xx) * 4 + 3]! > 127) opaque++;
      }
    }
    return total > 0 ? opaque / total : 0;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.w + x) * 4;
    const d = this.data;
    return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  }

  set(x: number, y: number, c: RGBA): void {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  fill(c: RGBA): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = c[3];
    }
  }

  /** Copy a rectangle of pixels out (clipped to the buffer). */
  extract(x: number, y: number, w: number, h: number): PixelBuffer {
    const out = new PixelBuffer(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (this.inside(x + xx, y + yy)) out.set(xx, yy, this.get(x + xx, y + yy));
      }
    }
    return out;
  }

  /** Write another buffer into this one at (x, y), clipped. */
  blit(src: PixelBuffer, x: number, y: number): void {
    for (let yy = 0; yy < src.h; yy++) {
      for (let xx = 0; xx < src.w; xx++) this.set(x + xx, y + yy, src.get(xx, yy));
    }
  }

  toJSON(): { w: number; h: number; z: string } {
    const bytes = new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.length);
    return { w: this.w, h: this.h, z: bytesToBase64(deflateSync(bytes, { level: 6 })) };
  }

  /** Accepts the JSON form, a live PixelBuffer, or a structured-cloned {w,h,data: typed array}. */
  static from(raw: unknown, fallbackW = 16, fallbackH = 16): PixelBuffer {
    if (raw instanceof PixelBuffer) return raw.clone();
    if (raw && typeof raw === 'object') {
      const r = raw as { w?: unknown; h?: unknown; z?: unknown; data?: unknown };
      const w = typeof r.w === 'number' && r.w > 0 ? Math.floor(r.w) : fallbackW;
      const h = typeof r.h === 'number' && r.h > 0 ? Math.floor(r.h) : fallbackH;
      let bytes: Uint8Array | null = null;
      try {
        if (typeof r.z === 'string') bytes = inflateSync(base64ToBytes(r.z));
        else if (typeof r.data === 'string') bytes = base64ToBytes(r.data);
        else if (r.data instanceof Uint8ClampedArray || r.data instanceof Uint8Array) bytes = new Uint8Array(r.data);
      } catch {
        bytes = null;
      }
      if (bytes && bytes.length === w * h * 4) {
        const data = new Uint8ClampedArray(bytes.length);
        data.set(bytes);
        return new PixelBuffer(w, h, data);
      }
      return new PixelBuffer(w, h);
    }
    return new PixelBuffer(fallbackW, fallbackH);
  }
}

export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Square brush of `size` pixels; the (x, y) pixel is the top-left-biased center. */
export function stamp(buf: PixelBuffer, x: number, y: number, size: number, color: RGBA): void {
  const off = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) buf.set(x - off + dx, y - off + dy, color);
  }
}

/** Bounding box a brush stamp touches. */
export function stampBounds(x: number, y: number, size: number): { x0: number; y0: number; x1: number; y1: number } {
  const off = Math.floor((size - 1) / 2);
  return { x0: x - off, y0: y - off, x1: x - off + size - 1, y1: y - off + size - 1 };
}

/** Bresenham line, calling `plot` for every pixel including both ends. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * 4-neighbour flood fill with exact RGBA matching. With a `mask`, only pixels for which it returns
 * true are visited (used to keep a fill inside one face's UV island). Returns the filled bounds.
 */
export function floodFill(
  buf: PixelBuffer,
  x: number,
  y: number,
  color: RGBA,
  mask?: (x: number, y: number) => boolean,
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!buf.inside(x, y)) return null;
  if (mask && !mask(x, y)) return null;
  const target = buf.get(x, y);
  if (colorsEqual(target, color)) return null;
  let x0 = x;
  let y0 = y;
  let x1 = x;
  let y1 = y;
  const stack: number[] = [x, y];
  while (stack.length) {
    const py = stack.pop()!;
    const px = stack.pop()!;
    if (!buf.inside(px, py)) continue;
    if (mask && !mask(px, py)) continue;
    if (!colorsEqual(buf.get(px, py), target)) continue;
    buf.set(px, py, color);
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  return { x0, y0, x1, y1 };
}

export function hexToRgba(hex: string, alpha = 255): RGBA {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 0, 255, alpha];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function rgbaToHex(c: RGBA): string {
  return `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
