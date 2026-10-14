/**
 * Camera solver — targets instead of hand-tuned numbers.
 *
 * Extends the rig's camera model (rig.ts): a plane at depth d under a camera
 * with no tilt / yaw maps a rest point p to
 *
 *   screen = centre + ((p − centre)·(1 + d) − (x, y)) · zoom / (1 + d − dolly)
 *
 * so the camera that frames a rect is solved in closed form:
 *
 *   fitTarget      auto framing of one element or a group (union) at a fill
 *                  fraction of the frame — dolly first, the lens zoom only for
 *                  what the dolly may not do without coming too close
 *   lookAtTargets  smooth look-at over a list of timed targets: the camera
 *                  follows each new target with an eased lag (no cut, no jump)
 *   clampBounds    camera bounds: the visible window never leaves the world
 *                  (e.g. the background plane), the dolly stays inside limits
 *   blurHint       velocity-aware motion-blur hint (direction + amount) from
 *                  the camera's on-screen speed
 *   focusHandoff   blends two framings with a rack of the focus plane
 *
 * Pure and deterministic; every function works on fractions of the canvas or
 * canvas px and returns plain CameraState objects.
 */
import { curve } from '../motion/easing';
import { NEAR, REST, mixCamera, type CameraState } from './rig';

/** A rect as fractions of the canvas (x, y = top-left). */
export interface FracRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitOptions {
  W: number;
  H: number;
  /** Depth plane of the target (default hero plane 0). */
  depth?: number;
  /** Fraction of the frame the target fills along its limiting axis (default 0.62). */
  fill?: number;
  /** Planes that must keep their clearance (default: the target plane only). */
  protect?: number[];
  /** Minimum clearance kept above NEAR (default 0.12). */
  margin?: number;
  /** Max lens zoom used when the dolly is capped (default 1.6). */
  maxZoom?: number;
  /** Where on screen the target centre sits (fraction, default centre). */
  anchor?: { x: number; y: number };
}

/** Bounding rect of a group of rects (fractions). */
export function unionRect(rects: FracRect[]): FracRect {
  if (!rects.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Camera that frames a rect (or a group: pass several) on its plane. */
export function fitTarget(target: FracRect | FracRect[], o: FitOptions): CameraState {
  const r = Array.isArray(target) ? unionRect(target) : target;
  const { W, H } = o;
  const d = o.depth ?? 0;
  const fill = o.fill ?? 0.62;
  const anchor = o.anchor ?? { x: 0.5, y: 0.5 };
  const rw = Math.max(1, r.w * W);
  const rh = Math.max(1, r.h * H);
  // wanted on-screen scale of the target plane
  const s = fill * Math.min(W / rw, H / rh);
  // dolly that gives that scale with the lens at 1: (1+d)/(1+d−dolly) = s
  const minClear = NEAR + (o.margin ?? 0.12);
  let dolly = (1 + d) * (1 - 1 / s);
  for (const p of o.protect ?? [d]) dolly = Math.min(dolly, 1 + p - minClear);
  const k = (1 + d) / (1 + d - dolly);
  const zoom = Math.min(o.maxZoom ?? 1.6, Math.max(1, s / k));
  const scale = k * zoom;
  // put the target centre at the anchor: screen = c + (X − x)·k·zoom/(1+d) … solve x, y (physical px)
  const X = (r.x + r.w / 2 - 0.5) * W * (1 + d);
  const Y = (r.y + r.h / 2 - 0.5) * H * (1 + d);
  const x = X - ((anchor.x - 0.5) * W * (1 + d)) / scale;
  const y = Y - ((anchor.y - 0.5) * H * (1 + d)) / scale;
  return { ...REST, x: r4(x), y: r4(y), dolly: r4(dolly), zoom: r4(zoom), focus: d };
}

export interface LookTarget {
  /** Scene-local seconds the camera starts turning to this target. */
  t: number;
  rect: FracRect | FracRect[];
  depth?: number;
  fill?: number;
}

/**
 * Smooth look-at: the camera holds each target and, when the next one is due, follows it over `lag`
 * seconds on an eased curve (velocity zero at both ends, so consecutive moves chain without a jump).
 */
export function lookAtTargets(targets: LookTarget[], t: number, o: FitOptions & { lag?: number; ease?: string }): CameraState {
  const list = [...targets].sort((a, b) => a.t - b.t);
  if (!list.length) return { ...REST };
  const lag = Math.max(0.1, o.lag ?? 0.8);
  const ease = curve(o.ease ?? 'camera-dolly');
  const cams = list.map((k) => fitTarget(k.rect, { ...o, depth: k.depth ?? o.depth, fill: k.fill ?? o.fill }));
  let cam = cams[0];
  for (let i = 1; i < list.length; i++) {
    if (t <= list[i].t) break;
    const u = Math.min(1, (t - list[i].t) / lag);
    cam = mixCamera(cam, cams[i], ease(u));
  }
  return cam;
}

/** Camera bounds: limits of the dolly and a world rect (rest px on plane `depth`) the visible window must stay in. */
export interface CameraBounds {
  /** World rect (fractions of the canvas, may extend beyond 0..1) on the bounds plane. */
  world?: FracRect;
  /** Plane of the world rect (default background 0.7). */
  depth?: number;
  minDolly?: number;
  maxDolly?: number;
  maxZoom?: number;
}

/** Keeps a camera inside its bounds (the visible window on the bounds plane never leaves the world rect). */
export function clampBounds(c: CameraState, b: CameraBounds, W: number, H: number): CameraState {
  let dolly = c.dolly;
  if (b.minDolly !== undefined) dolly = Math.max(b.minDolly, dolly);
  if (b.maxDolly !== undefined) dolly = Math.min(b.maxDolly, dolly);
  const zoom = b.maxZoom !== undefined ? Math.min(b.maxZoom, c.zoom) : c.zoom;
  let { x, y } = c;
  if (b.world) {
    const d = b.depth ?? 0.7;
    const clear = Math.max(NEAR, 1 + d - dolly);
    // visible half-extent on the plane in rest px: (W/2)·clear/(zoom·(1+d))
    const hw = ((W / 2) * clear) / (zoom * (1 + d));
    const hh = ((H / 2) * clear) / (zoom * (1 + d));
    // camera x / y are physical px: the visible centre on the plane is centre + x/(1+d)
    const lim = (v: number, lo: number, hi: number, half: number) => (hi - lo < 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v)));
    const wx0 = (b.world.x - 0.5) * W;
    const wy0 = (b.world.y - 0.5) * H;
    const cx = lim(x / (1 + d), wx0, wx0 + b.world.w * W, hw);
    const cy = lim(y / (1 + d), wy0, wy0 + b.world.h * H, hh);
    x = cx * (1 + d);
    y = cy * (1 + d);
  }
  return { ...c, x, y, dolly, zoom };
}

