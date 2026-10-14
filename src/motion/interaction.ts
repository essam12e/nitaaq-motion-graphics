/**
 * Interaction choreography — the cursor and the element it acts on, on the
 * same timeline as everything else.
 *
 * Cursor actions are ordinary choreography actions with `target: 'cursor'` and
 * a `kind` (appear, move, hover, press, release, click, drag, leave, hide);
 * `data.to` names where the pointer goes (an element name, or `{x, y}` as a
 * fraction of the canvas) and `data.target` the element it acts on. This module
 * reads those spans and answers two questions at any time t:
 *
 *   cursorAt(ix, t, resolve)   where the pointer is, how pressed, ripple, hover halo
 *   elementAt(ix, 'folder', t) how the element responds:
 *        hover    0..1  the pointer is over it (lift, highlight)
 *        press    0..1  compression while held; springs back past 0 on release (a pop)
 *        click    0..1  reaction pulse decaying from the contact moment
 *        clickAge s     since the contact (−1 before)
 *        released 0..1  state transition after release
 *        dragging 0..1  and drag {dx, dy}: the element carried by the pointer
 *
 * Layout stays out of the timing: positions are resolved at evaluation with the
 * scene's own layout (`resolve(name)`), so the same choreography — and the same
 * sound events — work in 9:16 and 16:9.
 */
import type { CompiledChoreo, ChoreoNode, ChoreoSpan } from './choreography';
import { CLICK_PRESS_SHARE, pointerEase } from './choreography';
import { curve } from './easing';
import { trackAt, type Keyframe } from './orchestrate';

export type PointRef = string | { x: number; y: number };
export interface Pt {
  x: number;
  y: number;
}

interface Move {
  t0: number;
  t1: number;
  to: PointRef;
  arc: number;
  ease: string;
  drag?: string;
}

export interface Interaction {
  /** Where the pointer starts (before the first move). */
  origin: PointRef | null;
  moves: Move[];
  appear: { t0: number; t1: number } | null;
  hide: { t0: number; t1: number } | null;
  /** Press / release per element: [pressStart, pressBottom, releaseStart, releaseEnd]. */
  presses: { target: string; p0: number; p1: number; r0: number; r1: number; drag: boolean }[];
  hovers: { target: string; h0: number; h1: number }[];
  targets: string[];
}

const toOf = (sp: ChoreoSpan): PointRef | undefined => {
  const to = sp.data.to;
  if (typeof to === 'string') return to;
  if (to && typeof to === 'object' && typeof (to as Pt).x === 'number' && typeof (to as Pt).y === 'number') return { x: (to as Pt).x, y: (to as Pt).y };
  return undefined;
};
const targetOfSpan = (sp: ChoreoSpan): string | undefined => (typeof sp.data.target === 'string' ? sp.data.target : typeof sp.data.to === 'string' ? sp.data.to : undefined);

/** Reads the cursor vocabulary out of a compiled choreography (once per choreography). */
export function interactionOf(c: CompiledChoreo): Interaction {
  const cached = cache.get(c);
  if (cached) return cached;
  const cur = c.spans.filter((s) => s.target === 'cursor' && s.kind);
  const moves: Move[] = [];
  const presses: Interaction['presses'] = [];
  const hovers: Interaction['hovers'] = [];
  let origin: PointRef | null = null;
  let appear: Interaction['appear'] = null;
  let hide: Interaction['hide'] = null;
  const st: { over: { target: string; h0: number } | null; pending: { target: string; p0: number; p1: number; drag: boolean } | null } = { over: null, pending: null };
  const leave = (t: number) => {
    if (st.over) hovers.push({ target: st.over.target, h0: st.over.h0, h1: t });
    st.over = null;
  };
  const enter = (target: string, t: number) => {
    if (st.over?.target === target) return;
    leave(t);
    st.over = { target, h0: t };
  };
  const release = (r0: number, r1: number) => {
    if (!st.pending) return;
    presses.push({ ...st.pending, r0, r1 });
    st.pending = null;
  };
  for (const sp of cur) {
    const to = toOf(sp);
    switch (sp.kind) {
      case 'appear':
        appear = { t0: sp.start, t1: Math.max(sp.end, sp.start + 0.05) };
        if (to) origin = to;
        break;
      case 'move':
      case 'drag': {
        if (!to) break;
        const drag = sp.kind === 'drag' ? (typeof sp.data.target === 'string' ? sp.data.target : st.over?.target) : undefined;
        if (drag && !st.pending) st.pending = { target: drag, p0: sp.start, p1: sp.start + Math.min(0.12, sp.dur * 0.2), drag: true };
        // moving away from the hovered element ends its hover as the pointer leaves it
        if (st.over && to !== st.over.target && sp.kind === 'move') leave(sp.start + Math.min(0.12, sp.dur * 0.25));
        moves.push({ t0: sp.start, t1: sp.end, to, arc: typeof sp.data.arc === 'number' ? sp.data.arc : 0.14, ease: sp.ease, drag });
        if (typeof to === 'string') enter(to, sp.end - Math.min(0.1, sp.dur * 0.2));
        if (sp.kind === 'drag') release(sp.end, sp.end + 0.16);
        break;
      }
      case 'hover': {
        const tg = targetOfSpan(sp);
        if (tg) enter(tg, sp.start);
        break;
      }
      case 'press': {
        const tg = targetOfSpan(sp) ?? st.over?.target;
        if (tg) {
          enter(tg, sp.start);
          st.pending = { target: tg, p0: sp.start, p1: sp.end, drag: false };
        }
        break;
      }
      case 'release':
        release(sp.start, sp.end);
        break;
      case 'click': {
        const tg = targetOfSpan(sp) ?? st.over?.target;
        if (tg) {
          enter(tg, sp.start);
          const mid = sp.start + sp.dur * CLICK_PRESS_SHARE;
          presses.push({ target: tg, p0: sp.start, p1: mid, r0: mid, r1: sp.end, drag: false });
        }
        break;
      }
      case 'leave':
        leave(sp.start);
        break;
      case 'hide':
        hide = { t0: sp.start, t1: Math.max(sp.end, sp.start + 0.05) };
        leave(sp.start);
        break;
      default:
        break;
    }
  }
  if (st.pending) release(Infinity, Infinity);
  if (st.over) leave(Infinity);
  if (!appear && cur.length) appear = { t0: cur[0].start - 0.3, t1: cur[0].start };
  const targets = [...new Set([...presses.map((p) => p.target), ...hovers.map((h) => h.target)])];
  const ix: Interaction = { origin, moves, appear, hide, presses, hovers, targets };
  cache.set(c, ix);
  return ix;
}
const cache = new WeakMap<CompiledChoreo, Interaction>();

