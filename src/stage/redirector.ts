/**
 * Composition Re-Director (P2-C).
 *
 * When a shot fails visually (a row of equal small cards, a subject read second, a frame two-thirds
 * empty), the answer is not "scale it up 30%": it is a different ORGANISATION of the same elements.
 * The Re-Director:
 *   1. diagnoses the shot — shot size, element count, the seen hierarchy, what steals the space;
 *   2. proposes strategies that fit the content (any kind, any count — nothing here knows "features");
 *   3. predicts each one's effect from geometry (the same Composition Engine the compiler runs, judged
 *      with the critic's own curves), with its cost and its risk to the shot's intent;
 *   4. returns them ranked; the Repair Planner picks, renders, measures and compares.
 * Pure (no node APIs).
 */
import type { StagePlan } from './plan';
import type { CriticReport, ShotVisual } from '../qc/critic';
import { curve } from '../qc/critic';
import { composeShot, defaultAspect, OCCUPANCY, resolveStrategy, subjectTypeOf, unionArea, type Box, type ComposeElement, type ShotSize, type Strategy, type CastRole } from './composition';
import type { ShotRedirection, RepairCost } from './redirection';

export interface Diagnosis {
  shot: string;
  codes: string[];
  findings: string[];
  /** Root causes a strategy can answer. */
  causes: ('row-of-equals' | 'weak-subject' | 'too-much-space' | 'crowded' | 'off-balance' | 'unreadable' | 'subject-not-first' | 'weak-cta')[];
  elementCount: number;
  shotSize: string;
  strategy: string;
}

export interface Prediction {
  score: number;
  heroOcc: number;
  contentOcc: number;
  dominance: number;
  overlap: number;
  minItem: number;
}

export interface Candidate {
  id: string;
  shot: string;
  kind: 'recompose' | 'local' | 'camera' | 'transition' | 'depth' | 'timing';
  directive: ShotRedirection;
  predicted?: Prediction;
  /** Predicted shot score change (critic scale). */
  gain: number;
  cost: RepairCost;
  /** Chance the candidate removes the issue (0..1), when geometry cannot predict it. */
  confidence: number;
  risk: string;
  /** Short label for logs and the report. */
  label: string;
}

export const COST_WEIGHT: Record<RepairCost, number> = { low: 0.1, medium: 0.35, high: 0.8, 'very-high': 1.6 };

type CastObj = { id: string; role?: string; at?: { x: number; y: number }; w?: number };
type ShotObj = { id: string; purpose?: string; subject?: string; shotSize?: string; composition?: string; cast?: CastObj[]; motionChain?: { id?: string; element: string; action: string; to?: string; at?: unknown; after?: string }[]; timing?: { duration?: number }; [k: string]: unknown };
type ScriptObj = { shots: ShotObj[]; stage?: { elements: { id: string; kind: string; asset?: string; text?: string; title?: string; size?: { w?: number; aspect?: number }; parent?: string }[] } };

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function diagnoseShot(critic: CriticReport, script: ScriptObj, shotId: string): Diagnosis {
  const s = script.shots.find((x) => x.id === shotId)!;
  const v = critic.shots.find((x) => x.shot === shotId);
  const iss = critic.issues.filter((i) => i.shot === shotId);
  const codes = [...new Set(iss.map((i) => i.code))];
  const causes: Diagnosis['causes'] = [];
  const has = (c: string) => codes.includes(c as never);
  if (has('ROW_OF_SMALL_OBJECTS')) causes.push('row-of-equals');
  if (has('TINY_SUBJECT') || (v && v.scores.frameUtilization < 5.5)) causes.push('weak-subject');
  if (has('NO_DOMINANT_SUBJECT')) causes.push('subject-not-first');
  if (has('EXCESS_NEGATIVE_SPACE') || has('EMPTY_COMPOSITION')) causes.push('too-much-space');
  if (has('CROWDED_FRAME')) causes.push('crowded');
  if (has('UNBALANCED')) causes.push('off-balance');
  if (has('UNREADABLE_TEXT')) causes.push('unreadable');
  if (has('WEAK_CTA_COMPOSITION') || has('FLAT_TYPOGRAPHY') && s.purpose === 'cta') causes.push('weak-cta');
  if (v && v.scores.hierarchy < 5.5 && !causes.includes('subject-not-first') && !causes.includes('row-of-equals')) causes.push('subject-not-first');
  const findings = iss.map((i) => `${i.code}: ${i.evidence}`);
  if (v) findings.unshift(`shot ${v.overall}/10 (${v.band}) — frame ${v.scores.frameUtilization}, hierarchy ${v.scores.hierarchy}, composition ${v.scores.composition}, type ${v.scores.typography}; subject ${Math.round(v.measured.subjectOcc * 100)}%, content ${Math.round(v.measured.contentOcc * 100)}%${v.hierarchy ? `; read ${v.hierarchy.readOrder.slice(0, 3).join(' → ')}` : ''}`);
  return { shot: shotId, codes, findings, causes, elementCount: (s.cast ?? []).length, shotSize: String(s.shotSize ?? 'wide'), strategy: String(s.composition ?? 'centered') };
}

