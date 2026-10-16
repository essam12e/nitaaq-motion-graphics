/**
 * Boundary Intelligence (P3-C) + Eye Flow (P3-E) + Visual Story Continuity (P3-W).
 *
 * Every cut A→B is a BOUNDARY, not a transition type: what the eye is on when A lets go, where it must
 * be when B lands, which element hands over, what persists, which way things move, the energy and the
 * camera state on both sides, the audio anchor, and what continuity B owes A. boundary_plan.json is
 * built from the compiled stage with the analytic sampler (predicted, before rendering) and, when the
 * animatic exists, re-read from the DOM samples + pixel transition frames (measured).
 *
 * A boundary carries a SIGNATURE of the state it depends on (A tail, B head, carrier, camera); when a
 * re-composition of A or B changes that state, the boundary is dirty and must be re-directed (P3-C/K).
 * Pure (no node APIs).
 */
import type { StagePlan, StageShot } from '../stage/plan';
import type { StageProbeSample } from '../qc/stage-probes';
import { judgeTransition, type TransitionQuality } from '../qc/transition-quality';
import { seenHierarchy } from '../stage/hierarchy';
import { settleTimeOf } from '../qc/stage-probes';
import { sampleStage, massOf, timesIn } from './sampler';

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface AttentionPoint {
  t: number;
  id: string | null;
  /** Frame fractions. */
  x: number;
  y: number;
}

export interface EyeFlow {
  exit: AttentionPoint;
  entry: AttentionPoint;
  /** Distance exit → entry (frame diagonals): how far the eye must travel across the cut. */
  travel: number;
  /** Largest step of the attention point between two consecutive samples inside the cut (frame diagonals). */
  maxJump: number;
  /** The eye is led: something carries it from the exit point to the entry point (no blind jump). */
  guided: boolean;
  /** RTL reading: does the eye move with the reading direction, against it, or stay? */
  direction: 'with-reading' | 'against-reading' | 'vertical' | 'still';
  path: AttentionPoint[];
}

export type VisualChange = 'object-moved' | 'object-transformed' | 'object-disappeared' | 'object-introduced' | 'camera-moved' | 'color-changed' | 'typography-changed' | 'density-changed';

export interface BoundaryIssue {
  code: 'EMPTY_BOUNDARY' | 'BOUNDARY_VOID' | 'EYE_JUMP' | 'WORLD_RESET' | 'CONTRACT_BROKEN' | 'CARRIER_NOT_SEEN' | 'MOTION_REVERSAL' | 'CAMERA_RESET' | 'OVERLAP_TRANSITION' | 'BROKEN_CONTINUITY';
  severity: 'critical' | 'major' | 'minor';
  evidence: string;
}

export interface Boundary {
  id: string;
  index: number;
  sourceShot: string;
  targetShot: string;
  sourceSubject: string | null;
  targetSubject: string | null;
  sharedElements: string[];
  handoffElement: string | null;
  transitionType: string;
  transitionReason: string;
  t0: number;
  t1: number;
  sourceExitState: { element: string | null; x: number; y: number; scale: number; opacity: number };
  targetEntryState: { element: string | null; x: number; y: number; scale: number };
  eye: EyeFlow;
  motionDirection: { out: [number, number]; in: [number, number]; agree: boolean };
  energyOut: number;
  energyIn: number;
  cameraStateOut: { x: number; y: number; dolly: number; zoom: number };
  cameraStateIn: { x: number; y: number; dolly: number; zoom: number };
  audioAnchor: string | null;
  continuityRequirements: string[];
  /** Visual story continuity: what changed from A's settle to B's settle. */
  changes: VisualChange[];
  worldReset: boolean;
  /** Predicted (analytic) or measured (pixels) frame quality through the cut — same judge as P2-G. */
  quality: { source: 'predicted' | 'measured'; score: number; min: number; dip: number; voidSec: number; issues: TransitionQuality['issues'] };
  issues: BoundaryIssue[];
  /** 0..10: frame quality + eye flow + continuity (the boundary's own score). */
  score: number;
  signature: string;
}

