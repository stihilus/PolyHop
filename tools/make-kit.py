#!/usr/bin/env python3
"""Draws assets/textures/Kit-16.png: the tiles of the building kit and the modeled trees.

    python3 tools/make-kit.py

The tile order below is the same list as KIT_TILE_NAMES in src/core/kit.ts (row by row, 16 per row).
Pixels that are fully transparent are cut out in the game (leaves, bars, fronds, ...).
"""
from pathlib import Path

from pixel_helpers import Atlas, mix, shade, T

ROOT = Path(__file__).resolve().parent.parent

NAMES = [
    # row 0: walls
    "stone_brick", "stone_brick_dark", "stone_block", "plaster", "plaster_aged", "timber", "timber_h", "timber_brace",
    "brick_red", "cobble", "cobble_dark", "rubble", "slate_wall", "sandstone", "marble", "stone_brick_moss",
    # row 1: roofs and floors
    "roof_red", "roof_slate", "roof_thatch", "roof_wood", "roof_copper", "roof_ridge", "floor_wood", "floor_flagstone",
    "floor_checker", "path_cobble", "path_dirt", "floor_stone", "carpet_red", "carpet_blue", "grass", "gravel",
    # row 2: trim, doors, windows
    "door_wood", "door_iron", "window", "shutter", "iron_bars", "trim_stone", "trim_wood", "beam_end",
    "plank_bridge", "chain", "lattice", "stripes", "canvas", "canvas_stripes", "metal_rust", "lamp_glow",
    # row 3: nature
    "bark_oak", "bark_pine", "bark_birch", "bark_dead", "leaves_oak", "leaves_light", "leaves_pine", "leaves_autumn",
    "leaves_cherry", "leaves_palm", "moss", "vines", "root", "trunk_cut", "grass_blades", "meadow",
    # row 4: misc
    "mush_cap", "mush_stem", "water", "foam", "dirt", "stone", "snow", "banner_red",
    "banner_blue", "wax", "glass", "straw", "sand", "ivy", "blank", "blank",
]
assert len(NAMES) % 16 == 0

A = Atlas(NAMES, 16, seed=4242)
rnd = A.rnd
tile = A.tile

STONE = (150, 150, 156)
STONE_D = (104, 104, 112)
STONE_L = (186, 186, 192)
MORTAR = (86, 86, 92)
WOOD = (150, 104, 58)
WOOD_L = (192, 144, 86)
WOOD_D = (108, 72, 40)
WOOD_DD = (68, 44, 26)
PLASTER = (232, 224, 204)


def bricks(t, base, mortar, light, rows=4, brick_w=8, noise=7):
    h = T // rows
    for r in range(rows):
        y0 = r * h
        off = 0 if r % 2 == 0 else brick_w // 2
        t.rect(0, y0, T - 1, y0 + h - 2, base, noise)
        t.hline(y0 + h - 1, 0, T - 1, mortar)
        for x in range(off, T + brick_w, brick_w):
            t.vline(x % T, y0, y0 + h - 2, mortar)
        # a lit top edge on every brick
        for x in range(T):
            t.put(x, y0, shade(light, rnd.randint(-6, 6)))
    return t


# ------------------------------------------------------------------ row 0: walls
t = tile("stone_brick")
bricks(t, STONE, MORTAR, STONE_L)

t = tile("stone_brick_dark")
bricks(t, (96, 98, 108), (52, 52, 60), (126, 128, 140))

t = tile("stone_block")
t.fill(STONE, 7)
# big blocks: two rows, offset joints, soft bevel light on top and left
for r in range(2):
    y0 = r * 8
    off = 0 if r == 0 else 4
    t.hline(y0 + 7, 0, T - 1, MORTAR)
    for x in (off % T, (off + 8) % T):
        t.vline(x, y0, y0 + 6, MORTAR)
    for x in range(T):
        t.put(x, y0, shade(STONE_L, rnd.randint(-5, 5)))
t.speckle(STONE_D, 18, 6)

t = tile("plaster")
t.fill(PLASTER, 5)
t.speckle((206, 198, 176), 20, 4)
t.speckle((246, 240, 224), 10, 3)

