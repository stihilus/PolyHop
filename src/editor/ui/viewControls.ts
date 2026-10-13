import * as THREE from 'three';
import type { CameraNav, ViewName } from '../cameraNav';
import { el } from './dom';

const VIEW_OPTIONS: { value: ViewName; label: string }[] = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthogonal', label: 'Orthogonal' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Rear' },
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
];

/** Godot-style "Perspective" menu: switch between perspective, orthogonal and the six standard views. */
export function buildViewMenu(nav: CameraNav): { el: HTMLSelectElement; sync: () => void } {
  const select = el('select', { class: 'view-menu', title: 'Camera view. Numpad 1 / 3 / 7 = front / right / top (Ctrl = opposite), 5 = perspective / orthogonal' });
  for (const o of VIEW_OPTIONS) select.append(el('option', { value: o.value, text: o.label }));
  select.addEventListener('change', () => nav.setView(select.value as ViewName));
  const sync = () => {
    select.value = nav.viewName;
  };
  sync();
  return { el: select, sync };
}

const AXES: { id: string; dir: [number, number, number]; color: string; label: string; view: ViewName }[] = [
  { id: '+x', dir: [1, 0, 0], color: '#e8505b', label: 'X', view: 'right' },
  { id: '-x', dir: [-1, 0, 0], color: '#e8505b', label: '', view: 'left' },
  { id: '+y', dir: [0, 1, 0], color: '#7bc950', label: 'Y', view: 'top' },
  { id: '-y', dir: [0, -1, 0], color: '#7bc950', label: '', view: 'bottom' },
  { id: '+z', dir: [0, 0, 1], color: '#4aa3ff', label: 'Z', view: 'front' },
  { id: '-z', dir: [0, 0, -1], color: '#4aa3ff', label: '', view: 'back' },
];

const SIZE = 88;
const RADIUS = 28;

/** Godot's view orientation gizmo: shows where X / Y / Z point and snaps the view when an axis is clicked. */
export class AxisGizmo {
  readonly el: HTMLCanvasElement;
  private hit: { view: ViewName; x: number; y: number; r: number; depth: number }[] = [];

  constructor(private nav: CameraNav) {
    this.el = el('canvas', { class: 'axis-gizmo', title: 'Click an axis to look along it' });
    const dpr = window.devicePixelRatio || 1;
    this.el.width = SIZE * dpr;
    this.el.height = SIZE * dpr;
    this.el.style.width = `${SIZE}px`;
    this.el.style.height = `${SIZE}px`;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const rect = this.el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const best = [...this.hit]
        .sort((a, b) => b.depth - a.depth)
        .find((h) => Math.hypot(h.x - x, h.y - y) <= h.r + 3);
      if (best) this.nav.setView(best.view);
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  draw(): void {
    const ctx = this.el.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const c = SIZE / 2;

    ctx.fillStyle = 'rgba(20,22,27,0.35)';
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.fill();

    const inv = this.nav.orientation.clone().invert();
    const items = AXES.map((a) => {
      const v = new THREE.Vector3(...a.dir).applyQuaternion(inv);
      return { a, x: c + v.x * RADIUS, y: c - v.y * RADIUS, depth: v.z };
    }).sort((p, q) => p.depth - q.depth);

    this.hit = [];
    ctx.font = '11px "Departure Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      const positive = it.a.id.startsWith('+');
      if (positive) {
        ctx.strokeStyle = it.a.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(it.x, it.y);
        ctx.stroke();
      }
      const r = positive ? 9 : 6.5;
      ctx.globalAlpha = positive ? 1 : 0.55;
      ctx.fillStyle = it.a.color;
      ctx.beginPath();
      ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (positive) {
        ctx.fillStyle = '#10131a';
        ctx.fillText(it.a.label, it.x, it.y + 0.5);
      }
      this.hit.push({ view: it.a.view, x: it.x, y: it.y, r, depth: it.depth });
    }
  }
}
