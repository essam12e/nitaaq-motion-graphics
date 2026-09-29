/**
 * Node-only: analyse a user logo (PNG/JPG/JPEG/WEBP/SVG) and build brand.json.
 * The logo itself is never modified; we only read pixels.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { MotionError } from '../core/errors';
import { rgbToHex, luminance } from './color';
import { derivePalette, type WeightedColor } from './palette';
import type { BrandProfile } from '../schema/video';

export const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

export interface LogoAnalysis {
  width: number;
  height: number;
  hasAlpha: boolean;
  /** Fraction of opaque pixels (for transparency detection). */
  coverage: number;
  /** Background color detected at borders when the logo is not transparent. */
  backgroundColor?: string;
  dominant: WeightedColor[];
  inkLuminance: number;
}

interface Px {
  r: number;
  g: number;
  b: number;
}

function kmeans(pixels: Px[], k: number, iterations = 12): { c: Px; n: number }[] {
  if (pixels.length === 0) return [];
  k = Math.min(k, pixels.length);
  // Deterministic init: spread over luminance-sorted samples.
  const sorted = pixels.slice().sort((a, b) => a.r * 0.3 + a.g * 0.59 + a.b * 0.11 - (b.r * 0.3 + b.g * 0.59 + b.b * 0.11));
  let centers = Array.from({ length: k }, (_, i) => ({ ...sorted[Math.floor(((i + 0.5) / k) * sorted.length)] }));
  let counts = new Array(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0 }));
    counts = new Array(k).fill(0);
    for (const p of pixels) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const c = centers[i];
        const d = (p.r - c.r) ** 2 * 0.3 + (p.g - c.g) ** 2 * 0.59 + (p.b - c.b) ** 2 * 0.11;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      sums[bi].r += p.r;
      sums[bi].g += p.g;
      sums[bi].b += p.b;
      counts[bi]++;
    }
    centers = centers.map((c, i) => (counts[i] ? { r: sums[i].r / counts[i], g: sums[i].g / counts[i], b: sums[i].b / counts[i] } : c));
  }
  return centers.map((c, i) => ({ c, n: counts[i] })).filter((x) => x.n > 0);
}

export async function analyzeLogo(file: string): Promise<LogoAnalysis> {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file)) {
    throw new MotionError({ code: 'ASSET_MISSING', what: `Logo file not found: ${file}`, where: 'BRAND', action: 'Check the path or re-upload the logo.' });
  }
  if (!LOGO_EXTENSIONS.includes(ext)) {
    throw new MotionError({
      code: 'ASSET_UNSUPPORTED',
      what: `Unsupported logo format "${ext}".`,
      where: file,
      why: `Supported formats: ${LOGO_EXTENSIONS.join(', ')}`,
      action: 'Export the logo as PNG (transparent background preferred) or SVG.',
    });
  }
  let img = sharp(file, ext === '.svg' ? { density: 300 } : {});
  const meta = await img.metadata();
  img = img.resize({ width: 220, height: 220, fit: 'inside', withoutEnlargement: false }).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px: Px[] = [];
  let opaque = 0;
  const total = info.width * info.height;
  // Border sampling to detect a solid background in non-transparent logos.
  const border: Px[] = [];
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const a = data[i + 3];
      if (a < 40) continue;
      opaque++;
      const p = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (x < 3 || y < 3 || x >= info.width - 3 || y >= info.height - 3) border.push(p);
      px.push(p);
    }
  }
  const coverage = opaque / total;
  const hasAlpha = coverage < 0.97;
  let backgroundColor: string | undefined;
  let pixels = px;
  if (!hasAlpha && border.length) {
    const avg = border.reduce((s, p) => ({ r: s.r + p.r, g: s.g + p.g, b: s.b + p.b }), { r: 0, g: 0, b: 0 });
    const bg = { r: avg.r / border.length, g: avg.g / border.length, b: avg.b / border.length };
    const variance = border.reduce((s, p) => s + (p.r - bg.r) ** 2 + (p.g - bg.g) ** 2 + (p.b - bg.b) ** 2, 0) / border.length;
    if (variance < 600) {
      backgroundColor = rgbToHex(bg);
      pixels = px.filter((p) => (p.r - bg.r) ** 2 + (p.g - bg.g) ** 2 + (p.b - bg.b) ** 2 > 900);
      if (pixels.length < 50) pixels = px;
    }
  }
  const clusters = kmeans(pixels, 6);
  const totalN = clusters.reduce((s, c) => s + c.n, 0) || 1;
  const dominant = clusters
    .map((c) => ({ hex: rgbToHex(c.c), weight: c.n / totalN }))
    .filter((c) => c.weight > 0.015)
    .sort((a, b) => b.weight - a.weight);
  const inkLuminance = dominant.reduce((s, c) => s + luminance(c.hex) * c.weight, 0);
  return { width: meta.width ?? info.width, height: meta.height ?? info.height, hasAlpha, coverage, backgroundColor, dominant, inkLuminance };
}

export async function brandFromLogo(
  logoFile: string,
  opts: { projectRelativeLogo: string; name?: string; font?: string; tone?: string[]; mode?: 'dark' | 'light' | 'auto' },
): Promise<{ brand: BrandProfile; analysis: LogoAnalysis }> {
  const analysis = await analyzeLogo(logoFile);
  const brand = derivePalette(analysis.dominant, {
    name: opts.name,
    logo: opts.projectRelativeLogo,
    font: opts.font,
    tone: opts.tone,
    mode: opts.mode ?? 'auto',
    source: 'logo',
  });
  // A non-transparent logo with a light box reads best on light layouts, unless tone says otherwise.
  if (!analysis.hasAlpha && analysis.backgroundColor && luminance(analysis.backgroundColor) > 0.8 && (!opts.mode || opts.mode === 'auto')) {
    brand.personality.push('boxed-logo');
  }
  return { brand, analysis };
}