t = tile("plaster_aged")
t.fill((214, 204, 180), 7)
t.speckle((170, 156, 130), 26, 8)
for _ in range(3):
    x = rnd.randrange(T)
    for y in range(rnd.randrange(8), T):
        t.put(x, y, (180, 168, 142))
        if rnd.random() < 0.3:
            break

t = tile("timber")
t.fill(WOOD_D, 6)
for x in (3, 8, 12):
    t.vline(x, 0, 15, WOOD_DD)
for _ in range(10):
    t.put(rnd.randrange(T), rnd.randrange(T), WOOD)
t.vline(0, 0, 15, (86, 56, 32))
t.vline(15, 0, 15, (86, 56, 32))

t = tile("timber_h")
t.fill(WOOD_D, 6)
for y in (3, 8, 12):
    t.hline(y, 0, 15, WOOD_DD)
for _ in range(10):
    t.put(rnd.randrange(T), rnd.randrange(T), WOOD)
t.hline(0, 0, 15, (86, 56, 32))
t.hline(15, 0, 15, (86, 56, 32))

t = tile("timber_brace")
t.fill(PLASTER, 5)
t.speckle((206, 198, 176), 16, 4)
# a diagonal beam across the plaster
for k in range(-2, T + 2):
    for w in range(3):
        t.put(k + w, k, shade(WOOD_D, rnd.randint(-6, 6)))
t.vline(0, 0, 15, WOOD_D)
t.vline(1, 0, 15, WOOD_D)
t.vline(14, 0, 15, WOOD_D)
t.vline(15, 0, 15, WOOD_D)

t = tile("brick_red")
bricks(t, (176, 78, 58), (196, 186, 170), (208, 118, 92), rows=4, brick_w=8, noise=9)

t = tile("cobble")
t.fill((132, 130, 128), 5)
cells = [(0, 0, 5, 4), (5, 0, 5, 5), (10, 0, 6, 4), (0, 4, 4, 6), (4, 5, 6, 4), (10, 4, 6, 6), (0, 10, 6, 6), (6, 9, 5, 7), (11, 10, 5, 6)]
for x, y, w, h in cells:
    c = shade((160, 158, 154), rnd.randint(-14, 10))
    t.rect(x + 1, y + 1, x + w - 1, y + h - 1, c, 5)
    t.hline(y + 1, x + 1, x + w - 1, shade(c, 22))

t = tile("cobble_dark")
t.fill((70, 70, 78), 4)
for x, y, w, h in cells:
    c = shade((104, 106, 116), rnd.randint(-12, 8))
    t.rect(x + 1, y + 1, x + w - 1, y + h - 1, c, 5)
    t.hline(y + 1, x + 1, x + w - 1, shade(c, 20))

t = tile("rubble")
t.fill((98, 94, 90), 8)
for _ in range(12):
    x, y = rnd.randrange(T - 3), rnd.randrange(T - 3)
    c = shade((140, 136, 130), rnd.randint(-20, 14))
    t.rect(x, y, x + rnd.randint(1, 3), y + rnd.randint(1, 3), c)

t = tile("slate_wall")
for r in range(4):
    y0 = r * 4
    c = shade((78, 86, 104), (r % 2) * 8)
    t.rect(0, y0, 15, y0 + 2, c, 6)
    t.hline(y0 + 3, 0, 15, (46, 52, 66))
    for x in ((r * 5) % 16, (r * 5 + 8) % 16):
        t.vline(x, y0, y0 + 2, (46, 52, 66))

t = tile("sandstone")
t.fill((214, 188, 140), 6)
for y in (5, 10):
    t.hline(y, 0, 15, (176, 150, 104))
for x, y0 in [(4, 0), (11, 5), (6, 10)]:
    t.vline(x, y0, y0 + 4, (176, 150, 104))
t.speckle((232, 210, 164), 14, 5)

