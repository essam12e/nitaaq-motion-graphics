/** Cached Remotion bundle + browser discovery (node only). */
import { bundle } from '@remotion/bundler';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, workspace } from './workspace';
import { log } from '../core/logger';
import { MotionError } from '../core/errors';

function hashTree(dirs: string[]): string {
  const h = createHash('sha1');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      // node-only code is not part of the browser bundle
      if (d === join(ROOT, 'src') && (name === 'node' || name === 'director' || name === 'qc')) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else h.update(relative(ROOT, p)).update(String(st.size)).update(String(st.mtimeMs));
    }
  };
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const st = statSync(d);
    if (st.isDirectory()) walk(d);
    else h.update(relative(ROOT, d)).update(String(st.size)).update(String(st.mtimeMs));
  }
  return h.digest('hex').slice(0, 16);
}

let memo: { key: string; url: string } | null = null;

/** Returns a serve directory for the composition. Rebuilds only when src/ or public/ changed. */
export async function getBundle(opts: { force?: boolean } = {}): Promise<string> {
  const key = hashTree([join(ROOT, 'src'), join(ROOT, 'public'), join(ROOT, 'package.json')]);
  if (!opts.force && memo?.key === key) return memo.url;
  const cacheDir = join(workspace().cache, 'bundles');
  const target = join(cacheDir, key);
  if (!opts.force && existsSync(join(target, 'index.html'))) {
    memo = { key, url: target };
    return target;
  }
  mkdirSync(cacheDir, { recursive: true });
  for (const old of readdirSync(cacheDir)) if (old !== key) rmSync(join(cacheDir, old), { recursive: true, force: true });
  const t = Date.now();
  log.info('RENDER', 'Building composition bundle (cached afterwards)…');
  await bundle({ entryPoint: join(ROOT, 'src', 'remotion', 'index.ts'), publicDir: join(ROOT, 'public'), outDir: target, enableCaching: true });
  writeFileSync(join(target, '.amd-bundle'), key);
  log.info('RENDER', `Bundle ready in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  memo = { key, url: target };
  return target;
}

/** Copies project assets into the bundle's public dir under p/<id>/ and returns the assetBase to use. */
export function stageProjectAssets(bundleDir: string, projectId: string, projectDir: string, files: string[]): string {
  const base = `p/${projectId}`;
  const dest = join(bundleDir, 'public', base);
  rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    const src = join(projectDir, f);
    if (!existsSync(src)) throw new MotionError({ code: 'ASSET_MISSING', what: `Asset not found: ${f}`, where: src, why: 'The project references a file that does not exist on disk.', action: 'Put the file in the project folder or fix its path in video.json.' });
    const out = join(dest, f);
    mkdirSync(join(out, '..'), { recursive: true });
    cpSync(src, out);
  }
  return base;
}

const CANDIDATES = [
  process.env.MOTION_BROWSER,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
];

/** Finds a local Chromium/headless shell; null means "let Remotion download its own". */
export function findBrowser(): string | null {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
        const p = join(pw, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}
