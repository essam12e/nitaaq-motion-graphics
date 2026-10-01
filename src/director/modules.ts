/**
 * ONE MASTER DIRECTOR + LAZY-LOADED SPECIALISED MODULES.
 *
 * The genre classifier recognises what kind of film the request is; the module
 * selector then switches on only the capabilities this film needs. Core
 * modules (animation principles, text motion, transitions, sound director) are
 * plain pure functions and always present; every other module is selected per
 * project, and its heavy code/data is `import()`-ed only when selected:
 *
 *   map        → GeoJSON + projection (node), precomputed paths in video.json
 *   soundtrack → synthesiser (node), only when there is no user/licensed music
 *   gsap       → gsap chunk in the render bundle, loaded by gsap-sequence scenes only
 *   logo       → logo structure analysis (sharp), only when a logo exists
 *   variants   → strategy re-planner, only when variants are requested
 *
 * Pure and deterministic.
 */
import type { Brief } from '../schema/brief';
import { CapabilityRegistry } from '../core/registry';
import { contentBlocks, type Classification } from './classify';

export type Genre = Exclude<Brief['genre'], undefined | 'auto'>;

export interface GenreDecision {
  genre: Genre;
  reason: string;
  explicit: boolean;
}

const has = (re: RegExp, ...parts: (string | undefined)[]) => re.test(parts.filter(Boolean).join(' '));

/** Recognise the production genre (explicit `genre` wins). */
export function classifyGenre(brief: Brief): GenreDecision {
  if (brief.genre && brief.genre !== 'auto') return { genre: brief.genre, reason: 'requested', explicit: true };
  const c = brief.content;
  const req = [brief.request, brief.industry, ...(brief.tone ?? [])].join(' ');
  const blocks = contentBlocks(brief);
  if (brief.visualMode === 'whiteboard' || has(/سبور|whiteboard|رسم توضيحي|doodle/i, req)) return { genre: 'whiteboard', reason: 'whiteboard drawing requested', explicit: false };
  if (c.map && (c.map.locations?.length || c.map.regions?.length || c.map.routes?.length || c.map.focus)) return { genre: 'map', reason: 'the brief carries map data (places / regions / routes)', explicit: false };
  if (has(/شعار|لوقو|لوغو|logo/i, req) && has(/تحريك|انيميشن|أنيميشن|animation|reveal|ظهور|intro|انترو/i, req) && blocks <= 1 && (brief.duration ?? 10) <= 15)
    return { genre: 'logo', reason: 'a short logo animation request', explicit: false };
  if (c.tease || c.reveal || has(/إطلاق|اطلاق|launch|teaser|تشويق|hype|هايب|قريباً|coming soon|كشف/i, req)) return { genre: 'launch', reason: 'launch / teaser / hype wording', explicit: false };
  if (brief.audio.music && brief.audio.mode === 'none' && has(/موسيق|music|إيقاع|ايقاع|beat|ريتم|rhythm/i, req)) return { genre: 'music', reason: 'music-driven request (cuts follow the track)', explicit: false };
  if (c.lines?.length || has(/تايبو|تيبو|كاينتك|كاينتيك|kinetic|typograph|نصوص متحركة/i, req) || (blocks === 0 && !brief.assets.length)) return { genre: 'kinetic', reason: c.lines?.length ? 'a kinetic typography script was supplied' : 'typography-only request', explicit: false };
  if ((c.series || (c.stats?.length ?? 0) >= 2) && has(/بيانات|إحصا|احصا|أرقام|ارقام|نمو|data|chart|stat|growth|KPI|تقرير/i, req)) return { genre: 'data', reason: 'data-story request with supplied numbers', explicit: false };
  if (brief.visualMode === 'zero-asset' || has(/بدون صور|zero.?asset|procedural|إجرائي|generative|جينيريتف/i, req)) return { genre: 'procedural', reason: 'asset-free procedural film requested', explicit: false };
  if (brief.visualMode === 'illustration' || has(/رسوم|إليستريشن|اليستريشن|illustrat|فلات|flat design/i, req)) return { genre: 'illustrated', reason: 'illustration style requested', explicit: false };
  if ((brief.objective === 'sell' || c.product || (c.products?.length ?? 0) > 0) && (c.product?.image || c.products?.length || brief.assets.some((a) => a.kind === 'product'))) return { genre: 'product', reason: 'product to sell with the real product image', explicit: false };
  if (has(/موقع|website|landing|web ?app|واجهة/i, req) && (c.ui?.url || c.ui?.screens?.length)) return { genre: 'web-ui', reason: 'website / UI walkthrough', explicit: false };
  if (has(/saas|منصة|برنامج|software|dashboard|داشبورد|تطبيق|app\b/i, req) && (c.ui || c.form || c.flow || c.integrations)) return { genre: 'saas', reason: 'software product with UI material', explicit: false };
  if (brief.objective === 'explain' || brief.objective === 'educate') return { genre: 'explainer', reason: `objective ${brief.objective}`, explicit: false };
  return { genre: 'social-ad', reason: 'default social ad', explicit: false };
}

