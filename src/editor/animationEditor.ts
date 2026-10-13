import * as THREE from 'three';
import {
  type Channel,
  FRAME,
  applyPose,
  clipPoseAt,
  deleteKey,
  duplicateClip,
  keyAt,
  keysOf,
  mirrorPose,
  moveKey,
  sampleBone,
  scaleDuration,
  setKey,
  snapTime,
} from '../core/clipEdit';
import { type Pose, boneAnchor, createSkeleton, rotateInParent, sampleClip } from '../core/rig';
import { type AnimationClip, type Bone, type Model, type Vec3, newId, normalizeClip } from '../core/types';
import type { ModelLibrary, ModelRender } from '../runtime/modelRender';
import { RigRender } from '../runtime/rigRender';
import type { TextureLibrary } from '../runtime/textures';
import { CameraNav } from './cameraNav';
import { Gizmo, type TransformTarget } from './gizmo';
import type { Store } from './store';
import { clear, el } from './ui/dom';
import { icon } from './ui/icons';
import { renameInline } from './ui/rename';
import { makeSplitter } from './ui/splitter';
import { AxisGizmo, buildViewMenu } from './ui/viewControls';

const LABEL_W = 170; // width of the bone names column of the timeline

interface HistoryStep {
  label: string;
  before: string;
  after: string;
}

interface KeyRef {
  bone: string;
  channel: Channel;
  t: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000 + 0;

/** The animation editor: poses a rigged model with a gizmo and records keyframes on a timeline. */
export class AnimationEditor {
  readonly root: HTMLElement;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private nav: CameraNav;
  private gizmo: Gizmo;
  private viewMenu: ReturnType<typeof buildViewMenu>;
  private axisGizmo: AxisGizmo;
  private canvas: HTMLCanvasElement;
  private viewportEl = el('div', { class: 'viewport' });
  private raycaster = new THREE.Raycaster();
  private downAt: { x: number; y: number } | null = null;
  private lastFrame = performance.now();
  private active = false;

  // what is on screen
  private model: Model | null = null;
  private render: ModelRender | null = null;
  private rig: RigRender | null = null;
  private skeleton: THREE.LineSegments;
  /** The model as it is when it has no bones yet (nothing to pose, but it is shown). */
  private stillMesh: THREE.Mesh | null = null;
  private marker: THREE.Mesh;

  // editing state
  private clip: AnimationClip | null = null;
  private time = 0;
  private playing = false;
  private speed = 1;
  private selectedBone: string | null = null;
  private selectedKey: KeyRef | null = null;
  private tool: 'rotate' | 'translate' = 'rotate';
  private onlyAnimated = true;
  private pps = 220; // timeline pixels per second
  private clipboard: Pose | null = null;

  // history of the open model's clips
  private undoStack: HistoryStep[] = [];
  private redoStack: HistoryStep[] = [];
  private stateJson = '';
  private lastCommitAt = 0;

  // ui
  private modelSelect = el('select', {});
  private clipListEl = el('div', { class: 'hierarchy clip-list' });
  private boneListEl = el('div', { class: 'hierarchy bone-tree' });
  private inspectorEl = el('div', { class: 'inspector' });
  private timelineEl = el('div', { class: 'timeline' });
  private tlBody = el('div', { class: 'tl-body' });
  private playBtn = el('button', { class: 'tool-btn', title: 'Play / pause (Space)' });
  private timeLabel = el('span', { class: 'tl-time', text: '0.00 s' });
  private playhead: HTMLElement | null = null;
  private undoBtn = el('button', { class: 'tool-btn', title: 'Undo (Ctrl/Cmd+Z)' }, icon('undo', 18));
  private redoBtn = el('button', { class: 'tool-btn', title: 'Redo (Ctrl/Cmd+Shift+Z)' }, icon('redo', 18));
  private toolButtons = new Map<string, HTMLButtonElement>();
  private emptyEl = el('div', { class: 'model-empty' });
  private bannerEl = el('div', { class: 'anim-banner hidden' });
  private hintEl = el('div', { class: 'hud hud-bottom' });
  private rotInputs: HTMLInputElement[] = [];
  private posInputs: HTMLInputElement[] = [];
  private keyInfoEl = el('div', { class: 'muted key-info' });

  constructor(
    private store: Store,
    _textures: TextureLibrary,
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

    this.skeleton = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#7be0ff', depthTest: false, transparent: true, opacity: 0.8 }),
    );
    this.skeleton.renderOrder = 10;
    this.skeleton.frustumCulled = false;
    this.scene.add(this.skeleton);
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#ffd34d', depthTest: false }),
    );
    this.marker.renderOrder = 11;
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.nav = new CameraNav(this.canvas);
    this.nav.jumpTo(new THREE.Vector3(0, 0.5, 0), 2.4, 0.7, 0.25);
    this.nav.onFocusRequest = () => this.frameModel();
    this.gizmo = new Gizmo(this.scene, this.nav.camera, this.canvas, this.nav);
    this.gizmo.setSpace('local');
    this.gizmo.setTool('rotate');
    this.viewMenu = buildViewMenu(this.nav);
    this.axisGizmo = new AxisGizmo(this.nav);
    this.viewportEl.append(this.axisGizmo.el);
    this.nav.onViewChange = () => {
      this.viewMenu.sync();
      this.gizmo.setCamera(this.nav.camera);
    };

