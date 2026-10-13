import { ambientMusic } from '../core/ambient';
import { UI_FONT_STACK } from '../core/fonts';
import {
  MAX_CHANNELS,
  MUSIC_WAVES,
  type MusicChannel,
  type MusicData,
  type MusicWave,
  NOTE_LENGTHS,
  SCALES,
  STEP_COUNTS,
  type ScaleName,
  channelLength,
  DEFAULT_NOTE_LENGTH,
  musicDuration,
  normalizeMusic,
  randomMusic,
  renderMusic,
} from '../core/music';
import { SFX_KINDS, SFX_WAVES, type SfxKind, type SfxParams, type SfxWave, mutateSfx, renderSfx, sfxPreset } from '../core/sfx';
import { encodeWav } from '../core/wav';
import {
  barCount,
  barRange,
  clearRange,
  copyRange,
  noteCount,
  noteName,
  nudgeRange,
  pasteRange,
  repeatBar,
  transposeRange,
} from '../core/musicEdit';
import { SOUND_IDS, type SoundAsset, builtInSound, newMusic, newSfx, soundDuration } from '../core/sounds';
import { newId } from '../core/types';
import { AudioEngine, bytesToBase64 } from '../runtime/audio';
import { CHANNEL_COLORS, MusicRoll, type RollView } from './musicRoll';
import type { Store } from './store';
import { clear, el } from './ui/dom';
import { renameInline } from './ui/rename';

