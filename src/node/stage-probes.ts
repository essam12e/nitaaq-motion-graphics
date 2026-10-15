/**
 * Collects DOM Motion Probes for a Stage film (P1-J): renders the qc composition at a dense set of
 * frames (every 0.2 s + around every emphasis and camera move) and writes dom_motion.json.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import { collectProbes } from '../qc/probes';
import { analyzeStageProbes, parseCam, stageProbeTimes, type DomMotionReport, type StageProbeSample } from '../qc/stage-probes';
import { buildTimeline } from '../core/timeline';

export async function runStageProbes(spec: VideoSpec, projectDir: string, opts: { out?: string; step?: number } = {}): Promise<{ report: DomMotionReport; samples: StageProbeSample[] } | null> {
  const plan = spec.stage as unknown as StagePlan | undefined;
  if (!plan) return null;
  const fps = spec.canvas.fps;
  const tl = buildTimeline(spec.scenes, fps);
  const times = stageProbeTimes(plan, tl.totalFrames / fps, opts.step ?? 0.2);
  const frames = [...new Set(times.map((t) => Math.min(tl.totalFrames - 1, Math.round(t * fps))))];
  const dir = join(projectDir, 'qc', 'stage-probes');
  mkdirSync(dir, { recursive: true });
  const run = await collectProbes(spec, projectDir, frames, dir);
  const samples: StageProbeSample[] = [];
  for (const f of frames) {
    const p = run.probes.get(f);
    if (!p?.stage) continue;
    samples.push({ t: f / fps, cam: parseCam(p.stage.cam), els: p.stage.els, words: p.stage.words, mask: p.stage.mask });
  }
  const report = analyzeStageProbes(plan, samples, { W: spec.canvas.width, H: spec.canvas.height });
  writeFileSync(opts.out ?? join(projectDir, 'dom_motion.json'), JSON.stringify(report, null, 2));
  return { report, samples };
}
