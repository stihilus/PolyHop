// On-screen controls for phones and tablets: a floating stick on the left half of the screen to move,
// dragging on the right half to look, and buttons for jump, run, crouch and interact.
// `TouchState` is the pure part (pointers in, input out); `TouchControls` draws it and feeds it.

export type TouchButton = 'jump' | 'run' | 'crouch' | 'interact';
export type TouchRole = 'move' | 'look' | TouchButton;

export interface TouchSample {
  /** -1..1, +1 = right. */
  moveX: number;
  /** -1..1, +1 = forward. */
  moveY: number;
  /** Pixels dragged since the last sample (in mouse-pixel units, ready for the camera). */
  lookX: number;
  lookY: number;
  /** Held (a tap shorter than a frame still counts as held for that frame). */
  jump: boolean;
  run: boolean;
  crouch: boolean;
  interact: boolean;
  /** Went down since the last sample. */
  jumpPressed: boolean;
  interactPressed: boolean;
}

/** Whatever feeds the game with touch input. */
export interface TouchSource {
  sample(): TouchSample;
}

/** The stick vector for a finger `dx`, `dy` pixels from where it landed: unit length at `radius`, nothing in the dead zone. */
export function stickVector(dx: number, dy: number, radius: number, deadzone = 0.15): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len === 0 || radius <= 0) return { x: 0, y: 0 };
  const m = Math.min(1, len / radius);
  if (m < deadzone) return { x: 0, y: 0 };
  const scaled = (m - deadzone) / (1 - deadzone);
  return { x: (dx / len) * scaled, y: (dy / len) * scaled };
}

interface Finger {
  role: TouchRole;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

export class TouchState implements TouchSource {
  /** How far a finger goes from where it landed for full speed, in pixels. */
  stickRadius = 56;
  /** Finger pixels -> mouse pixels. Fingers cover less distance than a mouse, so looking is sped up. */
  lookScale = 1.7;
  private fingers = new Map<number, Finger>();
  private lookX = 0;
  private lookY = 0;
  /** Buttons that went down since the last sample (a quick tap must not fall between two frames). */
  private edges = new Set<TouchButton>();

  down(id: number, x: number, y: number, role: TouchRole): void {
    // one finger per stick; a second finger on the same stick takes it over
    if (role === 'move') for (const [other, f] of this.fingers) if (f.role === 'move') this.fingers.delete(other);
    this.fingers.set(id, { role, x0: x, y0: y, x, y });
    if (role !== 'move' && role !== 'look') this.edges.add(role);
  }

  move(id: number, x: number, y: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    if (f.role === 'look') {
      this.lookX += (x - f.x) * this.lookScale;
      this.lookY += (y - f.y) * this.lookScale;
    }
    f.x = x;
    f.y = y;
  }

  up(id: number): void {
    this.fingers.delete(id);
  }

  /** Let go of everything (the screen changed, the game paused). */
  release(): void {
    this.fingers.clear();
    this.edges.clear();
    this.lookX = this.lookY = 0;
  }

  /** Where the stick was put down and where the finger is now, for drawing it; null when not in use. */
  stick(): { x0: number; y0: number; x: number; y: number } | null {
    for (const f of this.fingers.values()) if (f.role === 'move') return { x0: f.x0, y0: f.y0, x: f.x, y: f.y };
    return null;
  }

  isHeld(button: TouchButton): boolean {
    for (const f of this.fingers.values()) if (f.role === button) return true;
    return false;
  }

