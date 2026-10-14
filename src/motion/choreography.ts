/**
 * Choreography Engine — one timeline for a whole moment.
 *
 * A choreography describes HOW actions relate in time instead of hand-typed
 * delays: sequence, parallel, overlap, wait, marker, cue, trigger, follow,
 * stagger and handoff (the vocabulary of GSAP timelines and Motion Canvas
 * flows). It is plain JSON (zod-validated) so the Creative Director, the
 * Studio and a user can edit it.
 *
 *   seq ─┬─ action  cursor move → folder               (0.9 s)
 *        ├─ action  cursor press      ← event button_press
 *        ├─ par ─┬─ action folder.glow pulse
 *        │       └─ cue    click
 *        └─ action folder.open 0→1 (trigger: click, spring)
 *
 * It is NOT a second motion engine. `compileChoreo` only resolves WHEN things
 * happen; values come from the existing primitives (`curve`, `springAt`,
 * `staggerDelay`). The result is a set of pure functions of time:
 *
 *   valueAt(c, 'folder.open', t)   property tracks (to / pulse / kick shapes)
 *   phaseOf(c, 'press', t)         before / active / done + eased progress
 *   focusAt(c, t)                  focus weights after handoffs
 *   c.events                       MotionEventDecl[] with EXACT anchors for the Sound Director
 *
 * Remotion stays the clock: a scene evaluates the compiled choreography at its
 * own frame / fps. Nothing is stored between frames, so seek(t), stills and the
 * render agree, and the same JSON always gives the same film.
 */
import { z } from 'zod';
import { cubicBezier, curve, type EasingFn } from './easing';
import { springAt, springSettleTime, type SpringOptions } from './spring';
import { staggerDelay, type StaggerFrom } from './orchestrate';
import { MOTION_EVENT_TYPES, type MotionEventDecl, type MotionEventType } from '../audio/events';
import { ELEMENT_KINDS, type ElementKind } from './physics';

// ── schema ─────────────────────────────────────────────────────────────────────────

/** Ids and names: letters, digits, `_` and `:` (a `-` would read as an offset in "id-0.2"). */
export const CHOREO_ID = /^[A-Za-z_][A-Za-z0-9_:]*$/;
const Id = z.string().regex(CHOREO_ID, 'choreography ids use letters, digits, _ and : only');

export const ChoreoSpringSchema = z
  .object({
    bounce: z.number().min(-1).max(0.95).optional(),
    visualDuration: z.number().min(0.05).max(4).optional(),
    stiffness: z.number().positive().optional(),
    damping: z.number().min(0).optional(),
    mass: z.number().positive().optional(),
  })
  .strict();

export const ChoreoEventSchema = z
  .object({
    type: z.enum(MOTION_EVENT_TYPES),
    importance: z.number().min(0).max(1).optional(),
    element: z.enum(ELEMENT_KINDS as [ElementKind, ...ElementKind[]]).optional(),
    area: z.number().min(0).max(1).optional(),
    direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out', 'none']).optional(),
    anchor: z.enum(['start', 'peak', 'contact', 'settle', 'completion']).optional(),
  })
  .strict();
export type ChoreoEvent = z.infer<typeof ChoreoEventSchema>;

const Placement = {
  /**
   * Where the node starts. A number is absolute seconds on the choreography.
   * A string is a GSAP-style position: `<` (with the previous sibling), `>` (after it),
   * `<0.2` / `>-0.1`, `+=0.3` (gap after the previous) / `-=0.2` (overlap), or a reference
   * `name`, `name.end`, `name.peak+0.1` to any id, marker or cue anywhere in the tree.
   */
  at: z.union([z.number().min(0), z.string().min(1)]).optional(),
  /** Start when this cue / marker / id fires (sugar for `at: name`). */
  trigger: Id.optional(),
  /** Follow-through: start `lag` s after the leader's `on` point; inherits its duration and easing. */
  follow: z.object({ id: Id, on: z.enum(['start', 'end', 'peak', 'contact', 'settle']).default('start'), lag: z.number().min(-2).max(5).default(0.08) }).strict().optional(),
  /** Handoff: start while `from` is still finishing (at this fraction of it); focus passes from its target to this one. */
  handoff: z.object({ from: Id, at: z.number().min(0).max(1).default(0.7) }).strict().optional(),
  /** Seconds added after the placement is resolved. */
  offset: z.number().min(-10).max(10).optional(),
};

