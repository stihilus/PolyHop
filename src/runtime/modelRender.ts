import * as THREE from 'three';
import { triangulateFace } from '../core/mesh';
import { SMOOTH_ANGLE, faceCornerNormals } from '../core/meshModify';
import { eulerFromDegrees, isBoxMesh, pointsBounds, worldPoints } from '../core/shape';
import type { LevelModelInstance, Model, ModelCube, Vec3 } from '../core/types';
import { uvToRenderCoords } from '../core/uv';
import { type MeshCollider, isAxisAlignedRotation, meshColliderFromTriangles } from './collision';
import { type Box, boxFromPoints } from './physics';
import type { TextureLibrary } from './textures';

// ---------------------------------------------------------------- geometry

export interface ModelGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** For every triangle: which cube and which face of that cube it belongs to. */
  triCube: Uint16Array;
  triFace: Uint16Array;
  /** First vertex of every face, per cube. A face's corners are consecutive vertices. */
  faceStart: number[][];
}

/** Write one cube's face vertices (positions + flat normals) at their buffer offsets. */
function writeCubeVertices(cube: ModelCube, starts: number[], positions: ArrayLike<number> & { [i: number]: number }, normals: { [i: number]: number }): void {
  const pts = worldPoints(cube); // model space: position + rotation applied
  const cornerNormals = faceCornerNormals(cube.mesh, pts, cube.smooth ? SMOOTH_ANGLE : null);
  cube.mesh.faces.forEach((face, fi) => {
    const corners = face.v.map((i) => pts[i]!);
    corners.forEach((p, k) => {
      const o = (starts[fi]! + k) * 3;
      const n = cornerNormals[fi]![k]!;
      positions[o] = p[0];
      positions[o + 1] = p[1];
      positions[o + 2] = p[2];
      normals[o] = n[0];
      normals[o + 1] = n[1];
      normals[o + 2] = n[2];
    });
  });
}

/**
 * Flat-shaded geometry of all cubes. Each face has its own vertices (one per corner, consecutive), so
 * per-corner UVs and per-face updates are simple. UVs come from the faces' texture-pixel UVs.
 */
export function buildModelGeometryData(model: Model, texW: number, texH: number): ModelGeometryData {
  let vertexCount = 0;
  let triCount = 0;
  const faceStart: number[][] = [];
  const tris: number[][][] = [];
  model.cubes.forEach((cube, ci) => {
    const starts: number[] = [];
    const cubeTris: number[][] = [];
    cube.mesh.faces.forEach((face, fi) => {
      starts.push(vertexCount);
      vertexCount += face.v.length;
      const t = triangulateFace(cube.mesh, fi);
      cubeTris.push(...t.map((x) => [fi, ...x]));
      triCount += t.length;
    });
    faceStart.push(starts);
    tris[ci] = cubeTris;
  });

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(triCount * 3);
  const triCube = new Uint16Array(triCount);
  const triFace = new Uint16Array(triCount);

  let ti = 0;
  model.cubes.forEach((cube, ci) => {
    const starts = faceStart[ci]!;
    writeCubeVertices(cube, starts, positions, normals);
    cube.mesh.faces.forEach((face, fi) => {
      const coords = uvToRenderCoords(face.uv, texW, texH);
      for (let k = 0; k < face.v.length; k++) {
        uvs[(starts[fi]! + k) * 2] = coords[k * 2]!;
        uvs[(starts[fi]! + k) * 2 + 1] = coords[k * 2 + 1]!;
      }
    });
    for (const [fi, a, b, c] of tris[ci]!) {
      const s = faceStart[ci]![fi!]!;
      indices[ti * 3] = s + a!;
      indices[ti * 3 + 1] = s + b!;
      indices[ti * 3 + 2] = s + c!;
      triCube[ti] = ci;
      triFace[ti] = fi!;
      ti++;
    }
  });
  return { positions, normals, uvs, indices, triCube, triFace, faceStart };
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function modelBounds(model: Model): Bounds {
  if (model.cubes.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return pointsBounds(model.cubes.flatMap((c) => worldPoints(c)));
}

function rotationElements(deg: Vec3): ArrayLike<number> {
  return new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromEuler(eulerFromDegrees(deg))).elements;
}

/** Vertices of a cube in the level: cube rotation, instance scale, instance rotation, instance position. */
function instanceCubePoints(cube: ModelCube, inst: LevelModelInstance, q: THREE.Quaternion): Vec3[] {
  const v = new THREE.Vector3();
  return worldPoints(cube).map((p) => {
    v.set(p[0] * inst.scale[0], p[1] * inst.scale[1], p[2] * inst.scale[2]).applyQuaternion(q);
    return [v.x + inst.position[0], v.y + inst.position[1], v.z + inst.position[2]] as Vec3;
  });
}

/** A cube that is still an axis-aligned box in the level (a box mesh, turned in steps of 90 degrees only). */
function staysBox(cube: ModelCube, inst: LevelModelInstance): boolean {
  return isBoxMesh(cube.mesh) && isAxisAlignedRotation(rotationElements(cube.rotation)) && isAxisAlignedRotation(rotationElements(inst.rotation));
}

/**
 * Axis-aligned collision boxes of one model instance: one per cube that is still a box lined up with
 * the axes. Other cubes (turned by other angles, or not boxes) are triangles, see `modelInstanceMeshes`.
 */
export function modelInstanceColliders(model: Model, inst: LevelModelInstance): Box[] {
  const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(inst.rotation));
  return model.cubes.filter((c) => staysBox(c, inst)).map((c) => boxFromPoints(instanceCubePoints(c, inst, q)));
}

