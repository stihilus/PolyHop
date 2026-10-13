// Terrain: a height field kept as an ordinary block mesh. A grid of quads (one per cell, in rows) whose
// vertices go up and down. Painting a cell is painting a face, so the tile paint tool, vertex editing,
// smooth shading and the collision all work on it as they do on any other shape.

import { type FaceTile, type MeshData, type MeshFace, meshBounds, mulberry32 } from './mesh';
import type { Vec3 } from './types';
import { rectUv } from './uv';

/** What makes a block a terrain: the grid it was made with. The mesh holds the actual heights. */
export interface TerrainInfo {
  /** Cells along x and along z. */
  cols: number;
  rows: number;
  /** Side of one cell in meters. */
  cell: number;
}

/** Most cells along one side of a terrain (128 x 128 = 16384 cells). */
export const MAX_TERRAIN_CELLS = 128;

/** A flat grid of `cols` x `rows` cells, centered on the origin at height 0. */
export function terrainMesh(info: TerrainInfo, tile = { x: 0, y: 0, w: 16, h: 16 }): MeshData {
  return gridMesh(info.cols, info.rows, (-info.cols * info.cell) / 2, (-info.rows * info.cell) / 2, info.cell, info.cell, tile);
}

/** A flat grid whose first vertex is at (x0, z0) and whose cells are `dx` x `dz` meters. */
function gridMesh(cols: number, rows: number, x0: number, z0: number, dx: number, dz: number, tile = { x: 0, y: 0, w: 16, h: 16 }): MeshData {
  const verts: Vec3[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) verts.push([x0 + i * dx, 0, z0 + j * dz]);
  }
  const at = (i: number, j: number) => j * (cols + 1) + i;
  const faces: MeshFace[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // counter-clockwise seen from above (normal +Y)
      faces.push({ v: [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)], uv: rectUv(tile.x, tile.y, tile.w, tile.h) });
    }
  }
  return { verts, faces };
}

/** Is this mesh still the plain grid the terrain was made with (so heights can be read by position)? */
export function isTerrainGrid(mesh: MeshData, info: TerrainInfo): boolean {
  return mesh.verts.length === (info.cols + 1) * (info.rows + 1) && mesh.faces.length === info.cols * info.rows;
}

export function sanitizeTerrainInfo(raw: unknown): TerrainInfo | undefined {
  const t = raw as Partial<TerrainInfo> | null | undefined;
  if (!t || typeof t !== 'object') return undefined;
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_TERRAIN_CELLS;
  if (!ok(t.cols) || !ok(t.rows)) return undefined;
  if (typeof t.cell !== 'number' || !(t.cell >= 0.25 && t.cell <= 16)) return undefined;
  return { cols: t.cols!, rows: t.rows!, cell: t.cell };
}

const index = (info: TerrainInfo, i: number, j: number) => j * (info.cols + 1) + i;

/** Where the grid sits in the block's own space: its first corner and the size of one cell. */
export interface TerrainFrame {
  x0: number;
  z0: number;
  dx: number;
  dz: number;
}

/**
 * Read from the vertices, not from `info.cell`: stretching the shape (the Size field, the scale tool)
 * or growing it moves the grid, and sculpting has to follow the grid as it is now.
 */
export function terrainFrame(mesh: MeshData, info: TerrainInfo): TerrainFrame {
  const first = mesh.verts[0]!;
  const lastCol = mesh.verts[info.cols]!;
  const lastRow = mesh.verts[info.rows * (info.cols + 1)]!;
  const dx = (lastCol[0] - first[0]) / info.cols;
  const dz = (lastRow[2] - first[2]) / info.rows;
  return {
    x0: first[0],
    z0: first[2],
    dx: Math.abs(dx) > 1e-9 ? dx : info.cell,
    dz: Math.abs(dz) > 1e-9 ? dz : info.cell,
  };
}

/** Height of the surface at a point in the terrain's own space (bilinear over the cell), or null outside. */
export function terrainHeightAt(mesh: MeshData, info: TerrainInfo, x: number, z: number): number | null {
  const f = terrainFrame(mesh, info);
  const gx = (x - f.x0) / f.dx;
  const gz = (z - f.z0) / f.dz;
  if (gx < 0 || gz < 0 || gx > info.cols || gz > info.rows) return null;
  const i = Math.min(info.cols - 1, Math.floor(gx));
  const j = Math.min(info.rows - 1, Math.floor(gz));
  const fx = gx - i;
  const fz = gz - j;
  const h = (a: number, b: number) => mesh.verts[index(info, a, b)]![1];
  const top = h(i, j) * (1 - fx) + h(i + 1, j) * fx;
  const bottom = h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx;
  return top * (1 - fz) + bottom * fz;
}

