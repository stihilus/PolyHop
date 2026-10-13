// A tiny music sequencer: a loop of up to 512 steps on a few channels, rendered to samples. Chip sounds
// (square, triangle, saw) for lively tunes, and soft instruments (piano, bell, pad) with a bit of room
// (reverb) for calm, spacious music. Meant for background tunes that fit a platformer, not for a studio.

import { mulberry } from './sfx';

export type MusicWave = 'square' | 'triangle' | 'saw' | 'noise' | 'sine' | 'piano' | 'bell' | 'pad';

export const MUSIC_WAVES: { value: MusicWave; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'saw', label: 'Sawtooth' },
  { value: 'sine', label: 'Sine' },
  { value: 'piano', label: 'Soft piano' },
  { value: 'bell', label: 'Bell' },
  { value: 'pad', label: 'Pad (slow, soft)' },
  { value: 'noise', label: 'Noise (drums)' },
];

/** How many steps a note lasts when a channel does not say: a piano rings, a pad swells, chip notes fill a step. */
export const DEFAULT_NOTE_LENGTH: Record<MusicWave, number> = {
  square: 1,
  triangle: 1,
  saw: 1,
  sine: 1,
  noise: 1,
  piano: 8,
  bell: 8,
  pad: 16,
};

/** Loop lengths the editor offers (steps are sixteenth notes: 16 steps = one bar of 4/4). */
export const STEP_COUNTS: readonly number[] = [8, 16, 32, 64, 128, 256, 512];
export const MAX_CHANNELS = 8;
export const NOTE_LENGTHS: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

export type ScaleName = 'major' | 'minor' | 'pentatonic' | 'blues';

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

/** Rows shown in the editor: scale degrees, lowest first, over two octaves. */
export function degreeCount(scale: ScaleName): number {
  return SCALES[scale].length * 2;
}

export interface MusicChannel {
  wave: MusicWave;
  volume: number;
  /** Octave shift of the whole channel (-2..2). */
  octave: number;
  /** How many steps a note lasts (rings, or is held before it fades). Left out: `DEFAULT_NOTE_LENGTH` of the wave. */
  length?: number;
  /** One entry per step: -1 for silence, else the scale degree (0 = root, going up through two octaves). */
  steps: number[];
}

export interface MusicData {
  bpm: number;
  stepCount: number;
  /** MIDI note of the root (60 = middle C). */
  root: number;
  scale: ScaleName;
  channels: MusicChannel[];
  /** The size of the room the music is in, 0..1 (an echo that fills the gaps). Left out: none. */
  reverb?: number;
}

/** Steps a note of the channel lasts. */
export function channelLength(ch: MusicChannel): number {
  return ch.length ?? DEFAULT_NOTE_LENGTH[ch.wave];
}

export function emptyMusic(): MusicData {
  const rest = (n: number) => new Array<number>(n).fill(-1);
  return {
    bpm: 120,
    stepCount: 16,
    root: 57, // A3
    scale: 'pentatonic',
    channels: [
      { wave: 'square', volume: 0.5, octave: 1, steps: rest(16) },
      { wave: 'triangle', volume: 0.7, octave: -1, steps: rest(16) },
      { wave: 'noise', volume: 0.4, octave: 0, steps: rest(16) },
    ],
  };
}

/** A simple tune, so a new track is not silent: bass on the beat, a wandering lead, light drums. */
export function randomMusic(seed: number, scale: ScaleName = 'pentatonic'): MusicData {
  const r = mulberry(seed * 31 + 5);
  const m = emptyMusic();
  m.scale = scale;
  m.bpm = 100 + Math.floor(r() * 5) * 8;
  const top = degreeCount(scale);
  // lead: a motif of 4 steps that repeats with small changes
  const motif = Array.from({ length: 4 }, () => (r() < 0.2 ? -1 : Math.floor(r() * (top - 2)) + 2));
  const lead = m.channels[0]!;
  for (let i = 0; i < m.stepCount; i++) {
    const v = motif[i % 4]!;
    lead.steps[i] = i % 8 === 7 && r() < 0.5 ? -1 : v >= 0 && r() < 0.15 ? Math.min(top - 1, v + 1) : v;
  }
  // bass: root and fifth on the beat
  const bass = m.channels[1]!;
  for (let i = 0; i < m.stepCount; i += 4) bass.steps[i] = i % 8 === 0 ? 0 : Math.min(top - 1, Math.floor(SCALES[scale].length / 2));
  // drums: kick on 1 and 3 (degree 0), hat on the off-beats (degree 2)
  const drums = m.channels[2]!;
  for (let i = 0; i < m.stepCount; i += 4) drums.steps[i] = 0;
  for (let i = 2; i < m.stepCount; i += 4) drums.steps[i] = 2;
  return m;
}

