import { ambientMusic } from '../core/ambient';
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
  degreeCount,
  musicDuration,
  normalizeMusic,
  randomMusic,
} from '../core/music';
import { SFX_KINDS, SFX_WAVES, type SfxKind, type SfxParams, type SfxWave, mutateSfx, renderSfx, sfxPreset } from '../core/sfx';
import { SOUND_IDS, type SoundAsset, builtInSound, newMusic, newSfx, soundDuration } from '../core/sounds';
import { newId } from '../core/types';
import { AudioEngine, bytesToBase64 } from '../runtime/audio';
import type { Store } from './store';
import { clear, el } from './ui/dom';
import { renameInline } from './ui/rename';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

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

const DRUM_ROWS = ['Kick', 'Snare', 'Hat'];

/** The Audio tab: make sound effects, tunes and bring in audio files. */
export class AudioEditor {
  readonly root: HTMLElement;
  private engine = new AudioEngine();
  private selectedId: string | null = null;
  private active = false;
  private channel = 0;
  private seedCounter = 1;
  private waveCanvas: HTMLCanvasElement | null = null;

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
        if (this.active) this.refreshAll();
      }
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('hidden', !active);
    if (!active) this.engine.stopMusic();
    else {
      if (!this.selected() && this.store.project.sounds.length > 0) this.selectedId = this.store.project.sounds[0]!.id;
      this.refreshAll();
    }
  }

  private get sounds(): SoundAsset[] {
    return this.store.project.sounds;
  }

  private selected(): SoundAsset | null {
    return this.sounds.find((s) => s.id === this.selectedId) ?? null;
  }

  /** The sounds changed: save, and let the preview engine pick the change up. */
  private changed(): void {
    this.engine.setSounds(this.sounds, 1);
    this.store.soundsChanged();
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
    this.engine.setSounds(this.sounds, 1);
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
    const play = el('button', { class: 'btn primary', text: s.kind === 'music' ? '▶ Play loop' : '▶ Play', onclick: () => this.play(s) });
    const stop = el('button', { class: 'btn', text: '■ Stop', onclick: () => this.engine.stopMusic() });
    this.editorEl.append(
      el('div', { class: 'audio-head' }, name, el('span', { class: 'muted', text: 'Volume' }), volume, play, stop),
      el('div', { class: 'muted audio-hint', text: this.usedBy(s) }),
    );

    if (s.kind === 'sfx' && s.sfx) this.buildSfx(s, s.sfx);
    else if (s.kind === 'music' && s.music) this.buildMusic(s, s.music);
    else if (s.kind === 'file' && s.file) {
      this.editorEl.append(
        el('div', { class: 'empty', text: `Imported file (${s.file.mime}, ${(s.file.data.length * 0.75 / 1024).toFixed(0)} KB). It plays as it is.` }),
      );
    }
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

  private play(s: SoundAsset): void {
    this.engine.setSounds(this.sounds, 1);
    this.engine.resume();
    if (s.kind === 'music') {
      this.engine.stopMusic();
      this.engine.playMusic(s.id);
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

    this.waveCanvas = el('canvas', { class: 'wave-canvas', width: 560, height: 90 });
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
    ctx.fillStyle = '#14161b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const data = renderSfx(p, 11025, seed);
    ctx.strokeStyle = '#ffb23e';
    ctx.beginPath();
    const mid = canvas.height / 2;
    const per = Math.max(1, data.length / canvas.width);
    for (let x = 0; x < canvas.width; x++) {
      let lo = 0;
      let hi = 0;
      const from = Math.floor(x * per);
      const to = Math.min(data.length, Math.floor((x + 1) * per) + 1);
      for (let i = from; i < to; i++) {
        lo = Math.min(lo, data[i]!);
        hi = Math.max(hi, data[i]!);
      }
      ctx.moveTo(x + 0.5, mid - hi * (mid - 4));
      ctx.lineTo(x + 0.5, mid - lo * (mid - 4) + 1);
    }
    ctx.stroke();
  }

  // ---------------------------------------------------------------- music

  private buildMusic(s: SoundAsset, m: MusicData): void {
    const bpm = el('input', { type: 'number', min: '40', max: '240', step: '4', value: String(m.bpm) });
    bpm.addEventListener('change', () => {
      m.bpm = Math.max(40, Math.min(240, parseFloat(bpm.value) || 120));
      this.changed();
      this.restartLoop(s);
    });
    const scale = el('select', {});
    for (const k of Object.keys(SCALES) as ScaleName[]) scale.append(el('option', { value: k, text: k, selected: k === m.scale }));
    scale.addEventListener('change', () => {
      s.music = normalizeMusic({ ...m, scale: scale.value });
      this.changed();
      this.refreshEditor();
      this.restartLoop(s);
    });
    const root = el('select', {});
    for (let n = 36; n <= 72; n++) root.append(el('option', { value: String(n), text: noteName(n), selected: n === m.root }));
    root.addEventListener('change', () => {
      m.root = parseInt(root.value, 10);
      this.changed();
      this.restartLoop(s);
    });
    const steps = el('select', { title: 'How long the loop is. 16 steps are one bar.' });
    for (const n of STEP_COUNTS) {
      const bars = n / 16;
      steps.append(el('option', { value: String(n), text: n < 16 ? `${n} steps` : `${n} steps (${bars} bar${bars === 1 ? '' : 's'})`, selected: n === m.stepCount }));
    }
    steps.addEventListener('change', () => {
      s.music = normalizeMusic({ ...m, stepCount: parseInt(steps.value, 10) });
      this.changed();
      this.refreshEditor();
    });
    const reverb = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(m.reverb ?? 0), title: 'The size of the room: an echo that fills the gaps between the notes' });
    reverb.addEventListener('input', () => {
      if (parseFloat(reverb.value) > 0) m.reverb = parseFloat(reverb.value);
      else delete m.reverb;
    });
    reverb.addEventListener('change', () => {
      this.changed();
      this.restartLoop(s);
    });

    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar' },
        el('span', { class: 'muted', text: 'Tempo' }),
        bpm,
        el('span', { class: 'muted', text: 'Scale' }),
        scale,
        el('span', { class: 'muted', text: 'Key' }),
        root,
        steps,
        el('span', { class: 'muted', text: 'Space' }),
        reverb,
        el('button', {
          class: 'btn',
          text: 'Random tune',
          title: 'A new simple tune on this scale',
          onclick: () => {
            s.music = randomMusic(this.seedCounter++, m.scale);
            this.changed();
            this.refreshEditor();
            this.restartLoop(s);
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Calm tune',
          title: 'A new slow, spacious tune: soft piano, bells and pads in a big room, about two minutes long',
          onclick: () => {
            s.music = ambientMusic(this.seedCounter++);
            this.changed();
            this.refreshEditor();
            this.restartLoop(s);
          },
        }),
        el('button', {
          class: 'btn',
          text: 'Clear',
          onclick: () => {
            for (const c of m.channels) c.steps = c.steps.map(() => -1);
            this.changed();
            this.refreshEditor();
            this.restartLoop(s);
          },
        }),
        el('span', { class: 'muted', text: `${formatLoop(musicDuration(m))} loop` }),
      ),
    );

    // channel tabs
    const tabs = el('div', { class: 'tabs music-tabs' });
    m.channels.forEach((c, i) => {
      tabs.append(
        el('button', {
          class: `tab${i === this.channel ? ' active' : ''}`,
          text: `${i + 1} ${c.wave === 'noise' ? 'drums' : c.wave}`,
          onclick: () => {
            this.channel = i;
            this.refreshEditor();
          },
        }),
      );
    });
    if (m.channels.length < MAX_CHANNELS) {
      tabs.append(
        el('button', {
          class: 'tab',
          text: '+',
          title: 'Add a channel',
          onclick: () => {
            m.channels.push({ wave: 'square', volume: 0.5, octave: 0, steps: new Array<number>(m.stepCount).fill(-1) });
            this.channel = m.channels.length - 1;
            this.changed();
            this.refreshEditor();
          },
        }),
      );
    }
    this.editorEl.append(tabs);

    const ch = m.channels[Math.min(this.channel, m.channels.length - 1)]!;
    const wave = el('select', {});
    for (const w of MUSIC_WAVES) wave.append(el('option', { value: w.value, text: w.label, selected: w.value === ch.wave }));
    wave.addEventListener('change', () => {
      ch.wave = wave.value as MusicWave;
      this.changed();
      this.refreshEditor();
      this.restartLoop(s);
    });
    const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(ch.volume) });
    vol.addEventListener('input', () => {
      ch.volume = parseFloat(vol.value);
    });
    vol.addEventListener('change', () => {
      this.changed();
      this.restartLoop(s);
    });
    const oct = el('select', {});
    for (const o of [-2, -1, 0, 1, 2]) oct.append(el('option', { value: String(o), text: o === 0 ? 'octave 0' : `octave ${o > 0 ? '+' : ''}${o}`, selected: o === ch.octave }));
    oct.addEventListener('change', () => {
      ch.octave = parseInt(oct.value, 10);
      this.changed();
      this.restartLoop(s);
    });
    const holdNow = channelLength(ch);
    const hold = el('select', {
      title: 'How many steps a note lasts. A piano rings for that long, a pad swells and fades over it, chip notes fill it.',
    });
    for (const n of NOTE_LENGTHS.includes(holdNow) ? NOTE_LENGTHS : [...NOTE_LENGTHS, holdNow].sort((a, b) => a - b)) {
      hold.append(el('option', { value: String(n), text: n === 1 ? 'note: 1 step' : `note: ${n} steps`, selected: n === holdNow }));
    }
    hold.addEventListener('change', () => {
      const n = parseInt(hold.value, 10);
      if (n === DEFAULT_NOTE_LENGTH[ch.wave]) delete ch.length;
      else ch.length = n;
      this.changed();
      this.restartLoop(s);
    });
    this.editorEl.append(
      el(
        'div',
        { class: 'music-bar' },
        wave,
        oct,
        ...(ch.wave === 'noise' ? [] : [hold]),
        el('span', { class: 'muted', text: 'Volume' }),
        vol,
        m.channels.length > 1
          ? el('button', {
              class: 'btn danger',
              text: 'Remove channel',
              onclick: () => {
                m.channels.splice(this.channel, 1);
                this.channel = 0;
                this.changed();
                this.refreshEditor();
                this.restartLoop(s);
              },
            })
          : el('span'),
      ),
      this.musicGrid(s, m, ch),
      el('div', {
        class: 'muted audio-hint',
        text:
          'Click a square to put a note there, click it again to remove it. Drums: kick, snare, hat. For calm music try Soft piano, Bell and Pad, a slow tempo, a long loop and some Space.',
      }),
    );
  }

  /** Re-render and keep playing if this tune is being previewed. */
  private restartLoop(s: SoundAsset): void {
    if (this.engine.musicId !== s.id) return;
    this.engine.setSounds(this.sounds, 1);
    this.engine.stopMusic();
    this.engine.playMusic(s.id);
  }

  private musicGrid(s: SoundAsset, m: MusicData, ch: MusicChannel): HTMLElement {
    const drums = ch.wave === 'noise';
    const rows = drums ? DRUM_ROWS.length : degreeCount(m.scale);
    // a long loop gets narrower columns, so a few bars fit on the screen
    const cell = m.stepCount <= 32 ? 26 : m.stepCount <= 128 ? 18 : 12;
    const rowH = 18;
    const canvas = el('canvas', { class: 'music-grid', width: m.stepCount * cell, height: rows * rowH });
    const draw = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#14161b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < rows; r++) {
        // row 0 (the root) is drawn at the bottom, like a piano roll
        const y = (rows - 1 - r) * rowH;
        ctx.fillStyle = r % (drums ? 1 : SCALES[m.scale].length) === 0 ? '#1d222c' : '#191c24';
        ctx.fillRect(0, y, canvas.width, rowH);
      }
      ctx.strokeStyle = '#2d323d';
      ctx.lineWidth = 1;
      for (let c = 0; c <= m.stepCount; c++) {
        ctx.beginPath();
        ctx.strokeStyle = c % 16 === 0 ? '#5a6272' : c % 4 === 0 ? '#3d4452' : '#262a33';
        ctx.moveTo(c * cell + 0.5, 0);
        ctx.lineTo(c * cell + 0.5, canvas.height);
        ctx.stroke();
      }
      for (let c = 0; c < m.stepCount; c++) {
        const deg = ch.steps[c] ?? -1;
        if (deg < 0 || deg >= rows) continue;
        ctx.fillStyle = '#ffb23e';
        ctx.fillRect(c * cell + 2, (rows - 1 - deg) * rowH + 2, Math.max(3, cell - 3), rowH - 3);
      }
      if (drums) {
        ctx.fillStyle = '#8a93a3';
        ctx.font = '11px "Departure Mono", monospace';
        DRUM_ROWS.forEach((label, r) => ctx.fillText(label, 4, (rows - 1 - r) * rowH + 13));
      }
    };
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const c = Math.floor(((e.clientX - rect.left) / rect.width) * m.stepCount);
      const r = rows - 1 - Math.floor(((e.clientY - rect.top) / rect.height) * rows);
      if (c < 0 || c >= m.stepCount || r < 0 || r >= rows) return;
      ch.steps[c] = ch.steps[c] === r ? -1 : r;
      draw();
      this.changed();
      this.restartLoop(s);
      // a short preview of the note: render a one-note pattern
      if (ch.steps[c]! >= 0 && this.engine.musicId !== s.id) this.preview(m, ch, ch.steps[c]!);
    });
    draw();
    return el('div', { class: 'music-grid-wrap' }, canvas);
  }

  /** Hear one note of a channel. */
  private preview(m: MusicData, ch: MusicChannel, degree: number): void {
    // long enough for a piano or a pad to ring out inside the preview loop
    const stepCount = 64;
    const one: MusicData = {
      ...m,
      stepCount,
      channels: [{ ...ch, volume: Math.max(0.3, ch.volume), steps: [degree, ...new Array<number>(stepCount - 1).fill(-1)] }],
    };
    const id = '__preview__';
    this.engine.setSounds([...this.sounds, { id, name: 'preview', kind: 'music', volume: 0.7, music: one }], 1);
    this.engine.resume();
    this.engine.stopMusic();
    this.engine.playMusic(id);
    const seconds = channelLength(ch) * (60 / (m.bpm * 4));
    window.setTimeout(() => {
      if (this.engine.musicId === id) this.engine.stopMusic();
      this.engine.setSounds(this.sounds, 1);
    }, ch.wave === 'noise' ? 300 : Math.min(3500, Math.max(300, seconds * 1000 * 1.3)));
  }
}
