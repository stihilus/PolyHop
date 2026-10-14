// The rules the built-in models follow, taken from Hypixel Studios' "An Introduction to Making Models for Hytale"
// (December 2025). They are best practices, not law, but PolyHop's own models keep to them and this module
// checks a model against them (the Models tab shows the result, and the tests run it over every built-in model).
//
//   1. Geometry: only cubes (6 sides) and quads (2 sides). Angles are made by turning cubes or quads. No
//      triangles, wedges, pyramids, cones, cylinders, spheres, bevels, edge loops, skewed (sheared) boxes.
//   2. Proportions: small, bulky, chunky, toylike; pure iconic shapes; no thin "realistic" 1 px details.
//   3. Triangle budget by how often a model is seen: T1 ~8 (leaves, grass), T2 up to 50 (a fern, a mushroom),
//      T3 under 400 (furniture, a chest, a statue), T4 characters and bosses (about 1000).
//   4. Texture density: characters 64 px per unit, props and blocks 32 px per unit; stretching a node more
//      than 0.7x - 1.3x on an axis shows (stretched pixels).
//   5. Colors: no pure white or pure black; shadows carry color (a hint of purple), never plain grey; light,
//      shadow and ambient occlusion are painted into the texture; no noise, no perfectly flat surfaces.

import type { MeshData } from './mesh';
import type { Model, ModelCube, Vec3 } from './types';

/** The upper limits of the triangle tiers. */
export const TRIANGLE_TIERS = { t1: 8, t2: 50, t3: 400, t4: 1100 } as const;

export type StyleTier = 1 | 2 | 3 | 4;

export interface StyleProblem {
  /** Name of the shape (the cube of the model) the problem is in. */
  cube: string;
  message: string;
}

export interface StyleReport {
  /** Boxes (cubes). */
  boxes: number;
  /** Flat rectangles. */
  quads: number;
  triangles: number;
  tier: StyleTier;
  /** What breaks a rule. */
  problems: StyleProblem[];
  /** What is not wrong but against the spirit (a box so thin it should be a quad). */
  warnings: StyleProblem[];
}

const EPS = 1e-3;

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);

/** Groups of faces that share points: a mesh can hold several separate pieces. */
function components(mesh: MeshData): number[][] {
  const parent = mesh.verts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const f of mesh.faces) for (let i = 1; i < f.v.length; i++) parent[find(f.v[i]!)] = find(f.v[0]!);
  const groups = new Map<number, number[]>();
  mesh.faces.forEach((f, fi) => {
    const root = find(f.v[0]!);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(fi);
  });
  return [...groups.values()];
}

/** The three side lengths of a rectangle's corner, or null when the four points are not a rectangle. */
function rectangleSize(p: V[]): [number, number] | null {
  if (p.length !== 4) return null;
  const a = sub(p[1]!, p[0]!);
  const b = sub(p[3]!, p[0]!);
  const c = sub(p[2]!, p[1]!);
  const d = sub(p[2]!, p[3]!);
  const la = len(a);
  const lb = len(b);
  if (la < EPS || lb < EPS) return null;
  const right = Math.abs(dot(a, b)) / (la * lb) < 0.01;
  const parallel = len(sub(a, d)) < EPS * 10 && len(sub(b, c)) < EPS * 10;
  return right && parallel ? [la, lb] : null;
}

/** Is this piece a box: 8 points, 6 rectangles, edges at right angles (it may be turned, but not skewed or tapered)? */
function boxSize(mesh: MeshData, faces: number[]): V | null {
  if (faces.length !== 6) return null;
  const ids = new Set<number>();
  for (const fi of faces) {
    const f = mesh.faces[fi]!;
    if (f.v.length !== 4) return null;
    for (const v of f.v) ids.add(v);
  }
  if (ids.size !== 8) return null;
  const pts = [...ids].map((i) => mesh.verts[i]!);
  const origin = pts[0]!;
  // the three edges from one corner: the points that share a face edge with it
  const first = [...ids][0]!;
  const near = new Set<number>();
  for (const fi of faces) {
    const f = mesh.faces[fi]!;
    const at = f.v.indexOf(first);
    if (at >= 0) {
      near.add(f.v[(at + 1) % 4]!);
      near.add(f.v[(at + 3) % 4]!);
    }
  }
  if (near.size !== 3) return null;
  const e = [...near].map((i) => sub(mesh.verts[i]!, origin));
  const l = e.map(len);
  if (l.some((x) => x < EPS)) return null;
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (Math.abs(dot(e[i]!, e[j]!)) / (l[i]! * l[j]!) > 0.01) return null;
    }
  }
  // all 8 points are the corner plus a sum of the edges
  for (const p of pts) {
    const d = sub(p, origin);
    let ok = false;
    for (let mask = 0; mask < 8 && !ok; mask++) {
      const t: V = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (mask & (1 << k)) {
          t[0] += e[k]![0];
          t[1] += e[k]![1];
          t[2] += e[k]![2];
        }
      }
      ok = len(sub(d, t)) < EPS * 10;
    }
    if (!ok) return null;
  }
  return [l[0]!, l[1]!, l[2]!];
}

