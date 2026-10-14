import { type UVPoly, clampGroupMove, pointInPoly, translateUv } from '../../core/uv';
import { el } from './dom';
import { UI_FONT_STACK } from '../../core/fonts';

export interface AtlasLayer {
  id: string;
  uv: UVPoly;
  /** selected = editable (dragged together), sibling = other faces of the same cube, other = rest of the model */
  kind: 'selected' | 'sibling' | 'other';
  label?: string;
  /**
   * Of several selected layers, the one whose corner points have handles (the face the number fields edit). When no
   * selected layer says so, every selected layer has handles.
   */
  primary?: boolean;
}

/** What a click on a face's quad in the view asks for: replace the selection, add / take it out, or make it the main face. */
export type LayerPickMode = 'replace' | 'toggle' | 'primary';

export interface AtlasTexture {
  /** Changes when the texture or its size changes; the view re-fits on change. */
  key: string;
  width: number;
  height: number;
  tileSize: number;
  image: CanvasImageSource;
}

export interface AtlasViewOptions {
  mode: 'uv' | 'paint';
  texture: () => AtlasTexture | null;
  layers: () => AtlasLayer[];
  showTileGrid?: () => boolean;
  /** Snap step in texture pixels for UV dragging (0 = free). */
  snap?: () => number;
  /** In tile mode a click on a tile reports (col, row) instead of dragging UVs. */
  tileMode?: () => boolean;
  onVertexSet?: (layer: AtlasLayer, vertex: number, x: number, y: number) => void;
  onFaceSet?: (layer: AtlasLayer, uv: UVPoly) => void;
  onUvCommit?: () => void;
  onLayerPick?: (layer: AtlasLayer, mode: LayerPickMode) => void;
  onTilePick?: (col: number, row: number, shift: boolean) => void;
  onPaint?: (phase: 'down' | 'move' | 'up', x: number, y: number, e: PointerEvent) => void;
  onHover?: (x: number | null, y: number | null) => void;
  /** Extra overlay drawn in texture space (e.g. a brush cursor), after everything else. */
  drawOverlay?: (ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => [number, number], zoom: number) => void;
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | { type: 'vertex'; layer: AtlasLayer; vertex: number }
  | {
      type: 'faces';
      /** The selected faces that move together. */
      layers: AtlasLayer[];
      orig: UVPoly[];
      /** The face the pointer went down on. */
      under: AtlasLayer;
      startX: number;
      startY: number;
      clientX: number;
      clientY: number;
      shift: boolean;
      moved: boolean;
    }
  | { type: 'paint' }
  | { type: 'tile'; sx: number; sy: number; shift: boolean };

const HANDLE_RADIUS = 9;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;

/** Pannable, zoomable view of a texture with UV polygons on top. Used for UV editing and painting. */
export class AtlasView {
  readonly el: HTMLElement;
  private canvas = el('canvas', { class: 'atlas-canvas' });
  private status = el('div', { class: 'atlas-status muted' });
  private checker: CanvasPattern | null = null;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private fitKey = '';
  private drag: Drag | null = null;
  private spaceDown = false;
  private hover: { x: number; y: number } | null = null;
  private cssW = 1;
  private cssH = 1;