/** The compose input of a script shot (what the compiler would hand the Composition Engine). */
export function composeInputOf(plan: StagePlan, script: ScriptObj, shotId: string, over: { strategy?: string; shotSize?: string; subject?: string; unpin?: boolean } = {}) {
  const s = script.shots.find((x) => x.id === shotId)!;
  const decls = new Map((script.stage?.elements ?? []).map((d) => [d.id, d]));
  const W = plan.W;
  const H = plan.H;
  const els: ComposeElement[] = (s.cast ?? [])
    .filter((c) => !decls.get(c.id)?.parent)
    .map((c) => {
      const d = decls.get(c.id)!;
      const pe = plan.elements.find((e) => e.id === c.id);
      const chars = (d?.text ?? d?.title ?? '').length;
      const aspect = d?.size?.aspect ?? (d && (d.kind === 'image' || d.kind === 'ui') && pe ? (pe.box.w * W) / Math.max(1e-6, pe.box.h * H) : defaultAspect((d?.kind ?? 'shape') as never, chars));
      let role = (c.role ?? 'support') as CastRole;
      if (over.subject) role = c.id === over.subject ? 'hero' : role === 'hero' ? 'secondary' : role;
      const keepPin = !over.unpin || d?.kind === 'cursor';
      return { id: c.id, kind: (d?.kind ?? 'shape') as never, role, aspect, assetKind: d?.asset === 'logo' || /logo/.test(c.id) ? 'logo' : d?.asset === 'screenshot' ? 'screenshot' : d?.asset, at: keepPin ? c.at : undefined, w: keepPin ? (c.w ?? d?.size?.w) : d?.size?.w && d.kind !== 'card' ? d.size.w : undefined, chars };
    });
  return { W, H, safe: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, rtl: plan.rtl, shotSize: (over.shotSize ?? s.shotSize ?? 'wide') as ShotSize, purpose: String(s.purpose ?? ''), elements: els, strategy: over.strategy ?? s.composition };
}

