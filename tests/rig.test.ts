import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { importRigJson } from '../src/core/blockbench';
import {
  HUMANOID_FEMALE_ID,
  HUMANOID_FEMALE_SKIN,
  HUMANOID_ID,
  HUMANOID_SKIN,
  HUMANOID_SKINS,
  anchorOf,
  createHumanoidModel,
  cubeWorldPoints,
  refreshHumanoidLayout,
  skinForBuild,
} from '../src/core/humanoid';
import { blendPoses, boneMatrices, orderedBones, rotateInParent, sampleClip, sampleKeys } from '../src/core/rig';
import { type AnimationClip, type Bone, PROJECT_VERSION, cloneModel, createDefaultProject, normalizeModel, normalizeProject } from '../src/core/types';

let n = 0;
const ids = () => `t${++n}`;

describe('rig math', () => {
  it('interpolates keyframes and clamps at the ends', () => {
    const keys = [
      { t: 0, v: [0, 0, 0] as [number, number, number] },
      { t: 1, v: [10, 20, 30] as [number, number, number] },
    ];
    expect(sampleKeys(keys, 0.5)).toEqual([5, 10, 15]);
    expect(sampleKeys(keys, -3)).toEqual([0, 0, 0]);
    expect(sampleKeys(keys, 9)).toEqual([10, 20, 30]);
    expect(sampleKeys(undefined, 0)).toBeNull();
  });

  it('loops looping clips and holds the end of the others', () => {
    const clip: AnimationClip = {
      id: 'c',
      name: 'c',
      duration: 2,
      loop: true,
      tracks: { A: { rot: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [20, 0, 0] }] } },
    };
    expect(sampleClip(clip, 1).get('A')!.rot[0]).toBeCloseTo(10);
    expect(sampleClip(clip, 3).get('A')!.rot[0]).toBeCloseTo(10); // wrapped
    expect(sampleClip({ ...clip, loop: false }, 5).get('A')!.rot[0]).toBeCloseTo(20);
  });

  it('blends poses, treating a missing bone as rest', () => {
    const a = new Map([['X', { rot: [10, 0, 0] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }]]);
    const b = new Map([['Y', { rot: [0, 30, 0] as [number, number, number], pos: [0, 1, 0] as [number, number, number] }]]);
    const m = blendPoses(a, b, 0.5);
    expect(m.get('X')!.rot[0]).toBeCloseTo(5);
    expect(m.get('Y')!.rot[1]).toBeCloseTo(15);
    expect(m.get('Y')!.pos[1]).toBeCloseTo(0.5);
  });

  it('orders parents before children and survives cycles', () => {
    const bones: Bone[] = [
      { id: 'c', name: 'c', parent: 'b', pivot: [0, 0, 0] },
      { id: 'b', name: 'b', parent: 'a', pivot: [0, 0, 0] },
      { id: 'a', name: 'a', parent: null, pivot: [0, 0, 0] },
    ];
    expect(orderedBones(bones).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    const loop: Bone[] = [
      { id: 'x', name: 'x', parent: 'y', pivot: [0, 0, 0] },
      { id: 'y', name: 'y', parent: 'x', pivot: [0, 0, 0] },
    ];
    expect(orderedBones(loop)).toHaveLength(2);
  });

  it('rotates a child about its own pivot and carries it with the parent', () => {
    const bones: Bone[] = [
      { id: 'a', name: 'A', parent: null, pivot: [0, 1, 0] },
      { id: 'b', name: 'B', parent: 'a', pivot: [0, 2, 0] },
    ];
    const pose = new Map([['A', { rot: [0, 0, 90] as [number, number, number], pos: [0, 0, 0] as [number, number, number] }]]);
    const m = boneMatrices(orderedBones(bones), pose);
    // a point on the tip of B (0, 3, 0) turns about A's pivot (0, 1, 0): 90 degrees about Z puts it at (-2, 1, 0)
    const p = new THREE.Vector3(0, 3, 0).applyMatrix4(m.get('b')!);
    expect(p.x).toBeCloseTo(-2);
    expect(p.y).toBeCloseTo(1);
    // no pose: everything stays at rest
    const rest = boneMatrices(orderedBones(bones), new Map());
    expect(new THREE.Vector3(0, 3, 0).applyMatrix4(rest.get('b')!).y).toBeCloseTo(3);
  });
});

