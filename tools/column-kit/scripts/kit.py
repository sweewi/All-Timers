"""Render the production column kit + a manifest of pixel positions for the page.

Usage: python3 kit.py <piece> [<piece> ...]   pieces: crown base slice:<tier>:<side>:<frame>[:vines]
"""
import json, math, os, sys, time
sys.path.insert(0, "/home/claude/kit")
import bpy
import common as C, parts as P

OUT = "/home/claude/kit/out/kit"
os.makedirs(OUT, exist_ok=True)
SH = 2.0                      # slice height (one song)
W = 3.9                       # slice width: column + a ledge either side
LW, LD, RV = 1.25, 0.52, 0.16 # ledge capital
FR = 0.9                      # framed cover size on a ledge
ZTOP = 1.0                    # top of the ledge's abacus within a slice
TIERS = {"pristine": 0.0, "clean": 0.22, "weathered": 0.5, "worn": 0.85}
SEED = 5                      # same veining for every tier so tier seams blend

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
    # a back panel so light behaves around the opening
    return inner

def slice_piece(tier, side, kind, vines):
    C.reset()
    wear = TIERS[tier]
    stone = C.marble(f"m_{tier}", wear=wear, seed=SEED, period=SH)
    ledge_stone = C.marble(f"l_{tier}", wear=wear * 0.8, seed=SEED + 1)
    gold = C.gold()
    sh = C.loft(C.fluted_profile(), -0.3, SH + 0.3, rings=2)
    sh.data.materials.append(stone)
    nchips = {"pristine": 0, "clean": 2, "weathered": 5, "worn": 9}[tier]
    if nchips:
        C.chips(sh, nchips, hash((tier, side)) % 1000, 0.15, SH - 0.15)
    sx = 1 if side == "R" else -1
    xr = sx * (C.R + LW / 2 - RV * 0.9)
    P.ionic(xr, ZTOP, LW, LD, RV, ledge_stone)
    tab_top = ZTOP - 0.45
    TW, TH = LW - 0.14, 0.38
    P.tablet(xr, tab_top, TW, TH, LD * 0.85, ledge_stone)
    inner = covered_frame(xr, ZTOP, FR, kind, ledge_stone, gold)
    if vines == "full":
        P.ivy(31, 7, 0.0, period=SH)
    elif vines == "tips":
        P.ivy(31, 7, 0.0, tip_zone=(0.35, 1.6))
    cam = (0, SH / 2, W, SH)
    C.camera(0, SH / 2, W, SH)
    name = f"slice-{tier}-{side}-{kind}" + (f"-{vines}" if vines else "")
    C.render(f"{OUT}/{name}.png")
    fb = ZTOP
    hole = rect(xr - inner / 2, fb + (FR - inner) / 2, xr + inner / 2, fb + (FR + inner) / 2, cam)
    face = rect(xr - TW / 2 + 0.06, tab_top - TH + 0.05, xr + TW / 2 - 0.06, tab_top - 0.05, cam)
    return name, {"w": round(W * C.PX_PER_M), "h": round(SH * C.PX_PER_M), "cover": hole, "tablet": face,
                  "column": rect(-C.R, 0, C.R, SH, cam)}

def crown_piece():
    C.reset()
    stone = C.marble("m_top", wear=0.0, seed=SEED, period=SH)
    gold = C.gold()
    sh = C.loft(C.fluted_profile(), -0.3, 0.75, rings=2); sh.data.materials.append(stone)
    cap_top = 1.25
    P.ionic(0, cap_top, 1.62, 1.12, 0.21, stone, eggs=9, abacus_h=0.1)
    size = 1.5
    inner = covered_frame(0, cap_top, size, "gold", stone, gold)
    w, h = W, 3.1
    cam = (0, h / 2, w, h)
    C.camera(0, h / 2, w, h)
    C.render(f"{OUT}/crown.png")
    hole = rect(-inner / 2, cap_top + (size - inner) / 2, inner / 2, cap_top + (size + inner) / 2, cam)
    return "crown", {"w": round(w * C.PX_PER_M), "h": round(h * C.PX_PER_M), "cover": hole,
                     "column": rect(-C.R, 0, C.R, 0.75, cam), "joinY": round(h * C.PX_PER_M)}

def base_piece(variant="full"):
    C.reset()
    stone = C.marble("m_worn", wear=TIERS["worn"], seed=SEED, period=SH)
    sh = C.loft(C.fluted_profile(), 0.0, 1.6, rings=2); sh.data.materials.append(stone)
    C.chips(sh, 6, 77, 0.2, 1.4)
    P.attic_base(0, stone)
    if variant == "full":
        # the same periodic vines as the worn slices, shifted so they meet the slice above
        P.ivy(31, 7, 1.6 - SH, period=SH)
    P.ivy(32, 5, -0.45, tip_zone=(0.5, 1.3))
    # ground that only catches shadows; the photo garden shows through
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, -0.57))
    C.shadow_catcher(bpy.context.active_object)
    w, h = W, 2.4
    C.camera(0, 1.6 - h / 2, w, h)
    name = "base" if variant == "full" else "base-tips"
    C.render(f"{OUT}/{name}.png")
    cam = (0, 1.6 - h / 2, w, h)
    return name, {"w": round(w * C.PX_PER_M), "h": round(h * C.PX_PER_M), "column": rect(-C.R, -0.8, C.R, 1.6, cam),
                    "plinth": rect(-0.66, -0.43, 0.66, -0.22, cam)}

if __name__ == "__main__":
    C.PX_PER_M = int(os.environ.get("PXM", "520"))
    man_path = f"{OUT}/manifest.json"
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
