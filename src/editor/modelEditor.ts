import * as THREE from 'three';
import { assignRect, meshSize, planarCoords, recenterMesh, scaleMeshToSize, uvFromRect } from '../core/mesh';
import { PRIMITIVES, type PrimitiveKind, primitiveMesh } from '../core/meshGen';
import { sampleClip } from '../core/rig';
import { isBoxMesh, quaternionFromDegrees } from '../core/shape';
import {
  type Bone,
  type Model,
  type ModelCube,
  type Vec3,
  cloneCube,
  cloneModel,
  createMeshCube,
  createModel,
  newId,
  normalizeModel,
} from '../core/types';
import { type UVPoly, clampUv, cloneUv, flipUvH, flipUvV, rotateUvCW, uvBounds } from '../core/uv';
import { checkModel, tierLabel } from '../core/hytaleStyle';
import type { ModelLibrary, ModelRender } from '../runtime/modelRender';
import { RigRender } from '../runtime/rigRender';
import type { TextureInfo, TextureLibrary } from '../runtime/textures';
import { CameraNav } from './cameraNav';
import { Gizmo, type TransformTarget } from './gizmo';
import { MeshEditing } from './meshEditing';
import {
  type ShapeHooks,
  ShapeVisuals,
  averageFaceNormal,
  objectTarget,
  verticesOfFaces,
  vertexTarget,
} from './shapeTargets';
import type { Store, StoreEvent } from './store';
import { type AtlasLayer, type AtlasTexture, AtlasView } from './ui/atlasView';
import { clear, el } from './ui/dom';
import { type Field, buildForm } from './ui/form';
import { icon } from './ui/icons';
import { renameInline } from './ui/rename';
import { makeSplitter } from './ui/splitter';
import { TransformBar } from './ui/transformBar';
import { appConfirm } from './ui/dialogs';
import { facesInMarquee, marqueeOf, mergeSelection, verticesInMarquee } from './boxSelect';
import { AxisGizmo, buildViewMenu } from './ui/viewControls';

const SNAP_OPTIONS = [
  { value: 0, label: 'Snap off' },
  { value: 0.0625, label: 'Snap 1 px' },
  { value: 0.125, label: 'Snap 2 px' },
  { value: 0.25, label: 'Snap 4 px' },
  { value: 0.5, label: 'Snap 0.5 m' },
];

const CUBE_FIELDS: Field[] = [
  { kind: 'text', key: 'name', label: 'Name' },
  { kind: 'vec3', key: 'position', label: 'Position', step: 0.0625, unit: 'm' },
  { kind: 'vec3', key: 'rotation', label: 'Rotation', step: 15, unit: '°' },
  { kind: 'vec3', key: 'size', label: 'Size', step: 0.0625, unit: 'm' },
];

const MIN_SIZE = 1 / 16;
const BOX_FACE_NAMES = ['Front +Z', 'Back −Z', 'Right +X', 'Left −X', 'Top', 'Bottom'];

interface HistoryStep {
  label: string;
  before: string;
  after: string;
}

/** How far (px) the pointer has to move before a click becomes a dragged rectangle. */
const MARQUEE_TOLERANCE = 4;

export class ModelEditor {
  readonly root: HTMLElement;
  /** Called by the "Place in level" button. */
  onPlaceInLevel?: (modelId: string) => void;
  /** Called by "Paint this texture": the app opens the Paint mode on this texture. */
  onEditTexture?: (textureName: string) => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  /** Same Godot-style navigation as the level editor. */
  private nav: CameraNav;
  private viewMenu: ReturnType<typeof buildViewMenu>;
  private axisGizmo: AxisGizmo;
  private lastFrame = performance.now();
  private gizmo: Gizmo;
  private visuals: ShapeVisuals;
  private edit: MeshEditing;
  private raycaster = new THREE.Raycaster();
  private viewportEl = el('div', { class: 'viewport' });
  private canvas: HTMLCanvasElement;
  private bar = new TransformBar({ snapOptions: SNAP_OPTIONS, snap: 0.0625 });

  private model: Model | null = null;
  private render: ModelRender | null = null;
  private mesh: THREE.Mesh | null = null;

  private selectedCubeId: string | null = null;
  /** Clip being previewed (by name) with its own rig on screen; null = rest pose, editable. */
  private previewName: string | null = null;
  private previewRig: RigRender | null = null;
  private previewTime = 0;
  /** The face shown in the UV panel when no face is selected in the view. */
  private lastFace = 0;
  private tile = { col: 7, row: 0 };

  // UV panel options
  private uvPickTile = false;
  private uvSnap = 1;

  private modelListEl = el('div', { class: 'hierarchy model-list' });
  private cubeListEl = el('div', { class: 'hierarchy cube-list' });
  private inspectorEl = el('div', { class: 'inspector' });
  private hintEl = el('div', { class: 'hud hud-bottom' });
  private emptyEl = el('div', { class: 'model-empty' });
  private undoBtn = el('button', { class: 'tool-btn', title: 'Undo (Ctrl/Cmd+Z)' }, icon('undo', 18));
  private redoBtn = el('button', { class: 'tool-btn', title: 'Redo (Ctrl/Cmd+Shift+Z)' }, icon('redo', 18));
  private toolbarEl = el('div', { class: 'model-toolbar' });
  private uvView: AtlasView | null = null;
  private vertexInputs: HTMLInputElement[][] = [];
  private posForm: HTMLElement | null = null;
  private posView: { name: string; position: Vec3; rotation: Vec3; size: Vec3 } | null = null;
  private uvHeading: HTMLElement | null = null;
  private downAt: { x: number; y: number } | null = null;
  /** The rectangle being dragged over the view (client pixels), once the pointer moved far enough. */
  private marquee: { x: number; y: number; active: boolean } | null = null;
  private marqueeEl = el('div', { class: 'marquee-box' });

  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private modelJson = '';
  private lastCommitAt = 0;
  private notice = '';
  private noticeTimer: number | undefined;

  private active = false;
  /** Open the animation editor with this model. */
  onAnimate?: (modelId: string) => void;

