import { describe, expect, it } from 'vitest';
import { FACE_CORNERS, FACE_KEYS, baseCorner, boxMesh, faceNormal, meshBounds, triangulateFace } from '../src/core/mesh';
import {
  type Shape,
  degreesFromQuaternion,
  isBoxMesh,
  pointsBounds,
  quaternionFromDegrees,
  worldPoints,
} from '../src/core/shape';
import {
  type LevelModelInstance,
  createCube,
  createModel,
  normalizeObject,
  normalizeProject,
} from '../src/core/types';
import { buildBlockGeometryData, buildColliders } from '../src/runtime/level';
import { buildModelGeometryData, modelBounds, modelInstanceColliders } from '../src/runtime/modelRender';

const shape = (over: Partial<Shape> = {}): Shape => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  mesh: boxMesh([2, 1, 4]),
  ...over,
});

describe('box corners', () => {
  it('corner bits: x=1, y=2, z=4 select the + side', () => {
    expect(baseCorner([2, 4, 6], 0)).toEqual([-1, -2, -3]);
    expect(baseCorner([2, 4, 6], 7)).toEqual([1, 2, 3]);
    expect(baseCorner([2, 4, 6], 1)).toEqual([1, -2, -3]);
    expect(baseCorner([2, 4, 6], 4)).toEqual([-1, -2, 3]);
  });

  it('every corner belongs to exactly three faces', () => {
    const count = new Array(8).fill(0) as number[];
    for (const k of FACE_KEYS) for (const i of FACE_CORNERS[k]) count[i]!++;
    expect(count).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

describe('shape transforms', () => {
  it('rotation and position are applied to world points (three.js XYZ convention)', () => {
    const s = shape({ position: [10, 0, 0], rotation: [0, 90, 0] });
    const xs = worldPoints(s).map((p) => p[0]);
    // size x=2, z=4: after a 90 degree yaw the long side (z) points along x
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4);
    expect(Math.min(...xs)).toBeCloseTo(8);
  });

  it('degrees <-> quaternion round-trips', () => {
    const deg: [number, number, number] = [30, 45, -20];
    degreesFromQuaternion(quaternionFromDegrees(deg)).forEach((v, i) => expect(v).toBeCloseTo(deg[i]!, 2));
  });

  it('recognizes a plain box mesh and not an edited one', () => {
    expect(isBoxMesh(boxMesh([1, 2, 3]))).toBe(true);
    const moved = boxMesh([1, 1, 1]);
    moved.verts[7]![1] += 0.5; // a third y value: no longer a box
    expect(isBoxMesh(moved)).toBe(false);
  });
});

describe('block geometry', () => {
  it('flat shaded: every face has its own vertices and the normals match the winding', () => {
    const m = boxMesh([2, 1, 3]);
    const g = buildBlockGeometryData(m);
    expect(g.positions.length / 3).toBe(24);
    expect(g.indices.length / 3).toBe(12);
    expect(g.faceOfTriangle.length).toBe(12);
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
      const pa = p(a);
      const pb = p(b);
      const pc = p(c);
      const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const s = [g.normals[a * 3]!, g.normals[a * 3 + 1]!, g.normals[a * 3 + 2]!];
      expect(n[0]! * s[0]! + n[1]! * s[1]! + n[2]! * s[2]!).toBeGreaterThan(0);
    }
  });

  it('a one meter face spans exactly one tile and a longer one repeats it', () => {
    const g = buildBlockGeometryData(boxMesh([3, 1, 1]));
    // the front face (face 0) corners: tile coords run 0..3 along x and 0..1 along y
    const us: number[] = [];
    const vs: number[] = [];
    for (let i = 0; i < 4; i++) {
      us.push(g.tileUvs[i * 2]!);
      vs.push(g.tileUvs[i * 2 + 1]!);
    }
    expect(Math.max(...us)).toBeCloseTo(3);
    expect(Math.min(...us)).toBeCloseTo(0);
    expect(Math.max(...vs)).toBeCloseTo(1);
  });

  it('the texture sticks to the block: moving every vertex keeps the tile coordinates', () => {
    const a = boxMesh([1, 1, 1]);
    const b = boxMesh([1, 1, 1]);
    for (const v of b.verts) {
      v[0] += 10;
      v[1] += 3;
    }
    const ga = buildBlockGeometryData(a);
    const gb = buildBlockGeometryData(b);
    expect(Array.from(gb.tileUvs)).toEqual(Array.from(ga.tileUvs));
  });

  it('triangulates an extruded n-gon face', () => {
    const m = boxMesh([1, 1, 1]);
    m.faces[4]!.v.splice(1, 0, 8); // pretend a fifth corner (index must exist)
    m.verts.push([0, 0.5, 0.5]);
    m.faces[4]!.uv.splice(1, 0, [0, 0]);
    expect(triangulateFace(m, 4)).toHaveLength(3);
  });
});

describe('colliders', () => {
  it('a block turned by a multiple of 90 degrees is still an exact box', () => {
    const b = normalizeObject({ kind: 'block', position: [0, 1, 0], size: [2, 2, 4], rotation: [0, 90, 0] } as never);
    const { boxes, meshes } = buildColliders([b], () => undefined);
    expect(meshes).toHaveLength(0);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.maxX - boxes[0]!.minX).toBeCloseTo(4);
    expect(boxes[0]!.maxZ - boxes[0]!.minZ).toBeCloseTo(2);
  });

  it('a block turned by another angle becomes a triangle mesh instead of its bounding box', () => {
    const b = normalizeObject({ kind: 'block', position: [0, 1, 0], size: [2, 2, 2], rotation: [0, 45, 0] } as never);
    const { boxes, meshes } = buildColliders([b], () => undefined);
    expect(boxes).toHaveLength(0);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.tris.length / 9).toBe(12); // 6 faces, 2 triangles each
    expect(meshes[0]!.max[0] - meshes[0]!.min[0]).toBeCloseTo(2 * Math.SQRT2, 3);
  });

  it('a block with a moved vertex collides as its real shape', () => {
    const b = normalizeObject({ kind: 'block', position: [0, 0, 0], size: [1, 1, 1] } as never);
    if (b.kind !== 'block') throw new Error('expected a block');
    b.mesh.verts[7]![1] += 2;
    const { boxes, meshes } = buildColliders([b], () => undefined);
    expect(boxes).toHaveLength(0);
    expect(meshes[0]!.max[1]).toBeCloseTo(2.5);
  });

  it('blocks that are not solid add nothing', () => {
    const b = normalizeObject({ kind: 'block', collide: false } as never);
    const { boxes, meshes } = buildColliders([b], () => undefined);
    expect(boxes.length + meshes.length).toBe(0);
  });

  it('applies rotation and non-uniform scale to model instances', () => {
    const model = createModel('M', 't.png');
    model.cubes[0] = createCube('c', [0, 0.5, 0], [1, 1, 1]);
    const inst: LevelModelInstance = {
      id: 'i', name: 'i', kind: 'model', modelId: model.id,
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [3, 2, 1], animation: null, animationSpeed: 1, collide: true, rules: [],
    };
    const [a] = modelInstanceColliders(model, inst);
    expect(a!.maxX - a!.minX).toBeCloseTo(3);
    expect(a!.maxY).toBeCloseTo(2);
    const [b] = modelInstanceColliders(model, { ...inst, rotation: [0, 90, 0] });
    expect(b!.maxX - b!.minX).toBeCloseTo(1);
    expect(b!.maxZ - b!.minZ).toBeCloseTo(3);
  });

  it('model bounds include cube rotation and vertex edits', () => {
    const model = createModel('M', 't.png');
    model.cubes[0]!.rotation = [0, 0, 90];
    model.cubes[0]!.mesh = boxMesh([2, 1, 1]);
    const b = modelBounds(model);
    expect(b.max[1] - b.min[1]).toBeCloseTo(2);
  });
});

