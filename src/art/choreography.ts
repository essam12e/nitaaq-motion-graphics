/**
 * P4-B — Choreography Director and choreography_graph.
 *
 * The graph says WHY each thing moves: an edge is "A causes B" with a type (trigger, follow, pull, push,
 * orbit, attach, detach, replace, reveal, mask, carry, transform, respond, counter, echo, settle-with,
 * handoff-to). It is read from the script (motion events, `after` chains), the compiled plan (hand-offs) and
 * the object transitions. A shot whose elements all arrive on a clock, none caused by another, is
 * FLAT_CHOREOGRAPHY; an event with no cause in a shot that has causes is MOTION_WITHOUT_CAUSE.
 *
 * The director rewrites a shot's motion chain into cause → effect chains (candidates — the preview renders
 * judge them): cascade (a domino of siblings), land-and-react (the hero lands, the others answer),
 * gather (a hub pulls the scattered items in), relay (the focus passes along the items), and a camera-free
 * equivalent for a shot the camera carried (the element does what the camera did). Pure.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';

export const EDGE_TYPES = ['trigger', 'follow', 'pull', 'push', 'orbit', 'attach', 'detach', 'replace', 'reveal', 'mask', 'carry', 'transform', 'respond', 'counter', 'echo', 'settle-with', 'handoff-to'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface ChoreoEdge {
  shot: string;
  from: string;
  to: string;
  type: EdgeType;
  at: 'start' | 'peak' | 'contact' | 'end' | 'settle' | 'cut';
  source: 'script' | 'compiler' | 'transition';
  reason?: string;
}

export interface ShotChoreography {
  shot: string;
  events: number;
  caused: number;
  causalShare: number;
  depth: number;
  /** Elements whose only motion is a clock-placed entrance. */
  clocked: string[];
  issues: string[];
}

export interface ChoreographyGraph {
  version: 1;
  edges: ChoreoEdge[];
  shots: ShotChoreography[];
  film: { edges: number; causalShare: number; byType: Record<string, number>; crossShot: number };
}

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason: string; [k: string]: unknown };
type ShotObj = ScriptObj['shots'][number] & { motionChain: Ev[] };

const EFFECT: Record<string, EdgeType> = { enter: 'trigger', attract: 'pull', push: 'push', become: 'transform', morph: 'transform', transform: 'transform', settle: 'settle-with', focus: 'handoff-to', move: 'carry', emphasis: 'trigger', press: 'trigger', impact: 'trigger', reveal: 'reveal', draw: 'trigger', count: 'trigger', exit: 'handoff-to' };
const TRANSITION_EDGE: Record<string, EdgeType> = { shared: 'carry', morph: 'transform', 'shape-transform': 'transform', 'expand-to-background': 'replace', 'text-mask': 'mask', 'depth-pass': 'handoff-to', 'follow-path': 'follow', 'push-inside': 'carry' };

const respondType = (style?: string): EdgeType => (style === 'counter' ? 'counter' : style === 'echo' ? 'echo' : 'respond');

