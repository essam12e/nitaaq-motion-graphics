/**
 * P4-T/U — the Art Director Gate. After the Motion Critic (which judges technique: text cut, collisions,
 * dead holds), the Art Director asks whether the film is DIRECTED: is there an idea, a hero action, a key
 * visual, a payoff, a rhythm? Each "no" is a rejection code with its evidence. The gate never invents a
 * fix: its codes go to art_gate.json and, when they are the art pass's own failures, the problem list of
 * the next run (and the P3 fallback when the art pass broke something technical). Pure.
 *
 *   WEAK_VISUAL_IDEA       most shots have no main visual action beyond "things appear"
 *   NO_HERO_ACTION         a hero shot (hook / climax / CTA) has no event on its hero
 *   TEMPLATE_MOTION        over 40% of the shots are entrances on a clock
 *   CAMERA_CARRYING_SCENE  the camera carries a shot's motion (element share under 50%)
 *   FLAT_CHOREOGRAPHY      a shot's events are not caused by each other
 *   NO_KEY_VISUAL          no moment scores as a key visual (a transformation, a gathering, an object cut)
 *   WEAK_TRANSFORMATION    no element becomes another anywhere in the film
 *   MOTION_WITHOUT_CAUSE   motion with no cause (graph)
 *   WEAK_HOOK_EXECUTION    the opening is under its energy / slow to move
 *   WEAK_CLIMAX_EXECUTION  the climax shot is not the peak it should be
 *   WEAK_PAYOFF_EXECUTION  the CTA has no event (no press, no transform into the action)
 *   INFORMATION_OVERLOAD   3+ ideas arrive at once with no focus order
 *   RHYTHM_TOO_UNIFORM     the internal gaps are a metronome (coefficient of variation under 0.25)
 *   GENERIC_BRAND_MOTION   no brand motion language: every brand moves the same
 *   OVER_ANIMATED          motion clutter (several things moving over moving text)
 *   UNDER_ANIMATED         motion voids outside the closing hold, over 18% of the film
 */
import type { ShotIntent, KeyVisual } from './director';
import type { ChoreographyGraph } from './choreography';
import type { EnergyReport, RhythmCompose } from './energy';
import type { Contributions, DensityTimeline } from './motion-analysis';
import type { ScriptObj } from '../film/transition-redirector';

export const AD_CODES = ['WEAK_VISUAL_IDEA', 'NO_HERO_ACTION', 'TEMPLATE_MOTION', 'CAMERA_CARRYING_SCENE', 'FLAT_CHOREOGRAPHY', 'NO_KEY_VISUAL', 'WEAK_TRANSFORMATION', 'MOTION_WITHOUT_CAUSE', 'WEAK_HOOK_EXECUTION', 'WEAK_CLIMAX_EXECUTION', 'WEAK_PAYOFF_EXECUTION', 'INFORMATION_OVERLOAD', 'RHYTHM_TOO_UNIFORM', 'GENERIC_BRAND_MOTION', 'OVER_ANIMATED', 'UNDER_ANIMATED'] as const;
export type AdCode = (typeof AD_CODES)[number];

/** Codes that reject the film (the others are notes): a film without an idea, a payoff or a hero action. */
const BLOCKING: AdCode[] = ['WEAK_VISUAL_IDEA', 'NO_KEY_VISUAL', 'WEAK_PAYOFF_EXECUTION', 'OVER_ANIMATED'];

export interface GateInput {
  script: ScriptObj;
  intents: ShotIntent[];
  keyVisuals: KeyVisual[];
  graph: ChoreographyGraph;
  energy: EnergyReport;
  rhythm: RhythmCompose;
  contributions: Contributions;
  density: DensityTimeline;
  overloaded: { shot: string; why: string }[];
  durationSec: number;
  /** the camera is off (NITAAQ_NO_CAMERA): the camera cannot carry anything. */
  cameraOff?: boolean;
}

export interface AdRejection {
  code: AdCode;
  shots: string[];
  evidence: string;
  blocking: boolean;
}

export interface ArtGate {
  version: 1;
  passed: boolean;
  rejections: AdRejection[];
  notes: string[];
  summary: { mainActions: { shot: string; action: string; event: boolean }[]; keyVisuals: { shot: string; t: number; what: string }[] };
}

type ShotObj = { id: string; purpose?: string; cast?: { id: string; role?: string }[]; motionChain: { element: string; action: string; to?: string }[] };

