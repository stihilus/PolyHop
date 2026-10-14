// The editor's own versions of alert, confirm and prompt, so no browser system dialog ever interrupts the work:
// they look like the other dialogs of the editor, take the keyboard (Enter goes on, Esc cancels) and return
// promises. A destructive question puts the focus on Cancel.

import { el } from './dom';

export interface DialogOptions {
  /** The heading of the dialog. */
  title?: string;
  /** The label of the button that goes on (OK, Delete, Continue ...). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** The action destroys something: the button is drawn in the danger color and Cancel has the focus. */
  danger?: boolean;
}

let openCount = 0;

/** Is one of these dialogs open? The editor behind it does not take keys while it is. */
export function dialogOpen(): boolean {
  return openCount > 0;
}

interface Button<T> {
  label: string;
  value: () => T;
  primary?: boolean;
  danger?: boolean;
}

function present<T>(config: {
  title: string;
  message: string;
  field?: HTMLInputElement;
  buttons: Button<T>[];
  /** What closing with Esc answers. */
  cancel: T;
  /** The button that has the focus when the dialog opens (an index of `buttons`), unless there is a field. */
  focus: number;
}): Promise<T> {
  return new Promise<T>((resolve) => {
    const backdrop = el('div', { class: 'modal-backdrop app-dialog-backdrop' });
    const titleId = `app-dialog-title-${openCount}-${Math.random().toString(36).slice(2, 7)}`;
    const dialog = el('div', {
      class: 'modal modal-small app-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    });
    backdrop.append(dialog);
    const previousFocus = document.activeElement as HTMLElement | null;

    let done = false;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      openCount--;
      previousFocus?.focus?.();
      resolve(value);
    };

    const buttonEls = config.buttons.map((b) =>
      el('button', {
        class: `btn${b.primary ? ' primary' : ''}${b.danger ? ' danger' : ''}`,
        type: 'button',
        text: b.label,
        onclick: () => finish(b.value()),
      }),
    );
    const primaryIndex = Math.max(0, config.buttons.findIndex((b) => b.primary));

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(config.cancel);
        return;
      }
      if (e.code === 'Enter' && config.field && e.target === config.field) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(config.buttons[primaryIndex]!.value());
        return;
      }
      if (e.code === 'Tab') {
        // the focus stays in the dialog
        const stops: HTMLElement[] = [...(config.field ? [config.field] : []), ...buttonEls];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
        e.preventDefault();
        e.stopImmediatePropagation();
        stops[next]?.focus();
        return;
      }
      // anything else typed outside the dialog's own controls does not reach the editor behind it
      if (!dialog.contains(e.target as Node | null)) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);

    dialog.append(
      el('div', { class: 'modal-title' }, el('span', { id: titleId, text: config.title })),
      el('div', { class: 'app-dialog-message', text: config.message }),
      ...(config.field ? [config.field] : []),
      el('div', { class: 'modal-footer end app-dialog-footer' }, ...buttonEls),
    );
    document.body.append(backdrop);
    openCount++;
    (config.field ?? buttonEls[config.focus] ?? buttonEls[primaryIndex])?.focus();
    config.field?.select();
  });
}

/** A message with an OK button. Resolves when it is dismissed. */
export function appAlert(message: string, options: DialogOptions = {}): Promise<void> {
  return present<void>({
    title: options.title ?? 'PolyHop',
    message,
    buttons: [{ label: options.confirmLabel ?? 'OK', value: () => undefined, primary: true }],
    cancel: undefined,
    focus: 0,
  });
}

/** A yes / no question. Resolves with true when the user goes on. */
export function appConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  const danger = options.danger === true;
  return present<boolean>({
    title: options.title ?? 'Are you sure?',
    message,
    buttons: [
      { label: options.cancelLabel ?? 'Cancel', value: () => false },
      { label: options.confirmLabel ?? 'OK', value: () => true, primary: true, danger },
    ],
    cancel: false,
    // a question about destroying something is answered "no" by an Enter that comes too quickly
    focus: danger ? 0 : 1,
  });
}

/** A question with a text field. Resolves with the text, or null when cancelled. */
export function appPrompt(message: string, value = '', options: DialogOptions = {}): Promise<string | null> {
  const field = el('input', { type: 'text', value, class: 'app-dialog-field' });
  return present<string | null>({
    title: options.title ?? 'PolyHop',
    message,
    field,
    buttons: [
      { label: options.cancelLabel ?? 'Cancel', value: () => null },
      { label: options.confirmLabel ?? 'OK', value: () => field.value, primary: true },
    ],
    cancel: null,
    focus: 1,
  });
}