export interface ModuleCtx {
  brief: Brief;
  genre: Genre;
  cls: Classification;
  hasLogo: boolean;
  hasMusic: boolean;
}

export interface ModuleDef {
  id: string;
  title: string;
  /** Core modules are pure planning code that every film uses; they have no lazy part. */
  core?: boolean;
  /** Why this film needs the module, or null when it does not. */
  needs: (c: ModuleCtx) => string | null;
  /** Scene families this module brings. */
  scenes?: string[];
  /** Heavy part, loaded only when selected (node side). */
  load?: () => Promise<unknown>;
}

export const ModuleRegistry = new CapabilityRegistry<ModuleDef>('module');

const soundtrackStyle = (b: Brief) => b.audio.soundtrack;
export function wantsSoundtrack(c: Pick<ModuleCtx, 'brief' | 'genre' | 'hasMusic'>): string | null {
  if (c.hasMusic) return null; // user / licensed music always wins; the synthesiser never runs
  const s = soundtrackStyle(c.brief);
  if (s === 'off') return null;
  if (s && s !== 'auto') return `explicit soundtrack style "${s}"`;
  if (s === 'auto' && ['launch', 'music', 'kinetic', 'logo', 'procedural'].includes(c.genre)) return `${c.genre} film without supplied music`;
  if (s === undefined && c.genre === 'launch') return 'launch / hype film without supplied music';
  return null;
}

