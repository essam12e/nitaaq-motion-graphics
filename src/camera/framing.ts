/**
 * Safe framing + collision prevention for Camera Engine 2.0.
 *
 * Given a camera plan and the elements that matter (text, product, logo, CTA —
 * their rects on their depth planes), the solver samples the whole move and
 * checks, frame-accurately with the same projection the browser uses:
 *
 *   outside-safe  important text / logo / CTA leaves the platform safe area
 *   cropped       the hero product is cut by the frame edge
 *   collision     the camera reaches a depth plane (passes "through" a layer)
 *   occluded      a foreground layer covers the product / logo / text
 *   too-fast      text moves faster on screen than it can be read
 *
 * If a move breaks framing it is first re-aimed at the subject (focus on the
 * protected elements' centre), then its amplitude is reduced step by step
 * (0.75 → 0.5 → 0.3 → 0.15 → static). The camera never wins over the message.
 * Pure and deterministic.
 */
import { cameraAt, type CameraPlan, type MoveCtx } from './moves';
import { clearance, NEAR, projectRect, type RectPx } from './rig';

export type ProtectKind = 'text' | 'product' | 'logo' | 'cta' | 'ui' | 'other';

export interface ProtectedElement {
  rect: RectPx;
  /** Depth plane (fraction of D); 0 = hero plane. */
  depth?: number;
  kind: ProtectKind;
  importance?: number;
  label?: string;
}

export interface Occluder {
  rect: RectPx;
  depth: number;
}

export interface FramingViolation {
  t: number;
  kind: ProtectKind | 'camera';
  label?: string;
  problem: 'outside-safe' | 'cropped' | 'collision' | 'occluded' | 'too-fast';
  amount: number;
}

export interface FramingContext extends MoveCtx {
  D: number;
  safe: RectPx;
  /** Canvas unit (px) for tolerances. */
  u: number;
  occluders?: Occluder[];
  /** Max on-screen text speed while readable (px/s). Default 12% of the width per second. */
  maxTextSpeed?: number;
}

export interface FramingResult {
  plan: CameraPlan;
  ok: boolean;
  /** Amplitude multiplier applied (1 = unchanged). */
  scaled: number;
  refocused: boolean;
  violations: FramingViolation[];
  minClearance: number;
  note: string;
}

const inside = (r: RectPx, box: RectPx, tol: number) => r.x >= box.x - tol && r.y >= box.y - tol && r.x + r.width <= box.x + box.width + tol && r.y + r.height <= box.y + box.height + tol;
const overlap = (a: RectPx, b: RectPx) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** All framing violations of a plan (sampled across the scene). */
export function auditFraming(plan: CameraPlan | undefined, els: ProtectedElement[], ctx: FramingContext, samples = 30): { violations: FramingViolation[]; minClearance: number } {
  const out: FramingViolation[] = [];
  let minClear = Infinity;
  if (!plan || plan.move === 'static' || plan.amplitude <= 0) return { violations: out, minClearance: Infinity };
  const { W, H, D } = ctx;
  const frame = { x: 0, y: 0, width: W, height: H };
  const depths = new Set<number>([0, ...els.map((e) => e.depth ?? 0), ...(ctx.occluders ?? []).map((o) => o.depth)]);
  const maxSpeed = ctx.maxTextSpeed ?? 0.12 * W;
  const dt = ctx.durationSec / samples;
  let prev: Map<number, RectPx | null> | null = null;
  for (let i = 0; i <= samples; i++) {
    const t = i * dt;
    const cam = cameraAt(plan, t, ctx);
    for (const d of depths) {
      const c = clearance(d, cam);
      minClear = Math.min(minClear, c);
      if (c <= NEAR + 0.04) out.push({ t, kind: 'camera', problem: 'collision', amount: NEAR + 0.04 - c, label: `plane ${d}` });
    }
    const now = new Map<number, RectPx | null>();
    els.forEach((e, k) => {
      const r = projectRect(e.rect, e.depth ?? 0, cam, W, H, D);
      now.set(k, r);
      if (!r) {
        out.push({ t, kind: e.kind, label: e.label, problem: 'collision', amount: 1 });
        return;
      }
      if (e.kind === 'product' || e.kind === 'ui') {
        if (!inside(r, frame, -0.005 * W)) out.push({ t, kind: e.kind, label: e.label, problem: 'cropped', amount: 1 });
      } else if (e.kind !== 'other' && !inside(r, ctx.safe, ctx.u * 0.6)) {
        out.push({ t, kind: e.kind, label: e.label, problem: 'outside-safe', amount: 1 });
      }
      for (const o of ctx.occluders ?? []) {
        if (o.depth >= (e.depth ?? 0)) continue;
        const or = projectRect(o.rect, o.depth, cam, W, H, D);
        if (!or) continue;
        const cov = overlap(or, r) / Math.max(1, r.width * r.height);
        if (cov > 0.15 && e.kind !== 'other') out.push({ t, kind: e.kind, label: e.label, problem: 'occluded', amount: cov });
      }
      // readability: text speed on screen (centre displacement per second)
      const p = prev?.get(k);
      if (p && r && (e.kind === 'text' || e.kind === 'cta') && t > 0.6 && t < ctx.durationSec - 0.3) {
        const v = Math.hypot(r.x + r.width / 2 - (p.x + p.width / 2), r.y + r.height / 2 - (p.y + p.height / 2)) / dt;
        if (v > maxSpeed) out.push({ t, kind: e.kind, label: e.label, problem: 'too-fast', amount: v / maxSpeed });
      }
    });
    prev = now;
  }
  return { violations: out, minClearance: minClear };
}

