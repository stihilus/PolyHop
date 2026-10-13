import type { TileRef } from '../../core/types';
import type { TextureLibrary } from '../../runtime/textures';
import { el } from './dom';

export interface TilePickerOptions {
  textures: TextureLibrary;
  /** Current tile (used for the selection outline). */
  get: () => TileRef | null;
  onPick: (tile: TileRef) => void;
  zoom?: number;
  maxHeight?: number;
}

export interface TilePicker {
  el: HTMLElement;
  /** Re-read `get()` and redraw the selection outline. */
  refresh: () => void;
}

/** Atlas browser: pick a texture file, then click a tile. Pixel-perfect (nearest) at integer zoom. */
export function buildTilePicker(opts: TilePickerOptions): TilePicker {
  const { textures } = opts;
  const names = textures.names();
  let zoom = opts.zoom ?? 2;
  let textureName = opts.get()?.texture ?? names[0] ?? '';

  const canvas = el('canvas', { class: 'tilepicker-canvas' });
  const outline = el('div', { class: 'tilepicker-outline' });
  const hover = el('div', { class: 'tilepicker-hover' });
  const stage = el('div', { class: 'tilepicker-stage' }, canvas, hover, outline);
  const scroll = el('div', { class: 'tilepicker-scroll' }, stage);
  if (opts.maxHeight) scroll.style.maxHeight = `${opts.maxHeight}px`;
  const info = el('div', { class: 'tilepicker-info muted', text: '' });

  const select = el('select', {});
  for (const n of names) select.append(el('option', { value: n, text: n, selected: n === textureName }));
  select.addEventListener('change', () => {
    textureName = select.value;
    draw();
  });
  const zoomSelect = el('select', { class: 'tilepicker-zoom' });
  for (const z of [1, 2, 3, 4]) zoomSelect.append(el('option', { value: String(z), text: `${z * 100}%`, selected: z === zoom }));
  zoomSelect.addEventListener('change', () => {
    zoom = parseInt(zoomSelect.value, 10);
    draw();
  });

  const tileSizeOf = () => textures.get(textureName)?.tileSize ?? 16;

  function placeBox(box: HTMLElement, col: number, row: number): void {
    const ts = tileSizeOf() * zoom;
    box.style.left = `${col * ts}px`;
    box.style.top = `${row * ts}px`;
    box.style.width = `${ts}px`;
    box.style.height = `${ts}px`;
  }

  function draw(): void {
    const tex = textures.get(textureName);
    if (!tex) return;
    canvas.width = tex.width * zoom;
    canvas.height = tex.height * zoom;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // checkerboard so transparent pixels are visible as transparent
    const cell = Math.max(4, Math.round(tex.tileSize / 4) * zoom);
    for (let y = 0; y * cell < canvas.height; y++) {
      for (let x = 0; x * cell < canvas.width; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#2b2f3a' : '#363b48';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    ctx.drawImage(tex.texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    refresh();
  }

  function refresh(): void {
    const cur = opts.get();
    if (cur && cur.texture === textureName) {
      outline.style.display = 'block';
      placeBox(outline, cur.col, cur.row);
    } else {
      outline.style.display = 'none';
    }
  }

  function tileAt(e: MouseEvent): { col: number; row: number } | null {
    const tex = textures.get(textureName);
    if (!tex) return null;
    const rect = canvas.getBoundingClientRect();
    const ts = tex.tileSize * zoom;
    const col = Math.floor((e.clientX - rect.left) / ts);
    const row = Math.floor((e.clientY - rect.top) / ts);
    if (col < 0 || row < 0 || col >= Math.floor(tex.width / tex.tileSize) || row >= Math.floor(tex.height / tex.tileSize)) return null;
    return { col, row };
  }

  canvas.addEventListener('mousemove', (e) => {
    const t = tileAt(e);
    if (!t) {
      hover.style.display = 'none';
      return;
    }
    hover.style.display = 'block';
    placeBox(hover, t.col, t.row);
    info.textContent = `col ${t.col}, row ${t.row}`;
  });
  canvas.addEventListener('mouseleave', () => {
    hover.style.display = 'none';
  });
  canvas.addEventListener('click', (e) => {
    const t = tileAt(e);
    if (!t) return;
    opts.onPick({ texture: textureName, col: t.col, row: t.row });
    refresh();
  });

  const root = el(
    'div',
    { class: 'tilepicker' },
    el('div', { class: 'tilepicker-bar' }, select, zoomSelect),
    scroll,
    info,
  );
  draw();
  return { el: root, refresh };
}
