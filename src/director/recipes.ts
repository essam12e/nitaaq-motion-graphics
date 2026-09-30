/**
 * Scene recipes: how a narrative beat can be told with a registered family, and
 * how the brief's copy/assets map onto that family's content. Recipes only use
 * what the brief provides (never invented numbers, quotes or logos).
 */
import type { Brief } from '../schema/brief';
import type { Beat } from '../schema/plan';

export interface RecipeCtx {
  brief: Brief;
  orientation: 'portrait' | 'landscape' | 'square';
  assets: { logo?: string; product?: string; screenshot?: string; images: string[] };
  brandName?: string;
  lang: 'ar' | 'en' | 'mixed';
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
