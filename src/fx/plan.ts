/**
 * Micro FX auto planner: the film's motion moments (the same events the Sound Director hears) become
 * accents chosen by moment, element intent and motion personality, then rationed by the FX budget.
 * Pure: (spec, events) → spec with `auto` accents replaced. Scenes' own (hand-placed) `fx` are kept and
 * count toward the budget first.
 */
import type { VideoSpec } from '../schema/video';
import type { MotionEvent } from '../audio/events';
import type { MotionIntent } from '../motion/intent';
import type { MotionPersonalityId } from '../motion/personality';
import { buildTimeline } from '../core/timeline';
import { budgetFx, FX_DEFS, fxForMoment, type FxBudgetLevel, type MicroFxKind, type MicroFxSpec } from './micro';

type Scene = VideoSpec['scenes'][number];

/** Which intent a moment's element carries in its scene (the Motion Intent plan), when the Director wrote one. */
function intentOf(scene: Scene, ev: MotionEvent): MotionIntent | undefined {
  const intents = scene.motion?.intents ?? [];
  const role = ev.type === 'cta_reveal' ? 'cta' : ev.type === 'logo_reveal' ? 'logo' : ev.type.startsWith('product') ? 'hero-product' : ev.type === 'headline_reveal' || ev.type === 'word_impact' ? 'headline' : undefined;
  return (intents.find((i) => i.role === role)?.intent as MotionIntent | undefined) ?? undefined;
}

/** Moments that sit on the frame centre when the scene gave no position (reveals of the whole frame). */
const CENTRED = new Set(['hero_reveal', 'logo_reveal', 'cta_reveal']);

export function planMicroFx(spec: VideoSpec, events: MotionEvent[]): { spec: VideoSpec; kept: number; dropped: { scene: string; kind: MicroFxKind; why: string }[]; cost: number } {
  const personality = (spec.motion?.personality ?? 'premium') as MotionPersonalityId;
  const level = (spec.design.fxBudget ?? spec.design.effectBudget ?? 'MEDIUM') as FxBudgetLevel;
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const filmSec = tl.entries.length ? tl.entries[tl.entries.length - 1].endSec : 0;
  type Abs = MicroFxSpec & { start: number; sceneIndex: number };
  const list: Abs[] = [];
  spec.scenes.forEach((s, i) => {
    for (const f of s.fx ?? []) if (!f.auto) list.push({ ...f, start: tl.entries[i].startSec + f.at, sceneIndex: i, importance: f.importance ?? 0.9 });
  });
  if (spec.design.microFx === 'auto') {
    for (const ev of events) {
      if (ev.type === 'scene_transition' || ev.importance < 0.45) continue;
      const scene = spec.scenes[ev.sceneIndex];
      if (!scene) continue;
      const kind = fxForMoment(ev.type, personality, intentOf(scene, ev));
      if (!kind) continue;
      const pos = ev.pos ?? (CENTRED.has(ev.type) ? { x: 0.5, y: 0.45 } : undefined);
      if (!pos) continue;
      const at = Math.max(0, Math.round((ev.syncSec - tl.entries[ev.sceneIndex].startSec) * 1000) / 1000);
      const direction = ev.direction === 'left' ? 180 : ev.direction === 'up' ? 270 : ev.direction === 'down' ? 90 : 0;
      list.push({ kind, at, x: pos.x, y: pos.y, start: ev.syncSec, sceneIndex: ev.sceneIndex, importance: ev.importance, auto: true, seed: `${scene.id}:${ev.type}:${at}`, ...(kind === 'trails' || kind === 'directional-streaks' ? { direction } : {}), reason: `${ev.type} (${personality})` });
    }
  }
  const b = budgetFx(list, filmSec, level);
  const out: VideoSpec = { ...spec, scenes: spec.scenes.map((s) => ({ ...s, fx: (s.fx ?? []).filter((f) => !f.auto) })) };
  for (const f of b.kept) {
    if (!f.auto) continue;
    const { start: _s, sceneIndex, ...fx } = f;
    out.scenes[sceneIndex].fx!.push(fx);
  }
  out.scenes.forEach((s) => {
    if (s.fx && !s.fx.length && !spec.scenes.find((x) => x.id === s.id)?.fx) delete (s as Partial<Scene>).fx;
  });
  return { spec: out, kept: b.kept.length, dropped: b.dropped.map((d) => ({ scene: spec.scenes[d.fx.sceneIndex].id, kind: d.fx.kind, why: d.why })), cost: b.cost };
}

/** Duration-weighted micro-FX render cost of a spec (its scenes' `fx`). */
export function microFxCost(spec: VideoSpec): number {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0) || 1;
  let c = 0;
  for (const s of spec.scenes) for (const f of s.fx ?? []) c += FX_DEFS[f.kind].cost * (f.duration ?? FX_DEFS[f.kind].duration);
  return Math.round((c / total) * 1000) / 1000;
}
