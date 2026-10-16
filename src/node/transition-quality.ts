/**
 * Renders the frames through every Stage transition (P2-G), measures their content occupancy and
 * luminance, judges each cut (src/qc/transition-quality.ts) and writes:
 *   transition_quality.json   — curves, dips, issues, a 0..9 score per transition
 *   qc/transitions/<from>-<to>.png — a strip: before · through · after (for the eye)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import type { StageProbeSample } from '../qc/stage-probes';
import { judgeTransition, pixelOccupancy, transitionSampleTimes, type TransitionQuality } from '../qc/transition-quality';
import { prepare, renderFrame } from './render';

export interface TransitionQualityReport {
  version: 1;
  transitions: TransitionQuality[];
  /** Mean score (0..9) — the Visual Critic's transition evidence. */
  score: number;
  strips: string[];
}

export async function runTransitionQuality(spec: VideoSpec, projectDir: string, opts: { scale?: number; out?: string } = {}): Promise<TransitionQualityReport | null> {
  const plan = spec.stage as unknown as StagePlan | undefined;
  if (!plan || !plan.transitions?.length) return null;
  const scale = opts.scale ?? 0.25;
  const fps = spec.canvas.fps;
  const dir = join(projectDir, 'qc', 'transitions');
  mkdirSync(dir, { recursive: true });
  const domFile = join(projectDir, 'dom_samples.json');
  const dom: StageProbeSample[] = existsSync(domFile) ? (JSON.parse(readFileSync(domFile, 'utf8')) as { samples: StageProbeSample[] }).samples : [];
  const prep = await prepare(spec, projectDir, 'render');
  const total = Math.round(spec.scenes.reduce((a, s) => a + s.duration, 0) * fps);
  const out: TransitionQuality[] = [];
  const strips: string[] = [];
  for (const tr of plan.transitions) {
    const times = transitionSampleTimes(tr).filter((t) => t >= 0 && t * fps < total - 1);
    const curve: { t: number; occ: number; lum: number }[] = [];
    const files: { t: number; file: string }[] = [];
    for (const t of times) {
      const f = join(dir, `f-${tr.from}-${Math.round(t * fps)}.png`);
      await renderFrame(prep, Math.round(t * fps), f, scale);
      const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
      curve.push({ t, ...pixelOccupancy(data, info.width, info.height, info.channels) });
      files.push({ t, file: f });
    }
    const q = judgeTransition(tr, curve, dom.filter((s) => s.t >= tr.t0 - 0.3 && s.t <= tr.t1 + 0.3));
    out.push(q);
    // strip: 7 frames spread through the cut, the emptiest one included
    const pick = [0, 0.18, 0.36, 0.5, 0.64, 0.82, 1].map((k) => files[Math.round(k * (files.length - 1))]);
    const minFile = files.find((x) => Math.abs(x.t - q.minAt) < 0.01);
    if (minFile && !pick.includes(minFile)) pick[3] = minFile;
    const meta = await sharp(pick[0].file).metadata();
    const w = meta.width ?? 480;
    const h = meta.height ?? 270;
    const strip = join(dir, `${tr.from}-${tr.to}.png`);
    await sharp({ create: { width: w * pick.length + 4 * (pick.length - 1), height: h, channels: 3, background: '#ffffff' } })
      .composite(pick.map((p, i) => ({ input: p.file, left: i * (w + 4), top: 0 })))
      .png()
      .toFile(strip);
    strips.push(strip);
  }
  const report: TransitionQualityReport = { version: 1, transitions: out, score: Math.round((out.reduce((a, q) => a + q.score, 0) / out.length) * 100) / 100, strips };
  writeFileSync(opts.out ?? join(projectDir, 'transition_quality.json'), JSON.stringify(report, null, 2));
  return report;
}
