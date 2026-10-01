/**
 * nitaaq — NITAAQ | Motion Graphics CLI (shared by the Claude Code and Codex adapters).
 *
 *   nitaaq create   <brief.json> [--profile production] [--no-logo] [--out dir] [--name file] [--clean-voice]
 *   nitaaq direct   <brief.json> [--project dir] [--no-logo]          → plan.json, storyboard.json, video.json
 *   nitaaq produce  <projectDir|video.json> [--profile …] [--animatic]  → staged QC + repair + render + final QC
 *   nitaaq animatic <projectDir|video.json>                            → structural QC + sheets + half-size 15 fps animatic
 *   nitaaq validate <video.json> [--fix]
 *   nitaaq render   <projectDir|video.json> [--profile preview|animatic|draft|production] [--out file.mp4] [--no-cache]
 *   nitaaq quality  <projectDir|video.json> [--video file.mp4]
 *   nitaaq brand    <logo> [--name …]
 *   nitaaq cache    [summary|clear [namespace]]
 *   nitaaq preflight [--full] | scenes [--json] | styles | schema-export [--out dir] | voices
 *
 * Exit codes: 0 ok · 1 failed · 2 needs user input (questions printed as JSON).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { formatMotionError, isMotionError } from '../src/core/errors';
import { log } from '../src/core/logger';
import { SceneRegistry } from '../src/scenes';
import { STYLE_PRESETS } from '../src/styles/presets';
import { VideoSchema } from '../src/schema/video';
import { BriefSchema } from '../src/schema/brief';
import { CreativePlanSchema, StoryboardSchema } from '../src/schema/plan';
import { validateSpec, summarize } from '../src/validation/validate';
import { repairSpec } from '../src/validation/repair';
import { loadSpec, nodeValidateOptions, renderVideo, closeBrowser, RENDER_PROFILES, type RenderProfile } from '../src/node/render';
import { cacheSummary, clearCache } from '../src/cache/store';
import { runQuality } from '../src/qc/quality';
import { produce } from '../src/node/produce';
import { direct } from '../src/node/direct';
import { preflight } from '../src/node/preflight';
import { brandFromLogo } from '../src/brand/logo-analyzer';
import { voiceProviders } from '../src/node/tts';
import { workspace, ROOT } from '../src/node/workspace';

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos: string[] = [];
const flags = new Map<string, string>();
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags.set(a.slice(2), 'true');
    else flags.set(a.slice(2), argv[++i]);
  } else pos.push(a);
}
const flag = (k: string) => flags.get(k);
const profileOf = (d: RenderProfile): RenderProfile => {
  const p = (flag('profile') ?? d) as RenderProfile;
  if (!RENDER_PROFILES.includes(p)) throw new Error(`--profile must be one of ${RENDER_PROFILES.join(', ')} (got ${p})`);
  return p;
};
/** Accepts a project folder or a video.json path. */
function project(arg: string | undefined): { dir: string; spec: string } {
  if (!arg) throw new Error('Missing project folder or video.json path');
  const p = resolve(arg);
  if (existsSync(p) && statSync(p).isDirectory()) return { dir: p, spec: join(p, 'video.json') };
  return { dir: dirname(p), spec: p };
}
const out = (o: unknown) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');

