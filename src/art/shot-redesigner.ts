/**
 * P4.5 — Dynamic Shot Re-Designer & Motion-Aware Composition.
 *
 * P4 could find a good motion idea, build candidates, render them and reject the bad one — but a good idea
 * was sometimes rejected only because the shot's COMPOSITION left it no room (the SaaS hook: the chips of
 * "slam" and "collision" land on the headline). This module does not create motion. It re-plans where the
 * elements of ONE shot sit so that a visual action that was already chosen can happen:
 *
 *   motion idea → spatial requirements → re-layout → geometry filter → preview → measure → select
 *
 * instead of  motion idea → collision → reject.
 *
 *   motionEnvelope        every element's space through time: start / anticipation / path / impact / settle / exit
 *   reservedMotionSpace   the corridors, entry lanes, impact zones, expansion and transformation areas the
 *                         action needs — nothing else may stand in them unless the overlap is intended
 *   spatialDiagnosis      why a candidate fails, in spatial terms (MOTION_PATH_BLOCKED, TEXT_BLOCKS_ACTION …)
 *                         or that it fails for a MOTION reason (then nothing is re-laid out)
 *   heroDominanceTimeline the hero's share of the frame's visual weight at anticipation / movement / impact / settle
 *   attentionCorridor     current focus → motion path → impact point → next focus (ATTENTION_BREAK)
 *   motionCompositionFit  one score for the motion AND the composition together
 *   layoutCandidates      2–3 re-layouts from general strategies (never shot templates), each with the reason it
 *                         suits THIS action; the text keeps its size, nothing the client gave is removed
 *   redesignGate          a re-layout is accepted only if it is at least as good everywhere it must be (§24),
 *                         else the P4 version stays (NO_REDESIGN_IMPROVEMENT)
 *
 * Everything here is pure geometry on the compiled stage (sampleStage) or on preview frames; the node side
 * (src/node/art-director.ts) renders only the 1–2 layouts the geometry lets through.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';
import { sampleStage, KIND_MASS } from '../film/sampler';
import { fontForBox } from '../stage/compiler';
import type { PreviewFrame } from './judge';

// ───────────────────────────────────────────────────────────── types

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason?: string; [k: string]: unknown };
type Cast = { id: string; role?: string; at?: { x: number; y: number }; w?: number; enter?: string; enterFrom?: { x: number; y: number }; arriveAt?: { x: number; y: number; scale?: number }; rotation?: number; behind?: string; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; timing?: { duration?: number }; composition?: string; [k: string]: unknown };
type Decl = { id: string; kind: string; text?: string; title?: string; subtitle?: string; asset?: string; role?: string; size?: { w?: number; aspect?: number }; parent?: string; value?: number; [k: string]: unknown };

/** A rectangle in frame fractions (x, y = top-left). */
export interface FRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SpatialCode =
  | 'MOTION_PATH_BLOCKED'
  | 'HERO_TOO_SMALL_FOR_ACTION'
  | 'TEXT_BLOCKS_ACTION'
  | 'NO_IMPACT_SPACE'
  | 'NO_EXPANSION_SPACE'
  | 'CTA_NO_TRANSFORM_SPACE'
  | 'SUPPORTING_ELEMENTS_DOMINATE'
  | 'NO_NEGATIVE_SPACE'
  | 'ATTENTION_BREAK'
  | 'LAYOUT_TOO_DENSE'
  | 'RTL_FLOW_CONFLICT'
  | 'LOGO_IN_ACTION_PATH';
