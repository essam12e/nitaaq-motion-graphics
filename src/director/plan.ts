/**
 * Creative Director: turns a brief into a CreativePlan — objective, narrative
 * arc (beats the brief can actually support), pacing, duration, visual style,
 * energy curve, audio and brand strategy. Pure/deterministic: no I/O.
 */
import type { Brief } from '../schema/brief';
import type { Beat, CreativePlan } from '../schema/plan';
import type { BrandProfile } from '../schema/video';
import { PLATFORM_DEFAULT_ASPECT } from '../layout/canvas';
import { STYLE_PRESETS } from '../styles/presets';
import { SceneRegistry } from '../scenes';
import { RECIPES, type RecipeCtx } from './recipes';
import { pickStyle } from './direction';

type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

export const ARCS: Record<Brief['objective'], Beat[]> = {
  promote: ['hook', 'problem', 'bridge', 'solution', 'feature', 'demo', 'data', 'proof', 'social', 'offer', 'cta'],
  sell: ['hook', 'product', 'feature', 'offer', 'social', 'proof', 'cta'],
  explain: ['hook', 'problem', 'bridge', 'solution', 'demo', 'process', 'feature', 'comparison', 'data', 'cta'],
  announce: ['hook', 'brand', 'product', 'feature', 'demo', 'offer', 'cta'],
  educate: ['hook', 'problem', 'process', 'comparison', 'data', 'feature', 'cta'],
  brand: ['hook', 'brand', 'feature', 'social', 'proof', 'cta'],
  recruit: ['hook', 'brand', 'feature', 'process', 'social', 'cta'],
  event: ['hook', 'brand', 'process', 'feature', 'offer', 'cta'],
};

/**
 * Genre arcs: a launch film teases before it reveals, a product commercial
 * earns the hero shot then the details, a map film travels, a logo film is
 * the logo. social-ad / saas / web-ui keep the objective's arc.
 */
export const GENRE_ARCS: Partial<Record<string, Beat[]>> = {
  launch: ['tease', 'reveal', 'montage', 'feature', 'product', 'offer', 'cta'],
  product: ['hook', 'product', 'detail', 'feature', 'offer', 'social', 'proof', 'cta'],
  kinetic: ['hook', 'problem', 'solution', 'feature', 'proof', 'cta'],
  logo: ['brand', 'cta'],
  map: ['hook', 'map', 'data', 'feature', 'proof', 'cta'],
  data: ['hook', 'data', 'proof', 'comparison', 'solution', 'cta'],
  whiteboard: ['hook', 'problem', 'solution', 'process', 'feature', 'cta'],
  illustrated: ['hook', 'problem', 'solution', 'process', 'feature', 'cta'],
  explainer: ['hook', 'problem', 'bridge', 'solution', 'process', 'feature', 'data', 'cta'],
  procedural: ['hook', 'problem', 'solution', 'feature', 'cta'],
  music: ['hook', 'montage', 'feature', 'product', 'offer', 'cta'],
};
/** Beats that may open a film instead of 'hook' (they do the hook's job). */
const OPENERS: Beat[] = ['hook', 'tease', 'brand'];

/** Which beats survive first when the duration can't fit them all (lower = kept first). */
const PRIORITY: Beat[] = ['hook', 'cta', 'reveal', 'solution', 'product', 'map', 'offer', 'feature', 'demo', 'montage', 'problem', 'proof', 'data', 'process', 'tease', 'detail', 'social', 'comparison', 'brand', 'bridge'];

export const BEAT_ENERGY: Record<Beat, number> = {
  hook: 0.92, problem: 0.5, bridge: 0.85, solution: 0.8, demo: 0.55, feature: 0.62, product: 0.72, offer: 0.86,
  proof: 0.6, data: 0.58, social: 0.55, process: 0.55, comparison: 0.56, brand: 0.75, cta: 0.9,
  tease: 0.6, reveal: 0.98, montage: 0.88, detail: 0.5, map: 0.6,
};

const PLATFORM_DURATION: Record<Brief['platform'], number> = {
  tiktok: 18, 'instagram-reels': 18, 'youtube-shorts': 20, 'instagram-feed': 18, youtube: 35, generic: 20,
};

const SCENE_SECONDS: Record<'slow' | 'medium' | 'fast', number> = { slow: 3.8, medium: 3.1, fast: 2.6 };

export const orientationOf = (a: Aspect): RecipeCtx['orientation'] => (a === '16:9' ? 'landscape' : a === '1:1' ? 'square' : 'portrait');

export interface PlanInput {
  brief: Brief;
  brand: BrandProfile | null;
  assets: RecipeCtx['assets'];
  /** Duration of the user's voiceover (seconds), when present. */
  voiceDuration?: number;
  voiceSegments?: number;
  genre?: string;
  modules?: string[];
  logo?: RecipeCtx['logo'];
  map?: RecipeCtx['map'];
}

