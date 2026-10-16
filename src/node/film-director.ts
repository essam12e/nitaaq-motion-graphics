/**
 * P3 — Film Director (node side). Think Film → Sequence → Shot → Element.
 *
 *   direct      : film plan (authored film_plan.json, or derived for analysis only) applied before compile
 *   filmPrepass : after the style-frame gate, before the animatic — Neighborhood Repair of every boundary at
 *                 risk (Transition Re-Director), multiple-small-subjects for a B body no boundary move fixes,
 *                 and (when the Film Critic finds film-level problems) the limited Global Re-Director
 *   criticLoop  : a repaired shot marks its neighbourhood dirty and the neighbourhood is re-directed before
 *                 render; measured failing boundaries get Transition Re-Director candidates; the best
 *                 version is chosen by the film-aware version score; the global pass runs only when the
 *                 lower levels have nothing left (hierarchical repair)
 *   filmEvaluate: boundary_plan.json, film_critic.json, film_memory.json, rhythm_report.json
 *
 * Disabled with NITAAQ_NO_FILM_DIRECTOR=1 (the film is exactly P2). Ablations: NITAAQ_NO_SEQUENCE,
 * NITAAQ_NO_TRANSITION_REDIRECTOR, NITAAQ_NO_FILM_CRITIC, NITAAQ_NO_MOTIFS, NITAAQ_NO_CAMERA.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import type { CriticReport } from '../qc/critic';
import type { StageProbeSample } from '../qc/stage-probes';
import type { TransitionQuality } from '../qc/transition-quality';
import { log } from '../core/logger';
import { applyFilmPlan, deriveFilmPlan, validateFilmPlan, type FilmPlan, type FilmPlanReport } from '../film/film-plan';
import { buildBoundaries, type Boundary, type SampleSource } from '../film/boundary';
import { boundaryAtRisk, redirectBoundary, type ScriptObj } from '../film/transition-redirector';
import { dirtyOf, neighborhoodRepair, type NeighborhoodReport } from '../film/dirty';
import { filmCritic, filmMemory, localSequenceScore, versionScore, type FilmCriticReport } from '../film/film-critic';
import { directRhythm, informationFlow } from '../film/rhythm';
import { globalRedirect, multipleSubjects, type GlobalResult } from '../film/global-redirector';
import { stageCompiler } from './film-compile';

const env = (k: string) => process.env[k] === '1';
export const filmOn = () => !env('NITAAQ_NO_FILM_DIRECTOR');
export const filmAblations = () => ({ sequence: !env('NITAAQ_NO_SEQUENCE'), transitionRedirector: !env('NITAAQ_NO_TRANSITION_REDIRECTOR'), filmCritic: !env('NITAAQ_NO_FILM_CRITIC'), motifs: !env('NITAAQ_NO_MOTIFS'), camera: !env('NITAAQ_NO_CAMERA') });

const readJson = <T>(f: string): T | null => {
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
  } catch {
    return null;
  }
};

/** The film plan with the ablations applied (no motifs / phrases; no sequence contracts). */
export function ablate(film: FilmPlan): FilmPlan {
  const a = filmAblations();
  const f = JSON.parse(JSON.stringify(film)) as FilmPlan;
  if (!a.motifs) {
    f.motifs = [];
    f.phrases = [];
    if (f.ending.payoff?.motif) f.ending.payoff = undefined;
  }
  if (!a.sequence) for (const s of f.sequences) s.contract = { receives: null, delivers: null };
  return f;
}

/**
 * The script a stage film is compiled from (P3): the authored film plan applied (energy, camera arc,
 * motifs, phrases, contracts) and the camera ablation. A derived plan is never applied — it only lets the
 * critic read the film — so a film without film_plan.json compiles exactly as in P2.
 */
export function filmScript(script: ScriptObj, film: FilmPlan | null): { script: ScriptObj; report: FilmPlanReport | null } {
  let out = script;
  let report: FilmPlanReport | null = null;
  if (film && filmOn() && film.source !== 'derived') ({ script: out, report } = applyFilmPlan(script as never, ablate(film)) as unknown as { script: ScriptObj; report: FilmPlanReport });
  if (filmOn() && !filmAblations().camera) {
    out = JSON.parse(JSON.stringify(out)) as ScriptObj;
    for (const s of out.shots) s.camera = 'static';
  }
  return { script: out, report };
}