export interface BlurHint {
  /** On-screen velocity of the hero-plane centre (px per frame). */
  vx: number;
  vy: number;
  /** Relative scale change per frame (dolly / zoom). */
  vs: number;
  /** Suggested directional blur (px, along x / y) — 0 when the camera is slow enough to stay sharp. */
  bx: number;
  by: number;
  /** Suggested radial (zoom) blur strength 0..1. */
  radial: number;
}

/** Velocity-aware blur hint from two camera states one frame apart (shutter 180°: half the travel). */
export function blurHint(prev: CameraState, cur: CameraState, u: number): BlurHint {
  const k0 = prev.zoom / Math.max(NEAR, 1 - prev.dolly);
  const k1 = cur.zoom / Math.max(NEAR, 1 - cur.dolly);
  const vx = -(cur.x * k1 - prev.x * k0);
  const vy = -(cur.y * k1 - prev.y * k0);
  const vs = k1 / k0 - 1;
  // below ~0.35 u per frame motion reads as sharp; above, half the travel (shutter 180°), capped
  const thr = 0.35 * u;
  const cap = 3 * u;
  const b = (v: number) => (Math.abs(v) < thr ? 0 : Math.min(cap, (Math.abs(v) - thr) * 0.5));
  return { vx: r4(vx), vy: r4(vy), vs: r4(vs), bx: r4(b(vx)), by: r4(b(vy)), radial: r4(Math.min(1, Math.abs(vs) * 12)) };
}

/** Focus handoff: travel from framing A to framing B while the focus plane racks from A's plane to B's. */
export function focusHandoff(a: CameraState, b: CameraState, u: number, aperture = 0.6): CameraState {
  const e = curve('camera-dolly')(Math.min(1, Math.max(0, u)));
  const cam = mixCamera(a, b, e);
  // depth of field peaks mid-handoff: the eye is led from one plane to the other
  return { ...cam, aperture: Math.max(cam.aperture, aperture * Math.sin(Math.PI * e)) };
}