  constructor(
    private store: Store,
    private textures: TextureLibrary,
    private library: ModelLibrary,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('viewport-canvas');
    this.viewportEl.append(this.canvas);

    this.scene.background = new THREE.Color('#2a3140');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6f7886', 1.9));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.7);
    sun.position.set(0.7, 1, 0.5);
    this.scene.add(sun);

    const grid = new THREE.GridHelper(8, 16, 0x56607a, 0x3a4256);
    grid.position.y = -0.001;
    this.scene.add(grid);
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.01, 2.2), 0.9, 0xffb23e, 0.3, 0.2));

    this.nav = new CameraNav(this.canvas);
    this.nav.jumpTo(new THREE.Vector3(0, 0.5, 0), 5, 0.7, 0.4);
    this.nav.onFocusRequest = () => this.frameModel();

    this.gizmo = new Gizmo(this.scene, this.nav.camera, this.canvas, this.nav);
    this.visuals = new ShapeVisuals(this.scene);
    this.edit = new MeshEditing(this.bar, this.visuals, {
      shape: () => this.cube,
      raycastFace: (e) => this.raycastCubeFace(e),
      meshChanged: (label) => this.cubeMeshChanged(label),
      selectionChanged: () => this.onSelectionChanged(),
      notify: (t) => this.showNotice(t),
    });
    this.viewMenu = buildViewMenu(this.nav);
    this.axisGizmo = new AxisGizmo(this.nav);
    this.viewportEl.append(this.axisGizmo.el);
    this.nav.onViewChange = () => {
      this.viewMenu.sync();
      this.gizmo.setCamera(this.nav.camera);
    };
    this.bar.onChange = () => this.onBarChanged();

    this.root = this.buildLayout();
    this.root.classList.add('hidden');
    this.onBarChanged();

    this.viewportEl.append(this.marqueeEl);
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || this.gizmo.hovering || this.gizmo.dragging) {
        this.downAt = null;
        this.endMarquee();
        return;
      }
      this.downAt = { x: e.clientX, y: e.clientY };
      // loop cut and add vertex are clicks; every other tool can drag a selection rectangle
      const clicks = this.bar.tool === 'loopcut' || this.bar.tool === 'addvertex';
      this.marquee = clicks || this.previewName !== null ? null : { x: e.clientX, y: e.clientY, active: false };
      // the pointer stays with the view while the rectangle is dragged, also over the toolbars on top of it
      if (this.marquee) this.canvas.setPointerCapture?.(e.pointerId);
    });
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => {
      this.downAt = null;
      this.endMarquee();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) {
        // the button came up somewhere the view did not see: the rectangle is over
        if (this.marquee) this.endMarquee();
        this.edit.pointerMove(e);
      } else if (this.marquee && (e.buttons & 1) === 1) this.dragMarquee(e);
    });
    this.canvas.addEventListener('pointerleave', () => this.edit.clearPreview());
    window.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.resize()).observe(this.viewportEl);

    store.subscribe((e) => this.onStoreEvent(e));
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- public API

  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('hidden', !active);
    if (active) {
      if (!this.model || !this.store.getModel(this.model.id)) this.open(this.store.project.models[0]?.id ?? null);
      else this.refreshAll();
      this.resize();
    }
  }

  get currentModelId(): string | null {
    return this.model?.id ?? null;
  }

  open(modelId: string | null): void {
    this.model = modelId ? (this.store.getModel(modelId) ?? null) : null;
    this.selectedCubeId = this.model?.cubes[0]?.id ?? null;
    this.lastFace = 0;
    this.edit.clearSelection();
    this.undoStack = [];
    this.redoStack = [];
    this.modelJson = this.model ? JSON.stringify(this.model) : '';
    this.previewName = null;
    this.gizmo.setEnabled(true);
    this.rebuildMesh();
    this.frameModel();
    this.refreshAll();
  }

  createNewModel(): void {
    const model = createModel(`Model ${this.nextModelNumber()}`, this.defaultTextureName(), this.tileRect());
    this.store.addModel(model);
    this.open(model.id);
  }

  // ---------------------------------------------------------------- layout

  private buildLayout(): HTMLElement {
    this.emptyEl.append(
      el('div', { class: 'model-empty-title', text: 'No model yet' }),
      el('div', { class: 'muted', text: 'Models are built from cubes, mapped onto a texture atlas with UVs, and placed in your level.' }),
      el('button', { class: 'btn primary', text: '+ Create your first model', onclick: () => this.createNewModel() }),
    );

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    // the lists are rebuilt on every click, so the double-click is caught on the list itself
    this.modelListEl.addEventListener('dblclick', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-model-id]')?.dataset.modelId;
      if (id) this.renameModelInList(id);
    });
    this.cubeListEl.addEventListener('dblclick', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cube-id]')?.dataset.cubeId;
      if (id) this.renameCubeInList(id);
    });
    this.toolbarEl.append(
      el('div', { class: 'tb-group' }, this.viewMenu.el),
      this.bar.el,
      el('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn primary',
        title: 'Add this model to the level and switch to the level editor',
        onclick: () => this.model && this.onPlaceInLevel?.(this.model.id),
      }, 'Place in level →'),
    );

    const addShape = el('select', { class: 'add-shape', title: 'Add a cube, ramp, cylinder, rock, plane or grass tuft to the model' });
    addShape.append(el('option', { value: '', text: '+ Add shape…' }));
    for (const p of PRIMITIVES) addShape.append(el('option', { value: p.kind, text: p.label }));
    addShape.addEventListener('change', () => {
      const kind = addShape.value as PrimitiveKind | '';
      addShape.value = '';
      if (kind) this.addShape(kind);
    });

    const left = el(
      'aside',
      { class: 'panel panel-left' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Models' })),
      el(
        'div',
        { class: 'panel-toolbar' },
        el('button', { class: 'btn', text: '+ New', onclick: () => this.createNewModel() }),
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicateModel() }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => void this.deleteModel() }),
      ),
      this.modelListEl,
      el('div', { class: 'panel-header' }, el('span', { text: 'Shapes' })),
      el(
        'div',
        { class: 'panel-toolbar' },
        addShape,
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicateCube() }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => this.deleteCube() }),
      ),
      this.cubeListEl,
    );

    const center = el(
      'section',
      { class: 'viewport-wrap' },
      this.viewportEl,
      el('div', { class: 'view-overlay' }, this.toolbarEl, this.bar.strip),
      this.hintEl,
      this.emptyEl,
    );
    const right = el(
      'aside',
      { class: 'panel panel-right' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Properties' })),
      this.inspectorEl,
    );

    // draggable splitter between the 3D view and the right panel (the UV view likes width)
    const root = el('div', { class: 'workspace model-workspace' }, left, center);
    root.append(makeSplitter(root, { key: 'polyhop.rightWidth', min: 300, maxShare: 0.7 }), right);
    return root;
  }

  // ---------------------------------------------------------------- state helpers

  private get cube(): ModelCube | null {
    return this.model?.cubes.find((c) => c.id === this.selectedCubeId) ?? null;
  }

  private cubeIndexOf(cube: ModelCube): number {
    return this.model ? this.model.cubes.indexOf(cube) : -1;
  }

  /** The face the UV panel edits: the last selected face, else the last one that was clicked. */
  private primaryFace(): number {
    const cube = this.cube;
    if (!cube) return 0;
    const f = this.edit.faces[this.edit.faces.length - 1] ?? this.lastFace;
    return Math.min(Math.max(0, f), cube.mesh.faces.length - 1);
  }

  private faceLabel(cube: ModelCube, fi: number): string {
    return isBoxMesh(cube.mesh) && fi < 6 ? BOX_FACE_NAMES[fi]! : `Face ${fi + 1}`;
  }

  private nextModelNumber(): number {
    let n = this.store.project.models.length + 1;
    const names = new Set(this.store.project.models.map((m) => m.name));
    while (names.has(`Model ${n}`)) n++;
    return n;
  }

  private defaultTextureName(): string | null {
    // keep the atlas of the open model when its default tile has something in it (a skin atlas has not)
    const cur = this.model?.texture;
    if (cur && this.textures.tileCoverage(cur, this.tile.col, this.tile.row) >= 0.5) return cur;
    return this.textures.atlasWithTile(this.tile.col, this.tile.row) ?? cur ?? this.textures.names()[0] ?? null;
  }

  private texInfo(): TextureInfo | null {
    return this.model?.texture ? this.textures.get(this.model.texture) : null;
  }

  private atlasTexture(): AtlasTexture | null {
    const info = this.texInfo();
    if (!info) return null;
    return {
      key: `${info.name}:${info.width}x${info.height}`,
      width: info.width,
      height: info.height,
      tileSize: info.tileSize,
      image: info.texture.image as CanvasImageSource,
    };
  }

  /** The currently picked tile as a pixel rectangle in the model's texture. */
  private tileRect(): { x: number; y: number; w: number; h: number } {
    const ts = this.texInfo()?.tileSize ?? 16;
    return { x: this.tile.col * ts, y: this.tile.row * ts, w: ts, h: ts };
  }

  /** Camera focus on the whole model (also the F / Numpad . key). */
  private frameModel(): void {
    const r = this.render;
    if (!r) return;
    const { min, max } = r.bounds;
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    this.nav.focus(center, radius);
  }

  private get camera(): THREE.Camera {
    return this.nav.camera;
  }

  private showNotice(text: string): void {
    this.notice = text;
    this.updateHint();
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice = '';
      this.updateHint();
    }, 4000);
  }

  // ---------------------------------------------------------------- mesh + gizmo

  private rebuildMesh(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh = null;
    }
    this.dropPreviewRig();
    this.render = this.model ? this.library.get(this.model.id) : null;
    if (this.render) {
      this.mesh = this.render.createMesh();
      this.scene.add(this.mesh);
    }
    this.refreshTarget();
  }

  // ---------------------------------------------------------------- animation preview

  private dropPreviewRig(): void {
    if (!this.previewRig) return;
    this.scene.remove(this.previewRig.root);
    this.previewRig.dispose();
    this.previewRig = null;
  }

  /** Show a clip playing on the model (name), or go back to the editable rest pose (null). */
  private setPreview(name: string | null): void {
    this.previewName = name;
    this.previewTime = 0;
    if (name === null) this.dropPreviewRig();
    this.gizmo.setEnabled(name === null);
    if (this.mesh) this.mesh.visible = name === null;
    this.onSelectionChanged();
  }

  private updatePreview(dt: number): void {
    const model = this.model;
    if (!model || this.previewName === null || !this.render) return;
    const clip = model.clips.find((c) => c.name === this.previewName);
    if (!clip || model.bones.length === 0) return;
    if (!this.previewRig) {
      this.previewRig = new RigRender(this.render, this.render.material);
      this.scene.add(this.previewRig.root);
    }
    this.previewTime += dt;
    this.previewRig.pose(sampleClip(clip, this.previewTime));
  }

  private onBarChanged(): void {
    const step = this.bar.snap;
    this.gizmo.setTool(this.bar.gizmoTool);
    this.gizmo.setSpace(this.bar.space);
    this.gizmo.setSnap(step, step > 0 ? 15 : 0);
    this.edit?.clearPreview();
    this.updateHint();
    this.refreshTarget();
  }

  private updateHint(): void {
    if (this.notice) {
      this.hintEl.textContent = this.notice;
      return;
    }
    const nav = ' Orbit: middle mouse (Alt+left on a trackpad) · Pan: Shift+middle · Zoom: wheel · Fly: right mouse + WASD.';
    const tool = this.bar.tool;
    const sub = this.bar.sub;
    let text: string;
    if (tool === 'loopcut') text = 'Loop cut: hover an edge to preview the cut, click to make it.';
    else if (tool === 'addvertex') text = 'Add vertex: click an edge to split it, then move the new point.';
    else if (tool === 'select') text = 'Click a face to select it.';
    else if (sub === 'object') text = 'Drag the gizmo to move / rotate / scale the shape. Click a face to pick it for UV editing.';
    else if (sub === 'face') text = 'Click a face (Shift = more) or drag a rectangle over several, then drag the gizmo or use Extrude / Inset. Esc deselects.';
    else text = 'Click a point (Shift = several) or drag a rectangle over many, then drag the gizmo to move them. Esc deselects.';
    this.hintEl.textContent = text + nav;
  }

  private cubeHooks(cube: ModelCube): ShapeHooks {
    const update = () => {
      const i = this.cubeIndexOf(cube);
      if (i >= 0) this.render?.updateCubeGeometry(i);
      this.syncPositionFields();
    };
    return {
      onTransform: update,
      onGeometry: update,
      onCommit: () => this.structuralChange('transform'),
    };
  }

  private refreshTarget(): void {
    const cube = this.cube;
    this.bar.setCapabilities(this.edit.capabilities(!!cube));
    let target: TransformTarget | null = null;
    if (cube) {
      const hooks = this.cubeHooks(cube);
      const mesh = cube.mesh;
      if (this.bar.sub === 'object') {
        target = objectTarget(cube, hooks, this.bar.snap);
      } else if (this.bar.sub === 'face' && this.edit.faces.length > 0) {
        const faces = this.edit.faces;
        target = vertexTarget(cube, verticesOfFaces(mesh, faces), hooks, { normal: () => averageFaceNormal(mesh, faces) });
      } else if (this.bar.sub === 'vertex' && this.edit.vertices.length > 0) {
        target = vertexTarget(cube, this.edit.vertices, hooks);
      }
    }
    this.gizmo.setTarget(target);
  }

  /** The cube's mesh was changed by a tool: rebuild and record history. */
  private cubeMeshChanged(label: string): void {
    this.structuralChange(`mesh-${label}`);
    this.refreshInspector();
  }

  /** The face of the selected cube under the pointer, plus the hit point in the cube's local space. */
  private raycastCubeFace(e: { clientX: number; clientY: number }): { face: number; local: Vec3 } | null {
    const hit = this.pickAt(e);
    const cube = this.cube;
    if (!hit || !cube || hit.cube !== cube) return null;
    const q = quaternionFromDegrees(cube.rotation).invert();
    const p = new THREE.Vector3(...hit.point).sub(new THREE.Vector3(...cube.position)).applyQuaternion(q);
    return { face: hit.face, local: [p.x, p.y, p.z] };
  }

  // ---------------------------------------------------------------- history

  /** Record the model's current state as an undo step (no-op when nothing changed). */
  private commitModel(label: string): void {
    if (!this.model) return;
    const after = JSON.stringify(this.model);
    if (after === this.modelJson) return;
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (label.startsWith('edit:') && top && top.label === label && now - this.lastCommitAt < 700) {
      top.after = after; // coalesce rapid edits of one field into one step
    } else {
      this.undoStack.push({ label, before: this.modelJson, after });
      if (this.undoStack.length > 80) this.undoStack.shift();
    }
    this.redoStack = [];
    this.modelJson = after;
    this.lastCommitAt = now;
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  private restoreModel(snapshot: string): void {
    if (!this.model) return;
    const restored = normalizeModel(JSON.parse(snapshot) as Partial<Model>);
    const idx = this.store.project.models.findIndex((m) => m.id === this.model!.id);
    if (idx < 0) return;
    this.store.project.models[idx] = restored;
    this.model = restored;
    this.modelJson = snapshot;
    if (!restored.cubes.some((c) => c.id === this.selectedCubeId)) this.selectedCubeId = restored.cubes[0]?.id ?? null;
    this.edit.clearSelection();
    this.store.modelChanged(restored.id, true);
    this.rebuildMesh();
    this.refreshAll();
  }

  undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push(step);
    this.restoreModel(step.before);
    this.updateHistoryButtons();
  }

  redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push(step);
    this.restoreModel(step.after);
    this.updateHistoryButtons();
  }

  /** Geometry changed: rebuild everything that depends on the model, then record history. */
  private structuralChange(label: string): void {
    if (!this.model) return;
    this.store.modelChanged(this.model.id, true);
    this.rebuildMesh();
    this.commitModel(label);
    this.syncPositionFields();
  }

  /** UVs changed (already live in the shared geometry): record history and notify listeners. */
  private uvsChanged(label: string): void {
    if (!this.model) return;
    this.commitModel(label);
    this.store.modelChanged(this.model.id, false);
  }

  // ---------------------------------------------------------------- models and shapes

  /** Rename a model in place in the list (any model, not only the open one). */
  private renameModelInList(id: string): void {
    const target = this.store.getModel(id);
    const label = this.modelListEl.querySelector<HTMLElement>(`[data-model-id="${id}"] .tree-label`);
    if (!target || !label) return;
    renameInline(label, target.name, (name) => {
      target.name = name;
      if (this.model?.id === id) this.commitModel('rename-model');
      this.store.modelChanged(id, false);
      this.refreshModelList();
      if (this.model?.id === id) this.refreshInspector();
    });
  }

  private renameCubeInList(id: string): void {
    const model = this.model;
    const cube = model?.cubes.find((c) => c.id === id);
    const label = this.cubeListEl.querySelector<HTMLElement>(`[data-cube-id="${id}"] .tree-label`);
    if (!model || !cube || !label) return;
    renameInline(label, cube.name, (name) => {
      cube.name = name;
      this.commitModel('rename-shape');
      this.store.modelChanged(model.id, false);
      this.refreshCubeList();
      this.refreshInspector();
    });
  }

  private duplicateModel(): void {
    if (!this.model) return;
    const copy = cloneModel(this.model);
    this.store.addModel(copy);
    this.open(copy.id);
  }

  private async deleteModel(): Promise<void> {
    const model = this.model;
    if (!model) return;
    const n = this.store.countInstances(model.id);
    const msg = n > 0 ? `Delete "${model.name}"? ${n} placed instance(s) in the level will be removed too.` : `Delete "${model.name}"?`;
    if (!(await appConfirm(msg, { title: 'Delete model', confirmLabel: 'Delete', danger: true }))) return;
    this.store.removeModel(model.id);
    // onStoreEvent opens another model
  }

  private addShape(kind: PrimitiveKind): void {
    if (!this.model) return;
    const base = this.cube;
    const mesh = primitiveMesh(kind, this.tileRect(), (this.model.cubes.length + 1) * 7919);
    const { min, max } = meshBoundsOf(mesh);
    // next to the selected shape, standing on the ground
    const x = base ? base.position[0] + meshSize(base.mesh)[0] / 2 + (max[0] - min[0]) / 2 + 0.25 : 0;
    const z = base ? base.position[2] : 0;
    const info = PRIMITIVES.find((p) => p.kind === kind)!;
    const cube = createMeshCube(`${info.label} ${this.model.cubes.length + 1}`, [x, -min[1], z], mesh);
    if (info.rotation) cube.rotation = [...info.rotation];
    if (info.smooth) cube.smooth = true;
    this.model.cubes.push(cube);
    this.selectedCubeId = cube.id;
    this.edit.clearSelection();
    this.lastFace = 0;
    this.structuralChange('shape-add');
    this.refreshAll();
  }

  private duplicateCube(): void {
    const src = this.cube;
    if (!this.model || !src) return;
    const copy = cloneCube(src, `${src.name} copy`);
    const w = meshSize(src.mesh)[0];
    copy.position = [src.position[0] + w + 0.1, src.position[1], src.position[2]];
    this.model.cubes.push(copy);
    this.selectedCubeId = copy.id;
    this.edit.clearSelection();
    this.structuralChange('shape-duplicate');
    this.refreshAll();
  }

  private deleteCube(): void {
    if (!this.model || !this.cube) return;
    const i = this.model.cubes.findIndex((c) => c.id === this.selectedCubeId);
    this.model.cubes.splice(i, 1);
    this.selectedCubeId = this.model.cubes[Math.max(0, i - 1)]?.id ?? null;
    this.edit.clearSelection();
    this.structuralChange('shape-delete');
    this.refreshAll();
  }

  private selectCube(id: string, face?: number): void {
    this.selectedCubeId = id;
    this.edit.clearSelection();
    if (face !== undefined) {
      this.lastFace = face;
      this.edit.faces = [face];
    } else {
      this.lastFace = 0;
    }
    this.refreshCubeList();
    this.refreshTarget();
    this.refreshInspector();
  }

  /** Face / vertex selection changed (by a click or a tool): refresh gizmo, handles and the UV panel. */
  private onSelectionChanged(): void {
    const f = this.edit.faces[this.edit.faces.length - 1];
    if (f !== undefined) this.lastFace = f;
    this.refreshTarget();
    this.updateVertexFields();
    this.uvView?.redraw();
    if (this.uvHeading && this.cube) this.uvHeading.textContent = this.uvHeadingText(this.cube);
    this.focusUv();
  }

  /** The faces the UV panel works on: all the selected ones, or the one it shows when none is selected in the view. */
  private selectedFaces(): number[] {
    const cube = this.cube;
    if (!cube) return [];
    const last = cube.mesh.faces.length - 1;
    const picked = [...new Set(this.edit.faces)].filter((f) => f >= 0 && f <= last);
    return picked.length > 0 ? picked : [this.primaryFace()];
  }

  private uvHeadingText(cube: ModelCube): string {
    const faces = this.selectedFaces();
    return faces.length > 1 ? `UV · ${faces.length} faces` : `UV · ${this.faceLabel(cube, this.primaryFace())}`;
  }

  /** Zoom the UV view onto the selected face, or onto all the selected faces (after the layout has settled). */
  private focusUv(): void {
    requestAnimationFrame(() => {
      const cube = this.cube;
      if (!cube) return;
      const uvs = this.selectedFaces().flatMap((f) => {
        const face = cube.mesh.faces[f];
        return face ? [face.uv] : [];
      });
      if (uvs.length > 0) this.uvView?.focus(uvs);
    });
  }

  // ---------------------------------------------------------------- uv editing

  private setFaceUv(cube: ModelCube, face: number, uv: UVPoly): void {
    const f = cube.mesh.faces[face];
    if (!f) return;
    f.uv = uv;
    const ci = this.cubeIndexOf(cube);
    if (ci >= 0) this.render?.updateFaceUv(ci, face);
  }

  private assignTile(cube: ModelCube, faces: number[]): void {
    assignRect(cube.mesh, faces, this.tileRect());
    const ci = this.cubeIndexOf(cube);
    for (const f of faces) if (ci >= 0) this.render?.updateFaceUv(ci, f);
  }

  private resetFaceUv(): void {
    const cube = this.cube;
    const info = this.texInfo();
    if (!cube || !info) return;
    for (const fi of this.selectedFaces()) {
      const b = uvBounds(cube.mesh.faces[fi]!.uv);
      // one tile per meter: the face's real size in meters x tile size, anchored where it is now
      const { width, height } = planarCoords(cube.mesh, fi);
      const w = Math.max(1, Math.round(width * info.tileSize));
      const h = Math.max(1, Math.round(height * info.tileSize));
      const x = Math.min(Math.max(0, b.minX), Math.max(0, info.width - w));
      const y = Math.min(Math.max(0, b.minY), Math.max(0, info.height - h));
      this.setFaceUv(cube, fi, uvFromRect(cube.mesh, fi, { x, y, w, h }));
    }
    this.uvsChanged('uv-reset');
    this.afterUvEdit();
  }

  /** Rotate / flip the UV of every selected face (each in place). */
  private transformSelectedFaces(fn: (uv: UVPoly) => UVPoly, label: string): void {
    const cube = this.cube;
    if (!cube) return;
    for (const fi of this.selectedFaces()) this.setFaceUv(cube, fi, fn(cube.mesh.faces[fi]!.uv));
    this.uvsChanged(label);
    this.afterUvEdit();
  }

  /** Every face of the cube shows the same texture region as the selected face. */
  private copyUvToAllFaces(): void {
    const cube = this.cube;
    if (!cube) return;
    const b = uvBounds(cube.mesh.faces[this.primaryFace()]!.uv);
    const rect = { x: b.minX, y: b.minY, w: Math.max(1, b.maxX - b.minX), h: Math.max(1, b.maxY - b.minY) };
    const all = cube.mesh.faces.map((_, i) => i);
    assignRect(cube.mesh, all, rect);
    const ci = this.cubeIndexOf(cube);
    for (const f of all) if (ci >= 0) this.render?.updateFaceUv(ci, f);
    this.uvsChanged('uv-copy');
    this.afterUvEdit();
  }

  private afterUvEdit(): void {
    this.updateVertexFields();
    this.uvView?.redraw();
  }

  /** The faces of the shape in the UV view: the selected ones are dragged together, the main one has handles. */
  private layers(): AtlasLayer[] {
    const cube = this.cube;
    if (!cube) return [];
    const primary = this.primaryFace();
    const picked = new Set(this.selectedFaces());
    return cube.mesh.faces.map((f, i) => ({
      id: `${cube.id}:${i}`,
      uv: f.uv,
      kind: picked.has(i) ? ('selected' as const) : ('sibling' as const),
      primary: i === primary,
    }));
  }

  private parseLayer(layer: AtlasLayer): { cube: ModelCube; face: number } | null {
    const [cubeId, fi] = layer.id.split(':');
    const cube = this.model?.cubes.find((c) => c.id === cubeId);
    const face = Number(fi);
    if (!cube || !Number.isInteger(face) || !cube.mesh.faces[face]) return null;
    return { cube, face };
  }

  private createUvView(): AtlasView {
    return new AtlasView({
      mode: 'uv',
      texture: () => this.atlasTexture(),
      layers: () => this.layers(),
      showTileGrid: () => true,
      snap: () => this.uvSnap,
      tileMode: () => this.uvPickTile,
      onVertexSet: (layer, vertex, x, y) => {
        const t = this.parseLayer(layer);
        if (!t) return;
        const uv = cloneUv(t.cube.mesh.faces[t.face]!.uv);
        uv[vertex] = [x, y];
        this.setFaceUv(t.cube, t.face, uv);
        this.updateVertexFields();
      },
      onFaceSet: (layer, uv) => {
        const t = this.parseLayer(layer);
        if (!t) return;
        this.setFaceUv(t.cube, t.face, uv);
        this.updateVertexFields();
      },
      onUvCommit: () => this.uvsChanged('uv-edit'),
      onLayerPick: (layer, mode) => {
        const t = this.parseLayer(layer);
        if (!t) return;
        const current = this.selectedFaces();
        if (mode === 'toggle') {
          // Shift / Ctrl+click: add the face, or take it out (the last one stays)
          const on = current.includes(t.face);
          this.edit.faces = on ? (current.length > 1 ? current.filter((f) => f !== t.face) : current) : [...current, t.face];
          this.lastFace = this.edit.faces[this.edit.faces.length - 1] ?? t.face;
        } else if (mode === 'primary') {
          // a click on one of several selected faces: it becomes the one with the point handles
          this.edit.faces = [...current.filter((f) => f !== t.face), t.face];
          this.lastFace = t.face;
        } else {
          this.edit.faces = [t.face];
          this.lastFace = t.face;
        }
        this.onSelectionChanged();
      },
      onTilePick: (col, row, shift) => {
        this.tile = { col, row };
        const cube = this.cube;
        if (!cube) return;
        this.assignTile(cube, shift ? cube.mesh.faces.map((_, i) => i) : this.edit.faces.length > 0 ? this.edit.faces : [this.primaryFace()]);
        this.uvsChanged('uv-tile');
        this.afterUvEdit();
      },
    });
  }

  // ---------------------------------------------------------------- 3d pointer + keys

  private pickAt(e: { clientX: number; clientY: number }): { cube: ModelCube; face: number; point: Vec3 } | null {
    if (!this.mesh || !this.model || !this.render) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    const ref = this.render.faceOfTriangle(hit.faceIndex);
    const cube = ref ? this.model.cubes[ref.cube] : undefined;
    if (!ref || !cube) return null;
    return { cube, face: ref.face, point: [hit.point.x, hit.point.y, hit.point.z] };
  }

  /** Grow the selection rectangle while the left button is dragged over the view. */
  private dragMarquee(e: PointerEvent): void {
    const m = this.marquee;
    if (!m) return;
    if (!m.active && Math.hypot(e.clientX - m.x, e.clientY - m.y) <= MARQUEE_TOLERANCE) return;
    m.active = true;
    const box = this.viewportEl.getBoundingClientRect();
    const r = marqueeOf(m.x, m.y, e.clientX, e.clientY);
    Object.assign(this.marqueeEl.style, {
      display: 'block',
      left: `${r.x0 - box.left}px`,
      top: `${r.y0 - box.top}px`,
      width: `${r.x1 - r.x0}px`,
      height: `${r.y1 - r.y0}px`,
    });
  }

  private endMarquee(): void {
    this.marquee = null;
    this.marqueeEl.style.display = 'none';
  }

  /**
   * The rectangle was let go: in Vertex mode the points of the shape inside it are selected, in Face mode the faces
   * (Shift / Ctrl / Cmd adds to the selection). Shapes are edited one at a time, so Object mode has no box select.
   */
  private applyMarquee(down: { x: number; y: number }, e: PointerEvent): void {
    const cube = this.cube;
    const sub = this.bar.sub;
    if (!cube || (sub !== 'vertex' && sub !== 'face')) {
      this.showNotice(
        cube
          ? 'Box select picks points in Vertex mode (3) and faces in Face mode (2).'
          : 'Select a shape first, then drag a rectangle over its points (Vertex mode) or faces (Face mode).',
      );
      return;
    }
    const extend = e.shiftKey || e.ctrlKey || e.metaKey;
    const rect = this.canvas.getBoundingClientRect();
    const box = marqueeOf(down.x, down.y, e.clientX, e.clientY);
    if (sub === 'vertex') {
      this.edit.vertices = mergeSelection(this.edit.vertices, verticesInMarquee(cube, this.camera, rect, box), extend);
    } else {
      this.edit.faces = mergeSelection(this.edit.faces, facesInMarquee(cube, this.camera, rect, box), extend);
      const last = this.edit.faces[this.edit.faces.length - 1];
      if (last !== undefined) this.lastFace = last;
    }
    this.onSelectionChanged();
  }

  /**
   * Esc, or a click beside the model: nothing stays selected (the points, the faces and the shape). Returns whether
   * there was something to deselect.
   */
  private deselectAll(): boolean {
    if (!this.model) return false;
    const had = this.selectedCubeId !== null || this.edit.faces.length > 0 || this.edit.vertices.length > 0;
    if (!had) return false;
    this.selectedCubeId = null;
    this.edit.clearSelection();
    this.lastFace = 0;
    this.refreshCubeList();
    this.refreshInspector();
    this.onSelectionChanged();
    return true;
  }

  private onPointerUp(e: PointerEvent): void {
    const down = this.downAt;
    const marquee = this.marquee;
    this.downAt = null;
    this.endMarquee();
    if (e.button !== 0 || !down || !this.model) return;
    if (marquee?.active) {
      this.applyMarquee(down, e);
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;

    // loop cut / add vertex use the click themselves
    if (this.edit.pointerClick(e)) return;

    // vertex mode: a click near a vertex handle of the selected shape picks that vertex
    const cube = this.cube;
    if (cube && this.bar.sub === 'vertex') {
      const v = this.visuals.pickVertex(cube, this.camera, this.canvas.getBoundingClientRect(), e.clientX, e.clientY);
      if (v !== null) {
        const cur = this.edit.vertices;
        this.edit.vertices = e.shiftKey ? (cur.includes(v) ? cur.filter((i) => i !== v) : [...cur, v]) : [v];
        this.onSelectionChanged();
        return;
      }
    }

    const hit = this.pickAt(e);
    if (!hit) {
      // a click beside the model: nothing stays selected
      this.deselectAll();
      return;
    }
    if (hit.cube.id !== this.selectedCubeId) {
      this.selectCube(hit.cube.id, hit.face);
      return;
    }
    const cur = this.edit.faces;
    this.edit.faces = e.shiftKey && this.bar.sub === 'face' ? (cur.includes(hit.face) ? cur.filter((f) => f !== hit.face) : [...cur, hit.face]) : [hit.face];
    this.lastFace = hit.face;
    this.onSelectionChanged();
  }

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
    if (mod && !e.code.startsWith('Numpad')) return;
    if (e.code === 'Escape') {
      if (this.marquee?.active) this.endMarquee();
      else if (this.deselectAll()) e.preventDefault();
      return;
    }
    if (e.code === 'F2' && this.selectedCubeId) {
      e.preventDefault();
      this.renameCubeInList(this.selectedCubeId);
      return;
    }
    if (this.nav.handleKey(e)) return;
    // while the right button flies the camera, W A S D Q E belong to the camera, not to the tools
    if (this.nav.freelook) return;
    if (this.bar.handleKey(e.code)) return;
    if (e.code === 'KeyF') this.frameModel();
    else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (!this.edit.deleteSelection()) this.deleteCube();
    }
  }

  // ---------------------------------------------------------------- store events

  private onStoreEvent(e: StoreEvent): void {
    switch (e.type) {
      case 'project-replaced':
        this.model = null;
        this.render = null;
        if (this.mesh) {
          this.scene.remove(this.mesh);
          this.mesh = null;
        }
        this.gizmo.setTarget(null);
        if (this.active) this.open(this.store.project.models[0]?.id ?? null);
        break;
      case 'model-added':
      case 'model-changed':
        if (this.active) this.refreshModelList();
        break;
      case 'model-removed':
        if (this.model && this.model.id === e.id) {
          this.open(this.store.project.models[0]?.id ?? null);
        } else if (this.active) {
          this.refreshModelList();
        }
        break;
      case 'texture-changed':
        if (!this.active) break;
        if (e.structural) {
          this.rebuildMesh();
          this.refreshInspector();
        } else {
          this.uvView?.redraw();
        }
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- UI refresh

  private refreshAll(): void {
    this.refreshModelList();
    this.refreshCubeList();
    this.refreshInspector();
    this.updateHistoryButtons();
    this.updateHint();
    this.emptyEl.classList.toggle('hidden', !!this.model);
    this.toolbarEl.classList.toggle('hidden', !this.model);
    this.bar.strip.classList.toggle('hidden', !this.model);
  }

  private refreshModelList(): void {
    clear(this.modelListEl);
    for (const m of this.store.project.models) {
      this.modelListEl.append(
        el(
          'button',
          {
            class: `tree-item${this.model?.id === m.id ? ' selected' : ''}`,
            onclick: () => this.open(m.id),
            'data-model-id': m.id,
            title: 'Double-click to rename',
          },
          el('span', { class: 'tree-icon', text: '▣' }),
          el('span', { class: 'tree-label', text: m.name }),
          el('span', { class: 'tree-count muted', text: `${m.cubes.length}` }),
        ),
      );
    }
    if (this.store.project.models.length === 0) {
      this.modelListEl.append(el('div', { class: 'empty muted', text: 'No models yet.' }));
    }
  }

  private refreshCubeList(): void {
    clear(this.cubeListEl);
    if (!this.model) return;
    for (const c of this.model.cubes) {
      this.cubeListEl.append(
        el(
          'button',
          {
            class: `tree-item${c.id === this.selectedCubeId ? ' selected' : ''}`,
            onclick: () => this.selectCube(c.id),
            'data-cube-id': c.id,
            title: 'Double-click or F2 to rename',
          },
          el('span', { class: 'tree-icon', text: '■' }),
          el('span', { class: 'tree-label', text: c.name }),
          el('span', { class: 'tree-count muted', text: `${c.mesh.faces.length}` }),
        ),
      );
    }
  }

  private refreshInspector(): void {
    clear(this.inspectorEl);
    this.vertexInputs = [];
    this.posForm = null;
    this.posView = null;
    this.uvHeading = null;
    const model = this.model;
    if (!model) return;
    this.refreshCubeList();

    // ---- model: name + texture
    const names = this.textures.names();
    const select = el('select', {});
    if (model.texture && !names.includes(model.texture)) {
      select.append(el('option', { value: model.texture, text: `${model.texture} (missing)` }));
    }
    for (const n of names) {
      select.append(el('option', { value: n, text: this.textures.isProjectTexture(n) ? n : `${n} · built-in` }));
    }
    select.value = model.texture ?? '';
    select.addEventListener('change', () => {
      model.texture = select.value;
      this.structuralChange('edit:texture');
      this.refreshInspector();
    });

    this.inspectorEl.append(
      el('div', { class: 'section-title', text: 'Model' }),
      buildForm([{ kind: 'text', key: 'name', label: 'Name' }], model as unknown as Record<string, unknown>, () => {
        this.commitModel('edit:model-name');
        this.store.modelChanged(model.id, false);
      }),
      el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Texture' }), el('span', { class: 'form-control' }, select)),
      el(
        'div',
        { class: 'button-stack' },
        el('button', {
          class: 'btn',
          text: 'Paint this texture →',
          disabled: !model.texture,
          onclick: () => model.texture && this.onEditTexture?.(model.texture),
        }),
      ),
    );

    this.inspectorEl.append(this.buildRigSection(model), this.buildStyleSection(model));

    // ---- selected shape
    const cube = this.cube;
    if (!cube) {
      this.inspectorEl.append(
        el('div', {
          class: 'empty muted',
          text: model.cubes.length > 0 ? 'No shape selected. Click one in the view or in the Shapes list.' : 'Add a shape with “+ Add shape…”.',
        }),
      );
      return;
    }
    const view = { name: cube.name, position: cube.position, rotation: cube.rotation, size: meshSize(cube.mesh) };
    this.posView = view;
    const form = buildForm(CUBE_FIELDS, view as unknown as Record<string, unknown>, (key) => {
      if (key === 'name') {
        cube.name = view.name;
        this.refreshCubeList();
        this.commitModel('edit:cube-name');
        this.store.modelChanged(model.id, false);
        return;
      }
      if (key === 'size') {
        const size: Vec3 = [Math.max(MIN_SIZE, view.size[0]), Math.max(MIN_SIZE, view.size[1]), Math.max(MIN_SIZE, view.size[2])];
        scaleMeshToSize(cube.mesh, size);
      }
      this.structuralChange('edit:cube');
    });
    this.posForm = form;
    const smooth = el('input', { type: 'checkbox', checked: cube.smooth === true });
    smooth.addEventListener('change', () => {
      if (smooth.checked) cube.smooth = true;
      else delete cube.smooth;
      this.structuralChange('edit:smooth');
    });
    const boneSelect = el('select', {});
    boneSelect.append(el('option', { value: '', text: 'None (does not move)' }));
    for (const b of model.bones) boneSelect.append(el('option', { value: b.id, text: b.name }));
    boneSelect.value = cube.bone ?? '';
    boneSelect.addEventListener('change', () => {
      cube.bone = boneSelect.value || null;
      this.structuralChange('edit:bone');
    });
    this.inspectorEl.append(
      el('div', { class: 'section-title', text: `Shape · ${cube.mesh.verts.length} vertices, ${cube.mesh.faces.length} faces` }),
      form,
      el(
        'label',
        { class: 'form-row', title: 'Shade this shape as one smooth surface (edges sharper than 60 degrees stay sharp)' },
        el('span', { class: 'form-label', text: 'Smooth' }),
        el('span', { class: 'form-control' }, smooth),
      ),
      model.bones.length > 0
        ? el(
            'label',
            { class: 'form-row', title: 'The bone this shape moves with when the model is animated' },
            el('span', { class: 'form-label', text: 'Bone' }),
            el('span', { class: 'form-control' }, boneSelect),
          )
        : el('span'),
      el(
        'div',
        { class: 'button-stack row' },
        el('button', {
          class: 'btn',
          text: 'Center origin',
          title: 'Move the shape’s origin to the middle of its bounds',
          onclick: () => {
            const shift = recenterMesh(cube.mesh);
            const q = quaternionFromDegrees(cube.rotation);
            const d = new THREE.Vector3(...shift).applyQuaternion(q);
            cube.position = [cube.position[0] + d.x, cube.position[1] + d.y, cube.position[2] + d.z];
            this.structuralChange('center-origin');
            this.refreshInspector();
          },
        }),
      ),
    );

    // ---- uv of the selected face
    const info = this.texInfo();
    this.uvHeading = el('div', { class: 'section-title', text: this.uvHeadingText(cube) });
    this.inspectorEl.append(this.uvHeading);
    if (!info) {
      this.inspectorEl.append(el('div', { class: 'empty', text: 'Choose a texture above to edit UVs.' }));
      return;
    }
    this.uvView ??= this.createUvView();

    const seg = el('div', { class: 'tb-group' });
    const modeBtn = (label: string, pick: boolean, title: string) => {
      const b = el('button', {
        class: `btn${this.uvPickTile === pick ? ' active' : ''}`,
        text: label,
        title,
        onclick: () => {
          this.uvPickTile = pick;
          for (const x of seg.querySelectorAll('button')) x.classList.toggle('active', x === b);
        },
      });
      return b;
    };
    seg.append(
      modeBtn('Move points', false, 'Drag the corner points, or a face over the texture (all selected faces move together)'),
      modeBtn('Pick tile', true, 'Click a tile to map the selected face(s) to it (Shift = all faces)'),
    );
    const snap = el('select', { title: 'Point snapping' });
    for (const [v, label] of [
      [1, 'Snap 1 px'],
      [4, 'Snap 4 px'],
      [8, 'Snap 8 px'],
      [16, 'Snap 16 px'],
      [0, 'Free'],
    ] as const) {
      snap.append(el('option', { value: String(v), text: label, selected: v === this.uvSnap }));
    }
    snap.addEventListener('change', () => {
      this.uvSnap = parseFloat(snap.value);
    });

    this.inspectorEl.append(
      el('div', { class: 'uv-toolbar' }, seg, snap, el('button', { class: 'btn', text: 'Whole atlas', title: 'Show the entire texture', onclick: () => this.uvView?.fit() })),
      this.uvView.el,
      el(
        'div',
        { class: 'button-stack row wrap' },
        el('button', { class: 'btn', text: 'Rotate', onclick: () => this.transformSelectedFaces(rotateUvCW, 'uv-rotate') }),
        el('button', { class: 'btn', text: 'Flip H', onclick: () => this.transformSelectedFaces(flipUvH, 'uv-flip') }),
        el('button', { class: 'btn', text: 'Flip V', onclick: () => this.transformSelectedFaces(flipUvV, 'uv-flip') }),
        el('button', {
          class: 'btn',
          text: 'Reset size',
          title: 'Resize the UV to the face’s real size (1 tile per meter)',
          onclick: () => this.resetFaceUv(),
        }),
        el('button', { class: 'btn', text: 'Same on all faces', onclick: () => this.copyUvToAllFaces() }),
      ),
      el('details', { class: 'vertex-details' }, el('summary', { text: 'Point values' }), this.buildVertexFields()),
    );
    this.uvView.redraw();
    this.focusUv();
  }

  /**
   * The guide of the Hytale art team (see core/hytaleStyle.ts) as a check: is the model made of cubes and quads,
   * how many triangles does it have, and what in it is against the rules.
   */
  private buildStyleSection(model: Model): HTMLElement {
    const report = checkModel(model);
    const ok = report.problems.length === 0;
    const details = el('details', { class: 'style-details' });
    details.open = !ok;
    details.append(
      el('summary', {
        class: ok ? 'style-ok' : 'style-bad',
        text: `Style · ${ok ? 'cubes and quads only ✓' : `${report.problems.length} thing${report.problems.length === 1 ? '' : 's'} against the guide`} · ${report.triangles} triangles`,
      }),
    );
    details.append(
      el('div', { class: 'muted style-line', text: `${report.boxes} cube${report.boxes === 1 ? '' : 's'}, ${report.quads} quad${report.quads === 1 ? '' : 's'} · ${tierLabel(report.tier)}` }),
    );
    for (const p of [...report.problems, ...report.warnings]) {
      details.append(el('div', { class: 'style-problem', text: `${p.cube}: ${p.message}` }));
    }
    details.append(
      el('div', {
        class: 'muted style-line',
        text: 'The guide of the Hytale art team: only cubes (6 sides) and quads (2 sides), angles made by turning them, no spheres, cones, wedges or bevels; chunky, toylike shapes; a prop under 400 triangles. It is a best practice, not a law: a model that breaks it still works.',
      }),
    );
    return details;
  }

  /** Skeleton and animation preview of the open model. */
  private buildRigSection(model: Model): HTMLElement {
    const details = el('details', { class: 'rig-details' });
    details.open = this.previewName !== null;
    details.append(
      el('summary', {
        text: `Rig · ${model.bones.length} bone${model.bones.length === 1 ? '' : 's'} · ${model.clips.length} animation${model.clips.length === 1 ? '' : 's'}`,
      }),
    );

    details.append(
      el(
        'div',
        { class: 'button-stack' },
        el('button', {
          class: 'btn primary',
          text: 'Edit animations →',
          disabled: model.bones.length === 0,
          title: 'Open this model in the animation editor',
          onclick: () => this.onAnimate?.(model.id),
        }),
      ),
    );

    // preview
    const preview = el('select', { title: 'Play an animation of this model' });
    preview.append(el('option', { value: '', text: 'Rest pose (editable)' }));
    for (const c of model.clips) preview.append(el('option', { value: c.name, text: `▶ ${c.name}` }));
    preview.value = this.previewName ?? '';
    preview.disabled = model.clips.length === 0 || model.bones.length === 0;
    preview.addEventListener('change', () => this.setPreview(preview.value || null));
    details.append(
      el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Preview' }), el('span', { class: 'form-control' }, preview)),
    );
    if (model.bones.length === 0) {
      details.append(
        el('div', {
          class: 'empty muted',
          text: 'No bones yet. Add one below and give shapes a bone to animate them, or use File > Import rig.',
        }),
      );
    }

    // bones
    const parentOptions = (self: Bone) => {
      // anything that is not the bone itself or below it
      const below = new Set<string>([self.id]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const b of model.bones) {
          if (b.parent && below.has(b.parent) && !below.has(b.id)) {
            below.add(b.id);
            grew = true;
          }
        }
      }
      return model.bones.filter((b) => !below.has(b.id)).map((b) => ({ value: b.id, label: b.name }));
    };
    const list = el('div', { class: 'bone-list' });
    for (const bone of model.bones) {
      const oldName = bone.name;
      const view = { name: bone.name, parent: bone.parent, pivot: bone.pivot };
      const form = buildForm(
        [
          { kind: 'text', key: 'name', label: 'Name' },
          { kind: 'select', key: 'parent', label: 'Parent', nullable: true, noneLabel: 'None (root)', options: parentOptions(bone) },
          { kind: 'vec3', key: 'pivot', label: 'Pivot', step: 0.01, unit: 'm', hint: 'The joint the bone turns around' },
        ],
        view as unknown as Record<string, unknown>,
        (key) => {
          if (key === 'name') {
            // clips and the player's attachments refer to bones by name, so the store renames them there too
            if (!this.store.renameBone(model.id, bone.id, view.name.trim() || oldName)) return;
          } else if (key === 'parent') {
            bone.parent = view.parent || null;
          } else {
            bone.pivot = [...view.pivot] as Vec3;
          }
          this.structuralChange('edit:bone');
        },
      );
      list.append(
        el(
          'details',
          { class: 'bone' },
          el('summary', { text: bone.name }),
          form,
          el('button', {
            class: 'btn danger',
            text: 'Delete bone',
            onclick: () => {
              for (const c of model.cubes) if (c.bone === bone.id) c.bone = null;
              for (const b of model.bones) if (b.parent === bone.id) b.parent = bone.parent;
              model.bones = model.bones.filter((b) => b !== bone);
              this.structuralChange('delete-bone');
              this.refreshInspector();
            },
          }),
        ),
      );
    }
    details.append(list);

    const nameFor = (base: string) => {
      let name = base;
      for (let n = 2; model.bones.some((b) => b.name === name); n++) name = `${base} ${n}`;
      return name;
    };
    details.append(
      el(
        'div',
        { class: 'button-stack row wrap' },
        el('button', {
          class: 'btn',
          text: '+ Bone',
          title: 'Add a bone at the selected shape (or at the origin)',
          onclick: () => {
            const c = this.cube;
            model.bones.push({ id: newId(), name: nameFor('Bone'), parent: null, pivot: c ? [...c.position] : [0, 0.5, 0] });
            this.structuralChange('add-bone');
            this.refreshInspector();
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Bone from shape',
          title: 'Add a bone named after the selected shape and move the shape with it',
          disabled: !this.cube,
          onclick: () => {
            const c = this.cube;
            if (!c) return;
            const bone: Bone = { id: newId(), name: nameFor(c.name), parent: null, pivot: [...c.position] };
            model.bones.push(bone);
            c.bone = bone.id;
            this.structuralChange('add-bone');
            this.refreshInspector();
          },
        }),
      ),
    );
    return details;
  }

  /** Keep the position / rotation / size inputs in step with gizmo drags. */
  private syncPositionFields(): void {
    const cube = this.cube;
    const form = this.posForm;
    const view = this.posView;
    if (!cube || !form || !view) return;
    view.position = cube.position;
    view.rotation = cube.rotation;
    view.size = meshSize(cube.mesh);
    const inputs = form.querySelectorAll('input[type=number]');
    const values = [...cube.position, ...cube.rotation, ...view.size];
    inputs.forEach((input, i) => {
      if (i < values.length && document.activeElement !== input) {
        (input as HTMLInputElement).value = String(Math.round(values[i]! * 1000) / 1000);
      }
    });
  }

  private buildVertexFields(): HTMLElement {
    const wrap = el('div', { class: 'vertex-fields' });
    this.vertexInputs = [];
    const cube = this.cube;
    const count = cube?.mesh.faces[this.primaryFace()]?.v.length ?? 0;
    for (let i = 0; i < count; i++) {
      const row: HTMLInputElement[] = [];
      const cells: HTMLElement[] = [el('span', { class: 'vertex-label', text: `P${i + 1}` })];
      for (const axis of [0, 1] as const) {
        const input = el('input', { type: 'number', step: 1 });
        input.addEventListener('change', () => {
          const c = this.cube;
          const info = this.texInfo();
          const v = parseFloat(input.value);
          if (!c || !info || !Number.isFinite(v)) return;
          const fi = this.primaryFace();
          const uv = cloneUv(c.mesh.faces[fi]!.uv);
          uv[i]![axis] = v;
          this.setFaceUv(c, fi, clampUv(uv, info.width, info.height));
          this.uvsChanged('edit:uv-field');
          this.updateVertexFields();
          this.uvView?.redraw();
        });
        row.push(input);
        cells.push(el('span', { class: 'axis', text: axis === 0 ? 'U' : 'V' }), input);
      }
      this.vertexInputs.push(row);
      wrap.append(el('div', { class: 'vertex-row' }, ...cells));
    }
    this.updateVertexFields();
    return wrap;
  }

  private updateVertexFields(): void {
    const cube = this.cube;
    if (!cube || this.vertexInputs.length === 0) return;
    const uv = cube.mesh.faces[this.primaryFace()]?.uv;
    if (!uv) return;
    if (uv.length !== this.vertexInputs.length) {
      this.refreshInspector(); // a face with another number of corners: rebuild the fields
      return;
    }
    for (let i = 0; i < uv.length; i++) {
      this.vertexInputs[i]![0]!.value = String(Math.round(uv[i]![0] * 100) / 100);
      this.vertexInputs[i]![1]!.value = String(Math.round(uv[i]![1] * 100) / 100);
    }
  }

  // ---------------------------------------------------------------- loop

  private resize(): void {
    const w = Math.max(1, this.viewportEl.clientWidth);
    const h = Math.max(1, this.viewportEl.clientHeight);
    this.renderer.setSize(w, h);
    this.nav.setSize(w, h);
  }

  private frame = () => {
    requestAnimationFrame(this.frame);
    if (!this.active) return;
    // self-heal if another part of the editor invalidated this model's render
    if (this.model && this.library.get(this.model.id) !== this.render) this.rebuildMesh();
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.nav.update(dt);
    this.updatePreview(dt);
    this.gizmo.sync();
    this.axisGizmo.draw();
    this.visuals.update(this.previewName === null ? this.cube : null, this.bar.sub, this.edit.faces, this.edit.vertices, true);
    this.renderer.render(this.scene, this.camera);
  };
}

function meshBoundsOf(mesh: { verts: Vec3[] }): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.verts) {
    for (let i = 0; i < 3; i++) {
      if (v[i]! < min[i]!) min[i] = v[i]!;
      if (v[i]! > max[i]!) max[i] = v[i]!;
    }
  }
  return { min, max };
}

