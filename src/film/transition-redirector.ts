/**
 * Transition Re-Director (P3-D) + Neighborhood Repair (P3-K).
 *
 * P2 measured transitions; this re-DIRECTS a boundary when either side changed (or the cut fails):
 * it may edit the tail of A (last 10–20%), the transition, and the head of B (first 10–20%) — because
 * a cut starts before the cut and ends after it. It uses only what the Stage already has (exit / enter
 * timing, the carrying element, hold, shared element, a plain cut); no new transition types.
 *
 * Before choosing, it asks the editor's questions (recorded per boundary):
 *   1 where is the eye now?  2 where must it be after?  3 is there a shared element?
 *   4 is there motion to continue?  5 can a shape carry it?  6 can the type carry it?
 *   7 should the camera continue?  8 is a cut simpler and better?  ("a good cut beats a bad morph")
 *
 * Every candidate is PREDICTED (stage recompiled, the analytic sampler reads the boundary and its two
 * neighbours) and scored as a NEIGHBOURHOOD: A tail · A→B · B head · B→C — a fix that repairs one cut
 * by breaking the next is rejected. Pure: the caller passes the compile function.
 */
import { elementStillRun, sampleStage, timesIn } from './sampler';
import type { StagePlan } from '../stage/plan';
import { buildBoundary, type Boundary, type SampleSource } from './boundary';

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; style?: string; reason: string; [k: string]: unknown };
type ShotObj = { id: string; cast?: { id: string; role?: string }[]; motionChain: Ev[]; transitionOut?: unknown; transitionReason?: string; timing?: { duration?: number }; subject?: string; purpose?: string; [k: string]: unknown };
export type ScriptObj = { shots: ShotObj[]; stage?: { elements: { id: string; kind: string }[] }; [k: string]: unknown };

export type BoundaryMove = 'cross-hold' | 'early-entry' | 'full-head' | 'carrier-swap' | 'hold' | 'cut' | 'shared-bridge' | 'cross-hold+early-entry';
export const MOVE_COST: Record<BoundaryMove, number> = { 'cross-hold': 0.1, 'early-entry': 0.15, 'cross-hold+early-entry': 0.25, 'full-head': 0.35, hold: 0.1, 'carrier-swap': 0.35, 'shared-bridge': 0.35, cut: 0.5 };

/**
 * A boundary that needs re-direction: a measured / predicted frame problem, an eye jump, a world reset,
 * or (predicted) a cut close to emptying — the analytic model reads the white-card worlds a little
 * fuller than the pixels do, so "close" is a min under 5% with less than 65% of the calmer side.
 */
export function boundaryAtRisk(b: Boundary): boolean {
  if (b.issues.some((x) => x.severity !== 'minor' || x.code === 'EMPTY_BOUNDARY' || x.code === 'BOUNDARY_VOID' || x.code === 'EYE_JUMP')) return true;
  return b.quality.source === 'predicted' && b.quality.min < 0.05 && b.quality.dip < 0.65;
}

export interface TransitionDecision {
  eyeNow: string | null;
  eyeNext: string | null;
  shared: string[];
  continuingMotion: boolean;
  shapeCarrier: string | null;
  typeCarrier: string | null;
  cameraContinues: boolean;
  cutBetter: boolean;
  answer: string;
}

export interface BoundaryCandidate {
  move: BoundaryMove;
  label: string;
  /** What changes in the script, in words (A tail / transition / B head). */
  edits: string[];
  intentChanges: { what: string; why: string }[];
  cost: number;
  predicted?: { boundary: number; quality: number; min: number; dip: number; neighbours: { id: string; before: number; after: number }[]; eyeTravel: number; guided: boolean; value: number; issues: string[] };
  script?: ScriptObj;
}

