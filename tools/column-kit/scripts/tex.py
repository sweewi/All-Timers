"""Flat marble textures for HTML plaques and site panels (same material as the column)."""
import sys, math
sys.path.insert(0, "/home/claude/kit")
import bpy
import common as C
for name, (w, h, seed, wear) in {"marble": (1400, 900, 9, 0.0), "marble-worn": (1000, 500, 5, 0.3)}.items():
    C.PX_PER_M = 700
    C.reset()
    for o in list(bpy.data.objects):
        if o.type == "LIGHT":
            bpy.data.objects.remove(o)
    bpy.context.scene.render.film_transparent = False
    bpy.context.scene.view_settings.look = "AgX - Base Contrast"
    bpy.context.scene.view_settings.exposure = 1.0
    m = C.marble(name, wear=wear, seed=seed)
    wm, hm = w / C.PX_PER_M, h / C.PX_PER_M
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    p = bpy.context.active_object; p.scale = (wm, 1, hm); p.data.materials.append(m)
    C.camera(0, 0, wm, hm)
    bpy.context.scene.cycles.samples = 24
    C.render(f"/home/claude/kit/out/tex/{name}.png")
