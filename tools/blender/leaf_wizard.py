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
(hips), staff (in the right hand, parented to arm_R). The pose is in the parts' rotations, so code can start from
it. Colours are vertex colours on one shared material. +Y is up and he faces +Z in the GLB (Blender: faces -Y).
About 2.4 units tall, feet at y = 0.
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


# dusty, pastel-ish palette (art direction rule 4)
C = {
    'leaf': '#7F9A4F', 'leafDark': '#566F38', 'leafLight': '#A3BA68', 'hatUnder': '#3B4A2A',
    'scarf': '#C0643C', 'scarfDark': '#97492C',
    'pants': '#4A4536', 'wrap': '#DCCFB2', 'boot': '#4B3A2C', 'belt': '#3F3428',
    'skin': '#33292E', 'void': '#141318', 'eye': '#FFEFA8',
    'wood': '#5E4430', 'scroll': '#E2D3B0',
}


def rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def lin(c):  # sRGB -> linear, for the colour attribute
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------- tiny mesh kit: every piece is a bmesh with a colour per face ----------
COLS = []


class Piece:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.faces.layers.int.new('col')  # index into COLS

    def add(self, src, color, mat=None):
        """Copy the bmesh src into the piece, transformed by mat. color: one colour, or a list cycled per face."""
        if mat is not None:
            src.transform(mat)
        vmap = {v: self.bm.verts.new(v.co) for v in src.verts}
        colors = color if isinstance(color, list) else [color]
        for i, f in enumerate(src.faces):
            nf = self.bm.faces.new([vmap[v] for v in f.verts])
            c = colors[i % len(colors)]
            if c not in COLS:
                COLS.append(c)
            nf[self.col] = COLS.index(c)
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
    """A big folded leaf blade along +Y, base at the origin, the midrib raised along +Z (6 triangles)."""
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


def build_legs():
    legs = {}
    for side, sx in (('L', 1), ('R', -1)):
        p = Piece()
        p.add(tube([(0, 0, 0.04), (sx * 0.02, 0, -0.26), (0, 0, -0.46)], [0.15, 0.16, 0.1], seg=6), C['pants'])  # baggy
        p.add(cone(0.1, 0.11, 0.17, seg=6), C['wrap'], M((0, 0, -0.62)))  # shin wraps
        p.add(cube(0.17, 0.3, 0.13), C['boot'], M((0, -0.05, -0.675)))  # split-toe ninja boot
        p.add(cone(0.085, 0.0, 0.12, seg=4), C['boot'], M((0, -0.2, -0.68), (math.radians(-90), 0, math.radians(45)), (1, 0.7, 1)))
        legs[side] = (p, Vector((sx * 0.14, 0, HIP)))
    return legs


def build_body():
    p = Piece()
    p.add(cone(0.2, 0.23, 0.32, seg=8), C['leaf'], M((0, 0, -0.04)))  # tunic, wrapped round the waist
    p.add(cone(0.23, 0.17, 0.32, seg=8), C['leaf'], M((0, 0, 0.28)))  # chest to shoulders
    p.add(cone(0.215, 0.215, 0.08, seg=8), C['belt'], M((0, 0, 0.02)))  # a dark sash
    # one big leaf flap hanging from the sash at the back
    p.add(leaf(0.46, 0.34, 0.15), C['leafDark'], M((0, 0.2, 0.05), (math.radians(-80), 0, 0)))
    # big leaf pauldrons: from above, they make the shoulders read wide and sharp
    for sx in (1, -1):
        p.add(leaf(0.36, 0.26, 0.25), C['leafLight'], M((sx * 0.15, 0, 0.6), (0, 0, -sx * math.pi / 2)) @ M(rot=(math.radians(-30), 0, 0)))
    # the world detail: a scroll of leaf techniques strapped diagonally across his back
    axis = Vector((1, 0.15, 0.75))
    mid = Vector((0, 0.26, 0.36))
    p.add(cone(0.075, 0.075, 0.62, seg=6), C['scroll'], Matrix.Translation(mid - axis.normalized() * 0.31) @ aim(axis))
    for end in (-0.33, 0.3):
        p.add(cone(0.085, 0.085, 0.03, seg=6), C['scarfDark'], Matrix.Translation(mid + axis.normalized() * end) @ aim(axis))
    p.add(ribbon([(0.17, -0.2, 0.62), (0.0, -0.215, 0.3), (-0.17, -0.2, 0.0)], [0.06] * 3, side=(0, 1, 0)), C['belt'], M())  # strap
    return p, Vector((0, 0, HIP))


def build_head():
    p = Piece()
    p.add(ball(0.2, 1), C['void'], M((0, 0, 0.18), scale=(1, 0.95, 0.95)))  # the dark under the hat
    p.add(cone(0.215, 0.19, 0.15, seg=8), C['scarf'], M((0, -0.01, -0.02)))  # scarf pulled up as a mask
    # smug eyes: narrow and half-lidded, the left one squinting harder (a cocky smirk without a mouth)
    for ex, roll, h in ((-0.075, -0.32, 0.5), (0.08, 0.22, 0.75)):
        p.add(ball(0.07, 1), C['eye'], M((ex, -0.165, 0.18), (0, roll, 0), (1.2, 0.4, h)))
    return p, Vector((0, 0, NECK))