export const SPATIAL_CODES: SpatialCode[] = ['MOTION_PATH_BLOCKED', 'HERO_TOO_SMALL_FOR_ACTION', 'TEXT_BLOCKS_ACTION', 'NO_IMPACT_SPACE', 'NO_EXPANSION_SPACE', 'CTA_NO_TRANSFORM_SPACE', 'SUPPORTING_ELEMENTS_DOMINATE', 'NO_NEGATIVE_SPACE', 'ATTENTION_BREAK', 'LAYOUT_TOO_DENSE', 'RTL_FLOW_CONFLICT', 'LOGO_IN_ACTION_PATH'];

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const rectArea = (r: FRect) => Math.max(0, r.w) * Math.max(0, r.h);
export function interArea(a: FRect, b: FRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
export function unionRect(rs: FRect[]): FRect | null {
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) };
}
const centre = (r: FRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const inflate = (r: FRect, k: number): FRect => ({ x: r.x - (r.w * (k - 1)) / 2, y: r.y - (r.h * (k - 1)) / 2, w: r.w * k, h: r.h * k });
const declOf = (script: ScriptObj, id: string) => (script.stage?.elements as Decl[] | undefined)?.find((e) => e.id === id);
const kindOf = (script: ScriptObj, id: string) => declOf(script, id)?.kind ?? '';
const isLogo = (script: ScriptObj, id: string) => kindOf(script, id) === 'image' && declOf(script, id)?.asset === 'logo';
const readable = (kind: string) => ['text', 'chip', 'card', 'button', 'number'].includes(kind);

// ───────────────────────────────────────────────────────────── motion envelopes

export interface MotionEnvelope {
  element: string;
  kind: string;
  /** Phases of the element's own motion in the shot (frame fractions); null when it does not happen. */
  startBounds: FRect | null;
  anticipationBounds: FRect | null;
  pathBounds: FRect | null;
  impactBounds: FRect | null;
  settleBounds: FRect | null;
  exitBounds: FRect | null;
  /** The whole space the element needs while it is on screen in the shot. */
  motionEnvelope: FRect | null;
  /** The rects it sweeps while moving (a diagonal path is not its bounding box). */
  swept: { t: number; r: FRect }[];
  /** Film seconds the element moves (first / last moving sample). */
  moving: [number, number] | null;
  /** Centre travel (frame fractions) and peak size change. */
  travel: number;
  grow: number;
}

/** Frame-fraction rect sequence of every top-level element of shot i (analytic sampler, `step` s). */
export function sampleShot(plan: StagePlan, i: number, step = 0.05, range?: [number, number]): { t: number; els: { id: string; kind: string; r: FRect; o: number; z: number }[] }[] {
  const sh = plan.shots[i];
  const [t0, t1] = range ?? [sh.start, sh.end];
  const out: { t: number; els: { id: string; kind: string; r: FRect; o: number; z: number }[] }[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) {
    const s = sampleStage(plan, Math.min(t, t1 - 1e-3));
    // the space an element needs is its whole box: a mask / clip reveal or a drawn line is not a size change
    const full = (e: (typeof s.sampled)[number]) => {
      const el = plan.elements.find((x) => x.id === e.id);
      const aspPx = el ? (el.box.w * plan.W) / Math.max(1e-6, el.box.h * plan.H) : 0;
      const fw = aspPx ? e.rect.height * aspPx : e.rect.width;
      return fw > e.rect.width * 1.02 ? { ...e.rect, width: fw } : e.rect;
    };
    out.push({ t: r3(t), els: s.sampled.map((e) => {
      const r = full(e);
      return { id: e.id, kind: e.kind, r: { x: r.x / plan.W, y: r.y / plan.H, w: r.width / plan.W, h: r.height / plan.H }, o: e.opacity, z: e.z };
    }) });
  }
  return out;
}

/** motionEnvelope for every element of shot i (or only `ids`). */
export function motionEnvelopes(plan: StagePlan, i: number, opts: { step?: number; ids?: string[] } = {}): MotionEnvelope[] {
  const samples = sampleShot(plan, i, opts.step ?? 0.05);
  const ids = opts.ids ?? plan.shots[i].cast.map((c) => c.id).filter((id) => plan.elements.some((e) => e.id === id && !e.parent));
  const out: MotionEnvelope[] = [];
  for (const id of ids) {
    const seq = samples.map((s) => ({ t: s.t, e: s.els.find((x) => x.id === id) })).filter((x) => x.e && x.e.o > 0.08) as { t: number; e: { r: FRect; o: number; kind: string } }[];
    const kind = plan.elements.find((e) => e.id === id)?.kind ?? '';
    if (!seq.length) {
      out.push({ element: id, kind, startBounds: null, anticipationBounds: null, pathBounds: null, impactBounds: null, settleBounds: null, exitBounds: null, motionEnvelope: null, swept: [], moving: null, travel: 0, grow: 0 });
      continue;
    }
    const vel: number[] = seq.map((x, k) => {
      if (k === 0) return 0;
      const a = seq[k - 1].e.r;
      const b = x.e.r;
      const ca = centre(a);
      const cb = centre(b);
      return Math.hypot(cb.x - ca.x, cb.y - ca.y) + Math.abs(b.w - a.w) * 0.5 + Math.abs(b.h - a.h) * 0.5;
    });
    const thr = 0.0025;
    const movingIdx = vel.map((v, k) => (v > thr ? k : -1)).filter((k) => k >= 0);
    const first = movingIdx[0];
    const last = movingIdx[movingIdx.length - 1];
    // impact: the strongest deceleration (a fast sample followed by a slow one)
    let impK = -1;
    let best = 0;
    for (let k = 1; k < vel.length - 1; k++) {
      const dec = vel[k] - vel[k + 1];
      if (dec > best) {
        best = dec;
        impK = k;
      }
    }
    // the exit: the tail where the element fades (opacity falling) while moving
    const fadeK = seq.findIndex((x, k) => k > 0 && x.e.o < seq[k - 1].e.o - 0.05 && k > (last ?? 0) - 4 && k >= seq.length - 12);
    const settleK = (() => {
      // the last rest: the longest still run in the second half, else the last sample
      for (let k = seq.length - 1; k > 0; k--) if (vel[k] <= thr && (fadeK < 0 || k < fadeK)) return k;
      return seq.length - 1;
    })();
    const rects = seq.map((x) => x.e.r);
    // the glide to the next shot's place (the last 0.34 s) belongs to the cut, not to this shot's action
    const tEnd = plan.shots[i].end - 0.34;
    const swept = movingIdx.filter((k) => seq[k].t <= tEnd).map((k) => ({ t: seq[k].t, r: rects[k] }));
    // travel and growth are measured against the rest (settle) pose
    const c0 = centre(rects[settleK]);
    let travel = 0;
    let grow = 0;
    for (const r of rects) {
      const c = centre(r);
      travel = Math.max(travel, Math.hypot(c.x - c0.x, c.y - c0.y));
      grow = Math.max(grow, rectArea(r) / Math.max(1e-6, rectArea(rects[settleK])) - 1);
    }
    out.push({
      element: id,
      kind,
      startBounds: rects[0],
      anticipationBounds: first !== undefined && first > 0 ? unionRect(rects.slice(0, first)) : null,
      pathBounds: swept.length ? unionRect(swept.map((s) => s.r)) : null,
      impactBounds: impK > 0 ? rects[impK] : null,
      settleBounds: rects[settleK],
      exitBounds: fadeK > 0 ? unionRect(rects.slice(fadeK)) : null,
      motionEnvelope: unionRect(rects),
      swept,
      moving: swept.length ? [swept[0].t, swept[swept.length - 1].t] : null,
      travel: r3(travel),
      grow: r3(grow),
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── reserved motion space

export type ReservedKind = 'corridor' | 'entry-lane' | 'collision-path' | 'impact-zone' | 'expansion-area' | 'transformation-corridor' | 'gather-path';
export interface ReservedSpace {
  kind: ReservedKind;
  element: string;
  /** The element the action is aimed at (its own overlap with the space is intended). */
  target?: string;
  rects: { t: number; r: FRect }[];
  bounds: FRect;
  t: [number, number];
  why: string;
}

const evsOf = (script: ScriptObj, i: number) => ((script.shots[i] as ShotObj).motionChain ?? []) as Ev[];

/** The motion space the action of shot i needs (from its chain, measured on the compiled geometry). */
export function reservedMotionSpace(script: ScriptObj, plan: StagePlan, i: number, envs: MotionEnvelope[] = motionEnvelopes(plan, i)): ReservedSpace[] {
  const sh = script.shots[i] as ShotObj;
  const chain = evsOf(script, i);
  const out: ReservedSpace[] = [];
  const envOf = (id: string) => envs.find((e) => e.element === id);
  const castOf = (id: string) => (sh.cast ?? []).find((c) => c.id === id);
  for (const env of envs) {
    if (!env.moving || !env.swept.length) continue;
    const id = env.element;
    const evs = chain.filter((e) => e.element === id);
    const enter = evs.find((e) => e.action === 'enter');
    const style = (enter?.style as string) ?? castOf(id)?.enter;
    const push = evs.find((e) => e.action === 'push' || e.action === 'attract');
    const become = evs.find((e) => e.action === 'become');
    const grows = evs.find((e) => ['impact', 'transform'].includes(e.action)) ?? (env.grow > 0.12 ? ({ action: 'grow' } as Ev) : undefined);
    const t: [number, number] = env.moving;
    const rects = env.swept;
    const bounds = unionRect(rects.map((x) => x.r))!;
    if (become?.to) {
      out.push({ kind: 'transformation-corridor', element: id, target: become.to, rects, bounds, t, why: `${id} travels to ${become.to}'s place and becomes it: the corridor between them must stay clear` });
      continue;
    }
    if (push?.to) {
      out.push({ kind: push.action === 'push' ? 'collision-path' : 'gather-path', element: id, target: push.to, rects, bounds, t, why: `${id} ${push.action === 'push' ? 'collides with' : 'is pulled into'} ${push.to}: its path to the target is reserved` });
      // the contact: around where the mover meets the target (not the whole target)
      const hit = rects[rects.length - 1].r;
      out.push({ kind: 'impact-zone', element: id, target: push.to, rects: [{ t: t[1], r: inflate(hit, 1.6) }], bounds: inflate(hit, 1.6), t: [t[1] - 0.2, t[1] + 0.3], why: `the contact with ${push.to} needs a clear zone around it` });
      continue;
    }
    if (style === 'drop' || (enter && /drop|fall|thrown/.test(String(enter.id ?? '')))) {
      out.push({ kind: 'corridor', element: id, rects, bounds, t, why: `${id} drops in from above: the corridor down to where it lands is reserved` });
      continue;
    }
    if (style === 'slide' || castOf(id)?.enterFrom) {
      out.push({ kind: 'entry-lane', element: id, rects, bounds, t, why: `${id} enters along a lane: the lane is reserved` });
      continue;
    }
    if (grows) {
      out.push({ kind: 'expansion-area', element: id, rects, bounds: inflate(bounds, 1.06), t, why: `${id} expands (${grows.action}): the area it grows into is reserved` });
      continue;
    }
    if (env.travel > 0.06) out.push({ kind: 'entry-lane', element: id, rects, bounds, t, why: `${id} travels ${Math.round(env.travel * 100)}% of the frame` });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── hero dominance through time

export interface DominancePhase {
  t: number | null;
  /** hero weight / all readable + object weight (0..1). */
  share: number;
  /** hero weight / the next heaviest element. */
  ratio: number;
  /** hero area (frame fraction). */
  area: number;
}
export interface HeroDominanceTimeline {
  hero: string;
  points: { t: number; share: number; ratio: number }[];
  anticipation: DominancePhase;
  movement: DominancePhase;
  impact: DominancePhase;
  settle: DominancePhase;
  min: number;
  mean: number;
}

const weightOf = (kind: string, area: number, o: number) => area * (KIND_MASS[kind] ?? 0.2) * Math.min(1, o);

/** The hero's share of visual weight at anticipation, movement, impact and settle (not only the final frame). */
export function heroDominanceTimeline(frames: PreviewFrame[], hero: string, W: number, H: number, opts: { still?: number; group?: string[] } = {}): HeroDominanceTimeline {
  const f = [...frames].sort((a, b) => a.t - b.t);
  const thr = opts.still ?? 0.0025;
  const heroIds = new Set([hero, ...(opts.group ?? [])]);
  const pts = f.map((fr) => {
    let hw = 0;
    let ha = 0;
    const others: number[] = [];
    for (const e of fr.els) {
      const a = Math.max(0, Math.min(W, e.rect.x + e.rect.width) - Math.max(0, e.rect.x)) * Math.max(0, Math.min(H, e.rect.y + e.rect.height) - Math.max(0, e.rect.y));
      const af = a / (W * H);
      if (af > 0.6 && !heroIds.has(e.id)) continue; // a world / background plane
      if (e.kind === 'cursor') continue;
      const w = weightOf(e.kind, af, e.opacity);
      if (heroIds.has(e.id)) {
        hw += w;
        ha += af * Math.min(1, e.opacity);
      } else others.push(w);
    }
    const tot = hw + others.reduce((a, b) => a + b, 0);
    const next = Math.max(0, ...others);
    return { t: fr.t, share: tot > 0 ? hw / tot : 0, ratio: next > 0 ? hw / next : hw > 0 ? 9 : 0, area: ha, diff: fr.diff };
  });
  const phase = (sel: typeof pts): DominancePhase => {
    if (!sel.length) return { t: null, share: 0, ratio: 0, area: 0 };
    const m = (k: 'share' | 'ratio' | 'area') => sel.reduce((a, b) => a + b[k], 0) / sel.length;
    return { t: r2(sel[Math.floor(sel.length / 2)].t), share: r3(m('share')), ratio: r3(Math.min(9, m('ratio'))), area: r3(m('area')) };
  };
  const moving = pts.filter((p) => p.diff >= thr * 3);
  const firstMove = pts.findIndex((p) => p.diff >= thr * 3);
  const imp = pts.reduce((a, b, k) => (b.diff > pts[a].diff ? k : a), 0);
  const visible = pts.filter((p) => p.share > 0);
  const tailStill: typeof pts = [];
  for (let k = pts.length - 1; k >= 0 && pts[k].diff < thr * 3; k--) tailStill.unshift(pts[k]);
  const settle = tailStill.length ? tailStill : pts.slice(-Math.max(1, Math.round(pts.length * 0.2)));
  const anticipation = firstMove > 0 ? pts.slice(0, firstMove).filter((p) => p.share > 0) : [];
  const shares = visible.map((p) => p.share);
  return {
    hero,
    points: pts.map((p) => ({ t: r2(p.t), share: r3(p.share), ratio: r3(Math.min(9, p.ratio)) })),
    anticipation: phase(anticipation),
    movement: phase(moving.filter((p) => p.share > 0)),
    impact: phase(pts.slice(Math.max(0, imp - 1), imp + 2)),
    settle: phase(settle),
    min: r3(shares.length ? Math.min(...shares) : 0),
    mean: r3(shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0),
  };
}

// ───────────────────────────────────────────────────────────── attention corridor

export interface AttentionCorridor {
  /** the eye's position sample by sample: the moving mass while something moves, else the heaviest readable element. */
  points: { t: number; x: number; y: number; who: string }[];
  current: { x: number; y: number; who: string } | null;
  path: { dx: number; dy: number } | null;
  impact: { t: number; x: number; y: number; who: string } | null;
  next: { x: number; y: number; who: string } | null;
  /** largest jump of the eye between consecutive samples (frame diagonals). */
  maxJump: number;
  breaks: { t: number; what: string }[];
  score: number;
}

/** Current focus → motion path → impact point → next focus, from frames (predicted or rendered). */
export function attentionCorridor(frames: PreviewFrame[], W: number, H: number, opts: { first?: string; next?: { x: number; y: number; who: string } | null; still?: number } = {}): AttentionCorridor {
  const f = [...frames].sort((a, b) => a.t - b.t);
  const thr = opts.still ?? 0.0025;
  const D = Math.hypot(W, H);
  const pts: AttentionCorridor['points'] = [];
  let prevEls: Map<string, PreviewFrame['els'][number]> | null = null;
  for (const fr of f) {
    const els = fr.els.filter((e) => e.opacity > 0.3 && e.kind !== 'cursor' && (e.rect.width * e.rect.height) / (W * H) < 0.6);
    let pick: { x: number; y: number; who: string } | null = null;
    if (prevEls && fr.diff >= thr * 3) {
      // the eye follows what moves most (weighted by its size)
      let best = 0;
      for (const e of els) {
        const p = prevEls.get(e.id);
        if (!p) continue;
        const mv = Math.hypot(e.rect.x - p.rect.x, e.rect.y - p.rect.y) + Math.abs(e.rect.width - p.rect.width);
        const w = mv * Math.sqrt(Math.max(1, e.rect.width * e.rect.height));
        if (w > best && mv > 2) {
          best = w;
          pick = { x: (e.rect.x + e.rect.width / 2) / W, y: (e.rect.y + e.rect.height / 2) / H, who: e.id };
        }
      }
    }
    if (!pick) {
      // at rest: the heaviest readable element (the first read)
      const pref = opts.first ? els.find((e) => e.id === opts.first) : undefined;
      const heavy = pref ?? [...els].sort((a, b) => weightOf(b.kind, (b.rect.width * b.rect.height) / (W * H), b.opacity) * (readable(b.kind) ? 1.4 : 1) - weightOf(a.kind, (a.rect.width * a.rect.height) / (W * H), a.opacity) * (readable(a.kind) ? 1.4 : 1))[0];
      if (heavy) pick = { x: (heavy.rect.x + heavy.rect.width / 2) / W, y: (heavy.rect.y + heavy.rect.height / 2) / H, who: heavy.id };
    }
    if (pick) pts.push({ t: r2(fr.t), x: r3(pick.x), y: r3(pick.y), who: pick.who });
    prevEls = new Map(fr.els.map((e) => [e.id, e]));
  }
  const breaks: AttentionCorridor['breaks'] = [];
  let maxJump = 0;
  for (let k = 1; k < pts.length; k++) {
    const j = Math.hypot((pts[k].x - pts[k - 1].x) * W, (pts[k].y - pts[k - 1].y) * H) / D;
    maxJump = Math.max(maxJump, j);
  }
  const impK = f.length > 1 ? f.reduce((a, b, k) => (b.diff > f[a].diff ? k : a), 0) : -1;
  const impact = impK >= 0 ? pts.find((p) => Math.abs(p.t - r2(f[impK].t)) < 1e-6) ?? null : null;
  const moving = pts.filter((_, k) => f[k] && f[k].diff >= thr * 3);
  const path = moving.length >= 2 ? { dx: r3(moving[moving.length - 1].x - moving[0].x), dy: r3(moving[moving.length - 1].y - moving[0].y) } : null;
  const restPts = pts.slice(-3);
  const next = opts.next ?? (restPts.length ? restPts[restPts.length - 1] : null);
  // ATTENTION_BREAK: the motion leads the eye one way and the next thing to read appears far the other way
  if (path && impact && next) {
    const vx = path.dx * W;
    const vy = path.dy * H;
    const nx = (next.x - impact.x) * W;
    const ny = (next.y - impact.y) * H;
    const ln = Math.hypot(vx, vy);
    const dn = Math.hypot(nx, ny);
    if (ln > 0.04 * D && dn > 0.4 * D && (vx * nx + vy * ny) / (ln * dn) < -0.3) breaks.push({ t: impact.t, what: `the motion travels ${vx < 0 ? 'left' : 'right'}${Math.abs(vy) > Math.abs(vx) ? (vy < 0 ? '/up' : '/down') : ''} but the next read (${next.who}) appears ${Math.round((dn / D) * 100)}% of the frame away on the other side` });
  }
  if (maxJump > 0.55) breaks.push({ t: pts[0]?.t ?? 0, what: `the eye has to jump ${Math.round(maxJump * 100)}% of the frame diagonal between two moments` });
  const score = r2(clamp(10 - breaks.length * 3 - Math.max(0, maxJump - 0.35) * 8, 0, 10));
  return { points: pts, current: pts[0] ?? null, path, impact, next, maxJump: r3(maxJump), breaks, score };
}

// ───────────────────────────────────────────────────────────── spatial diagnosis

export interface SpatialConflict {
  code: SpatialCode;
  mover?: string;
  blocker?: string;
  t?: number;
  overlap?: number;
  what: string;
}
export interface SpatialDiagnosis {
  shot: string;
  codes: SpatialCode[];
  conflicts: SpatialConflict[];
  /** the failure is spatial / layout-related (a re-layout may save the motion). */
  spatial: boolean;
  /** the failure is the motion itself (no re-layout: it would be re-laying out for nothing). */
  motionFailure: boolean;
  why: string;
}

/** Elements visible at t (sampled), by id. */
function visibleAt(samples: ReturnType<typeof sampleShot>, t: number) {
  let best = samples[0];
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best?.els.filter((e) => e.o > 0.35) ?? [];
}

/**
 * Why does shot i fail its action, in spatial terms? `failure` is what the tournament saw (the veto, the
 * mid-motion failures, the score against the kept version); `heroId` the shot's hero.
 */
export function spatialDiagnosis(script: ScriptObj, plan: StagePlan, i: number, o: { failure?: { veto?: string | null; midMotion?: string[]; scoreGap?: number }; envs?: MotionEnvelope[]; reserved?: ReservedSpace[]; dominance?: HeroDominanceTimeline; attention?: AttentionCorridor } = {}): SpatialDiagnosis {
  const sh = script.shots[i] as ShotObj;
  const envs = o.envs ?? motionEnvelopes(plan, i);
  const res = o.reserved ?? reservedMotionSpace(script, plan, i, envs);
  const samples = sampleShot(plan, i, 0.05);
  const conflicts: SpatialConflict[] = [];
  const add = (c: SpatialConflict) => {
    if (!conflicts.some((x) => x.code === c.code && x.mover === c.mover && x.blocker === c.blocker)) conflicts.push(c);
  };
  const hero = (sh.cast ?? []).find((c) => c.role === 'hero')?.id;
  // reserved spaces crossed by something else that is on screen at the same time
  for (const r of res) {
    for (const { t, r: rr } of r.rects) {
      for (const e of visibleAt(samples, t)) {
        if (e.id === r.element || e.id === r.target) continue;
        // the mover's parent / children and a world plane are not blockers
        if (rectArea(e.r) > 0.6) continue;
        const ov = interArea(rr, e.r) / Math.max(1e-6, Math.min(rectArea(rr), rectArea(e.r)));
        if (ov < 0.12) continue;
        const k = kindOf(script, e.id);
        const code: SpatialCode = r.kind === 'expansion-area' ? 'NO_EXPANSION_SPACE' : r.kind === 'impact-zone' ? 'NO_IMPACT_SPACE' : r.kind === 'transformation-corridor' && /button|cta/.test(r.target ?? '') ? 'CTA_NO_TRANSFORM_SPACE' : isLogo(script, e.id) ? 'LOGO_IN_ACTION_PATH' : k === 'text' || (readable(kindOf(script, r.element)) && readable(k)) ? 'TEXT_BLOCKS_ACTION' : 'MOTION_PATH_BLOCKED';
        add({ code, mover: r.element, blocker: e.id, t, overlap: r3(ov), what: `${e.id} stands in the ${r.kind} of ${r.element} at ${t.toFixed(2)}s (${Math.round(ov * 100)}%)` });
      }
    }
  }
  // the failure the preview / prediction saw, read spatially
  const veto = o.failure?.veto ?? '';
  const mm = o.failure?.midMotion ?? [];
  if (/TEXT_CLASH|covers|text over text/.test(veto) || mm.some((x) => /covers|text over text/.test(x))) {
    const pair = (veto.match(/\(([^)]+)\)/)?.[1] ?? mm.map((x) => x.match(/\(([^)]+)\)/)?.[1] ?? x.match(/^(\S+) covers (\S+)/)?.slice(1).join(' × ')).find(Boolean) ?? '').split(' × ').map((x) => x.trim().replace(/[#:].*$/, ''));
    const movers = new Set(res.map((r) => r.element));
    const [a, b] = pair;
    const mover = movers.has(a) ? a : movers.has(b) ? b : envs.filter((e) => e.moving).sort((p, q) => q.travel - p.travel)[0]?.element;
    const blocker = mover === a ? b : a;
    if (blocker) add({ code: kindOf(script, blocker) === 'text' || kindOf(script, mover ?? '') === 'chip' ? 'TEXT_BLOCKS_ACTION' : 'MOTION_PATH_BLOCKED', mover, blocker, what: `the measured failure is a collision of ${mover} with ${blocker} (${veto || mm[0]})` });
  }
  if (/OFF_CANVAS/.test(veto)) add({ code: 'MOTION_PATH_BLOCKED', what: `the action pushes text out of the frame (${veto})` });
  if (/FLOODS/.test(veto)) add({ code: 'NO_EXPANSION_SPACE', what: `an element blows up over the frame (${veto})` });
  // hero dominance / hierarchy
  const tEnd = samples[samples.length - 1]?.t ?? 0;
  const settle = ([...samples].reverse().find((x) => x.t <= tEnd - 0.34) ?? samples[samples.length - 1])?.els ?? [];
  const weights = settle.filter((e) => rectArea(e.r) < 0.6 && e.kind !== 'cursor').map((e) => ({ id: e.id, w: weightOf(e.kind, rectArea(e.r), e.o), a: rectArea(e.r), kind: e.kind }));
  const hw = weights.find((x) => x.id === hero);
  if (hero && hw) {
    const others = weights.filter((x) => x.id !== hero && !x.id.startsWith(`${hero}.`));
    const top = others.sort((a, b) => b.w - a.w)[0];
    const sameKind = others.filter((x) => x.kind === hw.kind && Math.abs(x.a - hw.a) / Math.max(hw.a, 1e-6) < 0.2);
    if ((top && top.w >= hw.w * 0.95) || sameKind.length >= 2) add({ code: 'SUPPORTING_ELEMENTS_DOMINATE', blocker: top?.id, what: sameKind.length >= 2 ? `${sameKind.length + 1} ${hw.kind}s of equal size: the hero ${hero} is one of a row` : `${top!.id} weighs as much as the hero ${hero}` });
    const acted = evsOf(script, i).some((e) => (e.element === hero || e.to === hero) && ['impact', 'push', 'attract', 'transform', 'count', 'become', 'respond'].includes(e.action));
    if (acted && hw.a < 0.07) add({ code: 'HERO_TOO_SMALL_FOR_ACTION', blocker: hero, what: `the action is on ${hero} but it covers ${Math.round(hw.a * 100)}% of the frame` });
  }
  if (o.dominance && o.dominance.movement.share > 0 && o.dominance.movement.share < 0.25 && hero) add({ code: 'SUPPORTING_ELEMENTS_DOMINATE', what: `during the movement the hero carries ${Math.round(o.dominance.movement.share * 100)}% of the visual weight` });
  // density / negative space at rest
  const fg = settle.filter((e) => rectArea(e.r) < 0.6 && e.kind !== 'cursor');
  const occ = unionCover(fg.map((e) => e.r));
  if (occ > 0.62 || (plan.H > plan.W && fg.filter((e) => readable(e.kind)).length >= 5)) add({ code: 'LAYOUT_TOO_DENSE', what: `${Math.round(occ * 100)}% of the frame is covered at rest (${fg.length} elements)` });
  else if (occ > 0.5 && res.length) add({ code: 'NO_NEGATIVE_SPACE', what: `${Math.round(occ * 100)}% covered: no empty space for the motion to move into` });
  // RTL: the first read must not be preceded on its line by a supporting text-bearing element
  if (plan.rtl) {
    const head = settle.find((e) => e.id === hero && e.kind === 'text') ?? settle.find((e) => e.kind === 'text');
    if (head) {
      const before = settle.find((e) => e.id !== head.id && ['chip', 'card'].includes(e.kind) && e.r.x > head.r.x + head.r.w * 0.6 && Math.abs(centre(e.r).y - centre(head.r).y) < head.r.h * 0.5);
      if (before) add({ code: 'RTL_FLOW_CONFLICT', blocker: before.id, what: `${before.id} sits on the reading-start side of the headline: it is read before it` });
    }
  }
  if (o.attention?.breaks.length) add({ code: 'ATTENTION_BREAK', what: o.attention.breaks[0].what });
  const codes = [...new Set(conflicts.map((c) => c.code))];
  const spatial = codes.length > 0;
  // a motion failure: the candidate lost on its motion numbers with no spatial cause
  const motionFailure = !spatial && (o.failure?.scoreGap ?? 0) < 0;
  return { shot: sh.id, codes, conflicts, spatial, motionFailure, why: spatial ? conflicts.slice(0, 3).map((c) => c.what).join('; ') : motionFailure ? 'the motion itself loses (no spatial conflict, its numbers are lower): re-laying it out would not help' : 'no spatial conflict' };
}

/** Frame fraction covered by the union of rects (grid sampled). */
export function unionCover(rs: FRect[], n = 60): number {
  if (!rs.length) return 0;
  let hit = 0;
  for (let a = 0; a < n; a++)
    for (let b = 0; b < n; b++) {
      const x = (a + 0.5) / n;
      const y = (b + 0.5) / n;
      if (rs.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) hit++;
    }
  return hit / (n * n);
}

// ───────────────────────────────────────────────────────────── motion + composition, one score

export interface MotionCompositionFit {
  score: number;
  parts: { motionSpace: number; heroVisibility: number; textSafety: number; attentionFlow: number; collisionRisk: number; impactClarity: number; settleReadability: number; handoff: number; hierarchy: number; negativeSpace: number };
}

/** Composition and choreography judged together (0..10, heuristic weights reported as such). */
export function motionCompositionFit(x: { reserved: ReservedSpace[]; diagnosis: SpatialDiagnosis; dominance: HeroDominanceTimeline; attention: AttentionCorridor; clashFrames?: number; midMotion?: number; settleCover?: number; minTextScale?: number; handoffJump?: number }): MotionCompositionFit {
  const c = (code: SpatialCode) => x.diagnosis.conflicts.filter((k) => k.code === code).length;
  const blocked = c('MOTION_PATH_BLOCKED') + c('TEXT_BLOCKS_ACTION') + c('LOGO_IN_ACTION_PATH');
  const parts = {
    motionSpace: x.reserved.length ? clamp(1 - blocked / Math.max(1, x.reserved.length), 0, 1) : 1,
    heroVisibility: clamp(Math.min(x.dominance.movement.share || x.dominance.mean, x.dominance.impact.share || x.dominance.mean) / 0.45, 0, 1),
    textSafety: clamp(1 - 0.25 * (x.clashFrames ?? 0) - 0.2 * (x.midMotion ?? 0) - 0.5 * c('TEXT_BLOCKS_ACTION'), 0, 1),
    attentionFlow: x.attention.score / 10,
    collisionRisk: clamp(1 - 0.34 * blocked, 0, 1),
    impactClarity: clamp(1 - 0.5 * c('NO_IMPACT_SPACE') - 0.5 * c('NO_EXPANSION_SPACE'), 0, 1) * clamp((x.dominance.impact.share || x.dominance.mean) / 0.4, 0, 1),
    settleReadability: clamp((x.minTextScale ?? 1) >= 0.92 ? 1 - Math.max(0, (x.settleCover ?? 0.4) - 0.6) * 2 : 0.3, 0, 1),
    handoff: clamp(1 - Math.max(0, (x.handoffJump ?? 0.3) - 0.3) * 1.5, 0, 1),
    hierarchy: clamp(Math.min(x.dominance.settle.ratio, 3) / 2, 0, 1) * (c('SUPPORTING_ELEMENTS_DOMINATE') ? 0.6 : 1),
    negativeSpace: (() => {
      const cv = x.settleCover ?? 0.4;
      return clamp(cv < 0.15 ? cv / 0.15 : cv > 0.55 ? 1 - (cv - 0.55) * 3 : 1, 0, 1);
    })(),
  };
  const W = { motionSpace: 1.4, heroVisibility: 1.1, textSafety: 1.4, attentionFlow: 0.9, collisionRisk: 1.0, impactClarity: 1.0, settleReadability: 1.0, handoff: 0.6, hierarchy: 1.0, negativeSpace: 0.6 };
  let s = 0;
  let tw = 0;
  for (const [k, w] of Object.entries(W)) {
    s += (parts as Record<string, number>)[k] * w;
    tw += w;
  }
  return { score: r2((s / tw) * 10), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r3(v)])) as MotionCompositionFit['parts'] };
}

// ───────────────────────────────────────────────────────────── layout strategies

export const LAYOUT_STRATEGIES = ['hero-left/text-right', 'hero-right/text-left', 'hero-center/text-safe-zone', 'top-copy/bottom-action', 'bottom-copy/upper-action', 'diagonal-action', 'asymmetric-focus', 'split-action', 'corridor-layout', 'impact-zone', 'expansion-zone', 'progressive-stack', 'focus-stage', 'full-frame-hero', 'negative-space-for-motion'] as const;
export type LayoutStrategy = (typeof LAYOUT_STRATEGIES)[number];

/** What the action of the shot needs from the frame (read from its chain and reserved spaces). */
export interface ActionNeeds {
  shot: string;
  hero: string | null;
  /** elements that travel (enter from a distance, collide, are pulled, drop …). */
  movers: string[];
  /** elements the movers are aimed at. */
  targets: string[];
  /** readable text not acting: the copy block. */
  copy: string[];
  /** a logo that must stay visible and out of the action. */
  brand: string[];
  /** the remaining cast (cards, numbers, decor) not travelling. */
  rest: string[];
  /** same-kind supporting items next to the hero (features: hero + supporting). */
  peers: string[];
  corridor: 'vertical' | 'horizontal' | 'diagonal' | 'radial' | 'none';
  impact: boolean;
  expansion: boolean;
  transform: boolean;
  vertical: boolean;
  rtl: boolean;
  why: string[];
}

export function actionNeeds(script: ScriptObj, plan: StagePlan, i: number, reserved: ReservedSpace[] = reservedMotionSpace(script, plan, i)): ActionNeeds {
  const sh = script.shots[i] as ShotObj;
  const cast = (sh.cast ?? []).filter((c) => !declOf(script, c.id)?.parent && kindOf(script, c.id) !== 'cursor' && !c.behind);
  const chain = evsOf(script, i);
  const hero = cast.find((c) => c.role === 'hero')?.id ?? null;
  // a text that only reveals itself (its entrance travels a little) is copy, not an actor of the motion
  const actor = (r: ReservedSpace) => kindOf(script, r.element) !== 'text' || ['collision-path', 'gather-path', 'transformation-corridor'].includes(r.kind);
  const movers = [...new Set(reserved.filter((r) => ['corridor', 'entry-lane', 'collision-path', 'gather-path', 'transformation-corridor'].includes(r.kind) && actor(r)).map((r) => r.element))].filter((id) => cast.some((c) => c.id === id));
  const targets = [...new Set(chain.filter((e) => ['push', 'attract', 'become'].includes(e.action) && e.to).map((e) => e.to!))].filter((id) => cast.some((c) => c.id === id));
  const brand = cast.filter((c) => isLogo(script, c.id)).map((c) => c.id);
  const copy = cast.filter((c) => kindOf(script, c.id) === 'text' && !movers.includes(c.id) && !brand.includes(c.id)).map((c) => c.id);
  const hk = hero ? kindOf(script, hero) : '';
  const peers = hero ? cast.filter((c) => c.id !== hero && kindOf(script, c.id) === hk && hk !== 'text').map((c) => c.id) : [];
  const rest = cast.map((c) => c.id).filter((id) => !movers.includes(id) && !targets.includes(id) && !copy.includes(id) && !brand.includes(id) && id !== hero && !peers.includes(id));
  const kinds = new Set(reserved.map((r) => r.kind));
  // corridor direction from the movers' paths
  let dx = 0;
  let dy = 0;
  for (const r of reserved.filter((x) => x.rects.length > 1)) {
    const a = centre(r.rects[0].r);
    const b = centre(r.rects[r.rects.length - 1].r);
    dx += Math.abs(b.x - a.x);
    dy += Math.abs(b.y - a.y);
  }
  const corridor = kinds.has('gather-path') && movers.length >= 2 ? 'radial' : dx + dy < 0.02 ? 'none' : dy > dx * 1.6 ? 'vertical' : dx > dy * 1.6 ? 'horizontal' : 'diagonal';
  const why: string[] = [];
  if (kinds.has('corridor')) why.push('items drop in: they need free corridors above where they land');
  if (kinds.has('entry-lane')) why.push('items enter along lanes: the lanes must be empty');
  if (kinds.has('collision-path')) why.push('a collision: a clear path to the target and a clear impact zone');
  if (kinds.has('gather-path')) why.push('a gathering: clear paths from the pieces to the hero');
  if (kinds.has('expansion-area')) why.push('the hero expands: it needs room to grow');
  if (kinds.has('transformation-corridor')) why.push('a transformation: the corridor to the result must be clear');
  if (peers.length >= 2) why.push(`${peers.length + 1} ${hk}s of the same size: the hero must stand out from its peers`);
  return { shot: sh.id, hero, movers, targets, copy, brand, rest, peers, corridor, impact: kinds.has('collision-path') || kinds.has('gather-path') || chain.some((e) => e.action === 'impact'), expansion: kinds.has('expansion-area'), transform: kinds.has('transformation-corridor'), vertical: plan.H > plan.W, rtl: plan.rtl, why };
}

/** Why a strategy suits this action (null = it does not). The order of the list is the preference. */
export function strategyFit(s: LayoutStrategy, n: ActionNeeds): string | null {
  const start = n.rtl ? 'right' : 'left';
  const end = n.rtl ? 'left' : 'right';
  const hasMovers = n.movers.length > 0;
  const textHeroTarget = n.hero && n.targets.includes(n.hero) && n.copy.includes(n.hero);
  switch (s) {
    case 'hero-left/text-right':
      return !n.vertical && (n.copy.length || textHeroTarget) && n.rtl ? `RTL: the copy owns the reading-start (right) column; the ${hasMovers ? 'action lane runs in the open left half' : 'hero takes the left half'}` : null;
    case 'hero-right/text-left':
      return !n.vertical && (n.copy.length || textHeroTarget) && !n.rtl ? 'LTR: the copy owns the reading-start (left) column; the action takes the right half' : null;
    case 'hero-center/text-safe-zone':
      return n.expansion || n.impact ? 'the hero stays in the centre where it can grow / be hit; the copy sits in a safe band away from the motion' : null;
    case 'top-copy/bottom-action':
      return (n.corridor === 'horizontal' || n.corridor === 'diagonal' || n.corridor === 'radial' || n.vertical) && (n.copy.length || textHeroTarget) ? `the copy is read first at the top; the ${n.corridor} action plays in the lower band without crossing it` : null;
    case 'bottom-copy/upper-action':
      return n.corridor === 'vertical' || (n.vertical && hasMovers) ? 'things fall / rise in the upper band; the copy waits at the bottom, outside the corridors' : null;
    case 'diagonal-action':
      return hasMovers && !n.vertical && (n.corridor === 'diagonal' || n.corridor === 'vertical') ? `the movers travel corner to corner toward the impact; the copy holds the opposite (reading-${start}) corner` : null;
    case 'asymmetric-focus':
      return n.peers.length >= 1 ? `one hero takes the reading-start ${n.vertical ? 'top' : 'two thirds'}; the ${n.peers.length} supporting item(s) step back in a narrow column (${end})` : null;
    case 'split-action':
      return hasMovers && n.targets.length && !n.vertical ? 'the frame splits: the action on one side, the copy on the other, the impact on the seam' : null;
    case 'corridor-layout':
      return hasMovers ? `an explicit ${n.corridor === 'vertical' ? 'vertical corridor' : 'lane'} is kept empty from the frame edge to the impact point` : null;
    case 'impact-zone':
      return n.impact ? 'a clear zone is kept around the contact point so the impact reads' : null;
    case 'expansion-zone':
      return n.expansion ? 'the hero is given the room it grows into; nothing sits in it' : null;
    case 'progressive-stack':
      return n.peers.length >= 2 || (n.vertical && n.peers.length >= 1) ? `the ${n.peers.length} supporting items stack in one column beside / under the hero (fewer things side by side)` : null;
    case 'focus-stage':
      return n.hero && !hasMovers ? 'the hero is staged alone, large, with the supporting elements small and quiet below' : n.hero && n.corridor === 'radial' ? 'the hero sits centre stage; the pieces converge on it from the open space around' : null;
    case 'full-frame-hero':
      return n.hero && n.expansion && !n.copy.filter((c) => c !== n.hero).length ? 'the hero owns most of the frame (nothing else competes)' : null;
    case 'negative-space-for-motion':
      return hasMovers ? 'the composition leaves the empty side where the movers come from' : null;
  }
  return null;
}

/** The frame zones a strategy gives (frame fractions, top-left rects): copy, action, lane origin. */
interface Zones {
  copy: FRect;
  action: FRect;
  /** supporting column for peers (when the strategy has one). */
  side?: FRect;
}

/**
 * Zones of strategy `s` for these needs. `need` is the copy block at its current size (frame fractions): bands
 * and columns are sized to hold it, the action takes what is left — a strategy whose action space would be
 * too small for the action returns null.
 */
function zonesFor(s: LayoutStrategy, n: ActionNeeds, safe: FRect, need: { w: number; h: number }): Zones | null {
  const { x: sx, y: sy, w: sw, h: sh } = safe;
  const rtl = n.rtl;
  const gap = 0.03;
  const startCol = (w: number): FRect => (rtl ? { x: sx + sw - w, y: sy, w, h: sh } : { x: sx, y: sy, w, h: sh });
  const endCol = (w: number): FRect => (rtl ? { x: sx, y: sy, w, h: sh } : { x: sx + sw - w, y: sy, w, h: sh });
  const top = (h: number): FRect => ({ x: sx, y: sy, w: sw, h });
  const bottom = (h: number): FRect => ({ x: sx, y: sy + sh - h, w: sw, h });
  const minAction = n.movers.length || n.expansion ? 0.3 : 0.24;
  const band = (frac: number) => Math.max(sh * frac, need.h + 0.02);
  const col = (frac: number) => Math.max(sw * frac, Math.min(need.w + 0.01, sw * 0.62));
  const ok = (z: Zones) => (z.action.w >= minAction * (n.vertical ? 0.8 : 1) && z.action.h >= minAction * 0.8 ? z : null);
  switch (s) {
    case 'hero-left/text-right':
    case 'hero-right/text-left':
    case 'split-action': {
      if (n.vertical) {
        const h = band(0.36);
        return ok({ copy: top(h), action: { ...bottom(sh - h - gap) } });
      }
      const w = col(0.44);
      return ok({ copy: startCol(w), action: endCol(sw - w - gap) });
    }
    case 'top-copy/bottom-action': {
      const h = band(n.vertical ? 0.32 : 0.34);
      return ok({ copy: top(h), action: bottom(sh - h - gap) });
    }
    case 'bottom-copy/upper-action': {
      const h = band(n.vertical ? 0.3 : 0.34);
      return ok({ copy: bottom(h), action: top(sh - h - gap) });
    }
    case 'diagonal-action': {
      const w = col(0.5);
      const h = band(0.5);
      const copy = { ...startCol(w), y: sy + sh - h, h };
      // the action owns the opposite corner and the band above the copy
      return ok({ copy, action: { ...endCol(sw - w * 0.35), h: sh - h * 0.35 } });
    }
    case 'hero-center/text-safe-zone':
    case 'impact-zone':
    case 'expansion-zone':
    case 'focus-stage': {
      const h = band(n.vertical ? 0.26 : 0.28);
      return ok({ copy: bottom(h), action: n.vertical ? top(sh - h - gap) : { x: sx + sw * 0.1, y: sy, w: sw * 0.8, h: sh - h - gap } });
    }
    case 'full-frame-hero': {
      const h = band(0.2);
      return ok({ copy: bottom(h), action: top(sh - h - gap) });
    }
    case 'asymmetric-focus': {
      if (n.vertical) {
        const h = band(0.16);
        return ok({ copy: top(h), action: { x: sx, y: sy + h + gap, w: sw, h: (sh - h) * 0.6 }, side: bottom((sh - h) * 0.4 - gap * 2) });
      }
      const w = sw * 0.6;
      const h = need.h ? band(0.16) : 0;
      return ok({ copy: { ...startCol(w), h: Math.max(h, 0.001) }, action: { ...startCol(w), y: sy + h + (h ? gap : 0), h: sh - h - (h ? gap : 0) }, side: endCol(sw - w - gap) });
    }
    case 'progressive-stack': {
      if (n.vertical) {
        const h = band(0.14);
        return ok({ copy: top(h), action: { x: sx, y: sy + h + gap, w: sw, h: (sh - h) * 0.52 }, side: bottom((sh - h) * 0.48 - gap * 2) });
      }
      const w = sw * 0.54;
      const h = need.h ? band(0.18) : 0;
      return ok({ copy: { ...startCol(w), h: Math.max(h, 0.001) }, action: { ...startCol(w), y: sy + h + (h ? gap : 0), h: sh - h - (h ? gap : 0) }, side: endCol(sw - w - gap) });
    }
    case 'corridor-layout':
    case 'negative-space-for-motion': {
      // the copy keeps its place and size; the action lives in the largest empty band around it
      return null;
    }
  }
  return null;
}

export interface LayoutPlan {
  /** cast edits: id → { at, w, enterFrom } (absent keys unchanged). */
  cast: Record<string, { at?: { x: number; y: number }; w?: number; enterFrom?: { x: number; y: number } | null }>;
  /** stage-level text box aspect changes (only for text used in this shot alone). */
  aspect: Record<string, number>;
  notes: string[];
}

export interface LayoutCandidate {
  id: string;
  strategy: LayoutStrategy;
  label: string;
  /** Why this strategy suits THIS action (not its name). */
  why: string;
  script: ScriptObj;
  layout: LayoutPlan;
}

/** Rest boxes (centre + size, frame fractions) of the cast of shot i, read from the compiled plan. */
export function restBoxes(plan: StagePlan, i: number): Record<string, { x: number; y: number; w: number; h: number }> {
  const sh = plan.shots[i];
  const t = Math.max(sh.start, sh.end - 0.45);
  const s = sampleStage(plan, t);
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const el of plan.elements) {
    if (el.parent || !sh.cast.some((x) => x.id === el.id)) continue;
    const e = s.sampled.find((x) => x.id === el.id);
    out[el.id] = e ? { x: (e.rect.x + e.rect.width / 2) / plan.W, y: (e.rect.y + e.rect.height / 2) / plan.H, w: el.box.w, h: el.box.h } : { x: 0.5, y: 0.5, w: el.box.w, h: el.box.h };
  }
  return out;
}

/** The text box sizes this layout must keep: font (u) of each text of the shot in the current plan. */
export function textFonts(plan: StagePlan, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const f = plan.elements.find((e) => e.id === id)?.content.fontU;
    if (f) out[id] = f;
  }
  return out;
}

/**
 * Place a text block of `chars` into a zone keeping (at least) its font: returns w and the box aspect that
 * holds it in up to 3 lines inside the zone, or null when the zone cannot hold the text at its size.
 */
export function fitText(chars: number, fontU: number, zone: FRect, W: number, H: number, maxHFrac = 1): { w: number; aspect: number; fontU: number; lines: number } | null {
  const u = Math.min(W, H) / 100;
  let best: { w: number; aspect: number; fontU: number; lines: number } | null = null;
  for (let lines = 1; lines <= 3; lines++) {
    // the width the text needs at this size in this many lines (≈0.5 em per char), plus 4% air
    const wPx = ((chars * 0.5 * fontU * u) / lines) * 1.04;
    const hPx = lines * 1.28 * fontU * u * 1.04;
    const w = wPx / W;
    const h = hPx / H;
    if (w > zone.w || h > zone.h * maxHFrac) continue;
    const f = fontForBox(chars, wPx, hPx, u);
    if (f.fontU < fontU * 0.97) continue;
    const cand = { w: r3(w), aspect: r3(wPx / hPx), fontU: f.fontU, lines };
    if (!best || lines < best.lines) best = cand;
  }
  return best;
}

/** Frame share a staged hero takes per strategy (frame fractions of area). */
const HERO_AREA: Partial<Record<LayoutStrategy, number>> = { 'hero-left/text-right': 0.07, 'hero-right/text-left': 0.07, 'focus-stage': 0.16, 'full-frame-hero': 0.3, 'asymmetric-focus': 0.14, 'progressive-stack': 0.12, 'expansion-zone': 0.12, 'impact-zone': 0.1, 'hero-center/text-safe-zone': 0.12 };

const fitIn = (z: FRect, w: number, h: number, ax: number, ay: number) => ({ x: r3(clamp(z.x + z.w * ax, z.x + w / 2, z.x + z.w - w / 2)), y: r3(clamp(z.y + z.h * ay, z.y + h / 2, z.y + z.h - h / 2)) });
const rectAt = (c: { x: number; y: number }, w: number, h: number): FRect => ({ x: c.x - w / 2, y: c.y - h / 2, w, h });
/** Distance between two rects (0 when they touch / overlap). */
const rectGap = (a: FRect, b: FRect) => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));

/** The frame-edge point a lane through `from` → `to` starts at (extended back past `from`). */
function laneOrigin(from: { x: number; y: number }, to: { x: number; y: number }, len: number): { x: number; y: number } {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: r3(clamp(from.x + (dx / l) * len, 0.03, 0.97)), y: r3(clamp(from.y + (dy / l) * len, 0.03, 0.97)) };
}

