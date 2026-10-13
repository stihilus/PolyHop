// The words of a conversation appear letter by letter, and every few letters a little sound plays:
// what a character's voice sounds like (Animal Crossing, Zelda). Pure logic, so it is tested without a screen.

/** Letters per second when a conversation does not say. */
export const DEFAULT_SPEED = 30;

/** Seconds the text waits after a mark, so a sentence has a rhythm. */
function pause(ch: string): number {
  if ('.!?…'.includes(ch)) return 0.28;
  if (',;:'.includes(ch)) return 0.13;
  if (ch === '\n') return 0.2;
  return 0;
}

/** A letter or a digit makes a sound; spaces and marks do not. */
export function isVoiced(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

export class Typewriter {
  /** How many characters can be read now. */
  shown = 0;
  private acc = 0;
  private hold = 0;

  /** `speed` is letters per second; 0 (or less) shows everything at once. */
  constructor(
    readonly text: string,
    readonly speed: number,
  ) {
    if (!(speed > 0)) this.shown = text.length;
  }

  get done(): boolean {
    return this.shown >= this.text.length;
  }

  /** The part that can be read now. */
  get visible(): string {
    return this.text.slice(0, this.shown);
  }

  /** Let `dt` seconds pass. Returns the characters that appeared meanwhile. */
  update(dt: number): string {
    if (this.done) return '';
    this.acc += Math.max(0, dt);
    const per = 1 / this.speed;
    const start = this.shown;
    while (this.shown < this.text.length) {
      if (this.hold > 0) {
        if (this.acc < this.hold) {
          this.hold -= this.acc;
          this.acc = 0;
          break;
        }
        this.acc -= this.hold;
        this.hold = 0;
      }
      if (this.acc < per) break;
      this.acc -= per;
      this.hold = pause(this.text[this.shown]!);
      this.shown++;
    }
    if (this.done) this.acc = this.hold = 0;
    return this.text.slice(start, this.shown);
  }

  /** Show all of it now (the player pressed a button). */
  finish(): void {
    this.shown = this.text.length;
    this.acc = this.hold = 0;
  }
}

/**
 * Decides which letters make a sound and how high. Slower text sounds on more letters, fast text on every
 * few, so it never turns into a buzz. Each sound is a little higher or lower than the last (`jitter`),
 * the way a person's voice moves.
 */
export class VoiceBlips {
  private count = 0;
  private every: number;

  constructor(
    speed: number,
    /** The character's own pitch: 1 as the sound was made. */
    readonly pitch = 1,
    private random: () => number = Math.random,
    /** How far a sound strays from the pitch, as a share of it. */
    readonly jitter = 0.14,
  ) {
    this.every = Math.max(1, Math.round(speed / 15));
  }

  /** The playback rates of the sounds to make for these new characters (one per sound). */
  rates(appeared: string): number[] {
    const out: number[] = [];
    for (const ch of appeared) {
      if (!isVoiced(ch)) continue;
      this.count++;
      if ((this.count - 1) % this.every !== 0) continue;
      out.push(this.pitch * (1 + (this.random() * 2 - 1) * this.jitter));
    }
    return out;
  }
}
