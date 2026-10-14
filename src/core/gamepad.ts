// What the buttons of a gamepad do in a PolyHop game. The layout is the "standard" one every browser gives a
// controller (a Sony DualShock 4 or DualSense, an Xbox pad, a Switch pad ...), named like a PlayStation pad.
// This file has no browser code: the game, the menus and the editor all read the table below, so what they
// show is what happens.

/** Indices of the buttons of a controller with the standard layout. */
export const PAD = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** Axes of the sticks. */
export const PAD_AXES = { leftX: 0, leftY: 1, rightX: 2, rightY: 3 } as const;

/** A stick closer to the middle than this is not touched. */
export const STICK_DEADZONE = 0.2;
/** How far a stick has to be pushed to move a menu one step (and a trigger to count as pressed). */
export const NAV_THRESHOLD = 0.55;
/** A trigger (L2, R2) counts as held from this far. */
export const TRIGGER_THRESHOLD = 0.35;

/** What each action of the game is, on the pad: the rows of every list of controls that is shown. */
export const GAMEPAD_HELP: { action: string; buttons: string }[] = [
  { action: 'Move', buttons: 'Left stick or D-pad' },
  { action: 'Look / turn', buttons: 'Right stick' },
  { action: 'Jump', buttons: 'Cross (✕)' },
  { action: 'Run (hold)', buttons: 'Square (□) or R2' },
  { action: 'Crouch (hold)', buttons: 'Circle (○) or L3' },
  { action: 'Interact / talk', buttons: 'Triangle (△)' },
  { action: 'Pause / continue', buttons: 'Options' },
  { action: 'In menus and questions', buttons: 'D-pad up / down, Cross to pick, Circle to go back' },
];

/** The same names for other pads. */
export const GAMEPAD_NAMES_NOTE = 'On an Xbox pad: Cross = A, Circle = B, Square = X, Triangle = Y, Options = Menu.';

/**
 * Turns "the stick (or the D-pad) is held that way" into steps: one at once, then, when it is held on, one more
 * every so often, like the keys of a keyboard repeat. Used for moving through a menu.
 */
export class Repeater {
  private held = 0;
  private time = 0;

  constructor(
    private delay = 0.38,
    private every = 0.13,
  ) {}

  /** `direction` is -1, 0 or +1 for this frame; returns the step to take (-1, 0 or +1). */
  step(direction: number, dt: number): number {
    if (direction === 0) {
      this.held = 0;
      this.time = 0;
      return 0;
    }
    if (direction !== this.held) {
      this.held = direction;
      this.time = 0;
      return direction;
    }
    this.time += dt;
    if (this.time >= this.delay) {
      this.time -= this.every;
      return direction;
    }
    return 0;
  }

  reset(): void {
    this.held = 0;
    this.time = 0;
  }
}
