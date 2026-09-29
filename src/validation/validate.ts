/**
 * Semantic validation of video.json against the registries (scenes, styles,
 * transitions, SFX), policies (no invented data, no developer signatures) and,
 * optionally, the files on disk (via the injected `fileExists`).
 * Pure: usable from the CLI, the renderer and the Studio.
 */
import { VideoSchema, type VideoSpec } from '../schema/video';
import { SceneRegistry } from '../scenes';
import { findStyleId, STYLE_IDS } from '../styles/presets';
import { isKnownTransition, TRANSITION_IDS } from '../transitions/presentations';
import { isKnownSfx } from '../audio/sfx-library';
import { ASPECTS } from '../layout/canvas';
import { hasArabic } from '../typography/arabic';
import { buildTimeline } from '../core/timeline';

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface Issue {
  severity: Severity;
  code: string;
  path: string;
  message: string;
  /** A deterministic auto-repair exists for this issue. */
  repairable?: boolean;
  hint?: string;
}

export interface ValidateOptions {
  fileExists?: (projectRelative: string) => boolean;
  referencedFiles?: string[];
  /** Arabic-capability check for a user font file (node supplies it). */
  fontCheck?: (projectRelative: string) => { ok: boolean; reason?: string };
}

/** Text that would identify the tool/developer rather than the user's brand. */
export const DEVELOPER_SIGNATURES: RegExp[] = [/made\s+(with|by)\s+(nitaaq|remotion|claude|ai)/i, /created\s+with\s+(nitaaq|claude)/i, /nitaaq\s*\|?\s*motion\s+graphics/i, /نطاق\s*\|\s*موشن/, /@med3bbas/i, /\bwatermark\b/i, /صنع بواسطة/, /تم إنشاؤه بواسطة/];

function walkStrings(v: unknown, path: string, out: { path: string; text: string }[]) {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkStrings(x, `${path}.${k}`, out);
}

export function textLength(content: Record<string, unknown>): number {
  const all: { path: string; text: string }[] = [];
  walkStrings(content, '', all);
  return all.filter((s) => !/\.(png|jpe?g|webp|svg|mp3|wav)$/i.test(s.text) && !s.text.startsWith('lib:') && !/^(icon|image|logo|role|kind|from)$/.test(s.path.split('.').pop()!.replace(/\[\d+\]/, ''))).reduce((a, s) => a + s.text.length, 0);
}

export function parseSpec(input: unknown): { spec?: VideoSpec; issues: Issue[] } {
  const r = VideoSchema.safeParse(input);
  if (r.success) return { spec: r.data, issues: [] };
  return {
    issues: r.error.issues.map((i) => ({ severity: 'critical' as const, code: 'SCHEMA_INVALID', path: i.path.join('.') || '(root)', message: i.message })),
  };
}