const MODULES: ModuleDef[] = [
  { id: 'animation-principles', title: 'Animation Principles Engine', core: true, needs: () => 'every film' },
  { id: 'text-motion', title: 'Advanced Text Motion Engine', core: true, needs: () => 'every film' },
  { id: 'transitions', title: 'Scene Transition Engine', core: true, needs: () => 'every film' },
  { id: 'sound-director', title: 'NITAAQ Sound Director', core: true, needs: (c) => (c.brief.audio.sfx ? 'SFX enabled' : null) },
  {
    id: 'kinetic-type',
    title: 'Arabic Kinetic Typography',
    scenes: ['kinetic-sequence', 'kinetic-stack', 'kinetic-number', 'kinetic-mixed', 'kinetic-replace'],
    needs: (c) => (['kinetic', 'launch', 'music', 'social-ad', 'logo'].includes(c.genre) || c.brief.content.lines?.length ? `${c.genre} film uses typography as the main visual` : null),
  },
  { id: 'shared-elements', title: 'Shared-element continuity', needs: (c) => (c.brief.content.product?.image || c.brief.content.ui?.screenshot || c.hasLogo ? 'identity media appears in more than one scene' : null) },
  { id: 'brand-motion', title: 'Brand Motion Guidelines', needs: (c) => (c.hasLogo || c.brief.brand?.colors?.length || c.brief.brand?.name ? 'brand identity supplied — persist brand-motion.json' : null) },
  { id: 'logo-animation', title: 'Logo Animation Engine', scenes: ['logo-animation'], needs: (c) => (c.hasLogo ? 'user logo supplied' : null), load: () => import('../node/logo-structure') },
  { id: 'product-commercial', title: 'E-commerce Product Director', scenes: ['product-detail', 'product-hero'], needs: (c) => (c.genre === 'product' ? 'product commercial' : null) },
  { id: 'launch-film', title: 'Launch / Hype Director', scenes: ['tease-reveal', 'feature-montage'], needs: (c) => (c.genre === 'launch' ? 'launch / hype structure' : null) },
  { id: 'variants', title: 'Ad Creative Variants', needs: (c) => (c.brief.variants ? `${c.brief.variants.strategies.length} strategic variant(s) requested` : null), load: () => import('./variants') },
  { id: 'data', title: 'Data Animation Engine', scenes: ['data-story'], needs: (c) => (c.brief.content.series || c.brief.content.stats?.length || c.brief.content.table ? 'supplied numbers' : null) },
  { id: 'map', title: 'Map Animation', scenes: ['map-story'], needs: (c) => (c.brief.content.map ? 'map data supplied' : null), load: () => import('../maps/geo') },
  { id: 'illustration', title: 'Illustration Mode', scenes: ['illustration-scene', 'diagram-flow'], needs: (c) => (['illustrated', 'explainer', 'saas', 'procedural'].includes(c.genre) || c.brief.visualMode === 'illustration' || c.brief.content.illustration?.length ? `${c.genre}: editable procedural illustration` : null) },
  { id: 'zero-asset', title: 'JavaScript Zero-Asset Animation', scenes: ['zero-asset-sequence'], needs: (c) => (c.genre === 'procedural' || c.brief.visualMode === 'zero-asset' || (c.genre === 'kinetic' && !c.brief.assets.length) ? 'no image assets: geometry + type only' : null) },
  { id: 'whiteboard', title: 'Whiteboard Animation', scenes: ['whiteboard'], needs: (c) => (c.genre === 'whiteboard' ? 'whiteboard film' : null) },
  { id: 'gsap', title: 'Web Animation / GSAP', scenes: ['gsap-sequence'], needs: (c) => (c.brief.preferences.gsap || (c.genre === 'web-ui' && c.brief.preferences.gsap !== false) ? 'complex staggered UI timeline' : null) },
  { id: 'soundtrack', title: 'Code-Generated Soundtrack', needs: (c) => wantsSoundtrack(c), load: () => import('../audio/soundtrack/compose') },
  { id: 'beat-engine', title: 'Beat engine', needs: (c) => (c.hasMusic && c.brief.audio.beatSync !== false ? 'music supplied' : null) },
  { id: 'reference', title: 'Reference analysis', needs: (c) => (c.brief.reference ? 'style reference supplied' : null) },
];
for (const m of MODULES) if (!ModuleRegistry.has(m.id)) ModuleRegistry.register(m);

export interface ModuleSelection {
  id: string;
  title: string;
  core: boolean;
  reason: string;
}

/** Only the modules this film needs, each with the reason. */
export function selectModules(c: ModuleCtx): ModuleSelection[] {
  const out: ModuleSelection[] = [];
  for (const m of ModuleRegistry.list()) {
    const r = m.needs(c);
    if (r) out.push({ id: m.id, title: m.title, core: Boolean(m.core), reason: r });
  }
  return out;
}

export const isSelected = (sel: { id: string }[] | string[], id: string) => sel.some((s) => (typeof s === 'string' ? s : s.id) === id);

/** Load the heavy parts of the selected modules (in parallel). Unselected modules are never imported. */
export async function loadModules(sel: ModuleSelection[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    sel.map(async (s) => {
      const def = ModuleRegistry.get(s.id);
      if (def?.load) out[s.id] = await def.load();
    }),
  );
  return out;
}
