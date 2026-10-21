// ===== 3D camera and its controls (used by the 3D test page; meant for the 3D renderer later) =====
// Camera3D(THREE, camera, el, opts) drives a THREE.PerspectiveCamera over the board from pointer, wheel and key input
// on the element el.
//
// Views: level 0 is the strategic view, straight down at the whole board (taps there go to opts.onTap as a ground
// point, so the game can place squads). There the page can also take a one-finger drag for itself (to move a squad):
// opts.onPress(point) on the press returns true to take it, then opts.onDrag(point) as it moves and opts.onDrop(point)
// when it lifts (null when a second finger or a cancel ends it); a short press still counts as a tap after the drop.
// onTap and onPress also get the screen point (clientX, clientY), and groundAt(clientX, clientY, h) finds where it
// meets a level h metres above the ground (to pick what stands there).
// A mouse moving over the strategic view with no button down goes to opts.onHover(point), null when it leaves.
// While opts.placing() is true (the player is deploying), the angled view takes taps, drags and hover the same way;
// a drag that the page doesn't take still looks around, and setLevel(k) (or a pinch, the wheel, Esc) changes view. Levels 1 and 2 are cinematic: angled, then close to the ground. In a
// cinematic view you can only look around: drag to move, twist (or right/middle drag, Q/E) to rotate, and a tap
// goes back to the strategic view.
//   Touch: spread two fingers to go in, pinch to come back out. The camera follows the fingers, then settles on
//          the nearest level when they lift.
//   Mouse: the wheel steps a level in or out; a touchpad pinch (ctrl + wheel) works like the fingers.
//
// opts.onInput() on every pointer, wheel and key event and when the camera starts gliding to a level (setLevel too),
// and busy() while it moves on its own, so a page that only draws when something changes knows when to draw.
// dispose() when the page is done with it.
//
// The ground is the plane y = 0, the board is opts.width x opts.depth metres centred on the origin, and the player's
// own side is toward +z (the bottom of the screen in the strategic view).
const Camera3D = (THREE, camera, el, opts) => {
  const W = opts.width, D = opts.depth;
  const FOV = camera.fov;
  // cinematic levels: pitch (degrees above the horizon) and distance from the point looked at (metres)
  const LEVELS = [null, { pitch: 20, dist: 70 }, { pitch: 20, dist: 24 }]; // angled: low like the ground view, far back to see the enemy side
  const MAX = LEVELS.length - 1;
  const TAP_MOVE = 10, TAP_MS = 350;   // a touch that moves less than this many px and lifts this fast is a tap
  const PINCH_DEAD = Math.log(1.06);   // the fingers must spread or close by 6% before the view zooms
  const TWIST_DEAD = 10 * Math.PI / 180; // and twist by 10 degrees before it rotates
  const PINCH_PER_LEVEL = Math.log(2.1); // spreading the fingers 2.1x apart goes in one level
  const PAN_SPEED = 2;                 // a drag moves the view this many times as far as the finger

  let z = 0;                  // zoom: 0 strategic .. MAX, fractional while pinching or settling
  let target = new THREE.Vector3(); // the point a cinematic view looks at (on the ground)
  let yaw = 0;                // rotation of a cinematic view around the vertical axis (radians, 0 = from your side)
  let settle = null;          // { from, to, t } while z glides to a level
  let aspect = 1, viewH = 1;
  const woke = () => { if (opts.onInput) opts.onInput(); };
  const clampTarget = () => {
    target.x = Math.max(-W / 2 - 4, Math.min(W / 2 + 4, target.x));
    target.z = Math.max(-D / 2 - 4, Math.min(D / 2 + 4, target.z));
  };
  // the strategic view: straight down from high enough to fit the whole board
  const strategicDist = () => {
    const tan = Math.tan(FOV * Math.PI / 360);
    return Math.max(D / 2 / tan, W / 2 / (tan * aspect)) * 1.03;
  };
  // pitch and distance for any zoom value, gliding between levels (distance on a log scale, so it feels even)
  function pose(zz) {
    const lv = (k) => k === 0 ? { pitch: 90, dist: strategicDist() } : LEVELS[k];
    const k = Math.min(MAX - 1, Math.floor(zz)), f = zz - k, a = lv(k), b = lv(k + 1);
    return { pitch: a.pitch + (b.pitch - a.pitch) * f, dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * f) };
  }
  function apply() {
    const { pitch, dist } = pose(z);
    // going in from the strategic view, the look point and the turn grow from the board centre / no turn
    const w = Math.min(1, z), tx = target.x * w, tz = target.z * w, yw = yaw * w;
    const p = pitch * Math.PI / 180, h = Math.cos(p) * dist;
    camera.position.set(tx + Math.sin(yw) * h, Math.sin(p) * dist, tz + Math.cos(yw) * h);
    camera.up.set(-Math.sin(yw), 0, -Math.cos(yw)); // "up" on the screen points away from the camera, so straight down works too
    camera.lookAt(tx, 0, tz);
    camera.updateProjectionMatrix();
  }
  const level = () => Math.round(z);
  const strategic = () => z < 0.01 && !settle;
  // the views where taps, drags and hover go to the page: strategic, and angled while the player is placing
  const handsOn = () => strategic() || (!settle && Math.abs(z - 1) < 0.01 && !!(opts.placing && opts.placing()));
  function settleTo(to) {
    to = Math.max(0, Math.min(MAX, to));
    settle = { from: z, to, t: 0 };
    if (opts.onLevel) opts.onLevel(to);
    woke();
  }
  // the nearest level when the fingers lift; it takes a fair push to leave the strategic view
  const nearest = () => z < 0.35 ? 0 : Math.max(1, Math.min(MAX, Math.round(z)));
  function goStrategic() { settleTo(0); }

  // the point on the ground under a screen point (null if it's above the horizon)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // the point under a screen point on the ground, or (h metres) on a level that high above it
  const level_ = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(cx, cy, h = 0) {
    const r = el.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!h) return ray.ray.intersectPlane(ground, hit);
    level_.constant = -h;
    const p = ray.ray.intersectPlane(level_, hit);
    if (p) p.y = 0;
    return p;
  }
  // enter a cinematic view looking at the ground under a screen point
  function aimAt(cx, cy) {
    const g = groundAt(cx, cy);
    if (g) { target.set(g.x, 0, g.z); clampTarget(); }
    yaw = 0;
  }
  // move the look point so the ground follows a drag of dx, dy px
  function pan(dx, dy) {
    const { pitch, dist } = pose(z), k = PAN_SPEED * 2 * dist * Math.tan(FOV * Math.PI / 360) / viewH;
    const s = Math.sin(pitch * Math.PI / 180);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    target.x += -rx * dx * k + fx * dy * k / s;
    target.z += -rz * dx * k + fz * dy * k / s;
    clampTarget();
  }

  // ---------- pointers: one finger or the left button pans or taps, two fingers pinch and twist ----------
  const pts = new Map();      // pointerId -> { x, y }
  let tap = null;             // a press that may still turn out to be a tap
  let two = null;             // the two-finger gesture under way
  let rotDrag = null;         // a right / middle button drag that rotates
  let grab = null;            // pointerId of a one-finger drag the page took (opts.onPress)
  function dropGrab(p) { if (grab == null) return; grab = null; if (opts.onDrop) opts.onDrop(p); }
  const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  function startTwo() {
    const p = pair();
    settle = null;
    dropGrab(null);
    if (z < 0.01) { aimAt(p.mx, p.my); z = 0; }
    two = { d0: p.d, a0: p.ang, z0: z, yaw0: yaw, mx: p.mx, my: p.my, zooming: false, turning: false };
    tap = null;
  }
  el.addEventListener('pointerdown', (e) => {
    woke();
    if (e.pointerType === 'mouse' && e.button !== 0) {
      e.preventDefault();
      if (!strategic()) rotDrag = { x: e.clientX };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    if (pts.size === 1) {
      tap = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      if (handsOn() && opts.onPress && opts.onPress(groundAt(e.clientX, e.clientY), e.clientX, e.clientY)) grab = e.pointerId;
    }
    else if (pts.size === 2) startTwo();
  });
  el.addEventListener('pointermove', (e) => {
    woke();
    if (rotDrag) { yaw -= (e.clientX - rotDrag.x) * 0.008; rotDrag.x = e.clientX; return; }
    const p0 = pts.get(e.pointerId);
    if (!p0) { if (e.pointerType === 'mouse' && !e.buttons && handsOn() && opts.onHover) opts.onHover(groundAt(e.clientX, e.clientY)); return; }
    const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
    p0.x = e.clientX; p0.y = e.clientY;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_MOVE) tap = null;
    if (grab === e.pointerId) { if (opts.onDrag) opts.onDrag(groundAt(e.clientX, e.clientY)); return; }
    if (pts.size === 1 && !tap && z > 0.01) pan(dx, dy);
    if (pts.size === 2 && two) {
      const p = pair(), s = Math.log(p.d / two.d0), turn = Math.atan2(Math.sin(p.ang - two.a0), Math.cos(p.ang - two.a0));
      if (!two.zooming && Math.abs(s) > PINCH_DEAD) { two.zooming = true; two.sOff = Math.sign(s) * PINCH_DEAD; }
      if (!two.turning && Math.abs(turn) > TWIST_DEAD && z > 0.3) { two.turning = true; two.aOff = Math.sign(turn) * TWIST_DEAD; }
      if (two.zooming) z = Math.max(0, Math.min(MAX, two.z0 + (s - two.sOff) / PINCH_PER_LEVEL));
      if (two.turning) yaw = two.yaw0 + (turn - two.aOff); // the view turns the way the fingers twist
      if (z > 0.3) pan(p.mx - two.mx, p.my - two.my); // the two fingers moving together drag the view too
      two.mx = p.mx; two.my = p.my;
    }
  });
  function lift(e) {
    woke();
    if (rotDrag && e.pointerType === 'mouse' && e.button !== 0) { rotDrag = null; return; }
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (grab === e.pointerId) dropGrab(e.type === 'pointerup' ? groundAt(e.clientX, e.clientY) : null);
    if (tap && tap.id === e.pointerId && e.type === 'pointerup' && performance.now() - tap.t < TAP_MS) {
      if (handsOn()) { if (opts.onTap) opts.onTap(groundAt(e.clientX, e.clientY), e.clientX, e.clientY); }
      else goStrategic();
    }
    tap = null;
    if (two && pts.size < 2) { two = null; settleTo(nearest()); }
  }
  el.addEventListener('pointerup', lift);
  el.addEventListener('pointercancel', lift);
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && opts.onHover) opts.onHover(null); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- wheel: a notch steps a level (toward the pointer from the strategic view); ctrl + wheel is a touchpad pinch ----------
  let wheelAcc = 0, wheelBlock = 0, pinchIdle = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); woke();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (e.ctrlKey) { // touchpad pinch
      settle = null;
      if (z < 0.01 && dy < 0) aimAt(e.clientX, e.clientY);
      z = Math.max(0, Math.min(MAX, z - dy * 0.012));
      clearTimeout(pinchIdle); pinchIdle = setTimeout(() => settleTo(nearest()), 220);
      return;
    }
    const now = performance.now();
    if (now < wheelBlock) return; // touchpads send a stream of small scrolls: one step per gesture
    wheelAcc += dy;
    if (Math.abs(wheelAcc) < 40) return;
    const to = level() + (wheelAcc < 0 ? 1 : -1);
    wheelAcc = 0; wheelBlock = now + 260;
    if (to < 0 || to > MAX) return;
    if (z < 0.01 && to === 1) aimAt(e.clientX, e.clientY);
    settleTo(to);
  }, { passive: false });

  // ---------- keys: Q / E rotate, Escape goes back to the strategic view ----------
  const keys = new Set();
  const keyDown = (e) => { woke(); keys.add(e.key.toLowerCase()); if (e.key === 'Escape') goStrategic(); };
  const keyUp = (e) => keys.delete(e.key.toLowerCase());
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  // the page is done with this camera: let go of the window's keys (the element's listeners go with the element)
  function dispose() { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); keys.clear(); }

  function update(dt) {
    if (settle) {
      settle.t = Math.min(1, settle.t + dt / 0.3);
      const e = 1 - Math.pow(1 - settle.t, 3); // ease out
      z = settle.from + (settle.to - settle.from) * e;
      if (settle.t >= 1) { z = settle.to; settle = null; if (z === 0) yaw = 0; }
    }
    if (!strategic()) { if (keys.has('q')) yaw += dt * 1.6; if (keys.has('e')) yaw -= dt * 1.6; }
    apply();
  }
  // go to a level; into the angled view from the strategic one, it looks at your own half of the board
  function setLevel(k) {
    if (k > 0 && z < 0.01) { target.set(0, 0, D / 4); yaw = 0; }
    settleTo(k);
  }
  function resize(width, height) { aspect = width / height; viewH = height; camera.aspect = aspect; apply(); }

  // moving on its own (gliding to a level, a gesture under way, a rotate key held), so the page should keep drawing
  const busy = () => !!settle || !!two || !!rotDrag || keys.has('q') || keys.has('e');
  return { update, resize, groundAt, goStrategic, setLevel, strategic, handsOn, level, busy, dispose, zoom: () => z, LEVELS: MAX + 1 };
};
