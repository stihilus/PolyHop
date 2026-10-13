import type { PlayerSettings, Vec3 } from '../core/types';
import { type MeshCollider, capsuleTriangleContact } from './collision';
import { type Box, EPS, overlaps } from './physics';

export interface PlayerInput {
  /**
   * Move intent in -1..1. x = right, y = forward. With the free camera both are relative to the
   * camera; with the chase camera x turns the player and y moves along where they face.
   */
  moveX: number;
  moveY: number;
  /** Edge: jump went down since the last step. */
  jumpPressed: boolean;
  jumpHeld: boolean;
  run: boolean;
  crouch: boolean;
}

/** Things that happened during a step that the game may want to hear or show. */
export type PlayerEvent = 'jump' | 'doubleJump' | 'land' | 'splash';

export const NO_INPUT: PlayerInput = {
  moveX: 0,
  moveY: 0,
  jumpPressed: false,
  jumpHeld: false,
  run: false,
  crouch: false,
};

const TERMINAL_VELOCITY = 40;
/** How far (m) the player is pulled down onto a slope when walking off a rise, so it stays on it. */
const SNAP_DOWN = 0.12;
const NO_MESHES: MeshCollider[] = [];
const NO_LIQUIDS: Box[] = [];
/** Swimming: speed and sinking relative to dry land. */
const SWIM_SPEED = 0.6;
/** Walking backwards (chase camera) is slower than walking forward. */
const BACKWARD_SPEED = 0.7;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Kinematic character controller: an axis-aligned box that walks, runs, jumps and crouches against
 * static boxes. Pure logic, no rendering. `settings` is read live, so inspector edits apply instantly.
 */
export class PlayerController {
  /** Feet position (bottom center of the box). */
  pos: Vec3 = [0, 0, 0];
  vel: Vec3 = [0, 0, 0];
  grounded = false;
  crouching = false;
  /** Facing angle in radians; forward vector is (sin f, 0, cos f). */
  facing = 0;
  /** Current collision height (changes when crouching). */
  height: number;

  /** Filled during `update`; the game takes them out after each step. */
  readonly events: PlayerEvent[] = [];

  private coyote = 0;
  private jumpBuffer = 0;
  private airJumpUsed = false;
  private jumping = false;
  private cutApplied = false;
  /** The capsule leans on a slope too steep to stand on (set while resolving, read by the next jump check). */
  private onSteep = false;
  /** The player is gliding (jump held in the air after letting go once, falling). */
  gliding = false;
  /** The middle of the body is in water. */
  swimming = false;
  /** The top of the water the player is in (for climbing out), or -Infinity. */
  private waterSurface = -Infinity;
  /** Jump was let go of since leaving the ground: holding it now glides. */
  private glideReady = false;
  /** Seconds left of the short glide after climbing a step (no gravity, so the capsule gets over the edge). */
  private stepHold = 0;

  /**
   * @param spawn where `reset` puts the player (feet position); levels have their own
   * @param spawnYaw the direction they face there, in degrees
   */
  constructor(
    public settings: PlayerSettings,
    public spawn: Vec3 = [0, 0, 0],
    public spawnYaw = 0,
  ) {
    this.height = settings.height;
  }

  reset(): void {
    const s = this.settings;
    this.pos = [...this.spawn];
    this.vel = [0, 0, 0];
    this.grounded = false;
    this.crouching = false;
    this.height = s.height;
    this.facing = (this.spawnYaw * Math.PI) / 180;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.airJumpUsed = false;
    this.jumping = false;
    this.cutApplied = false;
    this.stepHold = 0;
  }

  /** Throw the player up (a bounce off an enemy or a spring); the double jump is theirs again. */
  launch(speed: number): void {
    this.vel[1] = speed;
    this.grounded = false;
    this.jumping = false;
    this.airJumpUsed = false;
    this.stepHold = 0;
    this.coyote = 0;
  }

  /** Turn by an extra angle (radians, positive = to the right), e.g. from the mouse. */
  turnRight(radians: number): void {
    this.facing = wrapAngle(this.facing - radians);
  }

  private box(height: number): Box {
    const h = this.settings.width / 2;
    return {
      minX: this.pos[0] - h,
      maxX: this.pos[0] + h,
      minY: this.pos[1],
      maxY: this.pos[1] + height,
      minZ: this.pos[2] - h,
      maxZ: this.pos[2] + h,
    };
  }

