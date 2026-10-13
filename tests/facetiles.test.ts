import { describe, expect, it } from 'vitest';
import {
  boxMesh,
  cloneMesh,
  extrudeFaces,
  insetFaces,
  loopCut,
  mergeVertices,
  sanitizeFaceTile,
  subdivideFaces,
} from '../src/core/mesh';
import { serializeProject, usedTextureNames } from '../src/core/projectFile';
import { createBlock, createDefaultProject, normalizeObject, normalizeProject } from '../src/core/types';
import { buildBlockGeometryData } from '../src/runtime/level';

const GRASS = { texture: 'Textures-16.png', col: 3, row: 16 };
const DIRT = { texture: 'Seamless-16.png', col: 1, row: 2, rot: 1 };

describe('face tiles', () => {
  it('a mesh clone keeps painted tiles and does not share them', () => {
    const m = boxMesh([1, 1, 1]);
    m.faces[4]!.tile = { ...GRASS };
    const c = cloneMesh(m);
    expect(c.faces[4]!.tile).toEqual(GRASS);
    c.faces[4]!.tile!.col = 9;
    expect(m.faces[4]!.tile!.col).toBe(3);
    expect(c.faces[0]!.tile).toBeUndefined();
  });

  it('cleans a tile of unknown origin', () => {
    expect(sanitizeFaceTile({ texture: 'a.png', col: 1, row: 2, rot: 5, flip: true })).toEqual({ texture: 'a.png', col: 1, row: 2, rot: 1, flip: true });
    expect(sanitizeFaceTile({ texture: 'a.png', col: 1, row: 2, rot: 0, flip: false })).toEqual({ texture: 'a.png', col: 1, row: 2 });
    expect(sanitizeFaceTile({ texture: '', col: 1, row: 2 })).toBeUndefined();
    expect(sanitizeFaceTile({ texture: 'a.png', col: -1, row: 2 })).toBeUndefined();
    expect(sanitizeFaceTile({ texture: 'a.png', col: 1.5, row: 2 })).toBeUndefined();
    expect(sanitizeFaceTile(null)).toBeUndefined();
  });

  it('new faces from mesh tools inherit the tile of the face they came from', () => {
    const m = boxMesh([2, 2, 2]);
    m.faces[4]!.tile = { ...GRASS };
    const ex = cloneMesh(m);
    extrudeFaces(ex, [4]);
    // the extruded face and its four walls
    expect(ex.faces.filter((f) => f.tile?.col === 3)).toHaveLength(5);

    const ins = cloneMesh(m);
    insetFaces(ins, [4]);
    expect(ins.faces.filter((f) => f.tile?.col === 3)).toHaveLength(5);

    const sub = cloneMesh(m);
    subdivideFaces(sub, [4]);
    expect(sub.faces.filter((f) => f.tile?.col === 3)).toHaveLength(4);
    expect(sub.faces.filter((f) => !f.tile)).toHaveLength(5);

    const cut = cloneMesh(boxMesh([2, 2, 2]));
    cut.faces[4]!.tile = { ...GRASS };
    cut.faces[0]!.tile = { ...DIRT };
    expect(loopCut(cut, 4, 0, 0.5)).not.toBeNull();
    // a loop cut splits faces in two; both halves keep the tile
    expect(cut.faces.filter((f) => f.tile?.col === 3).length).toBeGreaterThanOrEqual(2);
  });

  it('welding vertices keeps the tiles of the faces that survive', () => {
    const m = boxMesh([1, 1, 1]);
    m.faces[0]!.tile = { ...GRASS };
    mergeVertices(m, [0, 1]);
    expect(m.faces.some((f) => f.tile?.texture === 'Textures-16.png')).toBe(true);
  });
});

