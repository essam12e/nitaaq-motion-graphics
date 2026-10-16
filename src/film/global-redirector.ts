/**
 * Global Re-Director (P3-N) + Sequence Director for multiple small subjects (P3-Q) + CTA payoff (P3-O).
 *
 * Film-level problems get film-level answers — but few and costly, so only when the problem is really
 * film-level (hierarchical repair, P3-V: technical → shot → boundary → sequence → film; a text margin is
 * never fixed here). It changes at most `maxShots` shots per call:
 *   · WEAK_PAYOFF      → an element that began the film (a motif, else the earliest persistent / carrying
 *                         shape) returns on the CTA (a halo behind its action, or an accent)
 *   · REPETITIVE_FILM  → 1–2 shots of the repeated layout are re-composed (P2 Re-Director candidates with
 *                         a different strategy), 1–2 repeated transitions change language, a repeated camera
 *                         move is dropped where it does least
 *   · FLAT_FILM / NO_BUILD / WEAK_CLIMAX → the planned peak gets its impact (a motion phrase peak)
 *   · CAMERA_ADDICTION → the least justified moving shots become still
 * Pure: the caller passes the compile function (prediction) and the critic.
 */
import type { StagePlan } from '../stage/plan';
import type { CriticReport } from '../qc/critic';
import { recompositionCandidates } from '../stage/redirector';
import { applyRedirection } from '../stage/redirection';
import { moveFamily } from '../stage/direction';
import { sampleStage, timesIn } from './sampler';
import { buildBoundaries } from './boundary';
import { ctaPayoff, filmMemory, repetitions, type FilmCriticReport } from './film-critic';
import type { FilmPlan } from './film-plan';
import type { ScriptObj } from './transition-redirector';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface GlobalAction {
  code: string;
  level: 'film' | 'sequence';
  shots: string[];
  change: string;
  why: string;
  cost: 'high' | 'very-high';
  intentChanges: { what: string; why: string }[];
  predicted?: string;
}

export interface GlobalResult {
  actions: GlobalAction[];
  skipped: { code: string; why: string }[];
  script: ScriptObj;
  film: FilmPlan;
  changed: boolean;
}

type Cast = { id: string; role?: string; behind?: string; scale?: number; enter?: string; [k: string]: unknown };

/** The element that should pay off on the CTA: a motif, else the earliest shape / line that carried the film. */
export function payoffCandidate(plan: StagePlan, script: ScriptObj, film: FilmPlan): { element: string; why: string } | null {
  for (const m of film.motifs) if (script.stage?.elements.some((e) => e.id === m.element)) return { element: m.element, why: `motif ${m.id} (${m.meaning})` };
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));
  const half = Math.ceil(plan.shots.length / 2);
  for (const tr of plan.transitions) {
    const k = plan.shots.findIndex((s) => s.id === tr.from);
    if (k < half && tr.element && ['shape', 'line', 'chip'].includes(kinds.get(tr.element) ?? '')) return { element: tr.element, why: `${tr.element} carried the cut ${tr.from}→${tr.to} (${tr.kind}) early in the film` };
  }
  for (const e of plan.elements) if (e.shots.length >= 2 && ['shape', 'line'].includes(e.kind) && plan.shots.findIndex((s) => s.id === e.shots[0]) < half) return { element: e.id, why: `${e.id} persisted through ${e.shots.join(', ')}` };
  return null;
}

