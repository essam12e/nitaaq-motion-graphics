/**
 * Lottie animations as media (pure, browser-safe).
 *
 * A Lottie file is vector motion with its own frame rate (`fr`) and frame range
 * [ip, op). It is played like a video clip: the same clip model (trim in
 * seconds or by a named marker, loop or hold on the last frame, playback rate,
 * delay — src/media/video.ts) maps the Remotion frame to an exact, fractional
 * Lottie frame. lottie-web never plays on its own clock: every rendered frame
 * calls goToAndStop(frame) with this number, so renders, stills, seek and QC agree.
 *
 * `inspectLottie` reads a Lottie document without rendering it: size, timing,
 * markers, what it uses (masks, mattes, effects, text, images, 3D) and what we
 * refuse (expressions run arbitrary script and are not deterministic), a
 * complexity score for the performance budget, and its colours.
 */
import { mergeClips, resolveClip, videoTimeAt, type ClipTime, type ResolvedClip, type VideoClip } from './video';

export interface LottieClip extends Omit<VideoClip, 'muted' | 'volume'> {
  /** Play one named marker (Lottie `markers[].cm`) instead of startFrom / endAt. */
  marker?: string;
}

export interface LottieMarker {
  name: string;
  /** Seconds from the first frame (ip). */
  start: number;
  duration: number;
}

export interface LottieTiming {
  fr: number;
  ip: number;
  op: number;
  markers?: LottieMarker[];
}

export interface LottieFrame extends ClipTime {
  /** Lottie frame number to show (fractional: sub-frame accurate). */
  frame: number;
}

/** Resolves a clip against a Lottie's timing (a marker overrides startFrom / endAt). */
export function resolveLottieClip(clip: LottieClip | undefined, timing: LottieTiming): ResolvedClip {
  const duration = (timing.op - timing.ip) / timing.fr;
  const m = clip?.marker ? timing.markers?.find((x) => x.name === clip.marker) : undefined;
  const base: VideoClip = m ? { ...clip, startFrom: m.start, endAt: m.duration > 0 ? m.start + m.duration : undefined } : { ...clip };
  delete (base as LottieClip).marker;
  return resolveClip(base, duration);
}

/** The Lottie frame shown at scene-local second `localSec`. */
export function lottieFrameAt(localSec: number, clip: ResolvedClip, timing: LottieTiming): LottieFrame {
  const at = videoTimeAt(localSec, clip, timing.fr);
  return { ...at, frame: Math.round((timing.ip + at.time * timing.fr) * 1e4) / 1e4 };
}

/**
 * Scene families whose job is the logo moment (logo reveal, brand lockup, logo end card, lottie-moment):
 * there a Lottie logo plays its own animation. Everywhere else (a small logo in a corner, a hub centre…)
 * it shows its finished pose. Media and seek both use this, so renders and seek agree.
 */
export const LOTTIE_LOGO_PLAYS_IN: ReadonlySet<string> = new Set(['lottie-moment', 'logo-reveal', 'brand-intro', 'cta-logo']);
export const lottieLogoPlays = (sceneType?: string) => Boolean(sceneType && LOTTIE_LOGO_PLAYS_IN.has(sceneType));

export const mergeLottieClips = (...layers: (LottieClip | undefined)[]) => mergeClips(...(layers as VideoClip[])) as LottieClip;

// ───────────────────────── inspection