/** The attention point (first read) of a sample, read with the P2 hierarchy engine. */
export function attentionAt(plan: StagePlan, shotId: string, s: StageProbeSample, prev?: StageProbeSample): AttentionPoint {
  const h = seenHierarchy(plan, shotId, s, { W: plan.W, H: plan.H, rtl: plan.rtl, prev });
  const first = h.elements.find((e) => e.kind !== 'cursor');
  if (!first) return { t: s.t, id: null, x: 0.5, y: 0.5 };
  const r = s.els.find((e) => e.id === first.id)!.rect;
  return { t: r3(s.t), id: first.id, x: r3((r.x + r.width / 2) / plan.W), y: r3((r.y + r.height / 2) / plan.H) };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }, W: number, H: number) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) / Math.hypot(W, H);

/** Which shot a film second belongs to (by the cut instant). */
function shotAt(plan: StagePlan, i: number, t: number, cut: number): StageShot {
  return t < cut ? plan.shots[i] : plan.shots[i + 1];
}

/** The cut instant of boundary i: the middle of its transition (or the shot end). */
export function cutOf(plan: StagePlan, i: number): number {
  const tr = plan.transitions.find((x) => x.from === plan.shots[i].id);
  return tr ? (tr.t0 + tr.t1) / 2 : plan.shots[i].end;
}

export interface SampleSource {
  /** Samples covering the film (DOM probes): measured eye flow. Absent → the analytic sampler. */
  samples?: StageProbeSample[] | null;
  /** Measured transition frames (transition_quality.json) — absent → predicted from the sampler. */
  transitions?: TransitionQuality[] | null;
  /** Planned energy per shot (film plan) — absent → the stage shots' energy. */
  energy?: Record<string, number>;
  /** Voice words (for the audio anchor). */
  words?: { word: string; start: number; end: number }[];
  /** Boundaries declared intentional (film plan): ids "a->b" with the reason (a deliberate reset / jump). */
  intentional?: Record<string, string>;
  /** Boundaries that carry a film-plan promise (a sequence contract, a motif becoming something): "a->b" → what. */
  contracts?: Record<string, string>;
}

function nearestSample(samples: StageProbeSample[], t: number): StageProbeSample | null {
  let best: StageProbeSample | null = null;
  for (const s of samples) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best && Math.abs(best.t - t) <= 0.09 ? best : null;
}

