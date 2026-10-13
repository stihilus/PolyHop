import { describe, expect, it } from 'vitest';
import { boxMesh } from '../src/core/mesh';
import { PixelBuffer } from '../src/core/pixels';
import {
  canonicalJson,
  hashText,
  parseProjectText,
  projectFileName,
  serializeProject,
  usedTextureNames,
} from '../src/core/projectFile';
import { type ProjectTexture, createBlock, createDefaultProject, createModel, normalizeProject } from '../src/core/types';

const atlas = (name: string, fill: [number, number, number, number] = [255, 0, 0, 255]): ProjectTexture => {
  const pixels = new PixelBuffer(16, 16);
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set(fill, i);
  return { name, tileSize: 16, pixels };
};

function sampleProject() {
  const p = createDefaultProject();
  const model = createModel('Crate', 'Textures-16.png');
  p.models.push(model);
  p.levels[0]!.objects.push(createBlock('Wall', [0, 1, 0], boxMesh([2, 2, 2]), { texture: 'Textures-16.png', col: 1, row: 0 }));
  return p;
}

describe('project file', () => {
  it('names the file after the project and strips characters files cannot have', () => {
    expect(projectFileName('My Platformer')).toBe('My Platformer.polyhop.json');
    expect(projectFileName('a/b:c*?')).toBe('a-b-c-.polyhop.json');
    expect(projectFileName('   ')).toBe('project.polyhop.json');
    expect(projectFileName('.hidden')).toBe('hidden.polyhop.json');
  });

  it('finds the atlases that blocks and models use', () => {
    const p = sampleProject();
    const names = usedTextureNames(p);
    expect(names).toContain('Textures-16.png');
    expect(new Set(names).size).toBe(names.length);
  });

  it('copies used built-in atlases into the file, once, and only those', () => {
    const p = sampleProject();
    const asked: string[] = [];
    const text = serializeProject(p, (n) => {
      asked.push(n);
      return n === 'Textures-16.png' ? atlas(n) : null;
    });
    const back = normalizeProject(JSON.parse(text));
    expect(back.textures.map((t) => t.name)).toEqual(['Textures-16.png']);
    expect(back.textures[0]!.pixels.data[0]).toBe(255);
    // the live project is not changed by saving
    expect(p.textures).toHaveLength(0);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('keeps the project own copy of an atlas instead of the built-in one', () => {
    const p = sampleProject();
    p.textures.push(atlas('Textures-16.png', [0, 255, 0, 255]));
    const text = serializeProject(p, (n) => (n === 'Textures-16.png' ? atlas(n, [255, 0, 0, 255]) : null));
    const back = normalizeProject(JSON.parse(text));
    expect(back.textures).toHaveLength(1);
    expect(back.textures[0]!.pixels.data[1]).toBe(255);
  });

  it('round-trips settings, player, level, models and textures', () => {
    const p = sampleProject();
    p.settings.name = 'Round trip';
    p.player.walkSpeed = 9;
    p.player.doubleJump = false;
    p.textures.push(atlas('mine.png'));
    const back = normalizeProject(parseProjectText(serializeProject(p, () => null)));
    expect(back.settings.name).toBe('Round trip');
    expect(back.player.walkSpeed).toBe(9);
    expect(back.player.doubleJump).toBe(false);
    expect(back.models.map((m) => m.name)).toEqual(p.models.map((m) => m.name));
    expect(back.levels[0]!.objects).toHaveLength(p.levels[0]!.objects.length);
    expect(canonicalJson(back.textures)).toBe(canonicalJson(p.textures));
  });

  it('rejects text that is not a project', () => {
    expect(() => parseProjectText('not json')).toThrow(/not a JSON/);
    expect(() => parseProjectText('[1,2]')).toThrow();
    expect(() => parseProjectText('{"hello":1}')).toThrow(/does not look like a project/);
    expect(() => parseProjectText('{"level":{"objects":[]}}')).not.toThrow();
  });

  it('hash and canonical JSON ignore key order but notice real changes', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
    const a = hashText(canonicalJson({ x: 1, y: 2 }));
    expect(hashText(canonicalJson({ y: 2, x: 1 }))).toBe(a);
    expect(hashText(canonicalJson({ x: 1, y: 3 }))).not.toBe(a);
  });
});

describe('PixelBuffer.coverage', () => {
  it('measures how much of a tile is opaque', () => {
    const px = new PixelBuffer(32, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px.set(x, y, [10, 20, 30, 255]); // left tile solid
    px.set(20, 4, [1, 2, 3, 255]); // right tile: a single pixel
    expect(px.coverage(0, 0, 16, 16)).toBe(1);
    expect(px.coverage(16, 0, 16, 16)).toBeCloseTo(1 / 256);
    expect(px.coverage(0, 0, 32, 16)).toBeCloseTo(257 / 512);
    expect(px.coverage(100, 100, 4, 4)).toBe(0);
  });
});
