/**
 * Paint as data: colours, linear / radial gradients and their stops, so fills,
 * strokes and gradients can be animated (pure).
 *
 * Colours interpolate in OKLab (no muddy midpoints, no hue spin through grey).
 * Gradients interpolate stop by stop (resampled when the counts differ).
 */
import { hexToRgb, oklchToRgb, rgbToHex, rgbToOklch } from '../brand/color';
import type { Mat } from './matrix';
import { IDENTITY } from './matrix';

export interface Rgba {
  hex: string;
  alpha: number;
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500',
  purple: '#800080', gray: '#808080', grey: '#808080', silver: '#C0C0C0', maroon: '#800000', navy: '#000080', teal: '#008080',
  olive: '#808000', lime: '#00FF00', aqua: '#00FFFF', cyan: '#00FFFF', fuchsia: '#FF00FF', magenta: '#FF00FF', pink: '#FFC0CB',
  brown: '#A52A2A', gold: '#FFD700', indigo: '#4B0082', violet: '#EE82EE', coral: '#FF7F50', salmon: '#FA8072', tomato: '#FF6347',
  crimson: '#DC143C', khaki: '#F0E68C', beige: '#F5F5DC', ivory: '#FFFFF0', tan: '#D2B48C', chocolate: '#D2691E', turquoise: '#40E0D0',
  skyblue: '#87CEEB', steelblue: '#4682B4', royalblue: '#4169E1', darkblue: '#00008B', darkgreen: '#006400', darkred: '#8B0000',
  darkgray: '#A9A9A9', darkgrey: '#A9A9A9', lightgray: '#D3D3D3', lightgrey: '#D3D3D3', whitesmoke: '#F5F5F5', gainsboro: '#DCDCDC',
  slategray: '#708090', dimgray: '#696969', forestgreen: '#228B22', seagreen: '#2E8B57', orchid: '#DA70D6', plum: '#DDA0DD',
  lavender: '#E6E6FA', mintcream: '#F5FFFA', hotpink: '#FF69B4', deeppink: '#FF1493', firebrick: '#B22222', goldenrod: '#DAA520',
  midnightblue: '#191970', dodgerblue: '#1E90FF', deepskyblue: '#00BFFF', limegreen: '#32CD32', orangered: '#FF4500', sienna: '#A0522D',
};

/** Parses a CSS / SVG colour. `none`, `transparent` and url(#…) are not colours: null. */
export function parseColor(src: string | undefined): Rgba | null {
  if (!src) return null;
  const s = src.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s.startsWith('url(')) return null;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) return null;
    return { hex: `#${h.slice(0, 6).toUpperCase()}`, alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const v = (p: string, max: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * max : parseFloat(p));
    const a = parts[3] !== undefined ? v(parts[3], 1) : 1;
    if (fn[1].startsWith('rgb')) return { hex: rgbToHex({ r: v(parts[0], 255), g: v(parts[1], 255), b: v(parts[2], 255) }), alpha: a };
    const h = (((parseFloat(parts[0]) % 360) + 360) % 360) / 360;
    const sat = v(parts[1], 1);
    const l = v(parts[2], 1);
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const ch = (t: number) => {
      t = (t + 1) % 1;
      return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
    };
    return { hex: rgbToHex({ r: ch(h + 1 / 3), g: ch(h), b: ch(h - 1 / 3) }), alpha: a };
  }
  return NAMED[s] ? { hex: NAMED[s], alpha: 1 } : null;
}

/** url(#id) → id. */
export const paintRef = (src: string | undefined): string | null => {
  const m = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(src ?? '');
  return m ? m[1] : null;
};

// ── OKLab

const toLab = (hex: string) => {
  const o = rgbToOklch(hexToRgb(hex));
  const h = (o.h * Math.PI) / 180;
  return { l: o.l, a: o.c * Math.cos(h), b: o.c * Math.sin(h) };
};
const fromLab = (l: number, a: number, b: number) => rgbToHex(oklchToRgb({ l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }));