export interface RedirectResult {
  boundary: string;
  before: Pick<Boundary, 'score' | 'quality' | 'eye' | 'issues'>;
  decision: TransitionDecision;
  candidates: Omit<BoundaryCandidate, 'script'>[];
  chosen: Omit<BoundaryCandidate, 'script'> | null;
  script: ScriptObj | null;
  why: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const trType = (s: ShotObj) => (typeof s.transitionOut === 'string' ? s.transitionOut : (s.transitionOut as { type?: string } | undefined)?.type) ?? 'cut';
const trObj = (s: ShotObj) => (typeof s.transitionOut === 'object' && s.transitionOut ? (s.transitionOut as { type: string; element?: string; into?: string; hold?: number; duration?: number }) : null);
const dur = (s: ShotObj, plan?: StagePlan) => {
  const p = plan?.shots.find((x) => x.id === s.id);
  return p ? p.end - p.start : s.timing?.duration ?? 3;
};

/** The editor's questions for one boundary (P3-D). */
export function transitionDecision(b: Boundary, plan: StagePlan, script: ScriptObj): TransitionDecision {
  const A = plan.shots[b.index];
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));
  const castA = (A.cast ?? []).map((c) => c.id);
  const shape = castA.find((id) => ['shape', 'card', 'chip', 'button'].includes(kinds.get(id) ?? '')) ?? null;
  const type = castA.find((id) => kinds.get(id) === 'text') ?? null;
  const moving = Math.hypot(...b.motionDirection.out) > 0.04;
  const camOut = b.cameraStateOut;
  const camIn = b.cameraStateIn;
  const camMoves = Math.abs(camOut.zoom - camIn.zoom) > 0.03 || Math.abs(camOut.dolly - camIn.dolly) > 0.03;
  const cutBetter = !b.sharedElements.length && !moving && b.quality.score < 5 && b.transitionType !== 'cut';
  const answer = b.sharedElements.length
    ? `continue ${b.sharedElements[0]} (shared)`
    : moving
      ? `carry the motion of ${b.handoffElement ?? b.sourceSubject} into ${b.targetSubject}`
      : cutBetter
        ? 'a clean cut: nothing on screen can carry this cut without emptying the frame'
        : `keep ${b.transitionType}, carried by what the eye is on (${b.eye.exit.id ?? '—'})`;
  return { eyeNow: b.eye.exit.id, eyeNext: b.eye.entry.id, shared: b.sharedElements, continuingMotion: moving, shapeCarrier: shape, typeCarrier: type, cameraContinues: camMoves, cutBetter, answer };
}

