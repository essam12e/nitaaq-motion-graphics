/**
 * Micro FX — small, physical accents on top of a motion moment (a click, a landing, a reveal).
 *
 *   burst · ripple · ring · sparks · trails · impact-lines · energy-pulse · glow-pulse · directional-streaks
 *
 * Rules:
 *   - deterministic: every random choice comes from a seeded RNG (seed + kind + time), so a frame always
 *     draws the same shapes in every render, worker and seek;
 *   - meaning first: `fxForMoment` picks an effect from the moment (event type), the element's intent and
 *     the film's motion personality — premium films get a ring or a glow, playful films a burst;
 *   - rationed: an FX budget (count density per film, concurrent cost per moment) and a per-personality
 *     ceiling drop the least important accents; the render cost joins the film's performance budget;
 *   - light: each effect is a handful of SVG primitives, no filters, no images.
 *
 * Geometry is a pure function of (spec, local time, canvas): `fxShapes`.
 */
import { createRng } from '../core/rng';
import type { MotionPersonalityId } from '../motion/personality';
import type { MotionIntent } from '../motion/intent';

export const MICRO_FX = ['burst', 'ripple', 'ring', 'sparks', 'trails', 'impact-lines', 'energy-pulse', 'glow-pulse', 'directional-streaks'] as const;
export type MicroFxKind = (typeof MICRO_FX)[number];

export interface MicroFxSpec {
  kind: MicroFxKind;
  /** Scene-local seconds the effect starts. */
  at: number;
  /** Centre (fraction of the canvas). */
  x: number;
  y: number;
  /** Radius / reach as a fraction of the canvas short edge (default per kind). */
  size?: number;
  /** Colour (default: the style's accent). */
  color?: string;
  /** 0..1 strength (opacity and count). */
  intensity?: number;
  /** Direction in degrees for trails / streaks (0 = right, 90 = down). */
  direction?: number;
  /** Seconds (default per kind). */
  duration?: number;
  seed?: string | number;
  /** 0..1 how much the moment matters (budget keeps the most important). */
  importance?: number;
  /** Written by the auto planner (re-planning replaces these). */
  auto?: boolean;
  /** Why this accent (review). Not rendered. */
  reason?: string;
}

interface KindDef {
  duration: number;
  size: number;
  /** Render cost units (primitives redrawn per frame / 10). */
  cost: number;
  label: string;
}

export const FX_DEFS: Record<MicroFxKind, KindDef> = {
  burst: { duration: 0.55, size: 0.16, cost: 1, label: 'particles shoot out of the moment' },
  ripple: { duration: 0.9, size: 0.2, cost: 0.6, label: 'two or three rings spread like water' },
  ring: { duration: 0.5, size: 0.12, cost: 0.4, label: 'one clean ring expands from the contact point' },
  sparks: { duration: 0.7, size: 0.18, cost: 1.2, label: 'sparks fly and fall under gravity' },
  trails: { duration: 0.45, size: 0.22, cost: 0.8, label: 'after-images trailing a fast motion' },
  'impact-lines': { duration: 0.35, size: 0.2, cost: 0.8, label: 'radial lines of a hard hit' },
  'energy-pulse': { duration: 0.8, size: 0.2, cost: 0.7, label: 'an energy core pulses twice' },
  'glow-pulse': { duration: 0.9, size: 0.22, cost: 0.5, label: 'a soft glow swells and fades' },
  'directional-streaks': { duration: 0.5, size: 0.3, cost: 1, label: 'speed lines along the motion' },
};

/** A drawable primitive (canvas px). */
export type FxShape =
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; opacity: number; glow?: boolean }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; opacity: number };

