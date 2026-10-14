import { deflateSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packRects } from '../src/core/atlasPack';
import { PixelBuffer, type RGBA, floodFill, line, stamp } from '../src/core/pixels';
import { boxMesh } from '../src/core/mesh';
import {
  FACE_KEYS,
  type LevelModelInstance,
  createCube,
  createModel,
  normalizeModel,
  normalizeProject,
} from '../src/core/types';
import {
  type UVPoly,
  clampGroupMove,
  flipUvH,
  flipUvV,
  pointInPoly,
  rectUv,
  rotateUvCCW,
  rotateUvCW,
  translateUv,
  uvBounds,
  uvToRenderCoords,
} from '../src/core/uv';
import { buildModelGeometryData, modelBounds, modelInstanceColliders } from '../src/runtime/modelRender';

const RED: RGBA = [255, 0, 0, 255];
const BLUE: RGBA = [0, 0, 255, 255];

describe('PixelBuffer', () => {
  it('round-trips through compressed JSON', () => {
    const b = new PixelBuffer(32, 32);
    b.fill([10, 20, 30, 255]);
    b.set(1, 1, RED);
    b.set(2, 0, [1, 2, 3, 4]);
    const json = JSON.parse(JSON.stringify(b));
    expect(typeof json.z).toBe('string');
    // flat pixel art must compress well (raw would be 4096 bytes -> ~5.5k base64 chars)
    expect(json.z.length).toBeLessThan(600);
    const copy = PixelBuffer.from(json);
    expect(copy.w).toBe(32);
    expect(Array.from(copy.data)).toEqual(Array.from(b.data));
  });

  it('still reads the older uncompressed format', () => {
    const raw = new Uint8Array(2 * 2 * 4).fill(7);
    const legacy = { w: 2, h: 2, data: btoa(String.fromCharCode(...raw)) };
    expect(PixelBuffer.from(legacy).get(1, 1)).toEqual([7, 7, 7, 7]);
  });

  it('reads {w,h,data: typed array} objects', () => {
    const b = new PixelBuffer(2, 2);
    b.fill(BLUE);
    expect(PixelBuffer.from({ w: 2, h: 2, data: b.data.slice() }).get(1, 1)).toEqual(BLUE);
  });

  it('falls back to a blank buffer for corrupt data', () => {
    expect(PixelBuffer.from({ w: 4, h: 4, z: 'not-deflate' }).data.length).toBe(64);
    expect(PixelBuffer.from({ w: 4, h: 4, z: btoa(String.fromCharCode(...deflateSync(new Uint8Array(3)))) }).data.length).toBe(64);
  });

  it('extracts and blits rectangles', () => {
    const b = new PixelBuffer(4, 4);
    b.set(2, 2, RED);
    const patch = b.extract(1, 1, 3, 3);
    expect(patch.get(1, 1)).toEqual(RED);
    const c = new PixelBuffer(4, 4);
    c.blit(patch, 1, 1);
    expect(c.get(2, 2)).toEqual(RED);
  });
});

