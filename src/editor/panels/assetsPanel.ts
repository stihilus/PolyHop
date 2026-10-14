// The Assets dock: every model of the project as a card with a picture, to select, rename, place and drag. A card is
// purple when it is a component (a master that is placed as linked instances) and yellow when it is an ordinary object.

import { instancesOf, isComponent } from '../../core/components';
import type { Model } from '../../core/types';
import { Thumbnailer } from '../thumbnails';
import { MODEL_DRAG_MIME } from '../viewport';
import { clear, el } from '../ui/dom';
import { renameInline } from '../ui/rename';
import type { PanelHost } from './host';

type Kind = 'all' | 'components' | 'objects';

export class AssetsPanel {
  readonly element = el('div', { class: 'assets-dock' });
  private thumbnailer: Thumbnailer | null = null;
  private thumbs = new Map<string, string>();
  private filter = '';
  private kind: Kind = 'all';
  private grid = el('div', { class: 'asset-grid' });
  private head = el('div', { class: 'assets-head' });
  private searchEl = el('input', { type: 'search', class: 'scene-filter assets-search', placeholder: 'Find an asset…', title: 'Show only the assets whose name has this in it' });
  private countEl = el('span', { class: 'muted assets-count' });

  /** The dock was asked to fold or unfold. */
  onToggle?: () => void;

  constructor(private host: PanelHost) {
    this.searchEl.addEventListener('input', () => {
      this.filter = this.searchEl.value;
      this.renderGrid();
    });
    this.searchEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.searchEl.value = '';
        this.filter = '';
        this.renderGrid();
      }
    });
    this.element.append(this.head, this.grid);
    this.buildHead();
  }

  // ---- thumbnails (rendered once and kept until what they show changes)

  /** Every thumbnail may be out of date (the project or a texture changed). */
  clearThumbs(): void {
    this.thumbs.clear();
  }

  dropThumb(id: string): void {
    this.thumbs.delete(id);
    // a variant or a holder is drawn from the shapes of this one
    for (const dep of this.host.store.dependents(id)) this.thumbs.delete(dep);
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

  // ---- the head: title, search, filter, actions

  private buildHead(): void {
    const { host } = this;
    const chip = (kind: Kind, label: string, title: string) => {
      const b = el('button', { class: `chip${this.kind === kind ? ' active' : ''}`, text: label, title, 'data-kind': kind });
      b.addEventListener('click', () => {
        this.kind = kind;
        for (const c of this.head.querySelectorAll('.chip')) c.classList.toggle('active', c.getAttribute('data-kind') === kind);
        this.renderGrid();
      });
      return b;
    };
    clear(this.head);
    this.head.append(
      el('button', { class: 'dock-toggle', text: '▾', title: 'Fold the Assets (double-click the title)', onclick: () => this.onToggle?.() }),
      el('span', { class: 'assets-title', text: 'Assets', ondblclick: () => this.onToggle?.() }),
      this.countEl,
      this.searchEl,
      chip('all', 'All', 'Components and objects'),
      chip('components', '◆ Components', 'Masters you place as linked instances'),
      chip('objects', '▣ Objects', 'Ordinary models'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', text: 'Place', title: 'Add the selected asset to the level', onclick: () => this.placeSelected() }),
      el('button', { class: 'btn', text: 'Edit in Models', title: 'Open the selected asset in the model editor', onclick: () => this.editSelected() }),
      el('button', { class: 'btn', text: '+ New object', title: 'A new model to build in the Models tab', onclick: () => host.newModel() }),
    );
  }

  private placeSelected(): void {
    const id = this.host.selectedAssetId;
    if (id) this.host.placeModel(id, this.host.viewport.viewCenterPoint());
  }

  private editSelected(): void {
    const id = this.host.selectedAssetId ?? this.host.store.project.models[0]?.id ?? null;
    if (id) this.host.openModel(id);
  }

  // ---- renaming in place

  private renameModel(id: string): void {
    const { store } = this.host;
    const model = store.getModel(id);
    const label = this.element.querySelector<HTMLElement>(`[data-model-id="${id}"] .asset-name`);
    if (!model || !label) return;
    renameInline(label, model.name, (name) => {
      model.name = name;
      store.componentChanged(id, 'edit:name');
      store.modelChanged(id, false);
      this.host.refreshAssets();
      this.host.refreshInspector();
    });
  }

  // ---- the list

  render(): void {
    this.renderGrid();
  }

  private cardOf(m: Model, placed: number): HTMLElement {
    const { host } = this;
    const comp = isComponent(m);
    const thumb = this.thumbnailFor(m.id);
    const mark = comp ? '◆' : '▣';
    const kind = comp ? (m.variantOf ? 'a variant' : 'a component') : 'an ordinary object';
    const card = el(
      'div',
      {
        class: `asset-card ${comp ? 'asset-component' : 'asset-object'}${host.selectedAssetId === m.id ? ' selected' : ''}`,
        draggable: true,
        'data-model-id': m.id,
        title: `${m.name}: ${kind}${placed > 0 ? `, placed ${placed} time${placed === 1 ? '' : 's'}` : ''}. Click to select, double-click to place, drag into the view. Double-click the name to rename.`,
      },
      thumb ? el('img', { src: thumb, alt: m.name, draggable: false }) : el('div', { class: 'asset-empty', text: '∅' }),
      el('span', { class: 'asset-mark', text: m.variantOf ? `${mark}⁺` : mark }),
      ...(placed > 0 ? [el('span', { class: 'asset-count', text: `×${placed}` })] : []),
      el('span', { class: 'asset-name', text: m.name }),
    );
    card.addEventListener('click', () => host.selectAsset(m.id));
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
    return card;
  }

  private renderGrid(): void {
    const { host } = this;
    const models = host.store.project.models;
    const query = this.filter.trim().toLowerCase();
    const placedBy = new Map<string, number>();
    for (const m of models) placedBy.set(m.id, instancesOf(host.store.project.levels, m.id).length);

    const shown = models
      .filter((m) => (this.kind === 'all' ? true : this.kind === 'components' ? isComponent(m) : !isComponent(m)))
      .filter((m) => !query || m.name.toLowerCase().includes(query));
    // components first, then the ordinary objects
    const ordered = [...shown.filter(isComponent), ...shown.filter((m) => !isComponent(m))];
    this.countEl.textContent = `${ordered.length}`;

    clear(this.grid);
    if (models.length === 0) {
      this.grid.append(
        el('div', { class: 'empty muted', text: 'No models yet. Build one in the Models tab, or add a shape to the level and make it a component.' }),
      );
      return;
    }
    if (ordered.length === 0) {
      this.grid.append(el('div', { class: 'empty muted', text: 'Nothing matches.' }));
      return;
    }
    for (const m of ordered) this.grid.append(this.cardOf(m, placedBy.get(m.id) ?? 0));
  }
}
