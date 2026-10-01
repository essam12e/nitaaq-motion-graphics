/**
 * Illustration Mode — editable, procedural vector illustrations drawn in code.
 *
 * Every subject is a list of PARTS (paths in a 200×200 box) with a tone
 * (primary / secondary / accent / ink / surface) and a draw order, so the same
 * subject renders in any brand palette and in three styles:
 *   flat     — solid fills, no outlines
 *   line     — outlines only (monoline), draws on stroke by stroke
 *   duotone  — fills in two tones + ink outlines
 * Parts can be drawn on (stroke-dashoffset) then filled, which is also what
 * the whiteboard family uses. No stock art, no AI images, no third-party logos.
 * Pure data (browser-safe).
 */
import { CapabilityRegistry } from '../core/registry';

export type Tone = 'primary' | 'secondary' | 'accent' | 'ink' | 'surface';
export interface IllPart {
  d: string;
  tone: Tone;
  /** Line-only part (never filled): arrows, motion lines, connectors. */
  line?: boolean;
  /** Group index for staged reveals (0 first). */
  stage?: number;
}
export interface IllustrationSubject {
  id: string;
  /** Arabic + English keywords for matching the brief. */
  keywords: string[];
  parts: IllPart[];
}

export const ILLUSTRATION_STYLES = ['flat', 'line', 'duotone'] as const;
export type IllustrationStyle = (typeof ILLUSTRATION_STYLES)[number];