/**
 * One re-layout of shot i for the action of `script` (the motion candidate), with strategy `s`. The text keeps
 * its font; every cast element stays; the logo moves only out of an action path.
 */
export function planLayout(script: ScriptObj, plan: StagePlan, i: number, s: LayoutStrategy, needs: ActionNeeds, o: { safe?: FRect } = {}): LayoutPlan | null {
  const W = plan.W;
  const H = plan.H;
  const safe = o.safe ?? (needs.vertical ? { x: 0.07, y: 0.07, w: 0.86, h: 0.86 } : { x: 0.06, y: 0.08, w: 0.88, h: 0.84 });
  const rest = restBoxes(plan, i);
  const fonts = textFonts(plan, needs.copy);
  const lay: LayoutPlan = { cast: {}, aspect: {}, notes: [] };
  const sizeOf = (id: string) => rest[id] ?? { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };
  const usedOnlyHere = (id: string) => (plan.elements.find((e) => e.id === id)?.shots ?? []).length <= 1;
  const gap = 0.025;
  const copy = needs.copy.filter((id) => fonts[id] && (declOf(script, id)?.text ?? '').length);
  const need = { w: Math.max(0, ...copy.map((id) => sizeOf(id).w)), h: copy.reduce((a, id) => a + sizeOf(id).h, 0) + gap * Math.max(0, copy.length - 1) };
  const z = zonesFor(s, needs, safe, need);
  if (!z) return null;
  // 1 — the copy block: stacked in the copy zone, reading-start aligned, at (at least) its font
  const copyRects: FRect[] = [];
  const fitted: { id: string; w: number; h: number; aspect?: number }[] = [];
  for (const id of copy) {
    const chars = (declOf(script, id)?.text ?? '').length;
    const cur = sizeOf(id);
    let w = cur.w;
    let h = cur.h;
    let aspect: number | undefined;
    if (w > z.copy.w + 1e-3 || h > z.copy.h + 1e-3) {
      if (!usedOnlyHere(id)) return null; // a text shared with other shots keeps its box
      const ft = fitText(chars, fonts[id], z.copy, W, H);
      if (!ft) return null; // the zone would shrink the text: not this strategy
      w = ft.w;
      aspect = ft.aspect;
      h = (w * W) / aspect / H;
    }
    fitted.push({ id, w, h, aspect });
  }
  const totalH = fitted.reduce((a, t) => a + t.h, 0) + gap * Math.max(0, fitted.length - 1);
  if (totalH > z.copy.h + 0.02) return null;
  // the hand-off: the copy must not sit where the next shot's first read enters (it would cross it on the way out)
  const nextRects: FRect[] = [];
  const nxt = plan.shots[i + 1];
  if (nxt) {
    const castIds = new Set(((script.shots[i] as ShotObj).cast ?? []).map((c) => c.id));
    const sN = sampleStage(plan, Math.min(nxt.end - 1e-3, nxt.start + 0.4));
    for (const e of sN.sampled) if (readable(e.kind) && !castIds.has(e.id) && e.opacity > 0.2) nextRects.push({ x: e.rect.x / W, y: e.rect.y / H, w: e.rect.width / W, h: e.rect.height / H });
  }
  const slack = Math.max(0, z.copy.h - totalH);
  const blockAt = (y0: number) => {
    let y = y0;
    return fitted.map((t) => {
      const x = needs.rtl ? z.copy.x + z.copy.w - t.w / 2 : z.copy.x + t.w / 2;
      const r = rectAt({ x, y: y + t.h / 2 }, t.w, t.h);
      y += t.h + gap;
      return r;
    });
  };
  const hits = (y0: number) => blockAt(y0).reduce((a, r) => a + nextRects.reduce((b, q) => b + interArea(r, q), 0), 0);
  const options = [z.copy.y + slack / 2, z.copy.y, z.copy.y + slack];
  const y0 = nextRects.length ? options.reduce((a, b) => (hits(b) < hits(a) - 1e-4 ? b : a)) : options[0];
  if (y0 !== options[0]) lay.notes.push('the copy block shifts away from where the next shot enters');
  let yCursor = y0;
  for (const t of fitted) {
    // RTL: right-aligned in the zone (the line starts on the right); LTR: left-aligned
    const x = needs.rtl ? z.copy.x + z.copy.w - t.w / 2 : z.copy.x + t.w / 2;
    const c = { x: r3(x), y: r3(yCursor + t.h / 2) };
    // a text keeps its own box (and so its font) unless it was re-aspected to fit the zone
    lay.cast[t.id] = t.aspect ? { at: c, w: r3(t.w) } : { at: c };
    if (t.aspect) lay.aspect[t.id] = t.aspect;
    copyRects.push(rectAt(c, t.w, t.h));
    yCursor += t.h + gap;
  }
  const textHeroTarget = needs.hero && needs.copy.includes(needs.hero);
  // 2 — the hero (when it is not the copy): in the action zone, larger when the strategy stages it
  const heroBoost: Partial<Record<LayoutStrategy, number>> = { 'focus-stage': 1.35, 'full-frame-hero': 1.8, 'asymmetric-focus': 1.45, 'progressive-stack': 1.35, 'expansion-zone': 1.1, 'impact-zone': 1.1, 'hero-center/text-safe-zone': 1.15 };
  let heroRect: FRect | null = null;
  if (needs.hero && !textHeroTarget && rest[needs.hero]) {
    const b = sizeOf(needs.hero);
    const k = heroBoost[s] ?? 1;
    const asp = (b.w * W) / (b.h * H);
    const room = needs.expansion || needs.corridor === 'radial' ? 0.8 : 0.96;
    // the staged hero gets a share of the frame (not a multiple of a size authored for another aspect)
    const area = Math.max(b.w * b.h * k * k, HERO_AREA[s] ?? 0);
    let w = Math.min(Math.sqrt((area * asp * H) / W), z.action.w * room);
    let h = (w * W) / asp / H;
    if (h > z.action.h * room) {
      h = z.action.h * room;
      w = (h * H * asp) / W;
    }
    // a layout never makes the hero smaller than it was: that strategy has no room for it here
    if (w < b.w * 0.98) return null;
    const ax = needs.movers.length && needs.corridor !== 'radial' ? (needs.rtl ? 0.62 : 0.38) : 0.5;
    const c = fitIn(z.action, w, h, ax, 0.5);
    lay.cast[needs.hero] = { at: c, w: r3(w) };
    heroRect = rectAt(c, w, h);
  } else if (textHeroTarget) heroRect = copyRects[copy.indexOf(needs.hero!)] ?? null;
  // 3 — peers (hero + supporting): one supporting column / row, smaller than the hero
  const placed: FRect[] = [...copyRects, ...(heroRect ? [heroRect] : [])];
  if (needs.peers.length && heroRect) {
    const zoneP = z.side ?? (needs.vertical ? { x: safe.x, y: heroRect.y + heroRect.h + 0.03, w: safe.w, h: Math.max(0.12, safe.y + safe.h - (heroRect.y + heroRect.h + 0.03)) } : needs.rtl ? { x: safe.x, y: safe.y, w: Math.max(0.12, heroRect.x - safe.x - 0.03), h: safe.h } : { x: heroRect.x + heroRect.w + 0.03, y: safe.y, w: Math.max(0.12, safe.x + safe.w - heroRect.x - heroRect.w - 0.03), h: safe.h });
    const n = needs.peers.length;
    const stackV = !needs.vertical || s === 'progressive-stack';
    needs.peers.forEach((id, k) => {
      const b = sizeOf(id);
      const asp = (b.w * W) / (b.h * H);
      let w = Math.min(b.w, heroRect!.w * 0.62, stackV ? zoneP.w * 0.96 : (zoneP.w - 0.03 * (n - 1)) / n);
      let h = (w * W) / asp / H;
      const slotH = stackV ? (zoneP.h - 0.03 * (n - 1)) / n : zoneP.h;
      if (h > slotH * 0.96) {
        h = slotH * 0.96;
        w = (h * H * asp) / W;
      }
      const c = stackV ? { x: r3(zoneP.x + zoneP.w / 2), y: r3(zoneP.y + slotH * (k + 0.5) + 0.03 * k) } : { x: r3(needs.rtl ? zoneP.x + zoneP.w - (k + 0.5) * (zoneP.w / n) : zoneP.x + (k + 0.5) * (zoneP.w / n)), y: r3(zoneP.y + zoneP.h / 2) };
      lay.cast[id] = { at: c, w: r3(w) };
      placed.push(rectAt(c, w, h));
    });
  }
  // 4 — targets that are not the hero / copy: at the action zone's impact point
  for (const id of needs.targets) {
    if (lay.cast[id] || id === needs.hero || needs.copy.includes(id)) continue;
    const b = sizeOf(id);
    const c = fitIn(z.action, b.w, b.h, needs.rtl ? 0.62 : 0.38, 0.5);
    lay.cast[id] = { at: c, w: r3(b.w) };
    placed.push(rectAt(c, b.w, b.h));
  }
  // 5 — movers: a rest spot in the action zone (grid search), their entrance from the frame edge along a lane
  //     that crosses nothing: a collision comes in along the line to its target, a drop from above its spot
  const tgtRect = (id: string): FRect | null => {
    const e = lay.cast[id];
    const b = sizeOf(id);
    const w = e?.w ?? b.w;
    const h = (w / b.w) * b.h;
    return e?.at ? rectAt(e.at, w, h) : rectAt(b, b.w, b.h);
  };
  const chain = evsOf(script, i);
  const inner = (b: { w: number; h: number }) => ({ x: z.action.x + b.w / 2, y: z.action.y + b.h / 2, w: Math.max(0, z.action.w - b.w), h: Math.max(0, z.action.h - b.h) });
  const sweepFree = (a: { x: number; y: number }, b2: { x: number; y: number }, w: number, h: number, ignore: FRect[]) => {
    for (let k = 0; k <= 10; k++) {
      const p = { x: a.x + (b2.x - a.x) * (k / 10), y: a.y + (b2.y - a.y) * (k / 10) };
      const r = rectAt(p, w * 0.9, h * 0.9);
      if (placed.some((q) => !ignore.includes(q) && interArea(q, r) > 0)) return false;
    }
    return true;
  };
  for (let k = 0; k < needs.movers.length; k++) {
    const id = needs.movers[k];
    if (lay.cast[id]) continue;
    // the action is read through its movers: a chip a tenth of the frame wide does not read as a collision.
    // When the copy is the hero, the movers carry the event: they get a legible action size (never smaller)
    const b0 = sizeOf(id);
    const actionMin = H > W ? 0.42 : 0.26;
    const grow = textHeroTarget ? Math.min(2.2, Math.max(1, actionMin / Math.max(1e-3, b0.w)), (z.action.w * 0.6) / Math.max(1e-3, b0.w)) : 1;
    const b = grow > 1.05 ? { ...b0, w: b0.w * grow, h: b0.h * grow } : b0;
    const aim = chain.find((e) => e.element === id && ['push', 'attract', 'become'].includes(e.action) && e.to);
    const enter = chain.find((e) => e.element === id && e.action === 'enter');
    const style = (enter?.style as string) ?? (script.shots[i] as ShotObj).cast?.find((x) => x.id === id)?.enter;
    const tr = aim?.to ? tgtRect(aim.to) : null;
    const zi = inner(b);
    let best: { c: { x: number; y: number }; score: number; from?: { x: number; y: number } } | null = null;
    for (let gx = 0; gx <= 12; gx++)
      for (let gy = 0; gy <= 8; gy++) {
        const c = { x: zi.x + (zi.w * gx) / 12, y: zi.y + (zi.h * gy) / 8 };
        const r = rectAt(c, b.w, b.h);
        if (placed.some((q) => rectGap(q, r) < 0.02)) continue;
        let score = 0;
        let from: { x: number; y: number } | undefined;
        if (aim?.action === 'push' && tr) {
          // near the target (a short, readable hit), but clear of it by more than the push travel
          const gapT = rectGap(tr, r);
          if (gapT < 0.06) continue;
          score = -gapT * 4 - Math.abs(c.y - (tr.y + tr.h / 2)) * 0.6;
          from = laneOrigin(c, centre(tr), 0.32);
          if (!sweepFree(from, c, b.w, b.h, [])) score -= 3;
        } else if (aim?.action === 'attract' && tr) {
          // round the target in open space: far enough for a visible pull, never through the copy
          const d = Math.hypot(c.x - (tr.x + tr.w / 2), c.y - (tr.y + tr.h / 2));
          score = -Math.abs(d - 0.26) * 3;
          if (!sweepFree(c, centre(tr), b.w * 0.6, b.h * 0.6, [tr])) score -= 3;
        } else {
          // a landing spot away from the hero, spread from the other movers; drops need the corridor above
          score = -Math.abs((c.x - z.action.x) / Math.max(1e-3, z.action.w) - (needs.movers.length === 1 ? 0.5 : (needs.rtl ? 1 - k / Math.max(1, needs.movers.length - 1) : k / Math.max(1, needs.movers.length - 1)) * 0.8 + 0.1)) * 2;
          if (style === 'drop') {
            from = { x: r3(c.x), y: r3(Math.max(z.action.y + b.h / 2 - 0.02, c.y - 0.3)) };
            if (!sweepFree(from, c, b.w, b.h, [])) score -= 3;
          } else if (style === 'slide') {
            from = { x: needs.rtl ? 0.04 : 0.96, y: r3(c.y) };
            if (!sweepFree(from, c, b.w, b.h, [])) score -= 3;
          }
        }
        if (!best || score > best.score) best = { c: { x: r3(c.x), y: r3(c.y) }, score, from };
      }
    if (!best) return null; // no room for this mover in the action zone
    placed.push(rectAt(best.c, b.w, b.h));
    lay.cast[id] = { at: best.c, ...(b !== b0 ? { w: r3(b.w) } : {}), ...(best.from ? { enterFrom: best.from } : {}) };
    if (b !== b0) lay.notes.push(`${id} carries the action: ${Math.round(b0.w * 100)}% → ${Math.round(b.w * 100)}% of the width so the event reads`);
  }
  // 6 — the remaining cast (decor, numbers' cards …): keep, unless it now sits on placed things
  for (const id of needs.rest) {
    if (lay.cast[id]) continue;
    const b = sizeOf(id);
    const r = rectAt(b, b.w, b.h);
    if (placed.some((p) => interArea(p, r) > 0.15 * rectArea(r))) {
      const c = fitIn(z.action, b.w, b.h, needs.rtl ? 0.2 : 0.8, 0.82);
      lay.cast[id] = { at: c };
      placed.push(rectAt(c, b.w, b.h));
    } else placed.push(r);
  }
  // 7 — the logo: visible, never in an action path; moves to the nearest free corner only when it must
  for (const id of needs.brand) {
    const b = sizeOf(id);
    const r = rectAt(b, b.w, b.h);
    if (placed.some((p) => interArea(p, r) > 0)) {
      const corners = [{ x: safe.x + b.w / 2, y: safe.y + b.h / 2 }, { x: safe.x + safe.w - b.w / 2, y: safe.y + b.h / 2 }, { x: safe.x + b.w / 2, y: safe.y + safe.h - b.h / 2 }, { x: safe.x + safe.w - b.w / 2, y: safe.y + safe.h - b.h / 2 }];
      const free = corners.find((c) => !placed.some((p) => interArea(p, rectAt(c, b.w, b.h)) > 0));
      if (free) {
        lay.cast[id] = { at: { x: r3(free.x), y: r3(free.y) } };
        lay.notes.push(`${id} moved to a free corner: it was in the action`);
      }
    }
  }
  return lay;
}

