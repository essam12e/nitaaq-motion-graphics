/**
 * Mandatory QC agent. Two independent views of the same video:
 *  1. DOM probe: the composition is rendered in `qc` mode at sampled frames and
 *     every text/media element reports its geometry, fit, opacity and state.
 *  2. Pixels: frames extracted from the actual MP4 are checked for blank frames
 *     and text/background contrast; the MP4 container/stream and audio are probed.
 * Writes quality-report.json + a contact sheet. Delivery requires zero critical issues.
 */
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { buildTimeline, holdWindow } from '../core/timeline';
import { makeCanvasProfile } from '../layout/canvas';
import { SceneRegistry } from '../scenes';
import { contrastRatio, normalizeHex } from '../brand/color';
import { DEVELOPER_SIGNATURES, type Severity } from '../validation/validate';
import { planSfx } from '../audio/mix';
import { prepare } from '../node/render';
import { probe, loudness, ffmpegRun } from '../node/audio';
import type { ProbeResult as DomProbe, ProbeText } from '../engine/QCProbe';
import { log } from '../core/logger';

export interface QcIssue {
  severity: Severity;
  code: string;
  message: string;
  scene?: string;
  sceneIndex?: number;
  frame?: number;
  time?: number;
  element?: string;
  /** Machine-readable hint for the repair loop. */
  repair?: { action: string; value?: number };
}

export interface QualityReport {
  version: '1.0';
  project: string;
  video: string | null;
  profile?: string;
  createdAt: string;
  passed: boolean;
  summary: Record<Severity, number>;
  checks: Record<string, 'pass' | 'fail' | 'skipped'>;
  issues: QcIssue[];
  samples: { frame: number; time: number; scene: string; kind: 'hold' | 'transition' | 'edge' }[];
  media?: { duration: number; width?: number; height?: number; fps?: number; codec?: string; pixFmt?: string; hasAudio: boolean; bytes?: number };
  audio?: { integratedLufs: number | null; truePeak: number | null; meanVolume: number | null; maxVolume: number | null };
  contactSheet?: string;
  repairPass?: number;
}

interface Sample {
  frame: number;
  time: number;
  scene: string;
  sceneIndex: number;
  kind: 'hold' | 'transition' | 'edge';
}

export function sampleFrames(spec: VideoSpec, maxPerScene = 3): Sample[] {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const out: Sample[] = [];
  tl.entries.forEach((e, i) => {
    const w = holdWindow(e);
    const len = Math.max(1, w.end - w.start);
    const fr = maxPerScene >= 3 ? [0.3, 0.7, 0.97] : maxPerScene === 2 ? [0.45, 0.95] : [0.8];
    for (const f of fr) out.push({ frame: Math.min(tl.totalFrames - 1, Math.round(w.start + len * f)), time: 0, scene: e.id, sceneIndex: i, kind: 'hold' });
    if (e.transitionOut > 0) out.push({ frame: e.from + e.durationInFrames - Math.round(e.transitionOut / 2), time: 0, scene: e.id, sceneIndex: i, kind: 'transition' });
  });
  out.push({ frame: 0, time: 0, scene: tl.entries[0].id, sceneIndex: 0, kind: 'edge' });
  out.push({ frame: tl.totalFrames - 1, time: 0, scene: tl.entries[tl.entries.length - 1].id, sceneIndex: tl.entries.length - 1, kind: 'edge' });
  const uniq = new Map<number, Sample>();
  for (const s of out) if (!uniq.has(s.frame) || s.kind === 'hold') uniq.set(s.frame, { ...s, time: s.frame / spec.canvas.fps });
  return [...uniq.values()].sort((a, b) => a.frame - b.frame);
}

function rectInside(r: { x: number; y: number; width: number; height: number }, box: { x: number; y: number; width: number; height: number }, tol = 2) {
  return r.x >= box.x - tol && r.y >= box.y - tol && r.x + r.width <= box.x + box.width + tol && r.y + r.height <= box.y + box.height + tol;
}