/** Candidate moves for boundary i (script edits only; prediction is done by `redirectBoundary`). */
export function boundaryCandidates(script: ScriptObj, plan: StagePlan, b: Boundary): BoundaryCandidate[] {
  const i = b.index;
  const A = script.shots[i];
  const B = script.shots[i + 1];
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));
  const tr = trObj(A);
  const type = trType(A);
  const castA = (A.cast ?? []).map((c) => c.id);
  const castB = new Set((B.cast ?? []).map((c) => c.id));
  const out: BoundaryCandidate[] = [];
  const dA = dur(A, plan);
  const carried = tr?.element;
  // A tail: what leaves A stays until the cut (it fades over the cut instead of before it)
  const leaving = castA.filter((id) => !castB.has(id) && id !== carried && kinds.get(id) !== 'cursor');
  // (a leaving text clears its place a little earlier when B brings a text of its own: two lines never fight)
  const bText = [...castB].some((id) => kinds.get(id) === 'text' && !castA.includes(id));
  const crossHold = (s: ScriptObj) => {
    const a = s.shots[i];
    for (const id of leaving) {
      const ev = a.motionChain.find((e) => e.element === id && e.action === 'exit');
      const at = Math.round((dA - (bText && kinds.get(id) === 'text' ? 0.4 : 0.14)) * 100) / 100;
      if (ev) {
        ev.at = at;
        delete ev.after;
      } else a.motionChain.push({ element: id, action: 'exit', at, style: 'fade', reason: `P3 boundary ${b.id}: leaves over the cut, so the frame is held until ${B.id} arrives` });
    }
  };
  // B head: B's first read (and subject) arrive on the cut, not after it
  const firstB = [...new Set([b.eye.entry.id, b.targetSubject].filter((x): x is string => Boolean(x && castB.has(x) && !castA.includes(x))))];
  const brokenAfter: string[] = [];
  const earlyEntry = (s: ScriptObj) => {
    const bb = s.shots[i + 1];
    for (const id of firstB) {
      const ev = bb.motionChain.find((e) => e.element === id && e.action === 'enter');
      if (ev) {
        if (ev.after) brokenAfter.push(`${id} entered after "${ev.after}"`);
        ev.at = 0;
        delete ev.after;
      } else bb.motionChain.push({ element: id, action: 'enter', at: 0, reason: `P3 boundary ${b.id}: the next first read is already arriving on the cut` });
    }
  };
  // B head, fully: everything B introduces is on screen from the cut (in reading order), even what was
  // timed to follow something else — B's causality is traded for a carried frame, and declared
  const allB = (B.cast ?? []).map((c) => c.id).filter((id) => !castA.includes(id) && kinds.get(id) !== 'cursor' && !firstB.includes(id));
  if (allB.length && (B.motionChain ?? []).some((e) => allB.includes(e.element) && e.action === 'enter' && e.after)) {
    const s = clone(script);
    earlyEntry(s);
    const bb = s.shots[i + 1];
    const broke: string[] = [];
    allB.forEach((id, n) => {
      const ev = bb.motionChain.find((e) => e.element === id && e.action === 'enter');
      if (ev?.after) broke.push(`${id} after "${ev.after}"`);
      if (ev) {
        ev.at = Math.round(0.12 * (n + 1) * 100) / 100;
        delete ev.after;
      } else bb.motionChain.push({ element: id, action: 'enter', at: Math.round(0.12 * (n + 1) * 100) / 100, reason: `P3 boundary ${b.id}: on screen from the cut` });
    });
    out.push({ move: 'full-head', label: `all of ${B.id} is on screen from the cut (${[...firstB, ...allB].join(', ')})`, edits: [`B head (${B.id}): ${[...firstB, ...allB].join(', ')} enter from 0s, 0.12s apart`], intentChanges: broke.length ? [{ what: 'causality of the entrances', why: `${broke.join('; ')} — the items arrive with the cut instead of one by one, so the frame never empties` }] : [], cost: MOVE_COST['full-head'] + (broke.length ? 0.15 : 0), script: s });
  }
  if (leaving.length) {
    const s = clone(script);
    crossHold(s);
    out.push({ move: 'cross-hold', label: `hold ${leaving.join(', ')} until the cut`, edits: [`A tail (${A.id}): ${leaving.join(', ')} exit at ${(dA - 0.14).toFixed(2)}s`], intentChanges: [], cost: MOVE_COST['cross-hold'], script: s });
  }
  if (firstB.length) {
    const s = clone(script);
    brokenAfter.length = 0;
    earlyEntry(s);
    const ic = brokenAfter.length ? [{ what: 'causality of the entrance', why: `${brokenAfter.join('; ')} — it now lands on the cut so the frame is carried` }] : [];
    out.push({ move: 'early-entry', label: `${firstB.join(', ')} arrive on the cut`, edits: [`B head (${B.id}): ${firstB.join(', ')} enter at 0s`], intentChanges: ic, cost: MOVE_COST['early-entry'] + (ic.length ? 0.15 : 0), script: s });
    if (leaving.length) {
      const s2 = clone(script);
      crossHold(s2);
      brokenAfter.length = 0;
      earlyEntry(s2);
      out.push({ move: 'cross-hold+early-entry', label: 'A holds and B arrives on the cut (a cross-hold)', edits: [`A tail: ${leaving.join(', ')} exit at the cut`, `B head: ${firstB.join(', ')} enter at 0s`], intentChanges: ic, cost: MOVE_COST['cross-hold+early-entry'] + (ic.length ? 0.15 : 0), script: s2 });
    }
  }
  // the carrier: the transition happens on what the eye is on
  const eyeEl = b.eye.exit.id;
  if (tr && eyeEl && eyeEl !== tr.element && castA.includes(eyeEl) && !castB.has(eyeEl)) {
    const k = kinds.get(eyeEl) ?? '';
    const ok = (type === 'morph' && ['shape', 'icon', 'chip', 'card', 'button'].includes(k)) || (type === 'shape-transform' && !['image', 'ui'].includes(k)) || type === 'depth-pass';
    if (ok) {
      const s = clone(script);
      (s.shots[i].transitionOut as { element: string }).element = eyeEl;
      out.push({ move: 'carrier-swap', label: `${type} carried by ${eyeEl} (where the eye is) instead of ${tr.element}`, edits: [`transition ${A.id}→${B.id}: element ${tr.element} → ${eyeEl}`], intentChanges: [{ what: 'transition carrier', why: `the viewer is looking at ${eyeEl} when ${A.id} lets go; the ${type} keeps its meaning with the element that is seen` }], cost: MOVE_COST['carrier-swap'], script: s });
    }
  }
  if (tr && (type === 'depth-pass' || type === 'text-mask') && (tr.hold ?? 0) < 0.6) {
    const s = clone(script);
    (s.shots[i].transitionOut as { hold: number }).hold = Math.min(0.8, (tr.hold ?? 0) + 0.3);
    out.push({ move: 'hold', label: `${tr.element} keeps its ink ${(Math.min(0.8, (tr.hold ?? 0) + 0.3)).toFixed(2)}s longer`, edits: [`transition hold ${tr.hold ?? 0} → ${Math.min(0.8, (tr.hold ?? 0) + 0.3).toFixed(2)}`], intentChanges: [], cost: MOVE_COST.hold, script: s });
  }
  // a shared bridge: something on screen in A that B also casts continues instead
  const bridge = castA.find((id) => castB.has(id) && kinds.get(id) !== 'cursor' && id !== 'logo.brand');
  if (bridge && type !== 'shared') {
    const s = clone(script);
    s.shots[i].transitionOut = { type: 'shared', element: bridge };
    out.push({ move: 'shared-bridge', label: `${bridge} continues across the cut (shared)`, edits: [`transition ${type} → shared (${bridge})`], intentChanges: [{ what: 'transition', why: `${type} → shared: ${bridge} is in both shots — continuity by the element itself` }], cost: MOVE_COST['shared-bridge'], script: s });
  }
  if (type !== 'cut' && type !== 'shared') {
    const s = clone(script);
    s.shots[i].transitionOut = { type: 'cut', hard: true };
    out.push({ move: 'cut', label: `a clean cut instead of ${type}`, edits: [`transition ${type} → cut (everything leaving holds to the cut frame, everything arriving is there on it)`], intentChanges: [{ what: 'transition', why: `${type} empties the frame here; a good cut beats a bad ${type}` }], cost: MOVE_COST.cut, script: s });
  }
  return out;
}

