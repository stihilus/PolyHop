// The PolyHop logos (assets/brand): the mascot alone (the mark) and the mascot with the lettering (the logotype).
// The files are black on a transparent background; here they are drawn in the current text color, so CSS decides
// the color (the accent in the editor).

import logotypeSource from '../../../assets/brand/polyhop-logotype.svg?raw';
import markSource from '../../../assets/brand/polyhop-logo.svg?raw';

export type BrandKind = 'mark' | 'logotype';

const SOURCES: Record<BrandKind, string> = { mark: markSource, logotype: logotypeSource };

/** The ink of the original files. */
const INK = /fill="#030303"/gi;

/**
 * The SVG markup of a logo: drawn in `currentColor`, scaling to the size of the element it is in (the width and
 * height attributes are dropped, the viewBox stays), hidden from screen readers when `label` is empty.
 */
export function brandMarkup(kind: BrandKind, className = '', label = ''): string {
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"';
  return SOURCES[kind]
    .replace(INK, 'fill="currentColor"')
    .replace(/<svg\b[^>]*>/i, (open) => {
      const viewBox = /viewBox="[^"]*"/i.exec(open)?.[0] ?? '';
      return `<svg ${viewBox} ${aria} class="${className}" xmlns="http://www.w3.org/2000/svg" fill="none">`;
    })
    .trim();
}

/** A logo as an element (a wrapper span, so the page can size and color it). */
export function brandElement(kind: BrandKind, className = '', label = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = `brand-art brand-${kind} ${className}`.trim();
  span.innerHTML = brandMarkup(kind, '', label);
  return span;
}
