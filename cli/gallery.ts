/**
 * Scene gallery: renders every registered family (default or all variants) from its
 * manifest example and assembles a contact sheet. Used for visual review and as the
 * source of visual-regression snapshots.
 *
 *   npx tsx cli/gallery.ts --aspect 9:16 --style saudi-modern [--variants all] [--only id,id] [--out dir]
 */
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SceneRegistry } from '../src/scenes';
import { VideoSchema, type VideoSpec } from '../src/schema/video';
import { buildTimeline } from '../src/core/timeline';
import { ASPECTS } from '../src/layout/canvas';
import { getBundle, findBrowser } from '../src/node/bundle';
import { workspace } from '../src/node/workspace';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[++i]);
}
const aspect = (args.get('aspect') ?? '9:16') as keyof typeof ASPECTS;
const style = args.get('style') ?? 'saudi-modern';
const all = args.get('variants') === 'all';
const only = args.get('only')?.split(',');
const lang = (args.get('lang') ?? 'ar') as 'ar' | 'en';
const out = args.get('out') ?? join(workspace().output, 'gallery', `${style}-${aspect.replace(':', 'x')}${all ? '-all' : ''}`);
const at = Number(args.get('at') ?? 0.72);
mkdirSync(out, { recursive: true });

const [w, h] = ASPECTS[aspect] ? [ASPECTS[aspect].width, ASPECTS[aspect].height] : [1080, 1920];
const items: { id: string; variant: string }[] = [];
for (const m of SceneRegistry.list()) {
  if (only && !only.includes(m.manifest.id)) continue;
  for (const v of all ? m.manifest.variants : [m.manifest.defaultVariant]) items.push({ id: m.manifest.id, variant: v });
}
const spec: VideoSpec = VideoSchema.parse({
  project: { id: 'gallery', title: 'Gallery', language: lang },
  canvas: { aspect, width: w, height: h, fps: 30 },
  platform: 'generic',
  style: { preset: style },
  audio: { mode: 'none', sfx: { enabled: false } },
  scenes: items.map((it, i) => ({
    id: `g${i}`,
    type: it.id,
    variant: it.variant,
    duration: Math.max(2.4, SceneRegistry.get(it.id)!.manifest.defaultDuration),
    content: SceneRegistry.get(it.id)!.manifest.example,
    transition: { type: 'cut', duration: 0 },
  })),
});
const tl = buildTimeline(spec.scenes, 30);
const browserExecutable = findBrowser();
const serveUrl = await getBundle();
const inputProps = { spec, mode: 'render', assetBase: '' };
const puppeteerInstance = await openBrowser('chrome', { browserExecutable, logLevel: 'error' });
const composition = await selectComposition({ serveUrl, id: 'Main', inputProps, browserExecutable, puppeteerInstance, logLevel: 'error' });
const files: string[] = [];
const errors: string[] = [];
for (let i = 0; i < items.length; i++) {
  const e = tl.entries[i];
  const frame = e.from + Math.round(e.durationInFrames * at);
  const file = join(out, `${String(i).padStart(3, '0')}-${items[i].id}-${items[i].variant}.png`);
  await renderStill({
    serveUrl,
    composition,
    inputProps,
    frame,
    output: file,
    browserExecutable,
    scale: 0.5,
    puppeteerInstance,
    logLevel: 'error',
    onBrowserLog: (l) => {
      if (l.type === 'error') errors.push(`${items[i].id}/${items[i].variant}: ${l.text.slice(0, 240)}`);
    },
  });
  files.push(file);
  process.stdout.write('.');
}
console.log('');
await puppeteerInstance.close({ silent: true });
// contact sheet
const cols = aspect === '16:9' ? 5 : 8;
const tw = aspect === '16:9' ? 384 : 240;
const th = Math.round((tw * h) / w);
const label = 26;
const rows = Math.ceil(files.length / cols);
const comps: sharp.OverlayOptions[] = [];
for (let i = 0; i < files.length; i++) {
  const x = (i % cols) * tw;
  const y = Math.floor(i / cols) * (th + label);
  comps.push({ input: await sharp(files[i]).resize(tw, th).toBuffer(), left: x, top: y });
  const txt = `${items[i].id}/${items[i].variant}`;
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${label}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="18" font-family="monospace" font-size="13" fill="#ddd">${txt}</text></svg>`), left: x, top: y + th });
}
const sheet = join(out, 'contact-sheet.png');
await sharp({ create: { width: cols * tw, height: rows * (th + label), channels: 3, background: '#000' } }).composite(comps).png().toFile(sheet);
writeFileSync(join(out, 'errors.json'), JSON.stringify(errors, null, 2));
console.log(`${files.length} stills → ${sheet}`);
if (errors.length) console.log(`${errors.length} browser errors:\n` + errors.slice(0, 20).join('\n'));