/** Frequency of a scale degree of a channel. */
export function degreeFrequency(m: MusicData, degree: number, octave: number): number {
  const scale = SCALES[m.scale];
  const oct = Math.floor(degree / scale.length);
  const note = m.root + scale[degree % scale.length]! + 12 * (oct + octave);
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function musicDuration(m: MusicData): number {
  return (m.stepCount * 60) / (m.bpm * 4);
}

const SINE_TABLE_SIZE = 4096;
const SINE_TABLE = (() => {
  const t = new Float32Array(SINE_TABLE_SIZE + 1);
  for (let i = 0; i <= SINE_TABLE_SIZE; i++) t[i] = Math.sin((i / SINE_TABLE_SIZE) * 2 * Math.PI);
  return t;
})();

/** sin of a phase given in cycles (any real number), from a table. */
function sine(phase: number): number {
  const p = phase - Math.floor(phase);
  const x = p * SINE_TABLE_SIZE;
  const i = x | 0;
  const f = x - i;
  return SINE_TABLE[i]! + (SINE_TABLE[i + 1]! - SINE_TABLE[i]!) * f;
}

/** A struck string: a soft attack, then it dies away; the higher partials faster than the low one. */
function addPiano(out: Float32Array, start: number, freq: number, holdSeconds: number, gain: number, sampleRate: number): void {
  const total = out.length;
  const len = Math.max(1, Math.floor(holdSeconds * 1.5 * sampleRate));
  const tau = Math.max(0.15, holdSeconds / 2.5);
  const dec = (t: number) => Math.exp(-1 / (t * sampleRate));
  const dBody = dec(tau);
  const dHammer = dec(Math.min(0.14, tau * 0.3));
  const d2 = dec(tau * 0.5);
  const d3 = dec(tau * 0.3);
  const dAtt = dec(0.004);
  let body = 1;
  let hammer = 1;
  let e2 = 1;
  let e3 = 1;
  let att = 1;
  let phase = 0;
  const step = freq / sampleRate;
  const taper = Math.floor(len * 0.12);
  for (let i = 0; i < len; i++) {
    phase += step;
    const tone = sine(phase) + 0.32 * e2 * sine(phase * 2) + 0.12 * e3 * sine(phase * 3) + 0.04 * e3 * sine(phase * 4);
    let v = tone * (0.72 * body + 0.28 * hammer) * (1 - att) * gain;
    if (i > len - taper) v *= (len - i) / taper;
    out[(start + i) % total]! += v;
    body *= dBody;
    hammer *= dHammer;
    e2 *= d2;
    e3 *= d3;
    att *= dAtt;
  }
}

/** A glockenspiel / music box: a pure tone with a few bright partials that ring out quickly. */
function addBell(out: Float32Array, start: number, freq: number, holdSeconds: number, gain: number, sampleRate: number): void {
  const total = out.length;
  const len = Math.max(1, Math.floor(holdSeconds * 1.4 * sampleRate));
  const tau = Math.max(0.2, holdSeconds / 3);
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.0, 0.26, 0.55],
    [2.76, 0.3, 0.4],
    [5.4, 0.1, 0.2],
  ];
  const dec = partials.map(([, , m]) => Math.exp(-1 / (tau * m * sampleRate)));
  const env = partials.map(() => 1);
  const dAtt = Math.exp(-1 / (0.002 * sampleRate));
  let att = 1;
  const taper = Math.floor(len * 0.12);
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (let k = 0; k < partials.length; k++) {
      const [ratio, amp] = partials[k]!;
      v += sine((i / sampleRate) * freq * ratio) * amp * env[k]!;
      env[k] = env[k]! * dec[k]!;
    }
    v *= (1 - att) * gain * 0.8;
    if (i > len - taper) v *= (len - i) / taper;
    out[(start + i) % total]! += v;
    att *= dAtt;
  }
}

