/**
 * Text motion direction: which family animates which text role in each scene.
 *
 *  - hierarchy: headline ≠ support ≠ CTA; headline energy ≥ support energy
 *  - personality: premium reveals with masks and tracking, sport punches,
 *    playful bounces, corporate wipes lines — never a random mix
 *  - variety: a headline family is never used in two consecutive scenes and at
 *    most ⌈n/3⌉ times per film; "everything slides up" is rationed
 *  - Arabic: character-level families are filtered out for Arabic copy (they
 *    would degrade to word groups anyway); tracking becomes word-spacing
 *  - the hook gets the most energetic option the personality allows; the CTA
 *    resolves with a family different from the hook
 *
 * Pure and deterministic (seeded).
 */
import type { MotionPersonalityId } from '../motion/personality';
import { createRng } from '../core/rng';
import { TextMotionRegistry, type RoleGroup, type TextMotionFamily } from './families';

export const HEADLINE_FAMILIES: Record<MotionPersonalityId, string[]> = {
  premium: ['mask-reveal', 'cinematic-title', 'blur-reveal', 'editorial-title', 'tracking-reveal', 'wipe-reveal', 'split-reveal'],
  cinematic: ['cinematic-title', 'blur-reveal', 'mask-reveal', 'tracking-reveal', 'perspective-reveal', 'split-reveal'],
  corporate: ['wipe-reveal', 'line-reveal', 'mask-reveal', 'editorial-title', 'horizontal-reveal', 'underline-draw'],
  tech: ['mask-reveal', 'wipe-reveal', 'horizontal-reveal', 'split-reveal', 'char-stagger', 'word-stagger', 'background-highlight'],
  energetic: ['typography-punch', 'scale-impact', 'slide-reveal', 'kinetic-sequence', 'compress-expand', 'word-stagger', 'background-highlight'],
  sport: ['typography-punch', 'scale-impact', 'slide-reveal', 'compress-expand', 'kinetic-sequence', 'rotation-reveal'],
  playful: ['controlled-bounce', 'follow-through', 'scale-impact', 'rotation-reveal', 'word-stagger', 'marker-highlight'],
};

const SUPPORT_FAMILIES: Record<MotionPersonalityId, string[]> = {
  premium: ['line-reveal', 'blur-reveal', 'editorial-title'],
  cinematic: ['blur-reveal', 'line-reveal'],
  corporate: ['line-reveal', 'wipe-reveal', 'vertical-reveal'],
  tech: ['line-reveal', 'wipe-reveal', 'vertical-reveal', 'horizontal-reveal'],
  energetic: ['slide-reveal', 'word-stagger', 'line-reveal'],
  sport: ['slide-reveal', 'line-reveal', 'horizontal-reveal'],
  playful: ['word-stagger', 'follow-through', 'line-reveal'],
};

const CTA_FAMILIES: Record<MotionPersonalityId, string[]> = {
  premium: ['mask-reveal', 'tracking-reveal', 'blur-reveal'],
  cinematic: ['blur-reveal', 'cinematic-title', 'mask-reveal'],
  corporate: ['wipe-reveal', 'mask-reveal', 'background-highlight'],
  tech: ['background-highlight', 'mask-reveal', 'horizontal-reveal'],
  energetic: ['typography-punch', 'scale-impact', 'background-highlight'],
  sport: ['typography-punch', 'compress-expand', 'scale-impact'],
  playful: ['controlled-bounce', 'scale-impact', 'rotation-reveal'],
};

const LABEL_FAMILIES = ['vertical-reveal', 'line-reveal', 'wipe-reveal', 'tracking-reveal'];

export interface TextMotionScene {
  id: string;
  beat: string;
  arabic: boolean;
  hasHighlight: boolean;
}

export interface TextMotionPlan {
  scenes: { id: string; text: Partial<Record<RoleGroup, string>>; why: string }[];
  usage: Record<string, number>;
}

const fam = (id: string): TextMotionFamily | undefined => TextMotionRegistry.get(id);

export function planTextMotion(scenes: TextMotionScene[], personality: MotionPersonalityId, seed: string | number): TextMotionPlan {
  const rng = createRng(`${seed}:text-motion`).next;
  const n = scenes.length;
  const cap = Math.max(1, Math.ceil(n / 3));
  const usage: Record<string, number> = {};
  const recent: string[] = [];
  let ups = 0;
  const out: TextMotionPlan['scenes'] = [];
  const allowed = (id: string, s: TextMotionScene) => {
    const f = fam(id);
    if (!f) return false;
    if (s.arabic && f.unit === 'char') return false; // would only degrade: pick a real word-group family instead
    if (f.highlight && f.highlight !== 'pulse' && !s.hasHighlight) return false; // highlight families need emphasised words
    return true;
  };
  scenes.forEach((s, i) => {
    const isHook = i === 0;
    const isCta = s.beat === 'cta' || i === n - 1;
    let pool = (isCta ? CTA_FAMILIES : HEADLINE_FAMILIES)[personality].filter((id) => allowed(id, s));
    if (!pool.length) pool = HEADLINE_FAMILIES[personality].filter((id) => allowed(id, s));
    // variety: not used in the previous two scenes, under the per-film cap, and "up" moves rationed to ⅓ of scenes
    let fresh = pool.filter((id) => !recent.slice(-2).includes(id) && (usage[id] ?? 0) < cap);
    if (ups >= Math.ceil(n / 3)) fresh = fresh.filter((id) => fam(id)!.direction !== 'up');
    if (!fresh.length) fresh = pool.filter((id) => id !== recent[recent.length - 1]);
    if (!fresh.length) fresh = pool;
    let headline: string;
    if (isHook) headline = [...fresh].sort((a, b) => fam(b)!.energy - fam(a)!.energy)[0];
    else if (isCta) headline = fresh.find((id) => id !== out[0]?.text.headline) ?? fresh[0];
    else headline = fresh[Math.floor(rng() * fresh.length)];
    const hE = fam(headline)!.energy;
    // support: calmer than the headline, a different family, a different direction when possible
    const sPool = SUPPORT_FAMILIES[personality].filter((id) => id !== headline && allowed(id, s) && fam(id)!.energy <= hE + 0.05);
    const sDiff = sPool.filter((id) => fam(id)!.direction !== fam(headline)!.direction);
    const support = (sDiff.length ? sDiff : sPool.length ? sPool : ['line-reveal'])[Math.floor(rng() * (sDiff.length || sPool.length || 1))];
    const ctaPool = CTA_FAMILIES[personality].filter((id) => id !== headline && allowed(id, s));
    const cta = isCta ? headline : ctaPool[0] ?? 'mask-reveal';
    const labelPool = LABEL_FAMILIES.filter((id) => id !== headline && id !== support);
    const label = labelPool[Math.floor(rng() * labelPool.length)];
    usage[headline] = (usage[headline] ?? 0) + 1;
    if (fam(headline)!.direction === 'up') ups++;
    recent.push(headline);
    out.push({
      id: s.id,
      text: { headline, support, cta, number: 'number-count', label },
      why: `${isHook ? 'hook — strongest entrance the personality allows' : isCta ? 'CTA resolves with its own family' : `${s.beat} beat`}; ${headline} (${fam(headline)!.unit}${s.arabic ? ', Arabic word groups' : ''}) over ${support}`,
    });
  });
  return { scenes: out, usage };
}
