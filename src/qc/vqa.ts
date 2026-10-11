/**
 * Visual QA 2.0 — checks a director would make on the frames that matter,
 * using the DOM probes (true geometry after every transform) of the sampled
 * frames. Inspired by anymotion's seek-and-audit approach (MIT): sample the
 * timeline at meaningful moments, measure, report with a concrete fix.
 *
 *   camera framing     measured rects are un-projected to rest, then the whole
 *                      camera move is audited (safe area, crop, collision,
 *                      occlusion, text speed) and SOLVED (re-aim → smaller → still)
 *   product protection colour filters / non-uniform scale on product & logo
 *   obstruction        text covering the product or the logo
 *   composition        visual balance (mass centroid) and empty frames
 *   RTL                Latin punctuation / leading punctuation in Arabic lines
 *
 * Also: category scores (composition, motion, typography, camera, brand, audio,
 * technical, overall) used as a delivery gate, and the sample moments of a film
 * (hero, mid-motion, transition end, logo reveal, CTA).
 */
import type { VideoSpec } from '../schema/video';
import type { Timeline } from '../core/timeline';
import type { ProbeResult as DomProbe } from '../engine/QCProbe';
import type { CanvasProfile } from '../layout/canvas';
import { SceneRegistry } from '../scenes';
import { cameraAt, type CameraPlan } from '../camera/moves';
import { auditFraming, solveFraming, type FramingResult, type ProtectedElement } from '../camera/framing';
import { perspectiveOf, unprojectRect, type RectPx } from '../camera/rig';
import type { Severity } from '../validation/validate';

export type SampleKind = 'hold' | 'transition' | 'edge' | 'hero' | 'mid' | 'transition-end' | 'logo' | 'cta';

export interface VqaSample {
  frame: number;
  time: number;
  scene: string;
  sceneIndex: number;
  kind: SampleKind;
}

export interface VqaIssue {
  severity: Severity;
  code: string;
  message: string;
  scene?: string;
  sceneIndex?: number;
  frame?: number;
  time?: number;
  element?: string;
  fix?: string;
  repair?: { action: string; value?: number; data?: Record<string, unknown> };
}

/** Settled moments: the checks that need a resting composition use these. */
export const SETTLED: SampleKind[] = ['hold', 'hero', 'logo', 'cta'];

/** Extra sample moments (Visual QA 2.0) on top of the hold/transition/edge samples. */
export function momentSamples(spec: VideoSpec, tl: Timeline): VqaSample[] {
  const fps = spec.canvas.fps;
  const out: VqaSample[] = [];
  const at = (i: number, frame: number, kind: SampleKind) => out.push({ frame: Math.max(0, Math.min(tl.totalFrames - 1, Math.round(frame))), time: 0, scene: tl.entries[i].id, sceneIndex: i, kind });
  tl.entries.forEach((e, i) => {
    const s = spec.scenes[i];
    const m = SceneRegistry.get(s.type)?.manifest;
    // mid-motion: inside the entrance (elements are still travelling — overflow/clipping/camera)
    at(i, e.from + e.transitionIn + Math.min(0.35 * fps, e.durationInFrames * 0.15), 'mid');
    // transition end: the first frame where the incoming scene is fully on screen
    if (i > 0 && e.transitionIn > 0) at(i, e.from + e.transitionIn + 1, 'transition-end');
    if (spec.motion.heroScene === s.id) at(i, e.from + e.durationInFrames * 0.6, 'hero');
    if (s.type === 'logo-animation' || m?.category === 'brand') at(i, e.from + e.durationInFrames - e.transitionOut - Math.round(0.25 * fps), 'logo');
    if (i === tl.entries.length - 1 && (m?.category === 'cta' || s.beat === 'cta')) at(i, e.from + e.durationInFrames - Math.round(0.2 * fps), 'cta');
  });
  return out.map((s) => ({ ...s, time: s.frame / fps }));
}

