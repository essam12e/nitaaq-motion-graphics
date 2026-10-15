/**
 * Critic → Repair loop (P1-L) for Stage films:
 *
 *   probes (DOM) + metrics → Motion Critic → failing shots + reasons → repair rules edit shots.json
 *   → Stage recompiled → ONLY the affected frames re-rendered (Remotion frame range) and spliced into
 *   the previous video → probes + critic again.            (at most `maxPasses`, default 2)
 *
 * A timing change (a shot gets shorter or longer) moves every later frame and the soundtrack, so it
 * re-renders the whole film — reported as such, never hidden.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import type { StageReport } from '../stage/compiler';
import { critique, type CriticReport } from '../qc/critic';
import { repairScript, repairRanges, type RepairPatch } from '../stage/repair';
import { runStageProbes } from './stage-probes';
import { loadSpec, renderVideo, PROFILES, type RenderProfile } from './render';
import { direct } from './direct';
import { log } from '../core/logger';

export interface RepairPass {
  pass: number;
  verdict: CriticReport['verdict']['status'];
  overall: number;
  scores: CriticReport['scores'];
  issues: number;
  patches: RepairPatch[];
  render?: { mode: 'partial' | 'full' | 'none'; ranges: [number, number][]; framesRendered: number; framesTotal: number; ms: number };
}

const readJson = <T>(f: string): T | null => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return null;
  }
};

export async function evaluateStage(spec: VideoSpec, projectDir: string, tag: string): Promise<CriticReport> {
  const plan = spec.stage as unknown as StagePlan;
  const report = readJson<StageReport>(join(projectDir, 'stage_report.json'))!;
  const probes = await runStageProbes(spec, projectDir, { out: join(projectDir, `dom_motion${tag}.json`) });
  if (tag) copyFileSync(join(projectDir, `dom_motion${tag}.json`), join(projectDir, 'dom_motion.json'));
  const pixel = readJson<{ global?: { stillFrameRatio?: number; longestDeadHold?: number; score?: number } }>(join(projectDir, 'motion_metrics.animatic.json'))?.global ?? null;
  const direction = readJson<import('../stage/direction').Direction>(join(projectDir, 'direction.json'));
  const textProblems: { id: string; problem: string }[] = [];
  const critic = critique({ plan, report, dom: probes?.report, pixel, direction, textProblems, voice: Boolean(spec.audio.voice) });
  writeFileSync(join(projectDir, `critic${tag}.json`), JSON.stringify(critic, null, 2));
  if (tag) writeFileSync(join(projectDir, 'critic.json'), JSON.stringify(critic, null, 2));
  return critic;
}

/** Splices re-rendered segments into the previous video (video re-encoded, audio copied: timing is unchanged). */
export function spliceVideo(base: string, segments: { range: [number, number]; file: string }[], out: string, totalFrames: number): void {
  const inputs = ['-i', base, ...segments.flatMap((s) => ['-i', s.file])];
  const parts: string[] = [];
  const labels: string[] = [];
  let cursor = 0;
  segments.forEach((s, k) => {
    if (s.range[0] > cursor) {
      parts.push(`[0:v]trim=start_frame=${cursor}:end_frame=${s.range[0]},setpts=PTS-STARTPTS[b${k}]`);
      labels.push(`[b${k}]`);
    }
    parts.push(`[${k + 1}:v]setpts=PTS-STARTPTS[s${k}]`);
    labels.push(`[s${k}]`);
    cursor = s.range[1] + 1;
  });
  if (cursor < totalFrames) {
    parts.push(`[0:v]trim=start_frame=${cursor}:end_frame=${totalFrames},setpts=PTS-STARTPTS[bend]`);
    labels.push('[bend]');
  }
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=1:a=0[v]`;
  const tmp = `${out}.splice.mp4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp]);
  copyFileSync(tmp, out);
  execFileSync('rm', ['-f', tmp]);
}

