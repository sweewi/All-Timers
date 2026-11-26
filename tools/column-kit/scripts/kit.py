"""Render the production column kit + a manifest of pixel positions for the page.

Usage: python3 kit.py <piece> [<piece> ...]   pieces: crown base base-tips slice:<tier>:<side>:<frame>[:vines]

Every slice is SH tall plus an OV strip above it. The page stacks slices SH apart and
fades each one's top OV strip over the piece above, so tiers blend instead of meeting
at a hard line.
"""
import json, math, os, random, sys, time
sys.path.insert(0, "/home/claude/kit")
import bpy
from mathutils import Vector
import common as C, parts as P

OUT = os.environ.get("KITOUT", "/home/claude/kit/out/kit")
os.makedirs(OUT, exist_ok=True)
SH = 2.0                      # slice height (one song)
OV = 0.2                      # overlap strip rendered above each piece
W = 3.9                       # slice width: column + a ledge either side
LW, LD, RV = 1.25, 0.52, 0.16 # ledge capital
FR = 0.9                      # framed cover size on a ledge
ZTOP = 1.0                    # top of the ledge's abacus within a slice
# gentle steps: the eye should feel the column age, never see it change
TIERS = {"pristine": 0.0, "clean": 0.14, "weathered": 0.32, "worn": 0.55}
SEED = 5                      # same veining for every tier so tier seams blend
GRASS = "/home/claude/kit/dl/grass"


def px(x, z, cx, cz, w, h):
    return ((x - (cx - w / 2)) * C.PX_PER_M, ((cz + h / 2) - z) * C.PX_PER_M)


def rect(x0, z0, x1, z1, cam):
    a = px(x0, z1, *cam); b = px(x1, z0, *cam)
    return [round(a[0]), round(a[1]), round(b[0] - a[0]), round(b[1] - a[1])]


def holdout_plane(cx, cz, size, y):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(cx, y, cz), rotation=(math.radians(90), 0, 0))
    o = bpy.context.active_object
    m = bpy.data.materials.new("hold"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); h = nt.nodes.new("ShaderNodeHoldout")
    nt.links.new(h.outputs[0], out.inputs["Surface"])
    o.data.materials.append(m)
    return o


def covered_frame(cx, zb, size, kind, mat_stone, gold):
    """Frame standing at zb with a see-through opening for the album cover."""
    if kind == "gold":
        objs, inner = P.frame(cx, zb, size, gold)
    else:
        objs, inner = P.frame(cx, zb, size, mat_stone, band=size * 0.08, beads=False, depth=0.05)
    holdout_plane(cx, zb + size / 2, inner + 0.004, -0.004)
    return inner


def slice_piece(tier, side, kind, vines):
    C.reset()
    wear = TIERS[tier]
    stone = C.marble(f"m_{tier}", wear=wear, seed=SEED, period=SH)
    ledge_stone = C.marble(f"l_{tier}", wear=wear * 0.8, seed=SEED + 1)
    gold = C.gold()
    sh = C.loft(C.fluted_profile(), -0.3, SH + OV + 0.3, rings=2)
    sh.data.materials.append(stone)
    nchips = {"pristine": 0, "clean": 1, "weathered": 3, "worn": 6}[tier]
    if nchips:
        C.chips(sh, nchips, hash((tier, side)) % 1000, 0.25, SH - 0.25)
    sx = 1 if side == "R" else -1
    xr = sx * (C.R + LW / 2 - RV * 0.9)
    _, under = P.ionic(xr, ZTOP, LW, LD, RV, ledge_stone)
    inner = covered_frame(xr, ZTOP, FR, kind, ledge_stone, gold)
    if vines == "full":
        P.ivy(31, 7, 0.0, period=SH)
    elif vines == "tips":
        P.ivy(31, 7, 0.0, tip_zone=(0.35, 1.6))
    h = SH + OV
    cam = (0, h / 2, W, h)
    C.camera(0, h / 2, W, h)
    name = f"slice-{tier}-{side}-{kind}" + (f"-{vines}" if vines else "")
    C.render(f"{OUT}/{name}.png")
    hole = rect(xr - inner / 2, ZTOP + (FR - inner) / 2, xr + inner / 2, ZTOP + (FR + inner) / 2, cam)
    cap = rect(xr - LW / 2, under, xr + LW / 2, ZTOP, cam)
    return name, {"w": round(W * C.PX_PER_M), "h": round(h * C.PX_PER_M), "ov": round(OV * C.PX_PER_M),
                  "cover": hole, "plaque": [cap[0], cap[1] + cap[3], cap[2]],
                  "column": rect(-C.R, 0, C.R, SH, cam)}


