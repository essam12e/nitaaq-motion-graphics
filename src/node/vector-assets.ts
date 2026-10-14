/**
 * Vector Asset Pipeline (node):
 *
 *   source .svg ─► byte-identical copy ─► cache ─► parse + sanitise ─► inspect ─► accept / refuse
 *
 *   parse      src/vector/svg.ts: groups, matrices, CSS inlined, shapes as exact cubic
 *              paths, gradients as data, clips / masks / patterns / filters kept
 *   sanitise   scripts, event handlers, foreignObject, external links and SMIL are
 *              dropped from the prepared document (never from the user's file)
 *   inspect    shapes / groups / segments / clips / masks / gradients, colours and a
 *              complexity score for the effect budget
 *   refuse     nothing to draw, no size; very heavy art is accepted with a warning
 *
 * The user's file is copied unchanged and stays the asset's `src` (an SVG logo keeps
 * working everywhere as before). The prepared document is written next to it
 * (`*.vector.json`, `asset.vector.doc`) so the render never re-parses or meets
 * anything the sanitiser removed. Cached by the source bytes. Local only.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { blobDir, fileHash, getJson, hashOf, setJson } from '../cache/store';
import { parseSvg, docComplexity, flattenDoc, type VectorDoc } from '../vector/svg';
import { paintRef, parseColor } from '../vector/paint';
import type { AssetSpec } from '../schema/video';

/** Bump when parsing / inspection changes (invalidates cached documents). */
export const VECTOR_PIPELINE_VERSION = 'vector-v1';

export interface VectorInspection {
  width: number;
  height: number;
  shapes: number;
  groups: number;
  segments: number;
  clips: number;
  masks: number;
  gradients: number;
  raw: number;
  maxDepth: number;
  complexity: number;
  colors: string[];
  warnings: string[];
  errors: string[];
}

export function inspectVectorDoc(doc: VectorDoc): VectorInspection {
  // colours by painted share (shape length as a cheap proxy for presence)
  // (gradients count only where a shape paints with them: a mask's ramp is not a brand colour)
  const weight = new Map<string, number>();
  const add = (hex: string, w: number) => weight.set(hex.toUpperCase(), (weight.get(hex.toUpperCase()) ?? 0) + w);
  for (const f of flattenDoc(doc)) {
    for (const c of [f.shape.paint.fill, f.shape.paint.stroke]) {
      const rgba = parseColor(c);
      if (rgba) add(rgba.hex, f.shape.length + 1);
      const g = paintRef(c) ? doc.gradients[paintRef(c)!] : undefined;
      if (g) for (const s of g.stops) add(s.color, (f.shape.length + 1) / Math.max(1, g.stops.length));
    }
  }
  const colors = [...weight.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c);
  const st = doc.stats;
  return {
    width: doc.width,
    height: doc.height,
    shapes: st.shapes,
    groups: st.groups,
    segments: st.segments,
    clips: st.clips,
    masks: st.masks,
    gradients: st.gradients,
    raw: st.raw,
    maxDepth: st.maxDepth,
    complexity: docComplexity(doc),
    colors,
    warnings: doc.warnings,
    errors: doc.errors,
  };
}

/** Reads and inspects an SVG without ingesting it (`nitaaq vector inspect`). */
export function inspectVectorFile(file: string): VectorInspection & { doc: VectorDoc } {
  const doc = parseSvg(readFileSync(resolve(file), 'utf8'));
  return { ...inspectVectorDoc(doc), doc };
}

export interface PrepareVectorOptions {
  id?: string;
  /** Asset kind: an SVG can be the logo, an icon or an illustration; default 'svg'. */
  kind?: 'svg' | 'logo' | 'icon' | 'image';
}

export interface PreparedVector {
  id: string;
  asset: AssetSpec;
  inspection: VectorInspection;
  cached: boolean;
}

export function prepareVectorAsset(projectDir: string, file: string, opts: PrepareVectorOptions = {}): PreparedVector {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new MotionError({ code: 'ASSET_MISSING', what: `File not found: ${file}`, where: abs, action: 'Check the path and try again.' });
  const ext = extname(abs).toLowerCase();
  if (ext !== '.svg') throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `Vector art must be .svg, got ${ext || 'no extension'}`, where: abs, action: 'Export the artwork as SVG.' });
  const id = opts.id ?? 'svg';
  const hash = fileHash(abs);
  const safe = basename(abs, ext).replace(/[^\w.\-]+/g, '_');
  const tag = hash.slice(0, 8);
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  const srcRel = `assets/${tag}-${safe}${ext}`;
  const srcAbs = join(projectDir, srcRel);
  if (!existsSync(srcAbs)) copyFileSync(abs, srcAbs);
  if (fileHash(srcAbs) !== hash) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'Copied SVG differs from the original', where: srcAbs, action: 'Retry; check free disk space.' });

  const key = hashOf(VECTOR_PIPELINE_VERSION, hash);
  const blob = join(blobDir('vector'), `${key}.vector.json`);
  let inspection = getJson<VectorInspection>('vector', key);
  const cached = Boolean(inspection && existsSync(blob));
  if (!inspection || !cached) {
    const doc = parseSvg(readFileSync(abs, 'utf8'));
    inspection = inspectVectorDoc(doc);
    if (inspection.errors.length) {
      throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `${basename(abs)} cannot be drawn`, why: inspection.errors.join('; '), where: abs, action: 'Export the artwork again as a plain SVG with shapes (not an embedded bitmap only).' });
    }
    writeFileSync(blob, JSON.stringify(doc));
    inspection = setJson('vector', key, inspection);
  }
  const docRel = `assets/${tag}-${safe}.vector.json`;
  copyFileSync(blob, join(projectDir, docRel));
  for (const w of inspection.warnings) log.stage('ASSETS', `${basename(abs)}: ${w}`, 'warn');
  const asset: AssetSpec = {
    kind: opts.kind ?? 'svg',
    src: srcRel,
    width: Math.max(1, Math.round(inspection.width)),
    height: Math.max(1, Math.round(inspection.height)),
    hash,
    userSupplied: true,
    preserve: true,
    hasAlpha: true,
    vector: {
      shapes: inspection.shapes,
      groups: inspection.groups,
      segments: inspection.segments,
      clips: inspection.clips,
      masks: inspection.masks,
      gradients: inspection.gradients,
      raw: inspection.raw,
      complexity: inspection.complexity,
      colors: inspection.colors.slice(0, 8),
      doc: docRel,
      warnings: inspection.warnings,
    },
  };
  return { id, asset, inspection, cached };
}

/** True when a path is (by extension) an SVG. */
export const isVectorFile = (p: string) => extname(p).toLowerCase() === '.svg';
