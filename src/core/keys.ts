// Names of keys and of the actions they trigger, for the controls screen of the editor and the player.

import type { Action } from './types';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  run: 'Run (hold)',
  crouch: 'Crouch (hold)',
  interact: 'Interact',
};

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  ShiftLeft: 'Shift (L)',
  ShiftRight: 'Shift (R)',
  ControlLeft: 'Ctrl (L)',
  ControlRight: 'Ctrl (R)',
  AltLeft: 'Alt (L)',
  AltRight: 'Alt (R)',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
};

/** A KeyboardEvent.code as a short label: `KeyW` -> `W`, `ArrowUp` -> `↑`. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
