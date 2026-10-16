/**
 * Analytic stage sampler (P3). The same picture the StageLayer draws, computed from stage.json alone:
 * every top-level element's on-screen rect and opacity at a film second (camera planes, tracks, pass-
 * through fade), in the DOM probe format (StageProbeSample) so the P2 hierarchy engine can read it.
 *
 * It lets the Film Director PREDICT a boundary (what is on screen through a cut, where the eye is)
 * for a candidate change in milliseconds, before anything is rendered. The rendered DOM probes and the
 * pixel transition frames stay the evidence; this is the planner's model of them.
 * Pure (no node / browser APIs).
 */
import { compileChoreo, valueAt, type CompiledChoreo } from '../motion/choreography';
import { passOpacity, NEAR } from '../camera/rig';
import { CAMERA_KEY, type StagePlan, type StageElement } from '../stage/plan';
import type { StageProbeSample } from '../qc/stage-probes';

const cache = new WeakMap<object, CompiledChoreo>();
export function compiledOf(plan: StagePlan): CompiledChoreo {
  let c = cache.get(plan.choreo);
  if (!c) {
    c = compileChoreo(plan.choreo);
    cache.set(plan.choreo, c);
  }
  return c;
}

/**
 * Ink per unit of box area, by element kind: fitted (non-negative least squares, r = 0.78 over 424 frames)
 * to the pixel occupancy P2-G measures through the SaaS / voice cuts — a white card on a light world is
 * mostly its content, a solid button is mostly ink. The analytic model predicts the same quantity the
 * pixel judge measures.
 */
export const KIND_MASS: Record<string, number> = { text: 0.23, number: 0.25, card: 0.12, ui: 0.22, image: 0.3, button: 0.55, chip: 0.15, shape: 0.4, icon: 0.25, line: 0.08, cursor: 0 };

export interface SampledEl {
  id: string;
  kind: string;
  rect: { x: number; y: number; width: number; height: number };
  opacity: number;
  z: number;
  /** Frame fraction covered (clipped). */
  area: number;
}

export function sampleStage(plan: StagePlan, t: number): StageProbeSample & { sampled: SampledEl[] } {
  const c = compiledOf(plan);
  const { W, H } = plan;
  const cam = { x: valueAt(c, `${CAMERA_KEY}.x`, t), y: valueAt(c, `${CAMERA_KEY}.y`, t), dolly: valueAt(c, `${CAMERA_KEY}.dolly`, t), zoom: valueAt(c, `${CAMERA_KEY}.zoom`, t, 1) };
  const els: SampledEl[] = [];
  for (const el of plan.elements) {
    if (el.parent || t < el.life.from || t > el.life.to) continue;
    const v = (p: string, f = 0) => valueAt(c, `${el.key}.${p}`, t, f);
    let o = Math.max(0, Math.min(1, v('o', 1)));
    if (o <= 0.01) continue;
    const z = v('z');
    const clear = 1 + z - cam.dolly;
    if (clear <= NEAR) continue;
    const K = cam.zoom / Math.max(1e-3, clear);
    const a = (1 + z) * K;
    const tx = W / 2 - ((W / 2) * (1 + z) + cam.x) * K;
    const ty = H / 2 - ((H / 2) * (1 + z) + cam.y) * K;
    if (clear < 0.6) o *= passOpacity(clear);
    const k = a * v('s', 1);
    const bw = el.box.w * W * v('sx', 1) * k;
    const bh = el.box.h * H * v('sy', 1) * k;
    const cx = a * v('x', 0.5) * W + tx;
    const cy = a * v('y', 0.5) * H + ty;
    // a drawn path is only as long as it has been drawn; a clip reveal only as wide as revealed
    const drawn = el.kind === 'line' ? Math.max(0, Math.min(1, v('draw', 1))) : 1;
    const clip = Math.max(0, Math.min(1, v('clip', 1)));
    const rect = { x: cx - bw / 2, y: cy - bh / 2, width: bw * clip * (el.kind === 'line' ? Math.max(0.05, drawn) : 1), height: bh };
    const area = clipArea(rect, W, H);
    els.push({ id: el.id, kind: el.kind, rect, opacity: o, z, area });
  }
  const mask = plan.masks.some((m) => t >= m.from && t <= m.to);
  return { t, cam, els: els.map((e) => ({ id: e.id, kind: e.kind, z: e.z, rect: e.rect, opacity: e.opacity, parent: false })), words: [], mask, sampled: els };
}

export function clipArea(r: { x: number; y: number; width: number; height: number }, W: number, H: number): number {
  const w = Math.max(0, Math.min(W, r.x + r.width) - Math.max(0, r.x));
  const h = Math.max(0, Math.min(H, r.y + r.height) - Math.max(0, r.y));
  return (w * h) / (W * H);
}

/**
 * Visual mass on screen (0..1): what the eye has to hold on to. A full-frame world (an element that grew
 * to cover the frame) or an open text-mask window counts as a carried frame.
 */
export function massOf(plan: StagePlan, s: ReturnType<typeof sampleStage>): number {
  const byId = new Map<string, StageElement>(plan.elements.map((e) => [e.id, e]));
  let m = 0;
  let world = false;
  for (const e of s.sampled) {
    if (e.area >= 0.95 && (e.kind === 'shape' || e.kind === 'card')) {
      world = true;
      continue;
    }
    const el = byId.get(e.id);
    if (!el || el.kind === 'cursor') continue;
    m += e.area * (KIND_MASS[e.kind] ?? 0.5) * e.opacity;
  }
  // the world itself is not content (P2-G measures content against the world); the mask window is
  if (s.mask) m = Math.max(m, 0.12);
  void world;
  return Math.min(1, m);
}

/** Times of a window, every `step` seconds (inclusive ends). */
export function timesIn(t0: number, t1: number, step = 0.06): number[] {
  const out: number[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
