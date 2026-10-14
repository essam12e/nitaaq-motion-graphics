/**
 * Spatial QC (Phase 9) — extends the QC agent with the checks a spatial / camera-driven film needs.
 * Runs inside the structural pass on the same cached DOM probes (no extra browser work) plus pure
 * spec analysis, and works in fractions of the canvas so 9:16 and 16:9 use the same rules:
 *
 *   depth            DEPTH_TOO_CLOSE   the camera brings the hero plane inside the near plane without a pass-through
 *                    DEPTH_OCCLUSION   a card / layer in front of the hero plane covers critical text, the product or the logo
 *   hero             HERO_NOT_VISIBLE  the hero element is never fully visible while its scene holds
 *                    HERO_TOO_SMALL    … or only as a small fraction of the frame
 *   safe areas       LOGO_OUTSIDE_SAFE / HERO_OUTSIDE_SAFE   identity media leave the platform safe area
 *   transitions      TRANSITION_CORRIDOR  the next focal point lands against the transition's motion (the eye jumps back)
 *                    TRANSITION_TEXT_CLASH  outgoing and incoming text drawn on top of each other mid-transition
 *   continuity       CONTINUITY_BREAK  a cut whose motion vectors fight (score per cut + film score)
 *   budgets          PERF_BUDGET / PERF_LAYERS / FX_BUDGET
 *
 * Camera framing itself (safe area, crop, collision under a move) stays in Visual QA (vqa.ts).
 */
import type { VideoSpec } from '../schema/video';
import type { Timeline } from '../core/timeline';
import type { ProbeResult as DomProbe } from '../engine/QCProbe';
import type { CanvasProfile } from '../layout/canvas';
import type { Severity } from '../validation/validate';
import { cameraAt, resolvePlan, planMoves, type CameraPlan } from '../camera/moves';
import { clearance, PASS_BAND } from '../camera/rig';
import { blurHint } from '../camera/solver';
import { continuityScore, motionVector, spatialEdge, type MotionVector } from '../transitions/continuity';
import { dirOf } from '../transitions/advanced';
import { estimateEffectCost } from '../perf/effect-budget';
import { budgetFx, FX_BUDGET, FX_DEFS, type FxBudgetLevel, type MicroFxKind } from '../fx/micro';
import { SETTLED, type VqaIssue, type VqaSample } from './vqa';

type Rect = { x: number; y: number; width: number; height: number };

export interface SpatialMetrics {
  /** Motion Continuity Score: per cut and film mean (0..1). */
  continuity: { score: number; cuts: { from: string; to: string; transition: string; score: number }[] };
  hero: { scene: string | null; element: string | null; visible: boolean; coverage: number } | null;
  corridors: { cut: string; ok: boolean; against: number }[];
  depth: { minClearance: number | null; occlusions: number };
  perf: { score: number; level: string; budget: string | null; overBudget: boolean; peakVideos: number; peakLayers: number; peakMotionBlur: number };
  fx: { count: number; cost: number; dropped: number; level: FxBudgetLevel; peakConcurrent: number };
  /** 0..100 — 100 minus penalties of the spatial issues. */
  score: number;
}

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const inside = (r: Rect, box: Rect, tol: number) => r.x >= box.x - tol && r.y >= box.y - tol && r.x + r.width <= box.x + box.width + tol && r.y + r.height <= box.y + box.height + tol;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Transitions that clip each scene to its side of a seam (no doubled text). */
const CLIPPED = new Set(['wipe', 'mask-wipe', 'glass-wipe', 'foreground-card-wipe', 'card-push-through', 'video-match-cut', 'iris', 'clock-wipe']);

/** Legacy presentations that travel along the reading direction (they ignore `direction`). */
const LEGACY_TRAVEL = new Set(['push', 'slide']);
/** Advanced transitions that travel along dirOf(direction | vector | reading direction). */
const ADVANCED_TRAVEL = new Set(['foreground-card-wipe', 'glass-wipe', 'directional-blur']);

