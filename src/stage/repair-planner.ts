/**
 * Intelligent Repair Planner (P2-D, replaces the P1 fixed repair rules).
 *
 *   issue → diagnosis → candidate repairs → expected effect → cost / risk → select
 *         → (the loop) render → measure → compare → remember
 *
 * Every issue gets several ways out, from the least destructive (re-time, move, depth) through a
 * re-composition of the shot (the Re-Director) to the destructive ones (disable the camera, change a
 * transition) — which come LAST and only when everything cheaper failed. Candidates are ranked by
 * expected quality gain minus their cost; a repair that already failed (repair memory) is never
 * tried again. The output is a redirection.json — the same document Claude writes.
 * Pure (no node APIs).
 */
import type { StagePlan } from './plan';
import type { CriticReport, CriticIssue } from '../qc/critic';
import type { Redirection, ShotRedirection, RepairCost } from './redirection';
import { recompositionCandidates, diagnoseShot, COST_WEIGHT, type Candidate } from './redirector';

export interface RepairAttempt {
  pass: number;
  shot: string;
  candidate: string;
  label: string;
  issues: string[];
  cost: RepairCost;
  before: { overall: number; shot?: number };
  after?: { overall: number; shot?: number };
  sideEffects?: string[];
  result?: 'improved' | 'no-change' | 'regressed' | 'failed';
}

export interface RepairMemory {
  version: 1;
  attempts: RepairAttempt[];
}

export interface RepairPlan {
  redirection: Redirection;
  selected: Candidate[];
  /** Every candidate considered, best first per issue (for the report). */
  considered: { issue: string; shot?: string; candidates: { id: string; label: string; value: number; cost: RepairCost; tried?: string }[] }[];
  untreated: string[];
}

const SEV_GAIN = { critical: 2.5, major: 1.2, minor: 0.4 } as const;
const WIDER: Record<string, string> = { 'extreme-close': 'close', detail: 'close', close: 'medium', insert: 'medium', hero: 'medium', medium: 'wide', wide: 'wide' };
const CLOSER: Record<string, string> = { wide: 'medium', medium: 'close', close: 'extreme-close', insert: 'close', hero: 'close', detail: 'extreme-close', 'extreme-close': 'extreme-close' };

type CastObj = { id: string; role?: string; at?: { x: number; y: number }; w?: number; sustain?: string };
type ShotObj = { id: string; purpose?: string; subject?: string; shotSize?: string; composition?: string; cast?: CastObj[]; camera?: unknown; cameraTarget?: string; cameraReason?: string; framing?: { start?: string; end?: string }; transitionOut?: unknown; timing?: { duration?: number }; motionChain?: { id?: string; element: string; action: string; at?: unknown; after?: string }[]; [k: string]: unknown };
type ScriptObj = { shots: ShotObj[]; stage?: { elements: { id: string; kind: string; asset?: string; layer?: string }[] } };

const local = (shot: string, id: string, label: string, d: Omit<ShotRedirection, 'shot' | 'issues' | 'diagnosis' | 'cost' | 'intentChanges'> & { intentChanges?: ShotRedirection['intentChanges'] }, issue: CriticIssue, cost: RepairCost, confidence: number, risk: string, kind: Candidate['kind'] = 'local'): Candidate => ({
  id: `${shot}:${id}`,
  shot,
  kind,
  directive: { shot, issues: [issue.code], diagnosis: issue.evidence, cost, intentChanges: d.intentChanges ?? [], ...d },
  gain: SEV_GAIN[issue.severity] * confidence,
  cost,
  confidence,
  risk,
  label,
});

