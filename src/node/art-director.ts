/**
 * P4 — Motion Art Director (node side): diagnose → candidates → cheap filter → PREVIEW RENDER → measure →
 * judge → select, per problem, before the animatic (after the P3 film pre-pass).
 *
 * Preview rendering renders only the problem's range (a shot, a neighbourhood or a boundary) — stills and
 * DOM probes every 0.1 s (0.08 s through a cut) at half resolution — for the kept version and the 2–3
 * candidates the prediction lets through. The pixels and the DOM decide; the prediction only filters.
 * Frames are cached by content (an unchanged candidate is never rendered twice).
 *
 * Writes: art_director.json (intents, key visuals, problems), choreography_graph.json, motion_language.json,
 * energy_report.json, rhythm_compose.json, focus_timeline.json, contributions.json, density_timeline.json,
 * motion_paths.json, composition_phases.json, candidate_tournament.json, art_memory.json, art/preview/…
 *
 * Disabled with NITAAQ_NO_ART_DIRECTOR=1 (the film is exactly P3) or when the P3 film director is off.
 * Ablations: NITAAQ_NO_CHOREOGRAPHY, NITAAQ_NO_KEY_VISUAL, NITAAQ_NO_CROSS_TRANSFORM, NITAAQ_NO_CANDIDATE_RENDER,
 * NITAAQ_NO_ENERGY_BUILDER, NITAAQ_NO_INFO_FOCUS, NITAAQ_NO_PHRASE_V2, NITAAQ_NO_GLOBAL_V2 (NITAAQ_NO_CAMERA is P3's).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { VideoSpec } from '../schema/video';
import type { StagePlan, StageTransition } from '../stage/plan';
import type { FilmPlan } from '../film/film-plan';
import type { ScriptObj } from '../film/transition-redirector';
import { collectProbes } from '../qc/probes';
import { judgeTransition, pixelOccupancy, transitionSampleTimes } from '../qc/transition-quality';
import type { StageProbeSample } from '../qc/stage-probes';
import { sampleStage, massOf, timesIn } from '../film/sampler';
import { buildBoundaries } from '../film/boundary';
import { normWord } from '../audio/voice-map';
import { log } from '../core/logger';
import { artContext, filmOn, filmAblations } from './film-director';
import { diagnose, type ArtProblem } from '../art/director';
import { measurePreview, judgeCandidate, type PreviewFrame, type PreviewMeasure, type Verdict } from '../art/judge';
import { cheapFilter, selectWinner, memorySkip, remember, budgetProblems, DEFAULT_BUDGET, type ArtMemory, type CandidateRecord, type ProblemRecord, type Tournament } from '../art/tournament';
import { choreographyGraph } from '../art/choreography';
import { contributions, densityTimeline, motionPaths, compositionPhases } from '../art/motion-analysis';
import { buildEnergy, composeRhythm } from '../art/energy';
import { focusTimeline } from '../art/focus';
import { languageFor } from '../art/language';
import { buildBuildersDoc } from '../art/references';
import { artGate, type ArtGate } from '../art/gate';
import { shotIntents, keyVisuals } from '../art/director';
import { overloadedShots } from '../art/focus';
import { audioSync as audioSync, typographyMotion, motionCharacter } from '../art/polish';

const env = (k: string) => process.env[k] === '1';
export const artOn = () => filmOn() && !env('NITAAQ_NO_ART_DIRECTOR');
export const artAblations = () => ({
  choreography: !env('NITAAQ_NO_CHOREOGRAPHY'),
  keyVisual: !env('NITAAQ_NO_KEY_VISUAL'),
  crossTransform: !env('NITAAQ_NO_CROSS_TRANSFORM'),
  candidateRender: !env('NITAAQ_NO_CANDIDATE_RENDER'),
  energy: !env('NITAAQ_NO_ENERGY_BUILDER'),
  focus: !env('NITAAQ_NO_INFO_FOCUS'),
  phrase: !env('NITAAQ_NO_PHRASE_V2'),
  global: !env('NITAAQ_NO_GLOBAL_V2'),
  camera: filmAblations().camera,
});

const readJson = <T>(f: string): T | null => {
  try {
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
  } catch {
    return null;
  }
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Predicted frames (analytic sampler) in the preview format — the cheap filter's evidence. */
export function predictedFrames(plan: StagePlan, range: [number, number], step = 0.1): PreviewFrame[] {
  const out: PreviewFrame[] = [];
  let prev: ReturnType<typeof sampleStage> | null = null;
  for (const t of timesIn(range[0], range[1], step)) {
    const s = sampleStage(plan, t);
    let diff = 0;
    if (prev) {
      const pm = new Map(prev.sampled.map((e) => [e.id, e]));
      for (const e of s.sampled) {
        const p = pm.get(e.id);
        const sz = Math.sqrt(Math.max(e.area, 1e-4));
        diff += p ? (Math.abs(e.rect.x - p.rect.x) / plan.W + Math.abs(e.rect.y - p.rect.y) / plan.H + Math.abs(e.rect.width - p.rect.width) / plan.W) * sz + Math.abs(e.opacity - p.opacity) * sz * 0.5 : e.opacity * sz * 0.5;
      }
      diff *= 0.25;
    }
    const kinds = new Map(plan.elements.map((e) => [e.id, e.kind]));
    const texts = s.sampled.filter((e) => ['text', 'card', 'chip', 'button', 'number'].includes(e.kind)).map((e) => ({ el: e.id, id: e.id, px: 0, rect: e.kind === 'card' ? { x: e.rect.x + e.rect.width * 0.1, y: e.rect.y + e.rect.height * 0.45, width: e.rect.width * 0.8, height: e.rect.height * 0.3 } : e.rect, opacity: e.opacity }));
    out.push({ t, occ: massOf(plan, s), diff, texts, els: s.sampled.map((e) => ({ id: e.id, kind: kinds.get(e.id) ?? e.kind, rect: e.rect, opacity: e.opacity })) });
    prev = s;
  }
  return out;
}

