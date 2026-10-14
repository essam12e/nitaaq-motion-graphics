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
import { sceneLotties, sceneVideos } from '../engine/seek';
import { vectorPrograms } from '../vector/scene-program';
import type { VectorGraph } from '../vector/graph';
import { microFxCost } from '../fx/plan';

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
  let video = 0;
  let lottie = 0;
  let vector = 0;
  for (const s of spec.scenes) {
    // simultaneous video decodes: 0.25 per clip on screen (×2 for sources above 1080p), duration-weighted
    for (const v of sceneVideos(spec, s.content, 0)) {
      const a = spec.assets[v.asset];
      video += ((Math.max(a?.width ?? 0, a?.height ?? 0) > 1920 ? 0.5 : 0.25) * s.duration) / total;
    }
    // Lottie players redraw their SVG every frame: 0.1 per animation + its measured complexity (capped), duration-weighted
    for (const l of sceneLotties(spec, s.content, 0, s.type)) {
      const c = spec.assets[l.asset]?.lottie?.complexity ?? 0;
      lottie += (Math.min(0.6, 0.1 + c / 800) * s.duration) / total;
    }
    // vector scenes rebuild their paths every frame while a program runs (trims, morph interpolation): 0.1 + complexity
    // (both documents for a morph), capped, duration-weighted; graphs count their nodes; a still costs nothing extra
    if (s.type === 'vector-draw') {
      const c = s.content as { svg?: string; morphTo?: string; graph?: VectorGraph };
      const cx = (ref?: string) => (ref ? (spec.assets[ref] ?? Object.values(spec.assets).find((a) => a.src === ref))?.vector?.complexity ?? 200 : 0);
      const progs = vectorPrograms(s.variant, c, s.duration);
      const live = c.graph && (s.variant === 'graph' || !c.svg) ? c.graph.nodes.length * 15 : progs.some((x) => x.mode !== 'static') ? cx(c.svg) + (progs.some((x) => x.mode === 'morph') ? cx(c.morphTo) : 0) : 0;
      if (live) vector += (Math.min(0.6, 0.1 + live / 1500) * s.duration) / total;
    }
    const m = SceneRegistry.get(s.type)?.manifest;
    const w = m ? WEIGHT[costOf(m)] : 2;
    scenes += (w * s.duration) / total;
    if (s.motion?.camera && s.motion.camera !== 'none') camera += (0.35 * s.duration) / total;
  }
  contributors.push({ source: 'scenes (duration-weighted family cost)', add: round(scenes) });
  if (camera) contributors.push({ source: 'camera moves', add: round(camera) });
  if (video) contributors.push({ source: 'video clips (simultaneous decodes)', add: round(video) });
  if (lottie) contributors.push({ source: 'Lottie animations (vector redraw)', add: round(lottie) });
  if (vector) contributors.push({ source: 'vector art (path rebuild per frame)', add: round(vector) });
  const fx = microFxCost(spec);
  if (fx) contributors.push({ source: 'micro FX accents', add: round(fx) });
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
