/**
 * P4.5 — Dynamic Shot Re-Design (node side). Runs inside the P4 tournament, right after a problem was judged:
 *
 *   motion candidates that failed → failure diagnosis → spatial / layout-related? → promising (motion value
 *   above the kept version)? → 2–3 layout candidates each (Re-Layout Budget) → Stage 1 geometry (no render)
 *   → Stage 2 preview of the best 1–2 only → measure → Shot Re-Design Gate → select the best motion + layout
 *   pair, or keep the P4 result (NO_REDESIGN_IMPROVEMENT).
 *
 * A composition failure of the version that won / was kept (the hero is one of a row, too small for its action,
 * the frame too dense) is a source too: the same motion, re-laid out. A motion failure (no spatial conflict,
 * lower numbers) is never re-laid out. Every layout tried is remembered (art_memory.json "layouts") so the
 * same motion family + strategy that failed for the same reason on the same shot type / aspect is not tried
 * again. Writes shot_redesign.json (through the caller). Disabled with NITAAQ_NO_SHOT_REDESIGN=1 (= P4 exactly).
 */
import type { VideoSpec } from '../schema/video';
import type { StagePlan, StageTransition } from '../stage/plan';
import type { FilmPlan } from '../film/film-plan';
import type { ScriptObj } from '../film/transition-redirector';
import type { SampleSource } from '../film/boundary';
import { buildBoundaries } from '../film/boundary';
import type { ArtProblem } from '../art/director';
import { judgeCandidate, type PreviewFrame, type PreviewMeasure, type Verdict } from '../art/judge';
import type { CandidateRecord, ProblemRecord } from '../art/tournament';
import { buildEnergy } from '../art/energy';
import { log } from '../core/logger';
import {
  spatialDiagnosis,
  relayoutEligible,
  motionValueOf,
  layoutCandidates,
  geometryCheck,
  heroDominanceTimeline,
  attentionCorridor,
  redesignGate,
  contentPreserved,
  layoutMemoryExclude,
  rememberLayout,
  aspectOf,
  textFonts,
  type LayoutMemoryEntry,
  type SpatialDiagnosis,
  type RedesignEvidence,
  type HeroDominanceTimeline,
} from '../art/shot-redesigner';

export const redesignOn = () => process.env.NITAAQ_NO_SHOT_REDESIGN !== '1' && process.env.NITAAQ_NO_ART_DIRECTOR !== '1';

/** Problem kinds whose shot can be re-laid out (a cut / the global level never are). */
const KINDS = new Set(['hook', 'climax', 'focus', 'subjects', 'choreography', 'cta', 'layout']);
/** Composition failures of the kept / winning version that call for a re-layout of the same motion. */
const COMPOSITION_CODES = ['SUPPORTING_ELEMENTS_DOMINATE', 'HERO_TOO_SMALL_FOR_ACTION', 'LAYOUT_TOO_DENSE', 'NO_EXPANSION_SPACE', 'NO_NEGATIVE_SPACE'];

export interface RedesignLog {
  version: 1;
  problems: {
    problem: string;
    shot: string;
    sources: { candidate: string; motionValue: number; reference: number; failure: string; diagnosis: Pick<SpatialDiagnosis, 'codes' | 'spatial' | 'motionFailure' | 'why'>; eligible: boolean; why: string }[];
    layouts: { id: string; source: string; strategy: string; why: string; geometry: { pass: boolean; issues: string[]; fit: number; codes: string[]; textScale: number; dominance: { movement: number; impact: number; settle: number } }; status: 'geometry-rejected' | 'not-previewed' | 'previewed' | 'accepted' | 'rejected' | 'compile-failed' | 'memory-skip'; preview?: { score: number; veto: string | null; midMotion: number; clash: number }; gate?: { accept: boolean; failed: string[] }; cost?: { frames: number; ms: number; cached: number } }[];
    reference: { id: string; score: number; fit: number | null; dominance: { movement: number; impact: number; settle: number } | null };
    outcome: 'REDESIGN_ACCEPTED' | 'NO_REDESIGN_IMPROVEMENT' | 'NOT_ELIGIBLE';
    winner: string | null;
    why: string;
    ms: { geometry: number; preview: number };
  }[];
  memory: LayoutMemoryEntry[];
  totals: { motionSources: number; eligible: number; layoutCandidates: number; geometryPassed: number; previewed: number; accepted: number; rescued: number; geometryMs: number; previewMs: number; previewFrames: number; cacheHits: number };
}

