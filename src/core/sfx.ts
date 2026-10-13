// A small sound-effect synthesizer in the style of sfxr: a handful of numbers describe a blip, and
// `renderSfx` turns them into samples. Everything here is plain math, so it also runs in tests.

export type SfxWave = 0 | 1 | 2 | 3; // square, sawtooth, sine, noise

export const SFX_WAVES: { value: SfxWave; label: string }[] = [
  { value: 0, label: 'Square' },
  { value: 1, label: 'Sawtooth' },
  { value: 2, label: 'Sine' },
  { value: 3, label: 'Noise' },
];

export interface SfxParams {
  wave: SfxWave;
  /** Seconds-ish envelope, each 0..1 (squared internally). */
  attack: number;
  sustain: number;
  /** Extra loudness at the start of the sustain, 0..1. */
  punch: number;
  decay: number;
  /** Pitch: 0..1 (an exponential scale). */
  startFreq: number;
  /** Lowest pitch before the sound is cut (0 = never). */
  minFreq: number;
  /** Pitch slide, -1..1, and how the slide itself changes. */
  slide: number;
  deltaSlide: number;
  vibratoDepth: number;
  vibratoSpeed: number;
  /** One sudden pitch jump: how big (-1..1) and when (0..1). */
  changeAmount: number;
  changeSpeed: number;
  /** Square wave: width of the pulse and how it sweeps. */
  squareDuty: number;
  dutySweep: number;
  /** The sound restarts its pitch every so often (0 = never). */
  repeatSpeed: number;
  phaserOffset: number;
  phaserSweep: number;
  lpfCutoff: number;
  lpfSweep: number;
  lpfResonance: number;
  hpfCutoff: number;
  hpfSweep: number;
  /** Loudness, 0..1. */
  volume: number;
}

export const SFX_SAMPLE_RATE = 44100;

export function defaultSfx(): SfxParams {
  return {
    wave: 0,
    attack: 0,
    sustain: 0.3,
    punch: 0,
    decay: 0.4,
    startFreq: 0.3,
    minFreq: 0,
    slide: 0,
    deltaSlide: 0,
    vibratoDepth: 0,
    vibratoSpeed: 0,
    changeAmount: 0,
    changeSpeed: 0,
    squareDuty: 0,
    dutySweep: 0,
    repeatSpeed: 0,
    phaserOffset: 0,
    phaserSweep: 0,
    lpfCutoff: 1,
    lpfSweep: 0,
    lpfResonance: 0,
    hpfCutoff: 0,
    hpfSweep: 0,
    volume: 0.5,
  };
}

/** Small deterministic random numbers, so a preset with a seed always sounds the same. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render the sound to mono samples in -1..1. The result is deterministic: the noise comes from a seeded
 * generator. Long sounds are capped at 4 seconds.
 */
