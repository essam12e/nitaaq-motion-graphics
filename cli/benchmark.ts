/**
 * Performance benchmark — measures the real pipeline (not estimates).
 *
 *   A  10 s typography        bench-a-typography.json
 *   B  20 s product ad        bench-b-product.json
 *   C  30 s SaaS / launch     bench-c-saas-launch.json
 *   D  30 s audio-driven      bench-d-audio.json
 *
 * For every case three runs, each in a fresh Node process:
 *   cold    cache cleared + new project folder (first video on a machine)
 *   warm    cache kept, new project folder (next video, same machine)
 *   repeat  same project, nothing changed (re-run after a no-op edit)
 *   edit    cache kept, new project, one copy change (tweak → re-render)
 *
 * Stage groups come from performance_report.json of each run:
 *   planning (intake/classify/director/storyboard/compile), preprocessing
 *   (assets/brand/fonts/audio/beats/reference/soundtrack/sfx), animatic, qc, render.
 *
 *   npx tsx cli/benchmark.ts --label after [--cases a,b,c,d] [--runs cold,warm,repeat] [--out file]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[++i]);

const CASES: Record<string, { brief: string; what: string }> = {
  a: { brief: 'bench-a-typography.json', what: '10 s typography' },
  b: { brief: 'bench-b-product.json', what: '20 s product ad' },
  c: { brief: 'bench-c-saas-launch.json', what: '30 s SaaS / launch' },
  d: { brief: 'bench-d-audio.json', what: '30 s audio-driven' },
};

const GROUPS: Record<string, string[]> = {
  planning: ['intake', 'classify', 'director', 'storyboard', 'compile', 'creative', 'modules', 'sound-director'],
  preprocessing: ['assets', 'brand', 'fonts', 'audio', 'beats', 'reference', 'capture', 'soundtrack', 'sfx-library', 'brand-motion', 'map-data'],
  validation: ['validation'],
  qc: ['qc-structure', 'qc-final', 'contact-sheet', 'audio-qc'],
  animatic: ['animatic'],
  render: ['render'],
};

async function child(caseId: string, run: string, label: string, cacheDir: string): Promise<void> {
  process.env.NITAAQ_CACHE = cacheDir;
  const { direct } = await import('../src/node/direct');
  const { produce } = await import('../src/node/produce');
  const { closeBrowser } = await import('../src/node/render');
  const { Perf } = await import('../src/perf/timer');
  const { workspace } = await import('../src/node/workspace');
  const c = CASES[caseId];
  const fixtures = join(ROOT, 'test', 'fixtures');
  const brief = JSON.parse(readFileSync(join(fixtures, c.brief), 'utf8'));
  // edit: a one-word copy change (cache kept) — the realistic "tweak and re-render" loop
  if (run === 'edit') brief.content.hook = `${brief.content.hook}!`;
  const projectDir = join(workspace().projects, `bench-${label}-${caseId}-${run === 'repeat' ? 'warm' : run}`);
  if (run !== 'repeat') rmSync(projectDir, { recursive: true, force: true });
  const t0 = Date.now();
  const perf = new Perf();
  const d = await direct({ brief, baseDir: fixtures, projectDir, perf });
  const tDirect = Date.now() - t0;
  if (d.status !== 'ready') throw new Error(`needs input: ${JSON.stringify(d.questions)}`);
  const r = await produce({ projectDir, profile: 'production', animatic: true, perf, deliverTo: join(workspace().output, 'bench'), name: `bench-${label}-${caseId}-${run}` });
  await closeBrowser();
  const by: Record<string, number> = {};
  for (const s of perf.stages) by[s.stage] = (by[s.stage] ?? 0) + s.ms;
  const groups: Record<string, number> = {};
  for (const [g, names] of Object.entries(GROUPS)) groups[g] = names.reduce((a, n) => a + (by[n] ?? 0), 0);
  const out = { case: caseId, run, ok: r.ok, totalMs: Date.now() - t0, directMs: tDirect, groups, stages: by, overall: r.report?.scores?.overall ?? null, critical: r.report?.summary?.critical ?? null };
  process.stdout.write(`\n@@RESULT ${JSON.stringify(out)}\n`);
}

async function main() {
  if (args.get('child')) return child(args.get('child')!, args.get('run')!, args.get('label')!, args.get('cache')!);
  const label = args.get('label') ?? 'after';
  const cases = (args.get('cases') ?? 'a,b,c,d').split(',');
  const runs = (args.get('runs') ?? 'cold,warm,repeat').split(',');
  const cacheDir = join(ROOT, '.cache', `bench-${label}`);
  const outFile = args.get('out') ?? join(ROOT, 'workspace', `performance-report.${label}.json`);
  mkdirSync(join(ROOT, 'workspace'), { recursive: true });
  const results: unknown[] = existsSync(outFile) && args.get('append') ? JSON.parse(readFileSync(outFile, 'utf8')).results : [];
  for (const c of cases) {
    for (const run of runs) {
      if (run === 'cold') rmSync(cacheDir, { recursive: true, force: true });
      const t = Date.now();
      const p = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', c, '--run', run, '--label', label, '--cache', cacheDir], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, MOTION_LOG_LEVEL: 'warn' } });
      const line = (p.stdout ?? '').split('\n').find((l) => l.startsWith('@@RESULT '));
      const res = line ? { ...JSON.parse(line.slice(9)), wallMs: Date.now() - t } : { case: c, run, ok: false, wallMs: Date.now() - t, error: (p.stderr || p.stdout || '').slice(-1500) };
      results.push(res);
      console.log(JSON.stringify({ case: c, run, ok: (res as { ok: boolean }).ok, wallSec: Math.round((Date.now() - t) / 100) / 10, groups: (res as { groups?: unknown }).groups }));
      writeFileSync(outFile, JSON.stringify({ label, machine: { node: process.version, cpus: (await import('node:os')).cpus().length }, generatedAt: new Date().toISOString(), cases: CASES, groups: GROUPS, results }, null, 2));
    }
  }
}

await main();
