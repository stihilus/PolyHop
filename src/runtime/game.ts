import * as THREE from 'three';
import { meshBounds } from '../core/mesh';
import type { LevelData, LevelObject, Project, Vec3 } from '../core/types';
import { keyLabel } from '../core/keys';
import { Avatar, IDLE_MOTION, type Motion } from './avatar';
import { AudioEngine } from './audio';
import { Hud } from './hud';
import { type LogicEffect, LogicRuntime, triggerBox } from './logic';
import { CameraRig, MOUSE_RAD_PER_PIXEL } from './cameraRig';
import { Input } from './input';
import { Typewriter, VoiceBlips } from './typewriter';
import type { TouchSource } from './touch';
import { Level, buildColliders } from './level';
import { ModelLibrary } from './modelRender';
import { type Colliders, NO_COLLIDERS, meshGroundBelow } from './collision';
import { type Box, groundHeightBelow } from './physics';
import { type Action, DEFAULT_TEXT_SPEED, SILENT_VOICE } from '../core/logic';
import { SOUND_IDS } from '../core/sounds';
import { PlayerController } from './player';
import type { TextureLibrary } from './textures';

const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.1;
/** The player never reaches further than this (m) within one frame, so what is nearer is all that counts. */
const NEAR_RADIUS = 8;

/** The colliders that lie within `radius` of a point on the ground plane. */
export function collidersNear(c: Colliders, x: number, z: number, radius: number): Colliders {
  return {
    boxes: c.boxes.filter((b) => b.maxX >= x - radius && b.minX <= x + radius && b.maxZ >= z - radius && b.minZ <= z + radius),
    meshes: c.meshes.filter((m) => m.max[0] >= x - radius && m.min[0] <= x + radius && m.max[2] >= z - radius && m.min[2] <= z + radius),
    liquids: c.liquids,
  };
}

/** An object walking toward the player. */
interface Chaser {
  speed: number;
  range: number;
  /** Vertical speed while it falls. */
  vy: number;
}

/** What a character sounds like while the words appear. */
interface TalkVoice {
  /** Sound id, or null for a character that makes no sound. */
  sound: string | null;
  pitch: number;
  /** Letters per second; 0 shows a line at once. */
  speed: number;
}

/** How far below the lowest thing in a level the player may fall before going back to the checkpoint. */
const FALL_MARGIN = 30;

/** The lowest point of what a level is made of (blocks by their mesh, models by their feet). */
export function levelFloor(objects: LevelObject[]): number {
  let low = Infinity;
  for (const o of objects) {
    if (o.kind === 'block') low = Math.min(low, o.position[1] + meshBounds(o.mesh).min[1]);
    else low = Math.min(low, o.position[1]);
  }
  return Number.isFinite(low) ? low : 0;
}

interface Talk {
  objectId: string;
  speaker: string;
  lines: string[];
  index: number;
  /** A question: the answers and what each does. */
  options?: { label: string; actions: Action[] }[];
  /** The answer that is marked (a button picks it). */
  selected?: number;
  voice: TalkVoice;
  /** The line being shown and the sounds that go with it. */
  typer?: Typewriter;
  blips?: VoiceBlips | null;
}

/** A rule is sliding an object from one place to another. */
interface Move {
  id: string;
  from: Vec3;
  to: Vec3;
  t: number;
  duration: number;
  /** Go back and forth for ever (a moving platform) instead of stopping at `to`. */
  pingpong: boolean;
}

export interface GameStats {
  speed: number;
  grounded: boolean;
  crouching: boolean;
  pos: [number, number, number];
}

/**
 * Owns everything that makes up the running game inside a Three.js scene: the level meshes, the
 * player (a placeholder cube), the controller, the camera rig and input. The editor and the exported
 * player both use this class; only the editor knows about selection, gizmos and panels.
 */
export class Game {
  readonly level: Level;
  readonly models: ModelLibrary;
  readonly playerGroup = new THREE.Group();
  readonly playerBody: THREE.Mesh;
  controller: PlayerController;
  readonly rig = new CameraRig();
  playing = false;
  /** Gameplay is frozen (the exported player shows a pause screen). */
  paused = false;