/** Builds the boundary between shot i and i+1. */
export function buildBoundary(plan: StagePlan, i: number, src: SampleSource = {}): Boundary {
  const A = plan.shots[i];
  const B = plan.shots[i + 1];
  const tr = plan.transitions.find((x) => x.from === A.id);
  const cut = cutOf(plan, i);
  const t0 = tr ? tr.t0 : cut - 0.15;
  const t1 = tr ? tr.t1 : cut + 0.15;
  const sample = (t: number): StageProbeSample => (src.samples ? nearestSample(src.samples, t) : null) ?? sampleStage(plan, t);
  const castA = new Set((A.cast ?? []).map((c) => c.id));
  const castB = new Set((B.cast ?? []).map((c) => c.id));
  const shared = [...castA].filter((id) => castB.has(id));
  const handoff = plan.handoffs.find((h) => castA.has(h.from) && castB.has(h.to) && h.t >= A.start - 0.5 && (h.t <= B.end || h.t < 0));
  const carrier = tr?.element ?? handoff?.from ?? shared[0] ?? null;
  // ── eye flow: attention from A's settle, through the cut, to B's settle
  const sA = settleTimeOf(plan, A.id);
  const sB = Math.min(settleTimeOf(plan, B.id), B.start + Math.max(0.6, (B.end - B.start) * 0.55));
  const exitS = sample(sA);
  const exit = attentionAt(plan, A.id, exitS, sample(sA - 0.12));
  const entryS = sample(sB);
  const entry = attentionAt(plan, B.id, entryS, sample(sB - 0.12));
  const path: AttentionPoint[] = [];
  let prev: StageProbeSample | undefined;
  for (const t of timesIn(Math.max(sA, t0 - 0.3), Math.min(sB, t1 + 0.45), 0.08)) {
    const s = sample(t);
    path.push(attentionAt(plan, shotAt(plan, i, t, cut).id, s, prev));
    prev = s;
  }
  const pts = [exit, ...path, entry];
  let maxJump = 0;
  for (let k = 1; k < pts.length; k++) if (pts[k].id && pts[k - 1].id) maxJump = Math.max(maxJump, dist(pts[k], pts[k - 1], plan.W, plan.H));
  const travel = r3(dist(exit, entry, plan.W, plan.H));
  const guided = travel < 0.12 || maxJump < 0.2;
  const dx = entry.x - exit.x;
  const dy = entry.y - exit.y;
  const direction: EyeFlow['direction'] = travel < 0.08 ? 'still' : Math.abs(dy) * plan.H > Math.abs(dx) * plan.W * 1.4 ? 'vertical' : (plan.rtl ? dx < 0 : dx > 0) ? 'with-reading' : 'against-reading';
  // ── frame quality through the cut: measured when the pixels exist, else predicted from the sampler
  let q: Boundary['quality'];
  const measured = src.transitions?.find((x) => x.from === A.id && x.to === B.id);
  if (measured) q = { source: 'measured', score: measured.score, min: measured.min, dip: measured.dip, voidSec: measured.voidSec, issues: measured.issues };
  else {
    const times = timesIn(t0 - 0.24, t1 + 0.24, 0.06);
    const ana = times.map((t) => sampleStage(plan, t));
    const curve = ana.map((s) => ({ t: s.t, occ: r3(massOf(plan, s)), lum: 0 }));
    const j = judgeTransition(tr ?? { from: A.id, to: B.id, requested: 'cut', status: 'object', kind: 'cut', t0, t1, reason: '' }, curve, ana);
    q = { source: 'predicted', score: j.score, min: j.min, dip: j.dip, voidSec: j.voidSec, issues: j.issues };
  }
  // ── motion direction: how the carrier / A's subject leaves vs how B's subject arrives
  const vel = (id: string | null, ta: number, tb: number): [number, number] => {
    if (!id) return [0, 0];
    const a = sample(ta).els.find((e) => e.id === id);
    const b = sample(tb).els.find((e) => e.id === id);
    if (!a || !b) return [0, 0];
    return [r3((b.rect.x + b.rect.width / 2 - a.rect.x - a.rect.width / 2) / plan.W), r3((b.rect.y + b.rect.height / 2 - a.rect.y - a.rect.height / 2) / plan.H)];
  };
  const outV = vel(carrier ?? A.composition.subject, t0 - 0.1, cut);
  const inV = vel(B.composition.subject, B.start, Math.min(B.end, B.start + 0.5));
  const mag = (v: [number, number]) => Math.hypot(v[0], v[1]);
  const agree = mag(outV) < 0.02 || mag(inV) < 0.02 || outV[0] * inV[0] + outV[1] * inV[1] >= 0;
  // ── visual story continuity: what changed between the two settles
  const idsA = new Set(exitS.els.filter((e) => e.opacity > 0.3).map((e) => e.id));
  const idsB = new Set(entryS.els.filter((e) => e.opacity > 0.3).map((e) => e.id));
  const changes = new Set<VisualChange>();
  const transformed = tr && tr.status === 'object' && ['morph', 'shape-transform', 'expand-to-background', 'text-mask', 'push-inside', 'depth-pass', 'follow-path'].includes(tr.kind);
  for (const id of idsA) {
    if (!idsB.has(id)) changes.add('object-disappeared');
    else {
      const a = exitS.els.find((e) => e.id === id)!.rect;
      const b = entryS.els.find((e) => e.id === id)!.rect;
      if (dist({ x: a.x / plan.W, y: a.y / plan.H }, { x: b.x / plan.W, y: b.y / plan.H }, plan.W, plan.H) > 0.03 || Math.abs(Math.log(Math.max(1, b.width) / Math.max(1, a.width))) > 0.1) changes.add('object-moved');
    }
  }
  for (const id of idsB) if (!idsA.has(id)) changes.add('object-introduced');
  if (transformed) changes.add('object-transformed');
  const camA = exitS.cam;
  const camB = entryS.cam;
  if (Math.abs(camA.zoom - camB.zoom) > 0.05 || Math.abs(camA.dolly - camB.dolly) > 0.05 || Math.hypot(camA.x - camB.x, camA.y - camB.y) > plan.W * 0.03) changes.add('camera-moved');
  if (tr?.kind === 'expand-to-background' || tr?.kind === 'text-mask') changes.add('color-changed');
  const textsA = exitS.els.filter((e) => e.kind === 'text').length;
  const textsB = entryS.els.filter((e) => e.kind === 'text').length;
  if (textsA !== textsB) changes.add('typography-changed');
  if (Math.abs(idsA.size - idsB.size) >= 2) changes.add('density-changed');
  const persisted = [...idsA].filter((id) => idsB.has(id) && id !== 'cursor.main');
  const intentional = src.intentional?.[`${A.id}->${B.id}`];
  const worldReset = !persisted.length && !transformed && !handoff && !intentional;
  // ── issues
  const issues: BoundaryIssue[] = [];
  for (const x of q.issues) {
    if (x.code === 'EMPTY_TRANSITION_FRAME') issues.push({ code: 'EMPTY_BOUNDARY', severity: x.severity, evidence: x.evidence });
    else if (x.code === 'VISUAL_VOID') issues.push({ code: 'BOUNDARY_VOID', severity: x.severity, evidence: x.evidence });
    else if (x.code === 'OVERLAP_TRANSITION' || x.code === 'BROKEN_CONTINUITY') issues.push({ code: x.code, severity: x.severity, evidence: x.evidence });
  }
  // a side of the cut left empty for long (A leaves early / B arrives late): the cut window alone cannot see it,
  // so the frame is followed from A's settle to B's settle against the lighter of the two settled frames
  const sBfull = settleTimeOf(plan, B.id);
  const ref = Math.min(massOf(plan, sampleStage(plan, sA)), massOf(plan, sampleStage(plan, sBfull)));
  let gap = 0;
  let run = 0;
  let prevT = sA;
  for (const t of timesIn(sA, sBfull, 0.06)) {
    run = massOf(plan, sampleStage(plan, t)) < ref * 0.3 ? run + (t - prevT) : 0;
    gap = Math.max(gap, run);
    prevT = t;
  }
  gap = r3(gap);
  let gapPen = 0;
  if (ref > 0.01 && gap >= 0.3 && !intentional && !issues.some((x) => x.code === 'BOUNDARY_VOID')) {
    issues.push({ code: 'BOUNDARY_VOID', severity: gap >= 0.6 ? 'major' : 'minor', evidence: `between ${A.id}'s settle and ${B.id}'s the frame holds under a third of its settled content for ${gap.toFixed(2)}s (${A.id} leaves early or ${B.id} arrives late)` });
    gapPen = gap >= 0.6 ? 2.5 : 1.2;
  }
  if (!guided && travel >= 0.28 && !intentional) issues.push({ code: 'EYE_JUMP', severity: travel >= 0.45 ? 'major' : 'minor', evidence: `the eye leaves ${A.id} on ${exit.id ?? '—'} (${exit.x}, ${exit.y}) and must find ${entry.id ?? '—'} at (${entry.x}, ${entry.y}) in ${B.id}: ${Math.round(travel * 100)}% of the diagonal with a blind jump of ${Math.round(maxJump * 100)}%` });
  if (worldReset) issues.push({ code: 'WORLD_RESET', severity: 'major', evidence: `nothing from ${A.id} persists, transforms or hands over into ${B.id}: everything disappears and everything new appears` });
  if (carrier && tr?.status === 'object' && tr.kind !== 'text-mask' && exit.id && carrier !== exit.id && !path.some((p) => p.id === carrier)) issues.push({ code: 'CARRIER_NOT_SEEN', severity: 'minor', evidence: `${tr.kind} is carried by ${carrier}, but the eye is on ${exit.id} when ${A.id} lets go: the transition happens where nobody looks` });
  if (!agree && mag(outV) > 0.05 && mag(inV) > 0.05) issues.push({ code: 'MOTION_REVERSAL', severity: 'minor', evidence: `${A.id} leaves moving (${outV.join(', ')}) and ${B.id} arrives against it (${inV.join(', ')})` });
  // ── requirements B owes A (written for the planner and the report)
  const req: string[] = [];
  if (carrier) req.push(`${carrier} stays readable until ${B.composition.subject ?? B.id} is on screen`);
  if (travel >= 0.28) req.push(`lead the eye from (${exit.x}, ${exit.y}) to (${entry.x}, ${entry.y}) — or land B's first read near the exit point`);
  if (shared.length) req.push(`shared: ${shared.join(', ')} continue (no re-entrance)`);
  if (worldReset) req.push('hand something forward (an element, a shape, a colour, a direction) — or declare the reset');
  const pen = issues.filter((x) => !['EMPTY_BOUNDARY', 'BOUNDARY_VOID', 'OVERLAP_TRANSITION', 'BROKEN_CONTINUITY'].includes(x.code)).reduce((a, x) => a + (x.severity === 'critical' ? 2.5 : x.severity === 'major' ? 1.4 : 0.6), 0);
  const score = r3(Math.max(0, Math.min(10, q.score + (guided ? 0.6 : 0) + (persisted.length || transformed ? 0.4 : 0) - pen - gapPen)));
  const word = src.words?.find((w) => w.start >= cut - 0.6 && w.start <= cut + 0.6);
  const camAt = (t: number) => sample(t).cam;
  const stOf = (id: string | null, t: number) => {
    const e = id ? sample(t).els.find((x) => x.id === id) : undefined;
    return e ? { x: r3((e.rect.x + e.rect.width / 2) / plan.W), y: r3((e.rect.y + e.rect.height / 2) / plan.H), scale: r3(e.rect.width / plan.W), opacity: r3(e.opacity) } : { x: 0.5, y: 0.5, scale: 0, opacity: 0 };
  };
  const exitState = stOf(carrier ?? A.composition.subject, t0);
  const entryState = stOf(B.composition.subject, sB);
  const b: Boundary = {
    id: `${A.id}->${B.id}`,
    index: i,
    sourceShot: A.id,
    targetShot: B.id,
    sourceSubject: A.composition.subject,
    targetSubject: B.composition.subject,
    sharedElements: shared,
    handoffElement: carrier,
    transitionType: tr?.kind ?? 'cut',
    transitionReason: tr?.reason ?? '',
    t0: r3(t0),
    t1: r3(t1),
    sourceExitState: { element: carrier ?? A.composition.subject, ...exitState },
    targetEntryState: { element: B.composition.subject, x: entryState.x, y: entryState.y, scale: entryState.scale },
    eye: { exit, entry, travel, maxJump: r3(maxJump), guided, direction, path },
    motionDirection: { out: outV, in: inV, agree },
    energyOut: r3(src.energy?.[A.id] ?? A.energy ?? 0.5),
    energyIn: r3(src.energy?.[B.id] ?? B.energy ?? 0.5),
    cameraStateOut: roundCam(camAt(t0)),
    cameraStateIn: roundCam(camAt(t1)),
    audioAnchor: word ? `word:${word.word}@${r3(word.start)}` : null,
    continuityRequirements: req,
    changes: [...changes],
    worldReset,
    quality: { ...q, score: r3(q.score), min: r3(q.min), dip: r3(q.dip), voidSec: r3(q.voidSec) },
    issues,
    score,
    signature: '',
  };
  b.signature = boundarySignature(plan, i);
  return b;
}