/** Apply a layout plan to shot i of a script (cast at / w / enterFrom, text box aspects). */
export function applyLayout(script: ScriptObj, i: number, lay: LayoutPlan, composition?: string): ScriptObj {
  const sc = clone(script);
  const sh = sc.shots[i] as ShotObj;
  for (const [id, e] of Object.entries(lay.cast)) {
    const c = sh.cast?.find((x) => x.id === id);
    if (!c) continue;
    // a lane the motion already had moves with the element (same offset from its new place)
    if (e.at && c.enterFrom && e.enterFrom === undefined) {
      const old = c.at ?? { x: 0.5, y: 0.5 };
      c.enterFrom = { x: r3(clamp(c.enterFrom.x + e.at.x - old.x, -0.2, 1.2)), y: r3(clamp(c.enterFrom.y + e.at.y - old.y, -0.2, 1.2)) };
    }
    if (e.at && c.arriveAt) c.arriveAt = { ...c.arriveAt, x: r3(clamp(c.arriveAt.x + e.at.x - (c.at?.x ?? c.arriveAt.x), 0, 1)), y: r3(clamp(c.arriveAt.y + e.at.y - (c.at?.y ?? c.arriveAt.y), 0, 1)) };
    if (e.at) c.at = e.at;
    if (e.w) c.w = e.w;
    if (e.enterFrom) c.enterFrom = e.enterFrom;
    else if (e.enterFrom === null) delete c.enterFrom;
  }
  for (const [id, a] of Object.entries(lay.aspect)) {
    const d = (sc.stage?.elements as Decl[] | undefined)?.find((x) => x.id === id);
    if (d) d.size = { ...(d.size ?? {}), aspect: a };
  }
  // a re-placed hero that the action aims at (and that had no entrance of its own) is set first: when the layout
  // moves it to the far side of the reading order, the default RTL stagger would bring it in last
  const hero = sh.cast?.find((c) => c.role === 'hero')?.id;
  if (hero && lay.cast[hero]?.at && !sh.motionChain.some((e) => e.element === hero && e.action === 'enter') && sh.motionChain.some((e) => e.to === hero && ['attract', 'push'].includes(e.action))) {
    sh.motionChain.unshift({ id: 'stage', element: hero, action: 'enter', at: 0.05, reason: 'the target of the action is on stage before the pieces fly to it' });
    lay.notes.push(`${hero} enters first: it is the target of the action`);
  }
  if (composition) sh.composition = composition;
  return sc;
}