/** Candidate repairs for one issue (local ones; re-composition comes from the Re-Director). */
export function issueCandidates(plan: StagePlan, script: ScriptObj, issue: CriticIssue): Candidate[] {
  const sid = issue.shot;
  const s = script.shots.find((x) => x.id === sid);
  if (!s) return [];
  const idx = script.shots.indexOf(s);
  const ps = plan.shots.find((x) => x.id === sid);
  const moving = Boolean(s.camera && s.camera !== 'static');
  const camObj = typeof s.camera === 'object' && s.camera ? (s.camera as { move?: string; amplitude?: number }) : null;
  const endSize = s.framing?.end ?? String(s.shotSize ?? 'medium');
  const out: Candidate[] = [];
  const el = issue.elements?.[0];
  switch (issue.code) {
    case 'TEXT_OFF_FRAME': {
      const c = (s.cast ?? []).find((x) => x.id === el);
      // 1. the line re-flows narrower inside its own box (its hierarchy stays)
      if (c?.w) out.push(local(sid!, `reflow:${el}`, `${el}: narrower measure (×0.82)`, { resize: { [el!]: 0.82 } }, issue, 'low', 0.35, 'more lines'));
      // 1b. the line arrives during the hand-off while the frame is still magnified: it enters once the transition is over
      const trIn = plan.transitions.find((t) => t.to === sid);
      const elPlan = el ? plan.elements.find((e) => e.id === el) : undefined;
      const cutSec = Number(/ for ([\d.]+)s/.exec(issue.evidence)?.[1] ?? 99);
      if (trIn && ps && elPlan && !/after the shot settled/.test(issue.evidence) && cutSec <= trIn.t1 - trIn.t0 + 0.25 && elPlan.life.from < trIn.t1 - 0.05 && c && el !== trIn.element && el !== trIn.into) {
        const at = Math.round(Math.max(0, trIn.t1 - ps.start + 0.05) * 100) / 100;
        out.push(local(sid!, `retime:${el}`, `${el} enters after the ${trIn.kind} hand-off (at ${at}s)`, { retime: [{ element: el!, action: 'enter', at, reason: 'the line arrives on a settled frame, never cut by a frame still moving' }] }, issue, 'low', 0.7, 'the line arrives a little later'));
      }
      // 2. the shot is re-composed so the text sits with the camera target (the move keeps both in frame)
      if (moving && s.cameraTarget && el && s.cameraTarget !== el) {
        out.push(local(sid!, `recompose:stack`, `re-compose ${sid} as a stack: ${el} with ${s.cameraTarget}, centred under the move`, { strategy: 'stack', unpin: ['*'] }, issue, 'medium', 0.6, 'positions change', 'recompose'));
        out.push(local(sid!, `recompose:center-stage`, `re-compose ${sid} centre-stage: the target centred, ${el} close under it`, { strategy: 'center-stage', unpin: ['*'] }, issue, 'medium', 0.55, 'positions change', 'recompose'));
      }
      // 2b. a travelling move (follow / pan) that leaves an item cut once it stops: the travel is the cause, so
      // a push toward the middle of the group keeps a camera reason without leaving anything behind
      const travel = moving && ['follow', 'pan'].includes(String(camObj?.move ?? s.camera));
      const settledCut = /after the shot settled/.test(issue.evidence);
      if (travel && settledCut) {
        const items = (s.cast ?? []).filter((x) => x.role !== 'background' && x.id !== s.cameraTarget);
        const mid = items[Math.floor(items.length / 2)]?.id ?? s.cameraTarget;
        out.push(local(sid!, 'camera:push-centre', `camera ${camObj?.move ?? 'travel'} → a gentle push toward ${mid}`, { camera: { move: 'push-in', target: mid, amplitude: 0.5 }, intentChanges: [{ what: 'camera travel', why: `the ${camObj?.move ?? 'travel'} left ${el} cut at rest; a push keeps the focus without leaving an item behind` }] }, issue, 'medium', 0.8, 'loses the travel along the path', 'camera'));
      }
      // 3. the move is reframed: a wider end framing / a smaller amplitude (a lateral travel is barely helped by either)
      if (moving && endSize !== 'wide') out.push(local(sid!, `reframe:${WIDER[endSize]}`, `camera end framing ${endSize} → ${WIDER[endSize]}`, { camera: { move: camObj?.move ?? 'push-in', framingEnd: WIDER[endSize] as never } }, issue, 'low', travel && settledCut ? 0.2 : 0.45, 'the move shows less'));
      // (only ever smaller: a move already at a small amplitude is not "reduced" by raising it)
      const amp = camObj?.amplitude ?? 1;
      if (moving && amp > 0.6) out.push(local(sid!, 'amplitude:0.55', `camera amplitude ${amp} → ${Math.round(amp * 0.55 * 100) / 100}`, { camera: { move: camObj?.move ?? 'push-in', amplitude: Math.round(amp * 0.55 * 100) / 100 } }, issue, 'low', travel && settledCut ? 0.2 : 0.4, 'the move shows less'));
      // 4. last resort: no camera (the camera reason is lost — declared)
      if (moving) out.push(local(sid!, 'camera:static', 'camera → static (last resort)', { camera: 'static', intentChanges: [{ what: 'camera reason', why: 'every cheaper repair failed to keep the text in frame' }] }, issue, 'very-high', 0.95, 'loses the camera intent', 'camera'));
      break;
    }
    case 'TEXT_COLLISION':
    case 'SUBJECT_OBSTRUCTION': {
      const [a, b] = issue.elements ?? [];
      const tr = plan.transitions.find((t) => t.to === sid && (t.element === b || t.element === a));
      const inT = /decorative-collision/.test(issue.evidence) && tr;
      if (inT && ps) {
        // the text arrives once the shape has finished passing behind it
        const at = Math.round(Math.max(0, tr!.t1 - ps.start + 0.08) * 100) / 100;
        out.push(local(sid!, `retime:${a}`, `${a} enters after ${tr!.kind} has covered (at ${at}s)`, { retime: [{ element: a, action: 'enter', at, reason: 'the line appears on the finished background, never across its edge' }] }, issue, 'low', 0.75, 'the line arrives a little later'));
      }
      if (b && /obstruction|critical/.test(issue.evidence)) out.push(local(sid!, `depth:${a}`, `${a} in front of ${b}`, { depth: { [a]: 'front' } }, issue, 'low', 0.6, 'layer change holds for the whole film'));
      if (b) out.push(local(sid!, `recompose:hero-focus`, `re-compose ${sid} (hero-focus) to separate ${a} and ${b}`, { strategy: 'hero-focus', unpin: ['*'] }, issue, 'medium', 0.5, 'positions change', 'recompose'));
      break;
    }
    case 'EMPTY_TRANSITION_FRAME':
    case 'VISUAL_VOID': {
      const tr = plan.transitions.find((t) => t.from === sid);
      if (!tr) break;
      const nxt = script.shots[idx + 1];
      const nps = plan.shots.find((x) => x.id === nxt?.id);
      if (tr.kind === 'text-mask' || tr.kind === 'depth-pass') out.push(local(sid!, `hold:${tr.kind}`, `${tr.element} keeps its ink 0.35s into the ${tr.kind}`, { transition: { hold: 0.35 } }, issue, 'low', 0.7, 'the carrying element stays a moment longer'));
      if (nxt && nps) {
        const hero = (nxt.cast ?? []).find((c) => c.role === 'hero')?.id ?? nxt.subject;
        if (hero && hero !== tr.element && hero !== tr.into) out.push({ ...local(nxt.id, `overlap:${hero}`, `${hero} arrives at the cut (overlaps the outgoing shot)`, { retime: [{ element: hero, action: 'enter', at: 0, reason: 'the next subject is already arriving when the cut lands: the frame never empties' }] }, issue, 'low', 0.55, 'a busier cut'), id: `${nxt.id}:overlap:${hero}` });
      }
      if (typeof s.transitionOut === 'object' && s.transitionOut && tr.t1 - tr.t0 > 0.6) out.push(local(sid!, 'shorten', `${tr.kind} shortened`, { transition: { duration: Math.round((tr.t1 - tr.t0) * 0.6 * 100) / 100 } }, issue, 'low', 0.35, 'a faster cut'));
      break;
    }
    case 'CAMERA_NO_VISIBLE_EFFECT': {
      if (moving && endSize !== 'extreme-close') out.push(local(sid!, `reframe:${CLOSER[endSize]}`, `camera end framing ${endSize} → ${CLOSER[endSize]}`, { camera: { move: camObj?.move ?? 'push-in', framingEnd: CLOSER[endSize] as never, amplitude: 1 } }, issue, 'low', 0.6, 'a stronger move'));
      const tgtEl = plan.elements.find((e) => e.id === s.cameraTarget || (s.cameraTarget && e.anchors?.[s.cameraTarget]))?.id;
      if (moving && tgtEl) out.push(local(sid!, 'element-motion', `camera → static; ${tgtEl} grows itself`, { camera: 'static', addMotion: [{ element: tgtEl, action: 'transform', amount: 1.12, at: 0.8, reason: 'the element carries the focus the camera did not show' }], intentChanges: [{ what: 'camera reason', why: 'the move did not show on its target; the element motion does the same job' }] }, issue, 'high', 0.7, 'loses the camera move', 'camera'));
      break;
    }
    case 'ITEMS_OVERLAP': {
      // a displacement written for the old layout (a push along a row) now drives one item into another.
      // First choice: keep the causal relay but in place — each push becomes a kick on the item it pushed,
      // with the same event id, so everything chained after it still fires (energy kept, nothing collides).
      // Second choice: drop the displacement (and what was chained after it), the pusher breathes instead.
      const els = new Set(issue.elements ?? []);
      const chain = ((s as { motionChain?: { id?: string; element: string; action: string; to?: string; at?: unknown; after?: string; reason?: string }[] }).motionChain ?? []);
      const pushes = chain.filter((e) => e.id && ['push', 'attract', 'move'].includes(e.action) && (els.has(e.element) || (e.to && els.has(e.to))));
      const relay = pushes.filter((e) => e.to && plan.elements.some((x) => x.id === e.to));
      if (relay.length) {
        const addMotion = relay.map((e) => ({ id: e.id!, element: e.to!, action: 'impact' as const, ...(e.at !== undefined ? { at: e.at as number } : {}), ...(e.after ? { after: e.after } : {}), reason: `${e.reason ?? 'the relay along the row'} — in place: the layout no longer leaves room to travel` }));
        out.push(local(sid!, `relay:${relay.map((e) => e.id).join('+')}`, `${relay.map((e) => e.id).join(', ')}: the push along the row becomes an in-place relay (each item kicks in turn)`, { dropMotion: relay.map((e) => e.id!), addMotion: addMotion as never }, issue, 'low', 0.8, 'the travel goes; the causal chain and its energy stay'));
      }
      const drop = new Set(pushes.map((e) => e.id!));
      for (let grew = true; grew; ) {
        grew = false;
        for (const e of chain) if (e.id && !drop.has(e.id) && e.after && drop.has(e.after.split('.')[0])) (drop.add(e.id), (grew = true));
      }
      // the energy the push carried is kept as a living hold on the item that pushed (no dead frame left behind)
      const pusher = chain.find((e) => e.id && drop.has(e.id))?.element;
      const keep = pusher && !(s.cast ?? []).find((c) => c.id === pusher)?.sustain ? { sustain: { [pusher]: 'breathe' as const } } : {};
      if (drop.size) out.push(local(sid!, `drop:${[...drop].join('+')}`, `drop ${[...drop].join(', ')} (a displacement that now drives one item into another)${pusher ? `; ${pusher} breathes instead` : ''}`, { dropMotion: [...drop], ...keep }, issue, 'low', 0.6, 'less motion in the shot'));
      break;
    }
    case 'DEAD_HOLD': {
      const hero = (s.cast ?? []).find((c) => c.role === 'hero');
      if (hero && !hero.sustain && !/shorten/.test(issue.fix ?? '')) out.push(local(sid!, `sustain:${hero.id}`, `${hero.id} breathes through the hold`, { sustain: { [hero.id]: 'breathe' } }, issue, 'low', 0.6, 'subtle'));
      break;
    }
    case 'CTA_WEAKNESS': {
      const m = /shorten the closing shot by ([\d.]+)s/.exec(issue.fix ?? '');
      if (m && s.timing?.duration) out.push(local(sid!, 'shorten-end', `closing shot −${m[1]}s`, { timing: { duration: Math.round(Math.max(1.2, s.timing.duration - Number(m[1])) * 100) / 100 } }, issue, 'medium', 0.85, 'timing change (full re-render)', 'timing'));
      break;
    }
    default:
      break;
  }
  return out;
}