const area = (r: RectPx) => Math.max(0, r.width) * Math.max(0, r.height);
const overlap = (a: RectPx, b: RectPx) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const inside = (r: RectPx, box: RectPx, tol: number) => r.x >= box.x - tol && r.y >= box.y - tol && r.x + r.width <= box.x + box.width + tol && r.y + r.height <= box.y + box.height + tol;

export interface VqaResult {
  cameraScenes: Map<string, FramingResult>;
  issues: VqaIssue[];
}

export function visualQa(input: { spec: VideoSpec; tl: Timeline; samples: VqaSample[]; probes: Map<number, DomProbe>; canvas: CanvasProfile }): VqaResult {
  const { spec, tl, samples, probes, canvas } = input;
  const fps = spec.canvas.fps;
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  const D = perspectiveOf(W, H);
  const issues: VqaIssue[] = [];
  const cameraScenes = new Map<string, FramingResult>();

  // ── camera framing (measured truth, whole move audited) ─────────────────────
  spec.scenes.forEach((sc, i) => {
    const plan = sc.motion?.cameraPlan as CameraPlan | undefined;
    if (!plan || plan.move === 'static' || !(plan.amplitude > 0)) return;
    const e = tl.entries[i];
    const durationSec = e.durationInFrames / fps;
    const els = new Map<string, ProtectedElement>();
    for (const smp of samples.filter((x) => x.sceneIndex === i && SETTLED.includes(x.kind))) {
      const p = probes.get(smp.frame);
      if (!p) continue;
      const cam = cameraAt(plan, (smp.frame - e.from) / fps, { W, H, durationSec });
      for (const t of p.texts) {
        if (t.scene !== sc.id || t.opacity < 0.55 || !t.text.trim()) continue;
        if (!(t.critical || t.role === 'title' || t.role === 'subtitle')) continue;
        const rest = unprojectRect(t.rect, 0, cam, W, H, D);
        if (rest) els.set(`text:${t.role}:${t.text.slice(0, 24)}`, { rect: rest, kind: t.role === 'cta' ? 'cta' : 'text', importance: t.critical ? 1 : 0.6, label: `${t.role}:"${t.text.slice(0, 24)}"` });
      }
      for (const m of p.media) {
        if (m.scene !== sc.id || !m.identity || m.opacity < 0.55) continue;
        const rest = unprojectRect(m.rect, 0, cam, W, H, D);
        if (rest) els.set(`media:${m.role}:${m.src}`, { rect: rest, kind: m.role === 'logo' ? 'logo' : 'product', importance: 0.9, label: `${m.role}:${m.src}` });
      }
    }
    // an element already outside the safe area at rest is a layout problem, not the camera's
    const tol = canvas.u * 0.6;
    const list = [...els.values()].filter((el) => (el.kind === 'product' ? inside(el.rect, { x: 0, y: 0, width: W, height: H }, tol) : inside(el.rect, canvas.safe, tol)));
    if (!list.length) return;
    const ctx = { W, H, durationSec, D, safe: canvas.safe, u: canvas.u };
    const audit = auditFraming(plan, list, ctx);
    if (!audit.violations.length) return;
    const solved = solveFraming(plan, list, ctx);
    cameraScenes.set(sc.id, solved);
    const kinds = [...new Set(audit.violations.map((v) => v.problem))];
    const worst = audit.violations.find((v) => v.problem !== 'too-fast') ?? audit.violations[0];
    issues.push({
      severity: kinds.some((k) => k !== 'too-fast') ? 'error' : 'warning',
      code: 'CAMERA_FRAMING',
      scene: sc.id,
      sceneIndex: i,
      time: Math.round((e.startSec + worst.t) * 100) / 100,
      element: worst.label,
      message: `camera ${plan.move} (amplitude ${plan.amplitude}) breaks framing: ${kinds.join(', ')} — ${worst.label ?? worst.kind} at ${worst.t.toFixed(2)}s`,
      fix: `solver: ${solved.note}`,
      repair: { action: 'camera-solve', data: { plan: solved.plan } },
    });
  });

  // ── per-frame checks on settled moments ──────────────────────────────────────
  const seen = new Set<string>();
  const once = (k: string) => (seen.has(k) ? false : (seen.add(k), true));
  for (const smp of samples) {
    const p = probes.get(smp.frame);
    if (!p) continue;
    const settled = SETTLED.includes(smp.kind);
    const base = { frame: smp.frame, time: Math.round(smp.time * 100) / 100, scene: smp.scene, sceneIndex: smp.sceneIndex };
    // product protection: colour filters or non-uniform scale on the user's product / logo
    for (const m of p.media) {
      if (!m.identity || m.opacity < 0.9 || !settled) continue;
      if (m.colorFilter && once(`filter|${m.scene}|${m.src}`)) issues.push({ ...base, scene: m.scene || smp.scene, severity: 'critical', code: 'PRODUCT_ALTERED', element: `${m.role}:${m.src}`, message: `${m.role} is shown with a colour-changing filter (${m.colorFilter}) — the product must look exactly as supplied`, fix: 'remove the filter from this element (light it with the scene, never recolour it)' });
      if (m.layoutW && m.layoutH && m.rect.width > 4 && m.rect.height > 4) {
        const k = m.rect.width / m.rect.height / (m.layoutW / m.layoutH);
        if ((k > 1.04 || k < 0.96) && once(`aspect|${m.scene}|${m.src}`)) issues.push({ ...base, scene: m.scene || smp.scene, severity: 'critical', code: 'PRODUCT_DISTORTED', element: `${m.role}:${m.src}`, message: `${m.role} is stretched on screen (aspect ×${k.toFixed(3)}) by a non-uniform transform` });
      }
    }
    if (!settled) continue;
    const texts = p.texts.filter((t) => t.opacity > 0.55 && t.text.trim() && t.scene === smp.scene);
    // obstruction: words over the product / logo
    for (const m of p.media.filter((x) => x.identity && x.opacity > 0.9 && x.scene === smp.scene && (x.role === 'product' || x.role === 'logo'))) {
      const ma = area(m.rect);
      if (ma < 100) continue;
      for (const t of texts) {
        if (['label', 'eyebrow', 'number', 'caption'].includes(t.role)) continue;
        const k = overlap(t.rect, m.rect) / ma;
        if (k > 0.15 && once(`obs|${smp.scene}|${t.text}|${m.src}`))
          issues.push({ ...base, severity: k > 0.3 ? 'error' : 'warning', code: 'PRODUCT_OBSTRUCTED', element: `${t.role}:"${t.text.slice(0, 24)}"`, message: `${t.role} covers ${Math.round(k * 100)}% of the ${m.role}`, fix: 'move or shrink the text so the product/logo stays clear', repair: { action: 'shrink-layout' } });
      }
    }
    // composition: balance + empty frame (one verdict per scene, on its last settled sample)
    const rects = [...texts.map((t) => t.rect), ...p.media.filter((m) => m.opacity > 0.55 && m.scene === smp.scene).map((m) => m.rect), ...(p.boxes ?? []).filter((b) => b.opacity > 0.55 && b.scene === smp.scene).map((b) => b.rect)].filter((r) => area(r) > 0);
    const lastSettled = [...samples].reverse().find((x) => x.sceneIndex === smp.sceneIndex && SETTLED.includes(x.kind));
    if (lastSettled?.frame !== smp.frame) continue;
    if (!rects.length) continue;
    const s0 = canvas.safe;
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.width));
    const y1 = Math.max(...rects.map((r) => r.y + r.height));
    const cov = ((x1 - x0) * (y1 - y0)) / area(s0);
    if (cov < 0.05) issues.push({ ...base, severity: 'warning', code: 'FRAME_EMPTY', message: `content covers only ${Math.round(cov * 100)}% of the safe area — the frame reads empty`, repair: { action: 'grow-layout', value: 1.15 } });
    const mass = rects.reduce((a, r) => a + area(r), 0);
    const cx = rects.reduce((a, r) => a + (r.x + r.width / 2) * area(r), 0) / mass;
    const cy = rects.reduce((a, r) => a + (r.y + r.height / 2) * area(r), 0) / mass;
    const dx = (cx - (s0.x + s0.width / 2)) / s0.width;
    const dy = (cy - (s0.y + s0.height / 2)) / s0.height;
    if (Math.abs(dx) > 0.24 || Math.abs(dy) > 0.3) issues.push({ ...base, severity: 'warning', code: 'COMPOSITION_UNBALANCED', message: `visual weight sits ${Math.abs(dx) > 0.24 ? `${Math.round(Math.abs(dx) * 100)}% ${dx > 0 ? 'right' : 'left'}` : `${Math.round(Math.abs(dy) * 100)}% ${dy > 0 ? 'low' : 'high'}`} of centre with nothing to balance it`, fix: 'centre the group or give the empty side a counterweight (media, card, brand form)' });
  }
  // RTL punctuation in Arabic copy
  for (const p of probes.values())
    for (const t of p.texts) {
      if (!t.arabic || !t.text.trim()) continue;
      const bad = /^[.,!?:;،؛؟)\]]/.test(t.text.trim()) ? 'starts with punctuation' : /[؀-ۿ]\s*[?;,]/.test(t.text) ? 'Latin ? ; , after Arabic (use ؟ ؛ ،)' : null;
      if (bad && once(`rtl|${t.scene}|${t.text}`)) issues.push({ severity: 'warning', code: 'RTL_PUNCTUATION', scene: t.scene, element: `${t.role}:"${t.text.slice(0, 24)}"`, message: `Arabic line ${bad}` });
    }
  return { cameraScenes, issues };
}