export function renderSfx(p: SfxParams, sampleRate = SFX_SAMPLE_RATE, seed = 1): Float32Array {
  const rnd = mulberry(seed);
  const sq = (v: number) => v * v;
  const cube = (v: number) => v * v * v;

  let fperiod = 0;
  let fmaxperiod = 0;
  let fslide = 0;
  let fdslide = 0;
  let squareDuty = 0;
  let squareSlide = 0;
  let arpMod = 1;
  let arpTime = 0;
  let arpLimit = 0;

  const reset = (full: boolean) => {
    fperiod = 100 / (sq(p.startFreq) + 0.001);
    fmaxperiod = 100 / (sq(p.minFreq) + 0.001);
    fslide = 1 - cube(p.slide) * 0.01;
    fdslide = -cube(p.deltaSlide) * 0.000001;
    squareDuty = 0.5 - p.squareDuty * 0.5;
    squareSlide = -p.dutySweep * 0.00005;
    arpMod = p.changeAmount >= 0 ? 1 - sq(p.changeAmount) * 0.9 : 1 + sq(p.changeAmount) * 10;
    arpTime = 0;
    arpLimit = p.changeSpeed === 1 ? 0 : Math.floor(sq(1 - p.changeSpeed) * 20000 + 32);
    if (full) return;
  };
  reset(true);

  let fltw = cube(p.lpfCutoff) * 0.1;
  const fltwD = 1 + p.lpfSweep * 0.0001;
  let fltdmp = (5 / (1 + sq(p.lpfResonance) * 20)) * (0.01 + fltw);
  if (fltdmp > 0.8) fltdmp = 0.8;
  let flthp = sq(p.hpfCutoff) * 0.1;
  const flthpD = 1 + p.hpfSweep * 0.0003;
  let vibPhase = 0;
  const vibSpeed = sq(p.vibratoSpeed) * 0.01;
  const vibAmp = p.vibratoDepth * 0.5;

  const envLength = [
    Math.floor(sq(p.attack) * 100000),
    Math.floor(sq(p.sustain) * 100000),
    Math.floor(sq(p.decay) * 100000),
  ];
  let envStage = 0;
  let envTime = 0;

  let fphase = sq(p.phaserOffset) * 1020;
  if (p.phaserOffset < 0) fphase = -fphase;
  let fdphase = sq(p.phaserSweep);
  if (p.phaserSweep < 0) fdphase = -fdphase;
  let iphase = Math.abs(Math.floor(fphase));
  let ipp = 0;
  const phaserBuffer = new Float32Array(1024);
  const noiseBuffer = new Float32Array(32);
  for (let i = 0; i < 32; i++) noiseBuffer[i] = rnd() * 2 - 1;

  let repTime = 0;
  const repLimit = p.repeatSpeed === 0 ? 0 : Math.floor(sq(1 - p.repeatSpeed) * 20000 + 32);

  let phase = 0;
  let period = Math.floor(fperiod);
  let fltp = 0;
  let fltdp = 0;
  let fltphp = 0;

  const total = envLength[0] + envLength[1] + envLength[2];
  const out: number[] = [];
  // sfxr runs at 44.1 kHz with 8x oversampling; other rates just read the same stream scaled in time
  const step = SFX_SAMPLE_RATE / sampleRate;
  let acc = 0;
  let sampleIndex = 0;
  const maxSamples = Math.min(total + 64, SFX_SAMPLE_RATE * 4);
  const master = 0.25 * (2 * p.volume);

  let playing = true;
  while (playing && sampleIndex < maxSamples) {
    repTime++;
    if (repLimit !== 0 && repTime >= repLimit) {
      repTime = 0;
      reset(false);
    }
    arpTime++;
    if (arpLimit !== 0 && arpTime >= arpLimit) {
      arpLimit = 0;
      fperiod *= arpMod;
    }
    fslide += fdslide;
    fperiod *= fslide;
    if (fperiod > fmaxperiod) {
      fperiod = fmaxperiod;
      if (p.minFreq > 0) playing = false;
    }
    let rfperiod = fperiod;
    if (vibAmp > 0) {
      vibPhase += vibSpeed;
      rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp);
    }
    period = Math.floor(rfperiod);
    if (period < 8) period = 8;
    squareDuty += squareSlide;
    squareDuty = Math.min(0.5, Math.max(0, squareDuty));

    envTime++;
    if (envTime > envLength[envStage]!) {
      envTime = 0;
      envStage++;
      if (envStage === 3) playing = false;
    }
    let envVol = 0;
    if (envStage === 0) envVol = envLength[0]! > 0 ? envTime / envLength[0]! : 1;
    else if (envStage === 1) envVol = 1 + (envLength[1]! > 0 ? 1 - envTime / envLength[1]! : 0) * 2 * p.punch;
    else if (envStage === 2) envVol = envLength[2]! > 0 ? 1 - envTime / envLength[2]! : 0;

    fphase += fdphase;
    iphase = Math.min(1023, Math.abs(Math.floor(fphase)));
    if (flthpD !== 0) {
      flthp *= flthpD;
      flthp = Math.min(0.1, Math.max(0.00001, flthp));
    }

    let ssample = 0;
    for (let si = 0; si < 8; si++) {
      let sample = 0;
      phase++;
      if (phase >= period) {
        phase %= period;
        if (p.wave === 3) for (let i = 0; i < 32; i++) noiseBuffer[i] = rnd() * 2 - 1;
      }
      const fp = phase / period;
      switch (p.wave) {
        case 0:
          sample = fp < squareDuty ? 0.5 : -0.5;
          break;
        case 1:
          sample = 1 - fp * 2;
          break;
        case 2:
          sample = Math.sin(fp * 2 * Math.PI);
          break;
        case 3:
          sample = noiseBuffer[Math.floor((phase * 32) / period)]!;
          break;
      }
      const pp = fltp;
      fltw *= fltwD;
      fltw = Math.min(0.1, Math.max(0, fltw));
      if (p.lpfCutoff !== 1) {
        fltdp += (sample - fltp) * fltw;
        fltdp -= fltdp * fltdmp;
      } else {
        fltp = sample;
        fltdp = 0;
      }
      fltp += fltdp;
      fltphp += fltp - pp;
      fltphp -= fltphp * flthp;
      sample = fltphp;
      phaserBuffer[ipp & 1023] = sample;
      sample += phaserBuffer[(ipp - iphase + 1024) & 1023]!;
      ipp = (ipp + 1) & 1023;
      ssample += sample * envVol;
    }
    ssample = (ssample / 8) * master * 2;
    ssample = Math.max(-1, Math.min(1, ssample));

    // resample to the requested rate
    acc += 1;
    while (acc >= step) {
      acc -= step;
      out.push(ssample);
    }
    sampleIndex++;
  }
  // a short fade so a cut sound does not click
  const n = out.length;
  const fade = Math.min(64, n);
  for (let i = 0; i < fade; i++) out[n - 1 - i] = out[n - 1 - i]! * (i / fade);
  return Float32Array.from(out);
}

// ---------------------------------------------------------------- ready-made sounds

export type SfxKind = 'coin' | 'jump' | 'hit' | 'powerup' | 'explosion' | 'laser' | 'blip' | 'door' | 'random';

