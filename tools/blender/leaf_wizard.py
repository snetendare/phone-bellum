"""Leaf Wizard: the low-poly model, built in Blender from this script (see docs/art-direction.md).

In the Blender you have open: Scripting tab > Open > this file > Run Script. It builds the wizard into a
"LeafWizard" collection in the open .blend (running it again replaces that collection, nothing else is touched),
and if the .blend is saved it also exports leaf_wizard.glb next to it.

From a terminal (Blender, or the `bpy` module from pip):
  blender -b -P tools/blender/leaf_wizard.py -- [--out DIR] [--renders]
  python3 tools/blender/leaf_wizard.py [--out DIR] [--renders]
writes DIR/leaf_wizard.glb and .blend (DIR defaults to models/), and with --renders DIR/leaf_wizard_sheet.png.

The character: the most ninja of the wizards, and a cocky show-off about it. Emotion: smug. He stands in a
ready stance with his chin up, one hand in a hand seal, half-lidded eyes squinting over a scarf pulled up as a
mask. The hat is a low, wide leaf kasa pulled down over the eyes, with only a short wizard tip swept back.
World detail: a scroll of leaf techniques strapped across his back. The emotion explains the mechanics: he
can't just walk somewhere, he wind-walks there and strikes a pose.

Parts are separate objects with their pivots at the joints, for code animation in three.js: body (pivot at the
hips), head (neck), hat (top of the head), scarf (neck, the two tails), arm_L / arm_R (shoulders), leg_L / leg_R
(hips), staff (in the right hand, parented to arm_R), wisps (three floating leaves round the seal hand, parented to
arm_L). The pose is in the parts' rotations, so code can start from it.

Style: Frutiger Aero, after the owner's references: glossy fresh greens, sky blue and white, leaves that light up
towards their tips, glowing eyes. Colours are vertex colours on two materials: LeafWizard (glossy) and
LeafWizardGlow (the same, emissive: eyes, staff blade, wisps). +Y is up and he faces +Z in the GLB (Blender: faces
-Y). About 2.4 units tall, feet at y = 0.
"""
import math
import os
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Euler, Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
IN_UI = not bpy.app.background
RENDERS = '--renders' in ARGS


def out_dir():
    if '--out' in ARGS:
        return ARGS[ARGS.index('--out') + 1]
    if bpy.data.filepath:
        return os.path.dirname(bpy.data.filepath)
    if not IN_UI and os.path.isfile(__file__):
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')
    return None  # an unsaved file in the UI: build only


# Frutiger Aero, after the owner's references: fresh glossy greens, sky blue and clean white, leaves that light up
# towards their tips, glowing eyes. (This leaves the dusty pastel rule of docs/art-direction.md, on purpose.)
C = {
    'leaf': '#6FC83C', 'leafDeep': '#3B9435', 'lime': '#B9EE5C', 'tip': '#C8F6FF', 'hatUnder': '#24502A',
    'sky': '#4FB3EA', 'skyLight': '#B8E8FF', 'white': '#F2EFE6',
    'pants': '#3B4234', 'skin': '#4A3A30', 'void': '#0E1316', 'eye': '#F2FF7A',
    'wood': '#7A5636',
}


def rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def lin(c):  # sRGB -> linear, for the colour attribute
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(rgb(a), rgb(b))]


# ---------- tiny mesh kit: every piece is a bmesh with a colour per face corner ----------
class Piece:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')  # sRGB while building, made linear in to_object
        self.glow = self.bm.faces.layers.int.new('glow')

    def add(self, src, color, mat=None, tip=None, t=None, glow=False):
        """Copy the bmesh src into the piece, transformed by mat.
        color: one colour, or a list cycled per face. tip: blend to this colour along t(local co) in 0..1
        (by default along +Y, the length of a leaf or a scarf tail). glow: the emissive material."""
        if tip:
            ys = [v.co.y for v in src.verts]
            lo, hi = min(ys), max(ys)
            t = t or (lambda co: ((co.y - lo) / ((hi - lo) or 1)) ** 2.2)  # the colour stays until near the tip
            tv = {v: max(0.0, min(1.0, t(v.co))) for v in src.verts}
        if mat is not None:
            src.transform(mat)
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        colors = color if isinstance(color, list) else [color]
        for i, f in enumerate(src.faces):
            nf = self.bm.faces.new([vmap[v] for v in f.verts])
            nf[self.glow] = int(glow)
            c = colors[i % len(colors)]
            for loop, v in zip(nf.loops, f.verts):
                loop[self.col] = (*(mix(c, tip, tv[v]) if tip else rgb(c)), 1.0)
        src.free()


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def aim(v):
    """A rotation matrix turning +Z along v."""
    return Vector(v).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()


