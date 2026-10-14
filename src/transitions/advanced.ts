/**
 * Transition Intelligence 2.0 — continuity transitions built on the Morphing
 * and Camera engines. These need the canvas and a hint about the two scenes
 * (the shape/colour/point/direction they share), passed as `ctx`.
 *
 *   morph         the outgoing subject's SHAPE becomes the window into the next
 *                 scene (true path morph of the mask, not a crossfade)
 *   shape-match   same, starting from the exact rect of a matched element
 *   liquid        an organic body flows from the focus point and floods the frame
 *   color-match   the colour both scenes share floods from the subject, then opens
 *   zoom-through  the camera flies through the subject into the next scene
 *   camera-match  the incoming scene continues the outgoing camera move (same
 *                 direction and speed — no velocity jump at the cut)
 *   motion-match  an object's motion carries across the cut (velocity-continuous)
 */
import type { CSSProperties } from 'react';
import { cachedMorph } from '../morph/Morph';
import { morphAt } from '../morph/path';
import { blobPath, roundRectPath, shapePath } from '../morph/shapes';
import { cubicBezier, RATE } from '../motion/easing';
import type { TransitionDef, TransitionFrame } from './presentations';

export interface TransitionCtx {
  W: number;
  H: number;
  /** Subject focus point (fraction of the canvas). */
  focus?: { x: number; y: number };
  /** Matched element rect (fraction of the canvas) — shape-match starts here. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Shape name of the outgoing subject (morph library). */
  shape?: string;
  /** Shared colour (color-match). */
  color?: string;
  /** Motion direction carried across the cut. */
  direction?: 'left' | 'right' | 'up' | 'down';
  seed?: string | number;
  /** Scale match: the matched element's rect in the incoming scene (fraction of the canvas). */
  toRect?: { x: number; y: number; w: number; h: number };
  /** Motion Continuity: the outgoing scene's exit vector. */
  vector?: { dx: number; dy: number; speed: number; depth?: number };
}

const io = cubicBezier(0.65, 0, 0.35, 1);
const out = cubicBezier(0.16, 1, 0.3, 1);
const cl = (v: number) => Math.min(1, Math.max(0, v));

/** Full-frame rect path (slightly beyond the frame so edges never show). */
const frameRect = (W: number, H: number) => roundRectPath(-W * 0.02, -H * 0.02, W * 1.04, H * 1.04, 0);

function startShape(ctx: TransitionCtx): string {
  const { W, H } = ctx;
  const f = ctx.focus ?? { x: 0.5, y: 0.5 };
  if (ctx.rect) {
    const r = ctx.rect;
    return roundRectPath(r.x * W, r.y * H, r.w * W, r.h * H, Math.min(r.w * W, r.h * H) * 0.12);
  }
  const s = Math.min(W, H) * 0.22;
  // the named shape is drawn in a 100×100 box: scale it to the subject size at the focus point
  const base = shapePath(ctx.shape ?? 'rounded', 100, ctx.seed ?? 1);
  // the named shape lives in a 100×100 box: place it at the subject's size on the focus point
  return transformPath(base, (x, y) => ({ x: f.x * W + (x - 50) * (s / 50), y: f.y * H + (y - 50) * (s / 50) }));
}

/** Applies a point transform to an absolute path made of M/L/C/Z (arcs are converted first). */
function transformPath(d: string, fn: (x: number, y: number) => { x: number; y: number }): string {
  // normalise through the morph parser: every segment becomes a cubic
  const plan = cachedMorph(d, d, 72);
  const ring = plan.rings[0][0];
  const pts = ring.map((p) => fn(p.x, p.y));
  return `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`;
}

const maskMorph = (from: string, to: string, k: number): CSSProperties => ({ clipPath: `path('${morphAt(cachedMorph(from, to, 72), k)}')` });

