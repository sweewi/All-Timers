# Column kit

The monument view's marble column is pre-rendered in Blender (run as a Python module, `pip install bpy`).
These scripts rebuild every piece in `public/monument/`.

- `common.py`: scene setup (orthographic front camera so pieces stack exactly; one golden sun from the left
  and a little in front with soft 2.6° shadows; slightly cool sky fill from a Poly Haven HDRI), marble
  material (subsurface glow, veining that repeats every slice so slices tile, grime/chips by wear), gold,
  fluted Ionic shaft.
- `parts.py`: Ionic scroll ledge with a solid bolster (no sky shows through), egg-and-dart, the crown's
  round echinus and astragal that seat it on the shaft, gilded frame, Attic base, seamless ivy.
- `scripts/kit.py`: renders the crown (#1), the slices (one song each: tier x side x frame x ivy) and the
  base set in grass (camera tilted 7°, Poly Haven `leafy_grass` lawn fading out with distance, scattered
  `grass_medium_01/02` clumps). Each slice also renders an `ov` strip above itself that the page fades over
  the piece above, so tiers blend. Writes `manifest.json`: sizes, cover opening, `plaque` = [x, y, width]
  of the capital's underside where the HTML nameplate hangs, base `ground` line.
- `scripts/sky.py` + `reproject.py`: sky, garden (mirrored so its sun matches the column's) and feathered
  cloud cut-outs from two CC0 Poly Haven panoramas (`cloud_layers`, `borghese_gardens`), plus `rays.webp`,
  sun shafts from just off the top left.
- `scripts/tex.py`: flat renders of the same marble, used for nameplates and the site's panels.
- `scripts/export.py`: converts to WebP into `public/monument/` and writes `src/lib/monument-manifest.json`.

Tiers wear gently (0 / 0.14 / 0.32 / 0.55) so the column ages without visible jumps.
Paths assume the kit lives in `/home/claude/kit` with downloads in `dl/`; adjust `KIT` in `common.py`.
Render: `KITOUT=out/kit2 PXM=440 SAMPLES=32 python3 scripts/kit.py crown slice:pristine:L:gold ... base base-tips`
(about 2.5 min per slice, 4 min per base on 2 CPUs).
