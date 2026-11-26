"""Convert kit renders to WebP for the site and write the manifest the page reads."""
import json, os, shutil, sys
from PIL import Image
KIT = os.environ.get("KITOUT", "/home/claude/kit/out/kit2")
SKY = "/home/claude/kit/out/sky"
TEX = "/home/claude/kit/out/tex"
DEST = "/home/claude/all-timers/public/monument"
os.makedirs(DEST, exist_ok=True)
man = json.load(open(f"{KIT}/manifest.json"))
for f in os.listdir(DEST):
    if f.startswith(("slice-", "crown", "base", "ground")):
        os.remove(f"{DEST}/{f}")
for name in man:
    src = f"{KIT}/{name}.png"
    if os.path.exists(src):
        Image.open(src).save(f"{DEST}/{name}.webp", quality=84, method=6)
for d in (SKY, TEX):
    for f in os.listdir(d):
        if f.endswith(".webp"):
            shutil.copy(f"{d}/{f}", f"{DEST}/{f}")
json.dump(man, open("/home/claude/all-timers/src/lib/monument-manifest.json", "w"), indent=1)
print(sorted(man))
print({f: os.path.getsize(f"{DEST}/{f}") // 1024 for f in sorted(os.listdir(DEST))})
