"""Leaf Wizard: the low-poly model, built in Blender from this script (see docs/art-direction.md).

Run it with Blender's Python (Blender itself, or the `bpy` module from pip):
  blender -b -P tools/blender/leaf_wizard.py -- [--out DIR] [--renders]
  python3 tools/blender/leaf_wizard.py [--out DIR] [--renders]

It writes DIR/leaf_wizard.glb and DIR/leaf_wizard.blend (DIR defaults to models/), and with --renders also
DIR/leaf_wizard_sheet.png: front, side, back, three-quarter and top views.

The character: a shy forest gardener hiding under a hat of autumn leaves. Only two glowing eyes show in the dark of
the hat, glancing down and to the side. World detail: a little copper watering can on the belt.

Parts are separate objects with their pivots at the joints, for code animation in three.js: body (pivot at the hips),
head (neck), hat (top of the head), arm_L / arm_R (shoulders), leg_L / leg_R (hips), staff (in the right hand,
parented to arm_R), cape (shoulders). Colours are vertex colours on one shared material. +Y is up and the wizard
faces +Z in the GLB (Blender: faces -Y). About 2.6 units tall, feet at y = 0.
"""
import math
import os
import random
import sys

import bpy  # first: it makes bmesh and mathutils importable
import bmesh
from mathutils import Euler, Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = ARGS[ARGS.index('--out') + 1] if '--out' in ARGS else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models')
RENDERS = '--renders' in ARGS
random.seed(7)

# dusty, pastel-ish palette (art direction rule 4)
C = {
    'leaf': '#7F9A4F', 'leafDark': '#5C763C', 'leafLight': '#A8BE6C', 'olive': '#8C8A4A',
    'rust': '#B8653A', 'amber': '#D39A4C', 'ochre': '#C9AE62',
    'cream': '#E4D8BF', 'scarf': '#C46A3E', 'scarfDark': '#9E5233',
    'pants': '#4C4237', 'boot': '#6A4B34', 'bootCuff': '#8A6A4A', 'belt': '#5E4330',
    'skin': '#3A3036', 'void': '#17161B', 'eye': '#FFF0B0',
    'wood': '#6E5137', 'woodDark': '#4E3A29', 'orb': '#BFE3B4', 'copper': '#B07A4F', 'copperDark': '#7E5638',
}


def rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def lin(c):  # sRGB -> linear, for the colour attribute
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


# ---------- tiny mesh kit: every piece is a bmesh with a colour per face ----------
class Piece:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.faces.layers.int.new('col')  # index into COLS
        self.shade = self.bm.faces.layers.float.new('shade')  # baked darkening, 1 = none


COLS = []


def cidx(hexc):
    if hexc not in COLS:
        COLS.append(hexc)
    return COLS.index(hexc)