export type SculptMode = 'raise' | 'lower' | 'smooth' | 'flatten';

export interface SculptBrush {
  mode: SculptMode;
  /** Meters. */
  radius: number;
  /** 0..1: how much one application changes. */
  strength: number;
  /** For `flatten`: the height to pull toward. */
  level?: number;
}

/** The weight of the brush at a distance from its center: 1 in the middle, 0 at the edge, smooth in between. */
export function brushWeight(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t);
}

/**
 * Apply the brush once, centered at (x, z) in the terrain's space. Returns how many vertices moved.
 * One application raises / lowers by up to `strength` x 0.25 m at the center.
 */
export function sculpt(mesh: MeshData, info: TerrainInfo, x: number, z: number, brush: SculptBrush): number {
  const { cols, rows } = info;
  const f = terrainFrame(mesh, info);
  const reach = Math.ceil(brush.radius / Math.min(Math.abs(f.dx), Math.abs(f.dz))) + 1;
  const ci = Math.round((x - f.x0) / f.dx);
  const cj = Math.round((z - f.z0) / f.dz);
  const i0 = Math.max(0, ci - reach);
  const i1 = Math.min(cols, ci + reach);
  const j0 = Math.max(0, cj - reach);
  const j1 = Math.min(rows, cj + reach);

  // smoothing reads the heights as they were, so the result does not depend on the order
  const before: number[] = [];
  const read = (i: number, j: number) => mesh.verts[index(info, i, j)]![1];
  if (brush.mode === 'smooth') {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) before.push(read(i, j));
  }
  const old = (i: number, j: number) => before[(j - j0) * (i1 - i0 + 1) + (i - i0)]!;

  let moved = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const v = mesh.verts[index(info, i, j)]!;
      const d = Math.hypot(v[0] - x, v[2] - z);
      const w = brushWeight(d, brush.radius);
      if (w <= 0) continue;
      const k = brush.strength * w;
      switch (brush.mode) {
        case 'raise':
          v[1] += 0.25 * k;
          break;
        case 'lower':
          v[1] -= 0.25 * k;
          break;
        case 'flatten':
          v[1] += ((brush.level ?? 0) - v[1]) * Math.min(1, k * 0.6);
          break;
        case 'smooth': {
          let sum = 0;
          let n = 0;
          for (const [di, dj] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
            sum += old(ni, nj);
            n++;
          }
          if (n > 0) v[1] += (sum / n - v[1]) * Math.min(1, k * 0.8);
          break;
        }
      }
      v[1] = Math.round(v[1] * 1000) / 1000;
      moved++;
    }
  }
  return moved;
}

export interface HillOptions {
  seed: number;
  /** Highest rise in meters. */
  height: number;
  /** Width of the hills in meters (bigger = broader). */
  scale: number;
}

/** Fill the heights with rolling hills (value noise, a few octaves). Deterministic for a seed. */
export function generateHills(mesh: MeshData, opts: HillOptions): void {
  const rand = mulberry32(opts.seed);
  const lattice = 64;
  const table: number[] = Array.from({ length: lattice * lattice }, () => rand());
  const at = (ix: number, iz: number) => table[(((iz % lattice) + lattice) % lattice) * lattice + (((ix % lattice) + lattice) % lattice)]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    const a = at(ix, iz) * (1 - fx) + at(ix + 1, iz) * fx;
    const b = at(ix, iz + 1) * (1 - fx) + at(ix + 1, iz + 1) * fx;
    return a * (1 - fz) + b * fz;
  };
  const scale = Math.max(1, opts.scale);
  for (const v of mesh.verts) {
    let h = 0;
    let amp = 1;
    let freq = 1 / scale;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      h += noise(v[0] * freq + 100, v[2] * freq + 100) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    v[1] = Math.round((h / norm) * opts.height * 1000) / 1000;
  }
}

/** Put every height at `level`. */
export function flattenTerrain(mesh: MeshData, level = 0): void {
  for (const v of mesh.verts) v[1] = level;
}

