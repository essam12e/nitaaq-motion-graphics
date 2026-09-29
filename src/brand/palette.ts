/**
 * Professional palette derivation from a logo's dominant colors.
 * Does NOT blindly use every logo color: picks a primary by visual weight x
 * chroma, derives harmonious secondary/accent, builds contrast-safe neutrals.
 */
import { contrastRatio, ensureContrast, fromOklch, hueDistance, isDark, bestTextOn, normalizeHex, toOklch, luminance, adjust } from './color';
import type { BrandProfile } from '../schema/video';

export interface WeightedColor {
  hex: string;
  weight: number;
}

export interface PaletteOptions {
  mode?: 'dark' | 'light' | 'auto';
  name?: string;
  logo?: string;
  font?: string;
  tone?: string[];
  source?: BrandProfile['source'];
}

const CHROMA_MIN = 0.045;

export function describePersonality(hex: string): string[] {
  const o = toOklch(hex);
  const tags: string[] = [];
  const warm = o.h < 80 || o.h > 330;
  tags.push(o.c < 0.06 ? 'neutral' : warm ? 'warm' : o.h < 170 ? 'natural' : o.h < 270 ? 'cool' : 'creative');
  tags.push(o.c > 0.17 ? 'vibrant' : o.c > 0.09 ? 'balanced' : 'muted');
  tags.push(o.l < 0.45 ? 'deep' : o.l > 0.75 ? 'airy' : 'confident');
  if (o.h >= 40 && o.h <= 95 && o.c > 0.08 && o.l > 0.6) tags.push('premium-gold');
  if (o.h >= 140 && o.h <= 175) tags.push('fresh');
  if (o.h >= 230 && o.h <= 275) tags.push('trustworthy');
  return tags;
}

export function derivePalette(dominant: WeightedColor[], opts: PaletteOptions = {}): BrandProfile {
  const colors = dominant
    .filter((c) => c.weight > 0)
    .map((c) => ({ ...c, hex: normalizeHex(c.hex), o: toOklch(c.hex) }))
    .sort((a, b) => b.weight - a.weight);
  const chromatic = colors.filter((c) => c.o.c >= CHROMA_MIN && c.o.l > 0.12 && c.o.l < 0.97);
  const inkLum = colors.length ? colors.reduce((s, c) => s + luminance(c.hex) * c.weight, 0) / colors.reduce((s, c) => s + c.weight, 0) : 0.5;

  // Primary: highest weight * chroma boost.
  let primary: string;
  if (chromatic.length) {
    const scored = chromatic.map((c) => ({ c, s: c.weight * (0.5 + Math.min(c.o.c, 0.25) * 4) }));
    scored.sort((a, b) => b.s - a.s);
    primary = scored[0].c.hex;
  } else {
    // Monochrome logo: stay monochrome with a restrained cool accent.
    primary = colors.length && isDark(colors[0].hex) ? '#2F6BFF' : '#1F2937';
  }
  const po = toOklch(primary);

  // Secondary: another logo hue if distinct enough, else an analogous shift.
  const secondCand = chromatic.find((c) => c.hex !== primary && hueDistance(c.o.h, po.h) > 25);
  let secondary = secondCand ? secondCand.hex : fromOklch({ l: Math.min(0.85, po.l + 0.08), c: Math.max(0.06, po.c * 0.8), h: (po.h + 330) % 360 });

  // Accent: most distant logo hue, else a tasteful split-complement.
  const distant = chromatic
    .filter((c) => c.hex !== primary && c.hex !== secondary)
    .sort((a, b) => hueDistance(b.o.h, po.h) - hueDistance(a.o.h, po.h))[0];
  let accent = distant && hueDistance(distant.o.h, po.h) > 40 ? distant.hex : fromOklch({ l: 0.8, c: Math.max(0.1, Math.min(0.16, po.c)), h: (po.h + 150) % 360 });

  // Mode: dark by default (social), light when the logo ink is dark and would vanish.
  let mode: 'dark' | 'light';
  if (opts.mode && opts.mode !== 'auto') mode = opts.mode;
  else mode = inkLum < 0.07 && chromatic.length <= 1 ? 'light' : 'dark';
  const tone = (opts.tone ?? []).join(' ').toLowerCase();
  if (!opts.mode || opts.mode === 'auto') {
    if (/light|clean|فاتح|نظيف/.test(tone)) mode = 'light';
    if (/dark|premium|luxury|فاخر|داكن/.test(tone)) mode = 'dark';
  }

  const bgChroma = Math.min(0.03, po.c * 0.25);
  const background = mode === 'dark' ? fromOklch({ l: 0.17, c: bgChroma, h: po.h }) : fromOklch({ l: 0.975, c: Math.min(0.012, bgChroma), h: po.h });
  const surface = mode === 'dark' ? fromOklch({ l: 0.24, c: bgChroma + 0.005, h: po.h }) : '#FFFFFF';
  const textPrimary = mode === 'dark' ? fromOklch({ l: 0.975, c: 0.008, h: po.h }) : fromOklch({ l: 0.2, c: Math.min(0.03, po.c * 0.3), h: po.h });
  const textSecondary = ensureContrast(mode === 'dark' ? fromOklch({ l: 0.8, c: 0.02, h: po.h }) : fromOklch({ l: 0.43, c: 0.03, h: po.h }), background, 4.5);

  // Graphics in brand color must stay visible on the background (>=3:1).
  primary = contrastRatio(primary, background) >= 3 ? primary : ensureContrast(primary, background, 3);
  secondary = contrastRatio(secondary, background) >= 2 ? secondary : ensureContrast(secondary, background, 2);
  accent = contrastRatio(accent, background) >= 3 ? accent : ensureContrast(accent, background, 3);

  return {
    name: opts.name,
    primary: normalizeHex(primary),
    secondary: normalizeHex(secondary),
    accent: normalizeHex(accent),
    background,
    surface,
    textPrimary,
    textSecondary,
    logo: opts.logo,
    font: opts.font,
    mode,
    personality: describePersonality(primary),
    dominantColors: colors.slice(0, 6).map((c) => c.hex),
    contrastRules: {
      minTextContrast: 4.5,
      minLargeTextContrast: 3,
      textOnPrimary: bestTextOn(primary, [textPrimary, '#FFFFFF', '#0B0B0F', background]),
      textOnBackground: textPrimary,
      textOnSurface: bestTextOn(surface, [textPrimary, '#FFFFFF', '#0B0B0F']),
    },
    source: opts.source ?? 'logo',
  };
}

/** Build a brand profile from explicit user colors (no logo). */
export function paletteFromUserColors(colors: string[], opts: PaletteOptions = {}): BrandProfile {
  const weighted = colors.map((hex, i) => ({ hex, weight: colors.length - i }));
  return derivePalette(weighted, { ...opts, source: 'user' });
}

/** Lighter/darker helper used by styles to build ramps. */
export const ramp = (hex: string, steps: number[]) => steps.map((d) => adjust(hex, { l: d }));
