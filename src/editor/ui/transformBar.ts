import type { SpaceMode, ToolMode as GizmoTool } from '../gizmo';
import type { MeshOpName, SubMode } from '../meshOps';
import { el } from './dom';
import { type IconName, icon } from './icons';

/** Everything the left tool strip can be set to. Loop cut and add vertex are click-in-the-view tools. */
export type BarTool = GizmoTool | 'loopcut' | 'addvertex' | 'paint' | 'sculpt';

export interface TransformBarOptions {
  /** Snap steps offered in the dropdown (value 0 = off). */
  snapOptions: { value: number; label: string }[];
  snap: number;
  /** Offer the tile paint tool (the level editor does; model cubes are textured by UV instead). */
  paintTool?: boolean;
  /** Offer the terrain sculpt tool (level editor only). */
  sculptTool?: boolean;
}

export interface BarCapabilities {
  /** A mesh the tools can edit is selected (a block or a cube, not an instance or the player). */
  editable: boolean;
  faces: number;
  vertices: number;
}

/**
 * The shared tool strip of the level and model editors. `strip` is a vertical column of icon buttons
 * (transform tools, what to edit, mesh tools); `el` is a small settings row (axes, snap) for the top bar.
 */
export class TransformBar {
  /** Settings row: world / local axes and snapping. */
  readonly el: HTMLElement;
  /** Vertical icon strip, placed over the left edge of the view. */
  readonly strip: HTMLElement;
  tool: BarTool = 'translate';
  sub: SubMode = 'object';
  space: SpaceMode = 'world';
  snap: number;
  onChange?: () => void;
  /** A one-shot mesh operation was requested (extrude, inset, ...). */
  onOperation?: (op: MeshOpName) => void;

  private toolButtons = new Map<BarTool, HTMLButtonElement>();
  private subButtons = new Map<SubMode, HTMLButtonElement>();
  private opButtons = new Map<MeshOpName, HTMLButtonElement>();
  private spaceButton: HTMLButtonElement;
  private caps: BarCapabilities = { editable: false, faces: 0, vertices: 0 };
  private hasPaint: boolean;
  private hasSculpt: boolean;

  constructor(opts: TransformBarOptions) {
    this.snap = opts.snap;
    this.hasPaint = opts.paintTool === true;
    this.hasSculpt = opts.sculptTool === true;

    const button = (name: IconName, title: string, onclick: () => void) =>
      el('button', { class: 'tool-btn', title, 'aria-label': title, onclick }, icon(name, 20));
    const group = (...children: HTMLElement[]) => el('div', { class: 'tool-group' }, ...children);

    const addTool = (id: BarTool, name: IconName, title: string) => {
      const b = button(name, title, () => this.setTool(id));
      this.toolButtons.set(id, b);
      return b;
    };
    const addSub = (id: SubMode, name: IconName, title: string) => {
      const b = button(name, title, () => this.setSub(id));
      this.subButtons.set(id, b);
      return b;
    };
    const addOp = (id: MeshOpName, name: IconName, title: string) => {
      const b = button(name, title, () => this.requestOp(id));
      this.opButtons.set(id, b);
      return b;
    };

    this.strip = el(
      'div',
      { class: 'tool-strip' },
      group(
        addTool('select', 'select', 'Select (Q)'),
        addTool('translate', 'move', 'Move (W)'),
        addTool('rotate', 'rotate', 'Rotate (E)'),
        addTool('scale', 'scale', 'Scale (R)'),
      ),
      group(
        addSub('object', 'object', 'Edit the whole object (1)'),
        addSub('face', 'face', 'Edit faces (2): click a face, Shift-click for more'),
        addSub('vertex', 'vertex', 'Edit vertices (3): click a point, Shift-click for more'),
      ),
      ...(this.hasSculpt ? [group(addTool('sculpt', 'sculpt', 'Sculpt terrain (G): hold the mouse over a terrain to raise, lower, smooth, flatten or paint it'))] : []),
      ...(this.hasPaint ? [group(addTool('paint', 'paint', 'Paint tiles (P): pick a tile in Properties, click or drag over faces. Shift = whole block, Ctrl = pick the tile under the cursor'))] : []),
      group(
        addOp('extrude', 'extrude', 'Extrude the selected faces (T)'),
        addOp('inset', 'inset', 'Inset the selected faces (I)'),
        addTool('loopcut', 'loopcut', 'Loop cut (L): hover an edge, click to cut around the mesh'),
        addOp('subdivide', 'subdivide', 'Subdivide the selected faces, or everything (U)'),
        addTool('addvertex', 'addvertex', 'Add vertex (V): click an edge to split it'),
        addOp('merge', 'merge', 'Merge the selected vertices into one (M)'),
        addOp('bevel', 'bevel', 'Bevel: chamfer the hard edges of the whole shape (B)'),
        addOp('smooth', 'smooth', 'Smooth: round the whole shape, a round of subdivision (H)'),
        addOp('delete', 'delete', 'Delete the selected faces or vertices (Delete)'),
      ),
    );

    this.spaceButton = el('button', {
      class: 'tool-btn wide',
      title: 'Gizmo axes: world or local (X). In Face mode local follows the face normal.',
      onclick: () => this.setSpace(this.space === 'world' ? 'local' : 'world'),
    });

    const snap = el('select', { title: 'Snap to grid', class: 'snap-select' });
    for (const o of opts.snapOptions) snap.append(el('option', { value: String(o.value), text: o.label, selected: o.value === this.snap }));
    snap.addEventListener('change', () => {
      this.snap = parseFloat(snap.value);
      this.onChange?.();
    });

    this.el = el(
      'div',
      { class: 'tb-group' },
      this.spaceButton,
      el('span', { class: 'snap-wrap', title: 'Snap to grid' }, icon('magnet', 16), snap),
    );
    this.refresh();
  }

