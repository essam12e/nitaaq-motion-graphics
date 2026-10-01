/**
 * Reference intelligence: turns an image, video, UI screenshot or website into
 * design PRINCIPLES (reference_style.json) — palette family, light/dark, contrast,
 * saturation, visual density, whitespace, composition weight, motion energy and
 * cutting pace. It never copies layout, copy, logos or imagery from the reference.
 * Results are cached by the reference file's hash.
 */
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { kmeans } from '../brand/logo-analyzer';
import { rgbToHex, rgbToOklch, isDark, hexToRgb } from '../brand/color';
import { cached, fileHashAsync, hashOf } from '../cache/store';
import { findFfmpeg, probe } from '../node/audio';
import { MotionError } from '../core/errors';
import { detectPatterns } from '../qc/pattern-detect';
import { STYLE_PERSONALITY, type MotionPersonalityId } from '../motion/personality';

export type ReferenceKind = 'image' | 'video' | 'website' | 'ui';

export interface FrameStats {
  palette: { hex: string; weight: number }[];
  meanLum: number;
  contrast: number;
  saturation: number;
  density: number;
  whitespace: number;
  balance: { x: number; y: number };
  pattern: boolean;
}

export interface ReferenceStyle {
  version: 1;
  source: string;
  kind: ReferenceKind;
  hash: string;
  palette: { dominant: { hex: string; weight: number }[]; background: string; accent: string; neutralShare: number };
  mode: 'dark' | 'light';
  contrast: number;
  saturation: number;
  density: number;
  whitespace: number;
  composition: 'centered' | 'left-weighted' | 'right-weighted' | 'top-heavy' | 'bottom-heavy';
  motion: { energy: number; cutsPerSecond: number; avgShotSec: number | null; pacing: 'slow' | 'medium' | 'fast' } | null;
  principles: string[];
  mapping: { style: string; personality: MotionPersonalityId; background: string; pace: 'slow' | 'medium' | 'fast'; density: 'sparse' | 'balanced' | 'dense'; reason: string };
  notCopied: string[];
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.m4v', '.gif'];
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Low-level statistics of one frame (resized to 256 px wide). */
export async function frameStats(input: string | Buffer): Promise<FrameStats> {
  const { data, info } = await sharp(input).resize(256, 256, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px: { r: number; g: number; b: number }[] = [];
  const lum = new Float64Array(w * h);
  let satSum = 0;
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] };
    lum[p] = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (p % 3 === 0) px.push(c);
    satSum += rgbToOklch(c).c;
  }
  const clusters = kmeans(px, 6).sort((a, b) => b.n - a.n);
  const total = clusters.reduce((a, c) => a + c.n, 0);
  const palette = clusters.map((c) => ({ hex: rgbToHex({ r: Math.round(c.c.r), g: Math.round(c.c.g), b: Math.round(c.c.b) }), weight: r2(c.n / total) }));
  const sorted = Float64Array.from(lum).sort();
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  // gradient magnitude → density (edges) and whitespace (flat 8×8 blocks)
  let edges = 0;
  let mx = 0;
  let my = 0;
  let mw = 0;
  const grad = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
      grad[i] = g;
      if (g > 40) {
        edges++;
        mx += x;
        my += y;
        mw++;
      }
    }
  let flat = 0;
  let blocks = 0;
  for (let by = 0; by + 8 <= h; by += 8)
    for (let bx = 0; bx + 8 <= w; bx += 8) {
      let s = 0;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) s += grad[y * w + x];
      blocks++;
      if (s / 64 < 6) flat++;
    }
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = Math.round(lum[i]);
  const pattern = detectPatterns(grey, w, h).findings.length > 0;
  return {
    palette,
    meanLum: r2(sorted.reduce((a, b) => a + b, 0) / sorted.length / 255),
    contrast: r2((p95 - p5) / 255),
    saturation: r2(Math.min(1, satSum / (w * h) / 0.15)),
    density: r2(Math.min(1, edges / (w * h) / 0.12)),
    whitespace: r2(blocks ? flat / blocks : 0),
    balance: { x: r2(mw ? mx / mw / w : 0.5), y: r2(mw ? my / mw / h : 0.5) },
    pattern,
  };
}

function videoFrames(file: string, dir: string, n = 6): string[] {
  const { ffmpeg } = findFfmpeg();
  const dur = Math.max(0.5, probe(file).duration);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `fps=${(n / dur).toFixed(4)},scale=320:-2`, '-frames:v', String(n), join(dir, 'f%02d.png')]);
  return readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => join(dir, f));
}