export interface PreviewResult {
  measure: PreviewMeasure;
  frames: number;
  rendered: number;
  cached: number;
  ms: number;
  stills: { t: number; file: string }[];
}

/** Renders a range of a candidate plan (stills + DOM, half resolution) and measures it. */
export async function previewRender(spec: VideoSpec, projectDir: string, plan: StagePlan, range: [number, number], o: { tag: string; step?: number; transition?: StageTransition; items?: string[]; headline?: string; handover?: { from: string; to: string } }): Promise<PreviewResult> {
  const t0 = Date.now();
  const fps = spec.canvas.fps;
  const total = Math.round(spec.scenes.reduce((a, s) => a + s.duration, 0) * fps);
  const times = o.transition ? [...new Set([...timesIn(range[0], o.transition.t0 - 0.24, 0.12), ...transitionSampleTimes(o.transition), ...timesIn(o.transition.t1 + 0.24, range[1], 0.12)])].sort((a, b) => a - b) : timesIn(range[0], range[1], o.step ?? 0.1);
  const frames = [...new Set(times.map((t) => Math.min(total - 1, Math.max(0, Math.round(t * fps)))))];
  const dir = join(projectDir, 'art', 'preview', o.tag);
  mkdirSync(dir, { recursive: true });
  const sp = { ...spec, stage: plan as unknown as VideoSpec['stage'] } as VideoSpec;
  const run = await collectProbes(sp, projectDir, frames, dir);
  const out: PreviewFrame[] = [];
  const dom: StageProbeSample[] = [];
  const curve: { t: number; occ: number; lum: number }[] = [];
  let prevGrey: Buffer | null = null;
  const stills: PreviewResult['stills'] = [];
  for (const f of frames) {
    const file = run.stills.get(f);
    const p = run.probes.get(f);
    if (!file || !p?.stage) continue;
    const t = f / fps;
    const { data, info } = await sharp(file).resize(320).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const po = pixelOccupancy(data, info.width, info.height, info.channels);
    const grey = Buffer.alloc(info.width * info.height);
    for (let k = 0; k < grey.length; k++) grey[k] = (data[k * 3] * 0.3 + data[k * 3 + 1] * 0.59 + data[k * 3 + 2] * 0.11) | 0;
    let diff = 0;
    if (prevGrey) {
      let acc = 0;
      for (let k = 0; k < grey.length; k++) acc += Math.abs(grey[k] - prevGrey[k]);
      diff = acc / grey.length / 255;
    }
    prevGrey = grey;
    const W = p.canvas.width;
    void W;
    out.push({ t, occ: po.occ, diff, texts: (p.stage.texts ?? []).map((x) => ({ el: x.el, id: x.id, px: x.px, rect: x.rect, opacity: x.opacity })), els: p.stage.els.filter((e) => !e.parent).map((e) => ({ id: e.id, kind: e.kind, rect: e.rect, opacity: e.opacity })) });
    dom.push({ t, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, els: p.stage.els, words: p.stage.words, texts: p.stage.texts, mask: p.stage.mask });
    curve.push({ t, occ: po.occ, lum: po.lum });
    stills.push({ t, file });
  }
  const measure = measurePreview(out, spec.canvas.width, spec.canvas.height, { items: o.items, headline: o.headline, handover: o.handover });
  if (o.transition) measure.boundary = judgeTransition(o.transition, curve, dom).score;
  return { measure, frames: frames.length, rendered: run.rendered, cached: run.cached, ms: Date.now() - t0, stills };
}

