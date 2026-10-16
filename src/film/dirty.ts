/**
 * Dirty propagation (P3-C) + Neighborhood Repair (P3-K).
 *
 * When a shot changes, what else must be looked at again? The shot itself; every boundary whose
 * signature changed or that touches it; the persistent elements it shares with other shots (their other
 * shots); the shots whose camera state at their edges changed (the camera path); the energy neighbours.
 * A change is local only if the neighbourhood says so.
 *
 * `neighborhoodRepair` re-directs the dirty boundaries that a change made worse (or that are at risk),
 * one boundary at a time, each time re-checking the whole neighbourhood (A tail, A→B, B, B→C, C head).
 * Pure: the caller passes the compile function.
 */
import type { StagePlan } from '../stage/plan';
import { sampleStage } from './sampler';
import { buildBoundaries, buildBoundary, boundarySignature, type Boundary, type SampleSource } from './boundary';
import { boundaryAtRisk, redirectBoundary, type RedirectResult, type ScriptObj } from './transition-redirector';

const r2 = (x: number) => Math.round(x * 100) / 100;

export interface DirtyReport {
  changedShots: string[];
  dirtyShots: string[];
  dirtyBoundaries: { id: string; why: string[] }[];
  persistentElements: { element: string; shots: string[] }[];
  cameraPath: string[];
  energyNeighbours: string[];
}

const camKey = (plan: StagePlan, t: number) => {
  const c = sampleStage(plan, t).cam;
  return `${Math.round(c.x / 20)},${Math.round(c.y / 20)},${c.zoom.toFixed(2)},${c.dolly.toFixed(2)}`;
};

/** What a change of `changed` shots (before → after) makes dirty. */
export function dirtyOf(before: StagePlan, after: StagePlan, changed: string[]): DirtyReport {
  const ids = after.shots.map((s) => s.id);
  const dirtyShots = new Set(changed);
  // shots whose own timing or cast changed are dirty even if nobody named them
  for (const s of after.shots) {
    const b = before.shots.find((x) => x.id === s.id);
    if (!b || Math.abs(b.start - s.start) > 0.02 || Math.abs(b.end - s.end) > 0.02 || (b.cast ?? []).map((c) => c.id).join(',') !== (s.cast ?? []).map((c) => c.id).join(',')) dirtyShots.add(s.id);
  }
  const dirtyBoundaries: DirtyReport['dirtyBoundaries'] = [];
  for (let i = 0; i < after.shots.length - 1; i++) {
    const why: string[] = [];
    const A = after.shots[i].id;
    const B = after.shots[i + 1].id;
    if (dirtyShots.has(A)) why.push(`${A} changed (its tail)`);
    if (dirtyShots.has(B)) why.push(`${B} changed (its head)`);
    const bi = before.shots.findIndex((s) => s.id === A);
    if (bi < 0 || before.shots[bi + 1]?.id !== B) why.push('new boundary');
    else if (boundarySignature(before, bi) !== boundarySignature(after, i)) why.push('signature changed (A tail / transition / B head)');
    if (why.length) dirtyBoundaries.push({ id: `${A}->${B}`, why });
  }
  const persistentElements: DirtyReport['persistentElements'] = [];
  for (const e of after.elements) {
    if (e.shots.length < 2 || !e.shots.some((s) => dirtyShots.has(s))) continue;
    persistentElements.push({ element: e.id, shots: e.shots.filter((s) => !dirtyShots.has(s)) });
  }
  const cameraPath: string[] = [];
  for (const s of after.shots) {
    const b = before.shots.find((x) => x.id === s.id);
    if (!b) continue;
    if (camKey(before, b.start + 0.05) !== camKey(after, s.start + 0.05) || camKey(before, b.end - 0.05) !== camKey(after, s.end - 0.05)) cameraPath.push(s.id);
  }
  const energyNeighbours = [...new Set(changed.flatMap((id) => {
    const k = ids.indexOf(id);
    return [ids[k - 1], ids[k + 1]].filter((x): x is string => Boolean(x) && !changed.includes(x as string));
  }))];
  return { changedShots: changed, dirtyShots: [...dirtyShots], dirtyBoundaries, persistentElements: persistentElements.filter((p) => p.shots.length), cameraPath, energyNeighbours };
}

export interface NeighborhoodStep {
  boundary: string;
  before: number;
  after: number | null;
  move: string | null;
  why: string;
}

