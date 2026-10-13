import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { faceNormal, isValidMesh, meshBounds, planeMesh, scaleMeshToSize, triangulateFace, tuftMesh } from '../src/core/mesh';
import { PRIMITIVES, primitiveMesh } from '../src/core/meshGen';
import { type Project, createBlock, createDefaultProject, normalizeObject, normalizeProject } from '../src/core/types';
import { objectTarget } from '../src/editor/shapeTargets';
import { buildBlockGeometryData, collidersFrom } from '../src/runtime/level';
import { buildModelGeometryData } from '../src/runtime/modelRender';
import { createMeshCube, createModel } from '../src/core/types';

describe('plane and grass tuft', () => {
  it('a plane is one upright quad without thickness', () => {
    const m = planeMesh(2, 1);
    expect(isValidMesh(m)).toBe(true);
    expect(m.verts).toHaveLength(4);
    expect(m.faces).toHaveLength(1);
    const { min, max } = meshBounds(m);
    expect(max[0] - min[0]).toBeCloseTo(2);
    expect(max[1] - min[1]).toBeCloseTo(1);
    expect(max[2] - min[2]).toBe(0);
    expect(faceNormal(m, 0)[2]).toBeCloseTo(1);
    expect(triangulateFace(m, 0)).toHaveLength(2);
  });

  it('a tuft is two crossing planes, one facing Z and one facing X', () => {
    const m = tuftMesh(1);
    expect(isValidMesh(m)).toBe(true);
    expect(m.faces).toHaveLength(2);
    expect(Math.abs(faceNormal(m, 0)[2])).toBeCloseTo(1);
    expect(Math.abs(faceNormal(m, 1)[0])).toBeCloseTo(1);
    const { min, max } = meshBounds(m);
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([1, 1, 1]);
  });

  it('both are offered as shapes, not solid, and the tuft starts turned by 45 degrees', () => {
    const plane = PRIMITIVES.find((p) => p.kind === 'plane')!;
    const tuft = PRIMITIVES.find((p) => p.kind === 'tuft')!;
    expect(plane.solid).toBe(false);
    expect(tuft.solid).toBe(false);
    expect(tuft.rotation).toEqual([0, 45, 0]);
    expect(PRIMITIVES.filter((p) => p.cutout).map((p) => p.kind)).toEqual(['plane', 'tuft']);
    expect(primitiveMesh('plane').faces).toHaveLength(1);
    expect(primitiveMesh('tuft').faces).toHaveLength(2);
  });

  it('every face of a plane shows exactly one tile per meter', () => {
    const g = buildBlockGeometryData(planeMesh(1, 1));
    expect(g.positions.length / 3).toBe(4);
    expect(g.indices.length / 3).toBe(2);
    const us = [0, 1, 2, 3].map((i) => g.tileUvs[i * 2]!);
    const vs = [0, 1, 2, 3].map((i) => g.tileUvs[i * 2 + 1]!);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(1);
    const t = buildBlockGeometryData(tuftMesh(1));
    for (let f = 0; f < 2; f++) {
      const o = f * 4;
      const u = [0, 1, 2, 3].map((i) => t.tileUvs[(o + i) * 2]!);
      expect(Math.max(...u) - Math.min(...u)).toBeCloseTo(1);
    }
  });

  it('resizing keeps the flat axis flat', () => {
    const m = planeMesh(1, 1);
    scaleMeshToSize(m, [2, 3, 0.5]);
    const { min, max } = meshBounds(m);
    expect(max[0] - min[0]).toBeCloseTo(2);
    expect(max[1] - min[1]).toBeCloseTo(3);
    expect(max[2] - min[2]).toBe(0);
  });

  it('scaling with the gizmo ignores the flat axis instead of blowing up', () => {
    const shape = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], mesh: planeMesh(1, 1) };
    shape.mesh.verts.forEach((v) => (v[2] = 0.4)); // origin is not on the plane
    let geometry = 0;
    const target = objectTarget(shape, { onTransform() {}, onGeometry: () => geometry++, onCommit() {} });
    target.begin();
    target.apply({ translate: new THREE.Vector3(), rotate: new THREE.Quaternion(), scale: new THREE.Vector3(2, 2, 3) });
    expect(geometry).toBe(1);
    for (const v of shape.mesh.verts) {
      expect(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])).toBe(true);
      expect(v[2]).toBeCloseTo(0.4);
    }
    const { min, max } = meshBounds(shape.mesh);
    expect(max[0] - min[0]).toBeCloseTo(2);
  });
});

describe('both sides and solid', () => {
  it('blocks are drawn from both sides by default, also in older projects', () => {
    const b = createBlock('Grass', [0, 0, 0], planeMesh(), null);
    expect(b.doubleSided).toBe(true);
    const old = normalizeObject({ kind: 'block', position: [0, 0, 0] } as never);
    expect(old.kind === 'block' && old.doubleSided).toBe(true);
    const off = normalizeObject({ kind: 'block', doubleSided: false } as never);
    expect(off.kind === 'block' && off.doubleSided).toBe(false);
    const kept = normalizeProject(JSON.parse(JSON.stringify({ level: { objects: [{ ...createBlock('x', [0, 0, 0], planeMesh(), null), doubleSided: false }] } }))) as Project;
    expect(kept.levels[0]!.objects[0]!.kind === 'block' && (kept.levels[0]!.objects[0] as { doubleSided: boolean }).doubleSided).toBe(false);
  });

  it('a plane that is not solid adds no collision box', () => {
    const grass = createBlock('Grass', [0, 0.5, 0], planeMesh(), null);
    grass.collide = false;
    expect(collidersFrom([grass], () => undefined)).toHaveLength(0);
  });

  it('a plane inside a model is a normal single face with its own UV', () => {
    const model = createModel('Grass', 't.png');
    model.cubes[0] = createMeshCube('Plane', [0, 0.5, 0], planeMesh(1, 1, { x: 16, y: 0, w: 16, h: 16 }));
    const g = buildModelGeometryData(model, 128, 16);
    expect(g.positions.length / 3).toBe(4);
    expect(g.indices.length / 3).toBe(2);
    const us = [0, 1, 2, 3].map((i) => g.uvs[i * 2]!);
    expect(Math.min(...us)).toBeGreaterThan(0.12);
    expect(Math.max(...us)).toBeLessThan(0.26);
  });

  it('the default project still starts with the usual level', () => {
    expect(createDefaultProject().levels[0]!.objects.every((o) => o.kind !== 'block' || o.doubleSided)).toBe(true);
  });
});
