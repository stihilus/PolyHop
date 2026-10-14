import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../src/core/mesh';
import type { Shape } from '../src/core/shape';
import { facesInMarquee, marqueeOf, mergeSelection, screenPosition, verticesInMarquee } from '../src/editor/boxSelect';

const rect = { left: 0, top: 0, width: 800, height: 600 };

function camera(z = 6): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.1, 100);
  c.position.set(0, 0, z);
  c.lookAt(0, 0, 0);
  c.updateMatrixWorld();
  c.updateProjectionMatrix();
  return c;
}

const cube = (position: [number, number, number] = [0, 0, 0]): Shape => ({ position, rotation: [0, 0, 0], mesh: boxMesh([2, 2, 2]) });

describe('the rectangle', () => {
  it('is the same from any two corners', () => {
    expect(marqueeOf(10, 50, 4, 20)).toEqual({ x0: 4, y0: 20, x1: 10, y1: 50 });
    expect(marqueeOf(4, 20, 10, 50)).toEqual({ x0: 4, y0: 20, x1: 10, y1: 50 });
  });
});

describe('where a point is on the screen', () => {
  it('the middle of the view for the point the camera looks at, up on the screen for a point above it', () => {
    const c = camera();
    const mid = screenPosition([0, 0, 0], c, rect)!;
    expect(mid.x).toBeCloseTo(400, 3);
    expect(mid.y).toBeCloseTo(300, 3);
    const up = screenPosition([0, 1, 0], c, rect)!;
    expect(up.x).toBeCloseTo(400, 3);
    expect(up.y).toBeLessThan(300);
  });

  it('follows the canvas on the page', () => {
    const c = camera();
    const moved = screenPosition([0, 0, 0], c, { left: 100, top: 40, width: 800, height: 600 })!;
    expect(moved.x).toBeCloseTo(500, 3);
    expect(moved.y).toBeCloseTo(340, 3);
  });

  it('nothing for a point behind the camera', () => {
    expect(screenPosition([0, 0, 10], camera(), rect)).toBeNull();
  });
});

describe('box select of points', () => {
  const c = camera();

  it('a rectangle over everything takes all 8 corners', () => {
    expect(verticesInMarquee(cube(), c, rect, marqueeOf(0, 0, 800, 600))).toHaveLength(8);
  });

  it('the left half takes the 4 corners on the left, the same corners the left face has', () => {
    const shape = cube();
    const got = verticesInMarquee(shape, c, rect, marqueeOf(0, 0, 399, 600));
    expect(got).toHaveLength(4);
    for (const i of got) expect(shape.mesh.verts[i]![0]).toBeLessThan(0);
  });

  it('takes the points behind the shape too (the handles are drawn through it)', () => {
    const shape = cube();
    const front = verticesInMarquee(shape, c, rect, marqueeOf(0, 0, 800, 600)).filter((i) => shape.mesh.verts[i]![2] > 0);
    const back = verticesInMarquee(shape, c, rect, marqueeOf(0, 0, 800, 600)).filter((i) => shape.mesh.verts[i]![2] < 0);
    expect(front).toHaveLength(4);
    expect(back).toHaveLength(4);
  });

  it('a rectangle in empty space, or one around the middle, takes nothing', () => {
    expect(verticesInMarquee(cube(), c, rect, marqueeOf(0, 0, 50, 50))).toEqual([]);
    expect(verticesInMarquee(cube(), c, rect, marqueeOf(380, 280, 420, 320))).toEqual([]);
  });

  it('takes the shape where it stands: moved aside and turned', () => {
    const shape: Shape = { position: [2, 0, 0], rotation: [0, 45, 0], mesh: boxMesh([2, 2, 2]) };
    expect(verticesInMarquee(shape, c, rect, marqueeOf(0, 0, 399, 600))).toEqual([]);
    expect(verticesInMarquee(shape, c, rect, marqueeOf(400, 0, 800, 600))).toHaveLength(8);
  });

  it('skips a shape behind the camera', () => {
    expect(verticesInMarquee(cube([0, 0, 10]), c, rect, marqueeOf(0, 0, 800, 600))).toEqual([]);
  });
});

describe('box select of faces', () => {
  const c = camera();

  it('a face is taken by its center: all six with everything, the one on the left with the left half', () => {
    const shape = cube();
    expect(facesInMarquee(shape, c, rect, marqueeOf(0, 0, 800, 600))).toHaveLength(6);
    const left = facesInMarquee(shape, c, rect, marqueeOf(0, 0, 399, 600));
    expect(left).toHaveLength(1);
    const face = shape.mesh.faces[left[0]!]!;
    for (const vi of face.v) expect(shape.mesh.verts[vi]![0]).toBeLessThan(0);
  });

  it('a small rectangle in the middle takes the front and the back face (their centers are in line)', () => {
    expect(facesInMarquee(cube(), c, rect, marqueeOf(390, 290, 410, 310))).toHaveLength(2);
  });
});

describe('adding to a selection', () => {
  it('replaces it, or adds to it without repeats', () => {
    expect(mergeSelection([1, 2], [2, 3], false)).toEqual([2, 3]);
    expect(mergeSelection([1, 2], [2, 3], true)).toEqual([1, 2, 3]);
    expect(mergeSelection([], [], false)).toEqual([]);
  });
});
