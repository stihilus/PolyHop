// A "shape" is what level blocks and model cubes have in common: a mesh plus a position and rotation.
// The mesh itself (vertices, faces, edit operations) lives in core/mesh.ts.

import * as THREE from 'three';
import type { MeshData } from './mesh';
import type { Vec3 } from './types';

export { FACE_CORNERS, baseCorner } from './mesh';

export interface Shape {
  /** Origin of the shape in its parent space. */
  position: Vec3;
  /** Euler angles in degrees, XYZ order (same convention as three.js). */
  rotation: Vec3;
  mesh: MeshData;
}

export const MIN_SHAPE_SIZE = 1 / 16;

export function eulerFromDegrees(rotation: Vec3): THREE.Euler {
  const d = Math.PI / 180;
  return new THREE.Euler(rotation[0] * d, rotation[1] * d, rotation[2] * d, 'XYZ');
}

export function quaternionFromDegrees(rotation: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(eulerFromDegrees(rotation));
}

export function degreesFromQuaternion(q: THREE.Quaternion): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r = 180 / Math.PI;
  const clean = (v: number) => Math.round(v * r * 1000) / 1000 + 0; // +0 turns -0 into 0
  return [clean(e.x), clean(e.y), clean(e.z)];
}

/** Mesh vertices in the parent space: position + rotation applied to the local vertex. */
export function worldPoints(shape: Shape): Vec3[] {
  const q = quaternionFromDegrees(shape.rotation);
  const v = new THREE.Vector3();
  return shape.mesh.verts.map((p) => {
    v.set(p[0], p[1], p[2]).applyQuaternion(q);
    return [v.x + shape.position[0], v.y + shape.position[1], v.z + shape.position[2]] as Vec3;
  });
}

export function pointsBounds(points: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  }
  return { min, max };
}

/** True when the mesh is still the plain 8-vertex box. */
export function isBoxMesh(mesh: MeshData): boolean {
  if (mesh.verts.length !== 8 || mesh.faces.length !== 6) return false;
  // axis-aligned: each coordinate takes only two values
  for (let a = 0; a < 3; a++) {
    const vals = new Set(mesh.verts.map((v) => Math.round(v[a]! * 1e5)));
    if (vals.size !== 2) return false;
  }
  return mesh.faces.every((f) => f.v.length === 4);
}
