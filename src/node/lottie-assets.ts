/**
 * Lottie Asset Pipeline (node):
 *
 *   source (.json or .lottie) ─► byte-identical copy ─► cache ─► unpack ─► embed images ─► inspect ─► accept / refuse
 *
 *   unpack     a dotLottie (.lottie) is a ZIP: its first animation (manifest order)
 *              and its images are read with a small built-in reader (no dependency)
 *   embed      image assets referenced by path are embedded as data URIs, so the
 *              render never fetches anything (missing image → refused, not blank)
 *   inspect    size, frame rate, frame range, markers, layers / masks / mattes /
 *              effects / text, colours and a complexity score (src/media/lottie.ts)
 *   refuse     expressions (script inside the renderer, not deterministic), broken
 *              timing or size; 3D, effects and live text are accepted with a warning
 *
 * The user's file is copied unchanged; when unpacking or embedding was needed the
 * render uses a self-contained `*.lottie.json` next to it (`asset.original` keeps
 * the source). Everything is cached by the source bytes. Local only.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { blobDir, fileHash, getJson, hashOf, setJson } from '../cache/store';
import { inspectLottie, type LottieClip, type LottieInspection } from '../media/lottie';
import type { AssetSpec } from '../schema/video';

/** Bump when unpacking / embedding / inspection changes (invalidates cached results). */
export const LOTTIE_PIPELINE_VERSION = 'lottie-v1';
export const LOTTIE_EXTS = ['.json', '.lottie'];

const MAX_UNPACKED = 64 * 1024 * 1024;

// ───────────────────────── minimal ZIP reader (stored + deflate), for dotLottie

/** Reads every file of a ZIP archive. Throws on anything it does not understand. */
export function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken ZIP directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('broken ZIP entry');
    total += size;
    if (total > MAX_UNPACKED) throw new Error('archive unpacks to more than 64 MB');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_UNPACKED }));
    else throw new Error(`unsupported ZIP compression (${method})`);
  }
  return out;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };

interface Unpacked {
  doc: Record<string, unknown>;
  /** File reader for image paths (relative to the animation). */
  file: (path: string) => Buffer | undefined;
  packed: boolean;
}

