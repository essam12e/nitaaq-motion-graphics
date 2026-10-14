/**
 * Cinematic Camera Engine 2.0 — the camera model.
 *
 * A real 2.5D camera over depth planes, using the same maths as CSS 3D so the
 * QC/framing solver predicts exactly what the browser draws:
 *
 *   layer   authored at its rest size on a plane at depth d (fraction of the
 *           perspective distance D; hero plane d = 0, background d > 0,
 *           foreground d < 0). CSS: translateZ(−d·D) scale(1 + d) — at rest the
 *           layer looks exactly as authored, so layouts never change.
 *   camera  world transform translateZ(dolly·D) rotateX(tilt) rotateY(yaw)
 *           translate(−x, −y) then lens zoom and roll on the frame.
 *
 * Moving the camera therefore produces true parallax (near planes move more),
 * perspective (orbit/tilt foreshorten), and a measurable collision distance
 * (a plane reaches the lens when dolly ≥ 1 + d).
 */

export interface CameraState {
  /** Lateral position (px at the hero plane): truck / pan target. */
  x: number;
  /** Vertical position (px): pedestal / crane. */
  y: number;
  /** Dolly toward the scene, fraction of the perspective distance (0 = rest). */
  dolly: number;
  /** Lens zoom (1 = normal). */
  zoom: number;
  /** Tilt (deg, positive looks up). */
  tilt: number;
  /** Yaw (deg) — pan/orbit rotation. */
  yaw: number;
  /** Roll (deg). */
  roll: number;
  /** Focus plane depth (for rack focus / depth of field). */
  focus: number;
  /** 0..1 depth-of-field strength (0 = everything sharp). */
  aperture: number;
}

export const REST: CameraState = { x: 0, y: 0, dolly: 0, zoom: 1, tilt: 0, yaw: 0, roll: 0, focus: 0, aperture: 0 };

export const DEPTH_PLANES = ['foreground', 'midground', 'hero', 'background', 'atmosphere'] as const;
export type DepthPlane = (typeof DEPTH_PLANES)[number];

/** Default depth map (fraction of D). Hero = 0 keeps authored layout exact. */
export const DEPTH: Record<DepthPlane, number> = { foreground: -0.32, midground: -0.12, hero: 0, background: 0.7, atmosphere: 1.6 };

/** Near clipping distance: a plane closer than this to the lens counts as a collision. */
export const NEAR = 0.18;

/** Perspective distance in px for a canvas (long lenses keep parallax gentle). */
export function perspectiveOf(width: number, height: number): number {
  return Math.round(Math.hypot(width, height) * 1.25);
}

