"""The surreal world every page lives in: terracotta sand, a sea horizon, chrome
spheres, an arch that opens onto stars, giant marble heads. Same sun as the column.

Usage: python3 world.py plate | mini:<height> | arch | sphere | bust
Sky is transparent everywhere: the page paints it (it changes with altitude).
"""
import json, math, os, random, sys, time
sys.path.insert(0, "/home/claude/kit")
import bpy
from mathutils import Vector
import common as C, parts as P

OUT = os.environ.get("WORLDOUT", "/home/claude/kit/out/world")
os.makedirs(OUT, exist_ok=True)
DL = "/home/claude/kit/dl/world"
MAN = f"{OUT}/manifest.json"


def sky_world():
    """Gradient sky for reflections: warm haze at the horizon, cerulean, then ultramarine."""
    w = bpy.data.worlds.new("Sky"); bpy.context.scene.world = w
    w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    # Generated on the world = view direction; Z is up
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (0.62, 0.48, 0.36, 1)    # below horizon: sand bounce
    cr.elements[1].position = 1.0; cr.elements[1].color = (0.05, 0.13, 0.55, 1)    # zenith ultramarine
    for pos, col in ((0.5, (0.42, 0.56, 0.82, 1)), (0.52, (0.38, 0.55, 0.92, 1)), (0.7, (0.2, 0.38, 0.85, 1))):
        e = cr.elements.new(pos); e.color = col
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1; mr.inputs["From Max"].default_value = 1
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"]); nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    bg = nt.nodes.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value = 0.9
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"]); nt.links.new(bg.outputs[0], out.inputs[0])


def setup():
    C.reset()
    sky_world()
    sc = bpy.context.scene
    sc.view_settings.exposure = float(os.environ.get("EXPO", "0.25"))
    return sc


def pct():
    bpy.context.scene.render.resolution_percentage = int(os.environ.get("PCT", "100"))


def sand_material(scale=0.35, fade=None):
    m = bpy.data.materials.new("Sand"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    def tex(f, color=True):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(f"{DL}/red_sand/{f}")
        if not color: t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mp.outputs[0], t.inputs["Vector"]); return t
    d, r, n = tex("Diffuse.jpg"), tex("Rough.jpg", False), tex("nor_gl.jpg", False)
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0; tint.inputs["B"].default_value = (1.25, 0.86, 0.62, 1)
    nt.links.new(d.outputs["Color"], tint.inputs["A"])
    # large soft variation so the plain is not one flat colour
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 0.08
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    var = nt.nodes.new("ShaderNodeMix"); var.data_type = "RGBA"; var.blend_type = "MULTIPLY"
    nt.links.new(nz.outputs["Fac"], var.inputs["Factor"]); var.inputs["B"].default_value = (1.1, 1.0, 0.92, 1)
    nt.links.new(tint.outputs["Result"], var.inputs["A"])
    nt.links.new(var.outputs["Result"], b.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], b.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8
    nt.links.new(n.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    surf = b.outputs[0]
    if fade:
        # fade with distance from the origin (used under sprites so they melt into the plate)
        ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
        nt.links.new(tc.outputs["Object"], ln.inputs[0])
        fr = nt.nodes.new("ShaderNodeMapRange")
        fr.inputs["From Min"].default_value = fade[0]; fr.inputs["From Max"].default_value = fade[1]
        fr.inputs["To Min"].default_value = 1; fr.inputs["To Max"].default_value = 0
        nt.links.new(ln.outputs["Value"], fr.inputs["Value"])
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fr.outputs["Result"], mix.inputs["Fac"]); nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(b.outputs[0], mix.inputs[2]); surf = mix.outputs[0]
    nt.links.new(surf, out.inputs[0])
    return m


def water_material():
    m = bpy.data.materials.new("Sea"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.01, 0.12, 0.32, 1)
    b.inputs["Roughness"].default_value = 0.14
    b.inputs["Specular IOR Level"].default_value = 0.35
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.wave_type = "BANDS"; wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 0.6; wave.inputs["Distortion"].default_value = 6; wave.inputs["Detail"].default_value = 3
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.08
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def chrome():
    m = bpy.data.materials.new("Chrome"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.92, 0.92, 0.95, 1)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.06
    return m


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def group(objs, loc=(0, 0, 0), scale=1.0, rot_z=0.0):
    e = bpy.data.objects.new("grp", None); C.link(e)
    for o in objs:
        if o.parent is None:
            o.parent = e
    e.location = loc; e.scale = (scale, scale, scale); e.rotation_euler = (0, 0, math.radians(rot_z))
    return e


