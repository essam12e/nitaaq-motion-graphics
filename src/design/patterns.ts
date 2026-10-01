/**
 * Pattern policy. Repeating small-element backgrounds (dots, grids, halftone,
 * bokeh/particles, stripes, line grids) are the most recognisable "generic AI
 * template" look, so they are OFF by default everywhere: style presets, scene
 * backgrounds and old video.json files all resolve to a clean large-form kind
 * unless `design.allowPatterns` explicitly names the pattern.
 */
import type { BackgroundKind, CleanBackgroundKind, PatternBackgroundKind } from '../styles/tokens';

export const PATTERN_KINDS: PatternBackgroundKind[] = ['dots', 'grid', 'halftone', 'bokeh', 'stripes', 'lines', 'particles'];

export const CLEAN_KINDS: CleanBackgroundKind[] = [
  'solid', 'brand-solid', 'soft-gradient', 'directional-gradient', 'radial-light', 'cinematic-light', 'vignette', 'brand-shapes', 'geometry',
  'depth-layers', 'glass-depth', 'editorial', 'atmosphere', 'product-stage', 'paper', 'light-sweep', 'shadow-field',
  'gradient', 'mesh', 'aurora', 'spotlight', 'rays', 'noise-gradient',
];

/** What a disallowed pattern becomes: the closest clean, large-form look. */
export const PATTERN_FALLBACK: Record<PatternBackgroundKind, CleanBackgroundKind> = {
  dots: 'soft-gradient',
  grid: 'radial-light',
  halftone: 'directional-gradient',
  bokeh: 'brand-shapes',
  particles: 'atmosphere',
  stripes: 'directional-gradient',
  lines: 'radial-light',
};

export function isPatternKind(k: string | undefined): k is PatternBackgroundKind {
  return Boolean(k && (PATTERN_KINDS as string[]).includes(k));
}

export function isBackgroundKind(k: string | undefined): k is BackgroundKind {
  return Boolean(k && ((CLEAN_KINDS as string[]).includes(k) || isPatternKind(k)));
}

/** Resolves a requested background kind against the project's pattern allowance. */
export function resolveBackgroundKind(kind: string | undefined, allow: readonly string[] = []): CleanBackgroundKind | PatternBackgroundKind | undefined {
  if (!kind) return undefined;
  if (isPatternKind(kind)) return allow.includes(kind) ? kind : PATTERN_FALLBACK[kind];
  return (CLEAN_KINDS as string[]).includes(kind) ? (kind as CleanBackgroundKind) : 'soft-gradient';
}

/** Words in a request/reference that mean the user explicitly wants a pattern. */
const PATTERN_WORDS: [RegExp, PatternBackgroundKind][] = [
  [/\bdots?\b|dotted|polka|نقاط|منقط/i, 'dots'],
  [/\bgrid\b|blueprint|شبكة|شبكي|مربعات/i, 'grid'],
  [/halftone|هاف ?تون|كوميك نقطي/i, 'halftone'],
  [/bokeh|بوكيه/i, 'bokeh'],
  [/particles?|جزيئات|جسيمات|غبار ضوئي/i, 'particles'],
  [/stripes?|striped|خطوط مائلة|مخطط/i, 'stripes'],
];

/** Patterns explicitly requested in free text (request, tone, preferences). */
export function requestedPatterns(text: string): PatternBackgroundKind[] {
  const out = new Set<PatternBackgroundKind>();
  for (const [re, k] of PATTERN_WORDS) {
    const g = new RegExp(re.source, 'gi');
    for (let m = g.exec(text); m; m = g.exec(text)) {
      // "بدون نقاط" / "no dots" / "without grid" is a ban, not a request
      const before = text.slice(Math.max(0, m.index - 24), m.index);
      if (/(بدون|بلا|من غير|لا\s+\S*\s*|ولا|no|without|avoid|not|don'?t)\s*\S*\s*$/i.test(before)) continue;
      out.add(k);
    }
  }
  return [...out];
}