describe('pixel tools', () => {
  it('stamps a brush', () => {
    const b = new PixelBuffer(5, 5);
    stamp(b, 2, 2, 3, RED);
    expect(b.get(1, 1)).toEqual(RED);
    expect(b.get(3, 3)).toEqual(RED);
    expect(b.get(0, 0)[3]).toBe(0);
  });

  it('draws a connected line including both ends', () => {
    const pts: [number, number][] = [];
    line(0, 0, 4, 2, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([4, 2]);
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i]![0] - pts[i - 1]![0])).toBeLessThanOrEqual(1);
      expect(Math.abs(pts[i]![1] - pts[i - 1]![1])).toBeLessThanOrEqual(1);
    }
  });

  it('flood fills only the connected region and reports bounds', () => {
    const b = new PixelBuffer(4, 4);
    b.fill([0, 0, 0, 255]);
    for (let y = 0; y < 4; y++) b.set(2, y, [9, 9, 9, 255]); // wall
    const box = floodFill(b, 0, 0, RED);
    expect(box).toEqual({ x0: 0, y0: 0, x1: 1, y1: 3 });
    expect(b.get(1, 3)).toEqual(RED);
    expect(b.get(3, 0)).toEqual([0, 0, 0, 255]);
  });

  it('flood fill respects a mask', () => {
    const b = new PixelBuffer(6, 1);
    b.fill([0, 0, 0, 255]);
    floodFill(b, 0, 0, RED, (x) => x < 3);
    expect(b.get(2, 0)).toEqual(RED);
    expect(b.get(3, 0)).toEqual([0, 0, 0, 255]);
  });

  it('fill with the same color is a no-op (no infinite loop)', () => {
    const b = new PixelBuffer(3, 3);
    b.fill(RED);
    expect(floodFill(b, 1, 1, RED)).toBeNull();
  });
});

describe('uv helpers', () => {
  const rect = rectUv(16, 32, 16, 8);

  it('rectUv is upright: lower-left maps to the rect bottom-left', () => {
    expect(rect[0]).toEqual([16, 40]);
    expect(rect[1]).toEqual([32, 40]);
    expect(rect[2]).toEqual([32, 32]);
    expect(rect[3]).toEqual([16, 32]);
    expect(uvBounds(rect)).toEqual({ minX: 16, minY: 32, maxX: 32, maxY: 40 });
  });

  it('rotate CW then CCW is identity and four CW rotations too', () => {
    expect(rotateUvCCW(rotateUvCW(rect))).toEqual(rect);
    let r = rect;
    for (let i = 0; i < 4; i++) r = rotateUvCW(r);
    expect(r).toEqual(rect);
  });

  it('rotate CW moves the upper-left picture corner to the upper-right', () => {
    const r = rotateUvCW(rect);
    // after rotation the face's upper-right vertex (2) samples what was the upper-left (3)
    expect(r[2]).toEqual(rect[3]);
  });

  it('flips are involutions and swap the expected corners', () => {
    expect(flipUvH(flipUvH(rect))).toEqual(rect);
    expect(flipUvV(flipUvV(rect))).toEqual(rect);
    expect(flipUvH(rect)[0]).toEqual(rect[1]);
    expect(flipUvV(rect)[0]).toEqual(rect[3]);
  });

  it('translates', () => {
    expect(translateUv(rect, 2, -3)[0]).toEqual([18, 37]);
  });

  it('point in quad handles rects, edges and skewed quads', () => {
    expect(pointInPoly(20, 36, rect)).toBe(true);
    expect(pointInPoly(16, 36, rect)).toBe(true); // edge
    expect(pointInPoly(40, 36, rect)).toBe(false);
    const skew = [
      [0, 10],
      [10, 10],
      [14, 0],
      [4, 0],
    ] as Parameters<typeof pointInPoly>[2];
    expect(pointInPoly(9, 5, skew)).toBe(true);
    expect(pointInPoly(1, 1, skew)).toBe(false);
  });

  it('render coords normalize by texture size and flip v', () => {
    const c = uvToRenderCoords(rectUv(0, 0, 64, 64), 64, 64);
    // lower-left of the face samples texture bottom-left: u ~ 0, v ~ 0 (inset toward the center)
    expect(c[0]).toBeCloseTo(0, 2);
    expect(c[1]).toBeCloseTo(0, 2);
    // upper-right samples top-right: u ~ 1, v ~ 1
    expect(c[4]).toBeCloseTo(1, 2);
    expect(c[5]).toBeCloseTo(1, 2);
    // inset keeps every vertex strictly inside the rectangle
    expect(c[0]).toBeGreaterThan(0);
    expect(c[4]).toBeLessThan(1);
  });
});

