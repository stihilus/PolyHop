import { textOn } from '../core/menu';

// Tiny DOM helpers for the screens of the exported game (no framework, inline styles: one script, no CSS file).

export function div(style: Partial<CSSStyleDeclaration>, ...children: (Node | string)[]): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, style);
  d.append(...children);
  return d;
}

/** The color of the buttons of the game's screens: the author's choice for the menu (see `core/menu.ts`). */
let accent = '#ffb23e';

export function setAccent(color: string): void {
  accent = color;
}

export function getAccent(): string {
  return accent;
}

export function button(label: string, onClick: () => void, quiet = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    font: 'inherit',
    fontSize: quiet ? '15px' : '18px',
    padding: quiet ? '6px 14px' : '10px 22px',
    margin: '6px',
    border: `2px solid ${accent}`,
    borderRadius: '8px',
    background: quiet ? 'transparent' : accent,
    color: quiet ? accent : textOn(accent),
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  b.addEventListener('click', onClick);
  return b;
}
