import * as THREE from 'three';
import { type Pose, blendPoses, sampleClip } from '../core/rig';
import type { AnimationClip, Model, PlayerAttachment, PlayerSettings } from '../core/types';
import type { ModelLibrary, ModelRender } from './modelRender';
import { RigRender } from './rigRender';
import type { TextureLibrary } from './textures';

/** What the animation state machine needs to know about the player. */
export interface Motion {
  grounded: boolean;
  crouching: boolean;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Vertical speed, m/s. */
  vy: number;
  /** Gliding down with the jump button held. */
  gliding?: boolean;
  /** In water. */
  swimming?: boolean;
}

export const IDLE_MOTION: Motion = { grounded: true, crouching: false, speed: 0, vy: 0 };

export interface AnimationChoice {
  clip: 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'glide' | 'swim' | 'crouch' | 'crouch_walk';
  /** Playback speed multiplier (a faster walk plays its cycle faster). */
  rate: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Which clip fits the player right now. */
export function chooseAnimation(m: Motion, p: Pick<PlayerSettings, 'walkSpeed' | 'runSpeed' | 'crouchSpeed'>): AnimationChoice {
  if (m.swimming) return { clip: 'swim', rate: clamp(0.6 + m.speed / 5, 0.6, 1.5) };
  if (m.crouching && m.grounded) {
    return m.speed > 0.3 ? { clip: 'crouch_walk', rate: clamp(m.speed / Math.max(p.crouchSpeed, 0.1), 0.6, 1.6) } : { clip: 'crouch', rate: 1 };
  }
  if (!m.grounded) return { clip: m.gliding ? 'glide' : m.vy > 0 ? 'jump' : 'fall', rate: 1 };
  if (m.speed < 0.25) return { clip: 'idle', rate: 1 };
  const split = (p.walkSpeed + p.runSpeed) / 2;
  if (m.speed <= split) return { clip: 'walk', rate: clamp(m.speed / Math.max(p.walkSpeed, 0.1), 0.5, 1.8) };
  return { clip: 'run', rate: clamp(m.speed / Math.max(p.runSpeed, 0.1), 0.6, 1.6) };
}

/** Scale that makes a model of `modelHeight` as tall as the player; 1 for a flat or empty model. */
export function heightFitScale(modelHeight: number, playerHeight: number): number {
  return modelHeight > 0.05 && playerHeight > 0 ? playerHeight / modelHeight : 1;
}

const FADE = 0.14; // seconds to blend from one clip to the next
const CYCLES = new Set(['walk', 'run', 'crouch_walk']);

/**
 * The player's body on screen. Shows the chosen model: a rigged one is animated from its clips and
 * can carry a skin (another texture with the same layout) and attachments; a plain model is shown
 * as it is. All of it hangs under `root`, whose origin is the player's feet.
 */
export class Avatar {
  readonly root = new THREE.Group();

  private render: ModelRender | null = null;
  private rig: RigRender | null = null;
  private mesh: THREE.Mesh | null = null;
  private skinMaterial: THREE.MeshLambertMaterial | null = null;
  private skinTexture: THREE.Texture | null = null;
  private attachmentMeshes: THREE.Mesh[] = [];
  private attachKey = '';
  private attachRenders: (ModelRender | null)[] = [];

  /** Uniform scale that makes the shown model as tall as the player's Height. */
  fitScale = 1;

  private current: { clip: AnimationClip; time: number } | null = null;
  private previous: { clip: AnimationClip; time: number } | null = null;
  private blend = 1;

  constructor(
    private models: ModelLibrary,
    private textures: TextureLibrary,
  ) {}

  /** A model is shown (so the placeholder cube is hidden). */
  get present(): boolean {
    return this.render !== null;
  }

  /** The shown model has a skeleton. */
  get rigged(): boolean {
    return this.rig !== null;
  }

  get model(): Model | null {
    return this.render?.model ?? null;
  }

  /** Bring the shown model, skin and attachments in line with the player settings. */
  sync(player: PlayerSettings): void {
    const render = player.modelId ? this.models.get(player.modelId) : null;
    // the model is drawn as tall as the player is (Height in the player settings); a flat or empty
    // model is left at its own size
    this.fitScale = heightFitScale(render ? render.bounds.max[1] - render.bounds.min[1] : 0, player.height);
    const skinTex = player.skin ? (this.textures.get(player.skin)?.texture ?? null) : null;
    const attachRenders = player.attachments.map((a) => this.models.get(a.modelId));
    const key = JSON.stringify(player.attachments);
    const same =
      render === this.render &&
      skinTex === this.skinTexture &&
      key === this.attachKey &&
      attachRenders.length === this.attachRenders.length &&
      attachRenders.every((r, i) => r === this.attachRenders[i]);
    if (same) return;
    this.rebuild(render, skinTex, player.attachments, attachRenders);
    this.attachKey = key;
    this.attachRenders = attachRenders;
  }

