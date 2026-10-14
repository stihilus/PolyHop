import { describe, expect, it } from 'vitest';
import { checkCube, checkModel, triangleCount } from '../src/core/hytaleStyle';
import { boxMesh, planeMesh, prismMesh, rockMesh, tuftMesh, wedgeMesh } from '../src/core/mesh';
import { cylinderMesh, sphereMesh, stairsMesh } from '../src/core/meshGen';
import { bevelMesh } from '../src/core/meshModify';
import type { ModelCube } from '../src/core/types';

const cube = (name: string, mesh: ReturnType<typeof boxMesh>): ModelCube => ({ id: name, name, position: [0, 0, 0], rotation: [0, 0, 0], mesh, bone: null });

describe('the shapes the Hytale guide allows', () => {
  it('accepts a box of any size, and one that is turned', () => {
    expect(checkCube(cube('Box', boxMesh([1, 2, 0.5]))).problems).toEqual([]);
    const turned = boxMesh([1, 1, 1]);
    // turn the points 30 degrees about Y: still a cube
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    turned.verts = turned.verts.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
    const r = checkCube(cube('Turned', turned));
    expect(r.problems).toEqual([]);
    expect(r.boxes).toBe(1);
    expect(r.triangles).toBe(12);
  });

  it('accepts flat quads, a tuft of two, and several boxes in one mesh', () => {
    expect(checkCube(cube('Plane', planeMesh(1, 2))).quads).toBe(1);
    const tuft = checkCube(cube('Tuft', tuftMesh(1)));
    expect(tuft.quads).toBe(2);
    expect(tuft.problems).toEqual([]);
    expect(tuft.triangles).toBe(4);
  });

  it('refuses what the guide says no to: wedges, prisms, cylinders, spheres, rocks, bevels, skewed and tapered boxes', () => {
    const bad: [string, ReturnType<typeof boxMesh>][] = [
      ['wedge', wedgeMesh([1, 1, 1])],
      ['prism', prismMesh(6, 0.3, 0.5)],
      ['cylinder', cylinderMesh(8, 0.4, 0.4, 1)],
      ['cone', cylinderMesh(8, 0.4, 0, 1)],
      ['sphere', sphereMesh(0.5, 8, 5)],
      ['rock', rockMesh(3, 1)],
      ['bevel', bevelMesh(boxMesh([1, 1, 1]), { amount: 0.05 })],
      ['stairs', stairsMesh([1, 1, 1], 4)],
    ];
    for (const [name, mesh] of bad) expect(checkCube(cube(name, mesh)).problems.length, name).toBeGreaterThan(0);
    const skewed = boxMesh([1, 1, 1]);
    skewed.verts = skewed.verts.map(([x, y, z]) => [x + y * 0.4, y, z]);
    expect(checkCube(cube('skewed', skewed)).problems).toHaveLength(1);
    const tapered = boxMesh([1, 1, 1]);
    tapered.verts = tapered.verts.map(([x, y, z]) => [y > 0 ? x * 0.5 : x, y, y > 0 ? z * 0.5 : z]);
    expect(checkCube(cube('tapered', tapered)).problems).toHaveLength(1);
  });

  it('counts triangles and places a model in a tier', () => {
    expect(triangleCount(boxMesh([1, 1, 1]))).toBe(12);
    const model = { cubes: [cube('A', boxMesh([1, 1, 1])), cube('B', boxMesh([1, 1, 1])), cube('P', planeMesh(1, 1))] };
    const r = checkModel(model);
    expect(r.boxes).toBe(2);
    expect(r.quads).toBe(1);
    expect(r.triangles).toBe(26);
    expect(r.tier).toBe(2);
    expect(checkModel({ cubes: [cube('P', planeMesh(1, 1))] }).tier).toBe(1);
    expect(checkModel({ cubes: [cube('B', boxMesh([1, 1, 1]))] }).tier).toBe(2);
    const many = { cubes: Array.from({ length: 20 }, (_, i) => cube(`B${i}`, boxMesh([1, 1, 1]))) };
    expect(checkModel(many).tier).toBe(3);
    expect(checkModel({ cubes: Array.from({ length: 60 }, (_, i) => cube(`B${i}`, boxMesh([1, 1, 1]))) }).tier).toBe(4);
  });

  it('warns about a box that is too thin to be a box', () => {
    const r = checkCube(cube('Thin', boxMesh([1, 1, 0.01])));
    expect(r.problems).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});