def add(piece, bm_src, color, mat=Matrix(), shade=1.0):
    """Copy bm_src into the piece, transformed by mat, painted color."""
    bm_src.transform(mat) if mat is not None else None
    vmap = {}
    for v in bm_src.verts:
        vmap[v] = piece.bm.verts.new(v.co)
    ci = cidx(color)
    for f in bm_src.faces:
        nf = piece.bm.faces.new([vmap[v] for v in f.verts])
        nf[piece.col] = ci
        nf[piece.shade] = shade
        nf.smooth = f.smooth
    bm_src.free()


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def cone(r1, r2, depth, seg=6, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
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


def leaf(length, width, fold=0.25, tip_curl=0.0):
    """A folded leaf blade along +Y: base at the origin, a raised midrib, 4 triangles each side (8 tris)."""
    bm = bmesh.new()
    rib = width * fold
    pts = [
        (0, 0, 0),
        (-width * 0.5, length * 0.35, 0), (0, length * 0.35, rib), (width * 0.5, length * 0.35, 0),
        (-width * 0.32, length * 0.72, tip_curl * 0.5), (0, length * 0.72, rib * 0.7 + tip_curl * 0.5), (width * 0.32, length * 0.72, tip_curl * 0.5),
        (0, length, tip_curl),
    ]
    v = [bm.verts.new(p) for p in pts]
    for a, b, c in [(0, 2, 1), (0, 3, 2), (1, 2, 5), (1, 5, 4), (2, 3, 6), (2, 6, 5), (4, 5, 7), (5, 6, 7)]:
        bm.faces.new((v[a], v[b], v[c]))
    return bm


def maple(size):
    """A flat 5-point maple leaf (a fan of triangles), lying in XY, stem at the origin."""
    bm = bmesh.new()
    c = bm.verts.new((0, size * 0.35, size * 0.06))
    ring = []
    for i, a in enumerate([-100, -70, -45, -20, 0, 20, 45, 70, 100]):
        r = size * (1.0 if i % 2 == 0 else 0.55) * (0.7 if abs(a) == 100 else 1)
        t = math.radians(a)
        ring.append(bm.verts.new((math.sin(t) * r, size * 0.35 + math.cos(t) * r, 0)))
    stem = bm.verts.new((0, 0, 0))
    ring = [stem] + ring
    for i in range(len(ring)):
        bm.faces.new((c, ring[i], ring[(i + 1) % len(ring)]))
    return bm


def tube(points, radii, seg=5):
    """A bent tube through points (a branch, a scarf tail)."""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(points):
        p = Vector(p)
        d = (Vector(points[min(i + 1, len(points) - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
        q = d.to_track_quat('Z', 'Y')
        ring = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            ring.append(bm.verts.new(p + q @ Vector((math.cos(a) * radii[i], math.sin(a) * radii[i], 0))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for s in range(seg):
            bm.faces.new((r0[s], r0[(s + 1) % seg], r1[(s + 1) % seg], r1[s]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return bm


# ---------- the parts ----------
# Blender axes: +Z up, the wizard faces -Y, his right hand is -X.
HIP = 0.78
SHOULDER = 1.42
NECK = 1.58


def build_legs():
    legs = {}
    for side, sx in (('L', 1), ('R', -1)):
        p = Piece()
        x = sx * 0.17
        # baggy pants: wide at the knee, tucked into the boot
        add(p, tube([(0, 0, 0), (sx * 0.02, 0, -0.3), (0, 0, -0.52)], [0.15, 0.17, 0.11], seg=6), C['pants'])
        add(p, cone(0.13, 0.135, 0.12, seg=6), C['bootCuff'], M((0, 0, -0.62)))  # boot cuff
        add(p, cube(0.24, 0.36, 0.16), C['boot'], M((0, -0.07, -0.70)))  # chunky boot
        add(p, cube(0.2, 0.1, 0.1), C['boot'], M((0, -0.25, -0.73), (0.35, 0, 0)), shade=0.92)  # toe
        legs[side] = (p, Vector((x, 0.02, HIP)))
    return legs


def build_body():
    p = Piece()
    # cream inner robe, a long skirt that flares out over the pants
    add(p, cone(0.36, 0.22, 0.42, seg=8), C['cream'], M((0, 0, -0.35)))
    add(p, cone(0.22, 0.2, 0.72, seg=8), C['cream'], M((0, 0, 0.0)))
    # green tabard panels front and back, ending in a leaf point
    for y, turn in ((-1, math.pi), (1, 0)):  # hanging down, the hem flaring out a little
        add(p, leaf(0.95, 0.38, fold=0.12), C['leaf'], M((0, y * 0.215, 0.6), (math.radians(-82), 0, turn)), shade=0.95)
    # belt, buckle and a seed pouch
    add(p, cone(0.235, 0.225, 0.08, seg=8), C['belt'], M((0, 0, 0.06)))
    add(p, cube(0.09, 0.03, 0.08), C['ochre'], M((0, -0.235, 0.1)))
    add(p, cube(0.11, 0.08, 0.12), C['belt'], M((-0.2, -0.12, 0.0), (0, 0, 0.5)), shade=0.9)
    # the world detail: a little copper watering can hanging on his left hip
    can = Vector((0.26, -0.04, -0.06))
    add(p, cone(0.075, 0.065, 0.14, seg=6), C['copper'], M(can))
    add(p, cone(0.035, 0.012, 0.16, seg=4), C['copperDark'], M(can + Vector((0, -0.07, 0.04)), (math.radians(-60), 0, 0)))
    add(p, cone(0.03, 0.03, 0.025, seg=6), C['copperDark'], M(can + Vector((0, -0.16, 0.12)), (math.radians(-60), 0, 0)))  # the rose
    add(p, tube([can + Vector((0, 0.05, 0.12)), can + Vector((0, 0.07, 0.2)), can + Vector((0, -0.03, 0.2)), can + Vector((0, -0.05, 0.12))], [0.012] * 4, seg=3), C['copperDark'])
    add(p, tube([can + Vector((0, 0, 0.14)), Vector((0.22, 0, 0.1))], [0.01, 0.01], seg=3), C['belt'])  # the cord
    return p, Vector((0, 0, HIP))


def build_cape():
    """A collar of leaves around the shoulders, hanging down the back like a cape (green with autumn turns)."""
    p = Piece()
    palette = [C['leaf'], C['leafDark'], C['leafLight'], C['olive'], C['rust'], C['amber']]
    n = 11
    for i in range(n):
        a = math.pi / 2 + math.pi * 0.8 * (2 * i / (n - 1) - 1)  # all round except the front (+Y is the back)
        back = math.sin(a)  # 1 at the back
        length = 0.4 + 0.5 * max(0, back) ** 0.7 + random.uniform(-0.04, 0.04)
        col = palette[i % len(palette)] if i % 3 else C['leaf']
        tilt = math.radians(-66 - 12 * max(0, back))  # hang down, flaring outwards, straighter at the back
        mat = M((math.cos(a) * 0.2, math.sin(a) * 0.17, 0.02), (0, 0, a - math.pi / 2)) @ M(rot=(tilt, 0, 0))
        add(p, leaf(length, 0.24 + 0.06 * (i % 2), fold=0.18, tip_curl=-0.05), col, mat)
    # two shoulder leaves sticking out sideways, the silhouette's wings (seen from above)
    for sx in (1, -1):
        add(p, leaf(0.5, 0.2, fold=0.2, tip_curl=0.06), C['leafLight'], M((sx * 0.22, 0.05, 0.0), (0, 0, -sx * math.pi / 2)) @ M(rot=(math.radians(-25), 0, 0)))
    return p, Vector((0, 0, SHOULDER))


def build_arms():
    arms = {}
    for side, sx in (('L', 1), ('R', -1)):
        p = Piece()
        down = Vector((sx * 0.35, -0.04, -0.62)).normalized()  # a relaxed A-pose
        q = down.to_track_quat('Z', 'Y')
        rot = q.to_euler()
        add(p, cone(0.085, 0.13, 0.42, seg=6), C['cream'], Matrix.Translation((0, 0, 0)) @ rot.to_matrix().to_4x4())  # wide sleeve
        add(p, cone(0.135, 0.14, 0.07, seg=6), C['leafDark'], Matrix.Translation(down * 0.38) @ rot.to_matrix().to_4x4())  # cuff
        hand = down * 0.53
        add(p, ball(0.075, 1), C['skin'], M(hand, scale=(1, 0.9, 1.15)))
        add(p, cube(0.04, 0.05, 0.08), C['skin'], M(hand + Vector((0, -0.07, 0.01)), (0.4, 0, 0)))  # thumb
        arms[side] = (p, Vector((sx * 0.21, 0, SHOULDER)), hand)
    return arms


def build_head():
    p = Piece()
    # the dark of the hood: a squashed ball that the hat sits over
    add(p, ball(0.2, 1), C['void'], M((0, 0, 0.17), scale=(1, 0.95, 0.92)))
    # scarf: a thick ring round the neck and a tail flapping out behind
    add(p, tube([(math.cos(a) * 0.17, math.sin(a) * 0.15, 0.02 + 0.015 * math.sin(a * 2)) for a in [i * math.pi / 4 for i in range(9)]], [0.06] * 9, seg=4), C['scarf'])
    add(p, tube([(0.08, 0.13, 0.02), (0.16, 0.3, -0.08), (0.12, 0.45, -0.24), (0.2, 0.55, -0.36)], [0.055, 0.05, 0.045, 0.03], seg=4), C['scarfDark'])
    add(p, tube([(0.13, -0.08, 0.0), (0.16, -0.14, -0.14), (0.12, -0.16, -0.3)], [0.05, 0.045, 0.03], seg=4), C['scarf'], shade=0.92)
    # shy eyes: tall pale ovals, low under the brim and glancing to his left
    for ex in (-0.07, 0.08):
        add(p, ball(0.055, 1), C['eye'], M((ex + 0.02, -0.165, 0.11), (0.15, 0.25, 0), (0.8, 0.45, 1.35)))
    return p, Vector((0, 0, NECK))


def build_hat():
    p = Piece()
    seg = 8
    # wide floppy brim, drooping at the front so the face stays in shadow
    add(p, cone(0.48, 0.24, 0.12, seg=seg), C['leafDark'], M((0, -0.02, 0.0), (0.12, 0, 0)))
    # the crown: two stacked cones, the top one bent back
    add(p, cone(0.25, 0.14, 0.32, seg=seg), C['leaf'], M((0, 0.0, 0.1), (-0.08, 0, 0)))
    add(p, cone(0.145, 0.0, 0.42, seg=seg), C['leaf'], M((0, 0.05, 0.4), (-0.45, 0, 0.15)))
    # leaf shingles over the brim and crown
    palette = [C['leaf'], C['leafLight'], C['olive'], C['amber'], C['rust'], C['leafDark']]
    for i in range(9):
        a = 2 * math.pi * i / 9 + 0.2
        col = palette[i % len(palette)]
        add(p, leaf(0.36, 0.22, fold=0.15, tip_curl=-0.04), col, M((math.cos(a) * 0.22, math.sin(a) * 0.22 - 0.02, 0.15), (0, 0, a - math.pi / 2)) @ M(rot=(math.radians(-25), 0, 0)))
    # two maple leaves pinned to the crown, and a sprout at the tip
    add(p, maple(0.17), C['rust'], M((0.12, -0.14, 0.3), (math.radians(70), 0.4, 0.5)))
    add(p, maple(0.13), C['amber'], M((-0.15, -0.1, 0.36), (math.radians(80), -0.3, -0.6)))
    tip = Vector((0, 0.05, 0.4)) + Euler((-0.45, 0, 0.15)).to_matrix() @ Vector((0, 0, 0.42))
    add(p, leaf(0.2, 0.12, fold=0.2), C['leafLight'], M(tip, (math.radians(60), 0, 0.6)))
    add(p, leaf(0.16, 0.1, fold=0.2), C['leafLight'], M(tip, (math.radians(50), 0, -2.4)))
    return p, Vector((0, 0, NECK + 0.27))


def build_staff(hand_world):
    """A crooked branch with a forked top cradling a pale orb with a leaf in it."""
    p = Piece()
    pts = [(0, 0, -0.92), (0.02, 0, -0.2), (-0.01, 0.01, 0.3), (0.02, -0.01, 0.75), (0.0, 0.0, 1.0)]
    add(p, tube(pts, [0.03, 0.035, 0.035, 0.04, 0.045], seg=5), C['wood'])
    for sx in (1, -1):  # the fork
        add(p, tube([(0, 0, 0.98), (sx * 0.1, 0, 1.1), (sx * 0.08, 0, 1.25), (sx * 0.03, 0, 1.3)], [0.035, 0.03, 0.022, 0.012], seg=4), C['woodDark'])
    add(p, ball(0.09, 1), C['orb'], M((0, 0, 1.17)))
    add(p, leaf(0.09, 0.06, fold=0.25), C['leaf'], M((0, -0.02, 1.13), (0, 0, 0.3)), shade=0.9)
    add(p, leaf(0.18, 0.1, fold=0.2), C['leafLight'], M((0.02, 0, 0.7), (0, math.radians(70), 0.4)))  # a leaf growing on the shaft
    for z in (0.45, 0.52):  # a wrap of scarf cloth where he holds it
        add(p, cone(0.05, 0.05, 0.05, seg=5), C['scarf'], M((0.0, 0, z)))
    return p, hand_world


# ---------- into Blender ----------
def make_material():
    mat = bpy.data.materials.new('LeafWizard')
    mat.use_backface_culling = False  # the leaves are single sheets
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    return mat


def to_object(name, piece, pivot, mat, parent=None):
    """Make an object from a piece built around its pivot (piece coordinates are relative to the pivot)."""
    bm = piece.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.faces.ensure_lookup_table()
    # colours per face corner: the face colour, darker towards the bottom (painted gradient) with a little grain
    layer = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    zs = [v.co.z + pivot.z for v in me.vertices]
    for poly in me.polygons:
        f = bm.faces[poly.index]
        base = rgb(COLS[f[piece.col]])
        grain = random.uniform(-0.035, 0.035)
        for li in poly.loop_indices:
            z = zs[me.loops[li].vertex_index]
            k = (0.78 + 0.3 * min(1.0, max(0.0, z / 2.4)) + grain) * f[piece.shade]
            c = [min(1.0, x * k) for x in base] if COLS[f[piece.col]] not in (C['eye'], C['orb']) else base
            layer.data[li].color = (*lin(c), 1.0)
    me.color_attributes.active_color = layer
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(40))  # chunky, faceted where it folds, soft where it's round
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
        ob.location = pivot - parent.matrix_world.translation
    else:
        ob.location = pivot
    bm.free()
    bpy.context.view_layer.update()
    return ob


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = make_material()
    root = bpy.data.objects.new('LeafWizard', None)
    bpy.context.scene.collection.objects.link(root)
    body = to_object('body', *build_body(), mat, root)
    for side, (p, pivot) in build_legs().items():
        to_object('leg_' + side, p, pivot, mat, root)
    to_object('cape', *build_cape(), mat, body)
    head = to_object('head', *build_head(), mat, body)
    to_object('hat', *build_hat(), mat, head)
    arms = build_arms()
    arm_objs = {}
    for side, (p, pivot, hand) in arms.items():
        arm_objs[side] = (to_object('arm_' + side, p, pivot, mat, body), pivot + hand)
    arm_r, hand_r = arm_objs['R']
    to_object('staff', *build_staff(hand_r), mat, arm_r)
    return root


def tri_count():
    n = 0
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n


def export(root):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'leaf_wizard.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'leaf_wizard.glb'), export_format='GLB', export_yup=True,
                              export_apply=False, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                              export_animations=False, export_cameras=False, export_lights=False)


def render_sheet():
    from PIL import Image, ImageDraw
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 48
    scn.cycles.use_denoising = True
    scn.render.resolution_x = scn.render.resolution_y = 520
    scn.render.film_transparent = False
    scn.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w')
    scn.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*lin(rgb('#9FB4C8')), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(25)
    sun.rotation_euler = Euler((math.radians(40), 0, math.radians(-35)))
    scn.collection.objects.link(sun)
    ground = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=3)
    bm.to_mesh(ground)
    gob = bpy.data.objects.new('ground', ground)
    gmat = bpy.data.materials.new('ground')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(rgb('#B7C2A0')), 1)
    ground.materials.append(gmat)
    scn.collection.objects.link(gob)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 3.3
    scn.collection.objects.link(cam)
    scn.camera = cam
    target = Vector((0, 0, 1.3))
    views = [('front', -90, 5), ('three-quarter', -55, 15), ('side', 0, 5), ('back', 90, 5), ('top (in game)', -90, 65)]
    tiles = []
    for name, az, el in views:
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        cam.location = target + d * 8
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(OUT, '_view.png')
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        im = Image.open(path).convert('RGB')
        ImageDraw.Draw(im).text((12, 10), name, fill=(40, 48, 56))
        tiles.append(im)
        os.remove(path)
    sheet = Image.new('RGB', (520 * len(tiles), 520))
    for i, im in enumerate(tiles):
        sheet.paste(im, (520 * i, 0))
    ImageDraw.Draw(sheet).text((12, 500), f'Leaf Wizard - {tri_count()} triangles', fill=(40, 48, 56))
    sheet.save(os.path.join(OUT, 'leaf_wizard_sheet.png'))


if __name__ == '__main__':
    root = build()
    print('triangles:', tri_count())
    export(root)
    if RENDERS:
        render_sheet()
    print('wrote', os.path.abspath(OUT))
