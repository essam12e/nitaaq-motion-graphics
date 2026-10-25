/**
 * Style selection when the user names none. Deterministic scoring of every renderable style against
 * the brief's signals (industry, product, tone, audience, objective, assets, brand colours, voice,
 * duration, amount of information, aspect). Not a director: a ranked lookup with reasons
 * (`whyThisStyle`). Pure.
 */
import type { MotionStyle } from './schema';
import { RENDERABLE_STYLES } from './library';
import { isDark, toOklch } from '../brand/color';

/** Arabic / English words for the tags used in `fits` (a tag also matches itself). */
const LEX: Record<string, string> = {
  saas: 'ساس|برمج|منصة|منصه|software|platform', software: 'برمج|برنامج', fintech: 'مالي|محفظ|دفع|payment|wallet|بنك رقمي', b2b: 'شركات|مؤسس|b2b|enterprise',
  platform: 'منصة|منصه', app: 'تطبيق|app', ai: 'ذكاء|ai\\b|اصطناع|ذكي', tech: 'تقني|تقنية|tech', crypto: 'كريبتو|عملات رقمية', design: 'تصميم', architecture: 'معمار|عمارة',
  consulting: 'استشار|consult', finance: 'مال|تمويل|استثمار|finance|invest', agency: 'وكالة|agency', media: 'إعلام|اعلام|media', publishing: 'نشر|مجلة|كتاب', education: 'تعليم|دورة|course|أكاديمي|اكاديمي|مدرس|school|تدريب',
  culture: 'ثقاف|فن|culture', 'real estate': 'عقار|real ?estate|فلل|شقق', social: 'سوشال|social|ريلز|reels|تيك|tiktok', event: 'فعالي|مؤتمر|حفل|event|معرض', retail: 'تجزئة|retail|محل|سوق', services: 'خدمات|خدمة|service',
  delivery: 'توصيل|delivery', health: 'صح|health|عياد|طبي', government: 'حكوم|وزار|gov', startup: 'ناشئ|startup', logistics: 'لوجست|شحن|logistics|shipping', infrastructure: 'بنية تحتية|infrastructure|سحاب|cloud',
  'smart city': 'مدينة ذكية|smart city', iot: 'iot|إنترنت الأشياء', brand: 'هوية|علامة|brand', beverage: 'مشروب|عصير|قهوة|قهوه|drink|beverage|coffee|كافيه|cafe', beauty: 'تجميل|بشرة|مكياج|beauty|cosmetic', cosmetics: 'كريم|مستحضر',
  music: 'موسيق|music', lifestyle: 'لايف|lifestyle', healthcare: 'رعاية|مستشفى|طبي|healthcare|clinic', nonprofit: 'خيري|غير ربحي|nonprofit', wellness: 'عافية|يوغا|wellness|spa', art: 'فن|art|غاليري|gallery', museum: 'متحف|museum',
  furniture: 'أثاث|اثاث|furniture', engineering: 'هندس|engineer', construction: 'مقاول|بناء|construction', manufacturing: 'مصنع|تصنيع|manufactur', automotive: 'سيار|automotive|car\\b', hardware: 'جهاز|أجهزة|hardware',
  cybersecurity: 'أمن|امن سيبراني|حماية|security|cyber', gaming: 'ألعاب|العاب|قيمنق|gaming|game', defense: 'دفاع|defense', telecom: 'اتصالات|telecom', data: 'بيانات|data|تحليل', perfume: 'عطر|عطور|perfume|عود|oud|بخور',
  jewelry: 'مجوهر|ذهب|jewel|خاتم', fashion: 'أزياء|ازياء|موضة|fashion|عباي|ملابس', hotel: 'فندق|منتجع|hotel|resort', watches: 'ساع|watch', kids: 'أطفال|اطفال|kids|طفل', games: 'ألعاب|العاب|لعبة', ecommerce: 'متجر|متاجر|e-?commerce|تسوق|shop|سلة',
  electronics: 'إلكترون|الكترون|electronics|سماعة|جوال', food: 'أكل|طعام|مطعم|food|restaurant|برجر|وجبة', cafe: 'كافيه|قهوة|cafe|coffee', events: 'فعالي|حفل|event', youth: 'شباب|youth', creator: 'صانع محتوى|creator|يوتيوب',
  sport: 'رياض|sport|كرة|مباراة', fitness: 'لياقة|fitness|تمارين', gym: 'نادي|gym|جيم', 'energy drink': 'مشروب طاقة|energy drink', esports: 'رياضات إلكترونية|esports', tourism: 'سياح|tourism|سفر|travel', hospitality: 'ضيافة|hospitality',
  supermarket: 'سوبرماركت|بقالة|supermarket|هايبر', restaurant: 'مطعم|restaurant', store: 'متجر|store|محل', sale: 'تخفيض|خصم|عرض|عروض|sale|discount|تنزيلات', ai_assistant: 'مساعد',
  // tones
  trustworthy: 'موثوق|ثقة|trust', calm: 'هادئ|هدوء|calm', premium: 'فاخر|premium|راق', modern: 'حديث|عصري|modern', futuristic: 'مستقبل|futur', dreamy: 'حالم', confident: 'واثق|ثقة|confident', precise: 'دقيق|دقة|precise',
  bold: 'جريء|قوي|bold', thoughtful: 'عميق|thoughtful', credible: 'موثوق|مصداق', informative: 'معلومات|توعوي|informative', energetic: 'حماس|طاقة|نشيط|energetic|hype', direct: 'مباشر|direct', young: 'شبابي|young', friendly: 'ودود|لطيف|friendly',
  clear: 'واضح|clear', optimistic: 'متفائل|optimis', simple: 'بسيط|سهل|simple', systematic: 'منظم|نظام', smart: 'ذكي|smart', clever: 'ذكي|clever', minimal: 'بسيط|minimal|مينيمال', fresh: 'منعش|fresh|طازج', fluid: 'انسياب|fluid',
  playful: 'مرح|playful|فان|fun', sensual: 'حسي', human: 'إنساني|انساني|human', elegant: 'أنيق|انيق|elegant', technical: 'تقني|technical', expert: 'خبير|expert', intense: 'قوي|intense', powerful: 'قوي|powerful', luxurious: 'فخم|فاخر|luxur',
  exclusive: 'حصري|exclusive', cosy: 'دافئ|cosy|cozy', fun: 'مرح|fun|ممتع', approachable: 'قريب', desirable: 'مرغوب', clean: 'نظيف|clean', youthful: 'شبابي', rebellious: 'متمرد', casual: 'عفوي|casual', aggressive: 'هجوم|aggressive',
  fast: 'سريع|fast', emotional: 'عاطف|مؤثر|emotional', epic: 'ملحم|epic', inspiring: 'ملهم|inspir', exciting: 'مثير|exciting', urgent: 'عاجل|لفترة محدودة|urgent', loud: 'صاخب|loud', artistic: 'فني|artistic', cultural: 'ثقافي',
  // products / jobs
  dashboard: 'لوحة تحكم|داشبورد|dashboard', tool: 'أداة|اداة|tool', 'ai assistant': 'مساعد ذكي|assistant', card: 'بطاقة|card', service: 'خدمة|service', report: 'تقرير|report', offer: 'عرض|offer', campaign: 'حملة|campaign', process: 'عملية|خطوات|process',
  system: 'نظام|system', network: 'شبكة|network', logo: 'شعار|logo', drink: 'مشروب|drink', cream: 'كريم', wallet: 'محفظ|wallet', story: 'قصة|story', course: 'دورة|course', idea: 'فكرة|idea', exhibition: 'معرض|exhibition', device: 'جهاز|device',
  building: 'مبنى|برج|building', machine: 'آلة|ماكينة|machine', product: 'منتج|product', security: 'حماية|أمان|security', watch: 'ساعة|watch', jewel: 'مجوهر|jewel', villa: 'فيلا|villa', toy: 'لعبة|ألعاب|toy', gift: 'هدية|gift',
  bottle: 'زجاجة|عبوة|bottle', shoe: 'حذاء|جزمة|shoe|sneaker', package: 'علبة|تغليف|package', merch: 'منتجات|merch', menu: 'منيو|قائمة طعام|menu', car: 'سيارة|car\\b', match: 'مباراة|match', place: 'مكان|وجهة|place', project: 'مشروع|project',
  discount: 'خصم|discount', catalogue: 'كتالوج|catalog', demo: 'شرح|demo|عرض توضيحي', feature: 'ميزة|مميزات|feature', launch: 'إطلاق|اطلاق|launch|جديد', teaser: 'تشويق|teaser', announcement: 'إعلان|اعلان|announce', explainer: 'شرح|explain|كيف',
  onboarding: 'تسجيل|onboard', 'how-it-works': 'كيف يعمل|خطوات|how it works', hook: 'hook', reel: 'ريل|reel|ريلز', poster: 'بوستر|poster', ad: 'إعلان|اعلان|\\bad\\b',
};