type Live = { id: string; label: string; why: string; script: ScriptObj; film: FilmPlan | null; plan: StagePlan; predicted: Verdict | null; preview: Verdict | null; measure?: PreviewMeasure; frames?: PreviewFrame[]; rec: CandidateRecord };
type PreviewFn = (spec: VideoSpec, projectDir: string, plan: StagePlan, range: [number, number], o: { tag: string; step?: number; transition?: StageTransition; items?: string[]; headline?: string; handover?: { from: string; to: string } }) => Promise<{ measure: PreviewMeasure; frames: number; rendered: number; cached: number; ms: number; pf: PreviewFrame[] }>;

export interface RedesignInput {
  spec: VideoSpec;
  projectDir: string;
  problem: Omit<ArtProblem, 'candidates'>;
  rec: ProblemRecord;
  live: Live[];
  winner: Live | null;
  base: { measure: PreviewMeasure; pf: PreviewFrame[] };
  baseScore: number;
  basePredicted: number;
  cur: ScriptObj;
  curPlan: StagePlan;
  curFilm: FilmPlan | null;
  compile: (s: ScriptObj, f: FilmPlan | null) => StagePlan;
  src: SampleSource;
  memory: { layouts?: LayoutMemoryEntry[] };
  trOf: (pl: StagePlan) => StageTransition | undefined;
  handoverOf: (s: ScriptObj) => { from: string; to: string } | undefined;
  stepOf: number;
  log: RedesignLog;
  /** injected so the module stays testable (defaults to the art director's preview render). */
  preview?: PreviewFn;
  budget?: { sources?: number; layouts?: number; previews?: number };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const domOf = (d: HeroDominanceTimeline | null) => (d ? { movement: d.movement.share, impact: d.impact.share, settle: d.settle.share } : null);

/** The shot of a problem that the re-layout works on. */
function shotIndexOf(p: Omit<ArtProblem, 'candidates'>, script: ScriptObj): number {
  const ids = script.shots.map((s) => s.id);
  if (p.kind === 'cta') return ids.indexOf(p.shots[p.shots.length - 1]);
  return ids.indexOf(p.shots[0]);
}

/** Boundary scores (predicted) of the cuts into and out of shot k. */
function boundariesAround(plan: StagePlan, src: SampleSource, k: number): number | undefined {
  const bs = buildBoundaries(plan, src);
  const near = bs.filter((b) => b.index === k - 1 || b.index === k).map((b) => b.score);
  return near.length ? Math.min(...near) : undefined;
}

export async function redesignProblem(x: RedesignInput): Promise<{ winner: Live | null; why: string; rendered: number; frames: number; ms: number; cached: number }> {
  const none = { winner: null, why: '', rendered: 0, frames: 0, ms: 0, cached: 0 };
  const p = x.problem;
  if (!KINDS.has(p.kind)) return none;
  const k = shotIndexOf(p, x.cur);
  if (k < 0) return none;
  const shot = x.cur.shots[k];
  const preview = x.preview ?? ((await import('./art-director')).previewRender as unknown as PreviewFn);
  const budget = { sources: 2, layouts: 3, previews: 2, ...(x.budget ?? {}) };
  const tg0 = Date.now();
  const ref = x.winner;
  const refScript = ref?.script ?? x.cur;
  const refPlan = ref?.plan ?? x.curPlan;
  const refScore = ref?.preview?.score ?? x.baseScore;
  const refMeasure = ref?.measure ?? x.base.measure;
  const refFrames = ref?.frames ?? x.base.pf;
  const hero = (shot.cast ?? []).find((c) => c.role === 'hero')?.id ?? '';
  const group = (pl: StagePlan) => pl.elements.filter((e) => e.parent === hero).map((e) => e.id);
  const W = x.curPlan.W;
  const H = x.curPlan.H;
  const aspect = aspectOf(W, H);
  const brand = String(((x.cur as { motionLanguage?: { id?: string } }).motionLanguage?.id) ?? 'brand');
  const shotType = String((shot as { purpose?: string }).purpose ?? p.kind);
  const entry: RedesignLog['problems'][number] = { problem: p.id, shot: shot.id, sources: [], layouts: [], reference: { id: ref?.id ?? 'kept', score: refScore, fit: null, dominance: null }, outcome: 'NOT_ELIGIBLE', winner: null, why: '', ms: { geometry: 0, preview: 0 } };
  x.log.problems.push(entry);
  // ── 1. the sources: failed motion candidates (diagnosed), and the reference itself when its composition fails
  type Src = { id: string; label: string; script: ScriptObj; film: FilmPlan | null; plan: StagePlan; value: number; codes: string[] };
  const sources: Src[] = [];
  for (const l of x.live) {
    if (ref && l.id === ref.id) continue;
    const v = l.preview ?? l.predicted;
    if (!v) continue;
    const veto = l.preview?.veto ?? l.predicted?.veto ?? null;
    const mm = l.measure?.midMotion.failures.map((f) => f.what) ?? [];
    const lostOnClash = (v.parts.clash ?? 0) < -0.2 || (v.parts.midMotion ?? 0) < 0;
    const failure = veto || mm.length || lostOnClash ? (veto ?? (mm[0] || 'clash penalty')) : '';
    const value = motionValueOf(v.parts, v.score);
    const reference = l.preview ? refScore : ref?.predicted?.score ?? x.basePredicted;
    const scoreGap = v.score - reference;
    let diag: SpatialDiagnosis;
    try {
      diag = spatialDiagnosis(l.script, l.plan, k, { failure: { veto, midMotion: mm, scoreGap } });
    } catch {
      continue;
    }
    x.log.totals.motionSources++;
    // only a failure the tournament saw can be rescued; a candidate that lost on its own motion is a motion failure
    const d2 = failure ? diag : { ...diag, spatial: false, motionFailure: scoreGap < 0 || diag.motionFailure, why: scoreGap < 0 ? 'lost on its motion numbers (no veto, no collision): a motion failure, not a layout one' : 'no failure to rescue' };
    const el = relayoutEligible({ motionValue: value, keptValue: reference, veto, midMotion: mm, diagnosis: d2 });
    entry.sources.push({ candidate: l.id, motionValue: value, reference, failure: failure || '—', diagnosis: { codes: d2.codes, spatial: d2.spatial, motionFailure: d2.motionFailure, why: d2.why }, eligible: el.eligible, why: el.why });
    if (el.eligible) sources.push({ id: l.id, label: l.label, script: l.script, film: l.film, plan: l.plan, value, codes: d2.codes });
  }
  // the reference version: a composition failure of the shot itself (hero one of a row, too small, too dense)
  const refGeo = geometryCheck(refScript, refPlan, k, { plan: refPlan });
  entry.reference.fit = refGeo.fit.score;
  const compCodes = refGeo.diagnosis.codes.filter((c) => COMPOSITION_CODES.includes(c));
  const compFail = compCodes.length > 0 && ['climax', 'focus', 'subjects', 'layout'].includes(p.kind);
  entry.sources.push({ candidate: ref?.id ?? 'kept', motionValue: refScore, reference: refScore, failure: compFail ? compCodes.join(', ') : '—', diagnosis: { codes: refGeo.diagnosis.codes, spatial: refGeo.diagnosis.spatial, motionFailure: false, why: refGeo.diagnosis.why }, eligible: compFail, why: compFail ? `the composition of the current version fails the action: ${compCodes.join(', ')}` : 'the current composition serves its motion: not touched' });
  if (compFail) sources.push({ id: ref?.id ?? 'kept', label: ref?.label ?? 'current', script: refScript, film: ref?.film ?? x.curFilm, plan: refPlan, value: refScore + 0.01, codes: compCodes });
  sources.sort((a, b) => b.value - a.value);
  const use = sources.slice(0, budget.sources);
  x.log.totals.eligible += use.length;
  if (!use.length) {
    entry.why = entry.sources.some((s) => s.diagnosis.motionFailure) ? 'the failures are motion failures, not layout: nothing re-laid out' : 'no motion candidate failed for a spatial reason and the composition serves the shot';
    entry.ms.geometry = Date.now() - tg0;
    x.log.totals.geometryMs += entry.ms.geometry;
    return none;
  }
  // ── 2. layout candidates + Stage 1 geometry (no render)
  const refFonts = textFonts(refPlan, refPlan.elements.filter((e) => e.kind === 'text').map((e) => e.id));
  type LC = { id: string; source: Src; strategy: string; why: string; script: ScriptObj; plan: StagePlan; fit: number; geo: ReturnType<typeof geometryCheck> };
  const pass: LC[] = [];
  for (const src of use) {
    const exclude = layoutMemoryExclude(x.memory.layouts, { motionCandidate: src.id, shotType, aspectRatio: aspect, spatialFailure: src.codes });
    const lcs = layoutCandidates(src.script, src.plan, k, { max: budget.layouts, exclude, tag: src.id === (ref?.id ?? 'kept') ? undefined : src.id.replace(/[^a-z0-9]+/gi, '-').slice(0, 24) });
    for (const ex of exclude) entry.layouts.push({ id: `${ex}@${src.id}`, source: src.id, strategy: ex, why: 'skipped: the same motion family + strategy failed for the same reason before (memory)', geometry: { pass: false, issues: [], fit: 0, codes: [], textScale: 1, dominance: { movement: 0, impact: 0, settle: 0 } }, status: 'memory-skip' });
    for (const c of lcs) {
      x.log.totals.layoutCandidates++;
      let plan: StagePlan;
      try {
        plan = x.compile(c.script, src.film);
      } catch (e) {
        entry.layouts.push({ id: c.id, source: src.id, strategy: c.strategy, why: c.why, geometry: { pass: false, issues: [(e as Error).message.slice(0, 160)], fit: 0, codes: [], textScale: 1, dominance: { movement: 0, impact: 0, settle: 0 } }, status: 'compile-failed' });
        continue;
      }
      const geo = geometryCheck(c.script, plan, k, { plan: refPlan, fonts: refFonts });
      const preserved = contentPreserved(refScript, c.script);
      if (!preserved.ok) geo.issues.push(`content lost: ${preserved.lost.join(', ')}`);
      const ok = geo.pass && preserved.ok && geo.fit.score >= refGeo.fit.score - 0.3;
      if (!ok && geo.pass) geo.issues.push(`fit ${geo.fit.score} under the current ${refGeo.fit.score}`);
      entry.layouts.push({ id: c.id, source: src.id, strategy: c.strategy, why: c.why, geometry: { pass: ok, issues: geo.issues, fit: geo.fit.score, codes: geo.diagnosis.codes, textScale: geo.minTextScale, dominance: domOf(geo.dominance)! }, status: ok ? 'not-previewed' : 'geometry-rejected' });
      if (ok) {
        x.log.totals.geometryPassed++;
        pass.push({ id: c.id, source: src, strategy: c.strategy, why: c.why, script: c.script, plan, fit: geo.fit.score, geo });
      } else x.memory.layouts = rememberLayout(x.memory.layouts ?? [], { motionCandidate: src.id, layoutCandidate: c.strategy, spatialFailure: geo.diagnosis.codes.length ? geo.diagnosis.codes : ['GEOMETRY'], successfulLayout: false, brand, shotType, aspectRatio: aspect, why: geo.issues.join('; ').slice(0, 200) });
    }
  }
  entry.ms.geometry = Date.now() - tg0;
  x.log.totals.geometryMs += entry.ms.geometry;
  // ── 3. Stage 2: preview only the best 1–2 (motion value first, then the geometry fit)
  const toRender = [...pass].sort((a, b) => b.source.value - a.source.value || b.fit - a.fit).slice(0, budget.previews);
  const tp0 = Date.now();
  let rendered = 0;
  let framesN = 0;
  let cached = 0;
  const refDom = heroDominanceTimeline(refFrames, hero, W, H, { group: group(refPlan) });
  entry.reference.dominance = domOf(refDom);
  const refEv: RedesignEvidence = { veto: null, score: refScore, fit: refGeo.fit.score, dominance: refDom, minTextPx: refMeasure.readability.minTextPx, midMotion: refMeasure.midMotion.frames, clash: refMeasure.clash.worst, presenceOk: true, boundary: boundariesAround(refPlan, x.src, k) };
  const refIssues = buildEnergy(refScript, refPlan).report.issues.map((s) => s.split(':')[0]);
  const accepted: { lc: LC; v: Verdict; pr: Awaited<ReturnType<PreviewFn>> }[] = [];
  for (const lc of toRender) {
    const pr = await preview(x.spec, x.projectDir, lc.plan, p.range, { tag: `${p.id}-${lc.id}`.replace(/[^a-z0-9-]/gi, '_'), step: x.stepOf, transition: x.trOf(lc.plan), items: p.items, headline: p.headline, handover: x.handoverOf(lc.script) });
    rendered += pr.rendered;
    framesN += pr.frames;
    cached += pr.cached;
    x.log.totals.previewed++;
    x.log.totals.previewFrames += pr.frames;
    x.log.totals.cacheHits += pr.cached;
    const v = judgeCandidate(p.kind, pr.measure, x.base.measure);
    const dom = heroDominanceTimeline(pr.pf, hero, W, H, { group: group(lc.plan) });
    const att = attentionCorridor(pr.pf, W, H);
    const issues = buildEnergy(lc.script, lc.plan).report.issues.map((s) => s.split(':')[0]);
    const ev: RedesignEvidence = { veto: v.veto, score: v.score, fit: r2(lc.fit * 0.8 + att.score * 0.2), dominance: dom, minTextPx: pr.measure.readability.minTextPx, midMotion: pr.measure.midMotion.frames, clash: pr.measure.clash.worst, presenceOk: !/INFORMATION_DROPPED/.test(v.veto ?? ''), boundary: boundariesAround(lc.plan, x.src, k), sequenceOk: issues.filter((c) => !refIssues.includes(c)).length === 0 };
    const mode = lc.source.id === (ref?.id ?? 'kept') ? 'composition' : 'rescue';
    const gate = redesignGate(ev, { ...refEv, fit: r2(refGeo.fit.score * 0.8 + attentionCorridor(refFrames, W, H).score * 0.2) }, { preserved: contentPreserved(refScript, lc.script), minTextScale: lc.geo.minTextScale, mode });
    const row = entry.layouts.find((r) => r.id === lc.id)!;
    row.status = gate.accept ? 'accepted' : 'rejected';
    row.preview = { score: v.score, veto: v.veto, midMotion: pr.measure.midMotion.frames, clash: pr.measure.clash.worst };
    row.gate = { accept: gate.accept, failed: gate.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) };
    row.cost = { frames: pr.frames, ms: pr.ms, cached: pr.cached };
    x.memory.layouts = rememberLayout(x.memory.layouts ?? [], { motionCandidate: lc.source.id, layoutCandidate: lc.strategy, spatialFailure: gate.accept ? [] : lc.geo.diagnosis.codes.length ? lc.geo.diagnosis.codes : gate.checks.filter((c) => !c.ok).map((c) => c.name.toUpperCase().replace(/\s+/g, '_')), successfulLayout: gate.accept, brand, shotType, aspectRatio: aspect, why: gate.accept ? `${v.score} > ${refScore}` : row.gate.failed.join('; ').slice(0, 200) });
    if (gate.accept) accepted.push({ lc, v, pr });
  }
  entry.ms.preview = Date.now() - tp0;
  x.log.totals.previewMs += entry.ms.preview;
  x.log.memory = x.memory.layouts ?? [];
  if (!accepted.length) {
    entry.outcome = 'NO_REDESIGN_IMPROVEMENT';
    entry.why = toRender.length ? `no re-layout passed the Shot Re-Design Gate: the P4 version stays (${entry.layouts.filter((l) => l.gate && !l.gate.accept).map((l) => `${l.id}: ${l.gate!.failed[0] ?? ''}`).join(' | ')})` : `no layout passed the geometry stage (${pass.length} of ${entry.layouts.length}): the P4 version stays`;
    log.stage('REDESIGN', `${p.id}: ${entry.outcome} — ${entry.why.slice(0, 220)}`);
    return { ...none, why: entry.why, rendered, frames: framesN, ms: Date.now() - tg0, cached };
  }
  const best = accepted.sort((a, b) => b.v.score - a.v.score)[0];
  entry.outcome = 'REDESIGN_ACCEPTED';
  entry.winner = best.lc.id;
  x.log.totals.accepted++;
  if (best.lc.source.id !== (ref?.id ?? 'kept')) x.log.totals.rescued++;
  entry.why = `${best.lc.source.label} + ${best.lc.strategy}: ${best.v.score} vs ${refScore} (${best.lc.why})`;
  const recC: CandidateRecord = { problem: p.id, candidate: best.lc.id, label: `${best.lc.source.label} + ${best.lc.strategy}`, why: best.lc.why, predicted: { score: best.lc.fit, veto: null, notes: ['P4.5 geometry fit (motionCompositionFit)'] }, preview: { score: best.v.score, veto: best.v.veto, parts: best.v.parts, measure: { motion: best.pr.measure.motion, clash: best.pr.measure.clash, void: best.pr.measure.void, midMotion: best.pr.measure.midMotion, presence: best.pr.measure.presence, boundary: best.pr.measure.boundary } }, status: 'accepted', reason: `P4.5 re-layout: ${entry.why}`, cost: { frames: best.pr.frames, renderMs: best.pr.ms, cached: best.pr.cached } };
  x.rec.candidates.push(recC);
  log.stage('REDESIGN', `${p.id}: ${entry.why.slice(0, 220)}`);
  const winner: Live = { id: best.lc.id, label: recC.label, why: best.lc.why, script: best.lc.script, film: best.lc.source.film, plan: best.lc.plan, predicted: null, preview: best.v, measure: best.pr.measure, frames: best.pr.pf, rec: recC };
  return { winner, why: `P4.5 re-layout ${entry.why}`, rendered, frames: framesN, ms: Date.now() - tg0, cached };
}
