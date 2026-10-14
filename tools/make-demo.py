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

from PIL import Image, ImageDraw

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

# ---------------------------------------------------------------- cubes
# The models follow the Hytale modeling guide: cubes only (some turned, some tilted), no cones, wedges or lathes.
TILE_RECT = {n: ((i % COLS) * T, (i // COLS) * T, T, T) for i, n in enumerate(NAMES)}

# the corners of a cube: bits x = 1, y = 2, z = 4; the faces and their corners as src/core/mesh.ts has them
FACE_ORDER = ["pz", "nz", "px", "nx", "py", "ny"]
FACE_CORNERS = {"pz": [4, 5, 7, 6], "nz": [1, 0, 2, 3], "px": [5, 1, 3, 7], "nx": [0, 4, 6, 2], "py": [6, 7, 3, 2], "ny": [0, 1, 5, 4]}


def box_json(size, tile):
    """The mesh of a cube centered on the origin. `tile` is a tile name, or {"side", "top", "bottom"} names."""
    verts = []
    for i in range(8):
        verts.append([round((0.5 if i & 1 else -0.5) * size[0], 4), round((0.5 if i & 2 else -0.5) * size[1], 4), round((0.5 if i & 4 else -0.5) * size[2], 4)])
    faces = []
    for key in FACE_ORDER:
        if isinstance(tile, str):
            name = tile
        else:
            name = tile.get("top") if key == "py" else tile.get("bottom") if key == "ny" else tile.get("side")
            name = name or tile.get("side") or "ruin-stone"
        x, y, w, h = TILE_RECT[name]
        faces.append({"v": list(FACE_CORNERS[key]), "uv": [[x, y + h], [x + w, y + h], [x + w, y], [x, y]]})
    return {"verts": verts, "faces": faces}


_counter = [0]


def ident(prefix):
    _counter[0] += 1
    return f"{prefix}{_counter[0]}"


def rot_xyz(p, rot):
    """Turn a point the way the editor turns a cube: about Z, then Y, then X (degrees)."""
    return rot_x(rot_y(rot_z(p, rot[2]), rot[1]), rot[0])


def rot_x(p, deg):
    c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0], p[1] * c - p[2] * s_, p[1] * s_ + p[2] * c)


def rot_y(p, deg):
    c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c + p[2] * s_, p[1], -p[0] * s_ + p[2] * c)


def rot_z(p, deg):
    c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (p[0] * c - p[1] * s_, p[0] * s_ + p[1] * c, p[2])


def cube(name, center, size, tile, rot=(0, 0, 0), bone_id=None):
    return {
        "id": ident("cube"),
        "name": name,
        "position": [round(c, 4) for c in center],
        "rotation": list(rot),
        "mesh": box_json(size, tile),
        "bone": bone_id,
    }


def leaning(name, base, size, tile, lean, rest=0.0):
    """A cube standing on `base` (its bottom center), tilted by `lean` = (about X, about Z) degrees."""
    center = rot_xyz((0.0, size[1] / 2, 0.0), (lean[0], 0, lean[1]))
    return cube(name, (base[0] + center[0], base[1] + center[1] + rest, base[2] + center[2]), size, tile, (lean[0], 0, lean[1]))


