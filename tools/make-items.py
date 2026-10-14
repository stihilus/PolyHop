#!/usr/bin/env python3
"""Draws assets/textures/Items-16.png: the tiles of the built-in pickups (coin, key, apple, flag, hazard).

    python3 tools/make-items.py
"""
import random
from pathlib import Path

from PIL import Image
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from pixel_helpers import soften_extremes  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
T = 16
TILES = 8
im = Image.new("RGBA", (T * TILES, T), (0, 0, 0, 0))
px = im.load()
rnd = random.Random(11)


def put(tile, x, y, c):
    px[tile * T + x, y] = c


def fill(tile, color, noise=0):
    for y in range(T):
        for x in range(T):
            n = rnd.randint(-noise, noise) if noise else 0
            put(tile, x, y, tuple(max(0, min(255, v + n)) for v in color[:3]) + (255,))


GOLD = (255, 200, 40)
GOLD_D = (205, 140, 12)
GOLD_L = (255, 240, 150)

# 0: gold face with a rim and a shine
fill(0, GOLD, 4)
for i in range(T):
    for c in (GOLD_D,):
        put(0, i, 0, c)
        put(0, i, T - 1, c)
        put(0, 0, i, c)
        put(0, T - 1, i, c)
for i in range(3, T - 3):
    put(0, i, 3, GOLD_D)
    put(0, i, T - 4, GOLD_D)
    put(0, 3, i, GOLD_D)
    put(0, T - 4, i, GOLD_D)
for x, y in [(5, 5), (6, 5), (5, 6), (7, 6), (6, 7)]:
    put(0, x, y, GOLD_L)

# 1: darker gold for the edge of a coin
fill(1, GOLD_D, 5)

# 2: the key
fill(2, (232, 206, 96), 5)
for i in range(T):
    put(2, i, 0, (170, 140, 40, 255))
    put(2, i, T - 1, (170, 140, 40, 255))
    put(2, 0, i, (170, 140, 40, 255))
    put(2, T - 1, i, (170, 140, 40, 255))
for x, y in [(3, 3), (4, 3), (3, 4), (11, 11), (12, 11)]:
    put(2, x, y, (255, 248, 190, 255))

# 3: the apple, light from the top left
for y in range(T):
    for x in range(T):
        d = (x + y) / (2 * T)
        base = (230 - int(d * 90), 52 - int(d * 24), 48 - int(d * 22))
        n = rnd.randint(-5, 5)
        put(3, x, y, (max(0, base[0] + n), max(0, base[1] + n), max(0, base[2] + n), 255))
for x, y in [(3, 3), (4, 3), (3, 4), (4, 4), (5, 3)]:
    put(3, x, y, (255, 150, 140, 255))

# 4: stem
fill(4, (118, 78, 44), 8)
# 5: leaf
fill(5, (74, 176, 62), 8)
for i in range(2, T - 2):
    put(5, i, T // 2, (46, 126, 44, 255))
# 6: hazard stripes
for y in range(T):
    for x in range(T):
        put(6, x, y, (230, 40, 40, 255) if ((x + y) // 4) % 2 == 0 else (28, 24, 30, 255))
# 7: flag cloth
fill(7, (210, 36, 60), 5)
for x in range(T):
    put(7, x, 2, (255, 230, 230, 255))
    put(7, x, T - 3, (150, 20, 40, 255))

out = ROOT / "assets/textures/Items-16.png"
soften_extremes(im).save(out)
print("wrote", out)
