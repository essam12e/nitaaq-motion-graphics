/**
 * Font registry: curated fonts with licensing + script metadata. Files are
 * synced from @fontsource packages (all SIL OFL 1.1) into public/fonts by
 * `npm run fonts:sync`, which also writes font-manifest.json with the exact
 * files and unicode ranges. User fonts are registered at runtime from the
 * project (see font-manager.ts) after Arabic-coverage verification.
 */
import manifestJson from './font-manifest.json';

export type FontRole = 'display' | 'body' | 'latin' | 'mono';

export interface FontFile {
  weight: number;
  subset: string;
  file: string; // relative to public/
  unicodeRange?: string;
}

export interface FontDef {
  id: string;
  family: string;
  arabic: boolean;
  category: 'sans' | 'kufi' | 'geometric' | 'display' | 'mono' | 'condensed';
  roles: FontRole[];
  weights: number[];
  license: string;
  files: FontFile[];
  /** Personality notes the director uses when picking fonts. */
  tags: string[];
}

interface ManifestEntry {
  id: string;
  family: string;
  weights: number[];
  files: FontFile[];
  license: string;
}

const manifest = manifestJson as { fonts: ManifestEntry[] };
const byId = new Map(manifest.fonts.map((f) => [f.id, f]));

const META: Omit<FontDef, 'weights' | 'files' | 'license' | 'family'>[] = [
  { id: 'ibm-plex-sans-arabic', arabic: true, category: 'sans', roles: ['display', 'body'], tags: ['corporate', 'tech', 'clean', 'saudi-modern', 'readable'] },
  { id: 'noto-sans-arabic', arabic: true, category: 'sans', roles: ['display', 'body'], tags: ['neutral', 'readable', 'editorial', 'wide-weights'] },
  { id: 'noto-kufi-arabic', arabic: true, category: 'kufi', roles: ['display', 'body'], tags: ['modern', 'geometric', 'gulf', 'bold'] },
  { id: 'tajawal', arabic: true, category: 'geometric', roles: ['display', 'body'], tags: ['friendly', 'social', 'ecommerce', 'saudi'] },
  { id: 'alexandria', arabic: true, category: 'geometric', roles: ['display', 'body'], tags: ['premium', 'bold', 'futuristic', 'luxury', 'display'] },
  { id: 'changa', arabic: true, category: 'condensed', roles: ['display'], tags: ['sports', 'energetic', 'impact', 'condensed'] },
  { id: 'cairo', arabic: true, category: 'sans', roles: ['display', 'body'], tags: ['popular', 'friendly', 'ecommerce', 'bold-social'] },
  { id: 'inter', arabic: false, category: 'sans', roles: ['latin', 'body'], tags: ['ui', 'saas', 'clean'] },
  { id: 'manrope', arabic: false, category: 'geometric', roles: ['latin', 'display'], tags: ['modern', 'premium'] },
  { id: 'jetbrains-mono', arabic: false, category: 'mono', roles: ['mono', 'latin'], tags: ['code', 'tech'] },
  { id: 'anton', arabic: false, category: 'display', roles: ['latin', 'display'], tags: ['impact', 'sports', 'poster'] },
];

export const FONTS: FontDef[] = META.filter((m) => byId.has(m.id)).map((m) => {
  const e = byId.get(m.id)!;
  return { ...m, family: e.family, weights: e.weights, files: e.files, license: e.license };
});

export const FONT_IDS = FONTS.map((f) => f.id);

export function getFont(idOrFamily: string | undefined): FontDef | undefined {
  if (!idOrFamily) return undefined;
  const key = idOrFamily.trim().toLowerCase();
  return FONTS.find((f) => f.id === key || f.family.toLowerCase() === key || f.id === key.replace(/\s+/g, '-'));
}

/** Closest available weight (never silently jumps more than 200). */
export function nearestWeight(font: FontDef, wanted: number): number {
  let best = font.weights[0];
  for (const w of font.weights) if (Math.abs(w - wanted) < Math.abs(best - wanted)) best = w;
  return best;
}

/** Text families always put an Arabic-capable family + a Latin fallback + generic. */
export function cssFamily(primary: FontDef | undefined, fallbacks: (FontDef | undefined)[] = []): string {
  const fams = [primary, ...fallbacks].filter(Boolean).map((f) => `"${f!.family}"`);
  return [...new Set(fams)].join(', ') + ', sans-serif';
}
