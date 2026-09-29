/** Built-in UI labels used inside mockups, per project language (never hardcode Arabic for English projects). */
import { useVideo } from '../engine/context';

const DICT = {
  total: { ar: 'الإجمالي', en: 'Total' },
  cart: { ar: 'السلة', en: 'Cart' },
  shipping: { ar: 'الشحن', en: 'Shipping' },
  payment: { ar: 'الدفع', en: 'Payment' },
  before: { ar: 'قبل', en: 'Before' },
  after: { ar: 'بعد', en: 'After' },
  addToCart: { ar: 'أضف للسلة', en: 'Add to cart' },
  now: { ar: 'الآن', en: 'now' },
  vs: { ar: 'مقابل', en: 'vs' },
  pros: { ar: 'المميزات', en: 'Pros' },
  cons: { ar: 'العيوب', en: 'Cons' },
  problem: { ar: 'المشكلة', en: 'The problem' },
  solution: { ar: 'الحل', en: 'The solution' },
  step: { ar: 'الخطوة', en: 'Step' },
} as const;

export type LabelKey = keyof typeof DICT;

export function useLabel(): (k: LabelKey) => string {
  const { spec } = useVideo();
  const lang = spec.project.language === 'en' ? 'en' : 'ar';
  return (k) => DICT[k][lang];
}