export function globalRedirect(inp: { plan: StagePlan; script: ScriptObj; film: FilmPlan; report: FilmCriticReport; critic?: CriticReport | null; compile?: (s: ScriptObj) => StagePlan; maxShots?: number; only?: string[] }): GlobalResult {
  const { plan, report } = inp;
  let script = clone(inp.script);
  const film = clone(inp.film);
  const actions: GlobalAction[] = [];
  const skipped: GlobalResult['skipped'] = [];
  const maxShots = inp.maxShots ?? 3;
  const touched = new Set<string>();
  const budget = () => maxShots - touched.size;
  const codes = new Set(report.issues.map((i) => i.code));
  const want = (c: string) => codes.has(c as never) && (!inp.only || inp.only.includes(c));
  const last = script.shots[script.shots.length - 1];
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));

  // ── CTA payoff: the end receives something that began the film
  if (want('WEAK_PAYOFF') && budget() > 0) {
    const cand = payoffCandidate(plan, script, film);
    const action = (last.cast ?? []).find((c) => c.id.startsWith('button')) ?? (last.cast ?? []).find((c) => c.role === 'hero');
    if (!cand || !action) skipped.push({ code: 'WEAK_PAYOFF', why: cand ? 'the CTA has no action element to resolve on' : 'no element from the film can return (no motif, no early shape)' });
    else {
      const cast = (last.cast ??= []) as Cast[];
      const kind = script.stage?.elements.find((e) => e.id === cand.element)?.kind;
      const as = kind === 'shape' ? 'halo' : 'accent';
      const entry: Cast = { id: cand.element, role: 'background', behind: action.id, scale: as === 'halo' ? 1.9 : 0.5, enter: 'scale' };
      const has = cast.find((c) => c.id === cand.element);
      if (has) Object.assign(has, entry);
      else cast.push(entry);
      // the film plan learns the payoff (so the next critic reads it, and the report says what it is)
      const m = film.motifs.find((x) => x.element === cand.element);
      if (m) m.finalResolution = { shot: last.id, as, into: action.id, note: `${m.identity} resolves ${as === 'halo' ? 'around' : 'beside'} ${action.id}` };
      film.ending.payoff = { motif: m?.id, element: cand.element, from: plan.shots.find((s) => (s.cast ?? []).some((c) => c.id === cand.element))?.id ?? plan.shots[0].id, how: `${cand.element} returns ${as === 'halo' ? 'behind' : 'beside'} ${action.id}` };
      if (!film.ending.why.trim()) film.ending.why = `the film began with ${cand.element}; the decision lands on it (${cand.why})`;
      touched.add(last.id);
      let predicted: string | undefined;
      if (inp.compile) {
        try {
          const p = inp.compile(script);
          const po = ctaPayoff(p, film);
          predicted = `payoff ${po.connected ? 'connected' : 'still detached'} (${po.how})`;
        } catch (e) {
          predicted = `does not compile: ${(e as Error).message.slice(0, 100)}`;
        }
      }
      actions.push({ code: 'WEAK_PAYOFF', level: 'film', shots: [last.id], change: `${cand.element} returns on the CTA as a ${as} ${as === 'halo' ? 'behind' : 'beside'} ${action.id}`, why: `the CTA must be the conclusion of the film: ${cand.why}`, cost: 'high', intentChanges: [{ what: 'brand / CTA composition', why: `a background ${as} joins the CTA (no new copy, no logo change)` }], predicted });
    }
  }

  // ── repetition: layouts, transitions, camera
  if (want('REPETITIVE_FILM') && budget() > 0) {
    const mem = filmMemory(plan, film);
    const prio: Record<string, number> = { layout: 0, camera: 1, transition: 2 };
    const reps = repetitions(mem, film)
      .filter((r) => !r.intentional)
      .sort((a, b) => (prio[a.what] ?? 9) - (prio[b.what] ?? 9));
    for (const r of reps) {
      if (budget() <= 0) break;
      if (r.what === 'layout' && inp.critic) {
        const victims = mem.shots.filter((d) => d.layout === r.value && !touched.has(d.shot) && d.shot !== last.id && d.shot !== mem.shots[0].shot);
        let n = 0;
        for (const v of victims) {
          if (n >= 2 || budget() <= 0) break;
          const cands = recompositionCandidates(plan, script as never, inp.critic, v.shot).filter((c) => !c.directive.strategy || !(plan.shots.find((s) => s.id === v.shot)?.composition.layout ?? '').startsWith(c.directive.strategy)).filter((c) => c.gain > -0.4);
          const best = cands[0];
          if (!best) continue;
          const { script: next, report: ap } = applyRedirection(script as never, { version: 1, source: 'deterministic', shots: [best.directive] });
          if (ap.rejected.length) continue;
          script = next as never;
          touched.add(v.shot);
          n++;
          actions.push({ code: 'REPETITIVE_FILM', level: 'film', shots: [v.shot], change: `${best.label} (layout "${r.value}" was ${Math.round(r.share * 100)}% of the film)`, why: 'the same layout over and over reads as a template', cost: 'high', intentChanges: best.directive.intentChanges ?? [], predicted: best.directive.expected });
        }
      } else if (r.what === 'transition') {
        const idx = script.shots.map((s, i) => ({ s, i })).filter(({ s, i }) => i < script.shots.length - 1 && (typeof s.transitionOut === 'string' ? s.transitionOut : (s.transitionOut as { type?: string } | undefined)?.type) === r.value);
        let n = 0;
        for (const { s, i } of idx.slice(1)) {
          if (n >= 2 || budget() <= 0) break;
          // another language from what is on screen: an element both shots share continues; else A's hero
          // carries the cut by its kind (a line of type opens like a mask, a product / card passes the lens,
          // a shape becomes the world); a hard cut only when the habit is not already a cut
          const shared = (s.cast ?? []).map((c) => c.id).find((id) => (script.shots[i + 1].cast ?? []).some((c) => c.id === id) && !/cursor|logo/.test(id));
          const hero = (s.cast ?? []).find((c) => c.role === 'hero')?.id;
          const hk = hero ? kinds.get(hero) : undefined;
          const byKind = hero && hk === 'text' ? 'text-mask' : hero && (hk === 'ui' || hk === 'image' || hk === 'card') ? 'depth-pass' : hero && hk === 'shape' ? 'expand-to-background' : null;
          const next: { type: string; element?: string; hard?: boolean } | null = shared && r.value !== 'shared' ? { type: 'shared', element: shared } : byKind && byKind !== r.value ? { type: byKind, element: hero } : r.value !== 'cut' ? { type: 'cut', hard: true } : null;
          if (!next) continue;
          s.transitionOut = next;
          s.transitionReason = `film level: ${r.value} on every cut reads as a habit; ${next.type}${next.element ? ` (${next.element})` : ''} carries this one`;
          touched.add(s.id);
          n++;
          actions.push({ code: 'REPETITIVE_FILM', level: 'film', shots: [s.id], change: `transition ${r.value} → ${next.type}${next.element ? ` (${next.element})` : ''}`, why: `${r.value} is ${Math.round(r.share * 100)}% of the cuts: the language becomes a habit`, cost: 'high', intentChanges: [{ what: 'transition', why: 'varied at film level (repetition)' }] });
        }
      } else if (r.what === 'camera') {
        let moves = (inp.critic?.measures.cameraMoves ?? []).filter((m) => !touched.has(m.shot)).sort((a, b) => a.score - b.score);
        if (!moves.length) {
          // no measurement yet (before the animatic): the camera arc decides — keep the move on the planned
          // peak, still the others where the arc says "still", else every other moving shot
          const curve = film.arcs.energy.curve;
          const peak = Object.entries(curve).sort((a, b) => b[1] - a[1])[0]?.[0];
          const stillByArc = new Set(film.arcs.camera.stages.filter((st) => /still|static/i.test(st.behavior)).flatMap((st) => st.shots));
          const moving = script.shots.filter((x) => x.camera && x.camera !== 'static' && x.id !== peak && !touched.has(x.id));
          const pick = moving.filter((x) => stillByArc.has(x.id));
          moves = (pick.length ? pick : moving.filter((_, k) => k % 2 === 1)).slice(0, 2).map((x) => ({ shot: x.id, score: 0, note: stillByArc.has(x.id) ? 'the camera arc says still here' : 'one of a run of identical moves', replaceable: true, visible: true }) as never);
        }
        for (const m of moves.slice(0, 2)) {
          if (budget() <= 0) break;
          const s = script.shots.find((x) => x.id === m.shot);
          if (!s) continue;
          s.camera = 'static';
          touched.add(m.shot);
          actions.push({ code: 'REPETITIVE_FILM', level: 'film', shots: [m.shot], change: `camera ${r.value} → still in ${m.shot} (${m.score ? `its move scored ${m.score}: ` : ''}${m.note})`, why: `the same move (${r.value}) in ${Math.round(r.share * 100)}% of the film`, cost: 'very-high', intentChanges: [{ what: 'camera reason', why: `${m.shot}'s move was the least justified; the camera arc keeps the others` }] });
        }
      } else skipped.push({ code: 'REPETITIVE_FILM', why: `${r.what} "${r.value}" repeated — no film-level answer for ${r.what} (left to the shot level)` });
    }
  }

  // ── energy: the planned climax gets its impact
  if ((want('FLAT_FILM') || want('NO_BUILD') || want('WEAK_CLIMAX')) && budget() > 0) {
    const curve = film.arcs.energy.curve;
    const peakId = Object.entries(curve).sort((a, b) => b[1] - a[1]).find(([id]) => id !== script.shots[0].id && id !== last.id)?.[0];
    const s = peakId ? script.shots.find((x) => x.id === peakId) : undefined;
    const hero = s?.cast?.find((c) => c.role === 'hero')?.id;
    if (s && hero && !(s.motionChain ?? []).some((e) => e.element === hero && ['impact', 'transform', 'press', 'count'].includes(e.action))) {
      s.motionChain.push({ id: 'fp-climax', element: hero, action: 'impact', at: Math.round(Math.min(1.6, ((s.timing?.duration ?? 3) * 0.45)) * 100) / 100, reason: 'P3 energy arc: the planned climax lands with an impact' } as never);
      touched.add(s.id);
      actions.push({ code: [...codes].filter((c) => ['FLAT_FILM', 'NO_BUILD', 'WEAK_CLIMAX'].includes(c)).join('+'), level: 'film', shots: [s.id], change: `impact on ${hero} at the planned peak (${s.id}, energy ${curve[s.id]})`, why: 'the measured energy does not rise where the film plan peaks', cost: 'high', intentChanges: [] });
    } else skipped.push({ code: 'FLAT_FILM', why: 'the planned peak already has its impact, or no hero to give it to' });
  }

  // ── camera addiction: still the least justified moves
  if (want('CAMERA_ADDICTION') && budget() > 0 && inp.critic) {
    const moves = inp.critic.measures.cameraMoves.filter((m) => !touched.has(m.shot) && (m.replaceable || !m.visible)).sort((a, b) => a.score - b.score).slice(0, Math.min(2, budget()));
    for (const m of moves) {
      const s = script.shots.find((x) => x.id === m.shot);
      if (!s || moveFamily(String((s.camera as { move?: string } | undefined)?.move ?? 'static')) === 'static') continue;
      s.camera = 'static';
      touched.add(m.shot);
      actions.push({ code: 'CAMERA_ADDICTION', level: 'film', shots: [m.shot], change: `camera still in ${m.shot}`, why: `${m.note}${m.replaceable ? ' (the elements can carry it)' : ''}`, cost: 'very-high', intentChanges: [{ what: 'camera reason', why: 'film-level: the camera moves too often to mean anything' }] });
    }
  }
  return { actions, skipped, script, film, changed: actions.length > 0 };
}

