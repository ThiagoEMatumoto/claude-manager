#!/usr/bin/env node
// Generates the app icon (rounded square + ">_" terminal glyph) at multiple
// sizes into build/icons/, so electron-builder installs them across all
// hicolor sizes (a single 512x512 is ignored by most Linux launchers).
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'build', 'icons')

const py = `
import os
from PIL import Image, ImageDraw, ImageFont

OUT = ${JSON.stringify(outDir)}
os.makedirs(OUT, exist_ok=True)

ACCENT = (255, 122, 69, 255)   # #ff7a45
WHITE  = (255, 255, 255, 255)
SIZES  = [16, 24, 32, 48, 64, 128, 256, 512]

def find_font(px):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            return ImageFont.truetype(c, px)
    return ImageFont.load_default()

def render(size):
    # Supersample for crisp anti-aliasing, then downscale.
    scale = 4 if size <= 64 else 2
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=ACCENT)

    # Draw a ">_" prompt glyph.
    fs = int(S * 0.42)
    font = find_font(fs)
    text = ">_"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (S - tw) / 2 - bbox[0]
    ty = (S - th) / 2 - bbox[1]
    d.text((tx, ty), text, font=font, fill=WHITE)

    return img.resize((size, size), Image.LANCZOS)

for s in SIZES:
    render(s).save(os.path.join(OUT, f"{s}x{s}.png"))

# electron-builder also accepts a top-level icon.png; keep the 512 as canonical.
render(512).save(os.path.join(${JSON.stringify(join(here, '..', 'build'))}, "icon.png"))
print("generated", len(SIZES), "sizes in", OUT)
`

const r = spawnSync('python3', ['-c', py], { stdio: 'inherit' })
if (r.status !== 0) {
  console.error('icon generation failed')
  process.exit(1)
}