describe('model data', () => {
  it('new cubes map every face to the given rectangle', () => {
    const c = createCube('c', [0, 0.5, 0], [1, 1, 1], { x: 32, y: 48, w: 16, h: 16 });
    expect(c.mesh.faces).toHaveLength(6);
    for (const f of c.mesh.faces) expect(uvBounds(f.uv)).toEqual({ minX: 32, minY: 48, maxX: 48, maxY: 64 });
  });

  it('round-trips a model through JSON and normalizeModel', () => {
    const model = createModel('M', 'Textures-16.png', { x: 16, y: 0, w: 16, h: 16 });
    const back = normalizeModel(JSON.parse(JSON.stringify(model)));
    expect(back).toEqual(model);
  });

  it('repairs broken uv data instead of crashing', () => {
    const back = normalizeModel({ id: 'm', name: 'x', cubes: [{ id: 'c', name: 'c', uv: { pz: 'nope' } }] } as never);
    expect(back.cubes[0]!.mesh.faces[0]!.uv).toHaveLength(4);
    expect(back.cubes[0]!.mesh.verts).toHaveLength(8);
  });

  it('migrates the old per-face bitmap format into one texture', () => {
    const face = new PixelBuffer(16, 16);
    face.fill(RED);
    const legacyFaces = Object.fromEntries(FACE_KEYS.map((k) => [k, JSON.parse(JSON.stringify(face))]));
    const legacy = {
      id: 'old',
      name: 'Old crate',
      cubes: [{ id: 'c1', name: 'Cube', position: [0, 0.5, 0], size: [1, 1, 1], faces: legacyFaces }],
    };
    const project = normalizeProject({ models: [legacy] });
    expect(project.textures).toHaveLength(1);
    const tex = project.textures[0]!;
    const model = project.models[0]!;
    expect(model.texture).toBe(tex.name);
    FACE_KEYS.forEach((_, i) => {
      const b = uvBounds(model.cubes[0]!.mesh.faces[i]!.uv);
      expect(b.maxX - b.minX).toBe(16);
      expect(tex.pixels.get(Math.floor(b.minX) + 3, Math.floor(b.minY) + 3)).toEqual(RED);
    });
  });

  it('keeps project textures when normalizing', () => {
    const px = new PixelBuffer(8, 8);
    px.fill(BLUE);
    const project = normalizeProject({ textures: [{ name: 't.png', tileSize: 8, pixels: JSON.parse(JSON.stringify(px)) }] });
    expect(project.textures[0]!.pixels.get(3, 3)).toEqual(BLUE);
    expect(project.textures[0]!.tileSize).toBe(8);
  });
});

describe('atlas packing (used for migration)', () => {
  it('packs rects without overlap inside the atlas', () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, w: 4 + (i % 5) * 7, h: 3 + (i % 4) * 9 }));
    const atlas = packRects(items);
    const rects = [...atlas.rects.values()];
    expect(rects).toHaveLength(13);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.width);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.height);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    }
  });
});

describe('model geometry', () => {
  it('builds one quad per face with triangles that face outward', () => {
    const model = createModel('M', 't.png');
    model.cubes.push(createCube('b', [2, 0.5, 0], [1, 2, 1]));
    const g = buildModelGeometryData(model, 64, 64);
    expect(g.indices.length).toBe(model.cubes.length * 6 * 6);
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
      const pa = p(a);
      const pb = p(b);
      const pc = p(c);
      const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const s = [g.normals[a * 3]!, g.normals[a * 3 + 1]!, g.normals[a * 3 + 2]!];
      expect(n[0]! * s[0]! + n[1]! * s[1]! + n[2]! * s[2]!).toBeGreaterThan(0);
    }
  });

  it('writes each face uv into its own 4 vertices (quad index = cube*6 + face)', () => {
    const model = createModel('M', 't.png', { x: 0, y: 0, w: 16, h: 16 });
    model.cubes.push(createCube('b', [2, 0.5, 0], [1, 1, 1], { x: 32, y: 16, w: 16, h: 16 }));
    model.cubes[1]!.mesh.faces[0]!.uv = rectUv(48, 48, 8, 8);
    const g = buildModelGeometryData(model, 64, 64);
    const quad = 1 * 6 + 0; // second cube, +Z face
    const u0 = g.uvs[quad * 8]!; // lower-left u of that face
    const v0 = g.uvs[quad * 8 + 1]!;
    expect(u0 * 64).toBeCloseTo(48, 0);
    expect((1 - v0) * 64).toBeCloseTo(56, 0); // lower edge of an 8px rect starting at y=48
  });

});

