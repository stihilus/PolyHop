// The piano roll of the Audio tab: the notes of one channel on a grid of steps and scale degrees, with a keyboard
// of note names on the left, a ruler of bars on top, the other channels as ghosts, and a play position that
// moves along while the tune plays. It only shows and edits notes; undo, playback and saving belong to the editor.

import { UI_FONT_STACK } from '../core/fonts';
import { type MusicChannel, type MusicData, SCALES, channelLength, degreeCount, musicDuration } from '../core/music';
import { BAR_STEPS, barCount, degreeMidi, noteName, noteSpan, stepPosition } from '../core/musicEdit';
import { el } from './ui/dom';

/** One color per channel, used for its tab, its notes and its ghosts in the other channels. */
export const CHANNEL_COLORS = ['#ffb23e', '#52d6a6', '#6aa8ff', '#ff7b93', '#c692ff', '#ffd84d', '#6fe0ee', '#ff9a66'];

export const ROLL_ROW_H = 20;
const RULER_H = 26;
const KEYS_W = 64;
const DRUM_LABELS = ['Kick', 'Snare', 'Hat'];

export interface RollView {
  music: MusicData;
  channel: number;
  /** The selected bar (0-based) or null. */
  bar: number | null;
  /** Is this channel silent in the preview (muted, or not the solo one)? */
  silent: (index: number) => boolean;
  /** Show the notes of the other channels as ghosts. */
  showOthers: boolean;
  /** Width of one step in pixels. */
  cell: number;
}

export interface RollHooks {
  /** A gesture is about to change notes: take the snapshot for undo. Once per gesture. */
  beforeEdit(): void;
  /** A gesture changed notes. */
  edited(): void;
  /** Play the note of a row (a click on the keys, or a note that was just put down). */
  audition(degree: number): void;
  /** A bar was clicked on the ruler (null: the same bar again, so none). */
  selectBar(bar: number | null): void;
}

type Mode = 'paint' | 'erase';

export class MusicRoll {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private grid = el('canvas', { class: 'roll-grid' });
  private ruler = el('canvas', { class: 'roll-ruler' });
  private keys = el('canvas', { class: 'roll-keys' });
  private playhead = el('div', { class: 'roll-playhead' });
  private rulerMark = el('div', { class: 'roll-ruler-mark' });
  private hover = el('div', { class: 'roll-hover' });
  private status = el('div', { class: 'roll-status' });

  private mode: Mode | null = null;
  private began = false;
  private lastCol = -1;
  private lastRow = -1;
  private lastAudition = 0;

  constructor(private view: RollView, private hooks: RollHooks) {
    const rulerWrap = el('div', { class: 'roll-ruler-wrap' }, this.ruler, this.rulerMark);
    const keysWrap = el('div', { class: 'roll-keys-wrap' }, this.keys);
    const gridWrap = el('div', { class: 'roll-grid-wrap' }, this.grid, this.hover, this.playhead);
    this.scroller = el('div', { class: 'roll-scroll' }, el('div', { class: 'roll-corner' }), rulerWrap, keysWrap, gridWrap);
    this.el = el('div', { class: 'roll' }, this.scroller, this.status);
    this.setStatus(null);
    this.bind();
    this.redraw();
  }

  // ---------------------------------------------------------------- geometry

  private get channel(): MusicChannel {
    return this.view.music.channels[Math.min(this.view.channel, this.view.music.channels.length - 1)]!;
  }

  private get drums(): boolean {
    return this.channel.wave === 'noise';
  }

  private get rows(): number {
    return this.drums ? DRUM_LABELS.length : degreeCount(this.view.music.scale);
  }

  private get width(): number {
    return this.view.music.stepCount * this.view.cell;
  }

  private rowY(row: number): number {
    return (this.rows - 1 - row) * ROLL_ROW_H;
  }

  private cellAt(e: PointerEvent, clampToGrid: boolean): { c: number; r: number } | null {
    const rect = this.grid.getBoundingClientRect();
    let c = Math.floor((e.clientX - rect.left) / this.view.cell);
    let r = this.rows - 1 - Math.floor((e.clientY - rect.top) / ROLL_ROW_H);
    const inside = c >= 0 && c < this.view.music.stepCount && r >= 0 && r < this.rows;
    if (!inside && !clampToGrid) return null;
    c = Math.max(0, Math.min(this.view.music.stepCount - 1, c));
    r = Math.max(0, Math.min(this.rows - 1, r));
    return { c, r };
  }

