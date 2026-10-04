/**
 * Lightweight 2D character rig (pure, deterministic; shared by node and render).
 *
 * A rig is a list of SVG parts with a parent/child hierarchy, a pivot (joint)
 * per part, a paint order and optional state variants (eyes--closed, mouth--smile).
 * Posing = joint angles → world matrices (parent chain composed about pivots),
 * then parts are painted in z order, each with its own world matrix. No 3D
 * skeleton, no mesh: rotation about joints, small scale for breathing, state
 * swaps for the face. Two-bone IK puts a hand on a target (chin, chest, phone).
 *
 * Conventions:
 *  - Sides (L/R) are IMAGE sides (screen left / screen right), not anatomical.
 *  - Arm directions are degrees from "straight down"; positive = outward (away
 *    from the body's centre line), so the same gesture works for both sides.
 */
import type { Rig, RigPart } from './schema';

export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function rotateAbout(deg: number, px: number, py: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
}
export function scaleAbout(sx: number, sy: number, px: number, py: number): Mat {
  return [sx, 0, 0, sy, px - sx * px, py - sy * py];
}
export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}
export function apply(m: Mat, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}
export const matStr = (m: Mat) => `matrix(${m.map((v) => Math.round(v * 10000) / 10000).join(' ')})`;

export interface RigPoseInput {
  /** Local joint angles (deg) by part id. */
  angles?: Record<string, number>;
  /** Local scale about the pivot by part id (breathing). */
  scales?: Record<string, { sx: number; sy: number }>;
  /** Local offset by part id (rig units). */
  offsets?: Record<string, { x: number; y: number }>;
  /** State per part id or kind (eyes → closed, mouth → smile, prop → phone). */
  states?: Record<string, string>;
}

export interface SolvedPart {
  id: string;
  kind: string;
  matrix: Mat;
  markup: string;
  z: number;
}