def crown_piece():
    C.reset()
    stone = C.marble("m_top", wear=0.0, seed=SEED, period=SH)
    gold = C.gold()
    cap_top = 1.25
    sh = C.loft(C.fluted_profile(), -0.3, 0.8, rings=2); sh.data.materials.append(stone)
    _, under = P.ionic(0, cap_top, 1.62, 1.12, 0.21, stone, eggs=9, abacus_h=0.1, collar=C.R)
    size = 1.5
    inner = covered_frame(0, cap_top, size, "gold", stone, gold)
    w, h = W, 3.1
    cam = (0, h / 2, w, h)
    C.camera(0, h / 2, w, h)
    C.render(f"{OUT}/crown.png")
    hole = rect(-inner / 2, cap_top + (size - inner) / 2, inner / 2, cap_top + (size + inner) / 2, cam)
    return "crown", {"w": round(w * C.PX_PER_M), "h": round(h * C.PX_PER_M), "cover": hole,
                     "column": rect(-C.R, 0, C.R, under, cam), "joinY": round(h * C.PX_PER_M)}


# ------------------------------------------------------------------ the garden floor

def lawn_material():
    m = bpy.data.materials.new("Lawn"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (0.55, 0.55, 0.55)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    def tex(f, color=True):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(f"{GRASS}/leafy_grass/{f}")
        if not color: t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mp.outputs[0], t.inputs["Vector"]); return t
    d, r, n = tex("Diffuse.jpg"), tex("Rough.jpg", False), tex("nor_gl.jpg", False)
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 1.3; hsv.inputs["Value"].default_value = 0.7
    nt.links.new(d.outputs["Color"], hsv.inputs["Color"])
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = "RGBA"; tint.blend_type = "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0; tint.inputs["B"].default_value = (0.62, 1.0, 0.42, 1)
    nt.links.new(hsv.outputs["Color"], tint.inputs["A"])
    nt.links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    # fade out with distance from the column so it melts into the photo garden
    ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["X"], comb.inputs["X"])
    sy = nt.nodes.new("ShaderNodeMath"); sy.operation = "MULTIPLY"; sy.inputs[1].default_value = 0.55
    nt.links.new(sep.outputs["Y"], sy.inputs[0]); nt.links.new(sy.outputs[0], comb.inputs["Y"])
    nt.links.new(comb.outputs[0], ln.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 1.4
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    add = nt.nodes.new("ShaderNodeMath"); add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 0.9; add.inputs[2].default_value = -0.45
    nt.links.new(nz.outputs["Fac"], add.inputs[0])
    dist = nt.nodes.new("ShaderNodeMath"); dist.operation = "ADD"
    nt.links.new(ln.outputs["Value"], dist.inputs[0]); nt.links.new(add.outputs[0], dist.inputs[1])
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 1.5; fade.inputs["From Max"].default_value = 2.6
    fade.inputs["To Min"].default_value = 1.0; fade.inputs["To Max"].default_value = 0.0
    nt.links.new(dist.outputs[0], fade.inputs["Value"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fade.outputs["Result"], mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(bsdf.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


SCALE = float(os.environ.get("CLUMPSCALE", "0.85"))


def grass_clumps(z, count, seed=4):
    """Scatter Poly Haven grass clumps (CC0) around the plinth, thicker close to the stone."""
    protos = []
    tinted = set()
    for k in ("grass_medium_01", "grass_medium_02"):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f"{GRASS}/{k}/{k}.gltf")
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        for o in new:
            o.hide_render = True; o.location = (0, 0, -50)
        protos += new
        for o in new:
            for slot in o.material_slots:
                m = slot.material
                if not m or m.name in tinted:
                    continue
                tinted.add(m.name)
                nt = m.node_tree
                b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if b and b.inputs["Base Color"].links:
                    src = b.inputs["Base Color"].links[0].from_socket
                    hsv = nt.nodes.new("ShaderNodeHueSaturation")
                    hsv.inputs["Hue"].default_value = 0.515
                    hsv.inputs["Saturation"].default_value = 1.2
                    hsv.inputs["Value"].default_value = 1.45
                    nt.links.new(src, hsv.inputs["Color"])
                    nt.links.new(hsv.outputs["Color"], b.inputs["Base Color"])
        print("grass proto", k, [tuple(round(v, 2) for v in o.dimensions) for o in new], flush=True)
    rnd = random.Random(seed)
    placed = 0
    tries = 0
    while placed < count and tries < count * 20:
        tries += 1
        r = 0.7 + abs(rnd.gauss(0, 0.8))
        a = rnd.uniform(0, 2 * math.pi)
        x, y = r * math.cos(a), r * math.sin(a) * 0.9
        if abs(x) < 0.74 and abs(y) < 0.74:
            continue
        if r > 2.4:
            continue
        p = rnd.choice(protos)
        o = bpy.data.objects.new("clump", p.data)
        C.link(o)
        s = SCALE * rnd.uniform(0.7, 1.3) * (1.0 - 0.3 * min(1, (r - 0.7) / 1.6))
        o.scale = (s, s, s * rnd.uniform(0.8, 1.2))
        o.rotation_euler = (0, 0, rnd.uniform(0, 2 * math.pi))
        o.location = (x, y, z - 0.01)
        placed += 1


def base_piece(variant="full", tilt=7.0):
    C.reset()
    stone = C.marble("m_worn", wear=TIERS["worn"], seed=SEED, period=SH)
    top = 1.6
    sh = C.loft(C.fluted_profile(), 0.0, top + OV + 0.4, rings=2); sh.data.materials.append(stone)
    C.chips(sh, 5, 77, 0.2, 1.4)
    P.attic_base(0, stone)
    if variant == "full":
        # the same periodic vines as the worn slices, shifted so they meet the slice above
        P.ivy(31, 7, top - SH, period=SH)
    P.ivy(32, 5, -0.45, tip_zone=(0.5, 1.3))
    zg = -0.445
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, zg))
    lawn = bpy.context.active_object
    lawn.data.materials.append(lawn_material())
    grass_clumps(zg, int(os.environ.get("CLUMPS", "1100")))
    # camera looks down a few degrees so the lawn reads as ground, not a line
    t = math.radians(tilt)
    up = Vector((0, math.sin(t), math.cos(t)))
    fwd = Vector((0, math.cos(t), -math.sin(t)))
    v = lambda x, y, z: Vector((x, y, z)).dot(up)
    v_top = v(0, -C.R, top + OV)                # top of the image: front of the shaft
    v_bot = v(0, -0.71 - 2.6, zg)               # bottom: lawn well in front of the plinth
    h = v_top - v_bot
    vc = (v_top + v_bot) / 2
    cam = bpy.data.cameras.new("Cam"); cam.type = "ORTHO"; cam.ortho_scale = max(W, h)
    co = bpy.data.objects.new("Cam", cam); C.link(co)
    co.location = up * vc - fwd * 20
    co.rotation_euler = (math.radians(90) - t, 0, 0)
    sc = bpy.context.scene; sc.camera = co
    sc.render.resolution_x = round(W * C.PX_PER_M); sc.render.resolution_y = round(h * C.PX_PER_M)
    name = "base" if variant == "full" else "base-tips"
    C.render(f"{OUT}/{name}.png")
    py = lambda y, z: round((v_top - v(0, y, z)) * C.PX_PER_M)
    pxx = lambda x: round((x + W / 2) * C.PX_PER_M)
    return name, {"w": round(W * C.PX_PER_M), "h": round(h * C.PX_PER_M), "ov": py(-C.R, top),
                  "plinth": [pxx(-0.64), py(-0.71, -0.22), pxx(0.64) - pxx(-0.64), py(-0.71, -0.43) - py(-0.71, -0.22)],
                  "ground": py(-0.71, zg)}


if __name__ == "__main__":
    C.PX_PER_M = int(os.environ.get("PXM", "520"))
    man_path = os.environ.get("MANIFEST", f"{OUT}/manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else {}
    for arg in sys.argv[1:]:
        t = time.time()
        if arg == "crown": k, v = crown_piece()
        elif arg == "base": k, v = base_piece()
        elif arg == "base-tips": k, v = base_piece("tips")
        else:
            _, tier, side, kind, *rest = arg.split(":")
            k, v = slice_piece(tier, side, kind, rest[0] if rest else None)
        man[k] = v
        json.dump(man, open(man_path, "w"), indent=1)
        print("done", k, round(time.time() - t, 1), "s", flush=True)
