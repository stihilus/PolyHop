import { describe, expect, it } from 'vitest';
import { type MusicChannel, type MusicData, emptyMusic, normalizeMusic } from '../src/core/music';
import {
  BAR_STEPS,
  barCount,
  barRange,
  clearRange,
  copyRange,
  degreeMidi,
  noteCount,
  noteName,
  noteSpan,
  nudgeRange,
  pasteRange,
  repeatBar,
  stepPosition,
  transposeRange,
} from '../src/core/musicEdit';

function tune(stepCount = 64): MusicData {
  return normalizeMusic({ ...emptyMusic(), stepCount, scale: 'major' });
}

describe('bars', () => {
  it('counts bars and cuts the last one short in a loop shorter than a bar', () => {
    expect(barCount(tune(64))).toBe(4);
    expect(barRange(tune(64), 1)).toEqual([16, 32]);
    expect(barRange(tune(64), 99)).toEqual([48, 64]);
    const short = normalizeMusic({ ...emptyMusic(), stepCount: 8 });
    expect(barCount(short)).toBe(1);
    expect(barRange(short, 0)).toEqual([0, 8]);
  });

  it('tells where a step is', () => {
    expect(stepPosition(0)).toEqual({ bar: 0, beat: 0, sub: 0 });
    expect(stepPosition(21)).toEqual({ bar: 1, beat: 1, sub: 1 });
    expect(BAR_STEPS).toBe(16);
  });
});

describe('note names', () => {
  it('names MIDI notes and the notes of the scale degrees', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(69)).toBe('A4');
    expect(noteName(61)).toBe('C#4');
    const m = tune();
    m.root = 57; // A3
    m.scale = 'major';
    expect(noteName(degreeMidi(m, 0, 0))).toBe('A3');
    expect(noteName(degreeMidi(m, 2, 0))).toBe('C#4');
    // one octave up in the scale (7 degrees) and with the octave of the channel
    expect(noteName(degreeMidi(m, 7, 0))).toBe('A4');
    expect(noteName(degreeMidi(m, 0, 1))).toBe('A4');
  });
});

describe('editing a range of a channel', () => {
  const channel = (steps: number[]): MusicChannel => ({ wave: 'square', volume: 0.5, octave: 0, steps });

  it('copies, pastes and clears', () => {
    const ch = channel(Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? i / 4 : -1)));
    const data = copyRange(ch, 0, 16);
    expect(data).toHaveLength(16);
    expect(data[4]).toBe(1);
    pasteRange(ch, 16, data, 32);
    expect(ch.steps[20]).toBe(1);
    // a paste does not run past the limit
    pasteRange(ch, 28, data, 32);
    expect(ch.steps).toHaveLength(32);
    clearRange(ch, 0, 16);
    expect(noteCount(ch, 0, 16)).toBe(0);
    expect(noteCount(ch, 16, 32)).toBeGreaterThan(0);
  });

  it('repeats a bar over the bars after it', () => {
    const m = tune(64);
    const ch = m.channels[0]!;
    ch.steps = new Array<number>(64).fill(-1);
    ch.steps[0] = 3;
    ch.steps[8] = 5;
    repeatBar(ch, m, 0);
    for (const start of [0, 16, 32, 48]) {
      expect(ch.steps[start]).toBe(3);
      expect(ch.steps[start + 8]).toBe(5);
    }
    // a bar in the middle only fills the bars after it
    const m2 = tune(64);
    const c2 = m2.channels[0]!;
    c2.steps = new Array<number>(64).fill(-1);
    c2.steps[16] = 2;
    repeatBar(c2, m2, 1);
    expect(c2.steps[0]).toBe(-1);
    expect(c2.steps[32]).toBe(2);
    expect(c2.steps[48]).toBe(2);
  });

  it('moves notes up and down the scale, all or nothing', () => {
    const m = tune(16);
    const ch = m.channels[0]!;
    ch.steps = new Array<number>(16).fill(-1);
    ch.steps[0] = 0;
    ch.steps[4] = 5;
    expect(transposeRange(ch, m, 0, 16, 2)).toBe(true);
    expect([ch.steps[0], ch.steps[4]]).toEqual([2, 7]);
    // the top row is degreeCount - 1 = 13: a note that would go past it stops the whole move
    ch.steps[8] = 13;
    expect(transposeRange(ch, m, 0, 16, 1)).toBe(false);
    expect([ch.steps[0], ch.steps[8]]).toEqual([2, 13]);
    // the bottom row too
    ch.steps[8] = -1;
    ch.steps[0] = 0;
    expect(transposeRange(ch, m, 0, 16, -1)).toBe(false);
    // nothing to move
    expect(transposeRange(channel(new Array<number>(16).fill(-1)), m, 0, 16, 1)).toBe(false);
  });

  it('leaves drums alone', () => {
    const m = tune(16);
    const drums: MusicChannel = { wave: 'noise', volume: 0.4, octave: 0, steps: new Array<number>(16).fill(-1) };
    drums.steps[0] = 0;
    expect(transposeRange(drums, m, 0, 16, 1)).toBe(false);
    expect(drums.steps[0]).toBe(0);
  });

  it('nudges notes by steps and wraps them round the range', () => {
    const ch = channel(new Array<number>(16).fill(-1));
    ch.steps[0] = 4;
    ch.steps[15] = 6;
    nudgeRange(ch, 0, 16, 1);
    expect(ch.steps[1]).toBe(4);
    expect(ch.steps[0]).toBe(6);
    nudgeRange(ch, 0, 16, -1);
    expect(ch.steps[0]).toBe(4);
    expect(ch.steps[15]).toBe(6);
    // a whole range turns back to where it was
    const before = [...ch.steps];
    nudgeRange(ch, 0, 16, 16);
    expect(ch.steps).toEqual(before);
  });

  it('draws a note for its length, up to the end of the loop, whatever follows it', () => {
    const m = tune(32);
    expect(noteSpan(m, 0, 8)).toBe(8);
    expect(noteSpan(m, 28, 8)).toBe(4);
    expect(noteSpan(m, 5, 0)).toBe(1);
  });
});