export interface NeighborhoodReport {
  version: 1;
  trigger: string;
  dirty: DirtyReport | null;
  boundariesBefore: { id: string; score: number; atRisk: boolean }[];
  boundariesAfter: { id: string; score: number; atRisk: boolean }[];
  steps: NeighborhoodStep[];
  redirects: Omit<RedirectResult, 'script'>[];
  changed: boolean;
  /** Local sequence: mean predicted boundary score of the touched neighbourhood, before and after. */
  local: { before: number; after: number };
}

const brief = (bs: Boundary[]) => bs.map((b) => ({ id: b.id, score: r2(b.score), atRisk: boundaryAtRisk(b) }));

/**
 * Repairs the neighbourhood of a change (or the whole film when `only` is absent): every dirty boundary
 * that is at risk or got worse than `reference` is re-directed (Transition Re-Director), best candidate
 * kept only if the neighbourhood value is a real gain. Each boundary is visited at most `maxPerBoundary`
 * times; a move that was tried is not tried again.
 */
export function neighborhoodRepair(inp: { script: ScriptObj; plan: StagePlan; compile: (s: ScriptObj) => StagePlan; src?: SampleSource; only?: string[]; reference?: StagePlan | null; changed?: string[]; trigger?: string; maxRounds?: number; minGain?: number }): { script: ScriptObj; plan: StagePlan; report: NeighborhoodReport } {
  const src: SampleSource = { energy: inp.src?.energy, words: inp.src?.words, intentional: inp.src?.intentional };
  let script = inp.script;
  let plan = inp.plan;
  const before = buildBoundaries(plan, src);
  const refScore = new Map<string, number>();
  if (inp.reference) for (const b of buildBoundaries(inp.reference, src)) refScore.set(b.id, b.score);
  const steps: NeighborhoodStep[] = [];
  const redirects: NeighborhoodReport['redirects'] = [];
  const tried = new Set<string>();
  const visits = new Map<string, number>();
  const scope = (bs: Boundary[]) => bs.filter((b) => !inp.only || inp.only.includes(b.id));
  for (let round = 0; round < (inp.maxRounds ?? 4); round++) {
    const bs = scope(buildBoundaries(plan, src));
    // worst first: at risk, or dropped against the reference (a repair broke it)
    const todo = bs
      .map((b) => ({ b, drop: refScore.has(b.id) ? refScore.get(b.id)! - b.score : 0 }))
      .filter(({ b, drop }) => (boundaryAtRisk(b) || drop > 0.5) && (visits.get(b.id) ?? 0) < 2)
      .sort((x, y) => x.b.score - x.drop - (y.b.score - y.drop));
    if (!todo.length) break;
    const { b } = todo[0];
    visits.set(b.id, (visits.get(b.id) ?? 0) + 1);
    const r = redirectBoundary(script, plan, b.index, inp.compile, src, { minGain: inp.minGain ?? 0.6, tried });
    for (const c of r.candidates) tried.add(`${b.id}:${c.move}`);
    const { script: rs, ...rest } = r;
    redirects.push(rest);
    if (!rs) {
      steps.push({ boundary: b.id, before: r2(b.score), after: null, move: null, why: r.why });
      continue;
    }
    script = rs;
    plan = inp.compile(script);
    steps.push({ boundary: b.id, before: r2(b.score), after: r2(buildBoundary(plan, b.index, src).score), move: r.chosen!.move, why: r.why });
  }
  const after = buildBoundaries(plan, src);
  const touched = new Set(steps.filter((s) => s.move).flatMap((s) => {
    const k = after.findIndex((b) => b.id === s.boundary);
    return [k - 1, k, k + 1].filter((x) => x >= 0 && x < after.length);
  }));
  const mean = (bs: Boundary[]) => (touched.size ? r2([...touched].reduce((a, k) => a + (bs[k]?.score ?? 0), 0) / touched.size) : 0);
  return {
    script,
    plan,
    report: {
      version: 1,
      trigger: inp.trigger ?? 'film pass',
      dirty: inp.reference ? dirtyOf(inp.reference, inp.plan, inp.changed ?? []) : null,
      boundariesBefore: brief(before),
      boundariesAfter: brief(after),
      steps,
      redirects,
      changed: steps.some((s) => s.move),
      local: { before: mean(before), after: mean(after) },
    },
  };
}

/** The boundaries a shot change makes dirty (ids), for scoping a neighbourhood repair. */
export function dirtyBoundaryIds(before: StagePlan, after: StagePlan, changed: string[]): string[] {
  return dirtyOf(before, after, changed).dirtyBoundaries.map((b) => b.id);
}
