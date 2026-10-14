// The settings screen of the exported game: volume, mouse, resolution and the keys.
// It only edits through the `SettingsHost` it is given; the game and the saving are the host's business.

import { GAMEPAD_HELP, GAMEPAD_NAMES_NOTE } from '../core/gamepad';
import { ACTION_LABELS, keyLabel } from '../core/keys';
import { ACTIONS, type Action, RENDER_SCALES } from '../core/types';
import { RESERVED_KEYS, SENSITIVITY_MAX, SENSITIVITY_MIN } from '../runtime/prefs';
import { button, div, getAccent } from './dom';

export interface SettingsValues {
  volume: number;
  muted: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  renderScale: number;
  controls: Record<Action, string[]>;
}

export interface SettingsHost {
  /** Phone controls are in use: no keys to pick, and the "mouse" is a finger. */
  touch(): boolean;
  /** The game listens to a gamepad (the project allows it): its buttons are listed. */
  gamepad(): boolean;
  values(): SettingsValues;
  /** The player changed something. The host applies and saves it. */
  change(patch: Partial<Omit<SettingsValues, 'controls'>>): void;
  /** The player picked a key for an action. */
  rebind(action: Action, code: string): void;
  reset(): void;
  back(): void;
}

const SCALE_LABELS: Record<number, string> = { 1: 'Full', 0.5: 'Half', 0.34: 'Third', 0.25: 'Quarter' };

const ROW: Partial<CSSStyleDeclaration> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '5px 0',
  fontSize: '15px',
};

function row(label: string, control: HTMLElement): HTMLDivElement {
  return div(ROW, div({ color: '#cfd5e0' }, label), control);
}

function slider(min: number, max: number, value: number, onInput: (v: number) => void): HTMLElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(Math.round(value));
  input.style.width = '150px';
  input.style.accentColor = getAccent();
  const out = document.createElement('span');
  out.style.cssText = 'min-width:44px;text-align:right;color:#9aa3b2;font-size:14px';
  out.textContent = `${input.value}%`;
  input.addEventListener('input', () => {
    out.textContent = `${input.value}%`;
    onInput(Number(input.value));
  });
  return div({ display: 'flex', alignItems: 'center', gap: '8px' }, input, out);
}

function checkbox(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.accentColor = getAccent();
  input.style.width = '18px';
  input.style.height = '18px';
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

export interface SettingsMenu {
  element: HTMLElement;
  /** A key is being picked: the arrow keys and the buttons of a pad must leave it alone. */
  readonly listening: boolean;
  /** Draw the screen again (after the host changed the values on its own). */
  refresh(): void;
}

/** Build the screen. It rebuilds itself after a key was picked. */
export function createSettingsMenu(host: SettingsHost, title = 'Settings'): SettingsMenu {
  const panel = div({
    width: 'min(440px, 92vw)',
    maxHeight: '86vh',
    overflowY: 'auto',
    padding: '18px 22px',
    background: 'rgba(30, 34, 43, 0.96)',
    border: '1px solid #3b4252',
    borderRadius: '12px',
    textAlign: 'left',
    color: '#fff',
  });
  let listening: { action: Action; stop: () => void } | null = null;
  let note = '';

  const render = () => {
    listening?.stop();
    listening = null;
    const v = host.values();
    const touch = host.touch();
    panel.replaceChildren();
    panel.append(div({ fontSize: '24px', margin: '0 0 8px', textAlign: 'center' }, title));

    panel.append(
      row('Volume', slider(0, 100, v.volume * 100, (n) => host.change({ volume: n / 100 }))),
      row('Mute (M)', checkbox(v.muted, (m) => host.change({ muted: m }))),
      row(
        touch ? 'Look speed' : 'Mouse speed',
        slider(SENSITIVITY_MIN * 100, SENSITIVITY_MAX * 100, v.mouseSensitivity * 100, (n) => host.change({ mouseSensitivity: n / 100 })),
      ),
      row('Invert look up / down', checkbox(v.invertY, (c) => host.change({ invertY: c }))),
    );

    const select = document.createElement('select');
    select.style.cssText = 'font:inherit;font-size:15px;padding:4px 8px;border-radius:6px;background:#2a2f3a;color:#fff;border:1px solid #3b4252';
    for (const s of RENDER_SCALES) {
      const option = document.createElement('option');
      option.value = String(s);
      option.textContent = SCALE_LABELS[s] ?? `${Math.round(s * 100)}%`;
      option.selected = s === v.renderScale;
      select.append(option);
    }
    select.addEventListener('change', () => host.change({ renderScale: Number(select.value) }));
    panel.append(row('Resolution', select));

    if (!touch) {
      panel.append(div({ margin: '14px 0 4px', color: '#9aa3b2', fontSize: '13px', letterSpacing: '0.08em' }, 'KEYS (click one, then press the new key)'));
      for (const action of ACTIONS) {
        const keys = v.controls[action].map(keyLabel).join(' / ');
        const b = button(keys || '—', () => listen(action, b), true);
        b.style.minWidth = '130px';
        b.style.margin = '0';
        panel.append(row(ACTION_LABELS[action], b));
      }
    }
    // the buttons of a gamepad: what each does (a list to read, there is nothing to pick)
    if (host.gamepad()) {
      panel.append(div({ margin: '14px 0 4px', color: '#9aa3b2', fontSize: '13px', letterSpacing: '0.08em' }, 'GAMEPAD'));
      for (const h of GAMEPAD_HELP) {
        panel.append(
          div(
            { display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '3px 0', fontSize: '14px' },
            div({ color: '#cfd5e0' }, h.action),
            div({ color: '#9aa3b2', textAlign: 'right' }, h.buttons),
          ),
        );
      }
      panel.append(div({ color: '#6f7889', fontSize: '12px', margin: '6px 0 0' }, GAMEPAD_NAMES_NOTE));
    }
    panel.append(div({ minHeight: '20px', margin: '6px 0 0', color: getAccent(), fontSize: '13px', textAlign: 'center' }, note));
    note = '';

    const back = button('Back', host.back);
    back.setAttribute('data-nav-back', '');
    panel.append(div({ display: 'flex', justifyContent: 'center', marginTop: '6px' }, back, button('Defaults', host.reset, true)));
  };

  function listen(action: Action, label: HTMLButtonElement): void {
    listening?.stop();
    label.textContent = 'Press a key…';
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        stop();
        render();
        return;
      }
      if (RESERVED_KEYS.includes(e.code)) {
        note = `${keyLabel(e.code)} is used by the game itself`;
        stop();
        render();
        return;
      }
      stop();
      host.rebind(action, e.code);
      render();
    };
    const stop = () => {
      window.removeEventListener('keydown', onKey, true);
      if (listening?.action === action) listening = null;
    };
    window.addEventListener('keydown', onKey, true);
    listening = { action, stop };
  }

  render();
  return {
    element: panel,
    get listening() {
      return listening !== null;
    },
    refresh: render,
  };
}
