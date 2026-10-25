/**
 * A style for the legacy token path: the style's fonts, weights, line height, emphasis, surface kind,
 * radius, background kind, motion family and texture as token overrides of its mapped preset — so the
 * scene families (non-Stage films) and every QC check that resolves tokens see the same style. Pure.
 */
import type { MotionStyle } from './schema';

const EASING: Record<string, 'smooth' | 'snappy' | 'elastic' | 'cinematic'> = { precise: 'snappy', spring: 'snappy', elastic: 'elastic', glide: 'cinematic', linear: 'smooth', stepped: 'snappy' };
const ENTRANCE: Record<string, string> = { rise: 'rise', slide: 'slide', scale: 'scale', fade: 'blur', draw: 'wipe', mask: 'mask', drop: 'drop', none: 'rise' };
const HIGHLIGHT: Record<string, string> = { color: 'color', marker: 'marker', underline: 'underline', box: 'box', outline: 'outline', glow: 'glow' };

export function styleTokenOverrides(s: MotionStyle): { preset: string; overrides: Record<string, unknown> } {
  const t = s.typographyLanguage;
  const m = s.motionLanguage;
  const card = m.enter.card ?? m.enter.shape ?? 'rise';
  return {
    preset: s.tokens.preset,
    overrides: {
      typography: { display: t.display, body: t.body, displayWeight: t.displayWeight, bodyWeight: t.bodyWeight, lineHeight: t.lineHeight, highlight: HIGHLIGHT[t.emphasis] ?? 'color' },
      surface: { kind: s.tokens.surface, radius: s.shapeLanguage.radius },
      background: { kind: s.tokens.background, intensity: 0.55, animate: s.visualLanguage.compositionMotion === 'evolving' },
      motion: { easing: EASING[m.curve] ?? 'smooth', entrance: ENTRANCE[card] ?? 'rise', stagger: m.stagger, personality: m.personality, intensity: Math.min(1, 0.35 + s.character.energy * 0.6) },
      texture: { grain: s.materialLanguage.texture === 'grain' ? 0.08 : s.materialLanguage.texture === 'paper' || s.materialLanguage.texture === 'print' ? 0.05 : 0, vignette: s.visualLanguage.depth === 'deep' ? 0.35 : 0.15, scanlines: false },
      glow: Math.min(0.6, s.constraints.maxGlow),
      depth: s.depthLanguage.separation,
      density: s.visualLanguage.density === 'dense' ? 'dense' : s.visualLanguage.density === 'clean' ? 'sparse' : 'balanced',
    },
  };
}
