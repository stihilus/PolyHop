#!/usr/bin/env python3
"""Builds the built-in characters from scratch: their models and their skins.

  src/core/humanoid.model.json          the male character: its parts, joints (bones) and UV layout
  src/core/humanoid-female.model.json   the female character (the same bones, another build and another layout)
  assets/textures/Character-Skin.png            the default male skin (a plain outfit)
  assets/textures/Character-Explorer.png        the explorer of the demo: a green cap, a red scarf, a tunic
  assets/textures/Character-Template.png       every body part in its own color, for painting new skins
  assets/textures/Character-Female-Skin.png     the default female skin
  assets/textures/Character-Female-Explorer.png an adventurer: a headband, a green vest, boots
  assets/textures/Character-Female-Template.png the template of the female character

The build follows a stylized game character: a head that is nearly a cube (a fifth of the body), a short neck, a broad chest,
arms with separate hands, legs with long flat feet, and the hair as parts of its own. There is no nose in the
geometry (the face is painted). Everything is made from the numbers below (sizes in pixels, the whole body is
scaled to be 1 m tall before the game scales it to the player's height), so the models and the skins are always
made for the same layout. Run from the project root:

    python3 tools/make-humanoid.py
"""
import json
import math
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
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


def head_dims(p, y):
    """Width and depth of a part at height y (linear between its bottom and top, held beyond them)."""
    t = min(1.0, max(0.0, (y - p["y"]) / p["h"]))
    return (
        p["b"][2] + (p["t"][2] - p["b"][2]) * t,
        p["b"][3] + (p["t"][3] - p["b"][3]) * t,
    )


def both(name, y, h, bw, bd, tw, td, cx):
    """The part of the right side (-x) and the mirrored one of the left side."""
    return {
        f"Right{name}": part(y, h, bw, bd, tw, td, cx=-cx),
        f"Left{name}": part(y, h, bw, bd, tw, td, cx=cx),
    }


def hair(head, long_hair):
    """The hair is a cap over the top of the head and a slab behind it (and locks at the sides when long)."""
    top = head["y"] + head["h"]
    pad = 0.7
    cap_h = 3.8
    cap_top = top + 0.6
    cap_y = cap_top - cap_h
    w0, d0 = head_dims(head, cap_y)
    w1, d1 = head_dims(head, cap_top)
    parts = {"HairCap": part(cap_y, cap_h, w0 + 2 * pad, d0 + 2 * pad, w1 + 2 * pad, d1 + 2 * pad)}

    # the slab behind the head: a few pixels thick, 0.8 px behind the back of the head
    thick = 3.4 if not long_hair else 3.0
    back_y = head["y"] - 2.4 if long_hair else top - 7.8
    back_top = top - 1.0
    wb, db = head_dims(head, back_y)
    wt, dt = head_dims(head, back_top)
    parts["HairBack"] = part(
        back_y,
        back_top - back_y,
        wb + 2 * 0.5,
        thick,
        wt + 2 * pad,
        thick,
        bcz=-(db / 2) - 0.8 + thick / 2,
        tcz=-(dt / 2) - 0.8 + thick / 2,
    )
    if long_hair:
        lock_h = 9.4
        ly = top - 1.3 - lock_h
        wl, dl = head_dims(head, ly + lock_h / 2)
        for sign, name in ((-1, "RightHairLock"), (1, "LeftHairLock")):
            parts[name] = part(ly, lock_h, 1.9, 4.8, 1.9, 4.8, cx=sign * (wl / 2 + 0.55), bcz=-1.0)
    return parts