def cone(r1, r2, depth, seg=6):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    bm.transform(M((0, 0, depth / 2)))  # base at z = 0
    return bm


def ball(r, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    return bm


def cube(sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bm.transform(M(scale=(sx, sy, sz)))
    return bm


def tube(points, radii, seg=5):
    """A bent tube through points (limbs, the staff)."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(points):
        d = Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])
        q = d.normalized().to_track_quat('Z', 'Y')
        rings.append([bm.verts.new(Vector(p) + q @ Vector((math.cos(a) * radii[i], math.sin(a) * radii[i], 0)))
                      for a in (2 * math.pi * s / seg for s in range(seg))])
    for r0, r1 in zip(rings, rings[1:]):
        for s in range(seg):
            bm.faces.new((r0[s], r0[(s + 1) % seg], r1[(s + 1) % seg], r1[s]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return bm


def ribbon(points, widths, side=(1, 0, 0)):
    """A flat strip through points, widths across `side` (the scarf tails)."""
    bm = bmesh.new()
    side = Vector(side).normalized()
    rows = [(bm.verts.new(Vector(p) - side * w / 2), bm.verts.new(Vector(p) + side * w / 2)) for p, w in zip(points, widths)]
    for (a0, b0), (a1, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    return bm


def leaf(length, width, fold=0.2):
    """A big folded leaf blade along +Y, base at the origin, the midrib raised along +Z (4 triangles)."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(0, 0, 0), (-width / 2, length * 0.4, 0), (0, length * 0.4, width * fold),
                                   (width / 2, length * 0.4, 0), (0, length, 0)]]
    for a, b, c in [(0, 2, 1), (0, 3, 2), (1, 2, 4), (2, 3, 4)]:
        bm.faces.new((v[a], v[b], v[c]))
    return bm


# ---------- the parts ----------
# Blender axes: +Z up, he faces -Y, his right hand is -X. Pivots in world space; part geometry is relative to them.
HIP = 0.74
NECK = 1.36
SHOULDER = 1.30
UP = lambda lo, hi: (lambda co: (co.z - lo) / (hi - lo))  # a gradient from bottom to top


def build_legs():
    legs = {}
    for side, sx in (('L', 1), ('R', -1)):
        p = Piece()
        p.add(tube([(0, 0, 0.04), (sx * 0.02, 0, -0.26), (0, 0, -0.46)], [0.15, 0.16, 0.1], seg=6), C['pants'])  # baggy
        p.add(cone(0.1, 0.11, 0.17, seg=6), C['white'], M((0, 0, -0.62)))  # shin wraps
        p.add(cube(0.17, 0.3, 0.13), C['sky'], M((0, -0.05, -0.675)), tip=C['skyLight'], t=UP(-0.065, 0.065))  # glossy boot
        p.add(cone(0.085, 0.0, 0.12, seg=4), C['white'], M((0, -0.2, -0.68), (math.radians(-90), 0, math.radians(45)), (1, 0.7, 1)))
        legs[side] = (p, Vector((sx * 0.14, 0, HIP)))
    return legs