/** A choreography node. Containers place their children; leaves are timed actions, waits, markers and cues. */
export type ChoreoNode =
  | ({ type: 'action'; id?: string; target?: string; dur?: number; ease?: string; spring?: z.infer<typeof ChoreoSpringSchema>; props?: Record<string, number>; from?: Record<string, number>; shape?: 'to' | 'pulse' | 'kick'; kind?: string; data?: Record<string, unknown>; event?: ChoreoEvent | false } & PlacementT)
  | ({ type: 'wait'; id?: string; dur: number } & PlacementT)
  | ({ type: 'marker'; id: string } & PlacementT)
  | ({ type: 'cue'; id: string; event?: ChoreoEvent } & PlacementT)
  | ({ type: 'seq' | 'par'; id?: string; target?: string; children: ChoreoNode[] } & PlacementT)
  | ({ type: 'stagger'; id?: string; target?: string; each: number; from?: StaggerFrom; ease?: string; maxTotal?: number; children: ChoreoNode[] } & PlacementT);

interface PlacementT {
  at?: number | string;
  trigger?: string;
  follow?: { id: string; on?: 'start' | 'end' | 'peak' | 'contact' | 'settle'; lag?: number };
  handoff?: { from: string; at?: number };
  offset?: number;
}

export const ChoreoNodeSchema: z.ZodType<ChoreoNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal('action'),
        id: Id.optional(),
        /** What the action moves: an element name, `cursor` or `camera`. */
        target: Id.optional(),
        dur: z.number().min(0).max(60).optional(),
        /** Curve name from motion/easing CURVES, `linear` or `hold`. */
        ease: z.string().optional(),
        /** A spring instead of a curve (velocity carries over from the move it interrupts). */
        spring: ChoreoSpringSchema.optional(),
        /** Property → value at the end (`to`), or amount (`pulse` / `kick`). */
        props: z.record(z.number()).optional(),
        /** Explicit start values (otherwise the current value of the track). */
        from: z.record(z.number()).optional(),
        /** to: move to the value · pulse: there and back · kick: a spring impulse that settles by itself. */
        shape: z.enum(['to', 'pulse', 'kick']).optional(),
        /** Interaction vocabulary for `cursor` actions: appear, move, hover, press, release, click, drag, leave, hide. */
        kind: z.string().max(24).optional(),
        data: z.record(z.unknown()).optional(),
        /** Sound Director event; `false` silences a kind's default event. */
        event: z.union([ChoreoEventSchema, z.literal(false)]).optional(),
        ...Placement,
      })
      .strict(),
    z.object({ type: z.literal('wait'), id: Id.optional(), dur: z.number().min(0).max(60), ...Placement }).strict(),
    z.object({ type: z.literal('marker'), id: Id, ...Placement }).strict(),
    z.object({ type: z.literal('cue'), id: Id, event: ChoreoEventSchema.optional(), ...Placement }).strict(),
    z.object({ type: z.enum(['seq', 'par']), id: Id.optional(), target: Id.optional(), children: z.array(ChoreoNodeSchema).max(200), ...Placement }).strict(),
    z
      .object({
        type: z.literal('stagger'),
        id: Id.optional(),
        target: Id.optional(),
        each: z.number().min(0).max(5),
        from: z.union([z.enum(['first', 'last', 'center', 'edges', 'reading']), z.number().int().min(0)]).optional(),
        ease: z.string().optional(),
        maxTotal: z.number().min(0).optional(),
        children: z.array(ChoreoNodeSchema).max(200),
        ...Placement,
      })
      .strict(),
  ]),
);

export const ChoreoSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    /** Starting value of tracks (`target.prop`); unspecified tracks start at 0. */
    initial: z.record(z.number()).optional(),
    /** The root is a sequence. */
    timeline: z.array(ChoreoNodeSchema).max(400),
  })
  .strict();
export type ChoreoSpec = z.input<typeof ChoreoSpecSchema>;

// ── compiled form ──────────────────────────────────────────────────────────────────