/** A slow, soft swell: two slightly detuned tones that fade in, hold, and fade out. */
function addPad(out: Float32Array, start: number, freq: number, holdSeconds: number, gain: number, sampleRate: number): void {
  const total = out.length;
  const attack = Math.min(2.2, holdSeconds * 0.3);
  const release = Math.min(3, holdSeconds * 0.4);
  const len = Math.max(1, Math.floor((holdSeconds + release) * sampleRate));
  const holdEnd = holdSeconds * sampleRate;
  const attackN = Math.max(1, attack * sampleRate);
  const releaseN = Math.max(1, release * sampleRate);
  let p1 = 0;
  let p2 = 0.37;
  const f1 = freq / sampleRate;
  const f2 = (freq * 1.0016) / sampleRate;
  for (let i = 0; i < len; i++) {
    p1 += f1;
    p2 += f2;
    let env = 1;
    if (i < attackN) {
      const x = Math.sin((Math.PI / 2) * (i / attackN));
      env = x * x;
    } else if (i > holdEnd) {
      const x = Math.cos((Math.PI / 2) * Math.min(1, (i - holdEnd) / releaseN));
      env = x * x;
    }
    const tone = 0.55 * sine(p1) + 0.55 * sine(p2) + 0.18 * sine(p1 * 2) + 0.08 * sine(p2 * 3);
    out[(start + i) % total]! += tone * env * gain * 0.7;
  }
}

/**
 * A room: eight echoes that are slightly different and a few smears, so the notes ring on and fill the
 * gaps. The loop is run through twice and the second round is kept, so the tail of the last notes
 * runs into the beginning of the loop and there is no seam.
 */
function addReverb(buf: Float32Array, sampleRate: number, amount: number): void {
  const wet = 0.5 * amount;
  const feedback = 0.74 + 0.18 * amount;
  const damp = 0.4;
  const make = (ms: number) => ({ buf: new Float32Array(Math.max(1, Math.round((ms / 1000) * sampleRate))), idx: 0, lp: 0 });
  const combs = [35.3, 37.7, 40.1, 42.9, 45.1, 47.3, 50.3, 53.9].map(make);
  const smears = [12.6, 9.8, 6.5].map(make);
  const n = buf.length;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = buf[i]! * 0.16;
      let sum = 0;
      for (const c of combs) {
        const y = c.buf[c.idx]!;
        c.lp = y * (1 - damp) + c.lp * damp;
        c.buf[c.idx] = x + c.lp * feedback;
        c.idx = c.idx + 1 === c.buf.length ? 0 : c.idx + 1;
        sum += y;
      }
      let w = sum;
      for (const a of smears) {
        const b = a.buf[a.idx]!;
        const o = b - w;
        a.buf[a.idx] = w + b * 0.5;
        a.idx = a.idx + 1 === a.buf.length ? 0 : a.idx + 1;
        w = o;
      }
      if (pass === 1) buf[i] = buf[i]! + w * wet;
    }
  }
}

