#!/usr/bin/env python3
"""Draws assets/textures/Props-16.png: the tiles of the built-in prop models (trees, ores, chests, gems, ...).

    python3 tools/make-props.py

The tile order below is the same list as PROP_TILE_NAMES in src/core/props.ts (row by row, 16 per row).
Pixels that are fully transparent are cut out in the game (leaves, flames, flowers, ...).
"""
import random
from pathlib import Path

from PIL import Image
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from pixel_helpers import soften_extremes  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
T = 16
COLS = 16

NAMES = [
    # row 0: wood and plants
    "bark", "log_end", "leaves", "pine", "birch_bark", "birch_leaves", "planks", "planks_dark",
    "mushroom_cap", "mushroom_stem", "pumpkin", "pumpkin_top", "cactus", "hay", "rope", "moss",
    # row 1: stone, ores and metal
    "stone", "coal_ore", "iron_ore", "gold_ore", "diamond_ore", "emerald_ore", "ruby_ore", "copper_ore",
    "cobble_mossy", "brick_dark", "obsidian", "metal_plate", "gold_block", "dark_metal", "gravestone", "lava",
    # row 2: furniture and props
    "chest_front", "chest_side", "chest_top", "barrel_side", "barrel_top", "crate", "bookshelf", "cloth_red",
    "cloth_blue", "cloth_green", "torch_wood", "flame", "lantern", "candle", "pillow", "blanket",
    # row 3: gems, potions, ground
    "ruby", "emerald", "sapphire", "amethyst", "diamond", "potion_red", "potion_blue", "potion_green",
    "cork", "water", "slime", "snow", "ice", "sand", "dirt", "wool_white",
    # row 4: sprites with transparent background
    "poppy", "cornflower", "dandelion", "daisy", "tall_grass", "fern", "sapling", "wheat",
    "tulip", "rose_bush", "sunflower", "lily", "clover", "reed", "blank", "blank",
]
ROWS = (len(NAMES) + COLS - 1) // COLS
assert len(NAMES) % COLS == 0

im = Image.new("RGBA", (T * COLS, T * ROWS), (0, 0, 0, 0))
px = im.load()
rnd = random.Random(2077)


def clamp(v):
    return max(0, min(255, int(v)))


def shade(c, d):
    return (clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d), c[3] if len(c) > 3 else 255)


def mix(a, b, t):
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