  private input: Input;
  /** Phone controls are in use: hints say "Use" and "Tap" instead of naming keys. */
  touchMode = false;
  private colliders: Colliders = NO_COLLIDERS;
  private eyes: THREE.Mesh[] = [];
  private avatar: Avatar;
  /** Game logic of the level (variables, rules) and its on-screen display. */
  readonly logic = new LogicRuntime();
  /** Sound effects and music. Created empty; the project's sounds are handed over when play starts. */
  readonly audio = new AudioEngine();
  private hud: Hud | null = null;
  private hudParent: HTMLElement | null;
  /** Objects taken away by rules during this run (coins collected, doors opened). */
  private removed = new Set<string>();
  private checkpoint: [number, number, number] | null = null;
  /** The level shown (editing) or played; an index into `project.levels`. */
  private levelIndex = 0;
  /** The level where this run began (the "restart" action and the end screen go back there). */
  private runStartLevel = 0;
  /** While playing: a copy of the level's objects, because rules move and change them. */
  private live: LevelObject[] | null = null;
  private moves: Move[] = [];
  /** Objects that walk toward the player (set by "Chase the player"). */
  private chasers = new Map<string, Chaser>();
  /** Seconds the player cannot be hurt again; the body blinks meanwhile. */
  private invulnerable = 0;
  private clock = 0;
  /** A conversation in progress: gameplay waits, Interact / Jump / a click reads on. */
  private talking: Talk | null = null;
  /** Below this height the player has left the world and is put back at the checkpoint. */
  private fallLimit = -80;
  /** Colliders of everything that is not moving right now. */
  private staticColliders: Colliders = NO_COLLIDERS;
  /** The game reached an end screen; gameplay is frozen. */
  ended = false;
  /** Extra buttons of the end screen next to "Play again" (the editor adds "Back to editor"). */
  endActions: { label: string; run: () => void }[] = [];
  /** A level is now shown or played (the embedder sets the sky). */
  onLevelShown?: (level: LevelData) => void;
  /** A conversation was closed (the embedder may take the mouse back). */
  onDialogueEnd?: () => void;
  /** "Play again" was pressed (a click, so the embedder can take the mouse again). */
  onRestart?: () => void;
  /** Guards against levels that send the player on to each other forever within one frame. */
  private depth = 0;
  private shadow: THREE.Mesh;
  private bodyMat: THREE.MeshLambertMaterial;
  private visualHeight = 1;
  private accumulator = 0;
  private pendingJump = false;
  private project!: Project;