/** Perceptual colour interpolation (OKLab). */
export function lerpColor(a: string, b: string, t: number): string {
  if (t <= 0) return a.toUpperCase();
  if (t >= 1) return b.toUpperCase();
  const A = toLab(a);
  const B = toLab(b);
  return fromLab(A.l + (B.l - A.l) * t, A.a + (B.a - A.a) * t, A.b + (B.b - A.b) * t);
}

export const lerpRgba = (a: Rgba, b: Rgba, t: number): Rgba => ({ hex: lerpColor(a.hex, b.hex, t), alpha: a.alpha + (b.alpha - a.alpha) * t });

export const rgbaCss = (c: Rgba) => (c.alpha >= 1 ? c.hex : `rgba(${Object.values(hexToRgb(c.hex)).join(',')},${Math.round(c.alpha * 1000) / 1000})`);

// ── gradients

export interface GradientStop {
  offset: number;
  color: string;
  opacity: number;
}

export interface Gradient {
  id: string;
  type: 'linear' | 'radial';
  units: 'objectBoundingBox' | 'userSpaceOnUse';
  /** linear: x1 y1 x2 y2 · radial: cx cy r fx fy (numbers in the gradient's units). */
  coords: Record<string, number>;
  transform: Mat;
  spread: 'pad' | 'reflect' | 'repeat';
  stops: GradientStop[];
}

export const LINEAR_DEFAULTS = { x1: 0, y1: 0, x2: 1, y2: 0 };
export const RADIAL_DEFAULTS = { cx: 0.5, cy: 0.5, r: 0.5 };

/** Gradient colour at position 0..1 (pad). */
export function sampleGradient(stops: GradientStop[], pos: number): Rgba {
  if (!stops.length) return { hex: '#000000', alpha: 0 };
  if (pos <= stops[0].offset) return { hex: stops[0].color, alpha: stops[0].opacity };
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    if (pos <= b.offset) {
      const k = b.offset - a.offset > 1e-9 ? (pos - a.offset) / (b.offset - a.offset) : 1;
      return { hex: lerpColor(a.color, b.color, k), alpha: a.opacity + (b.opacity - a.opacity) * k };
    }
  }
  const z = stops[stops.length - 1];
  return { hex: z.color, alpha: z.opacity };
}

/** Stops of `a` and `b` brought to the same offsets, then interpolated. */
export function lerpStops(a: GradientStop[], b: GradientStop[], t: number): GradientStop[] {
  const offsets = [...new Set([...a.map((s) => s.offset), ...b.map((s) => s.offset)])].sort((x, y) => x - y);
  return offsets.map((o) => {
    const A = sampleGradient(a, o);
    const B = sampleGradient(b, o);
    const c = lerpRgba(A, B, t);
    return { offset: o, color: c.hex, opacity: c.alpha };
  });
}

/** A solid colour as a gradient (so a fill can become a gradient smoothly). */
export const solidStops = (c: Rgba): GradientStop[] => [
  { offset: 0, color: c.hex, opacity: c.alpha },
  { offset: 1, color: c.hex, opacity: c.alpha },
];

export function lerpGradient(a: Gradient, b: Gradient, t: number): Gradient {
  const pick = t < 0.5 ? a : b;
  const keys = [...new Set([...Object.keys(a.coords), ...Object.keys(b.coords)])];
  const coords: Record<string, number> = {};
  for (const k of keys) coords[k] = (a.coords[k] ?? b.coords[k] ?? 0) + ((b.coords[k] ?? a.coords[k] ?? 0) - (a.coords[k] ?? b.coords[k] ?? 0)) * t;
  return { ...pick, coords: a.type === b.type ? coords : pick.coords, transform: t < 0.5 ? a.transform : b.transform, stops: lerpStops(a.stops, b.stops, t) };
}

export const emptyGradient = (id: string): Gradient => ({ id, type: 'linear', units: 'objectBoundingBox', coords: { ...LINEAR_DEFAULTS }, transform: [...IDENTITY], spread: 'pad', stops: [] });