/** Seconds around cut i during which a text of A and a text of B (both readable) overlap by more than 20%. */
export function textClash(plan: StagePlan, i: number): number {
  const A = plan.shots[i];
  const B = plan.shots[i + 1];
  const kind = new Map(plan.elements.map((e) => [e.id, e.kind]));
  const inA = new Set((A.cast ?? []).map((c) => c.id));
  const inB = new Set((B.cast ?? []).map((c) => c.id));
  let sec = 0;
  for (const t of timesIn(A.end - 0.5, B.start + 0.7, 0.05)) {
    const els = sampleStage(plan, t).sampled.filter((e) => kind.get(e.id) === 'text' && e.opacity > 0.5);
    const a = els.filter((e) => inA.has(e.id) && !inB.has(e.id));
    const b = els.filter((e) => inB.has(e.id) && !inA.has(e.id));
    const hit = a.some((x) =>
      b.some((y) => {
        const ix = Math.max(0, Math.min(x.rect.x + x.rect.width, y.rect.x + y.rect.width) - Math.max(x.rect.x, y.rect.x));
        const iy = Math.max(0, Math.min(x.rect.y + x.rect.height, y.rect.y + y.rect.height) - Math.max(x.rect.y, y.rect.y));
        return (ix * iy) / Math.max(1, Math.min(x.rect.width * x.rect.height, y.rect.width * y.rect.height)) > 0.2;
      }),
    );
    if (hit) sec += 0.05;
  }
  return Math.round(sec * 100) / 100;
}

/**
 * Re-directs boundary i: predicts every candidate on the neighbourhood (i-1, i, i+1) and keeps the one
 * with the best value = Δ(local boundary scores) − cost, if it is a real gain. `compile` recompiles the
 * stage from a script (same timing / voice / canvas).
 */
