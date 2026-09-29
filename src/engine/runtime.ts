/** Pure derivation of everything the renderer needs from a validated spec (shared node + browser). */
import type { VideoSpec } from '../schema/video';
import { resolveStyle, highlightColor } from '../styles/resolve';
import { makeCanvasProfile } from '../layout/canvas';
import { buildTimeline } from '../core/timeline';
import { getFont, nearestWeight, cssFamily } from '../typography/registry';
import type { FontFamilies } from './context';
import type { StyleTokens } from '../styles/tokens';

export interface Runtime {
  tokens: StyleTokens;
  canvas: ReturnType<typeof makeCanvasProfile>;
  timeline: ReturnType<typeof buildTimeline>;
  fonts: FontFamilies;
  fontIds: string[];
  userFonts: { family: string; src: string }[];
  dir: 'rtl' | 'ltr';
  hl: string;
}

export const USER_FONT_FAMILY = 'AMD User Font';

export function buildRuntime(spec: VideoSpec): Runtime {
  const tokens = resolveStyle(spec.style.preset, spec.brand, spec.style.overrides);
  const canvas = makeCanvasProfile(spec.canvas.width, spec.canvas.height, spec.safeArea.preset, spec.safeArea.margin);
  const timeline = buildTimeline(spec.scenes, spec.canvas.fps);
  const userFonts: { family: string; src: string }[] = [];
  const userFontAsset = spec.brand?.font && /\.(ttf|otf|woff2?)$/i.test(spec.brand.font) ? spec.brand.font : undefined;
  if (userFontAsset) userFonts.push({ family: USER_FONT_FAMILY, src: userFontAsset });
  const display = getFont(tokens.typography.display) ?? getFont('ibm-plex-sans-arabic')!;
  const body = getFont(tokens.typography.body) ?? getFont('ibm-plex-sans-arabic')!;
  const latin = getFont(tokens.typography.latin) ?? getFont('inter')!;
  const mono = getFont(tokens.typography.mono) ?? getFont('jetbrains-mono')!;
  // Arabic fallback is always an Arabic-capable font (never an unsuitable substitute).
  const arabicFallback = getFont('ibm-plex-sans-arabic');
  const userFam = userFontAsset ? `"${USER_FONT_FAMILY}", ` : '';
  const fonts: FontFamilies = {
    display: userFam + cssFamily(display, [arabicFallback]),
    body: userFam + cssFamily(body, [arabicFallback]),
    latin: cssFamily(latin, [display]),
    mono: cssFamily(mono, [arabicFallback]),
    displayWeight: nearestWeight(display, tokens.typography.displayWeight),
    bodyWeight: nearestWeight(body, tokens.typography.bodyWeight),
  };
  const fontIds = [...new Set([display.id, body.id, latin.id, mono.id, arabicFallback!.id])];
  const dir: 'rtl' | 'ltr' = spec.project.language === 'en' ? 'ltr' : 'rtl';
  return { tokens, canvas, timeline, fonts, fontIds, userFonts, dir, hl: highlightColor(tokens) };
}
