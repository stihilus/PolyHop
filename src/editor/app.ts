import { type PresetKind, presetRules } from '../core/presets';
import { instantiatePrefab, newPrefab } from '../core/prefabs';
import { meshBounds } from '../core/mesh';
import { PRIMITIVES, type PrimitiveKind, primitiveMesh } from '../core/meshGen';
import { type TerrainInfo, terrainMesh } from '../core/terrain';
import { importRigJson } from '../core/blockbench';
import {
  type LevelObject,
  type Prefab,
  type Vec3,
  createBlock,
  createDefaultProject,
  createModelInstance,
  ensurePresetAssets,
  newId,
} from '../core/types';
import type { TextureLibrary } from '../runtime/textures';
import { AnimationEditor } from './animationEditor';
import { AudioEditor } from './audioEditor';
import { ModelEditor } from './modelEditor';
import { PaintEditor } from './paintEditor';
import type { FileSession } from './fileSession';
import type { Store, StoreEvent } from './store';
import { clear, el } from './ui/dom';
import { keyLabel, openSettingsDialog } from './ui/settingsDialog';
import { icon } from './ui/icons';
import { buildBehaviorEditor, buildVariablesPanel } from './ui/logicPanels';
import { renameInline } from './ui/rename';
import { DEFAULT_EXPORT_OPTIONS, exportGame } from './exportGame';
import { openExportDialog } from './ui/exportDialog';
import { shortcutSheet } from './ui/shortcutSheet';
import { makeSplitter } from './ui/splitter';
import { AssetsPanel } from './panels/assetsPanel';
import type { LeftTab, Mode, PanelHost } from './panels/host';
import { buildMultiInspector, buildBlockInspector, buildModelInstanceInspector, buildPrefabInspector } from './panels/objectInspectors';
import { buildPlayerInspector } from './panels/playerPanel';
import { fillHierarchy, fillLevelBar } from './panels/sceneTree';
import { buildLevelPanel, buildPaintPanel, buildSculptPanel } from './panels/toolPanels';
import { Viewport } from './viewport';

export const APP_NAME = 'PolyHop';

export class EditorApp {
  /** Exposed for dev-time debugging (window.__app). */
  viewport!: Viewport;
  modelEditor!: ModelEditor;
  paintEditor!: PaintEditor;
  animationEditor!: AnimationEditor;
  audioEditor!: AudioEditor;

  private mode: Mode = 'level';
  private levelWorkspace = el('div', { class: 'workspace level-workspace' });
  private hierarchy = el('div', { class: 'hierarchy' });
  private assets!: AssetsPanel;
  private host!: PanelHost;
  private sceneToolbar = el('div', { class: 'panel-toolbar' });
  private sceneFilter = '';
  private assetToolbar = el('div', { class: 'panel-toolbar hidden' });
  /** "+ New object…": pick what the new game object is made of (a block, or one of the models). */
  private newObjectSelect = el('select', { class: 'add-shape', title: 'A new game object: choose a plain block or one of your models, then give it a look and a behavior' });
  private leftTab: LeftTab = 'scene';
  private varsEl = el('div', { class: 'vars-panel hidden' });
  private leftTabs = el('div', { class: 'tabs' });
  private levelBar = el('div', { class: 'level-bar' });
  private selectedAssetId: string | null = null;
  /** A game object asset selected in the Assets panel (its properties are shown on the right). */
  private selectedPrefabId: string | null = null;
  private inspector = el('div', { class: 'inspector' });
  private playBtn = el('button', { class: 'btn play-btn', text: '▶  Play' });
  private modeButtons = new Map<Mode, HTMLButtonElement>();
  private titleEl = el('span', { class: 'project-title' });
  private hudTop = el('div', { class: 'hud hud-top' });
  private hudBottom = el('div', { class: 'hud hud-bottom' });
  private shortcuts = shortcutSheet(() => this.toggleShortcuts(false));
  private saveStatus = el('span', { class: 'save-status muted', text: '' });
  private saveBtn = el('button', { class: 'btn save-btn', title: 'Save everything (textures, models, level) to the project file (Ctrl/Cmd+S)' }, icon('save', 16), el('span', { text: 'Save' }));
  private levelToolbar = el('div', { class: 'model-toolbar level-toolbar' });
  private overlay = el('div', { class: 'view-overlay' });
  private undoBtn = el('button', { class: 'tool-btn', title: 'Undo (Ctrl/Cmd+Z)' }, icon('undo', 18));
  private redoBtn = el('button', { class: 'tool-btn', title: 'Redo (Ctrl/Cmd+Shift+Z)' }, icon('redo', 18));
  private noticeTimer: number | undefined;

  private assetsTimer: number | undefined;
  private inspectorTimer: number | undefined;