export const SFX_KINDS: { kind: SfxKind; label: string }[] = [
  { kind: 'coin', label: 'Coin' },
  { kind: 'jump', label: 'Jump' },
  { kind: 'hit', label: 'Hit' },
  { kind: 'powerup', label: 'Power-up' },
  { kind: 'explosion', label: 'Explosion' },
  { kind: 'laser', label: 'Laser' },
  { kind: 'blip', label: 'Blip' },
  { kind: 'door', label: 'Door' },
  { kind: 'random', label: 'Random' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clamp11 = (v: number) => Math.min(1, Math.max(-1, v));

/** A sound of a given kind; the seed picks a variation. */
export function sfxPreset(kind: SfxKind, seed = 1): SfxParams {
  const r = mulberry(seed * 7919 + 13);
  const p = defaultSfx();
  switch (kind) {
    case 'coin':
      return { ...p, wave: 0, startFreq: 0.55 + r() * 0.1, sustain: 0.02 + r() * 0.03, decay: 0.22 + r() * 0.08, punch: 0.4 + r() * 0.2, changeAmount: 0.35 + r() * 0.1, changeSpeed: 0.55 + r() * 0.1, squareDuty: 0.3 };
    case 'jump':
      return { ...p, wave: 0, startFreq: 0.3 + r() * 0.08, slide: 0.28 + r() * 0.1, sustain: 0.08 + r() * 0.05, decay: 0.2 + r() * 0.06, squareDuty: 0.4 + r() * 0.3, hpfCutoff: 0.1 + r() * 0.1 };
    case 'hit':
      return { ...p, wave: 3, startFreq: 0.25 + r() * 0.12, slide: -0.4 - r() * 0.2, sustain: 0.04 + r() * 0.04, decay: 0.2 + r() * 0.1, punch: 0.4, lpfCutoff: 0.7 };
    case 'powerup':
      return { ...p, wave: 0, startFreq: 0.25 + r() * 0.08, slide: 0.3 + r() * 0.1, repeatSpeed: 0.55 + r() * 0.15, sustain: 0.25, decay: 0.3 + r() * 0.1, squareDuty: 0.5 };
    case 'explosion':
      return { ...p, wave: 3, startFreq: 0.1 + r() * 0.1, slide: -0.2 - r() * 0.1, sustain: 0.28, decay: 0.55 + r() * 0.1, punch: 0.6, vibratoDepth: 0.2, vibratoSpeed: 0.3, lpfCutoff: 0.6 };
    case 'laser':
      return { ...p, wave: 1, startFreq: 0.7 + r() * 0.15, slide: -0.4 - r() * 0.2, minFreq: 0.15, sustain: 0.1, decay: 0.2, lpfCutoff: 0.9 };
    case 'blip':
      return { ...p, wave: 0, startFreq: 0.45 + r() * 0.2, sustain: 0.03, decay: 0.12, squareDuty: 0.5, hpfCutoff: 0.1 };
    case 'door':
      return { ...p, wave: 3, startFreq: 0.18 + r() * 0.05, slide: 0.15, sustain: 0.12, decay: 0.3, lpfCutoff: 0.35, lpfSweep: 0.2, punch: 0.2 };
    case 'random': {
      const wave = Math.floor(r() * 4) as SfxWave;
      return {
        ...p,
        wave,
        startFreq: clamp01(0.15 + r() * 0.6),
        slide: clamp11((r() - 0.5) * 1.2),
        sustain: 0.05 + r() * 0.25,
        decay: 0.15 + r() * 0.4,
        punch: r() * 0.6,
        squareDuty: r(),
        vibratoDepth: r() < 0.3 ? r() * 0.4 : 0,
        vibratoSpeed: r() * 0.6,
        changeAmount: r() < 0.4 ? (r() - 0.5) * 1.4 : 0,
        changeSpeed: r(),
        lpfCutoff: r() < 0.5 ? 1 : 0.4 + r() * 0.5,
      };
    }
  }
}

/** The same sound with every number nudged a little. */
export function mutateSfx(p: SfxParams, seed: number, amount = 0.08): SfxParams {
  const r = mulberry(seed * 104729 + 7);
  const out: SfxParams = { ...p };
  const unit: (keyof SfxParams)[] = ['attack', 'sustain', 'punch', 'decay', 'startFreq', 'squareDuty', 'vibratoDepth', 'vibratoSpeed', 'changeSpeed', 'repeatSpeed', 'lpfResonance', 'hpfCutoff'];
  const signed: (keyof SfxParams)[] = ['slide', 'deltaSlide', 'changeAmount', 'dutySweep', 'phaserOffset', 'phaserSweep', 'lpfSweep', 'hpfSweep'];
  for (const k of unit) (out[k] as number) = clamp01((p[k] as number) + (r() - 0.5) * 2 * amount);
  for (const k of signed) (out[k] as number) = clamp11((p[k] as number) + (r() - 0.5) * 2 * amount);
  return out;
}

/** How long a sound lasts, in seconds, without rendering it. */
export function sfxDuration(p: SfxParams): number {
  const sq = (v: number) => v * v;
  return Math.min(4, (sq(p.attack) + sq(p.sustain) + sq(p.decay)) * (100000 / SFX_SAMPLE_RATE));
}
