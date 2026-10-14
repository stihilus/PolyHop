#!/usr/bin/env python3
"""Makes the icons of the app from the logo mark (assets/brand/polyhop-logo.svg):

  public/favicon.svg            the mascot in the accent color on a dark rounded square
  public/favicon-32.png         the same, 32 x 32 (browsers without SVG icons)
  public/apple-touch-icon.png   the same on a full square, 180 x 180 (iPad / iPhone home screen)

The PNGs are drawn here from the same paths (curves flattened, even-odd fill, 4x supersampled), so no SVG
renderer is needed. Run from the project root:

    python3 tools/make-icons.py
"""
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets/brand/polyhop-logo.svg"
OUT = ROOT / "public"

BG = "#14161b"
INK = "#ffb23e"
SS = 4  # supersampling

# the mascot fills 189.5 x 181.8 units (it reaches a little left of 0)
MIN_X, WIDTH, HEIGHT = -2.5, 189.5, 181.8

source = LOGO.read_text()
DATA = re.findall(r'<path d="([^"]+)"', source)
assert DATA, "no paths in the logo"


def placement(size: float, fill: float):
    """Scale and offset that centre the mascot in a square of `size`, filling `fill` of it."""
    scale = size * fill / max(WIDTH, HEIGHT)
    return scale, (size - WIDTH * scale) / 2 - MIN_X * scale, (size - HEIGHT * scale) / 2


def svg_icon(size: int, radius: float, fill: float) -> str:
    scale, tx, ty = placement(size, fill)
    paths = "".join(f'<path d="{d}"/>' for d in DATA)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="{radius}" fill="{BG}"/>'
        f'<g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})" fill="{INK}">{paths}</g></svg>\n'
    )


def subpaths(d: str):
    """The closed outlines of a path made of M, L, C and Z, as lists of points (curves flattened)."""
    tokens = re.findall(r"[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    out, cur, i, pos = [], [], 0, (0.0, 0.0)
    while i < len(tokens):
        t = tokens[i]
        i += 1
        if t == "Z":
            if cur:
                out.append(cur)
            cur = []
        elif t in "ML":
            x, y = float(tokens[i]), float(tokens[i + 1])
            i += 2
            if t == "M" and cur:
                out.append(cur)
                cur = []
            cur.append((x, y))
            pos = (x, y)
        elif t == "C":
            c = [float(v) for v in tokens[i : i + 6]]
            i += 6
            p0, p1, p2, p3 = pos, (c[0], c[1]), (c[2], c[3]), (c[4], c[5])
            for k in range(1, 17):
                u = k / 16
                a, b, cc, dd = (1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u * u, u**3
                cur.append((a * p0[0] + b * p1[0] + cc * p2[0] + dd * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + dd * p3[1]))
            pos = p3
    if cur:
        out.append(cur)
    return out


def png_icon(size: int, radius: float, fill: float) -> Image.Image:
    big = size * SS
    scale, tx, ty = placement(big, fill)
    mask = Image.new("L", (big, big), 0)
    for d in DATA:
        for outline in subpaths(d):
            one = Image.new("L", (big, big), 0)
            ImageDraw.Draw(one).polygon([(x * scale + tx, y * scale + ty) for x, y in outline], fill=255)
            mask = ImageChops.logical_xor(mask.convert("1"), one.convert("1")).convert("L")  # even-odd: holes stay holes
    card = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * SS, fill=BG)
    ink = Image.new("RGBA", (big, big), INK)
    card.paste(ink, (0, 0), mask)
    return card.resize((size, size), Image.LANCZOS)


OUT.mkdir(exist_ok=True)
(OUT / "favicon.svg").write_text(svg_icon(64, 14, 0.78))
png_icon(32, 7, 0.8).save(OUT / "favicon-32.png", optimize=True)
png_icon(180, 0, 0.74).save(OUT / "apple-touch-icon.png", optimize=True)
for name in ("favicon.svg", "favicon-32.png", "apple-touch-icon.png"):
    print("wrote", OUT / name)
