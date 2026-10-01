/**
 * Mandatory QC agent, staged so it costs as little as possible:
 *
 *  STRUCTURAL QC (before any full render) — runs on cached, parallel DOM probes
 *  (src/qc/probes.ts) and their half-size stills. Three passes:
 *    1. structure: fit, overflow, safe area, overlap, fonts, media, Arabic shaping, watermark
 *    2. design:    banned patterns (spec + pixel detector), contrast, phone readability, fill
 *    3. motion:    reading time, voice sync, purpose, camera/transition monotony, personality
 *  FINAL TECHNICAL QC (after the production render) — reuses the structural probes
 *  (no second browser pass) and decodes the MP4 once for every sampled frame:
 *    4. technical: container, codec, duration, audio, blank frames, pixel contrast and
 *       patterns on the real output, loop seam, metadata signatures.
 *
 * Writes quality-report.json (+ contact sheet and phone-view sheet). Delivery requires
 * every acceptance rule to pass (zero critical issues, no dots, no watermark, …).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { makeCanvasProfile, type CanvasProfile } from '../layout/canvas';
import { SceneRegistry } from '../scenes';
import { contrastRatio, normalizeHex } from '../brand/color';
import { DEVELOPER_SIGNATURES, type Severity } from '../validation/validate';
import { planSfx } from '../audio/mix';
import { probe, loudness, ffmpegRun } from '../node/audio';
import type { ProbeResult as DomProbe, ProbeText } from '../engine/QCProbe';
import { log } from '../core/logger';
import { sampleFrames, collectProbes, type Sample } from './probes';
import { detectPatterns, type Rect } from './pattern-detect';
import { checkBannedPatterns } from '../design/banned';
import { cached, fileHash, hashOf } from '../cache/store';
import { resolveStyle } from '../styles/resolve';
import { compatiblePersonalities, STYLE_PERSONALITY, type MotionPersonalityId } from '../motion/personality';

export { sampleFrames, collectProbes } from './probes';

export type QcPass = 'structure' | 'design' | 'motion' | 'audio' | 'technical';

export interface QcIssue {
  severity: Severity;
  code: string;
  message: string;
  pass?: QcPass;
  scene?: string;
  sceneIndex?: number;
  frame?: number;
  time?: number;
  element?: string;
  /** Concrete, actionable fix in one sentence. */
  fix?: string;
  /** Machine-readable hint for the repair loop. */
  repair?: { action: string; value?: number };
}

export interface QualityReport {
  version: '2.0';
  project: string;
  video: string | null;
  stage: 'structure' | 'final';
  profile?: string;
  createdAt: string;
  passed: boolean;
  summary: Record<Severity, number>;
  scores: Record<QcPass | 'overall', number>;
  acceptance: { rule: string; ok: boolean }[];
  critique: string[];
  checks: Record<string, 'pass' | 'fail' | 'skipped'>;
  issues: QcIssue[];
  samples: { frame: number; time: number; scene: string; kind: 'hold' | 'transition' | 'edge' }[];
  media?: { duration: number; width?: number; height?: number; fps?: number; codec?: string; pixFmt?: string; hasAudio: boolean; bytes?: number };
  audio?: { integratedLufs: number | null; truePeak: number | null; meanVolume: number | null; maxVolume: number | null };
  contactSheet?: string;
  phoneSheet?: string;
  repairPass?: number;
  timings: Record<string, number>;
  probeCache?: { rendered: number; cached: number };
}

/** What a structural run leaves behind for the final pass (so nothing is probed twice). */
export interface StructuralQc {
  report: QualityReport;
  samples: Sample[];
  probes: Map<number, DomProbe>;
  stills: Map<number, string>;
}

export function severityRank(s: Severity): number {
  return { info: 0, warning: 1, error: 2, critical: 3 }[s];
}

// ── geometry helpers ────────────────────────────────────────────────────────────
function rectInside(r: Rect, box: Rect, tol = 2) {
  return r.x >= box.x - tol && r.y >= box.y - tol && r.x + r.width <= box.x + box.width + tol && r.y + r.height <= box.y + box.height + tol;
}
function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
function hexOf(color: string): string | null {
  if (color.startsWith('#')) return normalizeHex(color);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

/** Estimates text/background contrast inside a text rect from real pixels. */
async function pixelContrast(png: string, rect: Rect, textHex: string, scale: number, imgW: number, imgH: number): Promise<number | null> {
  const x = Math.max(0, Math.floor(rect.x * scale));
  const y = Math.max(0, Math.floor(rect.y * scale));
  const w = Math.min(imgW - x, Math.ceil(rect.width * scale));
  const h = Math.min(imgH - y, Math.ceil(rect.height * scale));
  if (w < 4 || h < 4) return null;
  const { data, info } = await sharp(png).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tr = parseInt(textHex.slice(1, 3), 16);
  const tg = parseInt(textHex.slice(3, 5), 16);
  const tb = parseInt(textHex.slice(5, 7), 16);
  const bg: number[][] = [];
  for (let i = 0; i < data.length; i += info.channels) {
    const d = Math.abs(data[i] - tr) + Math.abs(data[i + 1] - tg) + Math.abs(data[i + 2] - tb);
    if (d > 120) bg.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (bg.length < 20) return null;
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  bg.sort((a, b) => lum(a) - lum(b));
  const med = bg[Math.floor(bg.length / 2)];
  return contrastRatio(textHex, '#' + med.map((v) => v.toString(16).padStart(2, '0')).join(''));
}

/** Rectangles to ignore in pattern detection: text (Arabic i'jam dots), media, cards. */
function patternMasks(p: DomProbe | undefined, scale: number): Rect[] {
  if (!p) return [];
  const all = [...p.texts.filter((t) => t.opacity > 0.05).map((t) => t.rect), ...p.media.filter((m) => m.opacity > 0.05).map((m) => m.rect), ...(p.boxes ?? []).filter((b) => b.opacity > 0.05).map((b) => b.rect)];
  return all.map((r) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale }));
}

