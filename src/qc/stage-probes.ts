/**
 * DOM Motion Probes (P1-J): what the browser actually drew, frame by frame, for a Stage film.
 *
 * The QC probe (qc mode) reports every stage element's rect after all transforms (camera planes,
 * tracks, parents), the camera state and every emphasised word's rect. This module turns a dense
 * series of those probes into evidence — not what the plan says, what the DOM shows:
 *   · element motion (travel, scale change, seconds moving),
 *   · camera: per shot, did the TARGET visibly change on screen (size / position), vs the background,
 *   · word emphasis: did the word's rect grow when it was spoken / emphasised,
 *   · frame and subject occupancy per frame,
 *   · subject movement, typography activity, frames where nothing moves.
 * Pure: no node or browser APIs (the collector lives in src/node/stage-probes.ts).
 */
import type { StagePlan } from '../stage/plan';
import { planeScale } from '../stage/compiler';
import { LAYER_DEPTH } from '../stage/plan';

export interface StageProbeSample {
  t: number;
  cam: { x: number; y: number; dolly: number; zoom: number };
  els: { id: string; kind: string; rect: { x: number; y: number; width: number; height: number }; opacity: number; parent: boolean }[];
  words: { el: string; word: string; rect: { x: number; y: number; width: number; height: number }; opacity: number }[];
  mask: boolean;
}

export interface DomMotionReport {
  version: 1;
  samples: number;
  dt: number;
  elements: { id: string; kind: string; visibleSec: number; movingSec: number; travel: number; scaleRange: number }[];
  camera: {
    movingSec: number;
    shots: {
      shot: string;
      move: string;
      target?: string;
      cameraMovingSec: number;
      /** On-screen size ratio of the target (end / start of the move), measured on the DOM. */
      targetScale?: number;
      /** Centre shift of the target on screen (frame fractions). */
      targetShift?: number;
      /** Background plane scale ratio over the same window (from the camera state). */
      bgScale: number;
      visible: boolean;
      note: string;
    }[];
  };
  words: { el: string; word: string; at: number; baseH: number; peakH: number; grow: number; reacted: boolean }[];
  occupancy: { mean: number; min: number; byShot: { shot: string; frame: number; subject: number; subjectId?: string }[] };
  subjects: { shot: string; subject?: string; movingSec: number; travel: number; scaleRange: number }[];
  typography: { activeSec: number; share: number };
  still: { sec: number; share: number; longest: number; runs: { t0: number; t1: number }[] };
  /** Text overlapped by another drawn element (seconds, per pair) — collisions the eye sees. */
  collisions: { shot: string; text: string; other: string; sec: number; overlap: number }[];
  /** Readable text cut by the frame edge outside transitions (a camera push cropping a line mid-read). */
  offFrame: { shot: string; text: string; sec: number; worst: number; words: string[] }[];
  masks: number;
}

type R = { x: number; y: number; width: number; height: number };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const centre = (r: R) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function parseCam(s: string): StageProbeSample['cam'] {
  const [x, y, dolly, zoom] = s.split(',').map(Number);
  return { x: x || 0, y: y || 0, dolly: dolly || 0, zoom: zoom || 1 };
}

/** Area of the union of rects clipped to the frame (grid estimate, 96 × 54). */
export function unionCover(rects: R[], W: number, H: number, nx = 96, ny = 54): number {
  if (!rects.length) return 0;
  let hit = 0;
  for (let j = 0; j < ny; j++) {
    const y = ((j + 0.5) / ny) * H;
    for (let i = 0; i < nx; i++) {
      const x = ((i + 0.5) / nx) * W;
      if (rects.some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)) hit++;
    }
  }
  return hit / (nx * ny);
}

