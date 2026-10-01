/**
 * Logo Animation Engine — choose a reveal that fits the logo's STRUCTURE and
 * the brand's motion personality. Pure and deterministic.
 *
 * The logo is the user's own pixels and is never distorted, recoloured,
 * redrawn or regenerated: every reveal animates masks, crops of the same
 * image, light and space AROUND it, and ends on the untouched logo at its true
 * aspect ratio. A raster logo has no vector paths, so "stroke" is a frame
 * trace around its silhouette box (documented honestly), not a path draw.
 */
import { CapabilityRegistry } from '../core/registry';
import type { MotionPersonalityId } from '../motion/personality';
import { createRng } from '../core/rng';

export interface RectF {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LogoPart {
  role: 'symbol' | 'wordmark';
  rect: RectF;
}
export interface LogoStructure {
  width: number;
  height: number;
  aspect: number;
  /** Ink bounding box as fractions of the image. */
  contentBox: RectF;
  hasAlpha: boolean;
  vector: boolean;
  layout: 'icon' | 'wordmark' | 'icon+wordmark-horizontal' | 'icon+wordmark-vertical' | 'emblem';
  /** Symbol / wordmark pieces when the logo separates cleanly (fractions of the image). */
  parts: LogoPart[];
  symmetry: { horizontal: number; vertical: number };
  dominantDirection: 'horizontal' | 'vertical' | 'radial';
  colorCount: number;
  /** 0..1 empty share inside the ink box. */
  negativeSpace: number;
}

export interface LogoRevealDef {
  id: string;
  title: string;
  /** What the viewer sees. */
  describe: string;
  energy: number;
  personalities: MotionPersonalityId[];
  /** Structural requirements. */
  needs?: (s: LogoStructure) => boolean;
  /** Structural bonus (0..1) — how well the reveal expresses this logo. */
  fit?: (s: LogoStructure) => number;
  minDuration: number;
}

export const LogoRevealRegistry = new CapabilityRegistry<LogoRevealDef>('logo-reveal');

const twoParts = (s: LogoStructure) => s.parts.length === 2;
const REVEALS: LogoRevealDef[] = [
  { id: 'mask', title: 'Mask reveal', describe: 'a clean mask wipes along the logo direction', energy: 0.4, personalities: ['corporate', 'tech', 'premium', 'cinematic'], fit: (s) => (s.dominantDirection === 'horizontal' ? 0.5 : 0.2), minDuration: 1.4 },
  { id: 'stroke', title: 'Frame trace', describe: 'a line traces the silhouette box, then the logo fills in (raster logos have no paths)', energy: 0.35, personalities: ['tech', 'corporate', 'premium'], fit: (s) => (s.negativeSpace > 0.45 ? 0.4 : 0.15), minDuration: 2 },
  { id: 'shape-assembly', title: 'Shape assembly', describe: 'tiles cut from the same logo image fly into place and lock together', energy: 0.75, personalities: ['energetic', 'playful', 'tech', 'sport'], fit: (s) => (s.layout === 'icon' || s.layout === 'emblem' ? 0.5 : 0.25), minDuration: 2.2 },
  { id: 'scale', title: 'Scale with follow-through', describe: 'the logo lands with weight and a tiny settle', energy: 0.55, personalities: ['energetic', 'playful', 'sport', 'tech'], fit: () => 0.3, minDuration: 1.2 },
  { id: 'spotlight', title: 'Spotlight', describe: 'a soft light finds the logo in the dark', energy: 0.3, personalities: ['cinematic', 'premium'], fit: (s) => (s.layout === 'icon' || s.layout === 'emblem' ? 0.4 : 0.25), minDuration: 2.2 },
  { id: 'light-sweep', title: 'Light sweep', describe: 'a band of light travels across the logo, masked by its own alpha', energy: 0.45, personalities: ['premium', 'cinematic', 'corporate'], needs: (s) => s.hasAlpha, fit: (s) => (s.dominantDirection === 'horizontal' ? 0.5 : 0.3), minDuration: 1.8 },
  { id: 'split-assembly', title: 'Split assembly', describe: 'the two halves of a symmetric mark slide together', energy: 0.6, personalities: ['tech', 'energetic', 'sport', 'cinematic'], needs: (s) => s.symmetry.horizontal >= 0.6 || s.symmetry.vertical >= 0.6, fit: (s) => Math.max(s.symmetry.horizontal, s.symmetry.vertical) * 0.8, minDuration: 1.6 },
  { id: 'typography-reveal', title: 'Wordmark reveal', describe: 'a wordmark is revealed in reading direction, letter-block by letter-block of the same image', energy: 0.45, personalities: ['corporate', 'premium', 'tech', 'cinematic'], needs: (s) => s.layout === 'wordmark', fit: () => 0.7, minDuration: 1.6 },
  { id: 'icon-wordmark', title: 'Icon then wordmark', describe: 'the symbol arrives first, the wordmark unmasks beside it', energy: 0.5, personalities: ['corporate', 'tech', 'premium', 'energetic', 'playful', 'cinematic', 'sport'], needs: twoParts, fit: () => 0.85, minDuration: 2 },
  { id: 'depth', title: 'Depth', describe: 'the logo emerges from depth with blur-to-focus', energy: 0.4, personalities: ['cinematic', 'premium', 'tech'], fit: () => 0.25, minDuration: 1.8 },
  { id: 'minimal-premium', title: 'Minimal premium', describe: 'a slow fade with tracking-free breath and a hairline underline', energy: 0.2, personalities: ['premium', 'corporate', 'cinematic'], fit: (s) => (s.colorCount <= 3 ? 0.4 : 0.2), minDuration: 2 },
  { id: 'energetic', title: 'Energetic punch', describe: 'a hard punch-in with a colour flash and burst lines around it', energy: 0.9, personalities: ['energetic', 'sport', 'playful'], fit: () => 0.3, minDuration: 1.2 },
];
for (const r of REVEALS) if (!LogoRevealRegistry.has(r.id)) LogoRevealRegistry.register(r);
export const LOGO_REVEAL_IDS = REVEALS.map((r) => r.id);

export interface LogoRevealChoice {
  reveal: string;
  reason: string;
  scores: { id: string; score: number }[];
}

/**
 * Pick the reveal: structure fit + personality + duration, minus a penalty for
 * reveals this brand used recently (brand-motion history), so the brand's
 * films stay consistent but never identical.
 */
export function chooseLogoReveal(input: { structure?: LogoStructure; personality: MotionPersonalityId; durationSec: number; history?: string[]; explicit?: string; seed: string | number }): LogoRevealChoice {
  if (input.explicit && LogoRevealRegistry.has(input.explicit)) {
    const ok = !input.structure || !LogoRevealRegistry.require(input.explicit).needs || LogoRevealRegistry.require(input.explicit).needs!(input.structure);
    if (ok) return { reveal: input.explicit, reason: 'requested by the user', scores: [] };
  }
  const s = input.structure;
  const rng = createRng(`${input.seed}:logo-reveal`).next;
  const hist = input.history ?? [];
  const scores = LogoRevealRegistry.list()
    .filter((r) => !s || !r.needs || r.needs(s))
    .filter((r) => r.minDuration <= input.durationSec + 0.01)
    .map((r) => {
      let score = r.personalities.includes(input.personality) ? 1 : 0.2;
      score += s && r.fit ? r.fit(s) : 0.2;
      const last = hist.lastIndexOf(r.id);
      if (last >= 0) score -= last === hist.length - 1 ? 0.9 : 0.4; // the previous film's reveal is strongly avoided
      score += rng() * 0.05; // tie-break only
      return { id: r.id, score: Math.round(score * 1000) / 1000 };
    })
    .sort((a, b) => b.score - a.score);
  const best = scores[0]?.id ?? 'mask';
  const d = LogoRevealRegistry.require(best);
  const why = [`${input.personality} personality`];
  if (s) why.push(`${s.layout} logo${s.parts.length === 2 ? ' with separable symbol + wordmark' : ''}${Math.max(s.symmetry.horizontal, s.symmetry.vertical) >= 0.6 ? ', symmetric' : ''}`);
  if (hist.length) why.push(`avoids recent reveals (${hist.slice(-3).join(', ')})`);
  return { reveal: best, reason: `${d.title}: ${d.describe} — ${why.join('; ')}`, scores };
}