/** Judges a layout with the critic's own curves (geometry only: no contrast, no motion). */
export function predictLayout(boxes: Record<string, Box>, els: ComposeElement[], W: number, H: number): Prediction {
  const hero = els.find((e) => e.role === 'hero') ?? els[0];
  const area = (b: Box) => Math.max(0, Math.min(b.x + b.w / 2, 1) - Math.max(b.x - b.w / 2, 0)) * Math.max(0, Math.min(b.y + b.h / 2, 1) - Math.max(b.y - b.h / 2, 0));
  const vis = els.filter((e) => e.role !== 'background' && e.kind !== 'cursor' && boxes[e.id]);
  const hb = hero ? boxes[hero.id] : undefined;
  const heroOcc = hb ? area(hb) : 0;
  const contentOcc = unionArea(vis.map((e) => boxes[e.id]));
  const st = hero ? subjectTypeOf(hero.kind, hero.assetKind) : 'shape';
  const sizeNow = 'medium';
  void sizeNow;
  const others = vis.filter((e) => e !== hero).map((e) => area(boxes[e.id]));
  const best = others.length ? Math.max(...others) : 0;
  // dominance proxy: linear size ratio (text weighs as its type: ×1.25)
  const weight = (e: ComposeElement | undefined, a: number) => Math.sqrt(a) * (e?.kind === 'text' ? 1.25 : e?.kind === 'line' ? 0.7 : 1);
  const bestEl = vis.filter((e) => e !== hero).sort((a, b) => area(boxes[b.id]) - area(boxes[a.id]))[0];
  const dominance = best > 0 ? weight(hero, heroOcc) / weight(bestEl, best) : 3;
  let overlap = 0;
  for (let i = 0; i < vis.length; i++)
    for (let j = i + 1; j < vis.length; j++) {
      const a = boxes[vis[i].id];
      const b = boxes[vis[j].id];
      const ix = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
      const iy = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
      if (vis[i].kind === 'line' || vis[j].kind === 'line') continue;
      overlap = Math.max(overlap, (ix * iy) / Math.max(1e-6, Math.min(a.w * a.h, b.w * b.h)));
    }
  const items = vis.filter((e) => e.kind !== 'text' && e.kind !== 'line' && e.kind !== 'cursor' && subjectTypeOf(e.kind, e.assetKind) !== 'logo');
  const minItem = items.length ? Math.min(...items.map((e) => area(boxes[e.id]))) : 1;
  void st;
  return { score: 0, heroOcc: r3(heroOcc), contentOcc: r3(contentOcc), dominance: r3(dominance), overlap: r3(overlap), minItem: r3(minItem) };
}

/** Shot score of a predicted layout (critic curves: frame, hierarchy, negative space, collisions, readable items). */
export function scorePrediction(p: Prediction, target: [number, number], opts: { logo?: boolean; group?: boolean } = {}): number {
  const lo = Math.max(1e-3, target[0]);
  const hi = Math.max(lo, target[1]);
  let fu = p.heroOcc <= hi ? curve(p.heroOcc / lo, [[0, 0.5], [0.35, 2], [0.6, 3.8], [0.8, 5.2], [1, 7]]) : curve(p.heroOcc / hi, [[1, 7.4], [1.5, 7], [2.4, 5.5], [4, 4.5]]);
  if (p.heroOcc >= lo && p.heroOcc <= hi) fu = 7 + 1.2 * Math.min(1, (p.heroOcc - lo) / Math.max(1e-3, (hi - lo) * 0.6));
  const content = opts.logo ? 7.5 : curve(p.contentOcc, [[0, 0.5], [0.08, 2], [0.15, 4], [0.25, 6.5], [0.35, 8], [0.62, 8.2], [0.8, 7], [0.95, 6]]);
  const frame = 0.65 * fu + 0.35 * content;
  let hier = curve(p.dominance, [[0.9, 3], [1, 4.8], [1.12, 5.8], [1.3, 7], [1.6, 8.2], [2.4, 8.9]]);
  if (opts.group) hier = Math.min(hier, 4.8);
  const ns = opts.logo ? 7.5 : curve(1 - p.contentOcc, [[0.1, 4.5], [0.25, 6.5], [0.38, 8.2], [0.62, 8.2], [0.75, 6.5], [0.85, 4.5], [0.93, 2.5]]);
  const clean = 8.5 - (p.overlap > 0.3 ? 3 : p.overlap > 0.12 ? 1.2 : 0);
  const items = p.minItem >= 1 ? 7 : curve(p.minItem, [[0.01, 3], [0.04, 5], [0.07, 6.5], [0.09, 7.2], [0.14, 7.8]]);
  const sc = { frame, hier, ns, clean, items };
  const ov = 0.24 * frame + 0.28 * hier + 0.2 * ns + 0.1 * clean + 0.18 * items;
  return r3(Math.min(ov, Math.min(...Object.values(sc)) + 3));
}

