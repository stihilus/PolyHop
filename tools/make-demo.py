#!/usr/bin/env python3
"""Makes the assets of the demo project:

  assets/textures/Demo-16.png      a small atlas: gold and blue crystal, ruin stone, runes, spikes, moss
  assets/models/*.json             irregular low-poly models (a star crystal, a crystal cluster, a broken column,
                                   a patch of spikes): plain Model JSON, loaded by src/core/assetModels.ts
  assets/demo/splash.png           the title picture of the demo

Everything is drawn or built from numbers, so it can be made again: run from the project root

    python3 tools/make-demo.py
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from pixel_helpers import Atlas, T, shade  # noqa: E402

# ---------------------------------------------------------------- the atlas
NAMES = ["gem-gold", "gem-light", "crystal-blue", "crystal-teal", "ruin-stone", "ruin-rune", "spike-bone", "spike-dark", "moss", "glow"]
COLS = 8
atlas = Atlas(NAMES, cols=COLS, seed=5)


def facets(t, base, light, dark):
    """Crystal facets: a bright diagonal streak, a darker lower corner, a few sparkles."""
    t.fill(base, noise=7)
    for i in range(T):
        t.put(i, T - 1 - i, light)
        t.put(min(T - 1, i + 1), T - 1 - i, shade(light, -20))
        if i < T - 5:
            t.put(i + 4, T - 1 - i, shade(base, 18))
    for y in range(T):
        for x in range(T):
            if x + y > T + 4:
                t.put(x, y, shade(t.get(x, y), -22))
    for x, y in ((3, 3), (11, 6), (6, 12)):
        t.put(x, y, (255, 255, 255))
    t.border(shade(dark, 0))


facets(atlas.tile("gem-gold"), (232, 176, 40), (255, 232, 130), (150, 96, 12))
t = atlas.tile("gem-light")
t.fill((255, 226, 118), noise=5)
for x, y in ((2, 2), (9, 4), (5, 9), (12, 12), (13, 2)):
    t.rect(x, y, x + 1, y + 1, (255, 255, 240))
t.border((214, 160, 40))
facets(atlas.tile("crystal-blue"), (70, 138, 224), (176, 216, 255), (24, 52, 120))
facets(atlas.tile("crystal-teal"), (56, 196, 188), (178, 250, 240), (16, 92, 96))

t = atlas.tile("ruin-stone")
t.fill((120, 128, 144), noise=9)
for y in (5, 11):
    t.hline(y, 0, T - 1, (84, 90, 106))
for x, y0, y1 in ((4, 0, 4), (11, 6, 10), (7, 12, 15)):
    t.vline(x, y0, y1, (84, 90, 106))
for _ in range(14):
    x, y = atlas.rnd.randint(0, T - 1), atlas.rnd.randint(8, T - 1)
    t.put(x, y, (84, 144, 72))
t = atlas.tile("ruin-rune")
t.fill((120, 128, 144), noise=9)
t.hline(3, 0, T - 1, (84, 90, 106))
t.hline(12, 0, T - 1, (84, 90, 106))
glow = (112, 232, 242)
for x, y in ((8, 5), (7, 6), (9, 6), (6, 7), (10, 7), (8, 7), (8, 8), (8, 9), (7, 10), (9, 10), (5, 8), (11, 8)):
    t.put(x, y, glow)
for x, y in ((8, 4), (8, 11)):
    t.put(x, y, shade(glow, -50))

t = atlas.tile("spike-bone")
t.fill((232, 222, 196), noise=5)
for y in range(0, T, 4):
    t.hline(y, 0, T - 1, (196, 182, 150))
t.vline(0, 0, T - 1, (170, 156, 124))
t = atlas.tile("spike-dark")
t.fill((72, 62, 92), noise=7)
for x in range(0, T, 5):
    t.vline(x, 0, T - 1, (52, 44, 70))
t = atlas.tile("moss")
t.fill((84, 150, 64), noise=10)
for _ in range(18):
    x, y = atlas.rnd.randint(0, T - 2), atlas.rnd.randint(0, T - 2)
    t.rect(x, y, x + 1, y + 1, (60, 112, 48))
t = atlas.tile("glow")
t.fill((255, 244, 200), noise=4)

atlas.save(ROOT / "assets/textures/Demo-16.png")

# ---------------------------------------------------------------- mesh building
TILE_RECT = {n: ((i % COLS) * T, (i // COLS) * T, T, T) for i, n in enumerate(NAMES)}


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)


def rot_x(p, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c)


def rot_z(p, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def rot_y(p, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c)


class Mesh:
    """Vertices and faces (index lists with a tile name). Faces are turned so they face away from `outward`."""

    def __init__(self):
        self.verts = []
        self.faces = []  # (indices, tile)

    def add(self, p):
        self.verts.append(tuple(p))
        return len(self.verts) - 1

    def face(self, idx, tile, outward):
        """`outward`: a point inside the shape (the face is turned to face away from it) or a direction vector."""
        pts = [self.verts[i] for i in idx]
        n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])))
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts))
        away = sub(c, outward["from"]) if "from" in outward else outward["dir"]
        if dot(n, away) < 0:
            idx = list(reversed(idx))
        self.faces.append((list(idx), tile))

    def transform(self, fn):
        self.verts = [fn(p) for p in self.verts]

    def merge(self, other):
        base = len(self.verts)
        self.verts += other.verts
        self.faces += [([i + base for i in idx], tile) for idx, tile in other.faces]


def uv_for(points, tile):
    """Project a face onto its own plane and fit it in the tile, keeping the proportions."""
    n = norm(cross(sub(points[1], points[0]), sub(points[2], points[0])))
    up = (0, 1, 0) if abs(n[1]) < 0.9 else (0, 0, 1)
    tx = norm(cross(up, n))
    ty = cross(n, tx)
    uv = [(dot(p, tx), dot(p, ty)) for p in points]
    us = [a for a, _ in uv]
    vs = [b for _, b in uv]
    cu, cv = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
    s = max(max(us) - min(us), max(vs) - min(vs), 1e-6)
    rx, ry, rw, rh = TILE_RECT[tile]
    return [[round(rx + (0.5 + (a - cu) / s) * rw, 3), round(ry + (0.5 - (b - cv) / s) * rh, 3)] for a, b in uv]


def mesh_json(mesh):
    verts = [[round(c, 4) for c in v] for v in mesh.verts]
    faces = []
    for idx, tile in mesh.faces:
        faces.append({"v": idx, "uv": uv_for([mesh.verts[i] for i in idx], tile)})
    return {"verts": verts, "faces": faces}


_counter = [0]


def ident(prefix):
    _counter[0] += 1
    return f"{prefix}{_counter[0]}"


def model_json(model_id, name, cubes, texture="Demo-16.png", bone=None, clips=None):
    bones = []
    bone_id = None
    if bone:
        bone_id = ident("bone")
        bones.append({"id": bone_id, "name": bone["name"], "parent": None, "pivot": bone["pivot"]})
    out_cubes = []
    for cube_name, mesh, smooth in cubes:
        out_cubes.append(
            {
                "id": ident("cube"),
                "name": cube_name,
                "position": [0, 0, 0],
                "rotation": [0, 0, 0],
                "mesh": mesh_json(mesh),
                "bone": bone_id,
                **({"smooth": True} if smooth else {}),
            }
        )
    return {
        "id": model_id,
        "name": name,
        "texture": texture,
        "cubes": out_cubes,
        "bones": bones,
        "clips": [{**c, "id": ident("clip")} for c in (clips or [])],
    }


def spin_bob(pivot_y, seconds):
    return {
        "name": "spin",
        "duration": seconds,
        "loop": True,
        "smooth": True,
        "tracks": {
            "Root": {
                "rot": [{"t": 0, "v": [0, 0, 0]}, {"t": seconds / 2, "v": [0, 180, 0]}, {"t": seconds, "v": [0, 360, 0]}],
                "pos": [{"t": 0, "v": [0, 0, 0]}, {"t": seconds / 4, "v": [0, 0.07, 0]}, {"t": seconds / 2, "v": [0, 0, 0]}, {"t": seconds * 3 / 4, "v": [0, 0.07, 0]}, {"t": seconds, "v": [0, 0, 0]}],
            }
        },
    }


# ---------------------------------------------------------------- shapes
def shard(base, radius, height, tip, sides, rnd, lean=(0.0, 0.0), tile_a="crystal-blue", tile_b="crystal-teal", twist=0.0):
    """A crystal: a six-sided body that narrows a little, with a pointed tip. Irregular on purpose."""
    m = Mesh()
    ring0, ring1 = [], []
    for i in range(sides):
        a = 2 * math.pi * i / sides + rnd.uniform(-0.18, 0.18) + twist
        r0 = radius * (1 + rnd.uniform(-0.16, 0.16))
        r1 = r0 * rnd.uniform(0.62, 0.8)
        ring0.append(m.add((math.cos(a) * r0, 0.0, math.sin(a) * r0)))
        ring1.append(m.add((math.cos(a) * r1, height * rnd.uniform(0.9, 1.05), math.sin(a) * r1)))
    apex = m.add((rnd.uniform(-0.04, 0.04) * radius, height + tip, rnd.uniform(-0.04, 0.04) * radius))
    axis_mid = (0.0, height * 0.5, 0.0)
    for i in range(sides):
        j = (i + 1) % sides
        tile = tile_a if i % 2 == 0 else tile_b
        m.face([ring0[i], ring0[j], ring1[j], ring1[i]], tile, {"from": axis_mid})
        m.face([ring1[i], ring1[j], apex], tile, {"from": axis_mid})
    m.face(list(ring0), "spike-dark", {"dir": (0, -1, 0)})

    def place(p):
        q = rot_x(p, lean[0])
        q = rot_z(q, lean[1])
        return (q[0] + base[0], q[1] + base[1], q[2] + base[2])

    m.transform(place)
    return m


def bipyramid(center, radius, up, down, sides, rnd, tile_a, tile_b, lean=(0.0, 0.0), jitter=0.16):
    m = Mesh()
    ring = []
    for i in range(sides):
        a = 2 * math.pi * i / sides + rnd.uniform(-0.2, 0.2)
        r = radius * (1 + rnd.uniform(-jitter, jitter))
        ring.append(m.add((math.cos(a) * r, rnd.uniform(-0.04, 0.04) * radius, math.sin(a) * r)))
    top = m.add((rnd.uniform(-0.05, 0.05), up, rnd.uniform(-0.05, 0.05)))
    bottom = m.add((rnd.uniform(-0.05, 0.05), -down, rnd.uniform(-0.05, 0.05)))
    for i in range(sides):
        j = (i + 1) % sides
        tile = tile_a if i % 2 == 0 else tile_b
        m.face([ring[i], ring[j], top], tile, {"from": (0, 0, 0)})
        m.face([ring[j], ring[i], bottom], tile, {"from": (0, 0, 0)})

    def place(p):
        q = rot_x(p, lean[0])
        q = rot_z(q, lean[1])
        return (q[0] + center[0], q[1] + center[1], q[2] + center[2])

    m.transform(place)
    return m


def lathe(rings, sides, rnd, jitter, side_tile, bottom_tile=None, top="flat", top_tile=None, top_dip=0.0, axis=(0.0, 0.0), band=None):
    """A solid turned around the y axis. rings: [(y, radius)], lowest first. The top is flat, a jagged fan, or open."""
    m = Mesh()
    offsets = [rnd.uniform(-0.12, 0.12) for _ in range(sides)]
    ring_ids = []
    for y, r in rings:
        ids = []
        for i in range(sides):
            a = 2 * math.pi * i / sides + offsets[i] * 0.5
            rr = r * (1 + rnd.uniform(-jitter, jitter))
            ids.append(m.add((axis[0] + math.cos(a) * rr, y, axis[1] + math.sin(a) * rr)))
        ring_ids.append(ids)
    for k in range(len(rings) - 1):
        for i in range(sides):
            j = (i + 1) % sides
            tile = side_tile
            if band and band[0] <= k < band[1]:
                tile = band[2]
            ymid = (rings[k][0] + rings[k + 1][0]) / 2
            m.face([ring_ids[k][i], ring_ids[k][j], ring_ids[k + 1][j], ring_ids[k + 1][i]], tile, {"from": (axis[0], ymid, axis[1])})
    if bottom_tile:
        m.face(list(ring_ids[0]), bottom_tile, {"dir": (0, -1, 0)})
    last = ring_ids[-1]
    if top == "flat":
        m.face(list(last), top_tile or side_tile, {"dir": (0, 1, 0)})
    elif top == "jagged":
        # break the top: each corner is lowered a different amount and the top is a fan to a point below it
        ys = [rings[-1][0] - rnd.uniform(0.0, top_dip) for _ in range(sides)]
        for i, vi in enumerate(last):
            x, _, z = m.verts[vi]
            m.verts[vi] = (x, ys[i], z)
        centre = m.add((axis[0], rings[-1][0] - top_dip * 0.7, axis[1]))
        for i in range(sides):
            j = (i + 1) % sides
            m.face([last[i], last[j], centre], top_tile or side_tile, {"dir": (0, 1, 0)})
    elif top == "fan":
        centre = m.add((axis[0], rings[-1][0] + top_dip, axis[1]))
        for i in range(sides):
            j = (i + 1) % sides
            m.face([last[i], last[j], centre], top_tile or side_tile, {"dir": (0, 1, 0)})
    return m


def spike(base, radius, height, sides, rnd, lean, tile_a="spike-bone", tile_b="spike-dark"):
    m = Mesh()
    ring = []
    for i in range(sides):
        a = 2 * math.pi * i / sides + rnd.uniform(-0.2, 0.2)
        r = radius * (1 + rnd.uniform(-0.12, 0.12))
        ring.append(m.add((math.cos(a) * r, 0.0, math.sin(a) * r)))
    apex = m.add((lean[0], height, lean[1]))
    for i in range(sides):
        j = (i + 1) % sides
        m.face([ring[i], ring[j], apex], tile_a if i % 3 else tile_b, {"from": (lean[0] * 0.3, height * 0.3, lean[1] * 0.3)})
    m.transform(lambda p: (p[0] + base[0], p[1] + base[1], p[2] + base[2]))
    return m


def mound(radius, height, sides, rnd, tile):
    return lathe([(0.0, radius), (height * 0.55, radius * 0.82), (height * 0.9, radius * 0.5)], sides, rnd, 0.12, tile, bottom_tile=tile, top="fan", top_dip=height * 0.1, top_tile=tile)


# ---------------------------------------------------------------- the models
models = []

# 1. the star crystal: a tall gold crystal with a burst of shards around it. Spins and bobs.
rnd = random.Random(21)
gem = Mesh()
gem.merge(bipyramid((0, 0.62, 0), 0.24, 0.58, 0.46, 6, rnd, "gem-gold", "gem-light"))
for k, (az, lean, size) in enumerate([(20, 38, 0.8), (110, 42, 0.7), (200, 36, 0.85), (290, 44, 0.65)]):
    r = 0.62
    sh = bipyramid((0, 0, 0), 0.1 * size + 0.04, 0.36 * size + 0.18, 0.12, 5, rnd, "gem-gold", "gem-light", lean=(0, 0))
    # lean the shard away from the middle, then turn it around the stem
    sh.transform(lambda p, lean=lean, az=az: rot_y(rot_z(p, -lean), az))
    sh.transform(lambda p, az=az: (p[0] + math.sin(math.radians(az)) * 0.0, p[1] + 0.5, p[2]))
    gem.merge(sh)
models.append(model_json("demo-star-crystal", "Star crystal", [("Crystal", gem, False)], bone={"name": "Root", "pivot": [0, 0.62, 0]}, clips=[spin_bob(0.62, 3.2)]))

# 2. a cluster of blue and teal crystals growing out of a mossy mound
rnd = random.Random(33)
cluster = mound(0.7, 0.3, 8, rnd, "moss")
for base, h, lean in [((0.0, 0.18, 0.0), 1.0, (4, -6)), ((0.34, 0.14, 0.1), 0.62, (-10, -24)), ((-0.32, 0.14, 0.06), 0.72, (6, 22)), ((0.08, 0.14, -0.34), 0.5, (26, 4)), ((-0.1, 0.12, 0.36), 0.42, (-22, -10))]:
    cluster.merge(shard(base, 0.13 + h * 0.06, h, 0.26 + h * 0.2, 6, rnd, lean=lean))
models.append(model_json("demo-crystal-cluster", "Crystal cluster", [("Crystals", cluster, False)]))

# 3. a broken ancient column with a rune band, and a drum that fell next to it
rnd = random.Random(45)
column = lathe([(0.0, 0.62), (0.12, 0.6), (0.2, 0.5), (0.24, 0.42)], 8, rnd, 0.05, "ruin-stone", bottom_tile="ruin-stone", top="none")
shaft = lathe(
    [(0.24, 0.4), (0.7, 0.37), (0.95, 0.36), (1.18, 0.36), (1.45, 0.34), (1.85, 0.33)],
    8,
    rnd,
    0.04,
    "ruin-stone",
    top="jagged",
    top_dip=0.32,
    top_tile="ruin-stone",
    band=(2, 3, "ruin-rune"),
)
column.merge(shaft)
cap = mound(0.3, 0.12, 6, rnd, "moss")
cap.transform(lambda p: (p[0] + 0.06, p[1] + 1.55, p[2] - 0.04))
column.merge(cap)
drum = lathe([(-0.2, 0.36), (0.2, 0.34)], 8, rnd, 0.05, "ruin-stone", bottom_tile="ruin-stone", top="flat", top_tile="ruin-rune")
drum.transform(lambda p: (rot_z(p, 84)[0] + 1.05, rot_z(p, 84)[1] + 0.34, rot_z(p, 84)[2] + 0.25))
column.merge(drum)
models.append(model_json("demo-ruin-column", "Ruin column", [("Column", column, False)]))

# 4. a patch of spikes on a dark base
rnd = random.Random(57)
spikes = lathe([(0.0, 0.95), (0.1, 0.9)], 9, rnd, 0.1, "spike-dark", bottom_tile="spike-dark", top="flat", top_tile="spike-dark")
for _ in range(9):
    a = rnd.uniform(0, 2 * math.pi)
    d = rnd.uniform(0.0, 0.62) ** 0.8
    x, z = math.cos(a) * d, math.sin(a) * d
    spikes.merge(spike((x, 0.08, z), rnd.uniform(0.11, 0.17), rnd.uniform(0.42, 0.85), 5, rnd, (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1))))
models.append(model_json("demo-spikes", "Thorn spikes", [("Spikes", spikes, False)]))

for model in models:
    path = ROOT / "assets/models" / (model["id"].replace("demo-", "") + ".json")
    path.write_text(json.dumps(model, separators=(",", ":")))
    print("wrote", path, len(model["cubes"][0]["mesh"]["verts"]), "verts")

# ---------------------------------------------------------------- the splash picture of the demo
W, H = 320, 180
sky = Image.new("RGB", (W, H))
d = ImageDraw.Draw(sky)
top, bottom = (24, 36, 78), (240, 150, 96)
for y in range(H):
    t = y / (H - 1)
    t = t ** 1.4
    d.line([(0, y), (W, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
rnd = random.Random(8)
for _ in range(60):
    x, y = rnd.randint(0, W - 1), rnd.randint(0, 70)
    c = rnd.choice([(255, 255, 255), (255, 232, 190), (190, 210, 255)])
    d.point((x, y), fill=c)
# the hills, three layers, far to near
for layer, (base, amp, color) in enumerate([(124, 10, (92, 80, 128)), (140, 12, (58, 98, 96)), (156, 9, (34, 78, 62))]):
    pts = [(0, H)]
    for x in range(0, W + 8, 8):
        y = base + math.sin(x / 38.0 + layer * 1.7) * amp + math.sin(x / 15.0 + layer) * amp * 0.35
        pts.append((x, y))
    pts.append((W, H))
    d.polygon(pts, fill=color)
# a star crystal over the hills
cx, cy = 252, 88
for dx, dy, c in [(0, -14, (255, 232, 130)), (0, 14, (232, 176, 40)), (-8, 0, (240, 190, 60)), (8, 0, (240, 190, 60))]:
    d.polygon([(cx, cy), (cx + dx * 0.6 - 3 * (dy != 0), cy + dy * 0.6), (cx + dx, cy + dy), (cx + dx * 0.6 + 3 * (dy != 0), cy + dy * 0.6)], fill=c)
for dx, dy in ((-20, -10), (22, -6), (-14, 16), (18, 18)):
    d.point((cx + dx, cy + dy), fill=(255, 250, 220))
    d.point((cx + dx + 1, cy + dy), fill=(255, 250, 220))
font_big = ImageFont.truetype(str(ROOT / "assets/fonts/DepartureMono-Regular.otf"), 26)
font_small = ImageFont.truetype(str(ROOT / "assets/fonts/DepartureMono-Regular.otf"), 11)
for text, font, y, color in (("MOSSY HILLS", font_big, 36, (255, 244, 214)), ("a PolyHop demo", font_small, 70, (255, 214, 160))):
    w = d.textlength(text, font=font)
    x = (W - w) / 2
    d.text((x + 1, y + 1), text, font=font, fill=(30, 22, 50))
    d.text((x, y), text, font=font, fill=color)
sky = sky.resize((W * 2, H * 2), Image.NEAREST).quantize(48)
out = ROOT / "assets/demo/splash.png"
sky.save(out, optimize=True)
print("wrote", out, out.stat().st_size, "bytes")
