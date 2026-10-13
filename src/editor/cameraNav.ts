import * as THREE from 'three';

/**
 * Editor camera navigation modeled on Godot 4's 3D editor ("Godot" navigation scheme):
 *
 *   Middle mouse drag ................ orbit around the pivot
 *   Shift + middle mouse drag ........ pan
 *   Ctrl + middle mouse drag ......... zoom
 *   Mouse wheel ...................... zoom (distance x 1.08 per notch)
 *   Right mouse hold + W A S D Q E ... free look / fly (Shift = faster, Alt = slower, wheel = speed)
 *   Alt + left mouse (+Shift / +Ctrl)  orbit / pan / zoom for trackpads ("emulate 3 button mouse")
 *   F ................................ focus on the selection
 *   Numpad 1 / 3 / 7 ................. front / right / top view (+Ctrl: rear / left / bottom)
 *   Numpad 5 ......................... toggle perspective / orthogonal
 *   Numpad 4 6 8 2 / 9 ............... orbit 15 degrees / 180 degrees
 *   Numpad + - / . ................... zoom / focus
 *
 * Numbers (sensitivity 0.25 degrees per pixel, fly speed 5 m/s x3 / x0.25, zoom step 1.08, pan
 * distance/600 per pixel, small inertia on pan and zoom) are Godot's defaults.
 */

export type ViewName = 'perspective' | 'orthogonal' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const DEG = Math.PI / 180;
const ORBIT_SENSITIVITY = 0.25 * DEG;
const FREELOOK_SENSITIVITY = 0.25 * DEG;
const FREELOOK_BASE_SPEED = 5;
const FREELOOK_FAST = 3;
const FREELOOK_SLOW = 0.25;
const ZOOM_STEP = 1.08;
const MIN_DISTANCE = 0.05;
const MAX_DISTANCE = 1500;
const MAX_PITCH = Math.PI / 2;
const TRANSLATION_INERTIA = 0.05; // seconds
const ZOOM_INERTIA = 0.05;
const ORTHO_CAMERA_DISTANCE = 600; // the picture of an orthographic camera does not depend on this
const FOV = 50;

/** Yaw / pitch (radians) for the standard views. The camera sits on the named axis side, looking at the pivot. */
export function viewAngles(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'): { yaw: number; pitch: number } {
  switch (view) {
    case 'front':
      return { yaw: 0, pitch: 0 };
    case 'back':
      return { yaw: Math.PI, pitch: 0 };
    case 'right':
      return { yaw: Math.PI / 2, pitch: 0 };
    case 'left':
      return { yaw: -Math.PI / 2, pitch: 0 };
    case 'top':
      return { yaw: 0, pitch: MAX_PITCH }; // X to the right, -Z up on screen
    case 'bottom':
      return { yaw: 0, pitch: -MAX_PITCH };
  }
}

/** Camera orientation for yaw (about +Y) and pitch (elevation above the pivot, positive = looking down). */
export function poseQuaternion(yaw: number, pitch: number): THREE.Quaternion {
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
  return qy.multiply(qx);
}

type DragMode = 'orbit' | 'pan' | 'zoom' | 'freelook';

