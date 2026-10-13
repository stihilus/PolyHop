#!/usr/bin/env python3
"""Builds the built-in character from scratch: its model and its skins.

  src/core/humanoid.model.json        the parts, their joints (bones) and the UV layout
  assets/textures/Character-Skin.png      the default skin (a plain outfit)
  assets/textures/Character-Template.png  every body part in its own color, for painting new skins
  assets/textures/Character-Explorer.png  the explorer of the demo: a green cap, a red scarf, a tunic

Everything is made from the numbers below (sizes in pixels, 62 px = the whole body = 1 m before the game scales it
to the player's height), so the rig and the skins are always made for the same layout. Run from the project root:

    python3 tools/make-humanoid.py
"""
import json
import math
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HEIGHT_PX = 62.0  # the body from the soles to the top of the head
TEX = 128

# ---------------------------------------------------------------- the parts
# Each part is a box that can be narrower at the top than at the bottom (or the other way round).
#   y     : height of the bottom, h: height
#   b / t : (x center, z center, width, depth) of the bottom and the top rectangle
# +x is the character's left, +z is where it looks. Left and right are mirror images with their own UV rectangles.


def part(y, h, bw, bd, tw=None, td=None, cx=0.0, bcz=0.0, tcz=None):
    tw = bw if tw is None else tw
    td = bd if td is None else td
    tcz = bcz if tcz is None else tcz
    return {"y": y, "h": h, "b": (cx, bcz, bw, bd), "t": (cx, tcz, tw, td)}


PARTS = {
    "Hips": part(28, 5, 13, 7, 11.5, 6.5),
    "Waist": part(33, 5, 11.5, 6.5, 12.8, 7.0),
    "Chest": part(38, 10, 12.8, 7.0, 15.5, 7.6),
    "Neck": part(48, 2, 4.2, 4.2, 4.2, 4.0),
    "Head": part(50, 12, 9.6, 8.6, 12, 11),
    "Nose": part(53.6, 2.4, 2.2, 2.4, 1.8, 1.8, bcz=6.4, tcz=6.6),
    "RightEar": part(53.6, 3, 1.3, 3, cx=-6.6),
    "LeftEar": part(53.6, 3, 1.3, 3, cx=6.6),
    "RightUpperArm": part(35.5, 11, 3.8, 3.8, 4.6, 4.4, cx=-10.0),
    "LeftUpperArm": part(35.5, 11, 3.8, 3.8, 4.6, 4.4, cx=10.0),
    "RightForearm": part(26.5, 9, 3.2, 3.2, 3.8, 3.8, cx=-10.0),
    "LeftForearm": part(26.5, 9, 3.2, 3.2, 3.8, 3.8, cx=10.0),
    "RightHand": part(23, 3.5, 2.8, 2.4, 3.2, 3.0, cx=-10.0),
    "LeftHand": part(23, 3.5, 2.8, 2.4, 3.2, 3.0, cx=10.0),
    "RightThigh": part(16, 12, 4.8, 5.0, 5.8, 6.0, cx=-3.3),
    "LeftThigh": part(16, 12, 4.8, 5.0, 5.8, 6.0, cx=3.3),
    "RightShin": part(4, 12, 3.8, 4.0, 4.8, 5.0, cx=-3.3),
    "LeftShin": part(4, 12, 3.8, 4.0, 4.8, 5.0, cx=3.3),
    "RightFoot": part(0, 4, 4.4, 9.2, 3.8, 6.4, cx=-3.3, bcz=2.0, tcz=0.9),
    "LeftFoot": part(0, 4, 4.4, 9.2, 3.8, 6.4, cx=3.3, bcz=2.0, tcz=0.9),
}

# parent of each part (also its bone) and the joint of the bone
PARENT = {
    "Hips": "Root",
    "Waist": "Hips",
    "Chest": "Waist",
    "Neck": "Chest",
    "Head": "Neck",
    "Nose": "Head",
    "RightEar": "Head",
    "LeftEar": "Head",
    "RightUpperArm": "Chest",
    "LeftUpperArm": "Chest",
    "RightForearm": "RightUpperArm",
    "LeftForearm": "LeftUpperArm",
    "RightHand": "RightForearm",
    "LeftHand": "LeftForearm",
    "RightThigh": "Hips",
    "LeftThigh": "Hips",
    "RightShin": "RightThigh",
    "LeftShin": "LeftThigh",
    "RightFoot": "RightShin",
    "LeftFoot": "LeftShin",
}


def joint(name):
    """Where the bone of a part turns: the middle of the hips, the lower edge of the spine and head, the upper edge of limbs."""
    p = PARTS[name]
    cx = p["b"][0]
    if name == "Hips":
        return (0.0, p["y"] + p["h"] / 2, 0.0)
    if name in ("Waist", "Chest", "Neck", "Head", "Nose", "RightEar", "LeftEar"):
        return (cx, p["y"], p["b"][1] if name in ("Head",) else 0.0)
    return (cx, p["y"] + p["h"], 0.0)


