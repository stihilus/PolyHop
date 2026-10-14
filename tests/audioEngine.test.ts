import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sfxPreset } from '../src/core/sfx';
import { type SoundAsset, newMusic, newSfx } from '../src/core/sounds';
import { AudioEngine } from '../src/runtime/audio';

/** The little of Web Audio the engine touches, counting the buffers it has to make (a sound is rendered once per buffer). */
class FakeAudioContext {
  static buffers = 0;
  state = 'running';
  currentTime = 0;
  destination = {};
  createGain() {
    return { gain: { value: 1 }, connect: (n: unknown) => n, disconnect() {} };
  }
  createBuffer(_channels: number, length: number, rate: number) {
    FakeAudioContext.buffers++;
    return { duration: length / rate, copyToChannel() {} };
  }
  createBufferSource() {
    return { buffer: null, loop: false, playbackRate: { value: 1 }, connect: (n: unknown) => n, disconnect() {}, start() {}, stop() {} };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

const g = globalThis as unknown as { window?: unknown };
let before: unknown;

beforeEach(() => {
  before = g.window;
  g.window = { AudioContext: FakeAudioContext };
  FakeAudioContext.buffers = 0;
});

afterEach(() => {
  g.window = before;
});

describe('the audio engine and sounds that are edited in place', () => {
  it('makes a sound again after one of its sliders was moved (same object, other numbers)', () => {
    const engine = new AudioEngine();
    const sound: SoundAsset = newSfx('jump', 'Jump', 'jump', 3);
    engine.setSounds([sound], 1);
    engine.play('jump');
    expect(FakeAudioContext.buffers).toBe(1);
    // nothing changed: the sound that was made is used again
    engine.setSounds([sound], 1);
    engine.play('jump');
    expect(FakeAudioContext.buffers).toBe(1);
    // the Audio tab changes the numbers of the very object the engine was given
    sound.sfx!.startFreq = Math.min(1, sound.sfx!.startFreq + 0.2);
    engine.setSounds([sound], 1);
    engine.play('jump');
    expect(FakeAudioContext.buffers).toBe(2);
  });

  it('makes a sound again when a preset replaced its parameters', () => {
    const engine = new AudioEngine();
    const sound = newSfx('hit', 'Hit', 'hit', 1);
    engine.setSounds([sound], 1);
    engine.play('hit');
    sound.seed = 9;
    sound.sfx = sfxPreset('laser', 9);
    engine.setSounds([sound], 1);
    engine.play('hit');
    expect(FakeAudioContext.buffers).toBe(2);
  });

  it('makes a tune again after a note was added, and not when only the volume changed', () => {
    const engine = new AudioEngine();
    const tune = newMusic('m', 'Tune', 5);
    engine.setSounds([tune], 1);
    engine.play('m');
    expect(FakeAudioContext.buffers).toBe(1);
    // the volume is applied when the sound plays, it is not a part of what is rendered
    tune.volume = 0.2;
    engine.setSounds([tune], 1);
    engine.play('m');
    expect(FakeAudioContext.buffers).toBe(1);
    tune.music!.channels[0]!.steps[3] = 4;
    engine.setSounds([tune], 1);
    engine.play('m');
    expect(FakeAudioContext.buffers).toBe(2);
  });

  it('forgets a sound that was removed, and makes it again when it comes back', () => {
    const engine = new AudioEngine();
    const sound = newSfx('coin', 'Coin', 'coin', 2);
    engine.setSounds([sound], 1);
    engine.play('coin');
    engine.setSounds([], 1);
    engine.setSounds([sound], 1);
    engine.play('coin');
    expect(FakeAudioContext.buffers).toBe(2);
  });
});
