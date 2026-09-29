/** Color math: hex/rgb/OKLCH conversions, WCAG contrast, mixing. Shared (node + browser). */
export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface OKLCH {
  l: number;
  c: number;
  h: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function isHex(s: unknown): s is string {
  return typeof s === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s.trim());
}

export function normalizeHex(s: string): string {
  return rgbToHex(hexToRgb(s));
}

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp01(c) * 255);
};

export function luminance(hex: string | RGB): number {
  const { r, g, b } = typeof hex === 'string' ? hexToRgb(hex) : hex;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function rgbToOklch(rgb: RGB): OKLCH {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToRgb({ l, c, h }: OKLCH): RGB {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return {
    r: linearToSrgb(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: linearToSrgb(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: linearToSrgb(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  };
}

export const toOklch = (hex: string) => rgbToOklch(hexToRgb(hex));
export const fromOklch = (o: OKLCH) => rgbToHex(oklchToRgb(o));

export function withLightness(hex: string, l: number): string {
  const o = toOklch(hex);
  return fromOklch({ ...o, l: clamp01(l) });
}

export function adjust(hex: string, d: { l?: number; c?: number; h?: number }): string {
  const o = toOklch(hex);
  return fromOklch({ l: clamp01(o.l + (d.l ?? 0)), c: Math.max(0, o.c + (d.c ?? 0)), h: (o.h + (d.h ?? 0) + 360) % 360 });
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

export function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp01(a) * 1000) / 1000})`;
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.18;
}

/** Best readable text color (from candidates) on a background. */
export function bestTextOn(bg: string, candidates: string[] = ['#FFFFFF', '#0B0B0F']): string {
  let best = candidates[0];
  let bestC = 0;
  for (const c of candidates) {
    const r = contrastRatio(c, bg);
    if (r > bestC) {
      bestC = r;
      best = c;
    }
  }
  return best;
}

/**
 * Nudge `fg` lightness (keeping hue) until it reaches `min` contrast against `bg`.
 * Returns the original if already OK; falls back to black/white.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrastRatio(fg, bg) >= min) return normalizeHex(fg);
  const o = toOklch(fg);
  const bgDark = isDark(bg);
  for (let i = 1; i <= 40; i++) {
    const l = clamp01(o.l + (bgDark ? 1 : -1) * i * 0.025);
    const cand = fromOklch({ ...o, l, c: o.c * (1 - i * 0.012) });
    if (contrastRatio(cand, bg) >= min) return cand;
  }
  return bestTextOn(bg);
}

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
