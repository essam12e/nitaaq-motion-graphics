/**
 * Transition Frame Quality (P2-G). A transition is judged by the frames INSIDE it, not by its name:
 * for every cut the frame is sampled before, through and after it, and the content occupancy curve
 * (pixels that are not the world behind) is read like an editor scrubbing the cut:
 *
 *   0.60 → 0.08 → 0.65   with no intent  = a visual void (the eye falls into an empty frame)
 *
 * Detects EMPTY_TRANSITION_FRAME, VISUAL_VOID, FLASH_FRAME, OVERLAP_TRANSITION, BROKEN_CONTINUITY.
 * Pure: the node side renders the frames and measures them (src/node/transition-quality.ts).
 */
import type { StagePlan } from '../stage/plan';
import type { StageProbeSample } from './stage-probes';

export type TransitionIssueCode = 'EMPTY_TRANSITION_FRAME' | 'VISUAL_VOID' | 'FLASH_FRAME' | 'OVERLAP_TRANSITION' | 'BROKEN_CONTINUITY';

export interface TransitionCurvePoint {
  t: number;
  /** Content occupancy (0..1) of the frame. */
  occ: number;
  /** Mean luminance (0..1). */
  lum: number;
}

export interface TransitionQuality {
  from: string;
  to: string;
  kind: string;
  element?: string;
  t0: number;
  t1: number;
  pre: number;
  post: number;
  min: number;
  minAt: number;
  /** Seconds the occupancy stays under half of the calmer side. */
  voidSec: number;
  /** min ÷ min(pre, post): 1 = no dip. */
  dip: number;
  curve: TransitionCurvePoint[];
  issues: { code: TransitionIssueCode; severity: 'critical' | 'major' | 'minor'; evidence: string }[];
  /** 0..9 (measured): 9 = the frame never empties and nothing flashes. */
  score: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Judges one transition from its occupancy / luminance curve (+ the DOM samples inside it, when present). */
export function judgeTransition(tr: StagePlan['transitions'][number], curve: TransitionCurvePoint[], dom?: StageProbeSample[]): TransitionQuality {
  const c = [...curve].sort((a, b) => a.t - b.t);
  const before = c.filter((p) => p.t <= tr.t0 + 1e-6);
  const after = c.filter((p) => p.t >= tr.t1 - 1e-6);
  const inside = c.filter((p) => p.t > tr.t0 - 1e-6 && p.t < tr.t1 + 1e-6);
  const pre = before.length ? before[before.length - 1].occ : c[0]?.occ ?? 0;
  const post = after.length ? after[0].occ : c[c.length - 1]?.occ ?? 0;
  const lowSide = Math.min(pre, post);
  const scan = inside.length ? inside : c;
  const minP = scan.reduce((m, p) => (p.occ < m.occ ? p : m), scan[0] ?? { t: tr.t0, occ: lowSide, lum: 0 });
  let voidSec = 0;
  for (let i = 1; i < c.length; i++) if (c[i].occ < lowSide * 0.5 && c[i - 1].occ < lowSide * 0.5) voidSec += c[i].t - c[i - 1].t;
  const dip = lowSide > 0 ? r3(minP.occ / lowSide) : 1;
  const issues: TransitionQuality['issues'] = [];
  // an intentional "clean" moment would be declared as a hold; inside a transition it reads as a gap
  if (minP.occ < 0.12 && dip < 0.45) issues.push({ code: 'EMPTY_TRANSITION_FRAME', severity: minP.occ < 0.05 ? 'major' : 'minor', evidence: `content ${Math.round(pre * 100)}% → ${Math.round(minP.occ * 100)}% → ${Math.round(post * 100)}% at ${minP.t.toFixed(2)}s` });
  if (voidSec >= 0.2) issues.push({ code: 'VISUAL_VOID', severity: voidSec >= 0.35 ? 'major' : 'minor', evidence: `the frame stays under half its content for ${voidSec.toFixed(2)}s` });
  for (let i = 1; i < c.length - 1; i++) {
    const a = c[i - 1];
    const b = c[i];
    const d = c[i + 1];
    if (b.t - a.t <= 0.12 && Math.abs(b.lum - a.lum) > 0.3 && Math.abs(d.lum - a.lum) < 0.15) {
      issues.push({ code: 'FLASH_FRAME', severity: 'major', evidence: `luminance jumps ${Math.round(a.lum * 100)} → ${Math.round(b.lum * 100)} → ${Math.round(d.lum * 100)} at ${b.t.toFixed(2)}s` });
      break;
    }
  }
  if (dom?.length) {
    const mid = dom.filter((s) => s.t >= tr.t0 && s.t <= tr.t1);
    // two readable texts fighting for the same place mid-cut
    for (const s of mid) {
      const texts = s.els.filter((e) => e.kind === 'text' && !e.parent && e.opacity > 0.5);
      let hit = false;
      for (let i = 0; i < texts.length && !hit; i++)
        for (let j = i + 1; j < texts.length && !hit; j++) {
          const a = texts[i].rect;
          const b = texts[j].rect;
          const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
          const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
          if ((ix * iy) / Math.max(1, Math.min(a.width * a.height, b.width * b.height)) > 0.2) {
            issues.push({ code: 'OVERLAP_TRANSITION', severity: 'minor', evidence: `${texts[i].id} and ${texts[j].id} overlap at ${s.t.toFixed(2)}s` });
            hit = true;
          }
        }
      if (hit) break;
    }
    // an object transition whose element vanishes mid-way is not continuity
    if (tr.status === 'object' && tr.element && tr.kind !== 'text-mask' && mid.length >= 2) {
      // (text-mask: the element IS the window — its ink fading is the transition; depth-pass leaves through the lens)
      const span = tr.kind === 'depth-pass' ? mid.filter((s) => s.t <= tr.t0 + (tr.t1 - tr.t0) * 0.6) : mid;
      const gone = span.filter((s) => !s.els.some((e) => (e.id === tr.element || e.id === tr.into) && e.opacity > 0.2)).length;
      if (span.length && gone / span.length > 0.5) issues.push({ code: 'BROKEN_CONTINUITY', severity: 'major', evidence: `${tr.element} is not visible in ${gone}/${span.length} frames of its own transition` });
    }
  }
  const pen = issues.reduce((a, i) => a + (i.severity === 'critical' ? 4 : i.severity === 'major' ? 2.5 : 1.2), 0);
  // a perfect cut keeps the frame full (dip ≈ 1): 9; the score falls with the dip and the issues
  const score = r3(Math.max(0, Math.min(9, 5.5 + 3.5 * Math.min(1, dip) - pen)));
  return { from: tr.from, to: tr.to, kind: tr.kind, element: tr.element, t0: tr.t0, t1: tr.t1, pre: r3(pre), post: r3(post), min: r3(minP.occ), minAt: r3(minP.t), voidSec: r3(voidSec), dip, curve: c, issues, score };
}

/** The sample times of one transition: before, through and after it (every `step` s). */
export function transitionSampleTimes(tr: { t0: number; t1: number }, step = 0.08, pad = 0.24): number[] {
  const out: number[] = [];
  for (let t = tr.t0 - pad; t <= tr.t1 + pad + 1e-6; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

/** Content occupancy of an RGB(A) frame: share of pixels that differ from the world colour (the frame border's dominant colour). */
export function pixelOccupancy(data: Uint8Array | Buffer, width: number, height: number, channels: number, threshold = 30): { occ: number; lum: number } {
  // the world colour: the most common quantised colour on the border ring
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = counts.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += b;
    counts.set(k, e);
  };
  for (let x = 0; x < width; x += 2) {
    add(x, 1);
    add(x, height - 2);
  }
  for (let y = 0; y < height; y += 2) {
    add(1, y);
    add(width - 2, y);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const br = top.r / top.n;
  const bg = top.g / top.n;
  const bb = top.b / top.n;
  let hit = 0;
  let lum = 0;
  let n = 0;
  for (let y = 0; y < height; y += 2)
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.hypot(r - br, g - bg, b - bb) > threshold) hit++;
      lum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      n++;
    }
  return { occ: r3(hit / n), lum: r3(lum / n) };
}
