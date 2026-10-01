/**
 * Visual direction: picks a style preset from the brief (explicit style > tone >
 * industry > objective) and, when the user has no logo, derives a brand palette
 * from that direction. No logo is ever fabricated — only colours and type.
 */
import type { Brief } from '../schema/brief';
import type { BrandProfile } from '../schema/video';
import { findStyleId, STYLE_PRESETS } from '../styles/presets';
import { paletteFromUserColors } from '../brand/palette';
import { isHex, normalizeHex } from '../brand/color';

const TONE_STYLE: [RegExp, string][] = [
  [/فخم|فاخر|راق|luxur|premium|elegant|أنيق/i, 'luxury'],
  [/خليج|gulf|سعود|saudi|وطني/i, 'gulf-premium'],
  [/مستقبل|ذكاء|ai|futur|tech-forward/i, 'ai-futuristic'],
  [/نيون|neon|gaming|قيم/i, 'neon'],
  [/سينما|cinema|dramatic|درام|ملحم|epic/i, 'cinematic'],
  [/رياض|sport|energy|حماس|قوي|bold/i, 'sports'],
  [/مرح|fun|comic|كوميد|playful/i, 'comic'],
  [/بسيط|minimal|هادئ|calm|clean/i, 'minimal'],
  [/تحرير|editorial|مجلة|magazine/i, 'editorial'],
  [/زجاج|glass/i, 'glass'],
  [/جريء|سوشال|viral|trend|ترند/i, 'bold-social'],
  [/رسمي|corporate|professional|مؤسس|بنك|bank/i, 'clean-corporate'],
];

const INDUSTRY_STYLE: [RegExp, string][] = [
  [/saas|software|برمج|منصة|platform|app|تطبيق/i, 'saas'],
  [/ai|ذكاء|machine|بيانات|data/i, 'ai-futuristic'],
  [/tech|تقني|startup|ناشئ/i, 'tech'],
  [/perfume|عطر|عطور|oud|عود|jewel|مجوهر|fashion|أزياء|watch|ساع/i, 'luxury'],
  [/e-?commerce|store|متجر|shop|تسوق|retail|منتج/i, 'ecommerce'],
  [/food|مطعم|restaurant|coffee|قهو|كافيه|cafe/i, 'bold-social'],
  [/sport|رياض|gym|نادي|fitness/i, 'sports'],
  [/real ?estate|عقار|finance|مال|bank|بنك|insurance|تأمين|legal|محاما|consult|استشار/i, 'clean-corporate'],
  [/education|تعليم|course|دورة|school|مدرس|أكاديمي/i, 'minimal'],
  [/event|فعالي|مؤتمر|conference|launch|إطلاق/i, 'cinematic'],
  [/gov|حكوم|وزار|national|وطني/i, 'saudi-modern'],
];

export function pickStyle(brief: Brief, genre?: string): { id: string; reason: string } {
  const explicit = findStyleId(brief.style);
  if (explicit) return { id: explicit, reason: `requested style "${brief.style}"` };
  // the film's form decides the look before tone does (a whiteboard film is a board, whatever the tone)
  if (genre === 'whiteboard') return { id: 'whiteboard', reason: 'whiteboard film' };
  if (genre === 'illustrated') return { id: 'illustration', reason: 'illustrated film' };
  if (genre === 'launch' && /hype|حماس|قوي|energetic|bold|جريء|teaser|تشويق/i.test([...brief.tone, brief.request].join(' '))) return { id: 'launch-hype', reason: 'hype launch film' };
  const tone = [...brief.tone, brief.request].join(' ');
  for (const [re, id] of TONE_STYLE) if (re.test(brief.tone.join(' '))) return { id, reason: `tone (${brief.tone.join(', ')})` };
  const gccVoice = brief.language !== 'en' && ['saudi', 'gulf'].includes(brief.dialect);
  if (gccVoice && /tech|تقني|app|تطبيق|saas|منصة|platform|startup|ناشئ/i.test(brief.industry)) return { id: 'saudi-modern', reason: `GCC audience + ${brief.industry}` };
  for (const [re, id] of INDUSTRY_STYLE) if (re.test(brief.industry)) return { id, reason: `industry "${brief.industry}"` };
  for (const [re, id] of TONE_STYLE) if (re.test(tone)) return { id, reason: 'wording of the request' };
  for (const [re, id] of INDUSTRY_STYLE) if (re.test(brief.request)) return { id, reason: 'subject of the request' };
  const gcc = brief.language !== 'en' && ['saudi', 'gulf', 'msa'].includes(brief.dialect);
  return { id: gcc ? 'saudi-modern' : 'clean-corporate', reason: 'default direction for the audience' };
}

/**
 * Brand profile when the user has NO logo: name (if given) + palette from their
 * colours or from the chosen style. `source: 'generated'`, `logo` stays empty.
 */
export function generatedBrand(brief: Brief, styleId: string): BrandProfile | null {
  const b = brief.brand ?? undefined;
  const colors = (b?.colors ?? []).filter(isHex).map(normalizeHex);
  if (colors.length) {
    const p = paletteFromUserColors(colors, { name: b?.name, tone: brief.tone, source: 'user', mode: STYLE_PRESETS[styleId]?.mode ?? 'auto' });
    return { ...p, logo: undefined, style: styleId };
  }
  if (!b?.name) return null; // style palette alone is the direction; nothing to brand
  const t = STYLE_PRESETS[styleId];
  return {
    name: b.name,
    primary: t.palette.primary,
    secondary: t.palette.secondary,
    accent: t.palette.accent,
    background: t.palette.background,
    surface: t.palette.surface,
    textPrimary: t.palette.textPrimary,
    textSecondary: t.palette.textSecondary,
    style: styleId,
    mode: t.mode,
    personality: brief.tone,
    dominantColors: [],
    contrastRules: { minTextContrast: 4.5, minLargeTextContrast: 3 },
    source: 'generated',
  };
}

export const LOGO_QUESTION_AR = 'هل عندك شعار أو هوية بصرية تبغى نعتمدها في الفيديو؟ إذا عندك أرسل الشعار، وإذا ما عندك أكمل لك بهوية مناسبة للمحتوى.';
export const LOGO_QUESTION_EN = 'Do you have a logo or brand identity to use in the video? If so, upload it and I will extract the brand colours automatically. If not, I will create a fitting visual direction without adding a fake logo.';
