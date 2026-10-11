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
};
