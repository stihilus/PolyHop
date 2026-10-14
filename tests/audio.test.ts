import { describe, expect, it } from 'vitest';
import { SCALES, degreeCount, degreeFrequency, emptyMusic, musicDuration, normalizeMusic, randomMusic, renderMusic } from '../src/core/music';
import { SFX_KINDS, defaultSfx, mulberry, mutateSfx, renderSfx, sfxDuration, sfxPreset } from '../src/core/sfx';
import { SOUND_IDS, builtInSound, normalizeSounds, soundDuration } from '../src/core/sounds';
import { createDefaultProject, ensurePresetAssets, normalizeProject } from '../src/core/types';
import { presetRules, presetSounds } from '../src/core/presets';
import { pruneForExport } from '../src/core/exportProject';

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

describe('sfx synthesis', () => {
  it('makes a sound with a sensible length and level', () => {
    const data = renderSfx(sfxPreset('coin', 1));
    expect(data.length).toBeGreaterThan(2000);
    expect(data.length).toBeLessThan(44100 * 2);
    expect(rms(data)).toBeGreaterThan(0.02);
    expect(Math.max(...data)).toBeLessThanOrEqual(1);
    expect(Math.min(...data)).toBeGreaterThanOrEqual(-1);
  });

  it('is deterministic: the same numbers and seed give the same samples', () => {
    const a = renderSfx(sfxPreset('explosion', 3), 44100, 9);
    const b = renderSfx(sfxPreset('explosion', 3), 44100, 9);
    expect(a.length).toBe(b.length);
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
    // another noise seed is another explosion
    const c = renderSfx(sfxPreset('explosion', 3), 44100, 10);
    expect(Array.from(c.slice(0, 200))).not.toEqual(Array.from(a.slice(0, 200)));
  });

  it('every kind of preset renders something audible and finite', () => {
    for (const { kind } of SFX_KINDS) {
      const data = renderSfx(sfxPreset(kind, 4));
      expect(data.length).toBeGreaterThan(500);
      expect(data.every((v) => Number.isFinite(v))).toBe(true);
      expect(rms(data)).toBeGreaterThan(0.005);
    }
  });

  it('a lower sample rate gives proportionally fewer samples', () => {
    const p = sfxPreset('jump', 1);
    const hi = renderSfx(p, 44100);
    const lo = renderSfx(p, 22050);
    expect(lo.length / hi.length).toBeCloseTo(0.5, 1);
  });

  it('volume scales the level', () => {
    const p = sfxPreset('blip', 1);
    const loud = rms(renderSfx({ ...p, volume: 0.8 }));
    const quiet = rms(renderSfx({ ...p, volume: 0.2 }));
    expect(loud).toBeGreaterThan(quiet * 2);
  });

  it('mutating changes the numbers a little and keeps them in range', () => {
    const p = sfxPreset('laser', 2);
    const m = mutateSfx(p, 5, 0.1);
    expect(m.startFreq).not.toBe(p.startFreq);
    expect(Math.abs(m.startFreq - p.startFreq)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(m.slide).toBeGreaterThanOrEqual(-1);
    expect(m.slide).toBeLessThanOrEqual(1);
  });

  it('duration is estimated from the envelope and capped', () => {
    expect(sfxDuration({ ...defaultSfx(), attack: 0, sustain: 0, decay: 0 })).toBe(0);
    expect(sfxDuration({ ...defaultSfx(), attack: 1, sustain: 1, decay: 1 })).toBe(4);
  });

  it('the random generator is repeatable', () => {
    const a = mulberry(5);
    const b = mulberry(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('music', () => {
  it('a loop lasts steps * step length and renders that many samples', () => {
    const m = emptyMusic();
    m.bpm = 120;
    expect(musicDuration(m)).toBeCloseTo(2);
    m.channels[0]!.steps[0] = 3;
    const data = renderMusic(m, 8000);
    expect(data.length).toBe(Math.round(0.125 * 8000) * 16);
    expect(rms(data)).toBeGreaterThan(0);
  });

  it('a silent pattern is silent, a note makes sound only where it is', () => {
    const m = emptyMusic();
    expect(rms(renderMusic(m, 8000))).toBe(0);
    m.channels[0]!.steps[8] = 2;
    const data = renderMusic(m, 8000);
    const step = Math.round(0.125 * 8000);
    expect(rms(data.slice(0, step * 8))).toBe(0);
    expect(rms(data.slice(step * 8, step * 9))).toBeGreaterThan(0.01);
  });

  it('degrees go up in pitch, and an octave doubles the frequency', () => {
    const m = emptyMusic();
    m.root = 57;
    m.scale = 'major';
    const f0 = degreeFrequency(m, 0, 0);
    const f7 = degreeFrequency(m, SCALES.major.length, 0);
    expect(f0).toBeCloseTo(220, 3);
    expect(f7 / f0).toBeCloseTo(2, 6);
    expect(degreeFrequency(m, 2, 0)).toBeGreaterThan(degreeFrequency(m, 1, 0));
    expect(degreeFrequency(m, 0, 1)).toBeCloseTo(440, 3);
  });

  it('a random tune uses the notes of its scale and has all three parts', () => {
    const m = randomMusic(3, 'minor');
    const top = degreeCount('minor');
    for (const ch of m.channels) for (const s of ch.steps) expect(s).toBeLessThan(top);
    expect(m.channels[0]!.steps.some((s) => s >= 0)).toBe(true);
    expect(m.channels[1]!.steps.some((s) => s >= 0)).toBe(true);
    expect(m.channels[2]!.steps.some((s) => s >= 0)).toBe(true);
  });

  it('loads damaged data into something playable', () => {
    const m = normalizeMusic({ bpm: 9999, scale: 'weird', stepCount: 5, channels: [{ wave: 'zap', steps: [999, 'x', -5], volume: 7 }] });
    expect(m.bpm).toBe(240);
    expect(m.scale).toBe('pentatonic');
    expect(m.stepCount).toBe(16);
    expect(m.channels[0]!.wave).toBe('square');
    expect(m.channels[0]!.volume).toBe(1);
    expect(m.channels[0]!.steps).toHaveLength(16);
    expect(m.channels[0]!.steps[0]).toBe(degreeCount('pentatonic') - 1);
    expect(m.channels[0]!.steps[1]).toBe(-1);
  });
});

describe('sounds in a project', () => {
  it('the starter project has every built-in sound, music and working references', () => {
    const p = createDefaultProject();
    const ids = new Set(p.sounds.map((s) => s.id));
    for (const id of Object.values(SOUND_IDS)) expect(ids.has(id)).toBe(true);
    expect(p.settings.music).toBe(SOUND_IDS.theme);
    expect(p.player.soundJump).toBe(SOUND_IDS.jump);
    // every sound the rules play exists
    for (const o of p.levels.flatMap((l) => l.objects)) {
      for (const r of o.rules) for (const a of r.actions) if (a.type === 'sound') expect(ids.has(a.sound)).toBe(true);
    }
  });

  it('survives a save and a load', () => {
    const p = createDefaultProject();
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.sounds).toEqual(p.sounds);
    expect(back.settings.music).toBe(p.settings.music);
  });

  it('an older project is silent and its references are cleared', () => {
    const old = normalizeProject({ version: 4, settings: { music: 'gone' }, player: { soundJump: 'gone' } });
    expect(old.sounds).toEqual([]);
    expect(old.settings.music).toBeNull();
    expect(old.player.soundJump).toBeNull();
  });

  it('adding a pickup brings its sound', () => {
    const p = normalizeProject({ version: 4, models: [], variables: [], sounds: [] });
    ensurePresetAssets(p, 'coin');
    expect(p.sounds.map((s) => s.id)).toEqual([SOUND_IDS.coin]);
    ensurePresetAssets(p, 'coin');
    expect(p.sounds).toHaveLength(1);
  });

  it('presets only play sounds they bring along', () => {
    let n = 0;
    for (const kind of ['coin', 'key', 'apple', 'door', 'checkpoint', 'hazard'] as const) {
      const wanted = new Set(presetSounds(kind));
      for (const r of presetRules(kind, () => `i${++n}`)) {
        for (const a of r.actions) if (a.type === 'sound') expect(wanted.has(a.sound)).toBe(true);
      }
      for (const id of wanted) expect(builtInSound(id)).not.toBeNull();
    }
  });

  it('cleans up junk sounds and keeps imported files', () => {
    const sounds = normalizeSounds(
      [
        { kind: 'sfx', name: 'A', sfx: { wave: 9, startFreq: 5 }, volume: 3 },
        { kind: 'file', name: 'F', file: { mime: 'audio/ogg', data: 'AAAA' } },
        { kind: 'file', name: 'broken' },
        { kind: 'nope' },
        null,
      ],
      (() => {
        let i = 0;
        return () => `id${++i}`;
      })(),
    );
    expect(sounds).toHaveLength(2);
    expect(sounds[0]!.sfx!.wave).toBe(0);
    expect(sounds[0]!.sfx!.startFreq).toBe(1);
    expect(sounds[0]!.volume).toBe(1);
    expect(sounds[1]!.file!.data).toBe('AAAA');
    expect(soundDuration(sounds[0]!)).toBeGreaterThan(0);
    expect(soundDuration(sounds[1]!)).toBeNull();
  });
});

describe('the footstep sound', () => {
  it('is a short, quiet sound that ships with every new project and is the player\'s default', () => {
    const p = createDefaultProject();
    expect(p.player.soundStep).toBe(SOUND_IDS.step);
    const sound = p.sounds.find((s) => s.id === SOUND_IDS.step)!;
    expect(sound).toBeTruthy();
    expect(sound.kind).toBe('sfx');
    expect(sound.volume).toBeLessThanOrEqual(0.4);
    expect(soundDuration(sound)!).toBeLessThan(0.2);
    // noise made low and soft: the samples never reach full scale once the sound's volume is applied
    const samples = renderSfx(sound.sfx!, 44100, sound.seed ?? 1);
    let peak = 0;
    for (const v of samples) peak = Math.max(peak, Math.abs(v));
    expect(peak * sound.volume).toBeLessThan(0.4);
  });

  it('an older project that has sounds gets it once, and keeps a player that was silent', () => {
    const old = normalizeProject({ version: 15, sounds: [builtInSound(SOUND_IDS.coin)], player: {} });
    expect(old.sounds.some((s) => s.id === SOUND_IDS.step)).toBe(true);
    expect(old.player.soundStep).toBe(SOUND_IDS.step);
    // deleted afterwards (the project is at the current version): it stays deleted, and the player is silent
    const saved = JSON.parse(JSON.stringify(old));
    saved.sounds = saved.sounds.filter((s: { id: string }) => s.id !== SOUND_IDS.step);
    expect(normalizeProject(saved).sounds.some((s) => s.id === SOUND_IDS.step)).toBe(false);
    expect(normalizeProject(saved).player.soundStep).toBeNull();
    // a project without any sounds is left as it is
    expect(normalizeProject({ version: 15, sounds: [] }).sounds).toEqual([]);
  });

  it('an exported game keeps the sound only when the player uses it', () => {
    const p = createDefaultProject();
    const used = pruneForExport(p);
    expect(used.sounds.some((s) => s.id === SOUND_IDS.step)).toBe(true);
    p.player.soundStep = null;
    expect(pruneForExport(p).sounds.some((s) => s.id === SOUND_IDS.step)).toBe(false);
  });
});
