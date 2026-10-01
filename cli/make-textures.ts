/**
 * Generates the grain tiles used by the Background engine (deterministic seed, so
 * the files are reproducible): tex/grain-light.png (light specks for dark styles)
 * and tex/grain-dark.png (dark specks for light styles). Alpha-only noise — the
 * layer is composited with normal blending (no blend mode), which keeps it cheap.
 *
 *   npx tsx cli/make-textures.ts
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { createRng } from '../src/core/rng';
import { ROOT } from '../src/node/workspace';

const N = 256;
for (const [name, rgb] of [['grain-light', 255], ['grain-dark', 0]] as const) {
  const rng = createRng(`grain:${name}`).next;
  const buf = Buffer.alloc(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    // two summed uniforms → soft triangular distribution; most pixels faint
    const a = Math.max(0, (rng() + rng()) / 2 - 0.45) * 2 * 64;
    buf[i * 4] = rgb;
    buf[i * 4 + 1] = rgb;
    buf[i * 4 + 2] = rgb;
    buf[i * 4 + 3] = Math.round(a);
  }
  await sharp(buf, { raw: { width: N, height: N, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(ROOT, 'public', 'tex', `${name}.png`));
  console.log(`public/tex/${name}.png`);
}