/** Make a plan safe for its elements: re-aim, then shrink, then (last resort) hold still. */
export function solveFraming(plan: CameraPlan | undefined, els: ProtectedElement[], ctx: FramingContext): FramingResult {
  if (!plan || plan.move === 'static') return { plan: plan ?? { move: 'static', amplitude: 0 }, ok: true, scaled: 1, refocused: false, violations: [], minClearance: Infinity, note: 'static camera' };
  const first = auditFraming(plan, els, ctx);
  if (!first.violations.length) return { plan, ok: true, scaled: 1, refocused: false, violations: [], minClearance: first.minClearance, note: 'framing safe' };
  // 1. re-aim at the weighted centre of what matters
  const weighted = els.filter((e) => e.kind !== 'other');
  let refocused = false;
  let base = plan;
  if (weighted.length) {
    const wsum = weighted.reduce((s, e) => s + (e.importance ?? 0.5), 0) || 1;
    const fx = weighted.reduce((s, e) => s + (e.rect.x + e.rect.width / 2) * (e.importance ?? 0.5), 0) / wsum / ctx.W;
    const fy = weighted.reduce((s, e) => s + (e.rect.y + e.rect.height / 2) * (e.importance ?? 0.5), 0) / wsum / ctx.H;
    const aimed: CameraPlan = { ...plan, focus: { x: Math.round(fx * 1000) / 1000, y: Math.round(fy * 1000) / 1000 } };
    const a = auditFraming(aimed, els, ctx);
    if (a.violations.length < first.violations.length) {
      base = aimed;
      refocused = true;
      if (!a.violations.length) return { plan: aimed, ok: true, scaled: 1, refocused, violations: [], minClearance: a.minClearance, note: 're-aimed at the subject' };
    }
  }
  // 2. shrink amplitude
  for (const k of [0.75, 0.5, 0.3, 0.15]) {
    const p = { ...base, amplitude: Math.round(base.amplitude * k * 1000) / 1000 };
    const a = auditFraming(p, els, ctx);
    if (!a.violations.length) return { plan: p, ok: true, scaled: k, refocused, violations: [], minClearance: a.minClearance, note: `amplitude ×${k} keeps the subject framed` };
  }
  return { plan: { ...base, move: 'static', amplitude: 0, reason: `${plan.reason ?? plan.move}; held still — every amplitude broke framing` }, ok: true, scaled: 0, refocused, violations: first.violations, minClearance: first.minClearance, note: 'camera held still to protect framing' };
}
