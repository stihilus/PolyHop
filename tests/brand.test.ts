import { describe, expect, it } from 'vitest';
import logotype from '../assets/brand/polyhop-logotype.svg?raw';
import logo from '../assets/brand/polyhop-logo.svg?raw';
import { brandMarkup } from '../src/editor/ui/brand';

const files: Record<string, string> = { 'polyhop-logo.svg': logo, 'polyhop-logotype.svg': logotype };

describe('the logos', () => {
  it('the files are black, one ink, with a view box', () => {
    for (const [name, svg] of Object.entries(files)) {
      expect(new Set(svg.match(/fill="#[0-9a-f]{6}"/gi)), name).toEqual(new Set(['fill="#030303"']));
      expect(svg, name).toMatch(/viewBox="0 0 \d+ \d+"/);
    }
  });

  it('are drawn in the current color, and scale with their box', () => {
    for (const kind of ['mark', 'logotype'] as const) {
      const svg = brandMarkup(kind, 'x', 'PolyHop');
      expect(svg).not.toContain('#030303');
      expect(svg).toContain('fill="currentColor"');
      expect(svg).toMatch(/^<svg viewBox="0 0 \d+ \d+" role="img" aria-label="PolyHop" class="x"/);
      expect(svg).not.toMatch(/\swidth=/);
      expect(svg.match(/<svg/g)).toHaveLength(1);
    }
    expect(brandMarkup('mark')).toContain('aria-hidden="true"');
  });

  it('the logotype is the mark with the lettering', () => {
    const count = (svg: string) => (svg.match(/<path /g) ?? []).length;
    expect(count(brandMarkup('logotype'))).toBeGreaterThan(count(brandMarkup('mark')));
  });
});
