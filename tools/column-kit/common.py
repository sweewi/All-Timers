"""Shared scene setup for the All-Timers column kit (Blender as a Python module).

Units are meters. The column is 1.0 m in diameter, axis along Z, viewed from the
front (-Y) by an orthographic camera so stacked renders line up exactly.
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector

KIT = "/home/claude/kit"
HDRI = f"{KIT}/dl/cloud_layers_2k.hdr"
R = 0.5            # shaft radius
FLUTES = 24        # Ionic columns have 24 flutes
SEG_H = 2.0        # height of one repeating shaft segment
PX_PER_M = 520     # render density


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 20
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.04
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 2
    sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 4
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = "OPENIMAGEDENOISE"
    except Exception:
        pass
    sc.cycles.max_bounces = 3
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    sc.view_settings.exposure = 0.5
    world()
    sun()
    return sc


def world(strength=0.85):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexEnvironment")
    tex.image = bpy.data.images.load(HDRI)
    mapping = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping.inputs["Rotation"].default_value[2] = math.radians(200)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 0.45
    warm = nt.nodes.new("ShaderNodeMix"); warm.data_type = "RGBA"; warm.blend_type = "MULTIPLY"
    warm.inputs["Factor"].default_value = 1.0
    warm.inputs["B"].default_value = (1.0, 0.93, 0.84, 1)
    nt.links.new(tex.outputs["Color"], hsv.inputs["Color"])
    nt.links.new(hsv.outputs["Color"], warm.inputs["A"])
    nt.links.new(warm.outputs["Result"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def sun():
    """Warm sun from upper left and slightly in front: golden highlights, real shadows."""
    d = bpy.data.lights.new("Sun", "SUN")
    d.energy = 5.0
    d.color = (1.0, 0.82, 0.58)
    d.angle = math.radians(1.2)
    o = bpy.data.objects.new("Sun", d)
    bpy.context.collection.objects.link(o)
    # elevation ~38 deg, coming from the left-front
    o.rotation_euler = (math.radians(50), 0, math.radians(-62))
    return o


def camera(cx, cz, width_m, height_m):
    cam = bpy.data.cameras.new("Cam")
    cam.type = "ORTHO"
    cam.ortho_scale = max(width_m, height_m)
    o = bpy.data.objects.new("Cam", cam)
    bpy.context.collection.objects.link(o)
    o.location = (cx, -20, cz)
    o.rotation_euler = (math.radians(90), 0, 0)
    sc = bpy.context.scene
    sc.camera = o
    sc.render.resolution_x = int(round(width_m * PX_PER_M))
    sc.render.resolution_y = int(round(height_m * PX_PER_M))
    sc.render.resolution_percentage = 100
    return o


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def link(obj):
    bpy.context.collection.objects.link(obj)
    return obj


def shade_smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------- materials

def _n(nt, kind, **inputs):
    node = nt.nodes.new(kind)
    for k, v in inputs.items():
        node.inputs[k].default_value = v
    return node


def marble(name="Marble", wear=0.0, seed=1, period=None):
    """White marble with subsurface glow and soft gray veining.

    wear 0..1 adds grime settled in the flutes (via ambient occlusion), a faint green
    tint near the bottom of each surface and rougher stone. `period` makes the
    veining repeat every `period` meters along Z so stacked segments tile.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.42 + 0.2 * wear
    bsdf.subsurface_method = "BURLEY"
    bsdf.inputs["Subsurface Weight"].default_value = 0.3
    bsdf.inputs["Subsurface Radius"].default_value = (0.012, 0.010, 0.008)
    bsdf.inputs["Subsurface Scale"].default_value = 0.6
    bsdf.inputs["Specular IOR Level"].default_value = 0.45

    tc = nt.nodes.new("ShaderNodeTexCoord")
    # periodic 4D coordinate: (x, y, k cos(2 pi z / P)), w = k sin(...)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    if period:
        k = period / (2 * math.pi)
        ang = _n(nt, "ShaderNodeMath", **{})
        ang.operation = "MULTIPLY"
        ang.inputs[1].default_value = 2 * math.pi / period
        nt.links.new(sep.outputs["Z"], ang.inputs[0])
        cos = nt.nodes.new("ShaderNodeMath"); cos.operation = "COSINE"
        sin = nt.nodes.new("ShaderNodeMath"); sin.operation = "SINE"
        nt.links.new(ang.outputs[0], cos.inputs[0]); nt.links.new(ang.outputs[0], sin.inputs[0])
        cosk = nt.nodes.new("ShaderNodeMath"); cosk.operation = "MULTIPLY"; cosk.inputs[1].default_value = k
        sink = nt.nodes.new("ShaderNodeMath"); sink.operation = "MULTIPLY"; sink.inputs[1].default_value = k
        nt.links.new(cos.outputs[0], cosk.inputs[0]); nt.links.new(sin.outputs[0], sink.inputs[0])
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(sep.outputs["X"], comb.inputs["X"]); nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
        nt.links.new(cosk.outputs[0], comb.inputs["Z"])
        vec, w = comb.outputs[0], sink.outputs[0]
    else:
        vec, w = tc.outputs["Object"], None

    def noise(scale, detail, rough, distortion=0.0):
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.noise_dimensions = "4D"
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = detail
        nz.inputs["Roughness"].default_value = rough
        nz.inputs["Distortion"].default_value = distortion
        nz.inputs["W"].default_value = seed * 3.17
        nt.links.new(vec, nz.inputs["Vector"])
        if w is not None:
            add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"; add.inputs[1].default_value = seed * 3.17
            nt.links.new(w, add.inputs[0]); nt.links.new(add.outputs[0], nz.inputs["W"])
        return nz

    # veins: thin bands where a distorted noise crosses 0.5
    vn = noise(1.1, 7, 0.6, 3.0)
    band = nt.nodes.new("ShaderNodeMath"); band.operation = "SUBTRACT"; band.inputs[1].default_value = 0.5
    nt.links.new(vn.outputs["Fac"], band.inputs[0])
    ab = nt.nodes.new("ShaderNodeMath"); ab.operation = "ABSOLUTE"
    nt.links.new(band.outputs[0], ab.inputs[0])
    vein = nt.nodes.new("ShaderNodeMapRange")
    vein.inputs["From Min"].default_value = 0.0
    vein.inputs["From Max"].default_value = 0.018
    vein.inputs["To Min"].default_value = 1.0
    vein.inputs["To Max"].default_value = 0.0
    nt.links.new(ab.outputs[0], vein.inputs["Value"])

    # base color: warm white with cloudy variation
    cloud = noise(4.0, 4, 0.5)
    base = nt.nodes.new("ShaderNodeMix"); base.data_type = "RGBA"
    base.inputs["A"].default_value = (0.86, 0.84, 0.80, 1)
    base.inputs["B"].default_value = (0.93, 0.92, 0.89, 1)
    nt.links.new(cloud.outputs["Fac"], base.inputs["Factor"])
    veined = nt.nodes.new("ShaderNodeMix"); veined.data_type = "RGBA"
    veined.inputs["B"].default_value = (0.55, 0.55, 0.56, 1)
    vmul = nt.nodes.new("ShaderNodeMath"); vmul.operation = "MULTIPLY"; vmul.inputs[1].default_value = 0.38
    nt.links.new(vein.outputs["Result"], vmul.inputs[0])
    nt.links.new(vmul.outputs[0], veined.inputs["Factor"])
    nt.links.new(base.outputs["Result"], veined.inputs["A"])
    color = veined.outputs["Result"]

    if wear > 0:
        ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao.inputs["Distance"].default_value = 0.08
        inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
        nt.links.new(ao.outputs["AO"], inv.inputs[1])
        grime_n = noise(9.0, 5, 0.6)
        g = nt.nodes.new("ShaderNodeMath"); g.operation = "MULTIPLY"
        nt.links.new(inv.outputs[0], g.inputs[0]); nt.links.new(grime_n.outputs["Fac"], g.inputs[1])
        g2 = nt.nodes.new("ShaderNodeMath"); g2.operation = "MULTIPLY"; g2.inputs[1].default_value = 2.6 * wear
        nt.links.new(g.outputs[0], g2.inputs[0])
        cl = nt.nodes.new("ShaderNodeClamp")
        nt.links.new(g2.outputs[0], cl.inputs["Value"])
        dirt = nt.nodes.new("ShaderNodeMix"); dirt.data_type = "RGBA"
        dirt.inputs["B"].default_value = (0.36, 0.33, 0.25, 1) if wear < 0.7 else (0.26, 0.30, 0.20, 1)
        nt.links.new(color, dirt.inputs["A"]); nt.links.new(cl.outputs[0], dirt.inputs["Factor"])
        # overall weathering blotches
        blot = noise(2.2, 3, 0.6)
        bm = nt.nodes.new("ShaderNodeMapRange")
        bm.inputs["From Min"].default_value = 0.45; bm.inputs["From Max"].default_value = 0.75
        bm.inputs["To Max"].default_value = 0.45 * wear
        nt.links.new(blot.outputs["Fac"], bm.inputs["Value"])
        stain = nt.nodes.new("ShaderNodeMix"); stain.data_type = "RGBA"
        stain.inputs["B"].default_value = (0.62, 0.60, 0.52, 1)
        nt.links.new(dirt.outputs["Result"], stain.inputs["A"]); nt.links.new(bm.outputs["Result"], stain.inputs["Factor"])
        color = stain.outputs["Result"]

    nt.links.new(color, bsdf.inputs["Base Color"])
    # fine surface pitting for matte stone
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08 + 0.25 * wear
    bump.inputs["Distance"].default_value = 0.002
    pit = noise(140.0, 2, 0.5)
    nt.links.new(pit.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def gold(name="Gold", rough=0.22):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1.0, 0.71, 0.29, 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = rough
    # slight hammered unevenness so highlights break up like real gilding
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 60
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.05
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def shadow_catcher(obj):
    obj.is_shadow_catcher = True
    return obj


# ---------------------------------------------------------------- geometry

def fluted_profile(r=R, flutes=FLUTES, depth=0.045, fillet_frac=0.22, steps=10):
    """2D outline of a fluted shaft: semicircular-ish flutes separated by flat fillets."""
    pts = []
    per = 2 * math.pi / flutes
    fw = per * (1 - fillet_frac)
    for i in range(flutes):
        a0 = i * per
        # fillet
        for t in (0.0, 0.5):
            a = a0 + t * (per - fw)
            pts.append((r * math.cos(a), r * math.sin(a)))
        # flute
        for s in range(1, steps):
            u = s / steps
            a = a0 + (per - fw) + u * fw
            d = depth * math.sqrt(max(0.0, 1 - (2 * u - 1) ** 2))
            rr = r - d
            pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


def loft(profile, z0, z1, rings=2, name="Shaft"):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    loops = []
    for k in range(rings + 1):
        z = z0 + (z1 - z0) * k / rings
        loops.append([bm.verts.new((x, y, z)) for x, y in profile])
    n = len(profile)
    for k in range(rings):
        a, b = loops[k], loops[k + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    shade_smooth(o)
    return o


def chips(target, count, seed, zmin, zmax, size=(0.02, 0.06)):
    """Knock small chips out of flute edges with boolean cutters."""
    rnd = random.Random(seed)
    cutters = []
    for _ in range(count):
        a = rnd.uniform(-math.pi * 0.85, -math.pi * 0.15)  # front half (faces camera at -Y)
        z = rnd.uniform(zmin, zmax)
        s = rnd.uniform(*size)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=s, location=(R * math.cos(a), R * math.sin(a), z))
        c = bpy.context.active_object
        c.scale = (rnd.uniform(0.7, 1.4), rnd.uniform(0.6, 1.2), rnd.uniform(0.8, 1.8))
        c.rotation_euler = (rnd.random() * 3, rnd.random() * 3, rnd.random() * 3)
        dis = c.modifiers.new("d", "DISPLACE")
        tx = bpy.data.textures.new("ct", "CLOUDS"); tx.noise_scale = 0.02
        dis.texture = tx; dis.strength = s * 0.5
        cutters.append(c)
    for c in cutters:
        mod = target.modifiers.new("chip", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = c
        mod.solver = "EXACT"
        c.hide_render = True
        c.display_type = "WIRE"
    return cutters