def build_body():
    p = Piece()
    p.add(cone(0.2, 0.23, 0.32, seg=8), C['leafDeep'], M((0, 0, -0.04)), tip=C['leaf'], t=UP(0, 0.32))  # tunic
    p.add(cone(0.23, 0.17, 0.32, seg=8), C['leaf'], M((0, 0, 0.28)), tip=C['lime'], t=UP(0, 0.32))  # chest to shoulders
    p.add(cone(0.215, 0.215, 0.08, seg=8), C['white'], M((0, 0, 0.02)))  # a white sash
    p.add(cone(0.06, 0.06, 0.03, seg=6), C['sky'], M((0, -0.205, 0.06), (math.pi / 2, 0, 0)))  # its glassy buckle
    # one big leaf flap hanging from the sash at the back
    p.add(leaf(0.5, 0.36, 0.15), C['leaf'], M((0, 0.2, 0.05), (math.radians(-80), 0, 0)), tip=C['tip'])
    # a fan of three big leaves on each shoulder, flaring up and back like wings: the silhouette from above
    for sx in (1, -1):
        for lift, back, length in ((25, 10, 0.5), (-5, 35, 0.6), (-35, 60, 0.45)):
            p.add(leaf(length, 0.28, 0.25), C['leaf'], M((sx * 0.15, 0.02, 0.58), (0, 0, -sx * math.radians(90 - back))) @ M(rot=(math.radians(lift), 0, 0)), tip=C['tip'])
    # the world detail: a scroll of leaf techniques strapped diagonally across his back
    axis = Vector((1, 0.15, 0.75))
    mid = Vector((0, 0.26, 0.36))
    p.add(cone(0.075, 0.075, 0.62, seg=6), C['white'], Matrix.Translation(mid - axis.normalized() * 0.31) @ aim(axis))
    for end in (-0.33, 0.3):
        p.add(cone(0.085, 0.085, 0.03, seg=6), C['sky'], Matrix.Translation(mid + axis.normalized() * end) @ aim(axis))
    p.add(ribbon([(0.17, -0.2, 0.62), (0.0, -0.215, 0.3), (-0.17, -0.2, 0.0)], [0.06] * 3, side=(0, 1, 0)), C['white'], M())  # strap
    return p, Vector((0, 0, HIP))


def build_head():
    p = Piece()
    p.add(ball(0.2, 1), C['void'], M((0, 0, 0.18), scale=(1, 0.95, 0.95)))  # the dark under the hat
    p.add(cone(0.215, 0.19, 0.15, seg=8), C['sky'], M((0, -0.01, -0.02)), tip=C['skyLight'], t=UP(0, 0.15))  # scarf as a mask
    # smug eyes: narrow and half-lidded, the left one squinting harder (a cocky smirk without a mouth)
    for ex, roll, h in ((-0.075, -0.32, 0.5), (0.08, 0.22, 0.75)):
        p.add(ball(0.07, 1), C['eye'], M((ex, -0.165, 0.18), (0, roll, 0), (1.2, 0.4, h)), glow=True)
    return p, Vector((0, 0, NECK))


def build_hat():
    """A low, wide kasa of one big leaf with a serrated edge, pulled down at the front; a short wizard tip swept back.
    Deep green at the crown, lime further out, lighting up to a pale blue at the edge."""
    p = Piece()
    bm = bmesh.new()
    n, R, H = 16, 0.6, 0.24
    apex, under = bm.verts.new((0, 0, H)), bm.verts.new((0, 0, H * 0.45))
    rim = [bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0))
           for a, r in ((2 * math.pi * i / n, R if i % 2 == 0 else R * 0.8) for i in range(n))]
    for i in range(n):
        bm.faces.new((apex, rim[i], rim[(i + 1) % n]))
    radial = lambda co: (co.xy.length / R) ** 1.3
    p.add(bm, [C['leafDeep'], C['leaf']] * 8, tip=C['lime'], t=radial)  # ribbed top
    bm = bmesh.new()
    under = bm.verts.new((0, 0, H * 0.45))
    rim = [bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0))
           for a, r in ((2 * math.pi * i / n, R if i % 2 == 0 else R * 0.8) for i in range(n))]
    for i in range(n):
        bm.faces.new((under, rim[(i + 1) % n], rim[i]))
    p.add(bm, C['hatUnder'], tip=C['leaf'], t=radial)  # the underside, dark round the face
    p.add(cone(0.11, 0.0, 0.34, seg=5), C['leafDeep'], M((0, 0.03, H - 0.03), (math.radians(-55), 0, 0)), tip=C['lime'], t=UP(0, 0.34))
    return p, Vector((0, 0, NECK + 0.3))