/** Content preservation (§9): the shot keeps every element, word, number, logo, CTA and asset. */
export function contentPreserved(before: ScriptObj, after: ScriptObj): { ok: boolean; lost: string[] } {
  const lost: string[] = [];
  before.shots.forEach((s, k) => {
    const a = after.shots[k];
    for (const c of s.cast ?? []) if (!(a?.cast ?? []).some((x) => x.id === c.id)) lost.push(`${s.id}: ${c.id}`);
  });
  for (const e of (before.stage?.elements ?? []) as Decl[]) {
    const b = ((after.stage?.elements ?? []) as Decl[]).find((x) => x.id === e.id);
    if (!b) lost.push(`element ${e.id}`);
    else for (const k of ['text', 'title', 'subtitle', 'value', 'asset'] as const) if (e[k] !== b[k]) lost.push(`${e.id}.${k}`);
  }
  return { ok: lost.length === 0, lost };
}

/** Ranked strategies for these needs (with the reason each suits the action), minus the ones memory rules out. */
export function rankStrategies(n: ActionNeeds, exclude: Set<string> = new Set()): { strategy: LayoutStrategy; why: string }[] {
  const order: LayoutStrategy[] = n.peers.length
    ? ['asymmetric-focus', 'progressive-stack', 'focus-stage', 'hero-center/text-safe-zone', 'full-frame-hero']
    : n.corridor === 'radial'
      ? (n.vertical ? ['focus-stage', 'hero-center/text-safe-zone', 'top-copy/bottom-action', 'expansion-zone', 'impact-zone'] : ['focus-stage', 'hero-left/text-right', 'hero-center/text-safe-zone', 'diagonal-action', 'expansion-zone', 'top-copy/bottom-action', 'impact-zone'])
      : n.movers.length
        ? n.vertical
          ? ['top-copy/bottom-action', 'bottom-copy/upper-action', 'corridor-layout', 'impact-zone']
          : ['hero-left/text-right', 'hero-right/text-left', 'top-copy/bottom-action', 'diagonal-action', 'corridor-layout', 'split-action', 'bottom-copy/upper-action', 'negative-space-for-motion', 'impact-zone']
        : n.expansion
          ? ['expansion-zone', 'focus-stage', 'full-frame-hero', 'hero-center/text-safe-zone']
          : ['focus-stage', 'hero-center/text-safe-zone', 'asymmetric-focus'];
  const out: { strategy: LayoutStrategy; why: string }[] = [];
  for (const s of order) {
    if (exclude.has(s)) continue;
    const why = strategyFit(s, n);
    if (why) out.push({ strategy: s, why });
  }
  return out;
}