export type SpanShape = 'to' | 'pulse' | 'kick';

/** A resolved action on the timeline (seconds). */
export interface ChoreoSpan {
  id: string;
  target?: string;
  kind?: string;
  start: number;
  end: number;
  dur: number;
  ease: string;
  spring?: SpringOptions;
  shape: SpanShape;
  props: Record<string, number>;
  from?: Record<string, number>;
  data: Record<string, unknown>;
  /** Declaration order (ties on start keep it). */
  order: number;
}

export interface ChoreoHandoff {
  from: string;
  to: string;
  t0: number;
  t1: number;
}

export interface CompiledChoreo {
  duration: number;
  spans: ChoreoSpan[];
  /** Every named node (actions, containers, waits) → its resolved interval. */
  byId: Record<string, { start: number; end: number; type: ChoreoNode['type'] }>;
  markers: Record<string, number>;
  cues: { id: string; t: number }[];
  handoffs: ChoreoHandoff[];
  /** Sound Director events with exact anchors (scene-local seconds). */
  events: MotionEventDecl[];
  initial: Record<string, number>;
  /** Internal: compiled property tracks. */
  tracks: Map<string, Track>;
}

export class ChoreoError extends Error {}

/** Default Sound Director event for the cursor interaction vocabulary (the click is heard, a hover is not). */
export const KIND_EVENTS: Partial<Record<string, MotionEventType>> = { press: 'button_press', click: 'button_press', drag: 'swipe' };

/** Share of a `click` spent pressing down (the rest is the release). */
export const CLICK_PRESS_SHARE = 0.45;

const DEFAULT_DUR: Record<string, number> = { appear: 0.3, move: 0.8, hover: 0.3, press: 0.12, release: 0.16, click: 0.3, drag: 0.9, leave: 0.4, hide: 0.3 };

// ── compile ───────────────────────────────────────────────────────────────────────

interface Rec {
  node: ChoreoNode;
  key: string;
  parent: Rec | null;
  index: number;
  siblings: Rec[];
  children: Rec[];
  order: number;
}

const easeOf = (name: string | undefined): EasingFn => (name === 'linear' ? (t) => Math.min(1, Math.max(0, t)) : name === 'hold' ? (t) => (t >= 1 ? 1 : 0) : curve(name ?? 'ease-out-quint'));

/**
 * Resolve a choreography to absolute times and pure value functions.
 * `timeScale` stretches every duration, wait and absolute time (fit a phrase to a scene).
 * Throws ChoreoError on unknown references, duplicate ids and cycles.
 */
