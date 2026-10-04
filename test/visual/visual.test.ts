/**
 * Visual regression: renders every scene family's example (default variant) in
 * 9:16 and 16:9 at a fixed frame and compares with committed baselines
 * (test/visual/baseline). Missing baselines are created on first run; set
 * UPDATE_SNAPSHOTS=1 to accept intentional changes. Diffs land in test/visual/output.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { SceneRegistry } from '../../src/scenes';
import { VideoSchema } from '../../src/schema/video';
import { buildTimeline } from '../../src/core/timeline';
import { ASPECTS } from '../../src/layout/canvas';
import { getBundle, findBrowser } from '../../src/node/bundle';

const BASE = join(__dirname, 'baseline');
const OUT = join(__dirname, 'output');
const update = process.env.UPDATE_SNAPSHOTS === '1';
const W = 270; // compared at thumbnail size: catches layout/typography regressions, tolerant to AA noise
const MAX_DIFF = 0.01; // ≤1% of pixels may differ

type Browser = Awaited<ReturnType<typeof openBrowser>>;
let browser: Browser;
let serveUrl: string;

beforeAll(async () => {
  mkdirSync(BASE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  serveUrl = await getBundle();
  browser = await openBrowser('chrome', { browserExecutable: findBrowser(), logLevel: 'error' });
});
afterAll(async () => browser?.close({ silent: true }));

async function thumb(file: string, width: number, height: number): Promise<PNG> {
  const buf = await sharp(file).resize(width, height).removeAlpha().ensureAlpha().png().toBuffer();
  return PNG.sync.read(buf);
}

for (const aspect of ['9:16', '16:9'] as const) {
  describe(`scenes @ ${aspect}`, () => {
    const mods = SceneRegistry.list();
    const { width, height } = ASPECTS[aspect];
    const spec = VideoSchema.parse({
      project: { id: 'visual', title: 'Visual regression', language: 'ar' },
      canvas: { aspect, width, height, fps: 30 },
      platform: 'generic',
      style: { preset: 'saudi-modern' },
      audio: { mode: 'none', sfx: { enabled: false } },
      // character families need a character: the Saudi layered-SVG rig fixture
      character: JSON.parse(readFileSync(join(__dirname, '../fixtures/characters/saudi/character-spec.json'), 'utf8')),
      scenes: mods.map((m, i) => ({ id: `v${i}`, type: m.manifest.id, variant: m.manifest.defaultVariant, duration: Math.max(2.4, m.manifest.defaultDuration), content: m.manifest.example })),
    });
    const tl = buildTimeline(spec.scenes, 30);
    const inputProps = { spec, mode: 'render', assetBase: '' };
    mods.forEach((m, i) => {
      it(m.manifest.id, async () => {
        const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, puppeteerInstance: browser, logLevel: 'error' });
        const e = tl.entries[i];
        const name = `${aspect.replace(':', 'x')}-${m.manifest.id}.png`;
        const out = join(OUT, name);
        await renderStill({ serveUrl, composition, inputProps, frame: e.from + Math.round(e.durationInFrames * 0.72), output: out, scale: 0.25, puppeteerInstance: browser, logLevel: 'error' });
        const h = Math.round((W * height) / width);
        const base = join(BASE, name);
        if (update || !existsSync(base)) {
          await sharp(out).resize(W, h).png().toFile(base);
          return;
        }
        const a = await thumb(out, W, h);
        const b = PNG.sync.read(readFileSync(base));
        const diff = new PNG({ width: W, height: h });
        const n = pixelmatch(a.data, b.data, diff.data, W, h, { threshold: 0.15 });
        const ratio = n / (W * h);
        if (ratio > MAX_DIFF) writeFileSync(join(OUT, `diff-${name}`), PNG.sync.write(diff));
        expect(ratio, `${name}: ${(ratio * 100).toFixed(2)}% pixels differ (see test/visual/output)`).toBeLessThanOrEqual(MAX_DIFF);
      }, 120_000);
    });
  });
}

