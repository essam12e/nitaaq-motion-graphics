/**
 * Renders the 8 acceptance test videos end to end:
 *   brief → director → validate → structural QC (+ contact sheet) → repair →
 *   animatic → production render → final technical QC → delivery
 * and writes test-results.json with the real QC scores and stage timings.
 *
 *   npx tsx cli/test-videos.ts [--profile production] [--only 1,3] [--out dir] [--animatic false]
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { direct } from '../src/node/direct';
import { produce, type ProduceResult } from '../src/node/produce';
import { recomposeProject } from '../src/node/recompose';
import { ROOT, workspace } from '../src/node/workspace';
import type { RenderProfile } from '../src/node/render';
import { closeBrowser } from '../src/node/render';
import { Perf } from '../src/perf/timer';
import type { Aspect } from '../src/layout/canvas';
import { formatMotionError, isMotionError } from '../src/core/errors';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[++i]);
const profile = (args.get('profile') ?? 'production') as RenderProfile;
const only = args.get('only')?.split(',');
const animatic = args.get('animatic') !== 'false';
const out = args.get('out') ?? join(workspace().output, 'test-videos');
const fixtures = join(ROOT, 'test', 'fixtures');

const TESTS = [
  { key: '1', brief: 'brief-a-gcc-tech.json', what: 'Saudi tech ad, 9:16, no voice, clean background (no dots)' },
  { key: '2', brief: 'brief-b-ecommerce.json', what: 'E-commerce product ad: product image, music (beat-synced), SFX' },
  { key: '3', brief: 'brief-c-saas.json', what: 'SaaS explainer 16:9: browser + dashboard, integrations, state transitions' },
  { key: '4', brief: 'brief-d-voiceover.json', what: 'User voiceover, 9:16, scenes synced to phrases, ducked music' },
  { key: '5', brief: 'brief-g-brand-logo.json', what: 'User logo; palette derived from the logo, logo unchanged' },
  { key: '6', brief: 'brief-h-reference.json', what: 'Reference-driven style (principles extracted, not copied)' },
  { key: '7', brief: 'brief-e-long-arabic.json', what: 'Long Arabic text stress test, 4:5' },
  { key: '8', brief: 'brief-f-multi.json', what: 'Multi-format: 9:16 recomposed to 16:9 and 1:1 (re-laid-out, not cropped)' },
];

const summary = (r: ProduceResult) => ({
  ok: r.ok,
  video: r.delivered,
  animatic: r.animatic,
  seconds: r.report?.media?.duration,
  scores: r.report?.scores,
  qc: r.report?.summary,
  acceptance: r.report?.acceptance?.filter((a) => !a.ok).map((a) => a.rule),
  repairs: r.repairs.map((x) => `${x.path}: ${x.fix} (${x.issue})`),
  remainingIssues: r.report?.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity} ${i.code}${i.scene ? ` [${i.scene}]` : ''}: ${i.message}`),
  timings: { totalSec: r.perf.totalMs / 1000, qcSec: r.perf.qcMs / 1000, animaticSec: r.perf.animaticMs / 1000, renderSec: r.perf.productionRenderMs / 1000 },
});

mkdirSync(out, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const t of TESTS) {
  if (only && !only.includes(t.key)) continue;
  const brief = JSON.parse(readFileSync(join(fixtures, t.brief), 'utf8'));
  const projectDir = join(workspace().projects, `test-${t.key}`);
  rmSync(projectDir, { recursive: true, force: true });
  const t0 = Date.now();
  try {
    const perf = new Perf();
    const d = await direct({ brief, baseDir: fixtures, projectDir, perf });
    if (d.status !== 'ready') throw new Error(`needs input: ${d.questions.map((q) => q.id).join(', ')}`);
    const r = await produce({ projectDir, profile, deliverTo: out, name: `test-${t.key}`, animatic, perf });
    const formats: Record<string, unknown>[] = [];
    const extra = ((brief.formats ?? []) as Aspect[]).filter((a) => a !== d.spec!.canvas.aspect);
    if (r.ok && extra.length) {
      for (const m of recomposeProject(projectDir, extra)) {
        const fr = await produce({ projectDir: m.dir, profile, deliverTo: out, name: `test-${t.key}-${m.aspect.replace(':', 'x')}`, animatic: false });
        formats.push({ aspect: m.aspect, changes: m.changes, ...summary(fr) });
      }
    }
    results.push({
      test: t.key,
      what: t.what,
      taskClass: d.classification?.class,
      style: d.plan!.visualStyle,
      motion: d.motion ? { personality: d.motion.personality, hero: d.motion.heroScene, camera: d.motion.cameraBudget, beatSync: d.motion.beatSync } : undefined,
      reference: d.reference ? { style: d.reference.mapping.style, principles: d.reference.principles } : undefined,
      brand: d.spec?.brand ? { source: d.spec.brand.source, primary: d.spec.brand.primary, accent: d.spec.brand.accent, logo: d.spec.brand.logo } : null,
      scenes: d.storyboard!.scenes.map((s) => `${s.family}/${s.variant}`),
      ...summary(r),
      formats,
      wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    });
  } catch (e) {
    results.push({ test: t.key, what: t.what, ok: false, error: isMotionError(e) ? formatMotionError(e) : String((e as Error).stack ?? e) });
  }
  writeFileSync(join(out, 'test-results.json'), JSON.stringify({ profile, generatedAt: new Date().toISOString(), results }, null, 2));
}
await closeBrowser();
console.log(JSON.stringify(results.map((r) => ({ test: r.test, ok: r.ok, scores: (r.scores as { overall?: number })?.overall, wall: r.wallSeconds, formats: (r.formats as { aspect: string; ok: boolean }[] | undefined)?.map((f) => `${f.aspect}:${f.ok}`), error: r.error ? String(r.error).slice(0, 300) : undefined })), null, 1));