/** Pixel pattern scan of one PNG, cached by image bytes + masks. */
async function scanPatterns(png: string, masks: Rect[]) {
  return cached('patterns', hashOf('pat-v2', fileHash(png), masks), async () => {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    return detectPatterns(data, info.width, info.height, masks);
  });
}

/** A detected pattern the user explicitly asked for (design.allowPatterns) is reported, not blocked. */
const PATTERN_ALLOW: Record<string, string[]> = { 'dot-lattice': ['dots', 'halftone'], 'particle-field': ['particles', 'bokeh', 'dots'], 'line-grid': ['grid', 'lines'] };
function patternAllowed(spec: VideoSpec, kind: string): boolean {
  return (PATTERN_ALLOW[kind] ?? []).some((k) => (spec.design.allowPatterns as string[]).includes(k));
}

// ── phone readability ──────────────────────────────────────────────────────────
/** Width (CSS px) the video occupies on a typical phone: full width in a feed. */
export function phoneViewWidth(spec: VideoSpec): number {
  return spec.canvas.width > spec.canvas.height * 1.2 ? 640 : 390;
}
const PHONE_MIN: Record<string, number> = { headline: 12, title: 12, cta: 10, number: 10, body: 9, subtitle: 9, label: 7.5, caption: 7.5, eyebrow: 7.5 };

// ── scoring / critique / acceptance ───────────────────────────────────────────
const PENALTY: Record<Severity, number> = { critical: 40, error: 15, warning: 5, info: 0 };
function scoresOf(issues: QcIssue[], passes: QcPass[]): QualityReport['scores'] {
  const s = { structure: 100, design: 100, motion: 100, audio: 100, technical: 100, overall: 100 } as QualityReport['scores'];
  for (const i of issues) if (i.pass) s[i.pass] = Math.max(0, s[i.pass] - PENALTY[i.severity]);
  const ran = passes.map((p) => s[p]);
  s.overall = Math.round(ran.reduce((a, b) => a + b, 0) / ran.length);
  if (issues.some((i) => i.severity === 'critical')) s.overall = Math.min(s.overall, 59);
  return s;
}

const PATTERN_CODES = new Set(['PATTERN_IN_FRAME', 'BANNED_DOTTED-BACKGROUND', 'BANNED_PARTICLE-FIELD', 'BANNED_GENERIC-TECH-GRID']);
function acceptanceOf(issues: QcIssue[], stage: 'structure' | 'final', checks: QualityReport['checks']) {
  const none = (pred: (i: QcIssue) => boolean) => !issues.some(pred);
  const rules: { rule: string; ok: boolean }[] = [
    { rule: 'zero critical issues', ok: none((i) => i.severity === 'critical') },
    { rule: 'no dot / particle / grid background', ok: none((i) => PATTERN_CODES.has(i.code) && i.severity !== 'info') },
    { rule: 'no watermark or developer signature', ok: none((i) => i.code === 'DEVELOPER_SIGNATURE' || i.code === 'MP4_SIGNATURE') },
    { rule: 'no clipped or off-canvas text', ok: none((i) => (i.code === 'TEXT_FIT_FAIL' || i.code === 'TEXT_OFF_CANVAS' || i.code === 'TEXT_OVERFLOW') && severityRank(i.severity) >= 2) },
    { rule: 'text readable (no contrast / phone-size errors)', ok: none((i) => ['TEXT_CONTRAST_LOW', 'PHONE_UNREADABLE'].includes(i.code) && severityRank(i.severity) >= 2) },
    { rule: 'all fonts loaded', ok: checks.fonts !== 'fail' },
    { rule: 'user media intact (no distortion / broken assets)', ok: none((i) => i.code === 'MEDIA_DISTORTED' || i.code === 'MEDIA_BROKEN') },
    { rule: 'CTA readable when the film ends on one', ok: checks.cta !== 'fail' },
    { rule: 'no debug overlay in output', ok: none((i) => i.code === 'DEBUG_OVERLAY') },
  ];
  if (stage === 'final') {
    rules.push({ rule: 'valid H.264/yuv420p MP4 at the right size, fps and duration', ok: none((i) => i.code.startsWith('MP4_') && severityRank(i.severity) >= 2 && i.code !== 'MP4_SIGNATURE') });
    rules.push({ rule: 'audio present and not clipping when planned', ok: checks.audio !== 'fail' });
    rules.push({ rule: 'no sound file repeated back-to-back', ok: none((i) => i.code === 'SFX_REPEAT_CONSECUTIVE' && severityRank(i.severity) >= 2) });
    rules.push({ rule: 'no blank frames', ok: checks.blank !== 'fail' });
  }
  return rules;
}

const FIX: Record<string, string> = {
  TEXT_FIT_FAIL: 'shorten the line or give it one more line (layout.maxLines); the repair loop lowers textScale',
  TEXT_OVERFLOW: 'a single word is wider than its box — shorten it or lower textScale',
  TEXT_OFF_CANVAS: 'reduce layout.scale for this scene so the text stays inside the frame',
  TEXT_OUTSIDE_SAFE: 'reduce layout.scale; platform UI covers this area',
  TEXT_TOO_SMALL: 'raise textScale or cut copy so the type can be larger',
  PHONE_UNREADABLE: 'on a phone this text is too small — cut words or raise textScale',
  TEXT_OVERLAP: 'reduce layout.scale or shorten one of the overlapping lines',
  TEXT_CONTRAST_LOW: 'enable layout.scrim or use a contrast-safe text colour from brand.json',
  PATTERN_IN_FRAME: 'switch the scene background to a clean kind (soft-gradient / radial-light / brand-shapes)',
  LAYOUT_UNDERFILLED: 'scale the content up (layout.scale) so it holds the frame',
  HOLD_TOO_SHORT: 'extend the scene or cut words so it can be read',
  VOICE_DRIFT: 'move the scene cut to the voice phrase start',
  CTA_NOT_VISIBLE: 'extend the CTA scene so it settles fully before the end',
  MOTION_NO_PURPOSE: 'give each scene a motion job (reveal, focus, connect, prove, resolve)',
  CAMERA_OVERUSE: 'keep camera moves for 1–2 key beats; leave the rest still',
  TRANSITION_MONOTONY: 'vary transitions with the beat (cut on energy, morph between states)',
  PERSONALITY_MISMATCH: 'pick a motion personality that matches the style or the brief tone',
  AUDIO_CLIPPING: 'lower music/SFX volume',
  LOOP_SEAM: 'end on the opening composition so the loop point is invisible',
  BLANK_FRAME: 'a scene rendered empty — check its content and media',
};