describe('model geometry with transforms', () => {
  it('keeps winding outward for a rotated, deformed cube', () => {
    const model = createModel('M', 't.png');
    const c = model.cubes[0]!;
    c.rotation = [20, 35, 10];
    c.mesh.verts[3]![0] += 0.2;
    c.mesh.verts[3]![1] += 0.1;
    const g = buildModelGeometryData(model, 32, 32);
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, d] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
      const pa = p(a);
      const pb = p(b);
      const pd = p(d);
      const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const e2 = [pd[0]! - pa[0]!, pd[1]! - pa[1]!, pd[2]! - pa[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const s = [g.normals[a * 3]!, g.normals[a * 3 + 1]!, g.normals[a * 3 + 2]!];
      expect(n[0]! * s[0]! + n[1]! * s[1]! + n[2]! * s[2]!).toBeGreaterThan(0);
    }
  });

  it('maps a raycast triangle back to its cube and face', () => {
    const model = createModel('M', 't.png');
    model.cubes.push(createCube('b', [2, 0.5, 0], [1, 1, 1]));
    const g = buildModelGeometryData(model, 32, 32);
    // first cube: 12 triangles, second: 12 more
    expect(g.triCube[0]).toBe(0);
    expect(g.triCube[12]).toBe(1);
    expect(g.triFace[0]).toBe(0);
    expect(g.triFace[2]).toBe(1);
  });
});

