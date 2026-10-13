import * as THREE from 'three';
import { type Pose, boneMatrices, orderedBones } from '../core/rig';
import type { Bone } from '../core/types';
import type { ModelRender } from './modelRender';

/**
 * A rigged model on screen: one group per bone holding that bone's meshes (they share the model's
 * vertex data and one material). Posing sets every group's matrix; things attached to a bone are
 * simply children of its group, so they follow the animation.
 */
export class RigRender {
  readonly root = new THREE.Group();
  readonly bones: Bone[];
  private ordered: Bone[];
  private groups = new Map<string, THREE.Group>();
  private byName = new Map<string, Bone>();
  private matrices = new Map<string, THREE.Matrix4>();
  private geometries: THREE.BufferGeometry[] = [];

  constructor(
    readonly render: ModelRender,
    material: THREE.Material,
  ) {
    this.bones = render.model.bones;
    this.ordered = orderedBones(this.bones);
    for (const b of this.bones) this.byName.set(b.name, b);

    const geos = render.boneGeometries();
    const add = (id: string, key: string) => {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      this.groups.set(id, group);
      this.root.add(group);
      const geo = geos.get(key);
      if (geo) {
        this.geometries.push(geo);
        const mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = false; // posed bones leave their rest-pose bounds
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.sharedResources = true;
        mesh.userData.boneId = id;
        group.add(mesh);
      }
    };
    for (const b of this.bones) add(b.id, b.id);
    add('', ''); // parts without a bone never move
    this.pose(new Map());
  }

  has(boneName: string): boolean {
    return this.byName.has(boneName);
  }

  /** Apply a pose (bone name -> offset from rest). Bones missing from it stay at rest. */
  pose(pose: Pose): void {
    boneMatrices(this.ordered, pose, this.matrices);
    for (const b of this.bones) {
      const g = this.groups.get(b.id);
      const m = this.matrices.get(b.id);
      if (g && m) {
        g.matrix.copy(m);
        g.matrixWorldNeedsUpdate = true;
      }
    }
  }

  /** Name of the bone a picked mesh belongs to, or null (parts without a bone). */
  boneNameOf(object: THREE.Object3D): string | null {
    const id = object.userData.boneId as string | undefined;
    return this.bones.find((b) => b.id === id)?.name ?? null;
  }

  /** Where the pivot of a bone is right now (model space), given the pose last applied. */
  pivotNow(boneName: string): THREE.Vector3 | null {
    const b = this.byName.get(boneName);
    const m = b ? this.matrices.get(b.id) : undefined;
    return b && m ? new THREE.Vector3(b.pivot[0], b.pivot[1], b.pivot[2]).applyMatrix4(m) : null;
  }

  /** The matrix a bone's parts are carried by right now (model space). */
  matrixOf(boneName: string): THREE.Matrix4 | null {
    const b = this.byName.get(boneName);
    return (b ? this.matrices.get(b.id) : undefined) ?? null;
  }

  /** The group of a bone, where attachments go. */
  groupOf(boneName: string): THREE.Group | null {
    const b = this.byName.get(boneName);
    return b ? (this.groups.get(b.id) ?? null) : null;
  }

  /** Rest-pose pivot of a bone in model space. */
  pivotOf(boneName: string): [number, number, number] | null {
    return this.byName.get(boneName)?.pivot ?? null;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
  }
}