export function analyzeStageProbes(plan: StagePlan, samples: StageProbeSample[], opts: { W: number; H: number }): DomMotionReport {
  const { W, H } = opts;
  const S = [...samples].sort((a, b) => a.t - b.t);
  const dts = S.slice(1).map((s, i) => s.t - S[i].t);
  const dt = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
  const diag = Math.hypot(W, H);
  const vis = (s: StageProbeSample, id: string) => s.els.find((e) => e.id === id && e.opacity > 0.05);
  const shotAt = (t: number) => plan.shots.find((sh) => t >= sh.start && t < sh.end) ?? plan.shots[plan.shots.length - 1];
  // per-interval change of an element: centre move (fraction of the diagonal), size ratio, opacity change
  const change = (a: StageProbeSample['els'][number] | undefined, b: StageProbeSample['els'][number] | undefined) => {
    if (!a && !b) return { move: 0, size: 0, op: 0, any: false };
    if (!a || !b) return { move: 0, size: 0, op: Math.abs((a?.opacity ?? 0) - (b?.opacity ?? 0)), any: true };
    const ca = centre(a.rect);
    const cb = centre(b.rect);
    const move = Math.hypot(cb.x - ca.x, cb.y - ca.y) / diag;
    const sa = Math.sqrt(Math.max(1, a.rect.width * a.rect.height));
    const sb = Math.sqrt(Math.max(1, b.rect.width * b.rect.height));
    const size = Math.abs(Math.log(sb / sa));
    const op = Math.abs(a.opacity - b.opacity);
    return { move, size, op, any: move > 0.0015 || size > 0.006 || op > 0.03 };
  };

  // ── elements
  const ids = [...new Set(S.flatMap((s) => s.els.map((e) => e.id)))];
  const elements = ids.map((id) => {
    let visibleSec = 0;
    let movingSec = 0;
    let travel = 0;
    let minS = Infinity;
    let maxS = 0;
    const kind = S.find((s) => s.els.some((e) => e.id === id))!.els.find((e) => e.id === id)!.kind;
    S.forEach((s, i) => {
      const e = vis(s, id);
      if (e) {
        const sz = Math.sqrt(e.rect.width * e.rect.height);
        minS = Math.min(minS, sz);
        maxS = Math.max(maxS, sz);
      }
      if (i === 0) return;
      const step = s.t - S[i - 1].t;
      const a = vis(S[i - 1], id);
      if (e || a) visibleSec += step;
      const c = change(a, e);
      if (c.any) movingSec += step;
      if (a && e) travel += c.move;
    });
    return { id, kind, visibleSec: r3(visibleSec), movingSec: r3(movingSec), travel: r3(travel), scaleRange: r3(minS > 0 && Number.isFinite(minS) ? maxS / minS : 1) };
  });

  // ── camera: is the move visible ON THE TARGET?
  const camMoving = (a: StageProbeSample, b: StageProbeSample) => Math.abs(a.cam.x - b.cam.x) + Math.abs(a.cam.y - b.cam.y) > 0.5 || Math.abs(a.cam.dolly - b.cam.dolly) + Math.abs(a.cam.zoom - b.cam.zoom) > 0.0008;
  let camSec = 0;
  S.forEach((s, i) => {
    if (i && camMoving(S[i - 1], s)) camSec += s.t - S[i - 1].t;
  });
  const near = (t: number) => S.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), S[0]);
  const elementOfTarget = (target?: string) => {
    if (!target) return undefined;
    if (plan.elements.some((e) => e.id === target)) return target;
    return plan.elements.find((e) => e.anchors && target in e.anchors)?.id;
  };
  const camShots = plan.shots.map((sh) => {
    let moving = 0;
    S.forEach((s, i) => {
      if (i && s.t > sh.start && s.t <= sh.end && camMoving(S[i - 1], s)) moving += s.t - S[i - 1].t;
    });
    const a = near(sh.camera.t0);
    const b = near(sh.camera.t1);
    const bgScale = r3(planeScale(LAYER_DEPTH.bg, b.cam) / planeScale(LAYER_DEPTH.bg, a.cam));
    const tid = elementOfTarget(sh.camera.target);
    let targetScale: number | undefined;
    let targetShift: number | undefined;
    if (tid) {
      const ea = vis(a, tid);
      const eb = vis(b, tid);
      if (ea && eb) {
        targetScale = r3(Math.sqrt((eb.rect.width * eb.rect.height) / Math.max(1, ea.rect.width * ea.rect.height)));
        const ca = centre(ea.rect);
        const cb = centre(eb.rect);
        targetShift = r3(Math.hypot((cb.x - ca.x) / W, (cb.y - ca.y) / H));
      }
    }
    const moves = sh.camera.move !== 'static';
    const visible = !moves || (targetScale !== undefined && (Math.abs(targetScale - 1) > 0.08 || (targetShift ?? 0) > 0.03));
    const note = !moves
      ? 'static camera'
      : targetScale === undefined
        ? 'the target is not measurable on screen at the start / end of the move'
        : visible
          ? `the target changes ×${targetScale} on screen (background ×${bgScale})`
          : `camera moves but its target barely changes on screen (×${targetScale}, shift ${targetShift})`;
    return { shot: sh.id, move: sh.camera.move, target: sh.camera.target, cameraMovingSec: r3(moving), ...(targetScale !== undefined ? { targetScale, targetShift } : {}), bgScale, visible, note };
  });

  // ── words: did the emphasised word grow when it was emphasised?
  const words: DomMotionReport['words'] = [];
  for (const el of plan.elements) {
    for (const em of el.emphasis ?? []) {
      const at = el.life.from + em.at;
      const hOf = (s: StageProbeSample) => {
        const w = s.words.find((x) => x.el === el.id && x.word.includes(em.word.split(' ')[0]) && x.opacity > 0.05);
        return w ? w.rect.height : 0;
      };
      const before = S.filter((s) => s.t >= at - 0.45 && s.t <= at - 0.02).map(hOf).filter((h) => h > 0);
      const during = S.filter((s) => s.t >= at && s.t <= at + 0.6).map(hOf).filter((h) => h > 0);
      const baseH = before.length ? before[before.length - 1] : during.length ? Math.min(...during) : 0;
      const peakH = during.length ? Math.max(...during) : 0;
      const grow = baseH > 0 ? r3(peakH / baseH) : 0;
      words.push({ el: el.id, word: em.word, at: r3(at), baseH: r3(baseH), peakH: r3(peakH), grow, reacted: grow > 1.025 });
    }
  }

  // ── occupancy (frame + subject) and subject movement per shot
  // content occupancy: a shape that became the world (covers the frame) is a backdrop, not content
  const content = (s: StageProbeSample) => s.els.filter((e) => !e.parent && e.opacity > 0.3 && e.kind !== 'cursor' && !(e.kind === 'shape' && e.rect.width >= W * 0.98 && e.rect.height >= H * 0.98));
  const occ = S.map((s) => unionCover(content(s).map((e) => e.rect), W, H));
  const byShot = plan.shots.map((sh) => {
    const inShot = S.filter((s) => s.t >= sh.start && s.t < sh.end);
    const settle = inShot.slice(Math.floor(inShot.length * 0.45), Math.max(Math.floor(inShot.length * 0.45) + 1, Math.floor(inShot.length * 0.85)));
    const subj = sh.composition.subject;
    const frameOcc = settle.length ? settle.map((s) => occ[S.indexOf(s)]).reduce((a, b) => a + b, 0) / settle.length : 0;
    const subjOcc = settle.length && subj ? settle.map((s) => { const e = vis(s, subj); return e ? unionCover([e.rect], W, H) : 0; }).reduce((a, b) => a + b, 0) / settle.length : 0;
    return { shot: sh.id, frame: r3(frameOcc), subject: r3(subjOcc), ...(subj ? { subjectId: subj } : {}) };
  });
  const subjects = plan.shots.map((sh) => {
    const subj = sh.composition.subject;
    let movingSec = 0;
    let travel = 0;
    let minS = Infinity;
    let maxS = 0;
    S.forEach((s, i) => {
      if (!subj || s.t < sh.start || s.t >= sh.end) return;
      const e = vis(s, subj);
      if (e) {
        const z = Math.sqrt(e.rect.width * e.rect.height);
        minS = Math.min(minS, z);
        maxS = Math.max(maxS, z);
      }
      if (!i) return;
      const c = change(vis(S[i - 1], subj), e);
      if (c.any) movingSec += s.t - S[i - 1].t;
      travel += c.move;
    });
    return { shot: sh.id, subject: subj ?? undefined, movingSec: r3(movingSec), travel: r3(travel), scaleRange: r3(Number.isFinite(minS) && minS > 0 ? maxS / minS : 1) };
  });

  // ── typography activity and stillness (nothing on stage changes, camera included)
  let typo = 0;
  let still = 0;
  let run = 0;
  let longest = 0;
  const runs: { t0: number; t1: number }[] = [];
  let runStart = -1;
  const coll = new Map<string, { shot: string; text: string; other: string; sec: number; overlap: number }>();
  const off = new Map<string, { shot: string; text: string; sec: number; worst: number; words: string[] }>();
  const inTransition = (t: number) => (plan.transitions ?? []).some((tr) => t >= tr.t0 - 0.05 && t <= tr.t1 + 0.05);
  S.forEach((s, i) => {
    if (!i) return;
    const p = S[i - 1];
    const step = s.t - p.t;
    const textIds = new Set([...s.els, ...p.els].filter((e) => e.kind === 'text' || e.kind === 'button').map((e) => e.id));
    const wordMoved = s.words.some((w) => {
      const q = p.words.find((x) => x.el === w.el && x.word === w.word);
      return !q || Math.abs(q.rect.height - w.rect.height) > 0.5 || Math.abs(q.opacity - w.opacity) > 0.03;
    });
    if (wordMoved || [...textIds].some((id) => change(p.els.find((e) => e.id === id), s.els.find((e) => e.id === id)).any)) typo += step;
    const anyEl = [...new Set([...s.els, ...p.els].map((e) => e.id))].some((id) => change(p.els.find((e) => e.id === id), s.els.find((e) => e.id === id)).any);
    const moving = anyEl || camMoving(p, s) || wordMoved;
    if (!moving) {
      if (runStart < 0) runStart = p.t;
      still += step;
      run += step;
      longest = Math.max(longest, run);
    } else {
      if (runStart >= 0 && run >= 0.6) runs.push({ t0: r3(runStart), t1: r3(p.t) });
      run = 0;
      runStart = -1;
    }
    // off frame: a visible word cut by the frame edge (outside object transitions)
    if (!inTransition(s.t)) {
      const cut = new Map<string, { worst: number; words: Set<string> }>();
      for (const w of s.words) {
        if (w.opacity < 0.5 || w.rect.width < 1) continue;
        const vis = Math.max(0, Math.min(w.rect.x + w.rect.width, W) - Math.max(w.rect.x, 0)) * Math.max(0, Math.min(w.rect.y + w.rect.height, H) - Math.max(w.rect.y, 0));
        const lost = 1 - vis / Math.max(1, w.rect.width * w.rect.height);
        if (lost < 0.05) continue;
        const c = cut.get(w.el) ?? { worst: 0, words: new Set<string>() };
        c.worst = Math.max(c.worst, lost);
        c.words.add(w.word);
        cut.set(w.el, c);
      }
      for (const [el, c] of cut) {
        const o = off.get(el) ?? { shot: shotAt(s.t).id, text: el, sec: 0, worst: 0, words: [] };
        o.sec = r3(o.sec + step);
        o.worst = r3(Math.max(o.worst, c.worst));
        o.words = [...new Set([...o.words, ...c.words])].slice(0, 6);
        off.set(el, o);
      }
    }
    // collisions: a readable text overlapped by another opaque top-level element
    const tops = s.els.filter((e) => !e.parent && e.opacity > 0.5 && e.kind !== 'cursor');
    for (const a of tops.filter((e) => e.kind === 'text')) {
      for (const b of tops) {
        if (b.id === a.id) continue;
        const ix = Math.max(0, Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x));
        const iy = Math.max(0, Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y));
        const ov = (ix * iy) / Math.max(1, a.rect.width * a.rect.height);
        if (ov < 0.08 || unionCover([b.rect], W, H) > 0.85) continue; // a full-frame world is a backdrop, not a collision
        const key = `${a.id}|${b.id}`;
        const c = coll.get(key) ?? { shot: shotAt(s.t).id, text: a.id, other: b.id, sec: 0, overlap: 0 };
        c.sec = r3(c.sec + step);
        c.overlap = r3(Math.max(c.overlap, ov));
        coll.set(key, c);
      }
    }
  });
  if (runStart >= 0 && run >= 0.6) runs.push({ t0: r3(runStart), t1: r3(S[S.length - 1].t) });
  const total = S.length > 1 ? S[S.length - 1].t - S[0].t : 0;
  return {
    version: 1,
    samples: S.length,
    dt: r3(dt),
    elements,
    camera: { movingSec: r3(camSec), shots: camShots },
    words,
    occupancy: { mean: r3(occ.reduce((a, b) => a + b, 0) / Math.max(1, occ.length)), min: r3(Math.min(...occ)), byShot },
    subjects,
    typography: { activeSec: r3(typo), share: r3(total ? typo / total : 0) },
    still: { sec: r3(still), share: r3(total ? still / total : 0), longest: r3(longest), runs },
    collisions: [...coll.values()].filter((c) => c.sec >= 0.2),
    offFrame: [...off.values()].filter((o) => o.sec >= 0.2),
    masks: S.filter((s) => s.mask).length,
  };
}

/** Frames to probe: every `step` seconds plus a dense window around each emphasis and each camera move's ends. */
export function stageProbeTimes(plan: StagePlan, duration: number, step = 0.2): number[] {
  const out = new Set<number>();
  for (let t = 0; t < duration - 1e-6; t += step) out.add(Math.round(t * 100) / 100);
  for (const el of plan.elements) for (const em of el.emphasis ?? []) for (const d of [-0.3, -0.1, 0.1, 0.2, 0.3, 0.45]) out.add(Math.round((el.life.from + em.at + d) * 100) / 100);
  for (const sh of plan.shots) if (sh.camera.move !== 'static') for (const t of [sh.camera.t0, sh.camera.t1]) out.add(Math.round(t * 100) / 100);
  return [...out].filter((t) => t >= 0 && t < duration).sort((a, b) => a - b);
}