export interface BriefSignals {
  text: string;
  industry?: string;
  tone?: string[];
  objective?: string;
  audience?: string;
  duration?: number;
  aspect?: string;
  /** Number of info items (features, stats, steps, products, lines). */
  infoItems: number;
  hasProductImage: boolean;
  hasScreenshot: boolean;
  hasVoice: boolean;
  brandColors?: string[];
}

export interface StyleScore { id: string; score: number; reasons: string[] }

const reFor = (tag: string) => new RegExp(`(?:${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]?')}${LEX[tag] ? '|' + LEX[tag] : ''})`, 'i');

export function scoreStyle(s: MotionStyle, sig: BriefSignals): StyleScore {
  const reasons: string[] = [];
  let score = 0;
  const hit = (list: string[], w: number, label: string, text = sig.text) => {
    const m = list.filter((t) => reFor(t).test(text));
    if (m.length) {
      score += w * Math.min(2, m.length);
      reasons.push(`${label}: ${m.slice(0, 3).join(', ')}`);
    }
    return m.length;
  };
  hit(s.fits.industries, 3, 'industry', `${sig.industry ?? ''} ${sig.text}`);
  hit(s.fits.tones, 2, 'tone', `${(sig.tone ?? []).join(' ')} ${sig.text}`);
  hit(s.fits.products, 2, 'product');
  hit(s.fits.jobs, 1.2, 'job', `${sig.objective ?? ''} ${sig.text}`);
  const avoided = s.fits.avoidFor.filter((t) => reFor(t).test(`${sig.industry ?? ''} ${sig.text}`));
  if (avoided.length) {
    score -= 4;
    reasons.push(`avoid for: ${avoided.join(', ')}`);
  }
  // amount of information the film carries vs the style's capacity
  const need = Math.min(1, sig.infoItems / 8);
  const gap = Math.max(0, need - s.fits.infoCapacity);
  if (gap > 0.15) {
    score -= gap * 6;
    reasons.push(`too much information for it (${sig.infoItems} items)`);
  }
  if (sig.duration) {
    const [lo, hi] = s.fits.duration;
    if (sig.duration < lo || sig.duration > hi) {
      score -= 1;
      reasons.push(`duration ${sig.duration}s outside ${lo}–${hi}s`);
    }
  }
  if (sig.aspect && !s.fits.aspects.includes(sig.aspect as never)) score -= 0.5;
  if (sig.hasProductImage) {
    if (s.id === 'product-commercial') { score += 2.5; reasons.push('a product image is supplied'); }
    else if (s.id === 'minimal-luxury') score += 0.8;
  }
  if (sig.hasScreenshot && (s.id === 'premium-saas' || s.id === 'aurora-glass')) { score += 2; reasons.push('a real UI screenshot is supplied'); }
  if (sig.hasVoice && s.rhythmLanguage.pace === 'fast' && s.rhythmLanguage.cutOn === 'beat') score -= 0.5; // a voice paces the film
  // brand colour temperament
  const cs = (sig.brandColors ?? []).filter(Boolean);
  if (cs.length) {
    const p = toOklch(cs[0]);
    const vivid = p.c > 0.14;
    if (vivid && s.character.playfulness > 0.6) score += 0.5;
    if (!vivid && s.character.luxury > 0.7) score += 0.5;
    if (cs.some((c) => isDark(c)) && s.colorBehavior.ground === 'dark') score += 0.3;
  }
  return { id: s.id, score: Math.round(score * 100) / 100, reasons };
}