/** Codes a re-composition answers. */
const COMPOSITION_CODES = new Set(['ROW_OF_SMALL_OBJECTS', 'ELEMENT_OFF_FRAME', 'ITEMS_OVERLAP', 'NO_DOMINANT_SUBJECT', 'TINY_SUBJECT', 'EXCESS_NEGATIVE_SPACE', 'EMPTY_COMPOSITION', 'WEAK_CTA_COMPOSITION', 'UNBALANCED', 'UNREADABLE_TEXT', 'WEAK_HIERARCHY']);

/**
 * Plans one repair pass: at most one change per shot (the best value: expected gain − cost), never a
 * candidate the memory says failed, re-composition only when it is predicted to beat the measured shot.
 */
export function planRepairs(input: { plan: StagePlan; script: ScriptObj; critic: CriticReport; memory?: RepairMemory | null; pass?: number; redirector?: boolean; maxShots?: number }): RepairPlan {
  const { plan, script, critic } = input;
  const tried = new Map<string, string>();
  for (const a of input.memory?.attempts ?? []) if (a.result && a.result !== 'improved') tried.set(a.candidate, a.result);
  const used = new Set((input.memory?.attempts ?? []).filter((a) => a.result === 'improved').map((a) => a.candidate));
  const considered: RepairPlan['considered'] = [];
  const best = new Map<string, { c: Candidate; value: number }>();
  const offer = (c: Candidate, value: number) => {
    if (tried.has(c.id) || used.has(c.id)) return;
    const cur = best.get(c.shot);
    if (!cur || value > cur.value) best.set(c.shot, { c, value });
  };
  // 1. local candidates per issue (worst first)
  const order = { critical: 0, major: 1, minor: 2 } as const;
  const issues = [...critic.issues].filter((i) => i.shot).sort((a, b) => order[a.severity] - order[b.severity]);
  for (const i of issues) {
    const cs = issueCandidates(plan, script, i);
    if (input.redirector === false) for (let k = cs.length - 1; k >= 0; k--) if (cs[k].kind === 'recompose') cs.splice(k, 1);
    if (!cs.length) continue;
    const ranked = cs.map((c) => ({ c, value: Math.round((c.gain - COST_WEIGHT[c.cost]) * 1000) / 1000 })).sort((a, b) => b.value - a.value);
    considered.push({ issue: i.code, shot: i.shot, candidates: ranked.map((r) => ({ id: r.c.id, label: r.c.label, value: r.value, cost: r.c.cost, tried: tried.get(r.c.id) ?? (used.has(r.c.id) ? 'applied' : undefined) })) });
    // a candidate that frames tighter can never be chosen while the same shot already loses text at the edge
    const cropping = critic.issues.some((x) => x.shot === i.shot && (x.code === 'TEXT_OFF_FRAME' || x.code === 'ELEMENT_OFF_FRAME'));
    const tighter = (c: Candidate) => c.id.includes(':reframe:') && typeof c.directive.camera === 'object' && ['close', 'extreme-close', 'detail', 'insert'].includes(String(c.directive.camera.framingEnd)) && c.directive.issues.includes('CAMERA_NO_VISIBLE_EFFECT');
    const first = ranked.find((r) => !tried.has(r.c.id) && !used.has(r.c.id) && !(cropping && tighter(r.c)));
    // a technical failure (text lost at the edge, collisions) outranks a visual wish in the same shot;
    // issues of other severities never outrank a critical one
    if (first) offer(first.c, first.value + (i.severity === 'critical' ? 2 : 0) + (i.layer === 'technical' ? 1.5 : 0));
  }
  // 2. re-composition (the Re-Director) for shots whose problem is the composition itself
  if (input.redirector !== false) {
    const shots = [...new Set(critic.issues.filter((i) => i.shot && COMPOSITION_CODES.has(i.code) && i.severity !== 'minor').map((i) => i.shot!))];
    for (const sid of shots) {
      const cs = recompositionCandidates(plan, script, critic, sid).filter((c) => c.gain > 0.4);
      if (!cs.length) continue;
      const ranked = cs.map((c) => ({ c, value: Math.round((c.gain - COST_WEIGHT[c.cost]) * 1000) / 1000 }));
      considered.push({ issue: diagnoseShot(critic, script, sid).codes.join('+'), shot: sid, candidates: ranked.slice(0, 6).map((r) => ({ id: r.c.id, label: r.c.label, value: r.value, cost: r.c.cost, tried: tried.get(r.c.id) })) });
      const first = ranked.find((r) => !tried.has(r.c.id) && !used.has(r.c.id) && !(input.memory?.attempts ?? []).some((a) => a.shot === sid && a.label.startsWith('re-compose') && a.result === 'improved'));
      if (first) offer(first.c, first.value);
    }
  }
  const selected = [...best.values()].sort((a, b) => b.value - a.value).slice(0, input.maxShots ?? 4).map((b) => b.c);
  const treated = new Set(selected.flatMap((c) => c.directive.issues.map((code) => `${c.shot}:${code}`)));
  const untreated = critic.issues.filter((i) => i.severity !== 'minor' && !treated.has(`${i.shot}:${i.code}`)).map((i) => `${i.code}${i.shot ? ` (${i.shot})` : ''}`);
  return { redirection: { version: 1, source: 'deterministic', pass: input.pass, shots: selected.map((c) => c.directive) }, selected, considered, untreated };
}