def build_scarf():
    """Two long scarf tails streaming out behind: the motion lines of the silhouette."""
    p = Piece()
    p.add(ribbon([(0.06, 0.18, 0.0), (0.12, 0.42, 0.04), (0.2, 0.66, -0.06), (0.26, 0.9, 0.02)], [0.2, 0.18, 0.15, 0.08], (1, 0, 0.3)), C['sky'], tip=C['skyLight'])
    p.add(ribbon([(-0.02, 0.18, -0.02), (0.0, 0.38, -0.12), (0.06, 0.58, -0.08), (0.1, 0.74, -0.18)], [0.17, 0.15, 0.12, 0.06], (1, 0, -0.2)), C['sky'], tip=C['white'])
    return p, Vector((0, 0, NECK))


def build_arms():
    arms = {}
    # left: up into a hand seal in front of his chest. right: low, holding the staff along his side
    shapes = {'L': ((0.06, -0.1, -0.27), (-0.19, -0.13, 0.13)), 'R': ((-0.1, 0.02, -0.27), (-0.03, -0.06, -0.24))}
    for side, sx in (('L', 1), ('R', -1)):
        upper, fore = (Vector(v) for v in shapes[side])
        elbow, hand = upper, upper + fore
        p = Piece()
        p.add(tube([(0, 0, 0), elbow, hand * 0.92 + elbow * 0.08], [0.075, 0.07, 0.065], seg=5), C['leaf'])
        p.add(tube([elbow + (hand - elbow) * 0.35, hand - (hand - elbow) * 0.1], [0.078, 0.073], seg=5), C['white'])  # wrapped forearm
        p.add(ball(0.07, 1), C['skin'], M(hand))
        if side == 'L':  # two fingers up: the seal
            p.add(cube(0.05, 0.04, 0.13), C['skin'], M(hand + Vector((0, -0.01, 0.09))))
        arms[side] = (p, Vector((sx * 0.22, 0, SHOULDER)), hand)
    return arms


def build_staff():
    """A straight wooden pole with a big glowing leaf blade for a head: half staff, half weapon. Held trailing behind."""
    p = Piece()
    d = Vector((-0.15, 0.75, 0.65)).normalized()  # bottom forward and down, blade up behind his shoulder
    p.add(tube([d * -0.55, d * 1.1], [0.032, 0.035], seg=5), C['wood'])
    p.add(cone(0.045, 0.045, 0.09, seg=5), C['sky'], Matrix.Translation(d * 1.02) @ aim(d))  # a cloth wrap
    p.add(leaf(0.55, 0.22, 0.18), C['lime'], Matrix.Translation(d * 1.08) @ aim(d) @ M(rot=(math.pi / 2, 0, 0)), tip=C['tip'], glow=True)
    return p


def build_wisps():
    """Three glowing leaves floating round the seal hand: his technique charging. Its own part, to spin in code."""
    p = Piece()
    for a, r, z in ((0.3, 0.2, 0.05), (2.4, 0.24, -0.04), (4.3, 0.18, 0.12)):
        p.add(leaf(0.24, 0.1, 0.25), C['lime'], M((math.cos(a) * r, math.sin(a) * r, z), (0.4, 0.3, a + math.pi)), tip=C['tip'], glow=True)
    return p


# ---------- into Blender ----------
def node_material(name, glow):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_backface_culling = False  # the leaves are single sheets
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = next((n for n in nt.nodes if n.type == 'VERTEX_COLOR'), None) or nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.32  # glossy, like a candy-coated toy
    bsdf.inputs['Coat Weight'].default_value = 0.6
    bsdf.inputs['Coat Roughness'].default_value = 0.08
    if glow:
        nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 0.9
    return mat


PIVOT = {}  # object -> its pivot in world space, for placing children