export interface ArtPassResult {
  script: ScriptObj | null;
  film: FilmPlan | null;
  tournament: Tournament | null;
  changed: string[];
}

/** Spoken word for each element whose title / text is said in the voice (focus on the word). */
function spokenWords(script: ScriptObj, projectDir: string): Record<string, string> {
  const vm = readJson<{ words?: { word: string }[] }>(join(projectDir, 'voice_map.json'));
  const said = new Set((vm?.words ?? []).map((w) => normWord(w.word)));
  const out: Record<string, string> = {};
  for (const e of (script.stage?.elements ?? []) as { id: string; text?: string; title?: string }[]) {
    const words = (e.title ?? e.text ?? '').split(/\s+/).filter(Boolean);
    const hit = words.find((w) => said.has(normWord(w)) && normWord(w).length > 2);
    if (hit) out[e.id] = hit;
  }
  return out;
}

const shotOf = (script: ScriptObj, id: string) => script.shots.find((s) => s.id === id);
const sigOf = (p: Omit<ArtProblem, 'candidates'>, script: ScriptObj) => createHash('md5').update(JSON.stringify([p.id, p.code, p.shots.map((id) => shotOf(script, id))])).digest('hex').slice(0, 16);

/** The P4 pass. Returns the new script / film plan when the tournament changed anything. */
export async function artDirectorPass(spec: VideoSpec, projectDir: string, opts: { budget?: Partial<typeof DEFAULT_BUDGET> } = {}): Promise<ArtPassResult> {
  const none: ArtPassResult = { script: null, film: null, tournament: null, changed: [] };
  if (!artOn() || !spec.stage) return none;
  const ctx = artContext(projectDir);
  if (!ctx) return none;
  const ab = artAblations();
  const budget = { ...DEFAULT_BUDGET, ...(opts.budget ?? {}) };
  const t00 = Date.now();
  // the brand's motion language (O): a brand decision, applied film-wide before the problems are judged
  const direction = readJson<{ motionLanguage?: string; personality?: string }>(join(projectDir, 'direction.json'));
  const brief = readJson<{ brief?: { personality?: string; motionLanguage?: string } }>(join(projectDir, 'stage_source.json'));
  const lang = languageFor({ personality: `${direction?.personality ?? ''} ${brief?.brief?.personality ?? ''}`, motionLanguage: direction?.motionLanguage, requested: process.env.NITAAQ_MOTION_LANGUAGE ?? brief?.brief?.motionLanguage });
  let cur = clone(ctx.script);
  const { description: _d, ...ml } = lang.language;
  if (ab.phrase) cur.motionLanguage = ml as never;
  let curFilm: FilmPlan | null = ctx.authored ? ctx.film : null;
  const compile = (s: ScriptObj, f: FilmPlan | null) => ctx.compile(ab.phrase ? s : stripPhrases(s), f);
  let curPlan = compile(cur, curFilm);
  const firstPlan = ctx.compile(ctx.script, curFilm);
  const original = clone(ctx.script);
  const voice = Boolean(spec.audio.voice);
  const spoken = spokenWords(cur, projectDir);
  const tq = readJson<{ transitions?: unknown[] }>(join(projectDir, 'transition_quality.json'));
  const d = diagnose(cur, curPlan, { film: ctx.film, src: ctx.src, cameraOff: !ab.camera, original, voice, spoken, compile: (s) => compile(s, curFilm), boundaries: tq ? buildBoundaries(curPlan, ctx.src) : undefined });
  // ablations remove whole families of problems
  let problems = d.problems.filter((p) => {
    if (!ab.energy && ['hook', 'climax'].includes(p.kind)) return false;
    if (!ab.focus && p.kind === 'focus') return false;
    if (!ab.choreography && ['choreography', 'camera-free'].includes(p.kind)) return false;
    if (!ab.crossTransform && p.kind === 'cta') return false;
    if (!(ab.global && ab.energy) && p.kind === 'global') return false;
    return true;
  });
  // key visuals first (D): a problem on a key-visual shot is solved before the others
  if (ab.keyVisual) {
    const kv = new Set(d.keyVisuals.map((k) => k.shot));
    const lv = { local: 0, sequence: 1, global: 2 } as const;
    problems = [...problems].sort((a, b) => lv[a.level] - lv[b.level] || Number(b.shots.some((s) => kv.has(s))) - Number(a.shots.some((s) => kv.has(s))));
  }
  const { run, deferred } = budgetProblems(problems, budget);
  const memFile = join(projectDir, 'art_memory.json');
  const memory: ArtMemory = readJson<ArtMemory>(memFile) ?? { version: 3, entries: [] };
  const records: ProblemRecord[] = [];
  const changed: string[] = [];
  let frameBudget = budget.frames;
  const tot = { candidates: 0, rendered: 0, accepted: 0, rejected: 0, filtered: 0, previewFrames: 0, previewMs: 0, cacheHits: 0 };
  for (const p of run) {
    const tp = Date.now();
    const sig = sigOf(p, cur);
    let cands = d.make(p, cur, curPlan, curFilm);
    if (!ab.crossTransform) cands = cands.filter((c) => !JSON.stringify(c.script.shots).includes('"become"') || JSON.stringify(cur.shots).includes('"become"'));
    if (!ab.phrase) cands = cands.map((c) => ({ ...c, script: stripPhrases(c.script) }));
    const rec: ProblemRecord = { problem: p.id, kind: p.kind, code: p.code, level: p.level, shots: p.shots, range: p.range, why: p.why, base: { predicted: null, preview: null }, winner: null, candidates: [], ms: 0 };
    records.push(rec);
    if (!cands.length) {
      rec.ms = Date.now() - tp;
      continue;
    }
    const bi = p.boundary;
    const trOf = (pl: StagePlan) => (bi !== undefined ? pl.transitions.find((t) => t.from === pl.shots[bi]?.id) : undefined);
    const handoverOf = (s: ScriptObj) => {
      for (const id of p.shots) {
        const e = (shotOf(s, id)?.motionChain ?? []).find((x) => x.action === 'become') as { element: string; to?: string } | undefined;
        if (e?.to) return { from: e.element, to: e.to };
      }
      return undefined;
    };
    const baseHand = handoverOf(cur);
    const predOf = (pl: StagePlan, s: ScriptObj, baseM: PreviewMeasure | null) => {
      const m = measurePreview(predictedFrames(pl, p.range), pl.W, pl.H, { items: p.items, headline: p.headline, handover: handoverOf(s) });
      if (bi !== undefined) m.boundary = buildBoundaries(pl, ctx.src)[bi]?.score;
      return { m, v: baseM ? judgeCandidate(p.kind, m, baseM) : null };
    };
    const basePred = predOf(curPlan, cur, null);
    const basePredV = judgeCandidate(p.kind, basePred.m, basePred.m);
    rec.base.predicted = basePredV.score;
    type Live = { id: string; label: string; why: string; script: ScriptObj; film: FilmPlan | null; plan: StagePlan; predicted: Verdict | null; preview: Verdict | null; measure?: PreviewMeasure; rec: CandidateRecord };
    const live: Live[] = [];
    for (const c of cands) {
      tot.candidates++;
      const r: CandidateRecord = { problem: p.id, candidate: c.id, label: c.label, why: c.why, predicted: null, preview: null, status: 'filtered', reason: '', cost: { frames: 0, renderMs: 0, cached: 0 } };
      rec.candidates.push(r);
      const skip = memorySkip(memory, sig, c.id);
      if (skip) {
        r.status = 'memory-skip';
        r.reason = skip;
        continue;
      }
      let pl: StagePlan;
      const film = (c as { film?: FilmPlan }).film ?? curFilm;
      try {
        pl = compile(c.script, film);
      } catch (e) {
        r.status = 'compile-failed';
        r.reason = (e as Error).message.slice(0, 200);
        continue;
      }
      const pr = predOf(pl, c.script, basePred.m);
      r.predicted = { score: pr.v!.score, veto: pr.v!.veto, notes: pr.v!.notes };
      live.push({ id: c.id, label: c.label, why: c.why, script: c.script, film: film ?? null, plan: pl, predicted: pr.v, preview: null, rec: r });
    }
    const filt = cheapFilter(live, basePredV.score, budget.perProblem);
    for (const dr of filt.drop) {
      const l = live.find((x) => x.id === dr.id)!;
      l.rec.status = 'filtered';
      l.rec.reason = dr.why;
      tot.filtered++;
    }
    let winner: Live | null = null;
    let why = '';
    if (!ab.candidateRender) {
      // ablation: choose on the prediction alone (what P3 did)
      const sel = selectWinner(filt.keep.map((l) => ({ ...l, preview: l.predicted })), basePredV.score);
      winner = sel.winner ? filt.keep.find((l) => l.id === sel.winner!.id)! : null;
      why = `prediction only (NITAAQ_NO_CANDIDATE_RENDER): ${sel.why}`;
    } else if (frameBudget > 0) {
      // the global pass looks at the whole film sparsely (4 frames a second); a shot at 10
      const stepOf = p.level === 'global' ? 0.25 : 0.1;
      const tag = (x: string) => `${p.id}-${x}`.replace(/[^a-z0-9-]/gi, '_');
      const base = await previewRender(spec, projectDir, curPlan, p.range, { tag: tag('kept'), step: stepOf, transition: trOf(curPlan), items: p.items, headline: p.headline, handover: baseHand });
      frameBudget -= base.rendered;
      tot.previewFrames += base.frames;
      tot.previewMs += base.ms;
      tot.cacheHits += base.cached;
      const baseV = judgeCandidate(p.kind, base.measure, base.measure);
      rec.base.preview = baseV.score;
      for (const l of filt.keep) {
        const pr = await previewRender(spec, projectDir, l.plan, p.range, { tag: tag(l.id), step: stepOf, transition: trOf(l.plan), items: p.items, headline: p.headline, handover: handoverOf(l.script) });
        frameBudget -= pr.rendered;
        tot.rendered++;
        tot.previewFrames += pr.frames;
        tot.previewMs += pr.ms;
        tot.cacheHits += pr.cached;
        l.measure = pr.measure;
        l.preview = judgeCandidate(p.kind, pr.measure, base.measure);
        l.rec.preview = { score: l.preview.score, veto: l.preview.veto, parts: l.preview.parts, measure: { motion: pr.measure.motion, clash: pr.measure.clash, void: pr.measure.void, midMotion: pr.measure.midMotion, presence: pr.measure.presence, boundary: pr.measure.boundary } };
        l.rec.cost = { frames: pr.frames, renderMs: pr.ms, cached: pr.cached };
      }
      const sel = selectWinner(filt.keep, baseV.score);
      winner = sel.winner;
      why = sel.why;
    } else why = 'preview frame budget spent: kept';
    for (const l of filt.keep) {
      if (winner && l.id === winner.id) {
        l.rec.status = 'accepted';
        l.rec.reason = why;
        tot.accepted++;
      } else {
        l.rec.status = 'rejected';
        const pv = l.preview;
        l.rec.reason = pv?.veto ? `vetoed in preview: ${pv.veto}${l.predicted && !l.predicted.veto ? ` (predicted ${l.predicted.score}: the prediction missed it)` : ''}` : pv ? `preview ${pv.score} ${winner ? `< winner ${winner.preview?.score}` : `vs kept ${rec.base.preview}`}` : why;
        tot.rejected++;
      }
      remember(memory, sig, l.rec, new Date(0).toISOString());
    }
    if (winner) {
      rec.winner = winner.id;
      cur = winner.script;
      curFilm = winner.film ?? curFilm;
      curPlan = winner.plan;
      changed.push(`${p.id}: ${winner.label}`);
      log.stage('ART', `${p.id} (${p.code}): ${winner.label} — ${why}`);
    } else log.stage('ART', `${p.id} (${p.code}): kept — ${why}`);
    rec.ms = Date.now() - tp;
  }
  for (const p of deferred) records.push({ problem: p.id, kind: p.kind, code: p.code, level: p.level, shots: p.shots, range: p.range, why: `${p.why} — deferred (budget)`, base: { predicted: null, preview: null }, winner: null, candidates: [], ms: 0 });
  const tournament: Tournament = { version: 1, problems: records, totals: tot };
  writeFileSync(join(projectDir, 'candidate_tournament.json'), JSON.stringify(tournament, null, 2));
  writeFileSync(memFile, JSON.stringify(memory, null, 2));
  // the reports of the chosen film
  const fin = curPlan;
  const { make: _m, ...diag } = d;
  writeFileSync(join(projectDir, 'art_director.json'), JSON.stringify({ ...diag, ablations: ab, language: { id: lang.language.id, why: lang.why }, changed, ms: Date.now() - t00 }, null, 2));
  writeFileSync(join(projectDir, 'motion_language.json'), JSON.stringify({ version: 1, ...lang.language, why: lang.why, applied: ab.phrase }, null, 2));
  writeFileSync(join(projectDir, 'choreography_graph.json'), JSON.stringify({ before: d.graph, after: choreographyGraph(cur, fin) }, null, 2));
  writeFileSync(join(projectDir, 'contributions.json'), JSON.stringify({ before: d.contributions, after: contributions(fin) }, null, 2));
  writeFileSync(join(projectDir, 'energy_report.json'), JSON.stringify({ before: d.energy, after: buildEnergy(cur, fin, ctx.film.arcs.energy.curve).report }, null, 2));
  writeFileSync(join(projectDir, 'rhythm_compose.json'), JSON.stringify(composeRhythm(cur, fin).report, null, 2));
  writeFileSync(join(projectDir, 'focus_timeline.json'), JSON.stringify(focusTimeline(fin, cur), null, 2));
  writeFileSync(join(projectDir, 'density_timeline.json'), JSON.stringify(densityTimeline(fin), null, 2));
  writeFileSync(join(projectDir, 'motion_paths.json'), JSON.stringify(motionPaths(fin), null, 2));
  writeFileSync(join(projectDir, 'composition_phases.json'), JSON.stringify(compositionPhases(fin), null, 2));
  writeFileSync(join(projectDir, 'audio_sync.json'), JSON.stringify(audioSync(fin), null, 2));
  writeFileSync(join(projectDir, 'art_builders.json'), JSON.stringify(buildBuildersDoc(), null, 2));
  writeFileSync(join(projectDir, 'typography_motion.json'), JSON.stringify(typographyMotion(fin, cur), null, 2));
  writeFileSync(join(projectDir, 'motion_character.json'), JSON.stringify(motionCharacter(fin, cur), null, 2));
  writeFileSync(join(projectDir, 'art_gate.json'), JSON.stringify({ version: 1, before: gateOf(original, firstPlan, ctx.film, !ab.camera), after: gateOf(cur, fin, curFilm ?? ctx.film, !ab.camera) }, null, 2));
  const anyChange = changed.length > 0 || ab.phrase;
  return { script: anyChange ? cur : null, film: curFilm && curFilm !== (ctx.authored ? ctx.film : null) ? curFilm : null, tournament, changed };
}

