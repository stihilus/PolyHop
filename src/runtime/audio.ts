import { renderMusic } from '../core/music';
import { SFX_SAMPLE_RATE, renderSfx } from '../core/sfx';
import { type SoundAsset, TALK_VOICES, builtInSound } from '../core/sounds';

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

type AudioContextCtor = typeof AudioContext;

/**
 * Plays the sounds of a project with Web Audio. Generated effects and music are rendered from their
 * parameters when first needed; imported files are decoded. The context is created on the first play
 * (browsers only allow sound after a click or key press).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sounds = new Map<string, SoundAsset>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private music: { source: AudioBufferSourceNode; gain: GainNode; id: string } | null = null;
  private volume = 1;
  muted = false;

  /** Give the engine the project's sounds (call again after they were edited). */
  setSounds(sounds: SoundAsset[], masterVolume: number): void {
    const old = this.sounds;
    this.sounds = new Map(sounds.map((s) => [s.id, s] as const));
    // the voices of the characters are always there, also in a project that was made before they existed
    for (const id of TALK_VOICES) {
      const voice = this.sounds.has(id) ? null : builtInSound(id);
      if (voice) this.sounds.set(id, voice);
    }
    this.volume = masterVolume;
    // a sound that was edited or removed is rendered again next time
    for (const [id, s] of old) {
      const now = this.sounds.get(id);
      if (!now || JSON.stringify(now) !== JSON.stringify(s)) this.buffers.delete(id);
    }
    this.applyVolume();
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const C: AudioContextCtor | undefined = (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!C) return null;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolume();
    return this.ctx;
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /** Master volume 0..1 (the player's slider). */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  /** Get a sound ready before it is needed (a long tune takes a moment to make). */
  preload(id: string | null): void {
    if (id) void this.buffer(id);
  }

  /** Wake the context up (call from a click or key press). */
  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private buffer(id: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return cached;
    const ctx = this.ensure();
    const sound = this.sounds.get(id);
    if (!ctx || !sound) return Promise.resolve(null);
    let promise: Promise<AudioBuffer | null>;
    if (sound.kind === 'sfx' && sound.sfx) {
      const data = renderSfx(sound.sfx, SFX_SAMPLE_RATE, sound.seed ?? 1);
      promise = Promise.resolve(this.fromSamples(ctx, data, SFX_SAMPLE_RATE));
    } else if (sound.kind === 'music' && sound.music) {
      promise = Promise.resolve(this.fromSamples(ctx, renderMusic(sound.music, 22050), 22050));
    } else if (sound.kind === 'file' && sound.file) {
      promise = ctx.decodeAudioData(base64ToBytes(sound.file.data).buffer).catch(() => null);
    } else {
      promise = Promise.resolve(null);
    }
    this.buffers.set(id, promise);
    return promise;
  }

  private fromSamples(ctx: AudioContext, data: Float32Array, rate: number): AudioBuffer | null {
    if (data.length === 0) return null;
    const buf = ctx.createBuffer(1, data.length, rate);
    buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    return buf;
  }

  /** Play a sound once. `rate` changes the pitch (1 = as made). */
  play(id: string | null, rate = 1): void {
    if (!id || this.muted) return;
    const sound = this.sounds.get(id);
    if (!sound) return;
    void this.buffer(id).then((buf) => {
      const ctx = this.ctx;
      if (!buf || !ctx || !this.master) return;
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = sound.volume;
      source.connect(gain).connect(this.master);
      source.start();
    });
  }

  /** Start a music loop (replacing the one playing). null stops the music. */
  playMusic(id: string | null): void {
    if (this.music && this.music.id === id) return;
    this.stopMusic();
    if (!id) return;
    const sound = this.sounds.get(id);
    if (!sound) return;
    void this.buffer(id).then((buf) => {
      const ctx = this.ctx;
      if (!buf || !ctx || !this.master) return;
      // the request may be stale by now
      if (this.music) return;
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = sound.volume;
      source.connect(gain).connect(this.master);
      source.start();
      this.music = { source, gain, id };
    });
  }

  stopMusic(): void {
    if (!this.music) return;
    try {
      this.music.source.stop();
    } catch {
      // already stopped
    }
    this.music.source.disconnect();
    this.music = null;
  }

  /** Is this sound the music being played? */
  get musicId(): string | null {
    return this.music?.id ?? null;
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.buffers.clear();
  }
}