describe('model instances', () => {
  const model = createModel('M', 't.png');
  model.cubes[0]!.mesh = boxMesh([2, 1, 1]);
  const base: LevelModelInstance = {
    id: 'i',
    name: 'i',
    kind: 'model',
    modelId: model.id,
    position: [10, 0, 5],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    animation: null,
    animationSpeed: 1,
    collide: true,
    rules: [],
  };

  it('computes bounds', () => {
    expect(modelBounds(model)).toEqual({ min: [-1, 0, -0.5], max: [1, 1, 0.5] });
  });

  it('places collision boxes at the instance position', () => {
    const [b] = modelInstanceColliders(model, base);
    expect(b).toMatchObject({ minX: 9, maxX: 11, minY: 0, maxY: 1, minZ: 4.5, maxZ: 5.5 });
  });

  it('rotating by 90 degrees swaps the footprint axes', () => {
    const [b] = modelInstanceColliders(model, { ...base, rotation: [0, 90, 0] });
    expect(b!.maxX - b!.minX).toBeCloseTo(1);
    expect(b!.maxZ - b!.minZ).toBeCloseTo(2);
  });

  it('scales the boxes', () => {
    const [b] = modelInstanceColliders(model, { ...base, scale: [2, 2, 2] });
    expect(b!.maxX - b!.minX).toBeCloseTo(4);
    expect(b!.maxY).toBeCloseTo(2);
  });
});

describe('moving several UV quads together', () => {
  const quad = (x: number, y: number, w = 4, h = 4): UVPoly => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];

  it('moves the whole group by the same step, and stops when the first of them reaches the edge', () => {
    const group = [quad(2, 2), quad(10, 6)];
    expect(clampGroupMove(group, 3, 1, 64, 64)).toEqual([3, 1]);
    // the left quad reaches x = 0 first: the right one stops short of where it could go
    expect(clampGroupMove(group, -5, 0, 64, 64)).toEqual([-2, 0]);
    // the right quad reaches the right edge first (x = 14 + dx <= 64)
    expect(clampGroupMove(group, 100, 0, 64, 64)).toEqual([50, 0]);
    expect(clampGroupMove(group, 0, -9, 64, 64)).toEqual([0, -2]);
    expect(clampGroupMove(group, 0, 100, 64, 32)).toEqual([0, 22]);
  });

  it('a single quad, and an empty group', () => {
    expect(clampGroupMove([quad(0, 0)], -3, -3, 16, 16)).toEqual([0, 0]);
    expect(clampGroupMove([], 5, 5, 16, 16)).toEqual([5, 5]);
  });

  it('keeps the quads where they are relative to each other', () => {
    const group = [quad(2, 2), quad(10, 6)];
    const [dx, dy] = clampGroupMove(group, -8, -8, 64, 64);
    const moved = group.map((uv) => translateUv(uv, dx, dy));
    expect(moved[1]![0]![0]! - moved[0]![0]![0]!).toBe(8);
    expect(moved[1]![0]![1]! - moved[0]![0]![1]!).toBe(4);
    expect(Math.min(...moved.flat().map((p) => p[0]))).toBe(0);
    expect(Math.min(...moved.flat().map((p) => p[1]))).toBe(0);
  });
});