export function compileChoreo(input: ChoreoSpec, opts: { timeScale?: number } = {}): CompiledChoreo {
  const spec = ChoreoSpecSchema.parse(input);
  const k = Math.max(0.05, opts.timeScale ?? 1);
  const named = new Map<string, Rec>();
  let order = 0;
  const all: Rec[] = [];
  const build = (nodes: ChoreoNode[], parent: Rec | null): Rec[] => {
    const recs: Rec[] = [];
    nodes.forEach((node, index) => {
      const rec: Rec = { node, key: '', parent, index, siblings: recs, children: [], order: order++ };
      const nid = (node as { id?: string }).id;
      rec.key = nid ?? `#${rec.order}`;
      if (nid) {
        if (named.has(nid)) throw new ChoreoError(`duplicate choreography id "${nid}"`);
        named.set(nid, rec);
      }
      recs.push(rec);
      all.push(rec);
      if ('children' in node) rec.children = build(node.children, rec);
    });
    return recs;
  };
  const root: Rec = { node: { type: 'seq', children: spec.timeline }, key: '#root', parent: null, index: 0, siblings: [], children: [], order: -1 };
  root.children = build(spec.timeline, root);

  const starts = new Map<Rec, number>();
  const ends = new Map<Rec, number>();
  const busy = new Set<string>();
  const guard = <T,>(tag: string, fn: () => T): T => {
    if (busy.has(tag)) throw new ChoreoError(`choreography cycle through "${tag.split('|')[1]}"`);
    busy.add(tag);
    try {
      return fn();
    } finally {
      busy.delete(tag);
    }
  };

  const durOf = (rec: Rec): number => {
    const n = rec.node;
    if (n.type === 'wait') return n.dur * k;
    if (n.type !== 'action') return 0;
    if (n.dur !== undefined) return n.dur * k;
    if (n.follow) {
      const leader = named.get(n.follow.id);
      if (leader && leader.node.type === 'action') return durOf(leader);
    }
    return (DEFAULT_DUR[n.kind ?? ''] ?? 0.6) * k;
  };
  const springOf = (rec: Rec): SpringOptions | undefined => {
    const n = rec.node;
    if (n.type !== 'action') return undefined;
    if (n.spring) return scaleSpring(n.spring, k);
    if (!n.ease && n.follow) {
      const leader = named.get(n.follow.id);
      if (leader) return springOf(leader);
    }
    return undefined;
  };
  const easeNameOf = (rec: Rec): string => {
    const n = rec.node;
    if (n.type !== 'action') return 'ease-out-quint';
    if (n.ease) return n.ease;
    if (n.follow) {
      const leader = named.get(n.follow.id);
      if (leader) return easeNameOf(leader);
    }
    return n.kind === 'move' || n.kind === 'drag' ? 'pointer' : 'ease-out-quint';
  };

  const startOf = (rec: Rec): number => {
    if (rec === root) return 0;
    const hit = starts.get(rec);
    if (hit !== undefined) return hit;
    const v = guard(`s|${rec.key}`, () => Math.max(0, placed(rec) + (rec.node.offset ?? 0) * k));
    starts.set(rec, v);
    return v;
  };
  const endOf = (rec: Rec): number => {
    const hit = ends.get(rec);
    if (hit !== undefined) return hit;
    const v = guard(`e|${rec.key}`, () => {
      const s = startOf(rec);
      if (rec.children.length || 'children' in rec.node) return Math.max(s, ...rec.children.map(endOf));
      return s + durOf(rec);
    });
    ends.set(rec, v);
    return v;
  };
  const pointOf = (rec: Rec, on: string): number => {
    const s = startOf(rec);
    if (on === 'start') return s;
    const e = endOf(rec);
    if (on === 'end' || on === 'contact') return e;
    const span = rec.node.type === 'action' ? { start: s, dur: e - s, ease: easeNameOf(rec), spring: springOf(rec), shape: rec.node.shape ?? 'to' } : null;
    if (on === 'peak') return span ? s + peakFraction(span) * span.dur : (s + e) / 2;
    if (on === 'settle') return span?.spring ? s + springSettleTime(span.spring) : e;
    return e;
  };
  const refTime = (ref: string, from: Rec): number => {
    const m = /^([A-Za-z_][A-Za-z0-9_:]*)(?:\.(start|end|peak|contact|settle))?\s*(?:([+-])\s*(\d+(?:\.\d+)?|\.\d+))?$/.exec(ref.trim());
    if (!m) throw new ChoreoError(`bad choreography position "${ref}"`);
    const target = named.get(m[1]);
    if (!target) throw new ChoreoError(`"${ref}" refers to unknown id "${m[1]}"`);
    if (target === from) throw new ChoreoError(`"${m[1]}" cannot be placed relative to itself`);
    const off = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) * k : 0;
    return pointOf(target, m[2] ?? 'start') + off;
  };
  const placed = (rec: Rec): number => {
    const n = rec.node;
    if (typeof n.at === 'number') return n.at * k;
    if (n.trigger) return refTime(n.trigger, rec);
    if (n.follow) {
      const leader = named.get(n.follow.id);
      if (!leader) throw new ChoreoError(`follow refers to unknown id "${n.follow.id}"`);
      return pointOf(leader, n.follow.on ?? 'start') + (n.follow.lag ?? 0.08) * k;
    }
    if (n.handoff) {
      const src = named.get(n.handoff.from);
      if (!src) throw new ChoreoError(`handoff refers to unknown id "${n.handoff.from}"`);
      const s = startOf(src);
      return s + (endOf(src) - s) * (n.handoff.at ?? 0.7);
    }
    const parent = rec.parent!;
    const prev = rec.index > 0 ? rec.siblings[rec.index - 1] : null;
    const pStart = startOf(parent);
    if (typeof n.at === 'string') {
      const pos = /^(<|>)\s*([+-]?\d*\.?\d+)?$|^([+-])=\s*(\d*\.?\d+)$/.exec(n.at.trim());
      if (pos) {
        if (pos[1]) {
          const base = prev ? (pos[1] === '<' ? startOf(prev) : endOf(prev)) : pStart;
          return base + (pos[2] ? Number(pos[2]) * k : 0);
        }
        const base = prev ? endOf(prev) : pStart;
        return base + (pos[3] === '-' ? -1 : 1) * Number(pos[4]) * k;
      }
      return refTime(n.at, rec);
    }
    const pt = parent.node.type;
    if (pt === 'par') return pStart;
    if (pt === 'stagger') {
      const st = parent.node as Extract<ChoreoNode, { type: 'stagger' }>;
      return pStart + staggerDelay(rec.index, rec.siblings.length, { each: st.each * k, from: st.from, ease: st.ease, maxTotal: st.maxTotal !== undefined ? st.maxTotal * k : undefined });
    }
    return prev ? endOf(prev) : pStart;
  };

  // resolve everything
  for (const r of all) endOf(r);

  const targetOf = (rec: Rec): string | undefined => {
    const n = rec.node as { target?: string };
    if (n.target) return n.target;
    for (let p = rec.parent; p; p = p.parent) if ((p.node as { target?: string }).target) return (p.node as { target?: string }).target;
    // a container without a target hands focus to its first targeted descendant
    const stack = [...rec.children];
    while (stack.length) {
      const c = stack.shift()!;
      const t = (c.node as { target?: string }).target;
      if (t) return t;
      stack.push(...c.children);
    }
    return undefined;
  };

  const spans: ChoreoSpan[] = [];
  const byId: CompiledChoreo['byId'] = {};
  const markers: Record<string, number> = {};
  const cues: { id: string; t: number }[] = [];
  const handoffs: ChoreoHandoff[] = [];
  const events: MotionEventDecl[] = [];
  const r3 = (x: number) => Math.round(x * 1e4) / 1e4;
  for (const rec of all) {
    const n = rec.node;
    const s = r3(startOf(rec));
    const e = r3(endOf(rec));
    if ((n as { id?: string }).id) byId[(n as { id: string }).id] = { start: s, end: e, type: n.type };
    if (n.type === 'marker') markers[n.id] = s;
    if (n.type === 'cue') {
      cues.push({ id: n.id, t: s });
      markers[n.id] = s;
      if (n.event) events.push(eventDecl(n.event, { start: s, peak: s, contact: s, settle: s, completion: s }));
    }
    if (n.handoff) {
      const src = named.get(n.handoff.from)!;
      const from = targetOf(src);
      const to = targetOf(rec);
      if (from && to && from !== to) handoffs.push({ from, to, t0: s, t1: r3(Math.max(s + 0.2 * k, endOf(src))) });
    }
    if (n.type !== 'action') continue;
    const span: ChoreoSpan = {
      id: rec.key,
      target: targetOf(rec),
      kind: n.kind,
      start: s,
      end: e,
      dur: r3(e - s),
      ease: easeNameOf(rec),
      spring: springOf(rec),
      shape: n.shape ?? 'to',
      props: n.props ?? (n.follow && named.get(n.follow.id)?.node.type === 'action' ? ((named.get(n.follow.id)!.node as { props?: Record<string, number> }).props ?? {}) : {}),
      from: n.from,
      data: n.data ?? {},
      order: rec.order,
    };
    spans.push(span);
    const evType = n.event === false ? undefined : n.event?.type ?? (n.target === 'cursor' || !n.target ? KIND_EVENTS[n.kind ?? ''] : undefined);
    if (evType) {
      const decl: ChoreoEvent = n.event ? n.event : { type: evType, element: n.kind === 'drag' ? 'card' : 'button' };
      events.push(eventDecl(decl, spanAnchors(span)));
    }
  }
  spans.sort((a, b) => a.start - b.start || a.order - b.order);
  handoffs.sort((a, b) => a.t0 - b.t0);
  cues.sort((a, b) => a.t - b.t);
  events.sort((a, b) => a.at - b.at);
  const initial = { ...(spec.initial ?? {}) };
  const duration = r3(Math.max(0, ...all.map(endOf), ...spans.map((sp) => (sp.spring ? sp.start + springSettleTime(sp.spring) : sp.end))));
  return { duration, spans, byId, markers, cues, handoffs, events, initial, tracks: buildTracks(spans, initial) };
}