/** 2–3 layout candidates for shot i under the action of `script` (budget `max`, memory-excluded strategies). */
export function layoutCandidates(script: ScriptObj, plan: StagePlan, i: number, o: { max?: number; exclude?: Set<string>; tag?: string; reserved?: ReservedSpace[] } = {}): LayoutCandidate[] {
  const needs = actionNeeds(script, plan, i, o.reserved);
  const out: LayoutCandidate[] = [];
  const seen = new Set<string>();
  for (const { strategy, why } of rankStrategies(needs, o.exclude)) {
    if (out.length >= (o.max ?? 3)) break;
    const lay = planLayout(script, plan, i, strategy, needs);
    if (!lay || !Object.keys(lay.cast).length) continue;
    const key = JSON.stringify(lay.cast);
    if (seen.has(key)) continue; // two strategies that give the same frame are one candidate
    seen.add(key);
    const sc = applyLayout(script, i, lay);
    const id = `layout-${strategy.replace(/[^a-z0-9]+/g, '-')}-${script.shots[i].id}${o.tag ? `-${o.tag}` : ''}`;
    out.push({ id, strategy, label: strategy, why: `${why} — ${needs.why.join('; ') || 'composition'}`, script: sc, layout: lay });
  }
  return out;
}

// ───────────────────────────────────────────────────────────── geometry stage (before any render)