def to_object(coll, name, piece, pivot, mats, parent=None):
    """An object from a piece built around its pivot; pivot and parents are in world space, unrotated."""
    bm = piece.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for f in bm.faces:
        f.material_index = f[piece.glow]
        f.smooth = True
        for loop in f.loops:  # a soft shade from the bottom up, then linear for the colour attribute
            c = loop[piece.col]
            k = 1.0 if f[piece.glow] else 0.86 + 0.18 * min(1.0, max(0.0, (loop.vert.co.z + pivot.z) / 2.3))
            loop[piece.col] = (*lin([min(1.0, x * k) for x in c[:3]]), 1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    me.color_attributes.active_color = me.color_attributes['Col']
    for m in mats:
        me.materials.append(m)
    me.set_sharp_from_angle(angle=math.radians(40))  # chunky, faceted where it folds, soft where it's round
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.parent = parent
    ob.location = pivot - PIVOT.get(parent, Vector())
    PIVOT[ob] = pivot
    bm.free()
    return ob


def build():
    PIVOT.clear()
    old = bpy.data.collections.get('LeafWizard')
    if old:
        for ob in list(old.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    coll = bpy.data.collections.new('LeafWizard')
    bpy.context.scene.collection.children.link(coll)
    mat = [node_material('LeafWizard', False), node_material('LeafWizardGlow', True)]
    root = bpy.data.objects.new('LeafWizard', None)
    coll.objects.link(root)
    body = to_object(coll, 'body', *build_body(), mat, root)
    legs = {s: to_object(coll, 'leg_' + s, p, pv, mat, root) for s, (p, pv) in build_legs().items()}
    head = to_object(coll, 'head', *build_head(), mat, body)
    to_object(coll, 'hat', *build_hat(), mat, head)
    to_object(coll, 'scarf', *build_scarf(), mat, body)
    arms = {}
    for s, (p, pv, hand) in build_arms().items():
        arms[s] = to_object(coll, 'arm_' + s, p, pv, mat, body)
        if s == 'R':
            to_object(coll, 'staff', build_staff(), pv + hand, mat, arms[s])
        else:
            to_object(coll, 'wisps', build_wisps(), pv + hand, mat, arms[s])
    # the pose: a ready stance, leaning in, chin up and turned a little: smug
    legs['L'].rotation_euler = (math.radians(-12), math.radians(-15), 0)
    legs['R'].rotation_euler = (math.radians(12), math.radians(15), 0)
    body.rotation_euler = (math.radians(7), 0, math.radians(-8))
    head.rotation_euler = (math.radians(-12), 0, math.radians(14))
    return root


def tri_count():
    coll = bpy.data.collections['LeafWizard']
    return sum(len(p.vertices) - 2 for ob in coll.objects if ob.type == 'MESH' for p in ob.data.polygons)


def export(root, out):
    os.makedirs(out, exist_ok=True)
    for ob in bpy.context.selected_objects:
        ob.select_set(False)
    for ob in [root] + list(root.children_recursive):
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'leaf_wizard.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_cameras=False, export_lights=False)
    if not IN_UI:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'leaf_wizard.blend'))


def render_sheet(out):
    from PIL import Image, ImageDraw
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 48
    scn.render.resolution_x = scn.render.resolution_y = 520
    scn.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w')
    scn.world = world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin(rgb('#A9D2FA')), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(25)
    sun.rotation_euler = Euler((math.radians(40), 0, math.radians(-35)))
    scn.collection.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=3)
    ground = bpy.data.meshes.new('ground')
    bm.to_mesh(ground)
    gmat = bpy.data.materials.new('ground')
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(rgb('#8FBCE4')), 1)
    ground.materials.append(gmat)
    scn.collection.objects.link(bpy.data.objects.new('ground', ground))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 3.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    target = Vector((0, 0, 1.2))
    tiles = []
    for name, az, el in [('front', -90, 5), ('three-quarter', -55, 15), ('side', 0, 5), ('back', 90, 5), ('in game, from above', -90, 65)]:
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        cam.location = target + d * 8
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(out, '_view.png')
        bpy.ops.render.render(write_still=True)
        im = Image.open(scn.render.filepath).convert('RGB')
        ImageDraw.Draw(im).text((12, 10), name, fill=(235, 244, 255))
        tiles.append(im)
        os.remove(scn.render.filepath)
    sheet = Image.new('RGB', (520 * len(tiles), 520))
    for i, im in enumerate(tiles):
        sheet.paste(im, (520 * i, 0))
    ImageDraw.Draw(sheet).text((12, 500), f'Leaf Wizard - {tri_count()} triangles', fill=(235, 244, 255))
    sheet.save(os.path.join(out, 'leaf_wizard_sheet.png'))


if __name__ == '__main__':
    if not IN_UI:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    print('Leaf Wizard built:', tri_count(), 'triangles')
    out = out_dir()
    if out:
        export(root, out)
        if RENDERS:
            render_sheet(out)
        print('wrote', os.path.abspath(out))
