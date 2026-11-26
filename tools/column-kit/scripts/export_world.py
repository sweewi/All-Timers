"""World renders -> WebP in public/monument and src/lib/world-manifest.json."""
import json, os, sys
from PIL import Image
SRC = os.environ.get("WORLDOUT", "/home/claude/kit/out/world")
DEST = "/home/claude/all-timers/public/monument"
man = json.load(open(f"{SRC}/manifest.json"))
for name in man:
    p = f"{SRC}/{name}.png"
    if not os.path.exists(p):
        continue
    im = Image.open(p)
    out = name.replace(".", "_")
    if name == "plate":
        im.save(f"{DEST}/plate.webp", quality=80, method=6)
    else:
        im.save(f"{DEST}/{out}.webp", quality=84, method=6)
MP = "/home/claude/all-timers/src/lib/world-manifest.json"
merged = json.load(open(MP)) if os.path.exists(MP) else {}
merged.update({k.replace(".", "_"): v for k, v in man.items()})
json.dump(merged, open(MP, "w"), indent=1)
print({f: os.path.getsize(f"{DEST}/{f}") // 1024 for f in sorted(os.listdir(DEST)) if f.split(".")[0] in [k.replace(".", "_") for k in man]})
