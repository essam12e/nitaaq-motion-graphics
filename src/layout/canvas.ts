/**
 * Canvas profiles and platform safe areas.
 * Layouts never crop a master composition: every scene reads the profile and
 * responds (orientation, unit size, safe rect).
 */
export type Aspect = '9:16' | '16:9' | '1:1' | '4:5';
export type Platform = 'tiktok' | 'instagram-reels' | 'instagram-feed' | 'youtube-shorts' | 'youtube' | 'generic';
export type Orientation = 'portrait' | 'landscape' | 'square';

export const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Safe-area insets as fractions of the canvas. Values approximate the regions
 * covered by each platform's UI overlays (captions, action buttons, progress).
 */
export const SAFE_AREAS: Record<Platform, Partial<Record<Aspect, Insets>> & { default: Insets }> = {
  tiktok: {
    '9:16': { top: 0.08, right: 0.12, bottom: 0.2, left: 0.06 },
    default: { top: 0.06, right: 0.1, bottom: 0.16, left: 0.06 },
  },
  'instagram-reels': {
    '9:16': { top: 0.1, right: 0.11, bottom: 0.19, left: 0.06 },
    default: { top: 0.07, right: 0.09, bottom: 0.15, left: 0.06 },
  },
  'youtube-shorts': {
    '9:16': { top: 0.08, right: 0.12, bottom: 0.21, left: 0.06 },
    default: { top: 0.07, right: 0.1, bottom: 0.16, left: 0.06 },
  },
  'instagram-feed': {
    default: { top: 0.06, right: 0.06, bottom: 0.07, left: 0.06 },
  },
  youtube: {
    '16:9': { top: 0.07, right: 0.06, bottom: 0.11, left: 0.06 },
    default: { top: 0.06, right: 0.06, bottom: 0.1, left: 0.06 },
  },
  generic: {
    default: { top: 0.06, right: 0.06, bottom: 0.06, left: 0.06 },
  },
};

export const PLATFORM_DEFAULT_ASPECT: Record<Platform, Aspect> = {
  tiktok: '9:16',
  'instagram-reels': '9:16',
  'youtube-shorts': '9:16',
  'instagram-feed': '4:5',
  youtube: '16:9',
  generic: '9:16',
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasProfile {
  width: number;
  height: number;
  aspect: Aspect;
  orientation: Orientation;
  /** 1u = 1% of the short edge. Sizes are authored in u so they read the same across ratios. */
  u: number;
  /** Safe rect in px (platform UI excluded). */
  safe: Rect;
  insets: Insets;
  /** Tall = 9:16 style, where vertical stacking is preferred. */
  isTall: boolean;
  isWide: boolean;
}

export function aspectOf(width: number, height: number): Aspect {
  const r = width / height;
  const entries = Object.entries(ASPECTS) as [Aspect, { width: number; height: number }][];
  let best: Aspect = '9:16';
  let bestD = Infinity;
  for (const [a, s] of entries) {
    const d = Math.abs(s.width / s.height - r);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

export function safeInsets(platform: Platform, aspect: Aspect): Insets {
  const p = SAFE_AREAS[platform] ?? SAFE_AREAS.generic;
  return p[aspect] ?? p.default;
}

export function makeCanvasProfile(width: number, height: number, platform: Platform, extraMargin = 0): CanvasProfile {
  const aspect = aspectOf(width, height);
  const ins = safeInsets(platform, aspect);
  const insets: Insets = {
    top: Math.round((ins.top + extraMargin) * height),
    bottom: Math.round((ins.bottom + extraMargin) * height),
    left: Math.round((ins.left + extraMargin) * width),
    right: Math.round((ins.right + extraMargin) * width),
  };
  const r = width / height;
  return {
    width,
    height,
    aspect,
    orientation: r > 1.05 ? 'landscape' : r < 0.95 ? 'portrait' : 'square',
    u: Math.min(width, height) / 100,
    safe: {
      x: insets.left,
      y: insets.top,
      width: width - insets.left - insets.right,
      height: height - insets.top - insets.bottom,
    },
    insets,
    isTall: r < 0.7,
    isWide: r > 1.3,
  };
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function rectIntersection(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}