# ---------------------------------------------------------------- UV layout: a cross per part, packed in rows
FACES = ("top", "bottom", "right", "front", "left", "back")


def block_size(p):
    w = math.ceil(max(p["b"][2], p["t"][2]))
    d = math.ceil(max(p["b"][3], p["t"][3]))
    h = math.ceil(p["h"])
    return w, d, h


def pack():
    """Rectangles (x, y, w, h) of every face of every part. Biggest blocks first, row by row."""
    blocks = []
    for name, p in PARTS.items():
        w, d, h = block_size(p)
        blocks.append((name, w, d, h, 2 * d + 2 * w, d + h))
    blocks.sort(key=lambda b: (-b[5], -b[4], b[0]))
    layout = {}
    x = y = row_h = 0
    for name, w, d, h, bw, bh in blocks:
        if x + bw > TEX:
            x, y, row_h = 0, y + row_h + 1, 0
        layout[name] = {
            "top": (x + d, y, w, d),
            "bottom": (x + d + w, y, w, d),
            "right": (x, y + d, d, h),
            "front": (x + d, y + d, w, h),
            "left": (x + d + w, y + d, d, h),
            "back": (x + 2 * d + w, y + d, w, h),
        }
        x += bw + 1
        row_h = max(row_h, bh)
    if y + row_h > TEX:
        raise SystemExit("the parts do not fit in the texture")
    return layout


LAYOUT = pack()


# ---------------------------------------------------------------- geometry
def corners(p):
    """The 8 corners: index = y * 4 + z * 2 + x (y: 0 bottom 1 top, z: 0 back 1 front, x: 0 right(-x) 1 left(+x))."""
    out = []
    for yi, (cx, cz, w, d) in enumerate((p["b"], p["t"])):
        y = p["y"] + p["h"] * yi
        for zi in (0, 1):
            for xi in (0, 1):
                out.append((cx + (xi - 0.5) * w, y, cz + (zi - 0.5) * d))
    return out


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


# the corner indices of each face, and the axes the face's picture runs along (u: to the right of the picture, v: up)
FACE_CORNERS = {
    "front": ([2, 3, 7, 6], (1, 0, 0), (0, 1, 0)),
    "back": ([1, 0, 4, 5], (-1, 0, 0), (0, 1, 0)),
    "left": ([3, 1, 5, 7], (0, 0, -1), (0, 1, 0)),
    "right": ([0, 2, 6, 4], (0, 0, 1), (0, 1, 0)),
    "top": ([6, 7, 5, 4], (1, 0, 0), (0, 0, -1)),
    "bottom": ([0, 1, 3, 2], (1, 0, 0), (0, 0, 1)),
}


def build_cube(name):
    p = PARTS[name]
    pts = corners(p)
    centre = tuple(sum(c[i] for c in pts) / 8 for i in range(3))
    verts = [list(v) for v in pts]
    faces = []
    for face in FACES:
        idx, ua, va = FACE_CORNERS[face]
        quad = [pts[i] for i in idx]
        # turn the quad so it faces away from the middle of the part
        n = cross(sub(quad[1], quad[0]), sub(quad[2], quad[0]))
        fc = tuple(sum(q[i] for q in quad) / 4 for i in range(3))
        order = list(idx)
        if dot(n, sub(fc, centre)) < 0:
            order = list(reversed(order))
        x0, y0, rw, rh = LAYOUT[name][face]
        us = [dot(pts[i], ua) for i in idx]
        vs = [dot(pts[i], va) for i in idx]
        umin, umax, vmin, vmax = min(us), max(us), min(vs), max(vs)
        uv = []
        for i in order:
            u = (dot(pts[i], ua) - umin) / max(umax - umin, 1e-6)
            v = (dot(pts[i], va) - vmin) / max(vmax - vmin, 1e-6)
            uv.append([round(x0 + u * rw, 3), round(y0 + (1 - v) * rh, 3)])
        faces.append({"v": order, "uv": uv})
    s = 1.0 / HEIGHT_PX
    return {
        "id": f"cube-{name}",
        "name": name,
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "mesh": {"verts": [[round(c * s, 5) for c in v] for v in verts], "faces": faces},
        "bone": f"bone-{name}",
    }


