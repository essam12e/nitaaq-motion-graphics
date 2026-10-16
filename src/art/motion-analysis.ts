/**
 * P4 — what the motion of a film IS, read from stage.json alone (analytic; the preview renders measure the
 * same quantities in pixels and DOM, see src/art/judge.ts):
 *
 *   contributions        element vs camera share of the on-screen motion (C), per shot and for the film
 *   motionWithoutCamera  the film with the camera frozen: how much still remains, how long the dead holds are (C)
 *   densityTimeline      how many things move at once, every 0.1 s: MOTION_CLUTTER / MOTION_VOID (AB)
 *   motionPaths          every travel: length, straightness, reversals, off-frame excursions, crossing text (AF)
 *   compositionPhases    anticipation → mid-motion → impact → settle → handoff inside each shot (AE)
 *
 * Pure (no node / browser APIs).
 */
import { CAMERA_KEY, type StagePlan, type StageElement } from '../stage/plan';
import type { ChoreoNode } from '../motion/choreography';
import { compiledOf, sampleStage, KIND_MASS, type SampledEl } from '../film/sampler';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The plan with its camera frozen at rest (every camera action removed). */
export function withoutCamera(plan: StagePlan): StagePlan {
  const strip = (n: ChoreoNode): ChoreoNode | null => {
    if ((n as { target?: string }).target === CAMERA_KEY) return null;
    const kids = (n as { children?: ChoreoNode[] }).children;
    if (kids) return { ...(n as object), children: kids.map(strip).filter((x): x is ChoreoNode => x !== null) } as ChoreoNode;
    return n;
  };
  const timeline = (plan.choreo.timeline as ChoreoNode[]).map(strip).filter((x): x is ChoreoNode => x !== null);
  const initial = Object.fromEntries(Object.entries(plan.choreo.initial ?? {}).filter(([k]) => !k.startsWith(`${CAMERA_KEY}.`)));
  return { ...plan, choreo: { ...plan.choreo, initial, timeline } };
}

type Frame = Map<string, SampledEl>;
const frameAt = (plan: StagePlan, t: number): Frame => new Map(sampleStage(plan, t).sampled.filter((e) => e.kind !== 'cursor').map((e) => [e.id, e]));

/** On-screen motion between two frames: area-weighted travel + size change + fade (frame fractions per second). */
function energyBetween(a: Frame, b: Frame, W: number, H: number, dt: number, byId: Map<string, StageElement>): { total: number; per: Map<string, number> } {
  const per = new Map<string, number>();
  let total = 0;
  for (const [id, e1] of b) {
    const e0 = a.get(id);
    const el = byId.get(id);
    const mass = KIND_MASS[e1.kind] ?? 0.3;
    const size = Math.sqrt(Math.max(e1.area, 1e-4));
    let v: number;
    if (!e0) v = e1.opacity * size; // appears
    else {
      const dx = (e1.rect.x + e1.rect.width / 2 - (e0.rect.x + e0.rect.width / 2)) / W;
      const dy = (e1.rect.y + e1.rect.height / 2 - (e0.rect.y + e0.rect.height / 2)) / H;
      const ds = Math.abs(e1.rect.width * e1.rect.height - e0.rect.width * e0.rect.height) / (W * H) / Math.max(size, 0.05);
      v = Math.hypot(dx, dy) * size + ds + Math.abs(e1.opacity - e0.opacity) * size * 0.5;
    }
    void el;
    const w = (v * (0.4 + mass)) / dt;
    if (w > 1e-5) per.set(id, w);
    total += w;
  }
  for (const [id, e0] of a) if (!b.has(id)) total += (e0.opacity * Math.sqrt(Math.max(e0.area, 1e-4)) * (0.4 + (KIND_MASS[e0.kind] ?? 0.3))) / dt;
  return { total, per };
}

export interface ShotContribution {
  shot: string;
  element: number;
  camera: number;
  /** element share of the on-screen motion (0..1). */
  elementShare: number;
  /** longest stretch without element motion (camera frozen), seconds. */
  stillRunNoCam: number;
  stillShareNoCam: number;
}

export interface Contributions {
  version: 1;
  elementMotionContribution: number;
  cameraMotionContribution: number;
  motionWithoutCameraQuality: number;
  shots: ShotContribution[];
  /** Shots whose motion the camera carries (camera share > 0.5 with a real move). */
  cameraCarried: string[];
  diagnostic: string[];
}

