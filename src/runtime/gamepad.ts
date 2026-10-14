// Reads the first connected gamepad once per frame: which buttons went down this frame, where the sticks are, and
// steps for moving through a menu. Safari on an iPad only lists a controller after a button was pressed on it, so
// nothing here depends on a "connected" event: the list is looked at every frame.

import { NAV_THRESHOLD, PAD, PAD_AXES, Repeater, STICK_DEADZONE, TRIGGER_THRESHOLD } from '../core/gamepad';

export class PadReader {
  private cur: boolean[] = [];
  private prev: boolean[] = [];
  private nav = { x: new Repeater(), y: new Repeater() };
  /** A controller is there (and was looked at the last time). */
  connected = false;
  /** A button was pressed, or a stick pushed, in the last `poll`. */
  active = false;
  /** Menu steps of this frame: -1 / +1 along each axis (D-pad or left stick, repeating while held). */
  navX = 0;
  navY = 0;
  private axes: number[] = [];

  /** The first connected controller, as the browser lists it right now. */
  private find(): Gamepad | undefined {
    const list = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
    return Array.from(list ?? []).find((g): g is Gamepad => !!g && g.connected);
  }

  /** Take over the state of the buttons and sticks of a controller (nothing when there is none). */
  private take(pad: Gamepad | undefined): void {
    this.connected = !!pad;
    this.axes = pad ? Array.from(pad.axes) : [];
    this.cur = pad ? pad.buttons.map((b, i) => (i === PAD.l2 || i === PAD.r2 ? b.value > TRIGGER_THRESHOLD || b.pressed : b.pressed)) : [];
  }

  /** Look at the controller; call once per frame. */
  poll(dt: number): void {
    const pad = this.find();
    this.prev = this.cur;
    this.navX = this.navY = 0;
    this.take(pad);
    if (!pad) {
      this.active = false;
      this.nav.x.reset();
      this.nav.y.reset();
      return;
    }
    const stick = Math.max(Math.hypot(this.axis(PAD_AXES.leftX), this.axis(PAD_AXES.leftY)), Math.hypot(this.axis(PAD_AXES.rightX), this.axis(PAD_AXES.rightY)));
    this.active = this.cur.some((v, i) => v && !this.prev[i]) || stick > 0.5;
    // the D-pad and the left stick step through menus
    const lx = this.axis(PAD_AXES.leftX);
    const ly = this.axis(PAD_AXES.leftY);
    const x = (this.cur[PAD.right] ? 1 : 0) - (this.cur[PAD.left] ? 1 : 0) || (Math.abs(lx) > NAV_THRESHOLD && Math.abs(lx) > Math.abs(ly) ? Math.sign(lx) : 0);
    const y = (this.cur[PAD.down] ? 1 : 0) - (this.cur[PAD.up] ? 1 : 0) || (Math.abs(ly) > NAV_THRESHOLD && Math.abs(ly) >= Math.abs(lx) ? Math.sign(ly) : 0);
    this.navX = this.nav.x.step(x, dt);
    this.navY = this.nav.y.step(y, dt);
  }

  /** Is the button down? */
  down(button: number): boolean {
    return !!this.cur[button];
  }

  /** Did the button go down in this frame? */
  pressed(button: number): boolean {
    return !!this.cur[button] && !this.prev[button];
  }

  /** The value of an axis, 0 when it is not there. */
  axis(index: number): number {
    return this.axes[index] ?? 0;
  }

  /**
   * A stick as a vector with the dead zone taken out: nothing inside the zone, then 0..1 over the rest of the
   * way, in the direction the stick points.
   */
  stick(xAxis: number, yAxis: number): [number, number] {
    const x = this.axis(xAxis);
    const y = this.axis(yAxis);
    const mag = Math.hypot(x, y);
    if (mag <= STICK_DEADZONE) return [0, 0];
    const k = Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / mag;
    return [x * k, y * k];
  }

  /**
   * What is held right now is not a new press: after a pause, a screen that changed or a conversation that began the
   * button that did it may still be down.
   */
  sync(): void {
    this.take(this.find());
    this.prev = [...this.cur];
    this.nav.x.reset();
    this.nav.y.reset();
  }
}