export interface CursorState {
  x: number;
  y: number;
  /** 0..1 fade. */
  visible: number;
  /** 0..1 how far the button is down (arrow squashes). */
  press: number;
  /** 0..1 click ripple age, −1 when none. */
  ripple: number;
  /** 0..1 pointer over an interactive element (halo). */
  hover: number;
  /** Pointer speed in px/s (motion-blur hint). */
  speed: number;
}

const smooth01 = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

/** Point of the pointer's tip at t; `resolve` turns element names into canvas pixels. */
export function cursorPoint(ix: Interaction, t: number, resolve: (ref: PointRef) => Pt): Pt {
  let p: Pt = ix.origin ? resolve(ix.origin) : ix.moves.length ? resolve(ix.moves[0].to) : { x: 0, y: 0 };
  for (const m of ix.moves) {
    const a = p;
    const b = resolve(m.to);
    if (t <= m.t0) return a;
    if (t >= m.t1) {
      p = b;
      continue;
    }
    const u = (m.ease === 'pointer' ? pointerEase : curve(m.ease))((t - m.t0) / Math.max(1e-3, m.t1 - m.t0));
    // a real hand travels on a slight arc, not a ruler line
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const cx = (a.x + b.x) / 2 - dy * m.arc;
    const cy = (a.y + b.y) / 2 + dx * m.arc;
    const w = 1 - u;
    return { x: w * w * a.x + 2 * w * u * cx + u * u * b.x, y: w * w * a.y + 2 * w * u * cy + u * u * b.y };
  }
  return p;
}

/** Complete cursor state at t. */
export function cursorAt(ix: Interaction, t: number, resolve: (ref: PointRef) => Pt): CursorState {
  const p = cursorPoint(ix, t, resolve);
  const h = 1 / 60;
  const q = cursorPoint(ix, t - h, resolve);
  let visible = ix.appear ? smooth01((t - ix.appear.t0) / Math.max(1e-3, ix.appear.t1 - ix.appear.t0)) : 1;
  if (ix.hide) visible *= 1 - smooth01((t - ix.hide.t0) / Math.max(1e-3, ix.hide.t1 - ix.hide.t0));
  let press = 0;
  let ripple = -1;
  for (const pr of ix.presses) {
    if (t < pr.p0) continue;
    if (t < pr.p1) press = Math.max(press, curve('ease-out-quint')((t - pr.p0) / Math.max(1e-3, pr.p1 - pr.p0)));
    else if (t < pr.r0) press = 1;
    else if (t < pr.r1) press = Math.max(press, 1 - curve('ease-out-quint')((t - pr.r0) / Math.max(1e-3, pr.r1 - pr.r0)));
    const age = t - pr.p1;
    if (!pr.drag && age >= 0 && age < 0.6) ripple = age / 0.6;
  }
  let hover = 0;
  for (const hv of ix.hovers) hover = Math.max(hover, hoverLevel(hv, t));
  return { x: p.x, y: p.y, visible, press, ripple, hover, speed: Math.hypot(p.x - q.x, p.y - q.y) / h };
}

