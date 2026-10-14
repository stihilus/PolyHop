// The menu screen of an exported game: a logo, and under it the buttons "Start game" and "Settings". The author
// picks the logo, a background and the colors; the picture is kept inside the project as a data URL (like the
// splash screen), so the exported game stays one folder with no extra files.

import { MAX_SPLASH_CHARS, isImageDataUrl } from './splash';

export type MenuBackground = 'dim' | 'color' | 'picture';

export interface MenuScreen {
  /** The logo: a `data:image/...;base64,...` URL. Without one the title of the game is written out. */
  logo?: string;
  /** How much of the width of the screen the logo may take, in percent. */
  logoSize: number;
  /**
   * What is behind the menu: the game itself, dimmed (`dim`), one color or a picture. (While the game is paused
   * the menu is always over the dimmed game.)
   */
  background: MenuBackground;
  backgroundColor: string;
  backgroundImage?: string;
  /** The color of the buttons. */
  accent: string;
  startLabel: string;
  settingsLabel: string;
}

export const DEFAULT_MENU: MenuScreen = {
  logoSize: 50,
  background: 'dim',
  backgroundColor: '#14161b',
  accent: '#ffb23e',
  startLabel: 'Start game',
  settingsLabel: 'Settings',
};

export const MIN_LOGO_SIZE = 10;
export const MAX_LOGO_SIZE = 100;
export const MAX_LABEL_CHARS = 24;
/** A logo (as a data URL, in characters) is kept up to about 1.5 MB of picture. */
export const MAX_LOGO_CHARS = 2_000_000;
/** Logos are brought down to this size when they are picked. */
export const LOGO_MAX_WIDTH = 1024;
export const LOGO_MAX_HEIGHT = 512;

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function label(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS) : '';
  return t || fallback;
}

/**
 * A menu screen of unknown origin made valid. Undefined when it says nothing that the defaults do not
 * (so a project that never touched the menu stays as it was).
 */
export function normalizeMenu(raw: unknown): MenuScreen | undefined {
  const r = raw as Partial<Record<keyof MenuScreen, unknown>> | null | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const logo = isImageDataUrl(r.logo, MAX_LOGO_CHARS) ? r.logo : undefined;
  const backgroundImage = isImageDataUrl(r.backgroundImage, MAX_SPLASH_CHARS) ? r.backgroundImage : undefined;
  const size = typeof r.logoSize === 'number' && Number.isFinite(r.logoSize) ? r.logoSize : DEFAULT_MENU.logoSize;
  const wanted = r.background === 'color' || r.background === 'picture' ? r.background : 'dim';
  const menu: MenuScreen = {
    ...(logo ? { logo } : {}),
    logoSize: Math.round(Math.min(MAX_LOGO_SIZE, Math.max(MIN_LOGO_SIZE, size))),
    // a picture background needs its picture
    background: wanted === 'picture' && !backgroundImage ? 'dim' : wanted,
    backgroundColor: isColor(r.backgroundColor) ? r.backgroundColor.toLowerCase() : DEFAULT_MENU.backgroundColor,
    ...(backgroundImage ? { backgroundImage } : {}),
    accent: isColor(r.accent) ? r.accent.toLowerCase() : DEFAULT_MENU.accent,
    startLabel: label(r.startLabel, DEFAULT_MENU.startLabel),
    settingsLabel: label(r.settingsLabel, DEFAULT_MENU.settingsLabel),
  };
  const same =
    !menu.logo &&
    !menu.backgroundImage &&
    menu.logoSize === DEFAULT_MENU.logoSize &&
    menu.background === DEFAULT_MENU.background &&
    menu.backgroundColor === DEFAULT_MENU.backgroundColor &&
    menu.accent === DEFAULT_MENU.accent &&
    menu.startLabel === DEFAULT_MENU.startLabel &&
    menu.settingsLabel === DEFAULT_MENU.settingsLabel;
  return same ? undefined : menu;
}

/** The menu to show: what the project says, with the defaults where it says nothing. */
export function resolveMenu(raw: unknown): MenuScreen {
  return normalizeMenu(raw) ?? { ...DEFAULT_MENU };
}

/** Text that reads well on a button of this color: dark on light colors, white on dark ones. */
export function textOn(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#1b1e25';
  const n = parseInt(m[1]!, 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? '#1b1e25' : '#ffffff';
}