export function rankStyles(sig: BriefSignals, pool: MotionStyle[] = RENDERABLE_STYLES): StyleScore[] {
  return pool.map((s) => scoreStyle(s, sig)).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Signals from a brief (loose shape: works with BriefSchema output or a plain object). */
export function signalsFromBrief(brief: Record<string, any>): BriefSignals {
  const c = brief.content ?? {};
  const tone: string[] = Array.isArray(brief.tone) ? brief.tone : brief.tone ? [String(brief.tone)] : [];
  const assets: { kind: string }[] = brief.assets ?? [];
  const text = [brief.request, brief.title, brief.industry, brief.audience, tone.join(' '), c.hook, c.problem, c.solution, c.offer, c.product?.name, c.product?.tagline, ...(Array.isArray(c.lines) ? c.lines : []), ...((Array.isArray(c.features) ? c.features : []) as any[]).map((f) => (typeof f === 'string' ? f : f.title ?? '')), ...(Array.isArray(brief.audio?.transcript) ? brief.audio.transcript : [brief.audio?.transcript])]
    .filter(Boolean)
    .join(' ');
  const infoItems = (c.features?.length ?? 0) + (c.stats?.length ?? 0) + (c.steps?.length ?? 0) + (c.products?.length ?? 0) + (c.problemPoints?.length ?? 0) + (c.testimonials?.length ?? 0) + (c.lines?.length ?? 0) + (c.table ? 4 : 0) + (c.comparison ? 3 : 0);
  return {
    text,
    industry: brief.industry,
    tone,
    objective: brief.objective,
    audience: brief.audience,
    duration: brief.duration,
    aspect: brief.aspect,
    infoItems,
    hasProductImage: assets.some((a) => a.kind === 'product') || !!c.product?.image || !!(c.products ?? []).length,
    hasScreenshot: assets.some((a) => a.kind === 'screenshot') || !!c.ui?.screenshot,
    hasVoice: brief.audio?.mode === 'user-voice' || brief.audio?.mode === 'tts',
    brandColors: brief.brand?.colors ?? [],
  };
}