def dunes():
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -30, 0))
    g = bpy.context.active_object; g.scale = (900, 240, 1)
    bpy.ops.object.transform_apply(scale=True)
    m = g.modifiers.new("sub", "SUBSURF"); m.subdivision_type = "SIMPLE"; m.levels = 8; m.render_levels = 8
    tx = bpy.data.textures.new("dune", "CLOUDS"); tx.noise_scale = 18; tx.noise_depth = 1
    d = g.modifiers.new("disp", "DISPLACE"); d.texture = tx; d.strength = 1.6; d.mid_level = 0.55
    d.texture_coords = "GLOBAL"
    g.data.materials.append(sand_material())
    C.shade_smooth(g)
    return g


def arch_mesh(w=3.2, h=4.4, d=0.8, ow=1.8, oh=3.0, mat=None, name="arch"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, h / 2)); a = bpy.context.active_object
    a.scale = (w, d, h); bpy.ops.object.transform_apply(scale=True); a.name = name
    # opening: a box topped by a half cylinder
    rect_h = oh - ow / 2
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, rect_h / 2 - 0.05)); c1 = bpy.context.active_object
    c1.scale = (ow, d * 2, rect_h + 0.1); bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=ow / 2, depth=d * 2, location=(0, 0, rect_h),
                                        rotation=(math.radians(90), 0, 0)); c2 = bpy.context.active_object
    for c in (c1, c2):
        mod = a.modifiers.new("cut", "BOOLEAN"); mod.operation = "DIFFERENCE"; mod.object = c; mod.solver = "EXACT"
        c.hide_render = True; c.hide_viewport = True; c.parent = a
    bv = a.modifiers.new("bev", "BEVEL"); bv.width = 0.03; bv.segments = 3; bv.limit_method = "ANGLE"
    if mat: a.data.materials.append(mat)
    return a, rect_h


def plate():
    sc = setup()
    dunes()
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 1080, 0.15)); sea = bpy.context.active_object
    sea.scale = (6000, 2000, 1); sea.data.materials.append(water_material())
    marble = C.marble("m", wear=0.25, seed=9)
    # an arch on the right, a broken colonnade on the left, both standing in the sand
    a, _ = arch_mesh(mat=marble); a.location = (21, 62, 0.2); a.rotation_euler[2] = math.radians(-14); a.scale = (1.6, 1.6, 1.6)
    for (x, y, hgt) in ((-36, 70, 8.0), (-30.5, 71, 4.2), (-25, 72, 9.5), (-19.5, 73, 2.0)):
        s = C.loft(C.fluted_profile(), -1, hgt, rings=2); s.data.materials.append(marble)
        s.location = (x, y, 0); s.scale = (1.4, 1.4, 1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.7, depth=1.4, location=(-14, 55, 0.6), rotation=(math.radians(90), 0, math.radians(30)))
    drum = bpy.context.active_object; drum.data.materials.append(marble)
    # a giant marble head rising out of the sea
    bust = import_gltf(f"{DL}/marble_bust_01/marble_bust_01.gltf")
    group(bust, loc=(-46, 150, -12), scale=62, rot_z=150)
    # chrome spheres resting on the sand
    for (x, y, r) in ((7.5, 24, 0.8), (-9, 36, 0.5), (34, 58, 1.8)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r, location=(x, y, r + 0.15))
        sp = bpy.context.active_object; C.shade_smooth(sp); sp.data.materials.append(chrome())
    cam = bpy.data.cameras.new("Cam"); cam.lens = 30
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    co.location = (0, -12, 5.0); co.rotation_euler = (math.radians(87), 0, 0)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 2560, 1280
    pct(); C.render(f"{OUT}/plate.png")
    return "plate", {"w": 2560, "h": 1280}


