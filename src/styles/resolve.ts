/**
 * Resolve final tokens = style preset + brand palette + per-project overrides,
 * then enforce contrast so no combination produces unreadable text.
 */
import { STYLE_PRESETS, findStyleId } from './presets';
import { mergeTokens, type StyleTokens } from './tokens';
import type { BrandProfile } from '../schema/video';
import { bestTextOn, contrastRatio, ensureContrast, alpha, mix, isDark } from '../brand/color';
import { getFont } from '../typography/registry';

export function resolveStyle(presetId: string, brand: BrandProfile | null, overrides: Record<string, unknown> = {}): StyleTokens {
  const id = findStyleId(presetId) ?? 'saudi-modern';
  let t = mergeTokens(STYLE_PRESETS[id], overrides);
  if (brand) {
    const p = t.palette;
    const bgDark = isDark(brand.background);
    t = {
      ...t,
      mode: bgDark ? 'dark' : 'light',
      palette: {
        ...p,
        background: brand.background,
        backgroundAlt: mix(brand.background, brand.primary, 0.08),
        surface: brand.surface,
        surfaceAlt: mix(brand.surface, brand.primary, 0.08),
        primary: brand.primary,
        secondary: brand.secondary,
        accent: brand.accent,
        textPrimary: brand.textPrimary,
        textSecondary: brand.textSecondary,
        textOnPrimary: brand.contrastRules.textOnPrimary ?? bestTextOn(brand.primary),
        textOnSurface: brand.contrastRules.textOnSurface ?? bestTextOn(brand.surface, [brand.textPrimary, '#FFFFFF', '#0B0B0F']),
        border: alpha(brand.textPrimary, bgDark ? 0.14 : 0.12),
        glow: brand.primary,
      },
    };
    if (brand.font && getFont(brand.font)?.arabic) {
      t = { ...t, typography: { ...t.typography, display: getFont(brand.font)!.id, body: getFont(brand.font)!.id } };
    }
    if (brand.latinFont && getFont(brand.latinFont)) t = { ...t, typography: { ...t.typography, latin: getFont(brand.latinFont)!.id } };
    // A light brand on a style built for glow: tone down glow.
    if (!bgDark) t = { ...t, glow: Math.min(t.glow, 0.15) };
  }
  return enforceContrast(t);
}

export function enforceContrast(t: StyleTokens): StyleTokens {
  const p = { ...t.palette };
  p.textPrimary = ensureContrast(p.textPrimary, p.background, 7);
  p.textSecondary = ensureContrast(p.textSecondary, p.background, 4.5);
  p.textOnSurface = ensureContrast(p.textOnSurface, p.surface, 4.5);
  if (contrastRatio(p.textOnPrimary, p.primary) < 4.5) p.textOnPrimary = bestTextOn(p.primary, [p.textOnPrimary, '#FFFFFF', '#0B0B0F']);
  return { ...t, palette: p };
}

/** Colour of highlighted words on the background (must stay ≥3:1 for large type). */
export function highlightColor(t: StyleTokens): string {
  const c = contrastRatio(t.palette.primary, t.palette.background) >= 3 ? t.palette.primary : t.palette.accent;
  return ensureContrast(c, t.palette.background, 3);
}