/** The Art Director's verdict on a compiled film. */
export function artGate(g: GateInput): ArtGate {
  const out: AdRejection[] = [];
  const add = (code: AdCode, shots: string[], evidence: string) => out.push({ code, shots, evidence, blocking: BLOCKING.includes(code) });
  const shots = g.script.shots as unknown as ShotObj[];
  const n = Math.max(1, g.intents.length);
  const templ = g.intents.filter((i) => i.template);
  const events = g.intents.filter((i) => i.visualEvent);
  if (events.length === 0 || events.length / n < 0.25) add('WEAK_VISUAL_IDEA', g.intents.filter((i) => !i.visualEvent).map((i) => i.shot), `${events.length}/${n} shots perform a visual event`);
  if (templ.length / n > 0.4) add('TEMPLATE_MOTION', templ.map((i) => i.shot), `${templ.length}/${n} shots are entrances on a clock`);
  // hero shots: the hook, the climax and the CTA
  const heroShots = [shots[0]?.id, g.energy.climax, shots[shots.length - 1]?.id].filter((x, k, a): x is string => Boolean(x) && a.indexOf(x) === k);
  for (const id of heroShots) {
    const s = shots.find((x) => x.id === id);
    const it = g.intents.find((x) => x.shot === id);
    const hero = s?.cast?.find((c) => c.role === 'hero')?.id;
    const acts = (s?.motionChain ?? []).filter((e) => e.element === hero || e.to === hero).filter((e) => e.action !== 'enter' && e.action !== 'exit');
    if (!it?.visualEvent && !acts.length) add('NO_HERO_ACTION', [id], `${id}: the hero (${hero ?? '—'}) only appears`);
  }
  if (!g.cameraOff && g.contributions.cameraCarried.length) add('CAMERA_CARRYING_SCENE', g.contributions.cameraCarried, g.contributions.diagnostic.join('; ') || 'camera share over 50%');
  const flat = g.graph.shots.filter((s) => s.issues.includes('FLAT_CHOREOGRAPHY')).map((s) => s.shot);
  if (flat.length) add('FLAT_CHOREOGRAPHY', flat, `${flat.length} shot(s) whose events do not cause each other`);
  const noCause = g.graph.shots.filter((s) => s.issues.includes('MOTION_WITHOUT_CAUSE')).map((s) => s.shot);
  if (noCause.length) add('MOTION_WITHOUT_CAUSE', noCause, 'motion with no cause in the graph');
  if (!g.keyVisuals.some((k) => k.score >= 0.8)) add('NO_KEY_VISUAL', [], `best moment ${g.keyVisuals[0]?.what ?? '—'} (${g.keyVisuals[0]?.score ?? 0})`);
  const anyBecome = shots.some((s) => s.motionChain.some((e) => e.action === 'become')) || (g.graph.film.byType.transform ?? 0) > 0;
  if (!anyBecome) add('WEAK_TRANSFORMATION', [], 'nothing becomes anything else in the film');
  for (const iss of g.energy.issues) {
    if (iss.startsWith('WEAK_HOOK')) add('WEAK_HOOK_EXECUTION', [shots[0]?.id ?? ''], iss);
    if (iss.startsWith('WEAK_CLIMAX') || iss.startsWith('FLAT_FILM')) add('WEAK_CLIMAX_EXECUTION', g.energy.climax ? [g.energy.climax] : [], iss);
  }
  const last = shots[shots.length - 1];
  if (last && /cta/.test(last.purpose ?? '') && !last.motionChain.some((e) => ['become', 'press', 'impact'].includes(e.action))) add('WEAK_PAYOFF_EXECUTION', [last.id], 'the CTA only appears: no press, no transform into the action');
  // overload: only when the shot has no focus order
  const unfocused = g.overloaded.filter((o) => !shots.find((s) => s.id === o.shot)?.motionChain.some((e) => e.action === 'focus' || e.action === 'settle'));
  if (unfocused.length) add('INFORMATION_OVERLOAD', unfocused.map((o) => o.shot), unfocused.map((o) => o.why).join('; '));
  if (g.rhythm.cvAfter < 0.25) add('RHYTHM_TOO_UNIFORM', [], `internal gaps CV ${g.rhythm.cvAfter}`);
  if (!(g.script as { motionLanguage?: unknown }).motionLanguage) add('GENERIC_BRAND_MOTION', [], 'no brand motion language');
  const clutter = g.density.clutter.reduce((a, c) => a + (c.t1 - c.t0), 0);
  if (clutter > 0.8) add('OVER_ANIMATED', [], `${clutter.toFixed(1)}s of motion clutter (${g.density.clutter.map((c) => `${c.t0}–${c.t1}s`).join(', ')})`);
  const voids = g.density.voids.reduce((a, c) => a + (c.t1 - c.t0), 0);
  if (voids / Math.max(1, g.durationSec) > 0.18) add('UNDER_ANIMATED', [], `${voids.toFixed(1)}s of motion voids (${Math.round((voids / g.durationSec) * 100)}% of the film)`);
  const notes = out.filter((r) => !r.blocking).map((r) => `${r.code}: ${r.evidence}`);
  return {
    version: 1,
    passed: !out.some((r) => r.blocking),
    rejections: out,
    notes,
    summary: { mainActions: g.intents.map((i) => ({ shot: i.shot, action: i.mainAction, event: i.visualEvent })), keyVisuals: g.keyVisuals.map((k) => ({ shot: k.shot, t: k.t, what: k.what })) },
  };
}
