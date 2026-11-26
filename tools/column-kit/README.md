# Column kit

The monument view's marble column is pre-rendered in Blender (run as a Python module, `pip install bpy`).
These scripts rebuild every piece in `public/monument/`.

- `common.py`: scene setup (orthographic front camera so pieces stack exactly, warm sun from the upper left,
  sky light from a Poly Haven HDRI), marble material (subsurface glow, veining that repeats every slice so
  slices tile, grime/chips by wear), gold material, fluted Ionic shaft.
- `parts.py`: Ionic scroll ledge, inscription tablet, gilded frame, Attic base, seamless ivy.
- `scripts/kit.py`: renders the crown (#1), the slices (one song each: tier x side x frame x ivy) and the
  base, plus `manifest.json` with each piece's pixel size, cover opening and tablet face.
- `scripts/sky.py` + `reproject.py`: sky, garden and cloud cut-out layers from two CC0 Poly Haven panoramas
  (`cloud_layers`, `borghese_gardens`), reprojected to normal camera views and graded warm.
- `scripts/export.py`: converts to WebP into `public/monument/` and writes `src/lib/monument-manifest.json`.

Paths assume the kit lives in `/home/claude/kit` with downloads in `dl/`; adjust `KIT` in `common.py`.
Render: `PXM=440 python3 scripts/kit.py crown slice:pristine:L:gold ... base base-tips` (about 1-2 min per piece on 2 CPUs).
