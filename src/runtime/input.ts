import { PAD, PAD_AXES } from '../core/gamepad';
import type { Action, ProjectSettings } from '../core/types';
import { PadReader } from './gamepad';
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
  /**
   * Menu-style steps for a question: -1 up / +1 down, from the forward and back keys, the arrows, the D-pad and the
   * left stick of a gamepad (the stick and the D-pad repeat while held).
   */
  navY: number;
  /** Enter, or a button that does the job of "yes": Jump, Interact, Cross, Triangle (went down this frame). */
  confirm: boolean;
}

const STICK_LOOK_PIXELS_PER_SEC = 900;

/** Keyboard + mouse + gamepad, mapped through the project's control bindings. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private lookDX = 0;
  private lookDY = 0;
  private dragging = false;
  private pad = new PadReader();
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
    // a button of the pad that is still held is not a new press
    this.pad.sync();
  }

  /** A gamepad is plugged in (and the game listens to it). */
  get padConnected(): boolean {
    return this.pad.connected;
  }

  /** The player used the gamepad a moment ago (the hints name its buttons then). */
  get padActive(): boolean {
    return this.padRecent > 0;
  }
  private padRecent = 0;

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

    let navY = (this.anyPressed(c.back) ? 1 : 0) - (this.anyPressed(c.forward) ? 1 : 0);
    let confirm = this.pressed.has('Enter') || this.pressed.has('NumpadEnter');
    this.pad.poll(dt);
    if (settings.gamepad && this.pad.connected) {
      const pad = this.pad;
      // the left stick and the D-pad walk
      const [lx, ly] = pad.stick(PAD_AXES.leftX, PAD_AXES.leftY);
      moveX += lx + (pad.down(PAD.right) ? 1 : 0) - (pad.down(PAD.left) ? 1 : 0);
      moveY += -ly + (pad.down(PAD.up) ? 1 : 0) - (pad.down(PAD.down) ? 1 : 0);
      const mag = Math.hypot(moveX, moveY);
      if (mag > 1) {
        moveX /= mag;
        moveY /= mag;
      }
      // the right stick looks
      const [rx, ry] = pad.stick(PAD_AXES.rightX, PAD_AXES.rightY);
      lookX += rx * STICK_LOOK_PIXELS_PER_SEC * dt;
      lookY += ry * STICK_LOOK_PIXELS_PER_SEC * dt;
      if (pad.pressed(PAD.cross)) {
        jumpPressed = true;
        confirm = true;
      }
      jumpHeld ||= pad.down(PAD.cross);
      run ||= pad.down(PAD.square) || pad.down(PAD.r2);
      crouch ||= pad.down(PAD.circle) || pad.down(PAD.l3);
      if (pad.pressed(PAD.triangle)) {
        interactPressed = true;
        confirm = true;
      }
      if (pad.navY !== 0) navY = pad.navY;
      if (pad.active) this.padRecent = 3;
    }
    this.padRecent = Math.max(0, this.padRecent - dt);
    if (this.anyPressed(c.jump) || this.anyPressed(c.interact)) confirm = true;

    if (this.touch) {
      const t = this.touch.sample();
      if (t.moveX !== 0 || t.moveY !== 0 || t.jumpPressed) this.padRecent = 0;
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
    const frame: InputFrame = { moveX, moveY, jumpPressed, jumpHeld, run, crouch, interactPressed, answer, lookX, lookY, navY, confirm };
    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    return frame;
  }
}
