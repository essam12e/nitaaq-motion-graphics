/**
 * Produce — the staged, measured delivery pipeline:
 *
 *   validation + deterministic repair
 *   → structural QC on cached DOM probes (structure / design / motion), auto-repair
 *     (max 2 passes; a 3rd only while critical issues remain and repairs still apply)
 *   → contact sheet + phone-view sheet
 *   → optional animatic (half size, 15 fps) for timing review
 *   → production render (render cache: identical inputs are never re-rendered)
 *   → final technical QC (reuses the structural probes, one MP4 decode)
 *   → delivery only when every acceptance rule passes.
 *
 * Every stage is timed into performance_report.json; quality_report.json and
 * review_log.md are written to the project folder (project memory).
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { repairSpec, type RepairEntry } from '../validation/repair';
import { summarize, type Issue } from '../validation/validate';
import { loadSpec, nodeValidateOptions, renderVideo, type RenderProfile, type RenderResult } from './render';
import { structuralQc, finalQc, type QualityReport, type StructuralQc } from '../qc/quality';
import { applyQcRepairs, blockingUnrepairable } from '../qc/repair-loop';
import { estimateEffectCost } from '../perf/effect-budget';
import { Perf } from '../perf/timer';
import { renderConcurrency } from './render';
import { writeAssetsManifest } from './manifest';

export interface ProduceResult {
  ok: boolean;
  video: string | null;
  delivered: string | null;
  animatic: string | null;
  report: QualityReport | null;
  render: RenderResult | null;
  repairs: RepairEntry[];
  validation: Issue[];
  passes: number;
  specFile: string;
  perf: ReturnType<Perf['report']>;
}

export interface ProduceOptions {
  projectDir: string;
  profile?: RenderProfile;
  /** Normal cap is 2 repair passes; a 3rd runs only while critical issues remain. */
  maxPasses?: number;
  deliverTo?: string;
  name?: string;
  /** Also render a half-size 15 fps animatic before the final render. */
  animatic?: boolean;
  /** Stop after structural QC + sheets (+ animatic): no production render. */
  stopAfterAnimatic?: boolean;
  perf?: Perf;
  /** Probe frames per scene (classifier budget: 2 for SIMPLE/LONG_FORM, 3 otherwise). */
  perScene?: number;
}

/** Budget recorded by the Director (plan.json → taskClass), when the project was directed. */
function directorBudget(projectDir: string): { perScene?: number; animatic?: boolean; cls?: string } {
  try {
    const p = JSON.parse(readFileSync(join(projectDir, 'plan.json'), 'utf8')) as { taskClass?: { class: string; budget: { qcPerScene: number; animatic: boolean } } };
    return p.taskClass ? { perScene: p.taskClass.budget.qcPerScene, animatic: p.taskClass.budget.animatic, cls: p.taskClass.class } : {};
  } catch {
    return {};
  }
}

const save = (file: string, spec: VideoSpec) => writeFileSync(file, JSON.stringify(spec, null, 2));