describe('project normalization of old shapes', () => {
  it('upgrades old instances and turns size / offsets into a mesh', () => {
    const p = normalizeProject({
      level: {
        objects: [
          { id: 'a', kind: 'model', modelId: 'm', position: [1, 2, 3], rotationY: 90, scale: 2 },
          {
            id: 'b',
            kind: 'block',
            position: [0, 0, 0],
            size: [2, 4, 6],
            offsets: Array.from({ length: 8 }, (_, i) => (i === 7 ? [0, 1, 0] : [0, 0, 0])),
          },
          { id: 'c', kind: 'block', size: 'bad', offsets: 'bad' },
        ],
      },
    });
    const a = p.levels[0]!.objects[0]!;
    expect(a.kind === 'model' && a.rotation).toEqual([0, 90, 0]);
    expect(a.kind === 'model' && a.scale).toEqual([2, 2, 2]);

    const b = p.levels[0]!.objects[1]!;
    if (b.kind !== 'block') throw new Error('expected a block');
    const { min, max } = meshBounds(b.mesh);
    expect(max[0] - min[0]).toBeCloseTo(2);
    expect(max[2] - min[2]).toBeCloseTo(6);
    expect(max[1]).toBeCloseTo(3); // 2 + the 1 m pull on corner 7
    expect(faceNormal(b.mesh, 0)[2]).toBeGreaterThan(0.9);

    const c = p.levels[0]!.objects[2]!;
    expect(c.kind === 'block' && c.mesh.verts).toHaveLength(8);
  });

  it('keeps a stored mesh and fills in a broken one', () => {
    const good = boxMesh([1, 1, 1]);
    good.verts.push([0, 3, 0]); // extra vertex is fine
    const p = normalizeProject({ level: { objects: [{ kind: 'block', mesh: JSON.parse(JSON.stringify(good)) }, { kind: 'block', mesh: { verts: [], faces: [] } }] } });
    const [a, b] = p.levels[0]!.objects;
    expect(a!.kind === 'block' && a!.mesh.verts).toHaveLength(9);
    expect(b!.kind === 'block' && b!.mesh.verts).toHaveLength(8);
  });

  it('bounds helper', () => {
    expect(pointsBounds([[0, 0, 0], [1, 2, 3]])).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
  });
});
