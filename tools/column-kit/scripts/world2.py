"""Second pass on the world: a real shoreline and sea, haze, rocks and dry grass on the dunes,
and doors (arches) standing on floating islands, rendered at three angles so a row of them
reads as a curve in space.

Usage: python3 world2.py plate2 | door:<angle>
"""
import json, math, os, random, sys, time
sys.path.insert(0, "/home/claude/kit")
sys.path.insert(0, "/home/claude/kit/scripts")
import bpy, bmesh
from mathutils import Vector, noise
import common as C, parts as P
import world as Wd

OUT = Wd.OUT
DL = Wd.DL
MAN = Wd.MAN
HAZE = (0.86, 0.84, 0.86)


def haze(nt, surf, start=30.0, half=260.0, color=HAZE):
    """Aerial perspective: blend a surface toward the horizon haze with distance from the camera."""
    cam = nt.nodes.new("ShaderNodeCameraData")
    f = nt.nodes.new("ShaderNodeMath"); f.operation = "SUBTRACT"; f.inputs[1].default_value = start
    nt.links.new(cam.outputs["View Distance"], f.inputs[0])
    g = nt.nodes.new("ShaderNodeMath"); g.operation = "DIVIDE"; g.inputs[1].default_value = -half / 0.693
    nt.links.new(f.outputs[0], g.inputs[0])
    e = nt.nodes.new("ShaderNodeMath"); e.operation = "EXPONENT"; nt.links.new(g.outputs[0], e.inputs[0])
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    nt.links.new(e.outputs[0], inv.inputs[1])
    cl = nt.nodes.new("ShaderNodeClamp"); nt.links.new(inv.outputs[0], cl.inputs["Value"])
    em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (*color, 1); em.inputs["Strength"].default_value = 1.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(cl.outputs[0], mix.inputs["Fac"]); nt.links.new(surf, mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
    return mix.outputs[0]


def with_haze(m, **kw):
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    src = out.inputs["Surface"].links[0].from_socket
    nt.links.new(haze(nt, src, **kw), out.inputs["Surface"])
    return m


def shore_y(x):
    return 72 + 10 * math.sin(x / 41 + 0.7) + 4 * math.sin(x / 13 + 2.0) + 0.012 * x


def terrain():
    """Dunes that run down a beach into the water. Heights from layered noise; the beach is a
    gentle slope so the waterline wanders the way a real one does."""
    bm = bmesh.new()
    xs = [x for x in [i * 2.0 - 520 for i in range(521)]]
    ys = [-20 + (j / 200) ** 1.6 * 150 for j in range(201)]
    rows = []
    for y in ys:
        row = []
        for x in xs:
            sy = shore_y(x)
            d = sy - y                                    # >0 inland
            dune = 1.4 * (noise.noise(Vector((x / 26, y / 18, 0.3))) * 0.5 + 0.5) ** 1.5
            dune += 0.5 * noise.noise(Vector((x / 7, y / 6, 2.1)))
            ripple = 0.05 * math.sin(x * 1.3 + y * 0.4 + 2 * noise.noise(Vector((x / 9, y / 9, 5))))
            inland = max(0.0, min(1.0, (d - 6) / 14))
            beach = 0.12 + d * 0.045
            z = beach * (1 - inland) + (0.75 + dune) * inland + ripple
            if d < 0:
                z = min(z, 0.12 + d * 0.06)
            row.append(bm.verts.new((x, y, z)))
        rows.append(row)
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    me = bpy.data.meshes.new("terrain"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("terrain", me); C.link(o); C.shade_smooth(o)
    m = Wd.sand_material(scale=0.35)
    # wet sand near the water: darker and glossier
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    wet = nt.nodes.new("ShaderNodeMapRange"); wet.inputs["From Min"].default_value = 0.42; wet.inputs["From Max"].default_value = 0.08
    nt.links.new(sep.outputs["Z"], wet.inputs["Value"])
    src = b.inputs["Base Color"].links[0].from_socket
    dark = nt.nodes.new("ShaderNodeMix"); dark.data_type = "RGBA"; dark.blend_type = "MULTIPLY"
    dark.inputs["B"].default_value = (0.55, 0.5, 0.48, 1)
    nt.links.new(wet.outputs["Result"], dark.inputs["Factor"]); nt.links.new(src, dark.inputs["A"])
    nt.links.new(dark.outputs["Result"], b.inputs["Base Color"])
    rsrc = b.inputs["Roughness"].links[0].from_socket
    rmix = nt.nodes.new("ShaderNodeMix"); rmix.data_type = "FLOAT"
    nt.links.new(wet.outputs["Result"], rmix.inputs["Factor"]); nt.links.new(rsrc, rmix.inputs["A"])
    rmix.inputs["B"].default_value = 0.18
    nt.links.new(rmix.outputs["Result"], b.inputs["Roughness"])
    o.data.materials.append(with_haze(m))
    return o


def sea_material():
    m = bpy.data.materials.new("Sea"); m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.004, 0.045, 0.13, 1)
    b.inputs["Roughness"].default_value = 0.025
    b.inputs["IOR"].default_value = 1.33
    b.inputs["Specular IOR Level"].default_value = 0.5
    # shallow water near the beach goes turquoise
    geo = nt.nodes.new("ShaderNodeNewGeometry"); sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    sh = nt.nodes.new("ShaderNodeMapRange"); sh.inputs["From Min"].default_value = 105; sh.inputs["From Max"].default_value = 70
    nt.links.new(sep.outputs["Y"], sh.inputs["Value"])
    col = nt.nodes.new("ShaderNodeMix"); col.data_type = "RGBA"
    col.inputs["A"].default_value = (0.004, 0.045, 0.13, 1); col.inputs["B"].default_value = (0.02, 0.26, 0.3, 1)
    nt.links.new(sh.outputs["Result"], col.inputs["Factor"])
    # foam from the ocean simulation on crests
    at = nt.nodes.new("ShaderNodeAttribute"); at.attribute_name = "foam"
    fr = nt.nodes.new("ShaderNodeMapRange"); fr.inputs["From Min"].default_value = 0.35; fr.inputs["From Max"].default_value = 0.9
    nt.links.new(at.outputs["Fac"], fr.inputs["Value"])
    foam = nt.nodes.new("ShaderNodeMix"); foam.data_type = "RGBA"
    nt.links.new(fr.outputs["Result"], foam.inputs["Factor"]); nt.links.new(col.outputs["Result"], foam.inputs["A"])
    foam.inputs["B"].default_value = (0.9, 0.92, 0.92, 1)
    nt.links.new(foam.outputs["Result"], b.inputs["Base Color"])
    rough = nt.nodes.new("ShaderNodeMix"); rough.data_type = "FLOAT"; rough.inputs["A"].default_value = 0.04; rough.inputs["B"].default_value = 0.7
    nt.links.new(fr.outputs["Result"], rough.inputs["Factor"]); nt.links.new(rough.outputs["Result"], b.inputs["Roughness"])
    m = with_haze(m, start=120, half=900, color=(0.62, 0.72, 0.88))
    # far out, the sea dissolves into the sky instead of ending in a line
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    src = out.inputs["Surface"].links[0].from_socket
    cam = nt.nodes.new("ShaderNodeCameraData")
    fd = nt.nodes.new("ShaderNodeMapRange"); fd.inputs["From Min"].default_value = 1400; fd.inputs["From Max"].default_value = 3800
    nt.links.new(cam.outputs["View Distance"], fd.inputs["Value"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fd.outputs["Result"], mx.inputs["Fac"]); nt.links.new(src, mx.inputs[1]); nt.links.new(tr.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def sea():
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0)); o = bpy.context.active_object
    oc = o.modifiers.new("ocean", "OCEAN")
    oc.geometry_mode = "GENERATE"; oc.size = 1.0; oc.spatial_size = 60; oc.resolution = 8
    oc.repeat_x = 12; oc.repeat_y = 5; oc.wave_scale = 0.55; oc.choppiness = 1.1; oc.wind_velocity = 9
    oc.wave_alignment = 0.35; oc.wave_direction = math.radians(80); oc.time = 7.0
    oc.use_foam = True; oc.foam_layer_name = "foam"; oc.foam_coverage = 0.15
    o.location = (-360, 20, 0.0)
    o.data.materials.append(sea_material())
    # beyond the simulated patch: a flat sea to the horizon (haze hides the change)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 2050, -0.02)); far = bpy.context.active_object
    far.scale = (9000, 3700, 1); far.data.materials.append(sea_material())
    return o


def shore_foam():
    """A ribbon of lacy foam where the swash runs up the beach."""
    bm = bmesh.new()
    xs = [i * 1.0 - 520 for i in range(1041)]
    prev = None
    for x in xs:
        y = shore_y(x) + 1.2
        a = bm.verts.new((x, y - 2.6, 0.2)); b = bm.verts.new((x, y + 3.2, 0.09))
        if prev:
            bm.faces.new((prev[0], a, b, prev[1]))
        prev = (a, b)
    me = bpy.data.meshes.new("foam"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("foam", me); C.link(o)
    m = bpy.data.materials.new("Foam"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.92, 0.93, 0.92, 1); b.inputs["Roughness"].default_value = 0.6
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.9, 2.4, 1)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    v = nt.nodes.new("ShaderNodeTexVoronoi"); v.feature = "DISTANCE_TO_EDGE"; v.inputs["Scale"].default_value = 1.6
    nt.links.new(mp.outputs[0], v.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 0.35; nz.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    lace = nt.nodes.new("ShaderNodeMapRange"); lace.inputs["From Min"].default_value = 0.08; lace.inputs["From Max"].default_value = 0.0
    nt.links.new(v.outputs["Distance"], lace.inputs["Value"])
    band = nt.nodes.new("ShaderNodeMapRange"); band.inputs["From Min"].default_value = 0.4; band.inputs["From Max"].default_value = 0.62
    nt.links.new(nz.outputs["Fac"], band.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    nt.links.new(lace.outputs["Result"], mul.inputs[0]); nt.links.new(band.outputs["Result"], mul.inputs[1])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mul.outputs[0], mix.inputs["Fac"]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(b.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    o.data.materials.append(with_haze(m))
    return o


def rock_material(tint=(0.8, 0.72, 0.62), scale=0.6, strata=False):
    m = bpy.data.materials.new("Rock"); m.use_nodes = True; nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = scale; nz.inputs["Detail"].default_value = 12
    nz.inputs["Roughness"].default_value = 0.62
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (tint[0] * 0.45, tint[1] * 0.42, tint[2] * 0.4, 1)
    ramp.color_ramp.elements[1].color = (*tint, 1)
    fac = nz.outputs["Fac"]
    if strata:
        # sedimentary bands, wobbling, multiplied into the noise
        wv = nt.nodes.new("ShaderNodeTexWave"); wv.bands_direction = "Z"; wv.inputs["Scale"].default_value = 1.6
        wv.inputs["Distortion"].default_value = 4; wv.inputs["Detail"].default_value = 4
        nt.links.new(tc.outputs["Object"], wv.inputs["Vector"])
        mm = nt.nodes.new("ShaderNodeMix"); mm.data_type = "FLOAT"; mm.inputs["Factor"].default_value = 0.45
        nt.links.new(nz.outputs["Fac"], mm.inputs["A"]); nt.links.new(wv.outputs["Fac"], mm.inputs["B"])
        fac = mm.outputs["Result"]
    nt.links.new(fac, ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    bm = nt.nodes.new("ShaderNodeBump"); bm.inputs["Strength"].default_value = 0.9; bm.inputs["Distance"].default_value = 0.15
    nt.links.new(fac, bm.inputs["Height"]); nt.links.new(bm.outputs["Normal"], b.inputs["Normal"])
    return m


def headland():
    """A hazy limestone headland on the left horizon and a low island on the right."""
    for (cx, cy, sx, sy, hz, seed) in ((-420, 760, 260, 120, 70, 3), (430, 1100, 160, 60, 16, 8)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1, location=(cx, cy, -hz * 0.25))
        o = bpy.context.active_object; o.scale = (sx, sy, hz)
        bpy.ops.object.transform_apply(scale=True)
        tx = bpy.data.textures.new(f"cliff{seed}", "CLOUDS"); tx.noise_scale = 0.35; tx.noise_depth = 4
        d = o.modifiers.new("disp", "DISPLACE"); d.texture = tx; d.strength = hz * 0.35; d.texture_coords = "LOCAL"
        o.modifiers.new("sub", "SUBSURF").levels = 2
        tx2 = bpy.data.textures.new(f"crag{seed}", "CLOUDS"); tx2.noise_scale = 0.04; tx2.noise_depth = 2
        d2 = o.modifiers.new("crag", "DISPLACE"); d2.texture = tx2; d2.strength = hz * 0.12; d2.texture_coords = "LOCAL"
        C.shade_smooth(o)
        o.data.materials.append(with_haze(rock_material((0.42, 0.4, 0.3), scale=0.02, strata=True), start=150, half=1100, color=(0.66, 0.74, 0.88)))


def scatter_rocks(seed=2):
    rnd = random.Random(seed)
    src = Wd.import_gltf(f"{DL}/boulder_01/boulder_01.gltf")
    meshes = [o for o in src if o.type == "MESH"]
    for o in src:
        o.hide_render = True
    spots = [(-24, 40), (-13, 58), (19, 52), (27, 66), (-38, 64), (44, 74), (8, 70), (-52, 60), (-6, 34), (14, 30)]
    for (x, y) in spots:
        for me in meshes:
            r = bpy.data.objects.new("rock", me.data); C.link(r)
            s = rnd.uniform(1.6, 3.6)
            r.scale = (s, s, s * rnd.uniform(0.6, 1.0))
            r.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
            sy = shore_y(x)
            r.location = (x, y, 0.1 if y > sy - 3 else 0.4)


def dry_grass(count=420, seed=6):
    """Tufts of sun-bleached grass on the dunes, thicker toward the edges of the frame."""
    K = __import__("kit")
    protos = []
    for k in ("grass_medium_01", "grass_medium_02"):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"/home/claude/kit/dl/grass/{k}/{k}.gltf")
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        for o in new:
            o.hide_render = True
            for slot in o.material_slots:
                m = slot.material
                b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m else None
                if b and b.inputs["Base Color"].links and not m.get("dry"):
                    m["dry"] = 1
                    src = b.inputs["Base Color"].links[0].from_socket
                    hsv = m.node_tree.nodes.new("ShaderNodeHueSaturation")
                    hsv.inputs["Hue"].default_value = 0.44; hsv.inputs["Saturation"].default_value = 0.6; hsv.inputs["Value"].default_value = 1.7
                    m.node_tree.links.new(src, hsv.inputs["Color"]); m.node_tree.links.new(hsv.outputs["Color"], b.inputs["Base Color"])
        protos += new
    rnd = random.Random(seed)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    terr = bpy.data.objects["terrain"]
    n = 0
    while n < count:
        y = rnd.uniform(-4, 48)
        half = (y + 14) * 0.85
        x = rnd.uniform(-half, half)
        if abs(x) < half * 0.35 and rnd.random() < 0.8:
            continue
        if y > shore_y(x) - 10:
            continue
        hit, loc, *_ = terr.ray_cast(Vector((x, y, 20)), Vector((0, 0, -1)))
        if not hit:
            continue
        p = rnd.choice(protos)
        o = bpy.data.objects.new("tuft", p.data); C.link(o)
        s = rnd.uniform(2.4, 5.0)
        o.scale = (s, s, s); o.rotation_euler = (0, 0, rnd.uniform(0, 6.28)); o.location = loc
        n += 1


def plate2():
    sc = Wd.setup()
    terrain()
    sea()
    shore_foam()
    headland()
    scatter_rocks()
    dry_grass(int(os.environ.get("TUFTS", "420")))
    marble = C.marble("m", wear=0.25, seed=9)
    a, _ = Wd.arch_mesh(mat=marble); a.location = (26, 30, 0.6); a.rotation_euler[2] = math.radians(-18); a.scale = (1.6, 1.6, 1.6)
    for (x, y, hgt) in ((-40, 36, 8.0), (-34.5, 37, 4.2), (-29, 38, 9.5), (-23.5, 39, 2.0)):
        s = C.loft(C.fluted_profile(), -1, hgt, rings=2); s.data.materials.append(marble)
        s.location = (x, y, 0.4); s.scale = (1.4, 1.4, 1)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.7, depth=1.4, location=(-14, 26, 0.95), rotation=(math.radians(90), 0, math.radians(30)))
    bpy.context.active_object.data.materials.append(marble)
    # the giant head, half sunk in the sea far out
    bust = Wd.import_gltf(f"{DL}/marble_bust_01/marble_bust_01.gltf")
    Wd.group(bust, loc=(-90, 300, -18), scale=80, rot_z=150)
    terr = bpy.data.objects["terrain"]
    for (x, y, r) in ((7.5, 14, 0.8), (-9, 22, 0.5), (36, 40, 1.8)):
        _, loc, *_ = terr.ray_cast(Vector((x, y, 30)), Vector((0, 0, -1)))
        bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r, location=(x, y, loc.z + r * 0.92))
        sp = bpy.context.active_object; C.shade_smooth(sp); sp.data.materials.append(Wd.chrome())
    cam = bpy.data.cameras.new("Cam"); cam.lens = 22
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    co.location = (0, -14, 6.2); co.rotation_euler = (math.radians(87.5), 0, 0)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 3840, 1280
    Wd.pct(); C.render(f"{OUT}/plate2.png")
    return "plate2", {"w": 3840, "h": 1280}


def island(mat_rock, r=2.4, depth=3.2, seed=4):
    """A floating island: a sand top and a jagged rock underside tapering to a point."""
    bm = bmesh.new()
    rnd = random.Random(seed)
    rings = 14; segs = 64
    verts = []
    for i in range(rings + 1):
        t = i / rings
        rad = r * (1 - t ** 1.35) + 0.05
        z = -depth * t ** 0.9
        ring = []
        for j in range(segs):
            a = j / segs * 2 * math.pi
            jag = 1 + 0.16 * noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, t * 3 + seed))) + 0.06 * rnd.random()
            ring.append(bm.verts.new((math.cos(a) * rad * jag, math.sin(a) * rad * jag, z)))
        verts.append(ring)
    for i in range(rings):
        for j in range(segs):
            bm.faces.new((verts[i][j], verts[i][(j + 1) % segs], verts[i + 1][(j + 1) % segs], verts[i + 1][j]))
    tip = bm.verts.new((0, 0, -depth - 0.3))
    for j in range(segs):
        bm.faces.new((verts[rings][j], verts[rings][(j + 1) % segs], tip))
    top = bm.faces.new(list(reversed(verts[0])))
    me = bpy.data.meshes.new("island"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("island", me); C.link(o)
    o.data.materials.append(mat_rock)
    o.data.materials.append(Wd.sand_material(scale=0.6))
    for p in o.data.polygons:
        p.material_index = 1 if p.normal.z > 0.9 else 0
    tx = bpy.data.textures.new("isl", "CLOUDS"); tx.noise_scale = 0.4
    d = o.modifiers.new("d", "DISPLACE"); d.texture = tx; d.strength = 0.25
    C.shade_smooth(o)
    return o


def door(angle):
    """An arch on its own floating island, turned `angle` degrees. Writes the sprite and a
    mask of the opening (white where the page should show another world through it)."""
    sc = Wd.setup()
    stone = C.marble("m", wear=0.1, seed=7)
    w, h, ow, oh = 3.2, 4.4, 1.8, 3.0
    a, rect_h = Wd.arch_mesh(w, h, 0.8, ow, oh, mat=stone)
    corn = P.box("cornice", (0, 0, h + 0.09), (w + 0.25, 1.0, 0.18), stone, bevel=0.03)
    step = P.box("step", (0, -0.1, 0.06), (w + 0.5, 1.2, 0.12), stone, bevel=0.02)
    isl = island(rock_material((0.66, 0.34, 0.2), scale=2.2, strata=True))
    rocks = Wd.import_gltf(f"{DL}/boulder_01/boulder_01.gltf"); Wd.group(rocks, loc=(1.9, -0.7, 0), scale=0.35, rot_z=20)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, oh / 2), rotation=(math.radians(90), 0, 0))
    hp = bpy.context.active_object; hp.scale = (ow + 0.02, oh + 0.02, 1)
    K = __import__("kit")
    hold = K.holdout_plane(0, 0, 0.01, 0).data.materials[0]
    hp.data.materials.append(hold)
    root = bpy.data.objects.new("root", None); C.link(root)
    for o in list(bpy.data.objects):
        if o is not root and o.parent is None and o.type in ("MESH", "EMPTY") and not o.hide_render:
            o.parent = root
    root.rotation_euler = (0, 0, math.radians(angle))
    cam = bpy.data.cameras.new("Cam"); cam.lens = 55
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    tgt = Vector((0, 0, 0.9))
    co.location = tgt + Vector((0, -18, 6.4))
    co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 620, 1000
    name = f"door{angle:+d}".replace("+", "p").replace("-", "m")
    Wd.pct(); C.render(f"{OUT}/{name}.png")
    # mask pass: everything holds out, the opening glows white
    em = bpy.data.materials.new("white"); em.use_nodes = True; nt = em.node_tree; nt.nodes.clear()
    nt.links.new(nt.nodes.new("ShaderNodeEmission").outputs[0], nt.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"])
    for o in bpy.data.objects:
        if o.type == "MESH" and o.data.materials:
            for i in range(len(o.data.materials)):
                o.data.materials[i] = hold
    hp.data.materials[0] = em
    for l in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        l.hide_render = True
    sc.cycles.samples = 8
    C.render(f"{OUT}/{name}-mask.png")
    return name, {"w": 620, "h": 1000}


if __name__ == "__main__":
    man = json.load(open(MAN)) if os.path.exists(MAN) else {}
    for arg in sys.argv[1:]:
        t = time.time()
        if arg == "plate2": k, v = plate2()
        elif arg.startswith("door:"): k, v = door(int(arg.split(":")[1]))
        else: continue
        man[k] = v
        json.dump(man, open(MAN, "w"), indent=1)
        print("done", k, round(time.time() - t, 1), "s", flush=True)
