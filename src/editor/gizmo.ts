import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export type ToolMode = 'select' | 'translate' | 'rotate' | 'scale';
export type SpaceMode = 'world' | 'local';

/** Change made by the gizmo since the drag started, in world space. Identity parts mean "unchanged". */
export interface TransformDelta {
  translate: THREE.Vector3;
  rotate: THREE.Quaternion;
  /** Component-wise factors along the gizmo's local axes. */
  scale: THREE.Vector3;
}

/** Something the gizmo can drive: an object, a face, a set of vertices, the player spawn... */
export interface TransformTarget {
  /** World position of the gizmo. */
  pivot(): THREE.Vector3;
  /** World orientation of the gizmo (also the axes scaling works along). */
  orientation(): THREE.Quaternion;
  allow: { translate: boolean; rotate: boolean; scale: boolean };
  /** Restrict the rotate handles (e.g. only 'Y' for the player). */
  rotateAxes?: ('X' | 'Y' | 'Z')[];
  begin(): void;
  apply(d: TransformDelta): void;
  end(): void;
}

/**
 * Thin wrapper around three's TransformControls. The controls drive an invisible proxy object; on
 * every change we turn the proxy's movement into a TransformDelta and hand it to the current target.
 */
export class Gizmo {
  readonly controls: TransformControls;
  private proxy = new THREE.Object3D();
  private target: TransformTarget | null = null;
  private start = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private _tool: ToolMode = 'translate';
  private _enabled = true;
  dragging = false;

  /** `nav.enabled` is switched off while a handle is dragged so the camera does not move too. */
  constructor(scene: THREE.Scene, camera: THREE.Camera, dom: HTMLElement, nav: { enabled: boolean }) {
    // pointer capture can be refused for pointers that are not active (touch, automation); never let
    // that abort the gizmo's own handlers
    const capture = dom.setPointerCapture.bind(dom);
    const release = dom.releasePointerCapture.bind(dom);
    dom.setPointerCapture = (id: number) => {
      try {
        capture(id);
      } catch {
        // ignore
      }
    };
    dom.releasePointerCapture = (id: number) => {
      try {
        release(id);
      } catch {
        // ignore
      }
    };
    this.controls = new TransformControls(camera, dom);
    this.controls.setSize(0.85);
    scene.add(this.proxy);
    scene.add(this.controls.getHelper());
    this.controls.attach(this.proxy);

    this.controls.addEventListener('dragging-changed', (e) => {
      const value = Boolean((e as unknown as { value: unknown }).value);
      this.dragging = value;
      nav.enabled = !value;
      const t = this.target;
      if (!t) return;
      if (value) {
        this.start.pos.copy(this.proxy.position);
        this.start.quat.copy(this.proxy.quaternion);
        t.begin();
      } else {
        t.end();
        this.proxy.scale.set(1, 1, 1);
      }
    });
    this.controls.addEventListener('objectChange', () => {
      const t = this.target;
      if (!t || !this.dragging) return;
      t.apply({
        translate: this.proxy.position.clone().sub(this.start.pos),
        rotate: this.proxy.quaternion.clone().multiply(this.start.quat.clone().invert()),
        scale: this.proxy.scale.clone(),
      });
    });
    this.refreshVisibility();
  }

  get tool(): ToolMode {
    return this._tool;
  }

  /** True while the pointer hovers a gizmo handle (a click then belongs to the gizmo, not to picking). */
  get hovering(): boolean {
    return this.controls.axis !== null;
  }

  setTool(tool: ToolMode): void {
    this._tool = tool;
    if (tool !== 'select') this.controls.setMode(tool);
    this.refreshVisibility();
  }

  /** Switch between the perspective and orthographic editor camera. */
  setCamera(camera: THREE.Camera): void {
    this.controls.camera = camera;
  }

  setSpace(space: SpaceMode): void {
    this.controls.setSpace(space);
  }

  /** Grid step in meters (0 = no snapping) and rotation step in degrees (0 = none). */
  setSnap(translate: number, rotateDeg: number): void {
    this.controls.setTranslationSnap(translate > 0 ? translate : null);
    this.controls.setRotationSnap(rotateDeg > 0 ? THREE.MathUtils.degToRad(rotateDeg) : null);
    this.controls.setScaleSnap(null);
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.refreshVisibility();
  }

  setTarget(target: TransformTarget | null): void {
    if (this.dragging) return;
    this.target = target;
    this.sync();
    this.refreshVisibility();
  }

  /** Move the proxy to where the target says it is. Call every frame (a no-op while dragging). */
  sync(): void {
    const t = this.target;
    if (!t || this.dragging) return;
    this.proxy.position.copy(t.pivot());
    this.proxy.quaternion.copy(t.orientation());
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
  }

  private refreshVisibility(): void {
    const t = this.target;
    const mode = this._tool === 'select' ? null : this._tool;
    const usable = !!t && !!mode && t.allow[mode] && this._enabled;
    this.controls.enabled = usable;
    this.controls.getHelper().visible = usable;
    if (t && mode === 'rotate' && t.rotateAxes) {
      this.controls.showX = t.rotateAxes.includes('X');
      this.controls.showY = t.rotateAxes.includes('Y');
      this.controls.showZ = t.rotateAxes.includes('Z');
    } else {
      this.controls.showX = this.controls.showY = this.controls.showZ = true;
    }
  }

  dispose(): void {
    this.controls.dispose();
  }
}