  sample(): TouchSample {
    let moveX = 0;
    let moveY = 0;
    for (const f of this.fingers.values()) {
      if (f.role !== 'move') continue;
      const v = stickVector(f.x - f.x0, f.y - f.y0, this.stickRadius);
      moveX = v.x;
      moveY = -v.y; // dragging up is forward
    }
    const out: TouchSample = {
      moveX,
      moveY,
      lookX: this.lookX,
      lookY: this.lookY,
      jump: this.isHeld('jump') || this.edges.has('jump'),
      run: this.isHeld('run') || this.edges.has('run'),
      crouch: this.isHeld('crouch') || this.edges.has('crouch'),
      interact: this.isHeld('interact') || this.edges.has('interact'),
      jumpPressed: this.edges.has('jump'),
      interactPressed: this.edges.has('interact'),
    };
    this.edges.clear();
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }
}

/** Does this device want on-screen controls? A touch screen as the main pointer, or `?touch` in the address. */
export function wantsTouchControls(): boolean {
  try {
    if (new URLSearchParams(location.search).has('touch')) return true;
    return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

const BUTTONS: { role: TouchButton; label: string; size: number; right: number; bottom: number }[] = [
  { role: 'jump', label: 'Jump', size: 88, right: 22, bottom: 26 },
  { role: 'interact', label: 'Use', size: 62, right: 122, bottom: 28 },
  { role: 'run', label: 'Run', size: 58, right: 24, bottom: 130 },
  { role: 'crouch', label: 'Duck', size: 58, right: 96, bottom: 112 },
];

/** The on-screen controls inside `parent` (the game's page area). */
export class TouchControls {
  readonly state = new TouchState();
  readonly element: HTMLElement;
  private stickRing: HTMLElement;
  private stickKnob: HTMLElement;
  private buttonEls = new Map<TouchButton, HTMLElement>();

  /** `onPause` is called by the small pause button. */
  constructor(
    parent: HTMLElement,
    private onPause: () => void,
  ) {
    this.element = document.createElement('div');
    Object.assign(this.element.style, {
      position: 'absolute',
      inset: '0',
      zIndex: '15',
      display: 'none',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      fontFamily: '"Departure Mono", ui-monospace, monospace',
    } as Partial<CSSStyleDeclaration>);

    const zone = (role: TouchRole, left: string, width: string) => {
      const z = document.createElement('div');
      Object.assign(z.style, { position: 'absolute', top: '0', bottom: '0', left, width, touchAction: 'none' });
      this.listen(z, role);
      this.element.append(z);
    };
    zone('move', '0', '50%');
    zone('look', '50%', '50%');

    this.stickRing = this.circle(112, 'rgba(255,255,255,0.14)', '2px solid rgba(255,255,255,0.35)');
    this.stickKnob = this.circle(52, 'rgba(255,178,62,0.55)', '2px solid rgba(255,178,62,0.9)');
    this.stickRing.style.display = this.stickKnob.style.display = 'none';
    this.element.append(this.stickRing, this.stickKnob);

    for (const b of BUTTONS) {
      const el = this.circle(b.size, 'rgba(20,22,27,0.45)', '2px solid rgba(255,255,255,0.45)');
      Object.assign(el.style, {
        position: 'absolute',
        right: `${b.right}px`,
        bottom: `${b.bottom}px`,
        left: 'auto',
        top: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: b.size > 70 ? '16px' : '12px',
        pointerEvents: 'auto',
        touchAction: 'none',
      });
      el.textContent = b.label;
      this.listen(el, b.role);
      this.buttonEls.set(b.role, el);
      this.element.append(el);
    }

    const pause = document.createElement('button');
    pause.textContent = 'II';
    Object.assign(pause.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      width: '44px',
      height: '44px',
      borderRadius: '10px',
      border: '2px solid rgba(255,255,255,0.5)',
      background: 'rgba(20,22,27,0.5)',
      color: '#fff',
      font: 'inherit',
      fontSize: '16px',
      pointerEvents: 'auto',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);
    pause.addEventListener('click', () => this.onPause());
    this.element.append(pause);
    parent.append(this.element);
  }

  private circle(size: number, background: string, border: string): HTMLElement {
    const c = document.createElement('div');
    Object.assign(c.style, {
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      boxSizing: 'border-box',
      borderRadius: '50%',
      background,
      border,
      pointerEvents: 'none',
    });
    return c;
  }

  private listen(el: HTMLElement, role: TouchRole): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // capture can fail for synthetic pointers; moves over the element still arrive
      }
      this.state.down(e.pointerId, e.clientX, e.clientY, role);
      this.paint();
    });
    el.addEventListener('pointermove', (e) => {
      this.state.move(e.pointerId, e.clientX, e.clientY);
      this.paint();
    });
    const end = (e: PointerEvent) => {
      this.state.up(e.pointerId);
      this.paint();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  private paint(): void {
    const stick = this.state.stick();
    const box = this.element.getBoundingClientRect();
    if (stick) {
      const r = this.state.stickRadius;
      const dx = stick.x - stick.x0;
      const dy = stick.y - stick.y0;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, len / r);
      const kx = stick.x0 + (dx / len) * k * r;
      const ky = stick.y0 + (dy / len) * k * r;
      this.place(this.stickRing, stick.x0 - box.left, stick.y0 - box.top);
      this.place(this.stickKnob, kx - box.left, ky - box.top);
      this.stickRing.style.display = this.stickKnob.style.display = 'block';
    } else {
      this.stickRing.style.display = this.stickKnob.style.display = 'none';
    }
    for (const [role, el] of this.buttonEls) {
      el.style.background = this.state.isHeld(role) ? 'rgba(255,178,62,0.6)' : 'rgba(20,22,27,0.45)';
    }
  }

  private place(el: HTMLElement, cx: number, cy: number): void {
    const w = el.offsetWidth || parseFloat(el.style.width);
    el.style.left = `${cx - w / 2}px`;
    el.style.top = `${cy - w / 2}px`;
  }

  show(): void {
    this.element.style.display = 'block';
  }

  hide(): void {
    this.element.style.display = 'none';
    this.state.release();
    this.paint();
  }

  dispose(): void {
    this.element.remove();
  }
}