export interface LottieInspection {
  version?: string;
  width: number;
  height: number;
  fr: number;
  ip: number;
  op: number;
  /** Seconds. */
  duration: number;
  markers: LottieMarker[];
  layers: number;
  shapes: number;
  masks: number;
  mattes: number;
  effects: number;
  textLayers: number;
  imageLayers: number;
  threeD: boolean;
  expressions: number;
  /** Image assets: embedded (data URI) or a file reference that must be resolved. */
  images: { id: string; embedded: boolean; path?: string }[];
  /** Fonts a text layer asks for (rendered with a fallback unless glyphs are embedded). */
  fonts: string[];
  glyphs: boolean;
  /** Rough render cost (shapes + layers + masks/mattes/effects weighted). */
  complexity: number;
  /** Static fill / stroke colours, most used first (hex). */
  colors: string[];
  /** Problems that make the file unusable (empty → usable). */
  errors: string[];
  /** Things that render, but not exactly as in After Effects. */
  warnings: string[];
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** Reads a Lottie document (already JSON-parsed). Never throws: problems go to `errors`. */
export function inspectLottie(doc: unknown): LottieInspection {
  const errors: string[] = [];
  const warnings: string[] = [];
  const d = isObj(doc) ? doc : {};
  if (!isObj(doc)) errors.push('not a JSON object');
  const fr = num(d.fr) ?? 0;
  const ip = num(d.ip) ?? 0;
  const op = num(d.op) ?? 0;
  const width = num(d.w) ?? 0;
  const height = num(d.h) ?? 0;
  if (!(fr > 0)) errors.push('missing or invalid frame rate (fr)');
  if (!(op > ip)) errors.push('missing or invalid frame range (ip / op)');
  if (!(width > 0 && height > 0)) errors.push('missing size (w / h)');
  if (!Array.isArray(d.layers)) errors.push('no layers');

  const assets = Array.isArray(d.assets) ? (d.assets.filter(isObj) as Json[]) : [];
  const images = assets
    .filter((a) => typeof a.p === 'string' && !Array.isArray(a.layers))
    .map((a) => {
      const p = a.p as string;
      const embedded = a.e === 1 || p.startsWith('data:');
      return { id: String(a.id ?? ''), embedded, path: embedded ? undefined : `${typeof a.u === 'string' ? a.u : ''}${p}` };
    });

  let layers = 0;
  let shapes = 0;
  let masks = 0;
  let mattes = 0;
  let effects = 0;
  let textLayers = 0;
  let imageLayers = 0;
  let expressions = 0;
  let threeD = d.ddd === 1;
  const colorCount = new Map<string, number>();
  const fonts = new Set<string>();

  // expressions live in an `x` string on animated properties (anywhere in the tree)
  const scanExpressions = (x: unknown): void => {
    if (Array.isArray(x)) return x.forEach(scanExpressions);
    if (!isObj(x)) return;
    if (typeof x.x === 'string' && ('k' in x || 'a' in x)) expressions++;
    for (const v of Object.values(x)) if (typeof v === 'object' && v !== null) scanExpressions(v);
  };
  const color = (c: unknown) => {
    if (!isObj(c) || c.a === 1 || !Array.isArray(c.k) || c.k.length < 3 || typeof c.k[0] !== 'number') return;
    const [r, g, b] = c.k as number[];
    const h = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    colorCount.set(h, (colorCount.get(h) ?? 0) + 1);
  };
  const walkShapes = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!isObj(it)) continue;
      shapes++;
      if (it.ty === 'fl' || it.ty === 'st') color(it.c);
      if (it.ty === 'gr') walkShapes(it.it);
    }
  };
  const walkLayers = (ls: unknown): void => {
    if (!Array.isArray(ls)) return;
    for (const l of ls) {
      if (!isObj(l)) continue;
      layers++;
      if (l.ddd === 1) threeD = true;
      if (Array.isArray(l.masksProperties)) masks += l.masksProperties.length;
      if (num(l.tt)) mattes++;
      if (Array.isArray(l.ef)) effects += l.ef.length;
      if (l.ty === 5) textLayers++;
      if (l.ty === 2) imageLayers++;
      if (l.ty === 1 && typeof l.sc === 'string') {
        const c = l.sc.replace('#', '');
        if (/^[0-9a-f]{6}$/i.test(c)) colorCount.set(`#${c.toLowerCase()}`, (colorCount.get(`#${c.toLowerCase()}`) ?? 0) + 1);
      }
      walkShapes(l.shapes);
    }
  };
  walkLayers(d.layers);
  for (const a of assets) if (Array.isArray(a.layers)) walkLayers(a.layers);
  scanExpressions(d.layers);
  for (const a of assets) if (Array.isArray(a.layers)) scanExpressions(a.layers);

  const fontList = isObj(d.fonts) && Array.isArray(d.fonts.list) ? d.fonts.list : [];
  for (const f of fontList) if (isObj(f) && typeof f.fFamily === 'string') fonts.add(f.fFamily);
  const glyphs = Array.isArray(d.chars) && d.chars.length > 0;

  if (expressions) errors.push(`${expressions} expression(s): expressions run script inside the renderer and are not deterministic — export again with expressions converted to keyframes`);
  if (threeD) warnings.push('3D layers: the SVG player draws them flat');
  if (textLayers && !glyphs) warnings.push(`text layers without embedded glyphs: drawn with a fallback font (${[...fonts].join(', ') || 'unnamed'}) — convert text to shapes for exact type`);
  if (effects) warnings.push(`${effects} layer effect(s): most After Effects effects are ignored by the player`);
  if (layers > 400) warnings.push(`${layers} layers: heavy to render`);
  const missing = images.filter((i) => !i.embedded);
  if (missing.length) warnings.push(`${missing.length} image(s) referenced by path: embedded at ingest`);

  const markers: LottieMarker[] = (Array.isArray(d.markers) ? d.markers : [])
    .filter(isObj)
    .map((m) => ({ name: String(m.cm ?? ''), start: ((num(m.tm) ?? 0) - ip) / (fr || 1), duration: (num(m.dr) ?? 0) / (fr || 1) }))
    .filter((m) => m.name);

  return {
    version: typeof d.v === 'string' ? d.v : undefined,
    width,
    height,
    fr,
    ip,
    op,
    duration: fr > 0 && op > ip ? (op - ip) / fr : 0,
    markers,
    layers,
    shapes,
    masks,
    mattes,
    effects,
    textLayers,
    imageLayers,
    threeD,
    expressions,
    images,
    fonts: [...fonts],
    glyphs,
    complexity: Math.round(shapes + layers * 2 + masks * 4 + mattes * 6 + effects * 8 + imageLayers * 3 + textLayers * 4),
    colors: [...colorCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([h]) => h),
    errors,
    warnings,
  };
}