describe('gizmo rotation', () => {
  const q = (axis: [number, number, number], deg: number) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), (deg * Math.PI) / 180);

  it('turns a bone about the world axis when the parent is not rotated', () => {
    const r = rotateInParent([0, 0, 0], new THREE.Quaternion(), q([1, 0, 0], 30));
    expect(r[0]).toBeCloseTo(30);
    expect(r[1]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(0);
  });

  it('expresses the turn in the parent frame', () => {
    // parent turned 90 degrees about Y: the world X axis is the parent's local Z axis
    const r = rotateInParent([0, 0, 0], q([0, 1, 0], 90), q([1, 0, 0], 30));
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(30);
  });

  it('adds to the rotation the bone already has', () => {
    const r = rotateInParent([20, 0, 0], new THREE.Quaternion(), q([1, 0, 0], 15));
    expect(r[0]).toBeCloseTo(35);
  });

  it('stays on the same turn instead of flipping by 360 degrees', () => {
    const r = rotateInParent([175, 0, 0], new THREE.Quaternion(), q([1, 0, 0], 10));
    expect(r[0]).toBeCloseTo(185);
  });
});

describe('rig import', () => {
  const doc = {
    textureWidth: 64,
    textureHeight: 32,
    elements: [
      {
        name: 'Root',
        from: [0, 0, 0],
        to: [0, 0, 0],
        children: [
          {
            name: 'Torso',
            from: [-2, 0, 0],
            to: [0, 4, 6],
            rotationOrigin: [0, 0, 0],
            faces: { north: { uv: [0, 0, 6, 4] }, south: { uv: [6, 0, 12, 4] }, west: { uv: [12, 0, 14, 4] }, east: { uv: [14, 0, 16, 4] }, up: { uv: [0, 4, 6, 6] }, down: { uv: [6, 4, 12, 6] } },
            children: [{ name: 'Arm', from: [0, -3, 0], to: [2, 0, 2], rotationOrigin: [1, 0, 1], rotationZ: 90, faces: { north: { uv: [20, 0, 22, 3] } } }],
          },
          { name: 'Eye', from: [-2.1, 2, 1], to: [-2.1, 3, 2], faces: { north: { uv: [30, 5, 32, 7] }, south: { uv: [0, 0, 1, 1] } } },
        ],
      },
    ],
  };

  it('keeps the hierarchy and makes one bone per element', () => {
    const { model, textureWidth, textureHeight } = importRigJson(doc, { scale: 1, idGen: ids });
    expect([textureWidth, textureHeight]).toEqual([64, 32]);
    const byName = new Map(model.bones.map((b) => [b.name, b] as const));
    expect([...byName.keys()].sort()).toEqual(['Arm', 'Eye', 'Root', 'Torso']);
    expect(byName.get('Torso')!.parent).toBe(byName.get('Root')!.id);
    expect(byName.get('Arm')!.parent).toBe(byName.get('Torso')!.id);
    // the empty root has a bone but no cube
    expect(model.cubes.map((c) => c.name).sort()).toEqual(['Arm', 'Eye', 'Torso']);
    expect(model.cubes.find((c) => c.name === 'Torso')!.bone).toBe(byName.get('Torso')!.id);
  });

  it('turns the character to face +Z, stands it on the ground and centers it', () => {
    const { model } = importRigJson(doc, { scale: 1, idGen: ids });
    const pts = model.cubes.flatMap((c) => cubeWorldPoints(c));
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(0);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[2]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0);
    expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(0);
    // the torso is 6 wide along file Z => along our X, and 2 deep along file X => along our Z
    const torso = cubeWorldPoints(model.cubes.find((c) => c.name === 'Torso')!);
    const tx = torso.map((p) => p[0]);
    const tz = torso.map((p) => p[2]);
    expect(Math.max(...tx) - Math.min(...tx)).toBeCloseTo(6);
    expect(Math.max(...tz) - Math.min(...tz)).toBeCloseTo(2);
  });

  it('puts file -X (the front) at our +Z', () => {
    const { model } = importRigJson(doc, { scale: 1, idGen: ids });
    const torso = model.cubes.find((c) => c.name === 'Torso')!;
    const eye = model.cubes.find((c) => c.name === 'Eye')!;
    const eyeZ = cubeWorldPoints(eye)[0]![2];
    const torsoMaxZ = Math.max(...cubeWorldPoints(torso).map((p) => p[2]));
    expect(eyeZ).toBeGreaterThan(torsoMaxZ); // the eye plane sits in front of the torso
  });

  it('a flat element becomes a single face with the real UV', () => {
    const { model } = importRigJson(doc, { scale: 1, idGen: ids });
    const eye = model.cubes.find((c) => c.name === 'Eye')!;
    expect(eye.mesh.faces).toHaveLength(1);
    const xs = eye.mesh.faces[0]!.uv.map((p) => p[0]);
    expect(Math.min(...xs)).toBe(30);
    expect(Math.max(...xs)).toBe(32);
  });

  it('applies the rest rotation of a child about its pivot', () => {
    const { model } = importRigJson(doc, { scale: 1, idGen: ids });
    const arm = model.cubes.find((c) => c.name === 'Arm')!;
    // 90 degrees about the file Z axis (= our X axis) lays the hanging arm down
    const pts = cubeWorldPoints(arm);
    const ys = pts.map((p) => p[1]);
    const zs = pts.map((p) => p[2]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2, 3);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(3, 3);
  });

  it('can fit the model to a height', () => {
    const { model } = importRigJson(doc, { fitHeight: 2, idGen: ids });
    const ys = model.cubes.flatMap((c) => cubeWorldPoints(c).map((p) => p[1]));
    expect(Math.max(...ys)).toBeCloseTo(2);
  });

  it('refuses a file without elements', () => {
    expect(() => importRigJson({}, { scale: 1, idGen: ids })).toThrow(/no elements/);
  });
});