function hoverLevel(hv: { h0: number; h1: number }, t: number): number {
  if (t < hv.h0) return 0;
  const inn = curve('ease-out-quint')(Math.min(1, (t - hv.h0) / 0.22));
  if (t < hv.h1) return inn;
  const at = curve('ease-out-quint')(Math.min(1, (hv.h1 - hv.h0) / 0.22));
  return at * (1 - smooth01((t - hv.h1) / 0.3));
}

export interface ElementState {
  hover: number;
  press: number;
  click: number;
  clickAge: number;
  released: number;
  dragging: number;
  drag: Pt;
}

/** How element `name` responds to the pointer at t. `resolve` is only needed for drags. */
export function elementAt(ix: Interaction, name: string, t: number, resolve?: (ref: PointRef) => Pt): ElementState {
  let hover = 0;
  for (const hv of ix.hovers) if (hv.target === name) hover = Math.max(hover, hoverLevel(hv, t));
  let press = 0;
  let click = 0;
  let clickAge = -1;
  let released = 0;
  let dragging = 0;
  let drag: Pt = { x: 0, y: 0 };
  for (const pr of ix.presses) {
    if (pr.target !== name || t < pr.p0) continue;
    // compression: ease down, hold, then spring back past rest (a little pop) on release
    const keys: Keyframe[] = [
      { t: pr.p0, v: 0 },
      { t: pr.p1, v: 1, ease: 'ease-out-quint' },
    ];
    if (Number.isFinite(pr.r0)) keys.push({ t: pr.r0, v: 1 }, { t: pr.r0 + 0.01, v: 0, spring: { bounce: 0.45, visualDuration: Math.max(0.18, (pr.r1 - pr.r0) * 2) } });
    press = trackAt(keys, t);
    const age = t - pr.p1;
    if (age >= 0) {
      clickAge = age;
      click = pr.drag ? 0 : Math.exp(-age / 0.22) * (age < 0.04 ? age / 0.04 : 1);
    }
    if (Number.isFinite(pr.r0) && t >= pr.r0) released = Math.max(released, smooth01((t - pr.r0) / 0.35));
    if (pr.drag && resolve) {
      const mv = ix.moves.find((m) => m.drag === name && m.t0 <= pr.p0 + 0.2 && m.t0 >= pr.p0 - 0.2);
      if (mv) {
        const start = cursorPoint(ix, mv.t0, resolve);
        const now = cursorPoint(ix, Math.min(t - 0.05, mv.t1), resolve); // a carried object lags the hand a touch
        drag = { x: now.x - start.x, y: now.y - start.y };
        dragging = t < mv.t1 ? 1 : 1 - smooth01((t - mv.t1) / 0.25);
      }
    }
  }
  return { hover, press, click, clickAge, released, dragging, drag };
}

// ── builders (plain JSON nodes) ────────────────────────────────────────────────────

type Place = Pick<Extract<ChoreoNode, { type: 'action' }>, 'at' | 'trigger' | 'follow' | 'handoff' | 'offset' | 'id' | 'event'>;

export const cursor = {
  appear: (to: PointRef, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'appear', dur: o.dur ?? 0.3, data: { to }, ...rest(o) }),
  move: (to: PointRef, o: Place & { dur?: number; ease?: string; arc?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'move', dur: o.dur ?? 0.8, ...(o.ease ? { ease: o.ease } : {}), data: { to, ...(o.arc !== undefined ? { arc: o.arc } : {}) }, ...rest(o) }),
  hover: (target: string, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'hover', dur: o.dur ?? 0.3, data: { target }, ...rest(o) }),
  press: (target: string, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'press', dur: o.dur ?? 0.12, data: { target }, ...rest(o) }),
  release: (target: string, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'release', dur: o.dur ?? 0.16, data: { target }, ...rest(o) }),
  click: (target: string, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'click', dur: o.dur ?? 0.3, data: { target }, ...rest(o) }),
  drag: (target: string, to: PointRef, o: Place & { dur?: number; ease?: string; arc?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'drag', dur: o.dur ?? 0.9, ...(o.ease ? { ease: o.ease } : {}), data: { target, to, ...(o.arc !== undefined ? { arc: o.arc } : {}) }, ...rest(o) }),
  leave: (to: PointRef, o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'move', dur: o.dur ?? 0.6, data: { to }, ...rest(o) }),
  hide: (o: Place & { dur?: number } = {}): ChoreoNode => ({ type: 'action', target: 'cursor', kind: 'hide', dur: o.dur ?? 0.3, ...rest(o) }),
};

function rest(o: Place & Record<string, unknown>): Place {
  const out: Place = {};
  for (const k of ['at', 'trigger', 'follow', 'handoff', 'offset', 'id', 'event'] as const) if (o[k] !== undefined) (out as Record<string, unknown>)[k] = o[k];
  return out;
}