describe('geometry of a block with painted faces', () => {
  it('has one group when nothing is painted, covering every triangle', () => {
    const g = buildBlockGeometryData(boxMesh([1, 1, 1]));
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]).toEqual({ start: 0, count: 36, tile: null });
  });

  it('puts the block tile first and one group for each painted tile', () => {
    const m = boxMesh([1, 1, 1]);
    m.faces[4]!.tile = { ...GRASS };
    m.faces[5]!.tile = { ...GRASS };
    m.faces[0]!.tile = { ...DIRT };
    const g = buildBlockGeometryData(m);
    expect(g.groups.map((x) => [x.tile?.col ?? null, x.count])).toEqual([
      [null, 3 * 6],
      [1, 6], // face 0 is met first
      [3, 12],
    ]);
    // groups tile the index buffer exactly
    let at = 0;
    for (const grp of g.groups) {
      expect(grp.start).toBe(at);
      at += grp.count;
    }
    expect(at).toBe(g.indices.length);
    // the face of each triangle follows the new order
    const painted = g.groups[2]!;
    const faces = new Set<number>();
    for (let t = painted.start / 3; t < (painted.start + painted.count) / 3; t++) faces.add(g.faceOfTriangle[t]!);
    expect([...faces].sort()).toEqual([4, 5]);
  });

  it('a block painted on every face has no group for the block tile', () => {
    const m = boxMesh([1, 1, 1]);
    for (const f of m.faces) f.tile = { ...GRASS };
    const g = buildBlockGeometryData(m);
    expect(g.groups).toHaveLength(1);
    expect(g.groups[0]!.tile).toEqual(GRASS);
  });

  it('turning and mirroring change the texture coordinates but not the positions', () => {
    const plain = boxMesh([1, 1, 1]);
    const turned = boxMesh([1, 1, 1]);
    turned.faces[0]!.tile = { ...GRASS, rot: 1 };
    const flipped = boxMesh([1, 1, 1]);
    flipped.faces[0]!.tile = { ...GRASS, flip: true };
    const a = buildBlockGeometryData(plain);
    const b = buildBlockGeometryData(turned);
    const c = buildBlockGeometryData(flipped);
    // face 0 comes first in the vertex array of every variant (4 corners)
    expect(Array.from(b.positions.slice(0, 12))).toEqual(Array.from(a.positions.slice(0, 12)));
    expect(Array.from(b.tileUvs.slice(0, 8))).not.toEqual(Array.from(a.tileUvs.slice(0, 8)));
    expect(Array.from(c.tileUvs.slice(0, 8))).not.toEqual(Array.from(a.tileUvs.slice(0, 8)));
    // a quarter turn maps (a, b) to (-b, a): the face's first corner sits at (0, 0) and stays there
    expect(b.tileUvs[0]).toBeCloseTo(-0);
    expect(b.tileUvs[1]).toBeCloseTo(0);
    // the opposite corner moves from (1, 1) to (-1, 1)
    const uvs = Array.from(b.tileUvs.slice(0, 8));
    const base = Array.from(a.tileUvs.slice(0, 8));
    for (let k = 0; k < 4; k++) {
      expect(uvs[2 * k]).toBeCloseTo(-base[2 * k + 1]!);
      expect(uvs[2 * k + 1]).toBeCloseTo(base[2 * k]!);
    }
  });
});

describe('saving painted faces', () => {
  it('a painted block survives a save and a load', () => {
    const b = createBlock('Cube', [0, 0, 0], boxMesh([1, 1, 1]), { texture: 'Textures-16.png', col: 7, row: 0 });
    b.mesh.faces[4]!.tile = { ...GRASS };
    b.mesh.faces[0]!.tile = { ...DIRT };
    const back = normalizeObject(JSON.parse(JSON.stringify(b)));
    expect(back.kind === 'block' && back.mesh.faces[4]!.tile).toEqual(GRASS);
    expect(back.kind === 'block' && back.mesh.faces[0]!.tile).toEqual(DIRT);
    expect(back.kind === 'block' && back.mesh.faces[1]!.tile).toBeUndefined();
  });

  it('a broken tile in a file is dropped, the rest stays', () => {
    const b = createBlock('Cube', [0, 0, 0], boxMesh([1, 1, 1]), null);
    const raw = JSON.parse(JSON.stringify(b));
    raw.mesh.faces[0].tile = { texture: 5, col: 'x' };
    raw.mesh.faces[1].tile = { ...GRASS };
    const back = normalizeObject(raw);
    expect(back.kind === 'block' && back.mesh.faces[0]!.tile).toBeUndefined();
    expect(back.kind === 'block' && back.mesh.faces[1]!.tile).toEqual(GRASS);
  });

  it('atlases used only by painted faces are written into the project file', () => {
    const p = createDefaultProject();
    const b = createBlock('Cube', [0, 0, 0], boxMesh([1, 1, 1]), null);
    b.mesh.faces[2]!.tile = { texture: 'Plants-16.png', col: 0, row: 0 };
    p.levels[0]!.objects.push(b);
    expect(usedTextureNames(p)).toContain('Plants-16.png');
    const asked: string[] = [];
    serializeProject(p, (name) => {
      asked.push(name);
      return null;
    });
    expect(asked).toContain('Plants-16.png');
    // and the project still loads
    expect(normalizeProject(JSON.parse(serializeProject(p, () => null))).levels[0]!.objects.length).toBe(p.levels[0]!.objects.length);
  });
});
