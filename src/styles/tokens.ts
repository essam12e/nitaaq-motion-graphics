/** Style tokens: every scene reads these instead of hardcoded looks. */
export type BackgroundKind =
  | 'solid'
  | 'gradient'
  | 'mesh'
  | 'grid'
  | 'dots'
  | 'aurora'
  | 'spotlight'
  | 'paper'
  | 'halftone'
  | 'lines'
  | 'rays'
  | 'bokeh'
  | 'stripes'
  | 'noise-gradient';

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
  motion: { intensity: number; easing: EasingFamily; entrance: EntranceFamily; stagger: number; float: number };
  transitions: string[];
  icon: { style: 'line' | 'duotone' | 'filled' | 'badge'; stroke: number };
  image: { treatment: 'none' | 'duotone' | 'grain' | 'rounded' | 'frame' | 'polaroid' | 'halftone' | 'mono'; radius: number };
  texture: { grain: number; vignette: number; scanlines: boolean };
  depth: number;
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