/** Element vs camera contribution and the film without its camera (C). `step` in seconds. */
export function contributions(plan: StagePlan, step = 0.1): Contributions {
  const noCam = withoutCamera(plan);
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  const shots: ShotContribution[] = [];
  let E = 0;
  let C = 0;
  let stillAll = 0;
  let timeAll = 0;
  for (const sh of plan.shots) {
    let el = 0;
    let all = 0;
    let run = 0;
    let best = 0;
    let still = 0;
    let n = 0;
    let pa = frameAt(plan, sh.start);
    let pn = frameAt(noCam, sh.start);
    for (let t = sh.start + step; t <= sh.end + 1e-6; t += step) {
      const fa = frameAt(plan, t);
      const fn = frameAt(noCam, t);
      const ea = energyBetween(pa, fa, plan.W, plan.H, step, byId).total;
      const en = energyBetween(pn, fn, plan.W, plan.H, step, byId).total;
      all += ea;
      el += Math.min(en, ea || en);
      const moving = en > 0.004;
      run = moving ? 0 : run + step;
      if (!moving) still += step;
      best = Math.max(best, run);
      n += step;
      pa = fa;
      pn = fn;
    }
    const cam = Math.max(0, all - el);
    E += el;
    C += cam;
    stillAll += still;
    timeAll += n;
    shots.push({ shot: sh.id, element: r3(el), camera: r3(cam), elementShare: r3(el + cam > 0 ? el / (el + cam) : 1), stillRunNoCam: r2(best), stillShareNoCam: r3(n ? still / n : 0) });
  }
  const elementMotionContribution = r3(E + C > 0 ? E / (E + C) : 1);
  const stillShare = timeAll ? stillAll / timeAll : 0;
  const maxRun = Math.max(0, ...shots.map((s) => s.stillRunNoCam));
  // 0..10: the film still moves, has no long dead hold and keeps motion in every shot when the camera is gone
  const q = 10 - Math.max(0, stillShare - 0.12) * 14 - Math.max(0, maxRun - 1.0) * 1.6 - shots.filter((s) => s.stillShareNoCam > 0.6).length * 0.8;
  const cameraCarried = shots.filter((s, i) => s.elementShare < 0.5 && plan.shots[i].camera.move !== 'static').map((s) => s.shot);
  const diagnostic: string[] = [];
  for (const s of shots) {
    if (s.stillShareNoCam > 0.6) diagnostic.push(`${s.shot}: without the camera ${Math.round(s.stillShareNoCam * 100)}% of the shot is still (longest ${s.stillRunNoCam}s)`);
    if (cameraCarried.includes(s.shot)) diagnostic.push(`${s.shot}: the camera carries ${Math.round((1 - s.elementShare) * 100)}% of the motion (CAMERA_CARRYING_SCENE)`);
  }
  return { version: 1, elementMotionContribution, cameraMotionContribution: r3(1 - elementMotionContribution), motionWithoutCameraQuality: r2(Math.max(0, Math.min(10, q))), shots, cameraCarried, diagnostic };
}

export interface DensityPoint {
  t: number;
  moving: number;
  energy: number;
  textMoving: boolean;
}
export interface DensityTimeline {
  version: 1;
  step: number;
  points: DensityPoint[];
  clutter: { t0: number; t1: number; moving: number }[];
  voids: { t0: number; t1: number }[];
  issues: string[];
}

/**
 * Motion density every `step` s (AB): elements moving at once and the motion energy. MOTION_CLUTTER = more
 * than 3 things moving with readable text moving for over 0.6 s; MOTION_VOID = nothing moves for over 1.2 s
 * outside the closing hold (camera frozen: the camera does not fill a void).
 */
