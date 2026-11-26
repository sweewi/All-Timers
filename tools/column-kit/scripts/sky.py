import sys; sys.path.insert(0, "/home/claude/kit/scripts")
import numpy as np
from PIL import Image, ImageFilter, ImageOps
from reproject import view
Image.MAX_IMAGE_PIXELS = None
OUT = "/home/claude/kit/out/sky"
clouds = Image.open("/home/claude/kit/dl/cloud_layers.jpg").convert("RGB")
garden = Image.open("/home/claude/kit/dl/borghese_gardens.jpg").convert("RGB")

def grade(im, warm=(1.07, 1.0, 0.88), lift=1.06, sat=0.85):
    a = np.asarray(im).astype(np.float32) / 255
    g = a.mean(-1, keepdims=True)
    a = g + (a - g) * sat
    a = a * np.array(warm) * lift
    a = 1 - (1 - np.clip(a, 0, 1)) ** 1.08   # gentle highlight roll
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))

def save(im, name, q=78):
    im.save(f"{OUT}/{name}.webp", quality=q, method=6)
    print(name, im.size)

# mirrored so the sun sits back-left, matching the light on the column
save(ImageOps.mirror(grade(view(garden, -50, 6, 80, 1920, 1200))), "garden")
save(grade(view(clouds, -25, 44, 84, 1920, 1200), lift=1.08), "sky-mid")
save(grade(view(clouds, 40, 52, 92, 1920, 1200), lift=1.1, sat=0.8), "sky-high")

def cutout(yaw, pitch, fov, w, h, name):
    im = view(clouds, yaw, pitch, fov, w, h)
    a = np.asarray(im).astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / (mx + 1e-4)
    bright = a.mean(-1)
    # clouds: bright and unsaturated; sky: saturated blue
    alpha = np.clip((0.38 - sat) / 0.22, 0, 1) * np.clip((bright - 0.6) / 0.25, 0, 1)
    alpha = alpha ** 1.15
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
    # an elliptical feather: the cloud thins out toward every edge, so no edge is ever a line
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    feather = np.clip((1 - r) / 0.6, 0, 1)
    alpha *= feather * feather * (3 - 2 * feather)
    rgb = np.asarray(grade(im, lift=1.12, sat=0.6)).astype(np.float32)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    save(Image.fromarray(rgba, "RGBA"), name, q=72)

cutout(81, 30, 40, 1400, 700, "cloud-a")
cutout(-22, 22, 46, 1400, 700, "cloud-b")
cutout(-110, 16, 50, 1400, 700, "cloud-c")


def rays(w=1600, h=1000, sun=(-0.06, -0.22), seed=3):
    """Crepuscular rays fanning from a sun just off the top-left: white, carried in alpha."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    sx, sy = sun[0] * w, sun[1] * h
    ang = np.arctan2(yy - sy, xx - sx)          # 0 .. ~pi/2 across the frame
    dist = np.hypot(xx - sx, yy - sy) / np.hypot(w, h)
    # an irregular angular signal: shafts of different widths and strengths
    n = 4096
    sig = np.zeros(n)
    for width, amp in ((3, 0.5), (9, 0.8), (24, 0.9), (70, 0.6)):
        raw = rng.random(n // width + 2)
        sig += amp * np.interp(np.arange(n) / width, np.arange(len(raw)), raw)
    sig = (sig - sig.min()) / (sig.max() - sig.min())
    sig = np.clip((sig - 0.45) / 0.55, 0, 1) ** 1.6
    a0, a1 = -0.15, 1.75
    idx = np.clip((ang - a0) / (a1 - a0) * (n - 1), 0, n - 1).astype(int)
    shafts = sig[idx]
    fall = np.exp(-dist * 2.2) * np.clip(dist / 0.08, 0, 1)
    alpha = 2.4 * shafts * fall
    alpha += 0.4 * np.exp(-dist * 3.5)          # the glow around the sun itself
    im = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))
    rgb = np.zeros((h, w, 3), np.uint8); rgb[...] = (255, 236, 196)
    out = Image.fromarray(np.dstack([rgb, np.asarray(im)]), "RGBA")
    out.save(f"{OUT}/rays.webp", quality=80, method=6)
    print("rays", out.size)


rays()
