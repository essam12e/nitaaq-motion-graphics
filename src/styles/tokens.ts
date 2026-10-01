/** Style tokens: every scene reads these instead of hardcoded looks. */
import type { MotionPersonalityId } from '../motion/personality';

/**
 * Background kinds. Clean kinds are built from 1–5 large intentional forms (gradients,
 * light, geometry). Pattern kinds (dots, grid, halftone, bokeh, stripes, lines, particles)
 * are never used by default: they render only when `design.allowPatterns` names them
 * (the user asked for that look or a reference needs it) — see src/design/patterns.ts.
 */
export type CleanBackgroundKind =
  | 'solid'
  | 'brand-solid'
  | 'soft-gradient'
  | 'directional-gradient'
  | 'radial-light'
  | 'cinematic-light'
  | 'vignette'
  | 'brand-shapes'
  | 'geometry'
  | 'depth-layers'
  | 'glass-depth'
  | 'editorial'
  | 'atmosphere'
  | 'product-stage'
  | 'paper'
  | 'light-sweep'
  | 'shadow-field'
  // legacy names kept for old video.json files (all are large-form, no repeats)
  | 'gradient'
  | 'mesh'
  | 'aurora'
  | 'spotlight'
  | 'rays'
  | 'noise-gradient';

export type PatternBackgroundKind = 'dots' | 'grid' | 'halftone' | 'bokeh' | 'stripes' | 'lines' | 'particles';
export type BackgroundKind = CleanBackgroundKind | PatternBackgroundKind;

export type SurfaceKind = 'flat' | 'glass' | 'outline' | 'elevated' | 'neon' | 'paper' | 'comic' | 'soft';
export type EasingFamily = 'smooth' | 'snappy' | 'elastic' | 'cinematic';
export type EntranceFamily = 'rise' | 'fade' | 'blur' | 'scale' | 'mask' | 'slide' | 'pop' | 'drop' | 'tilt' | 'wipe';

export interface Palette {
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  textOnPrimary: string;
  textOnSurface: string;
  border: string;
  glow: string;
  positive: string;
  negative: string;
}

export interface StyleTokens {
  id: string;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  palette: Palette;
  background: { kind: BackgroundKind; intensity: number; animate: boolean; secondaryKind?: BackgroundKind };
  /** Key light character used by light-based backgrounds and surfaces. */
  lighting: 'flat' | 'soft' | 'key' | 'spot' | 'rim';
  surface: { kind: SurfaceKind; radius: number; borderWidth: number; blur: number; opacity: number };
  shadow: { strength: number; color: string; spread: number };
  glow: number;
  typography: {
    display: string;
    body: string;
    latin: string;
    mono: string;
    displayWeight: number;
    bodyWeight: number;
    /** Multiplies all type sizes. */
    scale: number;
    lineHeight: number;
    /** Latin-only uppercase for eyebrows. */
    eyebrowCase: 'upper' | 'none';
    highlight: 'color' | 'marker' | 'underline' | 'box' | 'glow' | 'outline';
  };
  spacing: { unit: number; density: 'tight' | 'normal' | 'airy' };
  motion: { intensity: number; easing: EasingFamily; entrance: EntranceFamily; stagger: number; float: number; personality: MotionPersonalityId };
  transitions: string[];
  icon: { style: 'line' | 'duotone' | 'filled' | 'badge'; stroke: number };
  image: { treatment: 'none' | 'duotone' | 'grain' | 'rounded' | 'frame' | 'polaroid' | 'halftone' | 'mono'; radius: number };
  texture: { grain: number; vignette: number; scanlines: boolean };
  /** Spacing/density language (Director + layout read it). */
  density?: 'sparse' | 'balanced' | 'dense';
  depth: number;
  /** Small scattered decorations. Off by default (banned: random-decorations); rendered only with design.decorations. */
  accents: { shape: 'blob' | 'line' | 'ring' | 'dots' | 'plus' | 'burst' | 'none'; amount: number };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function mergeTokens(base: StyleTokens, over: DeepPartial<StyleTokens> | Record<string, unknown>): StyleTokens {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) {
    const bv = (base as unknown as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = { ...(bv as object), ...(v as object) };
    } else if (v !== undefined) out[k] = v;
  }
  return out as unknown as StyleTokens;
}