/** Direction a transition carries the eye (unit vector), or null when it has none. */
export function transitionTravel(tr: NonNullable<VideoSpec['scenes'][number]['transition']>, language: string): { sx: number; sy: number } | null {
  const dsign: 1 | -1 = language === 'en' ? 1 : -1;
  if (LEGACY_TRAVEL.has(tr.type)) return { sx: dsign, sy: 0 };
  if (ADVANCED_TRAVEL.has(tr.type)) return dirOf({ direction: tr.direction, vector: tr.vector } as Parameters<typeof dirOf>[0], dsign);
  return null;
}

/**
 * Screen motion of a scene's camera over a window [t0, t1] (scene-local seconds) as a MotionVector, or
 * undefined when it holds still. Camera moves are deliberately small (a few % of the frame), so the
 * screen speed is weighted ×6: a drift of 5 % of the frame per second reads as clear motion (0.3).
 */
export function cameraVector(plan: CameraPlan | undefined, t0: number, t1: number, ctx: { W: number; H: number; durationSec: number; fps: number }): MotionVector | undefined {
  if (!planMoves(plan) || t1 <= t0) return undefined;
  const a = cameraAt(plan, t0, ctx);
  const b = cameraAt(plan, t1, ctx);
  const h = blurHint(a, b, 1);
  const dt = t1 - t0;
  const v = motionVector((h.vx / dt) * 6, (h.vy / dt) * 6, ctx.W, ctx.H, ((h.vs / dt) * 6) / 4, 0.5);
  return v.speed < 0.02 && Math.abs(v.depth ?? 0) < 0.03 ? undefined : v;
}

