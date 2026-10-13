// Editing a tune bar by bar: copy, paste, clear, repeat, move up and down the scale. Pure functions on the
// channels of a `MusicData`, so the Audio tab (and the tests) can use them without a DOM.

import { type MusicChannel, type MusicData, SCALES, degreeCount } from './music';

/** Steps in a bar (the steps are sixteenth notes of 4/4). */
export const BAR_STEPS = 16;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "A4" for a MIDI note number (60 = C4). */
export function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** The MIDI note a scale degree of a channel sounds at. */
export function degreeMidi(m: MusicData, degree: number, octave: number): number {
  const scale = SCALES[m.scale];
  return m.root + scale[degree % scale.length]! + 12 * (Math.floor(degree / scale.length) + octave);
}

export function barCount(m: MusicData): number {
  return Math.max(1, Math.ceil(m.stepCount / BAR_STEPS));
}

/** First step (included) and last step (excluded) of a bar; the last bar of a loop shorter than a bar is cut short. */
export function barRange(m: MusicData, bar: number): [number, number] {
  const b = Math.max(0, Math.min(Math.floor(bar), barCount(m) - 1));
  return [b * BAR_STEPS, Math.min(m.stepCount, (b + 1) * BAR_STEPS)];
}

/** Where a step is: bar, beat and the sixteenth within the beat (all counted from 0). */
export function stepPosition(step: number): { bar: number; beat: number; sub: number } {
  return { bar: Math.floor(step / BAR_STEPS), beat: Math.floor((step % BAR_STEPS) / 4), sub: step % 4 };
}

export function copyRange(ch: MusicChannel, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(ch.steps[i] ?? -1);
  return out;
}

/** Writes the steps in `data` from `from` on, as far as they fit before `limit`. */
export function pasteRange(ch: MusicChannel, from: number, data: number[], limit: number): void {
  for (let i = 0; i < data.length && from + i < limit; i++) ch.steps[from + i] = data[i]!;
}

export function clearRange(ch: MusicChannel, from: number, to: number): void {
  for (let i = from; i < to; i++) ch.steps[i] = -1;
}

/** Copies a bar over every bar after it (to fill a longer loop with a pattern). */
export function repeatBar(ch: MusicChannel, m: MusicData, bar: number): void {
  const [from, to] = barRange(m, bar);
  const data = copyRange(ch, from, to);
  for (let start = to; start < m.stepCount; start += BAR_STEPS) pasteRange(ch, start, data, m.stepCount);
}

/**
 * Moves the notes of a range up or down the scale by `delta` degrees. All or nothing: when a note would leave the
 * rows of the channel nothing moves and false is returned (the melody would otherwise fold on itself). Drums have
 * no pitch, they are left alone.
 */
export function transposeRange(ch: MusicChannel, m: MusicData, from: number, to: number, delta: number): boolean {
  if (ch.wave === 'noise' || delta === 0) return false;
  const top = degreeCount(m.scale);
  for (let i = from; i < to; i++) {
    const d = ch.steps[i] ?? -1;
    if (d >= 0 && (d + delta < 0 || d + delta >= top)) return false;
  }
  let moved = false;
  for (let i = from; i < to; i++) {
    const d = ch.steps[i] ?? -1;
    if (d >= 0) {
      ch.steps[i] = d + delta;
      moved = true;
    }
  }
  return moved;
}

/** Moves the notes of a range by whole steps; what leaves one end comes back at the other. */
export function nudgeRange(ch: MusicChannel, from: number, to: number, delta: number): void {
  const n = to - from;
  if (n <= 0 || delta % n === 0) return;
  const data = copyRange(ch, from, to);
  for (let i = 0; i < n; i++) ch.steps[from + ((i + delta) % n + n) % n] = data[i]!;
}

/** Notes in a range (a channel that is silent there has none). */
export function noteCount(ch: MusicChannel, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if ((ch.steps[i] ?? -1) >= 0) n++;
  return n;
}

/**
 * How many steps the note that starts at `step` is drawn for: its length, as far as the end of the loop. Notes ring
 * on after the next one has begun (a piano, a pad), so a note is not cut short by its neighbour.
 */
export function noteSpan(m: MusicData, step: number, length: number): number {
  return Math.max(1, Math.min(m.stepCount - step, Math.round(length)));
}
