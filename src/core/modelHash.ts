// A short fingerprint of what a model is made of (its cubes: names, places, points, faces), not of how it is
// painted. A project keeps its own copy of every built-in model; when the built-in one is redrawn, a saved copy
// whose fingerprint is the one the old built-in model had is known to be untouched and can be replaced.

import type { Model } from './types';

const r = (n: number): string => String(Math.round(n * 1000) / 1000 + 0);

/** FNV-1a over the geometry, as 8 hex digits. */
export function geometryHash(model: Pick<Model, 'cubes'>): string {
  let text = '';
  for (const c of model.cubes) {
    text += `${c.name}|${c.position.map(r).join(',')}|${c.rotation.map(r).join(',')}|`;
    text += c.mesh.verts.map((v) => v.map(r).join(',')).join(';');
    text += `|${c.mesh.faces.map((f) => f.v.join('.')).join(';')}#`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