/** "12.5 s" or "2:08". */
function formatLoop(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

interface Slider {
  key: keyof SfxParams;
  label: string;
  min: number;
  max: number;
  hint?: string;
}

const SFX_GROUPS: { title: string; sliders: Slider[] }[] = [
  {
    title: 'Envelope',
    sliders: [
      { key: 'attack', label: 'Attack', min: 0, max: 1 },
      { key: 'sustain', label: 'Sustain', min: 0, max: 1 },
      { key: 'punch', label: 'Punch', min: 0, max: 1, hint: 'Extra loudness at the start of the sustain' },
      { key: 'decay', label: 'Decay', min: 0, max: 1 },
    ],
  },
  {
    title: 'Pitch',
    sliders: [
      { key: 'startFreq', label: 'Start pitch', min: 0, max: 1 },
      { key: 'minFreq', label: 'Lowest pitch', min: 0, max: 1, hint: 'The sound stops when the pitch slides below this' },
      { key: 'slide', label: 'Slide', min: -1, max: 1 },
      { key: 'deltaSlide', label: 'Slide change', min: -1, max: 1 },
      { key: 'changeAmount', label: 'Jump amount', min: -1, max: 1, hint: 'One sudden change of pitch (a coin has an upward one)' },
      { key: 'changeSpeed', label: 'Jump time', min: 0, max: 1 },
      { key: 'vibratoDepth', label: 'Vibrato depth', min: 0, max: 1 },
      { key: 'vibratoSpeed', label: 'Vibrato speed', min: 0, max: 1 },
    ],
  },
  {
    title: 'Tone',
    sliders: [
      { key: 'squareDuty', label: 'Square width', min: 0, max: 1 },
      { key: 'dutySweep', label: 'Width sweep', min: -1, max: 1 },
      { key: 'repeatSpeed', label: 'Repeat', min: 0, max: 1, hint: 'The pitch restarts this often (0 = never)' },
      { key: 'phaserOffset', label: 'Phaser', min: -1, max: 1 },
      { key: 'phaserSweep', label: 'Phaser sweep', min: -1, max: 1 },
    ],
  },
  {
    title: 'Filter',
    sliders: [
      { key: 'lpfCutoff', label: 'Low-pass', min: 0, max: 1, hint: '1 = off' },
      { key: 'lpfSweep', label: 'Low-pass sweep', min: -1, max: 1 },
      { key: 'lpfResonance', label: 'Resonance', min: 0, max: 1 },
      { key: 'hpfCutoff', label: 'High-pass', min: 0, max: 1 },
      { key: 'hpfSweep', label: 'High-pass sweep', min: -1, max: 1 },
    ],
  },
];

const ZOOM_STEPS = [0.55, 0.75, 1, 1.35, 1.8];
const BAR_HINT =
  'Click a square to put a note, click it again to take it away. Drag to draw a run of notes, right-drag to erase. Click a bar number to select a bar (Copy, Paste, Repeat). Space plays. For calm music try Soft piano, Bell and Pad, a slow tempo, a long loop and some Space.';

/** The Audio tab: make sound effects, tunes and bring in audio files. */
export class AudioEditor {
  readonly root: HTMLElement;
  private engine = new AudioEngine();
  private selectedId: string | null = null;
  private active = false;
  private channel = 0;
  private seedCounter = 1;
  private waveCanvas: HTMLCanvasElement | null = null;

  // the tune being edited: what the roll shows and what only the preview hears
  private history: { id: string | null; undo: string[]; redo: string[] } = { id: null, undo: [], redo: [] };
  private pendingBefore: string | null = null;
  private muted = new Set<number>();
  private solo: number | null = null;
  private barSel: number | null = null;
  private clip: number[] | null = null;
  private zoom = 2;
  private showOthers = true;
  private roll: MusicRoll | null = null;
  private timeEl: HTMLElement | null = null;
  private playBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;
  private redoBtn: HTMLButtonElement | null = null;
  private restartTimer: number | undefined;
  private frame = 0;
  private statusEl: HTMLElement | null = null;

  private listEl = el('div', { class: 'hierarchy sound-list' });
  private editorEl = el('div', { class: 'audio-editor' });
  private fileInput = el('input', { type: 'file', accept: 'audio/*', class: 'hidden' });

  constructor(private store: Store) {
    this.root = this.buildLayout();
    this.root.classList.add('hidden');
    store.subscribe((e) => {
      if (e.type === 'project-replaced') {
        this.selectedId = null;
        this.engine.stopMusic();
        this.resetTune();
        if (this.active) this.refreshAll();
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Space plays and stops here, also while a button has the focus: do not let it press that button as well
    window.addEventListener('keyup', (e) => {
      if (this.active && e.code === 'Space' && (e.target as HTMLElement | null)?.tagName === 'BUTTON') e.preventDefault();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('hidden', !active);
    if (!active) {
      this.engine.stopMusic();
      window.clearTimeout(this.restartTimer);
      cancelAnimationFrame(this.frame);
    } else {
      if (!this.selected() && this.store.project.sounds.length > 0) this.selectedId = this.store.project.sounds[0]!.id;
      this.refreshAll();
      cancelAnimationFrame(this.frame);
      this.tick();
    }
  }

  /** Forget what belongs to the tune that was shown (selection of a bar, mutes, undo). */
  private resetTune(): void {
    this.barSel = null;
    this.muted.clear();
    this.solo = null;
    this.history = { id: null, undo: [], redo: [] };
    this.channel = 0;
  }

  /** The play position and the time label follow the music that plays. */
  private tick = (): void => {
    if (!this.active) return;
    const s = this.selected();
    const playing = s?.kind === 'music' && this.engine.musicId === s.id;
    const pos = playing ? this.engine.musicPosition() : null;
    this.roll?.setPlayhead(pos);
    if (this.timeEl && s?.music) {
      const total = musicDuration(s.music);
      this.timeEl.textContent = `${formatLoop(pos ?? 0)} / ${formatLoop(total)}`;
    }
    if (this.playBtn) {
      const label = playing ? '■ Stop' : '▶ Play loop';
      if (this.playBtn.textContent !== label) this.playBtn.textContent = label;
      this.playBtn.classList.toggle('playing', playing);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private get sounds(): SoundAsset[] {
    return this.store.project.sounds;
  }

  private selected(): SoundAsset | null {
    return this.sounds.find((s) => s.id === this.selectedId) ?? null;
  }

  /** The sounds changed: save, and let the preview engine pick the change up. */
  private changed(): void {
    this.pushSounds();
    this.store.soundsChanged();
  }

  /** The sounds as the preview hears them: a muted channel (or one that is not the solo one) is silent. */
  private previewSounds(): SoundAsset[] {
    const s = this.selected();
    if (!s || s.kind !== 'music' || !s.music) return this.sounds;
    if (this.muted.size === 0 && this.solo === null) return this.sounds;
    const copy: SoundAsset = {
      ...s,
      music: { ...s.music, channels: s.music.channels.map((c, i) => (this.silent(i) ? { ...c, volume: 0 } : c)) },
    };
    return this.sounds.map((x) => (x.id === s.id ? copy : x));
  }

  private silent(index: number): boolean {
    return this.solo !== null ? index !== this.solo : this.muted.has(index);
  }

  private pushSounds(): void {
    this.engine.setSounds(this.previewSounds(), 1);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const s = this.selected();
    if (!s) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      e.preventDefault();
      if (s.kind === 'music' && this.engine.musicId === s.id) this.engine.stopMusic();
      else this.play(s);
      return;
    }
    if (s.kind !== 'music' || !s.music) return;
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo(s);
      else this.undo(s);
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo(s);
    } else if (mod && e.code === 'KeyC') {
      e.preventDefault();
      this.copyBar(s);
    } else if (mod && e.code === 'KeyV') {
      e.preventDefault();
      this.pasteBar(s);
    } else if (!mod && (e.code === 'Delete' || e.code === 'Backspace')) {
      e.preventDefault();
      this.clearSelection(s);
    } else if (!mod && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      const len = SCALES[s.music.scale].length;
      this.transpose(s, (e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? len : 1));
    } else if (!mod && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      if (e.altKey) this.nudge(s, e.code === 'ArrowLeft' ? -1 : 1);
      else {
        const last = barCount(s.music) - 1;
        const next = this.barSel === null ? 0 : Math.max(0, Math.min(last, this.barSel + (e.code === 'ArrowLeft' ? -1 : 1)));
        this.selectBar(s, next);
      }
    } else if (e.code === 'Escape') {
      this.selectBar(s, null);
    }
  }

  // ---------------------------------------------------------------- layout

  private buildLayout(): HTMLElement {
    const effect = el('select', { class: 'add-shape', title: 'Make a sound effect' });
    effect.append(el('option', { value: '', text: '+ Sound effect…' }));
    for (const k of SFX_KINDS) effect.append(el('option', { value: k.kind, text: k.label }));
    effect.addEventListener('change', () => {
      const kind = effect.value as SfxKind | '';
      effect.value = '';
      if (kind) this.addSfx(kind);
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.importFile(file);
    });

    const left = el(
      'aside',
      { class: 'panel panel-left' },
      el('div', { class: 'panel-header' }, el('span', { text: 'Sounds' })),
      el(
        'div',
        { class: 'panel-toolbar' },
        effect,
        el('button', { class: 'btn', text: '+ Music', title: 'A chip-music loop', onclick: () => this.addMusic() }),
        el('button', { class: 'btn', text: 'Import…', title: 'An audio file (wav, ogg, mp3)', onclick: () => this.fileInput.click() }),
        el('button', { class: 'btn', text: 'Starter sounds', title: 'Add the sounds of the built-in pickups and the player', onclick: () => this.addStarter() }),
        el('button', { class: 'btn', text: 'Duplicate', onclick: () => this.duplicate() }),
        el('button', { class: 'btn danger', text: 'Delete', onclick: () => this.remove() }),
      ),
      this.listEl,
      this.fileInput,
    );
    this.listEl.addEventListener('dblclick', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sound-id]')?.dataset.soundId;
      if (id) this.rename(id);
    });
    return el('div', { class: 'workspace audio-workspace' }, left, el('section', { class: 'audio-main' }, this.editorEl));
  }

  // ---------------------------------------------------------------- actions

  private uniqueName(base: string): string {
    const names = new Set(this.sounds.map((s) => s.name));
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  private add(sound: SoundAsset): void {
    this.sounds.push(sound);
    this.selectedId = sound.id;
    this.channel = 0;
    this.changed();
    this.refreshAll();
  }

  private addSfx(kind: SfxKind): void {
    const label = SFX_KINDS.find((k) => k.kind === kind)!.label;
    this.add(newSfx(newId(), this.uniqueName(label), kind, this.seedCounter++));
  }

  private addMusic(): void {
    this.add(newMusic(newId(), this.uniqueName('Music'), this.seedCounter++));
  }

  private addStarter(): void {
    let first: string | null = null;
    for (const id of Object.values(SOUND_IDS)) {
      if (this.sounds.some((s) => s.id === id)) continue;
      const s = builtInSound(id);
      if (s) {
        this.sounds.push(s);
        first ??= s.id;
      }
    }
    if (first) this.selectedId = first;
    this.changed();
    this.refreshAll();
  }

  private duplicate(): void {
    const s = this.selected();
    if (!s) return;
    this.add({ ...structuredClone(s), id: newId(), name: this.uniqueName(`${s.name} copy`) });
  }

  private remove(): void {
    const s = this.selected();
    if (!s) return;
    if (!confirm(`Delete the sound "${s.name}"? Rules and settings that use it become silent.`)) return;
    this.engine.stopMusic();
    const project = this.store.project;
    project.sounds = project.sounds.filter((x) => x.id !== s.id);
    if (project.settings.music === s.id) project.settings.music = null;
    for (const k of ['soundJump', 'soundDoubleJump', 'soundLand'] as const) if (project.player[k] === s.id) project.player[k] = null;
    this.selectedId = project.sounds[0]?.id ?? null;
    this.changed();
    this.refreshAll();
  }

  private rename(id: string): void {
    const s = this.sounds.find((x) => x.id === id);
    const label = this.listEl.querySelector<HTMLElement>(`[data-sound-id="${id}"] .tree-label`);
    if (!s || !label) return;
    renameInline(label, s.name, (name) => {
      s.name = name;
      this.changed();
      this.refreshAll();
    });
  }

  private async importFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024 && !confirm(`${file.name} is ${(bytes.length / 1048576).toFixed(1)} MB. It is stored inside the project file; import it anyway?`)) return;
    const mime = file.type || (file.name.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : file.name.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg');
    this.add({
      id: newId(),
      name: this.uniqueName(file.name.replace(/\.[^.]+$/, '') || 'Audio'),
      kind: 'file',
      volume: 0.8,
      file: { mime, data: bytesToBase64(bytes) },
    });
  }

  // ---------------------------------------------------------------- views

  private refreshAll(): void {
    this.pushSounds();
    this.refreshList();
    this.refreshEditor();
  }

  private refreshList(): void {
    clear(this.listEl);
    if (this.sounds.length === 0) {
      this.listEl.append(el('div', { class: 'empty muted', text: 'No sounds yet. Make an effect, a music loop, or import a file. “Starter sounds” adds the ones the pickups use.' }));
    }
    for (const s of this.sounds) {
      const d = soundDuration(s);
      this.listEl.append(
        el(
          'button',
          {
            class: `tree-item${s.id === this.selectedId ? ' selected' : ''}`,
            'data-sound-id': s.id,
            title: 'Double-click to rename',
            onclick: () => {
              this.engine.stopMusic();
              if (this.selectedId !== s.id) {
                this.resetTune();
                this.keptScroll = null;
              }
              this.selectedId = s.id;
              this.channel = 0;
              this.refreshAll();
            },
          },
          el('span', { class: 'tree-icon', text: s.kind === 'sfx' ? '♪' : s.kind === 'music' ? '♫' : '▤' }),
          el('span', { class: 'tree-label', text: s.name }),
          el('span', { class: 'tree-count muted', text: d !== null ? `${d.toFixed(1)}s` : '' }),
        ),
      );
    }
  }

  private refreshEditor(): void {
    this.keptScroll = this.roll?.scroll ?? null;
    this.roll = null;
    this.rollView = null;
    this.scopeEl = null;
    this.statusEl = null;
    clear(this.editorEl);
    this.waveCanvas = null;
    const s = this.selected();
    if (!s) {
      this.editorEl.append(el('div', { class: 'model-empty-title', text: 'Pick a sound or make one' }));
      return;
    }

    const name = el('input', { type: 'text', value: s.name });
    name.addEventListener('change', () => {
      const n = name.value.trim();
      if (n) s.name = n;
      this.changed();
      this.refreshList();
    });
    const volume = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) });
    volume.addEventListener('input', () => {
      s.volume = parseFloat(volume.value);
      this.changed();
    });
    const play = el('button', {
      class: 'btn primary',
      text: s.kind === 'music' ? '▶ Play loop' : '▶ Play',
      title: s.kind === 'music' ? 'Play or stop the loop (Space)' : 'Play the sound (Space)',
      onclick: () => {
        if (s.kind === 'music' && this.engine.musicId === s.id) this.engine.stopMusic();
        else this.play(s);
      },
    });
    const stop = el('button', { class: 'btn', text: '■ Stop', onclick: () => this.engine.stopMusic() });
    this.playBtn = s.kind === 'music' ? play : null;
    this.timeEl = null;
    if (s.kind === 'music') {
      this.timeEl = el('span', { class: 'muted time-label', text: '' });
      this.editorEl.append(
        el('div', { class: 'audio-head' }, name, el('span', { class: 'muted', text: 'Volume' }), volume, play, this.timeEl, this.exportButton(s)),
        el('div', { class: 'muted audio-hint', text: this.usedBy(s) }),
      );
    } else {
      this.editorEl.append(
        el('div', { class: 'audio-head' }, name, el('span', { class: 'muted', text: 'Volume' }), volume, play, stop, this.exportButton(s)),
        el('div', { class: 'muted audio-hint', text: this.usedBy(s) }),
      );
    }

    if (s.kind === 'sfx' && s.sfx) this.buildSfx(s, s.sfx);
    else if (s.kind === 'music' && s.music) this.buildMusic(s, s.music);
    else if (s.kind === 'file' && s.file) {
      this.editorEl.append(
        el('div', { class: 'empty', text: `Imported file (${s.file.mime}, ${(s.file.data.length * 0.75 / 1024).toFixed(0)} KB). It plays as it is.` }),
      );
    }
  }

  /** A button that saves the sound as a WAV file (an imported file is saved as it came). */
  private exportButton(s: SoundAsset): HTMLElement {
    return el('button', {
      class: 'btn',
      text: 'Export .wav',
      title: 'Save this sound as an audio file, to use it somewhere else',
      onclick: () => this.exportSound(s),
    });
  }

  private exportSound(s: SoundAsset): void {
    let bytes: Uint8Array<ArrayBuffer>;
    let type = 'audio/wav';
    let ext = 'wav';
    if (s.kind === 'sfx' && s.sfx) {
      bytes = encodeWav(renderSfx(s.sfx, 44100, s.seed ?? 1), 44100);
    } else if (s.kind === 'music' && s.music) {
      bytes = encodeWav(renderMusic(s.music, 44100), 44100);
    } else if (s.kind === 'file' && s.file) {
      const bin = atob(s.file.data);
      bytes = new Uint8Array(new ArrayBuffer(bin.length));
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      type = s.file.mime;
      ext = /ogg/.test(type) ? 'ogg' : /mpeg|mp3/.test(type) ? 'mp3' : 'wav';
    } else {
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = el('a', { href: url, download: `${s.name.replace(/[^\w.-]+/g, '-') || 'sound'}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Where this sound is used, so it is clear what deleting it silences. */
  private usedBy(s: SoundAsset): string {
    const p = this.store.project;
    const uses: string[] = [];
    if (p.settings.music === s.id) uses.push('background music');
    if (p.player.soundJump === s.id) uses.push('jump');
    if (p.player.soundDoubleJump === s.id) uses.push('double jump');
    if (p.player.soundLand === s.id) uses.push('landing');
    const rules = p.levels.flatMap((l) => l.objects).filter((o) => o.rules.some((r) => r.actions.some((a) => a.type === 'sound' && a.sound === s.id))).length;
    if (rules > 0) uses.push(`${rules} object${rules === 1 ? '' : 's'}`);
    return uses.length > 0 ? `Used for: ${uses.join(', ')}.` : 'Not used yet. Pick it for the player in the Player settings, as music in Project Settings, or add a “Play sound” action to an object.';
  }

  private play(s: SoundAsset, offset = 0): void {
    this.pushSounds();
    this.engine.resume();
    if (s.kind === 'music') {
      this.engine.stopMusic();
      this.engine.playMusic(s.id, offset);
    } else {
      this.engine.play(s.id);
    }
  }

  // ---------------------------------------------------------------- sound effects

  private buildSfx(s: SoundAsset, p: SfxParams): void {
    const presets = el('div', { class: 'button-stack row wrap' });
    for (const k of SFX_KINDS) {
      presets.append(
        el('button', {
          class: 'btn',
          text: k.label,
          title: `Start again from a ${k.label.toLowerCase()} sound (each click is a new variation)`,
          onclick: () => {
            s.seed = this.seedCounter++;
            s.sfx = { ...sfxPreset(k.kind, s.seed), volume: p.volume };
            this.changed();
            this.refreshEditor();
            this.play(s);
          },
        }),
      );
    }
    presets.append(
      el('button', {
        class: 'btn',
        text: 'Mutate',
        title: 'The same sound, nudged a little',
        onclick: () => {
          s.sfx = mutateSfx(p, this.seedCounter++);
          this.changed();
          this.refreshEditor();
          this.play(s);
        },
      }),
    );

    this.waveCanvas = el('canvas', { class: 'wave-canvas', width: 880, height: 120 });
    const wave = el('select', {});
    for (const w of SFX_WAVES) wave.append(el('option', { value: String(w.value), text: w.label, selected: w.value === p.wave }));
    wave.addEventListener('change', () => {
      p.wave = parseInt(wave.value, 10) as SfxWave;
      this.changed();
      this.drawWave(p, s.seed ?? 1);
      this.play(s);
    });

    const groups = el('div', { class: 'sfx-groups' });
    groups.append(
      el('div', { class: 'sfx-group' }, el('div', { class: 'form-section', text: 'Wave' }), el('label', { class: 'form-row' }, el('span', { class: 'form-label', text: 'Shape' }), el('span', { class: 'form-control' }, wave))),
    );
    for (const g of SFX_GROUPS) {
      const box = el('div', { class: 'sfx-group' }, el('div', { class: 'form-section', text: g.title }));
      for (const sl of g.sliders) {
        const input = el('input', { type: 'range', min: String(sl.min), max: String(sl.max), step: '0.01', value: String(p[sl.key] as number) });
        const value = el('span', { class: 'muted slider-value', text: (p[sl.key] as number).toFixed(2) });
        input.addEventListener('input', () => {
          (p[sl.key] as number) = parseFloat(input.value);
          value.textContent = (p[sl.key] as number).toFixed(2);
          this.drawWave(p, s.seed ?? 1);
        });
        // hear the result when the slider is let go
        input.addEventListener('change', () => {
          this.changed();
          this.play(s);
        });
        box.append(el('label', { class: 'form-row', title: sl.hint ?? '' }, el('span', { class: 'form-label', text: sl.label }), el('span', { class: 'form-control' }, input, value)));
      }
      groups.append(box);
    }
    this.editorEl.append(el('div', { class: 'form-section', text: 'Start from' }), presets, this.waveCanvas, groups);
    this.drawWave(p, s.seed ?? 1);
  }

  private drawWave(p: SfxParams, seed: number): void {
    const canvas = this.waveCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#14161b';
    ctx.fillRect(0, 0, W, H);
    const data = renderSfx(p, 11025, seed);
    const seconds = data.length / 11025;
    const mid = H / 2;
    // the zero line and a mark every tenth of a second (or every second for a long sound)
    ctx.fillStyle = '#242933';
    ctx.fillRect(0, Math.round(mid), W, 1);
    const tick = seconds > 2 ? 1 : seconds > 0.6 ? 0.2 : 0.1;
    ctx.font = `10px ${UI_FONT_STACK}`;
    ctx.textBaseline = 'top';
    for (let t = tick; t < seconds; t += tick) {
      const x = Math.round((t / seconds) * W);
      ctx.fillStyle = '#242933';
      ctx.fillRect(x, 0, 1, H);
      ctx.fillStyle = '#5d6678';
      ctx.fillText(`${t.toFixed(tick < 1 ? 1 : 0)} s`, x + 4, 4);
    }
    ctx.strokeStyle = '#ffb23e';
    ctx.beginPath();
    const per = Math.max(1, data.length / W);
    for (let x = 0; x < W; x++) {
      let lo = 0;
      let hi = 0;
      const from = Math.floor(x * per);
      const to = Math.min(data.length, Math.floor((x + 1) * per) + 1);
      for (let i = from; i < to; i++) {
        lo = Math.min(lo, data[i]!);
        hi = Math.max(hi, data[i]!);
      }
      ctx.moveTo(x + 0.5, mid - hi * (mid - 6));
      ctx.lineTo(x + 0.5, mid - lo * (mid - 6) + 1);
    }
    ctx.stroke();
  }

  // ---------------------------------------------------------------- music

  private rollView: RollView | null = null;
  private keptScroll: { left: number; top: number } | null = null;
  private scopeEl: HTMLElement | null = null;

  private currentChannel(m: MusicData): MusicChannel {
    return m.channels[Math.min(this.channel, m.channels.length - 1)]!;
  }

  /** The steps the edit buttons work on: the selected bar, or the whole loop. */
  private scope(m: MusicData): [number, number] {
    return this.barSel === null ? [0, m.stepCount] : barRange(m, this.barSel);
  }

  /** Remember how the tune was before a change, so Undo can bring it back. */
  private remember(s: SoundAsset, before: string): void {
    if (this.history.id !== s.id) this.history = { id: s.id, undo: [], redo: [] };
    this.history.undo.push(before);
    if (this.history.undo.length > 100) this.history.undo.shift();
    this.history.redo = [];
    this.updateHistoryButtons();
  }

  private updateHistoryButtons(): void {
    const h = this.history;
    const own = h.id === this.selectedId;
    if (this.undoBtn) this.undoBtn.disabled = !own || h.undo.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = !own || h.redo.length === 0;
  }

  private restoreTune(s: SoundAsset, json: string): void {
    s.music = normalizeMusic(JSON.parse(json));
    this.changed();
    this.refreshEditor();
    this.scheduleRestart(s);
  }

  private undo(s: SoundAsset): void {
    const h = this.history;
    if (h.id !== s.id || h.undo.length === 0 || !s.music) return;
    h.redo.push(JSON.stringify(s.music));
    this.restoreTune(s, h.undo.pop()!);
  }

  private redo(s: SoundAsset): void {
    const h = this.history;
    if (h.id !== s.id || h.redo.length === 0 || !s.music) return;
    h.undo.push(JSON.stringify(s.music));
    this.restoreTune(s, h.redo.pop()!);
  }

  /** Change the notes in place (the roll is drawn again, the preview made again). */
  private edit(s: SoundAsset, fn: (m: MusicData) => void): void {
    const m = s.music;
    if (!m) return;
    const before = JSON.stringify(m);
    fn(m);
    if (JSON.stringify(m) === before) return;
    this.remember(s, before);
    this.changed();
    this.roll?.redraw();
    this.scheduleRestart(s);
  }

  /** Replace the whole tune (another scale, a new tune ...). */
  private replaceTune(s: SoundAsset, make: (m: MusicData) => MusicData): void {
    const m = s.music;
    if (!m) return;
    this.remember(s, JSON.stringify(m));
    s.music = make(m);
    this.changed();
    this.refreshEditor();
    this.scheduleRestart(s);
  }

  /** Hear a change when the tune plays: make it again soon (not once per note of a drag) and go on from the same place. */
  private scheduleRestart(s: SoundAsset): void {
    window.clearTimeout(this.restartTimer);
    if (this.engine.musicId !== s.id) return;
    this.restartTimer = window.setTimeout(() => this.restartLoop(s), 220);
  }

  /** Re-render and keep playing if this tune is being previewed. */
  private restartLoop(s: SoundAsset): void {
    if (this.engine.musicId !== s.id) return;
    const position = this.engine.musicPosition() ?? 0;
    this.pushSounds();
    this.engine.stopMusic();
    this.engine.playMusic(s.id, position);
  }

  private selectBar(s: SoundAsset, bar: number | null): void {
    this.barSel = bar;
    if (this.rollView) this.rollView.bar = bar;
    this.roll?.redraw();
    if (bar !== null) this.roll?.showBar(bar);
    this.updateScope(s);
    // while the tune plays, clicking a bar jumps there
    if (bar !== null && s.music && this.engine.musicId === s.id) {
      const [from] = barRange(s.music, bar);
      this.play(s, (from * 60) / (s.music.bpm * 4));
    }
  }

  private updateScope(s: SoundAsset): void {
    if (!this.scopeEl) return;
    this.scopeEl.textContent = this.barSel === null ? 'Whole channel' : `Bar ${this.barSel + 1}`;
    const m = s.music;
    if (m) this.editorEl.querySelectorAll<HTMLButtonElement>('[data-bar-only]').forEach((b) => (b.disabled = this.barSel === null));
  }

  private copyBar(s: SoundAsset): void {
    const m = s.music;
    if (!m || this.barSel === null) {
      this.setNote('Click a bar number on the ruler first, then copy it.');
      return;
    }
    const [from, to] = barRange(m, this.barSel);
    this.clip = copyRange(this.currentChannel(m), from, to);
    this.setNote(`Copied bar ${this.barSel + 1}. Select another bar and paste.`);
  }

  private pasteBar(s: SoundAsset): void {
    const m = s.music;
    if (!m || this.barSel === null || !this.clip) {
      this.setNote(this.clip ? 'Click the bar to paste into on the ruler.' : 'Copy a bar first.');
      return;
    }
    const clip = this.clip;
    const [from, to] = barRange(m, this.barSel);
    this.edit(s, (tune) => pasteRange(this.currentChannel(tune), from, clip, to));
  }

  private clearSelection(s: SoundAsset): void {
    const m = s.music;
    if (!m) return;
    const [from, to] = this.scope(m);
    this.edit(s, (tune) => clearRange(this.currentChannel(tune), from, to));
  }

  /** Move the notes of the scope up or down the scale (by one degree, or an octave with Shift). */
  private transpose(s: SoundAsset, delta: number): void {
    const m = s.music;
    if (!m) return;
    const ch = this.currentChannel(m);
    if (ch.wave === 'noise') {
      this.setNote('Drums have no pitch.');
      return;
    }
    const [from, to] = this.scope(m);
    if (noteCount(ch, from, to) === 0) {
      this.setNote('There are no notes here to move.');
      return;
    }
    // all or nothing: the rows are two octaves of the channel, and a note that would leave them stops the move
    const probe: MusicChannel = { ...ch, steps: [...ch.steps] };
    if (!transposeRange(probe, m, from, to, delta)) {
      this.setNote('A note would go past the top or the bottom. Change the octave of the channel to get more room.');
      return;
    }
    this.edit(s, (tune) => {
      transposeRange(this.currentChannel(tune), tune, from, to, delta);
    });
  }

  private nudge(s: SoundAsset, delta: number): void {
    const m = s.music;
    if (!m) return;
    const [from, to] = this.scope(m);
    this.edit(s, (tune) => nudgeRange(this.currentChannel(tune), from, to, delta));
  }

  private setNote(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  /** The cell width of the roll: narrower for longer loops, then the zoom of the user. */
  private cellWidth(m: MusicData): number {
    const base = m.stepCount <= 16 ? 48 : m.stepCount <= 32 ? 34 : m.stepCount <= 64 ? 26 : m.stepCount <= 128 ? 22 : 18;
    return Math.max(6, Math.round(base * ZOOM_STEPS[this.zoom]!));
  }

  private buildMusic(s: SoundAsset, m: MusicData): void {
    this.undoBtn = null;
    this.redoBtn = null;

    // ---- the song: tempo, key, scale, length, space
    const bpm = el('input', { type: 'number', min: '40', max: '240', step: '4', value: String(m.bpm), title: 'Beats per minute' });
    bpm.addEventListener('change', () => {
      const v = Math.max(40, Math.min(240, parseFloat(bpm.value) || 120));
      this.edit(s, (tune) => {
        tune.bpm = v;
      });
      this.refreshEditor();
    });
    const scale = el('select', { title: 'Which notes the rows are: every row is a note of this scale, so everything sounds right together' });
    for (const k of Object.keys(SCALES) as ScaleName[]) scale.append(el('option', { value: k, text: k, selected: k === m.scale }));
    scale.addEventListener('change', () => this.replaceTune(s, (tune) => normalizeMusic({ ...tune, scale: scale.value })));
    const root = el('select', { title: 'The note the scale starts on' });
    for (let n = 36; n <= 72; n++) root.append(el('option', { value: String(n), text: noteName(n), selected: n === m.root }));
    root.addEventListener('change', () => {
      const v = parseInt(root.value, 10);
      this.edit(s, (tune) => {
        tune.root = v;
      });
      this.refreshEditor();
    });
    const steps = el('select', { title: 'How long the loop is. 16 steps are one bar.' });
    for (const n of STEP_COUNTS) {
      const bars = n / 16;
      steps.append(el('option', { value: String(n), text: n < 16 ? `${n} steps` : `${bars} bar${bars === 1 ? '' : 's'} · ${n} steps`, selected: n === m.stepCount }));
    }
    steps.addEventListener('change', () => {
      const n = parseInt(steps.value, 10);
      this.barSel = null;
      this.replaceTune(s, (tune) => normalizeMusic({ ...tune, stepCount: n }));
    });
    const reverb = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(m.reverb ?? 0), title: 'The size of the room: an echo that fills the gaps between the notes' });
    reverb.addEventListener('input', () => {
      if (parseFloat(reverb.value) > 0) m.reverb = parseFloat(reverb.value);
      else delete m.reverb;
    });
    let reverbBefore = JSON.stringify(m);
    reverb.addEventListener('pointerdown', () => {
      reverbBefore = JSON.stringify(m);
    });
    reverb.addEventListener('change', () => {
      if (JSON.stringify(m) !== reverbBefore) this.remember(s, reverbBefore);
      this.changed();
      this.scheduleRestart(s);
    });

    const labeled = (text: string, ...controls: HTMLElement[]) => el('label', { class: 'music-field' }, el('span', { class: 'muted', text }), ...controls);
    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar' },
        labeled('Tempo', bpm),
        labeled('Key', root),
        labeled('Scale', scale),
        labeled('Length', steps),
        labeled('Space', reverb),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted', text: `${formatLoop(musicDuration(m))} loop` }),
      ),
    );

    // ---- tools: undo, whole tunes, zoom
    this.undoBtn = el('button', { class: 'btn', text: '↶ Undo', title: 'Take back the last change (Ctrl/Cmd+Z)', onclick: () => this.undo(s) });
    this.redoBtn = el('button', { class: 'btn', text: '↷ Redo', title: 'Bring it back (Shift+Ctrl/Cmd+Z)', onclick: () => this.redo(s) });
    const others = el('input', { type: 'checkbox', checked: this.showOthers });
    others.addEventListener('change', () => {
      this.showOthers = others.checked;
      if (this.rollView) this.rollView.showOthers = this.showOthers;
      this.roll?.redraw();
    });
    const zoom = (delta: number) => {
      this.zoom = Math.max(0, Math.min(ZOOM_STEPS.length - 1, this.zoom + delta));
      if (this.rollView) this.rollView.cell = this.cellWidth(m);
      this.roll?.redraw();
    };
    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar' },
        this.undoBtn,
        this.redoBtn,
        el('span', { class: 'bar-sep' }),
        el('button', {
          class: 'btn',
          text: 'Random tune',
          title: 'A new simple tune on this scale',
          onclick: () => this.replaceTune(s, (tune) => randomMusic(this.seedCounter++, tune.scale)),
        }),
        el('button', {
          class: 'btn',
          text: 'Calm tune',
          title: 'A new slow, spacious tune: soft piano, bells and pads in a big room, about two minutes long',
          onclick: () => this.replaceTune(s, () => ambientMusic(this.seedCounter++)),
        }),
        el('button', {
          class: 'btn',
          text: 'Clear all',
          title: 'Take every note out of every channel',
          onclick: () =>
            this.edit(s, (tune) => {
              for (const c of tune.channels) c.steps = c.steps.map(() => -1);
            }),
        }),
        el('span', { class: 'spacer' }),
        el('label', { class: 'inline-check', title: 'Show the notes of the other channels in the roll, faintly' }, others, el('span', { class: 'muted', text: 'Other channels' })),
        el('button', { class: 'btn icon-btn', text: '−', title: 'Narrower steps', onclick: () => zoom(-1) }),
        el('button', { class: 'btn icon-btn', text: '+', title: 'Wider steps', onclick: () => zoom(1) }),
      ),
    );
    this.updateHistoryButtons();

    // ---- channels: a tab each, with mute and solo
    const tabs = el('div', { class: 'chan-tabs' });
    m.channels.forEach((c, i) => {
      const selected = i === Math.min(this.channel, m.channels.length - 1);
      const mute = el('button', {
        class: `chan-toggle${this.muted.has(i) ? ' on' : ''}`,
        text: 'M',
        title: 'Mute this channel (only in the preview: the tune is not changed)',
        onclick: (e: Event) => {
          e.stopPropagation();
          if (this.muted.has(i)) this.muted.delete(i);
          else this.muted.add(i);
          this.pushSounds();
          this.scheduleRestart(s);
          this.refreshEditor();
        },
      });
      const solo = el('button', {
        class: `chan-toggle solo${this.solo === i ? ' on' : ''}`,
        text: 'S',
        title: 'Hear only this channel (only in the preview)',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.solo = this.solo === i ? null : i;
          this.pushSounds();
          this.scheduleRestart(s);
          this.refreshEditor();
        },
      });
      tabs.append(
        el(
          'div',
          {
            class: `chan-tab${selected ? ' active' : ''}${this.silent(i) ? ' silent' : ''}`,
            title: 'Edit this channel',
            onclick: () => {
              this.channel = i;
              this.refreshEditor();
            },
          },
          el('span', { class: 'chan-dot', style: `background:${CHANNEL_COLORS[i % CHANNEL_COLORS.length]}` }),
          el('span', { class: 'chan-name', text: `${i + 1} ${c.wave === 'noise' ? 'drums' : c.wave}` }),
          mute,
          solo,
        ),
      );
    });
    if (m.channels.length < MAX_CHANNELS) {
      tabs.append(
        el('button', {
          class: 'chan-add',
          text: '+',
          title: 'Add a channel',
          onclick: () => {
            this.edit(s, (tune) => {
              tune.channels.push({ wave: 'square', volume: 0.5, octave: 0, steps: new Array<number>(tune.stepCount).fill(-1) });
            });
            this.channel = m.channels.length - 1;
            this.refreshEditor();
          },
        }),
      );
    }
    this.editorEl.append(tabs);

    // ---- the channel: instrument, octave, how long a note lasts, volume
    const ch = this.currentChannel(m);
    const wave = el('select', { title: 'The instrument of this channel' });
    for (const w of MUSIC_WAVES) wave.append(el('option', { value: w.value, text: w.label, selected: w.value === ch.wave }));
    wave.addEventListener('change', () => {
      const v = wave.value as MusicWave;
      this.edit(s, (tune) => {
        this.currentChannel(tune).wave = v;
      });
      this.refreshEditor();
    });
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(ch.volume), title: 'How loud this channel is in the mix' });
    let volBefore = JSON.stringify(m);
    vol.addEventListener('pointerdown', () => {
      volBefore = JSON.stringify(m);
    });
    vol.addEventListener('input', () => {
      ch.volume = parseFloat(vol.value);
    });
    vol.addEventListener('change', () => {
      if (JSON.stringify(m) !== volBefore) this.remember(s, volBefore);
      this.changed();
      this.scheduleRestart(s);
    });
    const oct = el('select', { title: 'Move the whole channel up or down by octaves' });
    for (const o of [-2, -1, 0, 1, 2]) oct.append(el('option', { value: String(o), text: o === 0 ? 'octave 0' : `octave ${o > 0 ? '+' : ''}${o}`, selected: o === ch.octave }));
    oct.addEventListener('change', () => {
      const v = parseInt(oct.value, 10);
      this.edit(s, (tune) => {
        this.currentChannel(tune).octave = v;
      });
      this.refreshEditor();
    });
    const holdNow = channelLength(ch);
    const hold = el('select', { title: 'How many steps a note lasts. A piano rings for that long, a pad swells and fades over it, chip notes fill it.' });
    for (const n of NOTE_LENGTHS.includes(holdNow) ? NOTE_LENGTHS : [...NOTE_LENGTHS, holdNow].sort((a, b) => a - b)) {
      hold.append(el('option', { value: String(n), text: n === 1 ? 'note: 1 step' : `note: ${n} steps`, selected: n === holdNow }));
    }
    hold.addEventListener('change', () => {
      const n = parseInt(hold.value, 10);
      this.edit(s, (tune) => {
        const c = this.currentChannel(tune);
        if (n === DEFAULT_NOTE_LENGTH[c.wave]) delete c.length;
        else c.length = n;
      });
      this.refreshEditor();
    });
    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar' },
        wave,
        oct,
        ...(ch.wave === 'noise' ? [] : [hold]),
        labeled('Volume', vol),
        el('span', { class: 'spacer' }),
        m.channels.length > 1
          ? el('button', {
              class: 'btn danger',
              text: 'Remove channel',
              onclick: () => {
                const index = Math.min(this.channel, m.channels.length - 1);
                this.muted.clear();
                this.solo = null;
                this.edit(s, (tune) => {
                  tune.channels.splice(index, 1);
                });
                this.channel = 0;
                this.refreshEditor();
              },
            })
          : el('span'),
      ),
    );

    // ---- the bar tools
    this.scopeEl = el('span', { class: 'scope-label', text: '' });
    const tool = (text: string, title: string, run: () => void, barOnly = false) => {
      const b = el('button', { class: 'btn', text, title, onclick: run });
      if (barOnly) b.setAttribute('data-bar-only', '');
      return b;
    };
    const len = SCALES[m.scale].length;
    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar edit-bar' },
        el('span', { class: 'muted', text: 'Edit' }),
        this.scopeEl,
        tool('Copy', 'Copy the selected bar (Ctrl/Cmd+C)', () => this.copyBar(s), true),
        tool('Paste', 'Paste into the selected bar (Ctrl/Cmd+V)', () => this.pasteBar(s), true),
        tool('Repeat →', 'Copy the selected bar over every bar after it', () => {
          const bar = this.barSel;
          if (bar !== null) this.edit(s, (tune) => repeatBar(this.currentChannel(tune), tune, bar));
        }, true),
        tool('Clear', 'Take the notes out (Delete)', () => this.clearSelection(s)),
        el('span', { class: 'bar-sep' }),
        tool('↑', 'One step up the scale (Arrow up)', () => this.transpose(s, 1)),
        tool('↓', 'One step down the scale (Arrow down)', () => this.transpose(s, -1)),
        tool('⇑ octave', 'An octave up (Shift+Arrow up)', () => this.transpose(s, len)),
        tool('⇓ octave', 'An octave down (Shift+Arrow down)', () => this.transpose(s, -len)),
        el('span', { class: 'bar-sep' }),
        tool('←', 'Move the notes one step earlier (Alt+Arrow left)', () => this.nudge(s, -1)),
        tool('→', 'Move the notes one step later (Alt+Arrow right)', () => this.nudge(s, 1)),
      ),
    );
    this.updateScope(s);

    // ---- the roll
    this.rollView = {
      music: m,
      channel: Math.min(this.channel, m.channels.length - 1),
      bar: this.barSel !== null && this.barSel < barCount(m) ? this.barSel : null,
      silent: (i) => this.silent(i),
      showOthers: this.showOthers,
      cell: this.cellWidth(m),
    };
    this.barSel = this.rollView.bar;
    this.roll = new MusicRoll(this.rollView, {
      beforeEdit: () => {
        this.pendingBefore = JSON.stringify(m);
      },
      edited: () => {
        if (this.pendingBefore !== null && this.pendingBefore !== JSON.stringify(m)) this.remember(s, this.pendingBefore);
        this.pendingBefore = null;
        this.changed();
        this.scheduleRestart(s);
      },
      audition: (degree) => this.audition(m, this.currentChannel(m), degree),
      selectBar: (bar) => this.selectBar(s, bar),
    });
    this.statusEl = el('div', { class: 'muted audio-hint', text: BAR_HINT });
    this.editorEl.append(this.roll.el, this.statusEl);
    const kept = this.keptScroll;
    if (kept) requestAnimationFrame(() => this.roll?.restoreScroll(kept));
  }

  /** Hear one note of a channel, on top of whatever plays (a one-note tune, played once). */
  private audition(m: MusicData, ch: MusicChannel, degree: number): void {
    const drums = ch.wave === 'noise';
    const stepCount = drums ? 6 : Math.ceil(channelLength(ch) * 2.2) + 28;
    const note: MusicData = {
      bpm: m.bpm,
      stepCount,
      root: m.root,
      scale: m.scale,
      channels: [{ ...ch, volume: Math.max(0.35, ch.volume), steps: [degree, ...new Array<number>(stepCount - 1).fill(-1)] }],
    };
    const id = '__audition__';
    this.engine.setSounds([...this.previewSounds(), { id, name: 'audition', kind: 'music', volume: 0.7, music: note }], 1);
    this.engine.resume();
    this.engine.play(id);
  }
}