function scaleSpring(s: z.infer<typeof ChoreoSpringSchema>, k: number): SpringOptions {
  if (k === 1 || s.stiffness !== undefined || s.damping !== undefined) return { ...s };
  return { ...s, visualDuration: (s.visualDuration ?? 0.5) * k };
}

function eventDecl(e: ChoreoEvent, a: { start: number; peak: number; contact: number; settle: number; completion: number }): MotionEventDecl {
  return {
    type: e.type,
    at: a.start,
    ...(e.importance !== undefined ? { importance: e.importance } : {}),
    ...(e.element ? { element: e.element } : {}),
    ...(e.area !== undefined ? { area: e.area } : {}),
    ...(e.direction ? { direction: e.direction } : {}),
    ...(e.anchor ? { anchor: e.anchor } : {}),
    exact: a,
  };
}

/** Where a span's velocity peaks (fraction of its duration), from its own curve. */
function peakFraction(sp: { dur: number; ease: string; spring?: SpringOptions; shape: SpanShape }): number {
  if (sp.shape === 'pulse') return 0.5;
  if (sp.shape === 'kick') return 0;
  if (sp.spring) {
    let best = 0;
    let at = 0;
    const T = Math.max(0.05, Math.min(sp.dur || 1, springSettleTime(sp.spring)));
    for (let i = 1; i <= 48; i++) {
      const v = Math.abs(springAt((i / 48) * T, 0, 1, sp.spring).velocity);
      if (v > best) {
        best = v;
        at = (i / 48) * T;
      }
    }
    return sp.dur > 0 ? Math.min(1, at / sp.dur) : 0;
  }
  if (sp.ease === 'pointer') return 0.4;
  if (sp.ease === 'linear') return 0.5; // constant speed: the middle stands for the peak
  const e = easeOf(sp.ease);
  let best = -1;
  let at = 0.5;
  for (let i = 0; i < 48; i++) {
    const x = (i + 0.5) / 48;
    const v = e(x + 1 / 96) - e(x - 1 / 96);
    if (v > best) {
      best = v;
      at = x;
    }
  }
  return at;
}

