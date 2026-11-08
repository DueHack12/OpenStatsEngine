"""
The macOS menu bar icon: the logo's ring, bars and trend line (public/icon.svg)
as a one-colour template image, which macOS tints to suit a light or dark menu
bar. Writes MenuBarIcon.png (18 px) and MenuBarIcon@2x.png (36 px).

    python3 build/icon/menubar-icon.py build/icon      # needs Pillow
"""
import sys
from PIL import Image, ImageDraw, ImageChops
out = sys.argv[1]
K = 8                       # supersampling
def draw(px):
    S = px * K
    # Logo group coords: ring centre (150,150) r=130. Fit ring outer edge into the canvas.
    stroke_ring, bar_w, line_w, gap = 30, 30, 20, 10
    R = 130 + stroke_ring / 2
    scale = S / (2 * R + 4)
    o = S / 2 - 150 * scale
    f = lambda v: o + v * scale
    img = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(img)
    r_out, r_in = (130 + stroke_ring / 2) * scale, (130 - stroke_ring / 2) * scale
    c = S / 2
    bars = [(75, 150, 60), (115, 110, 100), (155, 70, 140), (195, 130, 80)]
    for x, y, h in bars:
        cx = x + 12
        d.rounded_rectangle([f(cx - bar_w / 2), f(y), f(cx + bar_w / 2), f(y + h)], radius=6 * scale, fill=255)
    pts = [(60, 160), (127, 100), (167, 125), (235, 55)]
    P = [(f(x), f(y)) for x, y in pts]
    def poly(width, fill):
        d.line(P, fill=fill, width=int(width * scale), joint='curve')
        for x, y in P:
            r = width * scale / 2
            d.ellipse([x - r, y - r, x + r, y + r], fill=fill)
    poly(line_w + 2 * gap, 0)   # knock the line out of the bars so it reads
    poly(line_w, 255)
    ring = Image.new('L', (S, S), 0)
    rd = ImageDraw.Draw(ring)
    rd.ellipse([c - r_out, c - r_out, c + r_out, c + r_out], fill=255)
    rd.ellipse([c - r_in, c - r_in, c + r_in, c + r_in], fill=0)
    img.paste(255, (0, 0), ring)
    r = 16 * scale
    x, y = P[-1]
    d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    a = img.resize((px, px), Image.LANCZOS)
    rgba = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    rgba.putalpha(a)
    return rgba
draw(18).save(f'{out}/MenuBarIcon.png')
draw(36).save(f'{out}/MenuBarIcon@2x.png')