t = tile("marble")
t.fill((236, 236, 240), 4)
for _ in range(4):
    x, y = rnd.randrange(T), 0
    for k in range(T):
        t.put((x + k // 3 + rnd.randint(0, 1)) % T, k, shade((170, 176, 190), rnd.randint(-8, 8)))
        if rnd.random() < 0.08:
            x += rnd.choice([-1, 1])
t.border((206, 208, 214))

t = tile("stone_brick_moss")
bricks(t, STONE, MORTAR, STONE_L)
t.speckle((74, 140, 62), 40, 12)
for x in range(T):
    if rnd.random() < 0.5:
        t.put(x, 15, (62, 120, 54))
        t.put(x, 14, (74, 140, 62))

# ------------------------------------------------------------------ row 1: roofs and floors
def shingles(t, base, dark, light, rows=4, w=8):
    t.fill(dark, 0)
    h = T // rows
    for r in range(rows):
        y0 = r * h
        off = 0 if r % 2 == 0 else w // 2
        for x0 in range(-off, T, w):
            c = shade(base, rnd.randint(-10, 10))
            t.rect(max(0, x0), y0, min(T - 1, x0 + w - 2), y0 + h - 2, c, 3)
            t.hline(y0 + h - 1, max(0, x0), min(T - 1, x0 + w - 1), dark)
            t.put(min(T - 1, x0 + w - 1), y0 + h - 2, dark)
            t.hline(y0, max(0, x0), min(T - 1, x0 + w - 2), light)


t = tile("roof_red")
shingles(t, (176, 60, 46), (96, 30, 26), (212, 100, 80))
t = tile("roof_slate")
shingles(t, (70, 82, 104), (36, 42, 56), (106, 120, 146))
t = tile("roof_wood")
shingles(t, (140, 96, 56), (78, 52, 28), (178, 132, 84))
t = tile("roof_copper")
shingles(t, (74, 160, 140), (36, 92, 82), (130, 206, 184))

t = tile("roof_thatch")
t.fill((204, 168, 78), 8)
for _ in range(34):
    x, y = rnd.randrange(T), rnd.randrange(T - 4)
    c = rnd.choice([(172, 134, 52), (232, 202, 108), (190, 152, 64)])
    for k in range(rnd.randint(2, 5)):
        t.put(x, y + k, c)
for y in (4, 9, 14):
    t.hline(y, 0, 15, (150, 114, 40))

t = tile("roof_ridge")
t.fill((120, 40, 34), 5)
t.hline(0, 0, 15, (170, 70, 56))
t.hline(15, 0, 15, (70, 24, 20))
for x in range(0, T, 4):
    t.vline(x, 1, 14, (96, 30, 26))

t = tile("floor_wood")
for x in range(0, T, 4):
    c = shade((176, 128, 76), rnd.randint(-12, 12))
    t.rect(x, 0, x + 2, 15, c, 4)
    t.vline(x + 3, 0, 15, (96, 62, 34))
for x in range(0, T, 4):
    y = rnd.randrange(T)
    t.put(x + 1, y, (120, 82, 44))

t = tile("floor_flagstone")
t.fill((112, 112, 118), 3)
slabs = [(0, 0, 8, 7), (8, 0, 8, 5), (0, 7, 5, 9), (5, 7, 6, 9), (11, 5, 5, 11), (8, 5, 3, 2)]
for x, y, w, h in slabs:
    c = shade((158, 158, 164), rnd.randint(-10, 8))
    t.rect(x + 1, y + 1, x + w - 1, y + h - 1, c, 4)

t = tile("floor_checker")
for y in range(T):
    for x in range(T):
        c = (226, 224, 218) if ((x // 4) + (y // 4)) % 2 == 0 else (52, 52, 60)
        t.put(x, y, shade(c, rnd.randint(-4, 4)))

t = tile("path_cobble")
t.fill((120, 104, 84), 5)
for _ in range(14):
    x, y = rnd.randrange(T - 3), rnd.randrange(T - 3)
    c = shade((176, 160, 140), rnd.randint(-16, 10))
    t.rect(x, y, x + 2, y + 2, c, 3)

t = tile("path_dirt")
t.fill((150, 118, 80), 7)
t.speckle((112, 84, 54), 20, 6)
t.speckle((190, 160, 120), 10, 5)

t = tile("floor_stone")
t.fill((148, 148, 154), 5)
t.border((108, 108, 116))
t.rect(2, 2, 13, 13, (160, 160, 166), 3)

t = tile("carpet_red")
t.fill((170, 36, 48), 4)
t.border((228, 196, 90))
t.rect(2, 2, 13, 13, (150, 28, 40), 3)

t = tile("carpet_blue")
t.fill((44, 76, 170), 4)
t.border((228, 196, 90))
t.rect(2, 2, 13, 13, (36, 62, 146), 3)

t = tile("grass")
t.fill((86, 158, 64), 8)
t.speckle((60, 124, 48), 30, 8)
t.speckle((124, 190, 84), 26, 8)

t = tile("gravel")
t.fill((156, 152, 146), 9)
t.speckle((110, 106, 100), 30, 8)
t.speckle((200, 196, 188), 20, 6)

# ------------------------------------------------------------------ row 2: trim, doors, windows
t = tile("door_wood")
for x in range(0, T, 4):
    t.rect(x, 0, x + 2, 15, shade(WOOD, rnd.randint(-8, 8)), 4)
    t.vline(x + 3, 0, 15, WOOD_DD)
t.rect(0, 3, 15, 4, (60, 60, 68))
t.rect(0, 11, 15, 12, (60, 60, 68))
t.put(12, 8, (232, 196, 70))
t.put(12, 9, (232, 196, 70))
t.border(WOOD_DD)

t = tile("door_iron")
t.fill((72, 74, 84), 4)
t.border((40, 40, 48))
for y in (3, 8, 13):
    t.hline(y, 1, 14, (50, 50, 58))
for x, y in [(2, 2), (13, 2), (2, 13), (13, 13), (8, 8)]:
    t.put(x, y, (150, 152, 162))

t = tile("window")
t.fill((150, 200, 226), 6)
t.rect(0, 0, 15, 1, WOOD_D)
t.rect(0, 14, 15, 15, WOOD_D)
t.rect(0, 0, 1, 15, WOOD_D)
t.rect(14, 0, 15, 15, WOOD_D)
t.rect(7, 0, 8, 15, WOOD_D)
t.rect(0, 7, 15, 8, WOOD_D)
t.put(3, 3, (230, 246, 255))
t.put(4, 3, (230, 246, 255))
t.put(10, 10, (230, 246, 255))

t = tile("shutter")
for x in range(0, T, 4):
    t.rect(x, 0, x + 2, 15, shade((70, 128, 84), rnd.randint(-8, 8)), 3)
    t.vline(x + 3, 0, 15, (36, 78, 48))
t.border((36, 78, 48))

t = tile("iron_bars")
for x in (2, 6, 10, 14):
    t.vline(x, 0, 15, (74, 76, 86))
    t.vline(x - 1, 0, 15, (110, 112, 124))
t.hline(1, 0, 15, (74, 76, 86))
t.hline(14, 0, 15, (74, 76, 86))

t = tile("trim_stone")
t.fill((196, 196, 202), 4)
t.hline(0, 0, 15, (226, 226, 232))
t.hline(15, 0, 15, (140, 140, 148))
t.speckle((170, 170, 178), 10, 4)

t = tile("trim_wood")
t.fill(WOOD_L, 5)
t.hline(0, 0, 15, (222, 178, 118))
t.hline(15, 0, 15, WOOD_D)
for y in (4, 9):
    t.hline(y, 0, 15, shade(WOOD, -6))

t = tile("beam_end")
t.fill(WOOD, 5)
for r in range(4):
    t.rect(2 + r, 2 + r, 13 - r, 13 - r, (196, 150, 96) if r % 2 == 0 else (164, 118, 70))
t.border(WOOD_DD)

t = tile("plank_bridge")
t.fill(WOOD, 5)
for y in (0, 5, 10):
    t.hline(y + 4, 0, 15, WOOD_DD)
for y in range(0, T, 5):
    t.put(1, y + 2, WOOD_DD)
    t.put(14, y + 2, WOOD_DD)
t.vline(0, 0, 15, (176, 150, 100))
t.vline(15, 0, 15, (176, 150, 100))

t = tile("chain")
for y in range(0, T, 4):
    t.rect(6, y, 9, y + 1, (130, 132, 144))
    t.rect(7, y + 2, 8, y + 3, (80, 82, 94))

t = tile("lattice")
for k in range(-T, T, 4):
    for i in range(T):
        t.put(i, (i + k) % T if 0 <= i + k < T else -1, WOOD_D)
        t.put(i, (-i + k + T) % T if 0 <= -i + k + T < T else -1, WOOD_D)
t.border(WOOD_DD)

t = tile("stripes")
for x in range(T):
    t.rect(x, 0, x, 15, (200, 40, 48) if (x // 4) % 2 == 0 else (240, 236, 224), 3)

t = tile("canvas")
t.fill((226, 214, 180), 5)
t.hline(15, 0, 15, (176, 160, 120))

t = tile("canvas_stripes")
for x in range(T):
    t.rect(x, 0, x, 15, (196, 52, 56) if (x // 4) % 2 == 0 else (238, 232, 214), 3)
t.hline(15, 0, 15, (120, 40, 40))

t = tile("metal_rust")
t.fill((120, 100, 90), 8)
t.speckle((168, 90, 40), 36, 10)
t.speckle((84, 70, 64), 20, 8)

t = tile("lamp_glow")
t.fill((255, 232, 140), 8)
t.rect(4, 4, 11, 11, (255, 248, 200), 4)
t.border((120, 100, 50))

# ------------------------------------------------------------------ row 3: nature
t = tile("bark_oak")
t.fill((104, 74, 46), 6)
for x in range(T):
    if rnd.random() < 0.55:
        y = rnd.randrange(12)
        for k in range(rnd.randint(3, 9)):
            t.put(x, (y + k) % T, shade((70, 48, 30), rnd.randint(-4, 4)))
t.speckle((136, 100, 64), 24, 6)

t = tile("bark_pine")
t.fill((126, 76, 52), 6)
for y in range(0, T, 5):
    t.hline(y, 0, 15, (84, 48, 32))
for x in range(T):
    if rnd.random() < 0.35:
        t.put(x, rnd.randrange(T), (160, 100, 70))
t.speckle((100, 58, 40), 22, 6)

t = tile("bark_birch")
t.fill((230, 226, 216), 5)
for _ in range(10):
    x, y = rnd.randrange(T - 4), rnd.randrange(T)
    for k in range(rnd.randint(2, 5)):
        t.put(x + k, y, shade((46, 44, 42), rnd.randint(-6, 6)))
t.vline(0, 0, 15, (194, 190, 180))
t.vline(15, 0, 15, (194, 190, 180))

t = tile("bark_dead")
t.fill((118, 108, 98), 6)
for x in (2, 6, 9, 13):
    t.vline(x, 0, 15, (74, 66, 58))
t.speckle((150, 140, 128), 20, 6)


def leaves(name, base, dark, light, holes=0.18):
    t = tile(name)
    t.fill(base, 8)
    t.speckle(dark, 40, 6)
    t.speckle(light, 30, 6)
    # leaf-shaped chunks: short strokes of the light and dark tones
    for _ in range(14):
        x, y = rnd.randrange(T - 2), rnd.randrange(T - 2)
        c = rnd.choice([dark, light])
        t.put(x, y, c)
        t.put(x + 1, y + 1, c)
    t.holes(holes)


leaves("leaves_oak", (64, 142, 54), (38, 100, 40), (104, 184, 76))
leaves("leaves_light", (116, 180, 70), (78, 140, 52), (172, 214, 100))
leaves("leaves_pine", (34, 96, 62), (20, 64, 44), (62, 128, 82), 0.22)
leaves("leaves_autumn", (214, 120, 36), (160, 60, 28), (244, 190, 64))
leaves("leaves_cherry", (240, 156, 190), (200, 100, 150), (255, 214, 228), 0.2)

t = tile("leaves_palm")
# a frond: a center rib with leaflets, on a see-through background
for y in range(T):
    t.put(7, y, (96, 124, 52))
    t.put(8, y, (74, 100, 40))
for y in range(1, T - 1):
    spread = min(7, 1 + abs(y - 2) // 2 + (4 if y < 10 else 12 - y // 1))
    spread = max(1, min(7, 7 - abs(y - 7) // 1))
    for d in range(1, spread + 1):
        c = shade((70, 150, 60), -d * 3 + rnd.randint(-6, 6))
        if (y + d) % 2 == 0:
            t.put(7 - d, y, c)
            t.put(8 + d, y, c)

t = tile("moss")
t.fill((70, 134, 58), 8)
t.speckle((100, 170, 70), 36, 8)
t.speckle((48, 98, 44), 20, 6)

t = tile("vines")
for x in (3, 8, 12):
    for y in range(T):
        t.put(x + (1 if (y // 3) % 2 else 0), y, (52, 112, 48))
        if y % 4 == 1:
            t.put(x + 2, y, (80, 156, 66))
            t.put(x - 1, y + 1, (80, 156, 66))

t = tile("root")
t.fill((82, 58, 38), 6)
t.speckle((54, 38, 26), 24, 6)
t.speckle((112, 84, 56), 16, 6)

t = tile("trunk_cut")
t.fill((110, 78, 46), 4)
for r in range(7):
    t.rect(1 + r, 1 + r, 14 - r, 14 - r, (204, 160, 104) if r % 2 == 0 else (172, 128, 78))
t.border((84, 58, 34))
t.put(7, 7, (120, 86, 50))
t.put(8, 8, (120, 86, 50))

t = tile("grass_blades")
for bx, top in [(1, 5), (3, 2), (5, 7), (7, 1), (9, 6), (11, 3), (13, 8), (14, 4)]:
    c = rnd.choice([(86, 170, 62), (60, 138, 48), (118, 196, 82)])
    for y in range(top, T):
        t.put(bx, y, shade(c, rnd.randint(-6, 6)))

t = tile("meadow")
for bx in range(1, T, 2):
    top = rnd.randint(5, 10)
    for y in range(top, T):
        t.put(bx, y, shade((80, 160, 60), rnd.randint(-8, 8)))
for x, y, c in [(3, 4, (240, 220, 60)), (8, 3, (240, 240, 240)), (12, 6, (230, 90, 120)), (6, 7, (130, 150, 240))]:
    t.rect(x, y, x + 1, y + 1, c)

# ------------------------------------------------------------------ row 4: misc
t = tile("mush_cap")
t.fill((200, 44, 44), 8)
for cx, cy in [(3, 3), (10, 2), (7, 8), (13, 9), (3, 12), (9, 13)]:
    t.rect(cx, cy, cx + 1, cy + 1, (246, 242, 230))

t = tile("mush_stem")
t.fill((232, 222, 200), 5)
t.rect(11, 0, 15, 15, (200, 188, 164), 4)

t = tile("water")
t.fill((52, 120, 210), 6)
for y in (2, 6, 10, 14):
    x0 = rnd.randrange(8)
    t.hline(y, x0, x0 + 6, (130, 190, 250))

t = tile("foam")
t.fill((196, 226, 246), 6)
t.speckle((250, 252, 255), 30, 3)

t = tile("dirt")
t.fill((124, 86, 54), 7)
t.speckle((92, 62, 38), 20, 6)

t = tile("stone")
t.fill(STONE, 8)
t.speckle(STONE_D, 26, 6)
t.speckle(STONE_L, 20, 6)

t = tile("snow")
t.fill((240, 244, 252), 5)
t.speckle((206, 218, 238), 12, 4)

t = tile("banner_red")
t.fill((192, 36, 50), 4)
t.hline(1, 0, 15, (236, 196, 80))
t.hline(14, 0, 15, (236, 196, 80))
t.rect(6, 5, 9, 10, (236, 196, 80))

t = tile("banner_blue")
t.fill((44, 84, 190), 4)
t.hline(1, 0, 15, (236, 196, 80))
t.hline(14, 0, 15, (236, 196, 80))
t.rect(6, 5, 9, 10, (236, 196, 80))

t = tile("wax")
t.fill((244, 238, 220), 4)
t.rect(11, 0, 15, 15, (214, 208, 186), 3)

t = tile("glass")
t.fill((170, 214, 232), 6)
t.border((120, 160, 180))
t.put(3, 3, (240, 250, 255))
t.put(4, 3, (240, 250, 255))

t = tile("straw")
t.fill((226, 194, 90), 8)
t.speckle((196, 160, 60), 24, 6)

t = tile("sand")
t.fill((228, 208, 150), 8)
t.speckle((200, 176, 118), 14, 5)

t = tile("ivy")
t.fill((46, 104, 48), 8)
t.speckle((74, 144, 66), 36, 8)

out = ROOT / "assets/textures/Kit-16.png"
A.save(out)
print("wrote", out, A.im.size)
