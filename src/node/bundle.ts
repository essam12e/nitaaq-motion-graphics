/** Cached Remotion bundle + browser discovery (node only). */
import { bundle } from '@remotion/bundler';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, cpSync, rmSync, renameSync } from 'node:fs';
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
      if (d === join(ROOT, 'src') && ['node', 'director', 'qc', 'cache', 'perf', 'reference', 'pipeline'].includes(name)) continue;
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
let keyMemo: string | null = null;

/** Hash of everything that goes into the browser bundle (src minus node-only code, public, package.json). */
export function bundleKey(): string {
  if (!keyMemo) keyMemo = hashTree([join(ROOT, 'src'), join(ROOT, 'public'), join(ROOT, 'package.json')]);
  return keyMemo;
}

/** Returns a serve directory for the composition. Rebuilds only when src/ or public/ changed. */
export async function getBundle(opts: { force?: boolean } = {}): Promise<string> {
  const key = bundleKey();
  if (!opts.force && memo?.key === key && existsSync(join(memo.url, 'index.html'))) return memo.url;
  const cacheDir = join(workspace().cache, 'bundles');
  const target = join(cacheDir, key);
  if (!opts.force && existsSync(join(target, 'index.html'))) {
    memo = { key, url: target };
    return target;
  }
  mkdirSync(cacheDir, { recursive: true });
  pruneBundles(cacheDir, key);
  const t = Date.now();
  log.info('RENDER', 'Building composition bundle (cached afterwards)…');
  // Build into a private folder and rename it into place: another process that is
  // rendering from an existing bundle (or building the same one) is never disturbed.
  const tmp = join(cacheDir, `.tmp-${key}-${process.pid}-${Date.now()}`);
  await bundle({ entryPoint: join(ROOT, 'src', 'remotion', 'index.ts'), publicDir: join(ROOT, 'public'), outDir: tmp, enableCaching: true });
  writeFileSync(join(tmp, '.amd-bundle'), key);
  if (opts.force && existsSync(target)) rmSync(target, { recursive: true, force: true });
  try {
    renameSync(tmp, target);
  } catch {
    // another process finished the same bundle first: use theirs
    rmSync(tmp, { recursive: true, force: true });
  }
  log.info('RENDER', `Bundle ready in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  memo = { key, url: target };
  return target;
}

/** Keeps the newest few bundles; an older one may still be served by a running process. */
function pruneBundles(cacheDir: string, keep: string) {
  const now = Date.now();
  const dirs = readdirSync(cacheDir)
    .filter((n) => n !== keep)
    .map((n) => ({ n, t: statSync(join(cacheDir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  dirs.forEach((d, i) => {
    const stale = now - d.t > (d.n.startsWith('.tmp-') ? 6 : 2) * 3600_000;
    if (i >= 3 || stale) rmSync(join(cacheDir, d.n), { recursive: true, force: true });
  });
}

/**
 * Copies project assets into the bundle's public dir under p/<id>/ and returns the
 * assetBase to use. Incremental: a file is copied only when missing or changed
 * (size/mtime), so repeated QC stills and renders don't re-copy media.
 */
export function stageProjectAssets(bundleDir: string, projectId: string, projectDir: string, files: string[]): string {
  const base = `p/${projectId}`;
  const dest = join(bundleDir, 'public', base);
  const wanted = new Set<string>();
  for (const f of files) {
    const src = join(projectDir, f);
    if (!existsSync(src)) throw new MotionError({ code: 'ASSET_MISSING', what: `Asset not found: ${f}`, where: src, why: 'The project references a file that does not exist on disk.', action: 'Put the file in the project folder or fix its path in video.json.' });
    const out = join(dest, f);
    wanted.add(out);
    const ss = statSync(src);
    if (existsSync(out)) {
      const so = statSync(out);
      if (so.size === ss.size && so.mtimeMs >= ss.mtimeMs) continue;
    }
    mkdirSync(join(out, '..'), { recursive: true });
    cpSync(src, out, { preserveTimestamps: true });
  }
  // drop files the spec no longer references (never serve stale assets)
  const prune = (d: string) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) prune(p);
      else if (!wanted.has(p)) rmSync(p, { force: true });
    }
  };
  prune(dest);
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