def tilt_cam(top, bottom, width, tilt=6.0, px=None):
    """Orthographic camera looking a few degrees down, framing z from bottom to top."""
    t = math.radians(tilt)
    up = Vector((0, math.sin(t), math.cos(t))); fwd = Vector((0, math.cos(t), -math.sin(t)))
    h = (top - bottom) * math.cos(t)
    vc = (top + bottom) / 2 * math.cos(t)
    cam = bpy.data.cameras.new("Cam"); cam.type = "ORTHO"; cam.ortho_scale = max(width, h)
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    co.location = up * vc - fwd * 30; co.rotation_euler = (math.radians(90) - t, 0, 0)
    sc = bpy.context.scene; sc.camera = co
    sc.render.resolution_x = round(width * px); sc.render.resolution_y = round(h * px)
    v = lambda x, y, z: Vector((x, y, z)).dot(up)
    to_px = lambda x, y, z: (round((x + width / 2) * px), round((vc + h / 2 - v(x, y, z)) * px))
    return to_px


def sand_catcher(radius_fade=(2.0, 4.0)):
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, 0)); g = bpy.context.active_object
    g.data.materials.append(sand_material(fade=radius_fade))
    return g


def lawn_disc(r=1.35):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=r, depth=0.06, location=(0, 0, 0.03))
    d = bpy.context.active_object
    sys.path.insert(0, "/home/claude/kit/scripts")
    import kit as K
    d.data.materials.append(K.lawn_material())
    return d


def mini(height):
    """A friend's whole column for the Grounds: lawn disc, base, shaft, capital, gold frame."""
    setup()
    px = int(os.environ.get("PXM", "150"))
    stone = C.marble("m", wear=0.05, seed=5, period=2.0)
    gold = C.gold()
    sand_catcher((1.8, 3.2))
    lawn_disc(1.25)
    sys.path.insert(0, "/home/claude/kit/scripts")
    import kit as K
    K.grass_clumps(0.06, 260, seed=int(height * 10))
    # attic base: its plinth bottom is at -0.445 in parts; lift so it stands on the lawn
    lift = 0.445 + 0.06
    base = P.attic_base(0, stone)
    for o in base: o.location.z += lift
    sh = C.loft(C.fluted_profile(), lift, lift + height + 0.05, rings=2); sh.data.materials.append(stone)
    P.ivy(32, 5, lift - 0.45, tip_zone=(0.4, 1.2))
    cap_top = lift + height + 0.5
    objs, under = P.ionic(0, cap_top, 1.62, 1.12, 0.21, stone, eggs=9, abacus_h=0.1, collar=C.R)
    fs = 1.5
    sys.path.insert(0, "/home/claude/kit/scripts")
    inner = K.covered_frame(0, cap_top, fs, "gold", stone, gold)
    W = 4.2
    to_px = tilt_cam(cap_top + fs + 0.1, -1.4, W, px=px)
    name = f"mini-{height:g}"
    pct(); C.render(f"{OUT}/{name}.png")
    x0, y0 = to_px(-inner / 2, -0.004, cap_top + (fs + inner) / 2)
    x1, y1 = to_px(inner / 2, -0.004, cap_top + (fs - inner) / 2)
    gx, gy = to_px(0, -1.25, 0.06)
    cx, cy = to_px(0, 0, 0)
    return name, {"w": round(W * px), "h": bpy.context.scene.render.resolution_y, "cover": [x0, y0, x1 - x0, y1 - y0],
                  "ground": cy, "front": gy, "px": px}


def arch():
    setup()
    px = int(os.environ.get("PXM", "160"))
    stone = C.marble("m", wear=0.12, seed=7)
    sand_catcher((2.2, 3.6))
    w, h, ow, oh = 3.2, 4.4, 1.8, 3.0
    a, rect_h = arch_mesh(w, h, 0.8, ow, oh, mat=stone)
    # cornice and a step
    P.box("cornice", (0, 0, h + 0.09), (w + 0.25, 1.0, 0.18), stone, bevel=0.03)
    P.box("step", (0, -0.1, 0.06), (w + 0.5, 1.2, 0.12), stone, bevel=0.02)
    rocks = import_gltf(f"{DL}/boulder_01/boulder_01.gltf"); group(rocks, loc=(1.9, -0.6, 0), scale=0.35, rot_z=20)
    # holdout inside the opening: the page shows another world through it
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, oh / 2), rotation=(math.radians(90), 0, 0))
    hp = bpy.context.active_object; hp.scale = (ow + 0.02, oh + 0.02, 1)
    sys.path.insert(0, "/home/claude/kit/scripts")
    import kit as K
    hm = K.holdout_plane(0, 0, 0.01, 0).data.materials[0]; hp.data.materials.append(hm)
    W = 5.2
    to_px = tilt_cam(h + 0.35, -0.9, W, px=px)
    pct(); C.render(f"{OUT}/arch.png")
    x0, y0 = to_px(-ow / 2, -0.4, oh); x1, y1 = to_px(ow / 2, -0.4, 0.12)
    return "arch", {"w": round(W * px), "h": bpy.context.scene.render.resolution_y, "opening": [x0, y0, x1 - x0, y1 - y0], "px": px}