const roundCam = (c: { x: number; y: number; dolly: number; zoom: number }) => ({ x: Math.round(c.x), y: Math.round(c.y), dolly: r3(c.dolly), zoom: r3(c.zoom) });

/**
 * What a boundary depends on: the last 20% of A, the transition, the first 20% of B (element rects and
 * opacity sampled there, the camera) and the casts. A change in any of them changes the signature.
 */
export function boundarySignature(plan: StagePlan, i: number): string {
  const A = plan.shots[i];
  const B = plan.shots[i + 1];
  const tr = plan.transitions.find((x) => x.from === A.id);
  const tA = A.end - (A.end - A.start) * 0.2;
  const tB = B.start + (B.end - B.start) * 0.2;
  const parts: string[] = [tr ? `${tr.kind}:${tr.element ?? ''}:${tr.into ?? ''}:${tr.t0.toFixed(2)}:${tr.t1.toFixed(2)}` : 'cut', (A.cast ?? []).map((c) => `${c.id}/${c.role}`).join(','), (B.cast ?? []).map((c) => `${c.id}/${c.role}`).join(',')];
  for (const t of [tA, (tA + tB) / 2, tB]) {
    const s = sampleStage(plan, t);
    parts.push(s.sampled.map((e) => `${e.id}@${Math.round((e.rect.x + e.rect.width / 2) / plan.W * 50)},${Math.round((e.rect.y + e.rect.height / 2) / plan.H * 50)},${Math.round((e.rect.width / plan.W) * 50)},${Math.round(e.opacity * 4)}`).join(';'));
    parts.push(`cam${Math.round(s.cam.x / 20)},${Math.round(s.cam.y / 20)},${s.cam.zoom.toFixed(2)},${s.cam.dolly.toFixed(2)}`);
  }
  return hash(parts.join('|'));
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function buildBoundaries(plan: StagePlan, src: SampleSource = {}): Boundary[] {
  return plan.shots.slice(0, -1).map((_, i) => buildBoundary(plan, i, src));
}
