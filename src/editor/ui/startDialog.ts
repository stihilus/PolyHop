// The first thing a new user sees: start from nothing, or from the example game.

import { DEMO_SPLASH_IMAGE } from '../../core/demoAssets';
import { el } from './dom';

export type StartChoice = 'blank' | 'example';

/**
 * Ask what to start with. `onChoose` runs with the choice; closing the dialog without choosing keeps what is open.
 * Returns a function that closes it.
 */
export function openStartDialog(onChoose: (choice: StartChoice) => void, firstTime: boolean): () => void {
  const backdrop = el('div', { class: 'modal-backdrop start-backdrop' });
  const dialog = el('div', { class: 'modal start-dialog' });
  backdrop.append(dialog);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const choose = (choice: StartChoice) => {
    close();
    onChoose(choice);
  };

  const card = (title: string, text: string, preview: HTMLElement, choice: StartChoice, primary = false) => {
    const c = el(
      'button',
      { class: `start-card${primary ? ' primary' : ''}`, title },
      preview,
      el('span', { class: 'start-card-title', text: title }),
      el('span', { class: 'start-card-text muted', text }),
    );
    c.addEventListener('click', () => choose(choice));
    return c;
  };

  const blankPreview = el('div', { class: 'start-preview start-preview-blank' }, el('span', { text: '+' }));
  const examplePreview = el('div', { class: 'start-preview' });
  const img = el('img', { src: DEMO_SPLASH_IMAGE, alt: 'Mossy Hills' });
  examplePreview.append(img);

  dialog.append(
    el(
      'div',
      { class: 'modal-title' },
      el('span', { text: firstTime ? 'Welcome to PolyHop' : 'New project' }),
      el('button', { class: 'icon-btn', text: '✕', onclick: close }),
    ),
    el('div', {
      class: 'muted start-intro',
      text: firstTime
        ? 'Make a 3D platformer in your browser with no code, and export it for itch.io. How do you want to start?'
        : 'Start from an empty level, or from the example game.',
    }),
    el(
      'div',
      { class: 'start-cards' },
      card('Blank project', 'An empty level with a floor to build on. Start from nothing.', blankPreview, 'blank'),
      card(
        'Example: Mossy Hills',
        'A small game with two levels that shows what the editor can do: terrain, enemies, a talking villager, moving platforms, a key and a door. Play it, then open it up and change it.',
        examplePreview,
        'example',
        true,
      ),
    ),
    el('div', { class: 'muted start-foot', text: 'You can open your own project at any time with File > Open.' }),
  );
  document.body.append(backdrop);
  (dialog.querySelector('.start-card.primary') as HTMLElement | null)?.focus();
  return close;
}
