"""Column kit parts: Ionic scroll ledge, inscription tablet, gold frame, capital, base, vines."""
import math
import random

import bpy
import bmesh
from mathutils import Vector

import common as C


def _obj_from_bm(bm, name, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    C.link(o)
    if smooth:
        C.shade_smooth(o)
    if mat:
        o.data.materials.append(mat)
    return o


def box(name, center, size, mat=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = o.modifiers.new("bev", "BEVEL")
        m.width = bevel
        m.segments = 4
        m.limit_method = "ANGLE"
    if mat:
        o.data.materials.append(mat)
    return o


def cyl_x(name, center, radius, length, mat=None, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=length, location=center,
                                        rotation=(0, math.radians(90), 0))
    o = bpy.context.active_object
    o.name = name
    C.shade_smooth(o)
    if mat:
        o.data.materials.append(mat)
    return o


def cyl_y(name, center, radius, length, mat=None, verts=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=length, location=center,
                                        rotation=(math.radians(90), 0, 0))
    o = bpy.context.active_object
    o.name = name
    C.shade_smooth(o)
    if mat:
        o.data.materials.append(mat)
    m = o.modifiers.new("bev", "BEVEL")
    m.width = radius * 0.08
    m.segments = 3
    m.limit_method = "ANGLE"
    return o


def spiral_ridge(name, center, rv, front_y, turns=2.6, mirror=False, mat=None):
    """The volute's spiral channel: a raised ridge winding in to the eye."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = rv * 0.075
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    n = 220
    sp.points.add(n - 1)
    for i in range(n):
        t = i / (n - 1)
        r = rv * (0.93 - 0.72 * t)
        a = math.pi / 2 + (1 if not mirror else -1) * turns * 2 * math.pi * t
        x = center[0] + r * math.cos(a)
        z = center[2] + r * math.sin(a)
        sp.points[i].co = (x, front_y, z, 1)
    o = bpy.data.objects.new(name, cu)
    C.link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def sphere(name, center, radius, scale=(1, 1, 1), mat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    C.shade_smooth(o)
    if mat:
        o.data.materials.append(mat)
    return o


def ionic(cx, ztop, width, depth, rv, mat, eggs=7, abacus_h=None, collar=None):
    """An Ionic capital: abacus, canalis, a solid bolster between two volutes, and an
    echinus with egg-and-dart. Built along X so the volutes face the camera.

    ztop is the top of the abacus. The body is closed underneath so no sky shows
    through. With `collar` (a shaft radius) it also gets the round echinus and the
    astragal bead that seat it on a shaft. Returns (objects, z of the underside).
    """
    objs = []
    ah = abacus_h or rv * 0.42
    objs.append(box("abacus", (cx, 0, ztop - ah / 2), (width * 1.04, depth * 1.06, ah), mat, bevel=ah * 0.22))
    # a thin cyma under the abacus so its edge casts a soft line, not a slot
    objs.append(box("cyma", (cx, 0, ztop - ah - rv * 0.06), (width * 0.97, depth * 1.0, rv * 0.14), mat, bevel=rv * 0.05))
    zc = ztop - ah - rv * 1.02          # volute center
    vx = width / 2 - rv
    front = -depth / 2
    for side in (-1, 1):
        x = cx + side * vx
        objs.append(cyl_y(f"roll{side}", (x, 0, zc), rv, depth, mat))
        objs.append(spiral_ridge(f"spiral{side}", (x, 0, zc), rv, front - rv * 0.02, mirror=(side > 0), mat=mat))
        objs.append(sphere(f"eye{side}", (x, front - rv * 0.03, zc), rv * 0.16, (1, 0.5, 1), mat))
    # canalis: the band joining the tops of the volutes
    band_h = rv * 0.95
    objs.append(box("canalis", (cx, 0, zc + rv - band_h / 2 + 0.002), (2 * vx, depth * 0.98, band_h), mat, bevel=rv * 0.08))
    # bolster: fills the space between and behind the volutes down to their underside
    zb = zc - rv * 0.9
    body_d = depth * 0.92
    objs.append(box("bolster", (cx, 0, (zb + zc + 0.1 * rv) / 2), (2 * vx + rv * 0.6, body_d, zc + 0.1 * rv - zb), mat,
                    bevel=rv * 0.1))
    if collar:
        R = collar
        # round echinus seated on the shaft, eggs around its front
        bpy.ops.mesh.primitive_cone_add(vertices=128, radius1=R + 0.012, radius2=R + 0.085, depth=0.15,
                                        location=(cx, 0, zb + 0.03))
        e = bpy.context.active_object; e.name = "echinus"; C.shade_smooth(e); e.data.materials.append(mat)
        bv = e.modifiers.new("bev", "BEVEL"); bv.width = 0.02; bv.segments = 4; bv.limit_method = "ANGLE"
        objs.append(e)
        n = eggs * 2
        for i in range(n):
            a = math.pi + (i + 0.5) / n * math.pi
            rr = R + 0.06
            objs.append(sphere(f"egg{i}", (cx + rr * math.cos(a), rr * math.sin(a), zb + 0.035), 0.04,
                               (0.62, 0.5, 0.95), mat))
        bpy.ops.mesh.primitive_torus_add(major_radius=R + 0.006, minor_radius=0.024, major_segments=128,
                                         minor_segments=16, location=(cx, 0, zb - 0.07))
        t = bpy.context.active_object; t.name = "astragal"; C.shade_smooth(t); t.data.materials.append(mat)
        objs.append(t)
        return objs, zb - 0.1
    # ledge: egg-and-dart set into the bolster's front, a bead line beneath
    fy = -body_d / 2
    elen = 2 * vx - rv * 0.7
    er = rv * 0.2
    for i in range(eggs + 2):
        ex = cx - elen / 2 + elen * (i + 0.5) / (eggs + 2)
        objs.append(sphere(f"egg{i}", (ex, fy, zb + rv * 0.42), er, (0.8, 0.5, 1.15), mat))
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=rv * 0.07, depth=elen + rv * 0.2,
                                        location=(cx, fy + rv * 0.02, zb + rv * 0.13), rotation=(0, math.radians(90), 0))
    bead = bpy.context.active_object; C.shade_smooth(bead); bead.data.materials.append(mat); objs.append(bead)
    objs.append(box("fillet", (cx, 0, zb + rv * 0.03), (2 * vx + rv * 0.3, body_d * 0.98, rv * 0.06), mat, bevel=rv * 0.02))
    return objs, zc - rv


def tablet(cx, ztop, w, h, d, mat):
    """Tabula ansata: an inscription plaque with dovetail handles. Its front face is flat
    so the song title can be 'carved' onto it in the page."""
    objs = [box("tablet", (cx, -d / 2 + 0.01, ztop - h / 2), (w, d, h), mat, bevel=0.012)]
    # raised border frame on the face
    t = 0.022
    fy = -d + 0.006
    for (x, z, sx, sz) in [(cx, ztop - t / 2 - 0.02, w - 0.05, t), (cx, ztop - h + t / 2 + 0.02, w - 0.05, t),
                           (cx - w / 2 + t / 2 + 0.025, ztop - h / 2, t, h - 0.04),
                           (cx + w / 2 - t / 2 - 0.025, ztop - h / 2, t, h - 0.04)]:
        objs.append(box("tb_rim", (x, fy, z), (sx, 0.02, sz), mat, bevel=0.006))
    return objs


def frame(cx, zbottom, size, mat, y=-0.02, depth=0.07, band=None, beads=True, lean=0.0):
    """Square gilded frame with a classical molding profile and a bead string.

    The opening is left empty: the page puts the album cover behind it.
    zbottom is where it stands. Returns (objects, opening_size).
    """
    band = band or size * 0.14
    inner = size - 2 * band
    # profile: (distance from inner edge, depth toward camera)
    prof = [(0.0, 0.0), (0.0, 0.012), (0.10, 0.018), (0.18, 0.012), (0.30, 0.03), (0.42, 0.045),
            (0.55, 0.05), (0.62, 0.04), (0.70, 0.055), (0.84, 0.07), (0.94, 0.06), (1.0, 0.035), (1.0, 0.0)]
    bm = bmesh.new()
    cz = zbottom + size / 2
    rings = []
    for (u, dd) in prof:
        hs = inner / 2 + u * band
        dz = dd * depth / 0.07
        ring = [bm.verts.new((cx + sx * hs, y - dz, cz + sz * hs)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        rings.append(ring)
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj_from_bm(bm, "frame", mat, smooth=False)
    ws = o.modifiers.new("ws", "WEIGHTED_NORMAL")
    objs = [o]
    if beads:
        hs = inner / 2 + 0.62 * band
        r = band * 0.06
        n = max(8, int((2 * hs) / (r * 2.6)))
        for sx, sz, ex, ez in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
            for i in range(n):
                t = i / n
                x = cx + hs * (sx + (ex - sx) * t)
                z = cz + hs * (sz + (ez - sz) * t)
                objs.append(sphere("bead", (x, y - 0.045 * depth / 0.07 - r * 0.3, z), r, (1, 1, 1), mat))
    # a thin back panel so the frame reads as an object even before the art loads
    if lean:
        for ob in objs:
            ob.rotation_euler[0] = math.radians(lean)
    return objs, inner


def attic_base(cx, mat):
    """Plinth + torus / scotia / torus, the classical column base. Top sits at z=0."""
    objs = []
    plinth_h = 0.24
    z0 = -plinth_h - 0.09 - 0.05 - 0.065
    objs.append(box("plinth", (cx, 0, z0 + plinth_h / 2), (1.42, 1.42, plinth_h), mat, bevel=0.02))
    def torus(name, z, R, r):
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=96, minor_segments=24, location=(cx, 0, z))
        o = bpy.context.active_object; o.name = name; C.shade_smooth(o); o.data.materials.append(mat); return o
    z = z0 + plinth_h
    objs.append(torus("torus_low", z + 0.09, 0.6, 0.09))
    bpy.ops.mesh.primitive_cone_add(vertices=96, radius1=0.6, radius2=0.53, depth=0.06, location=(cx, 0, z + 0.2))
    sc = bpy.context.active_object; C.shade_smooth(sc); sc.data.materials.append(mat); objs.append(sc)
    objs.append(torus("torus_high", z + 0.255, 0.55, 0.06))
    return objs


# ------------------------------------------------------------------- ivy

LEAF = None


def leaf_mesh():
    global LEAF
    if LEAF is not None:
        try:
            LEAF.name
            return LEAF
        except ReferenceError:
            LEAF = None
    bm = bmesh.new()
    pts = []
    for i in range(24):
        t = i / 24 * 2 * math.pi
        # ivy-ish leaf: lobed heart outline
        r = 0.5 + 0.18 * math.cos(3 * t) + 0.12 * math.cos(t)
        pts.append((r * math.sin(t) * 0.9, r * math.cos(t)))
    vs = [bm.verts.new((x, 0, z)) for x, z in pts]
    c = bm.verts.new((0, -0.06, 0.05))
    for i in range(len(vs)):
        bm.faces.new((c, vs[i], vs[(i + 1) % len(vs)]))
    me = bpy.data.meshes.new("leaf")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    LEAF = me
    return me


def ivy_material():
    m = bpy.data.materials.new("Ivy")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.11, 0.2, 0.06, 1)
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Subsurface Weight"].default_value = 0.15
    b.inputs["Subsurface Radius"].default_value = (0.02, 0.05, 0.01)
    # color variation per leaf
    info = m.node_tree.nodes.new("ShaderNodeObjectInfo")
    ramp = m.node_tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.09, 0.025, 1)
    ramp.color_ramp.elements[1].color = (0.10, 0.19, 0.05, 1)
    m.node_tree.links.new(info.outputs["Random"], ramp.inputs["Fac"])
    m.node_tree.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def stem_material():
    m = bpy.data.materials.new("Stem")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.09, 0.07, 0.045, 1)
    b.inputs["Roughness"].default_value = 0.7
    return m


def ivy(seed, count, z0=0.0, period=None, tip_zone=None, leaf_seed=None, length=None):
    """Ivy climbing the front of the shaft.

    Each vine has its own random stream, so the same seed gives the same vines in
    every piece. With `period`, each vine is bent so it ends where it started and is
    copied one period above and below: stacked pieces join seamlessly. With
    `tip_zone=(from, to)`, the same vines grow up from z0 and end in that range,
    thinning out toward the tip.
    """
    leafm, stemm = ivy_material(), stem_material()
    leaf = leaf_mesh()
    if not leaf.materials:
        leaf.materials.append(leafm)
    objs = []
    R = C.R + 0.012
    span = period or length or 2.0
    for v in range(count):
        rv = random.Random(seed * 1009 + v)
        rl = random.Random((leaf_seed or seed) * 7919 + v)
        a0 = rv.uniform(-math.pi * 0.93, -math.pi * 0.07)
        end = z0 + span
        if tip_zone:
            end = z0 + random.Random(seed * 31 + v).uniform(*tip_zone)
        pts, a, z = [], a0, z0
        while z < end:
            pts.append((a, z))
            a += rv.gauss(0, 0.045)
            z += rv.uniform(0.02, 0.035)
        if period and not tip_zone:
            pts.append((a, z0 + period))
            drift = pts[-1][0] - a0
            pts = [(aa - drift * (zz - z0) / period, zz) for aa, zz in pts]
        if len(pts) < 2:
            continue
        offsets = [-period, 0.0, period] if period and not tip_zone else [0.0]
        for off in offsets:
            cu = bpy.data.curves.new("stem", "CURVE")
            cu.dimensions = "3D"
            cu.bevel_depth = 0.0042
            sp = cu.splines.new("POLY")
            sp.points.add(len(pts) - 1)
            for i, (aa, zz) in enumerate(pts):
                sp.points[i].co = (R * math.cos(aa), R * math.sin(aa), zz + off, 1)
            so = bpy.data.objects.new("stem", cu)
            C.link(so)
            so.data.materials.append(stemm)
            objs.append(so)
            rl2 = random.Random(rl.random())
            for i, (aa, zz) in enumerate(pts):
                if rl2.random() > 0.85:
                    continue
                if tip_zone and zz - z0 > (end - z0) * 0.45 and rl2.random() < (zz - z0 - (end - z0) * 0.45) / max(0.01, (end - z0) * 0.55):
                    continue
                lo = bpy.data.objects.new("leaf", leaf)
                C.link(lo)
                s = rl2.uniform(0.045, 0.085)
                if tip_zone:
                    s *= 1 - 0.45 * max(0.0, (zz - z0) / max(0.01, end - z0))
                lo.scale = (s, s, s)
                aa2 = aa + rl2.uniform(-0.12, 0.12)
                rr = R + 0.01 + rl2.uniform(0, 0.02)
                lo.location = (rr * math.cos(aa2), rr * math.sin(aa2), zz + off + rl2.uniform(-0.02, 0.02))
                lo.rotation_euler = (rl2.uniform(-0.6, 0.4), rl2.uniform(-0.6, 0.6), aa2 + math.pi / 2 + rl2.uniform(-0.5, 0.5))
                objs.append(lo)
    return objs