    this.root = this.buildLayout();
    this.root.classList.add('hidden');

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || this.gizmo.hovering || this.gizmo.dragging) {
        this.downAt = null;
        return;
      }
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => this.onViewportClick(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
    new ResizeObserver(() => this.resize()).observe(this.viewportEl);
    store.subscribe((e) => {
      if (e.type === 'project-replaced') {
        this.model = null;
        this.clip = null;
        this.disposeRig();
        if (this.active) this.open(this.preferredModel()?.id ?? null);
      } else if ((e.type === 'model-removed' || e.type === 'model-added') && this.active) {
        if (e.type === 'model-removed' && this.model?.id === e.id) this.open(this.preferredModel()?.id ?? null);
        else this.refreshModelSelect();
      } else if (e.type === 'model-changed' && this.active && this.model?.id === e.id) {
        this.refreshModelSelect(); // a rename in the Models tab
      }
    });
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- public

  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('hidden', !active);
    if (!active) {
      this.playing = false;
      return;
    }
    // the model may have been changed in the Models tab since the last visit
    const keep = this.model && this.store.getModel(this.model.id) ? this.model.id : (this.preferredModel()?.id ?? null);
    this.open(keep);
  }

  /** Open a model. A model without bones is shown with an offer to give it a skeleton. */
  open(modelId: string | null): void {
    const model = modelId ? (this.store.getModel(modelId) ?? null) : null;
    const same = model !== null && this.model === model;
    this.model = model;
    if (!same) {
      this.time = 0;
      this.playing = false;
      this.selectedKey = null;
      this.undoStack = [];
      this.redoStack = [];
    }
    this.stateJson = this.snapshot();
    if (this.model && this.model.bones.length > 0) {
      if (!this.clip || !this.model.clips.includes(this.clip)) this.clip = this.model.clips[0] ?? null;
      if (!this.selectedBone || !this.model.bones.some((b) => b.name === this.selectedBone)) {
        this.selectedBone = this.model.bones.find((b) => /^(Pelvis|Body|Root)$/.test(b.name))?.name ?? this.model.bones[0]?.name ?? null;
      }
    } else {
      this.clip = null;
      this.selectedBone = null;
    }
    this.rebuildRig();
    this.refreshAll();
    if (!same) this.frameModel();
  }

  // ---------------------------------------------------------------- scene

  /** The model to show first: one that already has bones, else the first. */
  private preferredModel(): Model | undefined {
    const models = this.store.project.models;
    return models.find((m) => m.bones.length > 0) ?? models[0];
  }

  private disposeRig(): void {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      this.rig.dispose();
      this.rig = null;
    }
    if (this.stillMesh) {
      this.scene.remove(this.stillMesh);
      this.stillMesh = null;
    }
    this.render = null;
  }

  private rebuildRig(): void {
    this.disposeRig();
    if (!this.model) return;
    this.render = this.library.get(this.model.id);
    if (!this.render) return;
    if (this.model.bones.length > 0) {
      this.rig = new RigRender(this.render, this.render.material);
      this.scene.add(this.rig.root);
    } else {
      this.stillMesh = this.render.createMesh();
      this.scene.add(this.stillMesh);
    }
    this.updateGizmoTarget();
  }

  private frameModel(): void {
    const r = this.render;
    if (!r) return;
    const { min, max } = r.bounds;
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.nav.focus(center, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  }

  private resize(): void {
    const w = Math.max(1, this.viewportEl.clientWidth);
    const h = Math.max(1, this.viewportEl.clientHeight);
    this.renderer.setSize(w, h);
    this.nav.setSize(w, h);
  }

  private currentPose(): Pose {
    return this.clip ? sampleClip(this.clip, this.time) : new Map();
  }

  private parentRotation(boneName: string): THREE.Quaternion {
    const q = new THREE.Quaternion();
    const bone = this.model?.bones.find((b) => b.name === boneName);
    const parent = bone?.parent ? this.model?.bones.find((b) => b.id === bone.parent) : undefined;
    const m = parent ? this.rig?.matrixOf(parent.name) : null;
    if (m) m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    return q;
  }

  private updateOverlays(): void {
    const rig = this.rig;
    const model = this.model;
    if (!rig || !model) {
      this.skeleton.visible = false;
      this.marker.visible = false;
      return;
    }
    const pts: number[] = [];
    for (const b of model.bones) {
      const p = rig.pivotNow(b.name);
      const parent = b.parent ? model.bones.find((x) => x.id === b.parent) : undefined;
      const pp = parent ? rig.pivotNow(parent.name) : null;
      if (p && pp) pts.push(pp.x, pp.y, pp.z, p.x, p.y, p.z);
    }
    this.skeleton.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.skeleton.visible = true;
    const sel = this.selectedBone ? rig.pivotNow(this.selectedBone) : null;
    this.marker.visible = !!sel;
    if (sel) this.marker.position.copy(sel);
  }

  private frame = () => {
    requestAnimationFrame(this.frame);
    if (!this.active) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    // self-heal if the model's render was invalidated by an edit elsewhere
    if (this.model && this.library.get(this.model.id) !== this.render) {
      this.rebuildRig();
      this.refreshAll();
    }
    if (this.playing && this.clip) {
      this.time += dt * this.speed;
      if (this.time >= this.clip.duration) {
        if (this.clip.loop) this.time %= this.clip.duration;
        else {
          this.time = this.clip.duration;
          this.setPlaying(false);
        }
      }
      this.onTimeChanged(false);
    }
    this.rig?.pose(this.currentPose());
    this.nav.update(dt);
    this.updateOverlays();
    this.gizmo.sync();
    this.axisGizmo.draw();
    this.renderer.render(this.scene, this.nav.camera);
  };

  // ---------------------------------------------------------------- selection

  private selectBone(name: string | null): void {
    this.selectedBone = name;
    this.selectedKey = null;
    this.updateGizmoTarget();
    this.refreshBoneList();
    this.buildTimeline();
    this.refreshInspector();
  }

  private onViewportClick(e: PointerEvent): void {
    const down = this.downAt;
    this.downAt = null;
    if (e.button !== 0 || !down || !this.rig) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.nav.camera);
    const hit = this.raycaster.intersectObject(this.rig.root, true)[0];
    const name = hit ? this.rig.boneNameOf(hit.object) : null;
    if (name) this.selectBone(name);
  }

  // ---------------------------------------------------------------- gizmo

  private updateGizmoTarget(): void {
    const name = this.selectedBone;
    this.gizmo.setTool(this.tool);
    this.gizmo.setTarget(name && this.model && this.clip ? this.boneTarget(name) : null);
    this.gizmo.setEnabled(!this.playing && !!this.clip && !!name);
  }

  private boneTarget(boneName: string): TransformTarget {
    let eulerBefore: Vec3 = [0, 0, 0];
    let pos0: Vec3 = [0, 0, 0];
    return {
      allow: { translate: true, rotate: true, scale: false },
      pivot: () => this.rig?.pivotNow(boneName) ?? new THREE.Vector3(),
      orientation: () => this.parentRotation(boneName),
      begin: () => {
        const clip = this.clip;
        if (!clip) return;
        const p = sampleBone(clip, boneName, this.time);
        eulerBefore = p.rot;
        pos0 = p.pos;
      },
      apply: (d) => {
        const clip = this.clip;
        if (!clip) return;
        const t = this.keyTime();
        if (this.tool === 'rotate') {
          const deg = rotateInParent(eulerBefore, this.parentRotation(boneName), d.rotate);
          // (eulerBefore is the start of the drag, so every move event starts from the same pose)
          setKey(clip, boneName, 'rot', t, deg);
        } else {
          const dv = d.translate.clone().applyQuaternion(this.parentRotation(boneName).invert());
          setKey(clip, boneName, 'pos', t, [round3(pos0[0] + dv.x), round3(pos0[1] + dv.y), round3(pos0[2] + dv.z)]);
        }
        this.rig?.pose(this.currentPose());
        this.syncInspectorValues();
      },
      end: () => {
        this.commit('pose');
        this.buildTimeline();
        this.refreshInspector();
      },
    };
  }

  /** The playhead as a key time (always on a frame). */
  private keyTime(): number {
    return this.clip ? Math.min(snapTime(this.time), this.clip.duration) : 0;
  }

  // ---------------------------------------------------------------- history

  /** What an edit can change: the clips, the bones, and which bone each shape belongs to. */
  private snapshot(): string {
    const model = this.model;
    if (!model) return '';
    return JSON.stringify({
      clips: model.clips,
      bones: model.bones,
      cubeBones: Object.fromEntries(model.cubes.map((c) => [c.id, c.bone])),
    });
  }

  private commit(label: string): void {
    if (!this.model) return;
    const after = this.snapshot();
    if (after === this.stateJson) return;
    const now = performance.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (label.startsWith('edit:') && top && top.label === label && now - this.lastCommitAt < 700) {
      top.after = after;
    } else {
      this.undoStack.push({ label, before: this.stateJson, after });
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.redoStack = [];
    this.stateJson = after;
    this.lastCommitAt = now;
    this.updateHistoryButtons();
    this.store.modelChanged(this.model.id, false);
  }

  private restore(snapshot: string): void {
    const model = this.model;
    if (!model) return;
    const id = this.clip?.id;
    const data = JSON.parse(snapshot) as {
      clips: Partial<AnimationClip>[];
      bones: Bone[];
      cubeBones: Record<string, string | null>;
    };
    model.clips = data.clips.map((c) => normalizeClip(c));
    model.bones = data.bones;
    for (const c of model.cubes) c.bone = data.cubeBones[c.id] ?? null;
    this.stateJson = snapshot;
    this.clip = model.clips.find((c) => c.id === id) ?? model.clips[0] ?? null;
    if (this.selectedBone && !model.bones.some((b) => b.name === this.selectedBone)) this.selectedBone = model.bones[0]?.name ?? null;
    this.selectedKey = null;
    this.store.modelChanged(model.id, true);
    this.rebuildRig();
    this.refreshAll();
  }

  private undo(): void {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push(step);
    this.restore(step.before);
    this.updateHistoryButtons();
  }

  private redo(): void {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push(step);
    this.restore(step.after);
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  // ---------------------------------------------------------------- clips

  private uniqueClipName(base: string): string {
    const names = new Set(this.model?.clips.map((c) => c.name));
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  private newClip(): void {
    const model = this.model;
    if (!model) return;
    const clip: AnimationClip = { id: newId(), name: this.uniqueClipName('new_clip'), duration: 1, loop: true, smooth: true, tracks: {} };
    model.clips.push(clip);
    this.clip = clip;
    this.time = 0;
    this.commit('new-clip');
    this.updateGizmoTarget();
    this.refreshAll();
  }

  private duplicateCurrentClip(): void {
    const model = this.model;
    const clip = this.clip;
    if (!model || !clip) return;
    const copy = duplicateClip(clip, newId(), this.uniqueClipName(`${clip.name}_copy`));
    model.clips.push(copy);
    this.clip = copy;
    this.commit('duplicate-clip');
    this.updateGizmoTarget();
    this.refreshAll();
  }

  private deleteCurrentClip(): void {
    const model = this.model;
    const clip = this.clip;
    if (!model || !clip) return;
    if (!confirm(`Delete the animation "${clip.name}"?`)) return;
    model.clips = model.clips.filter((c) => c !== clip);
    this.clip = model.clips[0] ?? null;
    this.selectedKey = null;
    this.commit('delete-clip');
    this.updateGizmoTarget();
    this.refreshAll();
  }

  // ---------------------------------------------------------------- keys

  private addKey(): void {
    const clip = this.clip;
    const bone = this.selectedBone;
    if (!clip || !bone) return;
    const p = sampleBone(clip, bone, this.time);
    const t = this.keyTime();
    setKey(clip, bone, 'rot', t, [...p.rot] as Vec3);
    if (keysOf(clip, bone, 'pos').length > 0 || p.pos.some((v) => Math.abs(v) > 1e-6)) setKey(clip, bone, 'pos', t, [...p.pos] as Vec3);
    this.selectedKey = { bone, channel: 'rot', t };
    this.commit('add-key');
    this.buildTimeline();
    this.refreshInspector();
  }

  private deleteSelectedKey(): void {
    const clip = this.clip;
    const k = this.selectedKey;
    if (!clip || !k) return;
    deleteKey(clip, k.bone, k.channel, k.t);
    this.selectedKey = null;
    this.commit('delete-key');
    this.buildTimeline();
    this.refreshInspector();
  }

  private resetBoneHere(): void {
    const clip = this.clip;
    const bone = this.selectedBone;
    if (!clip || !bone || !clip.tracks[bone]) return;
    const t = this.keyTime();
    setKey(clip, bone, 'rot', t, [0, 0, 0]);
    if (keysOf(clip, bone, 'pos').length > 0) setKey(clip, bone, 'pos', t, [0, 0, 0]);
    this.commit('reset-bone');
    this.buildTimeline();
    this.refreshInspector();
  }

  private copyPose(): void {
    if (!this.clip) return;
    this.clipboard = clipPoseAt(this.clip, this.time);
    this.hint(`Copied the pose of ${this.clipboard.size} bones`);
  }

  private pastePose(mirrored: boolean): void {
    const clip = this.clip;
    if (!clip || !this.clipboard) return;
    applyPose(clip, mirrored ? mirrorPose(this.clipboard) : this.clipboard, this.keyTime());
    this.commit(mirrored ? 'paste-mirrored' : 'paste-pose');
    this.buildTimeline();
    this.refreshInspector();
  }

  private setPlaying(p: boolean): void {
    this.playing = p && !!this.clip;
    this.playBtn.replaceChildren(el('span', { text: this.playing ? '❚❚' : '▶' }));
    this.updateGizmoTarget();
  }

  private setTime(t: number, snap = true): void {
    const clip = this.clip;
    if (!clip) return;
    this.time = Math.min(Math.max(snap ? snapTime(t) : t, 0), clip.duration);
    this.onTimeChanged(true);
  }

  private onTimeChanged(full: boolean): void {
    // `full` is kept for callers that distinguish scrubbing from playback; both update the same widgets
    const clip = this.clip;
    this.timeLabel.textContent = clip ? `${this.time.toFixed(2)} s · frame ${Math.round(this.time / FRAME)}` : '0.00 s';
    if (this.playhead) this.playhead.style.left = `${LABEL_W + this.time * this.pps}px`;
    void full;
    this.syncInspectorValues();
  }

  // ---------------------------------------------------------------- keyboard

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
    if (this.nav.handleKey(e)) return;
    if (this.nav.freelook) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.setPlaying(!this.playing);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.setPlaying(false);
        this.setTime(this.time - FRAME * (e.shiftKey ? 5 : 1));
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.setPlaying(false);
        this.setTime(this.time + FRAME * (e.shiftKey ? 5 : 1));
        break;
      case 'Home':
        this.setTime(0);
        break;
      case 'End':
        if (this.clip) this.setTime(this.clip.duration);
        break;
      case 'KeyK':
        this.addKey();
        break;
      case 'KeyE':
        this.setTool('rotate');
        break;
      case 'KeyW':
        this.setTool('translate');
        break;
      case 'KeyF':
        this.frameModel();
        break;
      case 'Delete':
      case 'Backspace':
        this.deleteSelectedKey();
        break;
      default:
        break;
    }
  }

  private setTool(tool: 'rotate' | 'translate'): void {
    this.tool = tool;
    for (const [id, b] of this.toolButtons) b.classList.toggle('active', id === tool);
    this.updateGizmoTarget();
  }

  private hint(text: string): void {
    this.hintEl.textContent = text;
    window.setTimeout(() => {
      if (this.hintEl.textContent === text) this.hintEl.textContent = this.defaultHint();
    }, 3000);
  }

  private defaultHint(): string {
    return 'Click a bone (or pick it in the list), then drag the gizmo: a key is made at the playhead. Space plays · ←/→ steps a frame · K adds a key · Delete removes the selected key · E rotate · W move';
  }

  // ---------------------------------------------------------------- layout

  private buildLayout(): HTMLElement {
    this.emptyEl.append(
      el('div', { class: 'model-empty-title', text: 'No models yet' }),
      el('div', { class: 'muted', text: 'Make a model in the Models tab (or use the built-in Humanoid), then come back to animate it.' }),
    );
    this.hintEl.textContent = this.defaultHint();

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    this.updateHistoryButtons();

    const toolBtn = (id: 'rotate' | 'translate', ic: 'rotate' | 'move', title: string) => {
      const b = el('button', { class: `tool-btn${id === this.tool ? ' active' : ''}`, title, onclick: () => this.setTool(id) }, icon(ic, 18));
      this.toolButtons.set(id, b);
      return b;
    };
    const snap = el('select', { title: 'Rotation snap' });
    for (const [v, label] of [
      [0, 'Free'],
      [5, 'Snap 5°'],
      [15, 'Snap 15°'],
    ] as const) {
      snap.append(el('option', { value: String(v), text: label }));
    }
    snap.addEventListener('change', () => this.gizmo.setSnap(0, parseFloat(snap.value)));

    const toolbar = el(
      'div',
      { class: 'model-toolbar' },
      el('div', { class: 'tb-group' }, this.viewMenu.el),
      el('div', { class: 'tb-group' }, toolBtn('rotate', 'rotate', 'Rotate the bone (E)'), toolBtn('translate', 'move', 'Move the bone (W)'), snap),
      el('div', { class: 'tb-group' }, this.undoBtn, this.redoBtn),
    );

    this.modelSelect.addEventListener('change', () => this.open(this.modelSelect.value || null));
    const left = el(
      'aside',
      { class: 'panel panel-left' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Model' })),
      el('div', { class: 'panel-toolbar' }, this.modelSelect),
      el('div', { class: 'panel-header' }, el('span', { text: 'Animations' })),
      el(
        'div',
        { class: 'panel-toolbar' },
        el('button', { class: 'btn', text: '+ New', onclick: () => this.newClip() }),
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicateCurrentClip() }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => this.deleteCurrentClip() }),
      ),
      this.clipListEl,
      el('div', { class: 'panel-header' }, el('span', { text: 'Bones' })),
      this.boneListEl,
    );

    const view = el(
      'section',
      { class: 'viewport-wrap' },
      this.viewportEl,
      el('div', { class: 'view-overlay' }, toolbar),
      this.hintEl,
      this.emptyEl,
      this.bannerEl,
    );

    // the lists are rebuilt on every click, so a double-click is caught on the list itself
    this.clipListEl.addEventListener('dblclick', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id]')?.dataset.clipId;
      if (id) this.renameClipInList(id);
    });
    this.boneListEl.addEventListener('dblclick', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-bone-id]')?.dataset.boneId;
      if (id) this.renameBoneInList(id);
    });

    this.timelineEl.append(this.buildTimelineToolbar(), this.tlBody);
    const center = el('div', { class: 'anim-center' }, view, this.timelineEl);

    const right = el('aside', { class: 'panel panel-right' }, el('div', { class: 'panel-header' }, el('span', { text: 'Properties' })), this.inspectorEl);
    const workspace = el('div', { class: 'workspace anim-workspace' }, left, center);
    workspace.append(makeSplitter(workspace, { key: 'polyhop.animRightWidth', min: 280, maxShare: 0.5 }), right);
    return workspace;
  }

  private buildTimelineToolbar(): HTMLElement {
    this.playBtn.append(el('span', { text: '▶' }));
    this.playBtn.addEventListener('click', () => this.setPlaying(!this.playing));

    const speed = el('select', { title: 'Playback speed' });
    for (const v of [0.25, 0.5, 1, 2]) speed.append(el('option', { value: String(v), text: `${v}×`, selected: v === this.speed }));
    speed.addEventListener('change', () => {
      this.speed = parseFloat(speed.value);
    });

    const zoom = el('input', { type: 'range', min: '60', max: '600', value: String(this.pps), title: 'Timeline zoom' });
    zoom.addEventListener('input', () => {
      this.pps = parseFloat(zoom.value);
      this.buildTimeline();
    });

    const only = el('input', { type: 'checkbox', checked: this.onlyAnimated });
    only.addEventListener('change', () => {
      this.onlyAnimated = only.checked;
      this.buildTimeline();
    });

    return el(
      'div',
      { class: 'tl-toolbar' },
      el('button', { class: 'tool-btn', title: 'Back to the start (Home)', onclick: () => this.setTime(0) }, el('span', { text: '⏮' })),
      this.playBtn,
      this.timeLabel,
      speed,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', text: '◆ Key', title: 'Key the selected bone at the playhead (K)', onclick: () => this.addKey() }),
      el('button', { class: 'btn', text: 'Copy pose', title: 'Remember the whole pose at the playhead', onclick: () => this.copyPose() }),
      el('button', { class: 'btn', text: 'Paste', title: 'Write the remembered pose at the playhead', onclick: () => this.pastePose(false) }),
      el('button', { class: 'btn', text: 'Paste ⇄', title: 'Paste mirrored: left and right swapped (the other half of a walk cycle)', onclick: () => this.pastePose(true) }),
      el('label', { class: 'tl-only', title: 'Show only bones that have keys (and the selected one)' }, only, el('span', { text: 'Only animated' })),
      zoom,
    );
  }

  // ---------------------------------------------------------------- panels

  private refreshAll(): void {
    this.refreshModelSelect();
    this.refreshClipList();
    this.refreshBoneList();
    this.buildTimeline();
    this.refreshInspector();
    this.updateHistoryButtons();
    const rigged = !!this.model && this.model.bones.length > 0;
    this.emptyEl.classList.toggle('hidden', !!this.model);
    this.timelineEl.classList.toggle('hidden', !rigged);
    this.refreshBanner();
    this.onTimeChanged(true);
    this.setPlaying(this.playing);
  }

  /** A model without bones is shown as it is, with the offer to give it a skeleton. */
  private refreshBanner(): void {
    clear(this.bannerEl);
    const model = this.model;
    const show = !!model && model.bones.length === 0;
    this.bannerEl.classList.toggle('hidden', !show);
    if (!show || !model) return;
    this.bannerEl.append(
      el('div', { class: 'model-empty-title', text: `“${model.name}” has no bones yet` }),
      el('div', {
        class: 'muted',
        text: 'Animations move bones. Give this model a skeleton and you can pose and animate it right here. You can fine-tune bones later in Models > Rig.',
      }),
      el(
        'div',
        { class: 'button-stack row wrap' },
        el('button', {
          class: 'btn primary',
          text: 'One bone for the whole model',
          title: 'Everything moves together: spinning coins, bobbing platforms',
          onclick: () => this.createBones('single'),
        }),
        el('button', {
          class: 'btn primary',
          text: 'One bone per shape',
          title: 'Every shape gets its own bone, pivoting at the shape’s origin: doors, wheels, flaps',
          onclick: () => this.createBones('per-shape'),
          disabled: model.cubes.length === 0,
        }),
      ),
    );
  }

  private createBones(mode: 'single' | 'per-shape'): void {
    const model = this.model;
    if (!model || model.bones.length > 0 || model.cubes.length === 0) return;
    const made = createSkeleton(model, mode, newId);
    if (model.clips.length === 0) {
      model.clips.push({ id: newId(), name: 'new_clip', duration: 1, loop: true, smooth: true, tracks: {} });
    }
    this.clip = model.clips[0] ?? null;
    this.time = 0;
    this.selectedBone = made[0]?.name ?? null;
    this.commit('create-skeleton');
    // the model's render and every instance of it are rebuilt with the bones
    this.store.modelChanged(model.id, true);
    this.rebuildRig();
    this.refreshAll();
    this.updateGizmoTarget();
    this.frameModel();
  }

  private refreshModelSelect(): void {
    clear(this.modelSelect);
    const models = this.store.project.models;
    for (const m of models) {
      const label = m.bones.length > 0 ? m.name : `${m.name} (no bones yet)`;
      this.modelSelect.append(el('option', { value: m.id, text: label, selected: m.id === this.model?.id }));
    }
    if (models.length === 0) this.modelSelect.append(el('option', { value: '', text: '(no models)' }));
    this.modelSelect.value = this.model?.id ?? '';
  }

  private refreshClipList(): void {
    clear(this.clipListEl);
    const model = this.model;
    if (!model) return;
    if (model.clips.length === 0) {
      this.clipListEl.append(el('div', { class: 'empty muted', text: 'No animations yet. Press + New.' }));
    }
    for (const c of model.clips) {
      this.clipListEl.append(
        el(
          'button',
          {
            class: `tree-item${c === this.clip ? ' selected' : ''}`,
            'data-clip-id': c.id,
            title: 'Double-click to rename',
            onclick: () => {
              this.clip = c;
              this.time = 0;
              this.selectedKey = null;
              this.setPlaying(false);
              this.refreshAll();
              this.updateGizmoTarget();
            },
          },
          el('span', { class: 'tree-icon', text: '▶' }),
          el('span', { class: 'tree-label', text: c.name }),
          el('span', { class: 'tree-count muted', text: `${c.duration.toFixed(1)}s` }),
        ),
      );
    }
  }

  private renameClipInList(id: string): void {
    const model = this.model;
    const clip = model?.clips.find((c) => c.id === id);
    const label = this.clipListEl.querySelector<HTMLElement>(`[data-clip-id="${id}"] .tree-label`);
    if (!model || !clip || !label) return;
    renameInline(label, clip.name, (name) => {
      if (model.clips.some((c) => c !== clip && c.name === name)) {
        this.hint(`There is already an animation called “${name}”`);
        return;
      }
      clip.name = name;
      this.commit('rename-clip');
      this.refreshClipList();
      this.refreshInspector();
    });
  }

  private renameBoneInList(id: string): void {
    const model = this.model;
    const bone = model?.bones.find((b) => b.id === id);
    const label = this.boneListEl.querySelector<HTMLElement>(`[data-bone-id="${id}"] .tree-label`);
    if (!model || !bone || !label) return;
    renameInline(label, bone.name, (name) => {
      const old = bone.name;
      if (!this.store.renameBone(model.id, id, name)) {
        this.hint(`There is already a bone called “${name}”`);
        return;
      }
      if (this.selectedBone === old) this.selectedBone = bone.name;
      if (this.selectedKey?.bone === old) this.selectedKey = { ...this.selectedKey, bone: bone.name };
      this.commit('rename-bone');
      this.updateGizmoTarget();
      this.refreshAll();
    });
  }

  private depthOf(bone: Bone): number {
    let d = 0;
    let cur: Bone | undefined = bone;
    while (cur?.parent && d < 32) {
      cur = this.model?.bones.find((b) => b.id === cur!.parent);
      d++;
    }
    return d;
  }

  /** Bones in tree order: each bone right after its parent. */
  private treeOrder(): Bone[] {
    const model = this.model;
    if (!model) return [];
    const out: Bone[] = [];
    const seen = new Set<string>();
    const add = (b: Bone) => {
      if (seen.has(b.id)) return;
      seen.add(b.id);
      out.push(b);
      for (const c of model.bones) if (c.parent === b.id) add(c);
    };
    for (const b of model.bones) if (!b.parent || !model.bones.some((p) => p.id === b.parent)) add(b);
    for (const b of model.bones) add(b);
    return out;
  }

  private refreshBoneList(): void {
    clear(this.boneListEl);
    for (const b of this.treeOrder()) {
      const animated = !!this.clip?.tracks[b.name];
      const item = el(
        'button',
        {
          class: `tree-item${b.name === this.selectedBone ? ' selected' : ''}`,
          'data-bone-id': b.id,
          title: 'Double-click to rename',
          onclick: () => this.selectBone(b.name),
        },
        el('span', { class: 'tree-icon', text: animated ? '◆' : '·' }),
        el('span', { class: 'tree-label', text: b.name }),
      );
      item.style.paddingLeft = `${8 + this.depthOf(b) * 10}px`;
      this.boneListEl.append(item);
    }
  }

  // ---------------------------------------------------------------- timeline

  private visibleBones(): Bone[] {
    const clip = this.clip;
    return this.treeOrder().filter((b) => !this.onlyAnimated || b.name === this.selectedBone || !!clip?.tracks[b.name]);
  }

  private buildTimeline(): void {
    clear(this.tlBody);
    this.playhead = null;
    const clip = this.clip;
    if (!clip || !this.model) {
      this.tlBody.append(el('div', { class: 'empty muted', text: 'Pick or create an animation on the left.' }));
      return;
    }
    const pps = this.pps;
    const width = clip.duration * pps;
    const content = el('div', { class: 'tl-content' });
    content.style.width = `${LABEL_W + width + 30}px`;

    // ruler
    const ruler = el('div', { class: 'tl-ruler' });
    const corner = el('div', { class: 'tl-label tl-corner', text: clip.name });
    const rulerTrack = el('div', { class: 'tl-track tl-ruler-track' });
    rulerTrack.style.width = `${width + 30}px`;
    const major = pps >= 300 ? 0.1 : pps >= 120 ? 0.25 : 0.5;
    for (let t = 0; t <= clip.duration + 1e-6; t += major) {
      const tick = el('div', { class: 'tl-tick', text: `${Math.round(t * 100) / 100}` });
      tick.style.left = `${t * pps}px`;
      rulerTrack.append(tick);
    }
    const scrub = (e: PointerEvent, rect: DOMRect) => this.setTime((e.clientX - rect.left) / pps);
    rulerTrack.addEventListener('pointerdown', (e) => {
      this.setPlaying(false);
      const rect = rulerTrack.getBoundingClientRect();
      rulerTrack.setPointerCapture(e.pointerId);
      scrub(e, rect);
      const move = (ev: PointerEvent) => scrub(ev, rect);
      const up = () => {
        rulerTrack.removeEventListener('pointermove', move);
        rulerTrack.removeEventListener('pointerup', up);
      };
      rulerTrack.addEventListener('pointermove', move);
      rulerTrack.addEventListener('pointerup', up);
    });
    ruler.append(corner, rulerTrack);
    content.append(ruler);

    // rows
    for (const bone of this.visibleBones()) {
      const track = el('div', { class: 'tl-track' });
      track.style.width = `${width + 30}px`;
      const label = el('div', { class: 'tl-label', text: bone.name, title: bone.name, onclick: () => this.selectBone(bone.name) });
      label.style.paddingLeft = `${8 + this.depthOf(bone) * 8}px`;
      const row = el('div', { class: `tl-row${bone.name === this.selectedBone ? ' selected' : ''}` }, label, track);
      track.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).classList.contains('tl-key')) return;
        if (bone.name !== this.selectedBone) {
          this.selectedBone = bone.name;
          this.selectedKey = null;
          this.updateGizmoTarget();
          this.refreshBoneList();
          for (const r of content.querySelectorAll('.tl-row')) r.classList.toggle('selected', r === row);
          this.refreshInspector();
        }
        this.setPlaying(false);
        this.setTime((e.clientX - track.getBoundingClientRect().left) / pps);
      });
      for (const channel of ['rot', 'pos'] as const) {
        for (const k of keysOf(clip, bone.name, channel)) {
          const sel = this.selectedKey;
          const isSel = !!sel && sel.bone === bone.name && sel.channel === channel && Math.abs(sel.t - k.t) < 1e-4;
          const key = el('div', { class: `tl-key ${channel}${isSel ? ' selected' : ''}`, title: `${bone.name} ${channel === 'rot' ? 'rotation' : 'position'} · ${k.t.toFixed(2)} s` });
          key.style.left = `${k.t * pps}px`;
          this.wireKey(key, bone.name, channel, k.t, track);
          track.append(key);
        }
      }
      content.append(row);
    }

    const ph = el('div', { class: 'tl-playhead' });
    ph.style.left = `${LABEL_W + this.time * pps}px`;
    content.append(ph);
    this.playhead = ph;
    this.tlBody.append(content);
  }

  private wireKey(key: HTMLElement, bone: string, channel: Channel, t: number, track: HTMLElement): void {
    key.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.selectedKey = { bone, channel, t };
      if (bone !== this.selectedBone) {
        this.selectedBone = bone;
        this.updateGizmoTarget();
        this.refreshBoneList();
      }
      for (const k of this.tlBody.querySelectorAll('.tl-key')) k.classList.toggle('selected', k === key);
      this.refreshInspector();
      this.setPlaying(false);
      this.setTime(t, false);

      const clip = this.clip;
      if (!clip) return;
      const rect = track.getBoundingClientRect();
      key.setPointerCapture(e.pointerId);
      let moved = t;
      const move = (ev: PointerEvent) => {
        moved = Math.min(Math.max(snapTime((ev.clientX - rect.left) / this.pps), 0), clip.duration);
        key.style.left = `${moved * this.pps}px`;
      };
      const up = () => {
        key.removeEventListener('pointermove', move);
        key.removeEventListener('pointerup', up);
        if (Math.abs(moved - t) > 1e-4) {
          const final = moveKey(clip, bone, channel, t, moved);
          this.selectedKey = { bone, channel, t: final };
          this.commit('move-key');
          this.setTime(final, false);
        }
        this.buildTimeline();
        this.refreshInspector();
      };
      key.addEventListener('pointermove', move);
      key.addEventListener('pointerup', up);
    });
  }

  // ---------------------------------------------------------------- properties

  private refreshInspector(): void {
    clear(this.inspectorEl);
    this.rotInputs = [];
    this.posInputs = [];
    const clip = this.clip;
    const model = this.model;
    if (!model) return;
    if (model.bones.length === 0) {
      this.inspectorEl.append(el('div', { class: 'empty muted', text: 'This model has no bones yet. Give it a skeleton to animate it.' }));
      return;
    }
    const row = (label: string, control: HTMLElement, title?: string) =>
      el('label', { class: 'form-row', title: title ?? '' }, el('span', { class: 'form-label', text: label }), el('span', { class: 'form-control' }, control));

    // ---- clip
    if (!clip) {
      this.inspectorEl.append(el('div', { class: 'empty muted', text: 'Create an animation (+ New) to start.' }));
    } else {
      const name = el('input', { type: 'text', value: clip.name });
      name.addEventListener('change', () => {
        const n = name.value.trim();
        if (!n || model.clips.some((c) => c !== clip && c.name === n)) {
          name.value = clip.name;
          return;
        }
        clip.name = n;
        this.commit('rename-clip');
        this.refreshClipList();
      });
      const duration = el('input', { type: 'number', value: String(clip.duration), step: '0.1', min: '0.1' });
      duration.addEventListener('change', () => {
        const d = parseFloat(duration.value);
        if (!Number.isFinite(d) || d <= 0) {
          duration.value = String(clip.duration);
          return;
        }
        scaleDuration(clip, d);
        this.time = Math.min(this.time, clip.duration);
        this.commit('duration');
        this.buildTimeline();
        this.refreshClipList();
      });
      const loop = el('input', { type: 'checkbox', checked: clip.loop });
      loop.addEventListener('change', () => {
        clip.loop = loop.checked;
        if (clip.loop) {
          // a loop needs an end: where there is none, it ends where it starts
          for (const [bone, track] of Object.entries(clip.tracks)) {
            for (const ch of ['rot', 'pos'] as const) {
              const keys = track[ch];
              const first = keys?.[0];
              if (first && !keyAt(clip, bone, ch, clip.duration)) setKey(clip, bone, ch, clip.duration, [...first.v] as Vec3);
            }
          }
        }
        this.commit('loop');
        this.buildTimeline();
      });
      const smooth = el('input', { type: 'checkbox', checked: clip.smooth === true });
      smooth.addEventListener('change', () => {
        clip.smooth = smooth.checked;
        this.commit('smooth');
      });
      this.inspectorEl.append(
        el('div', { class: 'section-title', text: 'Animation' }),
        el(
          'div',
          { class: 'form' },
          row('Name', name, 'Idle, walk, run, jump, fall, crouch and crouch_walk are played by the player'),
          row('Duration', duration, 'Seconds. Changing it stretches the keys'),
          row('Loop', loop, 'Wraps around. The last key follows the first until you give it its own value (a spin ends at 360°)'),
          row('Smooth', smooth, 'Curves through the keys instead of straight lines'),
        ),
      );
    }

    // ---- bone
    const boneName = this.selectedBone;
    const bone = model.bones.find((b) => b.name === boneName);
    if (!boneName || !bone) return;

    this.inspectorEl.append(el('div', { class: 'section-title', text: `Bone · ${boneName}` }));
    if (clip) {
      const mk = (channel: Channel, axis: number, step: number) => {
        const input = el('input', { type: 'number', step: String(step) });
        input.addEventListener('change', () => this.onValueInput(boneName, channel));
        (channel === 'rot' ? this.rotInputs : this.posInputs)[axis] = input;
        return input;
      };
      const vec = (channel: Channel, step: number) => {
        const wrap = el('span', { class: 'form-control vec3' });
        (['X', 'Y', 'Z'] as const).forEach((a, i) => {
          wrap.append(el('span', { class: `axis axis-${a.toLowerCase()}`, text: a }), mk(channel, i, step));
        });
        return wrap;
      };
      this.inspectorEl.append(
        el(
          'div',
          { class: 'form' },
          el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Rotation (°)' }), vec('rot', 1)),
          el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Position (m)' }), vec('pos', 0.01)),
        ),
        this.keyInfoEl,
        el(
          'div',
          { class: 'button-stack row wrap' },
          el('button', { class: 'btn', text: '◆ Key here', onclick: () => this.addKey() }),
          el('button', { class: 'btn', text: 'Reset here', title: 'Key the rest pose at the playhead', onclick: () => this.resetBoneHere() }),
          el('button', { class: 'btn danger', text: 'Delete key', disabled: !this.selectedKey, onclick: () => this.deleteSelectedKey() }),
        ),
      );
    }

    // pivot: where the bone turns, in the rest pose (a door turns about its hinge, not its middle)
    const pivotInputs: HTMLInputElement[] = [];
    const pivotWrap = el('span', { class: 'form-control vec3' });
    (['X', 'Y', 'Z'] as const).forEach((a, i) => {
      const input = el('input', { type: 'number', step: '0.01', value: String(round3(bone.pivot[i]!)) });
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) {
          input.value = String(round3(bone.pivot[i]!));
          return;
        }
        bone.pivot = bone.pivot.map((n, k) => (k === i ? v : n)) as Vec3;
        this.commit('edit:pivot');
      });
      pivotInputs.push(input);
      pivotWrap.append(el('span', { class: `axis axis-${a.toLowerCase()}`, text: a }), input);
    });
    const setPivot = (where: 'center' | 'top' | 'bottom') => {
      const p = boneAnchor(model, bone.id, where);
      if (!p) return;
      bone.pivot = p;
      pivotInputs.forEach((input, i) => (input.value = String(round3(p[i]!))));
      this.commit('pivot');
    };
    const hasShapes = model.cubes.some((c) => c.bone === bone.id);
    this.inspectorEl.append(
      el(
        'div',
        { class: 'form' },
        el('label', { class: 'form-row', title: 'The joint this bone turns around (rest pose). Existing keys keep their angles.' }, el('span', { class: 'form-label', text: 'Pivot (m)' }), pivotWrap),
      ),
      el(
        'div',
        { class: 'button-stack row wrap' },
        el('button', { class: 'btn', text: 'Pivot: center', disabled: !hasShapes, onclick: () => setPivot('center') }),
        el('button', { class: 'btn', text: 'top', disabled: !hasShapes, title: 'Top-middle of this bone’s shapes (a hinge at the top)', onclick: () => setPivot('top') }),
        el('button', { class: 'btn', text: 'bottom', disabled: !hasShapes, title: 'Bottom-middle of this bone’s shapes (a standing figure’s feet)', onclick: () => setPivot('bottom') }),
      ),
    );
    this.syncInspectorValues();
  }

  /** Show the selected bone's pose at the playhead in the inputs (not while one is being typed in). */
  private syncInspectorValues(): void {
    const clip = this.clip;
    const bone = this.selectedBone;
    if (!clip || !bone) return;
    const p = sampleBone(clip, bone, this.time);
    const active = document.activeElement;
    this.rotInputs.forEach((input, i) => {
      if (input !== active) input.value = String(round3(p.rot[i]!));
    });
    this.posInputs.forEach((input, i) => {
      if (input !== active) input.value = String(round3(p.pos[i]!));
    });
    const t = this.keyTime();
    const onKey = keyAt(clip, bone, 'rot', t) || keyAt(clip, bone, 'pos', t);
    this.keyInfoEl.textContent = onKey ? `Keyed at ${t.toFixed(2)} s` : `Between keys at ${this.time.toFixed(2)} s (editing makes a key)`;
  }

  private onValueInput(bone: string, channel: Channel): void {
    const clip = this.clip;
    if (!clip) return;
    const inputs = channel === 'rot' ? this.rotInputs : this.posInputs;
    const cur = sampleBone(clip, bone, this.time)[channel];
    const v = inputs.map((input, i) => {
      const n = parseFloat(input.value);
      return Number.isFinite(n) ? n : cur[i]!;
    }) as Vec3;
    setKey(clip, bone, channel, this.keyTime(), v);
    this.commit('edit:value');
    this.buildTimeline();
    this.syncInspectorValues();
  }
}