/** Spec-only spatial checks (no probes): depth clearance, motion continuity, effect and FX budgets. */
export function spatialSpecQc(spec: VideoSpec, tl: Timeline): { issues: VqaIssue[]; continuity: SpatialMetrics['continuity']; depth: { minClearance: number | null }; perf: Omit<SpatialMetrics['perf'], 'peakVideos' | 'peakLayers' | 'peakMotionBlur'>; fx: Omit<SpatialMetrics['fx'], 'peakConcurrent'> } {
  const issues: VqaIssue[] = [];
  const fps = spec.canvas.fps;
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  let minClear: number | null = null;
  const plans = spec.scenes.map((s) => resolvePlan(s.motion?.cameraPlan as CameraPlan | undefined));
  // ── depth: the hero plane never comes inside the near band unless the plan passes through it
  spec.scenes.forEach((s, i) => {
    const plan = plans[i];
    if (!planMoves(plan)) return;
    const e = tl.entries[i];
    const durationSec = e.durationInFrames / fps;
    const through = Boolean(plan!.passThrough);
    let worst = Infinity;
    let at = 0;
    for (let k = 0; k <= 24; k++) {
      const t = (durationSec * k) / 24;
      const c = clearance(0, cameraAt(plan, t, { W, H, durationSec }));
      if (c < worst) {
        worst = c;
        at = t;
      }
    }
    minClear = minClear === null ? worst : Math.min(minClear, worst);
    if (!through && worst < PASS_BAND[0]) {
      // repair: the largest amplitude that keeps the hero plane out of the near band (text and layout untouched)
      const raw = s.motion!.cameraPlan as CameraPlan;
      const fits = (amp: number) => {
        for (let k = 0; k <= 24; k++) if (clearance(0, cameraAt({ ...raw, amplitude: amp }, (durationSec * k) / 24, { W, H, durationSec })) < PASS_BAND[0] + 0.02) return false;
        return true;
      };
      let amp = plan!.amplitude;
      while (amp > 0.05 && !fits(amp)) amp = Math.round(amp * 0.85 * 1000) / 1000;
      const solved = amp > 0.05 ? { ...raw, amplitude: amp } : { ...raw, move: 'static' as const, preset: undefined, amplitude: 0 };
      issues.push({ severity: 'error', code: 'DEPTH_TOO_CLOSE', scene: s.id, sceneIndex: i, time: r3(e.startSec + at), message: `camera brings the hero plane to clearance ${worst.toFixed(2)} (near band starts at ${PASS_BAND[0].toFixed(2)}) — content would blow up past the lens`, fix: `amplitude ${plan!.amplitude} → ${solved.amplitude} (or the flythrough preset, which fades the plane as the lens passes it)`, repair: { action: 'camera-solve', data: { plan: solved } } });
    }
  });
  // ── motion continuity: each cut's outgoing vs incoming motion
  const cuts: SpatialMetrics['continuity']['cuts'] = [];
  for (let i = 0; i + 1 < spec.scenes.length; i++) {
    const a = spec.scenes[i];
    const b = spec.scenes[i + 1];
    const ea = tl.entries[i];
    const eb = tl.entries[i + 1];
    const tr = a.transition?.type ?? 'cut';
    // the moves ease to rest at the cut: their direction is read over the last / first 40 % of the scene
    const out = (a.transition?.vector as MotionVector | undefined) ?? cameraVector(plans[i], (ea.durationInFrames / fps) * 0.55, (ea.durationInFrames / fps) * 0.95, { W, H, durationSec: ea.durationInFrames / fps, fps }) ?? spatialEdge(a.type, a.variant).vector;
    const into = cameraVector(plans[i + 1], (eb.durationInFrames / fps) * 0.05, (eb.durationInFrames / fps) * 0.45, { W, H, durationSec: eb.durationInFrames / fps, fps }) ?? spatialEdge(b.type, b.variant).vector;
    const score = continuityScore(out, into, tr);
    cuts.push({ from: a.id, to: b.id, transition: tr, score });
    if (score < 0.45) issues.push({ severity: 'warning', code: 'CONTINUITY_BREAK', scene: b.id, sceneIndex: i + 1, time: r3(eb.startSec), message: `motion continuity ${score.toFixed(2)} on the cut ${a.id} → ${b.id} (${tr}): the incoming motion fights the outgoing one`, fix: 'match the direction of the two moves or bridge them with a continuity transition (push-through, directional blur, match cut)' });
  }
  const continuity = { score: cuts.length ? r3(cuts.reduce((x, c) => x + c.score, 0) / cuts.length) : 1, cuts };
  // ── performance budget (the effect cost the renderer will pay)
  const cost = estimateEffectCost(spec);
  if (cost.overBudget) issues.push({ severity: 'warning', code: 'PERF_BUDGET', message: `effect cost ${cost.score} (${cost.level}) is over the ${cost.budget} budget: ${cost.contributors.filter((c) => c.add >= 0.2).map((c) => c.source).join(', ')}`, fix: 'lighter families, fewer simultaneous videos or a flatter style — or raise design.effectBudget for an ADVANCED brief' });
  // ── FX budget: every accent on the film, hand-placed ones included
  const level = (spec.design.fxBudget ?? spec.design.effectBudget ?? 'MEDIUM') as FxBudgetLevel;
  const all: { kind: MicroFxKind; start: number; duration?: number; importance?: number; scene: string }[] = [];
  spec.scenes.forEach((s, i) => {
    for (const f of s.fx ?? []) all.push({ kind: f.kind, start: tl.entries[i].startSec + f.at, duration: f.duration, importance: f.importance ?? 0.9, scene: s.id });
  });
  const b = budgetFx(all, tl.totalSec, level);
  if (b.dropped.length) issues.push({ severity: 'warning', code: 'FX_BUDGET', scene: b.dropped[0].fx.scene, message: `${b.dropped.length} micro-FX accent(s) over the ${level} FX budget (${b.dropped[0].why})`, fix: 'drop the least important accents — an accent only lands when it is rare' });
  return {
    issues,
    continuity,
    depth: { minClearance: minClear === null ? null : r3(minClear) },
    perf: { score: cost.score, level: cost.level, budget: cost.budget, overBudget: cost.overBudget },
    fx: { count: all.length, cost: b.cost, dropped: b.dropped.length, level },
  };
}

/** Hero scene of a film: the declared one, else the first reveal / product / brand beat. */
export function heroSceneOf(spec: VideoSpec): number {
  const byId = spec.motion.heroScene ? spec.scenes.findIndex((s) => s.id === spec.motion.heroScene) : -1;
  if (byId >= 0) return byId;
  return spec.scenes.findIndex((s) => /^(reveal|product|brand|solution|hero)$/.test(s.beat ?? ''));
}

