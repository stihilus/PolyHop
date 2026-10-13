// The built-in character: a low-poly humanoid (head with ears and a nose, neck, chest, waist, hips, arms
// with hands, legs with feet) with a skeleton and ready animations. Its parts, joints and UV layout are
// made by tools/make-humanoid.py (humanoid.model.json); the skins in assets/textures are drawn for that layout.

import * as THREE from 'three';
import model from './humanoid.model.json';
import { humanoidClips } from './humanoidClips';
import type { Bone, Model, ModelCube, Vec3 } from './types';

export const HUMANOID_ID = 'humanoid';
/** Built-in skin atlas (assets/textures) the humanoid is drawn with by default. */
export const HUMANOID_SKIN = 'Character-Skin.png';
/** Skin template: every body part in its own flat color, for painting new skins. */
export const HUMANOID_TEMPLATE = 'Character-Template.png';
/** The explorer skin made for the demo project. */
export const HUMANOID_EXPLORER = 'Character-Explorer.png';
/** Names the skins of the first versions had; a project that still uses one is given a current skin. */
export const OLD_HUMANOID_SKINS: Record<string, string | null> = {
  'Humanoid-Skin.png': null,
  'Humanoid-Template.png': HUMANOID_TEMPLATE,
  'Humanoid-Hero.png': HUMANOID_EXPLORER,
};
/** The model is made 1 m tall; the game scales it to the player's height. */
export const HUMANOID_HEIGHT = 1;

interface RawBone {
  id: string;
  name: string;
  parent: string | null;
  pivot: number[];
}
interface RawCube {
  id: string;
  name: string;
  position: number[];
  rotation: number[];
  bone: string | null;
  mesh: { verts: number[][]; faces: { v: number[]; uv: number[][] }[] };
}

/** Vertices of a cube in model space (rest pose). */
export function cubeWorldPoints(cube: Pick<ModelCube, 'position' | 'rotation' | 'mesh'>): Vec3[] {
  const d = Math.PI / 180;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cube.rotation[0] * d, cube.rotation[1] * d, cube.rotation[2] * d, 'XYZ'));
  return cube.mesh.verts.map((v) => {
    const p = new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(q);
    return [p.x + cube.position[0], p.y + cube.position[1], p.z + cube.position[2]] as Vec3;
  });
}

/** Middle of the top face, of the bottom face, or of the whole part. */
export function anchorOf(cube: Pick<ModelCube, 'position' | 'rotation' | 'mesh'>, where: 'top' | 'bottom' | 'center'): Vec3 {
  const pts = cubeWorldPoints(cube);
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const eps = (hi - lo) * 0.02 + 1e-6;
  const pick = where === 'top' ? pts.filter((p) => p[1] >= hi - eps) : where === 'bottom' ? pts.filter((p) => p[1] <= lo + eps) : pts;
  const n = pick.length;
  return [pick.reduce((a, p) => a + p[0], 0) / n, pick.reduce((a, p) => a + p[1], 0) / n, pick.reduce((a, p) => a + p[2], 0) / n];
}

/** A fresh copy of the humanoid (new ids every time except the model's own, which is `HUMANOID_ID`). */
export function createHumanoidModel(idGen: () => string): Model {
  const raw = model as unknown as { bones: RawBone[]; cubes: RawCube[] };
  const boneIds = new Map(raw.bones.map((b) => [b.id, idGen()] as const));
  const bones: Bone[] = raw.bones.map((b) => ({
    id: boneIds.get(b.id)!,
    name: b.name,
    parent: b.parent ? (boneIds.get(b.parent) ?? null) : null,
    pivot: [b.pivot[0]!, b.pivot[1]!, b.pivot[2]!] as Vec3,
  }));
  const cubes: ModelCube[] = raw.cubes.map((c) => ({
    id: idGen(),
    name: c.name,
    position: [c.position[0]!, c.position[1]!, c.position[2]!] as Vec3,
    rotation: [c.rotation[0]!, c.rotation[1]!, c.rotation[2]!] as Vec3,
    mesh: {
      verts: c.mesh.verts.map((v) => [v[0]!, v[1]!, v[2]!] as Vec3),
      faces: c.mesh.faces.map((f) => ({ v: [...f.v], uv: f.uv.map((p) => [p[0]!, p[1]!] as [number, number]) })),
    },
    bone: c.bone ? (boneIds.get(c.bone) ?? null) : null,
  }));
  return { id: HUMANOID_ID, name: 'Humanoid', texture: HUMANOID_SKIN, cubes, bones, clips: humanoidClips(idGen) };
}

/**
 * Projects saved before the skin was re-laid-out hold UVs for the old arrangement. Copy the UVs of the
 * current layout onto the saved humanoid's shapes (matched by name), leaving everything else the user
 * may have changed (geometry, bones, animations) alone.
 */
export function refreshHumanoidLayout(saved: Model, fresh: Model): void {
  const byName = new Map(fresh.cubes.map((c) => [c.name, c] as const));
  for (const cube of saved.cubes) {
    const f = byName.get(cube.name);
    if (!f || f.mesh.faces.length !== cube.mesh.faces.length) continue;
    if (!f.mesh.faces.every((face, i) => face.v.length === cube.mesh.faces[i]!.v.length)) continue;
    f.mesh.faces.forEach((face, i) => {
      cube.mesh.faces[i]!.uv = face.uv.map((p) => [p[0], p[1]] as [number, number]);
    });
  }
}