function finalize(spec: VideoSpec, issues: QcIssue[], checks: QualityReport['checks'], extra: Omit<QualityReport, 'version' | 'project' | 'createdAt' | 'passed' | 'summary' | 'scores' | 'acceptance' | 'critique' | 'checks' | 'issues'>, passes: QcPass[]): QualityReport {
  const dedup = new Map<string, QcIssue>();
  for (const i of issues) {
    const k = `${i.code}|${i.scene ?? ''}|${i.element ?? ''}`;
    if (!dedup.has(k) || severityRank(i.severity) > severityRank(dedup.get(k)!.severity)) dedup.set(k, i);
  }
  const final = [...dedup.values()].map((i) => ({ ...i, fix: i.fix ?? FIX[i.code] })).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const summary = { info: 0, warning: 0, error: 0, critical: 0 } as Record<Severity, number>;
  for (const i of final) summary[i.severity]++;
  const acceptance = acceptanceOf(final, extra.stage, checks);
  const critique = final
    .filter((i) => i.severity !== 'info')
    .slice(0, 12)
    .map((i) => `[${i.severity}] ${i.scene ? `${i.scene}: ` : ''}${i.message}${i.fix ? ` → ${i.fix}` : ''}`);
  return { version: '2.0', project: spec.project.id, createdAt: new Date().toISOString(), passed: acceptance.every((a) => a.ok), summary, scores: scoresOf(final, passes), acceptance, critique, checks, issues: final, ...extra };
}

// ── contact sheets ──────────────────────────────────────────────────────────────
async function writeSheet(files: string[], out: string, tileW: number, spec: VideoSpec, cols: number): Promise<string | undefined> {
  if (!files.length) return undefined;
  const th = Math.round((tileW * spec.canvas.height) / spec.canvas.width);
  const c = Math.min(cols, files.length);
  const rows = Math.ceil(files.length / c);
  const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tileW, th).toBuffer(), left: (i % c) * tileW, top: Math.floor(i / c) * th })));
  await sharp({ create: { width: c * tileW, height: rows * th, channels: 3, background: '#000' } }).composite(comps).png().toFile(out);
  return out;
}