const cl = (v: number) => Math.min(1, Math.max(0, v));
const outCubic = (x: number) => 1 - Math.pow(1 - cl(x), 3);
const outQuart = (x: number) => 1 - Math.pow(1 - cl(x), 4);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Shapes of one effect at scene-local time t (empty before it starts and after it ends). Pure. */
export function fxShapes(fx: MicroFxSpec, t: number, W: number, H: number, accent: string): FxShape[] {
  const def = FX_DEFS[fx.kind];
  const dur = fx.duration ?? def.duration;
  const p = (t - fx.at) / dur;
  if (p < 0 || p > 1) return [];
  const S = Math.min(W, H);
  const R = (fx.size ?? def.size) * S;
  const cx = fx.x * W;
  const cy = fx.y * H;
  const k = cl(fx.intensity ?? 0.8);
  const col = fx.color ?? accent;
  const rng = createRng(`${fx.seed ?? 'fx'}:${fx.kind}:${fx.at}`);
  const out: FxShape[] = [];
  const sw = Math.max(1.5, S * 0.004);
  switch (fx.kind) {
    case 'ring': {
      const e = outCubic(p);
      out.push({ t: 'circle', cx, cy, r: r2(R * (0.25 + 0.75 * e)), stroke: col, sw: r2(sw * (2.2 - 1.6 * e)), opacity: r2(k * (1 - p)) });
      break;
    }
    case 'ripple': {
      for (let i = 0; i < 3; i++) {
        const q = (p - i * 0.18) / 0.64;
        if (q < 0 || q > 1) continue;
        out.push({ t: 'circle', cx, cy, r: r2(R * (0.15 + 0.85 * outCubic(q))), stroke: col, sw: r2(sw * (1.6 - q)), opacity: r2(k * (1 - q) * (1 - i * 0.25)) });
      }
      break;
    }
    case 'burst': {
      const n = 8 + Math.round(6 * k);
      for (let i = 0; i < n; i++) {
        const a = ((i + rng.next() * 0.6) / n) * Math.PI * 2;
        const reach = R * (0.6 + 0.4 * rng.next());
        const d = reach * outQuart(p);
        const size = S * (0.006 + 0.006 * rng.next()) * (1 - p * 0.8);
        out.push({ t: 'circle', cx: r2(cx + Math.cos(a) * d), cy: r2(cy + Math.sin(a) * d), r: r2(size), fill: col, opacity: r2(k * (1 - p * p)) });
      }
      break;
    }
    case 'sparks': {
      const n = 10 + Math.round(6 * k);
      const g = R * 2.2; // gravity (px/s² scaled to the effect)
      const tt = p * dur;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (rng.next() - 0.5) * Math.PI * 1.3;
        const v = (R / dur) * (1.1 + rng.next() * 0.9);
        const x = cx + Math.cos(a) * v * tt;
        const y = cy + Math.sin(a) * v * tt + 0.5 * g * tt * tt;
        // streak along the velocity
        const vx = Math.cos(a) * v;
        const vy = Math.sin(a) * v + g * tt;
        const len = 0.06 * Math.hypot(vx, vy) * (1 - p * 0.5);
        const n2 = Math.hypot(vx, vy) || 1;
        out.push({ t: 'line', x1: r2(x), y1: r2(y), x2: r2(x - (vx / n2) * len), y2: r2(y - (vy / n2) * len), stroke: col, sw: r2(sw * 1.3), opacity: r2(k * (1 - p)) });
      }
      break;
    }
    case 'trails': {
      const a = ((fx.direction ?? 0) * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const lead = outCubic(p) * R;
      for (let i = 0; i < 5; i++) {
        const back = i * R * 0.16;
        const d = lead - back;
        if (d < 0) continue;
        const off = (rng.next() - 0.5) * R * 0.18;
        const x = cx + dx * d - dy * off;
        const y = cy + dy * d + dx * off;
        out.push({ t: 'line', x1: r2(x), y1: r2(y), x2: r2(x - dx * R * 0.22), y2: r2(y - dy * R * 0.22), stroke: col, sw: r2(sw * (1.6 - i * 0.2)), opacity: r2(k * (1 - p) * (1 - i * 0.17)) });
      }
      break;
    }
    case 'impact-lines': {
      const n = 10 + Math.round(4 * k);
      const e = outQuart(p);
      for (let i = 0; i < n; i++) {
        const a = ((i + (rng.next() - 0.5) * 0.5) / n) * Math.PI * 2;
        const r0 = R * (0.35 + 0.5 * e);
        const r1 = r0 + R * (0.25 + 0.3 * rng.next()) * (1 - p * 0.7);
        out.push({ t: 'line', x1: r2(cx + Math.cos(a) * r0), y1: r2(cy + Math.sin(a) * r0), x2: r2(cx + Math.cos(a) * r1), y2: r2(cy + Math.sin(a) * r1), stroke: col, sw: r2(sw * 1.4), opacity: r2(k * (1 - p)) });
      }
      break;
    }
    case 'energy-pulse': {
      for (let i = 0; i < 2; i++) {
        const q = (p - i * 0.35) / 0.65;
        if (q < 0 || q > 1) continue;
        out.push({ t: 'circle', cx, cy, r: r2(R * (0.2 + 0.8 * outCubic(q))), fill: col, opacity: r2(k * 0.35 * (1 - q)), glow: true });
        out.push({ t: 'circle', cx, cy, r: r2(R * (0.2 + 0.8 * outCubic(q))), stroke: col, sw: r2(sw * 1.2), opacity: r2(k * (1 - q)) });
      }
      out.push({ t: 'circle', cx, cy, r: r2(R * 0.12 * (1 + 0.25 * Math.sin(p * Math.PI * 4))), fill: '#FFFFFF', opacity: r2(k * 0.85 * (1 - p)), glow: true });
      break;
    }
    case 'glow-pulse': {
      const e = Math.sin(Math.PI * p);
      out.push({ t: 'circle', cx, cy, r: r2(R * (0.6 + 0.4 * outCubic(p))), fill: col, opacity: r2(k * 0.55 * e), glow: true });
      break;
    }
    case 'directional-streaks': {
      const a = ((fx.direction ?? 0) * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const n = 7 + Math.round(5 * k);
      for (let i = 0; i < n; i++) {
        const off = (rng.next() - 0.5) * 2 * R * 0.6;
        const start = (rng.next() - 0.5) * R;
        const len = R * (0.3 + 0.5 * rng.next());
        const travel = (p * 2.4 - 0.7) * R;
        const s0 = start + travel;
        const x0 = cx + dx * s0 - dy * off;
        const y0 = cy + dy * s0 + dx * off;
        out.push({ t: 'line', x1: r2(x0), y1: r2(y0), x2: r2(x0 - dx * len), y2: r2(y0 - dy * len), stroke: col, sw: r2(sw * (0.6 + rng.next() * 0.8)), opacity: r2(k * 0.8 * Math.sin(Math.PI * p)) });
      }
      break;
    }
  }
  return out;
}

/** Effects each personality may use (never more expressive than the film). */
export const FX_BY_PERSONALITY: Record<MotionPersonalityId, MicroFxKind[]> = {
  premium: ['ring', 'glow-pulse', 'ripple', 'trails'],
  corporate: ['ring', 'ripple', 'glow-pulse'],
  cinematic: ['glow-pulse', 'ripple', 'ring', 'directional-streaks'],
  tech: ['energy-pulse', 'ring', 'directional-streaks', 'ripple', 'trails'],
  playful: ['burst', 'sparks', 'ring', 'ripple', 'glow-pulse'],
  energetic: ['impact-lines', 'burst', 'directional-streaks', 'energy-pulse', 'sparks', 'trails'],
  sport: ['impact-lines', 'directional-streaks', 'burst', 'energy-pulse', 'trails'],
};

/** What each moment asks for, in order of preference (the personality filters the list). */
const BY_MOMENT: Record<string, MicroFxKind[]> = {
  button_press: ['ring', 'burst', 'impact-lines', 'ripple', 'energy-pulse'],
  phone_tap: ['ring', 'ripple', 'burst'],
  success_state: ['burst', 'sparks', 'glow-pulse', 'ring'],
  product_land: ['impact-lines', 'ripple', 'ring', 'glow-pulse'],
  object_land: ['impact-lines', 'ripple', 'ring'],
  word_impact: ['impact-lines', 'directional-streaks', 'ring', 'glow-pulse'],
  hero_reveal: ['glow-pulse', 'energy-pulse', 'sparks', 'burst', 'ripple'],
  logo_reveal: ['glow-pulse', 'ripple', 'energy-pulse', 'sparks'],
  cta_reveal: ['ring', 'glow-pulse', 'energy-pulse', 'burst'],
  price_reveal: ['burst', 'ring', 'glow-pulse'],
  counter_final: ['burst', 'ring', 'energy-pulse'],
  swipe: ['trails', 'directional-streaks'],
  camera_move: ['directional-streaks', 'trails'],
  card_entry: ['trails', 'ring'],
  map_pin: ['ripple', 'ring'],
};

/** Intents that never get an accent (the motion itself is the message, or it must stay quiet). */
const QUIET: MotionIntent[] = ['continuity', 'navigation', 'storytelling'];

/** Picks the accent for a moment (undefined = this moment stays clean). */
export function fxForMoment(moment: string, personality: MotionPersonalityId, intent?: MotionIntent): MicroFxKind | undefined {
  if (intent && QUIET.includes(intent)) return undefined;
  const allowed = FX_BY_PERSONALITY[personality] ?? FX_BY_PERSONALITY.premium;
  return (BY_MOMENT[moment] ?? []).find((k) => allowed.includes(k));
}

export type FxBudgetLevel = 'LOW' | 'MEDIUM' | 'HIGH';
/** Max accents per 10 s of film and max concurrent cost on screen. */
export const FX_BUDGET: Record<FxBudgetLevel, { per10s: number; concurrent: number }> = {
  LOW: { per10s: 3, concurrent: 1.2 },
  MEDIUM: { per10s: 6, concurrent: 2.2 },
  HIGH: { per10s: 10, concurrent: 3.5 },
};

export interface FxBudgetResult<T> {
  kept: T[];
  dropped: { fx: T; why: string }[];
  /** Duration-weighted render cost per second of film (joins the effect budget). */
  cost: number;
}

/** Applies the FX budget to absolute-timed effects (keeps the most important, then the earliest). */
export function budgetFx<T extends { kind: MicroFxKind; start: number; duration?: number; importance?: number }>(list: T[], filmSec: number, level: FxBudgetLevel = 'MEDIUM'): FxBudgetResult<T> {
  const b = FX_BUDGET[level];
  const cap = Math.max(1, Math.floor((b.per10s * filmSec) / 10));
  const order = [...list].sort((a, z) => (z.importance ?? 0.5) - (a.importance ?? 0.5) || a.start - z.start);
  const kept: T[] = [];
  const dropped: FxBudgetResult<T>['dropped'] = [];
  const end = (x: T) => x.start + (x.duration ?? FX_DEFS[x.kind].duration);
  for (const fx of order) {
    if (kept.length >= cap) {
      dropped.push({ fx, why: `film budget: at most ${cap} accents (${b.per10s} per 10 s)` });
      continue;
    }
    const overlap = kept.filter((k) => k.start < end(fx) && fx.start < end(k)).reduce((a, k) => a + FX_DEFS[k.kind].cost, 0);
    if (overlap + FX_DEFS[fx.kind].cost > b.concurrent) {
      dropped.push({ fx, why: `concurrent cost over ${b.concurrent}` });
      continue;
    }
    kept.push(fx);
  }
  kept.sort((a, z) => a.start - z.start);
  const cost = kept.reduce((a, k) => a + FX_DEFS[k.kind].cost * (k.duration ?? FX_DEFS[k.kind].duration), 0) / Math.max(1, filmSec);
  return { kept, dropped, cost: Math.round(cost * 1000) / 1000 };
}
