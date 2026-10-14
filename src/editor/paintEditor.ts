import { PixelBuffer, type RGBA, floodFill, hexToRgba, line, rgbaToHex, stamp, stampBounds } from '../core/pixels';
import type { ProjectTexture } from '../core/types';
import { type TextureInfo, type TextureLibrary, tileSizeFromName } from '../runtime/textures';
import type { Store, StoreEvent } from './store';
import { type AtlasLayer, type AtlasTexture, AtlasView } from './ui/atlasView';
import { clear, el } from './ui/dom';
import { appAlert, appConfirm } from './ui/dialogs';
import { openModal } from './ui/modal';

type PaintTool = 'paint' | 'erase' | 'fill' | 'pick';

const TOOLS: { id: PaintTool; label: string; key: string }[] = [
  { id: 'paint', label: 'Paint', key: 'B' },
  { id: 'erase', label: 'Erase', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'G' },
  { id: 'pick', label: 'Pick', key: 'I' },
];

const PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  '#000000', '#2d1b0f', '#6b4423', '#8a5a2b', '#c68b4d', '#e8c7a0', '#4a7a2e', '#9bd35a',
  '#7a1f1f', '#d94a3d', '#ff9ab0', '#ffffff', '#c9a227', '#6a5acd', '#2f9e9e', '#8d8d8d',
];

interface Stroke {
  tex: ProjectTexture;
  before: PixelBuffer;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  last: { x: number; y: number } | null;
}

interface PatchStep {
  name: string;
  x: number;
  y: number;
  before: PixelBuffer;
  after: PixelBuffer;
}

/**
 * The Paint mode: pick a texture and paint the whole atlas. Models and level blocks that use it
 * update live. A built-in atlas is copied into the project on the first stroke.
 */
export class PaintEditor {
  readonly root: HTMLElement;
  /** The model whose UVs are drawn over the texture (set by the app, optional). */
  private overlayModelId = '';

  private current: string | null = null;
  private tool: PaintTool = 'paint';
  private color: RGBA = [255, 138, 61, 255];
  private brush = 1;
  private showTileGrid = true;

  private listEl = el('div', { class: 'hierarchy' });
  private sideEl = el('div', { class: 'inspector' });
  private hintEl = el('div', { class: 'hud hud-bottom' });
  private emptyEl = el('div', { class: 'model-empty' });
  private undoBtn = el('button', { class: 'btn', text: '↶ Undo', title: 'Ctrl/Cmd+Z' });
  private redoBtn = el('button', { class: 'btn', text: '↷ Redo', title: 'Ctrl/Cmd+Shift+Z' });
  private toolButtons = new Map<PaintTool, HTMLButtonElement>();
  private colorInput: HTMLInputElement | null = null;
  private view: AtlasView;
  private stroke: Stroke | null = null;

  private undoStack: PatchStep[] = [];
  private redoStack: PatchStep[] = [];
  private active = false;

  constructor(
    private store: Store,
    private textures: TextureLibrary,
  ) {
    this.view = new AtlasView({
      mode: 'paint',
      texture: () => this.atlasTexture(),
      layers: () => this.overlayLayers(),
      showTileGrid: () => this.showTileGrid,
      onPaint: (phase, x, y) => this.onPaint(phase, x, y),
    });
    this.root = this.buildLayout();
    this.root.classList.add('hidden');
    this.updateHint();

    window.addEventListener('keydown', (e) => this.onKey(e));
    store.subscribe((e) => this.onStoreEvent(e));
  }