const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0Z`;
const rrect = (x: number, y: number, w: number, h: number, r: number) => `M${x + r},${y}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}v${-(h - 2 * r)}a${r},${r} 0 0 1 ${r},${-r}Z`;

const SUBJECTS: IllustrationSubject[] = [
  {
    id: 'growth',
    keywords: ['نمو', 'زيادة', 'ارتفاع', 'مبيعات', 'growth', 'increase', 'sales', 'revenue'],
    parts: [
      { d: rrect(30, 120, 30, 50, 4), tone: 'secondary', stage: 0 },
      { d: rrect(75, 95, 30, 75, 4), tone: 'secondary', stage: 0 },
      { d: rrect(120, 65, 30, 105, 4), tone: 'primary', stage: 0 },
      { d: 'M28,110 L80,78 L112,92 L168,40', tone: 'accent', line: true, stage: 1 },
      { d: 'M150,38 L170,38 L170,58', tone: 'accent', line: true, stage: 1 },
      { d: 'M20,172 H180', tone: 'ink', line: true, stage: 0 },
    ],
  },
  {
    id: 'network',
    keywords: ['شبكة', 'ربط', 'تكامل', 'اتصال', 'network', 'connect', 'integration'],
    parts: [
      { d: 'M100,100 L45,55 M100,100 L155,55 M100,100 L45,150 M100,100 L155,150 M45,55 L155,55', tone: 'ink', line: true, stage: 1 },
      { d: circle(100, 100, 24), tone: 'primary', stage: 0 },
      { d: circle(45, 55, 14), tone: 'secondary', stage: 2 },
      { d: circle(155, 55, 14), tone: 'secondary', stage: 2 },
      { d: circle(45, 150, 14), tone: 'accent', stage: 2 },
      { d: circle(155, 150, 14), tone: 'secondary', stage: 2 },
    ],
  },
  {
    id: 'security',
    keywords: ['أمان', 'حماية', 'خصوصية', 'آمن', 'security', 'secure', 'privacy', 'protect'],
    parts: [
      { d: 'M100,25 L160,48 V100 C160,140 132,165 100,178 C68,165 40,140 40,100 V48 Z', tone: 'primary', stage: 0 },
      { d: 'M100,45 L142,61 V100 C142,128 123,147 100,157 Z', tone: 'secondary', stage: 1 },
      { d: 'M72,102 L93,123 L132,82', tone: 'surface', line: true, stage: 2 },
    ],
  },
  {
    id: 'speed',
    keywords: ['سرعة', 'سريع', 'فوري', 'لحظي', 'speed', 'fast', 'instant', 'quick'],
    parts: [
      { d: 'M112,20 L58,110 H96 L84,180 L146,84 H106 Z', tone: 'accent', stage: 0 },
      { d: 'M20,70 H56 M12,100 H48 M24,130 H52', tone: 'ink', line: true, stage: 1 },
      { d: 'M150,140 H186 M156,165 H180', tone: 'ink', line: true, stage: 1 },
    ],
  },
  {
    id: 'delivery',
    keywords: ['توصيل', 'شحن', 'طلب', 'delivery', 'shipping', 'order'],
    parts: [
      { d: rrect(20, 70, 100, 70, 6), tone: 'primary', stage: 0 },
      { d: 'M120,90 H150 L178,115 V140 H120 Z', tone: 'secondary', stage: 0 },
      { d: circle(52, 148, 14), tone: 'ink', stage: 1 },
      { d: circle(150, 148, 14), tone: 'ink', stage: 1 },
      { d: 'M48,96 H92 M48,114 H80', tone: 'surface', line: true, stage: 2 },
      { d: 'M2,90 H14 M6,110 H16', tone: 'ink', line: true, stage: 2 },
    ],
  },
  {
    id: 'team',
    keywords: ['فريق', 'عملاء', 'ناس', 'مجتمع', 'team', 'people', 'customers', 'community'],
    parts: [
      { d: circle(100, 62, 22), tone: 'primary', stage: 0 },
      { d: 'M58,160 C58,120 142,120 142,160 Z', tone: 'primary', stage: 0 },
      { d: circle(48, 82, 16), tone: 'secondary', stage: 1 },
      { d: 'M18,162 C18,132 78,132 78,162 Z', tone: 'secondary', stage: 1 },
      { d: circle(152, 82, 16), tone: 'secondary', stage: 1 },
      { d: 'M122,162 C122,132 182,132 182,162 Z', tone: 'secondary', stage: 1 },
    ],
  },
  {
    id: 'idea',
    keywords: ['فكرة', 'ابتكار', 'إبداع', 'idea', 'innovation', 'creative'],
    parts: [
      { d: 'M100,30 C66,30 46,56 46,84 C46,108 62,120 70,134 H130 C138,120 154,108 154,84 C154,56 134,30 100,30 Z', tone: 'accent', stage: 0 },
      { d: rrect(72, 140, 56, 14, 4), tone: 'ink', stage: 1 },
      { d: rrect(80, 158, 40, 12, 4), tone: 'ink', stage: 1 },
      { d: 'M100,6 V18 M30,40 L40,48 M170,40 L160,48 M14,90 H28 M172,90 H186', tone: 'ink', line: true, stage: 2 },
    ],
  },
  {
    id: 'data',
    keywords: ['بيانات', 'تحليل', 'تقارير', 'إحصائيات', 'data', 'analytics', 'report', 'insight'],
    parts: [
      { d: rrect(24, 34, 152, 120, 10), tone: 'surface', stage: 0 },
      { d: 'M100,94 L100,58 A36,36 0 0,1 134,106 Z', tone: 'primary', stage: 1 },
      { d: 'M100,94 L134,106 A36,36 0 1,1 100,58 Z', tone: 'secondary', stage: 1 },
      { d: 'M44,140 H156', tone: 'ink', line: true, stage: 2 },
      { d: 'M70,176 H130 M100,154 V176', tone: 'ink', line: true, stage: 0 },
    ],
  },
  {
    id: 'cloud',
    keywords: ['سحابة', 'سحابي', 'تخزين', 'cloud', 'storage', 'saas'],
    parts: [
      { d: 'M56,140 C30,140 22,112 40,98 C38,72 66,58 86,70 C96,46 140,46 148,78 C174,78 184,108 166,124 C164,134 156,140 146,140 Z', tone: 'primary', stage: 0 },
      { d: 'M100,160 V108 M84,122 L100,106 L116,122', tone: 'surface', line: true, stage: 1 },
    ],
  },
  {
    id: 'payment',
    keywords: ['دفع', 'فلوس', 'مالية', 'بطاقة', 'payment', 'pay', 'money', 'card', 'finance'],
    parts: [
      { d: rrect(22, 52, 156, 100, 12), tone: 'primary', stage: 0 },
      { d: 'M22,76 H178 V96 H22 Z', tone: 'ink', stage: 1 },
      { d: rrect(40, 116, 40, 18, 4), tone: 'accent', stage: 2 },
      { d: 'M120,126 H158', tone: 'surface', line: true, stage: 2 },
    ],
  },
  {
    id: 'chat',
    keywords: ['محادثة', 'دعم', 'رسائل', 'تواصل', 'chat', 'support', 'message'],
    parts: [
      { d: 'M30,40 H130 A12,12 0 0 1 142,52 V104 A12,12 0 0 1 130,116 H66 L44,136 V116 H30 A12,12 0 0 1 18,104 V52 A12,12 0 0 1 30,40 Z', tone: 'primary', stage: 0 },
      { d: 'M88,92 H170 A12,12 0 0 1 182,104 V148 A12,12 0 0 1 170,160 H166 V178 L146,160 H88 A12,12 0 0 1 76,148 V104 A12,12 0 0 1 88,92 Z', tone: 'secondary', stage: 1 },
      { d: 'M40,68 H112 M40,88 H92', tone: 'surface', line: true, stage: 2 },
    ],
  },
  {
    id: 'search',
    keywords: ['بحث', 'اكتشاف', 'search', 'find', 'discover'],
    parts: [
      { d: circle(86, 86, 50), tone: 'surface', stage: 0 },
      { d: `${circle(86, 86, 50)}M86,52a34,34 0 1,0 0.1,0Z`, tone: 'primary', line: true, stage: 0 },
      { d: 'M124,124 L172,172', tone: 'ink', line: true, stage: 1 },
      { d: 'M64,72 A26,26 0 0 1 86,60', tone: 'accent', line: true, stage: 2 },
    ],
  },
  {
    id: 'location',
    keywords: ['موقع', 'فروع', 'مكان', 'خريطة', 'location', 'branch', 'place', 'map'],
    parts: [
      { d: 'M100,20 C66,20 44,46 44,76 C44,116 100,176 100,176 C100,176 156,116 156,76 C156,46 134,20 100,20 Z', tone: 'primary', stage: 0 },
      { d: circle(100, 76, 20), tone: 'surface', stage: 1 },
      { d: 'M40,184 C70,170 130,170 160,184', tone: 'ink', line: true, stage: 1 },
    ],
  },
  {
    id: 'time',
    keywords: ['وقت', 'توفير', 'ساعة', 'مواعيد', 'time', 'save time', 'clock', 'schedule'],
    parts: [
      { d: circle(100, 100, 72), tone: 'primary', stage: 0 },
      { d: circle(100, 100, 58), tone: 'surface', stage: 0 },
      { d: 'M100,58 V100 L130,118', tone: 'ink', line: true, stage: 1 },
      { d: 'M100,46 V52 M154,100 H148 M100,154 V148 M46,100 H52', tone: 'ink', line: true, stage: 2 },
    ],
  },
  {
    id: 'gift',
    keywords: ['هدية', 'عرض', 'خصم', 'مكافأة', 'gift', 'offer', 'discount', 'reward'],
    parts: [
      { d: rrect(34, 84, 132, 90, 8), tone: 'primary', stage: 0 },
      { d: rrect(26, 62, 148, 30, 6), tone: 'secondary', stage: 0 },
      { d: 'M90,62 H110 V174 H90 Z', tone: 'accent', stage: 1 },
      { d: 'M100,62 C80,30 52,40 66,62 M100,62 C120,30 148,40 134,62', tone: 'accent', line: true, stage: 2 },
    ],
  },
  {
    id: 'rocket',
    keywords: ['إطلاق', 'انطلاق', 'نمو سريع', 'launch', 'rocket', 'startup', 'boost'],
    parts: [
      { d: 'M100,18 C130,40 140,80 132,128 H68 C60,80 70,40 100,18 Z', tone: 'surface', stage: 0 },
      { d: circle(100, 72, 14), tone: 'primary', stage: 1 },
      { d: 'M68,104 L44,136 L70,132 Z M132,104 L156,136 L130,132 Z', tone: 'primary', stage: 1 },
      { d: 'M84,134 C84,160 100,184 100,184 C100,184 116,160 116,134 Z', tone: 'accent', stage: 2 },
    ],
  },
];

export const IllustrationRegistry = new CapabilityRegistry<IllustrationSubject>('illustration');
for (const s of SUBJECTS) if (!IllustrationRegistry.has(s.id)) IllustrationRegistry.register(s);
export const ILLUSTRATION_IDS = SUBJECTS.map((s) => s.id);

/** Match free text (Arabic/English) to subjects, best first. */
export function matchIllustrations(text: string, max = 3): string[] {
  const t = text.toLowerCase();
  return SUBJECTS.map((s) => ({ id: s.id, score: s.keywords.reduce((a, k) => a + (t.includes(k.toLowerCase()) ? k.length : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.id);
}
