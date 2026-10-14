import * as THREE from 'three';
import { type FaceTile, type MeshData, faceNormal, meshBounds, planarAxes, triangulateFace } from '../core/mesh';
import { SMOOTH_ANGLE, faceCornerNormals } from '../core/meshModify';
import { isBoxMesh, worldPoints } from '../core/shape';
import { isTiled, modelLook } from '../core/components';
import type { LevelBlock, LevelModelInstance, LevelObject, Model, Vec3 } from '../core/types';
import type { Action } from '../core/logic';
import { sampleClip } from '../core/rig';
import { type Colliders, type MeshCollider, chunkedColliders, isAxisAlignedRotation } from './collision';
import { type ModelLibrary, type ModelRender, modelInstanceBounds, modelInstanceColliders, modelInstanceMeshes } from './modelRender';
import { type UvRect, tileUvRect, tiledMaterial } from './tileMaterial';

export type { UvRect };
import { type Box, boxFromPoints } from './physics';
import { RigRender } from './rigRender';
import type { TextureLibrary } from './textures';

/** How many meters one texture tile covers on a block face. */
export const TILE_WORLD_SIZE = 1;

/** A run of triangles that share one material: the block's own tile (`tile` null) or a painted face tile. */
export interface BlockGroup {
  /** First index in the index buffer, and how many. */
  start: number;
  count: number;
  tile: FaceTile | null;
}

export interface BlockGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  /** Face-local planar coordinates in tiles (0..n); the shader wraps them into the tile rectangle. */
  tileUvs: Float32Array;
  indices: Uint32Array;
  /** For every triangle, the index of the mesh face it belongs to. */
  faceOfTriangle: Uint16Array;
  /** Triangles sorted by tile: the first group is the block's own tile (when any face uses it). */
  groups: BlockGroup[];
}

const tileKey = (t: FaceTile | undefined) => (t ? `${t.texture}|${t.col}|${t.row}` : '');

/**
 * Flat-shaded geometry of a block mesh. Each face gets its own vertices. Texture coordinates come from
 * a planar projection along the face's dominant normal axis, measured from the face's own minimum, so
 * a one-meter face always shows exactly one tile and the texture follows the block when it moves.
 */