/**
 * Sequence Director for multiple small subjects (P3-Q): a shot whose subject is a row of small items
 * asks "must all of them be seen at once?". Candidates — all at once (as is), progressive emphasis
 * (each item grows in turn and settles back, the row stays as context), focus-sequence (P2 strategy:
 * one item leads, the rest support) — are predicted with the sampler: how big is the item the eye is
 * on, on average, and does anything collide. Returns the best directive, or null when "all at once" wins.
 */
export function multipleSubjects(plan: StagePlan, script: ScriptObj, shotId: string, compile: (s: ScriptObj) => StagePlan): { choice: 'all-at-once' | 'progressive-emphasis' | 'focus-sequence'; scores: Record<string, { focusArea: number; overlap: number; value: number }>; script: ScriptObj | null; why: string } {
  const si = script.shots.findIndex((s) => s.id === shotId);
  const s = script.shots[si];
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));
  const items = (s.cast ?? []).filter((c) => ['card', 'chip', 'number', 'icon', 'button'].includes(kinds.get(c.id) ?? '')).map((c) => c.id);
  const evalPlan = (p: StagePlan) => {
    const sh = p.shots.find((x) => x.id === shotId)!;
    let focus = 0;
    let overlap = 0;
    let n = 0;
    for (const t of timesIn(sh.start + 0.4, sh.end - 0.4, 0.1)) {
      const els = sampleStage(p, t).sampled.filter((e) => items.includes(e.id) && e.opacity > 0.5);
      if (!els.length) continue;
      n++;
      focus += Math.max(...els.map((e) => e.area));
      for (let a = 0; a < els.length; a++)
        for (let b = a + 1; b < els.length; b++) {
          const A = els[a].rect;
          const B = els[b].rect;
          const ix = Math.max(0, Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x));
          const iy = Math.max(0, Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y));
          overlap = Math.max(overlap, (ix * iy) / Math.max(1, Math.min(A.width * A.height, B.width * B.height)));
        }
    }
    return { focusArea: r2(n ? focus / n : 0), overlap: r2(overlap) };
  };
  const scores: Record<string, { focusArea: number; overlap: number; value: number }> = {};
  const value = (x: { focusArea: number; overlap: number }, cost: number) => r2(x.focusArea * 40 - Math.max(0, x.overlap - 0.08) * 12 - cost);
  const base = evalPlan(plan);
  scores['all-at-once'] = { ...base, value: value(base, 0) };
  if (items.length < 3) return { choice: 'all-at-once', scores, script: null, why: 'fewer than three items: nothing to sequence' };
  const options: { name: 'progressive-emphasis' | 'focus-sequence'; script: ScriptObj; cost: number }[] = [];
  // progressive emphasis: each item grows when it arrives and settles back as the next one grows
  {
    const sc = clone(script);
    const sh = sc.shots[si];
    const dur = Number((sh.timing as { duration?: number } | undefined)?.duration ?? plan.shots.find((x) => x.id === shotId)!.end - plan.shots.find((x) => x.id === shotId)!.start);
    const step = Math.max(0.5, (dur - 1.2) / items.length);
    items.forEach((id, k) => {
      const t0 = Math.round((0.45 + k * step) * 100) / 100;
      sh.motionChain.push({ id: `pe-${k}`, element: id, action: 'transform', amount: 1.28, at: t0, dur: 0.45, reason: `P3-Q progressive emphasis: ${id} takes the eye in turn (the row stays as context)` } as never);
      if (k < items.length - 1) sh.motionChain.push({ id: `pe-${k}-back`, element: id, action: 'transform', amount: 1, at: Math.round((t0 + step) * 100) / 100, dur: 0.45, reason: 'settles back as the next item takes the eye' } as never);
    });
    options.push({ name: 'progressive-emphasis', script: sc, cost: 0.4 });
  }
  {
    const { script: sc, report } = applyRedirection(script as never, { version: 1, source: 'deterministic', shots: [{ shot: shotId, issues: ['ROW_OF_SMALL_OBJECTS'], diagnosis: 'multiple small subjects', strategy: 'focus-sequence', unpin: ['*'], cost: 'medium', intentChanges: [] }] });
    if (!report.rejected.length) options.push({ name: 'focus-sequence', script: sc as never, cost: 0.8 });
  }
  let best: { name: 'all-at-once' | 'progressive-emphasis' | 'focus-sequence'; script: ScriptObj | null; value: number } = { name: 'all-at-once', script: null, value: scores['all-at-once'].value };
  for (const o of options) {
    try {
      const p = compile(o.script);
      const e = evalPlan(p);
      // a change that breaks a neighbouring cut is not a sequence improvement
      const bnow = buildBoundaries(plan).filter((b) => b.sourceShot === shotId || b.targetShot === shotId);
      const bnew = buildBoundaries(p).filter((b) => b.sourceShot === shotId || b.targetShot === shotId);
      const dB = bnew.reduce((a, b) => a + b.score, 0) - bnow.reduce((a, b) => a + b.score, 0);
      scores[o.name] = { ...e, value: r2(value(e, o.cost) + Math.min(0, dB)) };
      if (scores[o.name].value > best.value + 0.5) best = { name: o.name, script: o.script, value: scores[o.name].value };
    } catch (err) {
      scores[o.name] = { focusArea: 0, overlap: 0, value: -9 };
      void err;
    }
  }
  return { choice: best.name, scores, script: best.script, why: best.name === 'all-at-once' ? 'showing the items together reads best here (no option gives the eye a bigger subject without collisions)' : `${best.name}: the item the eye is on covers ${Math.round(scores[best.name].focusArea * 100)}% of the frame on average (all at once: ${Math.round(scores['all-at-once'].focusArea * 100)}%)` };
}