export function recipeCtx(input: PlanInput, aspect: Aspect): RecipeCtx {
  return {
    brief: input.brief,
    orientation: orientationOf(aspect),
    assets: input.assets,
    brandName: input.brand?.name ?? input.brief.brand?.name ?? undefined,
    lang: input.brief.language,
    genre: input.genre,
    modules: input.modules,
    logo: input.logo,
    map: input.map,
  };
}

/** Beats for which at least one recipe can be built from what the user gave us. */
export function supportedBeats(ctx: RecipeCtx, aspect: Aspect): Set<Beat> {
  const ok = new Set<Beat>();
  for (const r of RECIPES) {
    const m = SceneRegistry.get(r.family);
    if (!m || !m.manifest.aspectRatios.includes(aspect)) continue;
    if (r.when(ctx)) r.beats.forEach((b) => ok.add(b));
  }
  return ok;
}

function pickPace(brief: Brief, styleId: string): 'slow' | 'medium' | 'fast' {
  if (brief.pace) return brief.pace;
  const tone = brief.tone.join(' ');
  if (/سريع|حماس|energ|fast|punchy|قوي/i.test(tone) || ['sports', 'bold-social', 'neon', 'comic'].includes(styleId)) return 'fast';
  if (/هادئ|calm|فخم|luxur|سينما|cinem/i.test(tone) || ['luxury', 'cinematic', 'minimal'].includes(styleId)) return 'slow';
  return ['tiktok', 'instagram-reels', 'youtube-shorts'].includes(brief.platform) ? 'fast' : 'medium';
}