export interface Pt {
  x: number;
  y: number;
}
export interface RectPx {
  x: number;
  y: number;
  width: number;
  height: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Projects a point authored on plane `d` (canvas px, origin top-left) to the
 * screen under camera `c`. Returns null when the point is behind the near plane.
 */
export function project(p: Pt, d: number, c: CameraState, W: number, H: number, D: number): (Pt & { scale: number }) | null {
  const cx = W / 2;
  const cy = H / 2;
  // layer: scale(1+d) about the canvas centre, translateZ(−dD)
  let x = (p.x - cx) * (1 + d);
  let y = (p.y - cy) * (1 + d);
  let z = -d * D;
  // camera world transform (applied right-to-left as CSS does): translate(−x,−y) → rotateY → rotateX → translateZ
  x -= c.x;
  y -= c.y;
  const cyw = Math.cos(rad(c.yaw));
  const syw = Math.sin(rad(c.yaw));
  const x1 = x * cyw + z * syw;
  const z1 = -x * syw + z * cyw;
  const ct = Math.cos(rad(c.tilt));
  const st = Math.sin(rad(c.tilt));
  const y2 = y * ct - z1 * st;
  const z2 = y * st + z1 * ct;
  const z3 = z2 + c.dolly * D;
  const denom = D - z3;
  if (denom < NEAR * D) return null;
  const k = D / denom;
  let sx = x1 * k;
  let sy = y2 * k;
  // lens zoom and roll on the frame
  sx *= c.zoom;
  sy *= c.zoom;
  if (c.roll) {
    const cr = Math.cos(rad(c.roll));
    const sr = Math.sin(rad(c.roll));
    const rx = sx * cr - sy * sr;
    sy = sx * sr + sy * cr;
    sx = rx;
  }
  return { x: sx + cx, y: sy + cy, scale: k * c.zoom * (1 + d) };
}

/** Screen bounding box of a rect on plane d (null if any corner crosses the lens). */
export function projectRect(r: RectPx, d: number, c: CameraState, W: number, H: number, D: number): RectPx | null {
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map((p) => project(p, d, c, W, H, D));
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x);
  const ys = pts.map((p) => p!.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}

/** Distance (fraction of D) between the lens and plane d — ≤ NEAR means the camera is inside it. */
export function clearance(d: number, c: CameraState): number {
  return 1 + d - c.dolly;
}

/** CSS for the world container (camera). Applied inside an element with `perspective: D`. */
export function worldTransform(c: CameraState, D: number): string {
  const parts = [`translateZ(${(c.dolly * D).toFixed(2)}px)`];
  if (c.tilt) parts.push(`rotateX(${c.tilt.toFixed(3)}deg)`);
  if (c.yaw) parts.push(`rotateY(${c.yaw.toFixed(3)}deg)`);
  if (c.x || c.y) parts.push(`translate(${(-c.x).toFixed(2)}px, ${(-c.y).toFixed(2)}px)`);
  return parts.join(' ');
}

/** CSS for a depth layer at depth d (keeps its authored rest size). */
export function layerTransform(d: number, D: number): string {
  return d === 0 ? 'none' : `translateZ(${(-d * D).toFixed(2)}px) scale(${(1 + d).toFixed(4)})`;
}

/** Lens transform (zoom + roll) for the frame. */
export function lensTransform(c: CameraState): string | undefined {
  if (c.zoom === 1 && !c.roll) return undefined;
  return `${c.roll ? `rotate(${c.roll.toFixed(3)}deg) ` : ''}scale(${c.zoom.toFixed(4)})`;
}

/** Depth-of-field blur (px) for a plane under the camera's focus. */
export function defocus(d: number, c: CameraState, u: number): number {
  if (!c.aperture) return 0;
  return Math.min(1.6 * u, Math.abs(d - c.focus) * c.aperture * 2.2 * u);
}

/** Inverse of `project` on plane d (Newton, numeric Jacobian): screen point → rest point. Null if it does not converge. */
export function unproject(p: Pt, d: number, c: CameraState, W: number, H: number, D: number): Pt | null {
  let q = { x: p.x, y: p.y };
  for (let it = 0; it < 25; it++) {
    const f = project(q, d, c, W, H, D);
    if (!f) return null;
    const ex = f.x - p.x;
    const ey = f.y - p.y;
    if (Math.abs(ex) + Math.abs(ey) < 0.01) return q;
    const h = 1;
    const fx = project({ x: q.x + h, y: q.y }, d, c, W, H, D);
    const fy = project({ x: q.x, y: q.y + h }, d, c, W, H, D);
    if (!fx || !fy) return null;
    const a = fx.x - f.x;
    const b = fy.x - f.x;
    const cc = fx.y - f.y;
    const dd = fy.y - f.y;
    const det = a * dd - b * cc;
    if (Math.abs(det) < 1e-9) return null;
    q = { x: q.x - (dd * ex - b * ey) / det, y: q.y - (-cc * ex + a * ey) / det };
  }
  return q;
}

/** Rest rect (bounding box of the unprojected corners) of a rect measured on screen. */
export function unprojectRect(r: RectPx, d: number, c: CameraState, W: number, H: number, D: number): RectPx | null {
  const pts = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map((p) => unproject(p, d, c, W, H, D));
  if (pts.some((p) => !p)) return null;
  const xs = pts.map((p) => p!.x);
  const ys = pts.map((p) => p!.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}

/**
 * Pass-through (opt-in): a plane the camera flies past fades out over this clearance band instead of
 * colliding with the lens, so a camera may travel through a layer. Spatial scenes and plans with
 * `passThrough: true` use it; everything else keeps the collision rule.
 */
export const PASS_BAND: [number, number] = [NEAR + 0.07, NEAR + 0.4];

/** Opacity of a plane at a given clearance under pass-through (1 far away, 0 before it reaches NEAR). */
export function passOpacity(clear: number): number {
  const t = Math.min(1, Math.max(0, (clear - PASS_BAND[0]) / (PASS_BAND[1] - PASS_BAND[0])));
  return t * t * (3 - 2 * t);
}

/** Linear blend of two camera states (focus / aperture included). */
export function mixCamera(a: CameraState, b: CameraState, t: number): CameraState {
  const l = (x: number, y: number) => x + (y - x) * t;
  return { x: l(a.x, b.x), y: l(a.y, b.y), dolly: l(a.dolly, b.dolly), zoom: l(a.zoom, b.zoom), tilt: l(a.tilt, b.tilt), yaw: l(a.yaw, b.yaw), roll: l(a.roll, b.roll), focus: l(a.focus, b.focus), aperture: l(a.aperture, b.aperture) };
}
