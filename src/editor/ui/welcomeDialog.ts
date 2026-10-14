// The welcome screen, the first thing the editor shows (like the splash of Blender): the logo and a few ways to
// start. Esc or a click outside keeps what is open.

import { brandElement } from './brand';
import { el } from './dom';

export interface WelcomeOptions {
  /** The project of the last session, when the editor restored one (shown as "Continue"); null for a fresh start. */
  continueName: string | null;
  /** A line about that project (levels, objects), shown under its name. */
  continueInfo?: string;
  /** Show this screen when the editor starts. */
  showAtStartup: boolean;
  onNew(): void;
  onOpen(): void;
  onShowAtStartupChange(value: boolean): void;
  /** The dialog closed, whichever way. */
  onClose?(): void;
}

/** Open the welcome screen. Returns a function that closes it. */
export function openWelcomeDialog(options: WelcomeOptions): () => void {
  const backdrop = el('div', { class: 'modal-backdrop welcome-backdrop' });
  const dialog = el('div', { class: 'modal welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to PolyHop' });
  backdrop.append(dialog);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    options.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  const choice = (title: string, text: string, onChoose: () => void, primary = false) => {
    const b = el(
      'button',
      { class: `welcome-choice${primary ? ' primary' : ''}`, type: 'button' },
      el('span', { class: 'welcome-choice-title', text: title }),
      el('span', { class: 'welcome-choice-text', text }),
    );
    b.addEventListener('click', () => {
      close();
      onChoose();
    });
    return b;
  };

  const choices = el('div', { class: 'welcome-choices' });
  const fresh = choice('New empty project', 'A flat ground, the characters and the game objects. Start from nothing.', options.onNew, true);
  choices.append(fresh, choice('Open project…', 'Load a .polyhop.json file from your computer.', options.onOpen));
  if (options.continueName !== null) {
    choices.append(
      choice(
        `Continue: ${options.continueName}`,
        options.continueInfo ?? 'The project of your last session, as you left it.',
        () => {},
      ),
    );
  }

  const startup = el('input', { type: 'checkbox', checked: options.showAtStartup });
  startup.addEventListener('change', () => options.onShowAtStartupChange(startup.checked));

  dialog.append(
    el('button', { class: 'icon-btn welcome-close', text: '✕', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }),
    el('div', { class: 'welcome-art' }, brandElement('logotype', 'welcome-logotype', 'PolyHop')),
    el(
      'div',
      { class: 'welcome-body' },
      el('div', { class: 'welcome-heading', text: 'Start' }),
      el('p', {
        class: 'muted welcome-tagline',
        text: 'Make a low-poly 3D platformer in your browser, with no code, and export it for itch.io.',
      }),
      choices,
      el(
        'div',
        { class: 'welcome-foot' },
        el('label', { class: 'welcome-startup' }, startup, el('span', { text: 'Show this screen when PolyHop starts' })),
        el(
          'a',
          { class: 'welcome-link muted', href: 'https://github.com/stihilus/PolyHop', target: '_blank', rel: 'noopener', text: 'MIT licensed · source on GitHub' },
        ),
      ),
    ),
  );
  document.body.append(backdrop);
  fresh.focus();
  return close;
}