/** Full spatial QC on the structural probes (+ the spec checks). */
export function spatialQc(input: { spec: VideoSpec; tl: Timeline; samples: VqaSample[]; probes: Map<number, DomProbe>; canvas: CanvasProfile }): { issues: VqaIssue[]; metrics: SpatialMetrics } {
  const { spec, tl, samples, probes, canvas } = input;
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  const frame = W * H;
  const sp = spatialSpecQc(spec, tl);
  const issues: VqaIssue[] = [...sp.issues];
  const seen = new Set<string>();
  const once = (k: string) => (seen.has(k) ? false : (seen.add(k), true));
  let occlusions = 0;
  let peakVideos = 0;
  let peakLayers = 0;
  let peakBlur = 0;
  let peakFx = 0;
  const tol = canvas.u * 0.6;
  for (const smp of samples) {
    const p = probes.get(smp.frame);
    if (!p) continue;
    const base = { frame: smp.frame, time: Math.round(smp.time * 100) / 100, sceneIndex: smp.sceneIndex };
    // budgets measured on the frame
    peakVideos = Math.max(peakVideos, p.media.filter((m) => m.kind === 'video' && m.opacity > 0.05).length);
    peakLayers = Math.max(peakLayers, (p.layers ?? []).filter((l) => l.opacity * l.pass > 0.05).length);
    peakBlur = Math.max(peakBlur, p.motionBlur ?? 0);
    const fxCost = (p.fx ?? []).reduce((a, f) => a + f.kinds.reduce((x, k) => x + (FX_DEFS[k as MicroFxKind]?.cost ?? 0.5), 0), 0);
    peakFx = Math.max(peakFx, fxCost);
    // wipes clip each scene to its side of the seam: both solid is how they look, not a clash
    const clipT = spec.scenes[Math.max(0, smp.sceneIndex - 1)]?.transition?.type ?? '';
    const ownT = spec.scenes[smp.sceneIndex]?.transition?.type ?? '';
    if (smp.kind === 'transition' && !CLIPPED.has(clipT) && !CLIPPED.has(ownT)) {
      // outgoing and incoming text on top of each other (both solid) mid-transition
      const solid = p.texts.filter((t) => t.opacity > 0.6 && t.text.trim() && (t.critical || t.role === 'title' || t.role === 'headline'));
      for (const a of solid)
        for (const b of solid) {
          if (a.scene >= b.scene || !a.scene || !b.scene) continue;
          const ov = overlap(a.rect, b.rect) / Math.max(1, Math.min(area(a.rect), area(b.rect)));
          if (ov > 0.3 && once(`clash|${a.scene}|${b.scene}`)) issues.push({ ...base, scene: b.scene, severity: 'warning', code: 'TRANSITION_TEXT_CLASH', element: `"${a.text.slice(0, 20)}" × "${b.text.slice(0, 20)}"`, message: `outgoing and incoming text are both solid and overlap ${Math.round(ov * 100)}% mid-transition`, fix: 'stagger the incoming text after the transition, or use a transition that clears the frame first' });
        }
    }
    if (!SETTLED.includes(smp.kind)) continue;
    // depth occlusion: a card / small layer in front of the hero plane over critical text, product or logo
    const front = (p.layers ?? []).filter((l) => l.depth < -0.05 && l.opacity * l.pass > 0.5 && (l.card || area(l.rect) < frame * 0.6));
    const guarded: { scene: string; rect: Rect; label: string }[] = [
      ...p.texts.filter((t) => t.opacity > 0.55 && t.critical && t.text.trim()).map((t) => ({ scene: t.scene, rect: t.rect, label: `${t.role}:"${t.text.slice(0, 24)}"` })),
      ...p.media.filter((m) => m.identity && m.opacity > 0.55).map((m) => ({ scene: m.scene, rect: m.rect, label: `${m.role}:${m.src}` })),
    ];
    for (const g of guarded)
      for (const l of front) {
        if (l.scene && g.scene && l.scene !== g.scene) continue;
        const ov = overlap(g.rect, l.rect) / Math.max(1, area(g.rect));
        if (ov > 0.25 && once(`occ|${g.scene}|${g.label}`)) {
          occlusions++;
          issues.push({ ...base, scene: g.scene || smp.scene, severity: 'error', code: 'DEPTH_OCCLUSION', element: g.label, message: `a ${l.card ? 'card' : 'layer'} at depth ${l.depth.toFixed(2)} (in front of the hero plane) covers ${Math.round(ov * 100)}% of ${g.label}`, fix: 'move the foreground card off the subject, push it behind the hero plane, or let it pass through before the hold' });
        }
      }
    // safe areas for identity media (text has its own checks)
    for (const m of p.media) {
      if (!m.identity || m.opacity < 0.85 || area(m.rect) < 16) continue;
      if (m.role === 'logo' && !inside(m.rect, canvas.safe, tol) && once(`logo-safe|${m.scene}`)) issues.push({ ...base, scene: m.scene || smp.scene, severity: 'warning', code: 'LOGO_OUTSIDE_SAFE', element: `${m.role}:${m.src}`, message: `the logo leaves the ${spec.safeArea.preset} safe area (platform UI may cover it)`, fix: 'scale the logo down or move it inside the safe area', repair: { action: 'shrink-layout' } });
      if (m.role !== 'logo') {
        const cx = m.rect.x + m.rect.width / 2;
        const cy = m.rect.y + m.rect.height / 2;
        const s = canvas.safe;
        if ((cx < s.x || cx > s.x + s.width || cy < s.y || cy > s.y + s.height) && once(`hero-safe|${m.scene}|${m.src}`)) issues.push({ ...base, scene: m.scene || smp.scene, severity: 'warning', code: 'HERO_OUTSIDE_SAFE', element: `${m.role}:${m.src}`, message: `the ${m.role}'s centre sits outside the safe area`, fix: 're-centre the subject (camera target or layout)' });
      }
    }
  }
  // ── hero visibility
  let hero: SpatialMetrics['hero'] = null;
  const hi = heroSceneOf(spec);
  if (hi >= 0) {
    const hs = spec.scenes[hi];
    let found = false;
    let best = 0;
    let label: string | null = null;
    const heroSamples = samples.filter((x) => x.sceneIndex === hi && SETTLED.includes(x.kind));
    for (const smp of heroSamples) {
      const p = probes.get(smp.frame);
      if (!p) continue;
      // the hero is the user's product, else the scene's media (video cards…), else its critical text
      const ident = p.media.filter((m) => m.scene === hs.id && m.identity && m.role !== 'logo');
      const any = p.media.filter((m) => m.scene === hs.id && m.role !== 'logo' && area(m.rect) > 16);
      const media = ident.length ? ident : any;
      const cands: { rect: Rect; opacity: number; label: string; media: boolean }[] = media.length
        ? media.map((m) => ({ rect: m.rect, opacity: m.opacity, label: `${m.role || m.kind}:${m.src}`, media: true }))
        : p.texts.filter((t) => t.scene === hs.id && t.critical && t.text.trim()).map((t) => ({ rect: t.rect, opacity: t.opacity, label: `${t.role}:"${t.text.slice(0, 24)}"`, media: false }));
      for (const c of cands) {
        found = true;
        label = label ?? c.label;
        const vis = overlap(c.rect, { x: 0, y: 0, width: W, height: H }) / Math.max(1, area(c.rect));
        if (c.opacity >= 0.85 && vis >= 0.9) {
          const cov = area(c.rect) / frame;
          if (cov > best) {
            best = cov;
            label = c.label;
          }
        }
      }
    }
    if (found) {
      const visible = best > 0;
      hero = { scene: hs.id, element: label, visible, coverage: r3(best) };
      if (!visible) issues.push({ severity: 'error', code: 'HERO_NOT_VISIBLE', scene: hs.id, sceneIndex: hi, element: label ?? undefined, message: `the hero (${label}) is never fully visible while its scene holds`, fix: 'hold the hero on screen, unoccluded and inside the frame, for at least one settled beat', repair: { action: 'extend', value: 0.4 } });
      else if (label && !label.includes('"') && best < 0.04) issues.push({ severity: 'warning', code: 'HERO_TOO_SMALL', scene: hs.id, sceneIndex: hi, element: label, message: `the hero covers only ${Math.round(best * 1000) / 10}% of the frame at its best moment`, fix: 'frame it larger (camera target fill) — the hero should own the frame' });
    } else hero = { scene: hs.id, element: null, visible: false, coverage: 0 };
  }
  // ── transition corridor: the eye travels with the transition; the next focal point must not land behind it
  const corridors: SpatialMetrics['corridors'] = [];
  const focal = (i: number, last: boolean): { x: number; y: number } | null => {
    const list = samples.filter((x) => x.sceneIndex === i && (SETTLED.includes(x.kind) || x.kind === 'transition-end'));
    const pick = last ? list[list.length - 1] : list.find((x) => x.kind === 'transition-end') ?? list[0];
    const p = pick ? probes.get(pick.frame) : undefined;
    if (!p) return null;
    const id = spec.scenes[i].id;
    const els = [...p.media.filter((m) => m.scene === id && m.identity && m.opacity > 0.5).map((m) => m.rect), ...p.texts.filter((t) => t.scene === id && t.opacity > 0.5 && (t.critical || t.role === 'title' || t.role === 'headline')).map((t) => t.rect)];
    if (!els.length) return null;
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const r of els) {
      const w = Math.max(1, area(r));
      sx += (r.x + r.width / 2) * w;
      sy += (r.y + r.height / 2) * w;
      sw += w;
    }
    return { x: sx / sw / W, y: sy / sw / H };
  };
  for (let i = 0; i + 1 < spec.scenes.length; i++) {
    const tr = spec.scenes[i].transition;
    const d = tr ? transitionTravel(tr, spec.project.language) : null;
    if (!tr || !d) continue;
    const a = focal(i, true);
    const b = focal(i + 1, false);
    if (!a || !b) continue;
    // the component of the focal jump that runs against the transition's travel
    const against = -((b.x - a.x) * d.sx + (b.y - a.y) * d.sy);
    const ok = against <= 0.35;
    corridors.push({ cut: `${spec.scenes[i].id}→${spec.scenes[i + 1].id}`, ok, against: r3(against) });
    if (!ok) issues.push({ severity: 'warning', code: 'TRANSITION_CORRIDOR', scene: spec.scenes[i + 1].id, sceneIndex: i + 1, time: r3(tl.entries[i + 1].startSec), message: `${tr.type}${tr.direction ? ` ${tr.direction}` : ''} carries the eye one way, but the next subject lands ${Math.round(against * 100)}% of the frame back the other way`, fix: 'flip the transition direction or place the incoming subject on the side the motion travels to' });
  }
  // ── measured performance on the frames
  if (peakVideos > 6) issues.push({ severity: 'warning', code: 'PERF_LAYERS', message: `${peakVideos} videos decode on one frame — slow renders and dropped frames on preview`, fix: 'show fewer live videos at once (stills for the far cards)' });
  if (peakBlur > 2) issues.push({ severity: 'warning', code: 'PERF_LAYERS', message: `${peakBlur} camera layers with velocity blur on one frame`, fix: 'motion blur on the hero camera only' });
  const level = sp.fx.level;
  if (peakFx > FX_BUDGET[level].concurrent + 1e-6) issues.push({ severity: 'warning', code: 'FX_BUDGET', message: `micro FX on screen at once cost ${peakFx.toFixed(1)} (concurrent limit ${FX_BUDGET[level].concurrent} at ${level})`, fix: 'space the accents out' });
  const PEN: Record<Severity, number> = { critical: 30, error: 15, warning: 5, info: 0 };
  const score = Math.max(0, 100 - issues.reduce((a, i) => a + PEN[i.severity], 0));
  return {
    issues,
    metrics: {
      continuity: sp.continuity,
      hero,
      corridors,
      depth: { minClearance: sp.depth.minClearance, occlusions },
      perf: { ...sp.perf, peakVideos, peakLayers, peakMotionBlur: peakBlur },
      fx: { ...sp.fx, peakConcurrent: r3(peakFx) },
      score,
    },
  };
}