  constructor(
    private root: HTMLElement,
    private store: Store,
    private textures: TextureLibrary,
    private files: FileSession,
  ) {
    this.host = this.makeHost();
    this.assets = new AssetsPanel(this.host);
    this.build();
    this.files.onChange = () => this.updateFileStatus();
    this.updateFileStatus();
    this.store.subscribe((e) => this.onStoreEvent(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('pointerlockchange', () => this.updateHud());
    this.refreshAll();
  }

  /** Which file the project is saved to and whether it has unsaved changes. */
  private updateFileStatus(): void {
    const s = this.files.state();
    this.saveBtn.classList.toggle('dirty', s.dirty);
    this.saveStatus.classList.toggle('dirty', s.dirty && s.name !== null);
    if (s.name === null) {
      this.saveStatus.textContent = 'Not saved to a file yet';
      this.saveStatus.title = 'Press Save (Ctrl/Cmd+S) to write the whole project to a file. It is also autosaved in this browser.';
    } else {
      this.saveStatus.textContent = `${s.dirty ? '● ' : '✓ '}${s.name}${s.dirty ? ' · unsaved changes' : ''}`;
      this.saveStatus.title = s.overwrites
        ? 'Save overwrites this file. The project is also autosaved in this browser.'
        : 'This browser cannot overwrite files, so Save downloads a new copy each time.';
    }
  }

  private exportOptions = { ...DEFAULT_EXPORT_OPTIONS };

  private openExport(): void {
    this.viewport.stop();
    this.updatePlayUi();
    openExportDialog(this.store.project.settings.name, this.exportOptions, async (options) => {
      this.exportOptions = { ...options };
      const r = await exportGame(this.store, this.files, options);
      return `Saved ${r.fileName} (${(r.bytes / 1024).toFixed(0)} KB: ${r.files.join(', ')}).`;
    });
  }

  private async saveProject(asNew = false): Promise<void> {
    const r = await this.files.save(asNew);
    if (r === 'downloaded') this.saveStatus.title = 'This browser cannot overwrite files, so Save downloads a new copy each time.';
  }

  private async importRig(file: File): Promise<void> {
    try {
      const json = JSON.parse(await file.text()) as { textures?: Record<string, string> };
      const answer = prompt('How tall should the model be, in meters?\n(Leave empty to use 16 file units = 1 m.)', '1');
      if (answer === null) return;
      const height = parseFloat(answer);

      // the file names its texture; use the one of that name when it exists
      const wanted = Object.values(json.textures ?? {}).concat(Object.keys(json.textures ?? {}));
      const have = this.textures.names();
      const texture =
        wanted.map((w) => have.find((n) => n.toLowerCase() === w.toLowerCase() || n.toLowerCase() === `${w.toLowerCase()}.png`)).find(Boolean) ?? null;

      const result = importRigJson(json, {
        idGen: newId,
        name: file.name.replace(/\.json$/i, '') || 'Imported rig',
        scale: 1 / 16,
        fitHeight: Number.isFinite(height) && height > 0 ? height : undefined,
        texture,
      });
      this.viewport.stop();
      this.updatePlayUi();
      this.store.addModel(result.model);
      this.setMode('model');
      this.modelEditor.open(result.model.id);

      const lines = [`Imported "${result.model.name}": ${result.model.cubes.length} parts, ${result.model.bones.length} bones.`];
      if (!texture) {
        lines.push(
          `The model has no texture yet. Its UVs are written for a ${result.textureWidth} × ${result.textureHeight} px image: ` +
            'import that PNG in the Paint tab, then pick it under Model > Texture.',
        );
      }
      if (result.warnings.length > 0) lines.push(`Notes: ${result.warnings.slice(0, 3).join('; ')}`);
      alert(lines.join('\n\n'));
    } catch (err) {
      alert(`Could not import the rig: ${err instanceof Error ? err.message : err}`);
    }
  }

  private confirmDiscard(question: string): boolean {
    return !this.files.state().dirty || confirm(`${question}\n\nThe current project has changes that are not saved to a file.`);
  }

  /** A new project is the blank one: a flat ground, the characters, and nothing else. */
  private async newProject(): Promise<void> {
    if (!this.confirmDiscard('Start a new project?')) return;
    this.viewport.stop();
    this.updatePlayUi();
    this.store.setProject(createDefaultProject());
    void this.files.detach();
  }

  private async openProject(fallbackInput: HTMLInputElement): Promise<void> {
    if (!this.confirmDiscard('Open another project?')) return;
    if (!this.files.supported) {
      fallbackInput.click();
      return;
    }
    if (this.viewport.playing) {
      this.viewport.stop();
      this.updatePlayUi();
    }
    await this.files.open();
  }

  /** What the panels (src/editor/panels) use of the editor. */
  private makeHost(): PanelHost {
    const app = this;
    return {
      get store() {
        return app.store;
      },
      get viewport() {
        return app.viewport;
      },
      get textures() {
        return app.textures;
      },
      get modelEditor() {
        return app.modelEditor;
      },
      get inspector() {
        return app.inspector;
      },
      get leftTab() {
        return app.leftTab;
      },
      get selectedPrefabId() {
        return app.selectedPrefabId;
      },
      set selectedPrefabId(id: string | null) {
        app.selectedPrefabId = id;
      },
      get selectedAssetId() {
        return app.selectedAssetId;
      },
      refreshInspector: () => this.refreshInspector(),
      refreshAssets: () => this.refreshAssets(),
      touch: (obj) => this.touch(obj),
      behaviorEditor: (obj, apply) => this.behaviorEditor(obj, apply),
      applyPreset: (obj, kind) => this.applyPreset(obj, kind),
      setMode: (mode) => this.setMode(mode),
      setLeftTab: (tab) => this.setLeftTab(tab),
      openAnimation: (id) => this.openAnimation(id),
      selectAsset: (sel) => this.selectAsset(sel),
      placePrefab: (id, at) => this.placePrefab(id, at),
      placeModel: (id, at) => this.placeModel(id, at),
      newModel: () => this.newModel(),
      duplicateSelected: () => this.duplicateSelected(),
      deleteSelected: () => this.deleteSelected(),
      fillNewObjectSelect: () => this.fillNewObjectSelect(),
    };
  }

  // ---------------------------------------------------------------- layout

  private build(): void {
    const viewportEl = el('div', { class: 'viewport' });

    const addShape = el('select', { class: 'add-shape', title: 'Add a block, ramp, cylinder, rock, plane or grass tuft to the level. Coins, doors and the other game objects are in Assets.' });
    addShape.append(el('option', { value: '', text: '+ Add shape…' }));
    for (const p of PRIMITIVES) addShape.append(el('option', { value: p.kind, text: p.label === 'Cube' ? 'Block' : p.label }));
    addShape.append(el('option', { value: 'terrain', text: 'Terrain (sculptable)' }));
    addShape.addEventListener('change', () => {
      const value = addShape.value;
      addShape.value = '';
      if (value === 'terrain') this.addTerrain();
      else if (value) this.addShape(value as PrimitiveKind);
    });
    const filter = el('input', { type: 'search', class: 'scene-filter', placeholder: 'Find an object…', title: 'Show only the objects whose name has this in it (Esc clears)' });
    filter.addEventListener('input', () => {
      this.sceneFilter = filter.value;
      this.refreshHierarchy();
    });
    filter.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        filter.value = '';
        this.sceneFilter = '';
        this.refreshHierarchy();
      }
    });
    this.sceneToolbar.append(
      addShape,
      el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicateSelected() }),
      el('button', { class: 'btn danger', text: 'Delete', onclick: () => this.deleteSelected() }),
      filter,
    );
    this.newObjectSelect.addEventListener('change', () => {
      const choice = this.newObjectSelect.value;
      this.newObjectSelect.value = '';
      if (choice) this.newPrefab(choice);
    });
    this.assetToolbar.append(
      el('button', { class: 'btn', text: 'Place', title: 'Add the selected asset to the level', onclick: () => this.placeSelectedAsset() }),
      el('button', { class: 'btn', text: 'Edit', title: 'Open the selected model in the model editor', onclick: () => this.editSelectedAsset() }),
      el('button', { class: 'btn', text: '+ New model', onclick: () => this.newModel() }),
      this.newObjectSelect,
    );

    for (const [id, label] of [
      ['scene', 'Scene'],
      ['assets', 'Assets'],
      ['vars', 'Variables'],
    ] as const) {
      this.leftTabs.append(
        el('button', {
          class: `tab${this.leftTab === id ? ' active' : ''}`,
          'data-tab': id,
          text: label,
          onclick: () => this.setLeftTab(id),
        }),
      );
    }

    this.undoBtn.addEventListener('click', () => this.store.undoLevel());
    this.redoBtn.addEventListener('click', () => this.store.redoLevel());

    this.levelWorkspace.append(
      el(
        'aside',
        { class: 'panel panel-left' },
        this.levelBar,
        this.leftTabs,
        this.sceneToolbar,
        this.assetToolbar,
        this.hierarchy,
        this.assets.element,
        this.varsEl,
      ),
      el('section', { class: 'viewport-wrap' }, viewportEl, this.overlay, this.hudTop, this.hudBottom, this.shortcuts),
      makeSplitter(this.levelWorkspace, { key: 'polyhop.levelRightWidth', min: 280, maxShare: 0.5 }),
      el(
        'aside',
        { class: 'panel panel-right' },
        el('div', { class: 'panel-header' }, el('span', { text: 'Properties' })),
        this.inspector,
      ),
    );

    this.root.append(this.buildTopbar(), this.levelWorkspace);
    this.hierarchy.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-object-id]');
      if (row?.dataset.objectId) this.renameObject(row.dataset.objectId);
    });

    this.viewport = new Viewport(viewportEl, this.store, this.textures);
    this.levelToolbar.append(
      el('div', { class: 'tb-group' }, this.viewport.viewMenu.el),
      this.viewport.bar.el,
      el('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      el('button', { class: 'tool-btn', text: '?', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: () => this.toggleShortcuts() }),
    );
    // settings row on top, vertical tool strip under it on the left edge (both hidden while the game plays)
    this.overlay.append(this.levelToolbar, this.viewport.bar.strip);
    this.viewport.onNotify = (text) => {
      this.hudTop.textContent = text;
      window.clearTimeout(this.noticeTimer);
      this.noticeTimer = window.setTimeout(() => {
        if (!this.viewport.playing) this.hudTop.textContent = '';
      }, 4000);
    };
    this.viewport.onNavStatus = (text) => {
      if (!this.viewport.playing) this.hudTop.textContent = text ?? '';
    };
    this.viewport.onPlayStats = (s) => {
      this.hudTop.textContent = `${s.grounded ? 'on ground' : 'airborne'}${s.crouching ? ' · crouching' : ''} · ${s.speed.toFixed(1)} m/s · pos ${s.pos.map((n) => n.toFixed(1)).join(', ')}`;
    };
    this.viewport.onDropModel = (modelId, pos) => this.placeModel(modelId, pos);
    this.viewport.onDropPrefab = (id, pos) => this.placePrefab(id, pos);
    this.viewport.onToolChange = () => this.refreshInspector();
    this.viewport.onBrushPicked = () => this.refreshInspector();
    this.viewport.onExitRequest = () => {
      this.viewport.stop();
      this.updatePlayUi();
    };

    this.modelEditor = new ModelEditor(this.store, this.textures, this.viewport.game.models);
    this.modelEditor.onPlaceInLevel = (modelId) => {
      this.setMode('level');
      this.placeModel(modelId, this.viewport.viewCenterPoint());
    };
    this.modelEditor.onEditTexture = (name) => {
      this.setMode('paint');
      this.paintEditor.open(name, this.modelEditor.currentModelId ?? '');
    };
    this.paintEditor = new PaintEditor(this.store, this.textures);
    this.animationEditor = new AnimationEditor(this.store, this.textures, this.viewport.game.models);
    this.modelEditor.onAnimate = (modelId) => this.openAnimation(modelId);
    this.audioEditor = new AudioEditor(this.store);
    this.root.append(this.modelEditor.root, this.paintEditor.root, this.animationEditor.root, this.audioEditor.root);
    this.updateHistoryButtons();
  }

  private buildTopbar(): HTMLElement {
    const fileItems = el('div', { class: 'menu-items' });
    const fileMenu = el('div', { class: 'menu' }, el('button', { class: 'btn', text: 'File ▾' }), fileItems);
    // browsers without the File System Access API pick a file with a plain input (no overwrite on save)
    const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      this.viewport.stop();
      this.updatePlayUi();
      await this.files.open(file);
    });

    // a rig exported from Blockbench (Hytale "blockymodel" JSON): becomes a model with bones
    const rigInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    rigInput.addEventListener('change', async () => {
      const file = rigInput.files?.[0];
      rigInput.value = '';
      if (file) await this.importRig(file);
    });

    const closeMenu = () => fileMenu.classList.remove('open');
    const item = (text: string, fn: () => void, disabled = false) =>
      el('button', {
        class: 'menu-item',
        text,
        disabled,
        onclick: () => {
          closeMenu();
          fn();
        },
      });
    fileItems.append(
      item('New project', () => void this.newProject()),
      item('Open project…', () => void this.openProject(fileInput)),
      item('Save  (Ctrl/Cmd+S)', () => void this.saveProject()),
      item('Save as…  (Ctrl/Cmd+Shift+S)', () => void this.saveProject(true)),
      item('Import rig model (.json)…', () => rigInput.click()),
      item('Export game (HTML5 .zip)…', () => this.openExport()),
    );
    fileMenu.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      fileMenu.classList.toggle('open');
    });
    document.addEventListener('click', closeMenu);

    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.saveBtn.addEventListener('click', () => void this.saveProject());

    const modeTabs = el('div', { class: 'mode-tabs' });
    for (const [id, label] of [
      ['level', 'Level'],
      ['model', 'Models'],
      ['paint', 'Paint'],
      ['animate', 'Animate'],
      ['audio', 'Audio'],
    ] as const) {
      const b = el('button', {
        class: `mode-tab${id === this.mode ? ' active' : ''}`,
        text: label,
        onclick: () => this.setMode(id),
      });
      this.modeButtons.set(id, b);
      modeTabs.append(b);
    }

    return el(
      'header',
      { class: 'topbar' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: '◆' }), el('span', { text: APP_NAME })),
      fileMenu,
      this.saveBtn,
      el('button', { class: 'btn', text: 'Project Settings', onclick: () => openSettingsDialog(this.store) }),
      modeTabs,
      el('div', { class: 'spacer' }),
      this.playBtn,
      el('div', { class: 'spacer' }),
      this.titleEl,
      this.saveStatus,
      fileInput,
      rigInput,
    );
  }

  // ---------------------------------------------------------------- modes

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    if (mode !== 'level' && this.viewport.playing) {
      this.viewport.stop();
      this.updatePlayUi();
    }
    this.mode = mode;
    for (const [id, b] of this.modeButtons) b.classList.toggle('active', id === mode);
    this.levelWorkspace.classList.toggle('hidden', mode !== 'level');
    this.viewport.active = mode === 'level';
    this.modelEditor.setActive(mode === 'model');
    this.paintEditor.setActive(mode === 'paint');
    this.animationEditor.setActive(mode === 'animate');
    this.audioEditor.setActive(mode === 'audio');
    this.playBtn.disabled = mode !== 'level';
    if (mode === 'level') this.scheduleAssetsRefresh();
  }

  private setLeftTab(tab: LeftTab): void {
    this.leftTab = tab;
    this.varsEl.classList.toggle('hidden', tab !== 'vars');
    this.sceneToolbar.classList.toggle('hidden', tab !== 'scene');
    if (tab === 'vars') this.refreshVariables();
    for (const t of this.leftTabs.querySelectorAll('.tab')) t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    this.hierarchy.classList.toggle('hidden', tab !== 'scene');
    this.sceneToolbar.classList.toggle('hidden', tab !== 'scene');
    this.assets.element.classList.toggle('hidden', tab !== 'assets');
    this.assetToolbar.classList.toggle('hidden', tab !== 'assets');
    if (tab === 'assets') this.refreshAssets();
    this.refreshInspector();
  }

  // ---------------------------------------------------------------- actions

  private togglePlay(): void {
    if (this.mode !== 'level') return;
    if (this.viewport.playing) this.viewport.stop();
    else this.viewport.play();
    this.updatePlayUi();
  }

  private updatePlayUi(): void {
    const playing = this.viewport.playing;
    this.playBtn.textContent = playing ? '■  Stop' : '▶  Play';
    this.playBtn.classList.toggle('playing', playing);
    this.root.classList.toggle('is-playing', playing);
    this.overlay.classList.toggle('hidden', playing);
    this.refreshLevelBar();
    this.updateHud();
  }

  private updateHud(): void {
    if (this.viewport.playing) {
      const c = this.store.project.settings.controls;
      const k = (a: keyof typeof c) => c[a].map(keyLabel).join('/');
      const chase = this.store.project.player.cameraMode === 'chase';
      const move = chase
        ? `${k('forward')} ${k('back')} move · ${k('left')} ${k('right')} turn · mouse turns`
        : `${k('forward')} ${k('left')} ${k('back')} ${k('right')} move · mouse look`;
      const jump = this.store.project.player.doubleJump ? `${k('jump')} jump (twice in the air)` : `${k('jump')} jump`;
      const pad = this.store.project.settings.gamepad ? ' · Gamepad: sticks move and look, ✕ jump, □ run, ○ crouch, △ use, Options stops' : '';
      this.hudBottom.textContent = `${move} · ${k('run')} run · ${jump} · ${k('crouch')} crouch · Esc ${this.viewport.pointerLocked ? 'releases mouse' : 'stops'}${pad}`;
    } else {
      this.hudBottom.textContent = 'Orbit: middle mouse · Pan: Shift + middle · Zoom: wheel · Fly: hold right mouse + W A S D · ? all shortcuts';
      this.hudTop.textContent = '';
    }
  }

  private toggleShortcuts(show = this.shortcuts.classList.contains('hidden')): void {
    this.shortcuts.classList.toggle('hidden', !show);
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = !this.store.canUndoLevel;
    this.redoBtn.disabled = !this.store.canRedoLevel;
  }

  private addShape(kind: PrimitiveKind): void {
    const info = PRIMITIVES.find((p) => p.kind === kind)!;
    // thin shapes want a texture with transparent pixels: prefer an atlas that looks like plants
    const plants = info.cutout ? this.textures.names().find((n) => /plant|grass|foliage|leaf|leaves|flora/i.test(n)) : undefined;
    // otherwise an atlas whose default tile (col 7, row 0) has something in it
    const t = plants ?? this.textures.atlasWithTile(7, 0) ?? this.textures.names()[0];
    const tile = t ? (plants ? { texture: t, col: 0, row: 0 } : { texture: t, col: 7, row: 0 }) : null;
    const target = this.viewport.viewCenterPoint();
    const mesh = primitiveMesh(kind, undefined, this.store.objects.length * 7919 + 1);
    const b = meshBounds(mesh);
    const obj = createBlock(info.label === 'Cube' ? 'Block' : info.label, [target[0], -b.min[1], target[2]], mesh, tile);
    obj.collide = info.solid;
    if (info.rotation) obj.rotation = [...info.rotation];
    if (info.smooth) obj.smooth = true;
    this.store.addObject(obj);
  }

  /** A flat terrain, 32 x 32 m in 1 m cells, with the sculpt tool switched on. */
  private addTerrain(): void {
    const info: TerrainInfo = { cols: 32, rows: 32, cell: 1 };
    const atlas = this.textures.names().includes('Textures-16.png') ? 'Textures-16.png' : this.textures.names()[0];
    const tile = atlas ? { texture: atlas, col: 3, row: 16 } : null; // the grass of the main atlas
    const [x, , z] = this.viewport.viewCenterPoint();
    const block = createBlock('Terrain', [x, 0, z], terrainMesh(info), tile);
    block.terrain = info;
    block.smooth = true;
    this.store.addObject(block);
    this.viewport.bar.setTool('sculpt');
  }

  private placeModel(modelId: string, position: Vec3): void {
    const model = this.store.getModel(modelId);
    if (!model) return;
    this.store.addObject(createModelInstance(model, position));
    this.setLeftTab('scene');
  }

  /** A game object asset into the level, with the variables, sounds and model it needs. */
  private placePrefab(id: string, position: Vec3): void {
    const prefab = this.store.getPrefab(id);
    if (!prefab) return;
    if (prefab.base) this.ensureAssets(prefab.base);
    this.store.addObject(instantiatePrefab(prefab, position, newId));
    this.setLeftTab('scene');
  }

  private placeSelectedAsset(): void {
    if (this.selectedPrefabId) this.placePrefab(this.selectedPrefabId, this.viewport.viewCenterPoint());
    else if (this.selectedAssetId) this.placeModel(this.selectedAssetId, this.viewport.viewCenterPoint());
  }

  private editSelectedAsset(): void {
    const id = this.selectedAssetId ?? this.store.project.models[0]?.id ?? null;
    this.setMode('model');
    if (id) this.modelEditor.open(id);
  }

  /** A fresh game object asset made of a plain block or of the given model. */
  private newPrefab(choice: string): void {
    let prefab: Prefab;
    if (choice === 'block') {
      const tile = this.textures.atlasWithTile(7, 0) ?? this.textures.names()[0];
      prefab = newPrefab({ kind: 'block', tile: tile ? { texture: tile, col: 7, row: 0 } : null }, 'New object', newId);
    } else {
      const model = this.store.getModel(choice);
      if (!model) return;
      prefab = newPrefab({ kind: 'model', modelId: model.id }, model.name, newId);
    }
    this.store.project.prefabs.push(prefab);
    this.store.prefabChanged(prefab.id);
    this.selectAsset({ prefab: prefab.id });
  }

  /** The choices of "+ New object…": a block, or any model of the project. */
  private fillNewObjectSelect(): void {
    const select = this.newObjectSelect;
    select.replaceChildren(el('option', { value: '', text: '+ New object…' }), el('option', { value: 'block', text: 'Plain block' }));
    const group = el('optgroup', { label: 'Made of a model' });
    for (const m of this.store.project.models) group.append(el('option', { value: m.id, text: m.name }));
    if (group.childElementCount > 0) select.append(group);
  }

  /** Select a model or a game object in the Assets panel. */
  private selectAsset(sel: { model?: string; prefab?: string } | null): void {
    this.selectedAssetId = sel?.model ?? null;
    this.selectedPrefabId = sel?.prefab ?? null;
    this.refreshAssets();
    this.refreshInspector();
  }

  /** Switch to the animation editor with a model open. */
  openAnimation(modelId: string | null): void {
    this.setMode('animate');
    this.animationEditor.open(modelId);
  }

  private newModel(): void {
    this.setMode('model');
    this.modelEditor.createNewModel();
  }

  private duplicateSelected(): void {
    this.store.duplicateObjects(this.store.selectedIds());
  }

  private deleteSelected(): void {
    this.store.removeObjects(this.store.selectedIds());
  }

  private onKey(e: KeyboardEvent): void {
    // Save works in every mode, also while typing in a field
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      void this.saveProject(e.shiftKey);
      return;
    }
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (this.mode !== 'level') return;
    if (!typing && e.key === '?' && !this.viewport.playing) {
      e.preventDefault();
      this.toggleShortcuts();
      return;
    }
    if (e.code === 'Escape' && !this.shortcuts.classList.contains('hidden')) {
      this.toggleShortcuts(false);
      return;
    }
    if (e.code === 'Escape' && this.viewport.playing && !this.viewport.pointerLocked) {
      this.viewport.stop();
      this.updatePlayUi();
      return;
    }
    if (typing || this.viewport.playing) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.store.redoLevel();
      else this.store.undoLevel();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.store.redoLevel();
      return;
    }
    if (mod && e.code === 'KeyA') {
      e.preventDefault();
      this.store.selectObjects(this.store.objects.map((o) => o.id));
      return;
    }
    if (mod && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if (mod && !e.code.startsWith('Numpad')) return; // Ctrl+Numpad are camera views
    if (e.code === 'F2') {
      const sel = this.store.selection;
      if (sel.kind === 'object') {
        e.preventDefault();
        this.renameObject(sel.id);
      }
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      if (!this.viewport.deleteElements()) this.deleteSelected();
      e.preventDefault();
    } else {
      this.viewport.handleKey(e);
    }
  }

  // ---------------------------------------------------------------- panels

  /** Gizmo drags change values continuously; refresh the inspector a few times per second. */
  private scheduleInspectorRefresh(): void {
    if (this.inspectorTimer !== undefined) return;
    this.inspectorTimer = window.setTimeout(() => {
      this.inspectorTimer = undefined;
      this.refreshInspector();
    }, 120);
  }

  private onStoreEvent(e: StoreEvent): void {
    this.updateHistoryButtons();
    switch (e.type) {
      case 'selection':
        this.refreshHierarchy();
        this.refreshInspector();
        break;
      case 'object-changed':
        this.refreshHierarchy();
        if (e.live) this.scheduleInspectorRefresh();
        break;
      case 'object-added':
      case 'object-removed':
        this.refreshHierarchy();
        break;
      case 'level-restored':
        this.refreshHierarchy();
        this.refreshInspector();
        break;
      case 'levels-changed':
        this.refreshLevelBar();
        this.refreshHierarchy();
        this.refreshInspector();
        break;
      case 'player-changed':
        if (e.live) this.scheduleInspectorRefresh();
        break;
      case 'project-replaced':
        this.assets.clearThumbs();
        this.selectedPrefabId = null;
        this.selectedAssetId = null;
        this.refreshAll();
        this.updatePlayUi();
        break;
      case 'variables-changed':
        if (this.leftTab === 'vars') this.refreshVariables();
        // the variable lists of the rule editors depend on them
        if (this.mode === 'level' && this.store.selection.kind === 'object') this.scheduleInspectorRefresh();
        break;
      case 'settings-changed':
        this.titleEl.textContent = this.store.project.settings.name;
        document.title = `${this.store.project.settings.name} — ${APP_NAME}`;
        this.updateHud();
        break;
      case 'model-changed':
        this.assets.dropThumb(e.id);
        this.scheduleAssetsRefresh();
        break;
      case 'texture-changed':
        // any texture edit can change how every model looks
        this.assets.clearThumbs();
        this.scheduleAssetsRefresh();
        if (e.structural && this.mode === 'level') this.refreshInspector();
        break;
      case 'prefabs-changed':
        this.assets.dropPrefabThumbs();
        this.scheduleAssetsRefresh();
        // a deleted or reset asset can no longer be the selected one
        if (this.selectedPrefabId && !this.store.getPrefab(this.selectedPrefabId)) {
          this.selectedPrefabId = null;
          this.refreshInspector();
        }
        break;
      case 'model-added':
      case 'model-removed':
        this.assets.dropThumb(e.id);
        if (this.selectedAssetId === e.id && e.type === 'model-removed') this.selectedAssetId = null;
        this.scheduleAssetsRefresh();
        // model names feed the player/instance dropdowns
        if (this.mode === 'level') this.refreshInspector();
        break;
    }
  }

  private refreshAll(): void {
    this.titleEl.textContent = this.store.project.settings.name;
    document.title = `${this.store.project.settings.name} — ${APP_NAME}`;
    this.refreshLevelBar();
    this.refreshHierarchy();
    this.refreshInspector();
    this.refreshAssets();
    this.updateHud();
    this.updateHistoryButtons();
  }

  private refreshAssets(): void {
    // the thumbnails are rendered here: only when the panel is there to show them
    if (this.leftTab !== 'assets') return;
    this.assets.render();
  }

  private scheduleAssetsRefresh(): void {
    window.clearTimeout(this.assetsTimer);
    this.assetsTimer = window.setTimeout(() => this.refreshAssets(), 150);
  }

  private refreshVariables(): void {
    clear(this.varsEl);
    this.varsEl.append(
      buildVariablesPanel({
        variables: () => this.store.project.variables,
        add: () => this.store.addVariable(),
        remove: (id) => this.store.removeVariable(id),
        rename: (id, name) => this.store.renameVariable(id, name),
        changed: () => this.store.variablesChanged(),
      }),
    );
  }

  /** The rule editor of an object. */
  private behaviorEditor(obj: LevelObject, apply: (kind: PresetKind) => void): HTMLElement {
    // an asset has no neighbours in a level to point at; a placed object does
    const inLevel = !this.isPrefabObject(obj);
    return buildBehaviorEditor({
      rules: obj.rules,
      variables: () => this.store.project.variables.map((v) => v.name),
      sounds: () => this.store.project.sounds.map((x) => ({ id: x.id, name: x.name })),
      objects: () => (inLevel ? this.store.objects.map((o) => ({ id: o.id, name: o.name })) : []),
      levels: () => this.store.project.levels.map((l) => ({ id: l.id, name: l.name })),
      animations: (target) => {
        const o = target ? this.store.getObject(target) : obj;
        const model = o && o.kind === 'model' ? this.store.getModel(o.modelId) : undefined;
        return model ? model.clips.map((c) => c.name) : [];
      },
      onChange: () => this.touch(obj),
      applyPreset: apply,
      newId,
    });
  }

  /** Give an object the behavior of a preset (and the variables and model it needs). */
  private applyPreset(obj: LevelObject, kind: PresetKind): void {
    this.ensureAssets(kind);
    obj.rules = presetRules(kind, newId);
    this.touch(obj);
    this.refreshHierarchy();
    this.refreshInspector();
  }

  /** The object is the template of a game object asset (not an object of a level). */
  private isPrefabObject(obj: LevelObject): boolean {
    return this.store.project.prefabs.some((p) => p.object === obj);
  }

  /** An object (or an asset's template) was edited. */
  private touch(obj: LevelObject): void {
    const prefab = this.store.project.prefabs.find((p) => p.object === obj);
    if (prefab) this.store.prefabChanged(prefab.id);
    else this.store.objectChanged(obj.id);
  }

  /** The preset's variables and model are added to the project when it lacks them. */
  private ensureAssets(kind: PresetKind): string | null {
    const before = new Set(this.store.project.models.map((m) => m.id));
    const varsBefore = this.store.project.variables.length;
    const modelId = ensurePresetAssets(this.store.project, kind);
    for (const m of this.store.project.models) if (!before.has(m.id)) this.store.emit({ type: 'model-added', id: m.id });
    if (this.store.project.variables.length !== varsBefore) this.store.emit({ type: 'variables-changed' });
    return modelId;
  }

  /** Rename a level object in place in the scene list. */
  private renameObject(id: string): void {
    const obj = this.store.getObject(id);
    const label = this.hierarchy.querySelector<HTMLElement>(`[data-object-id="${id}"] .tree-label`);
    if (!obj || !label) return;
    renameInline(label, obj.name, (name) => {
      obj.name = name;
      this.store.objectChanged(id);
      this.refreshHierarchy();
      this.refreshInspector();
    });
  }

  private refreshLevelBar(): void {
    fillLevelBar(this.levelBar, this.store, this.viewport.playing);
  }

  private refreshHierarchy(): void {
    fillHierarchy(this.hierarchy, this.store, this.sceneFilter);
  }

  private refreshInspector(): void {
    clear(this.inspector);
    const sel = this.store.selection;
    const assetOpen = this.leftTab === 'assets' && this.selectedPrefabId ? this.store.getPrefab(this.selectedPrefabId) : undefined;
    if (this.viewport.bar.tool === 'paint' && !this.viewport.playing) {
      this.inspector.append(buildPaintPanel(this.host));
    } else if (this.viewport.bar.tool === 'sculpt' && !this.viewport.playing) {
      this.inspector.append(buildSculptPanel(this.host));
    } else if (assetOpen) {
      buildPrefabInspector(this.host, assetOpen);
    } else if (sel.kind === 'player') {
      buildPlayerInspector(this.host);
    } else if (sel.kind === 'object' && this.store.selectedIds().length > 1) {
      buildMultiInspector(this.host);
    } else if (sel.kind === 'object') {
      const obj = this.store.getObject(sel.id);
      if (!obj) return;
      if (obj.kind === 'block') buildBlockInspector(this.host, obj);
      else buildModelInstanceInspector(this.host, obj);
    } else {
      this.inspector.append(buildLevelPanel(this.host));
      this.inspector.append(
        el('div', { class: 'empty', text: 'Select the Player or an object to edit its properties.' }),
        el('div', {
          class: 'empty muted',
          text: 'Tip: click ▶ Play, then press Esc to free the mouse and tweak jump, speed and camera while the game keeps running.',
        }),
      );
    }
  }

}