export function densityTimeline(plan: StagePlan, step = 0.1): DensityTimeline {
  const noCam = withoutCamera(plan);
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  const end = plan.shots[plan.shots.length - 1].end;
  const points: DensityPoint[] = [];
  let prev = frameAt(noCam, 0);
  for (let t = step; t <= end + 1e-6; t += step) {
    const cur = frameAt(noCam, t);
    const e = energyBetween(prev, cur, plan.W, plan.H, step, byId);
    const movers = [...e.per.entries()].filter(([, v]) => v > 0.01);
    points.push({ t: r2(t), moving: movers.length, energy: r3(e.total), textMoving: movers.some(([id]) => byId.get(id)?.kind === 'text') });
    prev = cur;
  }
  const clutter: DensityTimeline['clutter'] = [];
  const voids: DensityTimeline['voids'] = [];
  const holdFrom = plan.ending?.settleAt ?? end;
  let c0: number | null = null;
  let cMax = 0;
  let v0: number | null = null;
  points.forEach((p, k) => {
    const busy = p.moving > 3 && p.textMoving;
    if (busy) {
      c0 ??= p.t;
      cMax = Math.max(cMax, p.moving);
    }
    if ((!busy || k === points.length - 1) && c0 !== null) {
      if (p.t - c0 > 0.6) clutter.push({ t0: c0, t1: p.t, moving: cMax });
      c0 = null;
      cMax = 0;
    }
    const idle = p.energy < 0.004 && p.t < holdFrom;
    if (idle) v0 ??= p.t;
    if ((!idle || k === points.length - 1) && v0 !== null) {
      if (p.t - v0 > 1.2) voids.push({ t0: v0, t1: p.t });
      v0 = null;
    }
  });
  const issues = [...clutter.map((c) => `MOTION_CLUTTER ${c.t0}–${c.t1}s (${c.moving} things move with the text)`), ...voids.map((v) => `MOTION_VOID ${v.t0}–${v.t1}s`)];
  return { version: 1, step, points, clutter, voids, issues };
}

export interface MotionPath {
  element: string;
  shot: string;
  t0: number;
  t1: number;
  length: number;
  straightness: number;
  reversals: number;
  offFrame: boolean;
  crossesText: string[];
  quality: number;
  notes: string[];
}

/**
 * Every travel of an element (AF): sampled on screen (camera frozen), a path is judged by length, by how
 * direct it is (straightness = chord / length), unplanned reversals (a kick or settle is one reversal),
 * leaving the frame and passing over readable text of another element.
 */
export function motionPaths(plan: StagePlan, step = 0.05): MotionPath[] {
  const noCam = withoutCamera(plan);
  const c = compiledOf(noCam);
  void c;
  const out: MotionPath[] = [];
  for (const sh of plan.shots) {
    const ids = sh.cast.map((x) => x.id).filter((id) => plan.elements.find((e) => e.id === id && !e.parent && e.kind !== 'line' && e.kind !== 'cursor'));
    const track = new Map<string, { t: number; x: number; y: number; r: SampledEl['rect'] }[]>();
    const texts: { t: number; id: string; r: SampledEl['rect'] }[] = [];
    for (let t = sh.start; t <= sh.end + 1e-6; t += step) {
      const f = sampleStage(noCam, t).sampled;
      for (const e of f) {
        if (e.kind === 'text' && e.opacity > 0.5) texts.push({ t, id: e.id, r: e.rect });
        if (!ids.includes(e.id)) continue;
        const arr = track.get(e.id) ?? [];
        arr.push({ t, x: (e.rect.x + e.rect.width / 2) / plan.W, y: (e.rect.y + e.rect.height / 2) / plan.H, r: e.rect });
        track.set(e.id, arr);
      }
    }
    for (const [id, pts] of track) {
      // segments of continuous travel
      let k = 1;
      while (k < pts.length) {
        const moving = (j: number) => Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y) > 0.0015;
        if (!moving(k)) {
          k++;
          continue;
        }
        const a = k - 1;
        while (k < pts.length && moving(k)) k++;
        const seg = pts.slice(a, k);
        let len = 0;
        let rev = 0;
        let pd: [number, number] | null = null;
        for (let j = 1; j < seg.length; j++) {
          const d: [number, number] = [seg[j].x - seg[j - 1].x, seg[j].y - seg[j - 1].y];
          len += Math.hypot(d[0], d[1]);
          if (pd && d[0] * pd[0] + d[1] * pd[1] < 0) rev++;
          pd = d;
        }
        if (len < 0.02) continue;
        const chord = Math.hypot(seg[seg.length - 1].x - seg[0].x, seg[seg.length - 1].y - seg[0].y);
        const straightness = r3(chord / Math.max(len, 1e-6));
        const offFrame = seg.some((p) => p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02);
        const el = plan.elements.find((e) => e.id === id)!;
        const crosses = new Set<string>();
        if (el.kind !== 'text')
          for (const p of seg) for (const tx of texts) if (tx.id !== id && Math.abs(tx.t - p.t) < step / 2 && overlap(p.r, tx.r) > 0.25) crosses.add(tx.id);
        const notes: string[] = [];
        let q = 9;
        if (rev > 2) {
          q -= Math.min(3, (rev - 2) * 0.8);
          notes.push(`${rev} direction reversals (a wobble, not a gesture)`);
        }
        if (offFrame && el.kind === 'text') {
          q -= 3;
          notes.push('text leaves the frame');
        }
        if (crosses.size) {
          q -= 2;
          notes.push(`passes over readable text (${[...crosses].join(', ')})`);
        }
        if (len > 0.9) {
          q -= 1;
          notes.push('a very long travel for one gesture');
        }
        out.push({ element: id, shot: sh.id, t0: r2(seg[0].t), t1: r2(seg[seg.length - 1].t), length: r3(len), straightness, reversals: rev, offFrame, crossesText: [...crosses], quality: r2(Math.max(0, q)), notes });
      }
    }
  }
  return out;
}

