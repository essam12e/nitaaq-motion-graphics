/**
 * Scene recipes: how a narrative beat can be told with a registered family, and
 * how the brief's copy/assets map onto that family's content. Recipes only use
 * what the brief provides (never invented numbers, quotes or logos).
 */
import type { Brief } from '../schema/brief';
import type { Beat } from '../schema/plan';
import type { LogoStructure } from '../brand/logo-reveal';
import type { MapPrecomputed } from '../maps/geo';
import { chooseVisualization } from '../data/visualize';
import { matchIllustrations } from '../illustration/registry';

export interface RecipeCtx {
  brief: Brief;
  orientation: 'portrait' | 'landscape' | 'square';
  assets: { logo?: string; product?: string; screenshot?: string; images: string[] };
  brandName?: string;
  lang: 'ar' | 'en' | 'mixed';
  /** Production genre (src/director/modules.ts). */
  genre?: string;
  /** Selected module ids — families of unselected lazy modules are never used. */
  modules?: string[];
  /** Measured logo structure + the reveal the Logo Animation Engine chose. */
  logo?: { structure?: LogoStructure; reveal: string; reason: string };
  /** Precomputed map (node side) when the brief has map data. */
  map?: MapPrecomputed;
}

export interface Recipe {
  family: string;
  beats: Beat[];
  weight: number;
  when: (c: RecipeCtx) => boolean;
  build: (c: RecipeCtx) => Record<string, unknown>;
  message: (c: RecipeCtx) => string;
  visual: string;
  /** Preferred variants (filtered by the family's aspect preferences later). */
  variants?: (c: RecipeCtx) => string[] | undefined;
}

const words = (s?: string) => (s ?? '').split(/\s+/).filter(Boolean);
/** Emphasis words that actually occur in `text` (never invented). */
export function emph(c: RecipeCtx, ...texts: (string | undefined)[]): string[] | undefined {
  const all = texts.filter(Boolean).join(' ');
  const hits = c.brief.content.emphasis.filter((w) => all.includes(w));
  return hits.length ? hits : undefined;
}
const clip = <T,>(a: T[] | undefined, n: number) => (a ?? []).slice(0, n);
const ICONS_BY_HINT: [RegExp, string][] = [
  [/دفع|pay|payment|مدى|فيزا/i, 'CreditCard'],
  [/شحن|توصيل|ship|deliver/i, 'Truck'],
  [/أمان|آمن|حماية|secure|safe|privacy/i, 'ShieldCheck'],
  [/سرع|fast|speed|فوري|instant/i, 'Zap'],
  [/دعم|support|خدمة/i, 'Headset'],
  [/تقرير|report|تحليل|analytic|إحصا/i, 'ChartLine'],
  [/ذكاء|ai|smart|ذكي/i, 'Sparkles'],
  [/تصميم|design|هوية/i, 'Palette'],
  [/جوال|mobile|تطبيق|app/i, 'Smartphone'],
  [/عميل|customer|users|مستخدم/i, 'Users'],
  [/وقت|time|ساعة|يوم/i, 'Clock'],
  [/سعر|price|توفير|save|خصم/i, 'BadgePercent'],
  [/جودة|quality|ضمان|guarantee/i, 'BadgeCheck'],
  [/متجر|store|shop/i, 'Store'],
  [/ربط|integrat|connect/i, 'Plug'],
  [/مخزون|inventory|stock/i, 'Package'],
  [/سحاب|cloud/i, 'Cloud'],
  [/تنبيه|notif|إشعار/i, 'Bell'],
];
/** Journey states from a product brief (only the user's own product, name and price). */
function flowFromProduct(c: RecipeCtx) {
  const p = c.brief.content.product!;
  const ar = c.lang !== 'en';
  return [
    { kind: 'search' as const, label: ar ? 'ابحث' : 'Search', value: p.name },
    { kind: 'product' as const, label: p.name, value: p.price, image: c.assets.product },
    { kind: 'cart' as const, label: c.brief.content.cta.button ?? (ar ? 'أضفته للسلة' : 'Added to cart'), value: '1' },
    { kind: 'success' as const, label: ar ? 'تم الطلب' : 'Order placed' },
  ];
}

export function iconFor(text: string, fallback = 'CircleCheck'): string {
  for (const [re, icon] of ICONS_BY_HINT) if (re.test(text)) return icon;
  return fallback;
}
const shortHook = (c: RecipeCtx) => words(c.brief.content.hook).length <= 2;
const splitClauses = (t: string): string[] => {
  const parts = t.split(/[،,.؛;:!?؟—–-]\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 4) return parts;
  const w = words(t);
  if (w.length >= 6) return [w.slice(0, Math.ceil(w.length / 2)).join(' '), w.slice(Math.ceil(w.length / 2)).join(' ')];
  return [t];
};

/** A list's heading must stay a heading: a long problem paragraph is left to its points (which restate it). */
const listHeading = (t?: string) => (t && t.trim().split(/\s+/).length <= 12 ? t : undefined);

