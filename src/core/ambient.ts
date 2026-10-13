// Calm, spacious background music in the spirit of Minecraft's: a slow soft piano with long silences, a few
// bell notes, and pads that swell under a chord, all in a big room. It is plain `MusicData`: the same
// channels, steps and settings as any tune of the Audio tab, so it can be opened, changed and copied there.
//
// The shape: 16 blocks of two bars (32 steps) = 512 steps; one chord per block. At 60 bpm that is a loop of a
// little over two minutes, so it does not repeat soon.

import { DEFAULT_NOTE_LENGTH, type MusicChannel, type MusicData, STEP_COUNTS, degreeCount } from './music';
import { mulberry } from './sfx';

const STEPS = 512;
const BLOCK = 32;
const BLOCKS = STEPS / BLOCK;
const TOP = degreeCount('major') - 1;

/** Chord roots (scale degrees of the major scale, 0 = the key note) of 8 blocks; the loop plays two of these lists. */
const PROGRESSIONS: number[][] = [
  [0, 5, 3, 4, 2, 3, 1, 4], // C  Am F  G  Em F  Dm G
  [0, 3, 5, 4, 0, 3, 1, 4], // C  F  Am G  C  F  Dm G
  [3, 0, 4, 5, 3, 0, 1, 4], // F  C  G  Am F  C  Dm G
  [5, 3, 0, 4, 5, 3, 1, 4], // Am F  C  G  Am F  Dm G
  [0, 2, 3, 0, 5, 3, 1, 4], // C  Em F  C  Am F  Dm G
];

/** The melody over a chord: [step in the block, scale degree]; the register is the channel's octave. */
const MELODY: Record<number, [number, number][]> = {
  0: [[0, 4], [7, 2], [12, 4], [20, 7], [26, 6]],
  5: [[0, 5], [6, 4], [10, 2], [22, 5], [28, 4]],
  3: [[0, 3], [8, 5], [14, 7], [24, 5], [29, 3]],
  4: [[0, 4], [6, 6], [12, 8], [20, 6], [26, 4]],
  2: [[0, 2], [7, 4], [12, 6], [22, 4], [28, 2]],
  1: [[0, 1], [8, 3], [14, 5], [22, 3], [28, 1]],
};

/** Bell notes over a chord: they sit high above the piano and come rarely. */
const SPARKLE: Record<number, [number, number][]> = {
  0: [[15, 2], [27, 4]],
  5: [[13, 0], [29, 2]],
  3: [[11, 5], [25, 7]],
  4: [[14, 6], [28, 8]],
  2: [[13, 4], [27, 6]],
  1: [[15, 5], [29, 3]],
};

const clamp = (n: number) => Math.max(0, Math.min(TOP, n));

function channel(wave: MusicChannel['wave'], volume: number, octave: number, length: number): MusicChannel {
  // the length of the instrument is the default, so it is only written when it differs (like a saved tune does)
  return { wave, volume, octave, ...(length !== DEFAULT_NOTE_LENGTH[wave] ? { length } : {}), steps: new Array<number>(STEPS).fill(-1) };
}

/**
 * A new calm theme. Seed 0 is the one that ships as the game's main theme; other seeds vary the key, the tempo,
 * the chords and which notes are played, with the same character.
 */
export function ambientMusic(seed = 0): MusicData {
  const r = mulberry(seed * 977 + 13);
  const shipped = seed === 0;
  const progA = PROGRESSIONS[shipped ? 0 : Math.floor(r() * PROGRESSIONS.length)]!;
  const progB = PROGRESSIONS[shipped ? 1 : Math.floor(r() * PROGRESSIONS.length)]!;

  const melody = channel('piano', 0.75, 1, 8);
  const arpeggio = channel('piano', 0.4, 0, 6);
  const sparkle = channel('bell', 0.32, 2, 8);
  const bass = channel('piano', 0.45, -1, 16);
  const padLow = channel('pad', 0.22, -1, 30);
  const padMid = channel('pad', 0.25, 0, 30);
  const padHigh = channel('pad', 0.2, 0, 30);

  const put = (ch: MusicChannel, step: number, degree: number) => {
    if (step >= 0 && step < STEPS) ch.steps[step] = clamp(degree);
  };

  for (let b = 0; b < BLOCKS; b++) {
    const second = b >= BLOCKS / 2;
    const d = (second ? progB : progA)[b % 8]!;
    const base = b * BLOCK;

    // the chord: a bass note and three pads
    put(bass, base, d);
    put(padLow, base, d);
    put(padMid, base, d + 4);
    put(padHigh, base, d + 2 + (d + 2 < 7 ? 7 : 0));

    // a slow arpeggio of the chord, every eight steps
    const tones = [d, d + 2, d + 4, d + 7];
    const order = shipped ? (second ? [0, 2, 1, 3] : [0, 1, 2, 3]) : [0, 1, 2, 3].sort(() => r() - 0.5);
    order.forEach((tone, i) => put(arpeggio, base + i * 8, tones[tone]!));

    // the melody: the second time round it starts a little later, drops a note and ends higher
    // (one block of the shipped theme is left to the arpeggio alone, to breathe)
    const quiet = shipped ? b === 12 : r() < 0.12;
    if (!quiet) {
      const notes = MELODY[d] ?? MELODY[0]!;
      notes.forEach(([at, degree], i) => {
        if (second && i === 2) return;
        if (!shipped && r() < 0.15) return;
        const lift = second && i === notes.length - 1 ? 7 : 0;
        put(melody, base + at + (second ? 2 : 0), degree + lift);
      });
    }

    // bells, every now and then
    const sparks = SPARKLE[d] ?? SPARKLE[0]!;
    sparks.forEach(([at, degree], i) => {
      // the shipped theme: one bell on every other block, the later one in the first round and the earlier in the second
      const play = shipped ? b % 2 === 0 && i === (second ? 0 : 1) : r() < 0.5;
      if (play) put(sparkle, base + at + (second ? 3 : 0), degree);
    });
  }

  return {
    bpm: shipped ? 60 : 52 + Math.floor(r() * 5) * 4,
    stepCount: STEP_COUNTS.includes(STEPS) ? STEPS : 512,
    root: shipped ? 48 : [48, 50, 53, 55][Math.floor(r() * 4)]!,
    scale: 'major',
    reverb: shipped ? 0.7 : 0.55 + r() * 0.25,
    channels: [melody, arpeggio, sparkle, bass, padLow, padMid, padHigh],
  };
}