/** Compares two critic reports after a repair: what got better, what broke (side effects). */
export function sideEffects(before: CriticReport, after: CriticReport, shots: string[]): { gained: number; sideEffects: string[]; resolved: string[]; introduced: string[] } {
  const key = (i: CriticIssue) => `${i.code}@${i.shot ?? '*'}`;
  const b = new Set(before.issues.filter((i) => i.severity !== 'minor').map(key));
  const a = new Set(after.issues.filter((i) => i.severity !== 'minor').map(key));
  const resolved = [...b].filter((k) => !a.has(k));
  const introduced = [...a].filter((k) => !b.has(k));
  const se: string[] = [];
  // the dimensions a repair can break: composition, collisions, camera, typography, transitions, continuity, CTA, audio sync
  for (const d of ['composition', 'typography', 'camera', 'transitions', 'continuity', 'cta', 'audioSync', 'hierarchy'] as const) {
    const x = before.visual.scores[d];
    const y = after.visual.scores[d];
    if (x.basis !== 'n/a' && y.score < x.score - 0.3) se.push(`${d} ${x.score} → ${y.score}`);
  }
  for (const s of shots) {
    const x = before.shots.find((v) => v.shot === s)?.overall;
    const y = after.shots.find((v) => v.shot === s)?.overall;
    if (x !== undefined && y !== undefined && y < x - 0.2) se.push(`shot ${s} ${x} → ${y}`);
  }
  for (const k of introduced) se.push(`new: ${k}`);
  if (before.technical.pass && !after.technical.pass) se.push('technical checks now fail');
  return { gained: Math.round((after.overall - before.overall) * 100) / 100, sideEffects: se, resolved, introduced };
}

export interface RepairPatch {
  shot: string;
  code: string;
  change: string;
  /** The edit changes shot durations (timing): frames after it shift, so they re-render too. */
  timing: boolean;
}

/** Frame ranges to re-render after patches: each patched shot ±0.6 s (transitions span the cut); a timing change re-renders to the end. */
export function repairRanges(shots: { id: string; start: number; end: number }[], patches: RepairPatch[], fps: number, totalFrames: number): [number, number][] {
  const ranges: [number, number][] = [];
  for (const p of patches) {
    const s = shots.find((x) => x.id === p.shot);
    if (!s) continue;
    const a = Math.max(0, Math.floor((s.start - 0.6) * fps));
    const b = p.timing ? totalFrames - 1 : Math.min(totalFrames - 1, Math.ceil((s.end + 0.6) * fps));
    ranges.push([a, b]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const l = merged[merged.length - 1];
    if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  return merged;
}
