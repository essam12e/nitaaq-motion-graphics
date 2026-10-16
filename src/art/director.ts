/**
 * P4-A — Motion Art Director. For every shot it answers "what is the main visual action of this shot?" —
 * not "fade in cards" but "the circle pulls the scattered chips in", "the card becomes the button" — and
 * says whether the shot actually performs it (a visual EVENT) or only plays a template (things appearing
 * on a clock). It chooses the film's key visuals (1–3 moments a viewer would remember), and turns what it
 * sees into problems, each with 2–4 candidate solutions from the builders (hook, climax, focus, subjects,
 * cross-element transform, choreography, camera-free) — the preview tournament decides. Pure.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';
import type { FilmPlan } from '../film/film-plan';
import { buildBoundaries, type Boundary, type SampleSource } from '../film/boundary';
import { boundaryAtRisk, boundaryCandidates } from '../film/transition-redirector';
import { choreographyGraph, choreographyCandidates, cameraFreeEquivalent, siblingsOf, type ChoreographyGraph } from './choreography';
import { buildEnergy, climaxCandidates, hookCandidates, composeRhythm, internalGaps, wantedEnergy, type ArtCandidate, type EnergyReport } from './energy';
import { focusCandidates, overloadedShots, subjectsCandidates } from './focus';
import { ctaTransformCandidates, transformCutCandidates, type FilmCandidate } from './transform';
import { contributions, type Contributions } from './motion-analysis';
import { globalVarietyCandidate, habitsOf } from './global';
import type { ProblemKind } from './judge';

type Ev = { id?: string; element: string; action: string; to?: string; after?: string; style?: string; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; metaphor?: string; subject?: string; cast?: { id: string; role?: string }[]; motionChain: Ev[]; transitionOut?: unknown; camera?: unknown; [k: string]: unknown };

export type VisualVerb = 'gather' | 'transform' | 'reveal' | 'progress' | 'press' | 'push-into' | 'cascade' | 'collide' | 'emerge' | 'resolve';

export interface ShotIntent {
  shot: string;
  /** The main visual action, in one sentence. */
  mainAction: string;
  verb: VisualVerb;
  subject: string;
  object?: string;
  /** The shot performs an event (elements act on each other / one becomes another), not a template. */
  visualEvent: boolean;
  template: boolean;
  evidence: string[];
}

const kindOf = (script: ScriptObj, id: string) => script.stage?.elements.find((e) => e.id === id)?.kind ?? '';
const nameOf = (id: string) => id.replace(/^[a-z]+\./, '').replace(/[-_]/g, ' ');