/** Highest and lowest point (local space). */
export function terrainRange(mesh: MeshData): { min: number; max: number } {
  const b = meshBounds(mesh);
  return { min: b.min[1], max: b.max[1] };
}

export interface TerrainResize {
  cols: number;
  rows: number;
  /** Meters per cell; the current one when left out. */
  cell?: number;
}

/** How far outside the old ground the new ground takes to settle at the level of the old border. */
const GROW_FADE = 8;

const smooth01 = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

/**
 * A terrain of another size made from this one. What was sculpted and painted stays where it is (same spot,
 * same heights when the cells keep their size); new ground outside it settles at the level of the old
 * border over a few meters, and carries the border's paint. Returns a new mesh and info; the old ones are
 * not changed.
 */
export function resizeTerrain(mesh: MeshData, info: TerrainInfo, size: TerrainResize): { mesh: MeshData; info: TerrainInfo } {
  const f = terrainFrame(mesh, info);
  const clampCells = (n: number) => Math.min(MAX_TERRAIN_CELLS, Math.max(1, Math.round(n)));
  const cols = clampCells(size.cols);
  const rows = clampCells(size.rows);
  const cell = Math.min(16, Math.max(0.25, size.cell ?? Math.abs(f.dx)));

  // the same cell size: the old grid lines stay on the new ones, ground is added (or taken) on both sides
  const sameCells = Math.abs(cell - Math.abs(f.dx)) < 1e-4 && Math.abs(cell - Math.abs(f.dz)) < 1e-4;
  let x0: number;
  let z0: number;
  if (sameCells) {
    x0 = f.x0 - Math.floor((cols - info.cols) / 2) * cell;
    z0 = f.z0 - Math.floor((rows - info.rows) / 2) * cell;
  } else {
    // another cell size: the middle stays where it was
    x0 = f.x0 + (info.cols * f.dx) / 2 - (cols * cell) / 2;
    z0 = f.z0 + (info.rows * f.dz) / 2 - (rows * cell) / 2;
  }

  const old = (i: number, j: number) => mesh.verts[index(info, i, j)]![1];
  // the level the border has: new ground settles at it
  let borderSum = 0;
  let borderN = 0;
  for (let i = 0; i <= info.cols; i++) {
    borderSum += old(i, 0) + old(i, info.rows);
    borderN += 2;
  }
  for (let j = 1; j < info.rows; j++) {
    borderSum += old(0, j) + old(info.cols, j);
    borderN += 2;
  }
  const border = borderN > 0 ? borderSum / borderN : 0;

  const out = gridMesh(cols, rows, x0, z0, cell, cell);
  for (const v of out.verts) {
    // in old grid units
    const gx = (v[0] - f.x0) / f.dx;
    const gz = (v[2] - f.z0) / f.dz;
    const cx = Math.min(info.cols, Math.max(0, gx));
    const cz = Math.min(info.rows, Math.max(0, gz));
    const i = Math.min(info.cols - 1, Math.floor(cx));
    const j = Math.min(info.rows - 1, Math.floor(cz));
    const fx = cx - i;
    const fz = cz - j;
    const edge =
      (old(i, j) * (1 - fx) + old(i + 1, j) * fx) * (1 - fz) + (old(i, j + 1) * (1 - fx) + old(i + 1, j + 1) * fx) * fz;
    const outside = Math.hypot((gx - cx) * Math.abs(f.dx), (gz - cz) * Math.abs(f.dz));
    const h = outside === 0 ? edge : border + (edge - border) * (1 - smooth01(outside / GROW_FADE));
    v[1] = Math.round(h * 1000) / 1000;
  }

  // paint: each new cell takes the tile of the old cell under its middle (or nearest to it)
  const oldFaceAt = (i: number, j: number): FaceTile | undefined =>
    mesh.faces[Math.min(info.rows - 1, Math.max(0, j)) * info.cols + Math.min(info.cols - 1, Math.max(0, i))]?.tile;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const mx = x0 + (i + 0.5) * cell;
      const mz = z0 + (j + 0.5) * cell;
      const tile = oldFaceAt(Math.floor((mx - f.x0) / f.dx), Math.floor((mz - f.z0) / f.dz));
      if (tile) out.faces[j * cols + i]!.tile = { ...tile };
    }
  }
  return { mesh: out, info: { cols, rows, cell } };
}
