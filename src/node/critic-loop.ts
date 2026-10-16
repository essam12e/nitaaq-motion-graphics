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
import { buildTimeline } from '../core/timeline';
import { planRepairs, sideEffects, repairRanges, type RepairPatch, type RepairMemory, type RepairAttempt } from '../stage/repair-planner';
import { applyRedirection } from '../stage/redirection';
import { runStageProbes } from './stage-probes';
import { runTransitionQuality } from './transition-quality';
import type { StageProbeSample } from '../qc/stage-probes';
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

export async function evaluateStage(spec: VideoSpec, projectDir: string, tag: string, opts: { transitions?: boolean; judgment?: Parameters<typeof critique>[0]['judgment'] } = {}): Promise<CriticReport> {
  const plan = spec.stage as unknown as StagePlan;
  const report = readJson<StageReport>(join(projectDir, 'stage_report.json'))!;
  const probes = await runStageProbes(spec, projectDir, { out: join(projectDir, `dom_motion${tag}.json`) });
  if (tag) copyFileSync(join(projectDir, `dom_motion${tag}.json`), join(projectDir, 'dom_motion.json'));
  const samples = readJson<{ samples: StageProbeSample[] }>(join(projectDir, 'dom_samples.json'))?.samples ?? null;
  // the frames inside every cut (P2-G): pixel occupancy through the transition
  const tq = opts.transitions === false ? null : await runTransitionQuality(spec, projectDir, { out: join(projectDir, `transition_quality${tag}.json`) });
  if (tq && tag) writeFileSync(join(projectDir, 'transition_quality.json'), JSON.stringify(tq, null, 2));
  const pixel = readJson<{ global?: { stillFrameRatio?: number; longestDeadHold?: number; score?: number } }>(join(projectDir, 'motion_metrics.animatic.json'))?.global ?? null;
  const direction = readJson<import('../stage/direction').Direction>(join(projectDir, 'direction.json'));
  const textProblems: { id: string; problem: string }[] = [];
  const critic = critique({ plan, report, dom: probes?.report, samples, pixel, direction, textProblems, voice: Boolean(spec.audio.voice), transitions: tq?.transitions ?? null, judgment: opts.judgment });
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

const SNAP = ['video.json', 'stage.json', 'stage_report.json', 'shots.json', 'critic.json', 'dom_motion.json', 'dom_samples.json', 'transition_quality.json'];
function snapshot(projectDir: string, pass: number, video?: string): void {
  const d = join(projectDir, 'passes', `pass${pass}`);
  mkdirSync(d, { recursive: true });
  for (const f of SNAP) if (existsSync(join(projectDir, f))) copyFileSync(join(projectDir, f), join(d, f));
  if (video && existsSync(video)) copyFileSync(video, join(d, 'video.mp4'));
}
function restore(projectDir: string, pass: number, video?: string): void {
  const d = join(projectDir, 'passes', `pass${pass}`);
  for (const f of SNAP) if (existsSync(join(d, f))) copyFileSync(join(d, f), join(projectDir, f));
  if (video && existsSync(join(d, 'video.mp4'))) copyFileSync(join(d, 'video.mp4'), video);
}

/**
 * Repair Loop V2 (P2-N): critic → planner (redirection) → apply → recompile → partial / full render →
 * critic → compare → memory. Two passes by default; a third only when both earlier passes clearly
 * improved. Stops on no improvement, issue churn or regression, and keeps the BEST version (restored
 * if a later pass was worse), with the reason.
 * Ablations: NITAAQ_NO_REPAIR=1 (critic only), NITAAQ_NO_REDIRECTOR=1 (no re-composition candidates).
 */
export async function criticLoop(opts: {
  projectDir: string;
  brief: unknown;
  baseDir: string;
  maxPasses?: number;
  /** The video to repair in place (partial renders are spliced into it); omitted → no rendering. */
  video?: string;
  profile?: RenderProfile;
  redirector?: boolean;
  repair?: boolean;
}): Promise<{ passes: RepairPass[]; critic: CriticReport; best: { pass: number; reason: string } }> {
  const { projectDir } = opts;
  const repairOn = opts.repair ?? process.env.NITAAQ_NO_REPAIR !== '1';
  const redirectorOn = opts.redirector ?? process.env.NITAAQ_NO_REDIRECTOR !== '1';
  const base = opts.maxPasses ?? 2;
  let spec = loadSpec(join(projectDir, 'video.json'));
  let critic = await evaluateStage(spec, projectDir, '.pass0');
  snapshot(projectDir, 0, opts.video);
  const passes: RepairPass[] = [{ pass: 0, verdict: critic.verdict.status, overall: critic.overall, scores: critic.scores, issues: critic.issues.length, patches: [] }];
  log.stage('CRITIC', `pass 0: ${critic.verdict.status} · visual ${critic.overall}/10 (${critic.visual.band}) · technical ${critic.technical.pass ? 'pass' : 'FAIL'} · ${critic.issues.length} issue(s)`);
  const memFile = join(projectDir, 'repair_memory.json');
  const memory: RepairMemory = readJson<RepairMemory>(memFile) ?? { version: 1, attempts: [] };
  let best = { pass: 0, critic, reason: 'the first evaluation' };
  let stopReason = repairOn ? '' : 'repair disabled (NITAAQ_NO_REPAIR)';
  const gains: number[] = [];
  // per-shot undo (P2-M): a repair that made ITS shot worse is taken back on the next pass, while the
  // repairs of the other shots in the same pass are kept (a pass is not all-or-nothing)
  type ShotScript = { shots: { id: string }[] } & Record<string, unknown>;
  let undo: { shot: string; why: string }[] = [];
  let undoFrom: { script: ShotScript; critic: CriticReport } | null = null;
  for (let pass = 1; repairOn; pass++) {
    const allowed = pass <= base || (pass === base + 1 && gains.length >= 2 && gains.every((g) => g >= 0.3));
    // past the budget, one last pass may only take back the repairs that hurt their shot (nothing new is tried)
    const consolidate = !allowed && undo.length > 0 && pass === base + 1;
    if (!allowed && !consolidate) {
      stopReason ||= `pass limit (${base}${gains.length ? `; gains ${gains.join(', ')}` : ''})`;
      break;
    }
    if (critic.verdict.status === 'accept' && !undo.length) {
      stopReason = 'the critic accepts the film';
      break;
    }
    const script = readJson<ShotScript>(join(projectDir, 'shots.json'))!;
    // the critic the planner reads: for an undone shot, the issues it had BEFORE the failed repair
    let planCritic = critic;
    if (undo.length && undoFrom) {
      const ids = new Set(undo.map((u) => u.shot));
      for (const u of undo) {
        const k = script.shots.findIndex((s) => s.id === u.shot);
        const was = undoFrom.script.shots.find((s) => s.id === u.shot);
        if (k >= 0 && was) script.shots[k] = was;
        log.stage('REPAIR', `undo [${u.shot}] ${u.why}`);
      }
      const from = undoFrom.critic;
      planCritic = { ...critic, issues: [...critic.issues.filter((i) => !i.shot || !ids.has(i.shot)), ...from.issues.filter((i) => i.shot && ids.has(i.shot))], shots: critic.shots.map((s) => (ids.has(s.shot) ? from.shots.find((x) => x.shot === s.shot) ?? s : s)) };
    }
    const undone = undo;
    undo = [];
    const plan0 = spec.stage as unknown as StagePlan;
    const rp = consolidate ? { redirection: { version: 1, source: 'deterministic', pass, shots: [] } as never, selected: [] as ReturnType<typeof planRepairs>['selected'], considered: [], untreated: [] } : planRepairs({ plan: plan0, script: script as never, critic: planCritic, memory, pass, redirector: redirectorOn });
    writeFileSync(join(projectDir, `repair_plan.pass${pass}.json`), JSON.stringify({ undone, considered: rp.considered, untreated: rp.untreated, selected: rp.selected.map((c) => ({ id: c.id, label: c.label, cost: c.cost, gain: c.gain, expected: c.directive.expected, risk: c.risk })) }, null, 2));
    if (!rp.selected.length && !undone.length) {
      stopReason = `no untried repair for the remaining issues (${rp.untreated.join(', ') || 'minor only'}) — left for Claude / the user`;
      log.stage('CRITIC', `pass ${pass}: ${stopReason}`);
      break;
    }
    writeFileSync(join(projectDir, `redirection.pass${pass}.json`), JSON.stringify(rp.redirection, null, 2));
    const { script: next, report: applied } = rp.selected.length ? applyRedirection(script as never, rp.redirection) : { script, report: { applied: [], mapped: [], rejected: [], intent: [], timing: false } as unknown as ReturnType<typeof applyRedirection>['report'] };
    writeFileSync(join(projectDir, `redirection_apply.pass${pass}.json`), JSON.stringify(applied, null, 2));
    for (const c of rp.selected) log.stage('REPAIR', `[${c.shot}] ${c.label} (${c.cost}) — ${c.directive.expected ?? c.directive.diagnosis}`);
    for (const r of applied.rejected) log.stage('REPAIR', `rejected [${r.shot}] ${r.asked}: ${r.why}`);
    writeFileSync(join(projectDir, `shots.repair${pass}.json`), JSON.stringify(next, null, 2));
    const oldPlan = spec.stage as unknown as StagePlan;
    const oldScenes = spec.scenes;
    const direction = readJson<unknown>(join(projectDir, 'direction.json'));
    const r = await direct({ brief: opts.brief, baseDir: opts.baseDir, projectDir, shots: next, direction: direction ?? undefined });
    spec = r.spec!;
    const patches: RepairPatch[] = [...rp.selected.map((c) => ({ shot: c.shot, code: c.directive.issues.join('+'), change: c.label, timing: Boolean(c.directive.timing) })), ...undone.map((u) => ({ shot: u.shot, code: 'UNDO', change: `undo: ${u.why}`, timing: false }))];
    let render: RepairPass['render'] = { mode: 'none', ranges: [], framesRendered: 0, framesTotal: 0, ms: 0 };
    if (opts.video && existsSync(opts.video)) {
      const profile = opts.profile ?? 'animatic';
      const fps = PROFILES[profile].fps ?? spec.canvas.fps;
      // the composition's own frame count (per-scene rounding), never a rounded sum
      const total = buildTimeline(spec.scenes, fps).totalFrames;
      // any change of film length (a retime that moved an end, a shorter hold) needs the whole film again
      const timing = applied.timing || buildTimeline(oldScenes, fps).totalFrames !== total;
      const t0 = Date.now();
      if (timing) {
        await renderVideo({ spec, projectDir, output: opts.video, profile, cache: false });
        render = { mode: 'full', ranges: [[0, total - 1]], framesRendered: total, framesTotal: total, ms: Date.now() - t0 };
      } else {
        // a shot whose elements moved also changes the moves into / out of it: its neighbours' boundaries re-render too
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
    const prev = critic;
    critic = await evaluateStage(spec, projectDir, `.pass${pass}`);
    snapshot(projectDir, pass, opts.video);
    const fx = sideEffects(prev, critic, [...rp.selected.map((c) => c.shot), ...undone.map((u) => u.shot)]);
    for (const c of rp.selected) {
      const sb = planCritic.shots.find((x) => x.shot === c.shot)?.overall;
      const sa = critic.shots.find((x) => x.shot === c.shot)?.overall;
      const own = c.directive.issues.filter((code) => critic.issues.some((i) => i.code === code && i.shot === c.shot && i.severity !== 'minor')).length;
      const fixed = own < c.directive.issues.length;
      // its own shot: worse to look at, or a technical failure that was not there before
      const brokeTech = critic.issues.filter((i) => i.layer === 'technical' && i.shot === c.shot && i.severity !== 'minor' && !planCritic.issues.some((j) => j.code === i.code && j.shot === c.shot));
      const hurt = (sa !== undefined && sb !== undefined && sa < sb - 0.2) || brokeTech.length > 0;
      if (hurt) undo.push({ shot: c.shot, why: `${c.label} made the shot worse (${sb ?? '?'} → ${sa ?? '?'}${brokeTech.length ? `; new ${brokeTech.map((i) => i.code).join(', ')}` : ''})` });
      const result: RepairAttempt['result'] = hurt || fx.gained < -0.1 ? 'regressed' : (sa !== undefined && sb !== undefined && sa >= sb + 0.3) || fixed || fx.gained >= 0.1 ? 'improved' : 'no-change';
      memory.attempts.push({ pass, shot: c.shot, candidate: c.id, label: c.label, issues: c.directive.issues, cost: c.cost, before: { overall: prev.overall, shot: sb }, after: { overall: critic.overall, shot: sa }, sideEffects: fx.sideEffects, result });
    }
    if (undo.length) undoFrom = { script: script as ShotScript, critic: planCritic };
    writeFileSync(memFile, JSON.stringify(memory, null, 2));
    passes.push({ pass, verdict: critic.verdict.status, overall: critic.overall, scores: critic.scores, issues: critic.issues.length, patches, render, redirection: rp.redirection, applied, sideEffects: fx } as RepairPass);
    log.stage('CRITIC', `pass ${pass}: ${critic.verdict.status} · visual ${critic.overall}/10 (${fx.gained >= 0 ? '+' : ''}${fx.gained}) · resolved ${fx.resolved.length}, new ${fx.introduced.length}${fx.sideEffects.length ? ` · side effects: ${fx.sideEffects.join('; ')}` : ''}`);
    gains.push(fx.gained);
    // a version that passes the technical layer beats one that fails it (unless it is clearly worse to look at)
    const techWin = critic.technical.pass && !best.critic.technical.pass && critic.overall >= best.critic.overall - 0.5;
    if (techWin) best = { pass, critic, reason: `fixes the technical layer (visual ${critic.overall})` };
    else if (critic.overall > best.critic.overall + 0.001 && (critic.technical.pass || !best.critic.technical.pass)) best = { pass, critic, reason: `highest visual score (${critic.overall}) with technical ${critic.technical.pass ? 'pass' : 'fail'}` };
    // a technical failure still open keeps the loop going within the pass budget (the next candidate is tried)
    const techOpen = !critic.technical.pass && pass < base;
    // a shot to take back keeps the loop going for one more pass (within the budget, or the consolidation pass)
    if (undo.length && !consolidate) continue;
    if (consolidate) {
      stopReason = `pass limit (${base}); consolidation pass took back ${undone.map((u) => u.shot).join(', ')}`;
      break;
    }
    if (fx.gained < -0.1) {
      stopReason = `regression (${fx.gained})`;
      break;
    }
    if (fx.gained < 0.05 && !techOpen) {
      stopReason = `no improvement (${fx.gained})`;
      break;
    }
    if (fx.introduced.length && fx.resolved.length <= fx.introduced.length && !techOpen) {
      stopReason = `issue churn (resolved ${fx.resolved.length}, introduced ${fx.introduced.length})`;
      break;
    }
  }
  const lastPass = passes[passes.length - 1].pass;
  if (best.pass !== lastPass) {
    restore(projectDir, best.pass, opts.video);
    spec = loadSpec(join(projectDir, 'video.json'));
    critic = best.critic;
    writeFileSync(join(projectDir, 'critic.json'), JSON.stringify(critic, null, 2));
    log.stage('CRITIC', `kept pass ${best.pass} (${best.reason}); pass ${lastPass} was not better`);
  }
  writeFileSync(join(projectDir, 'repair_log.json'), JSON.stringify({ version: 2, maxPasses: base, passes, best: { pass: best.pass, reason: best.reason }, stop: stopReason, redirector: redirectorOn, repair: repairOn }, null, 2));
  return { passes, critic, best: { pass: best.pass, reason: best.reason } };
}