function overlap(a: SampledEl['rect'], b: SampledEl['rect']): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (w * h) / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

export interface CompositionPhases {
  shot: string;
  /** Seconds (film time) of each phase; null when the shot has no such phase. */
  anticipation: [number, number] | null;
  mid: [number, number] | null;
  impact: number | null;
  settle: [number, number] | null;
  handoff: [number, number] | null;
  /** Readable rest before the hand-over (s): the viewer reads the settled frame. */
  readSec: number;
  issues: string[];
}

/** Composition through time (AE): the shot's motion curve cut into its phases (camera frozen). */
export function compositionPhases(plan: StagePlan, step = 0.1): CompositionPhases[] {
  const d = densityTimeline(plan, step);
  return plan.shots.map((sh, i) => {
    const pts = d.points.filter((p) => p.t > sh.start && p.t <= sh.end);
    const issues: string[] = [];
    if (!pts.length) return { shot: sh.id, anticipation: null, mid: null, impact: null, settle: null, handoff: null, readSec: 0, issues };
    const peak = pts.reduce((a, b) => (b.energy > a.energy ? b : a));
    const thr = Math.max(0.004, peak.energy * 0.12);
    const first = pts.find((p) => p.energy > thr);
    const nextStart = plan.shots[i + 1]?.start ?? sh.end;
    const outT = i < plan.shots.length - 1 ? Math.min(sh.end, nextStart) - 0.6 : sh.end;
    // the settle: the longest quiet stretch after the impact and before the hand-over
    let settle: [number, number] | null = null;
    let s0: number | null = null;
    for (const p of pts.filter((q) => q.t >= peak.t && q.t <= outT)) {
      if (p.energy <= thr) s0 ??= p.t;
      else if (s0 !== null) {
        if (!settle || p.t - s0 > settle[1] - settle[0]) settle = [r2(s0), r2(p.t)];
        s0 = null;
      }
    }
    if (s0 !== null && (!settle || outT - s0 > settle[1] - settle[0])) settle = [r2(s0), r2(outT)];
    const readSec = settle ? r2(settle[1] - settle[0]) : 0;
    const hasText = sh.cast.some((c) => plan.elements.find((e) => e.id === c.id)?.kind === 'text');
    if (hasText && readSec < 0.5 && i < plan.shots.length - 1) issues.push(`NO_SETTLE: the text has ${readSec}s at rest before the hand-over`);
    return {
      shot: sh.id,
      anticipation: first && first.t > sh.start + 0.15 ? [r2(sh.start), r2(first.t)] : null,
      mid: first ? [r2(first.t), r2(peak.t)] : null,
      impact: r2(peak.t),
      settle,
      handoff: i < plan.shots.length - 1 ? [r2(outT), r2(Math.min(sh.end, nextStart) + 0.4)] : null,
      readSec,
      issues,
    };
  });
}

/** Energy per shot from the motion (camera frozen), normalised 0..1 across the film. */
export function shotEnergy(plan: StagePlan, step = 0.1): { shot: string; energy: number; early: number }[] {
  const d = densityTimeline(plan, step);
  const raw = plan.shots.map((sh) => {
    const pts = d.points.filter((p) => p.t > sh.start && p.t <= sh.end);
    const early = d.points.filter((p) => p.t > sh.start && p.t <= sh.start + 1.5);
    const m = pts.length ? pts.reduce((a, p) => a + p.energy, 0) / pts.length : 0;
    const e = early.length ? early.reduce((a, p) => a + p.energy, 0) / early.length : 0;
    return { shot: sh.id, m, e };
  });
  const top = Math.max(1e-6, ...raw.map((r) => r.m), ...raw.map((r) => r.e));
  return raw.map((r) => ({ shot: r.shot, energy: r3(r.m / top), early: r3(r.e / top) }));
}
