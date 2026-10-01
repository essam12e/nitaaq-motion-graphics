/**
 * Ad Creative Variants — the same brief told with different strategies, for
 * testing. A strategy changes the hook, the beat order, the pacing and when
 * the CTA lands; it never changes the brand, the product, the claims or the
 * user's media. A strategy the brief can't support (e.g. offer-first without
 * an offer) is reported as unsupported, never filled with invented copy.
 *
 * Aspects are RECOMPOSED, not cropped: each aspect is directed again so the
 * layout engine re-flows every scene for that canvas (9:16, 4:5, 1:1, 16:9).
 * Pure: the CLI runs `direct()` on each returned brief (lazy module "variants").
 */
import type { Brief } from '../schema/brief';
import { VARIANT_STRATEGIES } from '../schema/brief';
import type { Beat } from '../schema/plan';

export type Strategy = (typeof VARIANT_STRATEGIES)[number];
type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

interface StrategyDef {
  id: Strategy;
  title: string;
  /** Content the strategy needs; returns why not when missing. */
  needs: (b: Brief) => string | null;
  arc: (b: Brief) => Beat[];
  /** New hook line taken from the brief's own copy. */
  hook: (b: Brief) => string;
  pace: 'fast' | 'medium' | 'slow' | undefined;
  why: string;
}

const firstFeature = (b: Brief) => b.content.features?.[0]?.title;
const firstStat = (b: Brief) => (b.content.stats?.[0] ? `${b.content.stats[0].prefix ?? ''}${b.content.stats[0].value}${b.content.stats[0].suffix ?? ''} ${b.content.stats[0].label}` : undefined);

export const STRATEGIES: Record<Strategy, StrategyDef> = {
  'problem-first': {
    id: 'problem-first',
    title: 'Problem first',
    needs: (b) => (b.content.problem || b.content.problemPoints?.length ? null : 'no problem statement in the brief'),
    arc: () => ['hook', 'problem', 'bridge', 'solution', 'feature', 'proof', 'cta'],
    hook: (b) => b.content.problem ?? b.content.problemPoints![0],
    pace: undefined,
    why: 'opens on the pain the audience recognises, then resolves it',
  },
  'product-first': {
    id: 'product-first',
    title: 'Product first',
    needs: (b) => (b.content.product || b.content.products?.length || b.assets.some((a) => a.kind === 'product') ? null : 'no product in the brief'),
    arc: () => ['product', 'feature', 'detail', 'offer', 'proof', 'cta'],
    hook: (b) => b.content.product?.name ?? b.content.hook,
    pace: undefined,
    why: 'the product is on screen in the first second',
  },
  'benefit-first': {
    id: 'benefit-first',
    title: 'Benefit first',
    needs: (b) => (b.content.features?.length || b.content.solution ? null : 'no benefit / feature copy in the brief'),
    arc: () => ['hook', 'feature', 'product', 'demo', 'proof', 'cta'],
    hook: (b) => b.content.solution ?? firstFeature(b)!,
    pace: undefined,
    why: 'leads with what the viewer gets',
  },
  'offer-first': {
    id: 'offer-first',
    title: 'Offer first',
    needs: (b) => (b.content.offer || b.content.product?.price ? null : 'no offer or price in the brief'),
    arc: () => ['offer', 'product', 'feature', 'social', 'cta'],
    hook: (b) => b.content.offer ?? b.content.hook,
    pace: 'fast',
    why: 'the deal is the hook; the CTA arrives early and holds longer',
  },
  'result-first': {
    id: 'result-first',
    title: 'Result first',
    needs: (b) => (b.content.stats?.length || b.content.series || b.content.testimonials?.length ? null : 'no sourced result (stat / series / testimonial) in the brief'),
    arc: (b) => (b.content.stats?.length || b.content.series ? ['proof', 'data', 'solution', 'feature', 'cta'] : ['social', 'solution', 'feature', 'cta']),
    hook: (b) => firstStat(b) ?? b.content.testimonials?.[0]?.quote ?? b.content.hook,
    pace: undefined,
    why: 'opens on the proven outcome (sourced), then explains how',
  },
};

export interface VariantJob {
  id: string;
  strategy: Strategy;
  aspect: Aspect;
  brief: Brief;
  why: string;
}
export interface VariantPlan {
  jobs: VariantJob[];
  unsupported: { strategy: Strategy; reason: string }[];
}

/** One brief per (strategy × aspect). Same brand, product, claims and assets in every job. */
export function planVariants(brief: Brief, baseId: string): VariantPlan {
  const req = brief.variants;
  if (!req) return { jobs: [], unsupported: [] };
  const aspects: Aspect[] = (req.aspects?.length ? req.aspects : [brief.aspect ?? '9:16']) as Aspect[];
  const jobs: VariantJob[] = [];
  const unsupported: VariantPlan['unsupported'] = [];
  for (const sid of [...new Set(req.strategies)]) {
    const s = STRATEGIES[sid];
    const why = s.needs(brief);
    if (why) {
      unsupported.push({ strategy: sid, reason: why });
      continue;
    }
    for (const aspect of aspects) {
      const b: Brief = JSON.parse(JSON.stringify(brief));
      b.variants = undefined;
      b.aspect = aspect;
      b.title = `${brief.title ?? baseId}-${sid}-${aspect.replace(':', 'x')}`;
      b.content.hook = s.hook(brief).slice(0, 160);
      if (s.pace) b.pace = s.pace;
      b.preferences = { ...b.preferences, arc: s.arc(brief), variantOf: { strategy: sid, base: baseId }, seed: `${brief.preferences.seed ?? baseId}:${sid}` };
      jobs.push({ id: `${baseId}-${sid}-${aspect.replace(':', 'x')}`, strategy: sid, aspect, brief: b, why: s.why });
    }
  }
  return { jobs, unsupported };
}
