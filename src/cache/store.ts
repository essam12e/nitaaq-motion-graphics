/**
 * Content-addressed cache (node only) at `.cache/nitaaq-motion/` (override with
 * NITAAQ_CACHE). Every entry is keyed by a hash of exactly the inputs that
 * determine it — file bytes, configuration, engine version — so a changed source
 * can never return a stale result, and an unchanged one is never recomputed.
 *
 * Namespaces: files (path+size+mtime → sha1), assets, fonts, audio, beats,
 * reference, brand, preflight, probes (per-scene QC), renders.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, rmSync, readdirSync, createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../node/workspace';

/** Bump when a cached computation's algorithm changes (invalidates everything). */
export const CACHE_VERSION = 'v2';

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.NITAAQ_CACHE || join(ROOT, '.cache', 'nitaaq-motion'));
}

/** Stable JSON (sorted keys) so equal objects hash equally. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function hashOf(...parts: unknown[]): string {
  const h = createHash('sha1');
  for (const p of parts) h.update(typeof p === 'string' ? p : stableStringify(p)).update('\u0000');
  return h.digest('hex');
}

function nsDir(ns: string): string {
  const d = join(cacheRoot(), CACHE_VERSION, ns);
  mkdirSync(d, { recursive: true });
  return d;
}

export interface CacheStats {
  hits: number;
  misses: number;
  byNs: Record<string, { hits: number; misses: number }>;
}
export const cacheStats: CacheStats = { hits: 0, misses: 0, byNs: {} };
const count = (ns: string, hit: boolean) => {
  const b = (cacheStats.byNs[ns] ??= { hits: 0, misses: 0 });
  if (hit) {
    cacheStats.hits++;
    b.hits++;
  } else {
    cacheStats.misses++;
    b.misses++;
  }
};

export function getJson<T>(ns: string, key: string): T | undefined {
  if (process.env.NITAAQ_NO_CACHE === '1') {
    count(ns, false);
    return undefined;
  }
  const f = join(nsDir(ns), `${key}.json`);
  if (!existsSync(f)) {
    count(ns, false);
    return undefined;
  }
  try {
    const v = JSON.parse(readFileSync(f, 'utf8')) as T;
    count(ns, true);
    return v;
  } catch {
    count(ns, false);
    return undefined;
  }
}

/** Atomic write (tmp + rename) so concurrent runs never read half a file. */
export function setJson<T>(ns: string, key: string, value: T): T {
  const f = join(nsDir(ns), `${key}.json`);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, f);
  return value;
}

export async function cached<T>(ns: string, key: string, compute: () => Promise<T> | T): Promise<T> {
  const hit = getJson<T>(ns, key);
  if (hit !== undefined) return hit;
  return setJson(ns, key, await compute());
}

/** Directory for binary cache artefacts (renders, thumbnails, cutouts). */
export function blobDir(ns: string): string {
  return nsDir(ns);
}

// ── file hashing with a stat fast path ─────────────────────────────────────────
const memo = new Map<string, string>();

/** SHA-1 of a file's bytes. Re-hashes only when path/size/mtime changed. */
export function fileHash(file: string): string {
  const abs = resolve(file);
  const st = statSync(abs);
  const statKey = `${abs}|${st.size}|${st.mtimeMs}`;
  const m = memo.get(statKey);
  if (m) return m;
  const key = hashOf('stat', statKey);
  const hit = getJson<{ sha1: string }>('files', key);
  if (hit) {
    memo.set(statKey, hit.sha1);
    return hit.sha1;
  }
  const sha1 = createHash('sha1').update(readFileSync(abs)).digest('hex');
  setJson('files', key, { sha1 });
  memo.set(statKey, sha1);
  return sha1;
}

/** Streaming variant for big media (does not load the whole file). */
export async function fileHashAsync(file: string): Promise<string> {
  const abs = resolve(file);
  const st = statSync(abs);
  const statKey = `${abs}|${st.size}|${st.mtimeMs}`;
  const m = memo.get(statKey);
  if (m) return m;
  const key = hashOf('stat', statKey);
  const hit = getJson<{ sha1: string }>('files', key);
  if (hit) {
    memo.set(statKey, hit.sha1);
    return hit.sha1;
  }
  const sha1 = await new Promise<string>((res, rej) => {
    const h = createHash('sha1');
    createReadStream(abs)
      .on('data', (d) => h.update(d))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej);
  });
  setJson('files', key, { sha1 });
  memo.set(statKey, sha1);
  return sha1;
}

/** Removes the whole cache (or one namespace). */
export function clearCache(ns?: string): void {
  const base = join(cacheRoot(), CACHE_VERSION);
  if (ns) rmSync(join(base, ns), { recursive: true, force: true });
  else rmSync(cacheRoot(), { recursive: true, force: true });
}

export function cacheSummary(): { root: string; namespaces: Record<string, number> } {
  const base = join(cacheRoot(), CACHE_VERSION);
  const namespaces: Record<string, number> = {};
  if (existsSync(base)) for (const ns of readdirSync(base)) namespaces[ns] = readdirSync(join(base, ns)).length;
  return { root: cacheRoot(), namespaces };
}

/** Runs async jobs with bounded concurrency (preprocessing must not exhaust memory). */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