/** The Art Director Gate (T/U) on a compiled film. */
export function gateOf(script: ScriptObj, plan: StagePlan, film?: FilmPlan | null, cameraOff = false): ArtGate {
  const intents = shotIntents(script, plan);
  return artGate({ script, intents, keyVisuals: keyVisuals(script, plan, intents), graph: choreographyGraph(script, plan), energy: buildEnergy(script, plan, film?.arcs.energy.curve).report, rhythm: composeRhythm(script, plan).report, contributions: contributions(plan), density: densityTimeline(plan), overloaded: overloadedShots(plan), durationSec: plan.shots[plan.shots.length - 1]?.end ?? 1, cameraOff });
}

/** art_gate.json for the project as it stands (after the critic): the gate on the film that will be rendered. */
export function artGateFor(projectDir: string): ArtGate | null {
  const ctx = artContext(projectDir);
  if (!ctx) return null;
  const g = gateOf(ctx.script, ctx.compile(ctx.script), ctx.film, !artAblations().camera);
  const prev = readJson<{ before?: ArtGate }>(join(projectDir, 'art_gate.json'));
  writeFileSync(join(projectDir, 'art_gate.json'), JSON.stringify({ version: 1, before: prev?.before ?? null, final: g }, null, 2));
  return g;
}

/** NITAAQ_NO_PHRASE_V2: the script without phrases or a motion language (the compiler's P3 defaults). */
export function stripPhrases(s: ScriptObj): ScriptObj {
  const c = clone(s);
  delete (c as { motionLanguage?: unknown }).motionLanguage;
  for (const sh of c.shots) delete (sh as { phrase?: unknown }).phrase;
  return c;
}

export { r2 };