/** The loop as mono samples in -1..1 (a short tail wraps around so the loop is seamless). */
export function renderMusic(m: MusicData, sampleRate = 22050): Float32Array {
  const stepSeconds = 60 / (m.bpm * 4);
  const stepSamples = Math.max(1, Math.round(stepSeconds * sampleRate));
  const total = stepSamples * m.stepCount;
  const out = new Float32Array(total);
  const rnd = mulberry(7);
  // each soft note is a little louder or softer than the one before, so repeated notes do not sound machine-made
  const velocity = mulberry(11);
  const soft = (m.reverb ?? 0) > 0 || m.channels.some((c) => c.wave === 'piano' || c.wave === 'bell' || c.wave === 'pad');
  for (const ch of m.channels) {
    const hold = Math.max(1, channelLength(ch));
    for (let s = 0; s < m.stepCount; s++) {
      const degree = ch.steps[s];
      if (degree === undefined || degree < 0) continue;
      const start = s * stepSamples;
      if (ch.wave === 'noise') {
        // drums: degree 0 a low thump, 1 a snare burst, higher a short hat
        const length = Math.floor(stepSamples * (degree === 0 ? 0.9 : degree === 1 ? 0.7 : 0.25));
        let lp = 0;
        for (let i = 0; i < length; i++) {
          const t = i / length;
          const env = (1 - t) * (1 - t);
          let v: number;
          if (degree === 0) {
            const f = 120 * (1 - t * 0.8);
            v = Math.sin(((i / sampleRate) * 2 * Math.PI) * f * (1 + 4 * (1 - t))) * env;
          } else {
            const white = rnd() * 2 - 1;
            lp += (white - lp) * (degree === 1 ? 0.5 : 0.95);
            v = lp * env;
          }
          out[(start + i) % total]! += v * ch.volume * 0.5;
        }
        continue;
      }
      const freq = degreeFrequency(m, degree, ch.octave);
      if (ch.wave === 'piano' || ch.wave === 'bell' || ch.wave === 'pad') {
        const seconds = hold * stepSeconds;
        const gain = ch.volume * 0.5 * (0.78 + 0.22 * velocity());
        if (ch.wave === 'piano') addPiano(out, start, freq, seconds, gain, sampleRate);
        else if (ch.wave === 'bell') addBell(out, start, freq, seconds, gain, sampleRate);
        else addPad(out, start, freq, seconds, gain, sampleRate);
        continue;
      }
      // chip notes: held for almost the whole length, then a short release
      const length = Math.floor(stepSamples * hold * 0.95);
      let phase = 0;
      for (let i = 0; i < length; i++) {
        phase += freq / sampleRate;
        phase -= Math.floor(phase);
        let v = 0;
        switch (ch.wave) {
          case 'square':
            v = phase < 0.5 ? 0.6 : -0.6;
            break;
          case 'saw':
            v = (1 - phase * 2) * 0.6;
            break;
          case 'triangle':
            v = (phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4) * 0.9;
            break;
          case 'sine':
            v = sine(phase) * 0.9;
            break;
        }
        const t = i / length;
        const attack = Math.min(1, i / (sampleRate * 0.004));
        const release = t > 0.8 ? (1 - t) / 0.2 : 1;
        out[(start + i) % total]! += v * attack * release * ch.volume * 0.35;
      }
    }
  }
  if ((m.reverb ?? 0) > 0) addReverb(out, sampleRate, Math.min(1, m.reverb!));
  if (soft) {
    // soft instruments pile up: bring the loudest moment under the ceiling instead of cutting it off
    let peak = 0;
    for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]!));
    if (peak > 0.92) {
      const k = 0.92 / peak;
      for (let i = 0; i < total; i++) out[i] = out[i]! * k;
    }
  }
  for (let i = 0; i < total; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
  return out;
}

export function normalizeMusic(raw: unknown): MusicData {
  const base = emptyMusic();
  const r = (raw ?? {}) as Partial<MusicData>;
  const scale: ScaleName = r.scale && r.scale in SCALES ? r.scale : base.scale;
  const stepCount = STEP_COUNTS.includes(r.stepCount as number) ? (r.stepCount as number) : 16;
  const top = degreeCount(scale);
  const channels: MusicChannel[] = [];
  for (const c of Array.isArray(r.channels) ? r.channels : base.channels) {
    const wave = MUSIC_WAVES.find((w) => w.value === c?.wave)?.value ?? 'square';
    const steps = Array.from({ length: stepCount }, (_, i) => {
      const v = c?.steps?.[i];
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(top - 1, Math.round(v))) : -1;
    });
    const length = typeof c?.length === 'number' && Number.isFinite(c.length) ? Math.max(1, Math.min(64, Math.round(c.length))) : undefined;
    channels.push({
      wave,
      volume: typeof c?.volume === 'number' ? Math.max(0, Math.min(1, c.volume)) : 0.5,
      octave: typeof c?.octave === 'number' ? Math.max(-2, Math.min(2, Math.round(c.octave))) : 0,
      // only kept when it differs from what the wave does anyway
      ...(length !== undefined && length !== DEFAULT_NOTE_LENGTH[wave] ? { length } : {}),
      steps,
    });
  }
  const reverb = typeof r.reverb === 'number' && Number.isFinite(r.reverb) ? Math.max(0, Math.min(1, r.reverb)) : 0;
  return {
    bpm: typeof r.bpm === 'number' ? Math.max(40, Math.min(240, r.bpm)) : base.bpm,
    stepCount,
    root: typeof r.root === 'number' ? Math.max(24, Math.min(96, Math.round(r.root))) : base.root,
    scale,
    channels: channels.length > 0 ? channels.slice(0, MAX_CHANNELS) : base.channels,
    ...(reverb > 0 ? { reverb } : {}),
  };
}