def male_parts():
    # a head that is about a fifth of the body and nearly a cube (a little wider than it is tall), on a sturdy body
    p = {}
    p["Hips"] = part(24.8, 5.6, 12.8, 7.2, 12.2, 7.0)
    p["Waist"] = part(30.4, 5.0, 12.2, 7.0, 12.6, 7.4)
    p["Chest"] = part(35.4, 11.4, 12.6, 7.4, 15.2, 8.6)
    p["Neck"] = part(46.4, 1.8, 4.2, 4.2, 4.0, 4.0)
    p["Head"] = part(48.0, 13.4, 12.4, 11.8, 14.0, 13.0)
    p.update(hair(p["Head"], long_hair=False))
    p["RightEar"] = part(52.4, 3.4, 1.2, 3.0, cx=-7.1)
    p["LeftEar"] = part(52.4, 3.4, 1.2, 3.0, cx=7.1)
    p.update(both("UpperArm", 36.6, 10.2, 4.0, 4.4, 4.6, 4.9, 9.7))
    p.update(both("Forearm", 28.0, 8.6, 3.6, 3.9, 4.0, 4.4, 9.7))
    p.update(both("Hand", 24.0, 4.0, 3.3, 3.3, 3.8, 3.8, 9.7))
    p.update(both("Thigh", 14.8, 10.6, 4.8, 5.3, 5.7, 6.1, 3.2))
    p.update(both("Shin", 3.8, 11.0, 4.0, 4.3, 4.7, 4.9, 3.2))
    for sign, side in ((-1, "Right"), (1, "Left")):
        p[f"{side}Foot"] = part(0.0, 3.8, 4.7, 10.0, 4.4, 6.8, cx=sign * 3.2, bcz=2.5, tcz=1.0)
    return p


def female_parts():
    p = {}
    p["Hips"] = part(24.6, 5.8, 12.8, 7.2, 11.0, 6.8)
    p["Waist"] = part(30.4, 4.8, 11.0, 6.8, 10.4, 6.6)
    p["Chest"] = part(35.2, 11.2, 10.6, 6.8, 13.2, 7.8)
    p["Neck"] = part(46.0, 1.8, 3.6, 3.6, 3.4, 3.4)
    p["Head"] = part(47.6, 12.4, 11.4, 10.8, 12.8, 12.0)
    p.update(hair(p["Head"], long_hair=True))
    p["RightEar"] = part(51.6, 3.2, 1.2, 2.8, cx=-6.5)
    p["LeftEar"] = part(51.6, 3.2, 1.2, 2.8, cx=6.5)
    p.update(both("UpperArm", 36.2, 10.0, 3.5, 3.9, 4.0, 4.4, 8.4))
    p.update(both("Forearm", 27.8, 8.4, 3.1, 3.5, 3.5, 3.9, 8.4))
    p.update(both("Hand", 23.8, 4.0, 2.9, 3.1, 3.4, 3.5, 8.4))
    p.update(both("Thigh", 14.6, 10.6, 4.7, 5.1, 5.8, 5.9, 3.2))
    p.update(both("Shin", 3.6, 11.0, 3.6, 4.0, 4.5, 4.7, 3.2))
    for sign, side in ((-1, "Right"), (1, "Left")):
        p[f"{side}Foot"] = part(0.0, 3.6, 4.3, 9.4, 4.0, 6.4, cx=sign * 3.2, bcz=2.3, tcz=0.9)
    return p