/** The film's choreography graph (B). */
export function choreographyGraph(script: ScriptObj, plan: StagePlan): ChoreographyGraph {
  const edges: ChoreoEdge[] = [];
  const shots = script.shots as ShotObj[];
  const shotsOut: ShotChoreography[] = [];
  shots.forEach((s, i) => {
    const chain = s.motionChain ?? [];
    const byId = new Map<string, Ev>();
    for (let k = i; k >= 0; k--) for (const e of (shots[k].motionChain ?? []) as Ev[]) if (e.id && !byId.has(e.id)) byId.set(e.id, e);
    let caused = 0;
    const depthOf = (e: Ev, seen = new Set<string>()): number => {
      if (!e.after) return 0;
      const name = e.after.split('.')[0];
      const p = byId.get(name);
      if (!p || seen.has(name)) return 1;
      seen.add(name);
      return 1 + depthOf(p, seen);
    };
    let depth = 0;
    for (const e of chain) {
      const causal = ['attract', 'push', 'become', 'respond'].includes(e.action);
      if (e.after) {
        const [name, point] = e.after.split('.');
        const cause = byId.get(name);
        if (cause) edges.push({ shot: s.id, from: cause.element, to: e.element, type: e.action === 'respond' ? respondType(e.style) : EFFECT[e.action] ?? 'trigger', at: (point as ChoreoEdge['at']) ?? 'end', source: 'script', reason: e.reason });
        depth = Math.max(depth, depthOf(e));
      }
      if (e.to && (e.action === 'attract' || e.action === 'push' || e.action === 'become')) edges.push({ shot: s.id, from: e.element, to: e.to, type: e.action === 'attract' ? 'pull' : e.action === 'push' ? 'push' : 'transform', at: e.action === 'push' ? 'peak' : 'end', source: 'script', reason: e.reason });
      if (e.action === 'respond' && e.to && !e.after) edges.push({ shot: s.id, from: e.to, to: e.element, type: respondType(e.style), at: 'contact', source: 'script', reason: e.reason });
      if (e.after || causal) caused++;
    }
    // entrances on the clock (no enter event with a cause, no carried entrance)
    const castIds = (s.cast ?? []).map((c) => c.id);
    const carriedIn = new Set(plan.handoffs.filter((h) => castIds.includes(h.to)).map((h) => h.to));
    const prevT = i > 0 ? plan.transitions.find((t) => t.to === s.id) : undefined;
    if (prevT?.into) carriedIn.add(prevT.into);
    if (prevT?.element && castIds.includes(prevT.element)) carriedIn.add(prevT.element);
    const moved = new Set(chain.filter((e) => e.action !== 'enter' || e.after).map((e) => e.element));
    const prevCast = i > 0 ? (shots[i - 1].cast ?? []).map((c) => c.id) : [];
    const entering = castIds.filter((id) => !prevCast.includes(id));
    const clocked = entering.filter((id) => !carriedIn.has(id) && !moved.has(id) && !chain.some((e) => e.action === 'enter' && e.element === id && e.after));
    const events = chain.filter((e) => e.action !== 'sustain').length + entering.length;
    const causedAll = caused + entering.filter((id) => carriedIn.has(id)).length;
    const share = events ? causedAll / events : 0;
    const issues: string[] = [];
    if (entering.length + chain.length >= 3 && share < 0.34 && depth < 2) issues.push('FLAT_CHOREOGRAPHY');
    if (caused > 0 && chain.some((e) => !e.after && !['attract', 'push', 'become', 'respond', 'enter', 'exit', 'sustain'].includes(e.action) && typeof e.at !== 'string')) issues.push('MOTION_WITHOUT_CAUSE');
    shotsOut.push({ shot: s.id, events, caused: causedAll, causalShare: Math.round(share * 1000) / 1000, depth, clocked, issues });
  });
  for (const h of plan.handoffs) {
    const sh = plan.shots.find((x) => x.cast.some((c) => c.id === h.to))?.id ?? '';
    edges.push({ shot: sh, from: h.from, to: h.to, type: h.kind === 'exit-enter' ? 'handoff-to' : h.kind === 'attract' ? 'pull' : h.kind === 'push' ? 'push' : h.kind === 'impact' ? 'transform' : 'trigger', at: 'peak', source: 'compiler', reason: h.reason });
  }
  for (const t of plan.transitions) if (t.element && TRANSITION_EDGE[t.kind]) edges.push({ shot: t.to, from: t.element, to: t.into ?? t.element, type: TRANSITION_EDGE[t.kind], at: 'cut', source: 'transition', reason: t.reason });
  // dedupe (script + compiler report the same pull)
  const seen = new Set<string>();
  const uniq = edges.filter((e) => {
    const k = `${e.shot}|${e.from}|${e.to}|${e.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const byType: Record<string, number> = {};
  for (const e of uniq) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const ev = shotsOut.reduce((a, s) => a + s.events, 0);
  const cs = shotsOut.reduce((a, s) => a + s.caused, 0);
  return { version: 1, edges: uniq, shots: shotsOut, film: { edges: uniq.length, causalShare: ev ? Math.round((cs / ev) * 1000) / 1000 : 0, byType, crossShot: uniq.filter((e) => e.source !== 'script').length } };
}

// ── the director: cause → effect rewrites of one shot (candidates)

export type ChoreoPattern = 'cascade' | 'land-and-react' | 'gather' | 'relay' | 'camera-free';
export interface ChoreoCandidate {
  pattern: ChoreoPattern;
  script: ScriptObj;
  why: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const kindOf = (script: ScriptObj, id: string) => script.stage?.elements.find((e) => e.id === id)?.kind ?? '';
const SMALL = ['card', 'chip', 'icon', 'shape', 'number', 'button'];

/** The shot's siblings: two or more small objects of one kind that enter together (a row, a cluster). */
export function siblingsOf(script: ScriptObj, i: number): string[] {
  const s = script.shots[i];
  const prev = i > 0 ? (script.shots[i - 1].cast ?? []).map((c) => c.id) : [];
  const ids = (s.cast ?? []).map((c) => c.id).filter((id) => SMALL.includes(kindOf(script, id)) && !prev.includes(id));
  const byKind = new Map<string, string[]>();
  for (const id of ids) byKind.set(kindOf(script, id), [...(byKind.get(kindOf(script, id)) ?? []), id]);
  return [...byKind.values()].sort((a, b) => b.length - a.length)[0]?.filter(() => true) ?? [];
}

const named = (chain: Ev[], base: string) => {
  let n = base;
  let k = 2;
  while (chain.some((e) => e.id === n)) n = `${base}-${k++}`;
  return n;
};

/** Cause → effect rewrites for shot i (2–4 patterns that fit its cast); empty when nothing fits. */
export function choreographyCandidates(script: ScriptObj, i: number, opts: { hero?: string } = {}): ChoreoCandidate[] {
  const out: ChoreoCandidate[] = [];
  const s = script.shots[i] as ShotObj;
  const cast = s.cast ?? [];
  const hero = opts.hero ?? cast.find((c) => c.role === 'hero')?.id ?? (s.subject as string);
  const sibs = siblingsOf(script, i).filter((id) => id !== hero || cast.length <= 2);
  const prevCast = i > 0 ? (script.shots[i - 1].cast ?? []).map((c) => c.id) : [];
  const busy = new Set(s.motionChain.filter((e) => e.action === 'enter' || e.action === 'attract' || e.action === 'become').map((e) => e.element));
  // cascade: the siblings enter as a domino — each starts when the previous one peaks; the last one nudges the hero
  if (sibs.length >= 2 && sibs.every((id) => !busy.has(id))) {
    const sc = clone(script);
    const ch = (sc.shots[i] as ShotObj).motionChain;
    let prev: string | null = null;
    sibs.forEach((id, k) => {
      const nm = named(ch, `in-${k + 1}`);
      ch.push({ id: nm, element: id, action: 'enter', ...(prev ? { after: `${prev}.peak` } : {}), reason: k === 0 ? 'the first item opens the row' : 'each item is set off by the one before it (a domino, not a clock)' });
      prev = nm;
    });
    if (hero && !sibs.includes(hero) && SMALL.concat('text').includes(kindOf(script, hero)) && prevCast.includes(hero) === false) ch.push({ element: hero, action: 'respond', style: 'echo', after: `${prev}.end`, amount: 0.03, reason: 'the row completes and the hero answers it' });
    out.push({ pattern: 'cascade', script: sc, why: `${sibs.length} items enter as a chain of causes instead of a clock` });
  }
  // land-and-react: the hero lands; the supports answer the landing (recoil away from it)
  const supports = cast.filter((c) => c.id !== hero && c.role !== 'background' && ['chip', 'card', 'icon', 'shape', 'image', 'logo'].includes(kindOf(script, c.id))).map((c) => c.id);
  if (hero && supports.length && !prevCast.includes(hero) && !busy.has(hero)) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const hc = (sh.cast ?? []).find((c) => c.id === hero) as { id: string; enter?: string } | undefined;
    if (hc && kindOf(script, hero) !== 'text') hc.enter = 'scale';
    const nm = named(sh.motionChain, 'land');
    sh.motionChain.push({ id: nm, element: hero, action: 'enter', at: 0.15, reason: 'the hero lands first: it is what the shot is about' });
    for (const id of supports) {
      if (prevCast.includes(id)) sh.motionChain.push({ element: id, action: 'respond', style: 'recoil', to: hero, after: `${nm}.peak`, amount: 0.035, reason: 'the landing pushes the others back: they answer it' });
      else if (!busy.has(id)) sh.motionChain.push({ element: id, action: 'enter', after: `${nm}.peak`, reason: 'the others arrive because the hero landed' });
    }
    out.push({ pattern: 'land-and-react', script: sc, why: `${hero} lands and ${supports.length} element(s) answer it` });
  }
  // relay: the focus passes along the items (attention moves one at a time; nothing is removed)
  if (sibs.length >= 3) {
    const sc = clone(script);
    const ch = (sc.shots[i] as ShotObj).motionChain;
    const dur = (s.timing as { duration?: number } | undefined)?.duration ?? 3.5;
    const gap = Math.max(0.55, (dur - 1.7) / sibs.length);
    sibs.forEach((id, k) => {
      ch.push({ id: named(ch, `focus-${k + 1}`), element: id, action: 'focus', at: Math.round((1.0 + k * gap) * 100) / 100, amount: 1.06, reason: k === 0 ? 'the eye starts on the first item' : 'the attention is handed to the next item' });
    });
    out.push({ pattern: 'relay', script: sc, why: `the focus is handed along ${sibs.length} items` });
  }
  return out;
}

/**
 * A camera-free equivalent (no-camera choreography): what the camera move did to its target, the element
 * does itself — a push-in becomes the target growing toward the viewer, a follow becomes the target's own
 * travel (already there), a truck / orbit becomes a small travel of the hero. Applied when the camera is off
 * or when the camera carries the shot.
 */
export function cameraFreeEquivalent(script: ScriptObj, i: number, original: ScriptObj = script): ChoreoCandidate | null {
  const s = original.shots[i] as ShotObj & { camera?: unknown; cameraTarget?: string };
  const cam = s.camera;
  if (!cam || cam === 'static') return null;
  const move = (cam as { move?: string }).move ?? '';
  const target = s.cameraTarget?.split(',')[0]?.trim();
  const holder = target ? script.stage?.elements.find((e) => e.id === target || (e as { anchors?: Record<string, unknown> }).anchors?.[target])?.id : undefined;
  const hero = holder ?? (s.cast ?? []).find((c) => c.role === 'hero')?.id;
  if (!hero) return null;
  const sc = clone(script);
  const sh = sc.shots[i] as ShotObj;
  const startAt = typeof (cam as { startAt?: unknown }).startAt === 'number' ? ((cam as { startAt: number }).startAt as number) : 0.6;
  const endAt = typeof (cam as { endAt?: unknown }).endAt === 'number' ? ((cam as { endAt: number }).endAt as number) : Math.max(startAt + 1, ((s.timing as { duration?: number })?.duration ?? 3) - 0.4);
  const dur = Math.max(0.6, Math.min(2.4, endAt - startAt));
  if (/push|dolly|zoom-in|rack/.test(move)) {
    sh.motionChain.push({ id: named(sh.motionChain, 'grow'), element: hero, action: 'transform', at: startAt, dur, amount: 1.14, reason: `without a camera the ${hero} itself comes toward the viewer (what the push did)` });
  } else if (/pull/.test(move)) {
    sh.motionChain.push({ id: named(sh.motionChain, 'recede'), element: hero, action: 'transform', at: startAt, dur, amount: 0.9, reason: `without a camera the ${hero} steps back (what the pull did)` });
  } else if (/truck|orbit|crane|pan/.test(move)) {
    sh.motionChain.push({ id: named(sh.motionChain, 'drift'), element: hero, action: 'move', at: startAt, dur, amount: 0.04, reason: `without a camera the ${hero} travels a little (what the truck did)` });
  } else if (/follow/.test(move)) {
    // the follow already rides the element's own motion: nothing to replace
    return null;
  } else return null;
  return { pattern: 'camera-free', script: sc, why: `camera ${move} → the element moves itself` };
}