  constructor(private opts: AtlasViewOptions) {
    this.el = el('div', { class: 'atlas-view' }, this.canvas, this.status);
    this.canvas.tabIndex = 0;

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.hover = null;
        this.opts.onHover?.(null, null);
        this.redraw();
      }
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        this.spaceDown = true;
        e.preventDefault();
      }
    });
    this.canvas.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });

    new ResizeObserver(() => {
      this.resize();
      this.redraw();
    }).observe(this.canvas);
    requestAnimationFrame(() => {
      this.resize();
      this.fit();
    });
  }

  // ---------------------------------------------------------------- view

  fit(): void {
    const tex = this.opts.texture();
    if (!tex) return;
    if (!this.measure()) return; // detached or hidden: fit again once visible
    this.fitKey = tex.key;
    const k = Math.min(this.cssW / tex.width, this.cssH / tex.height) * 0.97;
    this.zoom = k >= 1 ? Math.floor(k) : Math.max(MIN_ZOOM, k);
    this.panX = (this.cssW - tex.width * this.zoom) / 2;
    this.panY = (this.cssH - tex.height * this.zoom) / 2;
    this.redraw();
  }

  /** Re-measure the canvas. Returns false while it has no size (not attached or hidden). */
  private measure(): boolean {
    if (!this.canvas.isConnected) return false;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    this.cssW = rect.width;
    this.cssH = rect.height;
    const w = Math.round(this.cssW * dpr);
    const h = Math.round(this.cssH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return true;
  }

  private resize(): void {
    this.measure();
  }

  /** Zoom and center on a UV quad, or on a group of them (about 40% of the view) so a small face is easy to work on. */
  focus(uvs: UVPoly | UVPoly[]): void {
    const tex = this.opts.texture();
    if (!tex || !this.measure()) return;
    const points = Array.isArray(uvs[0]![0]) ? (uvs as UVPoly[]).flat() : (uvs as UVPoly);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const size = Math.max(1, maxX - minX, maxY - minY);
    const k = (Math.min(this.cssW, this.cssH) * 0.4) / size;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k >= 1 ? Math.floor(k) : k));
    this.fitKey = tex.key;
    this.panX = this.cssW / 2 - ((minX + maxX) / 2) * this.zoom;
    this.panY = this.cssH / 2 - ((minY + maxY) / 2) * this.zoom;
    this.redraw();
  }

  private toTex(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left - this.panX) / this.zoom, (clientY - r.top - this.panY) / this.zoom];
  }

  private toScreen = (x: number, y: number): [number, number] => [this.panX + x * this.zoom, this.panY + y * this.zoom];

  // ---------------------------------------------------------------- drawing

  redraw(): void {
    if (!this.measure()) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14161b';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const tex = this.opts.texture();
    if (!tex) {
      ctx.fillStyle = '#8a93a3';
      ctx.font = `11px ${UI_FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText('No texture selected', this.cssW / 2, this.cssH / 2);
      this.status.textContent = '';
      return;
    }
    if (tex.key !== this.fitKey) {
      this.fit();
      return;
    }

    const [x0, y0] = this.toScreen(0, 0);
    const w = tex.width * this.zoom;
    const h = tex.height * this.zoom;

    if (!this.checker) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const cc = c.getContext('2d')!;
      cc.fillStyle = '#2a2e38';
      cc.fillRect(0, 0, 16, 16);
      cc.fillStyle = '#20232b';
      cc.fillRect(0, 0, 8, 8);
      cc.fillRect(8, 8, 8, 8);
      this.checker = ctx.createPattern(c, 'repeat');
    }
    ctx.save();
    ctx.translate(x0, y0);
    ctx.fillStyle = this.checker ?? '#20232b';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tex.image, x0, y0, w, h);

    // grids
    ctx.lineWidth = 1;
    if (this.zoom >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      for (let x = 1; x < tex.width; x++) {
        const sx = Math.round(x0 + x * this.zoom) + 0.5;
        if (sx < 0 || sx > this.cssW) continue;
        ctx.moveTo(sx, Math.max(0, y0));
        ctx.lineTo(sx, Math.min(this.cssH, y0 + h));
      }
      for (let y = 1; y < tex.height; y++) {
        const sy = Math.round(y0 + y * this.zoom) + 0.5;
        if (sy < 0 || sy > this.cssH) continue;
        ctx.moveTo(Math.max(0, x0), sy);
        ctx.lineTo(Math.min(this.cssW, x0 + w), sy);
      }
      ctx.stroke();
    }
    if (this.opts.showTileGrid?.() && tex.tileSize * this.zoom >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (let x = 0; x <= tex.width; x += tex.tileSize) {
        const sx = Math.round(x0 + x * this.zoom) + 0.5;
        ctx.moveTo(sx, y0);
        ctx.lineTo(sx, y0 + h);
      }
      for (let y = 0; y <= tex.height; y += tex.tileSize) {
        const sy = Math.round(y0 + y * this.zoom) + 0.5;
        ctx.moveTo(x0, sy);
        ctx.lineTo(x0 + w, sy);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, w, h);

    // UV polygons: faint ones first so the selected face is always on top
    const layers = this.opts.layers();
    const order = { other: 0, sibling: 1, selected: 2 } as const;
    for (const layer of [...layers].sort((a, b) => order[a.kind] - order[b.kind])) {
      this.drawLayer(ctx, layer);
    }

    this.opts.drawOverlay?.(ctx, this.toScreen, this.zoom);

    if (this.hover && this.opts.mode === 'paint') {
      const tx = Math.floor(this.hover.x);
      const ty = Math.floor(this.hover.y);
      if (tx >= 0 && ty >= 0 && tx < tex.width && ty < tex.height) {
        const [sx, sy] = this.toScreen(tx, ty);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeRect(sx + 0.5, sy + 0.5, Math.max(1, this.zoom - 1), Math.max(1, this.zoom - 1));
      }
    }

    const px = this.hover ? `${Math.floor(this.hover.x)}, ${Math.floor(this.hover.y)}` : '–';
    this.status.textContent = `${tex.width}×${tex.height} px · ${Math.round(this.zoom * 100)}% · pixel ${px}`;
  }

  /** Do the corner points of this selected layer have handles? (Only the main face of a group does.) */
  private hasHandles(layer: AtlasLayer): boolean {
    if (layer.kind !== 'selected') return false;
    if (layer.primary) return true;
    return !this.opts.layers().some((l) => l.kind === 'selected' && l.primary);
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: AtlasLayer): void {
    const pts = layer.uv.map(([x, y]) => this.toScreen(x, y));
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    ctx.closePath();
    if (layer.kind === 'selected') {
      ctx.fillStyle = 'rgba(255,178,62,0.20)';
      ctx.fill();
      ctx.strokeStyle = '#ffb23e';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (this.opts.mode === 'uv' && this.hasHandles(layer)) {
        ctx.lineWidth = 1;
        pts.forEach((p, i) => {
          ctx.fillStyle = '#14161b';
          ctx.strokeStyle = '#ffb23e';
          ctx.beginPath();
          ctx.rect(p[0] - 5, p[1] - 5, 10, 10);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffd68a';
          ctx.font = `11px ${UI_FONT_STACK}`;
          ctx.textAlign = 'left';
          ctx.fillText(String(i + 1), p[0] + 8, p[1] - 6);
        });
      }
    } else {
      ctx.strokeStyle = layer.kind === 'sibling' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (layer.kind === 'sibling' && layer.label && this.opts.mode === 'uv') {
        const cx = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
        const cy = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `11px ${UI_FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.fillText(layer.label, cx, cy);
      }
    }
  }

  // ---------------------------------------------------------------- interaction

  private snapValue(v: number): number {
    const step = this.opts.snap?.() ?? 0;
    return step > 0 ? Math.round(v / step) * step : v;
  }

  private clampTex(x: number, y: number): [number, number] {
    const tex = this.opts.texture();
    if (!tex) return [x, y];
    return [Math.min(tex.width, Math.max(0, x)), Math.min(tex.height, Math.max(0, y))];
  }

  private onDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    const isPan = e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown);
    if (isPan) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const tex = this.opts.texture();
    if (!tex) return;
    const [tx, ty] = this.toTex(e.clientX, e.clientY);

    if (this.opts.mode === 'paint') {
      if (tx < 0 || ty < 0 || tx >= tex.width || ty >= tex.height) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { type: 'paint' };
      this.opts.onPaint?.('down', Math.floor(tx), Math.floor(ty), e);
      return;
    }

    // uv mode
    if (this.opts.tileMode?.()) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { type: 'tile', sx: e.clientX, sy: e.clientY, shift: e.shiftKey };
      return;
    }
    const layers = this.opts.layers();
    const selected = layers.filter((l) => l.kind === 'selected');
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (const layer of selected) {
      if (!this.hasHandles(layer)) continue;
      for (let i = 0; i < layer.uv.length; i++) {
        const [sx, sy] = this.toScreen(layer.uv[i]![0], layer.uv[i]![1]);
        if (Math.hypot(sx - mx, sy - my) <= HANDLE_RADIUS) {
          this.canvas.setPointerCapture(e.pointerId);
          this.drag = { type: 'vertex', layer, vertex: i };
          return;
        }
      }
    }
    // inside any selected face: all the selected faces move together
    const under = [...selected].reverse().find((l) => pointInPoly(tx, ty, l.uv));
    if (under) {
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = {
        type: 'faces',
        layers: selected,
        orig: selected.map((l) => l.uv.map((p) => [...p]) as UVPoly),
        under,
        startX: tx,
        startY: ty,
        clientX: e.clientX,
        clientY: e.clientY,
        shift: e.shiftKey || e.ctrlKey || e.metaKey,
        moved: false,
      };
      return;
    }
    // click on another face's quad selects that face (Shift adds it to the selection)
    const hit = [...layers].reverse().find((l) => l.kind !== 'selected' && pointInPoly(tx, ty, l.uv));
    if (hit) this.opts.onLayerPick?.(hit, e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
  }

  private onMove(e: PointerEvent): void {
    const [tx, ty] = this.toTex(e.clientX, e.clientY);
    this.hover = { x: tx, y: ty };
    const d = this.drag;
    if (!d) {
      this.opts.onHover?.(tx, ty);
      this.redraw();
      return;
    }
    switch (d.type) {
      case 'pan':
        this.panX = d.px + (e.clientX - d.sx);
        this.panY = d.py + (e.clientY - d.sy);
        break;
      case 'vertex': {
        const [x, y] = this.clampTex(this.snapValue(tx), this.snapValue(ty));
        this.opts.onVertexSet?.(d.layer, d.vertex, x, y);
        break;
      }
      case 'faces': {
        if (!d.moved && Math.hypot(e.clientX - d.clientX, e.clientY - d.clientY) < 3) break;
        d.moved = true;
        let dx = this.snapValue(tx - d.startX);
        let dy = this.snapValue(ty - d.startY);
        const tex = this.opts.texture();
        // the group moves as one: keep the whole of it inside the texture
        if (tex) [dx, dy] = clampGroupMove(d.orig, dx, dy, tex.width, tex.height);
        d.layers.forEach((layer, i) => this.opts.onFaceSet?.(layer, translateUv(d.orig[i]!, dx, dy)));
        break;
      }
      case 'paint':
        this.opts.onPaint?.('move', Math.floor(tx), Math.floor(ty), e);
        break;
      case 'tile':
        break;
    }
    this.opts.onHover?.(tx, ty);
    this.redraw();
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.type === 'vertex') this.opts.onUvCommit?.();
    else if (d.type === 'faces') {
      if (d.moved) this.opts.onUvCommit?.();
      else if (d.shift) this.opts.onLayerPick?.(d.under, 'toggle');
      else if (d.layers.length > 1 && !d.under.primary) this.opts.onLayerPick?.(d.under, 'primary');
    } else if (d.type === 'paint') {
      const [tx, ty] = this.toTex(e.clientX, e.clientY);
      this.opts.onPaint?.('up', Math.floor(tx), Math.floor(ty), e);
    } else if (d.type === 'tile') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) {
        const tex = this.opts.texture();
        if (tex) {
          const [tx, ty] = this.toTex(e.clientX, e.clientY);
          const col = Math.floor(tx / tex.tileSize);
          const row = Math.floor(ty / tex.tileSize);
          if (col >= 0 && row >= 0 && col * tex.tileSize < tex.width && row * tex.tileSize < tex.height) {
            this.opts.onTilePick?.(col, row, d.shift);
          }
        }
      }
    }
    this.redraw();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const before = this.toTex(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    // keep the texel under the cursor fixed
    this.panX = mx - before[0] * this.zoom;
    this.panY = my - before[1] * this.zoom;
    this.redraw();
  }
}