// ══ STRUCTURAL QC ═══════════════════════════════════════════════════════════════
export async function structuralQc(opts: { spec: VideoSpec; projectDir: string; outDir: string; pass?: number; perScene?: number; useCache?: boolean; sheets?: boolean }): Promise<StructuralQc> {
  const { spec, projectDir } = opts;
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const issues: QcIssue[] = [];
  const checks: QualityReport['checks'] = {};
  const add = (pass: QcPass, i: Omit<QcIssue, 'pass'>) => issues.push({ ...i, pass });
  const fps = spec.canvas.fps;
  const tl = buildTimeline(spec.scenes, fps);
  const canvas = makeCanvasProfile(spec.canvas.width, spec.canvas.height, spec.safeArea.preset, spec.safeArea.margin);
  mkdirSync(opts.outDir, { recursive: true });
  const samples = sampleFrames(spec, opts.perScene ?? 3);
  const stillsDir = join(opts.outDir, 'frames');
  rmSync(stillsDir, { recursive: true, force: true });

  log.stage('QUALITY', `structural QC: ${samples.length} frames`);
  const run = await collectProbes(spec, projectDir, samples.map((s) => s.frame), stillsDir, { useCache: opts.useCache });
  const probes = run.probes;
  timings.probeMs = Date.now() - t0;

  // ── pass 1: structure ────────────────────────────────────────────────────────
  checks.probe = probes.size === samples.length ? 'pass' : 'fail';
  if (probes.size < samples.length) add('structure', { severity: 'critical', code: 'PROBE_MISSING', message: `QC probe missing for ${samples.length - probes.size} frame(s) — cannot verify them` });
  const fontsFailed = new Set<string>();
  let ctaSeen = false;
  const lastIdx = spec.scenes.length - 1;
  const phoneW = phoneViewWidth(spec);
  const phoneK = phoneW / spec.canvas.width;
  for (const s of samples) {
    const p = probes.get(s.frame);
    if (!p) continue;
    const base = { frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex };
    const fonts = p.fonts as { family: string; ok: boolean; error?: string }[] | null;
    if (!fonts) fontsFailed.add('(font status unavailable)');
    else for (const f of fonts) if (!f.ok) fontsFailed.add(`${f.family}${f.error ? ` (${f.error})` : ''}`);
    for (const e of p.errors) add('structure', { ...base, severity: 'critical', code: 'SCENE_CRASHED', message: `scene failed to render: ${e.error}`, scene: e.scene });
    if (p.debugOverlay) add('structure', { ...base, severity: 'critical', code: 'DEBUG_OVERLAY', message: 'safe-area debug overlay visible in output' });
    const visibleTexts = p.texts.filter((t) => t.opacity > 0.55 && t.text.trim());
    const hold = s.kind === 'hold';
    for (const t of p.texts) {
      if (!t.text.trim()) continue;
      const tb = { ...base, scene: t.scene || s.scene, element: `${t.role}:"${t.text.slice(0, 32)}"` };
      if (t.fit === 'fail') add('structure', { ...tb, severity: t.critical ? 'critical' : 'error', code: 'TEXT_FIT_FAIL', message: `text does not fit its box even at minimum size (${t.reason ?? 'overflow'})`, repair: { action: 'shrink-text' } });
      // an invisible line (before its entrance) cannot visibly clip; its settled frames are sampled as holds
      if (t.overflowX && t.opacity > 0.05) add('structure', { ...tb, severity: t.critical ? 'critical' : 'error', code: 'TEXT_OVERFLOW', message: 'a text line is wider than its container', repair: { action: 'shrink-text' } });
      if (t.arabic && Math.abs(t.letterSpacing) > 0.01) add('structure', { ...tb, severity: 'error', code: 'ARABIC_LETTER_SPACING', message: `letter-spacing ${t.letterSpacing}px on Arabic text breaks joining` });
      if (t.splitGlyphs) add('structure', { ...tb, severity: 'critical', code: 'ARABIC_SPLIT_GLYPHS', message: 'Arabic word split into single-letter elements (broken ligatures)' });
      if (t.arabic && t.direction !== 'rtl' && /^[؀-ۿ]/.test(t.text)) add('structure', { ...tb, severity: 'error', code: 'RTL_DIRECTION', message: 'Arabic text laid out left-to-right' });
      if (t.opacity <= 0.55) continue;
      for (const re of DEVELOPER_SIGNATURES) if (re.test(t.text)) add('structure', { ...tb, severity: 'critical', code: 'DEVELOPER_SIGNATURE', message: 'tool/developer signature visible in the video', fix: 'remove it — only the user’s own branding may appear' });
      if (!rectInside(t.rect, { x: 0, y: 0, width: canvas.width, height: canvas.height }, 1) && hold) add('structure', { ...tb, severity: 'critical', code: 'TEXT_OFF_CANVAS', message: 'text extends beyond the frame', repair: { action: 'shrink-layout' } });
      else if (hold && !rectInside(t.rect, canvas.safe, canvas.u * 0.6)) add('structure', { ...tb, severity: t.critical ? 'error' : 'warning', code: 'TEXT_OUTSIDE_SAFE', message: `text leaves the ${spec.safeArea.preset} safe area`, repair: { action: 'shrink-layout' } });
      const minLegible = (t.role === 'caption' || t.role === 'label' || t.role === 'eyebrow' ? 1.9 : 2.4) * canvas.u;
      if (hold && t.fontSize > 0 && t.fontSize < minLegible) add('design', { ...tb, severity: t.critical ? 'error' : 'warning', code: 'TEXT_TOO_SMALL', message: `font size ${t.fontSize.toFixed(0)}px is below legibility (${minLegible.toFixed(0)}px) for this canvas`, repair: { action: 'grow-text' } });
      else if (hold && t.fontSize > 0) {
        const need = PHONE_MIN[t.role] ?? 9;
        const seen = t.fontSize * phoneK;
        if (seen < need) add('design', { ...tb, severity: t.critical ? 'error' : 'warning', code: 'PHONE_UNREADABLE', message: `on a ${phoneW}px-wide phone this ${t.role} renders at ${seen.toFixed(1)}px (needs ≥${need}px)`, repair: { action: 'grow-text' } });
      }
      if (hold && s.sceneIndex === lastIdx && t.critical && t.opacity > 0.9) ctaSeen = true;
    }
    if (hold) {
      for (let i = 0; i < visibleTexts.length; i++)
        for (let j = i + 1; j < visibleTexts.length; j++) {
          const a = visibleTexts[i];
          const b = visibleTexts[j];
          if (a.rect.width * a.rect.height === 0 || b.rect.width * b.rect.height === 0) continue;
          const ov = overlapArea(a.rect, b.rect) / Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
          if (ov > 0.25 && !rectInside(b.rect, a.rect, 0)) add('structure', { ...base, severity: 'error', code: 'TEXT_OVERLAP', message: `"${a.text.slice(0, 20)}" overlaps "${b.text.slice(0, 20)}" (${Math.round(ov * 100)}%)`, repair: { action: 'shrink-layout' } });
        }
    }
    for (const m of p.media) {
      const mb = { ...base, scene: m.scene || s.scene, element: `${m.role}:${m.src}` };
      if (!m.loaded) add('structure', { ...mb, severity: 'critical', code: 'MEDIA_BROKEN', message: `image failed to load: ${m.src}` });
      if (m.identity && m.objectFit !== 'contain') add('structure', { ...mb, severity: 'critical', code: 'MEDIA_DISTORTED', message: `${m.role} is not rendered with object-fit: contain (would crop/distort the user asset)` });
      if (m.loaded && m.naturalWidth && m.identity && m.opacity > 0.9 && hold) {
        const scaleUp = Math.max(m.rect.width / m.naturalWidth, m.rect.height / m.naturalHeight);
        if (scaleUp > 2.2) add('design', { ...mb, severity: 'warning', code: 'MEDIA_UPSCALED', message: `${m.role} shown ${scaleUp.toFixed(1)}× its native size (may look soft)`, fix: 'a larger original of this asset would look sharper' });
      }
    }
  }
  if (fontsFailed.size) add('structure', { severity: 'critical', code: 'FONT_LOAD_FAILED', message: `fonts failed to load: ${[...fontsFailed].join(', ')}` });
  checks.fonts = fontsFailed.size ? 'fail' : 'pass';
  const lastScene = spec.scenes[lastIdx];
  const lastMod = SceneRegistry.get(lastScene.type);
  if (lastMod?.manifest.category === 'cta' || lastMod?.manifest.beats[0] === 'cta') {
    checks.cta = ctaSeen ? 'pass' : 'fail';
    if (!ctaSeen) add('structure', { severity: 'error', code: 'CTA_NOT_VISIBLE', scene: lastScene.id, sceneIndex: lastIdx, message: 'the CTA is never fully visible during its hold', repair: { action: 'extend', value: 0.6 } });
  } else checks.cta = 'skipped';

  // ── pass 2: design ───────────────────────────────────────────────────────────
  const td = Date.now();
  for (const f of checkBannedPatterns(spec)) add('design', { severity: f.severity, code: `BANNED_${f.id.toUpperCase()}`, message: f.message, scene: f.scene, element: f.path });
  const UNDERFILL_CATEGORIES = new Set(['infographic', 'data', 'social', 'ui', 'mobile', 'commerce']);
  spec.scenes.forEach((sc, i) => {
    const mod = SceneRegistry.get(sc.type);
    if (!mod || !UNDERFILL_CATEGORIES.has(mod.manifest.category)) return;
    let best: { cov: number; box: Rect; frame: number } | null = null;
    for (const smp of samples.filter((x) => x.sceneIndex === i && x.kind === 'hold')) {
      const p = probes.get(smp.frame);
      if (!p) continue;
      const rects = [...p.texts.filter((t) => t.scene === sc.id && t.opacity > 0.55 && t.text.trim()).map((t) => t.rect), ...p.media.filter((m) => m.scene === sc.id && m.opacity > 0.55).map((m) => m.rect), ...(p.boxes ?? []).filter((b) => b.scene === sc.id && b.opacity > 0.55).map((b) => b.rect)].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const x0 = Math.min(...rects.map((r) => r.x));
      const y0 = Math.min(...rects.map((r) => r.y));
      const x1 = Math.max(...rects.map((r) => r.x + r.width));
      const y1 = Math.max(...rects.map((r) => r.y + r.height));
      // union over every sampled hold frame: content that appears later in the scene (a solution
      // card under a problem line) must fit too, so scaling is measured on the full extent
      const prev = best as { cov: number; box: Rect; frame: number } | null;
      const u0 = prev?.box;
      const ux0 = Math.min(x0, u0?.x ?? x0), uy0 = Math.min(y0, u0?.y ?? y0);
      const ux1 = Math.max(x1, u0 ? u0.x + u0.width : x1), uy1 = Math.max(y1, u0 ? u0.y + u0.height : y1);
      const box = { x: ux0, y: uy0, width: ux1 - ux0, height: uy1 - uy0 };
      const cov = (box.width * box.height) / (canvas.safe.width * canvas.safe.height);
      best = { cov, box, frame: prev?.frame ?? smp.frame };
    }
    if (!best || best.cov >= 0.2) return;
    const s0 = canvas.safe;
    const cx = s0.x + s0.width / 2;
    const cy = s0.y + s0.height / 2;
    const lim = (edge: number, c: number, bound: number) => (Math.abs(edge - c) < 1 ? Infinity : Math.abs(bound - c) / Math.abs(edge - c));
    const kMax = Math.min(lim(best.box.x, cx, s0.x), lim(best.box.x + best.box.width, cx, s0.x + s0.width), lim(best.box.y, cy, s0.y), lim(best.box.y + best.box.height, cy, s0.y + s0.height)) * 0.94;
    const k = Math.min(kMax, Math.sqrt(0.3 / Math.max(0.02, best.cov)), 1.3);
    if (k < 1.06) return;
    add('design', { severity: 'warning', code: 'LAYOUT_UNDERFILLED', scene: sc.id, sceneIndex: i, frame: best.frame, message: `content fills only ${Math.round(best.cov * 100)}% of the safe area — scaling it up ×${k.toFixed(2)} reads better`, repair: { action: 'grow-layout', value: Math.round(k * 100) / 100 } });
  });
  // pixels of the probe stills (half size): contrast + banned patterns, in parallel
  const stillScale = 0.5;
  let patternHits = 0;
  await Promise.all(
    samples
      .filter((s) => s.kind === 'hold')
      .map(async (s) => {
        const png = run.stills.get(s.frame);
        const p = probes.get(s.frame);
        if (!png || !existsSync(png)) return;
        const scan = await scanPatterns(png, patternMasks(p, stillScale));
        for (const f of scan.findings) {
          patternHits++;
          const ok = patternAllowed(spec, f.kind);
          add('design', { severity: ok ? 'info' : 'critical', code: 'PATTERN_IN_FRAME', frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex, element: f.kind, message: ok ? `${f.kind} visible (requested: design.allowPatterns): ${f.message}` : `banned ${f.kind} visible: ${f.message}`, repair: ok ? undefined : { action: 'clean-background' } });
        }
        if (!p) return;
        const meta = await sharp(png).metadata();
        for (const tx of p.texts) {
          if (tx.opacity < 0.95 || !tx.text.trim() || tx.rect.width < 20) continue;
          const hex = hexOf(tx.color);
          if (!hex) continue;
          const cr = await pixelContrast(png, tx.rect, hex, stillScale, meta.width!, meta.height!);
          if (cr === null) continue;
          const min = tx.fontSize >= canvas.u * 4.5 ? 3 : 4.5;
          if (cr < min * 0.8) add('design', { severity: cr < 2 ? 'error' : 'warning', code: 'TEXT_CONTRAST_LOW', frame: s.frame, time: s.time, scene: tx.scene || s.scene, sceneIndex: s.sceneIndex, element: `${tx.role}:"${tx.text.slice(0, 32)}"`, message: `measured contrast ≈${cr.toFixed(1)}:1 (needs ${min}:1)`, repair: { action: 'scrim' } });
        }
      }),
  );
  checks.patterns = patternHits ? 'fail' : 'pass';
  checks.phone = issues.some((i) => i.code === 'PHONE_UNREADABLE' && i.severity !== 'warning') ? 'fail' : 'pass';
  timings.designMs = Date.now() - td;

  // ── pass 3: motion ───────────────────────────────────────────────────────────
  motionPass(spec, tl, samples, probes, (i) => add('motion', i));
  checks.timing = issues.some((i) => i.code === 'HOLD_TOO_SHORT' || i.code === 'VOICE_DRIFT') ? 'fail' : 'pass';

  // ── sheets ───────────────────────────────────────────────────────────────────
  const ts = Date.now();
  let contactSheet: string | undefined;
  let phoneSheet: string | undefined;
  if (opts.sheets !== false) {
    try {
      const holds = samples.filter((s) => s.kind === 'hold').map((s) => run.stills.get(s.frame)).filter((f): f is string => Boolean(f && existsSync(f)));
      contactSheet = await writeSheet(holds, join(opts.outDir, 'contact-sheet.png'), spec.canvas.width >= spec.canvas.height ? 320 : 180, spec, 6);
      // one representative hold per scene, shown at real phone size
      const perScene = spec.scenes.map((_, i) => samples.filter((s) => s.sceneIndex === i && s.kind === 'hold')[1] ?? samples.find((s) => s.sceneIndex === i && s.kind === 'hold')).filter(Boolean) as Sample[];
      const files = perScene.map((s) => run.stills.get(s.frame)).filter((f): f is string => Boolean(f && existsSync(f)));
      phoneSheet = await writeSheet(files.slice(0, 8), join(opts.outDir, 'phone-view.png'), phoneW, spec, 4);
    } catch (e) {
      add('design', { severity: 'info', code: 'CONTACT_SHEET', message: `contact sheet not written: ${(e as Error).message}` });
    }
  }
  timings.sheetMs = Date.now() - ts;
  timings.totalMs = Date.now() - t0;

  const report = finalize(spec, issues, checks, { video: null, stage: 'structure', samples: samples.map((s) => ({ frame: s.frame, time: Math.round(s.time * 100) / 100, scene: s.scene, kind: s.kind })), contactSheet, phoneSheet, repairPass: opts.pass, timings, probeCache: { rendered: run.rendered, cached: run.cached } }, ['structure', 'design', 'motion']);
  writeFileSync(join(opts.outDir, 'quality-report.json'), JSON.stringify(report, null, 2));
  log.stage('QUALITY', `structure ${report.passed ? 'PASSED' : 'FAILED'} — critical ${report.summary.critical}, error ${report.summary.error}, warning ${report.summary.warning}; probes ${run.rendered} rendered / ${run.cached} cached (${(timings.totalMs / 1000).toFixed(1)}s)`);
  return { report, samples, probes, stills: run.stills };
}