  /**
   * Push the capsule (radius = half the width) out of the triangle meshes. Walkable surfaces lift the
   * player straight up, so standing on a slope does not creep; steeper ones push along their normal
   * and take the speed into them away, so the player slides. Returns true when it ends up standing.
   */
  private resolveMeshes(meshes: MeshCollider[], height: number): boolean {
    const s = this.settings;
    const r = s.width / 2;
    const walkable = Math.cos((s.maxSlope * Math.PI) / 180);
    const h = Math.max(height, 2 * r);
    let standing = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const m of meshes) {
        if (
          m.max[0] < this.pos[0] - r ||
          m.min[0] > this.pos[0] + r ||
          m.max[2] < this.pos[2] - r ||
          m.min[2] > this.pos[2] + r ||
          m.max[1] < this.pos[1] ||
          m.min[1] > this.pos[1] + h
        ) {
          continue;
        }
        const T = m.tris;
        for (let i = 0; i < T.length; i += 9) {
          const x = this.pos[0];
          const y = this.pos[1];
          const z = this.pos[2];
          // triangle bounds against the capsule's bounds
          if (
            Math.max(T[i]!, T[i + 3]!, T[i + 6]!) < x - r ||
            Math.min(T[i]!, T[i + 3]!, T[i + 6]!) > x + r ||
            Math.max(T[i + 1]!, T[i + 4]!, T[i + 7]!) < y ||
            Math.min(T[i + 1]!, T[i + 4]!, T[i + 7]!) > y + h ||
            Math.max(T[i + 2]!, T[i + 5]!, T[i + 8]!) < z - r ||
            Math.min(T[i + 2]!, T[i + 5]!, T[i + 8]!) > z + r
          ) {
            continue;
          }
          const c = capsuleTriangleContact(
            [x, y + r, z],
            [x, y + h - r, z],
            r,
            [T[i]!, T[i + 1]!, T[i + 2]!],
            [T[i + 3]!, T[i + 4]!, T[i + 5]!],
            [T[i + 6]!, T[i + 7]!, T[i + 8]!],
          );
          if (!c || c.depth <= 1e-5) continue;
          const n = c.n;
          if (n[1] >= walkable) {
            this.pos[1] += c.depth / n[1];
            if (this.vel[1] < 0) this.vel[1] = 0;
            standing = true;
          } else {
            // a steep slope that faces somewhat upward can still be pushed off from with a jump
            if (n[1] > 0.05) this.onSteep = true;
            this.pos[0] += n[0] * c.depth;
            this.pos[1] += n[1] * c.depth;
            this.pos[2] += n[2] * c.depth;
            const into = this.vel[0] * n[0] + this.vel[1] * n[1] + this.vel[2] * n[2];
            if (into < 0) {
              this.vel[0] -= n[0] * into;
              this.vel[1] -= n[1] * into;
              this.vel[2] -= n[2] * into;
            }
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return standing;
  }

  /** True when a capsule of this height at the player's spot would touch a mesh. */
  private meshesBlock(meshes: MeshCollider[], height: number): boolean {
    const r = this.settings.width / 2;
    const h = Math.max(height, 2 * r);
    const [x, y, z] = this.pos;
    for (const m of meshes) {
      if (m.max[0] < x - r || m.min[0] > x + r || m.max[2] < z - r || m.min[2] > z + r || m.max[1] < y || m.min[1] > y + h) continue;
      const T = m.tris;
      for (let i = 0; i < T.length; i += 9) {
        const c = capsuleTriangleContact(
          [x, y + r, z],
          [x, y + h - r, z],
          r - 0.002,
          [T[i]!, T[i + 1]!, T[i + 2]!],
          [T[i + 3]!, T[i + 4]!, T[i + 5]!],
          [T[i + 6]!, T[i + 7]!, T[i + 8]!],
        );
        if (c && c.depth > 1e-4) return true;
      }
    }
    return false;
  }

  update(dt: number, input: PlayerInput, camYaw: number, boxes: Box[], meshes: MeshCollider[] = NO_MESHES, liquids: Box[] = NO_LIQUIDS): void {
    const s = this.settings;
    const wasGrounded = this.grounded;
    const fallSpeed = this.vel[1];

    // --- water: the middle of the body is inside a body of water
    const wasSwimming = this.swimming;
    this.swimming = false;
    this.waterSurface = -Infinity;
    const mid = this.pos[1] + this.height * 0.5;
    for (const l of liquids) {
      if (this.pos[0] > l.minX && this.pos[0] < l.maxX && this.pos[2] > l.minZ && this.pos[2] < l.maxZ && mid > l.minY && mid < l.maxY) {
        this.swimming = true;
        this.waterSurface = Math.max(this.waterSurface, l.maxY);
      }
    }
    if (this.swimming && !wasSwimming && fallSpeed < -3) this.events.push('splash');

    // --- crouch: stay crouched while there is no room to stand up
    if (input.crouch) {
      this.crouching = true;
    } else if (this.crouching) {
      const standing = this.box(s.height);
      if (!boxes.some((b) => overlaps(standing, b)) && !this.meshesBlock(meshes, s.height)) this.crouching = false;
    }
    this.height = this.crouching ? s.crouchHeight : s.height;

    // --- horizontal movement
    const chase = s.cameraMode === 'chase';
    let wx: number;
    let wz: number;
    let mag: number;
    let speedScale = 1;
    if (chase) {
      // the camera sits behind the player, so steering turns the player and the camera follows
      this.facing = wrapAngle(this.facing - input.moveX * ((s.steerSpeed * Math.PI) / 180) * dt);
      wx = Math.sin(this.facing) * input.moveY;
      wz = Math.cos(this.facing) * input.moveY;
      mag = Math.min(1, Math.abs(input.moveY));
      if (input.moveY < 0) speedScale = BACKWARD_SPEED;
    } else {
      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      // camera sits at +(sin, cos) around the player, so "forward" is -(sin, cos) and "right" is (cos, -sin)
      wx = -sin * input.moveY + cos * input.moveX;
      wz = -cos * input.moveY - sin * input.moveX;
      mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    }
    const wlen = Math.hypot(wx, wz);
    if (this.swimming) speedScale *= SWIM_SPEED;
    const speed = (this.crouching ? s.crouchSpeed : input.run ? s.runSpeed : s.walkSpeed) * speedScale;
    const tx = wlen > 1e-6 ? (wx / wlen) * speed * mag : 0;
    const tz = wlen > 1e-6 ? (wz / wlen) * speed * mag : 0;

    const rate = (mag > 0.01 ? s.acceleration : s.deceleration) * (this.grounded ? 1 : s.airControl);
    const dvx = tx - this.vel[0];
    const dvz = tz - this.vel[2];
    const dlen = Math.hypot(dvx, dvz);
    const maxStep = rate * dt;
    if (dlen <= maxStep || dlen < 1e-9) {
      this.vel[0] = tx;
      this.vel[2] = tz;
    } else {
      this.vel[0] += (dvx / dlen) * maxStep;
      this.vel[2] += (dvz / dlen) * maxStep;
    }

    // --- facing: with the free camera the player turns toward where they walk
    if (!chase && mag > 0.1 && wlen > 1e-6) {
      const target = Math.atan2(wx, wz);
      const diff = wrapAngle(target - this.facing);
      const step = s.turnSpeed * dt;
      this.facing += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    }

    // --- jump (coyote time, input buffer, optional double jump, variable height)
    const steep = this.onSteep;
    this.onSteep = false;
    if (this.grounded) {
      this.coyote = s.coyoteTime;
      this.airJumpUsed = false;
    } else if (steep && this.vel[1] <= 0.5) {
      // sliding down a slope that is too steep to stand on: it still counts as ground for a jump
      // (but not for the double jump, and not while shooting up it)
      this.coyote = s.coyoteTime;
    } else {
      this.coyote -= dt;
    }
    this.jumpBuffer = input.jumpPressed ? s.jumpBuffer : this.jumpBuffer - dt;

    if (this.swimming) {
      // in the water: jump swims up (and hops out at the surface), crouch dives
      const v0 = Math.sqrt(2 * s.gravity * s.jumpHeight);
      this.airJumpUsed = false;
      this.jumping = false;
      const atSurface = this.pos[1] + this.height * 0.9 > this.waterSurface;
      if (input.jumpPressed && atSurface) {
        this.vel[1] = v0 * 0.9;
        this.events.push('jump');
      } else if (input.jumpHeld) {
        this.vel[1] = Math.min(3.2, this.vel[1] + 26 * dt);
      } else if (input.crouch) {
        this.vel[1] = Math.max(-3.2, this.vel[1] - 14 * dt);
      }
      this.jumpBuffer = 0;
      this.coyote = 0;
    } else if (this.jumpBuffer > 0) {
      const v0 = Math.sqrt(2 * s.gravity * s.jumpHeight);
      if (this.coyote > 0) {
        this.vel[1] = v0;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.jumping = true;
        this.cutApplied = false;
        this.grounded = false;
        this.events.push('jump');
      } else if (input.jumpPressed && s.doubleJump && !this.airJumpUsed) {
        this.vel[1] = v0;
        this.airJumpUsed = true;
        this.jumpBuffer = 0;
        this.jumping = true;
        this.cutApplied = false;
        this.events.push('doubleJump');
      }
    }
    if (this.jumping && !this.cutApplied && !input.jumpHeld && this.vel[1] > 0) {
      this.vel[1] *= s.jumpCut;
      this.cutApplied = true;
    }

    // --- gliding: hold jump while falling, after having let go of it in the air
    if (this.swimming) {
      this.glideReady = false;
      this.gliding = false;
    } else if (this.grounded) {
      this.glideReady = false;
      this.gliding = false;
    } else if (!input.jumpHeld) {
      this.glideReady = true;
      this.gliding = false;
    } else {
      this.gliding = s.glide && this.glideReady && this.vel[1] < 0 && !this.jumping;
    }

    // --- gravity (exact integration for constant acceleration)
    let dy = 0;
    if (this.stepHold > 0 && this.vel[1] <= 0) {
      // just climbed a step: stay level for a moment so the body gets over the edge
      this.stepHold -= dt;
      this.vel[1] = 0;
    } else {
      this.stepHold = 0;
      const g = s.gravity * (this.vel[1] < 0 ? s.fallMultiplier : 1);
      let vyNew = Math.max(-TERMINAL_VELOCITY, this.vel[1] - g * dt);
      if (this.gliding) vyNew = Math.max(vyNew, -s.glideFall);
      if (this.swimming) {
        // the water holds the body up: hardly any gravity, and drag on everything
        vyNew = this.vel[1] - g * 0.12 * dt;
        vyNew *= Math.max(0, 1 - 2.6 * dt);
        vyNew = Math.max(vyNew, -3.2);
      }
      dy = (this.vel[1] + vyNew) * 0.5 * dt;
      this.vel[1] = vyNew;
    }

    // --- move and collide, one axis at a time
    const startX = this.pos[0];
    const startY = this.pos[1];
    const startZ = this.pos[2];
    const wantX = this.vel[0] * dt;
    const wantZ = this.vel[2] * dt;
    const keepVx = tx;
    const keepVz = tz;
    this.moveAxis(0, wantX, boxes);
    this.moveAxis(2, wantZ, boxes);
    this.grounded = false;
    this.moveAxis(1, dy, boxes);
    if (meshes.length > 0) {
      let onMesh = this.resolveMeshes(meshes, this.height);
      // walking off a rise onto a slope: stay on the surface instead of hopping down it (not while
      // standing on a box, whose top is already the ground)
      if (!onMesh && wasGrounded && this.vel[1] <= 0 && !this.standsOnSomething(boxes)) {
        const x = this.pos[0];
        const y = this.pos[1];
        const z = this.pos[2];
        const vx = this.vel[0];
        const vy = this.vel[1];
        const vz = this.vel[2];
        this.pos[1] -= SNAP_DOWN;
        onMesh = this.resolveMeshes(meshes, this.height);
        const body = this.box(this.height);
        if (!onMesh || boxes.some((b) => overlaps(body, b))) {
          onMesh = false;
          this.pos = [x, y, z];
          this.vel = [vx, vy, vz];
        }
      }
      if (onMesh) this.grounded = true;
    }
    if (!this.grounded && this.vel[1] <= 0 && this.standsOnSomething(boxes)) this.grounded = true;
    // a low edge in the way (a stair, a curb): step up onto it instead of stopping
    if (wasGrounded && s.stepHeight > 0.01 && (wantX !== 0 || wantZ !== 0)) {
      if (this.tryStepUp(startX, startY, startZ, wantX, wantZ, keepVx, keepVz, boxes, meshes)) {
        this.grounded = true;
        this.stepHold = 0.12;
      }
    }
    if (this.stepHold > 0) this.grounded = true;
    if (this.grounded) {
      this.jumping = false;
      if (!wasGrounded && fallSpeed < -4) this.events.push('land');
    }
  }

  /**
   * The horizontal move was blocked. Find the lowest lift (up to `stepHeight`) from which the same move
   * gets clearly further, and with room for the head. The player stays just above that edge and settles
   * on it a moment later, so a stair is climbed smoothly and a capsule does not have to balance on a rim.
   */
  private tryStepUp(
    sx: number,
    sy: number,
    sz: number,
    wantX: number,
    wantZ: number,
    vx: number,
    vz: number,
    boxes: Box[],
    meshes: MeshCollider[],
  ): boolean {
    const want = Math.hypot(wantX, wantZ);
    if (want < 1e-6) return false;
    const progress = ((this.pos[0] - sx) * wantX + (this.pos[2] - sz) * wantZ) / want;
    if (progress > want * 0.7) return false; // not blocked
    const step = this.settings.stepHeight;
    const saved = { pos: [...this.pos] as Vec3, vel: [...this.vel] as Vec3, grounded: this.grounded };
    const need = Math.max(progress + want * 0.25, want * 0.5);

    /** Does the move work from this much higher? Leaves the player where that move ended. */
    const works = (lift: number): boolean => {
      this.pos = [sx, sy + lift, sz];
      if (boxes.some((b) => overlaps(this.box(this.height), b)) || this.meshesBlock(meshes, this.height)) return false;
      this.moveAxis(0, wantX, boxes);
      this.moveAxis(2, wantZ, boxes);
      if (meshes.length > 0) this.resolveMeshes(meshes, this.height);
      return ((this.pos[0] - sx) * wantX + (this.pos[2] - sz) * wantZ) / want >= need;
    };
    const fail = () => {
      this.pos = saved.pos;
      this.vel = saved.vel;
      this.grounded = saved.grounded;
      return false;
    };

    if (!works(step)) return fail();
    let lo = 0;
    let hi = step;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (works(mid)) hi = mid;
      else lo = mid;
    }
    // a hair above the edge so the capsule does not scrape it; gravity sets it down next
    if (!works(Math.min(step, hi + 0.02))) return fail();

    // is that a ledge to stand on? Carry on a body's width and look where it would come down: the
    // top must be walkable and higher than where we started (a steep slope is a wall, not a step)
    const elevated = [...this.pos] as Vec3;
    const reach = this.settings.width / 2 + 0.05;
    this.moveAxis(0, (wantX / want) * reach, boxes);
    this.moveAxis(2, (wantZ / want) * reach, boxes);
    if (meshes.length > 0) this.resolveMeshes(meshes, this.height);
    let landed = false;
    this.grounded = false;
    const bit = (step + 0.1) / 14;
    for (let i = 0; i < 14 && !landed; i++) {
      this.moveAxis(1, -bit, boxes);
      if (this.grounded) landed = true;
      else if (meshes.length > 0 && this.resolveMeshes(meshes, this.height)) landed = true;
    }
    const settledAt = this.pos[1];
    if (!landed || settledAt < sy + 0.03) return fail();
    this.pos = elevated;
    this.vel = [vx, 0, vz];
    return true;
  }

  /** True when a box top is within a hair below the feet (so tiny steps don't flicker `grounded`). */
  private standsOnSomething(boxes: Box[]): boolean {
    const probe = this.box(this.height);
    probe.minY -= 0.02;
    probe.maxY -= 0.02;
    return boxes.some((b) => overlaps(probe, b));
  }

  private moveAxis(axis: 0 | 1 | 2, delta: number, boxes: Box[]): void {
    if (delta === 0) return;
    const before = this.pos[axis]!;
    this.pos[axis] += delta;
    const half = this.settings.width / 2;
    for (const b of boxes) {
      if (!overlaps(this.box(this.height), b)) continue;
      if (axis === 0) {
        this.pos[0] = delta > 0 ? b.minX - half : b.maxX + half;
        this.vel[0] = 0;
      } else if (axis === 2) {
        this.pos[2] = delta > 0 ? b.minZ - half : b.maxZ + half;
        this.vel[2] = 0;
      } else if (delta > 0) {
        this.pos[1] = b.minY - this.height - EPS * 0.5;
        this.vel[1] = 0;
      } else {
        this.pos[1] = b.maxY;
        this.vel[1] = 0;
        this.grounded = true;
      }
    }
    // the push-out must never throw the player across a box it was already inside of
    if (Math.abs(this.pos[axis]! - before) > Math.abs(delta) + 0.5) {
      this.pos[axis] = before;
      this.vel[axis] = 0;
    }
  }
}
