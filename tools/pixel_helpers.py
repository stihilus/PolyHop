"""Small helpers for drawing 16 x 16 tile atlases with PIL (used by make-kit.py, make-demo.py)."""
import random

from PIL import Image

T = 16

# The Hytale texturing advice: no pure white and no pure black (they break the lighting and ruin the values).
OFF_WHITE = (252, 249, 238)
OFF_BLACK = (22, 18, 32)


def soften_extremes(im):
    """Take pure white and pure black out of an image: sparkles become warm white, black becomes a dark violet."""
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if r >= 252 and g >= 252 and b >= 252:
                px[x, y] = (*OFF_WHITE, a)
            elif r <= 3 and g <= 3 and b <= 3:
                px[x, y] = (*OFF_BLACK, a)
    return im


def clamp(v):
    return max(0, min(255, int(v)))


def shade(c, d):
    return (clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d), c[3] if len(c) > 3 else 255)


def mix(a, b, t):
    return tuple(clamp(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


class Atlas:
    def __init__(self, names, cols=16, seed=1):
        self.names = names
        self.cols = cols
        self.rows = (len(names) + cols - 1) // cols
        self.im = Image.new("RGBA", (T * cols, T * self.rows), (0, 0, 0, 0))
        self.px = self.im.load()
        self.rnd = random.Random(seed)

    def tile(self, name):
        return Tile(self, self.names.index(name))

    def save(self, path):
        soften_extremes(self.im).save(path)


class Tile:
    def __init__(self, atlas, index):
        self.a = atlas
        self.px = atlas.px
        self.rnd = atlas.rnd
        self.ox = (index % atlas.cols) * T
        self.oy = (index // atlas.cols) * T

    def put(self, x, y, c):
        if 0 <= x < T and 0 <= y < T:
            self.px[self.ox + x, self.oy + y] = (c[0], c[1], c[2], c[3] if len(c) > 3 else 255)

    def get(self, x, y):
        return self.px[self.ox + x, self.oy + y]

    def erase(self, x, y):
        if 0 <= x < T and 0 <= y < T:
            self.px[self.ox + x, self.oy + y] = (0, 0, 0, 0)

    def fill(self, c, noise=0):
        for y in range(T):
            for x in range(T):
                n = self.rnd.randint(-noise, noise) if noise else 0
                self.put(x, y, shade(c, n))

    def rect(self, x0, y0, x1, y1, c, noise=0):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                n = self.rnd.randint(-noise, noise) if noise else 0
                self.put(x, y, shade(c, n))

    def hline(self, y, x0, x1, c):
        for x in range(x0, x1 + 1):
            self.put(x, y, c)

    def vline(self, x, y0, y1, c):
        for y in range(y0, y1 + 1):
            self.put(x, y, c)

    def border(self, c, w=1):
        for i in range(T):
            for k in range(w):
                self.put(i, k, c)
                self.put(i, T - 1 - k, c)
                self.put(k, i, c)
                self.put(T - 1 - k, i, c)

    def speckle(self, c, count, noise=0):
        for _ in range(count):
            self.put(self.rnd.randrange(T), self.rnd.randrange(T), shade(c, self.rnd.randint(-noise, noise) if noise else 0))

    def holes(self, fraction):
        for _ in range(int(T * T * fraction)):
            self.erase(self.rnd.randrange(T), self.rnd.randrange(T))