# parent of each part's bone, and the joint of the bone. The hair has no bones of its own: it follows the head.
PARENT = {
    "Hips": "Root",
    "Waist": "Hips",
    "Chest": "Waist",
    "Neck": "Chest",
    "Head": "Neck",
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
HAIR_PARTS = ("HairCap", "HairBack", "RightHairLock", "LeftHairLock")


def bone_of(name):
    return "Head" if name in HAIR_PARTS else name


def joint(parts, name):
    """Where the bone of a part turns: the middle of the hips, the lower edge of the spine and head, the upper edge of limbs."""
    p = parts[name]
    cx = p["b"][0]
    if name == "Hips":
        return (0.0, p["y"] + p["h"] / 2, 0.0)
    if name in ("Waist", "Chest", "Neck", "Head", "RightEar", "LeftEar"):
        return (cx, p["y"], p["b"][1] if name == "Head" else 0.0)
    return (cx, p["y"] + p["h"], 0.0)


# ---------------------------------------------------------------- UV layout: a cross per part, packed in rows
FACES = ("top", "bottom", "right", "front", "left", "back")


def block_size(p):
    w = math.ceil(max(p["b"][2], p["t"][2]) - 1e-6)
    d = math.ceil(max(p["b"][3], p["t"][3]) - 1e-6)
    h = math.ceil(p["h"] - 1e-6)
    return w, d, h


def pack(parts):
    """Rectangles (x, y, w, h) of every face of every part. Biggest blocks first, row by row."""
    blocks = []
    for name, p in parts.items():
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


class Rig:
    """The parts of one character with their UV layout; builds the model JSON and gives the painters their rectangles."""

    def __init__(self, key, name, model_id, texture, parts):
        self.key = key
        self.name = name
        self.model_id = model_id
        self.texture = texture
        self.parts = parts
        self.layout = pack(parts)
        top = max(p["y"] + p["h"] for p in parts.values())
        self.scale = 1.0 / top  # the whole body is 1 m

    def build_cube(self, name):
        p = self.parts[name]
        pts = corners(p)
        centre = tuple(sum(c[i] for c in pts) / 8 for i in range(3))
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
            x0, y0, rw, rh = self.layout[name][face]
            us = [dot(pts[i], ua) for i in idx]
            vs = [dot(pts[i], va) for i in idx]
            umin, umax, vmin, vmax = min(us), max(us), min(vs), max(vs)
            uv = []
            for i in order:
                u = (dot(pts[i], ua) - umin) / max(umax - umin, 1e-6)
                v = (dot(pts[i], va) - vmin) / max(vmax - vmin, 1e-6)
                uv.append([round(x0 + u * rw, 3), round(y0 + (1 - v) * rh, 3)])
            faces.append({"v": order, "uv": uv})
        s = self.scale
        return {
            "id": f"cube-{name}",
            "name": name,
            "position": [0, 0, 0],
            "rotation": [0, 0, 0],
            "mesh": {"verts": [[round(c * s, 5) for c in pt] for pt in pts], "faces": faces},
            "bone": f"bone-{bone_of(name)}",
        }

    def build_model(self):
        s = self.scale
        bones = [{"id": "bone-Root", "name": "Root", "parent": None, "pivot": [0, 0, 0]}]
        for name in PARENT:
            j = joint(self.parts, name)
            bones.append(
                {
                    "id": f"bone-{name}",
                    "name": name,
                    "parent": f"bone-{PARENT[name]}",
                    "pivot": [round(j[0] * s, 5), round(j[1] * s, 5), round(j[2] * s, 5)],
                }
            )
        return {
            "id": self.model_id,
            "name": self.name,
            "texture": self.texture,
            "cubes": [self.build_cube(n) for n in self.parts],
            "bones": bones,
            "clips": [],
        }


# ---------------------------------------------------------------- painting
SHADE = {"top": 1.07, "front": 1.0, "left": 0.94, "right": 0.94, "back": 0.9, "bottom": 0.78}


def clamp(v):
    return max(0, min(255, int(round(v))))


def shaded(c, k):
    return (clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k))


def add(c, d):
    return (clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d))


def mix(a, b, t):
    return (clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t))


def flat(c):
    return lambda x, y, w, h: c


