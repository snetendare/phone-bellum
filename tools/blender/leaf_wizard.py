"""Leaf Wizard: the low-poly model, built in Blender from this script (see docs/art-direction.md).

In the Blender you have open: Scripting tab > Open > this file > Run Script. It builds the wizard into a
"LeafWizard" collection in the open .blend (running it again replaces that collection, nothing else is touched),
and if the .blend is saved it also exports leaf_wizard.glb next to it.

From a terminal (Blender, or the `bpy` module from pip):
  blender -b -P tools/blender/leaf_wizard.py -- [--out DIR] [--renders]
  python3 tools/blender/leaf_wizard.py [--out DIR] [--renders]
writes DIR/leaf_wizard.glb and .blend (DIR defaults to models/), and with --renders DIR/leaf_wizard_sheet.png.

v3, the character: a wiry old hedge wizard who is far too excited about the fight. Emotion: giddy. He bounces
forward on his bare tiptoes, hunched, eyes wide, grinning, eyebrows up, one arm thrust out with a twig wand and
the other cocked back with a leaf ready to flick. His beard, eyebrows and moustache are leaves, and so is the
cape down his back: the stream of sharp leaves he shoots is plucked from himself, and it always grows back.
The emotion explains the mechanics: he's nimble and quick because he can't stand still.
World detail: a garden snail riding on his hat brim, the slowest thing on the battlefield, along for the ride.
Silhouette: a tall floppy hat drooping backwards and a long nose and wand pointing forwards, so from above he
reads as an arrow pointing where he's going. The robe is a warm dusty tan so the green leaves pop.

Parts are separate objects with their pivots at the joints, for code animation in three.js: body (pivot at the
hips), head (neck), hat (top of the head, the snail rides on it), arm_L / arm_R (shoulders), leg_L / leg_R (hips),
wand (in the right hand, parented to arm_R), throw_leaf (in the left hand, parented to arm_L, hide it while it
flies). The pose is in the parts' rotations, so code can start from it. Colours are vertex colours on one shared
material. +Y is up and he faces +Z in the GLB (Blender: faces -Y). About 2.4 units tall, feet at y = 0.
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


# dusty, pastel-ish palette (art direction rule 4): warm robe, cool-ish greens
C = {
    'leaf': '#7F9A4F', 'leafDark': '#5E7840', 'leafLight': '#A3BA68', 'leafPale': '#BCC98A',
    'robe': '#C09C6C', 'robeDark': '#9A7A55', 'sash': '#5C4A3A', 'pants': '#5E5247',
    'skin': '#D4B08E', 'skinDark': '#B38E70', 'mouth': '#4A2C2A', 'white': '#F1E8D4', 'pupil': '#2B2523',
    'wood': '#6B4E36', 'bud': '#F1CF97',
    'shell': '#C9935F', 'shellDark': '#9C6B45', 'snail': '#CEC3A4',
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


def R(x=0, y=0, z=0):
    """Rotation in degrees."""
    return (math.radians(x), math.radians(y), math.radians(z))


def aim(v, up='Y'):
    """A rotation matrix turning +Z along v."""
    return Vector(v).normalized().to_track_quat('Z', up).to_matrix().to_4x4()


def at(loc, v):
    """Placed at loc with +Z turned along v."""
    return Matrix.Translation(Vector(loc)) @ aim(v)


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


def tube(points, radii, seg=5, caps=True):
    """A bent tube through points (limbs, the wand, the hat)."""
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
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def leaf(length, width, fold=0.25):
    """A folded leaf blade along +Y, base at the origin, the midrib raised along +Z (4 triangles)."""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in [(0, 0, 0), (-width / 2, length * 0.4, 0), (0, length * 0.45, width * fold),
                                   (width / 2, length * 0.4, 0), (0, length, 0)]]
    for a, b, c in [(0, 2, 1), (0, 3, 2), (1, 2, 4), (2, 3, 4)]:
        bm.faces.new((v[a], v[b], v[c]))
    return bm


def hang(loc, direction, out, length, width, fold=0.25):
    """A leaf from loc along direction, its raised midrib facing out."""
    d = Vector(direction).normalized()
    o = Vector(out)
    o = (o - d * o.dot(d)).normalized()
    side = d.cross(o)
    rot = Matrix((side, d, o)).transposed().to_4x4()  # leaf x -> side, y -> direction, z -> out
    return leaf(length, width, fold), Matrix.Translation(Vector(loc)) @ rot


# ---------- the parts ----------
# Blender axes: +Z up, he faces -Y, his right hand is -X. Pivots in world space; part geometry is relative to them.
HIP = 0.66
SHOULDER = 1.13
NECK = 1.17
HEAD_TOP = 1.52


def build_legs():
    legs = {}
    for side, sx in (('L', 1), ('R', -1)):
        p = Piece()
        knee = Vector((0, -0.07, -0.3))
        ankle = Vector((0, 0.02, -0.6))
        p.add(tube([(0, 0, 0.05), knee], [0.095, 0.075], seg=6), C['pants'])  # short baggy trousers
        p.add(tube([knee + Vector((0, 0, 0.04)), ankle], [0.05, 0.042], seg=5), C['skin'])  # skinny bare shins
        p.add(ball(0.06, 1), C['skin'], M(knee, scale=(1, 1, 0.8)))  # knobbly knee
        # long bare foot, toes curled up: nimble
        p.add(cube(0.13, 0.26, 0.06), C['skin'], M(ankle + Vector((sx * 0.01, -0.08, -0.03))))
        p.add(cone(0.06, 0.02, 0.14, seg=5), C['skinDark'], at(ankle + Vector((sx * 0.01, -0.2, -0.03)), (0, -1, 0.5)))
        legs[side] = (p, Vector((sx * 0.1, 0, HIP)))
    return legs


def add_leaf(p, color, loc, direction, out, length, width, fold=0.25):
    bm, mat = hang(loc, direction, out, length, width, fold)
    p.add(bm, color, mat)


def build_body():
    p = Piece()
    p.add(cone(0.29, 0.16, 0.38, seg=8), [C['robe'], C['robeDark']] * 4 + [C['robe']] * 2, M((0, 0, -0.34)))
    p.add(cone(0.16, 0.2, 0.3, seg=8), C['robe'], M((0, 0.01, 0.04)))
    p.add(cone(0.2, 0.11, 0.16, seg=8), C['robe'], M((0, 0.02, 0.34)))
    p.add(cone(0.175, 0.175, 0.07, seg=8), C['sash'], M((0, 0, 0.02)))  # a rope sash
    p.add(cone(0.035, 0.02, 0.26, seg=4), C['sash'], at((0.13, -0.12, 0.02), (0.2, -0.3, -1)))  # its loose end
    # the leaf cape down his back: two layers, fanned, tips out behind (part of the arrow from above)
    for i, x in enumerate((-0.16, -0.08, 0.0, 0.08, 0.16)):
        add_leaf(p, (C['leaf'], C['leafDark'])[i % 2], (x, 0.15, 0.46), (x * 1.8, 0.45, -1), (0, 1, 0.2), 0.52, 0.2)
    for i, x in enumerate((-0.2, -0.07, 0.07, 0.2)):
        add_leaf(p, (C['leafLight'], C['leaf'])[i % 2], (x, 0.2, 0.08), (x * 1.2, 1.0, -0.8), (0, 1, 0.5), 0.48, 0.21)
    return p, Vector((0, 0, HIP))


def build_head():
    p = Piece()
    p.add(ball(0.18, 2), C['skin'], M((0, -0.01, 0.17), scale=(1, 0.95, 1.05)))
    # a long pointy nose, the front of the arrow
    p.add(cone(0.055, 0.008, 0.24, seg=5), C['skinDark'], at((0, -0.15, 0.17), (0, -1, -0.45)))
    # pointy ears sticking out sideways
    for sx in (1, -1):
        p.add(cone(0.045, 0.0, 0.14, seg=4), C['skin'], at((sx * 0.16, 0.0, 0.2), (sx, 0.35, 0.45)))
    # wide eyes, one pupil a little bigger: giddy, a bit unhinged
    for sx, pr in ((1, 0.03), (-1, 0.024)):
        p.add(ball(0.068, 1), C['white'], M((sx * 0.075, -0.145, 0.245), scale=(1, 0.55, 1.2)))
        p.add(ball(pr, 1), C['pupil'], M((sx * 0.068, -0.185, 0.262)))
        # eyebrows: leaves shooting up and out
        add_leaf(p, C['leafLight'], (sx * 0.03, -0.17, 0.315), (sx * 1, -0.3, 0.6), (0, -1, 0.3), 0.22, 0.09)
    # a big open grin
    p.add(ball(0.07, 1), C['mouth'], M((0, -0.15, 0.08), R(0, 6, 0), (1.85, 0.5, 0.75)))
    p.add(cube(0.17, 0.03, 0.03), C['white'], M((0, -0.19, 0.105), R(0, 6, 0)))  # top teeth
    # moustache: two leaves swept up at the ends
    for sx in (1, -1):
        add_leaf(p, C['leaf'], (sx * 0.02, -0.18, 0.115), (sx * 1, -0.25, 0.25), (0, -1, 0.2), 0.2, 0.08)
    # the beard: a bush of leaves hanging from the jaw down over his chest
    for i, (a, ln) in enumerate(((-60, 0.3), (-35, 0.4), (-12, 0.46), (12, 0.46), (35, 0.4), (60, 0.3), (0, 0.38))):
        r = math.radians(a)
        base = Vector((math.sin(r) * 0.13, -math.cos(r) * 0.12, 0.04 if a else 0.0))
        d = Vector((math.sin(r) * 0.35, -0.55, -1))
        col = (C['leaf'], C['leafDark'], C['leafLight'])[i % 3]
        add_leaf(p, col, base, d, (math.sin(r), -math.cos(r), 0.2), ln, 0.17)
    return p, Vector((0, 0, NECK))


def build_hat():
    """A tall floppy wizard hat of rolled leaves, drooping backwards, with a wavy brim and a sprout at the tip."""
    p = Piece()
    bm = bmesh.new()
    n, rad = 12, 0.4
    apex, under = bm.verts.new((0, 0, 0.08)), bm.verts.new((0, 0, 0.03))
    rim = [bm.verts.new((math.cos(a) * rad * (1 if i % 2 == 0 else 0.86),
                         math.sin(a) * rad * (1 if i % 2 == 0 else 0.86) - 0.03,
                         -0.035 * math.sin(a) + (0.015 if i % 2 else 0)))
           for i, a in enumerate(2 * math.pi * i / n for i in range(n))]
    for i in range(n):
        bm.faces.new((apex, rim[i], rim[(i + 1) % n]))
    for i in range(n):
        bm.faces.new((under, rim[(i + 1) % n], rim[i]))
    p.add(bm, [C['leaf'], C['leafLight']] * (n // 2) + [C['leafDark']] * n)
    # the crown: tall, bending back and flopping over
    pts = [(0, 0.0, 0.0), (0.0, 0.02, 0.2), (0.02, 0.07, 0.4), (0.06, 0.17, 0.56), (0.12, 0.31, 0.63), (0.17, 0.43, 0.59), (0.19, 0.5, 0.49)]
    p.add(tube(pts, [0.17, 0.14, 0.105, 0.075, 0.05, 0.03, 0.012], seg=6),
          [C['leaf'], C['leafLight'], C['leafDark']] * 14)
    p.add(tube([(0, 0, 0.02), (0, 0.004, 0.08)], [0.172, 0.16], seg=6), C['sash'])  # a band of twine
    # a sprout at the floppy tip
    add_leaf(p, C['leafPale'], (0.19, 0.5, 0.49), (0.6, 0.3, 0.3), (0, 0, 1), 0.15, 0.08)
    add_leaf(p, C['leafLight'], (0.19, 0.5, 0.49), (-0.6, 0.4, 0.1), (0, 0, 1), 0.12, 0.07)
    # the world detail: a garden snail riding on the brim, front left
    s = Vector((0.2, -0.26, -0.02))
    p.add(tube([s + Vector((-0.07, -0.05, 0.02)), s + Vector((0.0, 0.0, 0.025)), s + Vector((0.07, 0.04, 0.02))],
               [0.035, 0.04, 0.02], seg=5), C['snail'])
    p.add(ball(0.09, 1), [C['shell'], C['shellDark']] * 10, M(s + Vector((0.01, 0.02, 0.1)), R(0, 0, -35), (0.65, 1, 1)))
    p.add(ball(0.045, 1), C['shellDark'], M(s + Vector((-0.045, 0.0, 0.105)), R(0, 0, -35), (0.5, 1, 1)))  # the spiral's eye
    for dx in (-0.015, 0.015):  # eye stalks, looking at the enemy too
        p.add(cone(0.011, 0.007, 0.1, seg=3), C['snail'], at(s + Vector((-0.07 + dx, -0.05, 0.03)), (dx * 8, -0.6, 1)))
    return p, Vector((0, 0, HEAD_TOP))


def build_arms():
    arms = {}
    # right: thrust out forward with the wand. left: cocked back by his ear, a leaf between the fingers
    shapes = {'R': ((-0.05, -0.17, -0.14), (0.01, -0.24, 0.07)), 'L': ((0.14, 0.08, -0.13), (-0.02, 0.0, 0.3))}
    for side, sx in (('L', 1), ('R', -1)):
        upper, fore = (Vector(v) for v in shapes[side])
        elbow, hand = upper, upper + fore
        p = Piece()
        p.add(tube([(0, 0, 0), elbow], [0.06, 0.055], seg=5), C['robe'])
        p.add(tube([elbow, hand], [0.04, 0.035], seg=5), C['skin'])  # skinny forearm
        p.add(cone(0.06, 0.12, 0.2, seg=6), C['robeDark'], at(elbow - fore.normalized() * 0.04, fore))  # bell sleeve
        p.add(ball(0.055, 1), C['skin'], M(hand))
        arms[side] = (p, Vector((sx * 0.19, 0, SHOULDER)), hand)
    return arms


def build_wand():
    """A crooked twig with a bud of soft light at the tip, pointed where the leaves will go."""
    p = Piece()
    pts = [(0, 0.06, -0.06), (0, -0.0, 0.0), (0.02, -0.16, 0.13), (-0.02, -0.3, 0.22), (0.01, -0.44, 0.34)]
    p.add(tube(pts, [0.02, 0.022, 0.018, 0.014, 0.01], seg=4), C['wood'])
    p.add(ball(0.05, 1), C['bud'], M((0.01, -0.46, 0.36)))
    add_leaf(p, C['leafLight'], (0.02, -0.16, 0.13), (1, -0.2, 0.6), (0, -1, 0.3), 0.1, 0.06)
    return p


def build_throw_leaf():
    p = Piece()
    add_leaf(p, C['leafPale'], (0, -0.03, 0.03), (0.1, -1, 0.6), (0, 0.3, 1), 0.32, 0.13)
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
            k = 1.0 if hexc in (C['white'], C['bud'], C['pupil']) else 0.8 + 0.28 * min(1.0, max(0.0, z / 2.3))
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
    hat = to_object(coll, 'hat', *build_hat(), mat, head)
    hat.rotation_euler = R(-12, 4, 0)  # tipped back off his face
    arms = {}
    for s, (p, pv, hand) in build_arms().items():
        arms[s] = to_object(coll, 'arm_' + s, p, pv, mat, body)
        if s == 'R':
            to_object(coll, 'wand', build_wand(), pv + hand, mat, arms[s])
        else:
            to_object(coll, 'throw_leaf', build_throw_leaf(), pv + hand, mat, arms[s])
    # the pose: bouncing forward on his toes, hunched, head up, cocked to one side: giddy
    legs['L'].rotation_euler = R(-14, 0, 4)
    legs['R'].rotation_euler = R(18, 0, -6)
    body.rotation_euler = R(16, 0, 6)
    head.rotation_euler = R(-14, 10, -8)
    # stand him on the ground: lift so the lowest point is at z = 0
    bpy.context.view_layer.update()
    low = min((ob.matrix_world @ v.co).z for ob in coll.objects if ob.type == 'MESH' for v in ob.data.vertices)
    root.location.z = -low
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
