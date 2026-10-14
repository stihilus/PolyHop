// Box (marquee) selection of the points and faces of a shape: drag a rectangle over the view and everything of the
// shape that lies inside it is selected. Points are taken as drawn, also the ones behind the shape (the handles
// of Vertex mode are drawn through it).

import * as THREE from 'three';
import { type Shape, worldPoints } from '../core/shape';
import type { Vec3 } from '../core/types';

/** The canvas rectangle on the page (a DOMRect has these). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A rectangle in client pixels with x0 <= x1 and y0 <= y1. */
export interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The rectangle spanned by two corners, in any order. */
export function marqueeOf(ax: number, ay: number, bx: number, by: number): Marquee {
  return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
}

/** The client position of a world point, or null when it is not in front of the camera. */
export function screenPosition(p: Vec3, camera: THREE.Camera, rect: ScreenRect, scratch = new THREE.Vector3()): { x: number; y: number } | null {
  scratch.set(p[0], p[1], p[2]).project(camera);
  if (scratch.z > 1 || scratch.z < -1) return null;
  return { x: rect.left + ((scratch.x + 1) / 2) * rect.width, y: rect.top + ((1 - scratch.y) / 2) * rect.height };
}

const inside = (s: { x: number; y: number }, m: Marquee) => s.x >= m.x0 && s.x <= m.x1 && s.y >= m.y0 && s.y <= m.y1;

/** Indices of the vertices of the shape whose point lies inside the rectangle. */
export function verticesInMarquee(shape: Shape, camera: THREE.Camera, rect: ScreenRect, m: Marquee): number[] {
  const scratch = new THREE.Vector3();
  const out: number[] = [];
  worldPoints(shape).forEach((p, i) => {
    const s = screenPosition(p, camera, rect, scratch);
    if (s && inside(s, m)) out.push(i);
  });
  return out;
}

/** Indices of the faces of the shape whose center (the average of its corners) lies inside the rectangle. */
export function facesInMarquee(shape: Shape, camera: THREE.Camera, rect: ScreenRect, m: Marquee): number[] {
  const scratch = new THREE.Vector3();
  const pts = worldPoints(shape);
  const out: number[] = [];
  shape.mesh.faces.forEach((face, fi) => {
    if (face.v.length === 0) return;
    const c: Vec3 = [0, 0, 0];
    for (const vi of face.v) {
      const p = pts[vi]!;
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    const n = face.v.length;
    const s = screenPosition([c[0] / n, c[1] / n, c[2] / n], camera, rect, scratch);
    if (s && inside(s, m)) out.push(fi);
  });
  return out;
}

/** The new selection: the box's hits, added to the current selection when `extend` (Shift / Ctrl / Cmd). */
export function mergeSelection(current: readonly number[], hits: readonly number[], extend: boolean): number[] {
  if (!extend) return [...hits];
  const seen = new Set(current);
  return [...current, ...hits.filter((h) => !seen.has(h))];
}