/** The box around everything a model instance is made of (its trigger area), or null for an empty model. */
export function modelInstanceBounds(model: Model, inst: LevelModelInstance): Box | null {
  if (model.cubes.length === 0) return null;
  const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(inst.rotation));
  return boxFromPoints(model.cubes.flatMap((c) => instanceCubePoints(c, inst, q)));
}

/** Triangle colliders of the cubes of an instance that are not axis-aligned boxes. */
export function modelInstanceMeshes(model: Model, inst: LevelModelInstance): MeshCollider[] {
  const q = new THREE.Quaternion().setFromEuler(eulerFromDegrees(inst.rotation));
  const out: MeshCollider[] = [];
  for (const cube of model.cubes) {
    if (staysBox(cube, inst)) continue;
    const pts = instanceCubePoints(cube, inst, q);
    const tris: number[] = [];
    cube.mesh.faces.forEach((face, fi) => {
      for (const t of triangulateFace(cube.mesh, fi)) {
        for (const k of t) {
          const p = pts[face.v[k!]!]!;
          tris.push(p[0], p[1], p[2]);
        }
      }
    });
    const m = meshColliderFromTriangles(tris);
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- three.js object

/**
 * GPU-side form of a model: one merged geometry sampling the model's (shared) texture. The texture
 * itself belongs to the TextureLibrary, so painting it updates every model and level block using it.
 */
export class ModelRender {
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.MeshLambertMaterial;
  bounds: Bounds;
  readonly texW: number;
  readonly texH: number;
  private data: ModelGeometryData;

  constructor(
    readonly model: Model,
    textures: TextureLibrary,
  ) {
    const info = model.texture ? textures.get(model.texture) : null;
    this.texW = info?.width ?? 1;
    this.texH = info?.height ?? 1;
    this.bounds = modelBounds(model);

    this.data = buildModelGeometryData(model, this.texW, this.texH);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.data.positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.data.normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.data.uvs, 2));
    this.geometry.setIndex(new THREE.BufferAttribute(this.data.indices, 1));
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.material = info
      ? // models are drawn from both sides so planes work; transparent pixels (alpha < 0.5) are cut out
        new THREE.MeshLambertMaterial({ map: info.texture, alphaTest: 0.5, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: '#ff00ff', side: THREE.DoubleSide }); // missing texture
  }

  /** The cube and face a raycast triangle belongs to. */
  faceOfTriangle(triangleIndex: number): { cube: number; face: number } | null {
    const cube = this.data.triCube[triangleIndex];
    const face = this.data.triFace[triangleIndex];
    return cube === undefined || face === undefined ? null : { cube, face };
  }

  /** Re-upload the UVs of one face after the user moved its points (no rebuild needed). */
  updateFaceUv(cubeIndex: number, faceIndex: number): void {
    const cube = this.model.cubes[cubeIndex];
    const face = cube?.mesh.faces[faceIndex];
    const start = this.data.faceStart[cubeIndex]?.[faceIndex];
    if (!face || start === undefined) return;
    const coords = uvToRenderCoords(face.uv, this.texW, this.texH);
    const attr = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < face.v.length; k++) attr.setXY(start + k, coords[k * 2]!, coords[k * 2 + 1]!);
    attr.needsUpdate = true;
  }

  /**
   * Re-upload one cube's positions after it was moved, rotated or its vertices were dragged. Only valid
   * while its faces keep the same corners; after a topology change the render is rebuilt instead.
   */
  updateCubeGeometry(cubeIndex: number): void {
    const cube = this.model.cubes[cubeIndex];
    const starts = this.data.faceStart[cubeIndex];
    if (!cube || !starts) return;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.geometry.getAttribute('normal') as THREE.BufferAttribute;
    writeCubeVertices(cube, starts, pos.array as Float32Array, nor.array as Float32Array);
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    // raycasting culls against these, so they must follow the geometry
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    this.bounds = modelBounds(this.model);
  }

  /**
   * One geometry per bone (key: bone id, '' for parts that belong to no bone). They share this render's
   * vertex data, so UV edits show up in all of them; only the index buffers are their own.
   */
  boneGeometries(): Map<string, THREE.BufferGeometry> {
    const cubeBone = this.model.cubes.map((c) => c.bone ?? '');
    const buckets = new Map<string, number[]>();
    for (let t = 0; t < this.data.triCube.length; t++) {
      const key = cubeBone[this.data.triCube[t]!] ?? '';
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(this.data.indices[t * 3]!, this.data.indices[t * 3 + 1]!, this.data.indices[t * 3 + 2]!);
    }
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [key, indices] of buckets) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', this.geometry.getAttribute('position'));
      g.setAttribute('normal', this.geometry.getAttribute('normal'));
      g.setAttribute('uv', this.geometry.getAttribute('uv'));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      out.set(key, g);
    }
    return out;
  }

  /** Create a mesh that shares this render's geometry and material. */
  createMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.userData.sharedResources = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose(); // the texture is owned by the TextureLibrary
  }
}

/** Builds and caches one ModelRender per model; call `invalidate` after structural edits. */
export class ModelLibrary {
  private renders = new Map<string, ModelRender>();

  constructor(
    private getModel: (id: string) => Model | undefined,
    private textures: TextureLibrary,
  ) {}

  get(modelId: string): ModelRender | null {
    const existing = this.renders.get(modelId);
    if (existing) return existing;
    const model = this.getModel(modelId);
    if (!model) return null;
    const render = new ModelRender(model, this.textures);
    this.renders.set(modelId, render);
    return render;
  }

  invalidate(modelId: string): void {
    this.renders.get(modelId)?.dispose();
    this.renders.delete(modelId);
  }

  clear(): void {
    for (const r of this.renders.values()) r.dispose();
    this.renders.clear();
  }
}