/** Sound anchors of an action from its real timing. A click's contact is the bottom of the press. */
export function spanAnchors(sp: ChoreoSpan): { start: number; peak: number; contact: number; settle: number; completion: number } {
  const r = (x: number) => Math.round(x * 1e4) / 1e4;
  if (sp.kind === 'click') {
    const contact = sp.start + sp.dur * CLICK_PRESS_SHARE;
    return { start: sp.start, peak: r(sp.start + sp.dur * CLICK_PRESS_SHARE * 0.6), contact: r(contact), settle: sp.end, completion: sp.end };
  }
  if (sp.kind === 'press') return { start: sp.start, peak: r(sp.start + sp.dur * 0.6), contact: sp.end, settle: sp.end, completion: sp.end };
  const peak = r(sp.start + peakFraction(sp) * sp.dur);
  if (sp.shape === 'pulse') return { start: sp.start, peak, contact: peak, settle: sp.end, completion: sp.end };
  if (sp.shape === 'kick') return { start: sp.start, peak: sp.start, contact: sp.start, settle: sp.end, completion: sp.end };
  const settle = sp.spring ? r(sp.start + springSettleTime(sp.spring)) : sp.end;
  return { start: sp.start, peak, contact: sp.end, settle, completion: r(Math.max(settle, sp.end)) };
}

// ── property tracks ───────────────────────────────────────────────────────────────

interface Seg {
  sp: ChoreoSpan;
  to: number;
  fromV: number;
  v0: number;
  ease: EasingFn;
}
interface Track {
  base: number;
  chain: Seg[];
  add: { sp: ChoreoSpan; amount: number; ease: EasingFn; norm: number }[];
}

/** Pointer travel: quick start, long deceleration into the target (Fitts-like). */
export const pointerEase: EasingFn = cubicBezier(0.4, 0.04, 0.18, 1);

