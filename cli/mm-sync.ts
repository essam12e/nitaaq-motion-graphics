/**
 * Serves NITAAQ's own GSAP (optional dependency) to the MotionMaxxing runtime: copies
 * node_modules/gsap/dist/gsap.min.js → public/mm/runtime/vendor/gsap.min.js. MotionMaxxing ships its own
 * GSAP 3.12.5 copy; we do not vendor a second one (GSAP is under GreenSock's Standard "no charge" license).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
const dest = join(ROOT, 'public', 'mm', 'runtime', 'vendor', 'gsap.min.js');
if (!existsSync(src)) {
  console.log('[MM] gsap is not installed (optional dependency): MotionMaxxing scenes are unavailable');
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log('[MM] gsap → public/mm/runtime/vendor/gsap.min.js');
