import { describe, expect, it } from 'vitest';
import { ambientMusic } from '../src/core/ambient';
import {
  DEFAULT_NOTE_LENGTH,
  MAX_CHANNELS,
  type MusicData,
  channelLength,
  degreeCount,
  emptyMusic,
  musicDuration,
  normalizeMusic,
  renderMusic,
} from '../src/core/music';
import { SOUND_IDS, builtInSound, normalizeSounds } from '../src/core/sounds';
import { createDefaultProject, normalizeProject } from '../src/core/types';

const rate = 8000;

function peak(d: Float32Array): number {
  let p = 0;
  for (const v of d) p = Math.max(p, Math.abs(v));
  return p;
}

function rms(d: Float32Array, from = 0, to = d.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i]! * d[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** One note on one channel, in a loop of `steps` steps at 120 bpm (a step is 0.125 s). */
function oneNote(wave: MusicData['channels'][number]['wave'], steps = 64, extra: Partial<MusicData> = {}, length?: number): MusicData {
  const m = emptyMusic();
  m.stepCount = steps;
  m.channels = [{ wave, volume: 0.8, octave: 0, ...(length ? { length } : {}), steps: [5, ...new Array<number>(steps - 1).fill(-1)] }];
  return { ...m, ...extra };
}

describe('soft instruments', () => {
  it('a piano note rings and then dies away', () => {
    const d = renderMusic(oneNote('piano'), rate);
    const second = Math.floor(rate * 0.125);
    const early = rms(d, 0, second * 4);
    const late = rms(d, second * 16, second * 20);
    expect(early).toBeGreaterThan(0.02);
    expect(late).toBeLessThan(early * 0.5);
    // gone well before the loop is over
    expect(rms(d, Math.floor(d.length * 0.8))).toBeLessThan(0.002);
  });

  it('a longer note rings longer', () => {
    const short = renderMusic(oneNote('piano', 64, {}, 2), rate);
    const long = renderMusic(oneNote('piano', 64, {}, 16), rate);
    const at = Math.floor(rate * 0.125 * 8);
    expect(rms(long, at, at * 2)).toBeGreaterThan(rms(short, at, at * 2) * 3);
  });

  it('a pad swells in instead of striking', () => {
    const d = renderMusic(oneNote('pad', 64, {}, 16), rate);
    const first = rms(d, 0, Math.floor(rate * 0.05));
    const mid = rms(d, Math.floor(rate * 1), Math.floor(rate * 1.5));
    expect(mid).toBeGreaterThan(first * 5);
  });

  it('a bell is bright and short', () => {
    const d = renderMusic(oneNote('bell'), rate);
    expect(rms(d, 0, Math.floor(rate * 0.2))).toBeGreaterThan(0.02);
    expect(rms(d, Math.floor(d.length * 0.7))).toBeLessThan(0.002);
  });

  it('every instrument stays inside -1..1 and the length of the wave defaults are used', () => {
    for (const wave of ['square', 'triangle', 'saw', 'sine', 'piano', 'bell', 'pad'] as const) {
      const m = oneNote(wave, 32);
      const d = renderMusic(m, rate);
      expect(peak(d)).toBeLessThanOrEqual(1);
      expect(peak(d)).toBeGreaterThan(0.01);
      expect(channelLength(m.channels[0]!)).toBe(DEFAULT_NOTE_LENGTH[wave]);
    }
  });

  it('chip notes can be held for several steps', () => {
    const one = renderMusic(oneNote('square', 16, {}, 1), rate);
    const four = renderMusic(oneNote('square', 16, {}, 4), rate);
    const step = Math.floor(rate * 0.125);
    expect(rms(one, step * 2, step * 4)).toBe(0);
    expect(rms(four, step * 2, step * 4)).toBeGreaterThan(0.05);
  });
});

describe('reverb', () => {
  it('fills the silence after a note and wraps around the loop', () => {
    const dry = renderMusic(oneNote('bell', 64), rate);
    const wet = renderMusic(oneNote('bell', 64, { reverb: 1 }), rate);
    // the bell is over after 1.4 s; the room is still ringing a little later
    const from = Math.floor(rate * 1.6);
    expect(rms(dry, from, from + 2000)).toBeLessThan(0.0005);
    expect(rms(wet, from, from + 2000)).toBeGreaterThan(0.0015);
    // the end of the loop leads on into the start without a jump
    expect(Math.abs(wet[0]! - wet[wet.length - 1]!)).toBeLessThan(0.05);
  });

  it('nothing changes for a tune without it', () => {
    const m = oneNote('square', 16);
    const a = renderMusic(m, rate);
    const b = renderMusic({ ...m, reverb: 0 }, rate);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe('music data', () => {
  it('keeps longer loops, the new instruments, the length and the room', () => {
    const m = normalizeMusic({
      stepCount: 512,
      reverb: 0.4,
      channels: [
        { wave: 'piano', steps: [3], length: 8 },
        { wave: 'pad', steps: [], length: 4 },
        { wave: 'bell', steps: [], length: 99 },
      ],
    });
    expect(m.stepCount).toBe(512);
    expect(m.reverb).toBe(0.4);
    expect(m.channels.map((c) => c.wave)).toEqual(['piano', 'pad', 'bell']);
    // the length of the wave is not stored; another one is
    expect(m.channels[0]!.length).toBeUndefined();
    expect(m.channels[1]!.length).toBe(4);
    expect(m.channels[2]!.length).toBe(64);
    expect(m.channels[0]!.steps).toHaveLength(512);
    expect(normalizeMusic({ stepCount: 100 }).stepCount).toBe(16);
    expect(normalizeMusic({ channels: new Array(20).fill({ wave: 'sine', steps: [] }) }).channels).toHaveLength(MAX_CHANNELS);
    expect('reverb' in normalizeMusic({ reverb: 0 })).toBe(false);
  });

  it('older tunes load as they were', () => {
    const m = normalizeMusic({ bpm: 120, stepCount: 16, root: 57, scale: 'pentatonic', channels: [{ wave: 'square', volume: 0.5, octave: 1, steps: [0, 1] }] });
    expect(m.channels[0]).toEqual({ wave: 'square', volume: 0.5, octave: 1, steps: [0, 1, ...new Array(14).fill(-1)] });
    expect(m.reverb).toBeUndefined();
  });
});

describe('the main theme', () => {
  const theme = ambientMusic(0);

  it('is calm, spacious and long', () => {
    expect(theme.stepCount).toBe(512);
    expect(theme.bpm).toBeLessThanOrEqual(70);
    expect(musicDuration(theme)).toBeGreaterThan(100);
    expect(theme.reverb).toBeGreaterThan(0.4);
    expect(theme.channels.length).toBeLessThanOrEqual(MAX_CHANNELS);
    const waves = new Set(theme.channels.map((c) => c.wave));
    expect(waves.has('piano') && waves.has('pad') && waves.has('bell')).toBe(true);
    expect(waves.has('noise')).toBe(false);
  });

  it('is sparse: the melody has long silences', () => {
    const melody = theme.channels[0]!;
    const notes = melody.steps.filter((s) => s >= 0).length;
    expect(notes).toBeGreaterThan(30);
    expect(notes).toBeLessThan(512 / 5);
  });

  it('uses only notes that exist, and is the same every time', () => {
    const top = degreeCount(theme.scale);
    for (const c of theme.channels) {
      expect(c.steps).toHaveLength(512);
      for (const s of c.steps) expect(s >= -1 && s < top).toBe(true);
    }
    expect(ambientMusic(0)).toEqual(theme);
    expect(ambientMusic(3)).not.toEqual(theme);
    // an ordinary tune of the project: loading it again does not change it
    expect(normalizeMusic(theme)).toEqual(theme);
  });

  it('renders as a smooth loop with soft, even loudness', () => {
    const d = renderMusic(theme, 11025);
    expect(d.length).toBe(Math.round((60 / (theme.bpm * 4)) * 11025) * 512);
    expect(peak(d)).toBeLessThanOrEqual(0.93);
    expect(rms(d)).toBeGreaterThan(0.04);
    expect(Math.abs(d[0]! - d[d.length - 1]!)).toBeLessThan(0.1);
    // no stretch of ten seconds is empty
    const win = 11025 * 10;
    for (let i = 0; i + win <= d.length; i += win) expect(rms(d, i, i + win)).toBeGreaterThan(0.02);
  });

  it('is what the built-in theme sound is, and fits in a project file', () => {
    const sound = builtInSound(SOUND_IDS.theme)!;
    expect(sound.kind).toBe('music');
    expect(sound.music).toEqual(theme);
    expect(createDefaultProject().sounds.find((s) => s.id === SOUND_IDS.theme)?.music).toEqual(theme);
    expect(JSON.stringify(sound).length).toBeLessThan(40_000);
    // it survives saving and loading
    const again = normalizeSounds(JSON.parse(JSON.stringify([sound])), () => 'x')[0]!;
    expect(again.music).toEqual(theme);
    const p = normalizeProject(JSON.parse(JSON.stringify(createDefaultProject())));
    expect(p.sounds.find((s) => s.id === SOUND_IDS.theme)?.music).toEqual(theme);
  });
});