function overlapArea(a: ProbeText['rect'], b: ProbeText['rect']) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Collects DOM probes for the given frames (qc mode). */
export async function collectProbes(spec: VideoSpec, projectDir: string, frames: number[], stillsDir?: string): Promise<Map<number, DomProbe>> {
  const prep = await prepare(spec, projectDir, 'qc');
  const browser = await openBrowser('chrome', { browserExecutable: prep.browserExecutable, logLevel: 'error' });
  const probes = new Map<number, DomProbe>();
  // Remotion echoes browser console lines to the terminal; keep the probe payloads out of the logs.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const filt = (orig: typeof process.stdout.write) => ((chunk: unknown, ...rest: unknown[]) => (typeof chunk === 'string' && chunk.includes('__AMD_QC__') ? true : (orig as (...a: unknown[]) => boolean)(chunk, ...rest))) as typeof process.stdout.write;
  process.stdout.write = filt(origOut);
  process.stderr.write = filt(origErr);
  try {
    const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, puppeteerInstance: browser, logLevel: 'error' });
    if (stillsDir) mkdirSync(stillsDir, { recursive: true });
    for (const frame of frames) {
      let got: DomProbe | null = null;
      await renderStill({
        serveUrl: prep.serveUrl,
        composition,
        inputProps: prep.inputProps,
        frame,
        output: stillsDir ? join(stillsDir, `probe-${String(frame).padStart(5, '0')}.png`) : join(projectDir, '.qc-tmp.png'),
        scale: 0.5,
        puppeteerInstance: browser,
        logLevel: 'error',
        onBrowserLog: (l) => {
          const i = l.text.indexOf('__AMD_QC__');
          if (i >= 0) {
            try {
              got = JSON.parse(l.text.slice(i + 10)) as DomProbe;
            } catch {
              /* partial log line: ignored, reported as missing probe below */
            }
          }
        },
      });
      if (got) probes.set(frame, got);
    }
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    await browser.close({ silent: true });
    rmSync(join(projectDir, '.qc-tmp.png'), { force: true });
  }
  return probes;
}