export function validateSpec(spec: VideoSpec, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  // canvas
  const want = ASPECTS[spec.canvas.aspect];
  const ratio = spec.canvas.width / spec.canvas.height;
  if (Math.abs(ratio - want.width / want.height) > 0.01) add({ severity: 'error', code: 'CANVAS_MISMATCH', path: 'canvas', message: `canvas ${spec.canvas.width}×${spec.canvas.height} does not match aspect ${spec.canvas.aspect}`, repairable: true });
  if (spec.canvas.width % 2 || spec.canvas.height % 2) add({ severity: 'error', code: 'CANVAS_ODD', path: 'canvas', message: 'H.264 needs even dimensions', repairable: true });

  // style
  const styleId = findStyleId(spec.style.preset);
  if (!styleId) add({ severity: 'critical', code: 'STYLE_UNKNOWN', path: 'style.preset', message: `unknown style "${spec.style.preset}"`, hint: `available: ${STYLE_IDS().join(', ')}` });
  else if (styleId !== spec.style.preset) add({ severity: 'info', code: 'STYLE_ALIAS', path: 'style.preset', message: `"${spec.style.preset}" resolves to "${styleId}"`, repairable: true });

  // scenes
  const ids = new Set<string>();
  spec.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (ids.has(s.id)) add({ severity: 'error', code: 'SCENE_ID_DUPLICATE', path: `${p}.id`, message: `duplicate scene id "${s.id}"`, repairable: true });
    ids.add(s.id);
    const mod = SceneRegistry.get(s.type);
    if (!mod) {
      add({ severity: 'critical', code: 'SCENE_UNKNOWN', path: `${p}.type`, message: `unknown scene type "${s.type}"`, hint: 'run `npm run scenes` to list families' });
      return;
    }
    const m = mod.manifest;
    if (m.id !== s.type) add({ severity: 'info', code: 'SCENE_ALIAS', path: `${p}.type`, message: `"${s.type}" resolves to "${m.id}"`, repairable: true });
    if (s.variant && !m.variants.includes(s.variant)) add({ severity: 'error', code: 'VARIANT_UNKNOWN', path: `${p}.variant`, message: `"${s.variant}" is not a variant of ${m.id} (${m.variants.join(', ')})`, repairable: true });
    if (!m.aspectRatios.includes(spec.canvas.aspect)) add({ severity: 'error', code: 'ASPECT_UNSUPPORTED', path: `${p}.type`, message: `${m.id} does not support ${spec.canvas.aspect}` });
    if (s.duration < m.minDuration || s.duration > m.maxDuration) add({ severity: s.voice ? 'info' : 'warning', code: 'DURATION_RANGE', path: `${p}.duration`, message: `${s.duration}s is outside ${m.id}'s ${m.minDuration}–${m.maxDuration}s`, repairable: true });
    const c = m.content.safeParse(s.content);
    if (!c.success) {
      for (const e of c.error.issues) add({ severity: 'critical', code: 'SCENE_CONTENT_INVALID', path: `${p}.content.${e.path.join('.')}`, message: e.message });
    } else {
      for (const v of m.validate?.(c.data) ?? []) add({ severity: v.severity === 'error' ? 'error' : 'warning', code: 'SCENE_RULE', path: `${p}.${v.path}`, message: v.message });
      const cap = m.textCapacity?.[s.variant ?? m.defaultVariant];
      const len = textLength(s.content);
      if (cap && len > cap * 1.35) add({ severity: 'warning', code: 'TEXT_DENSE', path: `${p}.content`, message: `${len} characters is a lot for ${m.id}/${s.variant ?? m.defaultVariant} (≈${cap} comfortable)`, hint: 'the layout engine will downsize; consider splitting the message' });
    }
    // policy: placeholder data sources must not ship
    const strs: { path: string; text: string }[] = [];
    walkStrings(s.content, `${p}.content`, strs);
    for (const t of strs) {
      if (t.path.endsWith('.source') && /^(example|sample|placeholder|tbd|todo|xxx)$/i.test(t.text.trim())) add({ severity: 'critical', code: 'PLACEHOLDER_DATA', path: t.path, message: 'numbers/quotes marked as example data — real deliveries need the real source (the system never invents data)' });
      for (const re of DEVELOPER_SIGNATURES) if (re.test(t.text)) add({ severity: 'critical', code: 'DEVELOPER_SIGNATURE', path: t.path, message: `text looks like a tool/developer signature ("${t.text.slice(0, 40)}")`, hint: 'zero-watermark policy: videos carry only the user brand' });
      if (spec.project.language === 'en' && hasArabic(t.text) && !t.path.endsWith('.source')) add({ severity: 'info', code: 'MIXED_SCRIPT', path: t.path, message: 'Arabic text in an English project (rendered with Arabic font fallback)' });
    }
    if (s.transition && !isKnownTransition(s.transition.type)) add({ severity: 'error', code: 'TRANSITION_UNKNOWN', path: `${p}.transition.type`, message: `unknown transition "${s.transition.type}"`, hint: TRANSITION_IDS().join(', '), repairable: true });
    if (s.transition && i < spec.scenes.length - 1) {
      const next = spec.scenes[i + 1];
      const cap = Math.min(s.duration, next.duration) * 0.45;
      if (s.transition.duration > cap) add({ severity: 'warning', code: 'TRANSITION_LONG', path: `${p}.transition.duration`, message: `${s.transition.duration}s overlaps too much of the neighbouring scenes (max ${cap.toFixed(2)}s)`, repairable: true });
    }
    if (s.transition && i === spec.scenes.length - 1 && s.transition.type !== 'none' && s.transition.type !== 'cut') add({ severity: 'info', code: 'TRANSITION_LAST', path: `${p}.transition`, message: 'last scene has an outgoing transition (ignored)', repairable: true });
    if (Array.isArray(s.sfx)) s.sfx.forEach((e, k) => !isKnownSfx(e.sound) && !spec.audio.sfx.overrides[e.sound] && add({ severity: 'warning', code: 'SFX_UNKNOWN', path: `${p}.sfx[${k}].sound`, message: `unknown sound "${e.sound}"`, repairable: true }));
    if (s.voice?.segment !== undefined && !spec.audio.voice?.segments[s.voice.segment]) add({ severity: 'error', code: 'VOICE_SEGMENT_MISSING', path: `${p}.voice.segment`, message: `voice segment ${s.voice.segment} does not exist`, repairable: true });
  });

  // brand / identity
  const allStrings: { path: string; text: string }[] = [];
  walkStrings({ title: spec.project.title, brand: spec.brand?.name }, '', allStrings);
  if (spec.brand?.logo && opts.fileExists && !spec.brand.logo.startsWith('lib:') && !opts.fileExists(spec.brand.logo)) add({ severity: 'critical', code: 'ASSET_MISSING', path: 'brand.logo', message: `logo file not found: ${spec.brand.logo}` });

  // audio
  const a = spec.audio;
  if (a.mode === 'user-voice' && !a.voice) add({ severity: 'critical', code: 'AUDIO_MISSING', path: 'audio.voice', message: 'audio.mode is user-voice but no voice file is set' });
  if (a.mode === 'tts' && !a.voice) add({ severity: 'critical', code: 'AUDIO_MISSING', path: 'audio.voice', message: 'audio.mode is tts but the voice has not been synthesized (no premium provider output)' });
  if (a.mode === 'none' && a.voice) add({ severity: 'warning', code: 'AUDIO_MODE', path: 'audio.mode', message: 'a voice file is set but audio.mode is none (voice will not play)', repairable: true });
  if (a.music && !a.music.license && !a.music.src.startsWith('lib:')) add({ severity: 'info', code: 'MUSIC_LICENSE', path: 'audio.music.license', message: 'user-supplied music: make sure you hold the rights (no license recorded)' });
  if (a.voice?.duration && a.voice.offset + a.voice.duration > totalDuration(spec) + 0.05) add({ severity: 'error', code: 'VOICE_TOO_LONG', path: 'audio.voice', message: `voice (${(a.voice.offset + a.voice.duration).toFixed(2)}s) runs past the end of the video (${totalDuration(spec).toFixed(2)}s)`, repairable: true });

  // fonts
  if (spec.brand?.font && /\.(ttf|otf|woff2?)$/i.test(spec.brand.font) && opts.fontCheck) {
    const r = opts.fontCheck(spec.brand.font);
    if (!r.ok) add({ severity: spec.project.language === 'en' ? 'warning' : 'critical', code: 'FONT_NOT_ARABIC', path: 'brand.font', message: r.reason ?? 'font cannot render Arabic', hint: 'use an Arabic-capable font or set it as brand.latinFont' });
  }

  // files
  if (opts.fileExists && opts.referencedFiles) for (const f of opts.referencedFiles) if (!opts.fileExists(f)) add({ severity: 'critical', code: 'ASSET_MISSING', path: f, message: `referenced file not found: ${f}` });

  // timing
  const total = totalDuration(spec);
  if (total > 180) add({ severity: 'warning', code: 'DURATION_LONG', path: 'scenes', message: `total ${total.toFixed(1)}s — long for a motion ad` });
  return issues;
}

export function totalDuration(spec: VideoSpec): number {
  return buildTimeline(spec.scenes, spec.canvas.fps).totalSec;
}

export function summarize(issues: Issue[]): Record<Severity, number> {
  return { info: issues.filter((i) => i.severity === 'info').length, warning: issues.filter((i) => i.severity === 'warning').length, error: issues.filter((i) => i.severity === 'error').length, critical: issues.filter((i) => i.severity === 'critical').length };
}
