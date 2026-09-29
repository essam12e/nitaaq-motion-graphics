/**
 * Asset manager. Ingests user files into a project WITHOUT modifying them
 * (byte-for-byte copy, hash recorded), reads dimensions/alpha, and collects every
 * file a spec references so the renderer can stage exactly those.
 */
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { MotionError } from '../core/errors';
import type { VideoSpec } from '../schema/video';
import { z } from 'zod';
import { AssetKindSchema } from '../schema/video';

export type AssetKind = z.infer<typeof AssetKindSchema>;

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif'];
export const AUDIO_EXT = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'];
export const VIDEO_EXT = ['.mp4', '.mov', '.webm'];
export const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2'];

export function sha1File(p: string): string {
  return createHash('sha1').update(readFileSync(p)).digest('hex');
}

export interface IngestedAsset {
  id: string;
  kind: AssetKind;
  src: string;
  width?: number;
  height?: number;
  hash: string;
  hasAlpha?: boolean;
  bytes: number;
  userSupplied: true;
  preserve: true;
}

export async function imageInfo(file: string): Promise<{ width: number; height: number; hasAlpha: boolean; format: string }> {
  const ext = extname(file).toLowerCase();
  const img = sharp(file, ext === '.svg' ? { density: 144 } : {});
  const meta = await img.metadata();
  let hasAlpha = Boolean(meta.hasAlpha);
  if (hasAlpha) {
    // "meaningful" transparency: at least 2% of pixels not fully opaque
    const { data, info } = await sharp(file, ext === '.svg' ? { density: 72 } : {}).resize(96, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let i = 3; i < data.length; i += info.channels) if (data[i] < 250) transparent++;
    hasAlpha = transparent / (info.width * info.height) > 0.02;
  }
  if (!meta.width || !meta.height) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `Cannot read image dimensions`, where: file, why: 'The file is not a readable image.', action: 'Provide a PNG, JPG, WEBP or SVG file.' });
  return { width: meta.width, height: meta.height, hasAlpha, format: meta.format ?? ext.slice(1) };
}

/** Copies a user file into <project>/assets (or audio/, fonts/) unchanged and returns its spec entry. */
export async function ingestAsset(projectDir: string, file: string, kind: AssetKind, id?: string): Promise<IngestedAsset> {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new MotionError({ code: 'ASSET_MISSING', what: `File not found: ${file}`, where: abs, action: 'Check the path and try again.' });
  const ext = extname(abs).toLowerCase();
  const isImage = IMAGE_EXT.includes(ext);
  const isAudio = AUDIO_EXT.includes(ext);
  const isFont = FONT_EXT.includes(ext);
  const expectsImage = ['logo', 'product', 'screenshot', 'image', 'background', 'icon', 'svg', 'avatar'].includes(kind);
  if (expectsImage && !isImage) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${kind} must be an image (${IMAGE_EXT.join(', ')}), got ${ext || 'no extension'}`, where: abs, action: 'Export the file as PNG, JPG, WEBP or SVG.' });
  if (kind === 'audio' && !isAudio) throw new MotionError({ code: 'AUDIO_UNSUPPORTED', what: `Unsupported audio format ${ext}`, where: abs, action: `Use one of ${AUDIO_EXT.join(', ')}.` });
  if (kind === 'font' && !isFont) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `Unsupported font format ${ext}`, where: abs, action: `Use one of ${FONT_EXT.join(', ')}.` });
  const folder = kind === 'audio' ? 'audio' : kind === 'font' ? 'fonts' : 'assets';
  const hash = sha1File(abs);
  const safeName = basename(abs).replace(/[^\w.\-]+/g, '_');
  const rel = `${folder}/${hash.slice(0, 8)}-${safeName}`;
  const dest = join(projectDir, rel);
  mkdirSync(join(projectDir, folder), { recursive: true });
  if (!existsSync(dest)) copyFileSync(abs, dest);
  // Integrity: the stored copy must be byte-identical to the user's file.
  if (sha1File(dest) !== hash) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'Copied asset differs from the original', where: dest, why: 'Disk or filesystem error during copy.', action: 'Retry; check free disk space.' });
  const out: IngestedAsset = { id: id ?? kind, kind, src: rel, hash, bytes: statSync(abs).size, userSupplied: true, preserve: true };
  if (isImage) {
    const info = await imageInfo(dest);
    out.width = info.width;
    out.height = info.height;
    out.hasAlpha = info.hasAlpha;
  }
  return out;
}

/** Heuristic for content values that point at project files. */
export function looksLikeFile(v: string): boolean {
  if (v.startsWith('lib:') || /^(https?:|data:|blob:)/.test(v)) return false;
  return /\.(png|jpe?g|webp|svg|gif|avif|mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm|ttf|otf|woff2?)$/i.test(v);
}

/** Every project-relative file the spec references (assets, scene content, audio, fonts). */
export function referencedFiles(spec: VideoSpec): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') {
      const a = spec.assets[v];
      if (a) add(a.src);
      else if (looksLikeFile(v)) out.add(v.replace(/^\.?\//, ''));
    } else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  for (const a of Object.values(spec.assets)) add(a.src);
  for (const s of spec.scenes) {
    add(s.content);
    add(s.background?.image);
  }
  add(spec.brand?.logo);
  add(spec.brand?.logoOnDark);
  add(spec.audio.voice?.src);
  add(spec.audio.music?.src);
  add(Object.values(spec.audio.sfx.overrides));
  return [...out];
}

/** Guards against path traversal: all referenced files must live inside the project folder. */
export function assertInsideProject(projectDir: string, rel: string): string {
  const abs = resolve(projectDir, rel);
  const root = resolve(projectDir) + sep;
  if (!abs.startsWith(root)) throw new MotionError({ code: 'INPUT_INVALID', what: `Path escapes the project folder: ${rel}`, where: projectDir, action: 'Reference files by paths inside the project (assets/…, audio/…).' });
  return abs;
}

export function missingFiles(projectDir: string, spec: VideoSpec): string[] {
  return referencedFiles(spec).filter((f) => !existsSync(assertInsideProject(projectDir, f)));
}

export function relToProject(projectDir: string, abs: string): string {
  return relative(projectDir, abs).split(sep).join('/');
}