def model_json(model_id, name, cubes, texture="Demo-16.png", bone=None, clips=None):
    bones = []
    if bone:
        bone_id = ident("bone")
        bones.append({"id": bone_id, "name": bone["name"], "parent": None, "pivot": bone["pivot"]})
        for c in cubes:
            c["bone"] = bone_id
    return {
        "id": model_id,
        "name": name,
        "texture": texture,
        "cubes": cubes,
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


# ---------------------------------------------------------------- the models
models = []

# 1. the star crystal: a tall gold gem (two cubes turned 45 degrees) with a burst of four shards. Spins and bobs.
gem = [
    cube("Body", (0, 0.62, 0), (0.3, 0.6, 0.3), "gem-gold", (0, 45, 0)),
    cube("Top", (0, 1.04, 0), (0.18, 0.24, 0.18), "gem-light", (0, 45, 0)),
    cube("Bottom", (0, 0.27, 0), (0.16, 0.2, 0.16), "gem-gold", (0, 45, 0)),
]
for k, (dx, dz, lean) in enumerate([(1, 0, (0, -38)), (-1, 0, (0, 38)), (0, 1, (38, 0)), (0, -1, (-38, 0))]):
    gem.append(leaning(f"Shard {k + 1}", (dx * 0.12, 0.4, dz * 0.12), (0.09, 0.32, 0.09), "gem-light" if k % 2 else "gem-gold", lean))
models.append(model_json("demo-star-crystal", "Star crystal", gem, bone={"name": "Root", "pivot": [0, 0.62, 0]}, clips=[spin_bob(0.62, 3.2)]))

# 2. a cluster of blue and teal crystals growing out of a mossy mound: tall cubes, each with a narrower one on top
cluster = [
    cube("Mound", (0, 0.11, 0), (1.3, 0.22, 1.3), "moss", (0, 15, 0)),
    cube("Mound top", (0, 0.27, 0), (0.9, 0.14, 0.9), "moss", (0, 40, 0)),
]
for k, (base, h, w, lean, tile) in enumerate(
    [
        ((0.0, 0.3, 0.0), 1.15, 0.3, (4, -6), "crystal-blue"),
        ((0.34, 0.26, 0.1), 0.7, 0.22, (-10, -24), "crystal-teal"),
        ((-0.32, 0.26, 0.06), 0.8, 0.24, (6, 22), "crystal-blue"),
        ((0.08, 0.26, -0.34), 0.55, 0.2, (26, 4), "crystal-teal"),
        ((-0.1, 0.24, 0.36), 0.48, 0.18, (-22, -10), "crystal-blue"),
    ]
):
    body = h * 0.74
    cluster.append(leaning(f"Crystal {k + 1}", base, (w, body, w), tile, lean))
    tip_base = rot_xyz((0.0, body, 0.0), (lean[0], 0, lean[1]))
    cluster.append(leaning(f"Crystal {k + 1} tip", (base[0] + tip_base[0], base[1] + tip_base[1], base[2] + tip_base[2]), (w * 0.62, h * 0.26, w * 0.62), "crystal-teal" if tile == "crystal-blue" else "crystal-blue", lean))
models.append(model_json("demo-crystal-cluster", "Crystal cluster", cluster))

# 3. a broken ancient column with a rune band, and a drum that fell next to it
column = [
    cube("Base", (0, 0.12, 0), (1.1, 0.24, 1.1), "ruin-stone"),
    cube("Plinth", (0, 0.34, 0), (0.88, 0.2, 0.88), "ruin-stone", (0, 12, 0)),
    cube("Shaft", (0, 0.79, 0), (0.66, 0.7, 0.66), "ruin-stone", (0, 8, 0)),
    cube("Rune band", (0, 1.24, 0), (0.72, 0.2, 0.72), {"side": "ruin-rune", "top": "ruin-stone", "bottom": "ruin-stone"}, (0, 8, 0)),
    cube("Shaft top", (0, 1.52, 0), (0.64, 0.36, 0.64), "ruin-stone", (0, 20, 0)),
    cube("Broken top", (0.04, 1.78, 0), (0.44, 0.2, 0.5), "ruin-stone", (0, 20, 11)),
    cube("Moss", (0.06, 1.88, 0), (0.34, 0.08, 0.3), "moss", (0, 20, 8)),
    cube("Drum", (1.0, 0.2, 0.25), (0.72, 0.4, 0.72), {"side": "ruin-stone", "top": "ruin-rune", "bottom": "ruin-stone"}, (0, 20, 0)),
    cube("Chunk", (0.75, 0.13, -0.5), (0.42, 0.26, 0.36), "ruin-stone", (0, -30, 0)),
]
models.append(model_json("demo-ruin-column", "Ruin column", column))

# 4. a patch of spikes on a dark base: each thorn is a cube with a narrower one on top
rnd = random.Random(57)
spikes = [cube("Base", (0, 0.06, 0), (1.9, 0.12, 1.9), "spike-dark"), cube("Base 2", (0, 0.13, 0), (1.4, 0.08, 1.4), "spike-dark", (0, 30, 0))]
for k in range(9):
    a = rnd.uniform(0, 2 * math.pi)
    d = rnd.uniform(0.0, 0.62) ** 0.8
    x, z = math.cos(a) * d, math.sin(a) * d
    s_ = rnd.uniform(0.8, 1.15)
    lean = (round(rnd.uniform(-8, 8)), round(rnd.uniform(-8, 8)))
    spikes.append(leaning(f"Thorn {k + 1}", (x, 0.1, z), (0.17, 0.46 * s_, 0.17), "spike-bone", lean))
    top = rot_xyz((0.0, 0.46 * s_, 0.0), (lean[0], 0, lean[1]))
    spikes.append(leaning(f"Thorn {k + 1} tip", (x + top[0], 0.1 + top[1], z + top[2]), (0.1, 0.34 * s_, 0.1), "spike-bone", lean))
models.append(model_json("demo-spikes", "Thorn spikes", spikes))

for model in models:
    path = ROOT / "assets/models" / (model["id"].replace("demo-", "") + ".json")
    path.write_text(json.dumps(model, separators=(",", ":")))
    print("wrote", path, len(model["cubes"]), "cubes")

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
# the lettering: a small 5 x 7 pixel font drawn here (only the letters the splash needs), so the picture does
# not depend on a font file. Each glyph is seven rows of five pixels.
GLYPHS = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "a": ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
    "d": ["00001", "00001", "01101", "10011", "10001", "10011", "01101"],
    "e": ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
    "l": ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
    "m": ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
    "o": ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
    "p": ["00000", "00000", "11110", "10001", "11110", "10000", "10000"],
    "y": ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
    " ": ["00000"] * 7,
}


def lettering(text, scale, y, color, shadow):
    gap = scale
    width = sum(5 * scale + gap for _ in text) - gap
    x0 = (W - width) // 2
    for offset, fill in ((1, shadow), (0, color)):
        x = x0
        for ch in text:
            rows = GLYPHS[ch]
            for ry, row in enumerate(rows):
                for rx, bit in enumerate(row):
                    if bit == "1":
                        d.rectangle(
                            [x + rx * scale + offset, y + ry * scale + offset, x + (rx + 1) * scale - 1 + offset, y + (ry + 1) * scale - 1 + offset],
                            fill=fill,
                        )
            x += 5 * scale + gap


lettering("MOSSY HILLS", 3, 34, (255, 244, 214), (30, 22, 50))
lettering("a PolyHop demo", 1, 70, (255, 214, 160), (30, 22, 50))
sky = sky.resize((W * 2, H * 2), Image.NEAREST).quantize(48)
out = ROOT / "assets/demo/splash.png"
sky.save(out, optimize=True)
print("wrote", out, out.stat().st_size, "bytes")