  // ---------------------------------------------------------------- public API

  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('hidden', !active);
    if (!active) return;
    if (!this.current || !this.textures.get(this.current)) this.current = this.textures.names()[0] ?? null;
    this.refreshAll();
    requestAnimationFrame(() => this.view.redraw());
  }

  /** Open a texture for painting (the app switches to this mode). */
  open(name: string | null, overlayModelId = ''): void {
    this.current = name && this.textures.get(name) ? name : (this.textures.names()[0] ?? null);
    this.overlayModelId = overlayModelId;
    this.undoStack = [];
    this.redoStack = [];
    this.refreshAll();
    this.view.fit();
  }

  // ---------------------------------------------------------------- layout

  private buildLayout(): HTMLElement {
    const importInput = el('input', { type: 'file', accept: 'image/png,image/*', class: 'hidden' });
    importInput.addEventListener('change', () => {
      const f = importInput.files?.[0];
      importInput.value = '';
      if (f) void this.importTexture(f);
    });

    this.emptyEl.append(
      el('div', { class: 'model-empty-title', text: 'No texture selected' }),
      el('div', { class: 'muted', text: 'Create a texture or import a PNG to start painting.' }),
      el('button', { class: 'btn primary', text: '+ New texture', onclick: () => this.openNewTextureDialog() }),
    );

    const left = el(
      'aside',
      { class: 'panel panel-left' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Textures' })),
      el(
        'div',
        { class: 'panel-toolbar wrap' },
        el('button', { class: 'btn', text: '+ New', onclick: () => this.openNewTextureDialog() }),
        el('button', { class: 'btn', text: 'Import…', onclick: () => importInput.click() }),
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicateTexture() }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => void this.deleteTexture() }),
      ),
      this.listEl,
      importInput,
    );

    for (const t of TOOLS) {
      const b = el('button', { class: 'btn', text: t.label, title: `${t.label} (${t.key})`, onclick: () => this.setTool(t.id) });
      this.toolButtons.set(t.id, b);
    }
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    const toolbar = el(
      'div',
      { class: 'model-toolbar' },
      el('div', { class: 'tb-group' }, ...this.toolButtons.values()),
      el('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', text: 'Fit', onclick: () => this.view.fit() }),
    );

    const center = el('section', { class: 'viewport-wrap paint-stage' }, this.view.el, toolbar, this.hintEl, this.emptyEl);
    const right = el(
      'aside',
      { class: 'panel panel-right' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Brush & colors' })),
      this.sideEl,
    );
    return el('div', { class: 'workspace paint-workspace' }, left, center, right);
  }

  private updateHint(): void {
    const hints: Record<PaintTool, string> = {
      paint: 'Drag to paint pixels. Wheel zooms, right/middle mouse or Space+drag pans.',
      erase: 'Drag to erase pixels (makes them transparent).',
      fill: 'Click to fill a region of one color.',
      pick: 'Click a pixel to pick its color.',
    };
    this.hintEl.textContent = hints[this.tool];
  }

  private setTool(tool: PaintTool): void {
    this.tool = tool;
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === tool);
    this.updateHint();
  }

  private setColor(c: RGBA): void {
    this.color = c;
    if (this.colorInput) this.colorInput.value = rgbaToHex(c);
  }

  // ---------------------------------------------------------------- texture helpers

  private info(): TextureInfo | null {
    return this.current ? this.textures.get(this.current) : null;
  }

  private atlasTexture(): AtlasTexture | null {
    const info = this.info();
    if (!info) return null;
    return {
      key: `${info.name}:${info.width}x${info.height}`,
      width: info.width,
      height: info.height,
      tileSize: info.tileSize,
      image: info.texture.image as CanvasImageSource,
    };
  }

  private overlayLayers(): AtlasLayer[] {
    const model = this.overlayModelId ? this.store.getModel(this.overlayModelId) : null;
    if (!model || model.texture !== this.current) return [];
    const out: AtlasLayer[] = [];
    for (const cube of model.cubes) {
      cube.mesh.faces.forEach((f, i) => out.push({ id: `${cube.id}:${i}`, uv: f.uv, kind: 'other' }));
    }
    return out;
  }

  private uniqueName(base: string): string {
    const taken = new Set(this.textures.names());
    if (!taken.has(base)) return base;
    const m = /^(.*?)(\.[a-z]+)?$/i.exec(base);
    const stem = m?.[1] ?? base;
    const ext = m?.[2] ?? '';
    for (let n = 2; ; n++) {
      const c = `${stem} ${n}${ext}`;
      if (!taken.has(c)) return c;
    }
  }

  /** The project texture for painting; a built-in atlas is copied into the project first. */
  private editableTexture(): ProjectTexture | null {
    const name = this.current;
    if (!name) return null;
    const existing = this.store.project.textures.find((t) => t.name === name);
    if (existing) return existing;
    const info = this.textures.get(name);
    const pixels = this.textures.builtinPixels(name);
    if (!info || !pixels) return null;
    const tex: ProjectTexture = { name, tileSize: info.tileSize, pixels };
    this.store.addTexture(tex); // shadows the built-in atlas everywhere
    return tex;
  }

  private openNewTextureDialog(): void {
    const nameInput = el('input', { type: 'text', value: this.uniqueName('Texture-16.png') });
    const size = el('select', {});
    for (const n of [32, 64, 128, 256, 512]) size.append(el('option', { value: String(n), text: `${n} × ${n}`, selected: n === 128 }));
    const tile = el('select', {});
    for (const n of [8, 16, 32]) tile.append(el('option', { value: String(n), text: `${n} px`, selected: n === 16 }));
    const row = (label: string, control: HTMLElement) =>
      el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, control));
    openModal('New texture', el('div', { class: 'form' }, row('Name', nameInput), row('Size', size), row('Tile size', tile)), [
      { label: 'Cancel' },
      {
        label: 'Create',
        primary: true,
        onClick: () => {
          const name = nameInput.value.trim();
          if (!name || this.textures.names().includes(name)) {
            nameInput.style.borderColor = '#e5604f';
            return false;
          }
          const n = parseInt(size.value, 10);
          this.store.addTexture({ name, tileSize: parseInt(tile.value, 10), pixels: new PixelBuffer(n, n) });
          this.open(name, this.overlayModelId);
        },
      },
    ]);
  }

  private async importTexture(file: File): Promise<void> {
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      const name = this.uniqueName(file.name);
      this.store.addTexture({
        name,
        tileSize: tileSizeFromName(name),
        pixels: new PixelBuffer(bmp.width, bmp.height, new Uint8ClampedArray(data)),
      });
      this.open(name, this.overlayModelId);
    } catch (err) {
      await appAlert(`Could not import image: ${err instanceof Error ? err.message : err}`, { title: 'Import failed' });
    }
  }

  private duplicateTexture(): void {
    const info = this.info();
    const name = this.current;
    if (!info || !name) return;
    const px = this.textures.pixels(name) ?? this.textures.builtinPixels(name);
    if (!px) return;
    const m = /^(.*?)(\.[a-z]+)?$/i.exec(name);
    const copyName = this.uniqueName(`${m?.[1] ?? name} copy${m?.[2] ?? ''}`);
    this.store.addTexture({ name: copyName, tileSize: info.tileSize, pixels: px.clone() });
    this.open(copyName, this.overlayModelId);
  }

  private async deleteTexture(): Promise<void> {
    const name = this.current;
    if (!name || !this.textures.isProjectTexture(name)) return;
    const users = this.store.project.models.filter((m) => m.texture === name).length;
    const msg = this.textures.isBuiltin(name)
      ? `Revert "${name}" to the built-in version? Your edits to it will be lost.`
      : `Delete texture "${name}"? ${users} model(s) use it and will lose their texture.`;
    const revert = this.textures.isBuiltin(name);
    const ok = await appConfirm(msg, {
      title: revert ? 'Revert texture' : 'Delete texture',
      confirmLabel: revert ? 'Revert' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.store.removeTexture(name);
  }

  // ---------------------------------------------------------------- painting

  private grow(s: Stroke, x0: number, y0: number, x1: number, y1: number): void {
    const b = s.box;
    s.box = b
      ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) }
      : { x0, y0, x1, y1 };
  }

  private plot(s: Stroke, x: number, y: number): void {
    const px = s.tex.pixels;
    if (!px.inside(x, y)) return;
    if (this.tool === 'paint' || this.tool === 'erase') {
      stamp(px, x, y, this.brush, this.tool === 'paint' ? this.color : [0, 0, 0, 0]);
      const b = stampBounds(x, y, this.brush);
      this.grow(s, b.x0, b.y0, b.x1, b.y1);
    } else if (this.tool === 'fill') {
      const box = floodFill(px, x, y, this.color);
      if (box) this.grow(s, box.x0, box.y0, box.x1, box.y1);
    }
  }

  private dirtyRect(s: Stroke): { x: number; y: number; w: number; h: number } | null {
    if (!s.box) return null;
    const x0 = Math.max(0, s.box.x0);
    const y0 = Math.max(0, s.box.y0);
    const x1 = Math.min(s.tex.pixels.w - 1, s.box.x1);
    const y1 = Math.min(s.tex.pixels.h - 1, s.box.y1);
    return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  private onPaint(phase: 'down' | 'move' | 'up', x: number, y: number): void {
    if (phase === 'down') {
      if (this.tool === 'pick') {
        const name = this.current;
        const px = name ? (this.textures.pixels(name) ?? this.textures.builtinPixels(name)) : null;
        if (px?.inside(x, y)) {
          const c = px.get(x, y);
          if (c[3] > 0) this.setColor([c[0], c[1], c[2], 255]);
        }
        return;
      }
      const tex = this.editableTexture();
      if (!tex) return;
      const s: Stroke = { tex, before: tex.pixels.clone(), box: null, last: { x, y } };
      this.stroke = s;
      this.plot(s, x, y);
      const r = this.dirtyRect(s);
      if (r) this.textures.touch(tex.name, r);
      this.view.redraw();
    } else if (phase === 'move') {
      const s = this.stroke;
      if (!s || (this.tool !== 'paint' && this.tool !== 'erase')) return;
      if (s.last) line(s.last.x, s.last.y, x, y, (xx, yy) => this.plot(s, xx, yy));
      s.last = { x, y };
      const r = this.dirtyRect(s);
      if (r) this.textures.touch(s.tex.name, r);
      this.view.redraw();
    } else {
      this.endStroke();
    }
  }

  private endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const r = this.dirtyRect(s);
    if (!r) return;
    this.undoStack.push({
      name: s.tex.name,
      x: r.x,
      y: r.y,
      before: s.before.extract(r.x, r.y, r.w, r.h),
      after: s.tex.pixels.extract(r.x, r.y, r.w, r.h),
    });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistoryButtons();
    this.store.textureChanged(s.tex.name, false);
  }

  private applyPatch(step: PatchStep, patch: PixelBuffer): void {
    const pixels = this.textures.pixels(step.name);
    if (!pixels) return;
    pixels.blit(patch, step.x, step.y);
    this.textures.touch(step.name, { x: step.x, y: step.y, w: patch.w, h: patch.h });
    this.store.textureChanged(step.name, false);
    this.view.redraw();
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push(step);
    this.applyPatch(step, step.before);
    this.updateHistoryButtons();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push(step);
    this.applyPatch(step, step.after);
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  // ---------------------------------------------------------------- keys + store

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod) return;
    const byKey: Record<string, PaintTool> = { KeyB: 'paint', KeyE: 'erase', KeyG: 'fill', KeyI: 'pick' };
    const tool = byKey[e.code];
    if (tool) this.setTool(tool);
    else if (e.code === 'KeyF') this.view.fit();
    else if (e.code === 'BracketLeft') this.setBrush(this.brush - 1);
    else if (e.code === 'BracketRight') this.setBrush(this.brush + 1);
  }

  private setBrush(n: number): void {
    this.brush = Math.min(8, Math.max(1, n));
    this.refreshSide();
  }

  private onStoreEvent(e: StoreEvent): void {
    switch (e.type) {
      case 'project-replaced':
        this.current = null;
        this.stroke = null;
        this.undoStack = [];
        this.redoStack = [];
        this.overlayModelId = '';
        if (this.active) this.setActive(true);
        break;
      case 'texture-changed':
        if (!this.active) break;
        if (e.structural) {
          if (this.current && !this.textures.get(this.current)) this.current = this.textures.names()[0] ?? null;
          this.refreshAll();
        } else {
          this.view.redraw();
        }
        break;
      case 'model-added':
      case 'model-removed':
      case 'model-changed':
        if (this.active) this.refreshSide();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- UI refresh

  private refreshAll(): void {
    this.refreshList();
    this.refreshSide();
    this.updateHistoryButtons();
    this.setTool(this.tool);
    this.emptyEl.classList.toggle('hidden', !!this.info());
    this.view.redraw();
  }

  private refreshList(): void {
    clear(this.listEl);
    for (const name of this.textures.names()) {
      const mine = this.textures.isProjectTexture(name);
      this.listEl.append(
        el(
          'button',
          {
            class: `tree-item${name === this.current ? ' selected' : ''}`,
            title: mine ? name : `${name} (built-in)`,
            onclick: () => this.open(name, this.overlayModelId),
          },
          el('span', { class: 'tree-icon', text: '▦' }),
          el('span', { class: 'tree-label', text: name }),
          el('span', { class: 'tree-count muted', text: mine ? '' : 'built-in' }),
        ),
      );
    }
    if (this.textures.names().length === 0) this.listEl.append(el('div', { class: 'empty muted', text: 'No textures yet.' }));
  }

  private refreshSide(): void {
    clear(this.sideEl);
    const info = this.info();

    this.colorInput = el('input', { type: 'color', value: rgbaToHex(this.color), class: 'color-big' });
    this.colorInput.addEventListener('input', () => {
      this.color = hexToRgba(this.colorInput!.value);
    });
    const swatches = el('div', { class: 'palette' });
    for (const hex of PALETTE) {
      swatches.append(el('button', { class: 'swatch', title: hex, style: `background:${hex}`, onclick: () => this.setColor(hexToRgba(hex)) }));
    }

    const brush = el('select', {});
    for (const n of [1, 2, 3, 4, 6, 8]) brush.append(el('option', { value: String(n), text: `${n} px`, selected: n === this.brush }));
    brush.addEventListener('change', () => {
      this.brush = parseInt(brush.value, 10);
    });

    const grid = el('input', { type: 'checkbox', checked: this.showTileGrid });
    grid.addEventListener('change', () => {
      this.showTileGrid = grid.checked;
      this.view.redraw();
    });

    const modelSel = el('select', {});
    modelSel.append(el('option', { value: '', text: 'None' }));
    for (const m of this.store.project.models) {
      modelSel.append(el('option', { value: m.id, text: m.texture === this.current ? m.name : `${m.name} (other texture)`, selected: m.id === this.overlayModelId }));
    }
    modelSel.addEventListener('change', () => {
      this.overlayModelId = modelSel.value;
      this.view.redraw();
    });

    const row = (label: string, control: HTMLElement) =>
      el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, control));

    this.sideEl.append(
      el('div', { class: 'section-title', text: 'Color' }),
      el('div', { class: 'paint-row' }, this.colorInput),
      swatches,
      el('div', { class: 'section-title', text: 'Brush' }),
      row('Size', brush),
      el('div', { class: 'section-title', text: 'View' }),
      row('Tile grid', grid),
      row('Show UVs of', modelSel),
      el('div', { class: 'section-title', text: 'Texture' }),
      info
        ? el('div', {
            class: 'empty muted',
            text: info.editable
              ? `${info.name} · ${info.width}×${info.height} px · tiles of ${info.tileSize} px. Shared by every model and block that uses it.`
              : `${info.name} · ${info.width}×${info.height} px · built-in. The first stroke makes an editable copy in your project.`,
          })
        : el('div', { class: 'empty muted', text: 'Select or create a texture.' }),
    );
  }
}
