/**
 * Dot / grid / particle regression. Renders the same three scenes in many styles
 * through the real structural QC (stills + DOM probes + masked pixel detector) and
 * requires zero pattern findings. Two controls prove the detector still works:
 *   - positive: a dots background the user explicitly allowed → must be DETECTED (reported as info)
 *   - negative: a dots background nobody allowed → must be replaced by a clean form (not detected)
 * Contact sheets are written as snapshots to test/visual/dots/<style>.png.
 *
 *   npx tsx cli/dot-regression.ts [--styles a,b,c]
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { SceneRegistry } from '../src/scenes';
import { VideoSchema, type VideoSpec } from '../src/schema/video';
import { structuralQc } from '../src/qc/quality';
import { checkBannedPatterns } from '../src/design/banned';
import { closeBrowser } from '../src/node/render';
import { ROOT, workspace } from '../src/node/workspace';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const STYLES = arg('styles')?.split(',') ?? ['saudi-modern', 'tech', 'saas', 'ai-futuristic', 'neon', 'ecommerce', 'luxury', 'minimal', 'illustration', 'whiteboard', 'launch-hype'];
const FAMILIES = ['kinetic-title', 'feature-set', 'cta-button'];
const out = join(workspace().output, 'dot-regression');
const snap = join(ROOT, 'test', 'visual', 'dots');
mkdirSync(snap, { recursive: true });

const specFor = (style: string, bg?: { kind: string; allow: boolean }): VideoSpec =>
  VideoSchema.parse({
    project: { id: `dots-${style}${bg ? `-${bg.allow ? 'allowed' : 'unallowed'}` : ''}`, title: 'dots', language: 'ar' },
    canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
    platform: 'generic',
    style: { preset: style },
    design: bg?.allow ? { allowPatterns: [bg.kind], justification: 'regression control: explicitly requested' } : {},
    audio: { mode: 'none', sfx: { enabled: false } },
    scenes: FAMILIES.map((f, i) => ({ id: `s${i}`, type: f, duration: 3, content: SceneRegistry.get(f)!.manifest.example, transition: { type: 'cut', duration: 0 }, ...(bg ? { background: { kind: bg.kind } } : {}) })),
  });

const run = async (label: string, spec: VideoSpec) => {
  const dir = join(out, label);
  const r = await structuralQc({ spec, projectDir: dir, outDir: dir, perScene: 2, useCache: false });
  const pats = r.report.issues.filter((i) => i.code === 'PATTERN_IN_FRAME');
  return { label, style: spec.style.preset, pattern: pats.map((p) => `${p.severity} ${p.element} [${p.scene}]`), banned: checkBannedPatterns(spec).filter((b) => /dot|particle|grid/.test(b.id)).map((b) => `${b.severity} ${b.id}`), sheet: join(dir, 'contact-sheet.png') };
};

const results: Awaited<ReturnType<typeof run>>[] = [];
for (const st of STYLES) {
  const r = await run(st, specFor(st));
  results.push(r);
  await sharp(r.sheet).resize({ width: 540 }).png().toFile(join(snap, `${st}.png`));
  console.log(`${st}: ${r.pattern.length ? `✗ ${r.pattern.join(', ')}` : '✓ no pattern'}`);
}
const pos = await run('control-allowed-dots', specFor('saudi-modern', { kind: 'dots', allow: true }));
const neg = await run('control-unallowed-dots', specFor('saudi-modern', { kind: 'dots', allow: false }));
copyFileSync(pos.sheet, join(out, 'control-allowed-dots.png'));
await closeBrowser();

const clean = results.every((r) => r.pattern.length === 0);
const detectorWorks = pos.pattern.length > 0 && pos.pattern.every((p) => p.startsWith('info'));
const unallowedClean = neg.pattern.length === 0;
const summary = { passed: clean && detectorWorks && unallowedClean, styles: results, controls: { allowedDots: pos, unallowedDots: neg }, checks: { cleanStyles: clean, detectorFindsRequestedDots: detectorWorks, unrequestedDotsReplaced: unallowedClean } };
writeFileSync(join(out, 'dot-regression.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.checks), summary.passed ? 'PASSED' : 'FAILED');
process.exit(summary.passed ? 0 : 1);