export interface GeometryCheck {
  pass: boolean;
  issues: string[];
  diagnosis: SpatialDiagnosis;
  dominance: HeroDominanceTimeline;
  attention: AttentionCorridor;
  fit: MotionCompositionFit;
  /** smallest font ratio vs the current plan (1 = same size). */
  minTextScale: number;
  settleCover: number;
  clashFrames: number;
  offSafe: string[];
}

/** Analytic frames of shot i in the preview format (cheap; the same shapes the renders give). */
export function geometryFrames(plan: StagePlan, i: number, step = 0.08, range?: [number, number]): PreviewFrame[] {
  const samples = sampleShot(plan, i, step, range);
  const out: PreviewFrame[] = [];
  let prev: (typeof samples)[number] | null = null;
  for (const s of samples) {
    let diff = 0;
    if (prev) {
      const pm = new Map(prev.els.map((e) => [e.id, e]));
      for (const e of s.els) {
        const p = pm.get(e.id);
        const sz = Math.sqrt(Math.max(rectArea(e.r), 1e-4));
        diff += p ? (Math.abs(e.r.x - p.r.x) + Math.abs(e.r.y - p.r.y) + Math.abs(e.r.w - p.r.w)) * sz + Math.abs(e.o - p.o) * sz * 0.5 : e.o * sz * 0.5;
      }
      diff *= 0.25;
    }
    const px = (r: FRect) => ({ x: r.x * plan.W, y: r.y * plan.H, width: r.w * plan.W, height: r.h * plan.H });
    out.push({ t: s.t, occ: 0, diff, texts: s.els.filter((e) => readable(e.kind)).map((e) => ({ el: e.id, id: e.id, px: 0, rect: px(e.kind === 'card' ? { x: e.r.x + e.r.w * 0.1, y: e.r.y + e.r.h * 0.45, w: e.r.w * 0.8, h: e.r.h * 0.3 } : e.r), opacity: e.o })), els: s.els.map((e) => ({ id: e.id, kind: e.kind, rect: px(e.r), opacity: e.o })) });
    prev = s;
  }
  return out;
}

