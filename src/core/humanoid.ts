// The built-in characters: a low-poly humanoid, a male and a female build (a big head without a nose,
// ears and hair as parts of their own, neck, chest, waist, hips, arms with hands, legs with feet) with a
// skeleton and ready animations. Their parts, joints and UV layouts are made by tools/make-humanoid.py
// (humanoid.model.json, humanoid-female.model.json); the skins in assets/textures are drawn for those layouts.
// Both builds have the same bones, so the animations fit both.

import * as THREE from 'three';
import female from './humanoid-female.model.json';
import male from './humanoid.model.json';
import { humanoidClips } from './humanoidClips';
import type { Bone, Model, ModelCube, Vec3 } from './types';

export const HUMANOID_ID = 'humanoid';
export const HUMANOID_FEMALE_ID = 'humanoid-female';
/** The built-in characters, in the order the editor lists them. */
export const HUMANOID_IDS: readonly string[] = [HUMANOID_ID, HUMANOID_FEMALE_ID];
/** Built-in skin atlas (assets/textures) the humanoid is drawn with by default. */
export const HUMANOID_SKIN = 'Character-Skin.png';
/** Skin template: every body part in its own flat color, for painting new skins. */
export const HUMANOID_TEMPLATE = 'Character-Template.png';
/** The explorer skin: a green cap, a red scarf and a tunic. */
export const HUMANOID_EXPLORER = 'Character-Explorer.png';
export const HUMANOID_FEMALE_SKIN = 'Character-Female-Skin.png';
export const HUMANOID_FEMALE_TEMPLATE = 'Character-Female-Template.png';
export const HUMANOID_FEMALE_EXPLORER = 'Character-Female-Explorer.png';
/** The skins made for each build (the first is the build's own default), the way they go with the other build's. */
export const HUMANOID_SKINS: Record<string, string[]> = {
  [HUMANOID_ID]: [HUMANOID_SKIN, HUMANOID_EXPLORER, HUMANOID_TEMPLATE],
  [HUMANOID_FEMALE_ID]: [HUMANOID_FEMALE_SKIN, HUMANOID_FEMALE_EXPLORER, HUMANOID_FEMALE_TEMPLATE],
};

/**
 * The skin to use when the character changes from one build to the other: the same one for the other build
 * when the current skin is one of the built-in ones, else the skin is kept (it is the user's own).
 */
export function skinForBuild(skin: string | null, modelId: string): string | null {
  if (!skin) return null;
  const to = HUMANOID_SKINS[modelId];
  if (!to) return skin;
  for (const [id, list] of Object.entries(HUMANOID_SKINS)) {
    if (id === modelId) continue;
    const at = list.indexOf(skin);
    if (at >= 0) return to[at] ?? null;
  }
  return skin;
}
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

/** A fresh copy of a built-in character (new ids every time except the model's own: `HUMANOID_ID` or `HUMANOID_FEMALE_ID`). */
export function createHumanoidModel(idGen: () => string, id: string = HUMANOID_ID): Model {
  const isFemale = id === HUMANOID_FEMALE_ID;
  const raw = (isFemale ? female : male) as unknown as { bones: RawBone[]; cubes: RawCube[] };
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
  return {
    id: isFemale ? HUMANOID_FEMALE_ID : HUMANOID_ID,
    name: isFemale ? 'Humanoid (female)' : 'Humanoid',
    texture: isFemale ? HUMANOID_FEMALE_SKIN : HUMANOID_SKIN,
    cubes,
    bones,
    clips: humanoidClips(idGen),
  };
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