/** A — the main visual action of every shot. */
export function shotIntents(script: ScriptObj, plan: StagePlan): ShotIntent[] {
  return script.shots.map((s0, i) => {
    const s = s0 as ShotObj;
    const chain = s.motionChain ?? [];
    const subject = (s.cast ?? []).find((c) => c.role === 'hero')?.id ?? s.subject ?? '';
    const ev: string[] = [];
    const has = (a: string) => chain.find((e) => e.action === a);
    const tr = plan.transitions.find((t) => t.from === s.id);
    let verb: VisualVerb = 'emerge';
    let object: string | undefined;
    let sentence = '';
    const become = has('become');
    const attract = chain.filter((e) => e.action === 'attract');
    const push = chain.filter((e) => e.action === 'push');
    const draw = has('draw');
    const press = has('press');
    if (become) {
      verb = 'transform';
      object = become.to;
      sentence = `${nameOf(become.element)} becomes ${nameOf(become.to ?? '')}`;
      ev.push(`become ${become.element} → ${become.to}`);
    } else if (attract.length) {
      verb = 'gather';
      object = attract[0].to;
      sentence = `${nameOf(attract[0].to ?? '')} pulls ${attract.map((a) => nameOf(a.element)).join(' and ')} in`;
      ev.push(`${attract.length} attract`);
    } else if (draw && siblingsOf(script, i).length >= 2) {
      verb = 'progress';
      sentence = `the ${nameOf(draw.element)} is drawn and each step is born where it arrives`;
      ev.push('draw + steps');
    } else if (press) {
      verb = 'press';
      sentence = `the ${nameOf(press.element)} is pressed: the decision`;
      ev.push('press');
    } else if (push.length) {
      verb = 'cascade';
      sentence = `${push.map((p) => `${nameOf(p.element)} pushes ${nameOf(p.to ?? '')}`).join(', ')}`;
      ev.push(`${push.length} push`);
    } else if (s.camera && s.camera !== 'static' && /push/.test(String((s.camera as { move?: string }).move))) {
      verb = 'push-into';
      sentence = `the camera pushes into ${nameOf(String(s.cameraTarget ?? subject))}`;
      ev.push('camera push');
    } else if (chain.some((e) => e.action === 'focus')) {
      verb = 'reveal';
      sentence = `the ideas are disclosed one at a time`;
    } else if (tr && ['text-mask', 'expand-to-background'].includes(tr.kind)) {
      verb = 'reveal';
      sentence = `${nameOf(subject)} appears, then ${tr.kind === 'text-mask' ? 'its words open onto the next shot' : 'it grows into the world of the next shot'}`;
      ev.push(`exit ${tr.kind}`);
    } else if (s.purpose === 'cta') {
      verb = 'resolve';
      sentence = 'the brand and the action settle';
    } else sentence = `${nameOf(subject)} appears${(s.cast ?? []).length > 1 ? ` with ${(s.cast ?? []).length - 1} other element(s)` : ''}`;
    const causal = chain.filter((e) => e.after || ['attract', 'push', 'become', 'respond'].includes(e.action)).length;
    const visualEvent = Boolean(become || attract.length || push.length || (draw && causal >= 2) || chain.some((e) => e.action === 'respond')) || (tr ? ['morph', 'shape-transform', 'expand-to-background', 'text-mask'].includes(tr.kind) && verb !== 'emerge' : false);
    const template = !visualEvent && causal === 0 && verb === 'emerge';
    if (template) ev.push('only entrances on a clock');
    return { shot: s.id, mainAction: sentence, verb, subject, object, visualEvent, template, evidence: ev };
  });
}

export interface KeyVisual {
  shot: string;
  t: number;
  what: string;
  why: string;
  score: number;
}

/** D — 1–3 key visuals: the moments a viewer would remember (a transformation, a gathering, the payoff). */
export function keyVisuals(script: ScriptObj, plan: StagePlan, intents: ShotIntent[]): KeyVisual[] {
  const out: KeyVisual[] = [];
  const W: Partial<Record<VisualVerb, number>> = { transform: 1, gather: 0.9, collide: 0.8, cascade: 0.6, progress: 0.55, 'push-into': 0.5, reveal: 0.45, press: 0.5, resolve: 0.3, emerge: 0.1 };
  intents.forEach((it, i) => {
    const ps = plan.shots[i];
    const pos = i === 0 ? 0.2 : i === plan.shots.length - 1 ? 0.25 : 0;
    const score = (W[it.verb] ?? 0.1) + (it.visualEvent ? 0.3 : 0) + pos;
    const t = Math.round((ps.start + (ps.end - ps.start) * 0.62) * 100) / 100;
    out.push({ shot: it.shot, t, what: it.mainAction, why: it.visualEvent ? `a visual event (${it.verb})` : `a ${it.verb}`, score: Math.round(score * 100) / 100 });
  });
  for (const tr of plan.transitions.filter((x) => x.status === 'object' && ['morph', 'expand-to-background', 'text-mask'].includes(x.kind))) out.push({ shot: tr.to, t: Math.round(((tr.t0 + tr.t1) / 2) * 100) / 100, what: `${nameOf(tr.element ?? '')} ${tr.kind === 'morph' ? `becomes ${nameOf(tr.into ?? '')}` : tr.kind === 'expand-to-background' ? 'becomes the world' : 'opens onto the next shot'}`, why: 'an object transition: one thing turns into the next', score: 1.05 });
  return out.sort((a, b) => b.score - a.score).filter((k, idx, arr) => arr.findIndex((x) => x.shot === k.shot) === idx).slice(0, 3);
}

export interface ArtProblem {
  id: string;
  kind: ProblemKind;
  code: string;
  shots: string[];
  /** film seconds measured for this problem (the preview range). */
  range: [number, number];
  boundary?: number;
  items?: string[];
  headline?: string;
  why: string;
  level: 'local' | 'sequence' | 'global';
  candidates: FilmCandidate[];
}

