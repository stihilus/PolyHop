// Shows the splash screen of a game: the picture fades in, stays, fades out. A click, a touch or a key skips it.

import type { SplashScreen } from '../core/splash';

const FADE = 0.45;

/**
 * Show `splash` over `parent` and call `done` when it is over (or skipped). Returns a function that ends it at
 * once. The picture is made as big as the screen allows, with hard pixels when it is small, so a pixel logo stays sharp.
 */
export function showSplash(parent: HTMLElement, splash: SplashScreen, done: () => void): () => void {
  const layer = document.createElement('div');
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '60',
    background: splash.background,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    transition: `opacity ${FADE}s ease`,
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = splash.image;
  img.alt = '';
  img.draggable = false;
  // the picture fills the screen as far as its shape allows (a small pixel picture is made bigger, with hard pixels)
  Object.assign(img.style, {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'auto',
  } satisfies Partial<CSSStyleDeclaration>);
  img.addEventListener('load', () => {
    if (img.naturalWidth <= 800) img.style.imageRendering = 'pixelated';
  });
  layer.append(img);
  parent.append(layer);

  let finished = false;
  const timers: number[] = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener('keydown', finish, true);
    layer.style.opacity = '0';
    window.setTimeout(() => {
      layer.remove();
      done();
    }, FADE * 1000);
  };
  layer.addEventListener('pointerdown', finish);
  window.addEventListener('keydown', finish, true);
  // fade in on the next frame, then stay
  window.requestAnimationFrame(() => {
    layer.style.opacity = '1';
  });
  timers.push(window.setTimeout(finish, (splash.seconds + FADE) * 1000));
  return finish;
}
