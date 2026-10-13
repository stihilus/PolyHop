import * as THREE from 'three';
import { loopCut, splitEdge } from '../core/mesh';
import { type Shape, quaternionFromDegrees } from '../core/shape';
import type { Vec3 } from '../core/types';
import { type MeshOpName, type SubMode, nearestEdge, ringPreviewSegments, runMeshOp } from './meshOps';
import type { ShapeVisuals } from './shapeTargets';
import type { TransformBar } from './ui/transformBar';

export interface MeshEditHost {
  /** The shape the tools edit right now (a level block or a model cube), or null. */
  shape(): Shape | null;
  /** The face of that shape under the pointer, with the hit point in the shape's local space. */
  raycastFace(e: { clientX: number; clientY: number }): { face: number; local: Vec3 } | null;
  /** The mesh changed (topology or vertices): rebuild geometry and record an undo step. */
  meshChanged(label: string): void;
  /** Selection or edit mode changed: refresh the gizmo target and visuals. */
  selectionChanged(): void;
  /** Short message for the user (why an operation did nothing). */
  notify(text: string): void;
}

/**
 * Selection (faces / vertices) and the mesh tools shared by the level and the model editor: extrude,
 * inset, subdivide, delete, merge, and the click-in-view tools loop cut and add vertex.
 */
export class MeshEditing {
  faces: number[] = [];
  vertices: number[] = [];

  constructor(
    private bar: TransformBar,
    private visuals: ShapeVisuals,
    private host: MeshEditHost,
  ) {
    bar.onOperation = (op) => this.run(op);
  }

  clearSelection(): void {
    this.faces = [];
    this.vertices = [];
  }

  /** What the bar needs to know to enable or grey out tools. */
  capabilities(editable: boolean): { editable: boolean; faces: number; vertices: number } {
    return { editable, faces: this.faces.length, vertices: this.vertices.length };
  }

  private toWorld(shape: Shape, p: Vec3): Vec3 {
    const v = new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(quaternionFromDegrees(shape.rotation));
    return [v.x + shape.position[0], v.y + shape.position[1], v.z + shape.position[2]];
  }

  // ---------------------------------------------------------------- one-shot operations

  run(op: MeshOpName): void {
    const shape = this.host.shape();
    if (!shape) return;
    const res = runMeshOp(op, shape.mesh, { sub: this.bar.sub, faces: this.faces, vertices: this.vertices });
    if (!res.ok) {
      if (res.reason) this.host.notify(res.reason);
      return;
    }
    this.faces = res.selection.faces;
    this.vertices = res.selection.vertices;
    this.applySubMode(res.selection.sub);
    if (res.tool) this.bar.setTool(res.tool);
    if (res.space) this.bar.setSpace(res.space);
    this.host.meshChanged(op);
    this.host.selectionChanged();
  }

  /** Delete key: removes the selected faces / vertices when an element mode is active. */
  deleteSelection(): boolean {
    if (!this.host.shape()) return false;
    const has = (this.bar.sub === 'face' && this.faces.length > 0) || (this.bar.sub === 'vertex' && this.vertices.length > 0);
    if (!has) return false;
    this.run('delete');
    return true;
  }

  private applySubMode(sub: SubMode): void {
    if (this.bar.sub !== sub) this.bar.setSub(sub);
  }

  // ---------------------------------------------------------------- click-in-view tools

  pointerMove(e: { clientX: number; clientY: number }): void {
    const tool = this.bar.tool;
    if (tool !== 'loopcut' && tool !== 'addvertex') {
      this.clearPreview();
      return;
    }
    const shape = this.host.shape();
    const hit = shape ? this.host.raycastFace(e) : null;
    const edge = shape && hit ? nearestEdge(shape.mesh, hit.face, hit.local) : null;
    if (!shape || !hit || !edge) {
      this.clearPreview();
      return;
    }
    if (tool === 'loopcut') {
      const segs = ringPreviewSegments(shape.mesh, hit.face, edge.slot);
      if (!segs) {
        this.clearPreview();
        return;
      }
      this.visuals.setPreview(
        segs.map(([a, b]) => [this.toWorld(shape, a), this.toWorld(shape, b)] as [Vec3, Vec3]),
        [],
      );
    } else {
      const pa = shape.mesh.verts[edge.a]!;
      const pb = shape.mesh.verts[edge.b]!;
      const p: Vec3 = [pa[0] + (pb[0] - pa[0]) * edge.t, pa[1] + (pb[1] - pa[1]) * edge.t, pa[2] + (pb[2] - pa[2]) * edge.t];
      this.visuals.setPreview([[this.toWorld(shape, pa), this.toWorld(shape, pb)]], [this.toWorld(shape, p)]);
    }
  }

  clearPreview(): void {
    this.visuals.setPreview([], []);
  }

  /** A click in the view. Returns true when a tool used it (so the editor must not also select). */
  pointerClick(e: { clientX: number; clientY: number }): boolean {
    const tool = this.bar.tool;
    if (tool !== 'loopcut' && tool !== 'addvertex') return false;
    const shape = this.host.shape();
    const hit = shape ? this.host.raycastFace(e) : null;
    const edge = shape && hit ? nearestEdge(shape.mesh, hit.face, hit.local) : null;
    if (!shape || !hit || !edge) return true;

    if (tool === 'loopcut') {
      const verts = loopCut(shape.mesh, hit.face, edge.slot, 0.5);
      if (!verts) {
        this.host.notify('Loop cut needs a ring of quad faces. Try another edge.');
        return true;
      }
      this.vertices = verts;
      this.faces = [];
      this.clearPreview();
      this.applySubMode('vertex');
      this.bar.setTool('translate');
      this.host.meshChanged('loop-cut');
      this.host.selectionChanged();
    } else {
      const idx = splitEdge(shape.mesh, edge.a, edge.b, edge.t);
      this.vertices = [idx];
      this.faces = [];
      this.clearPreview();
      this.applySubMode('vertex');
      this.bar.setTool('translate');
      this.host.meshChanged('add-vertex');
      this.host.selectionChanged();
    }
    return true;
  }
}