function hexOf(color: string): string | null {
  if (color.startsWith('#')) return normalizeHex(color);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

/** Estimates text/background contrast inside a text rect from real pixels. */
async function pixelContrast(png: string, rect: { x: number; y: number; width: number; height: number }, textHex: string, scale: number, imgW: number, imgH: number): Promise<number | null> {
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
  // median background luminance pixel
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  bg.sort((a, b) => lum(a) - lum(b));
  const med = bg[Math.floor(bg.length / 2)];
  const hex = '#' + med.map((v) => v.toString(16).padStart(2, '0')).join('');
  return contrastRatio(textHex, hex);
}

async function frameStats(png: string): Promise<{ stdev: number; mean: number }> {
  const s = await sharp(png).greyscale().stats();
  return { stdev: s.channels[0].stdev, mean: s.channels[0].mean };
}

export async function runQuality(opts: { spec: VideoSpec; projectDir: string; video?: string | null; outDir: string; profile?: string; pass?: number; perScene?: number }): Promise<QualityReport> {
  const { spec, projectDir } = opts;
  const t0 = Date.now();
  const issues: QcIssue[] = [];
  const checks: QualityReport['checks'] = {};
  const add = (i: QcIssue) => issues.push(i);
  const fps = spec.canvas.fps;
  const tl = buildTimeline(spec.scenes, fps);
  const canvas = makeCanvasProfile(spec.canvas.width, spec.canvas.height, spec.safeArea.preset, spec.safeArea.margin);
  mkdirSync(opts.outDir, { recursive: true });
  const samples = sampleFrames(spec, opts.perScene ?? 3);
  const stillsDir = join(opts.outDir, 'frames');
  rmSync(stillsDir, { recursive: true, force: true });

  // ── 1. DOM probes
  log.stage('QUALITY', `probing ${samples.length} frames`);
  const probes = await collectProbes(spec, projectDir, samples.map((s) => s.frame), stillsDir);
  checks.probe = probes.size === samples.length ? 'pass' : 'fail';
  if (probes.size < samples.length) add({ severity: 'critical', code: 'PROBE_MISSING', message: `QC probe missing for ${samples.length - probes.size} frame(s) — cannot verify them` });
  const fontsFailed = new Set<string>();
  let ctaSeen = false;
  const lastIdx = spec.scenes.length - 1;
  for (const s of samples) {
    const p = probes.get(s.frame);
    if (!p) continue;
    const base = { frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex };
    const fonts = p.fonts as { family: string; ok: boolean; error?: string }[] | null;
    if (!fonts) fontsFailed.add('(font status unavailable)');
    else for (const f of fonts) if (!f.ok) fontsFailed.add(`${f.family}${f.error ? ` (${f.error})` : ''}`);
    for (const e of p.errors) add({ ...base, severity: 'critical', code: 'SCENE_CRASHED', message: `scene failed to render: ${e.error}`, scene: e.scene });
    if (p.debugOverlay) add({ ...base, severity: 'critical', code: 'DEBUG_OVERLAY', message: 'safe-area debug overlay visible in output' });
    const visibleTexts = p.texts.filter((t) => t.opacity > 0.55 && t.text.trim());
    const hold = s.kind === 'hold';
    for (const t of p.texts) {
      if (!t.text.trim()) continue;
      const tb = { ...base, scene: t.scene || s.scene, element: `${t.role}:"${t.text.slice(0, 32)}"` };
      if (t.fit === 'fail') add({ ...tb, severity: t.critical ? 'critical' : 'error', code: 'TEXT_FIT_FAIL', message: `text does not fit its box even at minimum size (${t.reason ?? 'overflow'})`, repair: { action: 'shrink-text' } });
      if (t.overflowX) add({ ...tb, severity: t.critical ? 'critical' : 'error', code: 'TEXT_OVERFLOW', message: 'a text line is wider than its container', repair: { action: 'shrink-text' } });
      if (t.arabic && Math.abs(t.letterSpacing) > 0.01) add({ ...tb, severity: 'error', code: 'ARABIC_LETTER_SPACING', message: `letter-spacing ${t.letterSpacing}px on Arabic text breaks joining` });
      if (t.splitGlyphs) add({ ...tb, severity: 'critical', code: 'ARABIC_SPLIT_GLYPHS', message: 'Arabic word split into single-letter elements (broken ligatures)' });
      if (t.arabic && t.direction !== 'rtl' && /^[؀-ۿ]/.test(t.text)) add({ ...tb, severity: 'error', code: 'RTL_DIRECTION', message: 'Arabic text laid out left-to-right' });
      if (t.opacity <= 0.55) continue;
      for (const re of DEVELOPER_SIGNATURES) if (re.test(t.text)) add({ ...tb, severity: 'critical', code: 'DEVELOPER_SIGNATURE', message: 'tool/developer signature visible in the video' });
      if (!rectInside(t.rect, { x: 0, y: 0, width: canvas.width, height: canvas.height }, 1) && hold) add({ ...tb, severity: 'critical', code: 'TEXT_OFF_CANVAS', message: 'text extends beyond the frame', repair: { action: 'shrink-layout' } });
      else if (hold && !rectInside(t.rect, canvas.safe, canvas.u * 0.6)) add({ ...tb, severity: t.critical ? 'error' : 'warning', code: 'TEXT_OUTSIDE_SAFE', message: `text leaves the ${spec.safeArea.preset} safe area`, repair: { action: 'shrink-layout' } });
      const minLegible = (t.role === 'caption' || t.role === 'label' || t.role === 'eyebrow' ? 1.9 : 2.4) * canvas.u;
      if (hold && t.fontSize > 0 && t.fontSize < minLegible) add({ ...tb, severity: t.critical ? 'error' : 'warning', code: 'TEXT_TOO_SMALL', message: `font size ${t.fontSize.toFixed(0)}px is below legibility (${minLegible.toFixed(0)}px) for this canvas`, repair: { action: 'grow-text' } });
      if (hold && s.sceneIndex === lastIdx && t.critical && t.opacity > 0.9) ctaSeen = true;
    }
    if (hold) {
      for (let i = 0; i < visibleTexts.length; i++)
        for (let j = i + 1; j < visibleTexts.length; j++) {
          const a = visibleTexts[i];
          const b = visibleTexts[j];
          if (a.rect.width * a.rect.height === 0 || b.rect.width * b.rect.height === 0) continue;
          const ov = overlapArea(a.rect, b.rect) / Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
          if (ov > 0.25 && !(a.rect.x <= b.rect.x && a.rect.y <= b.rect.y && a.rect.x + a.rect.width >= b.rect.x + b.rect.width && a.rect.y + a.rect.height >= b.rect.y + b.rect.height))
            add({ ...base, severity: 'error', code: 'TEXT_OVERLAP', message: `"${a.text.slice(0, 20)}" overlaps "${b.text.slice(0, 20)}" (${Math.round(ov * 100)}%)`, repair: { action: 'shrink-layout' } });
        }
    }
    for (const m of p.media) {
      const mb = { ...base, scene: m.scene || s.scene, element: `${m.role}:${m.src}` };
      if (!m.loaded) add({ ...mb, severity: 'critical', code: 'MEDIA_BROKEN', message: `image failed to load: ${m.src}` });
      if (m.identity && m.objectFit !== 'contain') add({ ...mb, severity: 'critical', code: 'MEDIA_DISTORTED', message: `${m.role} is not rendered with object-fit: contain (would crop/distort the user asset)` });
      if (m.loaded && m.naturalWidth && m.identity && m.opacity > 0.9 && hold) {
        const scaleUp = Math.max(m.rect.width / m.naturalWidth, m.rect.height / m.naturalHeight);
        if (scaleUp > 2.2) add({ ...mb, severity: 'warning', code: 'MEDIA_UPSCALED', message: `${m.role} shown ${scaleUp.toFixed(1)}× its native size (may look soft) — a larger original would help` });
      }
    }
  }
  // ── composition: content-heavy scenes that leave most of the frame empty look unfinished
  const UNDERFILL_CATEGORIES = new Set(['infographic', 'data', 'social', 'ui', 'mobile', 'commerce']);
  spec.scenes.forEach((sc, i) => {
    const mod = SceneRegistry.get(sc.type);
    if (!mod || !UNDERFILL_CATEGORIES.has(mod.manifest.category)) return;
    let best: { cov: number; box: { x: number; y: number; width: number; height: number }; frame: number } | null = null;
    for (const smp of samples.filter((x) => x.sceneIndex === i && x.kind === 'hold')) {
      const p = probes.get(smp.frame);
      if (!p) continue;
      const rects = [...p.texts.filter((t) => t.scene === sc.id && t.opacity > 0.55 && t.text.trim()).map((t) => t.rect), ...p.media.filter((m) => m.scene === sc.id && m.opacity > 0.55).map((m) => m.rect), ...(p.boxes ?? []).filter((b) => b.scene === sc.id && b.opacity > 0.55).map((b) => b.rect)].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const x0 = Math.min(...rects.map((r) => r.x));
      const y0 = Math.min(...rects.map((r) => r.y));
      const x1 = Math.max(...rects.map((r) => r.x + r.width));
      const y1 = Math.max(...rects.map((r) => r.y + r.height));
      const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      const cov = (box.width * box.height) / (canvas.safe.width * canvas.safe.height);
      if (!best || cov > best.cov) best = { cov, box, frame: smp.frame };
    }
    if (!best || best.cov >= 0.2) return;
    // largest extra scale that keeps the content inside the safe area (Stage scales about the safe-rect centre)
    const s0 = canvas.safe;
    const cx = s0.x + s0.width / 2;
    const cy = s0.y + s0.height / 2;
    const lim = (edge: number, c: number, bound: number) => (Math.abs(edge - c) < 1 ? Infinity : Math.abs(bound - c) / Math.abs(edge - c));
    const kMax = Math.min(lim(best.box.x, cx, s0.x), lim(best.box.x + best.box.width, cx, s0.x + s0.width), lim(best.box.y, cy, s0.y), lim(best.box.y + best.box.height, cy, s0.y + s0.height)) * 0.94;
    const k = Math.min(kMax, Math.sqrt(0.3 / Math.max(0.02, best.cov)), 1.3);
    if (k < 1.06) return;
    add({ severity: 'warning', code: 'LAYOUT_UNDERFILLED', scene: sc.id, sceneIndex: i, frame: best.frame, message: `content fills only ${Math.round(best.cov * 100)}% of the safe area — scaling it up ×${k.toFixed(2)} reads better`, repair: { action: 'grow-layout', value: Math.round(k * 100) / 100 } });
  });
  if (fontsFailed.size) add({ severity: 'critical', code: 'FONT_LOAD_FAILED', message: `fonts failed to load: ${[...fontsFailed].join(', ')}` });
  checks.fonts = fontsFailed.size ? 'fail' : 'pass';
  const lastScene = spec.scenes[lastIdx];
  const lastMod = SceneRegistry.get(lastScene.type);
  if (lastMod?.manifest.category === 'cta' || lastMod?.manifest.beats[0] === 'cta') {
    checks.cta = ctaSeen ? 'pass' : 'fail';
    if (!ctaSeen) add({ severity: 'error', code: 'CTA_NOT_VISIBLE', scene: lastScene.id, sceneIndex: lastIdx, message: 'the CTA is never fully visible during its hold', repair: { action: 'extend', value: 0.6 } });
  } else checks.cta = 'skipped';

  // ── 2. timing: reading time vs hold window
  tl.entries.forEach((e, i) => {
    const s = spec.scenes[i];
    const texts = new Set<string>();
    for (const smp of samples.filter((x) => x.sceneIndex === i && x.kind === 'hold')) for (const t of probes.get(smp.frame)?.texts ?? []) if (t.scene === s.id && t.opacity > 0.3 && t.text && t.role !== 'eyebrow' && t.role !== 'number') texts.add(t.text);
    const words = [...texts].join(' ').split(/\s+/).filter(Boolean).length;
    // display copy: ~4.5 words/s + perception base (readingTime() is the stricter body-copy estimate)
    const need = words ? 0.5 + words / 4.5 : 0;
    const have = (e.durationInFrames - (e.transitionIn + e.transitionOut) / 2) / fps;
    if (need > have + 0.2) add({ severity: 'warning', code: 'HOLD_TOO_SHORT', scene: s.id, sceneIndex: i, message: `on screen ${have.toFixed(1)}s but its text needs ≈${need.toFixed(1)}s to read`, repair: { action: 'extend', value: Math.round((need - have + 0.3) * 10) / 10 } });
    if (s.voice && spec.audio.voice) {
      // s.voice.start is the phrase's absolute time in the video. The phrase should begin while the
      // scene is arriving: between its first frame and the end of its entrance transition.
      const from = e.startSec;
      const to = e.startSec + e.transitionIn / fps;
      const seg = s.voice.segment !== undefined ? spec.audio.voice.segments[s.voice.segment] : undefined;
      const at = s.voice.start ?? (seg ? spec.audio.voice.offset + seg.start : undefined);
      const drift = at === undefined ? 0 : at < from ? at - from : at > to ? at - to : 0;
      if (i > 0 && Math.abs(drift) > 0.25) add({ severity: 'warning', code: 'VOICE_DRIFT', scene: s.id, sceneIndex: i, message: `its voice phrase starts ${Math.abs(drift).toFixed(2)}s ${drift < 0 ? 'before the scene appears' : 'after the scene has fully arrived'}` });
    }
  });
  checks.timing = issues.some((i) => i.code === 'HOLD_TOO_SHORT' || i.code === 'VOICE_DRIFT') ? 'fail' : 'pass';

  // ── 3. MP4 + pixels
  let media: QualityReport['media'];
  let audio: QualityReport['audio'];
  if (opts.video && existsSync(opts.video)) {
    const pr = probe(opts.video);
    const v = pr.streams.find((x) => x.type === 'video');
    const a = pr.streams.find((x) => x.type === 'audio');
    media = { duration: pr.duration, width: v?.width, height: v?.height, fps: v?.fps, codec: v?.codec, pixFmt: v?.pixFmt, hasAudio: Boolean(a), bytes: pr.size };
    checks.container = 'pass';
    if (!v) add({ severity: 'critical', code: 'MP4_NO_VIDEO', message: 'output has no video stream' });
    if (v && v.codec !== 'h264') add({ severity: 'critical', code: 'MP4_CODEC', message: `codec ${v.codec}, expected h264` });
    if (v && v.pixFmt !== 'yuv420p') add({ severity: 'error', code: 'MP4_PIXFMT', message: `pixel format ${v.pixFmt} (yuv420p plays everywhere)` });
    if (v?.width && v.height && Math.abs(v.width / v.height - spec.canvas.width / spec.canvas.height) > 0.01) add({ severity: 'critical', code: 'MP4_ASPECT', message: `output ${v.width}×${v.height} does not match ${spec.canvas.aspect}` });
    if (Math.abs(pr.duration - tl.totalSec) > 0.15) add({ severity: 'error', code: 'MP4_DURATION', message: `duration ${pr.duration.toFixed(2)}s, expected ${tl.totalSec.toFixed(2)}s` });
    if (v?.fps && Math.abs(v.fps - fps) > 0.5) add({ severity: 'error', code: 'MP4_FPS', message: `fps ${v.fps}, expected ${fps}` });
    const mbps = pr.duration > 0 && pr.size ? (pr.size * 8) / pr.duration / 1e6 : 0;
    if (mbps > 30) add({ severity: 'warning', code: 'MP4_BITRATE_HIGH', message: `${mbps.toFixed(0)} Mbit/s — heavy for social upload (usually per-frame noise or texture)` });
    for (const [k, val] of Object.entries(pr.tags)) {
      if (/made with|remotion|nitaaq|claude/i.test(val) && !/^(handler_name|vendor_id|major_brand|compatible_brands|minor_version|language)$/i.test(k)) add({ severity: 'critical', code: 'MP4_SIGNATURE', message: `tool signature in MP4 metadata (${k}=${val.slice(0, 40)})` });
    }
    {
      const head = readFileSync(opts.video).subarray(0, 4 << 20).toString('latin1');
      const found = /x264 - core|Lavf\d|Lavc\d|remotion/i.exec(head);
      if (found) add({ severity: 'warning', code: 'ENCODER_STRING', message: `encoder string "${found[0]}" left in the file` });
    }
    if (issues.some((i) => i.code.startsWith('MP4_'))) checks.container = 'fail';
    const sfxPlanned = planSfx(spec, tl, (sc) => SceneRegistry.get(sc.type)?.manifest.sfx ?? []).length > 0;
    const expectsAudio = Boolean(spec.audio.voice || spec.audio.music || sfxPlanned);
    if (expectsAudio && !a) add({ severity: 'critical', code: 'AUDIO_MISSING', message: 'audio was planned but the MP4 has no audio track' });
    if (a) {
      audio = loudness(opts.video);
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

    // pixel checks on real output frames
    const pxDir = join(opts.outDir, 'mp4-frames');
    rmSync(pxDir, { recursive: true, force: true });
    mkdirSync(pxDir, { recursive: true });
    const outScale = (v?.width ?? spec.canvas.width) / spec.canvas.width;
    let blank = 0;
    let lowContrast = 0;
    for (const s of samples) {
      const png = join(pxDir, `f${String(s.frame).padStart(5, '0')}.png`);
      const t = Math.min(pr.duration - 0.02, (s.frame + 0.5) / fps);
      ffmpegRun(['-ss', t.toFixed(3), '-i', opts.video, '-frames:v', '1', png], 'frame extraction failed');
      if (!existsSync(png)) continue;
      const st = await frameStats(png);
      if (s.kind === 'hold' && st.stdev < 3) {
        blank++;
        add({ severity: 'critical', code: 'BLANK_FRAME', frame: s.frame, time: s.time, scene: s.scene, sceneIndex: s.sceneIndex, message: `frame at ${s.time.toFixed(2)}s is blank/uniform` });
      }
      const p = probes.get(s.frame);
      if (!p || s.kind !== 'hold') continue;
      const meta = await sharp(png).metadata();
      for (const tx of p.texts) {
        if (tx.opacity < 0.95 || !tx.text.trim() || tx.rect.width < 20) continue;
        const hex = hexOf(tx.color);
        if (!hex) continue;
        const cr = await pixelContrast(png, tx.rect, hex, outScale, meta.width!, meta.height!);
        if (cr === null) continue;
        const large = tx.fontSize >= canvas.u * 4.5;
        const min = large ? 3 : 4.5;
        if (cr < min * 0.8) {
          lowContrast++;
          add({ severity: cr < 2 ? 'error' : 'warning', code: 'TEXT_CONTRAST_LOW', frame: s.frame, time: s.time, scene: tx.scene || s.scene, sceneIndex: s.sceneIndex, element: `${tx.role}:"${tx.text.slice(0, 32)}"`, message: `measured contrast ≈${cr.toFixed(1)}:1 (needs ${min}:1)`, repair: { action: 'scrim' } });
        }
      }
    }
    checks.blank = blank ? 'fail' : 'pass';
    checks.contrast = lowContrast ? 'fail' : 'pass';
  } else {
    checks.container = 'skipped';
    checks.audio = 'skipped';
    checks.blank = 'skipped';
    checks.contrast = 'skipped';
  }

  // ── contact sheet from probe stills (qc mode = identical visuals)
  let contactSheet: string | undefined;
  try {
    const frames = samples.filter((s) => s.kind === 'hold').map((s) => join(stillsDir, `probe-${String(s.frame).padStart(5, '0')}.png`)).filter(existsSync);
    if (frames.length) {
      const cols = Math.min(6, frames.length);
      const tw = spec.canvas.width >= spec.canvas.height ? 320 : 180;
      const th = Math.round((tw * spec.canvas.height) / spec.canvas.width);
      const rows = Math.ceil(frames.length / cols);
      const comps = await Promise.all(frames.map(async (f, i) => ({ input: await sharp(f).resize(tw, th).toBuffer(), left: (i % cols) * tw, top: Math.floor(i / cols) * th })));
      contactSheet = join(opts.outDir, 'contact-sheet.png');
      await sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#000' } }).composite(comps).png().toFile(contactSheet);
    }
  } catch (e) {
    add({ severity: 'info', code: 'CONTACT_SHEET', message: `contact sheet not written: ${(e as Error).message}` });
  }

  const dedup = new Map<string, QcIssue>();
  for (const i of issues) {
    const k = `${i.code}|${i.scene ?? ''}|${i.element ?? ''}`;
    if (!dedup.has(k) || severityRank(i.severity) > severityRank(dedup.get(k)!.severity)) dedup.set(k, i);
  }
  const final = [...dedup.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const summary = { info: 0, warning: 0, error: 0, critical: 0 } as Record<Severity, number>;
  for (const i of final) summary[i.severity]++;
  const report: QualityReport = {
    version: '1.0',
    project: spec.project.id,
    video: opts.video ?? null,
    profile: opts.profile,
    createdAt: new Date().toISOString(),
    passed: summary.critical === 0,
    summary,
    checks,
    issues: final,
    samples: samples.map((s) => ({ frame: s.frame, time: Math.round(s.time * 100) / 100, scene: s.scene, kind: s.kind })),
    media,
    audio,
    contactSheet,
    repairPass: opts.pass,
  };
  writeFileSync(join(opts.outDir, 'quality-report.json'), JSON.stringify(report, null, 2));
  log.stage('QUALITY', `${report.passed ? 'PASSED' : 'FAILED'} — critical ${summary.critical}, error ${summary.error}, warning ${summary.warning} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return report;
}

export function severityRank(s: Severity): number {
  return { info: 0, warning: 1, error: 2, critical: 3 }[s];
}
