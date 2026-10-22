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
// a drag that the page doesn't take still looks around, and setLevel(k) (or a pinch, the wheel, Esc) changes view.
// Level 1 is the tilted view: the whole board from your side at TILT degrees, gentler than the angled view; it works
// like the strategic view (taps and drags go to the page, nothing to pan). Levels 2 and 3 are cinematic: angled, then
// close to the ground. In a cinematic view you can only look around: drag to move, twist (or right/middle drag, Q/E) to rotate, and a tap
// goes back to the strategic view.
// The tilted view sits on the other side of the strategic view from the cinematic ones: the gestures go
// Tilted <- Strategic -> Angled -> Ground.
//   Touch: spread two fingers to go in (angled, ground), pinch to come back out; pinching on from the strategic
//          view goes to the tilted one. The camera follows the fingers, then settles on the nearest level when they lift.
//   Mouse: the wheel steps a level in or out (scrolling back from the strategic view is the tilted one); a touchpad
//          pinch (ctrl + wheel) works like the fingers.
//
// focus(k, x, z): the battle cam. While the strategic or tilted view is up, k from 0 to 1 moves it closer, lower and onto the
// ground point (x, z), easing in and back out on its own.
//
// opts.onInput() on every pointer, wheel and key event and when the camera starts gliding to a level (setLevel too),
// and busy() while it moves on its own, so a page that only draws when something changes knows when to draw.
// zoom() is where the gestures are: -1 tilted, 0 strategic, 1 angled, 2 ground, fractional in between.
// dispose() when the page is done with it.
//
// The ground is the plane y = 0, the board is opts.width x opts.depth metres centred on the origin, and the player's
// own side is toward +z (the bottom of the screen in the strategic view).
const Camera3D = (THREE, camera, el, opts) => {
  const W = opts.width, D = opts.depth;
  const FOV = camera.fov;
  // the levels: pitch (degrees above the horizon) and distance from the point looked at (metres)
  const LEVELS = [null, null, { pitch: 20, dist: 70 }, { pitch: 20, dist: 24 }]; // strategic and tilted fit the board; // angled: low like the ground view, far back to see the enemy side
  const MAX = LEVELS.length - 1;
  const TAP_MOVE = 10, TAP_MS = 350;   // a touch that moves less than this many px and lifts this fast is a tap
  const PINCH_DEAD = Math.log(1.06);   // the fingers must spread or close by 6% before the view zooms
  const TWIST_DEAD = 10 * Math.PI / 180; // and twist by 10 degrees before it rotates
  const PINCH_PER_LEVEL = Math.log(2.1); // spreading the fingers 2.1x apart goes in one level
  const PAN_SPEED = 2;                 // a drag moves the view this many times as far as the finger
  const TILT = 52;                     // pitch of the tilted view (degrees above the horizon)
  const FOCUS = { pitch: 58, dist: 0.6 }; // the battle cam at full strength: at most this pitch, this much of the view's distance

  // zoom along the gestures: -1 tilted, 0 strategic, 1 angled, 2 ground (fractional while pinching or settling).
  // Levels outside (setLevel, level(), onLevel) keep their numbers: 0 strategic, 1 tilted, 2 angled, 3 ground.
  const ZMIN = -1, ZMAX = MAX - 1;
  const levelOf = (u) => u < 0 ? 1 : u === 0 ? 0 : u + 1, zOf = (k) => k === 1 ? -1 : k === 0 ? 0 : k - 1;
  let z = 0;
  let target = new THREE.Vector3(); // the point a cinematic view looks at (on the ground)
  let yaw = 0;                // rotation of a cinematic view around the vertical axis (radians, 0 = from your side)
  let settle = null;          // { from, to, t } while z glides to a level
  let aspect = 1, viewH = 1;
  let tilt = { pitch: TILT, dist: 100, tz: 0 }; // the tilted view: distance and look point that fit the board (fitTilted)
  const foc = { k: 0, x: 0, z: 0 }, focT = { k: 0, x: 0, z: 0 }; // the battle cam now, and where it's heading
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
  // the tilted view: the distance, and the look point (z) that centres the board on the screen, so all four
  // corners (and models standing on them) fit
  const probe = new THREE.PerspectiveCamera(FOV, 1, 1, 1000), corner = new THREE.Vector3();
  function fitTilted() {
    const p = TILT * Math.PI / 180;
    probe.aspect = aspect; probe.updateProjectionMatrix();
    const ext = (d, tz) => {
      probe.position.set(0, Math.sin(p) * d, tz + Math.cos(p) * d); probe.lookAt(0, 0, tz); probe.updateMatrixWorld();
      let x = 0, y0 = Infinity, y1 = -Infinity;
      for (const cx of [-W / 2, W / 2]) for (const cz of [-D / 2, D / 2]) for (const h of [0, 2.5]) {
        corner.set(cx, h, cz).project(probe);
        x = Math.max(x, Math.abs(corner.x)); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
      }
      return { x, y0, y1 };
    };
    const centre = (d) => { // the board's middle on the screen rises as the look point comes toward you
      let lo = -D, hi = D;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2, e = ext(d, mid); if (e.y0 + e.y1 > 0) hi = mid; else lo = mid; }
      return (lo + hi) / 2;
    };
    let lo = 10, hi = 600;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2, e = ext(d, centre(d));
      if (e.x <= 0.97 && (e.y1 - e.y0) / 2 <= 0.97) hi = d; else lo = d;
    }
    tilt = { pitch: TILT, dist: hi, tz: centre(hi) };
  }
  // pitch and distance for any zoom value, gliding between levels (distance on a log scale, so it feels even)
  function pose(zz) {
    // on a screen taller than the 12:16 board, the cinematic views step back so they still see as far to the sides
    const lv = (u) => u === 0 ? { pitch: 90, dist: strategicDist() } : u < 0 ? { pitch: tilt.pitch, dist: tilt.dist } : { pitch: LEVELS[u + 1].pitch, dist: LEVELS[u + 1].dist * Math.max(1, 0.75 / aspect) };
    const k = Math.max(ZMIN, Math.min(ZMAX - 1, Math.floor(zz))), f = zz - k, a = lv(k), b = lv(k + 1);
    return { pitch: a.pitch + (b.pitch - a.pitch) * f, dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * f) };
  }
  function apply() {
    let { pitch, dist } = pose(z);
    // strategic to tilted, the look point slides to the tilted one; from strategic in to angled, the look point and
    // the turn grow from the middle / no turn
    const w = Math.max(0, Math.min(1, z)), z0 = tilt.tz * Math.max(0, Math.min(1, -z)), yw = yaw * w;
    let tx = target.x * w, tz = z0 + (target.z - z0) * w;
    // the battle cam, on the strategic and tilted views only (it fades as the player goes in)
    const fk = foc.k * (1 - w);
    if (fk > 0) {
      pitch += (Math.min(pitch, FOCUS.pitch) - pitch) * fk; dist *= Math.pow(FOCUS.dist, fk);
      tx += (foc.x - tx) * fk; tz += (foc.z - tz) * fk;
    }
    const p = pitch * Math.PI / 180, h = Math.cos(p) * dist;
    camera.position.set(tx + Math.sin(yw) * h, Math.sin(p) * dist, tz + Math.cos(yw) * h);
    camera.up.set(-Math.sin(yw), 0, -Math.cos(yw)); // "up" on the screen points away from the camera, so straight down works too
    camera.lookAt(tx, 0, tz);
    camera.updateProjectionMatrix();
  }
  const level = () => levelOf(Math.round(z));
  const strategic = () => Math.abs(z) < 0.01 && !settle;
  // the views where taps, drags and hover go to the page: strategic, tilted, and angled while the player is placing
  const handsOn = () => strategic() || (!settle && (Math.abs(z + 1) < 0.01 || (Math.abs(z - 1) < 0.01 && !!(opts.placing && opts.placing()))));
  const cinematic = () => z > 0.01; // in from the strategic view: the look point and turn count
  function settleTo(to) {
    to = Math.max(ZMIN, Math.min(ZMAX, to));
    settle = { from: z, to, t: 0 };
    if (opts.onLevel) opts.onLevel(levelOf(to));
    woke();
  }
  // the nearest level when the fingers lift; it takes a fair push to leave the strategic view
  const nearest = () => Math.abs(z) < 0.35 ? 0 : z < 0 ? -1 : Math.min(ZMAX, Math.max(1, Math.round(z)));
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
  // a cinematic view, when it comes, looks at the ground under a screen point
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
    if (!cinematic()) aimAt(p.mx, p.my);
    if (Math.abs(z) < 0.01) z = 0;
    two = { d0: p.d, a0: p.ang, z0: z, yaw0: yaw, mx: p.mx, my: p.my, zooming: false, turning: false };
    tap = null;
  }
  el.addEventListener('pointerdown', (e) => {
    woke();
    if (e.pointerType === 'mouse' && e.button !== 0) {
      e.preventDefault();
      if (cinematic()) rotDrag = { x: e.clientX };
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
    if (pts.size === 1 && !tap && cinematic()) pan(dx, dy);
    if (pts.size === 2 && two) {
      const p = pair(), s = Math.log(p.d / two.d0), turn = Math.atan2(Math.sin(p.ang - two.a0), Math.cos(p.ang - two.a0));
      if (!two.zooming && Math.abs(s) > PINCH_DEAD) { two.zooming = true; two.sOff = Math.sign(s) * PINCH_DEAD; }
      if (!two.turning && Math.abs(turn) > TWIST_DEAD && z > 0.3) { two.turning = true; two.aOff = Math.sign(turn) * TWIST_DEAD; }
      if (two.zooming) z = Math.max(ZMIN, Math.min(ZMAX, two.z0 + (s - two.sOff) / PINCH_PER_LEVEL));
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
      if (!cinematic() && dy < 0) aimAt(e.clientX, e.clientY);
      z = Math.max(ZMIN, Math.min(ZMAX, z - dy * 0.012));
      clearTimeout(pinchIdle); pinchIdle = setTimeout(() => settleTo(nearest()), 220);
      return;
    }
    const now = performance.now();
    if (now < wheelBlock) return; // touchpads send a stream of small scrolls: one step per gesture
    wheelAcc += dy;
    if (Math.abs(wheelAcc) < 40) return;
    const to = Math.round(z) + (wheelAcc < 0 ? 1 : -1);
    wheelAcc = 0; wheelBlock = now + 260;
    if (to < ZMIN || to > ZMAX) return;
    if (!cinematic() && to === 1) aimAt(e.clientX, e.clientY);
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
      if (settle.t >= 1) { z = settle.to; settle = null; if (z <= 0) yaw = 0; }
    }
    if (foc.k !== focT.k) {
      foc.k += (focT.k - foc.k) * Math.min(1, dt * 3);
      if (Math.abs(foc.k - focT.k) < 0.002) foc.k = focT.k;
    }
    if (focT.k > 0) { foc.x = focT.x; foc.z = focT.z; }
    if (cinematic()) { if (keys.has('q')) yaw += dt * 1.6; if (keys.has('e')) yaw -= dt * 1.6; }
    apply();
  }
  // go to a level; into the angled view from the strategic or tilted one, it looks at your own half of the board
  function setLevel(k) {
    if (k > 1 && !cinematic()) { target.set(0, 0, D / 4); yaw = 0; }
    settleTo(zOf(k));
  }
  function resize(width, height) { aspect = width / height; viewH = height; camera.aspect = aspect; fitTilted(); apply(); }
  // the battle cam (see the top); x, z on the ground
  function focus(k, x = 0, zz = 0) {
    if (k > 0 && foc.k === 0) { foc.x = x; foc.z = zz; }
    focT.k = Math.max(0, Math.min(1, k)); focT.x = x; focT.z = zz;
  }

  // moving on its own (gliding to a level, a gesture under way, a rotate key held), so the page should keep drawing
  const busy = () => !!settle || !!two || !!rotDrag || keys.has('q') || keys.has('e') || foc.k !== focT.k;
  return { update, resize, groundAt, goStrategic, setLevel, strategic, handsOn, level, busy, dispose, zoom: () => z, LEVELS: MAX + 1, focus };
};
