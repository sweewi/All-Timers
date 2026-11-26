"""Convert kit renders to WebP for the site and add the carved-face rects to the manifest."""
import json, os, shutil
from PIL import Image
KIT = "/home/claude/kit/out/kit"
SKY = "/home/claude/kit/out/sky"
DEST = "/home/claude/all-timers/public/monument"
os.makedirs(DEST, exist_ok=True)
man = json.load(open(f"{KIT}/manifest.json"))
PX = man["crown"]["w"] / 3.9
W = 3.9

def rect(x0, z0, x1, z1, cz, h):
    return [round((x0 + W / 2) * PX), round(((cz + h / 2) - z1) * PX), round((x1 - x0) * PX), round((z1 - z0) * PX)]

# crown: camera center z = 1.55, height 3.1 (see kit.py). Abacus front face and the band between the volutes.
man["crown"]["abacus"] = rect(-0.78, 1.158, 0.78, 1.242, 1.55, 3.1)
man["crown"]["band"] = rect(-0.37, 0.955, 0.37, 1.135, 1.55, 3.1)
for k in ("base", "base-tips"):
    if k in man:
        man[k]["plinth"] = rect(-0.64, -0.43, 0.64, -0.22, 0.4, 2.4)
for name in man:
    src = f"{KIT}/{name}.png"
    if os.path.exists(src):
        im = Image.open(src)
        if name.startswith("base"):
            # cut the render at the bottom of the plinth: the page sets it into the grass
            cut = round(((0.4 + 1.2) - (-0.445)) * PX) + 4
            im = im.crop((0, 0, im.width, cut))
            man[name]["h"] = cut
        im.save(f"{DEST}/{name}.webp", quality=82, method=6)
# a strip of foreground grass from the garden photo, fading in at the top
g = Image.open(f"{SKY}/garden.webp").convert("RGB")
gw, gh = g.size
strip = g.crop((0, int(gh * 0.72), gw, gh)).convert("RGBA")
import numpy as np
a = np.asarray(strip).copy()
h = a.shape[0]
fade = np.clip(np.linspace(0, 1.6, h), 0, 1)[:, None]
a[..., 3] = (fade * 255).astype(np.uint8)
Image.fromarray(a, "RGBA").save(f"{DEST}/ground.webp", quality=78, method=6)
for f in os.listdir(SKY):
    if f.endswith(".webp"):
        shutil.copy(f"{SKY}/{f}", f"{DEST}/{f}")
json.dump(man, open("/home/claude/all-timers/src/lib/monument-manifest.json", "w"), indent=1)
print(sorted(man), {f: os.path.getsize(f"{DEST}/{f}") // 1024 for f in sorted(os.listdir(DEST))})
