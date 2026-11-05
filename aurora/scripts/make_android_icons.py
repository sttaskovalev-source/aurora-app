"""Generate Aurora launcher icons for all Android densities and overwrite the Capacitor defaults."""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, "android", "app", "src", "main", "res")
STOPS = [(0.0, (124, 58, 237)), (0.5, (217, 70, 239)), (1.0, (251, 113, 133))]


def gradient(size):
    w = h = size
    yy, xx = np.mgrid[0:h, 0:w]
    t = (xx + yy) / (2.0 * (size - 1))
    img = np.zeros((h, w, 3), dtype=np.float64)
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        mask = (t >= t0) & (t <= t1)
        frac = (t - t0) / max(t1 - t0, 1e-6)
        for ch in range(3):
            img[..., ch] += mask * (c0[ch] + frac * (c1[ch] - c0[ch]))
    return img


def draw_note(d, s):
    w = (255, 255, 255)
    d.ellipse([120 * s, 300 * s, 216 * s, 396 * s], fill=w)
    d.rectangle([208 * s, 116 * s, 228 * s, 348 * s], fill=w)
    d.polygon([(228 * s, 116 * s), (304 * s, 180 * s), (250 * s, 228 * s), (228 * s, 168 * s)], fill=w)


def make(size, path, round_mask):
    im = Image.fromarray(gradient(size).astype(np.uint8), "RGB").convert("RGBA")
    if round_mask:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size, size], fill=255)
        im.putalpha(mask)
    draw_note(ImageDraw.Draw(im), size / 512.0)
    im.save(path)
    print("wrote", os.path.relpath(path, HERE), flush=True)


DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for d, sz in DENSITIES.items():
    dpath = os.path.join(RES, "mipmap-" + d)
    os.makedirs(dpath, exist_ok=True)
    make(sz, os.path.join(dpath, "ic_launcher.png"), round_mask=False)
    make(sz, os.path.join(dpath, "ic_launcher_round.png"), round_mask=True)
print("DONE", flush=True)