const mod = (c: RecipeCtx, id: string) => Boolean(c.modules?.includes(id));
const LATIN = /[A-Za-z][A-Za-z0-9 .&'’-]{1,}/;
/** Lines for kinetic typography: the user's script, else the hook split into clauses. */
const kineticLines = (c: RecipeCtx): string[] => (c.brief.content.lines?.length ? c.brief.content.lines.slice(0, 6) : splitClauses(c.brief.content.hook)).map((l) => l.slice(0, 80));
/** Illustration subjects that fit a text (never a random picture). */
const subjectsFor = (c: RecipeCtx, ...texts: (string | undefined)[]): string[] => {
  const hinted = (c.brief.content.illustration ?? []).flatMap((h) => matchIllustrations(h, 1).length ? matchIllustrations(h, 1) : []);
  const found = matchIllustrations(texts.filter(Boolean).join(' '), 3);
  return [...new Set([...hinted, ...found])];
};
const seriesData = (c: RecipeCtx) => {
  const s = c.brief.content.series!;
  return { labels: s.labels, values: s.values, prefix: s.prefix, suffix: s.suffix, source: s.source, title: s.title };
};

/** Families each genre leans on (weighted ×2.2 by the storyboard when eligible). */
export const GENRE_PREFER: Record<string, string[]> = {
  kinetic: ['kinetic-sequence', 'kinetic-stack', 'kinetic-number', 'kinetic-mixed', 'kinetic-replace', 'zero-asset-sequence'],
  launch: ['tease-reveal', 'feature-montage', 'product-hero', 'kinetic-sequence', 'logo-animation'],
  product: ['product-hero', 'product-detail', 'product-showcase', 'price-offer'],
  logo: ['logo-animation'],
  map: ['map-story'],
  data: ['data-story', 'kinetic-number', 'kpi-counter'],
  whiteboard: ['whiteboard'],
  illustrated: ['illustration-scene', 'diagram-flow'],
  explainer: ['diagram-flow', 'illustration-scene'],
  procedural: ['zero-asset-sequence', 'kinetic-sequence'],
  music: ['kinetic-sequence', 'feature-montage', 'zero-asset-sequence'],
  'web-ui': ['gsap-sequence', 'browser-scene', 'landing-page'],
  saas: ['saas-interface', 'dashboard', 'diagram-flow', 'gsap-sequence'],
};

export const MODULE_RECIPES: Recipe[] = [
  // ───────── Arabic kinetic typography
  { family: 'kinetic-sequence', beats: ['hook', 'tease', 'solution', 'montage'], weight: 1.1, visual: 'kinetic typography sequence (word groups)', when: (c) => mod(c, 'kinetic-type') && kineticLines(c).length >= 1 && kineticLines(c).join(' ').split(/\s+/).length >= 2, message: (c) => kineticLines(c).join(' / '), build: (c) => ({ lines: kineticLines(c), highlight: emph(c, ...kineticLines(c)) }), variants: (c) => (c.genre === 'music' || c.genre === 'launch' ? ['rhythm', 'impact', 'build'] : ['impact', 'build', 'rhythm']) },
  { family: 'kinetic-stack', beats: ['hook', 'problem', 'solution', 'feature'], weight: 1, visual: 'editorial type stack', when: (c) => mod(c, 'kinetic-type') && kineticLines(c).length >= 2 && kineticLines(c).length <= 5 && kineticLines(c).every((l) => l.length <= 60), message: (c) => kineticLines(c).join(' / '), build: (c) => ({ lines: kineticLines(c), highlight: emph(c, ...kineticLines(c)), kicker: c.brandName }) },
  { family: 'kinetic-number', beats: ['proof', 'data', 'hook'], weight: 1.25, visual: 'kinetic sourced number', when: (c) => mod(c, 'kinetic-type') && (c.brief.content.stats?.length ?? 0) >= 1, message: (c) => `${c.brief.content.stats![0].value} ${c.brief.content.stats![0].label}`, build: (c) => { const s = c.brief.content.stats![0]; return { value: s.value, prefix: s.prefix, suffix: s.suffix, label: s.label, source: s.source }; } },
  { family: 'kinetic-mixed', beats: ['hook', 'solution', 'brand'], weight: 1.15, visual: 'Arabic + English kinetic title', when: (c) => mod(c, 'kinetic-type') && Boolean(c.brief.content.english || (c.lang !== 'en' && LATIN.test(c.brief.content.hook))), message: (c) => c.brief.content.hook, build: (c) => { const en = c.brief.content.english ?? c.brief.content.hook.match(LATIN)![0].trim(); const ar = c.brief.content.english ? c.brief.content.hook : c.brief.content.hook.replace(en, '').replace(/\s+/g, ' ').trim() || c.brief.content.hook; return { arabic: ar.slice(0, 80), english: en.slice(0, 40), highlight: emph(c, ar) }; } },
  { family: 'kinetic-replace', beats: ['hook', 'feature', 'solution'], weight: 1.3, visual: 'word replacement', when: (c) => mod(c, 'kinetic-type') && Boolean(c.brief.content.rotate), message: (c) => `${c.brief.content.rotate!.prefix} ${c.brief.content.rotate!.words.join(' / ')}`, build: (c) => ({ prefix: c.brief.content.rotate!.prefix, words: c.brief.content.rotate!.words.slice(0, 6), suffix: c.brief.content.rotate!.suffix }) },
  // ───────── logo animation
  { family: 'logo-animation', beats: ['brand', 'reveal', 'solution', 'cta'], weight: 1.6, visual: 'structure-aware logo reveal', when: (c) => mod(c, 'logo-animation') && Boolean(c.assets.logo && c.logo), message: (c) => c.brandName ?? 'logo', build: (c) => ({ logo: c.assets.logo, tagline: c.genre === 'logo' ? c.brief.content.subhook ?? c.brief.content.solution ?? c.brief.content.cta.text : c.brief.content.solution, structure: c.logo!.structure ? { layout: c.logo!.structure.layout, contentBox: c.logo!.structure.contentBox, parts: c.logo!.structure.parts, symmetry: c.logo!.structure.symmetry, dominantDirection: c.logo!.structure.dominantDirection } : undefined, revealReason: c.logo!.reason }), variants: (c) => [c.logo!.reveal] },
  // ───────── product commercial
  { family: 'product-hero', beats: ['product', 'reveal', 'hook'], weight: 1.5, visual: 'product hero shot', when: (c) => mod(c, 'product-commercial') || mod(c, 'launch-film') ? Boolean(c.assets.product) : false, message: (c) => c.brief.content.product?.name ?? '', build: (c) => ({ image: c.assets.product, name: c.brief.content.product?.name, title: c.brief.content.product?.tagline, highlight: emph(c, c.brief.content.product?.tagline), price: c.genre === 'launch' ? undefined : c.brief.content.product?.price }), variants: (c) => (c.genre === 'launch' ? ['dark-reveal', 'drop-land'] : c.brief.tone.some((t) => /فخم|luxur|premium|راق/i.test(t)) ? ['rim-light', 'dark-reveal'] : ['drop-land', 'rim-light']) },
  { family: 'product-detail', beats: ['detail', 'feature'], weight: 1.4, visual: 'details on the real product', when: (c) => mod(c, 'product-commercial') && Boolean(c.assets.product) && (c.brief.content.features?.length ?? 0) >= 2, message: (c) => c.brief.content.features!.map((f) => f.title).join('، '), build: (c) => ({ image: c.assets.product, title: undefined, details: clip(c.brief.content.features, 5).map((f) => ({ label: f.title.slice(0, 40), value: f.description && f.description.length <= 30 ? f.description : undefined })) }), variants: (c) => (c.orientation === 'landscape' ? ['specs', 'callouts'] : ['specs', 'macro']) },
  // ───────── launch / hype
  { family: 'tease-reveal', beats: ['tease', 'reveal', 'hook'], weight: 1.7, visual: 'tease then reveal', when: (c) => mod(c, 'launch-film') && Boolean(c.brief.content.reveal || c.brandName || c.brief.content.product?.name), message: (c) => c.brief.content.reveal ?? c.brief.content.product?.name ?? c.brandName ?? '', build: (c) => ({ tease: (c.brief.content.tease ? splitClauses(c.brief.content.tease) : c.brief.content.hook ? [c.brief.content.hook] : []).slice(0, 3).map((x) => x.slice(0, 60)), reveal: (c.brief.content.reveal ?? c.brief.content.product?.name ?? c.brandName!).slice(0, 60), image: c.assets.product ?? undefined, date: c.brief.content.launchDate }), variants: (c) => (c.brief.tone.some((t) => /فخم|luxur|cinem|سينما/i.test(t)) ? ['slit', 'word-tease'] : ['word-tease', 'slit', 'countdown']) },
  { family: 'feature-montage', beats: ['montage', 'feature'], weight: 1.3, visual: 'feature montage on the beat', when: (c) => (mod(c, 'launch-film') || c.genre === 'music') && (c.brief.content.features?.length ?? 0) >= 3 && c.brief.content.features!.every((f) => f.title.length <= 40), message: (c) => c.brief.content.features!.map((f) => f.title).join(' / '), build: (c) => ({ features: clip(c.brief.content.features, 8).map((f) => f.title), image: c.assets.product }), variants: (c) => (c.assets.product ? ['rail', 'flash'] : ['flash']) },
  // ───────── map
  { family: 'map-story', beats: ['map', 'proof', 'feature'], weight: 1.8, visual: 'animated map (Natural Earth data)', when: (c) => mod(c, 'map') && Boolean(c.map && (c.map.pins.length || c.map.regions.length || c.map.focus)), message: (c) => c.brief.content.map?.title ?? 'map', build: (c) => ({ title: c.brief.content.map?.title, geo: c.map }), variants: (c) => (c.map!.routes.length ? ['route', 'pins'] : c.map!.regions.length ? ['regions', 'focus'] : c.map!.pins.length ? ['pins', 'focus'] : ['focus']) },
  // ───────── illustration / explainer
  { family: 'illustration-scene', beats: ['problem', 'solution', 'feature', 'hook'], weight: 1.15, visual: 'procedural illustration', when: (c) => mod(c, 'illustration') && subjectsFor(c, c.brief.content.problem, c.brief.content.solution, c.brief.content.hook, ...(c.brief.content.features?.map((f) => f.title) ?? [])).length >= 1, message: (c) => c.brief.content.solution ?? c.brief.content.hook, build: (c) => { const feats = c.brief.content.features ?? []; const trio = feats.slice(0, 3).map((f) => ({ subject: subjectsFor(c, f.title, f.description)[0], label: f.title.slice(0, 40) })).filter((x) => x.subject); if (trio.length >= 2) return { title: c.brief.content.solution, items: trio, style: c.genre === 'illustrated' ? 'flat' : 'duotone' }; const subj = subjectsFor(c, c.brief.content.solution, c.brief.content.problem, c.brief.content.hook)[0]; return { title: c.brief.content.solution ?? c.brief.content.hook, highlight: emph(c, c.brief.content.solution ?? c.brief.content.hook), items: [{ subject: subj }], style: c.genre === 'illustrated' ? 'flat' : 'duotone' }; }, variants: (c) => ((c.brief.content.features ?? []).filter((f) => subjectsFor(c, f.title, f.description).length).length >= 2 ? ['trio'] : c.orientation === 'landscape' ? ['explain', 'hero'] : ['hero', 'explain']) },
  { family: 'diagram-flow', beats: ['process', 'demo', 'solution'], weight: 1.35, visual: 'diagram of the process', when: (c) => mod(c, 'illustration') && (c.brief.content.steps?.length ?? 0) >= 2 && c.brief.content.steps!.length <= 6 && c.brief.content.steps!.every((s) => s.length <= 32), message: (c) => c.brief.content.steps!.join(' ← '), build: (c) => ({ nodes: c.brief.content.steps!.map((st) => ({ label: st, subject: subjectsFor(c, st)[0] })), center: c.brandName }), variants: (c) => ((c.brief.content.integrations?.length ?? 0) >= 3 ? ['hub', 'linear'] : ['linear', 'cycle']) },
  // ───────── zero asset
  { family: 'zero-asset-sequence', beats: ['hook', 'problem', 'solution', 'feature', 'tease', 'cta'], weight: 1.1, visual: 'asset-free geometry + type', when: (c) => mod(c, 'zero-asset'), message: (c) => c.brief.content.hook, build: (c) => ({ lines: (c.brief.content.lines?.length ? c.brief.content.lines.slice(0, 3) : splitClauses(c.brief.content.hook).slice(0, 3)).map((x) => x.slice(0, 60)), highlight: emph(c, c.brief.content.hook) }), variants: () => ['shapes', 'lines', 'orbit'] },
  // ───────── whiteboard
  { family: 'whiteboard', beats: ['problem', 'solution', 'process', 'feature', 'hook'], weight: 2, visual: 'whiteboard drawing', when: (c) => mod(c, 'whiteboard'), message: (c) => c.brief.content.solution ?? c.brief.content.hook, build: (c) => { const st = c.brief.content.steps?.length ? c.brief.content.steps : c.brief.content.features?.map((f) => f.title) ?? splitClauses(c.brief.content.solution ?? c.brief.content.hook); return { title: c.brief.content.problem && c.brief.content.problem.length <= 100 ? c.brief.content.problem : undefined, steps: st.slice(0, 4).map((t) => ({ text: t.slice(0, 80), subject: subjectsFor(c, t)[0] })) }; }, variants: (c) => (subjectsFor(c, ...(c.brief.content.steps ?? []), ...(c.brief.content.features?.map((f) => f.title) ?? [])).length ? ['draw', 'write'] : ['write']) },
  // ───────── data story
  { family: 'data-story', beats: ['data', 'proof'], weight: 1.6, visual: 'data story (honest visualization)', when: (c) => mod(c, 'data') && Boolean(c.brief.content.series && c.brief.content.series.labels.length === c.brief.content.series.values.length && c.brief.content.series.labels.length <= 8), message: (c) => c.brief.content.series!.title ?? 'data', build: (c) => seriesData(c), variants: (c) => [chooseVisualization(seriesData(c)).kind] },
  // ───────── gsap
  { family: 'gsap-sequence', beats: ['feature', 'demo'], weight: 1.2, visual: 'staggered UI timeline (GSAP)', when: (c) => mod(c, 'gsap') && ((c.brief.content.features?.length ?? 0) >= 2 || (c.brief.content.ui?.items?.length ?? 0) >= 2), message: (c) => (c.brief.content.features?.map((f) => f.title) ?? c.brief.content.ui!.items!).join('، '), build: (c) => ({ title: c.brief.content.ui?.headline, items: (c.brief.content.features?.length ? c.brief.content.features.map((f) => ({ label: f.title.slice(0, 36) })) : c.brief.content.ui!.items!.map((x) => ({ label: x.slice(0, 36) }))).slice(0, 8) }), variants: (c) => (c.orientation === 'portrait' ? ['cascade', 'stagger-grid'] : ['stagger-grid', 'cascade']) },
];

export const RECIPES: Recipe[] = [
  // ───────── hook
  { family: 'kinetic-title', beats: ['hook', 'solution'], weight: 1.2, visual: 'kinetic headline', when: () => true, message: (c) => c.brief.content.hook, build: (c) => ({ title: c.brief.content.hook, highlight: emph(c, c.brief.content.hook), subtitle: c.brief.content.subhook }), variants: (c) => (c.orientation === 'landscape' ? ['side', 'stack', 'impact'] : ['stack', 'impact', 'slam']) },
  { family: 'word-impact', beats: ['hook'], weight: 1.4, visual: 'one-word impact', when: (c) => shortHook(c), message: (c) => c.brief.content.hook, build: (c) => ({ word: c.brief.content.hook, line: c.brief.content.subhook }) },
  { family: 'highlight-text', beats: ['hook', 'solution'], weight: 1, visual: 'highlighted statement', when: (c) => Boolean(emph(c, c.brief.content.hook)), message: (c) => c.brief.content.hook, build: (c) => ({ title: c.brief.content.hook, highlight: emph(c, c.brief.content.hook), subtitle: c.brief.content.subhook }) },
  { family: 'cinematic-title', beats: ['hook', 'brand'], weight: 0.8, visual: 'film-style title card', when: (c) => ['announce', 'event', 'brand'].includes(c.brief.objective) || c.brief.tone.some((t) => /فخم|cinem|سينما|luxur/i.test(t)), message: (c) => c.brief.content.hook, build: (c) => ({ title: c.brief.content.hook, highlight: emph(c, c.brief.content.hook), subtitle: c.brief.content.subhook }) },
  { family: 'line-reveal', beats: ['hook', 'problem'], weight: 0.9, visual: 'lines revealed one by one', when: (c) => splitClauses(c.brief.content.hook).length >= 2 && words(c.brief.content.hook).length <= 30, message: (c) => c.brief.content.hook, build: (c) => ({ lines: splitClauses(c.brief.content.hook), highlight: emph(c, c.brief.content.hook) }) },
  { family: 'type-on', beats: ['hook'], weight: 0.8, visual: 'typed search/prompt', when: (c) => /[؟?]$/.test(c.brief.content.hook.trim()) && words(c.brief.content.hook).length <= 9, message: (c) => c.brief.content.hook, build: (c) => ({ text: c.brief.content.hook, label: c.brief.content.subhook }), variants: (c) => (/ai|ذكاء/i.test(c.brief.industry) ? ['prompt'] : ['search']) },
  { family: 'light-sweep-title', beats: ['hook', 'brand', 'offer'], weight: 0.7, visual: 'premium light sweep', when: (c) => c.brief.tone.some((t) => /فخم|premium|luxur|راق/i.test(t)), message: (c) => c.brief.content.hook, build: (c) => ({ title: c.brief.content.hook, highlight: emph(c, c.brief.content.hook), subtitle: c.brief.content.subhook }) },

  // ───────── problem
  { family: 'problem-solution', beats: ['problem'], weight: 1.3, visual: 'problem crossed out, solution rises', when: (c) => Boolean(c.brief.content.problem && c.brief.content.solution), message: (c) => `${c.brief.content.problem} → ${c.brief.content.solution}`, build: (c) => ({ problem: c.brief.content.problem, solution: c.brief.content.solution, highlight: emph(c, c.brief.content.solution) }) },
  { family: 'line-reveal', beats: ['problem'], weight: 1, visual: 'pain points as lines', when: (c) => Boolean(c.brief.content.problem), message: (c) => c.brief.content.problem!, build: (c) => ({ lines: splitClauses(c.brief.content.problem!), highlight: emph(c, c.brief.content.problem) }) },
  { family: 'icon-list', beats: ['problem'], weight: 1.1, visual: 'list of pain points', when: (c) => (c.brief.content.problemPoints?.length ?? 0) >= 2, message: (c) => [listHeading(c.brief.content.problem), ...c.brief.content.problemPoints!].filter(Boolean).join('، '), build: (c) => ({ title: listHeading(c.brief.content.problem), items: clip(c.brief.content.problemPoints, 5).map((t) => ({ text: t, icon: 'X' })) }), variants: () => ['bullets', 'checklist'] },
  { family: 'chat-message', beats: ['problem', 'demo', 'social'], weight: 1.2, visual: 'messaging conversation', when: (c) => (c.brief.content.messages?.length ?? 0) >= 2, message: (c) => c.brief.content.messages!.join(' / '), build: (c) => ({ title: c.brief.content.problem, messages: clip(c.brief.content.messages, 6).map((t, i) => ({ from: i % 2 === 0 ? 'me' : 'them', text: t })), contact: c.brandName }) },

  // ───────── bridge
  { family: 'speed-transition', beats: ['bridge'], weight: 1, visual: 'speed-line punch word', when: (c) => Boolean(c.brief.content.bridge), message: (c) => c.brief.content.bridge!, build: (c) => ({ text: c.brief.content.bridge, highlight: [c.brief.content.bridge] }) },
  { family: 'color-transition', beats: ['bridge'], weight: 0.8, visual: 'colour sweep with a word', when: (c) => Boolean(c.brief.content.bridge), message: (c) => c.brief.content.bridge!, build: (c) => ({ word: c.brief.content.bridge }) },

  // ───────── solution / brand
  { family: 'logo-reveal', beats: ['solution', 'brand'], weight: 1.2, visual: 'user logo reveal', when: (c) => Boolean(c.assets.logo), message: (c) => c.brandName ?? 'logo', build: (c) => ({ logo: c.assets.logo, tagline: c.brief.content.solution }) },
  { family: 'brand-intro', beats: ['solution', 'brand'], weight: 1, visual: 'brand lockup', when: (c) => Boolean(c.brandName || c.assets.logo), message: (c) => c.brandName ?? '', build: (c) => ({ name: c.brandName, tagline: c.brief.content.solution, logo: c.assets.logo }), variants: (c) => (c.assets.logo ? ['lockup', 'stacked'] : ['wordmark']) },
  { family: 'light-sweep-title', beats: ['solution'], weight: 0.8, visual: 'solution statement with light sweep', when: (c) => Boolean(c.brief.content.solution), message: (c) => c.brief.content.solution!, build: (c) => ({ title: c.brief.content.solution, highlight: emph(c, c.brief.content.solution) }) },
  { family: 'highlight-text', beats: ['solution'], weight: 1, visual: 'solution with marker', when: (c) => Boolean(c.brief.content.solution && emph(c, c.brief.content.solution)), message: (c) => c.brief.content.solution!, build: (c) => ({ title: c.brief.content.solution, highlight: emph(c, c.brief.content.solution) }) },
  { family: 'kinetic-title', beats: ['solution'], weight: 0.9, visual: 'solution headline', when: (c) => Boolean(c.brief.content.solution), message: (c) => c.brief.content.solution!, build: (c) => ({ title: c.brief.content.solution, highlight: emph(c, c.brief.content.solution) }) },

  // ───────── product
  { family: 'product-showcase', beats: ['product'], weight: 1.4, visual: "user's product, lit and framed", when: (c) => Boolean(c.assets.product), message: (c) => c.brief.content.product?.name ?? '', build: (c) => ({ image: c.assets.product, name: c.brief.content.product?.name, price: c.brief.content.product?.price, title: c.brief.content.product?.tagline, features: clip(c.brief.content.features?.map((f) => f.title), 3) }), variants: (c) => (c.orientation === 'landscape' ? ['split', 'hero', 'spotlight'] : ['hero', 'spotlight', 'orbit']) },
  { family: 'product-grid', beats: ['product'], weight: 1.2, visual: 'grid of real products', when: (c) => (c.brief.content.products?.length ?? 0) >= 2, message: () => 'products', build: (c) => ({ title: c.brief.content.product?.tagline, products: clip(c.brief.content.products, 6) }) },
  { family: 'category-showcase', beats: ['product', 'feature'], weight: 0.9, visual: 'category tiles', when: (c) => (c.brief.content.categories?.length ?? 0) >= 3, message: () => 'categories', build: (c) => ({ categories: clip(c.brief.content.categories, 6).map((x) => ({ ...x, icon: x.icon ?? iconFor(x.label, 'Tag') })) }) },
  { family: 'image-reveal', beats: ['product', 'demo'], weight: 0.7, visual: 'image reveal', when: (c) => Boolean(c.assets.product || c.assets.images[0]), message: (c) => c.brief.content.product?.name ?? '', build: (c) => ({ image: c.assets.product ?? c.assets.images[0], role: c.assets.product ? 'product' : 'image', title: c.brief.content.product?.tagline ?? c.brief.content.product?.name }) },

  // ───────── demo
  { family: 'browser-scene', beats: ['demo'], weight: 1.3, visual: 'website in a browser', when: (c) => Boolean(c.brief.content.ui && (c.brief.content.ui.url || c.assets.screenshot || c.brief.content.ui.headline)), message: (c) => c.brief.content.ui?.headline ?? c.brief.content.ui?.url ?? '', build: (c) => ({ title: c.brief.content.solution, url: c.brief.content.ui?.url, screenshot: c.assets.screenshot, pageTitle: c.brief.content.ui?.headline ?? c.brandName, pageSubtitle: c.brief.content.ui?.subline, menu: clip(c.brief.content.ui?.menu, 4), pageCta: c.brief.content.cta.button }), variants: (c) => (c.assets.screenshot ? ['scroll', 'zoom', 'focus'] : ['focus', 'navigate']) },
  { family: 'screenshot-focus', beats: ['demo'], weight: 1.2, visual: 'real screenshot with focus', when: (c) => Boolean(c.assets.screenshot), message: () => 'product screenshot', build: (c) => ({ title: c.brief.content.solution, screenshot: c.assets.screenshot }) },
  { family: 'saas-interface', beats: ['demo', 'feature'], weight: 1, visual: 'product UI with actions', when: (c) => (c.brief.content.ui?.items?.length ?? 0) >= 3, message: (c) => c.brief.content.ui!.items!.join('، '), build: (c) => ({ title: c.brief.content.ui?.headline ?? c.brief.content.solution, appName: c.brief.content.ui?.appName ?? c.brandName, items: clip(c.brief.content.ui?.items, 5) }) },
  { family: 'dashboard', beats: ['demo'], weight: 0.9, visual: 'dashboard UI (no invented numbers)', when: (c) => /saas|dashboard|لوحة|analytics|تحليل|data|بيانات/i.test(`${c.brief.industry} ${c.brief.request}`), message: () => 'dashboard', build: (c) => ({ title: c.brief.content.ui?.headline ?? c.brief.content.solution, appName: c.brief.content.ui?.appName ?? c.brandName, menu: clip(c.brief.content.ui?.menu, 5) }), variants: () => ['analytics'] },
  { family: 'phone-mockup', beats: ['demo', 'product'], weight: 1.1, visual: 'app on a phone', when: (c) => /app|تطبيق|mobile|جوال/i.test(`${c.brief.industry} ${c.brief.request}`) || Boolean(c.brief.content.ui?.screens?.length), message: (c) => c.brief.content.ui?.headline ?? '', build: (c) => ({ title: c.brief.content.solution, screen: { appName: c.brief.content.ui?.appName ?? c.brandName, headline: c.brief.content.ui?.headline ?? c.brief.content.solution, items: clip(c.brief.content.ui?.items, 4), button: c.brief.content.cta.button, screenshot: c.brief.content.ui?.screens?.[0]?.screenshot } }) },
  { family: 'app-walkthrough', beats: ['demo', 'process'], weight: 1.2, visual: 'app screens step by step', when: (c) => (c.brief.content.ui?.screens?.length ?? 0) >= 2, message: () => 'app walkthrough', build: (c) => ({ title: c.brief.content.solution, screens: clip(c.brief.content.ui?.screens, 4).map((s) => ({ ...s, appName: c.brief.content.ui?.appName ?? c.brandName })) }) },

  // ───────── features
  { family: 'state-flow', beats: ['demo', 'process'], weight: 1.6, visual: 'one element morphing through the product journey', when: (c) => (c.brief.content.flow?.length ?? 0) >= 2 || Boolean(c.brief.objective === 'sell' && c.assets.product && c.brief.content.product?.name && c.brief.content.product?.price), message: () => 'product journey', build: (c) => ({ title: c.brief.content.solution, states: c.brief.content.flow?.length ? clip(c.brief.content.flow, 7).map((s) => (s.kind === 'product' && c.assets.product ? { ...s, image: c.assets.product } : s)) : flowFromProduct(c) }), variants: () => ['morph-trail', 'morph'] },
  { family: 'workflow', beats: ['process'], weight: 1.2, visual: 'connected steps lighting up', when: (c) => (c.brief.content.steps?.length ?? 0) >= 3 && /saas|automation|أتمت|منصة|platform|app|تطبيق|نظام|system|workflow/i.test(`${c.brief.industry} ${c.brief.request}`), message: (c) => c.brief.content.steps!.join(' ← '), build: (c) => ({ steps: clip(c.brief.content.steps, 6).map((s) => ({ label: s, icon: iconFor(s, 'CircleCheck') })) }) },
  { family: 'integration-hub', beats: ['feature', 'demo'], weight: 1.3, visual: 'product connected to the tools it integrates with', when: (c) => (c.brief.content.integrations?.length ?? 0) >= 3, message: (c) => c.brief.content.integrations!.join('، '), build: (c) => ({ title: c.brief.content.ui?.headline, center: c.brandName ?? c.brief.content.ui?.appName ?? '•', centerLogo: c.assets.logo, apps: clip(c.brief.content.integrations, 8).map((a) => ({ label: a, icon: iconFor(a, 'Plug') })) }) },
  { family: 'data-table', beats: ['data', 'comparison'], weight: 1.3, visual: "a table of the user's data", when: (c) => Boolean(c.brief.content.table && c.brief.content.table.columns.length >= 2 && c.brief.content.table.rows.length >= 2), message: () => 'table', build: (c) => { const t = c.brief.content.table!; return { columns: t.columns.slice(0, 4), rows: t.rows.slice(0, 6).map((r) => r.slice(0, 4)), highlightRow: t.highlightRow, source: t.source }; } },
  { family: 'product-details', beats: ['feature'], weight: 1.35, visual: 'product with callouts to its features', when: (c) => Boolean(c.assets.product && (c.brief.content.features?.length ?? 0) >= 2), message: (c) => c.brief.content.features!.map((f) => f.title).join('، '), build: (c) => ({ image: c.assets.product, name: c.brief.content.product?.name, specs: clip(c.brief.content.features, 4).map((f) => f.title), price: undefined }) },
  { family: 'form-fill', beats: ['demo', 'process'], weight: 1.4, visual: 'a form filled in and submitted', when: (c) => Boolean(c.brief.content.form?.fields.length), message: (c) => c.brief.content.form!.button, build: (c) => ({ title: c.brief.content.solution, fields: clip(c.brief.content.form!.fields, 4), button: c.brief.content.form!.button, done: c.brief.content.form!.done }) },
  { family: 'landing-page', beats: ['demo'], weight: 1.15, visual: 'landing page in a browser', when: (c) => Boolean(c.brief.content.ui?.headline && (c.brief.content.ui.url || c.assets.screenshot)), message: (c) => c.brief.content.ui!.headline!, build: (c) => ({ url: c.brief.content.ui?.url, screenshot: c.assets.screenshot, pageTitle: c.brief.content.ui!.headline, pageSubtitle: c.brief.content.ui?.subline, pageCta: c.brief.content.cta.button, features: clip(c.brief.content.features?.map((f) => f.title), 3) }) },
  { family: 'feature-set', beats: ['feature'], weight: 1.5, visual: 'features with icons', when: (c) => (c.brief.content.features?.length ?? 0) >= 2, message: (c) => c.brief.content.features!.map((f) => f.title).join('، '), build: (c) => ({ title: c.brief.content.solution && (c.brief.content.features?.length ?? 0) <= 4 ? undefined : undefined, features: clip(c.brief.content.features, 6).map((f) => ({ title: f.title, text: f.description, icon: f.icon ?? iconFor(`${f.title} ${f.description ?? ''}`, 'Sparkles') })) }), variants: (c) => {
    const n = c.brief.content.features?.length ?? 0;
    if (c.orientation === 'portrait') return n <= 3 ? ['stack', 'staggered', 'spotlight', 'carousel'] : ['stack', 'grid', 'masonry', 'spotlight'];
    if (c.orientation === 'landscape') return n <= 4 ? ['grid', 'orbit', 'split', 'perspective', 'floating'] : ['grid', 'masonry', 'perspective'];
    return ['grid', 'orbit', 'stack', 'carousel'];
  } },
  { family: 'icon-list', beats: ['feature'], weight: 1, visual: 'benefit checklist', when: (c) => (c.brief.content.features?.length ?? 0) >= 2, message: (c) => c.brief.content.features!.map((f) => f.title).join('، '), build: (c) => ({ items: clip(c.brief.content.features, 5).map((f) => ({ text: f.title })) }), variants: (c) => (c.orientation === 'landscape' ? ['chips', 'checklist'] : ['checklist', 'chips']) },

  // ───────── process
  { family: 'process-steps', beats: ['process'], weight: 1.4, visual: 'numbered steps', when: (c) => (c.brief.content.steps?.length ?? 0) >= 2, message: (c) => c.brief.content.steps!.join(' ← '), build: (c) => ({ steps: clip(c.brief.content.steps, 5).map((s) => ({ title: s, icon: iconFor(s, 'ArrowLeft') })) }) },
  { family: 'timeline', beats: ['process'], weight: 0.8, visual: 'timeline', when: (c) => (c.brief.content.steps?.length ?? 0) >= 3 && c.brief.content.steps!.every((s) => s.includes(':')), message: (c) => c.brief.content.steps!.join(' ← '), build: (c) => ({ events: clip(c.brief.content.steps, 6).map((s) => ({ label: s.split(':')[0].trim(), text: s.split(':').slice(1).join(':').trim() })) }) },

  // ───────── comparison
  { family: 'comparison-table', beats: ['comparison'], weight: 1.2, visual: 'us vs them table', when: (c) => Boolean(c.brief.content.comparison && c.brief.content.comparison.left.length === c.brief.content.comparison.right.length), message: () => 'comparison', build: (c) => { const k = c.brief.content.comparison!; return { leftTitle: k.leftTitle, rightTitle: k.rightTitle, rows: k.left.slice(0, 6).map((l, i) => ({ label: k.right[i], left: false, right: true })) }; }, variants: (c) => (c.orientation === 'landscape' ? ['table', 'versus'] : ['versus', 'table']) },
  { family: 'pros-cons', beats: ['comparison'], weight: 1.2, visual: 'old way vs new way', when: (c) => Boolean(c.brief.content.comparison), message: () => 'comparison', build: (c) => { const k = c.brief.content.comparison!; return { consTitle: k.leftTitle, prosTitle: k.rightTitle, cons: k.left.slice(0, 5), pros: k.right.slice(0, 5) }; } },

  // ───────── data / proof (sourced only)
  { family: 'kpi-counter', beats: ['proof', 'data'], weight: 1.3, visual: 'sourced counters', when: (c) => (c.brief.content.stats?.length ?? 0) >= 2, message: (c) => c.brief.content.stats!.map((s) => `${s.value} ${s.label}`).join('، '), build: (c) => ({ kpis: clip(c.brief.content.stats, 4).map((s) => ({ value: s.value, label: s.label, prefix: s.prefix, suffix: s.suffix, icon: iconFor(s.label, 'TrendingUp') })), source: [...new Set(clip(c.brief.content.stats, 4).map((s) => s.source))].join(' · ') }), variants: (c) => (c.orientation === 'landscape' ? ['row', 'cards'] : ['cards', 'grid']) },
  { family: 'stat-highlight', beats: ['proof', 'data', 'hook'], weight: 1.2, visual: 'one big sourced number', when: (c) => (c.brief.content.stats?.length ?? 0) >= 1, message: (c) => `${c.brief.content.stats![0].value} ${c.brief.content.stats![0].label}`, build: (c) => { const s = c.brief.content.stats![0]; return { value: s.value, prefix: s.prefix, suffix: s.suffix, label: s.label, source: s.source, highlight: emph(c, s.label) }; }, variants: (c) => (c.brief.content.stats?.[0]?.suffix === '%' ? ['ring', 'center'] : ['center', 'split']) },
  { family: 'bar-chart', beats: ['data'], weight: 1.2, visual: 'sourced bar chart', when: (c) => Boolean(c.brief.content.series && c.brief.content.series.labels.length === c.brief.content.series.values.length && c.brief.content.series.labels.length <= 8), message: (c) => c.brief.content.series!.title ?? 'chart', build: (c) => { const s = c.brief.content.series!; return { title: s.title, labels: s.labels, values: s.values, prefix: s.prefix, suffix: s.suffix, source: s.source }; }, variants: (c) => (c.orientation === 'portrait' ? ['horizontal', 'vertical'] : ['vertical', 'race']) },
  { family: 'line-chart', beats: ['data'], weight: 1.1, visual: 'sourced trend line', when: (c) => Boolean(c.brief.content.series && c.brief.content.series.labels.length === c.brief.content.series.values.length && c.brief.content.series.labels.length >= 4), message: (c) => c.brief.content.series!.title ?? 'trend', build: (c) => { const s = c.brief.content.series!; return { title: s.title, labels: s.labels, values: s.values, prefix: s.prefix, suffix: s.suffix, source: s.source }; } },

  // ───────── social (sourced only)
  { family: 'testimonial', beats: ['social', 'proof'], weight: 1.4, visual: 'real customer quote', when: (c) => (c.brief.content.testimonials?.length ?? 0) >= 1, message: (c) => c.brief.content.testimonials![0].quote, build: (c) => { const t = c.brief.content.testimonials![0]; return { quote: t.quote, name: t.author, role: t.role, rating: t.rating, source: t.source, highlight: emph(c, t.quote) }; } },
  { family: 'comment', beats: ['social'], weight: 1, visual: 'real comments', when: (c) => (c.brief.content.testimonials?.length ?? 0) >= 2, message: () => 'comments', build: (c) => ({ comments: clip(c.brief.content.testimonials, 3).map((t) => ({ name: t.author, text: t.quote })), source: [...new Set(clip(c.brief.content.testimonials, 3).map((t) => t.source))].join(' · ') }) },

  // ───────── offer
  { family: 'price-offer', beats: ['offer'], weight: 1.4, visual: 'price / offer card', when: (c) => Boolean(c.brief.content.offer || c.brief.content.product?.price), message: (c) => c.brief.content.offer ?? c.brief.content.product!.price!, build: (c) => ({ headline: c.brief.content.offer ?? c.brief.content.product?.name ?? c.brief.content.hook, price: c.brief.content.product?.price, oldPrice: c.brief.content.product?.oldPrice, badge: c.brief.content.offerBadge, image: c.assets.product }), variants: (c) => (c.brief.content.product?.oldPrice ? ['slash', 'badge'] : ['badge', 'tag']) },
  { family: 'shopping-cart', beats: ['offer', 'product'], weight: 0.9, visual: 'add to cart moment', when: (c) => Boolean(c.brief.content.product?.name && c.assets.product && c.brief.objective === 'sell'), message: (c) => c.brief.content.product!.name, build: (c) => ({ image: c.assets.product, name: c.brief.content.product?.name, price: c.brief.content.product?.price, button: c.brief.content.cta.button }) },

  // ───────── CTA
  { family: 'cta-qr', beats: ['cta'], weight: 2.4, visual: 'scannable QR + CTA', when: (c) => Boolean(c.brief.content.cta.qr), message: (c) => c.brief.content.cta.text, build: (c) => ({ title: c.brief.content.cta.text, highlight: emph(c, c.brief.content.cta.text), url: c.brief.content.cta.qr, caption: c.brief.content.cta.url?.replace(/^https?:\/\//, '') }) },
  { family: 'cta-contact', beats: ['cta'], weight: 2, visual: 'contact details', when: (c) => Boolean(c.brief.content.cta.contacts?.length || c.brief.content.cta.contact), message: (c) => c.brief.content.cta.text, build: (c) => ({ title: c.brief.content.cta.text, highlight: emph(c, c.brief.content.cta.text), button: c.brief.content.cta.button, contacts: c.brief.content.cta.contacts ?? [{ kind: /^\+?\d[\d\s-]{6,}$/.test(c.brief.content.cta.contact!) ? 'phone' : /\./.test(c.brief.content.cta.contact!) ? 'website' : 'handle', value: c.brief.content.cta.contact! }], logo: c.assets.logo }) },
  { family: 'cta-logo', beats: ['cta'], weight: 1.4, visual: 'logo end card + CTA', when: (c) => Boolean(c.assets.logo || c.brandName), message: (c) => c.brief.content.cta.text, build: (c) => ({ title: c.brief.content.cta.text, highlight: emph(c, c.brief.content.cta.text), button: c.brief.content.cta.button, logo: c.assets.logo }) },
  { family: 'cta-button', beats: ['cta'], weight: 1.2, visual: 'button pressed', when: (c) => Boolean(c.brief.content.cta.button), message: (c) => c.brief.content.cta.text, build: (c) => ({ title: c.brief.content.cta.text, highlight: emph(c, c.brief.content.cta.text), button: c.brief.content.cta.button, buttonIcon: c.lang === 'en' ? 'ArrowRight' : 'ArrowLeft' }) },
  { family: 'cta-clean', beats: ['cta'], weight: 1, visual: 'clean CTA', when: () => true, message: (c) => c.brief.content.cta.text, build: (c) => ({ title: c.brief.content.cta.text, highlight: emph(c, c.brief.content.cta.text), button: c.brief.content.cta.button, subtitle: c.brief.content.cta.url?.replace(/^https?:\/\//, '') }) },
];
RECIPES.push(...MODULE_RECIPES);