// ── category scores (the delivery gate) ─────────────────────────────────────────
export const CATEGORIES = ['composition', 'motion', 'typography', 'camera', 'brand', 'audio', 'technical'] as const;
export type Category = (typeof CATEGORIES)[number];

export function categoryOf(code: string, pass?: string): Category {
  if (/^CAMERA_/.test(code)) return 'camera';
  if (/^(TEXT_(?!OVERLAP)|ARABIC_|RTL_|PHONE_)/.test(code)) return 'typography';
  if (/^(MEDIA_|PRODUCT_(?!OBSTRUCTED)|LOGO_|DEVELOPER_SIGNATURE|MP4_SIGNATURE|PERSONALITY_MISMATCH|BRAND_)/.test(code)) return 'brand';
  if (/^(AUDIO_|SFX_|SOUND_|MUSIC_)/.test(code) || pass === 'audio') return 'audio';
  if (/^(SCENE_CRASHED|PROBE_MISSING|FONT_LOAD_FAILED|DEBUG_OVERLAY|BLANK_FRAME|MP4_|ENCODER_|LOOP_SEAM|MOTION_NONDETERMINISTIC)/.test(code) || pass === 'technical') return 'technical';
  if (pass === 'motion' || /^(HOLD_|VOICE_|MOTION_|TRANSITION_)/.test(code)) return 'motion';
  return 'composition';
}

const PENALTY: Record<Severity, number> = { critical: 40, error: 15, warning: 5, info: 0 };
export const GATE = { category: 50, overall: 70 };

export function categoryScores(issues: { code: string; severity: Severity; pass?: string }[], ran: Category[]): Record<Category | 'overall', number> {
  const s = Object.fromEntries(CATEGORIES.map((c) => [c, 100])) as Record<Category | 'overall', number>;
  for (const i of issues) {
    const c = categoryOf(i.code, i.pass);
    s[c] = Math.max(0, s[c] - PENALTY[i.severity]);
  }
  const w: Record<Category, number> = { composition: 1.2, typography: 1.2, motion: 1, camera: 0.8, brand: 1.1, audio: 0.9, technical: 1 };
  const tot = ran.reduce((a, c) => a + w[c], 0) || 1;
  s.overall = Math.round(ran.reduce((a, c) => a + s[c] * w[c], 0) / tot);
  if (issues.some((i) => i.severity === 'critical')) s.overall = Math.min(s.overall, 59);
  return s;
}

export function gateOk(scores: Record<string, number>, ran: Category[]): boolean {
  return ran.every((c) => scores[c] >= GATE.category) && scores.overall >= GATE.overall;
}
