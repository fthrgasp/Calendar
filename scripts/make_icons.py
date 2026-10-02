#!/usr/bin/env python3
"""Regenerates the app icons (180/192/512 px) from icons/source-puffin-transparent.webp on a solid color tile.

  python3 scripts/make_icons.py            # default tile color
  python3 scripts/make_icons.py "#FFF1D6"  # any hex color

iPhone icons can't be transparent, so the transparent puffin is centered on an opaque tile.
Needs macOS `sips` and Homebrew `librsvg` (rsvg-convert) + `webp` (dwebp).
"""
import os, subprocess, sys, tempfile

COLOR = sys.argv[1] if len(sys.argv) > 1 else '#1C3D54'
FILL = 0.80          # figure height as a fraction of the tile (leaves a comfortable margin; keeps feet and edges clear)
SIZES = [180, 192, 512]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'icons', 'source-puffin-transparent.webp')

def run(*cmd): subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)

with tempfile.TemporaryDirectory() as tmp:
    png = os.path.join(tmp, 'puffin.png'); pam = os.path.join(tmp, 'puffin.pam')
    run('sips', '-s', 'format', 'png', SRC, '--out', png)
    run('dwebp', SRC, '-pam', '-o', pam)
    # find the visible bounds (alpha > 16) so the figure is centered by what you can see, not by the image edges
    data = open(pam, 'rb').read(); i = data.index(b'ENDHDR\n') + 7
    hdr = dict(l.split(b' ', 1) for l in data[:i].split(b'\n') if b' ' in l)
    W, H = int(hdr[b'WIDTH']), int(hdr[b'HEIGHT']); px = data[i:]
    xs = [x for y in range(0, H, 3) for x in range(W) if px[(y * W + x) * 4 + 3] > 16]
    ys = [y for y in range(H) for x in range(0, W, 3) if px[(y * W + x) * 4 + 3] > 16]
    cx, cy, bh = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, max(ys) - min(ys) + 1
    for S in SIZES:
        scale = FILL * S / bh
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">'
               f'<rect width="{S}" height="{S}" fill="{COLOR}"/>'
               f'<image x="{S/2 - cx*scale}" y="{S/2 - cy*scale}" width="{W*scale}" height="{H*scale}" href="puffin.png"/></svg>')
        open(os.path.join(tmp, 'tile.svg'), 'w').write(svg)
        run('rsvg-convert', os.path.join(tmp, 'tile.svg'), '-o', os.path.join(ROOT, 'icons', f'icon-{S}.png'))
        print(f'wrote icons/icon-{S}.png on {COLOR}')
