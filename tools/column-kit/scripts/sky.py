import sys; sys.path.insert(0, "/home/claude/kit/scripts")
import numpy as np
from PIL import Image, ImageFilter
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

save(grade(view(garden, -50, 6, 80, 1920, 1200)), "garden")
save(grade(view(clouds, -25, 34, 84, 1920, 1200), lift=1.08), "sky-mid")
save(grade(view(clouds, 40, 52, 92, 1920, 1200), lift=1.1, sat=0.8), "sky-high")

def cutout(yaw, pitch, fov, w, h, name):
    im = view(clouds, yaw, pitch, fov, w, h)
    a = np.asarray(im).astype(np.float32) / 255
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / (mx + 1e-4)
    bright = a.mean(-1)
    # clouds: bright and unsaturated; sky: saturated blue
    alpha = np.clip((0.42 - sat) / 0.22, 0, 1) * np.clip((bright - 0.55) / 0.25, 0, 1)
    alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    # fade the edges so a cutout never shows a hard border
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum.reduce([xx / (0.12 * w), (w - xx) / (0.12 * w), yy / (0.15 * h), (h - yy) / (0.15 * h), np.ones_like(xx, dtype=float)])
    alpha *= np.clip(edge, 0, 1)
    rgb = np.asarray(grade(im, lift=1.12, sat=0.6)).astype(np.float32)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    save(Image.fromarray(rgba, "RGBA"), name, q=72)

cutout(81, 30, 40, 1400, 700, "cloud-a")
cutout(-22, 22, 46, 1400, 700, "cloud-b")
cutout(-110, 16, 50, 1400, 700, "cloud-c")