/** Which strategies fit this content (by what is in the shot, never by its name). */
export function applicableStrategies(els: ComposeElement[], purpose: string, isLast: boolean): Strategy[] {
  const kinds = els.map((e) => e.kind);
  const hero = els.find((e) => e.role === 'hero');
  const things = els.filter((e) => e.kind !== 'text' && e.kind !== 'cursor' && e.kind !== 'line');
  const byKind = new Map<string, number>();
  for (const e of things) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const repeated = [...byKind.values()].some((n) => n >= 2);
  const out: Strategy[] = ['hero-focus', 'asymmetric-split', 'center-stage', 'spatial-cluster', 'stack'];
  if (repeated) out.push('card-cascade', 'focus-sequence', 'timeline-flow');
  if (kinds.includes('line')) out.push('timeline-flow');
  if (hero?.kind === 'text' && els.length <= 3) out.push('full-frame-typography');
  if (hero && (hero.kind === 'ui' || hero.kind === 'image')) out.push('ui-zoom');
  if (els.filter((e) => e.role !== 'background').length === 2) out.push('split');
  if (things.length >= 4) out.push('radial');
  if (purpose === 'cta' || isLast) out.push('cta-lockup');
  return [...new Set(out)];
}

const CLOSER: Record<string, ShotSize> = { wide: 'medium', medium: 'close', close: 'extreme-close', insert: 'close', hero: 'close', detail: 'extreme-close', 'extreme-close': 'extreme-close' };

/**
 * Re-composition candidates for one shot: every fitting strategy (× the current and one closer shot
 * size, × a different subject when the current one is only a connector), predicted and ranked.
 */
