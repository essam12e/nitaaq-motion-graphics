/**
 * Produce: validation → auto-repair → QC probe passes → render → full QC →
 * (repair → re-render) up to 3 passes. A video is only reported as delivered
 * when the final QC has zero critical issues.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { repairSpec, type RepairEntry } from '../validation/repair';
import { summarize, type Issue } from '../validation/validate';
import { loadSpec, nodeValidateOptions, renderVideo, type RenderProfile, type RenderResult } from './render';
import { runQuality, type QualityReport } from '../qc/quality';
import { applyQcRepairs, blockingUnrepairable } from '../qc/repair-loop';

export interface ProduceResult {
  ok: boolean;
  video: string | null;
  delivered: string | null;
  report: QualityReport | null;
  render: RenderResult | null;
  repairs: RepairEntry[];
  validation: Issue[];
  passes: number;
  specFile: string;
}

export async function produce(opts: { projectDir: string; profile?: RenderProfile; maxPasses?: number; deliverTo?: string; name?: string }): Promise<ProduceResult> {
  const profile = opts.profile ?? 'production';
  const maxPasses = opts.maxPasses ?? 3;
  const specFile = join(opts.projectDir, 'video.json');
  let spec: VideoSpec = loadSpec(specFile);
  const allRepairs: RepairEntry[] = [];

  // 1. validation + deterministic repair
  log.stage('VALIDATION', `${spec.scenes.length} scenes, ${spec.canvas.aspect}, style ${spec.style.preset}`);
  const rep = repairSpec(spec, nodeValidateOptions(opts.projectDir, spec));
  spec = rep.spec;
  allRepairs.push(...rep.repairs);
  for (const r of rep.repairs) log.stage('REPAIR', `${r.path}: ${r.issue} → ${r.fix}`);
  writeFileSync(specFile, JSON.stringify(spec, null, 2));
  const s = summarize(rep.remaining);
  if (!rep.ok) {
    const blocking = rep.remaining.filter((i) => i.severity === 'critical' || i.severity === 'error');
    throw new MotionError({ code: 'SCHEMA_INVALID', what: `video.json cannot be rendered safely (${s.critical} critical, ${s.error} errors)`, why: blocking.slice(0, 6).map((i) => `${i.path}: ${i.message}`).join('\n'), action: 'These need a decision (content, files or data) — they are not auto-repaired to avoid changing your material.' });
  }

  const qcDir = join(opts.projectDir, 'qc');
  const renders = join(opts.projectDir, 'renders');
  mkdirSync(renders, { recursive: true });

  // 2. probe-only QC passes (fast, no encode) to converge layout/timing
  let passes = 0;
  for (; passes < maxPasses; passes++) {
    const pre = await runQuality({ spec, projectDir: opts.projectDir, video: null, outDir: join(qcDir, `pass-${passes + 1}`), pass: passes + 1, perScene: 3 });
    const hard = blockingUnrepairable(pre);
    if (hard.length) throw new MotionError({ code: 'QC_FAILED', what: 'Quality check found problems that cannot be fixed automatically', why: hard.map((i) => `${i.code}: ${i.message}`).join('\n'), action: 'Fix the listed asset/font/content problem and run again.' });
    const actionable = pre.issues.filter((i) => i.repair && i.severity !== 'info');
    if (!actionable.length) break;
    const { spec: next, repairs } = applyQcRepairs(spec, pre, passes + 1);
    if (!repairs.length) break;
    for (const r of repairs) log.stage('REPAIR', `pass ${passes + 1} ${r.path}: ${r.fix} (${r.issue})`);
    allRepairs.push(...repairs);
    spec = next;
    writeFileSync(specFile, JSON.stringify(spec, null, 2));
  }

  // 3. render + full QC (MP4 + pixels + audio); re-render if a repair is still needed
  let render: RenderResult | null = null;
  let report: QualityReport | null = null;
  const out = join(renders, `${spec.project.id}-${profile}.mp4`);
  for (let attempt = 0; attempt < Math.max(1, maxPasses - passes + 1); attempt++) {
    render = await renderVideo({ spec, projectDir: opts.projectDir, output: out, profile });
    log.stage('RENDER', `${(render.bytes / 1e6).toFixed(2)} MB in ${(render.renderMs / 1000).toFixed(1)}s → ${out}`);
    report = await runQuality({ spec, projectDir: opts.projectDir, video: out, outDir: join(qcDir, 'final'), profile, pass: passes + attempt + 1 });
    if (report.summary.critical === 0 && report.summary.error === 0) break;
    const hard = blockingUnrepairable(report);
    if (hard.length) break;
    const { spec: next, repairs } = applyQcRepairs(spec, report, passes + attempt + 1);
    if (!repairs.length || passes + attempt + 1 >= maxPasses) break;
    for (const r of repairs) log.stage('REPAIR', `post-render ${r.path}: ${r.fix} (${r.issue})`);
    allRepairs.push(...repairs);
    spec = next;
    writeFileSync(specFile, JSON.stringify(spec, null, 2));
  }
  const ok = Boolean(report && report.summary.critical === 0);
  let delivered: string | null = null;
  if (ok && render) {
    const dest = opts.deliverTo ?? join(renders, 'final');
    mkdirSync(dest, { recursive: true });
    delivered = join(dest, `${opts.name ?? spec.project.id}.mp4`);
    copyFileSync(render.output, delivered);
    copyFileSync(join(qcDir, 'final', 'quality-report.json'), join(dest, `${opts.name ?? spec.project.id}.quality-report.json`));
    if (report?.contactSheet && existsSync(report.contactSheet)) copyFileSync(report.contactSheet, join(dest, `${opts.name ?? spec.project.id}.contact-sheet.png`));
    log.stage('COMPLETE', `delivered ${delivered}`);
  } else log.stage('QUALITY', `NOT delivered — ${report?.summary.critical ?? '?'} critical issue(s); see ${join(qcDir, 'final', 'quality-report.json')}`, 'error');
  return { ok, video: render?.output ?? null, delivered, report, render, repairs: allRepairs, validation: rep.remaining, passes, specFile };
}