  private setup(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
    // sharp on high-density screens, but never wider than a canvas may be
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 16000 / Math.max(1, w)));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // ---------------------------------------------------------------- drawing

  /** Draw everything again (after notes, the channel, the zoom or the selected bar changed). */
  redraw(): void {
    this.drawGrid();
    this.drawRuler();
    this.drawKeys();
  }

  private color(index: number): string {
    return CHANNEL_COLORS[index % CHANNEL_COLORS.length]!;
  }

  private drawGrid(): void {
    const { music: m, cell } = this.view;
    const ch = this.channel;
    const rows = this.rows;
    const len = SCALES[m.scale].length;
    const w = this.width;
    const h = rows * ROLL_ROW_H;
    const ctx = this.setup(this.grid, w, h);

    // rows: the root of the scale is tinted, the others alternate
    for (let r = 0; r < rows; r++) {
      const root = !this.drums && r % len === 0;
      ctx.fillStyle = root ? '#212838' : r % 2 === 0 ? '#1a1d25' : '#171a21';
      ctx.fillRect(0, this.rowY(r), w, ROLL_ROW_H);
    }
    // every other bar is a little lighter, so the structure of the tune can be seen from afar
    const bars = barCount(m);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let b = 1; b < bars; b += 2) ctx.fillRect(b * BAR_STEPS * cell, 0, BAR_STEPS * cell, h);
    if (this.view.bar !== null && this.view.bar < bars) {
      ctx.fillStyle = 'rgba(255,178,62,0.12)';
      ctx.fillRect(this.view.bar * BAR_STEPS * cell, 0, BAR_STEPS * cell, h);
    }
    // lines: bars, beats and (when there is room) steps
    for (let c = 0; c <= m.stepCount; c++) {
      const bar = c % BAR_STEPS === 0;
      const beat = c % 4 === 0;
      if (!bar && !beat && cell < 14) continue;
      ctx.fillStyle = bar ? '#5b6479' : beat ? '#363c4a' : '#252a34';
      ctx.fillRect(c * cell, 0, 1, h);
    }
    ctx.fillStyle = '#1f232c';
    for (let r = 1; r < rows; r++) ctx.fillRect(0, r * ROLL_ROW_H, w, 1);

    // the other channels, as thin ghosts at the pitch they have there
    if (this.view.showOthers && !this.drums) {
      m.channels.forEach((other, i) => {
        if (i === this.view.channel || other.wave === 'noise') return;
        const shift = (other.octave - ch.octave) * len;
        const hold = channelLength(other);
        ctx.fillStyle = this.color(i);
        ctx.globalAlpha = this.view.silent(i) ? 0.12 : 0.42;
        for (let c = 0; c < m.stepCount; c++) {
          const d = other.steps[c] ?? -1;
          if (d < 0) continue;
          const row = d + shift;
          if (row < 0 || row >= rows) continue;
          const span = noteSpan(m, c, hold);
          ctx.fillRect(c * cell + 1, this.rowY(row) + ROLL_ROW_H / 2 - 1.5, Math.max(3, span * cell - 2), 3);
        }
        ctx.globalAlpha = 1;
      });
    }

    // the notes of this channel
    const hold = this.drums ? 1 : channelLength(ch);
    const color = this.color(this.view.channel);
    const silent = this.view.silent(this.view.channel);
    ctx.globalAlpha = silent ? 0.38 : 1;
    for (let c = 0; c < m.stepCount; c++) {
      const d = ch.steps[c] ?? -1;
      if (d < 0 || d >= rows) continue;
      const span = noteSpan(m, c, hold);
      const x = c * cell + 1;
      const y = this.rowY(d) + 2;
      const nw = Math.max(4, span * cell - 2);
      const nh = ROLL_ROW_H - 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, nw, nh, 3);
      ctx.fill();
      if (span > 1 && (ch.wave === 'piano' || ch.wave === 'bell')) {
        // a struck note rings out: it fades along its length
        const g = ctx.createLinearGradient(x, 0, x + nw, 0);
        g.addColorStop(0, 'rgba(10,12,16,0)');
        g.addColorStop(1, 'rgba(10,12,16,0.62)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, y, nw, nh, 3);
        ctx.fill();
      } else if (span > 1 && ch.wave === 'pad') {
        // a pad swells and fades
        const g = ctx.createLinearGradient(x, 0, x + nw, 0);
        g.addColorStop(0, 'rgba(10,12,16,0.62)');
        g.addColorStop(0.35, 'rgba(10,12,16,0)');
        g.addColorStop(0.65, 'rgba(10,12,16,0)');
        g.addColorStop(1, 'rgba(10,12,16,0.62)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, y, nw, nh, 3);
        ctx.fill();
      }
      // a bright edge where the note starts
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y + 1, 2, nh - 2);
    }
    ctx.globalAlpha = 1;
    this.moveHover(null);
  }

  private drawRuler(): void {
    const { music: m, cell } = this.view;
    const w = this.width;
    const ctx = this.setup(this.ruler, w, RULER_H);
    ctx.fillStyle = '#1d2028';
    ctx.fillRect(0, 0, w, RULER_H);
    const bars = barCount(m);
    if (this.view.bar !== null && this.view.bar < bars) {
      ctx.fillStyle = 'rgba(255,178,62,0.28)';
      ctx.fillRect(this.view.bar * BAR_STEPS * cell, 0, BAR_STEPS * cell, RULER_H);
    }
    ctx.font = `600 11px ${UI_FONT_STACK}`;
    ctx.textBaseline = 'middle';
    // numbers every bar when there is room, every second or fourth bar when the loop is squeezed
    const every = BAR_STEPS * cell >= 44 ? 1 : BAR_STEPS * cell >= 22 ? 2 : 4;
    for (let c = 0; c <= m.stepCount; c++) {
      const bar = c % BAR_STEPS === 0;
      const beat = c % 4 === 0;
      if (!bar && !(beat && cell >= 10)) continue;
      ctx.fillStyle = bar ? '#7b8499' : '#464d5d';
      ctx.fillRect(c * cell, bar ? 0 : RULER_H - 7, 1, bar ? RULER_H : 7);
      if (bar && c < m.stepCount && (c / BAR_STEPS) % every === 0) {
        ctx.fillStyle = this.view.bar === c / BAR_STEPS ? '#ffe2ad' : '#aeb6c6';
        ctx.fillText(String(c / BAR_STEPS + 1), c * cell + 6, 11);
      }
    }
    ctx.fillStyle = '#2d323d';
    ctx.fillRect(0, RULER_H - 1, w, 1);
  }

  private drawKeys(): void {
    const { music: m } = this.view;
    const ch = this.channel;
    const rows = this.rows;
    const len = SCALES[m.scale].length;
    const ctx = this.setup(this.keys, KEYS_W, rows * ROLL_ROW_H);
    ctx.font = `600 10.5px ${UI_FONT_STACK}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let r = 0; r < rows; r++) {
      const y = this.rowY(r);
      const root = !this.drums && r % len === 0;
      ctx.fillStyle = root ? '#2b2619' : '#1d2028';
      ctx.fillRect(0, y, KEYS_W, ROLL_ROW_H);
      ctx.fillStyle = '#12141a';
      ctx.fillRect(0, y + ROLL_ROW_H - 1, KEYS_W, 1);
      ctx.fillStyle = this.color(this.view.channel);
      ctx.globalAlpha = root ? 0.9 : 0.35;
      ctx.fillRect(0, y, 3, ROLL_ROW_H - 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = root ? '#ffd9a0' : '#8f98aa';
      const label = this.drums ? DRUM_LABELS[r]! : noteName(degreeMidi(m, r, ch.octave));
      ctx.fillText(label, KEYS_W - 9, y + ROLL_ROW_H / 2 + 0.5);
    }
    ctx.fillStyle = '#2d323d';
    ctx.fillRect(KEYS_W - 1, 0, 1, rows * ROLL_ROW_H);
  }

  // ---------------------------------------------------------------- play position

  /** Seconds into the loop (null: nothing plays). While playing, the view follows the position. */
  setPlayhead(seconds: number | null): void {
    if (seconds === null) {
      this.playhead.style.display = 'none';
      this.rulerMark.style.display = 'none';
      return;
    }
    const duration = musicDuration(this.view.music);
    const x = duration > 0 ? (seconds / duration) * this.width : 0;
    this.playhead.style.display = 'block';
    this.rulerMark.style.display = 'block';
    this.playhead.style.transform = `translateX(${x}px)`;
    this.rulerMark.style.transform = `translateX(${x}px)`;
    const view = this.scroller.clientWidth - KEYS_W;
    const left = this.scroller.scrollLeft;
    if (view > 0 && (x < left || x > left + view - 24)) this.scroller.scrollLeft = Math.max(0, x - 40);
  }

  get scroll(): { left: number; top: number } {
    return { left: this.scroller.scrollLeft, top: this.scroller.scrollTop };
  }

  restoreScroll(s: { left: number; top: number }): void {
    this.scroller.scrollLeft = s.left;
    this.scroller.scrollTop = s.top;
  }

  /** Scroll so that a bar is in view. */
  showBar(bar: number): void {
    const x = bar * BAR_STEPS * this.view.cell;
    const view = this.scroller.clientWidth - KEYS_W;
    const left = this.scroller.scrollLeft;
    if (x < left || x + BAR_STEPS * this.view.cell > left + view) this.scroller.scrollLeft = Math.max(0, x - 24);
  }

  // ---------------------------------------------------------------- pointer

  private setStatus(p: { c: number; r: number } | null): void {
    if (!p) {
      this.status.textContent = 'Click to put a note, click it again to take it away. Drag to draw a run of notes, right-drag to erase.';
      return;
    }
    const pos = stepPosition(p.c);
    const label = this.drums ? DRUM_LABELS[p.r]! : noteName(degreeMidi(this.view.music, p.r, this.channel.octave));
    const has = (this.channel.steps[p.c] ?? -1) >= 0;
    this.status.textContent = `Bar ${pos.bar + 1}, beat ${pos.beat + 1}${pos.sub ? `.${pos.sub + 1}` : ''} · ${label}${has ? ' · has a note' : ''}`;
  }

  private moveHover(p: { c: number; r: number } | null): void {
    if (!p) {
      this.hover.style.display = 'none';
      return;
    }
    const cell = this.view.cell;
    Object.assign(this.hover.style, {
      display: 'block',
      width: `${cell}px`,
      height: `${ROLL_ROW_H}px`,
      transform: `translate(${p.c * cell}px, ${this.rowY(p.r)}px)`,
    });
  }

  private apply(c: number, r: number): void {
    const ch = this.channel;
    const now = ch.steps[c] ?? -1;
    const next = this.mode === 'paint' ? r : -1;
    if (now === next) return;
    if (!this.began) {
      this.hooks.beforeEdit();
      this.began = true;
    }
    ch.steps[c] = next;
  }

  private bind(): void {
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
    this.grid.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      const p = this.cellAt(e, false);
      if (!p) return;
      e.preventDefault();
      const existing = this.channel.steps[p.c] ?? -1;
      this.mode = e.button === 2 || e.altKey || existing === p.r ? 'erase' : 'paint';
      this.began = false;
      this.lastCol = p.c;
      this.lastRow = p.r;
      this.grid.setPointerCapture(e.pointerId);
      this.apply(p.c, p.r);
      if (this.mode === 'paint') this.hooks.audition(p.r);
      this.drawGrid();
    });
    this.grid.addEventListener('pointermove', (e) => {
      const p = this.cellAt(e, this.mode !== null);
      if (!this.mode) {
        this.moveHover(p);
        this.setStatus(p);
        return;
      }
      if (!p) return;
      this.moveHover(p);
      this.setStatus(p);
      if (p.c === this.lastCol && p.r === this.lastRow) return;
      // a fast drag skips columns: fill the ones in between
      const from = Math.min(this.lastCol, p.c);
      const to = Math.max(this.lastCol, p.c);
      for (let c = from; c <= to; c++) this.apply(c, p.r);
      if (this.mode === 'paint' && p.r !== this.lastRow && performance.now() - this.lastAudition > 70) {
        this.lastAudition = performance.now();
        this.hooks.audition(p.r);
      }
      this.lastCol = p.c;
      this.lastRow = p.r;
      this.drawGrid();
    });
    const end = (e: PointerEvent) => {
      if (!this.mode) return;
      this.mode = null;
      if (this.grid.hasPointerCapture(e.pointerId)) this.grid.releasePointerCapture(e.pointerId);
      if (this.began) this.hooks.edited();
      this.began = false;
    };
    this.grid.addEventListener('pointerup', end);
    this.grid.addEventListener('pointercancel', end);
    this.grid.addEventListener('pointerleave', () => {
      if (!this.mode) {
        this.moveHover(null);
        this.setStatus(null);
      }
    });

    // the ruler picks a bar
    this.ruler.addEventListener('pointerdown', (e) => {
      const rect = this.ruler.getBoundingClientRect();
      const bar = Math.floor((e.clientX - rect.left) / (BAR_STEPS * this.view.cell));
      if (bar < 0 || bar >= barCount(this.view.music)) return;
      this.hooks.selectBar(this.view.bar === bar ? null : bar);
    });

    // the keys play the note
    this.keys.addEventListener('pointerdown', (e) => {
      const rect = this.keys.getBoundingClientRect();
      const r = this.rows - 1 - Math.floor((e.clientY - rect.top) / ROLL_ROW_H);
      if (r >= 0 && r < this.rows) this.hooks.audition(r);
    });
  }
}