function easeFor(name: string): EasingFn {
  return name === 'pointer' ? pointerEase : easeOf(name);
}

/** Rest value of a property when nothing set it (`scale` 1, camera `close` 1, focus at the centre…). */
export const PROP_DEFAULTS: Record<string, number> = { scale: 1, zoom: 1, close: 1, opacity: 1, focusX: 0.5, focusY: 0.5 };
const baseOf = (key: string, initial: Record<string, number>) => initial[key] ?? PROP_DEFAULTS[key.slice(key.lastIndexOf('.') + 1)] ?? 0;

function chainValue(tr: Track, k: number, t: number): number {
  for (let i = k; i >= 0; i--) {
    const s = tr.chain[i];
    if (t < s.sp.start) continue;
    const local = t - s.sp.start;
    if (s.sp.spring) return springAt(local, s.fromV, s.to, { ...s.sp.spring, velocity: s.v0 }).value;
    if (s.sp.dur <= 0 || local >= s.sp.dur) return s.to;
    return s.fromV + (s.to - s.fromV) * s.ease(local / s.sp.dur);
  }
  return tr.base;
}

function buildTracks(spans: ChoreoSpan[], initial: Record<string, number>): Map<string, Track> {
  const tracks = new Map<string, Track>();
  const get = (key: string): Track => {
    let tr = tracks.get(key);
    if (!tr) tracks.set(key, (tr = { base: baseOf(key, initial), chain: [], add: [] }));
    return tr;
  };
  for (const sp of spans) {
    if (!sp.target) continue;
    for (const [prop, v] of Object.entries(sp.props)) {
      const tr = get(`${sp.target}.${prop}`);
      if (sp.shape === 'to') {
        const k = tr.chain.length - 1;
        const fromV = sp.from?.[prop] ?? chainValue(tr, k, sp.start);
        // velocity of the move this one interrupts carries into a spring (no dead stop)
        const h = 1 / 240;
        const v0 = sp.spring && sp.from?.[prop] === undefined ? (chainValue(tr, k, sp.start) - chainValue(tr, k, sp.start - h)) / h : 0;
        tr.chain.push({ sp, to: v, fromV, v0, ease: easeFor(sp.ease) });
      } else {
        let norm = 1;
        if (sp.shape === 'kick') {
          // normalise so the first swing reaches `amount`
          const opts = { ...(sp.spring ?? { bounce: 0.5, visualDuration: 0.3 }), velocity: 1, restDelta: 1e-7, restSpeed: 1e-6 };
          let peak = 0;
          for (let i = 1; i <= 240; i++) peak = Math.max(peak, Math.abs(springAt(i / 240, 0, 0, opts).value));
          norm = peak > 0 ? 1 / peak : 1;
        }
        tr.add.push({ sp, amount: v, ease: easeFor(sp.ease === 'pointer' ? 'linear' : sp.ease), norm });
      }
    }
  }
  return tracks;
}

/** Value of track `target.prop` at time t (seconds on the choreography). Pure. */
export function valueAt(c: CompiledChoreo, key: string, t: number, fallback = 0): number {
  // fallback applies only to properties without a known rest value
  const tr = c.tracks.get(key);
  if (!tr) return c.initial[key] ?? PROP_DEFAULTS[key.slice(key.lastIndexOf('.') + 1)] ?? fallback;
  let v = chainValue(tr, tr.chain.length - 1, t);
  for (const a of tr.add) {
    const local = t - a.sp.start;
    if (local < 0) continue;
    if (a.sp.shape === 'pulse') {
      if (local >= a.sp.dur) continue;
      v += a.amount * Math.sin(Math.PI * a.ease(local / Math.max(1e-6, a.sp.dur)));
    } else {
      if (a.sp.dur > 0 && local > a.sp.dur * 3) continue;
      const opts = { ...(a.sp.spring ?? { bounce: 0.5, visualDuration: 0.3 }), velocity: 1, restDelta: 1e-7, restSpeed: 1e-6 };
      v += a.amount * a.norm * springAt(local, 0, 0, opts).value;
    }
  }
  return v;
}