  private clear(): void {
    this.root.clear();
    this.rig?.dispose();
    this.rig = null;
    this.mesh = null;
    this.skinMaterial?.dispose();
    this.skinMaterial = null;
    this.attachmentMeshes = [];
    this.current = null;
    this.previous = null;
    this.blend = 1;
  }

  private rebuild(render: ModelRender | null, skinTex: THREE.Texture | null, attachments: PlayerAttachment[], attachRenders: (ModelRender | null)[]): void {
    this.clear();
    this.render = render;
    this.skinTexture = skinTex;
    if (!render) return;

    const model = render.model;
    if (model.bones.length === 0) {
      this.mesh = render.createMesh();
      this.root.add(this.mesh);
      return;
    }

    let material: THREE.Material = render.material;
    if (skinTex) {
      this.skinMaterial = new THREE.MeshLambertMaterial({ map: skinTex, alphaTest: 0.5, side: THREE.DoubleSide });
      material = this.skinMaterial;
    }
    this.rig = new RigRender(render, material);
    this.root.add(this.rig.root);

    attachments.forEach((a, i) => {
      const r = attachRenders[i];
      const group = this.rig!.groupOf(a.bone);
      const pivot = this.rig!.pivotOf(a.bone);
      if (!r || !group || !pivot) return;
      const mesh = r.createMesh();
      mesh.position.set(pivot[0] + a.offset[0], pivot[1] + a.offset[1], pivot[2] + a.offset[2]);
      mesh.rotation.set((a.rotation[0] * Math.PI) / 180, (a.rotation[1] * Math.PI) / 180, (a.rotation[2] * Math.PI) / 180, 'XYZ');
      mesh.scale.setScalar(a.scale);
      mesh.frustumCulled = false;
      group.add(mesh);
      this.attachmentMeshes.push(mesh);
    });
  }

  /** Advance the animation by `dt` seconds. */
  update(dt: number, motion: Motion, player: Pick<PlayerSettings, 'walkSpeed' | 'runSpeed' | 'crouchSpeed'>): void {
    const rig = this.rig;
    if (!rig) return;
    const choice = chooseAnimation(motion, player);
    // looked up every frame so clips edited, added or renamed in the animation editor apply at once
    const clips = this.render?.model.clips ?? [];
    const clip =
      clips.find((c) => c.name === choice.clip) ??
      (choice.clip === 'glide' || choice.clip === 'swim' ? clips.find((c) => c.name === 'fall') : undefined) ??
      clips.find((c) => c.name === 'idle') ??
      null;
    if (clip && clip !== this.current?.clip) this.switchTo(clip);

    const pose = this.currentPose(dt, choice.rate);
    rig.pose(pose);
  }

  private switchTo(clip: AnimationClip): void {
    const cur = this.current;
    this.previous = cur ? { ...cur } : null;
    // walk <-> run keep the stride phase so the feet do not jump
    const phase = cur && CYCLES.has(cur.clip.name) && CYCLES.has(clip.name) ? (cur.time % cur.clip.duration) / cur.clip.duration : 0;
    this.current = { clip, time: phase * clip.duration };
    this.blend = this.previous ? 0 : 1;
  }

  private currentPose(dt: number, rate: number): Pose {
    const cur = this.current;
    if (!cur) return new Map();
    cur.time += dt * rate;
    if (this.previous) this.previous.time += dt * rate;
    const to = sampleClip(cur.clip, cur.time);
    if (this.blend >= 1 || !this.previous) return to;
    this.blend = Math.min(1, this.blend + dt / FADE);
    const w = this.blend * this.blend * (3 - 2 * this.blend);
    if (this.blend >= 1) this.previous = null;
    return this.previous ? blendPoses(sampleClip(this.previous.clip, this.previous.time), to, w) : to;
  }

  /** Rest pose (used by the model editor and for a still frame). */
  resetPose(): void {
    this.rig?.pose(new Map());
  }

  dispose(): void {
    this.clear();
    this.render = null;
  }
}