/** Stage 1 — geometry: collisions, open paths, the hero in the safe area, readable text, nothing out, impact room. */
export function geometryCheck(script: ScriptObj, plan: StagePlan, i: number, base: { plan: StagePlan; fonts?: Record<string, number> }, o: { next?: { x: number; y: number; who: string } | null } = {}): GeometryCheck {
  const sh = script.shots[i] as ShotObj;
  const hero = (sh.cast ?? []).find((c) => c.role === 'hero')?.id ?? '';
  const envs = motionEnvelopes(plan, i);
  const reserved = reservedMotionSpace(script, plan, i, envs);
  const frames = geometryFrames(plan, i);
  const group = plan.elements.filter((e) => e.parent === hero).map((e) => e.id);
  const dominance = heroDominanceTimeline(frames, hero, plan.W, plan.H, { group });
  const attention = attentionCorridor(frames, plan.W, plan.H, { next: o.next });
  const diagnosis = spatialDiagnosis(script, plan, i, { envs, reserved, dominance, attention });
  const issues: string[] = [];
  // text-on-text collisions (both readable, different elements) through the whole shot
  const textClash = (fs: PreviewFrame[]) => {
    let n = 0;
    for (const fr of fs) {
      const vis = fr.texts.filter((x) => x.opacity > 0.35);
      let hit = false;
      for (let a = 0; a < vis.length && !hit; a++)
        for (let b = a + 1; b < vis.length && !hit; b++) {
          const ra = { x: vis[a].rect.x, y: vis[a].rect.y, w: vis[a].rect.width, h: vis[a].rect.height };
          const rb = { x: vis[b].rect.x, y: vis[b].rect.y, w: vis[b].rect.width, h: vis[b].rect.height };
          if (interArea(ra, rb) / Math.max(1, Math.min(rectArea(ra), rectArea(rb))) > 0.15) hit = true;
        }
      if (hit) n++;
    }
    return n;
  };
  // inside the shot, and through the hand-off into the next one (only what the layout makes worse than before)
  const handoffOf = (pl: StagePlan) => (i + 1 < pl.shots.length ? geometryFrames(pl, i, 0.08, [Math.max(pl.shots[i].start, pl.shots[i].end - 0.34), Math.min(pl.shots[i + 1].end, pl.shots[i].end + 0.4)]) : []);
  const handoffNew = Math.max(0, textClash(handoffOf(plan)) - (base.plan === plan ? 0 : textClash(handoffOf(base.plan))));
  const clashFrames = textClash(frames) + handoffNew;
  if (clashFrames >= 2) issues.push(`text over text in ${clashFrames} frames`);
  // the safe area: readable things inside the frame at rest (hero inside the safe area)
  // "at rest" = before the glide into the next shot (the last 0.34 s belongs to the handoff)
  const tEnd = frames[frames.length - 1]?.t ?? 0;
  const restFrame = [...frames].reverse().find((f) => f.t <= tEnd - 0.34) ?? frames[frames.length - 1];
  const lastEls = restFrame?.els ?? [];
  const offSafe: string[] = [];
  for (const e of lastEls.filter((x) => x.opacity > 0.6 && readable(x.kind))) {
    const r = { x: e.rect.x / plan.W, y: e.rect.y / plan.H, w: e.rect.width / plan.W, h: e.rect.height / plan.H };
    if (r.x < 0.02 || r.y < 0.02 || r.x + r.w > 0.98 || r.y + r.h > 0.98) offSafe.push(e.id);
  }
  if (offSafe.length) issues.push(`outside the safe area at rest: ${offSafe.join(', ')}`);
  // text size: the font of every text of the shot is kept
  const ids = plan.elements.filter((e) => e.kind === 'text' && e.shots.includes(sh.id)).map((e) => e.id);
  const before = base.fonts ?? textFonts(base.plan, ids);
  const after = textFonts(plan, ids);
  let minTextScale = 1;
  for (const id of ids) if (before[id] && after[id]) minTextScale = Math.min(minTextScale, after[id] / before[id]);
  if (minTextScale < 0.92) issues.push(`a text shrinks to ${Math.round(minTextScale * 100)}% of its size`);
  // presence: every cast element is visible at rest
  const missing = (sh.cast ?? []).filter((c) => !plan.elements.find((e) => e.id === c.id)?.parent && !c.behind).filter((c) => !lastEls.some((e) => e.id === c.id && e.opacity > 0.5));
  const carried = (sh.transitionOut as { element?: string } | undefined)?.element;
  const lost = missing.filter((c) => c.id !== carried && !evsOf(script, i).some((e) => e.element === c.id && ['exit', 'become', 'attract'].includes(e.action)) && kindOf(script, c.id) !== 'cursor');
  if (lost.length) issues.push(`not on screen at rest: ${lost.map((c) => c.id).join(', ')}`);
  const blocking = diagnosis.conflicts.filter((c) => ['MOTION_PATH_BLOCKED', 'TEXT_BLOCKS_ACTION', 'LOGO_IN_ACTION_PATH'].includes(c.code));
  if (blocking.length) issues.push(`path blocked: ${blocking[0].what}`);
  const settleCover = unionCover(lastEls.filter((e) => e.opacity > 0.4 && (e.rect.width * e.rect.height) / (plan.W * plan.H) < 0.6 && e.kind !== 'cursor').map((e) => ({ x: e.rect.x / plan.W, y: e.rect.y / plan.H, w: e.rect.width / plan.W, h: e.rect.height / plan.H })));
  const fit = motionCompositionFit({ reserved, diagnosis, dominance, attention, clashFrames, settleCover, minTextScale });
  return { pass: issues.length === 0, issues, diagnosis, dominance, attention, fit, minTextScale: r3(minTextScale), settleCover: r3(settleCover), clashFrames, offSafe };
}

// ───────────────────────────────────────────────────────────── the gate (§24) and the fallback (§25)

export interface RedesignEvidence {
  /** preview / technical. */
  veto: string | null;
  /** judge score on the problem's kind. */
  score: number;
  fit: number;
  dominance: HeroDominanceTimeline;
  minTextPx: number | null;
  midMotion: number;
  clash: number;
  presenceOk: boolean;
  boundary?: number;
  sequenceOk?: boolean;
}

export interface RedesignGate {
  accept: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  code: 'REDESIGN_ACCEPTED' | 'NO_REDESIGN_IMPROVEMENT';
}

/** Accept a re-layout only if it is at least as good everywhere it must be, and better where it was weak. */
export function redesignGate(cand: RedesignEvidence, kept: RedesignEvidence, o: { margin?: number; preserved?: { ok: boolean; lost: string[] }; minTextScale?: number; mode?: 'rescue' | 'composition' } = {}): RedesignGate {
  const m = o.margin ?? 0.35;
  const comp = o.mode === 'composition';
  const dm = (d: HeroDominanceTimeline) => (d.movement.share || d.mean) * 0.4 + (d.impact.share || d.mean) * 0.3 + d.settle.share * 0.3;
  const checks = [
    { name: 'technical pass', ok: !cand.veto, detail: cand.veto ?? 'no veto' },
    // a rescued motion must beat the kept version; a re-composed shot must not lose motion and must gain hierarchy
    comp
      ? { name: 'motion candidate works', ok: cand.score >= kept.score - 0.15 && dm(cand.dominance) >= dm(kept.dominance) + 0.04 && cand.fit >= kept.fit + 0.2, detail: `same motion re-composed: ${cand.score} vs ${kept.score}, dominance ${r3(dm(cand.dominance))} vs ${r3(dm(kept.dominance))}, fit ${cand.fit} vs ${kept.fit}` }
      : { name: 'motion candidate works', ok: cand.score >= kept.score + m, detail: `${cand.score} vs kept ${kept.score} (margin ${m})` },
    { name: 'layout better or equal', ok: cand.fit >= kept.fit - 0.05, detail: `motionCompositionFit ${cand.fit} vs ${kept.fit}` },
    { name: 'text readable', ok: (o.minTextScale ?? 1) >= 0.92 && (cand.minTextPx === null || kept.minTextPx === null || cand.minTextPx >= kept.minTextPx * 0.9), detail: `font ×${o.minTextScale ?? 1}, smallest text ${cand.minTextPx}px vs ${kept.minTextPx}px` },
    { name: 'hero dominance improved', ok: dm(cand.dominance) >= dm(kept.dominance) - 0.01, detail: `${r3(dm(cand.dominance))} vs ${r3(dm(kept.dominance))} (movement / impact / settle)` },
    { name: 'no information loss', ok: cand.presenceOk && (o.preserved?.ok ?? true), detail: o.preserved?.lost.length ? `lost: ${o.preserved.lost.join(', ')}` : 'every element present' },
    { name: 'boundary not harmed', ok: cand.boundary === undefined || kept.boundary === undefined || cand.boundary >= kept.boundary - 0.5, detail: `${cand.boundary ?? '—'} vs ${kept.boundary ?? '—'}` },
    { name: 'sequence not harmed', ok: cand.sequenceOk !== false, detail: cand.sequenceOk === false ? 'the neighbouring shots lose' : 'ok' },
    { name: 'motion path clean', ok: cand.midMotion <= kept.midMotion && cand.clash <= Math.max(0.15, kept.clash + 0.02), detail: `mid-motion failures ${cand.midMotion} vs ${kept.midMotion}, clash ${cand.clash} vs ${kept.clash}` },
    { name: 'art director score improved', ok: cand.score + cand.fit * 0.3 + dm(cand.dominance) * 2 > kept.score + kept.fit * 0.3 + dm(kept.dominance) * 2, detail: `${r2(cand.score + cand.fit * 0.3 + dm(cand.dominance) * 2)} vs ${r2(kept.score + kept.fit * 0.3 + dm(kept.dominance) * 2)} (preview score + 0.3 × fit + 2 × hero dominance)` },
  ];
  const accept = checks.every((c) => c.ok);
  return { accept, checks, code: accept ? 'REDESIGN_ACCEPTED' : 'NO_REDESIGN_IMPROVEMENT' };
}

// ───────────────────────────────────────────────────────────── Re-Layout Memory

export interface LayoutMemoryEntry {
  motionCandidate: string;
  layoutCandidate: string;
  spatialFailure: string[];
  successfulLayout: boolean;
  brand: string;
  shotType: string;
  aspectRatio: string;
  why: string;
}

export const aspectOf = (W: number, H: number) => (Math.abs(W / H - 16 / 9) < 0.05 ? '16:9' : Math.abs(W / H - 9 / 16) < 0.05 ? '9:16' : Math.abs(W / H - 1) < 0.05 ? '1:1' : Math.abs(W / H - 4 / 5) < 0.05 ? '4:5' : `${W}x${H}`);
/** A motion family, not a candidate id: "collision", "slam", "strike" … (memory is about ideas, not names). */
export const motionFamily = (candidate: string) => candidate.replace(/^(hook|climax|cut|focus|subjects|layout|number)-/, '').replace(/-(pain|hook|solution|demo|steps|features|cta)\b.*$/, '');

/** Strategies to skip: the same motion family + strategy failed for the same reason on this shot type / aspect. */
export function layoutMemoryExclude(entries: LayoutMemoryEntry[] | undefined, q: { motionCandidate: string; shotType: string; aspectRatio: string; spatialFailure: string[] }): Set<string> {
  const out = new Set<string>();
  for (const e of entries ?? []) {
    if (e.successfulLayout) continue;
    if (motionFamily(e.motionCandidate) !== motionFamily(q.motionCandidate) || e.shotType !== q.shotType || e.aspectRatio !== q.aspectRatio) continue;
    if (e.spatialFailure.some((c) => q.spatialFailure.includes(c)) || !e.spatialFailure.length) out.add(e.layoutCandidate);
  }
  return out;
}

export function rememberLayout(entries: LayoutMemoryEntry[], e: LayoutMemoryEntry): LayoutMemoryEntry[] {
  const k = (x: LayoutMemoryEntry) => [motionFamily(x.motionCandidate), x.layoutCandidate, x.shotType, x.aspectRatio, x.brand].join('|');
  return [...entries.filter((x) => k(x) !== k(e)), e];
}

// ───────────────────────────────────────────────────────────── eligibility (§18, §26)

export interface RelayoutDecision {
  eligible: boolean;
  why: string;
  diagnosis: SpatialDiagnosis | null;
}

/**
 * Re-layout only when a strong motion candidate failed for a spatial reason (or a hero / hierarchy failure
 * of composition), its motion value is above the kept version, and there is no unrelated technical failure.
 */
export function relayoutEligible(x: { motionValue: number; keptValue: number; veto: string | null; midMotion: string[]; diagnosis: SpatialDiagnosis }): RelayoutDecision {
  if (/EMPTY_FRAME|INFORMATION_DROPPED/.test(x.veto ?? '')) return { eligible: false, why: `technical failure unrelated to the layout (${x.veto})`, diagnosis: x.diagnosis };
  if (!x.diagnosis.spatial) return { eligible: false, why: x.diagnosis.motionFailure ? 'the motion itself is weak: re-laying it out would not help' : 'no spatial failure', diagnosis: x.diagnosis };
  if (x.motionValue <= x.keptValue) return { eligible: false, why: `predicted motion value ${x.motionValue} not above the kept version ${x.keptValue}`, diagnosis: x.diagnosis };
  return { eligible: true, why: `promising motion (${x.motionValue} > ${x.keptValue}) blocked by the layout: ${x.diagnosis.codes.join(', ')}`, diagnosis: x.diagnosis };
}

/** The candidate's motion value without its spatial penalties (what it would score with room to move). */
export function motionValueOf(parts: Record<string, number> | undefined, score: number): number {
  if (!parts) return score;
  // the judge's base (6) plus every part that is not a spatial penalty (unclamped)
  return r2(6 + Object.entries(parts).filter(([k]) => k !== 'clash' && k !== 'midMotion').reduce((a, [, v]) => a + v, 0));
}

export const _test = { zonesFor, inflate, centre };
