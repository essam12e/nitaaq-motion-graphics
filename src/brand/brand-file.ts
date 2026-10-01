/**
 * brand.json — the project's brand memory: the palette actually used (after
 * contrast enforcement), which colours are safe for text on which surface, the
 * user's logo asset (never a generated one), fonts and personalities.
 */
import type { BrandProfile, VideoSpec } from '../schema/video';
import { resolveStyle } from '../styles/resolve';
import { contrastRatio } from './color';

export interface BrandFile {
  version: 1;
  name: string | null;
  source: 'logo' | 'user' | 'generated' | 'style';
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  /** For each surface: the brand colours that pass WCAG for text (≥4.5:1) or large text (≥3:1). */
  contrastSafeColors: Record<'onBackground' | 'onSurface' | 'onPrimary', { text: string[]; largeText: string[] }>;
  contrast: { pair: string; ratio: number; ok: boolean }[];
  logoAsset: string | null;
  fontPreferences: { arabic: string; latin: string | null; userFont: boolean };
  visualPersonality: string[];
  motionPersonality: string;
  style: string;
  mode: 'dark' | 'light';
  dominantColors: string[];
  note: string;
}

export function brandFile(spec: VideoSpec): BrandFile {
  const b: BrandProfile | null = spec.brand;
  const t = resolveStyle(spec.style.preset, b, spec.style.overrides);
  const p = t.palette;
  const named = { primary: p.primary, secondary: p.secondary, accent: p.accent, textPrimary: p.textPrimary, textSecondary: p.textSecondary, white: '#FFFFFF', ink: '#0B0B0F' };
  const safe = (bg: string) => {
    const text: string[] = [];
    const largeText: string[] = [];
    for (const [k, c] of Object.entries(named)) {
      const r = contrastRatio(c, bg);
      if (r >= 4.5) text.push(`${k} ${c}`);
      else if (r >= 3) largeText.push(`${k} ${c}`);
    }
    return { text, largeText };
  };
  const pairs: [string, string, string, number][] = [
    ['textPrimary/background', p.textPrimary, p.background, 4.5],
    ['textSecondary/background', p.textSecondary, p.background, 4.5],
    ['textPrimary/surface', p.textPrimary, p.surface, 4.5],
    ['accent/background (large)', p.accent, p.background, 3],
    ['primary/background (large)', p.primary, p.background, 3],
  ];
  const userFont = Boolean(b?.font && /\.(ttf|otf|woff2?)$/i.test(b.font));
  return {
    version: 1,
    name: b?.name ?? null,
    source: b ? b.source : 'style',
    primary: p.primary,
    secondary: p.secondary,
    accent: p.accent,
    background: p.background,
    surface: p.surface,
    textPrimary: p.textPrimary,
    textSecondary: p.textSecondary,
    contrastSafeColors: { onBackground: safe(p.background), onSurface: safe(p.surface), onPrimary: safe(p.primary) },
    contrast: pairs.map(([pair, a, c, min]) => {
      const ratio = Math.round(contrastRatio(a, c) * 100) / 100;
      return { pair, ratio, ok: ratio >= min };
    }),
    logoAsset: b?.logo ?? null,
    fontPreferences: { arabic: b?.font ?? t.typography.display, latin: b?.latinFont ?? t.typography.latin ?? null, userFont },
    visualPersonality: b?.personality ?? [],
    motionPersonality: spec.motion?.personality ?? t.motion.personality ?? 'tech',
    style: t.id,
    mode: t.mode === 'light' ? 'light' : 'dark',
    dominantColors: b?.dominantColors ?? [],
    note: b?.logo ? 'palette derived from the user logo; the logo file is used unchanged' : b ? 'no logo supplied: palette only, no logo is generated' : 'no brand supplied: style palette only, no logo is generated',
  };
}
