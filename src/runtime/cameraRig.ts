import * as THREE from 'three';
import type { PlayerSettings, Vec3 } from '../core/types';
import { type MeshCollider, raycastMeshes } from './collision';
import { type Box, raycastBoxes } from './physics';

const MIN_PITCH = -0.4;
const MAX_PITCH = 1.35;
export const MOUSE_RAD_PER_PIXEL = 0.0025;
/** How quickly the chase camera swings behind the player (1/s). Higher = stiffer. */
const CHASE_RATE = 9;
const WALL_MARGIN = 0.25;
const MIN_DISTANCE = 0.6;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Third-person camera that follows the player and pulls in when geometry is in the way. In `chase`
 * mode it always settles behind the player's back and turns with them; in `free` mode the mouse or
 * the right stick orbits it.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.4;
  private distance = 6;
  private focusY = 0;
  private initialized = false;

  /** Place the camera behind a given facing direction. */
  reset(facing: number): void {
    this.yaw = facing + Math.PI;
    this.pitch = 0.4;
    this.initialized = false;
  }

  /** Mouse / stick look. Yaw is only applied when `orbit` is on (free camera); pitch always. */
  look(dx: number, dy: number, sensitivity: number, invertY: boolean, orbit: boolean): void {
    if (orbit) this.yaw -= dx * MOUSE_RAD_PER_PIXEL * sensitivity;
    this.pitch += dy * MOUSE_RAD_PER_PIXEL * sensitivity * (invertY ? -1 : 1);
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch));
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    feet: Vec3,
    facing: number,
    bodyHeight: number,
    s: PlayerSettings,
    boxes: Box[],
    meshes: MeshCollider[] = [],
  ): void {
    if (s.cameraMode === 'chase') {
      // swing around to the player's back (shortest way round, eased)
      const diff = wrapAngle(facing + Math.PI - this.yaw);
      this.yaw = wrapAngle(this.yaw + diff * (1 - Math.exp(-CHASE_RATE * dt)));
    }
    const targetY = feet[1] + bodyHeight * 0.5 + s.cameraHeight;
    if (!this.initialized) {
      this.focusY = targetY;
      this.distance = s.cameraDistance;
      this.initialized = true;
    }
    // follow vertical movement with a little lag so jumps feel less jittery
    this.focusY += (targetY - this.focusY) * (1 - Math.exp(-10 * dt));

    const focus: Vec3 = [feet[0], this.focusY, feet[2]];
    const cp = Math.cos(this.pitch);
    const dir: Vec3 = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp];

    let wanted = s.cameraDistance;
    const boxHit = raycastBoxes(focus, dir, s.cameraDistance + WALL_MARGIN, boxes);
    const meshHit = meshes.length > 0 ? raycastMeshes(focus, dir, s.cameraDistance + WALL_MARGIN, meshes) : null;
    const hit = boxHit === null ? meshHit : meshHit === null ? boxHit : Math.min(boxHit, meshHit);
    if (hit !== null) wanted = Math.max(MIN_DISTANCE, Math.min(wanted, hit - WALL_MARGIN));

    if (wanted < this.distance) this.distance = wanted; // snap in so the wall never clips the view
    else this.distance += (wanted - this.distance) * (1 - Math.exp(-6 * dt));

    camera.position.set(focus[0] + dir[0] * this.distance, focus[1] + dir[1] * this.distance, focus[2] + dir[2] * this.distance);
    camera.lookAt(focus[0], focus[1], focus[2]);
    if (camera.fov !== s.cameraFov) {
      camera.fov = s.cameraFov;
      camera.updateProjectionMatrix();
    }
  }
}