  constructor(
    scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private textures: TextureLibrary,
    project: Project,
  ) {
    this.models = new ModelLibrary((id) => this.project.models.find((m) => m.id === id), textures);
    this.level = new Level(textures, this.models);
    scene.add(this.level.group);
    this.avatar = new Avatar(this.models, textures);

    this.bodyMat = new THREE.MeshLambertMaterial({ color: project.player.color });
    this.playerBody = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.bodyMat);
    this.playerBody.name = 'Player';
    this.playerGroup.add(this.playerBody);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1b1b24' });
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), eyeMat);
      this.eyes.push(eye);
      this.playerGroup.add(eye);
    }
    this.playerGroup.add(this.avatar.root);
    scene.add(this.playerGroup);

    const shadowGeo = new THREE.CircleGeometry(0.5, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(
      shadowGeo,
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);

    this.input = new Input(canvas);
    this.hudParent = canvas.parentElement;
    this.controller = new PlayerController(project.player);
    this.load(project);
  }

  /** (Re)load a whole project: rebuilds the level and puts the player at spawn. */
  load(project: Project, levelIndex = 0): void {
    this.project = project;
    this.removed.clear();
    this.moves = [];
    this.live = null;
    this.ended = false;
    this.hud?.hide();
    this.textures.dropProjectCache();
    this.models.clear();
    this.controller = new PlayerController(project.player);
    this.levelIndex = Math.min(Math.max(0, levelIndex), project.levels.length - 1);
    this.level.rebuild(this.objects());
    this.refreshColliders();
    this.resetPlayer();
    this.onLevelShown?.(project.levels[this.levelIndex]!);
  }

  /** The level the editor wants to see (not while playing). */
  showLevel(index: number): void {
    if (this.playing) return;
    this.levelIndex = Math.min(Math.max(0, index), this.project.levels.length - 1);
    this.level.rebuild(this.objects());
    this.refreshColliders();
    this.resetPlayer();
    this.onLevelShown?.(this.project.levels[this.levelIndex]!);
  }

  get currentLevelIndex(): number {
    return this.levelIndex;
  }

  /** The objects of the level in play (the working copy) or in the editor. */
  private objects(): LevelObject[] {
    return this.live ?? this.project.levels[this.levelIndex]!.objects;
  }

  private getModel = (id: string) => this.project.models.find((m) => m.id === id);

  /** Colliders of the objects now (call after the level's objects changed in the editor). */
  /** Ids of objects that change place by themselves; they are collided separately, every frame. */
  private dynamicIds(): Set<string> {
    const ids = new Set(this.moves.map((m) => m.id));
    for (const id of this.chasers.keys()) ids.add(id);
    return ids;
  }

  refreshColliders(): void {
    const moving = this.dynamicIds();
    this.staticColliders = buildColliders(
      this.objects().filter((o) => !this.removed.has(o.id) && !moving.has(o.id)),
      this.getModel,
    );
    this.updateMovingColliders();
  }

  /** The things that are sliding right now are collided at their current place, every frame. */
  private updateMovingColliders(): void {
    const moving = this.dynamicIds();
    if (moving.size === 0) {
      this.colliders = this.staticColliders;
      return;
    }
    const dynamic = buildColliders(this.objects().filter((o) => moving.has(o.id) && !this.removed.has(o.id)), this.getModel);
    this.colliders = {
      boxes: [...this.staticColliders.boxes, ...dynamic.boxes],
      meshes: [...this.staticColliders.meshes, ...dynamic.meshes],
      liquids: [...this.staticColliders.liquids, ...dynamic.liquids],
    };
  }

  /** Put the controller's spawn point where the shown level has it. */
  private syncSpawn(): void {
    const data = this.project.levels[this.levelIndex]!;
    this.controller.spawn = [data.spawn[0], data.spawn[1], data.spawn[2]];
    this.controller.spawnYaw = data.spawnYaw;
  }

  resetPlayer(): void {
    this.syncSpawn();
    this.controller.reset();
    this.visualHeight = this.controller.height;
    this.bodyMat.color.set(this.project.player.color);
    this.syncVisual(0);
  }

  /**
   * Get the sounds ready while the start screen is up, so the music (a long tune takes about half a second to
   * make) does not make the game stutter when Play is pressed.
   */
  prepareAudio(): void {
    this.audio.setSounds(this.project.sounds, this.project.settings.volume);
    this.audio.preload(this.project.settings.music);
  }

  /** Start playing at a level (the one shown by default): the game, the variables and the music from the top. */
  startPlay(levelIndex = this.levelIndex): void {
    this.playing = true;
    this.paused = false;
    this.input.attach();
    this.input.clear();
    this.audio.setSounds(this.project.sounds, this.project.settings.volume);
    this.audio.resume();
    this.audio.playMusic(this.project.settings.music);
    this.hud ??= this.hudParent ? new Hud(this.hudParent) : null;
    this.runStartLevel = Math.min(Math.max(0, levelIndex), this.project.levels.length - 1);
    this.depth = 0;
    this.beginRun();
  }

  /** A fresh run from the level it began at. Also what "Play again" and the restart action do. */
  private beginRun(): void {
    this.hud?.hideEnd();
    this.ended = false;
    this.enterLevel(this.runStartLevel, true);
  }

  /** "Play again" on the end screen. */
  restartRun(): void {
    if (!this.playing) return;
    this.depth = 0;
    this.beginRun();
    this.onRestart?.();
  }

  /**
   * Put a level into play: a working copy of its objects, the player at its spawn, its rules armed.
   * Variables carry over from the level before unless `newRun`.
   */
  private enterLevel(index: number, newRun: boolean): void {
    this.levelIndex = index;
    const data = this.project.levels[index]!;
    this.live = structuredClone(data.objects);
    this.fallLimit = levelFloor(this.live) - FALL_MARGIN;
    this.removed.clear();
    this.moves = [];
    this.chasers.clear();
    this.talking = null;
    this.hud?.hideDialogue();
    this.invulnerable = 0;
    this.checkpoint = null;
    // a running game draws what never changes in a few big batches
    this.level.rebuild(this.live, true);
    this.refreshColliders();
    this.resetPlayer();
    this.onLevelShown?.(data);
    this.rig.reset(this.controller.facing);
    this.accumulator = 0;
    this.pendingJump = false;
    this.updateCamera(0);
    const effects = this.logic.begin(this.project.variables, this.live, this.getModel, newRun);
    if (newRun) this.hud?.show(this.project.variables, this.logic.store);
    // with several levels, say which one it is
    if (this.project.levels.length > 1) this.hud?.toast(data.name, 2.5);
    this.applyEffects(effects);
  }

  /** Feed the game from on-screen controls (null: keyboard, mouse and gamepad only). */
  setTouch(source: TouchSource | null): void {
    this.input.touch = source;
    this.touchMode = source !== null;
  }

  /** Freeze or continue the game; held keys are forgotten so nothing is stuck on resume. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (this.playing) this.input.clear();
  }

  stopPlay(): void {
    this.playing = false;
    this.paused = false;
    this.ended = false;
    this.input.detach();
    this.hud?.hide();
    this.audio.stopMusic();
    // back to the level as it is edited: what the rules took away or moved comes back
    this.live = null;
    this.moves = [];
    this.chasers.clear();
    this.talking = null;
    this.invulnerable = 0;
    this.playerGroup.visible = true;
    this.removed.clear();
    this.levelIndex = this.runStartLevel;
    this.level.rebuild(this.objects());
    this.refreshColliders();
    this.resetPlayer();
    this.onLevelShown?.(this.project.levels[this.levelIndex]!);
  }

  /** Which foot the next footstep is (the sound is played a little lower for the second). */
  private stepSide = 0;

  private playPlayerSounds(): void {
    const events = this.controller.events;
    if (events.length === 0) return;
    const p = this.project.player;
    for (const e of events) {
      if (e === 'jump') this.audio.play(p.soundJump);
      else if (e === 'doubleJump') this.audio.play(p.soundDoubleJump);
      else if (e === 'splash') this.audio.play(p.soundLand, 0.6);
      else if (e === 'step') {
        // left and right foot: the same sound, the second a little lower
        this.audio.play(p.soundStep, this.stepSide++ % 2 === 0 ? 1 : 0.88);
      } else this.audio.play(p.soundLand);
    }
    events.length = 0;
  }

  /** The box where the player touches things: its body, a little fatter so a solid door can be "touched". */
  private touchBox(): Box {
    const c = this.controller;
    const r = this.project.player.width / 2 + 0.15;
    return {
      minX: c.pos[0] - r,
      maxX: c.pos[0] + r,
      minY: c.pos[1] - 0.05,
      maxY: c.pos[1] + c.height + 0.05,
      minZ: c.pos[2] - r,
      maxZ: c.pos[2] + r,
    };
  }

  /** The end screen: gameplay stops, the mouse is given back and the buttons are shown. */
  private finish(title: string, text: string): void {
    if (this.ended) return;
    this.ended = true;
    this.input.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud?.showEnd(title, text, [{ label: 'Play again', run: () => this.restartRun() }, ...this.endActions]);
  }

  /** The area in which the interact key reaches things: the player's body and a meter around it. */
  private interactBox(): Box {
    const c = this.controller;
    const r = this.project.player.width / 2 + 1;
    return { minX: c.pos[0] - r, maxX: c.pos[0] + r, minY: c.pos[1] - 0.2, maxY: c.pos[1] + c.height + 0.2, minZ: c.pos[2] - r, maxZ: c.pos[2] + r };
  }

  // ---------------------------------------------------------------- conversations

  /** A conversation is going on (gameplay waits). */
  get isTalking(): boolean {
    return this.talking !== null;
  }

  /**
   * What Interact, Jump or a click does in a conversation: the words that are still appearing show up at
   * once, and when they are all there, it reads on (or closes).
   */
  advanceTalk(): void {
    const t = this.talking;
    if (t?.typer && !t.typer.done) {
      t.typer.finish();
      this.hud?.setDialogueShown(t.typer.shown);
      return;
    }
    this.nextLine();
  }

  /** The end screen, while there is one. */
  get endScreen(): HTMLElement | null {
    return this.hud?.endScreen ?? null;
  }

  /** The gamepad has been used a moment ago (the hints and prompts name its buttons). */
  get padActive(): boolean {
    return this.input.padActive;
  }

  /** The words of the line are still appearing. */
  get isTyping(): boolean {
    const typer = this.talking?.typer;
    return !!typer && !typer.done;
  }

  /** Pick answer `i` (0-based) of a question. */
  chooseAnswer(i: number): void {
    this.answer(i);
  }

  private voiceOf(effect: { voice?: string; pitch?: number; speed?: number }): TalkVoice {
    return {
      sound: effect.voice === SILENT_VOICE ? null : effect.voice || SOUND_IDS.talk,
      pitch: effect.pitch ?? 1,
      speed: effect.speed ?? DEFAULT_TEXT_SPEED,
    };
  }

  private startTalk(talk: Talk): void {
    this.talking = talk;
    this.input.clear();
    if (talk.options && document.pointerLockElement) document.exitPointerLock();
    this.showTalk();
  }

  private showTalk(): void {
    const t = this.talking;
    if (!t) return;
    const line = t.lines[t.index]!;
    // the words appear letter by letter, with a sound for some of the letters
    t.typer = new Typewriter(line, t.voice.speed);
    t.blips = t.voice.sound ? new VoiceBlips(t.voice.speed, t.voice.pitch) : null;
    if (!this.hud) return;
    const last = t.index >= t.lines.length - 1;
    if (t.options) {
      // up / down and Cross (or Enter) pick an answer too; the number keys and a click still do
      const hint = this.input.padActive ? 'D-pad: choose · Cross: pick' : this.touchMode ? '' : '↑ ↓ choose · Enter or 1-4: pick';
      t.selected = 0;
      this.hud.showDialogue(t.speaker, line, hint, t.options.map((o) => o.label), (i) => this.answer(i), () => this.advanceTalk(), t.typer.shown);
    } else {
      const what = last ? 'close' : 'next';
      const hint = this.input.padActive ? `Cross / Triangle: ${what}` : this.touchMode ? `Tap: ${what}` : `Interact / Jump: ${what}`;
      this.hud.showDialogue(t.speaker, line, hint, [], () => {}, () => this.advanceTalk(), t.typer.shown);
    }
  }

  /** Let the words of the conversation go on appearing. */
  private talkTick(dt: number): void {
    const t = this.talking;
    if (!t?.typer || t.typer.done) return;
    const appeared = t.typer.update(dt);
    if (appeared === '') return;
    this.hud?.setDialogueShown(t.typer.shown);
    if (t.voice.sound && t.blips) {
      for (const rate of t.blips.rates(appeared)) this.audio.play(t.voice.sound, rate);
    }
  }

  private nextLine(): void {
    const t = this.talking;
    if (!t || t.options) return;
    t.index++;
    if (t.index >= t.lines.length) this.endTalk();
    else this.showTalk();
  }

  private answer(i: number): void {
    const t = this.talking;
    if (!t?.options || !t.options[i]) return;
    const effects = this.logic.runActions(t.objectId, t.options[i]!.actions);
    this.endTalk();
    this.applyEffects(effects);
  }

  private endTalk(): void {
    this.talking = null;
    this.hud?.hideDialogue();
    this.input.clear();
    this.onDialogueEnd?.();
  }

  // ---------------------------------------------------------------- enemies

  /** Take health, fling the player away from the object and make them untouchable for a moment. */
  private hurtPlayer(objectId: string, amount: number, variable: string, knockback: number): void {
    if (this.invulnerable > 0 || this.ended) return;
    if (amount > 0 && variable) this.logic.store.add(variable, -amount);
    this.invulnerable = 1.2;
    const src = this.objects().find((o) => o.id === objectId);
    const c = this.controller;
    if (knockback > 0 && src) {
      let dx = c.pos[0] - src.position[0];
      let dz = c.pos[2] - src.position[2];
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      c.vel = [dx * knockback, Math.max(c.vel[1], 5.5), dz * knockback];
      c.grounded = false;
    }
    this.hud?.flash();
  }

  /** Objects under "Chase the player" walk toward the player, follow the ground and face where they go. */
  private advanceChasers(dt: number): void {
    if (this.chasers.size === 0) return;
    const objects = this.objects();
    const target = this.controller.pos;
    for (const [id, ch] of this.chasers) {
      const obj = objects.find((o) => o.id === id);
      if (!obj || this.removed.has(id)) {
        this.chasers.delete(id);
        continue;
      }
      const bounds = triggerBox(obj, this.getModel);
      const half = bounds ? Math.max(0.15, Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2) : 0.4;
      // how far the origin is above the lowest point (a block's origin is its middle, a model's its feet)
      const foot = bounds ? Math.max(0, obj.position[1] - bounds.minY) : 0;
      let [x, y, z] = obj.position;
      const dx = target[0] - x;
      const dz = target[2] - z;
      const dist = Math.hypot(dx, dz);
      let nx = x;
      let nz = z;
      if (dist <= ch.range && dist > half + 0.35) {
        const step = Math.min(ch.speed * dt, dist - (half + 0.35));
        nx = x + (dx / dist) * step;
        nz = z + (dz / dist) * step;
        obj.rotation = [obj.rotation[0], (Math.atan2(dx, dz) * 180) / Math.PI, obj.rotation[2]];
      }
      // a drop is fine (it falls), a wall of more than half a meter is not
      const ahead = this.groundAt(nx, nz, y - foot + 0.5, half);
      if (ahead !== null && ahead - (y - foot) > 0.5) {
        nx = x;
        nz = z;
      }
      const g = this.groundAt(nx, nz, y - foot + 0.5, half);
      const bottom = y - foot;
      if (g !== null && bottom <= g + 0.02) {
        y = g + foot;
        ch.vy = 0;
      } else {
        ch.vy = Math.max(-30, ch.vy - 30 * dt);
        y = g !== null ? Math.max(g + foot, y + ch.vy * dt) : y + ch.vy * dt;
        if (y < -80) {
          this.removed.add(id);
          this.level.remove(id);
          this.chasers.delete(id);
          continue;
        }
      }
      x = nx;
      z = nz;
      this.placeObject(obj, [x, y, z]);
      this.level.syncTransform(obj);
    }
    this.updateMovingColliders();
  }

  /** Highest static floor under (x, z) that is not above `from` (null = nothing below). */
  private groundAt(x: number, z: number, from: number, half: number): number | null {
    const boxes = groundHeightBelow(x, z, half, from, this.staticColliders.boxes);
    const meshes = meshGroundBelow(x, z, from, this.staticColliders.meshes);
    if (boxes === null) return meshes;
    return meshes === null ? boxes : Math.max(boxes, meshes);
  }

  private applyEffects(effects: LogicEffect[]): void {
    if (this.depth > 8) return;
    this.depth++;
    try {
      this.applyEffectList(effects);
    } finally {
      this.depth--;
    }
  }

  private applyEffectList(effects: LogicEffect[]): void {
    let collidersChanged = false;
    for (const { objectId, effect } of effects) {
      switch (effect.type) {
        case 'destroy': {
          const id = effect.target || objectId;
          this.removed.add(id);
          this.level.remove(id);
          this.moves = this.moves.filter((m) => m.id !== id);
          this.chasers.delete(id);
          collidersChanged = true;
          break;
        }
        case 'move':
        case 'patrol': {
          const id = effect.target || objectId;
          const obj = this.objects().find((o) => o.id === id);
          if (!obj || this.removed.has(id)) break;
          const from: Vec3 = [obj.position[0], obj.position[1], obj.position[2]];
          const to: Vec3 = [from[0] + effect.offset[0], from[1] + effect.offset[1], from[2] + effect.offset[2]];
          this.moves = this.moves.filter((m) => m.id !== id);
          if (effect.type === 'move' && effect.seconds <= 0) this.placeObject(obj, to);
          else this.moves.push({ id, from, to, t: 0, duration: Math.max(0.05, effect.seconds), pingpong: effect.type === 'patrol' });
          collidersChanged = true;
          break;
        }
        case 'chase': {
          const id = effect.target || objectId;
          if (this.removed.has(id) || !this.objects().some((o) => o.id === id)) break;
          this.chasers.set(id, { speed: effect.speed, range: effect.range, vy: 0 });
          collidersChanged = true;
          break;
        }
        case 'hurt':
          this.hurtPlayer(objectId, effect.amount, effect.variable, effect.knockback);
          break;
        case 'bounce':
          this.controller.launch(effect.strength);
          break;
        case 'dialogue':
          if (!this.talking) this.startTalk({ objectId, speaker: effect.speaker, lines: effect.lines, index: 0, voice: this.voiceOf(effect) });
          break;
        case 'choice':
          if (!this.talking) {
            this.startTalk({ objectId, speaker: effect.speaker ?? '', lines: [effect.question], index: 0, options: effect.options, voice: this.voiceOf(effect) });
          }
          break;
        case 'animate': {
          const obj = this.objects().find((o) => o.id === (effect.target || objectId));
          if (obj && obj.kind === 'model' && !this.removed.has(obj.id)) {
            obj.animation = effect.animation || null;
            this.level.upsert(obj);
          }
          break;
        }
        case 'message':
          this.hud?.toast(effect.text, effect.seconds);
          break;
        case 'sound':
          this.audio.play(effect.sound);
          break;
        case 'checkpoint':
          this.checkpoint = [this.controller.pos[0], this.controller.pos[1], this.controller.pos[2]];
          break;
        case 'respawn': {
          const to = this.checkpoint ?? this.project.levels[this.levelIndex]!.spawn;
          this.controller.pos = [to[0], to[1], to[2]];
          this.controller.vel = [0, 0, 0];
          break;
        }
        case 'end':
          this.finish(effect.title, effect.text);
          return;
        case 'level': {
          const next = effect.level ? this.project.levels.findIndex((l) => l.id === effect.level) : this.levelIndex + 1;
          if (next < 0) break; // a level that was deleted
          if (next >= this.project.levels.length) {
            this.finish('You win!', '');
          } else {
            this.enterLevel(next, false);
          }
          return; // the rest of this batch belonged to the level that was just left
        }
        case 'restart':
          this.beginRun();
          return; // the rest of this batch belonged to the run that just ended
      }
    }
    if (collidersChanged) this.refreshColliders();
  }

  private placeObject(obj: LevelObject, to: Vec3): void {
    const dx = to[0] - obj.position[0];
    const dy = to[1] - obj.position[1];
    const dz = to[2] - obj.position[2];
    obj.position = [to[0], to[1], to[2]];
    this.level.syncTransform(obj);
    this.logic.shift(obj.id, dx, dy, dz);
  }

  /** The player stands on top of this object (so it takes the player along when it moves). */
  private playerRidesOn(obj: LevelObject): boolean {
    if (!obj.collide || !this.controller.grounded) return false;
    const box = triggerBox(obj, this.getModel);
    if (!box) return false;
    const c = this.controller;
    const r = this.project.player.width / 2;
    const gap = c.pos[1] - box.maxY;
    return gap > -0.1 && gap < 0.15 && c.pos[0] > box.minX - r && c.pos[0] < box.maxX + r && c.pos[2] > box.minZ - r && c.pos[2] < box.maxZ + r;
  }

  /**
   * Slide the objects rules are moving. A solid one carries the player standing on it. A one-way move
   * ends as part of the static level; a patrol turns around and goes on.
   */
  private advanceMoves(dt: number): void {
    if (this.moves.length === 0) return;
    const objects = this.objects();
    let finished = false;
    for (const m of this.moves) {
      const obj = objects.find((o) => o.id === m.id);
      if (!obj) {
        m.t = m.duration;
        m.pingpong = false;
        finished = true;
        continue;
      }
      const rides = this.playerRidesOn(obj);
      const before: Vec3 = [obj.position[0], obj.position[1], obj.position[2]];
      m.t = Math.min(m.duration, m.t + dt);
      const k = m.t / m.duration;
      const e = k * k * (3 - 2 * k); // smoothstep
      this.placeObject(obj, [
        m.from[0] + (m.to[0] - m.from[0]) * e,
        m.from[1] + (m.to[1] - m.from[1]) * e,
        m.from[2] + (m.to[2] - m.from[2]) * e,
      ]);
      if (rides) {
        this.controller.pos[0] += obj.position[0] - before[0];
        this.controller.pos[1] += obj.position[1] - before[1];
        this.controller.pos[2] += obj.position[2] - before[2];
      }
      if (m.t >= m.duration) {
        if (m.pingpong) {
          [m.from, m.to] = [m.to, m.from];
          m.t = 0;
        } else {
          finished = true;
        }
      }
    }
    if (finished) {
      this.moves = this.moves.filter((m) => m.pingpong || m.t < m.duration);
      this.refreshColliders();
    } else {
      this.updateMovingColliders();
    }
  }

  /** Advance one rendered frame (only does gameplay work while playing). */
  update(frameDt: number): void {
    if (!this.playing) {
      // the editor shows the character breathing in its idle pose
      this.avatar.sync(this.project.player);
      this.avatar.update(Math.min(frameDt, MAX_FRAME), IDLE_MOTION, this.project.player);
      this.level.animate(Math.min(frameDt, MAX_FRAME));
      return;
    }
    if (this.paused) return;
    if (this.ended) {
      this.level.animate(Math.min(frameDt, MAX_FRAME));
      return;
    }
    const dt = Math.min(frameDt, MAX_FRAME);
    this.clock += dt;
    const inp = this.input.poll(this.project.settings, dt);
    if (this.talking) {
      // the world waits while someone is talking
      this.level.animate(dt);
      this.talkTick(dt);
      if (this.talking.options) {
        const t = this.talking;
        if (inp.answer >= 0) {
          // the first key press shows the whole question, the next one answers it
          if (this.isTyping) this.advanceTalk();
          else this.answer(inp.answer);
        } else if (inp.navY !== 0 && !this.isTyping) {
          // up and down move the mark over the answers (it wraps round)
          const n = t.options!.length;
          t.selected = (((t.selected ?? 0) + inp.navY) % n + n) % n;
          this.hud?.selectAnswer(t.selected);
        } else if (inp.confirm) {
          if (this.isTyping) this.advanceTalk();
          else this.answer(t.selected ?? 0);
        }
      } else if (inp.interactPressed || inp.jumpPressed || inp.confirm) {
        this.advanceTalk();
      }
      this.updateCamera(dt);
      return;
    }
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.playerGroup.visible = this.invulnerable <= 0 || Math.floor(this.clock * 12) % 2 === 0;
    const { mouseSensitivity, invertY } = this.project.settings;
    const chase = this.project.player.cameraMode === 'chase';
    this.rig.look(inp.lookX, inp.lookY, mouseSensitivity, invertY, !chase);
    // chase camera: the mouse turns the player and the camera follows
    if (chase) this.controller.turnRight(inp.lookX * MOUSE_RAD_PER_PIXEL * mouseSensitivity);
    if (inp.jumpPressed) this.pendingJump = true;

    // big levels have thousands of colliders: the body only needs the ones around it
    const near = collidersNear(this.colliders, this.controller.pos[0], this.controller.pos[2], NEAR_RADIUS);

    this.accumulator += dt;
    while (this.accumulator >= FIXED_STEP) {
      this.controller.update(
        FIXED_STEP,
        {
          moveX: inp.moveX,
          moveY: inp.moveY,
          jumpPressed: this.pendingJump,
          jumpHeld: inp.jumpHeld,
          run: inp.run,
          crouch: inp.crouch,
        },
        this.rig.yaw,
        near.boxes,
        near.meshes,
        near.liquids,
      );
      this.pendingJump = false;
      this.accumulator -= FIXED_STEP;
      this.playPlayerSounds();
    }

    // out of the world (off an island, through a hole): back to the checkpoint, no harm done
    if (this.controller.pos[1] < this.fallLimit && !this.ended) {
      this.applyEffects([{ objectId: '', effect: { type: 'respawn' } }]);
      this.rig.reset(this.controller.facing);
    }

    this.syncVisual(dt);
    this.level.animate(dt);
    this.advanceMoves(dt);
    this.advanceChasers(dt);
    this.applyEffects(this.logic.update(this.touchBox(), this.removed, dt, this.controller.vel[1]));
    if (inp.interactPressed && !this.ended) this.applyEffects(this.logic.interact(this.interactBox(), this.removed));
    if (this.hud && !this.ended) {
      const key = this.project.settings.controls.interact[0];
      const can = this.logic.canInteract(this.interactBox(), this.removed);
      this.hud.setPrompt(
        can && (this.touchMode || this.input.padActive || key)
          ? this.input.padActive
            ? 'Triangle: interact'
            : this.touchMode
              ? 'Use: interact'
              : `${keyLabel(key!)}: interact`
          : null,
      );
    }
    this.hud?.update(this.logic.store);
    if (this.hud) {
      const cam = this.camera.position;
      const under = this.colliders.liquids.some(
        (l) => cam.x > l.minX && cam.x < l.maxX && cam.z > l.minZ && cam.z < l.maxZ && cam.y > l.minY && cam.y < l.maxY,
      );
      this.hud.tint(under ? 'rgba(30, 100, 200, 0.38)' : null);
    }
    const c = this.controller;
    const motion: Motion = {
      grounded: c.grounded,
      crouching: c.crouching,
      speed: Math.hypot(c.vel[0], c.vel[2]),
      vy: c.vel[1],
      gliding: c.gliding,
      swimming: c.swimming,
    };
    this.avatar.update(dt, motion, this.project.player);
    this.updateCamera(dt);
  }

  /** Apply player settings (size/color/spawn) to the placeholder while editing. */
  syncVisual(dt: number): void {
    const c = this.controller;
    const s = this.project.player;
    const w = s.width;
    this.visualHeight += (c.height - this.visualHeight) * (dt > 0 ? 1 - Math.exp(-25 * dt) : 1);
    const h = this.visualHeight;

    this.playerGroup.position.set(c.pos[0], c.pos[1], c.pos[2]);
    this.playerGroup.rotation.y = c.facing;
    this.playerBody.scale.set(w, h, w);
    this.playerBody.position.y = h / 2;

    this.avatar.sync(s);
    const hasModel = this.avatar.present;
    // the cube stays in the scene (invisible) as the click target and collision-size reference
    this.bodyMat.visible = !hasModel;
    this.playerBody.visible = true;
    // a rigged body crouches with its animation; a plain model is squashed to the crouch height
    const fit = this.avatar.fitScale;
    this.avatar.root.scale.set(fit, fit * (this.avatar.rigged ? 1 : h / s.height), fit);

    const eyeW = w * 0.16;
    const eyeH = h * 0.22;
    this.eyes.forEach((eye, i) => {
      eye.visible = !hasModel;
      eye.scale.set(eyeW, eyeH, 0.04);
      eye.position.set((i === 0 ? -1 : 1) * w * 0.2, h * 0.62, w / 2 + 0.005);
    });

    const boxGround = groundHeightBelow(c.pos[0], c.pos[2], w / 2, c.pos[1], this.colliders.boxes);
    const meshGround = meshGroundBelow(c.pos[0], c.pos[2], c.pos[1], this.colliders.meshes);
    const ground = boxGround === null ? meshGround : meshGround === null ? boxGround : Math.max(boxGround, meshGround);
    // real shadows (the level's setting) replace the round blob under the player
    const realShadows = this.project.levels[this.levelIndex]?.look.shadows !== false;
    if (ground === null || realShadows) {
      this.shadow.visible = false;
    } else {
      this.shadow.visible = true;
      const air = c.pos[1] - ground;
      const k = Math.max(0.4, 1 - air * 0.08);
      this.shadow.position.set(c.pos[0], ground + 0.02, c.pos[2]);
      this.shadow.scale.set(w * 1.3 * k, 1, w * 1.3 * k);
      (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.max(0.3, 1 - air * 0.06);
    }
  }

  private updateCamera(dt: number): void {
    // the camera looks back from the player up to its distance away: only that part of the world matters
    const reach = this.project.player.cameraDistance + NEAR_RADIUS;
    const near = collidersNear(this.colliders, this.controller.pos[0], this.controller.pos[2], reach);
    this.rig.update(
      dt,
      this.camera,
      this.controller.pos,
      this.controller.facing,
      this.visualHeight,
      this.project.player,
      near.boxes,
      near.meshes,
    );
  }

  stats(): GameStats {
    const c = this.controller;
    return {
      speed: Math.hypot(c.vel[0], c.vel[2]),
      grounded: c.grounded,
      crouching: c.crouching,
      pos: [c.pos[0], c.pos[1], c.pos[2]],
    };
  }
}