class Tile:
    def __init__(self, name):
        i = NAMES.index(name)
        self.ox = (i % COLS) * T
        self.oy = (i // COLS) * T

    def put(self, x, y, c):
        if 0 <= x < T and 0 <= y < T:
            px[self.ox + x, self.oy + y] = (c[0], c[1], c[2], c[3] if len(c) > 3 else 255)

    def get(self, x, y):
        return px[self.ox + x, self.oy + y]

    def fill(self, c, noise=0):
        for y in range(T):
            for x in range(T):
                n = rnd.randint(-noise, noise) if noise else 0
                self.put(x, y, shade(c, n))

    def rect(self, x0, y0, x1, y1, c, noise=0):
        """Filled rectangle, inclusive corners."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                n = rnd.randint(-noise, noise) if noise else 0
                self.put(x, y, shade(c, n))

    def border(self, c, w=1):
        for i in range(T):
            for k in range(w):
                self.put(i, k, c)
                self.put(i, T - 1 - k, c)
                self.put(k, i, c)
                self.put(T - 1 - k, i, c)

    def erase(self, x, y):
        px[self.ox + x, self.oy + y] = (0, 0, 0, 0)


def tile(name):
    return Tile(name)


# ------------------------------------------------------------------ palettes
WOOD_L = (190, 142, 84)
WOOD = (150, 104, 58)
WOOD_D = (108, 72, 40)
WOOD_DD = (72, 48, 28)
STONE = (130, 130, 134)
STONE_D = (96, 96, 102)
STONE_L = (160, 160, 166)
LEAF = (72, 152, 62)
LEAF_D = (44, 108, 44)
LEAF_L = (108, 186, 84)
METAL = (150, 152, 162)
METAL_D = (88, 90, 100)


# ------------------------------------------------------------------ row 0: wood and plants
t = tile("bark")
t.fill(WOOD_D, 6)
for x in range(T):
    if rnd.random() < 0.6:
        y = rnd.randint(0, 10)
        for k in range(rnd.randint(3, 8)):
            t.put(x, (y + k) % T, shade(WOOD_DD, rnd.randint(-4, 4)))
    if rnd.random() < 0.4:
        y = rnd.randint(0, 12)
        for k in range(rnd.randint(2, 5)):
            t.put(x, (y + k) % T, shade(WOOD, rnd.randint(-6, 6)))

t = tile("log_end")
t.fill(WOOD_D, 4)
for r in range(7):
    c = (196, 150, 96) if r % 2 == 0 else (164, 118, 70)
    t.rect(1 + r, 1 + r, 14 - r, 14 - r, shade(c, 0))
t.border(WOOD_DD)
t.put(7, 7, WOOD_D)
t.put(8, 8, WOOD_D)


def foliage(name, base, dark, light, hole):
    t = tile(name)
    t.fill(base, 8)
    for _ in range(40):
        x, y = rnd.randrange(T), rnd.randrange(T)
        t.put(x, y, shade(dark, rnd.randint(-6, 6)))
    for _ in range(30):
        x, y = rnd.randrange(T), rnd.randrange(T)
        t.put(x, y, shade(light, rnd.randint(-6, 6)))
    for _ in range(int(T * T * hole)):
        t.erase(rnd.randrange(T), rnd.randrange(T))
    return t


foliage("leaves", LEAF, LEAF_D, LEAF_L, 0.16)
foliage("pine", (36, 100, 66), (22, 70, 48), (66, 134, 88), 0.2)
foliage("birch_leaves", (140, 176, 60), (98, 140, 44), (190, 210, 90), 0.16)

t = tile("birch_bark")
t.fill((228, 224, 212), 6)
for _ in range(9):
    y = rnd.randrange(T)
    x = rnd.randrange(T - 4)
    for k in range(rnd.randint(2, 5)):
        t.put(x + k, y, shade((44, 42, 40), rnd.randint(-8, 8)))
    if rnd.random() < 0.5:
        t.put(x, y + 1, (120, 116, 108))
t.rect(0, 0, 0, 15, (190, 186, 176))
t.rect(15, 0, 15, 15, (190, 186, 176))


def planks(name, light, mid, dark):
    t = tile(name)
    for b in range(4):
        y0 = b * 4
        t.rect(0, y0, 15, y0 + 2, mid, 6)
        t.rect(0, y0 + 3, 15, y0 + 3, dark)
        # grain
        for _ in range(3):
            gx = rnd.randrange(T)
            t.put(gx, y0 + 1, shade(light, rnd.randint(-8, 8)))
            t.put((gx + 1) % T, y0 + 1, shade(light, rnd.randint(-8, 8)))
        # nails at the ends
        t.put(1, y0 + 1, dark)
        t.put(14, y0 + 1, dark)
        # end joints shifted per board
        j = (b * 5 + 3) % 12 + 2
        t.rect(j, y0, j, y0 + 2, dark)


planks("planks", WOOD_L, WOOD, WOOD_D)
planks("planks_dark", WOOD, WOOD_D, WOOD_DD)

t = tile("mushroom_cap")
t.fill((196, 38, 40), 8)
for cx, cy in [(3, 3), (10, 2), (7, 8), (13, 9), (3, 12), (9, 13)]:
    t.rect(cx, cy, cx + 1, cy + 1, (244, 240, 228))
    t.put(cx - 1, cy, (232, 226, 214))

t = tile("mushroom_stem")
t.fill((232, 222, 200), 5)
t.rect(11, 0, 15, 15, (200, 188, 164), 4)
t.rect(0, 0, 1, 15, (246, 240, 224), 3)

t = tile("pumpkin")
t.fill((232, 128, 30), 5)
for x in (0, 5, 10, 15):
    t.rect(x, 0, x, 15, (176, 84, 14))
    if x + 1 < T:
        t.rect(x + 1, 0, x + 1, 15, (206, 106, 20))
for _ in range(10):
    t.put(rnd.randrange(T), rnd.randrange(T), (250, 168, 70))

t = tile("pumpkin_top")
t.fill((226, 120, 26), 5)
for r in (6, 7):
    pass
t.rect(5, 5, 10, 10, (190, 90, 18))
t.rect(7, 7, 8, 8, (96, 140, 40))
t.rect(6, 6, 9, 9, (82, 120, 36))
t.rect(7, 7, 8, 8, (110, 160, 50))

t = tile("cactus")
t.fill((60, 146, 72), 6)
for x in (3, 8, 12):
    t.rect(x, 0, x, 15, (40, 108, 52))
for _ in range(14):
    t.put(rnd.randrange(T), rnd.randrange(T), (232, 228, 160))
t.border((36, 98, 48))

t = tile("hay")
t.fill((224, 190, 82), 8)
for _ in range(26):
    y = rnd.randrange(T)
    x = rnd.randrange(T - 5)
    c = rnd.choice([(190, 150, 50), (246, 220, 120), (206, 168, 62)])
    for k in range(rnd.randint(3, 6)):
        t.put(x + k, y, c)
t.rect(0, 5, 15, 5, (150, 110, 40))
t.rect(0, 10, 15, 10, (150, 110, 40))

t = tile("rope")
for y in range(T):
    for x in range(T):
        c = (156, 116, 66) if ((x + y) // 2) % 2 == 0 else (112, 78, 42)
        t.put(x, y, shade(c, rnd.randint(-5, 5)))

t = tile("moss")
t.fill((70, 134, 58), 8)
for _ in range(36):
    t.put(rnd.randrange(T), rnd.randrange(T), shade((100, 170, 70), rnd.randint(-8, 8)))
for _ in range(20):
    t.put(rnd.randrange(T), rnd.randrange(T), (48, 98, 44))


# ------------------------------------------------------------------ row 1: stone, ores, metal
def stone_base(t):
    t.fill(STONE, 8)
    for _ in range(26):
        t.put(rnd.randrange(T), rnd.randrange(T), shade(STONE_D, rnd.randint(-6, 6)))
    for _ in range(20):
        t.put(rnd.randrange(T), rnd.randrange(T), shade(STONE_L, rnd.randint(-6, 6)))


t = tile("stone")
stone_base(t)


def ore(name, main, accent=None, clusters=7):
    """Stone with chunky blobs of ore: each blob is a 3 x 3 patch with a corner or two knocked off."""
    t = tile(name)
    stone_base(t)
    taken = []
    tries = 0
    while len(taken) < clusters and tries < 60:
        tries += 1
        x, y = rnd.randrange(0, T - 3), rnd.randrange(0, T - 3)
        if any(abs(x - a) < 4 and abs(y - b) < 4 for a, b in taken):
            continue
        taken.append((x, y))
        for dx in range(3):
            for dy in range(3):
                if (dx in (0, 2) and dy in (0, 2)) and rnd.random() < 0.3:
                    continue
                c = main if (rnd.random() > 0.25 or not accent) else accent
                t.put(x + dx, y + dy, shade(c, rnd.randint(-8, 8)))
    return t


ore("coal_ore", (28, 28, 32), (62, 62, 70), 7)
ore("iron_ore", (216, 176, 150), (186, 140, 116), 7)
ore("gold_ore", (250, 214, 60), (255, 244, 150), 7)
ore("diamond_ore", (84, 226, 230), (230, 255, 255), 6)
ore("emerald_ore", (52, 200, 92), (150, 240, 170), 6)
ore("ruby_ore", (222, 36, 62), (255, 130, 150), 6)
ore("copper_ore", (206, 112, 58), (60, 176, 150), 7)

t = tile("cobble_mossy")
stone_base(t)
for _ in range(10):
    x, y = rnd.randrange(T), rnd.randrange(T)
    w = rnd.randint(3, 6)
    t.rect(x, y, min(15, x + w), y, STONE_D)
    t.rect(x, y, x, min(15, y + rnd.randint(2, 4)), STONE_D)
for _ in range(34):
    t.put(rnd.randrange(T), rnd.randrange(T), shade((70, 140, 60), rnd.randint(-10, 10)))

t = tile("brick_dark")
t.fill((84, 84, 94), 5)
for r in range(4):
    y = r * 4
    t.rect(0, y + 3, 15, y + 3, (44, 44, 52))
    off = 0 if r % 2 == 0 else 4
    for x in range(off, T, 8):
        t.rect(x, y, x, y + 2, (44, 44, 52))
    for _ in range(4):
        t.put(rnd.randrange(T), y + rnd.randrange(3), (104, 104, 116))

t = tile("obsidian")
t.fill((28, 18, 44), 5)
for _ in range(7):
    x = rnd.randrange(T)
    y = rnd.randrange(T)
    for k in range(rnd.randint(3, 6)):
        t.put((x + k) % T, (y + k // 2) % T, shade((88, 52, 140), rnd.randint(-10, 10)))
t.border((16, 10, 28))

t = tile("metal_plate")
t.fill(METAL, 5)
t.border(METAL_D)
for x, y in [(2, 2), (13, 2), (2, 13), (13, 13)]:
    t.put(x, y, (210, 212, 222))
    t.put(x + 1 if x < 8 else x - 1, y, METAL_D)
t.rect(3, 7, 12, 8, (126, 128, 138))

t = tile("gold_block")
t.fill((240, 200, 56), 5)
t.border((196, 140, 20))
for k in range(2, 12):
    t.put(k, 14 - k, (255, 240, 150))
    t.put(k + 1, 14 - k, (255, 226, 110))
t.rect(2, 2, 4, 4, (255, 236, 130))

t = tile("dark_metal")
t.fill((54, 56, 64), 4)
t.rect(0, 0, 15, 1, (98, 100, 112))
t.rect(0, 14, 15, 15, (30, 30, 36))

t = tile("gravestone")
t.fill((152, 154, 160), 5)
t.border((112, 114, 120))
t.rect(7, 3, 8, 11, (116, 118, 124))
t.rect(5, 5, 10, 6, (116, 118, 124))
for _ in range(6):
    t.put(rnd.randrange(T), rnd.randrange(T), (176, 178, 184))

t = tile("lava")
t.fill((236, 100, 20), 10)
for _ in range(18):
    x, y = rnd.randrange(T - 2), rnd.randrange(T - 2)
    t.rect(x, y, x + 1, y + 1, (255, 214, 60))
for _ in range(14):
    t.put(rnd.randrange(T), rnd.randrange(T), (170, 40, 10))


# ------------------------------------------------------------------ row 2: furniture and props
def boards(t, base, dark, light):
    for b in range(4):
        y0 = b * 4
        t.rect(0, y0, 15, y0 + 2, base, 6)
        t.rect(0, y0 + 3, 15, y0 + 3, dark)


t = tile("chest_front")
boards(t, WOOD, WOOD_D, WOOD_L)
t.rect(0, 0, 15, 1, METAL_D)
t.rect(6, 0, 9, 15, METAL)
t.rect(7, 5, 8, 9, (236, 196, 60))
t.put(7, 7, (60, 44, 20))
t.border(WOOD_DD)

t = tile("chest_side")
boards(t, WOOD, WOOD_D, WOOD_L)
t.rect(0, 0, 15, 1, METAL_D)
t.rect(1, 0, 3, 15, METAL)
t.rect(12, 0, 14, 15, METAL)
t.border(WOOD_DD)

t = tile("chest_top")
boards(t, WOOD_L, WOOD, WOOD_D)
t.rect(1, 0, 3, 15, METAL)
t.rect(12, 0, 14, 15, METAL)
t.border(WOOD_DD)

t = tile("barrel_side")
for x in range(T):
    c = WOOD if (x // 4) % 2 == 0 else WOOD_L
    t.rect(x, 0, x, 15, c, 6)
    if x % 4 == 3:
        t.rect(x, 0, x, 15, WOOD_D)
for y in (2, 3, 12, 13):
    t.rect(0, y, 15, y, METAL_D)
t.rect(0, 2, 15, 2, METAL)
t.rect(0, 12, 15, 12, METAL)

t = tile("barrel_top")
t.fill(WOOD_L, 6)
for x in (4, 8, 12):
    t.rect(x, 0, x, 15, WOOD_D)
t.border(METAL_D, 2)
t.put(8, 8, WOOD_DD)

t = tile("crate")
t.fill(WOOD, 6)
t.border(WOOD_D, 2)
for k in range(2, 14):
    t.put(k, k, WOOD_D)
    t.put(15 - k, k, WOOD_D)
for x, y in [(1, 1), (14, 1), (1, 14), (14, 14)]:
    t.put(x, y, (60, 44, 28))

t = tile("bookshelf")
t.fill(WOOD_DD, 3)
for shelf in (0, 1):
    y0 = 1 + shelf * 7
    x = 1
    while x < 15:
        w = rnd.choice([2, 2, 3])
        h = rnd.randint(4, 5)
        c = rnd.choice([(170, 40, 44), (44, 90, 170), (60, 140, 70), (220, 180, 60), (130, 60, 150), (200, 120, 50)])
        if x + w > 15:
            break
        t.rect(x, y0 + (5 - h), x + w - 1, y0 + 4, c, 8)
        t.put(x, y0 + (5 - h), shade(c, 40))
        x += w
t.rect(0, 0, 15, 0, WOOD_D)
t.rect(0, 6, 15, 6, WOOD)
t.rect(0, 13, 15, 15, WOOD)
t.rect(0, 0, 0, 15, WOOD)
t.rect(15, 0, 15, 15, WOOD)


def cloth(name, base, light):
    t = tile(name)
    for y in range(T):
        for x in range(T):
            c = base if (x + y) % 2 == 0 else shade(base, -12)
            t.put(x, y, shade(c, rnd.randint(-4, 4)))
    t.rect(0, 0, 15, 1, light)
    t.rect(0, 14, 15, 15, shade(base, -30))


cloth("cloth_red", (196, 40, 52), (232, 90, 90))
cloth("cloth_blue", (48, 88, 190), (96, 140, 230))
cloth("cloth_green", (56, 150, 72), (104, 200, 110))

t = tile("torch_wood")
t.fill((120, 82, 44), 6)
t.rect(0, 0, 3, 15, (84, 56, 30), 3)
t.rect(12, 0, 15, 15, (150, 108, 60), 3)

t = tile("flame")
# a teardrop of fire; everything else stays see-through
widths = [1, 2, 3, 4, 5, 6, 7, 7, 8, 8, 8, 8, 7, 6, 5, 3]
for y in range(T):
    w = widths[y]
    x0 = 8 - w // 2
    for k in range(w):
        edge = k == 0 or k == w - 1
        mid = abs(k - (w - 1) / 2) < w / 4
        if y > 8 and mid:
            c = (255, 244, 150)
        elif y > 5 and not edge:
            c = (255, 190, 50)
        elif edge:
            c = (226, 80, 24)
        else:
            c = (255, 150, 40)
        t.put(x0 + k, y, c)

t = tile("lantern")
t.fill((255, 226, 120), 8)
t.border((52, 44, 36), 2)
t.rect(7, 0, 8, 15, (52, 44, 36))
t.rect(0, 7, 15, 8, (52, 44, 36))
t.rect(3, 3, 5, 5, (255, 248, 190))

t = tile("candle")
t.fill((242, 238, 220), 4)
t.rect(11, 0, 15, 15, (214, 208, 186), 3)
t.rect(4, 0, 5, 6, (252, 250, 238))

t = tile("pillow")
t.fill((238, 238, 244), 4)
t.border((196, 196, 208))
t.rect(3, 3, 12, 12, (226, 226, 236), 3)

t = tile("blanket")
t.fill((186, 42, 52), 5)
for y in (3, 7, 11):
    t.rect(0, y, 15, y, (222, 86, 90))
t.rect(0, 15, 15, 15, (128, 24, 34))


# ------------------------------------------------------------------ row 3: gems, potions, ground
def gem(name, base, light, dark):
    t = tile(name)
    t.fill(base, 6)
    # facets: light up-left, dark down-right
    for k in range(T):
        for x in range(T - k):
            if x < 7 and k < 7 and x + k < 8:
                t.put(x, k, shade(light, rnd.randint(-8, 8)))
    for y in range(8, T):
        for x in range(8, T):
            if x + y > 20:
                t.put(x, y, shade(dark, rnd.randint(-8, 8)))
    t.rect(6, 6, 9, 9, shade(light, 30))
    t.border(shade(dark, -30))
    t.put(3, 3, (255, 255, 255))
    t.put(4, 3, (255, 255, 255))


gem("ruby", (214, 30, 60), (255, 120, 140), (128, 12, 36))
gem("emerald", (30, 176, 80), (130, 240, 160), (14, 100, 46))
gem("sapphire", (40, 96, 214), (130, 180, 255), (20, 52, 140))
gem("amethyst", (152, 70, 210), (214, 150, 255), (90, 36, 130))
gem("diamond", (110, 226, 236), (230, 255, 255), (60, 150, 176))


def potion(name, liquid, light, dark):
    t = tile(name)
    t.fill(liquid, 6)
    t.rect(1, 1, 3, 13, light)
    t.rect(12, 1, 14, 14, dark)
    t.rect(1, 12, 14, 14, dark)
    t.border((236, 244, 250))
    t.rect(4, 4, 5, 5, (255, 255, 255))


potion("potion_red", (210, 40, 56), (255, 130, 140), (140, 20, 36))
potion("potion_blue", (50, 110, 230), (140, 190, 255), (28, 60, 150))
potion("potion_green", (60, 200, 80), (160, 240, 150), (30, 120, 50))

t = tile("cork")
t.fill((204, 160, 100), 8)
for _ in range(10):
    t.put(rnd.randrange(T), rnd.randrange(T), (160, 120, 70))

t = tile("water")
t.fill((46, 110, 214), 6)
for y in (2, 6, 10, 14):
    x0 = rnd.randrange(8)
    t.rect(x0, y, x0 + 6, y, (120, 180, 250))

t = tile("slime")
t.fill((104, 208, 78), 6)
t.border((54, 150, 48))
t.rect(3, 3, 5, 4, (190, 255, 160))
t.rect(10, 9, 11, 10, (150, 230, 120))

t = tile("snow")
t.fill((240, 244, 252), 5)
for _ in range(12):
    t.put(rnd.randrange(T), rnd.randrange(T), (206, 218, 238))

t = tile("ice")
t.fill((168, 218, 242), 8)
for _ in range(6):
    x, y = rnd.randrange(T - 5), rnd.randrange(T)
    for k in range(5):
        t.put(x + k, (y + k // 2) % T, (230, 248, 255))

t = tile("sand")
t.fill((228, 208, 150), 8)
for _ in range(14):
    t.put(rnd.randrange(T), rnd.randrange(T), (200, 176, 118))

t = tile("dirt")
t.fill((124, 86, 54), 7)
for _ in range(20):
    t.put(rnd.randrange(T), rnd.randrange(T), (92, 62, 38))
for _ in range(8):
    t.put(rnd.randrange(T), rnd.randrange(T), (150, 108, 70))

t = tile("wool_white")
for y in range(T):
    for x in range(T):
        c = (236, 236, 236) if (x // 2 + y // 2) % 2 == 0 else (222, 222, 226)
        t.put(x, y, shade(c, rnd.randint(-3, 3)))


# ------------------------------------------------------------------ row 4: sprites (transparent background)
def stem(t, x, y0, y1, c=(64, 140, 56)):
    for y in range(y0, y1 + 1):
        t.put(x, y, c)


t = tile("poppy")
stem(t, 8, 7, 15)
t.rect(5, 8, 7, 9, (80, 160, 64))
t.rect(9, 11, 11, 12, (80, 160, 64))
for dx, dy in [(-2, 0), (-1, -1), (0, -2), (1, -1), (2, 0), (-1, 1), (0, 2), (1, 1), (0, 0), (-2, 1), (2, 1), (-1, 0), (1, 0), (0, -1), (0, 1)]:
    t.put(8 + dx, 4 + dy, (216, 32, 40))
t.put(8, 4, (40, 24, 24))

t = tile("cornflower")
stem(t, 8, 7, 15)
t.rect(5, 10, 7, 11, (80, 160, 64))
for dx, dy in [(-2, 0), (-1, -1), (0, -2), (1, -1), (2, 0), (-1, 1), (0, 2), (1, 1), (-1, 0), (1, 0), (0, -1), (0, 1)]:
    t.put(8 + dx, 4 + dy, (58, 110, 226))
t.put(8, 4, (230, 230, 250))

t = tile("dandelion")
stem(t, 8, 6, 15)
t.rect(9, 11, 11, 12, (80, 160, 64))
for dx in range(-2, 3):
    for dy in range(-2, 3):
        if abs(dx) + abs(dy) <= 3:
            t.put(8 + dx, 4 + dy, (250, 214, 40) if (dx + dy) % 2 == 0 else (236, 190, 28))

t = tile("daisy")
stem(t, 8, 7, 15)
t.rect(5, 10, 7, 11, (80, 160, 64))
for dx, dy in [(-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, -1), (-1, 1), (1, 1)]:
    t.put(8 + dx, 4 + dy, (250, 250, 250))
for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
    t.put(8 + dx, 4 + dy, (250, 200, 40))

t = tile("tall_grass")
for bx, top in [(2, 6), (4, 3), (6, 8), (8, 2), (10, 7), (12, 4), (14, 9)]:
    c = rnd.choice([(80, 164, 60), (58, 134, 48), (110, 190, 76)])
    for y in range(top, 16):
        t.put(bx, y, shade(c, rnd.randint(-6, 6)))
        if y < top + 3:
            t.put(bx + 1 if bx < 8 else bx - 1, y + 1, shade(c, -10))

t = tile("fern")
stem(t, 8, 2, 15, (46, 116, 52))
for k in range(3, 14, 2):
    w = min(5, 1 + (k // 2))
    w = min(w, 14 - k + 1) if k > 9 else w
    for d in range(1, w + 1):
        t.put(8 - d, k + d // 2, (66, 150, 66))
        t.put(8 + d, k + d // 2, (66, 150, 66))

t = tile("sapling")
t.rect(7, 9, 8, 15, (110, 76, 42))
for dx, dy in [(0, 0), (-1, 0), (1, 0), (-2, 1), (2, 1), (-1, 1), (1, 1), (0, 1), (-1, -1), (0, -1), (1, -1), (0, 2), (-1, 2), (1, 2), (0, -2)]:
    t.put(8 + dx, 6 + dy, shade((74, 156, 62), rnd.randint(-14, 14)))

t = tile("wheat")
for bx in (3, 6, 9, 12):
    top = rnd.randint(2, 5)
    for y in range(top + 3, 16):
        t.put(bx, y, (176, 150, 60))
    for y in range(top, top + 4):
        t.put(bx, y, (232, 196, 70))
        t.put(bx + 1, y + 1, (214, 176, 56))
        t.put(bx - 1, y + 1, (214, 176, 56))

t = tile("tulip")
stem(t, 8, 8, 15)
t.rect(5, 11, 7, 12, (80, 160, 64))
t.rect(6, 4, 10, 7, (232, 88, 140))
t.put(6, 3, (232, 88, 140))
t.put(8, 3, (232, 88, 140))
t.put(10, 3, (232, 88, 140))
t.rect(7, 5, 9, 7, (250, 140, 180))

t = tile("rose_bush")
t.rect(3, 6, 12, 15, (44, 112, 48))
t.rect(2, 8, 13, 13, (54, 130, 56))
for _ in range(14):
    t.put(rnd.randrange(3, 13), rnd.randrange(6, 15), shade((70, 150, 64), rnd.randint(-10, 10)))
for x, y in [(4, 8), (8, 7), (11, 10), (6, 12), (10, 13)]:
    t.rect(x, y, x + 1, y + 1, (214, 30, 54))

t = tile("sunflower")
stem(t, 8, 8, 15)
t.rect(5, 11, 7, 12, (80, 160, 64))
for dx in range(-3, 4):
    for dy in range(-3, 4):
        d = abs(dx) + abs(dy)
        if d <= 4:
            t.put(8 + dx, 4 + dy, (252, 208, 36) if d >= 3 else (110, 70, 30))

t = tile("lily")
t.rect(4, 6, 11, 11, (60, 140, 70))
t.rect(5, 5, 10, 12, (70, 156, 80))
t.erase(8, 6)
t.erase(8, 7)
t.rect(7, 7, 8, 8, (240, 120, 160))

t = tile("clover")
for cx, cy in [(5, 10), (10, 9), (7, 5)]:
    for dx, dy in [(0, 0), (1, 0), (0, 1), (1, 1), (-1, 0), (0, -1)]:
        t.put(cx + dx, cy + dy, shade((76, 164, 70), rnd.randint(-8, 8)))
    t.put(cx, cy + 2, (50, 110, 50))
    t.put(cx, cy + 3, (50, 110, 50))

t = tile("reed")
for bx, top in [(4, 2), (7, 0), (10, 3), (12, 1)]:
    for y in range(top, 16):
        t.put(bx, y, (92, 150, 70))
    t.rect(bx - 1, top, bx, top + 3, (120, 84, 48))

out = ROOT / "assets/textures/Props-16.png"
soften_extremes(im).save(out)
print("wrote", out, im.size)
