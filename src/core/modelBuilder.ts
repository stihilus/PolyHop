// A small builder for the models that ship with the editor (props, building kit, trees): boxes and ready-made
// meshes textured with the tiles of one atlas, grouped into bones and animations. The built-in models are made
// of cubes and quads only (see hytaleStyle.ts): round things are made of turned cubes, with `round`, `clump`
// and `ringOf` below, never of cylinders, spheres or wedges.

import { type FaceKey, type MeshData, boxMesh, mulberry32, prismMesh } from './mesh';
import { SMOOTH_ANGLE } from './meshModify';
import type { AnimationClip, Bone, Model, ModelCube, Vec3 } from './types';
import { type UVPoly, rectUv } from './uv';

export type Idgen = () => string;
export type TileRect = { x: number; y: number; w: number; h: number };

/** What a box shows on its faces: one tile for all, or tiles for the sides, top, bottom and front. */
export type Look<T extends string> = T | { all?: T; side?: T; top?: T; bottom?: T; front?: T };

export class ModelBuilder<T extends string> {
  cubes: ModelCube[] = [];
  bones: Bone[] = [];
  clips: AnimationClip[] = [];

  /** `rectOf` says where a named tile is in the atlas (in pixels). */
  constructor(
    private idGen: Idgen,
    private rectOf: (tile: T) => TileRect,
    private fallback: T,
  ) {}

  private add(name: string, center: Vec3, mesh: MeshData, rot: Vec3, bone: string | null): ModelCube {
    const cube: ModelCube = { id: this.idGen(), name, position: center, rotation: rot, mesh, bone };
    this.cubes.push(cube);
    return cube;
  }

  /** A box centered on `center`. */
  box(name: string, center: Vec3, size: Vec3, look: Look<T>, rot: Vec3 = [0, 0, 0], bone: string | null = null): ModelCube {
    let base: T;
    const uv: Partial<Record<FaceKey, UVPoly>> = {};
    const set = (keys: FaceKey[], tile: T | undefined) => {
      if (!tile) return;
      const r = this.rectOf(tile);
      for (const k of keys) uv[k] = rectUv(r.x, r.y, r.w, r.h);
    };
    if (typeof look === 'string') {
      base = look;
    } else {
      base = look.all ?? look.side ?? look.top ?? this.fallback;
      set(['pz', 'nz', 'px', 'nx'], look.side);
      set(['pz'], look.front);
      set(['py'], look.top);
      set(['ny'], look.bottom);
    }
    return this.add(name, center, boxMesh(size, null, uv, this.rectOf(base)), rot, bone);
  }

  /**
   * A column that reads as round, made of two cubes: one square and one turned 45 degrees, so the outline from
   * above is an eight-pointed shape (a barrel, a tower, a trunk, a log's end). Both are cubes.
   */
  round(name: string, center: Vec3, size: Vec3, look: Look<T>, bone: string | null = null, turned = 0.9): void {
    this.box(name, center, size, look, [0, 0, 0], bone);
    // a little lower at the top so the two tops do not fight over the same pixels
    this.box(`${name} turned`, [center[0], center[1] - 0.005, center[2]], [size[0] * turned, size[1] - 0.01, size[2] * turned], look, [0, 45, 0], bone);
  }

  /**
   * A clump of cubes at slightly different angles: foliage, a rock, a bush. The first is the core, the others sit
   * around it, smaller and turned about. Always the same for the same `seed`.
   */
  clump(name: string, center: Vec3, size: Vec3, look: Look<T>, seed = 1, pieces = 3, bone: string | null = null): void {
    const rnd = mulberry32(seed * 7919 + 13);
    this.box(name, center, size, look, [0, Math.round(rnd() * 50 - 25), 0], bone);
    for (let i = 1; i < pieces; i++) {
      const k = 0.55 + rnd() * 0.25;
      const at: Vec3 = [
        center[0] + (rnd() - 0.5) * size[0] * 0.75,
        center[1] + (rnd() - 0.3) * size[1] * 0.45,
        center[2] + (rnd() - 0.5) * size[2] * 0.75,
      ];
      const turn: Vec3 = [Math.round((rnd() - 0.5) * 30), Math.round(rnd() * 70 - 35), Math.round((rnd() - 0.5) * 30)];
      this.box(`${name} ${i + 1}`, at, [size[0] * k, size[1] * (k + 0.1), size[2] * k], look, turn, bone);
    }
  }

  /** `count` cubes standing in a ring (in the plane of the XY axes when `upright`, else on the ground). */
  ringOf(name: string, center: Vec3, radius: number, count: number, size: Vec3, look: Look<T>, upright = false, bone: string | null = null): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const deg = (a * 180) / Math.PI;
      const at: Vec3 = upright
        ? [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius, center[2]]
        : [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius];
      this.box(`${name} ${i + 1}`, at, size, look, upright ? [0, 0, deg] : [0, -deg, 0], bone);
    }
  }

  /** A prism with `sides` sides standing on its center; the caps get their own tile. (Not used by the built-in models.) */
  prism(name: string, center: Vec3, sides: number, radius: number, height: number, side: T, cap: T, bone: string | null = null): ModelCube {
    const mesh = prismMesh(sides, radius, height, this.rectOf(side));
    this.spreadCaps(mesh, radius, cap);
    return this.add(name, center, mesh, [0, 0, 0], bone);
  }

  /** The two cap faces of a prism or cylinder (faces 0 and 1) show `cap` spread over the circle's square. */
  spreadCaps(mesh: MeshData, radius: number, cap: T, faces: number[] = [0, 1]): void {
    const r = this.rectOf(cap);
    for (const fi of faces) {
      const face = mesh.faces[fi];
      if (!face) continue;
      face.uv = face.v.map((vi) => {
        const p = mesh.verts[vi]!;
        return [r.x + ((p[0] / radius + 1) / 2) * r.w, r.y + ((p[2] / radius + 1) / 2) * r.h] as [number, number];
      });
    }
  }

  /** Any mesh (a rock, crossing planes, a stairs). `smooth` shades it as one round surface. */
  mesh(name: string, center: Vec3, mesh: MeshData, rot: Vec3 = [0, 0, 0], bone: string | null = null, smooth = false): ModelCube {
    const cube = this.add(name, center, mesh, rot, bone);
    if (smooth) cube.smooth = true;
    return cube;
  }

  /** Atlas rectangle of a named tile (for the generators that take one). */
  rect(tile: T): TileRect {
    return this.rectOf(tile);
  }

  bone(name: string, pivot: Vec3, parent: string | null = null): string {
    const id = this.idGen();
    this.bones.push({ id, name, parent, pivot });
    return id;
  }

  clip(name: string, duration: number, loop: boolean, tracks: AnimationClip['tracks']): void {
    this.clips.push({ id: this.idGen(), name, duration, loop, smooth: true, tracks });
  }

  toModel(id: string, name: string, texture: string): Model {
    return { id, name, texture, cubes: this.cubes, bones: this.bones, clips: this.clips };
  }
}

export { SMOOTH_ANGLE };