export function recompositionCandidates(plan: StagePlan, script: ScriptObj, critic: CriticReport, shotId: string): Candidate[] {
  const s = script.shots.find((x) => x.id === shotId)!;
  const idx = script.shots.indexOf(s);
  const dg = diagnoseShot(critic, script, shotId);
  const base = composeInputOf(plan, script, shotId);
  const now = composeShot(base);
  const isLast = idx === script.shots.length - 1;
  const group = dg.causes.includes('row-of-equals');
  const tgt = (inp: ReturnType<typeof composeInputOf>, subj?: string) => {
    const h = inp.elements.find((e) => e.id === (subj ?? inp.elements.find((x) => x.role === 'hero')?.id)) ?? inp.elements[0];
    return h ? OCCUPANCY[subjectTypeOf(h.kind, h.assetKind)][inp.shotSize] : ([0.1, 0.2] as [number, number]);
  };
  const isLogo = (inp: ReturnType<typeof composeInputOf>) => inp.elements.find((e) => e.role === 'hero')?.assetKind === 'logo';
  const pNow = predictLayout(now.boxes, base.elements, base.W, base.H);
  pNow.score = scorePrediction(pNow, tgt(base), { logo: isLogo(base), group });
  // the measured shot score anchors the prediction (geometry misses contrast, motion, the camera)
  const measured = critic.shots.find((x) => x.shot === shotId)?.overall ?? pNow.score;
  const out: Candidate[] = [];
  const heroNow = base.elements.find((e) => e.role === 'hero');
  // subject alternatives: when the subject is a connector (a path, a shape), the things it connects can lead
  const subjects: (string | undefined)[] = [undefined];
  if (heroNow && (heroNow.kind === 'line' || heroNow.kind === 'shape') && (group || dg.causes.includes('weak-subject'))) {
    const firstThing = base.elements.find((e) => e.kind !== 'line' && e.kind !== 'text' && e.kind !== 'cursor' && e.role !== 'background');
    if (firstThing) subjects.push(firstThing.id);
  }
  const sizes = [base.shotSize, CLOSER[base.shotSize]].filter((v, i, a) => a.indexOf(v) === i);
  for (const subj of subjects)
    for (const size of sizes)
      for (const st of applicableStrategies(base.elements, String(s.purpose ?? ''), isLast)) {
        if (st === resolveStrategy(String(s.composition ?? 'centered')) && size === base.shotSize && !subj) continue;
        const inp = composeInputOf(plan, script, shotId, { strategy: st, shotSize: size, subject: subj, unpin: true });
        const c = composeShot(inp);
        const p = predictLayout(c.boxes, inp.elements, inp.W, inp.H);
        const stillGroup = group && !['hero-focus', 'card-cascade', 'focus-sequence', 'asymmetric-split', 'center-stage', 'ui-zoom', 'spatial-cluster', 'radial'].includes(st);
        p.score = scorePrediction(p, tgt(inp, subj), { logo: isLogo(inp), group: stillGroup && st !== 'timeline-flow' ? true : false });
        const gain = r3(p.score - pNow.score);
        const cost: RepairCost = subj ? 'high' : size !== base.shotSize ? 'medium' : 'medium';
        const directive: ShotRedirection = {
          shot: shotId,
          issues: dg.codes,
          diagnosis: dg.findings[0] ?? dg.codes.join(', '),
          strategy: st,
          ...(size !== base.shotSize ? { shotSize: size } : {}),
          ...(subj ? { subject: subj } : {}),
          unpin: ['*'],
          addMotion: st === 'focus-sequence' ? focusPasses(inp.elements, s) : undefined,
          expected: `${st}${size !== base.shotSize ? ` at ${size}` : ''}${subj ? ` led by ${subj}` : ''}: subject ${Math.round(pNow.heroOcc * 100)}% → ${Math.round(p.heroOcc * 100)}%, dominance ×${pNow.dominance} → ×${p.dominance}, content ${Math.round(pNow.contentOcc * 100)}% → ${Math.round(p.contentOcc * 100)}%, smallest item ${Math.round(pNow.minItem * 100)}% → ${Math.round(p.minItem * 100)}% (predicted shot ${measured} → ~${r3(measured + gain)})`,
          cost,
          risk: p.overlap > 0.12 ? `elements overlap ${Math.round(p.overlap * 100)}% in this layout` : subj ? 'the shot is led by a different element (its message stays)' : 'positions change: element moves between shots get longer',
          intentChanges: subj ? [{ what: 'subject', why: `the subject ${heroNow?.id} only connects the items; ${subj} carries the message` }] : [],
        };
        if (!directive.addMotion) delete directive.addMotion;
        out.push({ id: `${shotId}:${st}${size !== base.shotSize ? `@${size}` : ''}${subj ? `>${subj}` : ''}`, shot: shotId, kind: 'recompose', directive, predicted: p, gain, cost, confidence: 0.7, risk: directive.risk!, label: `re-compose ${shotId} as ${st}${size !== base.shotSize ? ` (${size})` : ''}${subj ? ` led by ${subj}` : ''}` });
      }
  return out.sort((a, b) => b.gain - COST_WEIGHT[b.cost] - (a.gain - COST_WEIGHT[a.cost]));
}

/** Focus passes for focus-sequence: the supporting items take the eye one after another, in reading order. */
function focusPasses(els: ComposeElement[], s: ShotObj): ShotRedirection['addMotion'] {
  const dur = s.timing?.duration ?? 3;
  const items = els.filter((e) => e.role !== 'hero' && e.kind !== 'cursor' && e.kind !== 'text' && e.role !== 'background');
  const used = new Set((s.motionChain ?? []).map((e) => `${e.element}:${e.action}`));
  return items
    .filter((e) => !used.has(`${e.id}:emphasis`))
    .slice(0, 3)
    .map((e, i) => ({ element: e.id, action: 'emphasis' as const, at: Math.round((0.9 + i * Math.min(0.55, (dur - 1.6) / Math.max(1, items.length))) * 100) / 100, reason: 'the focus passes on: each supporting item takes the eye in turn' }));
}