export async function produce(opts: ProduceOptions): Promise<ProduceResult> {
  const perf = opts.perf ?? new Perf();
  const profile = opts.profile ?? 'production';
  const normalPasses = Math.min(2, opts.maxPasses ?? 2);
  const hardCap = Math.max(normalPasses, opts.maxPasses ?? 3);
  const specFile = join(opts.projectDir, 'video.json');
  let spec: VideoSpec = loadSpec(specFile);
  const budget = directorBudget(opts.projectDir);
  const perScene = opts.perScene ?? budget.perScene ?? 3;
  if (budget.cls) perf.meta.taskClass = budget.cls;
  const allRepairs: RepairEntry[] = [];
  perf.meta.project = spec.project.id;
  perf.meta.profile = profile;
  perf.meta.concurrency = renderConcurrency();
  perf.meta.durationSec = spec.scenes.reduce((a, s) => a + s.duration, 0);
  perf.meta.effects = estimateEffectCost(spec);
  perf.meta.canvas = `${spec.canvas.width}x${spec.canvas.height}@${spec.canvas.fps}`;

  // 1. validation + deterministic repair
  const rep = await perf.stage('validation', () => {
    log.stage('VALIDATION', `${spec.scenes.length} scenes, ${spec.canvas.aspect}, style ${spec.style.preset}`);
    return repairSpec(spec, nodeValidateOptions(opts.projectDir, spec));
  });
  spec = rep.spec;
  allRepairs.push(...rep.repairs);
  for (const r of rep.repairs) log.stage('REPAIR', `${r.path}: ${r.issue} → ${r.fix}`);
  save(specFile, spec);
  const s = summarize(rep.remaining);
  if (!rep.ok) {
    const blocking = rep.remaining.filter((i) => i.severity === 'critical' || i.severity === 'error');
    throw new MotionError({ code: 'SCHEMA_INVALID', what: `video.json cannot be rendered safely (${s.critical} critical, ${s.error} errors)`, why: blocking.slice(0, 6).map((i) => `${i.path}: ${i.message}`).join('\n'), action: 'These need a decision (content, files or data) — they are not auto-repaired to avoid changing your material.' });
  }

  const qcDir = join(opts.projectDir, 'qc');
  const renders = join(opts.projectDir, 'renders');
  mkdirSync(renders, { recursive: true });

  // 2. structural QC + repair (cached probes: unchanged scenes are not re-probed)
  let passes = 0;
  let st: StructuralQc | null = null;
  const structural = async (pass: number) => {
    const r = await perf.stage('qc-structure', () => structuralQc({ spec, projectDir: opts.projectDir, outDir: join(qcDir, `pass-${pass}`), pass, perScene }), `pass ${pass}`);
    perf.mark('contact-sheet', r.report.timings.sheetMs ?? 0, { note: 'included in qc-structure' });
    return r;
  };
  for (;;) {
    st = await structural(passes + 1);
    const hard = blockingUnrepairable(st.report);
    if (hard.length) throw new MotionError({ code: 'QC_FAILED', what: 'Quality check found problems that cannot be fixed automatically', why: hard.map((i) => `${i.code}: ${i.message}`).join('\n'), action: 'Fix the listed asset/font/content problem and run again.' });
    const actionable = st.report.issues.filter((i) => i.repair && i.severity !== 'info');
    const cap = st.report.summary.critical > 0 ? hardCap : normalPasses;
    if (!actionable.length || passes >= cap) break;
    const { spec: next, repairs } = applyQcRepairs(spec, st.report, passes + 1);
    if (!repairs.length) break;
    for (const r of repairs) log.stage('REPAIR', `pass ${passes + 1} ${r.path}: ${r.fix} (${r.issue})`);
    allRepairs.push(...repairs);
    spec = next;
    save(specFile, spec);
    passes++;
  }

  // 3. optional animatic (timing/story review at a fraction of the cost)
  let animatic: string | null = null;
  if (opts.animatic ?? (opts.stopAfterAnimatic || budget.animatic)) {
    const out = join(renders, `${spec.project.id}-animatic.mp4`);
    const r = await perf.stage('animatic', () => renderVideo({ spec, projectDir: opts.projectDir, output: out, profile: 'animatic' }));
    animatic = r.output;
    log.stage('RENDER', `animatic ${(r.bytes / 1e6).toFixed(2)} MB in ${(r.renderMs / 1000).toFixed(1)}s${r.cached ? ' (cached)' : ''} → ${out}`);
  }
  if (opts.stopAfterAnimatic) {
    writeAssetsManifest(opts.projectDir, spec);
    const report = st!.report;
    writeProjectMemory(opts.projectDir, spec, report, perf, allRepairs, passes, profile, null);
    return { ok: report.passed, video: null, delivered: null, animatic, report, render: null, repairs: allRepairs, validation: rep.remaining, passes, specFile, perf: perf.report() };
  }

  // 4. production render + final technical QC (re-render only if a post-render repair applies)
  let render: RenderResult | null = null;
  let report: QualityReport | null = null;
  const out = join(renders, `${spec.project.id}-${profile}.mp4`);
  for (;;) {
    render = await perf.stage('render', () => renderVideo({ spec, projectDir: opts.projectDir, output: out, profile }), profile);
    perf.meta.renderCached = Boolean(render.cached);
    log.stage('RENDER', `${(render.bytes / 1e6).toFixed(2)} MB in ${(render.renderMs / 1000).toFixed(1)}s${render.cached ? ' (cached)' : ''} → ${out}`);
    report = await perf.stage('qc-final', () => finalQc({ spec, projectDir: opts.projectDir, video: out, outDir: join(qcDir, 'final'), structural: st!, profile, pass: passes + 1 }));
    if (report.passed && report.summary.error === 0) break;
    if (blockingUnrepairable(report).length || passes >= hardCap) break;
    const { spec: next, repairs } = applyQcRepairs(spec, report, passes + 1);
    if (!repairs.length) break;
    for (const r of repairs) log.stage('REPAIR', `post-render ${r.path}: ${r.fix} (${r.issue})`);
    allRepairs.push(...repairs);
    spec = next;
    save(specFile, spec);
    passes++;
    st = await structural(passes + 1);
  }

  const ok = Boolean(report?.passed);
  let delivered: string | null = null;
  const name = opts.name ?? spec.project.id;
  if (ok && render) {
    const dest = opts.deliverTo ?? join(renders, 'final');
    mkdirSync(dest, { recursive: true });
    delivered = join(dest, `${name}.mp4`);
    copyFileSync(render.output, delivered);
    copyFileSync(join(qcDir, 'final', 'quality-report.json'), join(dest, `${name}.quality-report.json`));
    if (report?.contactSheet && existsSync(report.contactSheet)) copyFileSync(report.contactSheet, join(dest, `${name}.contact-sheet.png`));
    if (report?.phoneSheet && existsSync(report.phoneSheet)) copyFileSync(report.phoneSheet, join(dest, `${name}.phone-view.png`));
    log.stage('COMPLETE', `delivered ${delivered}`);
  } else log.stage('QUALITY', `NOT delivered — ${report?.acceptance.filter((a) => !a.ok).map((a) => a.rule).join('; ') || 'see report'}; ${join(qcDir, 'final', 'quality-report.json')}`, 'error');
  writeAssetsManifest(opts.projectDir, spec);
  writeProjectMemory(opts.projectDir, spec, report, perf, allRepairs, passes, profile, delivered);
  return { ok, video: render?.output ?? null, delivered, animatic, report, render, repairs: allRepairs, validation: rep.remaining, passes, specFile, perf: perf.report() };
}

