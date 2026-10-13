// Sounds of a project: generated effects, chip-music loops and imported audio files. Generated ones are
// stored as their few parameters (a few hundred bytes) and rendered when the game starts.

import { ambientMusic } from './ambient';
import { type MusicData, emptyMusic, musicDuration, normalizeMusic, randomMusic } from './music';
import { type SfxKind, type SfxParams, type SfxWave, defaultSfx, sfxDuration, sfxPreset } from './sfx';

export type SoundKind = 'sfx' | 'music' | 'file';

export interface SoundAsset {
  id: string;
  name: string;
  kind: SoundKind;
  /** 0..1 */
  volume: number;
  sfx?: SfxParams;
  /** Picks the variation of the noise in generated effects. */
  seed?: number;
  music?: MusicData;
  /** An imported file, base64 encoded, with its MIME type (audio/ogg, audio/wav, audio/mpeg ...). */
  file?: { mime: string; data: string };
}

/** Sounds the built-in pickups and the player use; they are added to a project when needed. */
export const SOUND_IDS = {
  coin: 'sfx-coin',
  key: 'sfx-key',
  door: 'sfx-door',
  hit: 'sfx-hit',
  powerup: 'sfx-powerup',
  checkpoint: 'sfx-checkpoint',
  jump: 'sfx-jump',
  jump2: 'sfx-jump2',
  land: 'sfx-land',
  theme: 'music-theme',
  /** The little sounds that play while a character's words appear (see `TALK_VOICES`). */
  talk: 'sfx-talk',
  talkSoft: 'sfx-talk-soft',
  talkDeep: 'sfx-talk-deep',
  talkChirp: 'sfx-talk-chirp',
  talkMumble: 'sfx-talk-mumble',
} as const;

/** Voices that ship with the engine: what a character sounds like while the text appears. */
export const TALK_VOICES: readonly string[] = [SOUND_IDS.talk, SOUND_IDS.talkSoft, SOUND_IDS.talkDeep, SOUND_IDS.talkChirp, SOUND_IDS.talkMumble];

type SoundSpec = Omit<SoundAsset, 'id'> & { id: string };

function sfx(id: string, name: string, kind: SfxKind, seed: number, volume = 0.8, tweak?: Partial<SfxParams>): SoundSpec {
  return { id, name, kind: 'sfx', volume, seed, sfx: { ...sfxPreset(kind, seed), ...tweak } };
}

/** The sounds that ship with the engine, by id. */
export function builtInSound(id: string): SoundAsset | null {
  switch (id) {
    case SOUND_IDS.coin:
      return sfx(id, 'Coin', 'coin', 3);
    case SOUND_IDS.key:
      return sfx(id, 'Key', 'powerup', 5, 0.8, { sustain: 0.1, decay: 0.3, repeatSpeed: 0.35 });
    case SOUND_IDS.door:
      return sfx(id, 'Door', 'door', 2);
    case SOUND_IDS.hit:
      return sfx(id, 'Hit', 'hit', 4);
    case SOUND_IDS.powerup:
      return sfx(id, 'Power-up', 'powerup', 1);
    case SOUND_IDS.checkpoint:
      return sfx(id, 'Checkpoint', 'blip', 7, 0.6, { startFreq: 0.42, changeAmount: 0.45, changeSpeed: 0.55, sustain: 0.1, decay: 0.28, punch: 0.15 });
    case SOUND_IDS.jump:
      return sfx(id, 'Jump', 'jump', 2, 0.55);
    case SOUND_IDS.jump2:
      return sfx(id, 'Double jump', 'jump', 5, 0.55, { startFreq: 0.4 });
    case SOUND_IDS.land:
      return sfx(id, 'Land', 'hit', 9, 0.35, { startFreq: 0.18, sustain: 0.01, decay: 0.12, slide: -0.2 });
    case SOUND_IDS.theme:
      // the main theme: calm and spacious, a loop of a little over two minutes (the Audio tab can edit it like any tune)
      return { id, name: 'Theme', kind: 'music', volume: 0.55, music: ambientMusic(0) };
    // each one is a single short blip; the game plays it again for the letters, a little higher or lower
    case SOUND_IDS.talk:
      return sfx(id, 'Voice: blip', 'blip', 11, 0.45, { wave: 0, squareDuty: 0.35, startFreq: 0.36, minFreq: 0, slide: 0.08, attack: 0, sustain: 0.1, decay: 0.16, lpfCutoff: 0.55, punch: 0.1 });
    case SOUND_IDS.talkSoft:
      return sfx(id, 'Voice: soft', 'blip', 12, 0.5, { wave: 2, startFreq: 0.34, slide: 0, attack: 0.04, sustain: 0.1, decay: 0.14, lpfCutoff: 0.8, punch: 0 });
    case SOUND_IDS.talkDeep:
      return sfx(id, 'Voice: deep', 'blip', 13, 0.5, { wave: 1, startFreq: 0.22, slide: -0.05, attack: 0, sustain: 0.1, decay: 0.15, lpfCutoff: 0.45, punch: 0.2 });
    case SOUND_IDS.talkChirp:
      return sfx(id, 'Voice: chirp', 'blip', 14, 0.4, { wave: 0, squareDuty: 0.2, startFreq: 0.5, slide: 0.15, attack: 0, sustain: 0.06, decay: 0.12, lpfCutoff: 0.7, punch: 0 });
    case SOUND_IDS.talkMumble:
      return sfx(id, 'Voice: mumble', 'blip', 15, 0.5, { wave: 1, startFreq: 0.3, slide: 0.05, attack: 0.02, sustain: 0.11, decay: 0.15, lpfCutoff: 0.35, lpfResonance: 0.15, vibratoDepth: 0.1, vibratoSpeed: 0.4, punch: 0 });
    default:
      return null;
  }
}