function motionPass(spec: VideoSpec, tl: ReturnType<typeof buildTimeline>, samples: Sample[], probes: Map<number, DomProbe>, add: (i: Omit<QcIssue, 'pass'>) => void) {
  const fps = spec.canvas.fps;
  tl.entries.forEach((e, i) => {
    const s = spec.scenes[i];
    const texts = new Set<string>();
    for (const smp of samples.filter((x) => x.sceneIndex === i && x.kind === 'hold')) for (const t of probes.get(smp.frame)?.texts ?? []) if (t.scene === s.id && t.opacity > 0.3 && t.text && t.role !== 'eyebrow' && t.role !== 'number') texts.add(t.text);
    const words = [...texts].join(' ').split(/\s+/).filter(Boolean).length;
    const need = words ? 0.5 + words / 4.5 : 0;
    const have = (e.durationInFrames - (e.transitionIn + e.transitionOut) / 2) / fps;
    if (need > have + 0.2) add({ severity: 'warning', code: 'HOLD_TOO_SHORT', scene: s.id, sceneIndex: i, message: `on screen ${have.toFixed(1)}s but its text needs ≈${need.toFixed(1)}s to read`, repair: { action: 'extend', value: Math.round((need - have + 0.3) * 10) / 10 } });
    if (s.voice && spec.audio.voice) {
      const from = e.startSec;
      const to = e.startSec + e.transitionIn / fps;
      const seg = s.voice.segment !== undefined ? spec.audio.voice.segments[s.voice.segment] : undefined;
      const at = s.voice.start ?? (seg ? spec.audio.voice.offset + seg.start : undefined);
      const drift = at === undefined ? 0 : at < from ? at - from : at > to ? at - to : 0;
      if (i > 0 && Math.abs(drift) > 0.25) add({ severity: 'warning', code: 'VOICE_DRIFT', scene: s.id, sceneIndex: i, message: `its voice phrase starts ${Math.abs(drift).toFixed(2)}s ${drift < 0 ? 'before the scene appears' : 'after the scene has fully arrived'}` });
    }
  });
  const n = spec.scenes.length;
  const noJob = spec.scenes.filter((s) => !s.motion.jobs?.length).length;
  if (noJob && spec.metadata.generator === 'director') add({ severity: 'info', code: 'MOTION_NO_PURPOSE', message: `${noJob}/${n} scenes have no declared motion job` });
  const cams = spec.scenes.filter((s) => s.motion.camera && s.motion.camera !== 'none').length;
  if (n >= 4 && cams / n > 0.7) add({ severity: 'warning', code: 'CAMERA_OVERUSE', message: `${cams}/${n} scenes move the camera — nothing feels still, so nothing feels important` });
  const trans = spec.scenes.slice(0, -1).map((s) => s.transition?.type ?? 'auto');
  if (trans.length >= 4 && new Set(trans).size === 1 && trans[0] !== 'auto') add({ severity: 'warning', code: 'TRANSITION_MONOTONY', message: `every cut uses "${trans[0]}"` });
  const style = resolveStyle(spec.style.preset, spec.brand, spec.style.overrides);
  const filmP = spec.motion?.personality as MotionPersonalityId | undefined;
  const styleP = (style.motion.personality ?? STYLE_PERSONALITY[style.id]) as MotionPersonalityId | undefined;
  if (filmP && styleP && !compatiblePersonalities(filmP, styleP)) add({ severity: 'warning', code: 'PERSONALITY_MISMATCH', message: `motion personality "${filmP}" fights the ${style.id} style (${styleP})` });
}