class Skin:
    def __init__(self, rig, seed):
        self.rig = rig
        self.im = Image.new("RGBA", (TEX, TEX), (0, 0, 0, 0))
        self.px = self.im.load()
        self.rnd = random.Random(seed)

    def rect(self, part, face):
        return self.rig.layout[part][face]

    def face(self, part, face, color_at, noise=1, lit=True):
        """color_at(x, y, w, h) -> an (r, g, b) base color or None to leave the texel clear. The face's shade and a
        little noise are added."""
        x0, y0, rw, rh = self.rect(part, face)
        k = SHADE[face] if lit else 1.0
        for y in range(rh):
            for x in range(rw):
                c = color_at(x, y, rw, rh)
                if c is None:
                    continue
                n = self.rnd.randint(-noise, noise) if noise else 0
                r, g, b = shaded(c, k)
                self.px[x0 + x, y0 + y] = (clamp(r + n), clamp(g + n), clamp(b + n), 255)

    def part(self, part, color_at, noise=1, faces=FACES):
        for face in faces:
            self.face(part, face, color_at, noise)

    def put(self, part, face, x, y, color, lit=False):
        x0, y0, rw, rh = self.rect(part, face)
        if 0 <= x < rw and 0 <= y < rh:
            k = SHADE[face] if lit else 1.0
            c = shaded(color, k)
            self.px[x0 + x, y0 + y] = (c[0], c[1], c[2], 255)

    def get(self, part, face, x, y):
        x0, y0, rw, rh = self.rect(part, face)
        p = self.px[x0 + x, y0 + y]
        return (p[0], p[1], p[2])

    def size(self, part, face):
        r = self.rect(part, face)
        return r[2], r[3]

    def save(self, path):
        self.im.save(path)


SIDES = ("Right", "Left")
BODY = ("Hips", "Waist", "Chest", "Neck", "Head", "RightEar", "LeftEar", "RightUpperArm", "LeftUpperArm", "RightForearm",
        "LeftForearm", "RightHand", "LeftHand", "RightThigh", "LeftThigh", "RightShin", "LeftShin", "RightFoot", "LeftFoot")


def body_skin(sk, tone):
    """The bare body: a skin color that gets a little darker toward the joints so the parts read as shapes."""
    shadow = mix(tone, (120, 60, 40), 0.18)
    for name in BODY:
        sk.part(name, flat(tone), noise=1)
    for name in ("RightEar", "LeftEar"):
        sk.part(name, flat(mix(tone, (230, 120, 110), 0.3)), noise=1)
    # a soft line where the arm meets the shoulder, where the hand meets the wrist and above the knees
    for side in SIDES:
        sk.face(f"{side}Forearm", "front", lambda x, y, w, h: shadow if y == 0 else None, noise=0)
        sk.face(f"{side}Hand", "front", lambda x, y, w, h: shadow if y == 0 else None, noise=0)
    # the neck is in the shade of the head
    sk.part("Neck", flat(mix(tone, (80, 30, 20), 0.22)), noise=1)


