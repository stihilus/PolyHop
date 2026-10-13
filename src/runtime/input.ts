import type { Action, ProjectSettings } from '../core/types';
import type { TouchSource } from './touch';

export interface InputFrame {
  moveX: number;
  moveY: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  run: boolean;
  crouch: boolean;
  /** The interact key (talk, pull a lever) went down this frame. */
  interactPressed: boolean;
  /** A number key 1-4 went down this frame (answers in a conversation): 0-3, or -1. */
  answer: number;
  /** Camera look in "mouse pixels" for this frame (stick input already converted using dt). */
  lookX: number;
  lookY: number;
}

const STICK_DEADZONE = 0.2;
const STICK_LOOK_PIXELS_PER_SEC = 900;

/** Keyboard + mouse + gamepad, mapped through the project's control bindings. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private dragging = false;
  private prevPadJump = false;
  private prevPadInteract = false;
  private attached = false;
  /** On-screen controls of a phone, when there are any. */
  touch: TouchSource | null = null;

  constructor(private canvas: HTMLElement) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.down.clear();
    this.pressed.clear();
    this.dragging = false;
    this.lookDX = this.lookDY = 0;
  }

  /** Forget held keys, pressed edges and mouse movement (after a pause or a lost focus). */
  clear(): void {
    this.down.clear();
    this.pressed.clear();
    this.dragging = false;
    this.lookDX = this.lookDY = 0;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    // keep Space/arrows from scrolling the page while playing (but not from working in a menu's slider)
    const t = e.target;
    const inForm = t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
    if (!inForm && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private onBlur = () => {
    this.down.clear();
    this.dragging = false;
  };
  private onMouseDown = (e: MouseEvent) => {
    this.dragging = true;
    e.preventDefault();
  };
  private onMouseUp = () => {
    this.dragging = false;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas || this.dragging) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    }
  };
  private onContextMenu = (e: Event) => e.preventDefault();

  private anyDown(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }
  private anyPressed(codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Sample input for one rendered frame; clears the edge/delta accumulators. */
  poll(settings: ProjectSettings, dt: number): InputFrame {
    const c = settings.controls as Record<Action, string[]>;
    let moveX = (this.anyDown(c.right) ? 1 : 0) - (this.anyDown(c.left) ? 1 : 0);
    let moveY = (this.anyDown(c.forward) ? 1 : 0) - (this.anyDown(c.back) ? 1 : 0);
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    let jumpPressed = this.anyPressed(c.jump);
    let jumpHeld = this.anyDown(c.jump);
    let run = this.anyDown(c.run);
    let crouch = this.anyDown(c.crouch);
    let interactPressed = this.anyPressed(c.interact);
    let lookX = this.lookDX;
    let lookY = this.lookDY;

    if (settings.gamepad) {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find((g) => g && g.connected);
      if (pad) {
        const lx = pad.axes[0] ?? 0;
        const ly = pad.axes[1] ?? 0;
        const mag = Math.hypot(lx, ly);
        if (mag > STICK_DEADZONE) {
          const scale = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / mag;
          moveX += lx * scale;
          moveY += -ly * scale;
          const l2 = Math.hypot(moveX, moveY);
          if (l2 > 1) {
            moveX /= l2;
            moveY /= l2;
          }
        }
        const rx = pad.axes[2] ?? 0;
        const ry = pad.axes[3] ?? 0;
        if (Math.hypot(rx, ry) > STICK_DEADZONE) {
          lookX += rx * STICK_LOOK_PIXELS_PER_SEC * dt;
          lookY += ry * STICK_LOOK_PIXELS_PER_SEC * dt;
        }
        const padJump = !!pad.buttons[0]?.pressed; // A / Cross
        if (padJump && !this.prevPadJump) jumpPressed = true;
        this.prevPadJump = padJump;
        jumpHeld ||= padJump;
        run ||= !!pad.buttons[2]?.pressed || !!pad.buttons[7]?.pressed; // X / RT
        crouch ||= !!pad.buttons[1]?.pressed || !!pad.buttons[10]?.pressed; // B / L3
        const padInteract = !!pad.buttons[3]?.pressed; // Y / Triangle
        if (padInteract && !this.prevPadInteract) interactPressed = true;
        this.prevPadInteract = padInteract;
      }
    }

    if (this.touch) {
      const t = this.touch.sample();
      moveX += t.moveX;
      moveY += t.moveY;
      const len = Math.hypot(moveX, moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }
      lookX += t.lookX;
      lookY += t.lookY;
      if (t.jumpPressed) jumpPressed = true;
      jumpHeld ||= t.jump;
      run ||= t.run;
      crouch ||= t.crouch;
      if (t.interactPressed) interactPressed = true;
    }

    let answer = -1;
    ['Digit1', 'Digit2', 'Digit3', 'Digit4'].forEach((code, i) => {
      if (this.pressed.has(code) || this.pressed.has(`Numpad${i + 1}`)) answer = i;
    });
    const frame: InputFrame = { moveX, moveY, jumpPressed, jumpHeld, run, crouch, interactPressed, answer, lookX, lookY };
    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    return frame;
  }
}