export function newSfx(id: string, name: string, kind: SfxKind, seed: number): SoundAsset {
  return { id, name, kind: 'sfx', volume: 0.8, seed, sfx: sfxPreset(kind, seed) };
}

export function newMusic(id: string, name: string, seed = 1): SoundAsset {
  return { id, name, kind: 'music', volume: 0.5, music: seed === 0 ? emptyMusic() : randomMusic(seed) };
}

/** Seconds a sound lasts (for the list in the editor). */
export function soundDuration(s: SoundAsset): number | null {
  if (s.kind === 'sfx' && s.sfx) return sfxDuration(s.sfx);
  if (s.kind === 'music' && s.music) return musicDuration(s.music);
  return null;
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function normalizeSfx(raw: unknown): SfxParams {
  const base = defaultSfx();
  const r = (raw ?? {}) as Partial<SfxParams>;
  const out: SfxParams = { ...base };
  const wave = r.wave;
  out.wave = (wave === 0 || wave === 1 || wave === 2 || wave === 3 ? wave : 0) as SfxWave;
  const unit = ['attack', 'sustain', 'punch', 'decay', 'startFreq', 'minFreq', 'vibratoDepth', 'vibratoSpeed', 'changeSpeed', 'squareDuty', 'repeatSpeed', 'lpfCutoff', 'lpfResonance', 'hpfCutoff', 'volume'] as const;
  const signed = ['slide', 'deltaSlide', 'changeAmount', 'dutySweep', 'phaserOffset', 'phaserSweep', 'lpfSweep', 'hpfSweep'] as const;
  for (const k of unit) out[k] = num(r[k], 0, 1, base[k]);
  for (const k of signed) out[k] = num(r[k], -1, 1, base[k]);
  return out;
}

export function normalizeSounds(raw: unknown, idGen: () => string): SoundAsset[] {
  if (!Array.isArray(raw)) return [];
  const out: SoundAsset[] = [];
  const seen = new Set<string>();
  for (const s of raw as Partial<SoundAsset>[]) {
    if (!s || (s.kind !== 'sfx' && s.kind !== 'music' && s.kind !== 'file')) continue;
    const id = typeof s.id === 'string' && s.id && !seen.has(s.id) ? s.id : idGen();
    seen.add(id);
    const base: SoundAsset = {
      id,
      name: typeof s.name === 'string' && s.name ? s.name : 'Sound',
      kind: s.kind,
      volume: num(s.volume, 0, 1, 0.8),
    };
    if (s.kind === 'sfx') {
      base.sfx = normalizeSfx(s.sfx);
      base.seed = typeof s.seed === 'number' ? Math.floor(s.seed) : 1;
    } else if (s.kind === 'music') {
      base.music = normalizeMusic(s.music);
    } else {
      const f = s.file;
      if (!f || typeof f.data !== 'string' || typeof f.mime !== 'string') continue;
      base.file = { mime: f.mime, data: f.data };
    }
    out.push(base);
  }
  return out;
}