describe.each([
  ['male', HUMANOID_ID],
  ['female', HUMANOID_FEMALE_ID],
])('the built-in humanoid (%s)', (_label, builtId) => {
  const model = createHumanoidModel(ids, builtId);
  const names = new Set(model.bones.map((b) => b.name));

  it('has the parts of the template and a spine / limb hierarchy', () => {
    for (const part of ['Root', 'Hips', 'Waist', 'Chest', 'Neck', 'Head', 'RightEar', 'RightUpperArm', 'RightForearm', 'RightHand', 'RightThigh', 'RightShin', 'RightFoot', 'LeftUpperArm', 'LeftHand', 'LeftFoot']) {
      expect(names.has(part)).toBe(true);
    }
    const parentOf = (n: string) => model.bones.find((b) => b.id === model.bones.find((x) => x.name === n)!.parent)?.name;
    expect(parentOf('Head')).toBe('Neck');
    expect(parentOf('Neck')).toBe('Chest');
    expect(parentOf('Chest')).toBe('Waist');
    expect(parentOf('Waist')).toBe('Hips');
    expect(parentOf('Hips')).toBe('Root');
    expect(parentOf('RightUpperArm')).toBe('Chest');
    expect(parentOf('RightForearm')).toBe('RightUpperArm');
    expect(parentOf('LeftFoot')).toBe('LeftShin');
    expect(parentOf('LeftShin')).toBe('LeftThigh');
    expect(parentOf('RightEar')).toBe('Head');
  });

  it('is one meter tall, stands on the ground and faces +Z', () => {
    const pts = model.cubes.flatMap((c) => cubeWorldPoints(c));
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
    expect(Math.max(...ys)).toBeCloseTo(1, 3);
    // the front of the character is +Z: the feet reach further forward than the heels, and the head is not in front of them
    const foot = model.cubes.find((c) => c.name === 'LeftFoot')!;
    const toeZ = Math.max(...cubeWorldPoints(foot).map((p) => p[2]));
    const heelZ = Math.min(...cubeWorldPoints(foot).map((p) => p[2]));
    expect(toeZ).toBeGreaterThan(Math.abs(heelZ) * 2);
  });

  it('has no nose, and its hair is made of parts that follow the head', () => {
    expect(model.cubes.some((c) => c.name === 'Nose')).toBe(false);
    expect(names.has('Nose')).toBe(false);
    const head = model.bones.find((b) => b.name === 'Head')!;
    const headCube = model.cubes.find((c) => c.name === 'Head')!;
    const extent = (c: typeof headCube, axis: 0 | 1 | 2) => {
      const v = cubeWorldPoints(c).map((p) => p[axis]);
      return [Math.min(...v), Math.max(...v)] as const;
    };
    for (const part of ['HairCap', 'HairBack']) {
      const cube = model.cubes.find((c) => c.name === part)!;
      expect(cube, part).toBeDefined();
      expect(cube.bone).toBe(head.id);
    }
    // the cap sits over the top of the head, the back of the hair reaches behind it
    expect(extent(model.cubes.find((c) => c.name === 'HairCap')!, 1)[1]).toBeGreaterThan(extent(headCube, 1)[1]);
    expect(extent(model.cubes.find((c) => c.name === 'HairBack')!, 2)[0]).toBeLessThan(extent(headCube, 2)[0]);
  });

  it('has a big head: about a quarter of the body', () => {
    const head = model.cubes.find((c) => c.name === 'Head')!;
    const ys = cubeWorldPoints(head).map((p) => p[1]);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(height).toBeGreaterThan(0.22);
    expect(height).toBeLessThan(0.3);
  });

  it('puts joints where limbs bend', () => {
    const bone = (n: string) => model.bones.find((b) => b.name === n)!;
    const upperArm = model.cubes.find((c) => c.name === 'RightUpperArm')!;
    const top = Math.max(...cubeWorldPoints(upperArm).map((p) => p[1]));
    expect(bone('RightUpperArm').pivot[1]).toBeCloseTo(top, 2);
    // right side of the character is -X
    expect(bone('RightUpperArm').pivot[0]).toBeLessThan(0);
    expect(bone('LeftUpperArm').pivot[0]).toBeGreaterThan(0);
    // knees and elbows bend at the top of the part below
    const shin = model.cubes.find((c) => c.name === 'LeftShin')!;
    expect(bone('LeftShin').pivot[1]).toBeCloseTo(Math.max(...cubeWorldPoints(shin).map((p) => p[1])), 2);
    const head = model.cubes.find((c) => c.name === 'Head')!;
    expect(bone('Head').pivot[1]).toBeCloseTo(anchorOf(head, 'bottom')[1], 5);
  });

  it('ships clips for every state the player can be in, each driving existing bones', () => {
    const clipNames = model.clips.map((c) => c.name).sort();
    expect(clipNames).toEqual(['crouch', 'crouch_walk', 'fall', 'glide', 'idle', 'jump', 'run', 'swim', 'walk']);
    for (const clip of model.clips) {
      expect(clip.duration).toBeGreaterThan(0);
      for (const bone of Object.keys(clip.tracks)) expect(names.has(bone)).toBe(true);
    }
    // looping gaits start and end on the same pose
    for (const name of ['walk', 'run', 'idle']) {
      const clip = model.clips.find((c) => c.name === name)!;
      const first = sampleClip(clip, 0);
      const last = sampleClip(clip, clip.duration - 1e-6);
      for (const [bone, p] of first) expect(last.get(bone)!.rot[0]).toBeCloseTo(p.rot[0], 1);
    }
  });

  it('swings opposite legs and arms when walking', () => {
    const walk = model.clips.find((c) => c.name === 'walk')!;
    const p = sampleClip(walk, walk.duration * 0.25);
    expect(p.get('RightThigh')!.rot[0] * p.get('LeftThigh')!.rot[0]).toBeLessThan(0);
    // the arm on a side swings against the leg on that side
    expect(p.get('RightThigh')!.rot[0] * p.get('RightUpperArm')!.rot[0]).toBeLessThan(0);
    expect(p.get('LeftThigh')!.rot[0] * p.get('LeftUpperArm')!.rot[0]).toBeLessThan(0);
  });

  it('keeps every face UV inside the 128 px skin, and every face has a place of its own', () => {
    for (const c of model.cubes) {
      for (const f of c.mesh.faces) {
        for (const [u, v] of f.uv) {
          expect(u).toBeGreaterThanOrEqual(0);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(u).toBeLessThanOrEqual(128);
          expect(v).toBeLessThanOrEqual(128);
        }
      }
    }
  });

  it('lays the faces out on the skin without overlaps (shared rectangles excepted)', () => {
    const rects = new Map<string, [number, number, number, number]>();
    for (const c of model.cubes) {
      for (const f of c.mesh.faces) {
        const xs = f.uv.map((p) => p[0]);
        const ys = f.uv.map((p) => p[1]);
        const r: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        rects.set(r.join(','), r);
      }
    }
    const list = [...rects.values()];
    expect(list.length).toBeGreaterThan(60);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        expect(w > 0 && h > 0, `${a} overlaps ${b}`).toBe(false);
      }
    }
  });

  it('is part of every new project, with the right skin and id', () => {
    const p = createDefaultProject();
    expect(p.player.modelId).toBe(HUMANOID_ID);
    const m = p.models.find((x) => x.id === builtId)!;
    expect(m.texture).toBe(builtId === HUMANOID_ID ? HUMANOID_SKIN : HUMANOID_FEMALE_SKIN);
    expect(m.texture).toBe(HUMANOID_SKINS[builtId]![0]);
    expect(m.bones.length).toBeGreaterThan(18);
  });
});

