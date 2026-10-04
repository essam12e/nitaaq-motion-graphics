/**
 * Character Motion Engine acceptance suite (tests A–J) + cold/warm benchmark.
 *
 *   brief (character) → direct (prepare / cache → bible → pose library → Character Director)
 *   → structural + character QC → animatic → production render → final QC → motion strip
 *
 *   npx tsx cli/test-characters.ts [--only a,f] [--profile production|preview] [--out dir] [--bench false]
 *
 * Writes <out>/character-results.json, one MP4 + motion strip per test, and benchmark.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { direct } from '../src/node/direct';
import { produce } from '../src/node/produce';
import { ROOT, workspace } from '../src/node/workspace';
import type { RenderProfile } from '../src/node/render';
import { closeBrowser } from '../src/node/render';
import { Perf } from '../src/perf/timer';
import { prepareCharacter } from '../src/node/character/package';
import { formatMotionError, isMotionError } from '../src/core/errors';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) args.set(process.argv[i].slice(2), process.argv[++i]);
const profile = (args.get('profile') ?? 'production') as RenderProfile;
const only = args.get('only')?.split(',');
const out = args.get('out') ?? join(workspace().output, 'test-characters');
const briefs = join(ROOT, 'test', 'fixtures', 'characters', 'briefs');
const saudi = join(ROOT, 'test', 'fixtures', 'characters', 'saudi');

const TESTS = [
  { key: 'a', brief: 'brief-a-single.json', what: 'Single PNG: idle, camera, 2.5D — no faked gestures (honest limits)' },
  { key: 'b', brief: 'brief-b-sheet.json', what: 'Character sheet (12 poses): extraction + classification, "استخدم هذه الشخصية وسو لي فيديو"' },
  { key: 'c', brief: 'brief-c-poses.json', what: 'Multiple PNG poses: pose library, pose cuts' },
  { key: 'd', brief: 'brief-d-svg.json', what: 'Layered SVG 16:9: rig + anchors + gestures (side layout)' },
  { key: 'e', brief: 'brief-e-identity.json', what: 'Saudi character 1:1: thobe / shemagh / agal identity consistency' },
  { key: 'f', brief: 'brief-f-phone-chat.json', what: 'Phone + chat: prop in hand, UI, typing, messages' },
  { key: 'g', brief: 'brief-g-kinetic.json', what: 'Character + Arabic kinetic typography (title shots)' },
  { key: 'h', brief: 'brief-h-product.json', what: 'Character presents the user product image' },
  { key: 'i', brief: 'brief-i-data.json', what: 'Character + sourced number and chart (nothing invented)' },
  { key: 'j', brief: 'brief-j-social-30s.json', what: '30-second social ad, 10 beats, saved to the character library' },
];

const read = (f: string) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

function strip(video: string, dest: string, seconds: number) {
  // ~78 tiles across the film: what the character does over time, at a glance
  const fps = Math.min(4, 78 / Math.max(1, seconds));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', video, '-vf', `fps=${fps.toFixed(3)},scale=150:-1,tile=13x6`, '-frames:v', '1', dest]);
}

mkdirSync(out, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const t of TESTS) {
  if (only && !only.includes(t.key)) continue;
  const brief = read(join(briefs, t.brief));
  const projectDir = join(workspace().projects, `char-test-${t.key}`);
  rmSync(projectDir, { recursive: true, force: true });
  const t0 = Date.now();
  try {
    const perf = new Perf();
    const d = await direct({ brief, baseDir: briefs, projectDir, perf, assumeNoLogo: true });
    if (d.status !== 'ready') throw new Error(`needs input: ${d.questions.map((q) => q.id).join(', ')}`);
    const r = await produce({ projectDir, profile, deliverTo: out, name: `character-${t.key}`, animatic: true, perf });
    const plan = read(join(projectDir, 'character_plan.json'));
    const spec = read(join(projectDir, 'video.json'));
    const sound = read(join(projectDir, 'sound-plan.json'));
    const cues = read(join(projectDir, 'audio-qc.json'));
    const charEvents = (sound?.report?.events ?? []).filter?.((e: { type: string }) => /^(character_|head_turn|phone_|gesture_peak|point|reaction|object_land)/.test(e.type));
    const seconds = r.report?.media?.duration ?? 0;
    if (r.delivered && existsSync(r.delivered)) strip(r.delivered, join(out, `character-${t.key}-strip.png`), seconds);
    results.push({
      test: t.key,
      what: t.what,
      ok: r.ok,
      video: r.delivered,
      seconds,
      character: spec?.character ? { name: spec.character.name, mode: spec.character.mode, complexity: spec.character.complexity, poses: Object.keys(spec.character.poses).length, garments: spec.character.identity.garments } : null,
      shots: plan?.shots?.map((s: { line: string; intent: { state: string }; poseId: string; choice: { match: string }; camera: { size: string; move: string }; cut: { type: string } }) => `${s.intent.state} → ${s.poseId} (${s.choice.match}) ${s.camera.size}/${s.camera.move} cut:${s.cut.type}`),
      needsArt: plan?.needsArt,
      scenes: d.storyboard!.scenes.map((s) => `${s.family}/${s.variant}`),
      scores: r.report?.scores,
      qc: r.report?.summary,
      remainingIssues: r.report?.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity} ${i.code}${i.scene ? ` [${i.scene}]` : ''}: ${i.message}`),
      repairs: r.repairs.map((x) => `${x.path}: ${x.fix} (${x.issue})`),
      sound: cues ? { cues: cues.stats.cues, syncErrorMaxMs: cues.stats.syncErrorMaxMs, characterEvents: Array.isArray(charEvents) ? charEvents.length : undefined } : null,
      timings: { totalSec: r.perf.totalMs / 1000, characterSec: (r.perf.stages.find((s) => s.stage === 'character')?.ms ?? 0) / 1000, animaticSec: r.perf.animaticMs / 1000, renderSec: r.perf.productionRenderMs / 1000 },
      wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    });
  } catch (e) {
    results.push({ test: t.key, what: t.what, ok: false, error: isMotionError(e) ? formatMotionError(e) : String((e as Error).stack ?? e) });
  }
  writeFileSync(join(out, 'character-results.json'), JSON.stringify({ profile, generatedAt: new Date().toISOString(), results }, null, 2));
}

// ── cold / warm character preparation (fresh cache dir, same art twice) ──
if (args.get('bench') !== 'false') {
  const prev = process.env.NITAAQ_CACHE;
  const bench: Record<string, unknown>[] = [];
  const P = ['neutral', 'happy', 'surprised', 'confused', 'thinking', 'talking', 'pointing', 'presenting', 'holding-phone', 'looking-phone', 'excited', 'listening'];
  const inputs = {
    single: { image: join(saudi, 'saudi-single.png') },
    sheet: { sheet: join(saudi, 'saudi-sheet.png') },
    poses: { poses: P.map((p) => ({ path: join(saudi, 'poses', `character-${p}.png`) })) },
    svg: { svg: join(saudi, 'saudi-layered.svg') },
  };
  for (const [kind, c] of Object.entries(inputs)) {
    const dir = mkdtempSync(join(tmpdir(), 'nitaaq-bench-'));
    process.env.NITAAQ_CACHE = dir;
    const t1 = performance.now();
    const cold = await prepareCharacter(c, { baseDir: saudi });
    const coldMs = performance.now() - t1;
    const t2 = performance.now();
    const warm = await prepareCharacter(c, { baseDir: saudi });
    const warmMs = performance.now() - t2;
    bench.push({ input: kind, poses: cold.manifest.poses.length, cold: { ms: Math.round(coldMs), cache: cold.cache, stages: cold.timings }, warm: { ms: Math.round(warmMs), cache: warm.cache }, speedup: Math.round((coldMs / Math.max(1, warmMs)) * 10) / 10 });
    rmSync(dir, { recursive: true, force: true });
  }
  if (prev === undefined) delete process.env.NITAAQ_CACHE;
  else process.env.NITAAQ_CACHE = prev;
  writeFileSync(join(out, 'benchmark.json'), JSON.stringify({ generatedAt: new Date().toISOString(), machine: { cpus: (await import('node:os')).cpus().length }, prepare: bench, render: results.map((r) => ({ test: r.test, seconds: r.seconds, timings: r.timings })) }, null, 2));
  console.log(JSON.stringify(bench, null, 1));
}
await closeBrowser();
console.log(JSON.stringify(results.map((r) => ({ test: r.test, ok: r.ok, overall: (r.scores as { overall?: number })?.overall, wall: r.wallSeconds, issues: (r.remainingIssues as string[] | undefined)?.length, error: r.error ? String(r.error).slice(0, 400) : undefined })), null, 1));