// ══ FINAL TECHNICAL QC ═════════════════════════════════════════════════════════
/** Decodes the MP4 once and writes the requested frames as PNGs (in frame order). */
function extractFrames(video: string, frames: number[], dir: string, half: boolean): Map<number, string> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const uniq = [...new Set(frames)].sort((a, b) => a - b);
  const sel = uniq.map((f) => `eq(n\\,${f})`).join('+');
  const vf = `select='${sel}'${half ? ',scale=iw/2:-2' : ''}`;
  ffmpegRun(['-i', video, '-vf', vf, '-fps_mode', 'passthrough', join(dir, 'x%05d.png')], 'frame extraction failed');
  const files = readdirSync(dir).filter((f) => f.startsWith('x')).sort();
  const out = new Map<number, string>();
  files.forEach((f, i) => uniq[i] !== undefined && out.set(uniq[i], join(dir, f)));
  return out;
}

export async function finalQc(opts: { spec: VideoSpec; projectDir: string; video: string; outDir: string; structural: StructuralQc; profile?: string; pass?: number; extraIssues?: QcIssue[] }): Promise<QualityReport> {
  const { spec, video, structural } = opts;
  const t0 = Date.now();
  const timings: Record<string, number> = { ...structural.report.timings };
  // carry structure/design/motion findings; recompute the pixel ones on the real output
  const issues: QcIssue[] = structural.report.issues.filter((i) => i.code !== 'TEXT_CONTRAST_LOW' && i.code !== 'PATTERN_IN_FRAME');
  const checks: QualityReport['checks'] = { ...structural.report.checks };
  const add = (i: Omit<QcIssue, 'pass'>) => issues.push({ ...i, pass: 'technical' });
  const fps = spec.canvas.fps;
  const tl = buildTimeline(spec.scenes, fps);
  const canvas: CanvasProfile = makeCanvasProfile(spec.canvas.width, spec.canvas.height, spec.safeArea.preset, spec.safeArea.margin);
  log.stage('QUALITY', 'final technical QC');

  const pr = probe(video);
  const v = pr.streams.find((x) => x.type === 'video');
  const a = pr.streams.find((x) => x.type === 'audio');
  const media: QualityReport['media'] = { duration: pr.duration, width: v?.width, height: v?.height, fps: v?.fps, codec: v?.codec, pixFmt: v?.pixFmt, hasAudio: Boolean(a), bytes: pr.size };
  if (!v) add({ severity: 'critical', code: 'MP4_NO_VIDEO', message: 'output has no video stream' });
  if (v && v.codec !== 'h264') add({ severity: 'critical', code: 'MP4_CODEC', message: `codec ${v.codec}, expected h264` });
  if (v && v.pixFmt !== 'yuv420p') add({ severity: 'error', code: 'MP4_PIXFMT', message: `pixel format ${v.pixFmt} (yuv420p plays everywhere)` });
  if (v?.width && v.height && Math.abs(v.width / v.height - spec.canvas.width / spec.canvas.height) > 0.01) add({ severity: 'critical', code: 'MP4_ASPECT', message: `output ${v.width}×${v.height} does not match ${spec.canvas.aspect}` });
  if (Math.abs(pr.duration - tl.totalSec) > 0.15) add({ severity: 'error', code: 'MP4_DURATION', message: `duration ${pr.duration.toFixed(2)}s, expected ${tl.totalSec.toFixed(2)}s` });
  const expectFps = opts.profile === 'animatic' ? 15 : fps;
  if (v?.fps && Math.abs(v.fps - expectFps) > 0.5) add({ severity: 'error', code: 'MP4_FPS', message: `fps ${v.fps}, expected ${expectFps}` });
  const mbps = pr.duration > 0 && pr.size ? (pr.size * 8) / pr.duration / 1e6 : 0;
  if (mbps > 30) add({ severity: 'warning', code: 'MP4_BITRATE_HIGH', message: `${mbps.toFixed(0)} Mbit/s — heavy for social upload (usually per-frame noise or texture)` });
  for (const [k, val] of Object.entries(pr.tags)) {
    if (/made with|remotion|nitaaq|claude/i.test(val) && !/^(handler_name|vendor_id|major_brand|compatible_brands|minor_version|language)$/i.test(k)) add({ severity: 'critical', code: 'MP4_SIGNATURE', message: `tool signature in MP4 metadata (${k}=${val.slice(0, 40)})` });
  }
  {
    const head = readFileSync(video).subarray(0, 4 << 20).toString('latin1');
    // exact, case-sensitive encoder banners (random bytes in compressed data can spell "lavc4")
    const found = /x264 - core \d+|Lavf\d+\.\d+\.\d+|Lavc\d+\.\d+\.\d+|[Mm]ade with Remotion|Remotion \d/.exec(head);
    if (found) add({ severity: 'warning', code: 'ENCODER_STRING', message: `encoder string "${found[0]}" left in the file` });
  }
  checks.container = issues.some((i) => i.code.startsWith('MP4_') && i.pass === 'technical' && severityRank(i.severity) >= 2) ? 'fail' : 'pass';

  const sfxPlanned = planSfx(spec, tl, (sc) => SceneRegistry.get(sc.type)?.manifest.sfx ?? []).length > 0;
  const expectsAudio = Boolean(spec.audio.voice || spec.audio.music || sfxPlanned);
  let audio: QualityReport['audio'];
  if (expectsAudio && !a) add({ severity: 'critical', code: 'AUDIO_MISSING', message: 'audio was planned but the MP4 has no audio track' });
  if (a) {
    audio = loudness(video);
    checks.audio = 'pass';
    if (expectsAudio && (audio.meanVolume === null || audio.meanVolume < -55)) {
      add({ severity: 'critical', code: 'AUDIO_SILENT', message: `audio track is silent (mean ${audio.meanVolume ?? '?'} dB)` });
      checks.audio = 'fail';
    }
    if (audio.truePeak !== null && audio.truePeak > -0.3) {
      add({ severity: 'error', code: 'AUDIO_CLIPPING', message: `true peak ${audio.truePeak} dBFS — risk of clipping`, repair: { action: 'lower-audio', value: 0.75 } });
      checks.audio = 'fail';
    }
    if (spec.audio.voice && audio.integratedLufs !== null && audio.integratedLufs < -26) add({ severity: 'warning', code: 'AUDIO_QUIET', message: `integrated loudness ${audio.integratedLufs} LUFS — voice may be too quiet for social` });
  } else checks.audio = expectsAudio ? 'fail' : 'skipped';
  timings.containerMs = Date.now() - t0;

  // ── pixels of the real output: one decode for every sampled frame
  const tp = Date.now();
  const fpsK = (v?.fps ?? fps) / fps;
  const holds = structural.samples;
  const outFrame = (f: number) => Math.min(Math.round(f * fpsK), Math.max(0, Math.round(pr.duration * (v?.fps ?? fps)) - 1));
  const loop = spec.timeline?.seamlessLoop;
  const want = [...holds.map((s) => outFrame(s.frame)), ...(loop ? [0, outFrame(tl.totalFrames - 1)] : [])];
  const half = (v?.width ?? spec.canvas.width) >= 1000;
  const frames = extractFrames(video, want, join(opts.outDir, 'mp4-frames'), half);
  timings.decodeMs = Date.now() - tp;
  const outScale = ((v?.width ?? spec.canvas.width) / spec.canvas.width) * (half ? 0.5 : 1);
  let blank = 0;
  let patternHits = 0;
  let lowContrast = 0;
  await Promise.all(
    holds.map(async (s) => {
      const png = frames.get(outFrame(s.frame));
      if (!png) return;
      const st = await sharp(png).greyscale().stats();
      if (s.kind === 'hold' && st.channels[0].stdev < 3) {
        blank++;
        add({ severity: 'critical', code: 'BLANK_FRAME', frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex, message: `frame at ${s.time.toFixed(2)}s is blank/uniform` });
      }
      if (s.kind !== 'hold') return;
      const p = structural.probes.get(s.frame);
      const scan = await scanPatterns(png, patternMasks(p, outScale));
      for (const f of scan.findings) {
        patternHits++;
        const ok = patternAllowed(spec, f.kind);
        add({ severity: ok ? 'info' : 'critical', code: 'PATTERN_IN_FRAME', frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex, element: f.kind, message: ok ? `${f.kind} in the MP4 (requested: design.allowPatterns): ${f.message}` : `banned ${f.kind} in the rendered MP4: ${f.message}`, repair: ok ? undefined : { action: 'clean-background' } });
      }
      if (!p) return;
      const meta = await sharp(png).metadata();
      for (const tx of p.texts) {
        if (tx.opacity < 0.95 || !tx.text.trim() || tx.rect.width < 20) continue;
        const hex = hexOf(tx.color);
        if (!hex) continue;
        const cr = await pixelContrast(png, tx.rect, hex, outScale, meta.width!, meta.height!);
        if (cr === null) continue;
        const min = tx.fontSize >= canvas.u * 4.5 ? 3 : 4.5;
        if (cr < min * 0.8) {
          lowContrast++;
          add({ severity: cr < 2 ? 'error' : 'warning', code: 'TEXT_CONTRAST_LOW', frame: s.frame, time: s.time, scene: tx.scene || s.scene, sceneIndex: s.sceneIndex, element: `${tx.role}:"${tx.text.slice(0, 32)}"`, message: `measured contrast ≈${cr.toFixed(1)}:1 (needs ${min}:1)`, repair: { action: 'scrim' } });
        }
      }
    }),
  );
  checks.blank = blank ? 'fail' : 'pass';
  checks.patterns = patternHits ? 'fail' : 'pass';
  checks.contrast = lowContrast ? 'fail' : 'pass';
  if (loop) {
    const f0 = frames.get(0);
    const f1 = frames.get(outFrame(tl.totalFrames - 1));
    if (f0 && f1) {
      const [g0, g1] = await Promise.all([f0, f1].map((f) => sharp(f).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer()));
      let d = 0;
      for (let i = 0; i < g0.length; i++) d += Math.abs(g0[i] - g1[i]);
      d /= g0.length;
      checks.loop = d > 14 ? 'fail' : 'pass';
      if (d > 14) add({ severity: 'error', code: 'LOOP_SEAM', message: `last and first frames differ by ${d.toFixed(1)} grey levels — the loop point will jump` });
    }
  }
  timings.pixelMs = Date.now() - tp;
  timings.finalMs = Date.now() - t0;

  // sound-design / motion-variety findings from produce's sound stage
  if (opts.extraIssues?.length) issues.push(...opts.extraIssues);
  const report = finalize(spec, issues, checks, { video, stage: 'final', profile: opts.profile, samples: structural.report.samples, media, audio, contactSheet: structural.report.contactSheet, phoneSheet: structural.report.phoneSheet, repairPass: opts.pass, timings, probeCache: structural.report.probeCache }, opts.extraIssues ? ['structure', 'design', 'motion', 'audio', 'technical'] : ['structure', 'design', 'motion', 'technical']);
  writeFileSync(join(opts.outDir, 'quality-report.json'), JSON.stringify(report, null, 2));
  log.stage('QUALITY', `final ${report.passed ? 'PASSED' : 'FAILED'} — critical ${report.summary.critical}, error ${report.summary.error}, warning ${report.summary.warning}; score ${report.scores.overall} (${(timings.finalMs / 1000).toFixed(1)}s)`);
  return report;
}

/** CLI entry: structural QC, plus the technical pass when a video is given. */
export async function runQuality(opts: { spec: VideoSpec; projectDir: string; video?: string | null; outDir: string; profile?: string; pass?: number; perScene?: number }): Promise<QualityReport> {
  const st = await structuralQc(opts);
  if (!opts.video || !existsSync(opts.video)) return st.report;
  return finalQc({ spec: opts.spec, projectDir: opts.projectDir, video: opts.video, outDir: opts.outDir, structural: st, profile: opts.profile, pass: opts.pass });
}

export type { ProbeText };