describe('the two builds of the character', () => {
  const male = createHumanoidModel(ids, HUMANOID_ID);
  const female = createHumanoidModel(ids, HUMANOID_FEMALE_ID);

  it('share their bones, so every animation fits both', () => {
    expect(female.bones.map((b) => b.name)).toEqual(male.bones.map((b) => b.name));
    expect(female.clips.map((c) => c.name)).toEqual(male.clips.map((c) => c.name));
    expect(female.id).not.toBe(male.id);
  });

  it('differ in build: narrower shoulders and a narrower waist, wider hips (relative to the shoulders), long hair', () => {
    const width = (m: typeof male, part: string) => {
      const xs = m.cubes.find((c) => c.name === part)!.mesh.verts.map((v) => v[0]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(female, 'Chest')).toBeLessThan(width(male, 'Chest'));
    expect(width(female, 'Waist')).toBeLessThan(width(male, 'Waist'));
    expect(width(female, 'Hips') / width(female, 'Chest')).toBeGreaterThan(width(male, 'Hips') / width(male, 'Chest'));
    const hairDrop = (m: typeof male) => Math.min(...m.cubes.find((c) => c.name === 'HairBack')!.mesh.verts.map((v) => v[1]));
    expect(hairDrop(female)).toBeLessThan(hairDrop(male) - 0.1);
    expect(female.cubes.some((c) => c.name === 'LeftHairLock')).toBe(true);
    expect(male.cubes.some((c) => c.name === 'LeftHairLock')).toBe(false);
  });

  it('are both one meter tall and stand on the ground', () => {
    for (const m of [male, female]) {
      const ys = m.cubes.flatMap((c) => cubeWorldPoints(c).map((p) => p[1]));
      expect(Math.min(...ys)).toBeCloseTo(0, 3);
      expect(Math.max(...ys)).toBeCloseTo(1, 3);
    }
  });

  it('carry the skin along when a project changes from one build to the other', () => {
    expect(skinForBuild(HUMANOID_SKIN, HUMANOID_FEMALE_ID)).toBe('Character-Female-Skin.png');
    expect(skinForBuild('Character-Explorer.png', HUMANOID_FEMALE_ID)).toBe('Character-Female-Explorer.png');
    expect(skinForBuild('Character-Female-Template.png', HUMANOID_ID)).toBe('Character-Template.png');
    // the same build: unchanged; no skin: still the model's own; a skin of the user's: kept
    expect(skinForBuild('Character-Explorer.png', HUMANOID_ID)).toBe('Character-Explorer.png');
    expect(skinForBuild(null, HUMANOID_FEMALE_ID)).toBeNull();
    expect(skinForBuild('My-Skin.png', HUMANOID_FEMALE_ID)).toBe('My-Skin.png');
  });
});

describe('model data with bones', () => {
  it('survives normalization and drops dangling bone references', () => {
    const m = createHumanoidModel(ids);
    const back = normalizeModel(JSON.parse(JSON.stringify(m)));
    expect(back.bones).toHaveLength(m.bones.length);
    expect(back.clips).toHaveLength(m.clips.length);
    expect(back.cubes.every((c) => c.bone === null || back.bones.some((b) => b.id === c.bone))).toBe(true);
    const broken = normalizeModel({ ...JSON.parse(JSON.stringify(m)), bones: [{ id: 'only', name: 'Only', parent: 'ghost', pivot: [0, 0, 0] }] });
    expect(broken.bones[0]!.parent).toBeNull();
    expect(broken.cubes.every((c) => c.bone === null)).toBe(true);
  });

  it('cloning gives new bone ids and keeps cubes pointing at the copies', () => {
    const m = createHumanoidModel(ids);
    const copy = cloneModel(m);
    expect(copy.id).not.toBe(m.id);
    const old = new Set(m.bones.map((b) => b.id));
    expect(copy.bones.every((b) => !old.has(b.id))).toBe(true);
    expect(copy.cubes.every((c) => c.bone === null || copy.bones.some((b) => b.id === c.bone))).toBe(true);
    expect(copy.bones.filter((b) => b.parent).every((b) => copy.bones.some((x) => x.id === b.parent))).toBe(true);
  });

  it('old projects get the humanoid exactly once and a body that fits it', () => {
    const base = createDefaultProject().player;
    const old = { version: 1, player: { modelId: null, width: 0.8, crouchHeight: 0.5 }, models: [] };
    const p = normalizeProject(old);
    expect(p.player.modelId).toBe(HUMANOID_ID);
    expect(p.player.width).toBe(base.width);
    expect(p.player.crouchHeight).toBe(base.crouchHeight);
    expect(p.models.filter((m) => m.id === HUMANOID_ID)).toHaveLength(1);
    // saved again as the current version: choosing the cube is respected
    const cube = normalizeProject({ ...JSON.parse(JSON.stringify(p)), player: { ...p.player, modelId: null } });
    expect(cube.player.modelId).toBeNull();
    // a user's own size stays
    expect(normalizeProject({ version: 1, player: { modelId: null, width: 0.9 } }).player.width).toBe(0.9);
  });

  it('players of the 1 m era grow to 1.8 m, unless the size was changed', () => {
    const base = createDefaultProject().player;
    expect(base.height).toBe(1.8);
    const grown = normalizeProject({ version: 3, player: { height: 1, width: 0.5, crouchHeight: 0.65, cameraDistance: 4.5 } }).player;
    expect([grown.height, grown.width, grown.crouchHeight, grown.cameraDistance]).toEqual([1.8, 0.6, 1.1, 6.5]);
    const mine = normalizeProject({ version: 3, player: { height: 1.4, width: 0.45, crouchHeight: 0.7, cameraDistance: 5 } }).player;
    expect([mine.height, mine.width, mine.crouchHeight, mine.cameraDistance]).toEqual([1.4, 0.45, 0.7, 5]);
    expect(normalizeProject({ version: 4, player: { height: 1 } }).player.height).toBe(1);
  });

  it('an older project gets the rebuilt humanoid, its skin by the new name and its worn things on the new bones', () => {
    const fresh = createHumanoidModel(ids);
    const saved = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
    // what a project of the first versions held: other bone names and parts
    saved.bones = saved.bones.map((b) => ({ ...b, name: b.name === 'RightUpperArm' ? 'RightShoulder' : b.name }));
    saved.cubes = saved.cubes.filter((c) => c.name !== 'HairCap');
    const p = normalizeProject({
      version: 10,
      player: { modelId: HUMANOID_ID, skin: 'Humanoid-Hero.png', attachments: [{ modelId: 'hat', bone: 'RightShoulder', offset: [0, 0, 0], scale: 1 }] },
      models: [saved],
    });
    const h = p.models.find((m) => m.id === HUMANOID_ID)!;
    expect(h.cubes.some((c) => c.name === 'HairCap')).toBe(true);
    expect(h.bones.some((b) => b.name === 'RightUpperArm')).toBe(true);
    expect(h.bones.some((b) => b.name === 'RightShoulder')).toBe(false);
    expect(p.player.skin).toBe('Character-Explorer.png');
    expect(p.player.attachments[0]!.bone).toBe('RightUpperArm');
    expect(normalizeProject({ version: 10, player: { modelId: HUMANOID_ID, skin: 'Humanoid-Skin.png' }, models: [saved] }).player.skin).toBeNull();
    // a project of the current version is left alone
    const again = normalizeProject({ version: PROJECT_VERSION, player: { modelId: HUMANOID_ID }, models: [saved] });
    expect(again.models.find((m) => m.id === HUMANOID_ID)!.cubes.some((c) => c.name === 'HairCap')).toBe(false);
  });

  it('a project of version 11 gets the nose-less humanoid, the female build and its worn things on the head', () => {
    const fresh = createHumanoidModel(ids);
    const saved = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
    saved.cubes = saved.cubes.filter((c) => c.name !== 'HairCap' && c.name !== 'HairBack');
    const p = normalizeProject({
      version: 11,
      player: { modelId: HUMANOID_ID, skin: 'Character-Explorer.png', attachments: [{ modelId: 'hat', bone: 'Nose', offset: [0, 0, 0], scale: 1 }] },
      models: [saved],
    });
    expect(p.models.find((m) => m.id === HUMANOID_ID)!.cubes.some((c) => c.name === 'HairCap')).toBe(true);
    expect(p.models.some((m) => m.id === HUMANOID_FEMALE_ID)).toBe(true);
    expect(p.models.filter((m) => m.id === HUMANOID_ID)).toHaveLength(1);
    expect(p.player.attachments[0]!.bone).toBe('Head');
    expect(p.player.skin).toBe('Character-Explorer.png');
  });

  it('can still copy the UVs of a layout onto a saved humanoid (a helper for older layouts)', () => {
    const fresh = createHumanoidModel(ids);
    const saved = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
    for (const cube of saved.cubes) for (const f of cube.mesh.faces) f.uv = f.uv.map(([u, v]) => [u + 7, v + 3] as [number, number]);
    saved.cubes.find((c) => c.name === 'Head')!.position = [0, 5, 0];
    refreshHumanoidLayout(saved, fresh);
    const head = saved.cubes.find((c) => c.name === 'Head')!;
    expect(head.mesh.faces[0]!.uv).toEqual(fresh.cubes.find((c) => c.name === 'Head')!.mesh.faces[0]!.uv);
    expect(head.position).toEqual([0, 5, 0]);
  });

  it('keeps and validates attachments', () => {
    const p = normalizeProject({
      version: 2,
      player: { attachments: [{ modelId: 'hat', bone: 'Head', offset: [0, 1, 0], scale: 2 }, { modelId: 5 }, null] },
    });
    expect(p.player.attachments).toHaveLength(1);
    expect(p.player.attachments[0]).toMatchObject({ modelId: 'hat', bone: 'Head', offset: [0, 1, 0], rotation: [0, 0, 0], scale: 2 });
  });
});

describe('skeleton helpers', () => {
  it('renames a bone everywhere its name is used', async () => {
    const { renameBoneInModel } = await import('../src/core/rig');
    const m = createHumanoidModel(ids);
    const head = m.bones.find((b) => b.name === 'Head')!;
    const before = m.clips.filter((c) => c.tracks.Head).length;
    expect(before).toBeGreaterThan(0);
    expect(renameBoneInModel(m, head.id, '  Skull ')).toBe('Head');
    expect(head.name).toBe('Skull');
    expect(m.clips.filter((c) => c.tracks.Skull)).toHaveLength(before);
    expect(m.clips.some((c) => c.tracks.Head)).toBe(false);
  });

  it('refuses an empty or a taken name', async () => {
    const { renameBoneInModel } = await import('../src/core/rig');
    const m = createHumanoidModel(ids);
    const head = m.bones.find((b) => b.name === 'Head')!;
    expect(renameBoneInModel(m, head.id, '   ')).toBeNull();
    expect(renameBoneInModel(m, head.id, 'Neck')).toBeNull();
    expect(head.name).toBe('Head');
  });

  it('gives a plain model one bone per shape, pivoting at each shape origin', async () => {
    const { createSkeleton } = await import('../src/core/rig');
    const { createCube, createModel } = await import('../src/core/types');
    const model = createModel('Door', null);
    model.cubes[0]!.name = 'Frame';
    model.cubes.push(createCube('Panel', [1, 0.5, 0], [1, 1, 0.1]));
    expect(model.bones).toHaveLength(0);
    const bones = createSkeleton(model, 'per-shape', ids);
    expect(bones.map((b) => b.name)).toEqual(['Frame', 'Panel']);
    expect(model.cubes.map((c) => c.bone)).toEqual(bones.map((b) => b.id));
    expect(bones[1]!.pivot).toEqual([1, 0.5, 0]);
  });

  it('gives a plain model a single root bone at the middle of its bounds', async () => {
    const { createSkeleton, boneAnchor } = await import('../src/core/rig');
    const { createCube, createModel } = await import('../src/core/types');
    const model = createModel('Coin', null);
    model.cubes[0] = createCube('Disc', [0, 1, 0], [1, 0.2, 1]);
    const [root] = createSkeleton(model, 'single', ids);
    expect(root!.name).toBe('Root');
    expect(root!.pivot[1]).toBeCloseTo(1);
    expect(model.cubes[0]!.bone).toBe(root!.id);
    expect(boneAnchor(model, root!.id, 'top')![1]).toBeCloseTo(1.1);
    expect(boneAnchor(model, root!.id, 'bottom')![1]).toBeCloseTo(0.9);
    expect(boneAnchor(model, 'nothing', 'center')).toBeNull();
  });

  it('keeps unique names when a model already has bones', async () => {
    const { createSkeleton } = await import('../src/core/rig');
    const { createModel } = await import('../src/core/types');
    const model = createModel('M', null);
    createSkeleton(model, 'single', ids);
    createSkeleton(model, 'single', ids);
    expect(model.bones.map((b) => b.name)).toEqual(['Root', 'Root 2']);
  });
});