  /** The tool the transform gizmo should use (it is hidden for the click-in-view tools). */
  get gizmoTool(): GizmoTool {
    return this.tool === 'loopcut' || this.tool === 'addvertex' || this.tool === 'paint' || this.tool === 'sculpt' ? 'select' : this.tool;
  }

  setTool(tool: BarTool): void {
    this.tool = tool;
    this.refresh();
    this.onChange?.();
  }

  setSub(sub: SubMode): void {
    this.sub = sub;
    this.refresh();
    this.onChange?.();
  }

  setSpace(space: SpaceMode): void {
    this.space = space;
    this.refresh();
    this.onChange?.();
  }

  /** Tell the bar what is selected so it can grey out tools that would do nothing. */
  setCapabilities(caps: BarCapabilities): void {
    this.caps = caps;
    this.refresh();
  }

  private opEnabled(op: MeshOpName): boolean {
    const c = this.caps;
    if (!c.editable) return false;
    switch (op) {
      case 'extrude':
      case 'inset':
        return this.sub === 'face' && c.faces > 0;
      case 'subdivide':
      case 'bevel':
      case 'smooth':
        return true;
      case 'merge':
        return this.sub === 'vertex' && c.vertices >= 2;
      case 'delete':
        return (this.sub === 'face' && c.faces > 0) || (this.sub === 'vertex' && c.vertices > 0);
    }
  }

  private requestOp(op: MeshOpName): void {
    if (this.opEnabled(op)) this.onOperation?.(op);
  }

  /** Handle a keyboard shortcut. Returns true when the key was used. */
  handleKey(code: string): boolean {
    const tools: Record<string, BarTool> = {
      KeyQ: 'select',
      KeyW: 'translate',
      KeyE: 'rotate',
      KeyR: 'scale',
      KeyL: 'loopcut',
      KeyV: 'addvertex',
      ...(this.hasPaint ? { KeyP: 'paint' as BarTool } : {}),
      ...(this.hasSculpt ? { KeyG: 'sculpt' as BarTool } : {}),
    };
    const subs: Record<string, SubMode> = { Digit1: 'object', Digit2: 'face', Digit3: 'vertex' };
    const ops: Record<string, MeshOpName> = { KeyT: 'extrude', KeyI: 'inset', KeyU: 'subdivide', KeyM: 'merge', KeyB: 'bevel', KeyH: 'smooth' };
    const tool = tools[code];
    if (tool) {
      if ((tool === 'loopcut' || tool === 'addvertex') && !this.caps.editable) return true;
      this.setTool(tool);
      return true;
    }
    const sub = subs[code];
    if (sub) {
      if (sub === 'object' || this.caps.editable) this.setSub(sub);
      return true;
    }
    const op = ops[code];
    if (op) {
      this.requestOp(op);
      return true;
    }
    if (code === 'KeyX') {
      this.setSpace(this.space === 'world' ? 'local' : 'world');
      return true;
    }
    return false;
  }

  private refresh(): void {
    for (const [id, b] of this.toolButtons) {
      b.classList.toggle('active', id === this.tool);
      if (id === 'loopcut' || id === 'addvertex') b.disabled = !this.caps.editable;
    }
    for (const [id, b] of this.subButtons) {
      b.classList.toggle('active', id === this.sub);
      b.disabled = id !== 'object' && !this.caps.editable;
    }
    for (const [id, b] of this.opButtons) b.disabled = !this.opEnabled(id);
    this.spaceButton.replaceChildren(icon(this.space === 'world' ? 'world' : 'local', 16), el('span', { text: this.space === 'world' ? 'World' : 'Local' }));
  }
}
