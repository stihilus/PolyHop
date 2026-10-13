// Shelf packing of rectangles into a power-of-two atlas. Used when migrating models that stored a
// separate bitmap per face (the earlier model format) into a single shared texture.

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  rects: Map<string, AtlasRect>;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Deterministic for a given input set (sorted by height, width, key). */
export function packRects(items: { key: string; w: number; h: number }[], minWidth = 64): AtlasLayout {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w || a.key.localeCompare(b.key));
  const maxW = sorted.reduce((m, i) => Math.max(m, i.w), 1);
  const area = sorted.reduce((s, i) => s + i.w * i.h, 0);
  const width = nextPow2(Math.max(minWidth, maxW, Math.ceil(Math.sqrt(area))));

  const rects = new Map<string, AtlasRect>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of sorted) {
    if (x + it.w > width) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    rects.set(it.key, { x, y, w: it.w, h: it.h });
    x += it.w;
    rowH = Math.max(rowH, it.h);
  }
  return { width, height: nextPow2(Math.max(1, y + rowH)), rects };
}