export class CameraNav {
  readonly perspective = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2000);
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);

  /** Turned off while a gizmo is being dragged or the game is running. */
  enabled = true;
  /** The view mode (perspective / orthogonal / a standard view) changed. */
  onViewChange?: () => void;
  /** Short status text while navigating (fly speed); null clears it. */
  onStatus?: (text: string | null) => void;
  /** Numpad "." or similar asked for a focus on the selection. */
  onFocusRequest?: () => void;

  private targetPivot = new THREE.Vector3(0, 1, 0);
  private pivot = new THREE.Vector3(0, 1, 0);
  private targetDistance = 18;
  private distance = 18;
  private yaw = 0.7;
  private pitch = 0.5;
  private ortho = false;
  private autoOrtho = false;
  private view: ViewName = 'perspective';
  private aspect = 1;

  private drag: { mode: DragMode; pointerId: number } | null = null;
  private keys = new Set<string>();
  private shift = false;
  private alt = false;
  private freelookSpeed = FREELOOK_BASE_SPEED;

  constructor(private dom: HTMLElement) {
    dom.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerup', (e) => this.endDrag(e.pointerId));
    dom.addEventListener('pointercancel', (e) => this.endDrag(e.pointerId));
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
    window.addEventListener('blur', () => this.endDrag());
    this.apply();
  }

  // ---------------------------------------------------------------- state

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.ortho ? this.orthographic : this.perspective;
  }

  get isOrthographic(): boolean {
    return this.ortho;
  }

  get viewName(): ViewName {
    return this.view;
  }

  /** True while the right mouse button holds the camera in fly mode. */
  get freelook(): boolean {
    return this.drag?.mode === 'freelook';
  }

  /** The point the camera orbits around (target value, ignoring inertia). */
  get pivotPoint(): THREE.Vector3 {
    return this.targetPivot.clone();
  }

  get orientation(): THREE.Quaternion {
    return poseQuaternion(this.yaw, this.pitch);
  }

  setSize(width: number, height: number): void {
    this.aspect = Math.max(0.01, width / Math.max(1, height));
    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();
    this.apply();
  }

  /** Set pivot / distance / angles immediately (no inertia). */
  jumpTo(pivot: THREE.Vector3, distance: number, yaw?: number, pitch?: number): void {
    this.targetPivot.copy(pivot);
    this.pivot.copy(pivot);
    this.targetDistance = this.distance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH);
    this.apply();
  }

  /** Center the view on something of the given size (Godot's "Focus Selection"). */
  focus(center: THREE.Vector3, radius: number): void {
    this.targetPivot.copy(center);
    this.targetDistance = THREE.MathUtils.clamp(Math.max(radius, 0.25) / Math.sin((FOV / 2) * DEG) * 1.15, 1.5, 500);
  }

  // ---------------------------------------------------------------- views

  setView(view: ViewName): void {
    if (view === 'perspective') {
      this.ortho = false;
      this.autoOrtho = false;
    } else if (view === 'orthogonal') {
      this.ortho = true;
      this.autoOrtho = false;
    } else {
      const a = viewAngles(view);
      this.yaw = a.yaw;
      this.pitch = a.pitch;
      this.ortho = true; // Godot's "auto orthogonal": numpad views are orthogonal until you orbit away
      this.autoOrtho = true;
    }
    this.view = view;
    this.apply();
    this.onViewChange?.();
  }

  toggleOrtho(): void {
    this.setView(this.ortho ? 'perspective' : 'orthogonal');
  }

  /** Orbiting by hand leaves an automatic orthogonal view, like Godot. */
  private leaveAutoOrtho(): void {
    if (this.autoOrtho) {
      this.ortho = false;
      this.autoOrtho = false;
      this.view = 'perspective';
      this.onViewChange?.();
    } else if (this.ortho) {
      this.view = 'orthogonal';
    } else {
      this.view = 'perspective';
    }
  }

  // ---------------------------------------------------------------- input

  private mods(e: { shiftKey: boolean; altKey: boolean }): void {
    this.shift = e.shiftKey;
    this.alt = e.altKey;
  }

  private onPointerDown(e: PointerEvent): void {
    this.mods(e);
    if (!this.enabled || this.drag) return;
    let mode: DragMode | null = null;
    const zoomMod = e.ctrlKey || e.metaKey;
    if (e.button === 1) mode = e.shiftKey ? 'pan' : zoomMod ? 'zoom' : 'orbit';
    else if (e.button === 0 && e.altKey) mode = e.shiftKey ? 'pan' : zoomMod ? 'zoom' : 'orbit';
    else if (e.button === 2) mode = 'freelook';
    if (!mode) return;

    e.preventDefault();
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      // not an active pointer (synthetic events); events still arrive while the cursor is over the view
    }
    this.drag = { mode, pointerId: e.pointerId };
    if (mode === 'freelook') {
      this.keys.clear();
      try {
        const p = this.dom.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => {});
      } catch {
        // pointer lock can be refused; looking around still works through pointer capture
      }
      this.status();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.mods(e);
    const d = this.drag;
    if (!d) return;
    const dx = e.movementX;
    const dy = e.movementY;
    switch (d.mode) {
      case 'orbit':
        this.leaveAutoOrtho();
        this.yaw -= dx * ORBIT_SENSITIVITY;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * ORBIT_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
        this.apply();
        break;
      case 'pan': {
        const q = poseQuaternion(this.yaw, this.pitch);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const scale = this.targetDistance / 600;
        this.targetPivot.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
        break;
      }
      case 'zoom':
        this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * Math.pow(1.01, dy), MIN_DISTANCE, MAX_DISTANCE);
        break;
      case 'freelook': {
        this.leaveAutoOrtho();
        // the camera turns in place, so the pivot has to follow
        const before = this.cameraPosition();
        this.yaw -= dx * FREELOOK_SENSITIVITY;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * FREELOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
        this.placePivotFor(before);
        this.apply();
        break;
      }
    }
  }

  private endDrag(pointerId?: number): void {
    const d = this.drag;
    if (!d) return;
    if (pointerId !== undefined && d.pointerId !== pointerId) return;
    if (d.mode === 'freelook') {
      this.keys.clear();
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
      this.onStatus?.(null);
    }
    try {
      this.dom.releasePointerCapture(d.pointerId);
    } catch {
      // already released
    }
    this.drag = null;
  }

  private onWheel(e: WheelEvent): void {
    if (!this.enabled && !this.freelook) return;
    e.preventDefault();
    this.mods(e);
    if (this.freelook) {
      // the wheel changes the fly speed while the right button is held
      this.freelookSpeed = THREE.MathUtils.clamp(this.freelookSpeed * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), 0.1, 200);
      this.status();
      return;
    }
    let steps = e.deltaY / (e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100);
    if (e.ctrlKey) steps = e.deltaY / 10; // pinch on a trackpad
    steps = THREE.MathUtils.clamp(steps, -3, 3);
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * Math.pow(ZOOM_STEP, steps), MIN_DISTANCE, MAX_DISTANCE);
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.mods(e);
    if (!this.freelook) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      this.keys.add(e.code);
      e.preventDefault();
      e.stopPropagation(); // do not let the tool shortcuts (W, E, Q) see it
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.mods(e);
    this.keys.delete(e.code);
  }

  /** Numpad shortcuts. Returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (this.freelook) return false;
    const ctrl = e.ctrlKey || e.metaKey;
    const orbit = (dyaw: number, dpitch: number) => {
      this.leaveAutoOrtho();
      this.yaw += dyaw * DEG;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dpitch * DEG, -MAX_PITCH, MAX_PITCH);
      this.apply();
    };
    const pan = (rightAmount: number, upAmount: number) => {
      const q = poseQuaternion(this.yaw, this.pitch);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const s = this.targetDistance * 0.08;
      this.targetPivot.addScaledVector(right, rightAmount * s).addScaledVector(up, upAmount * s);
    };
    switch (e.code) {
      case 'Numpad1':
        this.setView(ctrl ? 'back' : 'front');
        return true;
      case 'Numpad3':
        this.setView(ctrl ? 'left' : 'right');
        return true;
      case 'Numpad7':
        this.setView(ctrl ? 'bottom' : 'top');
        return true;
      case 'Numpad5':
        this.toggleOrtho();
        return true;
      case 'Numpad4':
        if (ctrl) pan(-1, 0);
        else orbit(15, 0);
        return true;
      case 'Numpad6':
        if (ctrl) pan(1, 0);
        else orbit(-15, 0);
        return true;
      case 'Numpad8':
        if (ctrl) pan(0, 1);
        else orbit(0, 15);
        return true;
      case 'Numpad2':
        if (ctrl) pan(0, -1);
        else orbit(0, -15);
        return true;
      case 'Numpad9':
        orbit(180, 0);
        return true;
      case 'NumpadAdd':
        this.targetDistance = Math.max(MIN_DISTANCE, this.targetDistance / ZOOM_STEP);
        return true;
      case 'NumpadSubtract':
        this.targetDistance = Math.min(MAX_DISTANCE, this.targetDistance * ZOOM_STEP);
        return true;
      case 'NumpadDecimal':
        this.onFocusRequest?.();
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- per frame

  /** Advance inertia and fly movement, then update the camera. */
  update(dt: number): void {
    if (this.freelook) {
      const q = poseQuaternion(this.yaw, this.pitch);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const dir = new THREE.Vector3();
      if (this.keys.has('KeyW')) dir.add(forward);
      if (this.keys.has('KeyS')) dir.sub(forward);
      if (this.keys.has('KeyD')) dir.add(right);
      if (this.keys.has('KeyA')) dir.sub(right);
      if (this.keys.has('KeyE')) dir.add(up);
      if (this.keys.has('KeyQ')) dir.sub(up);
      if (dir.lengthSq() > 0) {
        const speed = this.freelookSpeed * (this.shift ? FREELOOK_FAST : 1) * (this.alt ? FREELOOK_SLOW : 1);
        dir.normalize().multiplyScalar(speed * dt);
        this.targetPivot.add(dir);
        this.pivot.add(dir);
      }
    }
    const kt = 1 - Math.exp(-dt / TRANSLATION_INERTIA);
    const kz = 1 - Math.exp(-dt / ZOOM_INERTIA);
    this.pivot.lerp(this.targetPivot, kt);
    this.distance += (this.targetDistance - this.distance) * kz;
    this.apply();
  }

  // ---------------------------------------------------------------- camera pose

  private cameraPosition(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(poseQuaternion(this.yaw, this.pitch));
    return this.pivot.clone().addScaledVector(dir, this.distance);
  }

  /** Keep the camera where it was (`position`) while the angles changed: move the pivot. */
  private placePivotFor(position: THREE.Vector3): void {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(poseQuaternion(this.yaw, this.pitch));
    this.pivot.copy(position).addScaledVector(dir, -this.distance);
    this.targetPivot.copy(this.pivot);
  }

  private apply(): void {
    const q = poseQuaternion(this.yaw, this.pitch);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const cam = this.camera;
    cam.quaternion.copy(q);
    if (this.ortho) {
      const halfH = Math.max(0.01, this.distance * Math.tan((FOV / 2) * DEG));
      const o = this.orthographic;
      o.left = -halfH * this.aspect;
      o.right = halfH * this.aspect;
      o.top = halfH;
      o.bottom = -halfH;
      o.near = 0.1;
      o.far = ORTHO_CAMERA_DISTANCE * 2;
      o.updateProjectionMatrix();
      o.position.copy(this.pivot).addScaledVector(dir, ORTHO_CAMERA_DISTANCE);
    } else {
      this.perspective.position.copy(this.pivot).addScaledVector(dir, this.distance);
    }
    cam.updateMatrixWorld(true);
  }

  private status(): void {
    this.onStatus?.(`Fly speed ${this.freelookSpeed.toFixed(1)} m/s · Shift faster · Alt slower · wheel changes speed`);
  }
}