/** The project's film plan: the authored one (validated), else one derived from the script (analysis only). */
export function loadFilm(projectDir: string, script: ScriptObj, given?: unknown, meta: { title?: string; cta?: string } = {}): { film: FilmPlan; authored: boolean; warnings: string[] } {
  const raw = given ?? readJson<unknown>(join(projectDir, 'film_plan.json'));
  if (raw) {
    const v = validateFilmPlan(raw, script);
    if (!v.ok) throw new Error(`film_plan.json is not valid:\n${v.errors.slice(0, 12).join('\n')}`);
    return { film: v.film, authored: v.film.source !== 'derived', warnings: v.warnings };
  }
  return { film: deriveFilmPlan(script, meta), authored: false, warnings: ['no film_plan.json: a conservative plan was derived from the script (analysis only, nothing applied)'] };
}

/** The current film (authored or derived) and a compiler for candidate scripts. */
function filmContext(projectDir: string): { script: ScriptObj; film: FilmPlan; authored: boolean; compile: ((s: ScriptObj) => StagePlan) | null; src: SampleSource } | null {
  const script = readJson<ScriptObj>(join(projectDir, 'shots.json'));
  if (!script) return null;
  const brief = readJson<{ brief?: { title?: string; content?: { cta?: { text?: string } } } }>(join(projectDir, 'stage_source.json'));
  const { film, authored } = loadFilm(projectDir, script, undefined, { title: brief?.brief?.title, cta: brief?.brief?.content?.cta?.text });
  const f = ablate(film);
  const compile0 = stageCompiler(projectDir, authored ? f : null);
  const compile = compile0
    ? (s: ScriptObj) => {
        const cam = filmAblations().camera ? s : filmScript(s, null).script;
        return compile0(cam);
      }
    : null;
  return { script, film: f, authored, compile, src: { energy: f.arcs.energy.curve, intentional: Object.fromEntries(f.transitionStrategy.resetsAllowed.map((r) => [r.boundary, r.why])) } };
}

/** Measured (DOM samples + pixel transitions) when available, else predicted. */
function measuredSource(projectDir: string, base: SampleSource): SampleSource {
  const samples = readJson<{ samples: StageProbeSample[] }>(join(projectDir, 'dom_samples.json'))?.samples ?? null;
  const tq = readJson<{ transitions: TransitionQuality[] }>(join(projectDir, 'transition_quality.json'))?.transitions ?? null;
  const vm = readJson<{ words?: { word: string; start: number; end: number }[] }>(join(projectDir, 'voice_map.json'));
  return { ...base, samples, transitions: tq, words: vm?.words };
}

export interface FilmEvaluation {
  boundaries: Boundary[];
  critic: FilmCriticReport | null;
  versionScore: number;
}

/** Boundary plan + film critic + film memory + rhythm report, written to the project folder. */
export function filmEvaluate(spec: VideoSpec, projectDir: string, critic: CriticReport | null, tag = ''): FilmEvaluation | null {
  if (!filmOn() || !spec.stage) return null;
  const ctx = filmContext(projectDir);
  if (!ctx) return null;
  const plan = spec.stage as unknown as StagePlan;
  const src = measuredSource(projectDir, ctx.src);
  const boundaries = buildBoundaries(plan, src);
  const strip = boundaries.map(({ eye, ...b }) => ({ ...b, eye: { ...eye, path: eye.path.filter((_, k) => k % 3 === 0) } }));
  writeFileSync(join(projectDir, `boundary_plan${tag}.json`), JSON.stringify({ version: 1, source: src.transitions ? 'measured' : 'predicted', boundaries: strip }, null, 2));
  if (tag) writeFileSync(join(projectDir, 'boundary_plan.json'), JSON.stringify({ version: 1, source: src.transitions ? 'measured' : 'predicted', boundaries: strip }, null, 2));
  const voiceWords = src.words;
  const info = informationFlow(plan, voiceWords);
  const stills = readJson<{ stillRuns?: { t0: number; t1: number }[] }>(join(projectDir, 'dom_motion.json'))?.stillRuns;
  const rhythm = directRhythm(plan, ctx.script as never, { voice: Boolean(spec.audio.voice), energy: ctx.film.arcs.energy.curve, stillRuns: stills, voiceWords });
  writeFileSync(join(projectDir, 'rhythm_report.json'), JSON.stringify(rhythm, null, 2));
  const mem = filmMemory(plan, ctx.film, boundaries);
  writeFileSync(join(projectDir, 'film_memory.json'), JSON.stringify(mem, null, 2));
  if (!filmAblations().filmCritic) return { boundaries, critic: null, versionScore: critic ? versionScore(critic, null) : 0 };
  const report = readJson<FilmPlanReport>(join(projectDir, 'film_plan_report.json'));
  const judgment = readJson<FilmCriticReport['dims']>(join(projectDir, 'film_judgment.json')) as never;
  const fc = filmCritic({ plan, film: ctx.film, boundaries, critic, info, filmReport: report, mem, rhythmCv: rhythm.durationCv, judgment });
  writeFileSync(join(projectDir, `film_critic${tag}.json`), JSON.stringify(fc, null, 2));
  if (tag) writeFileSync(join(projectDir, 'film_critic.json'), JSON.stringify(fc, null, 2));
  const lss = critic ? plan.shots.map((s) => ({ shot: s.id, ...localSequenceScore(s.id, critic, boundaries) })) : [];
  if (lss.length) writeFileSync(join(projectDir, `local_sequence${tag}.json`), JSON.stringify(lss, null, 2));
  return { boundaries, critic: fc, versionScore: critic ? versionScore(critic, fc) : fc.overall };
}