def fingers(sk, tone):
    """The fingers of the hands, as a dark line between them on the front and the back."""
    line = mix(tone, (90, 40, 30), 0.35)
    for side in SIDES:
        for face in ("front", "back"):
            w, h = sk.size(f"{side}Hand", face)
            for y in range(h // 2, h):
                sk.put(f"{side}Hand", face, w // 2, y, line, lit=True)


def toes(sk, tone):
    """The toes of the bare feet: two dark lines on the front and on the front end of the top."""
    line = mix(tone, (90, 40, 30), 0.35)
    for side in SIDES:
        w, h = sk.size(f"{side}Foot", "front")
        cuts = sorted({max(1, round(w / 3)), min(w - 1, round(2 * w / 3))})
        for x in cuts:
            for y in range(h // 2, h):
                sk.put(f"{side}Foot", "front", x, y, line, lit=True)
        tw, td = sk.size(f"{side}Foot", "top")
        for x in cuts:
            for y in range(max(0, td - 3), td):
                sk.put(f"{side}Foot", "top", x, y, line, lit=True)


def emblem(sk, part, face, y0, color):
    """A small diamond, centered on a face (the sign of PolyHop on the chest)."""
    w, _ = sk.size(part, face)
    c = w // 2
    rows = [[c], [c - 1, c, c + 1], [c]] if w % 2 else [[c - 1, c], [c - 2, c - 1, c, c + 1], [c - 1, c]]
    for dy, xs in enumerate(rows):
        for x in xs:
            sk.put(part, face, x, y0 + dy, color, lit=True)


def draw_face(sk, tone, female=False, iris=(62, 120, 212), brow=(78, 52, 34), lip=(168, 78, 78), lip_low=(206, 112, 108)):
    """Eyes, brows, a hint of a nose, a mouth and cheeks, painted on the front of the head. Big eyes with a
    highlight give the character its look; there is no nose in the geometry."""
    W, H = sk.size("Head", "front")
    ex = [2, W - 6]  # left columns of the two eyes: 4 pixels of white each
    skin_shadow = mix(tone, (110, 50, 40), 0.3)
    skin_light = add(tone, 9)
    row = 5  # the first row of the eyes: brows right under the fringe, then the lids, then the eyes
    # lids and brows
    for i, x0 in enumerate(ex):
        outer_left = i == 0
        for dx in range(4):
            sk.put("Head", "front", x0 + dx, row - 1, (60, 40, 40) if female else mix(tone, brow, 0.55))
        # brows: straight and thick for the male build, thin and a little arched for the female one
        span = range(-1 if outer_left else 0, 4 if outer_left else 5) if not female else range(0, 4)
        for dx in span:
            by = row - 2
            col = brow if not female else mix(brow, tone, 0.2)
            if female and dx == (0 if outer_left else 3):
                by = row - 2  # the outer end sits a pixel lower
                by += 0
            if 0 <= x0 + dx < W:
                sk.put("Head", "front", x0 + dx, by, col)
        if not female:
            # the inner end of a brow comes down a little (a stern, honest look)
            inner = x0 + 3 if outer_left else x0
            sk.put("Head", "front", inner, row - 1, brow)
        # the white of the eye, then the iris with a highlight
        for dy in range(3):
            for dx in range(4):
                sk.put("Head", "front", x0 + dx, row + dy, (248, 248, 252) if dy < 2 or dx in (0, 3) else (214, 218, 232))
        ix = x0 + 1
        dark = shaded(iris, 0.5)
        sk.put("Head", "front", ix, row, dark)
        sk.put("Head", "front", ix + 1, row, dark)
        sk.put("Head", "front", ix, row + 1, iris)
        sk.put("Head", "front", ix + 1, row + 1, shaded(iris, 0.62))  # the pupil
        sk.put("Head", "front", ix, row + 2, add(iris, 38))
        sk.put("Head", "front", ix + 1, row + 2, iris)
        sk.put("Head", "front", ix, row, (255, 255, 255))  # highlight
        # shadow under the eye
        for dx in range(4):
            sk.put("Head", "front", x0 + dx, row + 3, mix(tone, (150, 80, 70), 0.22))
        if female:
            # a lash at the outer corner
            sk.put("Head", "front", x0 - 1 if outer_left else x0 + 4, row, (60, 40, 40))
    # the nose: a lit ridge and two shadows
    c0, c1 = (W - 1) // 2, W // 2
    for y in (row + 2, row + 3):
        for x in {c0, c1}:
            sk.put("Head", "front", x, y, skin_light)
    sk.put("Head", "front", c0 - 1, row + 4, skin_shadow)
    sk.put("Head", "front", c1 + 1, row + 4, skin_shadow)
    for x in {c0, c1}:
        sk.put("Head", "front", x, row + 4, mix(tone, (120, 60, 50), 0.14))
    # cheeks
    blush = mix(tone, (240, 110, 110), 0.38 if female else 0.25)
    for x in (2, 3, W - 4, W - 3):
        sk.put("Head", "front", x, row + 4, blush)
    # mouth (one row nearer on a head that is only 13 rows tall, so the chin keeps its row)
    my = row + 5 if H <= 13 else row + 6
    half = 2 if not female else 1
    left = c0 - half
    right = c1 + half
    for x in range(left, right + 1):
        sk.put("Head", "front", x, my, lip)
    for x in range(left + 1, right):
        sk.put("Head", "front", x, my + 1, lip_low)
    sk.put("Head", "front", left - 1, my - 1, skin_shadow)
    sk.put("Head", "front", right + 1, my - 1, skin_shadow)
    # the chin
    for x in range(1, W - 1):
        sk.put("Head", "front", x, H - 1, mix(tone, (110, 50, 40), 0.1))


def paint_hair(sk, color, long_hair=False, bangs="side", highlight=18):
    """Paints the hair parts (and the top of the head under them). Clear texels let the head show through."""
    light = add(color, highlight)
    dark = add(color, -16)

    def streaks(x, y, w, h):
        return light if (x + 2 * y) % 5 == 0 else (dark if (x * 3 + y) % 7 == 0 else color)

    sk.face("Head", "top", flat(color), noise=1)
    # the cap
    sk.face("HairCap", "top", streaks, noise=1)

    def fringe(x, y, w, h):
        if y <= 1:
            return streaks(x, y, w, h)
        if bangs == "side":
            # swept to one side: it hangs low on the left and is short on the right
            reach = max(0, 3 - x // 3)
            return streaks(x, y, w, h) if y - 1 <= reach and x < w - 2 else None
        # a parting in the middle, two curtains
        mid = w // 2
        gap = abs(x - (mid - 0.5)) < 1.6
        reach = 2 if x < 3 or x >= w - 3 else 1
        return None if gap else (streaks(x, y, w, h) if y <= 1 + reach else None)

    sk.face("HairCap", "front", fringe, noise=1)

    def side(x, y, w, h):
        # the hair reaches down behind the ear
        if y <= 1:
            return streaks(x, y, w, h)
        return streaks(x, y, w, h) if x >= w // 2 + (1 if long_hair else 0) else None

    for face in ("left", "right"):
        sk.face("HairCap", face, side, noise=1)
    sk.face("HairCap", "back", streaks, noise=1)

    def slab(x, y, w, h):
        base = streaks(x, y, w, h)
        return mix(base, dark, 0.3 * (y / max(1, h)))

    for face in ("back", "left", "right", "front", "bottom", "top"):
        sk.face("HairBack", face, slab, noise=1)
    if long_hair:
        for side_name in ("RightHairLock", "LeftHairLock"):
            for face in FACES:
                sk.face(side_name, face, slab, noise=1)


def make_plain(rig, female=False):
    sk = Skin(rig, 3 if not female else 5)
    tone = (232, 176, 130) if not female else (238, 188, 146)
    body_skin(sk, tone)
    fingers(sk, tone)
    toes(sk, tone)
    if not female:
        paint_hair(sk, (88, 58, 36), long_hair=False, bangs="side")
        top, top_light = (66, 118, 196), (96, 148, 226)
        shorts, shorts_dark = (82, 84, 100), (58, 60, 74)
        shoes = (210, 206, 198)
        draw_face(sk, tone, female=False, iris=(60, 118, 214))
    else:
        paint_hair(sk, (66, 42, 38), long_hair=True, bangs="part", highlight=22)
        top, top_light = (50, 156, 150), (86, 190, 182)
        shorts, shorts_dark = (52, 66, 112), (38, 48, 86)
        shoes = (236, 232, 226)
        draw_face(sk, tone, female=True, iris=(96, 70, 52), brow=(60, 40, 34), lip=(196, 92, 100), lip_low=(218, 122, 124))

    # a short-sleeved top with a collar and a small diamond (the sign of PolyHop) on the chest
    for name in ("Chest", "Waist"):
        sk.part(name, lambda x, y, w, h: top, noise=1)
    sk.face("Chest", "front", lambda x, y, w, h: top_light if y == 0 else top, noise=1)
    emblem(sk, "Chest", "front", 4, (255, 214, 96))
    for side in SIDES:
        sk.part(f"{side}UpperArm", lambda x, y, w, h: (top if y < 6 else None), noise=1)
        sk.face(f"{side}UpperArm", "bottom", lambda x, y, w, h: add(tone, -8), noise=0)
    # shorts / jeans
    sk.part("Hips", lambda x, y, w, h: shorts_dark if y == 0 else shorts, noise=1)
    for side in SIDES:
        if not female:
            sk.part(f"{side}Thigh", lambda x, y, w, h: shorts if y < 7 else None, noise=1)
            # socks with a stripe, shoes
            sk.part(f"{side}Shin", lambda x, y, w, h: ((235, 235, 240) if y not in (6,) else (200, 70, 70)) if y >= 6 else None, noise=0)
        else:
            sk.part(f"{side}Thigh", flat(shorts), noise=1)
            sk.part(f"{side}Shin", lambda x, y, w, h: shorts if y < h - 1 else add(shorts, 40), noise=1)
        sk.part(f"{side}Foot", flat(shoes), noise=1)
        # a dark sole and a toe cap
        sk.face(f"{side}Foot", "bottom", flat(add(shoes, -90)), noise=0)
        sk.face(f"{side}Foot", "front", lambda x, y, w, h: add(shoes, -60) if y == h - 1 else shoes, noise=0)
    return sk


def make_template(rig):
    colors = {
        "Hips": (206, 238, 112), "Waist": (10, 70, 150), "Chest": (0, 172, 196), "Neck": (0, 160, 110), "Head": (190, 20, 36),
        "HairCap": (255, 120, 90), "HairBack": (255, 90, 140), "RightHairLock": (255, 150, 60), "LeftHairLock": (255, 190, 90),
        "RightEar": (255, 150, 160), "LeftEar": (255, 150, 160),
        "RightUpperArm": (232, 100, 0), "LeftUpperArm": (232, 130, 40), "RightForearm": (200, 70, 0), "LeftForearm": (214, 96, 24),
        "RightHand": (250, 164, 40), "LeftHand": (250, 190, 90), "RightThigh": (228, 120, 255), "LeftThigh": (200, 150, 255),
        "RightShin": (176, 0, 238), "LeftShin": (140, 40, 220), "RightFoot": (150, 255, 228), "LeftFoot": (110, 230, 200),
    }
    sk = Skin(rig, 1)
    for name in rig.parts:
        sk.part(name, flat(colors.get(name, (200, 200, 200))), noise=0)
        # a bright dot in the corner of every face, so the way a picture runs can be told
        for face in FACES:
            sk.put(name, face, 0, 0, (255, 255, 255))
    return sk


def make_explorer(rig, female=False):
    sk = Skin(rig, 11 if not female else 13)
    tone = (226, 170, 128) if not female else (236, 184, 142)
    body_skin(sk, tone)
    fingers(sk, tone)
    toes(sk, tone)
    cap, cap_light, cap_dark = (58, 142, 74), (92, 178, 104), (36, 100, 52)
    scarf, scarf_dark = (200, 52, 48), (150, 34, 36)
    tunic, tunic_light = (72, 150, 84), (110, 188, 120)
    belt, buckle = (112, 72, 40), (236, 190, 70)
    trousers, boot, bracer = (128, 90, 54), (72, 46, 30), (104, 66, 38)
    if not female:
        brown_hair = (112, 70, 38)
        paint_hair(sk, brown_hair, long_hair=False, bangs="side")
        draw_face(sk, tone, female=False, iris=(78, 136, 84), brow=(70, 46, 30))
        # a cap: the cap part is painted as cloth; its front is a brim, the sides come down to the ears
        sk.face("HairCap", "top", lambda x, y, w, h: cap_light if (x + y) % 7 == 0 else cap, noise=1)
        sk.face("HairCap", "front", lambda x, y, w, h: cap_dark if y >= h - 2 else cap, noise=1)
        for face in ("left", "right"):
            sk.face("HairCap", face, lambda x, y, w, h: cap_dark if y >= h - 1 else cap, noise=1)
        sk.face("HairCap", "back", lambda x, y, w, h: cap_dark if y >= h - 1 else cap, noise=1)
    else:
        auburn = (150, 74, 40)
        paint_hair(sk, auburn, long_hair=True, bangs="part", highlight=24)
        draw_face(sk, tone, female=True, iris=(70, 130, 90), brow=(110, 56, 34), lip=(190, 86, 92), lip_low=(216, 116, 116))
        # a red headband across the forehead and round the head
        band, band_dark = (200, 52, 48), (150, 34, 36)
        for face in ("front", "left", "right", "back"):
            w, h = sk.size("HairCap", face)
            for x in range(w):
                sk.put("HairCap", face, x, h - 1, band, lit=True)
                sk.put("HairCap", face, x, h - 2, band_dark if face == "back" else band, lit=True)
    # a scarf for the man, a vest for the woman
    sk.part("Neck", lambda x, y, w, h: scarf_dark if y % 2 == 1 else scarf, noise=1)
    sk.face("Chest", "front", lambda x, y, w, h: scarf if y < 2 else (tunic_light if x in (w // 2 - 1, w // 2) and y % 3 == 0 else tunic), noise=1)
    for face in ("back", "left", "right", "top", "bottom"):
        sk.face("Chest", face, lambda x, y, w, h: scarf if (face != "bottom" and y < 1) else tunic, noise=1)
    sk.part("Waist", flat(tunic), noise=1)
    if female:
        cream = (236, 224, 196)
        # a cream shirt under the vest: long sleeves rolled to the elbow, the vest open at the front
        sk.face("Chest", "front", lambda x, y, w, h: (scarf if y < 2 else (cream if w // 2 - 1 <= x <= w // 2 and y >= 2 else tunic)), noise=1)
        for side in SIDES:
            sk.part(f"{side}UpperArm", lambda x, y, w, h: cream if y < 8 else None, noise=1)
    # belt on the hips, with a buckle
    sk.part("Hips", lambda x, y, w, h: belt if y < 2 else trousers, noise=1)
    bw, _ = sk.size("Hips", "front")
    for dx in (-1, 0, 1):
        sk.put("Hips", "front", bw // 2 + dx, 0, buckle, lit=True)
        sk.put("Hips", "front", bw // 2 + dx, 1, add(buckle, -40), lit=True)
    for side in SIDES:
        if not female:
            sk.part(f"{side}UpperArm", lambda x, y, w, h: tunic if y < 8 else (tunic_light if y == 8 else None), noise=1)
        sk.part(f"{side}Forearm", lambda x, y, w, h: bracer if y >= 5 else None, noise=1)
        sk.part(f"{side}Thigh", flat(trousers), noise=1)
        sk.part(f"{side}Shin", lambda x, y, w, h: boot if y >= 6 else (add(trousers, 16) if y == 5 else trousers), noise=1)
        sk.part(f"{side}Foot", flat(boot), noise=1)
        sk.face(f"{side}Foot", "bottom", flat(add(boot, -30)), noise=0)
    return sk


# ---------------------------------------------------------------- write everything
def main():
    male = Rig("male", "Humanoid", "humanoid", "Character-Skin.png", male_parts())
    female = Rig("female", "Humanoid (female)", "humanoid-female", "Character-Female-Skin.png", female_parts())
    core = ROOT / "src/core"
    tex = ROOT / "assets/textures"
    for rig, file in ((male, "humanoid.model.json"), (female, "humanoid-female.model.json")):
        model = rig.build_model()
        out = core / file
        out.write_text(json.dumps(model, separators=(",", ":")))
        print("wrote", out, f"{out.stat().st_size} bytes,", len(model["cubes"]), "parts")
    make_plain(male, False).save(tex / "Character-Skin.png")
    make_template(male).save(tex / "Character-Template.png")
    make_explorer(male, False).save(tex / "Character-Explorer.png")
    make_plain(female, True).save(tex / "Character-Female-Skin.png")
    make_template(female).save(tex / "Character-Female-Template.png")
    make_explorer(female, True).save(tex / "Character-Female-Explorer.png")
    print("wrote the skins in", tex)


if __name__ == "__main__":
    main()
