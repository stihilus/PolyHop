// Tiny DOM helpers for the screens of the exported game (no framework, inline styles: one script, no CSS file).

export function div(style: Partial<CSSStyleDeclaration>, ...children: (Node | string)[]): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, style);
  d.append(...children);
  return d;
}

export function button(label: string, onClick: () => void, quiet = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    font: 'inherit',
    fontSize: quiet ? '15px' : '18px',
    padding: quiet ? '6px 14px' : '10px 22px',
    margin: '6px',
    border: '2px solid #ffb23e',
    borderRadius: '8px',
    background: quiet ? 'transparent' : '#ffb23e',
    color: quiet ? '#ffb23e' : '#1b1e25',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  b.addEventListener('click', onClick);
  return b;
}
