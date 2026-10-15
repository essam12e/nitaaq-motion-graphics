/** tsx cli/stage-probes.ts <projectDir>  → dom_motion.json (DOM Motion Probes of a Stage film) */
import { join, resolve } from 'node:path';
import { loadSpec, closeBrowser } from '../src/node/render';
import { runStageProbes } from '../src/node/stage-probes';

async function main() {
  const dir = resolve(process.argv[2]);
  const spec = loadSpec(join(dir, 'video.json'));
  const r = await runStageProbes(spec, dir);
  await closeBrowser();
  if (!r) throw new Error('not a Stage film (no spec.stage)');
  const { report } = r;
  console.log(JSON.stringify({ samples: report.samples, camera: report.camera.shots.filter((s) => s.move !== 'static'), words: report.words, occupancy: report.occupancy, still: report.still, typography: report.typography, collisions: report.collisions }, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