def build_model():
    s = 1.0 / HEIGHT_PX
    bones = [{"id": "bone-Root", "name": "Root", "parent": None, "pivot": [0, 0, 0]}]
    for name in PARTS:
        j = joint(name)
        parent = PARENT[name]
        bones.append(
            {
                "id": f"bone-{name}",
                "name": name,
                "parent": f"bone-{parent}",
                "pivot": [round(j[0] * s, 5), round(j[1] * s, 5), round(j[2] * s, 5)],
            }
        )
    return {
        "id": "humanoid",
        "name": "Humanoid",
        "texture": "Character-Skin.png",
        "cubes": [build_cube(n) for n in PARTS],
        "bones": bones,
        "clips": [],
    }


# ---------------------------------------------------------------- skins
SHADE = {"top": 1.12, "front": 1.0, "left": 0.93, "right": 0.93, "back": 0.88, "bottom": 0.74}


def shaded(c, k):
    return tuple(max(0, min(255, round(v * k))) for v in c[:3])


class Skin:
    def __init__(self, seed):
        self.im = Image.new("RGBA", (TEX, TEX), (0, 0, 0, 0))
        self.px = self.im.load()
        self.rnd = random.Random(seed)

    def face(self, part, face, color_at, noise=3):
        """color_at(x, y, w, h) -> an (r, g, b) base color or None to leave the texel; shading and noise are added."""
        x0, y0, rw, rh = LAYOUT[part][face]
        for y in range(rh):
            for x in range(rw):
                c = color_at(x, y, rw, rh)
                if c is None:
                    continue
                n = self.rnd.randint(-noise, noise) if noise else 0
                r, g, b = shaded(c, SHADE[face])
                self.px[x0 + x, y0 + y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)), 255)

    def part(self, part, color_at, noise=3):
        for face in FACES:
            self.face(part, face, color_at, noise)

    def put(self, part, face, x, y, color):
        x0, y0, rw, rh = LAYOUT[part][face]
        if 0 <= x < rw and 0 <= y < rh:
            self.px[x0 + x, y0 + y] = (color[0], color[1], color[2], 255)

    def save(self, path):
        self.im.save(path)


def flat(c):
    return lambda x, y, w, h: c


def add(c, d):
    return tuple(max(0, min(255, v + d)) for v in c[:3])


SIDES = ("Right", "Left")
SKIN_TONE = (226, 174, 134)
HAIR = (96, 62, 38)


def draw_face(sk, brow=(70, 46, 30)):
    """Eyes, brows, mouth and cheeks, painted on the front of the head (the nose is a part of its own)."""
    # 12 px wide front: eyes at columns 2-4 and 7-9
    for ex in (2, 7):
        for dx in range(3):
            sk.put("Head", "front", ex + dx, 5, (246, 246, 250))
            sk.put("Head", "front", ex + dx, 6, (246, 246, 250))
        iris = ex + 1 if ex == 2 else ex + 1
        sk.put("Head", "front", iris, 5, (60, 110, 200))
        sk.put("Head", "front", iris, 6, (24, 30, 70))
        for dx in range(3):
            sk.put("Head", "front", ex + dx, 4, brow)
    for dx in range(4, 8):
        sk.put("Head", "front", dx, 9, (150, 60, 66))
    sk.put("Head", "front", 3, 8, (236, 150, 140))
    sk.put("Head", "front", 8, 8, (236, 150, 140))
    sk.put("Nose", "front", 0, 0, add(SKIN_TONE, -14))


def base_skin(sk, tone=SKIN_TONE):
    for name in PARTS:
        sk.part(name, flat(tone), noise=2)
    for name in ("RightEar", "LeftEar"):
        sk.part(name, flat((232, 150, 128)), noise=2)


