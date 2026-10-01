/**
 * Effect cost budget. Every scene family declares a render cost (LOW/MEDIUM/HIGH)
 * and every style declares the expensive effects it uses (backdrop blur, glow,
 * grain). The estimate is duration-weighted, so a 2 s HIGH scene costs less than
 * a 10 s one. The Director sets the budget from the task class; validation warns
 * when a film goes over it, and performance_report.json records both.
 */
import type { VideoSpec } from '../schema/video';
import { SceneRegistry } from '../scenes';
import { costOf, type PerformanceCost } from '../scenes/registry';
import { STYLE_PRESETS, findStyleId } from '../styles/presets';

const WEIGHT: Record<PerformanceCost, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
/** Upper bound of the per-second score for each budget level. */
export const BUDGET_LIMIT: Record<PerformanceCost, number> = { LOW: 1.6, MEDIUM: 2.5, HIGH: 3.6 };

export interface EffectCost {
  score: number;
  level: PerformanceCost;
  budget: PerformanceCost | null;
  overBudget: boolean;
  contributors: { source: string; add: number }[];
}

export function levelOf(score: number): PerformanceCost {
  return score <= BUDGET_LIMIT.LOW ? 'LOW' : score <= BUDGET_LIMIT.MEDIUM ? 'MEDIUM' : 'HIGH';
}

export function estimateEffectCost(spec: VideoSpec): EffectCost {
  const contributors: EffectCost['contributors'] = [];
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0) || 1;
  let scenes = 0;
  let camera = 0;
  for (const s of spec.scenes) {
    const m = SceneRegistry.get(s.type)?.manifest;
    const w = m ? WEIGHT[costOf(m)] : 2;
    scenes += (w * s.duration) / total;
    if (s.motion?.camera && s.motion.camera !== 'none') camera += (0.35 * s.duration) / total;
  }
  contributors.push({ source: 'scenes (duration-weighted family cost)', add: round(scenes) });
  if (camera) contributors.push({ source: 'camera moves', add: round(camera) });
  const t = STYLE_PRESETS[findStyleId(spec.style.preset) ?? ''];
  if (t) {
    if (t.surface.blur > 0) contributors.push({ source: `style ${t.id}: backdrop blur`, add: 0.6 });
    if (t.glow > 0.3) contributors.push({ source: `style ${t.id}: glow`, add: round(t.glow * 0.5) });
    if (t.texture.grain > 0) contributors.push({ source: `style ${t.id}: grain`, add: round(t.texture.grain * 2) });
  }
  const score = round(contributors.reduce((a, c) => a + c.add, 0));
  const level = levelOf(score);
  const budget = spec.design.effectBudget ?? null;
  return { score, level, budget, overBudget: budget ? score > BUDGET_LIMIT[budget] : false, contributors };
}

const round = (x: number) => Math.round(x * 100) / 100;
