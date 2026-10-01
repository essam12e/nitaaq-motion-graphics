/**
 * Shared-element continuity, measured: for every planned shared element (same
 * logo / product / screenshot in two consecutive scenes) the DOM probe measures
 * where the asset really sits in the outgoing scene when the transition starts
 * and in the incoming scene when it ends. The film-level SharedLayer then glides
 * the one asset between those rects (uniform scale, object-fit contain) while
 * both scenes hide their own copy — no destroy-and-recreate.
 *
 * Unmeasurable pairs (asset not on screen at one end) keep the scene's normal
 * transition; nothing is guessed. Probes are cached per frame like QC probes.
 */
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { collectProbes } from '../qc/probes';

export interface SharedResolution {
  measured: number;
  skipped: { id: string; why: string }[];
  changed: boolean;
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export async function resolveSharedRects(spec: VideoSpec, projectDir: string): Promise<SharedResolution> {
  const shared = spec.timeline?.shared ?? [];
  const out: SharedResolution = { measured: 0, skipped: [], changed: false };
  if (!shared.length) return out;
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const jobs = shared.map((sh) => {
    const to = tl.entries.find((e) => e.id === sh.toScene);
    return { sh, to, start: to ? to.from : -1, end: to ? to.from + Math.max(1, to.transitionIn) - 1 : -1 };
  });
  const frames = [...new Set(jobs.filter((j) => j.to && j.to.transitionIn > 0).flatMap((j) => [j.start, j.end]))];
  if (!frames.length) {
    for (const sh of shared) out.skipped.push({ id: sh.id, why: 'no transition window (hard cut)' });
    return out;
  }
  // measure on the spec WITHOUT rects so both scenes still draw their own copy
  const probeSpec: VideoSpec = { ...spec, timeline: { ...spec.timeline, shared: shared.map(({ fromRect: _a, toRect: _b, ...s }) => s) } };
  const run = await collectProbes(probeSpec, projectDir, frames, join(projectDir, 'qc', 'shared'));
  const W = spec.canvas.width;
  const H = spec.canvas.height;
  for (const j of jobs) {
    if (!j.to || j.to.transitionIn <= 0) {
      out.skipped.push({ id: j.sh.id, why: 'no transition window (hard cut)' });
      continue;
    }
    const src = spec.assets[j.sh.asset]?.src;
    const find = (frame: number, scene: string) => run.probes.get(frame)?.media.find((m) => m.scene === scene && (m.src === j.sh.asset || (src && m.src === src)) && m.rect.width > 2 && m.rect.height > 2);
    const a = find(j.start, j.sh.fromScene);
    const b = find(j.end, j.sh.toScene);
    if (!a || !b) {
      out.skipped.push({ id: j.sh.id, why: `${j.sh.asset} not visible in ${!a ? j.sh.fromScene : j.sh.toScene} at the transition edge` });
      if (j.sh.fromRect || j.sh.toRect) out.changed = true;
      delete j.sh.fromRect;
      delete j.sh.toRect;
      continue;
    }
    const fr = { x: round(a.rect.x / W), y: round(a.rect.y / H), w: round(a.rect.width / W), h: round(a.rect.height / H) };
    const tr = { x: round(b.rect.x / W), y: round(b.rect.y / H), w: round(b.rect.width / W), h: round(b.rect.height / H) };
    if (JSON.stringify(fr) !== JSON.stringify(j.sh.fromRect) || JSON.stringify(tr) !== JSON.stringify(j.sh.toRect)) out.changed = true;
    j.sh.fromRect = fr;
    j.sh.toRect = tr;
    out.measured++;
  }
  return out;
}
