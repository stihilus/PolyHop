#!/usr/bin/env python3
"""Makes the Demo-16 texture atlas:

  assets/textures/Demo-16.png      a small atlas: gold and blue crystal, ruin stone, runes, spikes, moss

(The example game and its models are gone; the atlas stays for anyone to paint with.)
Everything is drawn from numbers, so it can be made again: run from the project root

    python3 tools/make-demo.py
"""
import sys
from pathlib import Path

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
