/**
 * P4-F/G/X — Cross-Element Transform, the CTA transformation, transition transformation intelligence.
 *
 * Cross-Element Transform is the one new motion primitive of P4 (compiler action "become"): element A
 * travels to B's place, takes B's outline and size (a circle rounds into a pill, a card rounds into a
 * circle, its content letting go), and hands over to B at the instant it arrives — B appears exactly there
 * and settles with a small kick. Why: the films' strongest moments are "this BECOMES that" and P3 could only
 * do it at a cut (morph); inside a shot it had nothing. Where: the CTA (the motif circle becomes the button)
 * and any shot that resolves into an element. How: three tracks on A (travel + sx/sy, morph, hand-over) and
 * B's entrance re-timed to A's arrival. Cost: compile-time only, no new renderer layer (the card rounding
 * is a border-radius / colour mix on the existing card). Fallback: a user asset (image, ui) is never
 * reshaped — it dissolves into B in place (a crossfade), reported as BECOME_FALLBACK.
 *
 * The CTA transformation (G): the circle that began the film's idea becomes the button — the payoff is an
 * event, not a halo behind the button. Transition intelligence (X): a cut into a transform-carried shot is
 * re-planned as a whole: the carrier is fed by the other items (they are drawn into it once read, so the
 * frame never empties), or the carrier becomes the motif which then becomes the action.
 * Pure: candidates only; the preview renders decide.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';
import type { FilmPlan } from '../film/film-plan';
import type { ArtCandidate } from './energy';

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason: string; [k: string]: unknown };
type Cast = { id: string; role?: string; enter?: string; behind?: string; scale?: number; at?: { x: number; y: number }; w?: number; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; timing?: { duration?: number }; transitionOut?: unknown; transitionReason?: string; [k: string]: unknown };

export type FilmCandidate = ArtCandidate & { film?: FilmPlan };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const kindOf = (script: ScriptObj, id: string) => script.stage?.elements.find((e) => e.id === id)?.kind ?? '';

export interface TransformFeasibility {
  ok: boolean;
  primitive: 'become' | 'morph' | 'shape-transform' | 'crossfade';
  why: string;
}

/** Can A become B (inside a shot or at a cut)? Assets never reshape (crossfade fallback). */
export function canTransform(script: ScriptObj, from: string, into: string): TransformFeasibility {
  const a = kindOf(script, from);
  const b = kindOf(script, into);
  if (!a || !b) return { ok: false, primitive: 'crossfade', why: `${!a ? from : into} is not a stage element` };
  if (a === 'image' || a === 'ui') return { ok: true, primitive: 'crossfade', why: `${from} is a user asset (${a}): never reshaped — it dissolves into ${into}` };
  if (['shape', 'card', 'chip', 'button'].includes(a)) return { ok: true, primitive: 'become', why: `${from} (${a}) can take ${into}'s outline (${b})` };
  return { ok: true, primitive: 'become', why: `${from} (${a}) travels and scales into ${into}'s place (no outline change)` };
}

/** The circle (motif) the CTA can be made of: the film's motif resolving on the last shot, else an early shape. */
export function ctaSource(script: ScriptObj, film?: FilmPlan | null): { element: string; motif?: string; why: string } | null {
  const last = script.shots[script.shots.length - 1];
  const m = film?.motifs.find((x) => x.finalResolution.shot === last.id);
  if (m && kindOf(script, m.element) === 'shape') return { element: m.element, motif: m.id, why: `motif ${m.id} (${m.identity}) resolves on the CTA` };
  for (const s of script.shots.slice(0, Math.ceil(script.shots.length / 2)))
    for (const c of s.cast ?? []) if (kindOf(script, c.id) === 'shape') return { element: c.id, why: `${c.id} appeared in ${s.id}, early in the film` };
  return null;
}

const button = (script: ScriptObj, sh: ShotObj) => (sh.cast ?? []).find((c) => kindOf(script, c.id) === 'button')?.id;

