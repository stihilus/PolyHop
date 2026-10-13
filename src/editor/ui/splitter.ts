// A draggable divider between the view and the right-hand panel. The width is a CSS variable of the workspace
// (so its grid follows) and is remembered in the browser. Double-click puts it back.

import { el } from './dom';

export interface SplitterOptions {
  /** Where the width is remembered (localStorage). */
  key: string;
  min?: number;
  /** Largest share of the workspace the panel may take. */
  maxShare?: number;
}

/** Makes the divider element and wires it to the workspace. Put the element between the view and the right panel. */
export function makeSplitter(workspace: HTMLElement, options: SplitterOptions): HTMLElement {
  const min = options.min ?? 280;
  const maxShare = options.maxShare ?? 0.6;
  const splitter = el('div', { class: 'splitter', title: 'Drag to resize (double-click to reset)' });
  const set = (w: number | null) => {
    if (w === null) workspace.style.removeProperty('--right-w');
    else workspace.style.setProperty('--right-w', `${Math.round(w)}px`);
  };
  const remember = () => {
    try {
      const w = parseInt(workspace.style.getPropertyValue('--right-w'), 10);
      if (Number.isFinite(w)) localStorage.setItem(options.key, String(w));
      else localStorage.removeItem(options.key);
    } catch {
      // storage can be unavailable (private window); the width just is not kept
    }
  };
  try {
    const saved = parseInt(localStorage.getItem(options.key) ?? '', 10);
    if (Number.isFinite(saved) && saved >= min) set(saved);
  } catch {
    // the default width is fine
  }
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('dragging');
    const rect = workspace.getBoundingClientRect();
    const move = (ev: PointerEvent) => set(Math.min(rect.width * maxShare, Math.max(min, rect.right - ev.clientX - 3)));
    const up = () => {
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      remember();
    };
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });
  splitter.addEventListener('dblclick', () => {
    set(null);
    remember();
  });
  return splitter;
}
