"""Replace Capacitor's default adaptive-icon foreground + splash with Aurora branding."""
import os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(HERE, "android", "app", "src", "main", "res")
STOPS = [(0.0, (124, 58, 237)), (0.5, (217, 70, 239)), (1.0, (251, 113, 133))]

# note geometry in a 512 reference frame
HEAD = (120, 300, 216, 396)
STEM = (208, 116, 228, 348)
FLAG = [(228, 116), (304, 180), (250, 228), (228, 168)]
NCX, NCY = 212, 256  # note center in the reference frame


def gradient(w, h):
    yy, xx = np.mgrid[0:h, 0:w]
    t = (xx / max(w - 1, 1) + yy / max(h - 1, 1)) / 2.0
    img = np.zeros((h, w, 3), dtype=np.float64)
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        mask = (t >= t0) & (t <= t1)
        frac = (t - t0) / max(t1 - t0, 1e-6)
        for ch in range(3):
            img[..., ch] += mask * (c0[ch] + frac * (c1[ch] - c0[ch]))
    return img.astype(np.uint8)


def draw_note(d, size, scale=1.0, cx0=None, cy0=None):
    s = size / 512.0 * scale
    cx0 = size / 2 if cx0 is None else cx0
    cy0 = size / 2 if cy0 is None else cy0
    def P(x, y):
        return (x - NCX) * s + cx0, (y - NCY) * s + cy0
    d.ellipse([P(HEAD[0], HEAD[1]), P(HEAD[2], HEAD[3])], fill=(255, 255, 255))
    d.rectangle([P(STEM[0], STEM[1]), P(STEM[2], STEM[3])], fill=(255, 255, 255))
    d.polygon([P(*p) for p in FLAG], fill=(255, 255, 255))


# 1) adaptive-icon foreground: transparent + centered white note
DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for d, sz in DENS.items():
    im = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
    draw_note(ImageDraw.Draw(im), sz, scale=0.85)
    p = os.path.join(RES, "mipmap-" + d, "ic_launcher_foreground.png")
    im.save(p)
    print("foreground", os.path.relpath(p, HERE), flush=True)

# 2) splash screens: gradient + centered note, keeping existing sizes
for sub in ["drawable", "drawable-land-mdpi", "drawable-land-hdpi", "drawable-land-xhdpi",
            "drawable-land-xxhdpi", "drawable-land-xxxhdpi", "drawable-port-mdpi",
            "drawable-port-hdpi", "drawable-port-xhdpi", "drawable-port-xxhdpi",
            "drawable-port-xxxhdpi"]:
    d = os.path.join(RES, sub)
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        if f == "splash.png":
            p = os.path.join(d, f)
            w, h = Image.open(p).size
            im = Image.fromarray(gradient(w, h), "RGB")
            draw_note(ImageDraw.Draw(im), min(w, h), scale=0.62, cx0=w / 2, cy0=h / 2)
            im.save(p)
            print("splash", os.path.relpath(p, HERE), (w, h), flush=True)

print("DONE", flush=True)