/** CTA transformation candidates (G): the motif circle becomes the button. */
export function ctaTransformCandidates(script: ScriptObj, film?: FilmPlan | null): FilmCandidate[] {
  const li = script.shots.length - 1;
  const last = script.shots[li] as ShotObj;
  if (last.purpose !== 'cta') return [];
  const btn = button(script, last);
  const src = ctaSource(script, film);
  if (!btn || !src) return [];
  const out: FilmCandidate[] = [];
  const patchFilm = (f?: FilmPlan | null): FilmPlan | undefined => {
    if (!f || !src.motif) return undefined;
    const g = clone(f);
    const m = g.motifs.find((x) => x.id === src.motif)!;
    m.finalResolution = { ...m.finalResolution, as: 'transform', into: btn, note: `${m.identity} becomes the button: the one place is the one action` };
    if (g.ending.payoff) g.ending.payoff = { ...g.ending.payoff, how: `${m.identity} becomes the button` };
    return g;
  };
  const cursorAfter = (sh: ShotObj, ref: string) => {
    for (const e of sh.motionChain) if (kindOf(script, e.element) === 'cursor' && e.action === 'move' && !e.after) {
      // the cursor sets off while the circle is still becoming the button (overlap, not a queue): the press
      // and the closing hold keep their time
      delete e.at;
      e.after = ref.replace(/\.end$/, '.peak');
      e.dur = Math.min(e.dur ?? 0.6, 0.45);
    }
  };
  // G1: the circle comes back behind the button's place and becomes it (no travel: a pure change of shape)
  {
    const sc = clone(script);
    const sh = sc.shots[li] as ShotObj;
    sh.cast = (sh.cast ?? []).filter((c) => c.id !== src.element);
    sh.cast.push({ id: src.element, role: 'background', behind: btn, scale: 1.25, enter: 'scale' });
    sh.motionChain = sh.motionChain.filter((e) => !(e.element === src.element && e.action === 'become'));
    sh.motionChain.unshift({ id: 'circle-becomes', element: src.element, action: 'become', to: btn, at: 0.35, dur: 0.7, reason: 'the circle that gathered everything becomes the one button' });
    cursorAfter(sh, 'circle-becomes.end');
    out.push({ id: 'cta-circle-becomes', label: 'circle → button (in place)', script: sc, film: patchFilm(film), why: `${src.element} returns where the button will be and turns into ${btn} (${src.why})` });
  }
  // G2: the circle arrives at the frame's centre, then travels and becomes the button
  {
    const sc = clone(script);
    const sh = sc.shots[li] as ShotObj;
    sh.cast = (sh.cast ?? []).filter((c) => c.id !== src.element);
    sh.cast.push({ id: src.element, role: 'background', behind: btn, scale: 1.6, enter: 'scale' });
    sh.motionChain = sh.motionChain.filter((e) => !(e.element === src.element && e.action === 'become'));
    sh.motionChain.unshift({ id: 'circle-pops', element: src.element, action: 'impact', at: 0.3, amount: 0.08, reason: 'the circle comes back with a beat' });
    sh.motionChain.unshift({ id: 'circle-becomes', element: src.element, action: 'become', to: btn, after: 'circle-pops.end', dur: 0.6, reason: 'and contracts into the button: the idea becomes the action' });
    cursorAfter(sh, 'circle-becomes.end');
    out.push({ id: 'cta-circle-beat-becomes', label: 'circle beat → button', script: sc, film: patchFilm(film), why: `${src.element} returns larger, beats once and contracts into ${btn}` });
  }
  return out;
}

/** Transition intelligence (X): candidates for the cut out of shot i when it is carried by a transform. */
export function transformCutCandidates(script: ScriptObj, plan: StagePlan, i: number, film?: FilmPlan | null): FilmCandidate[] {
  const s = script.shots[i] as ShotObj;
  const tr = s.transitionOut as { type?: string; element?: string; into?: string } | undefined;
  if (!tr || typeof tr !== 'object' || !['morph', 'shape-transform'].includes(tr.type ?? '') || !tr.element) return [];
  const carrier = tr.element;
  const others = (s.cast ?? []).filter((c) => c.id !== carrier && kindOf(script, c.id) === kindOf(script, carrier)).map((c) => c.id);
  const out: FilmCandidate[] = [];
  const dur = s.timing?.duration ?? plan.shots[i].end - plan.shots[i].start;
  // X1: the others are drawn into the carrier once read (no outward exits that empty the frame before the morph)
  if (others.length) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const t0 = Math.max(1.4, dur - 1.05);
    others.forEach((id, k) => sh.motionChain.push({ id: `feed-${k + 1}`, element: id, action: 'attract', to: carrier, ...(k === 0 ? { at: Math.round(t0 * 100) / 100 } : { after: `feed-${k}.start` }), dur: 0.45, reason: 'once read, the others pour into the card that carries the cut: the frame stays full' }));
    out.push({ id: `cut-feed-${s.id}`, label: 'feed the carrier', script: sc, why: `${others.length} item(s) are drawn into ${carrier} before it transforms` });
  }
  // X2: the carrier becomes the film's circle (the motif) — which then becomes the action (with the CTA transform)
  const last = script.shots.length - 1;
  if (i === last - 1 && tr.into && kindOf(script, tr.into) === 'button') {
    const cta = ctaTransformCandidates(script, film)[0];
    const src = cta ? ctaSource(script, film) : null;
    if (cta && src && kindOf(script, carrier) !== 'image') {
      const sc = clone(cta.script);
      const sh = sc.shots[i] as ShotObj;
      sh.transitionOut = { type: 'morph', element: carrier, into: src.element };
      sh.transitionReason = `the card becomes the circle — and the circle becomes the button`;
      const nx = sc.shots[last] as ShotObj;
      const hub = nx.cast!.find((c) => c.id === src.element)!;
      // it arrives by the morph: the circle keeps the button's place (behind), the become starts once it is there
      hub.scale = 1.25;
      const be = nx.motionChain.find((e) => e.id === 'circle-becomes')!;
      be.at = 0.5;
      out.push({ id: `cut-card-circle-button-${s.id}`, label: 'card → circle → button', script: sc, film: cta.film, why: `${carrier} morphs into ${src.element} at the cut, which then becomes ${tr.into}` });
    }
  }
  return out;
}
