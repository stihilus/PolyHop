import * as THREE from 'three';
import { type FaceTile, sanitizeFaceTile, triangulateFace } from '../core/mesh';
import { type SculptMode, isTerrainGrid, sculpt as sculptHeights, terrainHeightAt } from '../core/terrain';
import { degreesFromQuaternion, quaternionFromDegrees, worldPoints } from '../core/shape';
import type { LevelBlock, LevelData, LevelModelInstance, Vec3 } from '../core/types';
import { PAD } from '../core/gamepad';
import { type Environment, createEnvironment } from '../runtime/environment';
import { Game, type GameStats } from '../runtime/game';
import { PadReader } from '../runtime/gamepad';
import { MenuNav } from '../runtime/menuNav';
import type { TextureLibrary } from '../runtime/textures';
import { CameraNav } from './cameraNav';
import { Gizmo, type TransformDelta, type TransformTarget } from './gizmo';
import type { LevelObject } from '../core/types';
import { MeshEditing } from './meshEditing';
import {
  type ShapeHooks,
  ShapeVisuals,
  averageFaceNormal,
  multiObjectTarget,
  objectTarget,
  verticesOfFaces,
  vertexTarget,
} from './shapeTargets';
import type { Store, StoreEvent } from './store';
import { TransformBar } from './ui/transformBar';
import { AxisGizmo, buildViewMenu } from './ui/viewControls';

const CLICK_MOVE_TOLERANCE = 4; // px
const RING_SEGMENTS = 48;
export const MODEL_DRAG_MIME = 'application/x-polyhop-model';
export const PREFAB_DRAG_MIME = 'application/x-polyhop-prefab';

const SNAP_OPTIONS = [
  { value: 0, label: 'Snap off' },
  { value: 0.25, label: 'Snap 0.25 m' },
  { value: 0.5, label: 'Snap 0.5 m' },
  { value: 1, label: 'Snap 1 m' },
];