export function redirectBoundary(script: ScriptObj, plan: StagePlan, i: number, compile: (s: ScriptObj) => StagePlan, src: SampleSource = {}, opts: { minGain?: number; tried?: Set<string> } = {}): RedirectResult {
  const b = buildBoundary(plan, i, src);
  const decision = transitionDecision(b, plan, script);
  const nb = [i - 1, i, i + 1].filter((k) => k >= 0 && k < plan.shots.length - 1);
  // the neighbourhood "before" uses the same (predicted) model as the candidates, so the comparison is fair
  const beforePred = new Map(nb.map((k) => [k, buildBoundary(plan, k, { energy: src.energy, words: src.words, intentional: src.intentional }).score]));
  // a cut that carries a film-plan promise (a contract, a motif becoming the next thing) keeps its carrier:
  // only the timing around it may change (the film plan outranks a local gain)
  const promise = src.contracts?.[b.id];
  const cands = boundaryCandidates(script, plan, b).filter((c) => !opts.tried?.has(`${b.id}:${c.move}`) && !(promise && ['cut', 'carrier-swap', 'shared-bridge'].includes(c.move)));
  if (promise) decision.answer += ` · the film plan protects this cut (${promise}): its carrier stays`;

  // the shots' own choreography, camera left out: a move may not buy a carried cut by turning A's tail or
  // B's body into one long still (it reads fine with a camera and like a slide without one, P3-S)
  const stillBefore = [i, i + 1].map((k) => elementStillRun(plan, k));
  for (const c of cands) {
    let p: StagePlan;
    try {
      p = compile(c.script!);
    } catch (e) {
      c.predicted = { boundary: 0, quality: 0, min: 0, dip: 0, neighbours: [], eyeTravel: 0, guided: false, value: -9, issues: [`does not compile: ${(e as Error).message.slice(0, 120)}`] };
      continue;
    }
    const after = nb.map((k) => ({ k, b: buildBoundary(p, k, { energy: src.energy, words: src.words, intentional: src.intentional }) }));
    const me = after.find((x) => x.k === i)!.b;
    const neighbours = after.map((x) => ({ id: x.b.id, before: Math.round(beforePred.get(x.k)! * 100) / 100, after: Math.round(x.b.score * 100) / 100 }));
    // local sequence gain: this boundary counts double; a neighbour that drops counts double too
    const gain = neighbours.reduce((a, n) => {
      const d = n.after - n.before;
      return a + (n.id === b.id ? 2 * d : d < 0 ? 2 * d : 0.5 * d);
    }, 0);
    // two readable lines fighting for one place around the cut is worse than a thin frame
    const clash = textClash(p, i);
    const stillAfter = [i, i + 1].map((k) => elementStillRun(p, k));
    const stilled = stillAfter.reduce((a, s2, j) => a + Math.max(0, s2 - Math.max(stillBefore[j], 1.2)), 0);
    const value = Math.round((gain - c.cost * 2 - (clash >= 0.1 ? 3 : 0) - stilled * 2) * 100) / 100;
    const issues = me.issues.map((x) => x.code as string);
    if (stilled > 0.05) issues.push('CHOREOGRAPHY_COLLAPSED');
    // past the dead-hold line (P0: > 1.6 s with nothing moving) it is not a cost, it is a veto
    const dead = stillAfter.some((s2, j) => s2 > 1.6 && s2 > stillBefore[j] + 0.3);
    if (dead) issues.push('CREATES_DEAD_HOLD');
    if (clash >= 0.1 && !issues.includes('OVERLAP_TRANSITION')) issues.push('OVERLAP_TRANSITION');
    c.predicted = { boundary: Math.round(me.score * 100) / 100, quality: me.quality.score, min: me.quality.min, dip: me.quality.dip, neighbours, eyeTravel: me.eye.travel, guided: me.eye.guided, value: dead ? Math.min(value, -1) : value, issues };
  }
  const ranked = cands.filter((c) => c.predicted && c.predicted.value > (opts.minGain ?? 0.6)).sort((a, b2) => b2.predicted!.value - a.predicted!.value);
  const best = ranked[0] ?? null;
  const strip = (c: BoundaryCandidate) => {
    const { script: _s, ...rest } = c;
    void _s;
    return rest;
  };
  return {
    boundary: b.id,
    before: { score: b.score, quality: b.quality, eye: b.eye, issues: b.issues },
    decision,
    candidates: cands.map(strip),
    chosen: best ? strip(best) : null,
    script: best?.script ?? null,
    why: best ? `${best.label}: boundary ${b.score.toFixed(1)} → ${best.predicted!.boundary.toFixed(1)} (predicted), neighbourhood value ${best.predicted!.value}` : cands.length ? `no candidate improves the neighbourhood enough (best value ${Math.max(...cands.map((c) => c.predicted?.value ?? -9)).toFixed(2)})` : 'nothing to try',
  };
}
