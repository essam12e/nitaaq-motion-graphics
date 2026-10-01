/**
 * Spec-level enforcement of design/banned-patterns.json. Pure (no I/O): used by
 * validation (before anything renders) and by QC (with the pixel detector in
 * src/qc/pattern-detect.ts for what only shows up in real frames).
 */
import banned from '../../design/banned-patterns.json';
import type { VideoSpec } from '../schema/video';
import { resolveStyle } from '../styles/resolve';
import { isPatternKind } from './patterns';
import { rgbToOklch, hexToRgb } from '../brand/color';
import { SceneRegistry } from '../scenes/registry';

export type BannedSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface BannedFinding {
  id: string;
  severity: BannedSeverity;
  message: string;
  scene?: string;
  path?: string;
}

export interface BannedRule {
  id: string;
  severity: BannedSeverity;
  detect: string[];
  allowWith?: string;
  why: string;
}

export const BANNED_RULES: BannedRule[] = (banned as { patterns: BannedRule[] }).patterns;
const rule = (id: string) => BANNED_RULES.find((r) => r.id === id)!;

const hue = (hex: string) => rgbToOklch(hexToRgb(hex)).h;
const chroma = (hex: string) => rgbToOklch(hexToRgb(hex)).c;
const bluePurple = (hex: string) => chroma(hex) > 0.06 && hue(hex) >= 235 && hue(hex) <= 310;

export function checkBannedPatterns(spec: VideoSpec): BannedFinding[] {
  const out: BannedFinding[] = [];
  const t = resolveStyle(spec.style.preset, spec.brand, spec.style.overrides);
  const allow = spec.design?.allowPatterns ?? [];
  const justified = Boolean(spec.design?.justification);
  const add = (id: string, message: string, extra: Partial<BannedFinding> = {}, severity?: BannedSeverity) => out.push({ id, severity: severity ?? rule(id).severity, message, ...extra });

  // background kinds (style + per scene)
  const kinds: { kind: string; path: string; scene?: string }[] = [
    { kind: t.background.kind, path: 'style.background.kind' },
    ...(t.background.secondaryKind ? [{ kind: t.background.secondaryKind, path: 'style.background.secondaryKind' }] : []),
    ...spec.scenes.filter((s) => s.background?.kind).map((s, i) => ({ kind: s.background!.kind!, path: `scenes[${i}].background.kind`, scene: s.id })),
  ];
  for (const k of kinds) {
    if (!isPatternKind(k.kind)) continue;
    const id = k.kind === 'dots' || k.kind === 'halftone' ? 'dotted-background' : k.kind === 'bokeh' || k.kind === 'particles' ? 'particle-field' : k.kind === 'stripes' ? 'repeating-stripes' : 'generic-tech-grid';
    if (allow.includes(k.kind as never)) {
      if (!justified) add(id, `pattern "${k.kind}" is allowed but design.justification is empty — say why the film needs it`, { path: k.path, scene: k.scene }, 'warning');
    } else add(id, `pattern background "${k.kind}" requested at ${k.path} — rendered as a clean background instead (not allowed by design.allowPatterns)`, { path: k.path, scene: k.scene }, 'info');
  }
  if (spec.design?.decorations && !justified) add('random-decorations', 'scattered decorations enabled without a justification', { path: 'design.decorations' });
  if (t.glow > 0.6 && t.id !== 'neon' && !justified) add('meaningless-glowing-circles', `glow ${t.glow} on every surface flattens hierarchy`, { path: 'style.glow' });
  if (t.id === 'neon' && !justified && !(spec.brand && spec.brand.source !== 'generated')) add('excessive-neon-glow', 'neon style chosen without a neon brand or request', { path: 'style.preset' });
  if (t.surface.kind === 'glass' && t.id !== 'glass' && t.id !== 'ai-futuristic') add('glassmorphism-everywhere', `glass surfaces on every card in style ${t.id}`, { path: 'style.surface.kind' });
  if (t.motion.entrance === 'fade') add('fade-in-only', 'the style entrance is fade-only', { path: 'style.motion.entrance' });
  if (t.texture.grain > 0.15) add('noise-reduces-readability', `grain ${t.texture.grain} is heavy over text`, { path: 'style.texture.grain' });
  const multiColourBg = ['brand-shapes', 'mesh', 'aurora'].includes(t.background.kind) || ['brand-shapes', 'mesh', 'aurora'].includes(t.background.secondaryKind ?? '');
  if (!spec.brand && multiColourBg && bluePurple(t.palette.primary) && bluePurple(t.palette.secondary) && !justified) add('generic-blue-purple-ai-gradient', 'blue-violet multi-colour gradient without a brand or request', { path: 'style.palette' });

  // repetition / template structure
  const sig = spec.scenes.map((s) => `${SceneRegistry.resolveId(s.type) ?? s.type}/${s.variant ?? ''}`);
  const counts = new Map<string, number>();
  sig.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  for (const [k, n] of counts) if (n >= 3) add('identical-cards-repeated', `${k} is used ${n} times`, { path: 'scenes' });
  for (let i = 1; i < spec.scenes.length; i++) {
    const a = SceneRegistry.resolveId(spec.scenes[i - 1].type);
    if (a && a === SceneRegistry.resolveId(spec.scenes[i].type)) add('identical-cards-repeated', `scene ${i} and ${i + 1} use the same family (${a}) back to back`, { scene: spec.scenes[i].id, path: `scenes[${i}]` });
  }
  const cats = spec.scenes.map((s) => SceneRegistry.get(s.type)?.manifest.category ?? '?');
  if (spec.scenes.length >= 3 && cats[0] === 'typography' && cats[cats.length - 1] === 'cta' && cats.slice(1, -1).every((c) => c === 'infographic')) add('centered-heading-cards-cta-template', 'heading → cards → CTA template arc', { path: 'scenes' });
  const eyebrows = spec.scenes.filter((s) => typeof (s.content as Record<string, unknown>).eyebrow === 'string').length;
  if (spec.scenes.length >= 4 && eyebrows / spec.scenes.length >= 0.6) add('excessive-pills-labels', `${eyebrows}/${spec.scenes.length} scenes carry an eyebrow label`, { path: 'scenes' });
  return out;
}

/** Background kinds that are pattern kinds anywhere in the spec (resolved or not). */
export function patternKindsIn(spec: VideoSpec): string[] {
  const t = resolveStyle(spec.style.preset, spec.brand, spec.style.overrides);
  return [t.background.kind, t.background.secondaryKind, ...spec.scenes.map((s) => s.background?.kind)].filter((k): k is string => isPatternKind(k));
}
