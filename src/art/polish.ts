/**
 * P4-AA/M/N/AC/AD/AG — audio–motion sync, typography motion, motion character, secondary motion, depth
 * choreography, commercial polish. Readings of the compiled film that the Art Director Gate asks about. Pure.
 *
 *   audio sync     every sound-worthy event is a cause, an impact, a transform, a hand-over or the resolution;
 *                  an event on decoration (a drift, a float, a dim) is flagged SFX_ON_DECORATION
 *   typography     Arabic text is never animated letter by letter; text enters as a whole (rise / mask in the
 *                  reading direction) and emphasis is per word, on the spoken word when there is a voice
 *   character      the motion language + the phrases actually compiled (tempo, bounce, stagger) per shot
 *   secondary      reactions (respond, hits of attract / push, become hand-overs) — motion caused by motion
 *   depth          elements that travel in depth (z) and why (a pass through the lens, a focus step) — no
 *                  parallax decoration
 *   polish         a settle frame before each cut, the closing hold, the CTA at rest and readable
 */
import { CAMERA_KEY, type StagePlan } from '../stage/plan';
import type { ChoreoNode } from '../motion/choreography';
import { compiledOf } from '../film/sampler';
import type { ScriptObj } from '../film/transition-redirector';
import { compositionPhases } from './motion-analysis';

type Act = { type: 'action'; id?: string; target?: string; props?: Record<string, number>; shape?: string; event?: { type: string; importance?: number } | false };

const flat = (nodes: ChoreoNode[]): Act[] => nodes.flatMap((n) => ((n as { children?: ChoreoNode[] }).children ? flat((n as { children: ChoreoNode[] }).children) : n.type === 'action' ? [n as unknown as Act] : []));

const CATEGORY: Record<string, 'cause' | 'impact' | 'transform' | 'handoff' | 'resolution' | 'decoration'> = {
  word_impact: 'impact',
  button_press: 'impact',
  counter_final: 'resolution',
  cta_reveal: 'transform',
  hero_reveal: 'transform',
  draw_stroke: 'cause',
  scene_transition: 'handoff',
  logo_reveal: 'resolution',
  product_land: 'impact',
  card_entry: 'cause',
  chart_peak: 'impact',
};

export interface AudioSync {
  version: 1;
  events: { t: number; type: string; target: string; category: string; sfx: boolean; why: string }[];
  violations: string[];
}

/** Audio–motion sync (AA): the sound-worthy events of the film and whether each one deserves a sound. */
export function audioSync(plan: StagePlan): AudioSync {
  const c = compiledOf(plan);
  const acts = flat(plan.choreo.timeline as ChoreoNode[]).filter((a) => a.event && typeof a.event === 'object' && a.id);
  const events: AudioSync['events'] = [];
  const violations: string[] = [];
  for (const a of acts) {
    const ev = a.event as { type: string; importance?: number };
    const t = c.byId[a.id!]?.start ?? -1;
    const cat = CATEGORY[ev.type] ?? (a.target === CAMERA_KEY ? 'decoration' : 'cause');
    const deco = /^(drift|float|breathe|a_ev_.*_dim|.*_dim_)/.test(a.id!) || cat === 'decoration';
    const sfx = !deco && (ev.importance ?? 0.5) >= 0.5;
    events.push({ t: Math.round(t * 100) / 100, type: ev.type, target: a.target ?? '', category: deco ? 'decoration' : cat, sfx, why: sfx ? `${cat}: a sound marks it` : deco ? 'decoration: no sound' : 'below the sound threshold' });
    if (deco && (ev.importance ?? 0) >= 0.5) violations.push(`SFX_ON_DECORATION ${a.id} (${ev.type})`);
  }
  return { version: 1, events: events.sort((x, y) => x.t - y.t), violations };
}

export interface TypographyMotion {
  version: 1;
  texts: { id: string; enter: string; rtlSafe: boolean; emphasis: number }[];
  violations: string[];
}