function unpack(abs: string): Unpacked {
  const ext = extname(abs).toLowerCase();
  const raw = readFileSync(abs);
  const parse = (b: Buffer, what: string) => {
    try {
      return JSON.parse(b.toString('utf8').replace(/^﻿/, '')) as Record<string, unknown>;
    } catch (e) {
      throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${what} is not valid JSON`, why: (e as Error).message, where: abs, action: 'Export the animation again (Bodymovin / LottieFiles JSON).' });
    }
  };
  if (ext === '.json') {
    const dir = dirname(abs);
    return { doc: parse(raw, basename(abs)), packed: false, file: (p) => { const f = resolve(dir, p); return f.startsWith(dir) && existsSync(f) ? readFileSync(f) : undefined; } };
  }
  let files: Map<string, Buffer>;
  try {
    files = readZip(raw);
  } catch (e) {
    throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${basename(abs)} is not a readable dotLottie`, why: (e as Error).message, where: abs, action: 'Export the animation as Lottie JSON instead.' });
  }
  const manifest = files.get('manifest.json') ? parse(files.get('manifest.json')!, 'manifest.json') : {};
  const first = Array.isArray(manifest.animations) ? (manifest.animations[0] as { id?: string } | undefined)?.id : undefined;
  const animName =
    (first && [`animations/${first}.json`, `a/${first}.json`].find((n) => files.has(n))) ?? [...files.keys()].sort().find((n) => /^(animations|a)\/[^/]+\.json$/.test(n));
  if (!animName) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${basename(abs)} has no animation inside`, where: abs, action: 'Export the animation as Lottie JSON instead.' });
  const norm = (p: string) => p.replace(/^\.?\//, '').replace(/^\/+/, '');
  return {
    doc: parse(files.get(animName)!, animName),
    packed: true,
    file: (p) => {
      const n = norm(p);
      return files.get(n) ?? files.get(`images/${basename(n)}`) ?? files.get(`i/${basename(n)}`);
    },
  };
}

/** Embeds image assets referenced by path. Returns how many were embedded; missing ones throw. */
function embedImages(u: Unpacked, where: string): number {
  const assets = Array.isArray(u.doc.assets) ? (u.doc.assets as Record<string, unknown>[]) : [];
  let n = 0;
  for (const a of assets) {
    if (typeof a.p !== 'string' || Array.isArray(a.layers) || a.e === 1 || a.p.startsWith('data:')) continue;
    const rel = `${typeof a.u === 'string' ? a.u : ''}${a.p}`;
    const bytes = u.file(rel);
    if (!bytes) throw new MotionError({ code: 'ASSET_MISSING', what: `The animation uses an image that is not there: ${rel}`, where, action: 'Put the image next to the JSON (same relative path), or export with images embedded.' });
    a.p = `data:${MIME[extname(rel).toLowerCase()] ?? 'image/png'};base64,${bytes.toString('base64')}`;
    a.u = '';
    a.e = 1;
    n++;
  }
  return n;
}

/** Hashes of the image files a .json animation references next to itself (part of its cache key). */
function sideImages(abs: string): string[] {
  let doc: { assets?: { u?: string; p?: string; e?: number; layers?: unknown }[] };
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const dir = dirname(abs);
  return (Array.isArray(doc.assets) ? doc.assets : [])
    .filter((a) => typeof a?.p === 'string' && !a.layers && a.e !== 1 && !a.p.startsWith('data:'))
    .map((a) => resolve(dir, `${a.u ?? ''}${a.p}`))
    .map((f) => (f.startsWith(dir) && existsSync(f) ? `${basename(f)}:${fileHash(f)}` : `${basename(f)}:missing`));
}

export interface PrepareLottieOptions {
  id?: string;
  /** Asset kind: a Lottie can be the logo or an icon; default 'lottie'. */
  kind?: 'lottie' | 'logo' | 'icon';
  clip?: LottieClip;
}

export interface PreparedLottie {
  id: string;
  asset: AssetSpec;
  inspection: LottieInspection;
  /** The render uses a self-contained copy (unpacked / images embedded). */
  rewritten: boolean;
  cached: boolean;
}

/**
 * Ingests one Lottie animation into a project and returns its asset entry.
 * Refuses files that would render wrongly instead of rendering them wrong.
 */
export function prepareLottieAsset(projectDir: string, file: string, opts: PrepareLottieOptions = {}): PreparedLottie {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new MotionError({ code: 'ASSET_MISSING', what: `File not found: ${file}`, where: abs, action: 'Check the path and try again.' });
  const ext = extname(abs).toLowerCase();
  if (!LOTTIE_EXTS.includes(ext)) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `Lottie must be .json or .lottie, got ${ext || 'no extension'}`, where: abs, action: 'Export the animation as Lottie JSON.' });
  const id = opts.id ?? 'lottie';
  const hash = fileHash(abs);
  const safe = basename(abs, ext).replace(/[^\w.\-]+/g, '_');
  const tag = hash.slice(0, 8);
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  const originalRel = `assets/${tag}-${safe}${ext}`;
  const originalAbs = join(projectDir, originalRel);
  if (!existsSync(originalAbs)) copyFileSync(abs, originalAbs);
  if (fileHash(originalAbs) !== hash) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'Copied animation differs from the original', where: originalAbs, action: 'Retry; check free disk space.' });

  // images next to a .json are part of the input: they go into the cache key
  const key = hashOf(LOTTIE_PIPELINE_VERSION, hash, ext === '.json' ? sideImages(abs) : []);
  type Entry = { inspection: LottieInspection; rewritten: boolean };
  let entry = getJson<Entry>('lottie', key);
  const blob = join(blobDir('lottie'), `${key}.anim.json`);
  let cachedAll = Boolean(entry && (!entry.rewritten || existsSync(blob)));
  if (!entry || !cachedAll) {
    const u = unpack(abs);
    const embedded = embedImages(u, abs);
    const inspection = inspectLottie(u.doc);
    if (inspection.errors.length) {
      throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${basename(abs)} cannot be rendered faithfully`, why: inspection.errors.join('; '), where: abs, action: 'Fix it in the source animation and export again.' });
    }
    const rewritten = u.packed || embedded > 0;
    if (rewritten) writeFileSync(blob, JSON.stringify(u.doc));
    entry = setJson<Entry>('lottie', key, { inspection, rewritten });
    cachedAll = false;
  }
  const { inspection, rewritten } = entry;
  let srcRel = originalRel;
  if (rewritten) {
    srcRel = `assets/${tag}-${safe}.lottie.json`;
    // always refreshed: a changed side image keeps the original's hash but changes this copy
    copyFileSync(blob, join(projectDir, srcRel));
  }
  for (const w of inspection.warnings) log.stage('ASSETS', `${basename(abs)}: ${w}`, 'warn');
  const asset: AssetSpec = {
    kind: opts.kind ?? 'lottie',
    src: srcRel,
    width: Math.round(inspection.width),
    height: Math.round(inspection.height),
    hash,
    userSupplied: true,
    preserve: true,
    fps: inspection.fr,
    duration: Math.round(inspection.duration * 1e4) / 1e4,
    ...(rewritten ? { original: originalRel } : {}),
    ...(opts.clip && Object.keys(opts.clip).length ? { clip: opts.clip } : {}),
    lottie: { ip: inspection.ip, op: inspection.op, markers: inspection.markers, layers: inspection.layers, complexity: inspection.complexity, colors: inspection.colors.slice(0, 8), warnings: inspection.warnings },
  };
  return { id, asset, inspection, rewritten, cached: cachedAll };
}

/** Reads and inspects a Lottie file (.json / .lottie) without ingesting it (`nitaaq lottie inspect`). */
export function inspectLottieFile(file: string): LottieInspection & { packed: boolean } {
  const abs = resolve(file);
  const u = unpack(abs);
  const missing: string[] = [];
  try {
    embedImages(u, abs);
  } catch (e) {
    missing.push((e as MotionError).message);
  }
  const r = inspectLottie(u.doc);
  return { ...r, errors: [...r.errors, ...missing], packed: u.packed };
}

/** True when a path is (by extension) a Lottie animation. */
export const isLottieFile = (p: string) => LOTTIE_EXTS.includes(extname(p).toLowerCase());