/** Unit direction of a transition: explicit direction, else the exit vector, else the reading direction. */
export function dirOf(ctx: TransitionCtx | undefined, dsign: 1 | -1): { sx: number; sy: number } {
  const d = ctx?.direction;
  if (d) return { sx: d === 'left' ? -1 : d === 'right' ? 1 : 0, sy: d === 'up' ? -1 : d === 'down' ? 1 : 0 };
  const v = ctx?.vector;
  if (v && Math.hypot(v.dx, v.dy) > 0.2) {
    const n = Math.hypot(v.dx, v.dy);
    return { sx: v.dx / n, sy: v.dy / n };
  }
  return { sx: dsign === -1 ? -1 : 1, sy: 0 };
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const f3 = (v: number) => v.toFixed(4);

/** Transform (origin 0 0, % of the frame) that maps rect A onto rect B at progress k. */
function rectMap(A: { x: number; y: number; w: number; h: number }, B: { x: number; y: number; w: number; h: number }, k: number): string {
  const s1 = (B.w / Math.max(1e-4, A.w) + B.h / Math.max(1e-4, A.h)) / 2;
  const s = 1 + (s1 - 1) * k;
  const acx = A.x + A.w / 2;
  const acy = A.y + A.h / 2;
  const cx = acx + (B.x + B.w / 2 - acx) * k;
  const cy = acy + (B.y + B.h / 2 - acy) * k;
  return `translate(${pct(cx - acx * s)}, ${pct(cy - acy * s)}) scale(${f3(s)})`;
}

const DEFAULT_RECT = { x: 0.3, y: 0.32, w: 0.4, h: 0.36 };

/**
 * Geometry of the two wipes, shared by the transition (the reveal edge) and the overlay (the card / glass
 * pane that covers it): `shown` is how much of the incoming scene is revealed along the travel, `lo`/`w`
 * the pane's leading-side position and width (fractions of the frame, before mirroring for direction).
 */
export function wipeGeometry(kind: 'card-wipe' | 'glass-wipe', p: number): { shown: number; lo: number; w: number } {
  const k = io(cl(p));
  if (kind === 'card-wipe') {
    const lo = -0.95 + 1.95 * k;
    return { shown: Math.min(1, Math.max(0, lo + 0.05)), lo, w: 0.9 };
  }
  const centre = -0.2 + 1.4 * k;
  return { shown: Math.min(1, Math.max(0, centre)), lo: centre - 0.2, w: 0.4 };
}

export const ADVANCED: Record<string, TransitionDef> = {
  morph: {
    id: 'morph',
    label: 'Shape morph',
    energy: 0.45,
    meaning: ['continuity', 'reveal'],
    duration: 0.7,
    peak: 0.55,
    sfx: 'whoosh-low',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      if (!ctx) return { exit: { opacity: 1 - io(p) }, enter: { opacity: io(p) } };
      const k = io(cl(p));
      return { exit: { transform: `scale(${1 - 0.05 * k})`, filter: `brightness(${1 - 0.25 * k})` }, enter: maskMorph(startShape(ctx), frameRect(ctx.W, ctx.H), k) };
    },
  },
  'shape-match': {
    id: 'shape-match',
    label: 'Shape match',
    energy: 0.4,
    meaning: ['continuity'],
    duration: 0.65,
    peak: 0.5,
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      if (!ctx) return { exit: { opacity: 1 - io(p) }, enter: { opacity: io(p) } };
      const k = out(cl(p));
      return { exit: { filter: `brightness(${1 - 0.3 * k})` }, enter: maskMorph(startShape(ctx), frameRect(ctx.W, ctx.H), k) };
    },
  },
  liquid: {
    id: 'liquid',
    label: 'Liquid flood',
    energy: 0.55,
    meaning: ['reveal', 'brand', 'continuity'],
    duration: 0.75,
    peak: 0.5,
    sfx: 'whoosh-low',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      if (!ctx) return { exit: { opacity: 1 - io(p) }, enter: { opacity: io(p) } };
      const { W, H } = ctx;
      const f = ctx.focus ?? { x: 0.5, y: 0.5 };
      const k = io(cl(p));
      const reach = Math.hypot(Math.max(f.x, 1 - f.x) * W, Math.max(f.y, 1 - f.y) * H) * 1.25;
      const r = Math.max(1, reach * k);
      const d = blobPath(f.x * W, f.y * H, r, ctx.seed ?? 'liquid', { phase: p * Math.PI * 2, wobble: 0.28 * (1 - k * 0.6) });
      return { exit: { filter: `blur(${(3 * k).toFixed(2)}px)` }, enter: { clipPath: `path('${d}')` } };
    },
  },
  'color-match': {
    id: 'color-match',
    label: 'Colour match',
    energy: 0.45,
    meaning: ['brand', 'continuity'],
    duration: 0.6,
    peak: 0.5,
    frame: (p) => ({ exit: { opacity: p < 0.5 ? 1 : 0 }, enter: { opacity: p >= 0.5 ? 1 : 0 }, overlay: { kind: 'color-flood', p } }),
  },
  'zoom-through': {
    id: 'zoom-through',
    label: 'Zoom through the subject',
    energy: 0.7,
    meaning: ['reveal', 'space'],
    duration: 0.6,
    peak: 0.5,
    sfx: 'whoosh',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      const f = ctx?.focus ?? { x: 0.5, y: 0.5 };
      const origin = `${(f.x * 100).toFixed(1)}% ${(f.y * 100).toFixed(1)}%`;
      const a = cubicBezier(0.55, 0, 1, 0.45)(cl(p / 0.6));
      const b = out(cl((p - 0.4) / 0.6));
      return {
        exit: { transform: `scale(${1 + 2.2 * a})`, transformOrigin: origin, opacity: 1 - cl((p - 0.35) / 0.25), filter: `blur(${(10 * a).toFixed(1)}px)` },
        enter: { transform: `scale(${0.7 + 0.3 * b})`, transformOrigin: origin, opacity: cl((p - 0.38) / 0.2), filter: `blur(${(8 * (1 - b)).toFixed(1)}px)` },
      };
    },
  },
  'camera-match': {
    id: 'camera-match',
    label: 'Camera match',
    energy: 0.6,
    meaning: ['continuity', 'space'],
    duration: 0.45,
    peak: 0.5,
    sfx: 'whoosh',
    frame: (p, dsign, ctx?: TransitionCtx): TransitionFrame => {
      const dir = ctx?.direction ?? (dsign === -1 ? 'left' : 'right');
      const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      const sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      // velocity-continuous: the exit accelerates exactly as the enter decelerates (mirrored curve)
      const a = cubicBezier(0.5, 0, 0.9, 0.4)(cl(p * 2));
      const b = cubicBezier(0.1, 0.6, 0.5, 1)(cl(p * 2 - 1));
      const blur = Math.sin(Math.PI * cl(p)) * 14;
      return {
        exit: p < 0.5 ? { transform: `translate(${(-sx * 60 * a).toFixed(2)}%, ${(-sy * 60 * a).toFixed(2)}%)`, filter: `blur(${blur.toFixed(1)}px)` } : { opacity: 0 },
        enter: p >= 0.5 ? { transform: `translate(${(sx * 60 * (1 - b)).toFixed(2)}%, ${(sy * 60 * (1 - b)).toFixed(2)}%)`, filter: `blur(${blur.toFixed(1)}px)` } : { opacity: 0 },
      };
    },
  },
  'motion-match': {
    id: 'motion-match',
    label: 'Motion match',
    energy: 0.5,
    meaning: ['continuity', 'energy'],
    duration: 0.5,
    peak: 0.5,
    sfx: 'swoosh',
    frame: (p, dsign, ctx?: TransitionCtx): TransitionFrame => {
      const dir = ctx?.direction ?? (dsign === -1 ? 'left' : 'right');
      const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      const sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      const k = RATE.smooth(cl(p));
      return {
        exit: { transform: `translate(${(-sx * 100 * k).toFixed(2)}%, ${(-sy * 100 * k).toFixed(2)}%)` },
        enter: { transform: `translate(${(sx * 100 * (1 - k)).toFixed(2)}%, ${(sy * 100 * (1 - k)).toFixed(2)}%)` },
      };
    },
  },