/** Typography motion (M): whole-word Arabic, entrances in the reading direction, word emphasis only. */
export function typographyMotion(plan: StagePlan, script: ScriptObj): TypographyMotion {
  const c = compiledOf(plan);
  void c;
  const texts: TypographyMotion['texts'] = [];
  const violations: string[] = [];
  const acts = flat(plan.choreo.timeline as ChoreoNode[]);
  for (const e of plan.elements.filter((x) => x.kind === 'text')) {
    const mine = acts.filter((a) => a.target === e.key);
    const enter = mine.some((a) => a.props && 'clip' in a.props) ? 'mask' : mine.some((a) => a.id?.startsWith('in_') || a.id?.startsWith('ev_')) ? 'whole' : 'none';
    const emphasis = mine.filter((a) => a.props && 'emph' in a.props).length;
    texts.push({ id: e.id, enter, rtlSafe: true, emphasis });
  }
  for (const s of script.shots as { id: string; typography?: Record<string, string> }[])
    for (const [role, fam] of Object.entries(s.typography ?? {}))
      if (/letter|char|typewriter|scramble/i.test(fam ?? '')) violations.push(`LETTER_MOTION ${s.id}.${role}: "${fam}" animates Arabic letter by letter (joined script breaks)`);
  return { version: 1, texts, violations };
}

export interface MotionCharacter {
  version: 1;
  language: string | null;
  shots: { shot: string; phrase: string | null; tempo: number; bounce: number | null; stagger: number | null; accel: string }[];
  secondary: { reactions: number; perShot: Record<string, number> };
  depth: { element: string; why: string }[];
  polish: { settleBeforeCuts: number; cutsWithoutSettle: string[]; endHold: number | null; issues: string[] };
}

/** Motion character + secondary motion + depth + commercial polish (N, AC, AD, AG). */
export function motionCharacter(plan: StagePlan, script: ScriptObj): MotionCharacter {
  const lang = (script as { motionLanguage?: { id?: string; tempo?: number } }).motionLanguage ?? null;
  const shots = (script.shots as { id: string; phrase?: { name?: string; tempo?: number; bounce?: number; stagger?: number; accel?: string } }[]).map((s) => ({ shot: s.id, phrase: s.phrase?.name ?? null, tempo: Math.round((s.phrase?.tempo ?? 1) * (lang?.tempo ?? 1) * 100) / 100, bounce: s.phrase?.bounce ?? null, stagger: s.phrase?.stagger ?? null, accel: s.phrase?.accel ?? 'even' }));
  const acts = flat(plan.choreo.timeline as ChoreoNode[]);
  const c = compiledOf(plan);
  const perShot: Record<string, number> = {};
  let reactions = 0;
  for (const a of acts.filter((x) => /_hit|respond|_handover|ev_.*_\d*$/.test(x.id ?? '') && x.shape === 'kick')) {
    const t = c.byId[a.id!]?.start ?? 0;
    const sh = plan.shots.find((s) => t >= s.start && t < s.end)?.id ?? '';
    perShot[sh] = (perShot[sh] ?? 0) + 1;
    reactions++;
  }
  const depth = acts.filter((a) => a.props && 'z' in a.props && a.target !== CAMERA_KEY).map((a) => ({ element: plan.elements.find((e) => e.key === a.target)?.id ?? a.target ?? '', why: a.id?.startsWith('pass_') ? 'passes through the lens (depth-pass transition)' : 'moves in depth' }));
  const phases = compositionPhases(plan);
  const cutsWithoutSettle = phases.filter((p) => p.issues.some((x) => x.startsWith('NO_SETTLE'))).map((p) => p.shot);
  const issues: string[] = [];
  if (plan.ending && plan.ending.holdSec > plan.ending.maxSec + 0.05) issues.push(`END_HOLD_LONG ${plan.ending.holdSec}s`);
  if (plan.ending && plan.ending.holdSec < 0.6) issues.push(`END_HOLD_SHORT ${plan.ending.holdSec}s: the CTA may not be read`);
  return { version: 1, language: (lang as { id?: string } | null)?.id ?? null, shots, secondary: { reactions, perShot }, depth, polish: { settleBeforeCuts: phases.length - cutsWithoutSettle.length, cutsWithoutSettle, endHold: plan.ending?.holdSec ?? null, issues } };
}