export interface PrepassResult {
  script: ScriptObj | null;
  neighborhood: NeighborhoodReport | null;
  subjects: { shot: string; choice: string; why: string; scores: unknown }[];
  global: Omit<GlobalResult, 'script' | 'film'> | null;
  film: FilmPlan | null;
}

/**
 * The film pass before any motion is rendered: every boundary at risk is re-directed with its
 * neighbourhood (Transition Re-Director); a boundary whose B side is a row of small subjects that no
 * boundary move fixes gets the multiple-subjects director on B's body; then the Film Critic (predicted)
 * and, for film-level problems only, the limited Global Re-Director. Returns the new script (or null).
 */
export function filmPrepass(spec: VideoSpec, projectDir: string, critic: CriticReport | null = null): PrepassResult {
  const none: PrepassResult = { script: null, neighborhood: null, subjects: [], global: null, film: null };
  if (!filmOn() || !spec.stage) return none;
  const ctx = filmContext(projectDir);
  if (!ctx?.compile) return none;
  const ab = filmAblations();
  let script = ctx.script;
  let plan = spec.stage as unknown as StagePlan;
  let film = ctx.film;
  let neighborhood: NeighborhoodReport | null = null;
  const subjects: PrepassResult['subjects'] = [];
  if (ab.transitionRedirector) {
    const r = neighborhoodRepair({ script, plan, compile: ctx.compile, src: ctx.src, trigger: 'film pre-pass (before the animatic)', minGain: ab.sequence ? 0.6 : 0.3 });
    neighborhood = r.report;
    script = r.script;
    plan = r.plan;
    // a cut no boundary move fixes, whose B body is a row of small subjects (P3-Q)
    for (const b of buildBoundaries(plan, ctx.src).filter(boundaryAtRisk)) {
      const ms = multipleSubjects(plan, script, b.targetShot, ctx.compile);
      subjects.push({ shot: b.targetShot, choice: ms.choice, why: ms.why, scores: ms.scores });
      if (ms.script) {
        script = ms.script;
        plan = ctx.compile(script);
      }
    }
  }
  let global: PrepassResult['global'] = null;
  if (ab.filmCritic) {
    const boundaries = buildBoundaries(plan, ctx.src);
    const fc = filmCritic({ plan, film, boundaries, critic });
    const filmLevel = fc.issues.filter((i) => i.level === 'film');
    if (filmLevel.length) {
      const g = globalRedirect({ plan, script, film, report: fc, critic, compile: ctx.compile, only: ab.motifs ? undefined : filmLevel.map((i) => i.code).filter((c) => c !== 'WEAK_PAYOFF') });
      const { script: gs, film: gf, ...rest } = g;
      global = rest;
      if (g.changed) {
        script = gs;
        film = gf;
        // the global change dirties its neighbourhoods: re-direct them
        if (ab.transitionRedirector) {
          const before = plan;
          plan = ctx.compile(script);
          const dirty = dirtyOf(before, plan, g.actions.flatMap((a) => a.shots)).dirtyBoundaries.map((d) => d.id);
          const r2 = neighborhoodRepair({ script, plan, compile: ctx.compile, src: ctx.src, only: dirty, reference: before, changed: g.actions.flatMap((a) => a.shots), trigger: 'global re-director', maxRounds: 2 });
          script = r2.script;
          neighborhood = neighborhood ? { ...neighborhood, steps: [...neighborhood.steps, ...r2.report.steps], redirects: [...neighborhood.redirects, ...r2.report.redirects], changed: neighborhood.changed || r2.report.changed } : r2.report;
        }
      }
    }
  }
  const changed = Boolean(neighborhood?.changed || subjects.some((s) => s.choice !== 'all-at-once') || global?.changed);
  writeFileSync(join(projectDir, 'film_prepass.json'), JSON.stringify({ version: 1, changed, neighborhood, subjects, global }, null, 2));
  if (global?.changed && ctx.authored) writeFileSync(join(projectDir, 'film_plan.json'), JSON.stringify(film, null, 2));
  for (const s of neighborhood?.steps ?? []) log.stage('FILM', `${s.boundary}: ${s.move ? `${s.move} (${s.before} → ${s.after})` : 'kept'} — ${s.why}`);
  for (const s of subjects) log.stage('FILM', `[${s.shot}] multiple subjects: ${s.choice} — ${s.why}`);
  for (const a of global?.actions ?? []) log.stage('FILM', `global ${a.code} [${a.shots.join(', ')}]: ${a.change}`);
  return { script: changed ? script : null, neighborhood, subjects, global, film };
}