export function buildBlockGeometryData(mesh: MeshData, smooth = false): BlockGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const tileUvs: number[] = [];
  const faceVertexStart: number[] = [];
  const cornerNormals = faceCornerNormals(mesh, mesh.verts, smooth ? SMOOTH_ANGLE : null);

  mesh.faces.forEach((face, fi) => {
    const n = faceNormal(mesh, fi);
    const { u, v } = planarAxes(n);
    const pts = face.v.map((i) => mesh.verts[i]!);
    const uc = pts.map((p) => p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
    const vc = pts.map((p) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
    const minU = Math.min(...uc);
    const minV = Math.min(...vc);
    const rot = face.tile?.rot ?? 0;
    const flip = face.tile?.flip === true;

    faceVertexStart.push(positions.length / 3);
    pts.forEach((p, k) => {
      positions.push(p[0], p[1], p[2]);
      const cn = cornerNormals[fi]![k]!;
      normals.push(cn[0], cn[1], cn[2]);
      let a = (uc[k]! - minU) / TILE_WORLD_SIZE;
      let b = (vc[k]! - minV) / TILE_WORLD_SIZE;
      if (flip) a = -a;
      // quarter turns of the picture; negative values are fine, the shader only keeps the fraction
      for (let r = 0; r < rot; r++) [a, b] = [-b, a];
      tileUvs.push(a, b);
    });
  });

  // faces that share a tile are drawn with one material; the block's own tile comes first
  const keys: string[] = [''];
  const tiles = new Map<string, FaceTile | null>([['', null]]);
  mesh.faces.forEach((face) => {
    const key = tileKey(face.tile);
    if (!tiles.has(key)) {
      tiles.set(key, face.tile ?? null);
      keys.push(key);
    }
  });

  const indices: number[] = [];
  const faceOfTriangle: number[] = [];
  const groups: BlockGroup[] = [];
  for (const key of keys) {
    const start = indices.length;
    mesh.faces.forEach((face, fi) => {
      if (tileKey(face.tile) !== key) return;
      const base = faceVertexStart[fi]!;
      for (const [a, b, c] of triangulateFace(mesh, fi)) {
        indices.push(base + a!, base + b!, base + c!);
        faceOfTriangle.push(fi);
      }
    });
    if (indices.length > start) groups.push({ start, count: indices.length - start, tile: tiles.get(key) ?? null });
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    tileUvs: new Float32Array(tileUvs),
    indices: new Uint32Array(indices),
    faceOfTriangle: new Uint16Array(faceOfTriangle),
    groups,
  };
}

const DEG = Math.PI / 180;

/** A small stable number from an id, used to desynchronise animated instances. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Two '#rrggbb' colors multiplied channel by channel (an instance's tint on top of the look of its model). */
export function multiplyColors(a: string, b: string | undefined): string {
  if (!b || b.toLowerCase() === '#ffffff') return a;
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round((channel(a, i) * channel(b, i)) / 255));
  return `#${out.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * An instance of a tile-mapped model drawn as a block: all its shapes merged into one mesh in model space, with the
 * scale of the instance applied to the points (so the tile keeps its size when the instance is made bigger).
 */
export function instanceAsBlock(o: LevelModelInstance, model: Model): LevelBlock {
  const look = modelLook(model);
  const verts: Vec3[] = [];
  const faces: MeshData['faces'] = [];
  for (const cube of model.cubes) {
    const base = verts.length;
    for (const p of worldPoints(cube)) verts.push([p[0] * o.scale[0], p[1] * o.scale[1], p[2] * o.scale[2]]);
    for (const f of cube.mesh.faces) faces.push({ ...f, v: f.v.map((i) => i + base) });
  }
  return {
    id: o.id,
    name: o.name,
    kind: 'block',
    position: o.position,
    rotation: o.rotation,
    mesh: { verts, faces },
    tile: look.tile && model.texture ? { texture: model.texture, col: look.tile.col, row: look.tile.row } : null,
    color: multiplyColors(look.tint, o.tint),
    doubleSided: look.doubleSided,
    ...(model.cubes.some((c) => c.smooth) ? { smooth: true } : {}),
    ...(look.opacity !== undefined ? { opacity: look.opacity } : {}),
    ...(look.liquid ? { liquid: true } : {}),
    collide: o.collide,
    rules: o.rules,
  };
}

/** The Three.js representation of a level: blocks (tiled meshes) and placed model instances. */
/** Ids of the objects that something can change while the game runs: they have rules, or rules point at them. */
export function dynamicObjectIds(objects: LevelObject[]): Set<string> {
  const ids = new Set<string>();
  const visit = (owner: string, actions: Action[]) => {
    for (const a of actions) {
      if ('target' in a) ids.add(a.target || owner);
      if (a.type === 'choice') for (const o of a.options) visit(owner, o.actions);
    }
  };
  for (const o of objects) {
    if (o.rules.length === 0) continue;
    ids.add(o.id);
    for (const r of o.rules) visit(o.id, r.actions);
  }
  return ids;
}

/** Side of the squares the batches are cut into, so the view can still skip what is off screen. */
const BATCH_CELL = 32;

export class Level {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  /** Merged blocks and instanced models of a running game (not individually addressable). */
  private batches: THREE.Object3D[] = [];
  /** Copies of model materials made for tinted instances of a running game. */
  private tinted: THREE.Material[] = [];
  /** Offsets of the flowing materials (water), moved a little every frame. */
  private flows: THREE.Vector2[] = [];
  /** Material of the still mesh that stands in for an animated model (picking and bounds only). */
  private proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });

  constructor(
    private textures: TextureLibrary,
    private models: ModelLibrary,
  ) {
    this.group.name = 'Level';
  }

  /**
   * Build the scene of a list of objects. With `batch` (a running game) blocks that nothing changes at run
   * time are merged into a few big meshes and still model instances are drawn instanced, which cuts the
   * draw calls of a big level from hundreds to a handful. The editor never batches: it needs every object.
   */
  rebuild(objects: LevelObject[], batch = false): void {
    for (const id of [...this.meshes.keys()]) this.remove(id);
    this.clearBatches();
    this.flows = [];
    if (!batch) {
      for (const o of objects) this.upsert(o);
      return;
    }
    const dynamic = dynamicObjectIds(objects);
    const statics: LevelObject[] = [];
    for (const o of objects) {
      if (dynamic.has(o.id) || !this.canBatch(o)) this.upsert(o);
      else statics.push(o);
    }
    this.buildBatches(statics);
  }

  private canBatch(o: LevelObject): boolean {
    if (o.kind === 'block') return !o.liquid && !o.terrain;
    // a model that plays an animation, or one that is missing, stays on its own (so does a body of water)
    const render = this.models.get(o.modelId);
    return !o.animation && render !== null && !(isTiled(render.model) && modelLook(render.model).liquid);
  }

  /** The material of a model drawn in another color: a copy of its own (kept to be disposed with the level). */
  private tintedMaterial(render: ModelRender, tint: string): THREE.Material {
    const m = render.material.clone();
    m.color.set(multiplyColors(`#${render.material.color.getHexString()}`, tint));
    this.tinted.push(m);
    return m;
  }

  private clearBatches(): void {
    for (const m of this.tinted) m.dispose();
    this.tinted = [];
    for (const b of this.batches) {
      this.group.remove(b);
      const mesh = b as THREE.Mesh;
      if (!mesh.userData.sharedResources) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
      }
    }
    this.batches = [];
  }

  private buildBatches(objects: LevelObject[]): void {
    interface Bucket {
      key: string;
      pos: number[];
      nor: number[];
      uv: number[];
      idx: number[];
      tile: { texture: string; col: number; row: number } | null;
      color: string;
      side: THREE.Side;
      opacity: number;
      cast: boolean;
    }
    const buckets = new Map<string, Bucket>();
    const instances = new Map<string, { render: ModelRender; matrices: THREE.Matrix4[]; tint?: string }>();
    const m4 = new THREE.Matrix4();
    const rotation = new THREE.Matrix3();
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const cell = (x: number, z: number) => `${Math.floor(x / BATCH_CELL)}:${Math.floor(z / BATCH_CELL)}`;

    for (const source of objects) {
      // an instance of a tile-mapped model is drawn like a block
      let o: LevelObject = source;
      if (source.kind === 'model') {
        const render = this.models.get(source.modelId);
        if (render && isTiled(render.model)) o = instanceAsBlock(source, render.model);
      }
      if (o.kind === 'model') {
        const render = this.models.get(o.modelId);
        if (!render) continue;
        const key = `${o.modelId}|${o.tint ?? ''}|${cell(o.position[0], o.position[2])}`;
        let entry = instances.get(key);
        if (!entry) instances.set(key, (entry = { render, matrices: [], tint: o.tint }));
        m4.compose(
          v.set(o.position[0], o.position[1], o.position[2]),
          q.setFromEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, 'XYZ')),
          new THREE.Vector3(o.scale[0], o.scale[1], o.scale[2]),
        );
        entry.matrices.push(m4.clone());
        continue;
      }

      // a block: its triangles go into the bucket of their material, placed in the world
      const data = buildBlockGeometryData(o.mesh, o.smooth === true);
      const b = meshBounds(o.mesh);
      const thin = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) < 0.06;
      const opacity = o.opacity ?? 1;
      const cast = !thin && opacity >= 1;
      m4.makeRotationFromEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, 'XYZ'));
      rotation.setFromMatrix4(m4);
      const place = cell(o.position[0], o.position[2]);
      for (const g of data.groups) {
        const tile = g.tile ?? o.tile;
        const key = `${place}|${tile ? `${tile.texture}:${tile.col}:${tile.row}` : '-'}|${o.color}|${o.doubleSided}|${opacity}|${cast}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = {
            key,
            pos: [],
            nor: [],
            uv: [],
            idx: [],
            tile: tile ? { texture: tile.texture, col: tile.col, row: tile.row } : null,
            color: o.color,
            side: o.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            opacity,
            cast,
          };
          buckets.set(key, bucket);
        }
        const remap = new Map<number, number>();
        for (let i = g.start; i < g.start + g.count; i++) {
          const old = data.indices[i]!;
          let at = remap.get(old);
          if (at === undefined) {
            at = bucket.pos.length / 3;
            remap.set(old, at);
            v.set(data.positions[old * 3]!, data.positions[old * 3 + 1]!, data.positions[old * 3 + 2]!).applyMatrix3(rotation);
            bucket.pos.push(v.x + o.position[0], v.y + o.position[1], v.z + o.position[2]);
            v.set(data.normals[old * 3]!, data.normals[old * 3 + 1]!, data.normals[old * 3 + 2]!).applyMatrix3(rotation);
            bucket.nor.push(v.x, v.y, v.z);
            bucket.uv.push(data.tileUvs[old * 2]!, data.tileUvs[old * 2 + 1]!);
          }
          bucket.idx.push(at);
        }
      }
    }

    for (const bucket of buckets.values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bucket.pos), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bucket.nor), 3));
      geo.setAttribute('aTileUv', new THREE.BufferAttribute(new Float32Array(bucket.uv), 2));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(bucket.idx), 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const color = new THREE.Color(bucket.color);
      const info = bucket.tile ? this.textures.get(bucket.tile.texture) : null;
      let material: THREE.Material;
      if (bucket.tile && info) {
        material = tiledMaterial(
          info.texture,
          tileUvRect(bucket.tile.col, bucket.tile.row, info.tileSize, info.width, info.height),
          color,
          bucket.side,
          bucket.opacity,
        );
      } else {
        const plain = new THREE.MeshLambertMaterial({ color, side: bucket.side });
        if (bucket.opacity < 1) {
          plain.transparent = true;
          plain.opacity = bucket.opacity;
          plain.depthWrite = false;
        }
        material = plain;
      }
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = true;
      if (bucket.opacity < 1) mesh.renderOrder = 2;
      mesh.name = 'Batch';
      this.group.add(mesh);
      this.batches.push(mesh);
    }

    for (const { render, matrices, tint } of instances.values()) {
      const material = tint ? this.tintedMaterial(render, tint) : render.material;
      const inst = new THREE.InstancedMesh(render.geometry, material, matrices.length);
      matrices.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.userData.sharedResources = true; // the geometry and material belong to the model
      inst.name = 'Instances';
      inst.computeBoundingSphere();
      this.group.add(inst);
      this.batches.push(inst);
    }
  }

  upsert(obj: LevelObject): void {
    this.remove(obj.id);
    let mesh: THREE.Mesh;
    const render = obj.kind === 'model' ? this.models.get(obj.modelId) : null;
    if (obj.kind === 'block') {
      mesh = this.buildBlock(obj);
    } else if (render && isTiled(render.model)) {
      // a tile-mapped model is drawn like a block, with the scale of the instance in its points
      mesh = this.buildBlock(instanceAsBlock(obj, render.model));
      mesh.userData.bakedScale = obj.scale.join(',');
    } else {
      mesh = this.buildModel(obj);
    }
    mesh.name = obj.name;
    mesh.userData.objectId = obj.id;
    this.meshes.set(obj.id, mesh);
    this.group.add(mesh);
    this.syncTransform(obj);
  }

  /** Cheap update for move / rotate / scale (no rebuild). */
  syncTransform(obj: LevelObject): void {
    const mesh = this.meshes.get(obj.id);
    if (!mesh) return;
    mesh.position.set(obj.position[0], obj.position[1], obj.position[2]);
    mesh.rotation.set(obj.rotation[0] * DEG, obj.rotation[1] * DEG, obj.rotation[2] * DEG, 'XYZ');
    if (obj.kind !== 'model') return;
    const baked = mesh.userData.bakedScale as string | undefined;
    if (baked === undefined) mesh.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    else if (baked !== obj.scale.join(',')) this.upsert(obj); // the points carry the scale: draw it again
  }

  private buildBlock(obj: LevelBlock): THREE.Mesh {
    const data = buildBlockGeometryData(obj.mesh, obj.smooth === true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('aTileUv', new THREE.BufferAttribute(data.tileUvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    geo.userData.faceOfTriangle = data.faceOfTriangle;

    const color = new THREE.Color(obj.color);
    const side = obj.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    const opacity = obj.opacity ?? 1;
    // water flows slowly across its surface
    const scroll = obj.liquid ? new THREE.Vector2(0, 0) : undefined;
    if (scroll) this.flows.push(scroll);
    const materialFor = (tile: { texture: string; col: number; row: number } | null): THREE.Material => {
      const info = tile ? this.textures.get(tile.texture) : null;
      if (tile && info) {
        return tiledMaterial(info.texture, tileUvRect(tile.col, tile.row, info.tileSize, info.width, info.height), color, side, opacity, scroll);
      }
      const plain = new THREE.MeshLambertMaterial({ color, side });
      if (opacity < 1) {
        plain.transparent = true;
        plain.opacity = opacity;
        plain.depthWrite = false;
      }
      return plain;
    };

    // thin things (planes of grass, leaves) cast no shadow: their cut-out pixels would show as solid
    const b = meshBounds(obj.mesh);
    const thin = Math.min(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) < 0.06;
    const finish = (mesh: THREE.Mesh) => {
      mesh.castShadow = !thin && opacity >= 1 && !obj.liquid;
      mesh.receiveShadow = true;
      if (opacity < 1) mesh.renderOrder = 2;
      return mesh;
    };

    // one material when every face uses the block's tile, else one per tile with a draw group each
    const painted = data.groups.some((g) => g.tile !== null);
    if (!painted) return finish(new THREE.Mesh(geo, materialFor(obj.tile)));
    const materials = data.groups.map((g) => materialFor(g.tile ?? obj.tile));
    data.groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
    return finish(new THREE.Mesh(geo, materials));
  }

  private buildModel(obj: LevelModelInstance): THREE.Mesh {
    const render = this.models.get(obj.modelId);
    if (render) {
      const mesh = render.createMesh();
      if (obj.tint) {
        const own = this.tintedMaterial(render, obj.tint);
        mesh.material = own;
        mesh.userData.ownMaterial = own;
      }
      // an animated instance: the still mesh stays as an invisible stand-in for picking, and the
      // posed rig is its child, so it moves, turns and scales with the instance
      if (obj.animation && render.model.bones.length > 0 && render.model.clips.some((c) => c.name === obj.animation)) {
        mesh.material = this.proxyMaterial;
        const rig = new RigRender(render, render.material);
        mesh.add(rig.root);
        mesh.userData.rig = rig;
        mesh.userData.render = render;
        mesh.userData.animation = obj.animation;
        mesh.userData.speed = obj.animationSpeed;
        // instances of one model should not move in lockstep
        mesh.userData.time = (hashId(obj.id) % 1000) / 1000;
      }
      return mesh;
    }
    // missing model: show a magenta wireframe cube so the problem is visible
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ff00ff', wireframe: true }),
    );
    mesh.geometry.translate(0, 0.5, 0);
    return mesh;
  }

  remove(id: string): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.group.remove(mesh);
    (mesh.userData.rig as RigRender | undefined)?.dispose();
    (mesh.userData.ownMaterial as THREE.Material | undefined)?.dispose();
    if (!mesh.userData.sharedResources) {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
    }
    this.meshes.delete(id);
  }

  /** Advance the animated instances (looping clips, looked up by name every frame so edits apply). */
  animate(dt: number): void {
    for (const f of this.flows) {
      f.x = (f.x + dt * 0.06) % 1;
      f.y = (f.y + dt * 0.035) % 1;
    }
    for (const mesh of this.meshes.values()) {
      const rig = mesh.userData.rig as RigRender | undefined;
      if (!rig) continue;
      const render = mesh.userData.render as ModelRender;
      const clip = render.model.clips.find((c) => c.name === mesh.userData.animation);
      if (!clip) continue;
      mesh.userData.time = (mesh.userData.time as number) + dt * (mesh.userData.speed as number);
      rig.pose(sampleClip(clip, mesh.userData.time as number));
    }
  }

  getMesh(id: string): THREE.Mesh | undefined {
    return this.meshes.get(id);
  }

  meshList(): THREE.Mesh[] {
    return [...this.meshes.values()];
  }
}

/**
 * Everything solid in the level. Blocks and cubes that are plain boxes lined up with the axes become
 * exact boxes; slopes, rotated and irregular shapes become triangle meshes the player slides over.
 */
export function buildColliders(objects: LevelObject[], getModel: (id: string) => Model | undefined): Colliders {
  const boxes: Box[] = [];
  const meshes: MeshCollider[] = [];
  const liquids: Box[] = [];
  for (const o of objects) {
    if (o.kind === 'block' && o.liquid) liquids.push(boxFromPoints(worldPoints(o)));
    if (o.kind === 'model') {
      // a body of water that is a component
      const m = getModel(o.modelId);
      if (m && isTiled(m) && modelLook(m).liquid) {
        const b = modelInstanceBounds(m, o);
        if (b) liquids.push(b);
      }
    }
    if (!o.collide) continue;
    if (o.kind === 'block') {
      const pts = worldPoints(o);
      const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(o.rotation[0] * DEG, o.rotation[1] * DEG, o.rotation[2] * DEG, 'XYZ'));
      if (isBoxMesh(o.mesh) && isAxisAlignedRotation(rot.elements)) {
        boxes.push(boxFromPoints(pts));
        continue;
      }
      const tris: number[] = [];
      o.mesh.faces.forEach((face, fi) => {
        for (const t of triangulateFace(o.mesh, fi)) {
          for (const k of t) {
            const p = pts[face.v[k!]!]!;
            tris.push(p[0], p[1], p[2]);
          }
        }
      });
      // a big mesh (terrain) is cut into chunks so only the ones near the player are tested
      meshes.push(...chunkedColliders(tris));
    } else {
      const model = getModel(o.modelId);
      if (!model) continue;
      boxes.push(...modelInstanceColliders(model, o));
      meshes.push(...modelInstanceMeshes(model, o));
    }
  }
  return { boxes, meshes, liquids };
}

/** Only the box colliders (kept for callers that do not care about slopes). */
export function collidersFrom(objects: LevelObject[], getModel: (id: string) => Model | undefined): Box[] {
  return buildColliders(objects, getModel).boxes;
}