export interface Diagnosis {
  version: 1;
  intents: ShotIntent[];
  keyVisuals: KeyVisual[];
  graph: ChoreographyGraph;
  energy: EnergyReport;
  contributions: Contributions;
  problems: Omit<ArtProblem, 'candidates'>[];
}

const shotRange = (plan: StagePlan, id: string, pad = 0): [number, number] => {
  const s = plan.shots.find((x) => x.id === id)!;
  return [Math.max(0, Math.round((s.start - pad) * 100) / 100), Math.round((s.end + pad) * 100) / 100];
};

export interface DiagnoseOptions {
  film?: FilmPlan | null;
  src?: SampleSource;
  /** NITAAQ_NO_CAMERA: the camera is off — every shot it carried needs a camera-free equivalent. */
  cameraOff?: boolean;
  /** The script as authored (before the camera ablation), to read what the camera was asked to do. */
  original?: ScriptObj;
  voice?: boolean;
  spoken?: Record<string, string>;
  compile?: (s: ScriptObj) => StagePlan;
  /** measured boundaries (pixels) when an animatic exists. */
  boundaries?: Boundary[];
}

/** The Art Director's reading of the film: intents, key visuals, graph, energy, problems (in repair order). */
export function diagnose(script: ScriptObj, plan: StagePlan, o: DiagnoseOptions = {}): Diagnosis & { make: (p: Omit<ArtProblem, 'candidates'>, current: ScriptObj, currentPlan: StagePlan, film?: FilmPlan | null) => FilmCandidate[] } {
  const intents = shotIntents(script, plan);
  const graph = choreographyGraph(script, plan);
  const { report: energy } = buildEnergy(script, plan, o.film?.arcs.energy.curve);
  const contrib = contributions(plan);
  const problems: Omit<ArtProblem, 'candidates'>[] = [];
  const ids = script.shots.map((s) => s.id);
  const last = ids.length - 1;
  const hero = (k: number) => ((script.shots[k] as ShotObj).cast ?? []).find((c) => c.role === 'hero')?.id;
  // local: the hook
  if (energy.issues.some((x) => x.startsWith('WEAK_HOOK')) || intents[0]?.template) problems.push({ id: 'hook', kind: 'hook', code: 'WEAK_HOOK_EXECUTION', shots: [ids[0]], range: [0, Math.min(2.4, plan.shots[0].end)], headline: hero(0), why: energy.issues.find((x) => x.startsWith('WEAK_HOOK')) ?? 'the opening is a template', level: 'local' });
  // local: the CTA payoff (and the cut into it)
  const lastShot = script.shots[last] as ShotObj;
  if (lastShot.purpose === 'cta' && !lastShot.motionChain.some((e) => e.action === 'become')) {
    const r = shotRange(plan, ids[last]);
    problems.push({ id: 'cta', kind: 'cta', code: 'WEAK_PAYOFF_EXECUTION', shots: [ids[last - 1], ids[last]], range: [Math.max(0, r[0] - 1.0), r[1]], boundary: last - 1, why: 'the payoff is a halo behind the button: no event turns the film into the action', level: 'sequence' });
  }
  // local: cuts at risk (measured when an animatic exists), other than the one into the CTA
  const bs = o.boundaries ?? buildBoundaries(plan, o.src ?? {});
  for (const b of bs.filter((x) => boundaryAtRisk(x) && x.index !== last - 1)) problems.push({ id: `cut-${b.id}`, kind: 'boundary', code: b.issues[0]?.code ?? 'BOUNDARY_AT_RISK', shots: [ids[b.index], ids[b.index + 1]], range: [Math.round((plan.shots[b.index].end - 1.0) * 100) / 100, Math.round((plan.shots[b.index + 1].start + 1.0) * 100) / 100], boundary: b.index, why: `${b.id} ${b.score.toFixed(1)} (${b.quality.source}): ${b.issues.map((x) => x.code).join(', ') || 'at risk'}`, level: 'local' });
  // local: information overload
  for (const ov of overloadedShots(plan)) {
    const k = ids.indexOf(ov.shot);
    if (k < 0 || siblingsOf(script, k).length < 3) continue;
    // a process / steps row is a subjects problem (one hero at a time), not a disclosure one
    const stepsLike = /process|step/.test((script.shots[k] as ShotObj).purpose ?? '');
    problems.push({ id: `${stepsLike ? 'subjects' : 'focus'}-${ov.shot}`, kind: stepsLike ? 'subjects' : 'focus', code: 'INFORMATION_OVERLOAD', shots: [ov.shot], range: shotRange(plan, ov.shot), items: siblingsOf(script, k), why: ov.why, level: 'local' });
  }
  // local: a row of small subjects (steps): none of them is ever the subject of the frame
  script.shots.forEach((s, k) => {
    const sibs = siblingsOf(script, k);
    // not the opening (its chips are the hook's business) nor the problem / CTA shots
    if (k === 0 || /hook|problem|cta/.test((s as ShotObj).purpose ?? '')) return;
    if (sibs.length < 2 || problems.some((p) => p.shots.includes(s.id) && (p.kind === 'focus' || p.kind === 'subjects'))) return;
    const comp = plan.shots[k].composition as unknown as { boxes?: Record<string, { w: number; h: number }> } | undefined;
    const areas = sibs.map((id) => plan.elements.find((e) => e.id === id)!).filter(Boolean).map((e) => e.box.w * e.box.h);
    void comp;
    if (Math.max(...areas) < 0.07 && (s as ShotObj).purpose !== 'cta') problems.push({ id: `subjects-${s.id}`, kind: 'subjects', code: 'ROW_OF_SMALL_OBJECTS', shots: [s.id], range: shotRange(plan, s.id), items: sibs, why: `${sibs.length} items, the largest covers ${Math.round(Math.max(...areas) * 100)}% of the frame`, level: 'local' });
  });
  // sequence: the climax
  if (energy.climax && energy.issues.some((x) => x.startsWith('WEAK_CLIMAX') || x.startsWith('FLAT_FILM'))) problems.push({ id: `climax-${energy.climax}`, kind: 'climax', code: energy.issues.some((x) => x.startsWith('FLAT_FILM')) ? 'FLAT_FILM' : 'WEAK_CLIMAX_EXECUTION', shots: [energy.climax], range: shotRange(plan, energy.climax), why: energy.issues.filter((x) => /CLIMAX|FLAT/.test(x)).join('; '), level: 'sequence' });
  // local: flat choreography (template shots) not covered above
  for (const g of graph.shots.filter((x) => x.issues.includes('FLAT_CHOREOGRAPHY'))) {
    if (problems.some((p) => p.shots.includes(g.shot) && p.kind !== 'boundary')) continue;
    problems.push({ id: `choreo-${g.shot}`, kind: 'choreography', code: 'FLAT_CHOREOGRAPHY', shots: [g.shot], range: shotRange(plan, g.shot), why: `${g.events} events, ${Math.round(g.causalShare * 100)}% caused`, level: 'local' });
  }
  // local: the camera carried the shot (or it is off): the element does what the camera did
  // a follow rides the element's own motion: without it nothing the element did is lost
  const isFollow = (id: string) => /follow/.test(((((o.original ?? script).shots.find((s) => s.id === id) as ShotObj | undefined)?.camera ?? {}) as { move?: string }).move ?? '');
  const camShots = (o.cameraOff ? (o.original ?? script).shots.filter((s) => (s as ShotObj).camera && (s as ShotObj).camera !== 'static').map((s) => s.id) : contrib.cameraCarried).filter((id) => !isFollow(id));
  for (const id of camShots) problems.push({ id: `camfree-${id}`, kind: 'camera-free', code: 'CAMERA_CARRYING_SCENE', shots: [id], range: shotRange(plan, id), why: o.cameraOff ? 'the camera is off: what it did must be done by the element' : `the camera carries ${Math.round((1 - (contrib.shots.find((x) => x.shot === id)?.elementShare ?? 0)) * 100)}% of the motion`, level: 'local' });
  // global (reserved budget): the film's energy and internal rhythm
  // (it runs even when the lower levels still have work; its code says what the film-level reading found)
  const flatFilm = energy.issues.some((x) => x.startsWith('FLAT_FILM'));
  const gaps = internalGaps(plan);
  const gm = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const cv = gaps.length > 1 && gm > 0 ? Math.sqrt(gaps.reduce((a, b) => a + (b - gm) ** 2, 0) / gaps.length) / gm : 1;
  const flatEnergy = Object.keys(energy.wanted).length > 1 && Math.max(...Object.values(energy.measured)) - Math.min(...Object.values(energy.measured)) < 0.25;
  const habits = habitsOf(script);
  const gcode = habits.repetitive ? 'REPETITIVE_FILM' : flatFilm ? 'FLAT_FILM' : cv < 0.35 ? 'RHYTHM_TOO_UNIFORM' : flatEnergy ? 'FLAT_ENERGY' : energy.issues.length ? 'ENERGY_OFF_CURVE' : null;
  if (gcode) problems.push({ id: 'global-energy', kind: 'global', code: gcode, shots: ids, range: [0, plan.shots[last].end], why: `film level: ${gcode === 'REPETITIVE_FILM' ? `the same ${[habits.camera && `camera (${habits.camera.value} ${Math.round(habits.camera.share * 100)}%)`, habits.entrance && `entrance (${habits.entrance.value})`, habits.duration && `duration (${habits.duration.value}s)`].filter(Boolean).join(', ')} shot after shot` : gcode === 'RHYTHM_TOO_UNIFORM' ? `internal gaps CV ${cv.toFixed(2)}` : energy.issues.join('; ') || 'measured energy is flat'} (reserved global budget)`, level: 'global' });

  const make = (p: Omit<ArtProblem, 'candidates'>, current: ScriptObj, currentPlan: StagePlan, film?: FilmPlan | null): FilmCandidate[] => {
    const k = ids.indexOf(p.shots[0]);
    switch (p.kind) {
      case 'hook':
        return hookCandidates(current);
      case 'cta': {
        const cut = transformCutCandidates(current, currentPlan, last - 1, film);
        const cta = ctaTransformCandidates(current, film);
        return [...cta, ...cut].slice(0, 4);
      }
      case 'boundary': {
        const b = buildBoundaries(currentPlan, o.src ?? {})[p.boundary!];
        const fromP3 = b ? boundaryCandidates(current, currentPlan, b).filter((c) => c.script).map((c) => ({ id: `p3-${c.move}`, label: `P3 ${c.label}`, script: c.script!, why: c.edits.join('; ') })) : [];
        return [...transformCutCandidates(current, currentPlan, p.boundary!, film), ...fromP3].slice(0, 4);
      }
      case 'focus':
        return focusCandidates(current, currentPlan, k, { voice: o.voice, spoken: o.spoken });
      case 'subjects':
        return [...subjectsCandidates(current, currentPlan, k), ...focusCandidates(current, currentPlan, k).filter((c) => c.id.startsWith('focus-relay'))].slice(0, 4);
      case 'climax':
        return climaxCandidates(current, p.shots[0]);
      case 'choreography':
        return choreographyCandidates(current, k).map((c) => ({ id: `choreo-${c.pattern}-${p.shots[0]}`, label: c.pattern, script: c.script, why: c.why }));
      case 'camera-free': {
        const c = cameraFreeEquivalent(current, k, o.original ?? current);
        const ch = choreographyCandidates(current, k).slice(0, 2).map((x) => ({ id: `choreo-${x.pattern}-${p.shots[0]}`, label: x.pattern, script: x.script, why: x.why }));
        return [...(c ? [{ id: `camfree-${p.shots[0]}`, label: 'camera-free equivalent', script: c.script, why: c.why }] : []), ...ch];
      }
      case 'global': {
        const e = buildEnergy(current, currentPlan, film?.arcs.energy.curve).candidate;
        const r = composeRhythm(e.script, currentPlan, o.compile).candidate;
        const v = globalVarietyCandidate(current, wantedEnergy(current, film?.arcs.energy.curve), { voice: o.voice });
        const vr = v ? { ...v, script: composeRhythm(v.script, currentPlan, o.compile).candidate.script } : null;
        return [...(vr ? [vr] : []), { ...r, id: 'global-energy-rhythm', label: 'energy phrases + composed rhythm', why: `${e.why}; ${r.why}` }, e];
      }
      default:
        return [];
    }
  };
  return { version: 1, intents, keyVisuals: keyVisuals(script, plan, intents), graph, energy, contributions: contrib, problems, make };
}

export type { ArtCandidate };
