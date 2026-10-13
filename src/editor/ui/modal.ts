import { el } from './dom';

export interface ModalAction {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open (e.g. validation failed). */
  onClick?: () => boolean | void;
}

/** Small modal dialog. Returns a function that closes it. */
export function openModal(title: string, content: HTMLElement, actions: ModalAction[]): () => void {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const dialog = el('div', { class: 'modal modal-small' });
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
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  const footer = el('div', { class: 'modal-footer end' });
  for (const a of actions) {
    footer.append(
      el('button', {
        class: `btn${a.primary ? ' primary' : ''}`,
        text: a.label,
        onclick: () => {
          if (a.onClick?.() === false) return;
          close();
        },
      }),
    );
  }
  dialog.append(
    el('div', { class: 'modal-title' }, el('span', { text: title }), el('button', { class: 'icon-btn', text: '✕', onclick: close })),
    content,
    footer,
  );
  document.body.append(backdrop);
  const first = content.querySelector('input, select') as HTMLElement | null;
  first?.focus();
  return close;
}