/** Motion energy (mean frame difference at 5 fps) and cut rate (scene changes). */
function videoMotion(file: string): { energy: number; cuts: number; duration: number } {
  const { ffmpeg } = findFfmpeg();
  const duration = probe(file).duration;
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-t', '60', '-vf', 'fps=5,scale=64:64,format=gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 26 });
  const buf = r.stdout as Buffer;
  const F = 64 * 64;
  let diff = 0;
  let n = 0;
  for (let o = F; o + F <= buf.length; o += F) {
    let d = 0;
    for (let i = 0; i < F; i++) d += Math.abs(buf[o + i] - buf[o - F + i]);
    diff += d / F / 255;
    n++;
  }
  const sc = spawnSync(ffmpeg, ['-v', 'info', '-i', file, '-t', '60', '-vf', "select='gt(scene,0.32)',showinfo", '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const cuts = (String(sc.stderr).match(/pts_time:/g) ?? []).length;
  return { energy: r2(Math.min(1, (n ? diff / n : 0) / 0.08)), cuts, duration: Math.min(60, duration) };
}

const STYLE_RULES: { style: string; when: (s: Omit<ReferenceStyle, 'mapping' | 'principles' | 'notCopied' | 'version' | 'source' | 'kind' | 'hash'>) => boolean; why: string }[] = [
  { style: 'neon', when: (s) => s.mode === 'dark' && s.saturation > 0.65 && s.contrast > 0.5, why: 'dark, highly saturated, high contrast' },
  { style: 'luxury', when: (s) => s.mode === 'dark' && s.saturation < 0.35 && s.whitespace > 0.55, why: 'dark, restrained colour, lots of empty space' },
  { style: 'cinematic', when: (s) => s.mode === 'dark' && (s.motion?.energy ?? 0) < 0.35 && s.contrast > 0.55, why: 'dark, contrasty, slow movement' },
  { style: 'sports', when: (s) => (s.motion?.energy ?? 0) > 0.7 && s.saturation > 0.4, why: 'fast, saturated movement' },
  { style: 'dark-premium', when: (s) => s.mode === 'dark' && s.saturation < 0.45, why: 'dark and calm' },
  { style: 'tech', when: (s) => s.mode === 'dark', why: 'dark product look' },
  { style: 'bold-social', when: (s) => s.mode === 'light' && s.saturation > 0.6, why: 'light with loud colour' },
  { style: 'editorial', when: (s) => s.mode === 'light' && s.density > 0.55, why: 'light, information-dense' },
  { style: 'minimal', when: (s) => s.mode === 'light' && s.whitespace > 0.7 && s.saturation < 0.3, why: 'light, sparse, quiet colour' },
  { style: 'light-premium', when: (s) => s.mode === 'light' && s.whitespace > 0.55, why: 'light and airy' },
  { style: 'saas', when: () => true, why: 'light product UI look' },
];

export function deriveReferenceStyle(source: string, kind: ReferenceKind, hash: string, frames: FrameStats[], motion: { energy: number; cuts: number; duration: number } | null): ReferenceStyle {
  const avg = (f: (s: FrameStats) => number) => r2(frames.reduce((a, s) => a + f(s), 0) / Math.max(1, frames.length));
  const merged = new Map<string, number>();
  for (const f of frames) for (const p of f.palette) merged.set(p.hex, (merged.get(p.hex) ?? 0) + p.weight / frames.length);
  const dominant = [...merged.entries()].map(([hex, weight]) => ({ hex, weight: r2(weight) })).sort((a, b) => b.weight - a.weight).slice(0, 6);
  const chroma = (hex: string) => rgbToOklch(hexToRgb(hex)).c;
  const neutrals = dominant.filter((d) => chroma(d.hex) < 0.04);
  const colourful = dominant.filter((d) => chroma(d.hex) >= 0.04).sort((a, b) => chroma(b.hex) * Math.sqrt(b.weight) - chroma(a.hex) * Math.sqrt(a.weight));
  const background = dominant[0]?.hex ?? '#111111';
  const accent = colourful[0]?.hex ?? dominant[1]?.hex ?? background;
  const meanLum = avg((s) => s.meanLum);
  const mode: 'dark' | 'light' = isDark(background) || meanLum < 0.42 ? 'dark' : 'light';
  const bx = avg((s) => s.balance.x);
  const by = avg((s) => s.balance.y);
  const composition = by < 0.42 ? 'top-heavy' : by > 0.6 ? 'bottom-heavy' : bx < 0.42 ? 'left-weighted' : bx > 0.58 ? 'right-weighted' : 'centered';
  const mot = motion ? { energy: motion.energy, cutsPerSecond: r2(motion.cuts / Math.max(1, motion.duration)), avgShotSec: motion.cuts ? r2(motion.duration / (motion.cuts + 1)) : null, pacing: (motion.energy > 0.6 || motion.cuts / Math.max(1, motion.duration) > 0.6 ? 'fast' : motion.energy < 0.3 ? 'slow' : 'medium') as 'slow' | 'medium' | 'fast' } : null;
  const base = { palette: { dominant, background, accent, neutralShare: r2(neutrals.reduce((a, n) => a + n.weight, 0)) }, mode, contrast: avg((s) => s.contrast), saturation: avg((s) => s.saturation), density: avg((s) => s.density), whitespace: avg((s) => s.whitespace), composition, motion: mot } as const;
  const ui = kind === 'ui' || kind === 'website';
  const rule = ui ? { style: mode === 'dark' ? 'tech' : 'saas', why: `${mode} product UI` } : STYLE_RULES.find((r) => r.when(base))!;
  const energy = mot?.energy ?? (base.saturation > 0.6 ? 0.6 : base.whitespace > 0.6 ? 0.3 : 0.5);
  const personality: MotionPersonalityId = energy > 0.72 ? 'energetic' : energy < 0.3 ? 'premium' : STYLE_PERSONALITY[rule.style] ?? 'tech';
  const density = base.density > 0.55 ? 'dense' : base.whitespace > 0.6 ? 'sparse' : 'balanced';
  const background_ = mode === 'dark' ? (base.saturation > 0.5 ? 'radial-light' : 'atmosphere') : base.whitespace > 0.6 ? 'soft-gradient' : 'brand-shapes';
  const pattern = frames.some((f) => f.pattern);
  const principles = [
    `${mode} canvas; background family around ${background}, accent ${accent}`,
    `contrast ${base.contrast >= 0.6 ? 'high' : base.contrast >= 0.35 ? 'medium' : 'low'}, colour ${base.saturation > 0.6 ? 'saturated' : base.saturation > 0.3 ? 'moderate' : 'restrained'}`,
    `${density} layout (${Math.round(base.whitespace * 100)}% empty space), visual weight ${composition}`,
    mot ? `${mot.pacing} pacing: motion energy ${mot.energy}, ${mot.cutsPerSecond} cuts/s` : 'still reference: pacing comes from the brief',
    ...(pattern ? ['the reference uses a dot/grid texture — NOT carried over (banned pattern); its mood is rebuilt with clean light and large forms'] : []),
  ];
  return {
    version: 1,
    source,
    kind,
    hash,
    ...base,
    principles,
    mapping: { style: rule.style, personality, background: background_, pace: mot?.pacing ?? (base.whitespace > 0.65 ? 'slow' : 'medium'), density, reason: rule.why },
    notCopied: ['layout and exact composition', 'text, logos and trademarks', 'photos, illustrations and footage', 'specific UI components', ...(pattern ? ['dot/grid/particle textures'] : [])],
  };
}

export async function analyzeReference(file: string, kind?: ReferenceKind, label?: string): Promise<ReferenceStyle> {
  if (!existsSync(file)) throw new MotionError({ code: 'REFERENCE_UNREADABLE', what: 'Reference file not found', where: file });
  const ext = extname(file).toLowerCase();
  const k: ReferenceKind = kind ?? (VIDEO_EXT.includes(ext) ? 'video' : 'image');
  if (k !== 'video' && !IMAGE_EXT.includes(ext)) throw new MotionError({ code: 'REFERENCE_UNREADABLE', what: `Unsupported reference format ${ext}`, where: file, action: `Use an image (${IMAGE_EXT.join(', ')}) or a video (${VIDEO_EXT.join(', ')}).` });
  const hash = await fileHashAsync(file);
  return cached('reference', hashOf('ref-v1', hash, k), async () => {
    if (k === 'video') {
      const dir = join(file + '.ref-frames');
      const frames = videoFrames(file, dir);
      if (!frames.length) throw new MotionError({ code: 'REFERENCE_UNREADABLE', what: 'Could not read frames from the reference video', where: file });
      const stats = await Promise.all(frames.map((f) => frameStats(f)));
      rmSync(dir, { recursive: true, force: true });
      return deriveReferenceStyle(label ?? file, k, hash, stats, videoMotion(file));
    }
    return deriveReferenceStyle(label ?? file, k, hash, [await frameStats(file)], null);
  });
}