/** quality_report.json, performance_report.json and an appended review_log.md entry. */
function writeProjectMemory(dir: string, spec: VideoSpec, report: QualityReport | null, perf: Perf, repairs: RepairEntry[], passes: number, profile: string, delivered: string | null) {
  if (report) writeFileSync(join(dir, 'quality_report.json'), JSON.stringify(report, null, 2));
  perf.write(join(dir, 'performance_report.json'), { repairPasses: passes });
  const p = perf.report();
  const lines = [
    `## ${new Date().toISOString()} — ${profile}${delivered ? ' — delivered' : report ? ' — not delivered' : ''}`,
    '',
    `- spec: ${spec.scenes.length} scenes, ${spec.canvas.width}×${spec.canvas.height}, style ${spec.style.preset}${spec.motion?.personality ? `, motion ${spec.motion.personality}` : ''}`,
    report ? `- scores: overall ${report.scores.overall} · structure ${report.scores.structure} · design ${report.scores.design} · motion ${report.scores.motion}${report.stage === 'final' ? ` · technical ${report.scores.technical}` : ''}` : '',
    report ? `- acceptance: ${report.acceptance.map((a) => `${a.ok ? '✓' : '✗'} ${a.rule}`).join(' · ')}` : '',
    `- repair passes: ${passes}${repairs.length ? '' : ' (no changes)'}`,
    ...repairs.slice(-12).map((r) => `  - ${r.path}: ${r.fix} (${r.issue})`),
    report?.critique.length ? '- critique:' : '',
    ...(report?.critique ?? []).map((c) => `  - ${c}`),
    `- time: total ${(p.totalMs / 1000).toFixed(1)}s · qc ${(p.qcMs / 1000).toFixed(1)}s · animatic ${(p.animaticMs / 1000).toFixed(1)}s · render ${(p.productionRenderMs / 1000).toFixed(1)}s${perf.meta.renderCached ? ' (cached)' : ''} · cache hits ${p.cache.hits}/${p.cache.hits + p.cache.misses}`,
    '',
  ].filter((l) => l !== '');
  const file = join(dir, 'review_log.md');
  if (!existsSync(file)) writeFileSync(file, `# Review log — ${spec.project.title ?? spec.project.id}\n\n`);
  appendFileSync(file, lines.join('\n') + '\n\n');
}