/** Triangles of a mesh (a face of n points is n - 2 triangles; a box is 12, a quad 2). */
export function triangleCount(mesh: MeshData): number {
  let n = 0;
  for (const f of mesh.faces) n += Math.max(0, f.v.length - 2);
  return n;
}

function tierOf(triangles: number): StyleTier {
  if (triangles <= TRIANGLE_TIERS.t1) return 1;
  if (triangles <= TRIANGLE_TIERS.t2) return 2;
  if (triangles <= TRIANGLE_TIERS.t3) return 3;
  return 4;
}

/** What is wrong with a shape that is neither a box nor a quad, in words. */
function describe(mesh: MeshData, faces: number[]): string {
  const sides = faces.map((fi) => mesh.faces[fi]!.v.length);
  if (sides.some((s) => s === 3)) return 'has triangles (a wedge, a pyramid or a cone): build angles by turning cubes or quads';
  if (faces.length > 6) return 'has many faces (a cylinder, a sphere or a bevel): use cubes, and turn them to make angles';
  if (faces.length === 6) return 'is skewed or tapered: a cube keeps its sides parallel and at right angles';
  return 'is not a cube or a flat quad';
}

/** Thickness (in meters of the model) under which a cube is a quad pretending: one texel of a prop (32 px per unit). */
export const THIN_PROP = 1 / 32;
/** The same for a character, which is drawn with twice the density (64 px per unit). */
export const THIN_CHARACTER = 1 / 64;

/** A model with a skeleton of a body (a humanoid): its cubes may be as thin as a texel of a character. */
export function isCharacterModel(model: Pick<Model, 'bones'>): boolean {
  return model.bones.length >= 12;
}

/** A shape made of one or more cubes and quads only? Report the pieces and what breaks the rules. */
export function checkCube(
  cube: Pick<ModelCube, 'name' | 'mesh'>,
  thin: number = THIN_PROP,
): { boxes: number; quads: number; triangles: number; problems: StyleProblem[]; warnings: StyleProblem[] } {
  const out = { boxes: 0, quads: 0, triangles: triangleCount(cube.mesh), problems: [] as StyleProblem[], warnings: [] as StyleProblem[] };
  for (const piece of components(cube.mesh)) {
    const size = boxSize(cube.mesh, piece);
    if (size) {
      out.boxes++;
      // a box thinner than one texel is a quad pretending
      if (Math.min(...size) < thin * 0.95) out.warnings.push({ cube: cube.name, message: 'is thinner than one pixel of its texture: make it a quad' });
      continue;
    }
    if (piece.length === 1) {
      const f = cube.mesh.faces[piece[0]!]!;
      if (rectangleSize(f.v.map((i) => cube.mesh.verts[i]!))) {
        out.quads++;
        continue;
      }
    }
    out.problems.push({ cube: cube.name, message: describe(cube.mesh, piece) });
  }
  return out;
}

/** Check a whole model against the rules of the guide. */
export function checkModel(model: Pick<Model, 'cubes'> & { bones?: Model['bones'] }): StyleReport {
  const report: StyleReport = { boxes: 0, quads: 0, triangles: 0, tier: 1, problems: [], warnings: [] };
  const thin = model.bones && isCharacterModel({ bones: model.bones }) ? THIN_CHARACTER : THIN_PROP;
  for (const c of model.cubes) {
    const r = checkCube(c, thin);
    report.boxes += r.boxes;
    report.quads += r.quads;
    report.triangles += r.triangles;
    report.problems.push(...r.problems);
    report.warnings.push(...r.warnings);
  }
  report.tier = tierOf(report.triangles);
  return report;
}

/** "Tier 3 · under 400 triangles". */
export function tierLabel(tier: StyleTier): string {
  switch (tier) {
    case 1:
      return 'T1 · hyper-used (about 8 triangles)';
    case 2:
      return 'T2 · common (up to 50 triangles)';
    case 3:
      return 'T3 · rare (under 400 triangles)';
    default:
      return 'T4 · epic (characters and bosses, about 1000 triangles)';
  }
}