def hair(sk, color=HAIR, front_rows=3, side_rows=5, back_rows=9):
    sk.face("Head", "top", flat(color), noise=4)
    sk.face("Head", "front", lambda x, y, w, h: color if y < front_rows else None, noise=3)
    for face in ("left", "right"):
        sk.face("Head", face, lambda x, y, w, h: color if y < side_rows or (x >= w // 2 and y < side_rows + 3) else None, noise=3)
    sk.face("Head", "back", lambda x, y, w, h: color if y < back_rows else None, noise=3)


def make_plain():
    sk = Skin(3)
    base_skin(sk)
    hair(sk)
    shirt = (70, 120, 190)
    shorts = (78, 76, 92)
    shoes = (54, 48, 52)
    for name in ("Chest", "Waist"):
        sk.part(name, lambda x, y, w, h: add(shirt, 12) if y == 0 else shirt, noise=3)
    for side in SIDES:
        sk.part(f"{side}UpperArm", lambda x, y, w, h: shirt if y < 7 else None, noise=3)
        sk.part(f"{side}Thigh", lambda x, y, w, h: shorts if y < 8 else None, noise=3)
        sk.part(f"{side}Foot", flat(shoes), noise=2)
        sk.part(f"{side}Shin", lambda x, y, w, h: (210, 210, 218) if y >= 9 else None, noise=2)  # socks
    sk.part("Hips", flat(shorts), noise=3)
    draw_face(sk)
    return sk


def make_template():
    colors = {
        "Hips": (206, 238, 112), "Waist": (10, 70, 150), "Chest": (0, 172, 196), "Neck": (0, 160, 110), "Head": (190, 20, 36),
        "Nose": (255, 120, 90), "RightEar": (255, 150, 160), "LeftEar": (255, 150, 160),
        "RightUpperArm": (232, 100, 0), "LeftUpperArm": (232, 130, 40), "RightForearm": (200, 70, 0), "LeftForearm": (214, 96, 24),
        "RightHand": (250, 164, 40), "LeftHand": (250, 190, 90), "RightThigh": (228, 120, 255), "LeftThigh": (200, 150, 255),
        "RightShin": (176, 0, 238), "LeftShin": (140, 40, 220), "RightFoot": (150, 255, 228), "LeftFoot": (110, 230, 200),
    }
    sk = Skin(1)
    for name in PARTS:
        sk.part(name, flat(colors.get(name, (200, 200, 200))), noise=0)
        # a bright dot in the corner of every face, so the way a picture runs can be told
        for face in FACES:
            sk.put(name, face, 0, 0, (255, 255, 255))
    return sk


def make_explorer():
    sk = Skin(11)
    base_skin(sk, (226, 172, 130))
    cap, cap_light, cap_dark = (58, 142, 74), (92, 178, 104), (36, 100, 52)
    brown_hair = (112, 70, 38)
    scarf, scarf_dark = (200, 52, 48), (150, 34, 36)
    tunic, tunic_light = (72, 150, 84), (110, 188, 120)
    belt, buckle = (112, 72, 40), (236, 190, 70)
    trousers, boot, bracer = (128, 90, 54), (72, 46, 30), (104, 66, 38)

    # cap with a brim at the front, hair at the back
    sk.face("Head", "top", lambda x, y, w, h: cap_light if (x + y) % 7 == 0 else cap, noise=3)
    sk.face("Head", "front", lambda x, y, w, h: (cap_dark if y >= 2 else cap) if y <= 2 else None, noise=3)
    for face in ("left", "right"):
        sk.face("Head", face, lambda x, y, w, h: (cap_dark if y == 4 else cap) if y <= 4 else (brown_hair if x >= w // 2 and y <= 7 else None), noise=3)
    sk.face("Head", "back", lambda x, y, w, h: (cap_dark if y == 4 else cap) if y <= 4 else (brown_hair if y <= 9 else None), noise=3)
    # a scarf round the neck and over the top of the chest
    sk.part("Neck", lambda x, y, w, h: scarf_dark if y % 2 == 1 else scarf, noise=2)
    sk.face("Chest", "front", lambda x, y, w, h: scarf if y < 2 else (tunic_light if x in (w // 2 - 1, w // 2) and y % 3 == 0 else tunic), noise=3)
    for face in ("back", "left", "right", "top", "bottom"):
        sk.face("Chest", face, lambda x, y, w, h: scarf if (face != "bottom" and y < 1) else tunic, noise=3)
    sk.part("Waist", flat(tunic), noise=3)
    # belt on the hips, with a buckle
    sk.part("Hips", lambda x, y, w, h: belt if y < 2 else trousers, noise=3)
    bx = LAYOUT["Hips"]["front"]
    for dx in (-1, 0, 1):
        sk.put("Hips", "front", bx[2] // 2 + dx, 0, buckle)
        sk.put("Hips", "front", bx[2] // 2 + dx, 1, add(buckle, -40))
    for side in SIDES:
        sk.part(f"{side}UpperArm", lambda x, y, w, h: tunic if y < 8 else (tunic_light if y == 8 else None), noise=3)
        sk.part(f"{side}Forearm", lambda x, y, w, h: bracer if y >= 5 else None, noise=3)
        sk.part(f"{side}Thigh", flat(trousers), noise=3)
        sk.part(f"{side}Shin", lambda x, y, w, h: boot if y >= 6 else (add(trousers, 16) if y == 5 else trousers), noise=3)
        sk.part(f"{side}Foot", flat(boot), noise=2)
    draw_face(sk)
    return sk


# ---------------------------------------------------------------- write everything
def main():
    model = build_model()
    out = ROOT / "src/core/humanoid.model.json"
    out.write_text(json.dumps(model, separators=(",", ":")))
    print("wrote", out, f"{out.stat().st_size} bytes,", len(model["cubes"]), "parts")
    tex = ROOT / "assets/textures"
    make_plain().save(tex / "Character-Skin.png")
    make_template().save(tex / "Character-Template.png")
    make_explorer().save(tex / "Character-Explorer.png")
    print("wrote the skins in", tex)


if __name__ == "__main__":
    main()
