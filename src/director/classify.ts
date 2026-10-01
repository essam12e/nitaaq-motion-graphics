/**
 * Task classifier: decides how much machinery a request deserves, so a simple
 * 15-second typography ad never pays for reference analysis, beat tracking or
 * a three-format recompose. Pure and deterministic.
 *
 *   SIMPLE     short, ≤2 content blocks, no voice/reference/extra formats
 *   STANDARD   the normal ad/explainer
 *   ADVANCED   several heavy signals (reference, voice, beat sync, multi-format, UI state flow…)
 *   LONG_FORM  > 75 s or chapters — chaptered, shared ANIMATION_GUIDE.md
 */
import type { Brief } from '../schema/brief';

export type TaskClass = 'SIMPLE' | 'STANDARD' | 'ADVANCED' | 'LONG_FORM';
export type EffectBudget = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Classification {
  class: TaskClass;
  reasons: string[];
  blocks: number;
  signals: string[];
  budget: {
    /** Probe frames per scene in structural QC. */
    qcPerScene: 2 | 3;
    /** Normal repair passes (a 3rd only while critical issues remain). */
    repairPasses: number;
    referenceEngine: boolean;
    beatEngine: boolean;
    /** Render an animatic before the final render. */
    animatic: boolean;
    effects: EffectBudget;
  };
}

export function contentBlocks(brief: Brief): number {
  const c = brief.content;
  return [c.problem || c.problemPoints?.length, c.solution, c.features?.length, c.steps?.length, c.stats?.length, c.series, c.comparison, c.testimonials?.length, c.product, c.products?.length, c.categories?.length, c.offer, c.ui, c.messages?.length].filter(Boolean).length;
}

export function classifyBrief(brief: Brief): Classification {
  const duration = brief.duration ?? 20;
  const blocks = contentBlocks(brief);
  const signals: string[] = [];
  if (brief.reference) signals.push(`reference (${brief.reference.kind ?? 'auto'})`);
  if (brief.audio.mode !== 'none') signals.push(`voice (${brief.audio.mode})`);
  if (brief.audio.music && brief.audio.beatSync !== false) signals.push('music beat sync');
  if ((brief.formats?.length ?? 0) > 1) signals.push(`${brief.formats!.length} formats`);
  if ((brief.content.ui?.screens?.length ?? 0) >= 2) signals.push('UI state flow');
  if ((brief.content.products?.length ?? 0) >= 3) signals.push('product catalogue');
  if (brief.content.ui?.url && brief.capture) signals.push('website capture');
  if (brief.loop) signals.push('seamless loop');

  const reasons: string[] = [];
  let cls: TaskClass;
  if (duration > 75 || (brief.chapters?.length ?? 0) > 1) {
    cls = 'LONG_FORM';
    reasons.push(duration > 75 ? `${duration}s is long-form` : `${brief.chapters!.length} chapters`);
  } else if (signals.length >= 2 || blocks >= 6) {
    cls = 'ADVANCED';
    reasons.push(signals.length >= 2 ? `heavy signals: ${signals.join(', ')}` : `${blocks} content blocks`);
  } else if (duration <= 20 && blocks <= 2 && !signals.length && brief.assets.length <= 1) {
    cls = 'SIMPLE';
    reasons.push(`${duration}s, ${blocks} content block(s), no voice/reference/extra formats`);
  } else {
    cls = 'STANDARD';
    reasons.push(`${duration}s, ${blocks} content block(s)${signals.length ? `, ${signals.join(', ')}` : ''}`);
  }
  const heavyStyle = /cinematic|luxury|ai-futuristic|neon|glass/i.test(brief.style ?? '');
  return {
    class: cls,
    reasons,
    blocks,
    signals,
    budget: {
      qcPerScene: cls === 'SIMPLE' || cls === 'LONG_FORM' ? 2 : 3,
      repairPasses: 2,
      referenceEngine: Boolean(brief.reference),
      beatEngine: Boolean(brief.audio.music) && brief.audio.beatSync !== false,
      animatic: cls === 'ADVANCED' || cls === 'LONG_FORM',
      effects: cls === 'SIMPLE' ? (heavyStyle ? 'MEDIUM' : 'LOW') : cls === 'LONG_FORM' ? 'MEDIUM' : 'HIGH',
    },
  };
}