/**
 * Inside the critic loop (P3-C/K): the shots a repair changed make their boundaries dirty; each dirty
 * boundary the repair made worse (or left at risk) is re-directed before anything is rendered.
 */
export function neighborhoodAfterRepair(projectDir: string, before: StagePlan, next: ScriptObj, changed: string[], tag: string): ScriptObj {
  if (!filmOn() || !filmAblations().transitionRedirector || !filmAblations().sequence || !changed.length) return next;
  const ctx = filmContext(projectDir);
  if (!ctx?.compile) return next;
  let after: StagePlan;
  try {
    after = ctx.compile(next);
  } catch {
    return next;
  }
  const d = dirtyOf(before, after, changed);
  const r = neighborhoodRepair({ script: next, plan: after, compile: ctx.compile, src: ctx.src, only: d.dirtyBoundaries.map((b) => b.id), reference: before, changed, trigger: `repair of ${changed.join(', ')}`, maxRounds: 3 });
  writeFileSync(join(projectDir, `neighborhood_repair${tag}.json`), JSON.stringify({ ...r.report, dirty: d }, null, 2));
  for (const s of r.report.steps) log.stage('FILM', `dirty ${s.boundary}: ${s.move ? `${s.move} (${s.before} → ${s.after})` : 'kept'} — ${s.why}`);
  return r.script;
}

/**
 * Measured boundaries that fail (pixels: a void, an empty frame, an eye jump) get a Transition
 * Re-Director move — the P3 replacement of the P2 hold / overlap patches. Skips the boundaries whose
 * shots a repair already touches this pass, and moves already tried.
 */
export function measuredBoundaryRepairs(projectDir: string, plan: StagePlan, script: ScriptObj, skipShots: string[], tried: Set<string>): { script: ScriptObj | null; moves: { boundary: string; move: string; why: string }[] } {
  if (!filmOn() || !filmAblations().transitionRedirector) return { script: null, moves: [] };
  const ctx = filmContext(projectDir);
  if (!ctx?.compile) return { script: null, moves: [] };
  const src = measuredSource(projectDir, ctx.src);
  const bs = buildBoundaries(plan, src).filter((b) => b.quality.source === 'measured' && boundaryAtRisk(b) && !skipShots.includes(b.sourceShot) && !skipShots.includes(b.targetShot));
  let cur = script;
  let curPlan = plan;
  const moves: { boundary: string; move: string; why: string }[] = [];
  for (const b of bs.sort((x, y) => x.score - y.score).slice(0, 2)) {
    const r = redirectBoundary(cur, curPlan, b.index, ctx.compile, ctx.src, { minGain: 0.3, tried });
    for (const c of r.candidates) tried.add(`${b.id}:${c.move}`);
    if (!r.script || !r.chosen) continue;
    cur = r.script;
    curPlan = ctx.compile(cur);
    moves.push({ boundary: b.id, move: r.chosen.move, why: `measured ${b.score.toFixed(1)} (${b.issues.map((i) => i.code).join(', ') || 'at risk'}); ${r.why}` });
  }
  return { script: moves.length ? cur : null, moves };
}

/** The global pass inside the loop — only when the lower levels have nothing left (hierarchical repair). */
export function globalInLoop(projectDir: string, plan: StagePlan, script: ScriptObj, critic: CriticReport, done: Set<string>): { script: ScriptObj | null; actions: GlobalResult['actions'] } {
  if (!filmOn() || !filmAblations().filmCritic) return { script: null, actions: [] };
  const ctx = filmContext(projectDir);
  if (!ctx?.compile) return { script: null, actions: [] };
  const fc = readJson<FilmCriticReport>(join(projectDir, 'film_critic.json'));
  if (!fc) return { script: null, actions: [] };
  const codes = fc.issues.filter((i) => i.level === 'film' && !done.has(i.code)).map((i) => i.code).filter((c) => filmAblations().motifs || c !== 'WEAK_PAYOFF');
  if (!codes.length) return { script: null, actions: [] };
  for (const c of codes) done.add(c);
  const g = globalRedirect({ plan, script, film: ctx.film, report: fc, critic, compile: ctx.compile, only: codes });
  if (g.changed && ctx.authored) writeFileSync(join(projectDir, 'film_plan.json'), JSON.stringify(g.film, null, 2));
  return { script: g.changed ? g.script : null, actions: g.actions };
}
