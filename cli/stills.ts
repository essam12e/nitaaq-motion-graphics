/**
 * Renders still frames at given times (seconds) — deterministic seek for review.
 *   tsx cli/stills.ts <projectDir> <t1,t2,...> [--scale 0.5] [--out dir]
 * Prints the PNG paths; with ≥2 frames also writes a horizontal strip (ffmpeg).
 */
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadSpec, prepare, renderFrame, closeBrowser } from '../src/node/render';

async function main() {
  const [dir, times, ...rest] = process.argv.slice(2);
  if (!dir || !times) throw new Error('usage: tsx cli/stills.ts <projectDir> <t1,t2,...> [--scale 0.5] [--out dir]');
  const arg = (k: string) => (rest.includes(k) ? rest[rest.indexOf(k) + 1] : undefined);
  const projectDir = resolve(dir);
  const spec = loadSpec(join(projectDir, 'video.json'));
  const out = resolve(arg('--out') ?? join(projectDir, 'qc', 'stills'));
  mkdirSync(out, { recursive: true });
  const scale = Number(arg('--scale') ?? 0.5);
  const prep = await prepare(spec, projectDir, 'render');
  const files: string[] = [];
  for (const t of times.split(',').map(Number)) {
    const f = join(out, `t${t.toFixed(2)}.png`);
    await renderFrame(prep, Math.round(t * spec.canvas.fps), f, scale);
    files.push(f);
  }
  await closeBrowser();
  if (files.length > 1) {
    const strip = join(out, 'strip.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `hstack=inputs=${files.length}`, strip]);
    files.push(strip);
  }
  console.log(files.join('\n'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