/** Every track of a target as an object (`{ open, glow, hover… }`). */
export function targetValues(c: CompiledChoreo, target: string, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  const pre = `${target}.`;
  for (const key of c.tracks.keys()) if (key.startsWith(pre)) out[key.slice(pre.length)] = valueAt(c, key, t);
  for (const [key, v] of Object.entries(c.initial)) if (key.startsWith(pre) && !(key.slice(pre.length) in out)) out[key.slice(pre.length)] = v;
  return out;
}

export interface ChoreoPhase {
  phase: 'before' | 'active' | 'done';
  /** Eased progress of the node (0..1, springs may overshoot). */
  p: number;
  /** Seconds since the node started (negative before). */
  local: number;
}

/** Where a named node is at t. */
export function phaseOf(c: CompiledChoreo, id: string, t: number): ChoreoPhase {
  const r = c.byId[id];
  if (!r) return { phase: 'before', p: 0, local: -Infinity };
  const local = t - r.start;
  if (t < r.start) return { phase: 'before', p: 0, local };
  const sp = c.spans.find((s) => s.id === id);
  const dur = r.end - r.start;
  if (sp?.spring) {
    const v = springAt(local, 0, 1, sp.spring);
    return { phase: v.done || (dur > 0 && local >= dur && Math.abs(v.value - 1) < 0.01) ? 'done' : 'active', p: v.value, local };
  }
  if (dur <= 0 || t >= r.end) return { phase: 'done', p: 1, local };
  const e = sp ? easeFor(sp.ease) : (x: number) => x;
  return { phase: 'active', p: e(local / dur), local };
}

/** Ids of the actions running at t (seek / QC). */
export function activeAt(c: CompiledChoreo, t: number): string[] {
  return c.spans.filter((s) => t >= s.start && t < Math.max(s.end, s.start + 1e-3) && !s.id.startsWith('#')).map((s) => s.id);
}

/** Markers and cues already passed at t (latest last). */
export function passedAt(c: CompiledChoreo, t: number): string[] {
  return Object.entries(c.markers)
    .filter(([, at]) => at <= t)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

/**
 * Focus weights after handoffs: the element that has the viewer's attention (1)
 * and those it passed from (fading to 0). Before the first handoff the first
 * source has focus.
 */
export function focusAt(c: CompiledChoreo, t: number): Record<string, number> {
  if (!c.handoffs.length) return {};
  const w: Record<string, number> = { [c.handoffs[0].from]: 1 };
  for (const h of c.handoffs) {
    if (t <= h.t0) break;
    const u = Math.min(1, (t - h.t0) / Math.max(1e-3, h.t1 - h.t0));
    const s = u * u * (3 - 2 * u);
    for (const key of Object.keys(w)) w[key] *= 1 - s;
    w[h.to] = Math.max(w[h.to] ?? 0, s);
  }
  for (const key of Object.keys(w)) w[key] = Math.round(w[key] * 1e4) / 1e4;
  return w;
}

// ── camera ────────────────────────────────────────────────────────────────────────

/**
 * Camera Engine state from the `camera` target's tracks, with the same mapping
 * as a `track` camera plan: focus (fraction of the canvas) moves the camera
 * toward the subject, close (1 = rest framing) dollies in; `dolly`, `zoom`,
 * `tilt`, `yaw`, `roll` are direct channels (kicks add accents).
 */
export function cameraFromChoreo(c: CompiledChoreo, t: number, W: number, H: number): { x: number; y: number; dolly: number; zoom: number; tilt: number; yaw: number; roll: number; focus: number; aperture: number } {
  const v = (p: string) => valueAt(c, `camera.${p}`, t);
  return {
    x: (v('focusX') - 0.5) * W * 0.14,
    y: (v('focusY') - 0.5) * H * 0.14,
    dolly: Math.max(-0.3, (v('close') - 1) * 0.9 + v('dolly')),
    zoom: v('zoom'),
    tilt: v('tilt'),
    yaw: v('yaw'),
    roll: v('roll'),
    focus: v('focus'),
    aperture: Math.max(0, v('aperture')),
  };
}

/** Does the choreography move the camera at all? */
export const hasCamera = (c: CompiledChoreo) => [...c.tracks.keys()].some((k) => k.startsWith('camera.'));