const childrenOf = (rig: Rig) => {
  const m = new Map<string | undefined, RigPart[]>();
  for (const p of rig.parts) {
    const k = p.parent && rig.parts.some((q) => q.id === p.parent) ? p.parent : undefined;
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return m;
};

/** Pick the markup for a part's state (by part id, then by kind); unknown states fall back to the default. */
export function partMarkup(p: RigPart, states?: Record<string, string>): string {
  const want = states?.[p.id] ?? states?.[p.kind];
  if (want !== undefined && want in p.states) return p.states[want];
  if (want === 'hidden' && p.kind === 'prop') return '';
  if (p.defaultState && p.defaultState in p.states) return p.markup + p.states[p.defaultState];
  return p.markup;
}

/** World matrices of every part for a pose, in paint order. */
export function solveRig(rig: Rig, pose: RigPoseInput = {}, root: Mat = IDENTITY): SolvedPart[] {
  const kids = childrenOf(rig);
  const out: SolvedPart[] = [];
  const walk = (parent: string | undefined, world: Mat) => {
    for (const p of kids.get(parent) ?? []) {
      let a = pose.angles?.[p.id] ?? 0;
      if (p.limits) a = Math.min(p.limits[1], Math.max(p.limits[0], a));
      let local = rotateAbout(a, p.pivot.x, p.pivot.y);
      const s = pose.scales?.[p.id];
      if (s) local = mul(local, scaleAbout(s.sx, s.sy, p.pivot.x, p.pivot.y));
      const o = pose.offsets?.[p.id];
      if (o) local = mul(translate(o.x, o.y), local);
      const w = mul(world, local);
      out.push({ id: p.id, kind: p.kind, matrix: w, markup: partMarkup(p, pose.states), z: p.z });
      walk(p.id, w);
    }
  };
  walk(undefined, root);
  return out.sort((x, y) => x.z - y.z);
}

/** Standalone SVG string of a posed rig (node rasterisation, thumbnails, tests). */
export function rigSvg(rig: Rig, pose: RigPoseInput = {}, opts: { width?: number; height?: number; background?: string; pad?: number; box?: { x: number; y: number; width: number; height: number } } = {}): string {
  const [vx, vy, vw, vh] = opts.box ? [opts.box.x, opts.box.y, opts.box.width, opts.box.height] : rig.viewBox;
  const pad = opts.pad ?? 0;
  const parts = solveRig(rig, pose);
  const bg = opts.background ? `<rect x="${vx - pad}" y="${vy - pad}" width="${vw + pad * 2}" height="${vh + pad * 2}" fill="${opts.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vx - pad} ${vy - pad} ${vw + pad * 2} ${vh + pad * 2}" width="${opts.width ?? vw}" height="${opts.height ?? vh}"><defs>${rig.defs}</defs>${bg}${parts
    .filter((p) => p.markup)
    .map((p) => `<g transform="${matStr(p.matrix)}">${p.markup}</g>`)
    .join('')}</svg>`;
}

// ───────────────────────────── arm kinematics ─────────────────────────────

export type Side = 'L' | 'R';
export interface ArmChain {
  side: Side;
  upper: RigPart;
  lower?: RigPart;
  hand?: RigPart;
}

const byKind = (rig: Rig, kind: string) => rig.parts.find((p) => p.kind === kind);
export function armChain(rig: Rig, side: Side): ArmChain | null {
  const upper = byKind(rig, `upperArm${side}`) ?? byKind(rig, `arm${side}`);
  if (!upper) return null;
  return { side, upper, lower: byKind(rig, `lowerArm${side}`), hand: byKind(rig, `hand${side}`) };
}

/** Rig centre line (torso pivot x, or the viewBox centre). */
export function centreX(rig: Rig): number {
  const t = byKind(rig, 'torso');
  return t ? t.bbox.x + t.bbox.width / 2 : rig.viewBox[0] + rig.viewBox[2] / 2;
}

/** Signed "outward" sign for a side: screen-left arms go out toward −x. */
const outSign = (rig: Rig, part: RigPart) => (part.pivot.x < centreX(rig) ? -1 : 1);

/** Direction (deg from straight down, positive = outward) of the vector a→b for an arm part. */
export function dirOf(rig: Rig, part: RigPart, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = (b.x - a.x) * outSign(rig, part);
  const dy = b.y - a.y;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** The far end of a segment in rest pose: its child's pivot, else the bbox end opposite the pivot. */
export function restEnd(rig: Rig, part: RigPart): { x: number; y: number } {
  const child = rig.parts.find((p) => p.parent === part.id && /^(lowerArm|hand)/.test(p.kind));
  if (child) return child.pivot;
  const b = part.bbox;
  const corners = [
    { x: b.x + b.width / 2, y: b.y + b.height },
    { x: b.x + b.width / 2, y: b.y },
    { x: b.x, y: b.y + b.height / 2 },
    { x: b.x + b.width, y: b.y + b.height / 2 },
  ];
  return corners.sort((p, q) => Math.hypot(q.x - part.pivot.x, q.y - part.pivot.y) - Math.hypot(p.x - part.pivot.x, p.y - part.pivot.y))[0];
}

/** Rotation (SVG degrees) that turns a segment from its rest direction to a target direction (both "from down, outward +"). */
const wrap180 = (a: number) => {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
};
function rotFor(rig: Rig, part: RigPart, restDir: number, targetDir: number): number {
  // a positive outward angle on the screen-left side is a clockwise (+) SVG rotation
  return wrap180((targetDir - restDir) * (outSign(rig, part) < 0 ? 1 : -1));
}

export interface ArmTarget {
  /** World direction of the upper arm and forearm (deg from down, + outward). */
  upper: number;
  lower: number;
  /** Wrist bend (deg, local). */
  hand?: number;
}

/** Local angles that put an arm chain at absolute world directions (forward kinematics). */
export function armAngles(rig: Rig, chain: ArmChain, t: ArmTarget): Record<string, number> {
  const out: Record<string, number> = {};
  const uEnd = restEnd(rig, chain.upper);
  const uRest = dirOf(rig, chain.upper, chain.upper.pivot, uEnd);
  const uRot = rotFor(rig, chain.upper, uRest, t.upper);
  out[chain.upper.id] = uRot;
  if (chain.lower) {
    const lEnd = restEnd(rig, chain.lower);
    const lRest = dirOf(rig, chain.lower, chain.lower.pivot, lEnd);
    // child inherits the parent's rotation
    out[chain.lower.id] = wrap180(rotFor(rig, chain.lower, lRest, t.lower) - uRot);
  }
  if (chain.hand && t.hand) out[chain.hand.id] = t.hand;
  return out;
}

export interface Reach {
  angles: Record<string, number>;
  /** Forearm foreshortening (a forearm pointing at the camera looks shorter) + hand counter-scale. */
  scales: Record<string, { sx: number; sy: number }>;
}

/**
 * Natural reach: the elbow hangs at the side (`elbowDir`, deg from down, + outward)
 * and the forearm aims at the target, foreshortened when the target is closer than
 * the forearm is long (≥ 55% — a hand brought toward the camera). Falls back to
 * exact two-bone IK when the target is out of that range.
 */
export function naturalReach(rig: Rig, chain: ArmChain, target: { x: number; y: number }, elbowDir = 14): Reach {
  if (!chain.lower) return { angles: reachAngles(rig, chain, target), scales: {} };
  const S = chain.upper.pivot;
  const E0 = chain.lower.pivot;
  const W0 = restEnd(rig, chain.lower);
  const l1 = Math.hypot(E0.x - S.x, E0.y - S.y);
  const l2 = Math.hypot(W0.x - E0.x, W0.y - E0.y);
  const o = outSign(rig, chain.upper);
  const r = (elbowDir * Math.PI) / 180;
  const E = { x: S.x + Math.sin(r) * l1 * o, y: S.y + Math.cos(r) * l1 };
  const dist = Math.hypot(target.x - E.x, target.y - E.y);
  if (dist > l2 * 1.02 || dist < l2 * 0.55) return { angles: reachAngles(rig, chain, target), scales: {} };
  const angles = armAngles(rig, chain, { upper: elbowDir, lower: dirOf(rig, chain.upper, E, target) });
  const k = Math.min(1, dist / l2);
  const scales: Reach['scales'] = {};
  if (k < 0.995) {
    scales[chain.lower.id] = { sx: 1, sy: k };
    if (chain.hand) scales[chain.hand.id] = { sx: 1, sy: 1 / k };
  }
  return { angles, scales };
}

/**
 * Two-bone IK: put the hand (end of the forearm) on `target` (rig coords),
 * elbow bending outward/down. Unreachable targets are approached along the line.
 */
export function reachAngles(rig: Rig, chain: ArmChain, target: { x: number; y: number }): Record<string, number> {
  const S = chain.upper.pivot;
  const E = chain.lower ? chain.lower.pivot : restEnd(rig, chain.upper);
  const W = chain.lower ? restEnd(rig, chain.lower) : E;
  const l1 = Math.hypot(E.x - S.x, E.y - S.y);
  const l2 = Math.hypot(W.x - E.x, W.y - E.y);
  const dx = target.x - S.x;
  const dy = target.y - S.y;
  const d = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  if (!chain.lower) {
    const dir = dirOf(rig, chain.upper, S, { x: S.x + Math.cos(base) * 10, y: S.y + Math.sin(base) * 10 });
    return armAngles(rig, chain, { upper: dir, lower: dir });
  }
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // elbow hangs down (gravity), then outward
  const sgn = outSign(rig, chain.upper);
  const cands = [base + A, base - A].map((ang) => ({ x: S.x + Math.cos(ang) * l1, y: S.y + Math.sin(ang) * l1 }));
  const elbow = cands.sort((p, q) => q.y - p.y + (q.x - p.x) * sgn * 0.25)[0];
  const len = Math.max(1e-6, Math.hypot(dx, dy));
  const hand = { x: S.x + (dx / len) * d, y: S.y + (dy / len) * d };
  return armAngles(rig, chain, { upper: dirOf(rig, chain.upper, S, elbow), lower: dirOf(rig, chain.upper, elbow, hand) });
}

/** Rig-space anchor points for a solved pose (hands, head, neck …). */
export function rigAnchors(rig: Rig, solved: SolvedPart[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const mat = new Map(solved.map((s) => [s.id, s.matrix]));
  for (const p of rig.parts) {
    const m = mat.get(p.id);
    if (!m) continue;
    const c = { x: p.bbox.x + p.bbox.width / 2, y: p.bbox.y + p.bbox.height / 2 };
    out[`${p.kind}.pivot`] = apply(m, p.pivot);
    out[`${p.kind}.center`] = apply(m, c);
    if (/^lowerArm|^arm[LR]$/.test(p.kind)) out[`${p.kind}.end`] = apply(m, restEnd(rig, p));
  }
  return out;
}

/** Union box (rig units) of every part's box under a solved pose. */
export function solvedBounds(rig: Rig, solved: SolvedPart[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const byId = new Map(rig.parts.map((p) => [p.id, p]));
  for (const s of solved) {
    if (!s.markup) continue;
    const b = byId.get(s.id)!.bbox;
    for (const c of [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }]) {
      const p = apply(s.matrix, c);
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