async function main(): Promise<number> {
  switch (cmd) {
    case 'preflight': {
      const r = preflight();
      for (const c of r.checks) log.info('PREFLIGHT', `${c.ok ? '✓' : c.level === 'optional' ? '·' : '✗'} ${c.id}: ${c.detail}${!c.ok && c.action ? ` → ${c.action}` : ''}`);
      log.info('PREFLIGHT', r.ok ? 'ready' : 'not ready — fix the ✗ items above');
      return r.ok ? 0 : 1;
    }
    case 'create':
    case 'direct': {
      const file = pos[0];
      if (!file) throw new Error(`Usage: nitaaq ${cmd} <brief.json>`);
      const brief = JSON.parse(readFileSync(file, 'utf8'));
      const r = await direct({ brief, baseDir: dirname(resolve(file)), projectDir: flag('project') ? resolve(flag('project')!) : undefined, assumeNoLogo: flag('no-logo') === 'true', cleanVoice: flag('clean-voice') === 'true' });
      if (r.status === 'needs-input') {
        out({ status: 'needs-input', questions: r.questions });
        return 2;
      }
      log.info('DIRECTOR', `project ready: ${r.projectDir}`);
      if (cmd === 'direct') {
        out({ status: 'ready', project: r.projectDir, assumptions: r.assumptions, scenes: r.storyboard!.scenes.map((s) => `${s.family}/${s.variant} ${s.duration}s`) });
        return 0;
      }
      const res = await produce({ projectDir: r.projectDir, profile: profileOf('production'), deliverTo: flag('out') ? resolve(flag('out')!) : undefined, name: flag('name'), animatic: flag('animatic') === 'true' });
      out({ ok: res.ok, delivered: res.delivered, report: join(r.projectDir, 'quality_report.json'), performance: join(r.projectDir, 'performance_report.json'), summary: res.report?.summary, scores: res.report?.scores, repairs: res.repairs.length, totalSec: Math.round(res.perf.totalMs / 100) / 10 });
      return res.ok ? 0 : 1;
    }
    case 'produce': {
      const p = project(pos[0]);
      const res = await produce({ projectDir: p.dir, profile: profileOf('production'), deliverTo: flag('out') ? resolve(flag('out')!) : undefined, name: flag('name'), animatic: flag('animatic') === 'true' });
      out({ ok: res.ok, delivered: res.delivered, animatic: res.animatic, summary: res.report?.summary, scores: res.report?.scores, failed: res.report?.acceptance.filter((a) => !a.ok).map((a) => a.rule), repairs: res.repairs.length, passes: res.passes, totalSec: Math.round(res.perf.totalMs / 100) / 10 });
      return res.ok ? 0 : 1;
    }
    case 'animatic': {
      const p = project(pos[0]);
      const res = await produce({ projectDir: p.dir, stopAfterAnimatic: true });
      out({ ok: res.ok, animatic: res.animatic, contactSheet: res.report?.contactSheet, phoneView: res.report?.phoneSheet, scores: res.report?.scores, critique: res.report?.critique, totalSec: Math.round(res.perf.totalMs / 100) / 10 });
      return res.ok ? 0 : 1;
    }
    case 'cache': {
      if (pos[0] === 'clear') {
        clearCache(pos[1]);
        log.info('CACHE', `cleared ${pos[1] ?? 'everything'}`);
      }
      out(cacheSummary());
      return 0;
    }
    case 'validate': {
      const p = project(pos[0]);
      let spec = loadSpec(p.spec);
      if (flag('fix') === 'true') {
        const r = repairSpec(spec, nodeValidateOptions(p.dir, spec));
        spec = r.spec;
        writeFileSync(p.spec, JSON.stringify(spec, null, 2));
        for (const x of r.repairs) log.info('REPAIR', `${x.path}: ${x.issue} → ${x.fix}`);
      }
      const issues = validateSpec(spec, nodeValidateOptions(p.dir, spec));
      for (const i of issues) log.info('VALIDATION', `${i.severity.toUpperCase()} ${i.code} ${i.path}: ${i.message}`);
      const s = summarize(issues);
      log.info('VALIDATION', `critical ${s.critical}, error ${s.error}, warning ${s.warning}, info ${s.info}`);
      return s.critical + s.error === 0 ? 0 : 1;
    }
    case 'render': {
      const p = project(pos[0]);
      const spec = loadSpec(p.spec);
      const profile = profileOf('preview');
      const file = flag('out') ? resolve(flag('out')!) : join(p.dir, 'renders', `${spec.project.id}-${profile}.mp4`);
      mkdirSync(dirname(file), { recursive: true });
      const r = await renderVideo({ spec, projectDir: p.dir, output: file, profile, cache: flag('no-cache') !== 'true' });
      log.info('RENDER', `${file} (${(r.bytes / 1e6).toFixed(2)} MB). Not QC'd — run \`nitaaq quality\` or use \`nitaaq produce\` for a checked delivery.`);
      return 0;
    }
    case 'quality': {
      const p = project(pos[0]);
      const spec = loadSpec(p.spec);
      const video = flag('video') ? resolve(flag('video')!) : null;
      const r = await runQuality({ spec, projectDir: p.dir, video, outDir: join(p.dir, 'qc', 'manual'), profile: flag('profile') });
      for (const i of r.issues.filter((x) => x.severity !== 'info')) log.info('QUALITY', `${i.severity.toUpperCase()} ${i.code}${i.scene ? ` [${i.scene}]` : ''}: ${i.message}`);
      log.info('QUALITY', `${r.passed ? 'PASSED' : 'FAILED'} → ${join(p.dir, 'qc', 'manual', 'quality-report.json')}`);
      return r.passed ? 0 : 1;
    }
    case 'brand': {
      const logo = pos[0];
      if (!logo) throw new Error('Usage: nitaaq brand <logo.png|svg|jpg|webp> [--name …]');
      const r = await brandFromLogo(resolve(logo), { projectRelativeLogo: basename(logo), name: flag('name') });
      out({ brand: r.brand, analysis: { width: r.analysis.width, height: r.analysis.height, hasAlpha: r.analysis.hasAlpha, dominant: r.analysis.dominant.slice(0, 6) } });
      return 0;
    }
    case 'scenes': {
      const list = SceneRegistry.list().map((m) => ({ id: m.manifest.id, category: m.manifest.category, variants: m.manifest.variants, beats: m.manifest.beats, duration: [m.manifest.minDuration, m.manifest.maxDuration] }));
      if (flag('json') === 'true') out(list);
      else for (const s of list) process.stdout.write(`${s.category.padEnd(12)} ${s.id.padEnd(22)} ${s.variants.join(', ')}\n`);
      process.stdout.write(`\n${list.length} families, ${list.reduce((a, s) => a + s.variants.length, 0)} variants\n`);
      return 0;
    }
    case 'styles': {
      for (const t of Object.values(STYLE_PRESETS)) process.stdout.write(`${t.id.padEnd(18)} ${t.mode.padEnd(5)} ${t.description}\n`);
      return 0;
    }
    case 'voices': {
      out(voiceProviders());
      return 0;
    }
    case 'schema-export': {
      const dir = resolve(flag('out') ?? join(ROOT, 'schemas'));
      mkdirSync(dir, { recursive: true });
      const write = (name: string, schema: Parameters<typeof zodToJsonSchema>[0]) => writeFileSync(join(dir, `${name}.schema.json`), JSON.stringify(zodToJsonSchema(schema, { name, $refStrategy: 'none' }), null, 2));
      write('video', VideoSchema);
      write('brief', BriefSchema);
      write('creative-plan', CreativePlanSchema);
      write('storyboard', StoryboardSchema);
      const scenes: Record<string, unknown> = {};
      for (const m of SceneRegistry.list()) scenes[m.manifest.id] = { variants: m.manifest.variants, content: zodToJsonSchema(m.manifest.content as never, { $refStrategy: 'none' }) };
      writeFileSync(join(dir, 'scene-content.schema.json'), JSON.stringify(scenes, null, 2));
      log.info('SCHEMA', `JSON Schemas written to ${dir}`);
      return 0;
    }
    case 'workspace': {
      out(workspace());
      return 0;
    }
    default:
      process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, '') + '\n');
      return cmd ? 1 : 0;
  }
}

main()
  .then(async (code) => {
    await closeBrowser();
    process.exit(code);
  })
  .catch((e) => {
    if (isMotionError(e)) process.stderr.write(formatMotionError(e) + '\n');
    else process.stderr.write(`Error: ${(e as Error).message}\n`);
    process.exit(1);
  });