export async function criticLoop(opts: {
  projectDir: string;
  brief: unknown;
  baseDir: string;
  maxPasses?: number;
  /** The video to repair in place (partial renders are spliced into it); omitted → no rendering. */
  video?: string;
  profile?: RenderProfile;
}): Promise<{ passes: RepairPass[]; critic: CriticReport }> {
  const { projectDir } = opts;
  const max = opts.maxPasses ?? 2;
  let spec = loadSpec(join(projectDir, 'video.json'));
  let critic = await evaluateStage(spec, projectDir, '.pass0');
  const passes: RepairPass[] = [{ pass: 0, verdict: critic.verdict.status, overall: critic.overall, scores: critic.scores, issues: critic.issues.length, patches: [] }];
  log.stage('CRITIC', `pass 0: ${critic.verdict.status} · overall ${critic.overall}/10 · ${critic.issues.length} issue(s)`);
  for (let pass = 1; pass <= max && critic.verdict.status !== 'accept'; pass++) {
    const shots = readJson<{ shots: never[] } & Record<string, unknown>>(join(projectDir, 'shots.json'))!;
    const dom = readJson<{ camera: { shots: { shot: string; targetScale?: number }[] } }>(join(projectDir, 'dom_motion.json'));
    const { script, patches } = repairScript(shots, critic, dom);
    if (!patches.length) {
      log.stage('CRITIC', `pass ${pass}: no repair rule applies to the remaining issues — left for Claude / the user`);
      break;
    }
    for (const p of patches) log.stage('REPAIR', `[${p.shot}] ${p.code}: ${p.change}`);
    writeFileSync(join(projectDir, `shots.repair${pass}.json`), JSON.stringify(script, null, 2));
    const oldPlan = spec.stage as unknown as StagePlan;
    const direction = readJson<unknown>(join(projectDir, 'direction.json'));
    const r = await direct({ brief: opts.brief, baseDir: opts.baseDir, projectDir, shots: script, direction: direction ?? undefined });
    spec = r.spec!;
    let render: RepairPass['render'] = { mode: 'none', ranges: [], framesRendered: 0, framesTotal: 0, ms: 0 };
    if (opts.video && existsSync(opts.video)) {
      const profile = opts.profile ?? 'animatic';
      const fps = PROFILES[profile].fps ?? spec.canvas.fps;
      const total = Math.round(spec.scenes.reduce((a, s) => a + s.duration, 0) * fps);
      const timing = patches.some((p) => p.timing);
      const t0 = Date.now();
      if (timing) {
        await renderVideo({ spec, projectDir, output: opts.video, profile, cache: false });
        render = { mode: 'full', ranges: [[0, total - 1]], framesRendered: total, framesTotal: total, ms: Date.now() - t0 };
      } else {
        const ranges = repairRanges(oldPlan.shots, patches, fps, total);
        const segDir = join(projectDir, 'renders', `repair${pass}`);
        mkdirSync(segDir, { recursive: true });
        const segments: { range: [number, number]; file: string }[] = [];
        for (const range of ranges) {
          const file = join(segDir, `seg-${range[0]}-${range[1]}.mp4`);
          await renderVideo({ spec, projectDir, output: file, profile, frameRange: range });
          segments.push({ range, file });
        }
        mkdirSync(dirname(opts.video), { recursive: true });
        spliceVideo(opts.video, segments, opts.video, total);
        render = { mode: 'partial', ranges, framesRendered: ranges.reduce((a, r) => a + r[1] - r[0] + 1, 0), framesTotal: total, ms: Date.now() - t0 };
      }
      log.stage('REPAIR', `${render.mode} re-render: ${render.framesRendered}/${render.framesTotal} frames in ${(render.ms / 1000).toFixed(1)}s`);
    }
    critic = await evaluateStage(spec, projectDir, `.pass${pass}`);
    passes.push({ pass, verdict: critic.verdict.status, overall: critic.overall, scores: critic.scores, issues: critic.issues.length, patches, render });
    log.stage('CRITIC', `pass ${pass}: ${critic.verdict.status} · overall ${critic.overall}/10 · ${critic.issues.length} issue(s)`);
  }
  writeFileSync(join(projectDir, 'repair_log.json'), JSON.stringify({ version: 1, maxPasses: max, passes }, null, 2));
  return { passes, critic };
}