def build_hat():
    """A low, wide kasa of one big leaf with a serrated edge, pulled down at the front; a short wizard tip swept back."""
    p = Piece()
    bm = bmesh.new()
    n, R, H = 16, 0.6, 0.24
    apex, under = bm.verts.new((0, 0, H)), bm.verts.new((0, 0, H * 0.45))
    rim = [bm.verts.new((math.cos(a) * r, math.sin(a) * r, 0))
           for a, r in ((2 * math.pi * i / n, R if i % 2 == 0 else R * 0.8) for i in range(n))]
    for i in range(n):
        bm.faces.new((apex, rim[i], rim[(i + 1) % n]))
    for i in range(n):
        bm.faces.new((under, rim[(i + 1) % n], rim[i]))
    p.add(bm, [C['leaf'], C['leafLight']] * 8 + [C['hatUnder']] * 16)  # ribbed top, dark underside
    p.add(cone(0.11, 0.0, 0.34, seg=5), C['leafDark'], M((0, 0.03, H - 0.03), (math.radians(-55), 0, 0)))  # the tip
    return p, Vector((0, 0, NECK + 0.3))


def build_scarf():
    """Two long scarf tails streaming out behind: the motion lines of the silhouette."""
    p = Piece()
    p.add(ribbon([(0.06, 0.18, 0.0), (0.12, 0.42, 0.04), (0.2, 0.66, -0.06), (0.26, 0.9, 0.02)], [0.2, 0.18, 0.15, 0.08], (1, 0, 0.3)), C['scarf'])
    p.add(ribbon([(-0.02, 0.18, -0.02), (0.0, 0.38, -0.12), (0.06, 0.58, -0.08), (0.1, 0.74, -0.18)], [0.17, 0.15, 0.12, 0.06], (1, 0, -0.2)), C['scarfDark'])
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
        p.add(tube([elbow + (hand - elbow) * 0.35, hand - (hand - elbow) * 0.1], [0.075, 0.07], seg=5), C['wrap'])  # wrapped forearm
        p.add(ball(0.07, 1), C['skin'], M(hand))
        if side == 'L':  # two fingers up: the seal
            p.add(cube(0.05, 0.04, 0.13), C['skin'], M(hand + Vector((0, -0.01, 0.09))))
        arms[side] = (p, Vector((sx * 0.22, 0, SHOULDER)), hand)
    return arms


def build_staff():
    """A straight wooden pole with a big leaf blade for a head: half staff, half weapon. Held trailing behind him."""
    p = Piece()
    d = Vector((-0.15, 0.75, 0.65)).normalized()  # bottom forward and down, blade up behind his shoulder
    p.add(tube([d * -0.55, d * 1.1], [0.032, 0.035], seg=5), C['wood'])
    p.add(cone(0.045, 0.045, 0.09, seg=5), C['scarf'], Matrix.Translation(d * 1.02) @ aim(d))  # a cloth wrap
    p.add(leaf(0.5, 0.2, 0.18), C['leafLight'], Matrix.Translation(d * 1.08) @ aim(d) @ M(rot=(math.pi / 2, 0, 0)))
    return p


# ---------- into Blender ----------
def material():
    mat = bpy.data.materials.get('LeafWizard') or bpy.data.materials.new('LeafWizard')
    mat.use_backface_culling = False  # the leaves are single sheets
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = next((n for n in nt.nodes if n.type == 'VERTEX_COLOR'), None) or nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    return mat


PIVOT = {}  # object -> its pivot in world space, for placing children


def to_object(coll, name, piece, pivot, mat, parent=None):
    """An object from a piece built around its pivot; pivot and parents are in world space, unrotated."""
    bm = piece.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    # one colour per face, darker towards the bottom (painted gradient, art direction rule 5)
    layer = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        hexc = COLS[bm.faces[poly.index][piece.col]]
        base = rgb(hexc)
        for li in poly.loop_indices:
            z = me.vertices[me.loops[li].vertex_index].co.z + pivot.z
            k = 1.0 if hexc == C['eye'] else 0.8 + 0.28 * min(1.0, max(0.0, z / 2.3))
            layer.data[li].color = (*lin([min(1.0, x * k) for x in base]), 1.0)
    me.color_attributes.active_color = layer
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(40))  # chunky, faceted where it folds, soft where it's round
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.parent = parent
    ob.location = pivot - PIVOT.get(parent, Vector())
    PIVOT[ob] = pivot
    bm.free()
    return ob


def build():
    COLS.clear()
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
    mat = material()
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
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin(rgb('#9FB4C8')), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(25)
    sun.rotation_euler = Euler((math.radians(40), 0, math.radians(-35)))
    scn.collection.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=3)
    ground = bpy.data.meshes.new('ground')
    bm.to_mesh(ground)
    gmat = bpy.data.materials.new('ground')
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(rgb('#B7C2A0')), 1)
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
        ImageDraw.Draw(im).text((12, 10), name, fill=(40, 48, 56))
        tiles.append(im)
        os.remove(scn.render.filepath)
    sheet = Image.new('RGB', (520 * len(tiles), 520))
    for i, im in enumerate(tiles):
        sheet.paste(im, (520 * i, 0))
    ImageDraw.Draw(sheet).text((12, 500), f'Leaf Wizard - {tri_count()} triangles', fill=(40, 48, 56))
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