/** The 3D view: orbit camera, selection and transform gizmo while editing, gameplay while playing. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly game: Game;
  /** Toolbar with the tool / edit mode / snap controls. The app puts it into the page. */
  readonly bar = new TransformBar({ snapOptions: SNAP_OPTIONS, snap: 0.5, paintTool: true, sculptTool: true });
  /** Godot-style editor camera navigation (orbit / pan / zoom / fly, numpad views). */
  readonly nav: CameraNav;
  /** Perspective / orthogonal / standard views menu, for the toolbar. */
  readonly viewMenu: ReturnType<typeof buildViewMenu>;
  private axisGizmo: AxisGizmo;
  private fog: THREE.Fog;
  private playCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  private gizmo: Gizmo;
  private visuals: ShapeVisuals;
  private grid: THREE.GridHelper;
  // selection display for things that are not editable boxes (model instances, the player)
  private selectionBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffd34d'));
  private selectionFill = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.2, depthWrite: false }),
  );
  private tmpBox = new THREE.Box3();
  private followPoint = new THREE.Vector3();
  /** Outlines of the selected objects while more than one is selected (reused between frames). */
  private multiBoxes: { helper: THREE.Box3Helper; fill: THREE.Mesh }[] = [];
  /** The drag rectangle that selects several objects. */
  private marqueeEl = document.createElement('div');
  /** Paint tool: the face under the cursor, and the stroke in progress. */
  private hoverMesh: THREE.Mesh;
  private painting = false;
  private paintedAny = false;
  private lastPainted = '';
  /** Sculpt tool: the stroke in progress, the ring that shows the brush. */
  private sculptStroke: { block: LevelBlock; level: number; timer: number; at: { clientX: number; clientY: number } } | null = null;
  private brushRing: THREE.LineLoop;
  private marquee: { x: number; y: number; active: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private last = performance.now();
  private pointerDownAt: { x: number; y: number } | null = null;

  /** Face / vertex selection and the mesh tools (extrude, loop cut, ...) of the selected block. */
  private edit!: MeshEditing;

  /** Called every frame while playing (used for the debug HUD). */
  onPlayStats?: (s: GameStats) => void;
  /** A model from the asset explorer was dropped on the view. */
  onDropModel?: (modelId: string, position: Vec3) => void;
  /** A game object asset was dropped on the view. */
  onDropPrefab?: (prefabId: string, position: Vec3) => void;
  /** Short status while flying the camera (fly speed). */
  onNavStatus?: (text: string | null) => void;
  /** A tool wants to tell the user something (why it did nothing). */
  onNotify?: (text: string) => void;
  /** Sky, fog, sun and shadows of the level shown (set up with the environment). */
  private applyLook: (level: LevelData) => void = () => {};
  private environment!: Environment;
  /** The tile the paint tool lays down (a tile of an atlas plus a quarter-turn count and a mirror flag). */
  brush: FaceTile | null = null;
  /** Paint tool: lay the brush down, or take a painted tile off a face. */
  brushMode: 'paint' | 'erase' = 'paint';
  /** The tool strip changed tool (the Properties panel shows the brush while painting). */
  onToolChange?: () => void;
  /** The eyedropper took a new brush from a face. */
  onBrushPicked?: () => void;
  /** Sculpt tool: what the brush does, how big and how strong. 'paint' lays the paint brush's tile on cells. */
  sculptMode: SculptMode | 'paint' = 'raise';
  sculptRadius = 3;
  sculptStrength = 0.5;
  /** The end screen's "Back to editor" button was pressed. */
  onExitRequest?: () => void;
  /** Rendering pauses while another editor is shown. */
  active = true;

  constructor(
    private container: HTMLElement,
    private store: Store,
    textures: TextureLibrary,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.renderer.domElement.classList.add('viewport-canvas');

    const environment = createEnvironment(this.scene, this.renderer);
    this.environment = environment;
    this.fog = environment.fog;

    // grid on the ground plane with the world axes drawn in color, like Godot (X red, Y green, Z blue)
    this.grid = new THREE.GridHelper(120, 120, 0x1d2430, 0x1d2430);
    this.grid.position.y = 0.01;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.22;
    const axisLine = (a: THREE.Vector3, b: THREE.Vector3, color: number) => {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
      );
      line.position.y = 0.02;
      this.grid.add(line);
    };
    axisLine(new THREE.Vector3(-60, 0, 0), new THREE.Vector3(60, 0, 0), 0xe8505b);
    axisLine(new THREE.Vector3(0, 0, -60), new THREE.Vector3(0, 0, 60), 0x4aa3ff);
    axisLine(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 60, 0), 0x7bc950);
    this.scene.add(this.grid);

    this.hoverMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    const ringPts: THREE.Vector3[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) ringPts.push(new THREE.Vector3(Math.cos((i / RING_SEGMENTS) * Math.PI * 2), 0, Math.sin((i / RING_SEGMENTS) * Math.PI * 2)));
    this.brushRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: '#ffd34d', depthTest: false }),
    );
    this.brushRing.renderOrder = 13;
    this.brushRing.frustumCulled = false;
    this.brushRing.visible = false;
    this.scene.add(this.brushRing);
    this.hoverMesh.renderOrder = 12;
    this.hoverMesh.frustumCulled = false;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);

    (this.selectionBox.material as THREE.LineBasicMaterial).depthTest = false;
    this.selectionBox.renderOrder = 10;
    this.selectionFill.renderOrder = 9;
    this.selectionBox.visible = false;
    this.selectionFill.visible = false;
    this.scene.add(this.selectionBox, this.selectionFill);

    this.game = new Game(this.scene, this.playCamera, this.renderer.domElement, textures, store.project);
    this.applyLook = (level) => environment.setLevel(level, textures);
    this.game.onLevelShown = (level) => this.applyLook(level);
    this.applyLook(store.level);
    this.game.endActions = [{ label: 'Back to editor', run: () => this.onExitRequest?.() }];
    this.game.onRestart = () => this.requestLock();

    this.nav = new CameraNav(this.renderer.domElement);
    this.nav.jumpTo(new THREE.Vector3(0, 1, 0), 23.4, 0.72, 0.44);
    this.nav.onStatus = (t) => this.onNavStatus?.(t);
    this.nav.onFocusRequest = () => this.frameSelection();

    // created after the navigation so the gizmo can pause the camera while a handle is dragged
    this.gizmo = new Gizmo(this.scene, this.editCamera, this.renderer.domElement, this.nav);
    this.visuals = new ShapeVisuals(this.scene);
    this.edit = new MeshEditing(this.bar, this.visuals, {
      shape: () => this.selectedBlock(),
      raycastFace: (e) => this.raycastBlockFace(e),
      meshChanged: (label) => this.blockMeshChanged(label),
      selectionChanged: () => this.refreshTarget(),
      notify: (t) => this.onNotify?.(t),
    });
    this.viewMenu = buildViewMenu(this.nav);
    this.axisGizmo = new AxisGizmo(this.nav);
    container.append(this.axisGizmo.el);
    this.nav.onViewChange = () => {
      this.viewMenu.sync();
      this.gizmo.setCamera(this.editCamera);
      this.scene.fog = this.nav.isOrthographic ? null : this.fog;
    };
    this.bar.onChange = () => this.onBarChanged();
    this.onBarChanged();

    Object.assign(this.marqueeEl.style, {
      position: 'absolute',
      display: 'none',
      border: '1px dashed #ffd34d',
      background: 'rgba(255, 211, 77, 0.12)',
      pointerEvents: 'none',
      zIndex: '5',
    });
    container.append(this.marqueeEl);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      // Alt + left mouse is the trackpad stand-in for the middle button (navigation, not picking)
      if (e.button !== 0 || e.altKey || this.gizmo.hovering || this.gizmo.dragging) {
        this.pointerDownAt = null;
        this.marquee = null;
        return;
      }
      if (!this.game.playing && this.bar.tool === 'sculpt') {
        this.pointerDownAt = null;
        this.marquee = null;
        this.beginSculpt(e);
        return;
      }
      if (!this.game.playing && this.bar.tool === 'paint') {
        // the paint tool: a stroke starts here and runs until the button comes up
        this.pointerDownAt = null;
        this.marquee = null;
        this.painting = true;
        this.paintedAny = false;
        this.lastPainted = '';
        this.paintAt(e);
        return;
      }
      this.pointerDownAt = { x: e.clientX, y: e.clientY };
      this.marquee = this.game.playing ? null : { x: e.clientX, y: e.clientY, active: false };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.sculptStroke) {
        this.endSculpt();
        return;
      }
      if (this.painting) {
        this.endPaintStroke();
        return;
      }
      this.onPointerUp(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.game.playing && e.buttons === 0) this.edit.pointerMove(e);
      if (this.marquee && (e.buttons & 1) === 1) this.dragMarquee(e);
      if (!this.game.playing && this.bar.tool === 'paint') {
        if (this.painting && (e.buttons & 1) === 1) this.paintAt(e);
        else if (e.buttons === 0) this.hoverFaceAt(e);
      }
      if (!this.game.playing && this.bar.tool === 'sculpt') {
        if (this.sculptStroke) this.sculptStroke.at = { clientX: e.clientX, clientY: e.clientY };
        this.showBrushRing(e);
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.edit.clearPreview();
      this.endMarquee();
      this.hoverMesh.visible = false;
      this.brushRing.visible = false;
      if (this.sculptStroke) this.endSculpt();
      if (this.painting) this.endPaintStroke();
    });
    canvas.addEventListener('click', () => {
      if (this.game.playing) this.requestLock();
    });

    container.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types;
      if (types?.includes(MODEL_DRAG_MIME) || types?.includes(PREFAB_DRAG_MIME)) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'copy';
      }
    });
    container.addEventListener('drop', (e) => {
      const prefab = e.dataTransfer?.getData(PREFAB_DRAG_MIME);
      if (prefab) {
        e.preventDefault();
        this.onDropPrefab?.(prefab, this.groundPointAt(e.clientX, e.clientY));
        return;
      }
      const id = e.dataTransfer?.getData(MODEL_DRAG_MIME);
      if (!id) return;
      e.preventDefault();
      this.onDropModel?.(id, this.groundPointAt(e.clientX, e.clientY));
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();

    store.subscribe((e) => this.onStoreEvent(e));
    this.refreshTarget();
    requestAnimationFrame(this.frame);
  }

  get playing(): boolean {
    return this.game.playing;
  }

  // ---------------------------------------------------------------- play / stop

  private requestLock(): void {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      // pointer lock can be refused (iframes, automation); mouse-drag look still works
    }
  }

  play(): void {
    if (this.game.playing) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.store.select({ kind: 'none' });
    this.nav.enabled = false;
    this.grid.visible = false;
    this.axisGizmo.el.style.display = 'none';
    this.selectionBox.visible = false;
    this.selectionFill.visible = false;
    this.updateMultiBoxes([]);
    this.endMarquee();
    this.hoverMesh.visible = false;
    this.brushRing.visible = false;
    this.renderer.domElement.style.cursor = '';
    this.gizmo.setEnabled(false);
    this.setRenderScale(this.store.project.settings.renderScale);
    this.game.startPlay(this.store.levelIndex);
    this.requestLock();
    if (this.store.project.settings.fullscreen) {
      this.container.requestFullscreen?.().catch(() => {});
    }
  }

  stop(): void {
    if (!this.game.playing) return;
    this.game.stopPlay();
    this.setRenderScale(1);
    this.nav.enabled = true;
    this.grid.visible = true;
    this.axisGizmo.el.style.display = '';
    this.gizmo.setEnabled(true);
    this.renderer.domElement.style.cursor = this.bar.tool === 'paint' || this.bar.tool === 'sculpt' ? 'crosshair' : '';
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.refreshTarget();
  }

  /** Draw at a fraction of the screen's resolution (chunky pixels), or at full resolution. */
  private setRenderScale(scale: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
    this.renderer.domElement.style.imageRendering = scale < 1 ? 'pixelated' : '';
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.renderer.domElement;
  }

  // ---------------------------------------------------------------- selection and gizmo targets

  private selectedBlock(): LevelBlock | null {
    const o = this.store.selectedObject();
    return o && o.kind === 'block' && !this.isMultiple ? o : null;
  }

  private selectedInstance(): LevelModelInstance | null {
    const o = this.store.selectedObject();
    return o && o.kind === 'model' && !this.isMultiple ? o : null;
  }

  /** More than one object is selected: they are moved together and the mesh tools are off. */
  private get isMultiple(): boolean {
    return this.store.selectedIds().length > 1;
  }

  private selectedObjects(): LevelObject[] {
    return this.store.selectedIds().map((id) => this.store.getObject(id)).filter((o): o is LevelObject => !!o);
  }

  /** The active editor camera (perspective, or orthographic in the standard views). */
  private get editCamera(): THREE.Camera {
    return this.nav.camera;
  }

  /** Keyboard shortcuts of the level editor. Returns true when handled. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.nav.handleKey(e)) return true;
    // while the right button flies the camera, W A S D Q E belong to the camera, not to the tools
    if (this.nav.freelook) return true;
    if (this.bar.handleKey(e.code)) return true;
    if (e.code === 'KeyF') {
      this.frameSelection();
      return true;
    }
    return false;
  }

  /** Focus the camera on the selection (Godot: F). */
  frameSelection(): void {
    const obj = this.selectedObject3D();
    if (!obj) return;
    if (this.isMultiple) {
      this.tmpBox.makeEmpty();
      for (const id of this.store.selectedIds()) {
        const mesh = this.game.level.getMesh(id);
        if (mesh) this.tmpBox.union(new THREE.Box3().setFromObject(mesh));
      }
    } else {
      this.tmpBox.setFromObject(obj);
    }
    const center = this.tmpBox.getCenter(new THREE.Vector3());
    const radius = this.tmpBox.getSize(new THREE.Vector3()).length() / 2;
    this.nav.focus(center, radius);
  }

  private selectedObject3D(): THREE.Object3D | null {
    const sel = this.store.selection;
    if (sel.kind === 'player') return this.game.playerGroup;
    if (sel.kind === 'object') return this.game.level.getMesh(sel.id) ?? null;
    return null;
  }

  private onBarChanged(): void {
    const step = this.bar.snap;
    this.gizmo.setTool(this.bar.gizmoTool);
    this.gizmo.setSpace(this.bar.space);
    this.edit?.clearPreview();
    this.gizmo.setSnap(step, step > 0 ? 15 : 0);
    if (this.bar.tool !== 'paint') this.hoverMesh.visible = false;
    if (this.bar.tool !== 'sculpt') this.brushRing.visible = false;
    this.renderer.domElement.style.cursor = this.bar.tool === 'paint' || this.bar.tool === 'sculpt' ? 'crosshair' : '';
    this.refreshTarget();
    this.onToolChange?.();
  }

  private blockHooks(block: LevelBlock): ShapeHooks {
    const live = () => this.store.emit({ type: 'object-changed', id: block.id, live: true });
    return {
      onTransform: () => {
        this.game.level.syncTransform(block);
        this.game.refreshColliders();
        live();
      },
      onGeometry: () => {
        this.game.level.upsert(block);
        this.game.refreshColliders();
        live();
      },
      onCommit: () => this.store.commitLevel('transform'),
    };
  }

  /** A mesh tool changed the selected block: rebuild its geometry and colliders and record an undo step. */
  private blockMeshChanged(label: string): void {
    const block = this.selectedBlock();
    if (!block) return;
    this.game.level.upsert(block);
    this.game.refreshColliders();
    this.store.emit({ type: 'object-changed', id: block.id, live: true });
    this.store.commitLevel(`mesh:${label}`);
  }

  /** The face of the selected block under the pointer, with the hit point in the block's local space. */
  private raycastBlockFace(e: { clientX: number; clientY: number }): { face: number; local: Vec3 } | null {
    const block = this.selectedBlock();
    const mesh = block ? this.game.level.getMesh(block.id) : null;
    if (!block || !mesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.editCamera);
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    if (!hit) return null;
    const face = this.faceOfHit(hit);
    if (face === null) return null;
    const local = mesh.worldToLocal(hit.point.clone());
    return { face, local: [local.x, local.y, local.z] };
  }

  /** Delete key with a face / vertex selection: remove those elements. Returns true when it did something. */
  deleteElements(): boolean {
    return !this.game.playing && this.edit.deleteSelection();
  }

  private instanceTarget(inst: LevelModelInstance): TransformTarget {
    let pos0: Vec3 = [0, 0, 0];
    let scale0: Vec3 = [1, 1, 1];
    let q0 = new THREE.Quaternion();
    const live = () => {
      this.game.level.syncTransform(inst);
      this.game.refreshColliders();
      this.store.emit({ type: 'object-changed', id: inst.id, live: true });
    };
    return {
      allow: { translate: true, rotate: true, scale: true },
      pivot: () => new THREE.Vector3(...inst.position),
      orientation: () => quaternionFromDegrees(inst.rotation),
      begin: () => {
        pos0 = [...inst.position];
        scale0 = [...inst.scale];
        q0 = quaternionFromDegrees(inst.rotation);
      },
      apply: (d: TransformDelta) => {
        if (d.translate.lengthSq() > 0) inst.position = [pos0[0] + d.translate.x, pos0[1] + d.translate.y, pos0[2] + d.translate.z];
        if (Math.abs(Math.abs(d.rotate.w) - 1) > 1e-9) inst.rotation = degreesFromQuaternion(d.rotate.clone().multiply(q0));
        const k = (n: number) => Math.max(0.05, Math.round(n * 1000) / 1000);
        inst.scale = [k(scale0[0] * d.scale.x), k(scale0[1] * d.scale.y), k(scale0[2] * d.scale.z)];
        live();
      },
      end: () => this.store.commitLevel('transform'),
    };
  }

  /** Several objects at once: move, turn and scale them together. */
  private multiTarget(): TransformTarget {
    const live = (objs: LevelObject[]) => {
      for (const o of objs) this.store.emit({ type: 'object-changed', id: o.id, live: true });
    };
    return multiObjectTarget(this.selectedObjects(), {
      onTransform: (objs) => {
        for (const o of objs) this.game.level.syncTransform(o);
        this.game.refreshColliders();
        live(objs);
      },
      onGeometry: (objs) => {
        for (const o of objs) this.game.level.upsert(o);
        this.game.refreshColliders();
        live(objs);
      },
      onCommit: () => this.store.commitLevel('transform'),
    });
  }

  /** The gizmo of the player: it moves the spawn point of the level being edited. */
  private playerTarget(): TransformTarget {
    const p = this.store.project.player;
    const level = this.store.level;
    let spawn0: Vec3 = [0, 0, 0];
    let yaw0 = 0;
    const apply = () => this.store.emit({ type: 'player-changed', live: true });
    const yawQuat = () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (level.spawnYaw * Math.PI) / 180);
    return {
      allow: { translate: true, rotate: true, scale: false },
      rotateAxes: ['Y'],
      pivot: () => new THREE.Vector3(level.spawn[0], level.spawn[1] + p.height / 2, level.spawn[2]),
      orientation: yawQuat,
      begin: () => {
        spawn0 = [...level.spawn];
        yaw0 = level.spawnYaw;
      },
      apply: (d: TransformDelta) => {
        level.spawn = [spawn0[0] + d.translate.x, spawn0[1] + d.translate.y, spawn0[2] + d.translate.z];
        const yaw = 2 * Math.atan2(d.rotate.y, d.rotate.w); // rotation about Y of the delta
        level.spawnYaw = Math.round(yaw0 + (yaw * 180) / Math.PI);
        apply();
      },
      end: () => this.store.commitLevel('transform'),
    };
  }

  /** Rebuild what the gizmo drives after the selection, the edit mode or the data changed. */
  private refreshTarget(): void {
    const sel = this.store.selection;
    const block = this.selectedBlock();
    const inst = this.selectedInstance();
    this.bar.setCapabilities(this.edit.capabilities(!!block && !this.game.playing));
    let target: TransformTarget | null = null;

    if (!this.game.playing) {
      if (sel.kind === 'player') {
        target = this.playerTarget();
      } else if (block) {
        const hooks = this.blockHooks(block);
        const step = this.bar.snap;
        const mesh = block.mesh;
        if (this.bar.sub === 'object') {
          target = objectTarget(block, hooks, step);
        } else if (this.bar.sub === 'face' && this.edit.faces.length > 0) {
          const faces = this.edit.faces;
          target = vertexTarget(block, verticesOfFaces(mesh, faces), hooks, { normal: () => averageFaceNormal(mesh, faces) });
        } else if (this.bar.sub === 'vertex' && this.edit.vertices.length > 0) {
          target = vertexTarget(block, this.edit.vertices, hooks);
        }
      } else if (inst) {
        target = this.instanceTarget(inst);
      } else if (sel.kind === 'object' && this.isMultiple) {
        target = this.multiTarget();
      }
    }
    this.gizmo.setTarget(target);
  }

  private onStoreEvent(e: StoreEvent): void {
    const { game, store } = this;
    switch (e.type) {
      case 'project-replaced':
        this.edit.clearSelection();
        game.load(store.project, store.levelIndex);
        this.refreshTarget();
        break;
      case 'level-restored':
        this.edit.clearSelection();
        game.showLevel(store.levelIndex);
        this.refreshTarget();
        break;
      case 'sky-changed':
        if (!game.playing) this.applyLook(store.level);
        break;
      case 'levels-changed':
        if (!game.playing) this.applyLook(store.level);
        // another level is being edited
        if (game.currentLevelIndex !== store.levelIndex) {
          this.edit.clearSelection();
          game.showLevel(store.levelIndex);
          this.refreshTarget();
        }
        break;
      case 'object-added':
      case 'object-changed': {
        if (e.type === 'object-changed' && e.live) break; // the gizmo already updated the view
        const obj = store.getObject(e.id);
        if (obj) game.level.upsert(obj);
        game.refreshColliders();
        this.refreshTarget();
        break;
      }
      case 'object-removed':
        game.level.remove(e.id);
        game.refreshColliders();
        break;
      case 'selection':
        this.edit.clearSelection();
        this.refreshTarget();
        break;
      case 'model-changed':
        // pixel-only edits are already live in the shared atlas texture
        if (e.structural) {
          game.models.invalidate(e.id);
          for (const o of store.objects) {
            if (o.kind === 'model' && o.modelId === e.id) game.level.upsert(o);
          }
          game.refreshColliders();
        }
        break;
      case 'model-removed':
        game.models.invalidate(e.id);
        game.refreshColliders();
        break;
      case 'model-added':
        break;
      case 'texture-changed':
        // a texture appeared, vanished or changed size: everything sampling it must be rebuilt
        if (e.structural) {
          game.models.clear();
          game.level.rebuild(store.objects);
          game.refreshColliders();
        }
        // a picture of the sky may have been painted over
        if (!game.playing && store.level.look.skyStyle === 'texture') this.applyLook(store.level);
        break;
      case 'player-changed':
        if (game.playing) game.syncVisual(0);
        else game.resetPlayer();
        break;
      case 'settings-changed':
        break;
    }
  }

  // ---------------------------------------------------------------- picking

  /** World point under a screen position: first level surface hit, else the y=0 plane. Snapped to 0.5 m. */
  groundPointAt(clientX: number, clientY: number): Vec3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.editCamera);
    const snap = (v: number) => Math.round(v * 2) / 2;
    const hit = this.raycaster.intersectObjects(this.game.level.meshList(), false)[0];
    if (hit) return [snap(hit.point.x), hit.point.y, snap(hit.point.z)];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, p)) return [snap(p.x), 0, snap(p.z)];
    const t = this.nav.pivotPoint;
    return [snap(t.x), 0, snap(t.z)];
  }

  /** Where "place in level" puts things: the orbit pivot dropped to the ground. */
  viewCenterPoint(): Vec3 {
    const t = this.nav.pivotPoint;
    return [Math.round(t.x * 2) / 2, 0, Math.round(t.z * 2) / 2];
  }

  private faceOfHit(hit: THREE.Intersection): number | null {
    const map = (hit.object as THREE.Mesh).geometry?.userData?.faceOfTriangle as Uint16Array | undefined;
    if (!map || hit.faceIndex === undefined || hit.faceIndex === null) return null;
    return map[hit.faceIndex] ?? null;
  }

  // ---------------------------------------------------------------- terrain sculpting

  /** The terrain under the pointer (any block that is still a terrain grid) and the point in its own space. */
  private pickTerrain(e: { clientX: number; clientY: number }, only?: LevelBlock): { block: LevelBlock; x: number; z: number; world: THREE.Vector3 } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.editCamera);
    const meshes = only ? [this.game.level.getMesh(only.id)].filter((m): m is THREE.Mesh => !!m) : this.game.level.meshList();
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const block = this.store.getObject(hit.object.userData.objectId as string);
    if (!block || block.kind !== 'block' || !block.terrain || !isTerrainGrid(block.mesh, block.terrain)) return null;
    const local = (hit.object as THREE.Mesh).worldToLocal(hit.point.clone());
    return { block, x: local.x, z: local.z, world: hit.point.clone() };
  }

  /** The ring that shows where and how big the brush is, laid over the terrain. */
  private showBrushRing(e: { clientX: number; clientY: number }): void {
    const hit = this.pickTerrain(e, this.sculptStroke?.block);
    if (!hit) {
      this.brushRing.visible = false;
      return;
    }
    const { block, x, z } = hit;
    const info = block.terrain!;
    const attr = this.brushRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mesh = this.game.level.getMesh(block.id)!;
    const p = new THREE.Vector3();
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const lx = x + Math.cos(a) * this.sculptRadius;
      const lz = z + Math.sin(a) * this.sculptRadius;
      const h = terrainHeightAt(block.mesh, info, lx, lz) ?? terrainHeightAt(block.mesh, info, x, z) ?? 0;
      p.set(lx, h + 0.06, lz);
      mesh.localToWorld(p);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    this.brushRing.position.set(0, 0, 0);
    this.brushRing.scale.set(1, 1, 1);
    this.brushRing.visible = true;
  }

  private beginSculpt(e: PointerEvent): void {
    if (e.button !== 0) return;
    const hit = this.pickTerrain(e);
    if (!hit) {
      this.onNotify?.('Click on a terrain to sculpt it. Add one with + Add shape… > Terrain.');
      return;
    }
    const level = terrainHeightAt(hit.block.mesh, hit.block.terrain!, hit.x, hit.z) ?? 0;
    const stroke = {
      block: hit.block,
      level,
      at: { clientX: e.clientX, clientY: e.clientY },
      timer: window.setInterval(() => this.applySculpt(), 45),
    };
    this.sculptStroke = stroke;
    this.paintedAny = false;
    this.applySculpt();
  }

  private applySculpt(): void {
    const st = this.sculptStroke;
    if (!st) return;
    const hit = this.pickTerrain(st.at, st.block);
    if (!hit) return;
    const { block } = hit;
    const info = block.terrain!;
    if (this.sculptMode === 'paint') {
      const tile = sanitizeFaceTile(this.brush);
      if (!tile) return;
      let n = 0;
      block.mesh.faces.forEach((face, fi) => {
        let cx = 0;
        let cz = 0;
        for (const vi of face.v) {
          cx += block.mesh.verts[vi]![0];
          cz += block.mesh.verts[vi]![2];
        }
        cx /= face.v.length;
        cz /= face.v.length;
        if (Math.hypot(cx - hit.x, cz - hit.z) <= this.sculptRadius) {
          if (this.brushMode === 'erase') delete block.mesh.faces[fi]!.tile;
          else block.mesh.faces[fi]!.tile = { ...tile };
          n++;
        }
      });
      if (n === 0) return;
    } else {
      const moved = sculptHeights(block.mesh, info, hit.x, hit.z, {
        mode: this.sculptMode,
        radius: this.sculptRadius,
        strength: this.sculptStrength,
        level: st.level,
      });
      if (moved === 0) return;
    }
    this.paintedAny = true;
    this.game.level.upsert(block);
    this.store.emit({ type: 'object-changed', id: block.id, live: true });
    this.showBrushRing(st.at);
  }

  private endSculpt(): void {
    const st = this.sculptStroke;
    if (!st) return;
    window.clearInterval(st.timer);
    this.sculptStroke = null;
    if (this.paintedAny) {
      this.game.refreshColliders();
      this.store.commitLevel('sculpt');
    }
    this.paintedAny = false;
  }

  // ---------------------------------------------------------------- tile painting

  /** The level block face under the pointer, if any. */
  private pickBlockFace(e: { clientX: number; clientY: number }): { block: LevelBlock; face: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.editCamera);
    const hit = this.raycaster.intersectObjects(this.game.level.meshList(), false)[0];
    if (!hit) return null;
    const block = this.store.getObject(hit.object.userData.objectId as string);
    const face = this.faceOfHit(hit);
    if (!block || block.kind !== 'block' || face === null) return null;
    return { block, face };
  }

  /** Light up the face the paint tool would change. */
  private hoverFaceAt(e: { clientX: number; clientY: number }): void {
    const hit = this.pickBlockFace(e);
    if (!hit) {
      this.hoverMesh.visible = false;
      return;
    }
    const pts = worldPoints(hit.block);
    const face = hit.block.mesh.faces[hit.face]!;
    const positions: number[] = [];
    for (const [a, b, c] of triangulateFace(hit.block.mesh, hit.face)) {
      for (const k of [a!, b!, c!]) {
        const p = pts[face.v[k]!]!;
        positions.push(p[0], p[1], p[2]);
      }
    }
    this.hoverMesh.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.hoverMesh.geometry = geo;
    this.hoverMesh.visible = true;
  }

  /** Apply the brush to the face under the pointer (Shift: the whole block, Ctrl / Cmd: take its tile). */
  private paintAt(e: PointerEvent): void {
    const hit = this.pickBlockFace(e);
    if (!hit) return;
    const { block, face } = hit;
    const f = block.mesh.faces[face]!;
    if (e.ctrlKey || e.metaKey) {
      const t = f.tile ?? block.tile;
      if (t) {
        this.brush = { ...t };
        this.brushMode = 'paint';
        this.onBrushPicked?.();
      }
      return;
    }
    const whole = e.shiftKey;
    const key = `${block.id}:${whole ? '*' : face}`;
    if (key === this.lastPainted) return;
    this.lastPainted = key;

    if (this.brushMode === 'erase') {
      if (whole) for (const g of block.mesh.faces) delete g.tile;
      else delete f.tile;
    } else {
      const tile = sanitizeFaceTile(this.brush);
      if (!tile) return;
      if (whole) {
        // the block's own tile; painted faces fall back to it
        block.tile = { texture: tile.texture, col: tile.col, row: tile.row };
        for (const g of block.mesh.faces) delete g.tile;
      } else {
        f.tile = tile;
      }
    }
    this.paintedAny = true;
    this.game.level.upsert(block);
    this.store.emit({ type: 'object-changed', id: block.id, live: true });
  }

  private endPaintStroke(): void {
    this.painting = false;
    this.lastPainted = '';
    if (this.paintedAny) this.store.commitLevel('paint');
    this.paintedAny = false;
  }

  /** Grow the selection rectangle while the left button is dragged over empty space or objects. */
  private dragMarquee(e: PointerEvent): void {
    const m = this.marquee;
    if (!m || this.game.playing) return;
    if (!m.active && Math.hypot(e.clientX - m.x, e.clientY - m.y) <= CLICK_MOVE_TOLERANCE) return;
    m.active = true;
    const box = this.container.getBoundingClientRect();
    const x0 = Math.min(m.x, e.clientX) - box.left;
    const y0 = Math.min(m.y, e.clientY) - box.top;
    Object.assign(this.marqueeEl.style, {
      display: 'block',
      left: `${x0}px`,
      top: `${y0}px`,
      width: `${Math.abs(e.clientX - m.x)}px`,
      height: `${Math.abs(e.clientY - m.y)}px`,
    });
  }

  private endMarquee(): void {
    this.marquee = null;
    this.marqueeEl.style.display = 'none';
  }

  /** Ids of the objects whose center lies inside a screen rectangle (client coordinates). */
  private objectsInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const out: string[] = [];
    const c = new THREE.Vector3();
    for (const o of this.store.objects) {
      const mesh = this.game.level.getMesh(o.id);
      if (!mesh) continue;
      this.tmpBox.setFromObject(mesh);
      if (this.tmpBox.isEmpty()) continue;
      this.tmpBox.getCenter(c).project(this.editCamera);
      if (c.z > 1 || c.z < -1) continue; // behind the camera
      const sx = rect.left + ((c.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - c.y) / 2) * rect.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) out.push(o.id);
    }
    return out;
  }

  private onPointerUp(e: PointerEvent): void {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    const marquee = this.marquee;
    this.endMarquee();
    if (this.game.playing || e.button !== 0 || !down) return;
    if (marquee?.active) {
      const ids = this.objectsInRect(
        Math.min(down.x, e.clientX),
        Math.min(down.y, e.clientY),
        Math.max(down.x, e.clientX),
        Math.max(down.y, e.clientY),
      );
      const keep = e.shiftKey || e.ctrlKey || e.metaKey ? this.store.selectedIds() : [];
      this.store.selectObjects([...ids, ...keep]);
      return;
    }
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MOVE_TOLERANCE) return;

    // click-in-view mesh tools (loop cut, add vertex) use the click themselves
    if (this.edit.pointerClick(e)) return;

    const rect = this.renderer.domElement.getBoundingClientRect();

    // vertex mode: a click near a vertex handle of the selected block picks that vertex
    const block = this.selectedBlock();
    if (block && this.bar.sub === 'vertex') {
      const v = this.visuals.pickVertex(block, this.editCamera, rect, e.clientX, e.clientY);
      if (v !== null) {
        const cur = this.edit.vertices;
        this.edit.vertices = e.shiftKey ? (cur.includes(v) ? cur.filter((i) => i !== v) : [...cur, v]) : [v];
        this.refreshTarget();
        return;
      }
    }

    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.editCamera);
    const targets: THREE.Object3D[] = [...this.game.level.meshList(), this.game.playerBody];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      this.store.select({ kind: 'none' });
      return;
    }
    if (hit.object === this.game.playerBody) {
      this.store.select({ kind: 'player' });
      return;
    }
    const id = hit.object.userData.objectId as string;
    const face = this.faceOfHit(hit);
    const sel = this.store.selection;
    const sameObject = sel.kind === 'object' && sel.id === id;
    // Ctrl / Cmd (or Shift in object mode) adds the object to the selection or takes it out again
    const addsFaces = e.shiftKey && sameObject && this.bar.sub === 'face' && !this.isMultiple;
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && !addsFaces && sel.kind !== 'player') {
      this.store.toggleObject(id);
      this.refreshTarget();
      return;
    }
    if (!sameObject || this.isMultiple) this.store.select({ kind: 'object', id });
    if (face !== null) {
      // Shift adds faces to the selection in Face mode; otherwise the clicked face replaces it
      const cur = this.edit.faces;
      this.edit.faces =
        e.shiftKey && sameObject && this.bar.sub === 'face' ? (cur.includes(face) ? cur.filter((f) => f !== face) : [...cur, face]) : [face];
    }
    this.refreshTarget();
  }

  /** One yellow outline and tint per selected object (the pool grows as needed). */
  private updateMultiBoxes(ids: string[]): void {
    while (this.multiBoxes.length < ids.length) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffd34d'));
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 10;
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.2, depthWrite: false }),
      );
      fill.renderOrder = 9;
      this.scene.add(helper, fill);
      this.multiBoxes.push({ helper, fill });
    }
    this.multiBoxes.forEach(({ helper, fill }, i) => {
      const mesh = i < ids.length ? this.game.level.getMesh(ids[i]!) : undefined;
      helper.visible = !!mesh;
      fill.visible = !!mesh;
      if (!mesh) return;
      helper.box.setFromObject(mesh).expandByScalar(0.02);
      helper.box.getCenter(fill.position);
      helper.box.getSize(fill.scale);
    });
  }

  // ---------------------------------------------------------------- loop

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.nav.setSize(w, h);
    this.playCamera.aspect = w / h;
    this.playCamera.updateProjectionMatrix();
  }

  private pad = new PadReader();
  private menuNav = new MenuNav({ layers: () => [this.game.endScreen], blocked: () => false });

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.active) return;

    if (this.game.playing && this.store.project.settings.gamepad) {
      // the gamepad: up / down and Cross on the end screen, and Options leaves the game like Esc does
      this.pad.poll(dt);
      this.menuNav.update(this.pad);
      if (this.pad.pressed(PAD.options) && !this.game.ended) this.onExitRequest?.();
    }
    this.game.update(dt);
    // the sun's shadows are drawn around where the action is
    if (this.game.playing) {
      const c = this.game.controller.pos;
      this.followPoint.set(c[0], c[1], c[2]);
    } else {
      this.followPoint.copy(this.nav.pivotPoint);
    }
    this.environment.followSun(this.followPoint);
    if (this.game.playing) {
      this.visuals.update(null, 'object', [], [], false);
      this.onPlayStats?.(this.game.stats());
      this.renderer.render(this.scene, this.playCamera);
      return;
    }

    this.nav.update(dt);
    this.gizmo.sync();
    this.axisGizmo.draw();

    const block = this.selectedBlock();
    this.visuals.update(block, block ? this.bar.sub : 'object', this.edit.faces, this.edit.vertices, true);

    // several selected objects: one outline each
    const many = this.isMultiple ? this.store.selectedIds() : [];
    this.updateMultiBoxes(many);

    // plain box highlight for selections that are not editable boxes
    const obj = block || many.length > 0 ? null : this.selectedObject3D();
    this.selectionBox.visible = !!obj;
    this.selectionFill.visible = !!obj;
    if (obj) {
      this.tmpBox.setFromObject(obj);
      this.selectionBox.box.copy(this.tmpBox).expandByScalar(0.02);
      this.selectionBox.box.getCenter(this.selectionFill.position);
      this.selectionBox.box.getSize(this.selectionFill.scale);
    }
    this.renderer.render(this.scene, this.editCamera);
  };
}
