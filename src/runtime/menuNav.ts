// Moving through the buttons, sliders and lists of a menu without a mouse: the arrow keys of a keyboard, or the D-pad
// and the left stick of a gamepad (Cross picks, Circle goes back). It works on whichever screen is on top (the
// start menu, the settings, the end screen), and only shows its highlight once it has been used.

import { PAD } from '../core/gamepad';
import type { PadReader } from './gamepad';

export interface MenuNavOptions {
  /** The screens that can be moved through, topmost first (a hidden or missing one is skipped). */
  layers(): (HTMLElement | null)[];
  /** True while something else wants the keys (a key of the controls is being picked). */
  blocked(): boolean;
}

const ITEMS = 'button:not([disabled]), input:not([disabled]):not([type=file]):not([type=hidden]), select:not([disabled])';
const STYLE_ID = 'polyhop-menu-nav';

function visible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

export class MenuNav {
  /** The highlight is showing (a key or a button of a pad moved it). */
  private on = false;
  private current: HTMLElement | null = null;

  constructor(private options: MenuNavOptions) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '[data-nav="1"]{outline:3px solid #fff !important;outline-offset:2px;border-radius:8px}';
      document.head.append(style);
    }
    window.addEventListener('keydown', this.onKey);
    // a click with the mouse takes the highlight away
    window.addEventListener('pointerdown', () => this.hide(), true);
  }

  /** The screen the keys and the pad work on right now. */
  private layer(): HTMLElement | null {
    for (const l of this.options.layers()) {
      if (l && visible(l) && this.items(l).length > 0) return l;
    }
    return null;
  }

  private items(layer: HTMLElement): HTMLElement[] {
    return Array.from(layer.querySelectorAll<HTMLElement>(ITEMS)).filter(visible);
  }

  private hide(): void {
    this.on = false;
    this.mark(null);
  }

  private mark(el: HTMLElement | null): void {
    if (this.current && this.current !== el) this.current.removeAttribute('data-nav');
    this.current = el;
    if (el) {
      el.setAttribute('data-nav', '1');
      el.focus({ preventScroll: true });
    }
  }

  /** Where the highlight is, found again when the screen was drawn anew. */
  private position(layer: HTMLElement): { items: HTMLElement[]; index: number } {
    const items = this.items(layer);
    const active = document.activeElement as HTMLElement | null;
    let index = this.current ? items.indexOf(this.current) : -1;
    if (index < 0 && active && layer.contains(active)) index = items.indexOf(active);
    return { items, index };
  }

  private move(layer: HTMLElement, delta: number): void {
    const { items, index } = this.position(layer);
    if (items.length === 0) return;
    // the first step only shows where it is
    const next = !this.on || index < 0 ? Math.max(0, index) : (index + delta + items.length) % items.length;
    this.on = true;
    this.mark(items[next]!);
  }

  /** Left / right: a slider moves, a list changes, a box is ticked or cleared. */
  private adjust(layer: HTMLElement, delta: number): void {
    const { items, index } = this.position(layer);
    const el = index >= 0 ? items[index] : undefined;
    if (!el || !this.on) {
      this.move(layer, delta);
      return;
    }
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const step = Math.max(Number(el.step) || 1, (max - min) / 20);
      el.value = String(Math.min(max, Math.max(min, Number(el.value) + delta * step)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLSelectElement) {
      const n = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + delta));
      if (n !== el.selectedIndex) {
        el.selectedIndex = n;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      const want = delta > 0;
      if (el.checked !== want) el.click();
    }
  }

  /** Cross: press the button, tick the box, take the next entry of a list. */
  private activate(layer: HTMLElement): void {
    if (!this.on) {
      this.move(layer, 0);
    }
    const { items, index } = this.position(layer);
    const el = index >= 0 ? items[index] : undefined;
    if (!el) return;
    if (el instanceof HTMLSelectElement) {
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLInputElement && el.type === 'range') {
      // a slider has nothing to press
    } else {
      el.click();
    }
  }

  /** Circle: the button of the screen that goes back (marked `data-nav-back`). */
  private back(layer: HTMLElement): void {
    layer.querySelector<HTMLElement>('[data-nav-back]')?.click();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.options.blocked() || e.altKey || e.ctrlKey || e.metaKey) return;
    const layer = this.layer();
    if (!layer) return;
    switch (e.code) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        this.move(layer, e.code === 'ArrowDown' ? 1 : -1);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        this.adjust(layer, e.code === 'ArrowRight' ? 1 : -1);
        break;
      default:
        break;
    }
  };

  /** Call once a frame with the pad of the player. */
  update(pad: PadReader): void {
    const layer = this.layer();
    if (!layer) {
      if (this.on) this.hide();
      return;
    }
    // the screen was drawn anew (the settings were opened, a key was picked): put the highlight on the same place again
    if (this.on && this.current && !this.current.isConnected) {
      const { items } = this.position(layer);
      this.mark(items[0] ?? null);
    }
    if (this.options.blocked()) return;
    if (pad.navY !== 0) this.move(layer, pad.navY);
    if (pad.navX !== 0) this.adjust(layer, pad.navX);
    if (pad.pressed(PAD.cross)) this.activate(layer);
    if (pad.pressed(PAD.circle)) this.back(layer);
  }
}
