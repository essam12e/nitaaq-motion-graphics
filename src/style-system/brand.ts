/**
 * Brand adaptation: the brand's colours are fed INTO the style's colour behaviour and material
 * rules (a Swiss film floods columns with the brand primary; an isometric film derives the three
 * face tones from it; a luxury film turns the brand accent into metal). The style never imposes
 * its own colours. Product / logo pixels are never touched (see preservation.ts). Pure.
 */
import type { MotionStyle } from './schema';
import type { Palette } from '../styles/tokens';
import { adjust, alpha, bestTextOn, ensureContrast, hueDistance, isDark, mix, toOklch, fromOklch, contrastRatio } from '../brand/color';

export interface BrandColors { primary: string; secondary: string; accent: string; background: string; surface: string; textPrimary: string; textSecondary: string; source?: string }

export interface BrandAdaptation {
  palette: Palette;
  /** Material colours the renderer uses (faces, metal, keylines, light). */
  roles: Record<string, string>;
  notes: string[];
}

const NEUTRAL: BrandColors = { primary: '#3D6BFF', secondary: '#1B2A4A', accent: '#FFB547', background: '#0E1016', surface: '#171A22', textPrimary: '#F4F5F7', textSecondary: '#A7ACB8', source: 'neutral' };

/** A third hue when the brand has only one or two distinct colours (split complement of the primary). */
function thirdHue(b: BrandColors): string {
  const p = toOklch(b.primary);
  const s = toOklch(b.secondary);
  const a = toOklch(b.accent);
  if (hueDistance(a.h, p.h) > 40 && a.c > 0.06) return b.accent;
  if (hueDistance(s.h, p.h) > 40 && s.c > 0.06) return b.secondary;
  return fromOklch({ l: Math.min(0.78, Math.max(0.6, p.l)), c: Math.max(0.12, p.c), h: (p.h + 150) % 360 });
}

export function adaptBrand(style: MotionStyle, brand: BrandColors | null | undefined): BrandAdaptation {
  const b = brand ?? NEUTRAL;
  const notes: string[] = [brand ? `brand colours from ${b.source ?? 'brand'}` : 'no brand colours: neutral base, the style rules still apply'];
  const cb = style.colorBehavior;
  const primary = b.primary;
  const pO = toOklch(primary);
  let ground: string;
  switch (cb.ground) {
    case 'dark': ground = isDark(b.background) ? b.background : mix('#0C0E13', primary, 0.06); break;
    case 'light': ground = !isDark(b.background) ? b.background : mix('#F5F5F2', primary, 0.05); break;
    case 'paper': ground = mix('#F2ECE1', primary, 0.03); break;
    case 'brand': ground = primary; break;
    case 'deep-brand': ground = fromOklch({ l: 0.17, c: Math.min(0.06, pO.c * 0.45), h: pO.h }); break;
    case 'black': ground = '#07080B'; break;
    case 'blueprint': ground = fromOklch({ l: 0.33, c: 0.11, h: hueDistance(pO.h, 255) < 70 && pO.c > 0.05 ? pO.h : 255 }); break;
  }
  const dark = isDark(ground);
  const ink = dark ? '#F6F6F4' : '#101114';
  // the signal colour: the brand's own colour that reads on the ground
  let signal = primary;
  if (cb.ground === 'brand') signal = contrastRatio(b.accent, ground) >= 3 ? b.accent : contrastRatio(b.secondary, ground) >= 3 ? b.secondary : ink;
  else if (contrastRatio(primary, ground) < 3) signal = contrastRatio(b.accent, ground) >= 3 ? b.accent : ensureContrast(primary, ground, 3);
  const second = cb.hues === 'mono' ? mix(signal, ground, 0.55) : b.secondary !== b.primary ? b.secondary : adjust(primary, { l: dark ? 0.12 : -0.12 });
  const third = cb.hues === 'tri' || cb.hues === 'multi' ? thirdHue(b) : b.accent;

  const m = style.materialLanguage;
  let surface: string;
  switch (m.kind) {
    case 'glass': case 'frosted': surface = alpha('#FFFFFF', dark ? 0.1 : 0.45); break;
    case 'soft-ui': surface = mix(ground, ink, dark ? 0.07 : 0.03); break;
    case 'paper': case 'print': surface = mix(ground, '#FFFFFF', 0.5); break;
    case 'clay': surface = mix(primary, '#FFFFFF', 0.62); break;
    case 'sticker': surface = '#FFFFFF'; break;
    case 'outline': case 'blueprint': surface = alpha(ink, 0.04); break;
    case 'neon': surface = alpha(signal, 0.08); break;
    case 'metallic': surface = mix(ground, '#FFFFFF', 0.04); break;
    case 'iso': surface = mix(primary, '#FFFFFF', 0.2); break;
    case 'gloss': surface = mix(primary, '#FFFFFF', 0.25); break;
    case 'studio': surface = mix(ground, '#FFFFFF', 0.08); break;
    default: surface = cb.ground === 'brand' ? mix(primary, '#FFFFFF', 0.85) : mix(ground, ink, dark ? 0.1 : 0.05);
  }
  const roles: Record<string, string> = {
    ground, ink, signal, second, third, surface,
    // isometric / clay faces: top lighter toward warm white, right side darker toward a cool dark
    faceTop: mix(primary, '#FFF6E8', 0.2), faceLeft: primary, faceRight: mix(primary, '#10131C', 0.22),
    metal: mix(b.accent !== b.primary ? b.accent : primary, '#E9D9AE', 0.55), metalDark: mix(b.accent, '#3A2E14', 0.5),
    keyline: cb.ground === 'blueprint' ? '#EAF2FF' : alpha(ink, dark ? 0.5 : 0.7),
    light: cb.ground === 'black' || dark ? mix(primary, '#FFFFFF', 0.55) : '#FFFFFF',
    stickerBorder: '#FFFFFF', shadow: dark ? '#000000' : mix(ground, '#000000', 0.75),
  };
  if (m.kind === 'metallic') notes.push('the brand accent becomes the metal of hairlines (product pixels untouched)');
  if (m.kind === 'iso') notes.push('isometric faces are three tones of the brand primary');
  if (cb.ground === 'brand') notes.push('the brand primary is the ground; the signal is the brand accent');
  const textOn = (bg: string) => bestTextOn(bg, [ink, '#FFFFFF', '#0B0B0F']);
  const solidSurface = surface.length > 7 ? (dark ? mix(ground, '#FFFFFF', 0.12) : mix(ground, '#000000', 0.04)) : surface;
  const palette: Palette = {
    background: ground,
    backgroundAlt: cb.gradients === 'none' ? ground : mix(ground, primary, dark ? 0.14 : 0.08),
    surface: solidSurface,
    surfaceAlt: mix(solidSurface, primary, 0.08),
    primary: signal,
    secondary: second,
    accent: third,
    textPrimary: ensureContrast(ink, ground, 7),
    textSecondary: ensureContrast(mix(ink, ground, 0.35), ground, 4.5),
    textOnPrimary: textOn(signal),
    textOnSurface: textOn(solidSurface),
    border: alpha(ink, dark ? 0.16 : 0.14),
    glow: signal,
    positive: '#2FBF71',
    negative: '#E5484D',
  };
  return { palette, roles, notes };
}
