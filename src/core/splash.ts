// A picture shown full screen when an exported game starts (a logo, a title card). It is kept inside the
// project as a data URL, so the exported game stays one folder with no extra files.

export interface SplashScreen {
  /** A `data:image/...;base64,...` URL. */
  image: string;
  /** Seconds it stays (a click or a key skips it). */
  seconds: number;
  /** Color around the picture (a picture that does not fill the screen sits on it). */
  background: string;
}

export const DEFAULT_SPLASH_SECONDS = 2.5;
export const MIN_SPLASH_SECONDS = 0.5;
export const MAX_SPLASH_SECONDS = 10;
/** The longest picture (as a data URL, in characters) a project keeps: about 3 MB of picture. */
export const MAX_SPLASH_CHARS = 4_000_000;
/** Pictures are brought down to this size when they are picked. */
export const SPLASH_MAX_WIDTH = 1280;
export const SPLASH_MAX_HEIGHT = 720;

export function isImageDataUrl(value: unknown, maxChars = MAX_SPLASH_CHARS): value is string {
  return typeof value === 'string' && value.length <= maxChars && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

/** A splash screen of unknown origin made valid, or undefined when there is no usable picture. */
export function normalizeSplash(raw: unknown): SplashScreen | undefined {
  const r = raw as Partial<SplashScreen> | null | undefined;
  if (!r || typeof r !== 'object' || !isImageDataUrl(r.image)) return undefined;
  const seconds = typeof r.seconds === 'number' && Number.isFinite(r.seconds) ? r.seconds : DEFAULT_SPLASH_SECONDS;
  return {
    image: r.image,
    seconds: Math.min(MAX_SPLASH_SECONDS, Math.max(MIN_SPLASH_SECONDS, seconds)),
    background: typeof r.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.background) ? r.background : '#000000',
  };
}

/** The size a picture is brought down to when it has to fit inside a box (never made bigger than it is). */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 };
  const k = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** The size a splash picture is shown at when it has to fit inside the limits. */
export function fitSplash(width: number, height: number): { width: number; height: number } {
  return fitWithin(width, height, SPLASH_MAX_WIDTH, SPLASH_MAX_HEIGHT);
}