def sphere():
    setup()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1, location=(0, 0, 0))
    s = bpy.context.active_object; C.shade_smooth(s); s.data.materials.append(chrome())
    # sand far below and a horizon to reflect, but invisible to the camera
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -3)); g = bpy.context.active_object
    g.data.materials.append(sand_material()); g.visible_camera = False
    cam = bpy.data.cameras.new("Cam"); cam.type = "ORTHO"; cam.ortho_scale = 2.08
    co = bpy.data.objects.new("Cam", cam); C.link(co); co.location = (0, -10, 0); co.rotation_euler = (math.radians(90), 0, 0)
    sc = bpy.context.scene; sc.camera = co; sc.render.resolution_x = sc.render.resolution_y = 700
    pct(); C.render(f"{OUT}/sphere.png")
    return "sphere", {"w": 700, "h": 700}


def bust():
    setup()
    objs = import_gltf(f"{DL}/marble_bust_01/marble_bust_01.gltf")
    meshes = [o for o in objs if o.type == "MESH"]
    g = group(objs, rot_z=-28)
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            wv = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, wv)); hi = Vector(map(max, hi, wv))
    size = max(hi - lo); ctr = (lo + hi) / 2
    g.location = -ctr
    cam = bpy.data.cameras.new("Cam"); cam.type = "ORTHO"; cam.ortho_scale = size * 1.08
    co = bpy.data.objects.new("Cam", cam); C.link(co); co.location = (0, -10, 0); co.rotation_euler = (math.radians(90), 0, 0)
    sc = bpy.context.scene; sc.camera = co; sc.render.resolution_x = sc.render.resolution_y = 1100
    pct(); C.render(f"{OUT}/bust.png")
    return "bust", {"w": 1100, "h": 1100}


def head():
    """The same marble head seen from far below, huge, the way a god would hang in the sky."""
    setup()
    objs = import_gltf(f"{DL}/marble_bust_01/marble_bust_01.gltf")
    meshes = [o for o in objs if o.type == "MESH"]
    g = group(objs, rot_z=38)
    bpy.context.view_layer.update()
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            wv = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, wv)); hi = Vector(map(max, hi, wv))
    size = max(hi - lo); ctr = (lo + hi) / 2
    g.location = -ctr
    # aim at the face, from below: chin and jaw lead, the bust's base falls out of frame
    target = Vector((0, 0, size * 0.27))
    cam = bpy.data.cameras.new("Cam"); cam.lens = 60
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    co.location = target + Vector((0, -size * 1.25, -size * 0.55))
    co.rotation_euler = (target - co.location).to_track_quat("-Z", "Y").to_euler()
    sc = bpy.context.scene; sc.camera = co; sc.render.resolution_x = 1200; sc.render.resolution_y = 1300
    pct(); C.render(f"{OUT}/head.png")
    return "head", {"w": 1200, "h": 1300}


if __name__ == "__main__":
    man = json.load(open(MAN)) if os.path.exists(MAN) else {}
    for arg in sys.argv[1:]:
        t = time.time()
        if arg == "plate": k, v = plate()
        elif arg.startswith("mini:"): k, v = mini(float(arg.split(":")[1]))
        elif arg == "arch": k, v = arch()
        elif arg == "sphere": k, v = sphere()
        elif arg == "head": k, v = head()
        elif arg == "bust": k, v = bust()
        else: continue
        man[k] = v
        json.dump(man, open(MAN, "w"), indent=1)
        print("done", k, round(time.time() - t, 1), "s", flush=True)
