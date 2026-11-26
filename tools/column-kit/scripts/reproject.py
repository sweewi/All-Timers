"""Equirectangular panorama -> rectilinear (normal camera) view."""
import sys, math
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

def view(pano, yaw_deg, pitch_deg, hfov_deg, w, h):
    P = np.asarray(pano).astype(np.float32)
    H, W = P.shape[:2]
    f = (w / 2) / math.tan(math.radians(hfov_deg) / 2)
    xs, ys = np.meshgrid(np.arange(w) - w / 2 + 0.5, h / 2 - np.arange(h) - 0.5)
    d = np.stack([xs, ys, np.full_like(xs, f)], -1)
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    p, y = math.radians(pitch_deg), math.radians(yaw_deg)
    # pitch about X, then yaw about Y
    Rx = np.array([[1, 0, 0], [0, math.cos(p), math.sin(p)], [0, -math.sin(p), math.cos(p)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    d = d @ Rx.T @ Ry.T
    lon = np.arctan2(d[..., 0], d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    u = (lon / (2 * math.pi) + 0.5) * W
    v = (0.5 - lat / math.pi) * H
    # bilinear sample
    u0 = np.floor(u).astype(int); v0 = np.clip(np.floor(v).astype(int), 0, H - 2)
    du = (u - u0)[..., None]; dv = (v - v0)[..., None]
    u0 %= W; u1 = (u0 + 1) % W
    c = (P[v0, u0] * (1 - du) * (1 - dv) + P[v0, u1] * du * (1 - dv) + P[v0 + 1, u0] * (1 - du) * dv + P[v0 + 1, u1] * du * dv)
    return Image.fromarray(np.clip(c, 0, 255).astype(np.uint8))

if __name__ == "__main__":
    src, out, yaw, pitch, fov, w, h = sys.argv[1:8]
    pano = Image.open(src).convert("RGB")
    view(pano, float(yaw), float(pitch), float(fov), int(w), int(h)).save(out, quality=88)