export function buildPlan(input: PlanInput): CreativePlan {
  const { brief } = input;
  const aspect: Aspect = brief.aspect ?? PLATFORM_DEFAULT_ASPECT[brief.platform];
  const style = pickStyle(brief, input.genre);
  const pace = pickPace(brief, style.id);
  const voiceLed = Boolean(input.voiceDuration);
  const duration = Math.round(
    (voiceLed ? Math.max(input.voiceDuration! + 0.8, brief.duration ?? 0) : brief.duration ?? PLATFORM_DURATION[brief.platform]) * 10,
  ) / 10;
  const ctx = recipeCtx(input, aspect);
  const supported = supportedBeats(ctx, aspect);

  const arc: Beat[] = (brief.preferences.arc?.length ? (brief.preferences.arc.filter((b) => b in BEAT_ENERGY) as Beat[]) : undefined) ?? (input.genre ? GENRE_ARCS[input.genre] : undefined) ?? ARCS[brief.objective];
  const opener = arc.find((b) => OPENERS.includes(b) && (b === 'hook' || supported.has(b)));
  let beats = arc.filter((b) => supported.has(b) || b === 'cta' || (b === 'hook' && (!opener || opener === 'hook')));
  // a genre opener the brief can't support (e.g. no tease material) falls back to a hook
  // (an explicit arc — e.g. an ad variant's product-first / offer-first order — opens on its own first beat)
  if (!beats.some((b) => OPENERS.includes(b)) && !(brief.preferences.arc?.length && beats[0] === brief.preferences.arc[0])) beats.unshift('hook');
  // comparison/data are strong when supplied even if the objective's arc omits them
  const c = brief.content;
  const has: Partial<Record<Beat, boolean>> = { comparison: Boolean(c.comparison), data: Boolean(c.stats?.length || c.series || c.table), product: Boolean(input.assets.product || c.products?.length), demo: Boolean(c.flow?.length || c.form?.fields.length || input.assets.screenshot || c.ui?.url), process: Boolean(c.steps?.length) };
  // content the user supplied is never silently lost because the objective's arc omits its beat
  for (const extra of ['comparison', 'data', 'product', 'demo', 'process'] as Beat[]) {
    if (has[extra] && supported.has(extra) && !beats.includes(extra)) beats.splice(Math.max(1, beats.length - 1), 0, extra);
  }
  // several distinct product demos supplied (real screenshot, a form, a flow, integrations) → a second demo beat
  const demoPayloads = [Boolean(input.assets.screenshot || c.ui?.url), Boolean(c.form?.fields.length), Boolean(c.flow?.length), (c.integrations?.length ?? 0) >= 3].filter(Boolean).length;
  // …only while every scene still gets ≥3.3 s (demos need time to read)
  if (supported.has('demo') && beats.includes('demo')) for (let k = 1; k < Math.min(demoPayloads, 3) && duration / (beats.filter((b) => b !== 'bridge').length + 1) >= 3.3; k++) beats.splice(beats.indexOf('demo') + 1, 0, 'demo');
  if (beats.includes('bridge') && !(beats.includes('problem') && beats.includes('solution'))) beats = beats.filter((b) => b !== 'bridge');
  // problem-solution already covers solution when both exist
  const maxScenes = Math.max(3, Math.min(14, voiceLed && input.voiceSegments ? Math.max(3, Math.min(input.voiceSegments, Math.round(duration / 1.8))) : Math.round(duration / SCENE_SECONDS[pace])));
  const dropped: Beat[] = [];
  // a short logo sting is one structure-aware reveal (tagline included), not a two-scene film
  if (input.genre === 'logo' && duration <= 8 && beats.includes('brand') && supported.has('brand')) {
    dropped.push(...beats.filter((b) => b !== 'brand'));
    beats = ['brand'];
  }
  while (beats.length > maxScenes) {
    const worst = [...beats].sort((a, b) => PRIORITY.indexOf(b) - PRIORITY.indexOf(a))[0];
    beats = beats.filter((b) => b !== worst);
    dropped.push(worst);
  }
  if (beats.includes('bridge') && !(beats.includes('problem') && beats.includes('solution'))) beats = beats.filter((b) => b !== 'bridge');

  const tokens = STYLE_PRESETS[style.id];
  const brand = input.brand;
  const messageOf = (b: Beat) => {
    const m: Partial<Record<Beat, string | undefined>> = {
      hook: c.hook, problem: c.problem ?? c.problemPoints?.join('، '), bridge: c.bridge, solution: c.solution,
      feature: c.features?.map((f) => f.title).join('، '), product: c.product?.name, offer: c.offer ?? c.product?.price,
      proof: c.stats?.map((s) => `${s.value}${s.suffix ?? ''} ${s.label}`).join('، '), data: c.series?.title ?? c.stats?.[0]?.label,
      social: c.testimonials?.[0]?.quote, process: c.steps?.join(' ← '), comparison: c.comparison ? `${c.comparison.leftTitle} / ${c.comparison.rightTitle}` : undefined,
      brand: brand?.name ?? brief.brand?.name ?? undefined, demo: c.ui?.headline ?? c.solution, cta: c.cta.text,
    };
    return m[b] ?? b;
  };
  const weightOf = (b: Beat) => (b === 'hook' || b === 'cta' ? 1.1 : b === 'bridge' ? 0.5 : b === 'feature' || b === 'demo' || b === 'process' ? 1.3 : 1);

  const audioMode = brief.audio.mode;
  return {
    objective: brief.objective,
    audience: brief.audience ?? 'general',
    platform: brief.platform,
    aspect,
    duration,
    pace,
    tone: brief.tone,
    visualStyle: style.id,
    styleReason: style.reason,
    energyCurve: beats.map((b) => BEAT_ENERGY[b]),
    narrativeArc: beats.map((b) => ({ beat: b, message: messageOf(b), weight: weightOf(b) })),
    sceneStrategy: [
      `${beats.length} scenes, ${pace} pace, ~${(duration / beats.length).toFixed(1)}s each`,
      'no family repeated back-to-back; category variety across the arc',
      voiceLed ? 'scene cuts snap to the voiceover phrase boundaries' : 'hold time scales with the amount of on-screen text',
      ...(dropped.length ? [`beats left out to fit ${duration}s: ${dropped.join(', ')}`] : []),
    ],
    audioStrategy: {
      mode: audioMode,
      music: brief.audio.music ? `user/licensed track${brief.audio.musicLicense ? ` (${brief.audio.musicLicense})` : ''}${audioMode !== 'none' ? ', ducked under voice' : ', cuts aligned to its beats'}` : 'none (no music supplied — nothing is downloaded)',
      sfx: brief.audio.sfx ? `library SFX at ${pace === 'fast' ? 'medium-high' : 'medium'} intensity, synced to scene accents` : 'off',
      voice: audioMode === 'user-voice' ? 'user voiceover, scenes synced to speech segments' : audioMode === 'tts' ? 'premium TTS (requires a configured provider)' : 'none',
    },
    brandStrategy: {
      source: brand?.source ?? 'style',
      logoUsage: brand?.logo ? 'user logo shown as supplied (never recoloured or redrawn)' : 'no logo — the brand name (if any) is set as type; no fake logo',
      palette: brand ? `${brand.source} palette ${brand.primary}/${brand.accent} on ${brand.background}` : `${tokens.name} style palette`,
      font: brand?.font ?? tokens.typography.display,
    },
    constraints: [
      'zero watermark / developer identity',
      'no invented statistics, testimonials or claims',
      'user media is never altered',
      brief.language !== 'en' ? `Arabic-first RTL, dialect: ${brief.dialect}` : 'LTR English',
    ],
  };
}
