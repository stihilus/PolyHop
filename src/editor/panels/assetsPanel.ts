// The Assets list: game objects and models as cards with a picture, to select, rename, place and drag.

import { type Prefab, type TileRef, builtInModelById } from '../../core/types';
import { ModelRender } from '../../runtime/modelRender';
import { Thumbnailer } from '../thumbnails';
import { MODEL_DRAG_MIME, PREFAB_DRAG_MIME } from '../viewport';
import { clear, el } from '../ui/dom';
import { renameInline } from '../ui/rename';
import type { PanelHost } from './host';

export class AssetsPanel {
  readonly element = el('div', { class: 'assets hidden' });
  private thumbnailer: Thumbnailer | null = null;
  private thumbs = new Map<string, string>();

  constructor(private host: PanelHost) {}

  // ---- thumbnails (rendered once and kept until what they show changes)

  /** Every thumbnail may be out of date (the project or a texture changed). */
  clearThumbs(): void {
    this.thumbs.clear();
  }

  dropThumb(id: string): void {
    this.thumbs.delete(id);
  }

  /** The pictures of the game objects made of a plain block. */
  dropPrefabThumbs(): void {
    for (const k of [...this.thumbs.keys()]) if (k.startsWith('prefab:')) this.thumbs.delete(k);
  }

  private thumbnailFor(modelId: string): string {
    const cached = this.thumbs.get(modelId);
    if (cached !== undefined) return cached;
    let url = '';
    try {
      this.thumbnailer ??= new Thumbnailer(96);
      const render = this.host.viewport.game.models.get(modelId);
      if (render) url = this.thumbnailer.render(render);
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    this.thumbs.set(modelId, url);
    return url;
  }

  /** A thumbnail of a flat game object: the tile it shows (tinted), drawn at 64 px. */
  private tileThumbnail(tile: TileRef | null, color: string, key: string): string {
    const cached = this.thumbs.get(key);
    if (cached !== undefined) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    let ready = true;
    ctx.imageSmoothingEnabled = false;
    const info = tile ? this.host.textures.get(tile.texture) : null;
    const image = info?.texture.image as (CanvasImageSource & { complete?: boolean }) | undefined;
    if (tile && info && image && image.complete !== false) {
      const ts = info.tileSize;
      ctx.drawImage(image, tile.col * ts, tile.row * ts, ts, ts, 0, 0, 64, 64);
    } else {
      ready = !tile; // an atlas that has not loaded yet: draw a plain square and look again later
      ctx.fillStyle = '#6c7380';
      ctx.fillRect(0, 0, 64, 64);
    }
    if (color.toLowerCase() !== '#ffffff') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
    }
    const url = canvas.toDataURL('image/png');
    if (ready) this.thumbs.set(key, url);
    return url;
  }

  /** A picture of a built-in model the project does not have (yet): a game object looks right before it is placed. */
  private builtInThumbnail(modelId: string, key: string): string {
    const cached = this.thumbs.get(key);
    if (cached !== undefined) return cached;
    let url = '';
    try {
      const model = builtInModelById(modelId);
      if (model) {
        this.thumbnailer ??= new Thumbnailer(96);
        const render = new ModelRender(model, this.host.textures);
        url = this.thumbnailer.render(render);
        render.dispose();
      }
    } catch (err) {
      console.warn('thumbnail failed', err);
    }
    this.thumbs.set(key, url);
    return url;
  }

  private prefabThumbnail(p: Prefab): string {
    const o = p.object;
    if (o.kind === 'model') {
      return this.host.store.getModel(o.modelId) ? this.thumbnailFor(o.modelId) : this.builtInThumbnail(o.modelId, `prefab:${p.id}`);
    }
    return this.tileThumbnail(o.tile, o.color, `prefab:${p.id}`);
  }

  // ---- renaming in place

  private renamePrefab(id: string): void {
    const { store } = this.host;
    const prefab = store.getPrefab(id);
    const label = this.element.querySelector<HTMLElement>(`[data-prefab-id="${id}"] .asset-name`);
    if (!prefab || !label) return;
    renameInline(label, prefab.name, (name) => {
      prefab.name = name;
      store.prefabChanged(id);
      this.host.refreshAssets();
      this.host.refreshInspector();
    });
  }

  private renameModel(id: string): void {
    const { store } = this.host;
    const model = store.getModel(id);
    const label = this.element.querySelector<HTMLElement>(`[data-model-id="${id}"] .asset-name`);
    if (!model || !label) return;
    renameInline(label, model.name, (name) => {
      model.name = name;
      store.modelChanged(id, false);
      this.host.refreshAssets();
      this.host.refreshInspector();
    });
  }

  // ---- the list

  render(): void {
    const { host } = this;
    clear(this.element);
    host.fillNewObjectSelect();

    // game objects: the built-in ones and your own
    const prefabs = host.store.project.prefabs;
    this.element.append(el('div', { class: 'tree-group', text: `Game objects (${prefabs.length})` }));
    const objectGrid = el('div', { class: 'asset-grid' });
    for (const p of prefabs) {
      const thumb = this.prefabThumbnail(p);
      const card = el(
        'div',
        {
          class: `asset-card${host.selectedPrefabId === p.id ? ' selected' : ''}`,
          draggable: true,
          'data-prefab-id': p.id,
          title: `${p.name}: click to edit its look and behavior, double-click to place, drag into the view. Double-click the name to rename.`,
        },
        thumb ? el('img', { src: thumb, alt: p.name, draggable: false }) : el('div', { class: 'asset-empty', text: '★' }),
        el('span', { class: 'asset-name', text: p.name }),
      );
      card.addEventListener('click', () => host.selectAsset({ prefab: p.id }));
      card.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).classList.contains('asset-name')) {
          this.renamePrefab(p.id);
          return;
        }
        host.placePrefab(p.id, host.viewport.viewCenterPoint());
      });
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(PREFAB_DRAG_MIME, p.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      objectGrid.append(card);
    }
    this.element.append(objectGrid);

    const models = host.store.project.models;
    this.element.append(el('div', { class: 'tree-group', text: `Models (${models.length})` }));
    if (models.length === 0) {
      this.element.append(
        el('div', { class: 'empty muted', text: 'No models yet. Create one in the Models editor, then drag it into the level.' }),
        el('div', { class: 'button-stack' }, el('button', { class: 'btn primary', text: 'Create a model', onclick: () => host.newModel() })),
      );
      return;
    }
    const grid = el('div', { class: 'asset-grid' });
    for (const m of models) {
      const thumb = this.thumbnailFor(m.id);
      const card = el(
        'div',
        {
          class: `asset-card${host.selectedAssetId === m.id ? ' selected' : ''}`,
          draggable: true,
          'data-model-id': m.id,
          title: `${m.name}: click to select, double-click to place, drag into the view. Double-click the name to rename.`,
        },
        thumb ? el('img', { src: thumb, alt: m.name, draggable: false }) : el('div', { class: 'asset-empty', text: '∅' }),
        el('span', { class: 'asset-name', text: m.name }),
      );
      card.addEventListener('click', () => host.selectAsset({ model: m.id }));
      card.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).classList.contains('asset-name')) {
          this.renameModel(m.id);
          return;
        }
        host.placeModel(m.id, host.viewport.viewCenterPoint());
      });
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(MODEL_DRAG_MIME, m.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      grid.append(card);
    }
    this.element.append(grid);
  }
}