// ── Phase 6: spatial transitions (camera language across the cut) ──
  'card-push-through': {
    id: 'card-push-through',
    label: 'Card push-through',
    energy: 0.6,
    meaning: ['space', 'reveal', 'continuity'],
    duration: 0.7,
    peak: 0.55,
    sfx: 'whoosh',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      // the camera pushes into a card of the outgoing scene; the card is a window onto the next scene that grows to the frame
      const r = ctx?.rect ?? DEFAULT_RECT;
      const k = io(cl(p));
      const top = r.y * (1 - k);
      const left = r.x * (1 - k);
      const right = (1 - r.x - r.w) * (1 - k);
      const bottom = (1 - r.y - r.h) * (1 - k);
      const rad = Math.min(r.w * (ctx?.W ?? 1080), r.h * (ctx?.H ?? 1920)) * 0.08 * (1 - k);
      const origin = `${pct(r.x + r.w / 2)} ${pct(r.y + r.h / 2)}`;
      const push = 1 + 1.6 * k * k;
      return {
        exit: { transform: `scale(${f3(push)})`, transformOrigin: origin, filter: `brightness(${f3(1 - 0.35 * k)})` },
        enter: { clipPath: `inset(${pct(top)} ${pct(right)} ${pct(bottom)} ${pct(left)} round ${rad.toFixed(1)}px)`, transform: `scale(${f3(0.86 + 0.14 * k)})`, transformOrigin: origin },
      };
    },
  },
  'video-match-cut': {
    id: 'video-match-cut',
    label: 'Video match cut',
    energy: 0.5,
    meaning: ['continuity'],
    duration: 0.5,
    peak: 0.5,
    sfx: 'swoosh',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      // the outgoing video grows until it fills the frame, the cut lands on the matching full-frame video
      const r = ctx?.rect ?? DEFAULT_RECT;
      const full = { x: 0, y: 0, w: 1, h: 1 };
      const a = cubicBezier(0.55, 0, 0.9, 0.5)(cl(p * 2));
      const b = out(cl(p * 2 - 1));
      return {
        exit: p < 0.5 ? { transform: rectMap(r, full, a), transformOrigin: '0 0' } : { opacity: 0 },
        enter: p >= 0.5 ? { transform: `scale(${f3(1.06 - 0.06 * b)})` } : { opacity: 0 },
      };
    },
  },
  'foreground-card-wipe': {
    id: 'foreground-card-wipe',
    label: 'Foreground card wipe',
    energy: 0.55,
    meaning: ['space', 'continuity', 'ui'],
    duration: 0.65,
    peak: 0.5,
    sfx: 'swoosh',
    frame: (p, dsign, ctx?: TransitionCtx): TransitionFrame => {
      // a card passes in front of the lens; the cut happens behind it
      const { sx } = dirOf(ctx, dsign);
      const k = io(cl(p));
      const { shown } = wipeGeometry('card-wipe', p);
      // the outgoing scene is cut away where the incoming one is revealed (scenes have no opaque backing of their own)
      return {
        exit: { clipPath: sx >= 0 ? `inset(0 0 0 ${pct(shown)})` : `inset(0 ${pct(shown)} 0 0)`, transform: `translateX(${pct(sx * 0.06 * k)})` },
        enter: { clipPath: sx >= 0 ? `inset(0 ${pct(1 - shown)} 0 0)` : `inset(0 0 0 ${pct(1 - shown)})`, transform: `translateX(${pct(-sx * 0.06 * (1 - k))})` },
        overlay: { kind: 'card-wipe', p },
      };
    },
  },
  'glass-wipe': {
    id: 'glass-wipe',
    label: 'Glass wipe',
    energy: 0.45,
    meaning: ['reveal', 'calm', 'brand'],
    duration: 0.7,
    peak: 0.5,
    sfx: 'shimmer',
    frame: (p, dsign, ctx?: TransitionCtx): TransitionFrame => {
      // a pane of frosted glass slides across; behind it the next scene is already there
      const { sx } = dirOf(ctx, dsign);
      const { shown } = wipeGeometry('glass-wipe', p);
      return {
        exit: { clipPath: sx >= 0 ? `inset(0 0 0 ${pct(shown)})` : `inset(0 ${pct(shown)} 0 0)` },
        enter: { clipPath: sx >= 0 ? `inset(0 ${pct(1 - shown)} 0 0)` : `inset(0 0 0 ${pct(1 - shown)})` },
        overlay: { kind: 'glass-wipe', p },
      };
    },
  },
  'scale-match': {
    id: 'scale-match',
    label: 'Scale match',
    energy: 0.4,
    meaning: ['continuity'],
    duration: 0.6,
    peak: 0.5,
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      // the matched element keeps its place and size across the cut: A's rect travels to B's rect while the scenes swap
      const A = ctx?.rect ?? DEFAULT_RECT;
      const B = ctx?.toRect ?? A;
      const k = io(cl(p));
      return {
        exit: { transform: rectMap(A, B, k), transformOrigin: '0 0', opacity: 1 - cl((p - 0.35) / 0.3) },
        enter: { transform: rectMap(B, A, 1 - k), transformOrigin: '0 0', opacity: cl((p - 0.3) / 0.3) },
      };
    },
  },
  'z-depth-pass': {
    id: 'z-depth-pass',
    label: 'Z-depth pass',
    energy: 0.65,
    meaning: ['space', 'reveal', 'energy'],
    duration: 0.65,
    peak: 0.5,
    sfx: 'whoosh',
    frame: (p, _d, ctx?: TransitionCtx): TransitionFrame => {
      // the camera travels forward: the outgoing layer passes the lens, the incoming one arrives from depth at the same speed
      const f = ctx?.focus ?? { x: 0.5, y: 0.5 };
      const origin = `${pct(f.x)} ${pct(f.y)}`;
      const z = cubicBezier(0.4, 0, 0.6, 1)(cl(p));
      const sOut = 1 / Math.max(0.35, 1 - 0.65 * z);
      const sIn = 0.55 + 0.45 * z;
      return {
        exit: { transform: `scale(${f3(sOut)})`, transformOrigin: origin, opacity: 1 - cl((p - 0.3) / 0.3), filter: `blur(${(6 * z).toFixed(2)}px)` },
        enter: { transform: `scale(${f3(sIn)})`, transformOrigin: origin, opacity: cl((p - 0.25) / 0.35), filter: `blur(${(6 * (1 - z)).toFixed(2)}px) brightness(${f3(0.7 + 0.3 * z)})` },
      };
    },
  },
  'directional-blur': {
    id: 'directional-blur',
    label: 'Directional motion blur',
    energy: 0.7,
    meaning: ['energy', 'continuity'],
    duration: 0.4,
    peak: 0.5,
    sfx: 'whoosh',
    frame: (p, dsign, ctx?: TransitionCtx): TransitionFrame => {
      // a fast move along the motion direction, smeared by a real directional blur (not an isotropic one)
      const { sx, sy } = dirOf(ctx, dsign);
      const a = cubicBezier(0.5, 0, 0.9, 0.4)(cl(p * 2));
      const b = cubicBezier(0.1, 0.6, 0.5, 1)(cl(p * 2 - 1));
      const amt = Math.round(Math.sin(Math.PI * cl(p)) * 2800) / 100;
      const blur: [number, number] = [Math.abs(sx) * amt, Math.abs(sy) * amt];
      return {
        exit: p < 0.5 ? { transform: `translate(${pct(-sx * 0.35 * a)}, ${pct(-sy * 0.35 * a)})` } : { opacity: 0 },
        enter: p >= 0.5 ? { transform: `translate(${pct(sx * 0.35 * (1 - b))}, ${pct(sy * 0.35 * (1 - b))})` } : { opacity: 0 },
        blur: { exit: p < 0.5 ? blur : undefined, enter: p >= 0.5 ? blur : undefined },
      };
    },
  },
  'focus-handoff': {
    id: 'focus-handoff',
    label: 'Focus handoff',
    energy: 0.3,
    meaning: ['calm', 'continuity', 'space'],
    duration: 0.8,
    peak: 0.5,
    frame: (p): TransitionFrame => {
      // a rack focus across the cut: the outgoing scene falls out of focus as the incoming one comes in
      const k = io(cl(p));
      return {
        exit: { filter: `blur(${(12 * k).toFixed(2)}px)`, transform: `scale(${f3(1 + 0.03 * k)})`, opacity: 1 - cl((p - 0.25) / 0.3) },
        // the two planes barely overlap: the eye racks from one to the other instead of reading both at once
        enter: { filter: `blur(${(12 * (1 - k)).toFixed(2)}px)`, transform: `scale(${f3(0.97 + 0.03 * k)})`, opacity: cl((p - 0.45) / 0.35) },
      };
    },
  },
};
