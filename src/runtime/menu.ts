// The menu screen of a game: a logo (or the title), and under it the buttons Start game and Settings. The exported
// game builds it from the project's menu options; the editor builds the same thing for the preview in Project Settings.

import { type MenuScreen, textOn } from '../core/menu';

export interface MenuHost {
  /** The options of the project, with defaults filled in (`resolveMenu`). */
  menu: MenuScreen;
  title: string;
  /** The game is paused: the first button continues it. */
  paused: boolean;
  onStart(): void;
  onSettings(): void;
  /** When given, a quiet Fullscreen button goes under the others. */
  onFullscreen?(): void;
}

/** The look of the layer the menu sits on: the game dimmed, one color, or a picture. A paused game is always dimmed. */
export function menuBackdrop(menu: MenuScreen, paused: boolean): Partial<CSSStyleDeclaration> {
  if (!paused && menu.background === 'color') return { background: menu.backgroundColor };
  if (!paused && menu.background === 'picture' && menu.backgroundImage) {
    // the picture is a validated data URL (letters, digits and + / = only), so it cannot break out of the quotes
    return { background: `${menu.backgroundColor} url("${menu.backgroundImage}") center / cover no-repeat` };
  }
  return { background: 'rgba(20, 22, 27, 0.86)' };
}

function box(style: Partial<CSSStyleDeclaration>, ...children: (Node | string)[]): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, style);
  d.append(...children);
  return d;
}

function menuButton(text: string, kind: 'primary' | 'secondary' | 'quiet', accent: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  const quiet = kind === 'quiet';
  Object.assign(b.style, {
    font: 'inherit',
    fontSize: quiet ? '15px' : '20px',
    fontWeight: quiet ? '400' : '600',
    width: quiet ? 'auto' : 'min(260px, 80%)',
    padding: quiet ? '6px 14px' : '12px 20px',
    margin: quiet ? '10px 0 0' : '6px 0',
    border: quiet ? '0' : `2px solid ${accent}`,
    borderRadius: '10px',
    background: kind === 'primary' ? accent : quiet ? 'transparent' : 'rgba(0, 0, 0, 0.28)',
    color: kind === 'primary' ? textOn(accent) : accent,
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  b.addEventListener('mouseenter', () => (b.style.filter = 'brightness(1.15)'));
  b.addEventListener('mouseleave', () => (b.style.filter = ''));
  b.addEventListener('click', onClick);
  return b;
}

/** The logo (or the title of the game) with the buttons under it. */
export function menuContent(host: MenuHost): HTMLElement {
  const { menu } = host;
  const root = box({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    boxSizing: 'border-box',
    padding: '0 24px',
  });
  if (menu.logo) {
    const img = document.createElement('img');
    img.src = menu.logo;
    img.alt = host.title;
    img.draggable = false;
    Object.assign(img.style, {
      width: `${menu.logoSize}%`,
      height: 'auto',
      maxHeight: '44vh',
      objectFit: 'contain',
      margin: '0 0 30px',
      imageRendering: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);
    // a small picture is made bigger: keep its pixels hard
    img.addEventListener('load', () => {
      if (img.naturalWidth <= 400) img.style.imageRendering = 'pixelated';
    });
    root.append(img);
  } else {
    root.append(box({ fontSize: '44px', fontWeight: '700', margin: '0 0 28px', textShadow: '0 2px 8px rgba(0, 0, 0, 0.5)' }, host.title));
  }
  if (host.paused) root.append(box({ fontSize: '16px', color: '#9aa3b2', margin: '-14px 0 16px' }, 'Paused'));
  const start = menuButton(host.paused ? 'Continue' : menu.startLabel, 'primary', menu.accent, host.onStart);
  root.append(start, menuButton(menu.settingsLabel, 'secondary', menu.accent, host.onSettings));
  if (host.onFullscreen) root.append(menuButton('Fullscreen', 'quiet', menu.accent, host.onFullscreen));
  return root;
}
