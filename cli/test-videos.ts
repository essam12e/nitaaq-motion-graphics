/**
 * Renders the acceptance test videos A–E end to end (brief → director → render →
 * QC → repair) and writes a summary with the real QC numbers.
 *
 *   npx tsx cli/test-videos.ts [--profile production] [--only a,c] [--out dir]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct } from '../src/node/direct';
import { produce } from '../src/node/produce';
import { ROOT, workspace } from '../src/node/workspace';
import type { RenderProfile } from '../src/node/render';
import { formatMotionError, isMotionError } from '../src/core/errors';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[++i]);
const profile = (args.get('profile') ?? 'production') as RenderProfile;
const only = args.get('only')?.split(',');
const out = args.get('out') ?? join(workspace().output, 'test-videos');
const fixtures = join(ROOT, 'test', 'fixtures');

const TESTS = [
  { key: 'a', brief: 'brief-a-gcc-tech.json', what: 'Arabic GCC tech ad, 9:16, test logo, no voice' },
  { key: 'b', brief: 'brief-b-ecommerce.json', what: 'E-commerce product ad, 9:16, product image + music + SFX' },
  { key: 'c', brief: 'brief-c-saas.json', what: 'SaaS explainer, 16:9, dashboard + browser, mixed Arabic/English' },
  { key: 'd', brief: 'brief-d-voiceover.json', what: 'Simulated user voiceover, 9:16, scenes synced to phrases' },
  { key: 'e', brief: 'brief-e-long-arabic.json', what: 'Long Arabic text stress test, 4:5' },
];

mkdirSync(out, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const t of TESTS) {
  if (only && !only.includes(t.key)) continue;
  const brief = JSON.parse(readFileSync(join(fixtures, t.brief), 'utf8'));
  const projectDir = join(workspace().projects, `test-${t.key}`);
  rmSync(projectDir, { recursive: true, force: true });
  const t0 = Date.now();
  try {
    const d = await direct({ brief, baseDir: fixtures, projectDir });
    if (d.status !== 'ready') throw new Error(`needs input: ${d.questions.map((q) => q.id).join(', ')}`);
    const r = await produce({ projectDir, profile, deliverTo: out, name: `test-${t.key}` });
    results.push({
      test: t.key.toUpperCase(),
      what: t.what,
      ok: r.ok,
      video: r.delivered,
      seconds: r.report?.media?.duration,
      audio: r.report?.audio,
      scenes: d.storyboard!.scenes.map((s) => `${s.family}/${s.variant}`),
      style: d.plan!.visualStyle,
      qc: r.report?.summary,
      repairs: r.repairs.map((x) => `${x.path}: ${x.fix} (${x.issue})`),
      remainingIssues: r.report?.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity} ${i.code}${i.scene ? ` [${i.scene}]` : ''}: ${i.message}`),
      wallSeconds: Math.round((Date.now() - t0) / 1000),
    });
  } catch (e) {
    results.push({ test: t.key.toUpperCase(), what: t.what, ok: false, error: isMotionError(e) ? formatMotionError(e) : String((e as Error).stack ?? e) });
  }
  writeFileSync(join(out, 'test-results.json'), JSON.stringify({ profile, generatedAt: new Date().toISOString(), results }, null, 2));
}
console.log(JSON.stringify(results.map((r) => ({ test: r.test, ok: r.ok, qc: r.qc, error: r.error ? String(r.error).slice(0, 300) : undefined })), null, 1));
