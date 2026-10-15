/**
 * Node side of Motion Metrics (P0-A): decodes a rendered video into small grey frames with ffmpeg
 * (10 fps, 64 px on the short side — the architecture review's method) and writes motion_metrics.json.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { findFfmpeg, ffEnv, probe } from './audio';
import { buildTimeline } from '../core/timeline';
import { ANALYSIS_FPS, computeMotionMetrics, type FrameSeries, type MotionMetrics } from '../qc/motion-metrics';

/** Analysis size: 64 px on the short side, aspect kept (portrait 64×114, landscape 114×64). */
export function analysisSize(w: number, h: number): [number, number] {
  if (!w || !h) return [64, 114];
  if (Math.abs(w / h - 9 / 16) < 0.02) return [64, 114];
  if (Math.abs(w / h - 16 / 9) < 0.02) return [114, 64];
  const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
  return w <= h ? [64, even((64 * h) / w)] : [even((64 * w) / h), 64];
}

export function decodeFrames(video: string, fps = ANALYSIS_FPS): FrameSeries {
  const v = probe(video).streams.find((s) => s.type === 'video');
  const [w, h] = analysisSize(v?.width ?? 0, v?.height ?? 0);
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', video, '-vf', `fps=${fps},scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { env: ffEnv(), maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${video}: ${r.stderr?.toString().slice(0, 400)}`);
  const buf: Buffer = r.stdout;
  const n = Math.floor(buf.length / (w * h));
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i++) frames.push(new Uint8Array(buf.buffer, buf.byteOffset + i * w * h, w * h));
  return { fps, width: w, height: h, frames };
}

export interface AnalyzeOptions {
  spec?: VideoSpec | null;
  stage?: 'animatic' | 'final' | 'external';
  /** Words (video seconds) whose visual sync to measure, e.g. emphasis words from voice_map.json. */
  words?: { word: string; start: number; end: number }[];
  wordSource?: string;
  /** Where to write motion_metrics.json (default: next to the video). Pass false to skip writing. */
  out?: string | false;
}

export function analyzeMotion(video: string, opts: AnalyzeOptions = {}): { metrics: MotionMetrics; file: string | null } {
  const series = decodeFrames(video);
  const metrics = computeMotionMetrics({ series, spec: opts.spec ?? null, video, stage: opts.stage ?? 'external', words: opts.words, wordSource: opts.wordSource });
  const file = opts.out === false ? null : opts.out ?? join(dirname(video), 'motion_metrics.json');
  if (file) writeFileSync(file, JSON.stringify(metrics, null, 2));
  return { metrics, file };
}

/** Emphasis words a spec carries (lifecycle.emphasis, scene-relative) converted to film seconds. */
export function emphasisWordsOf(spec: VideoSpec): { word: string; start: number; end: number }[] {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const out: { word: string; start: number; end: number }[] = [];
  spec.scenes.forEach((s, i) => {
    for (const e of s.motion?.lifecycle?.emphasis ?? []) {
      if (e.source === 'script') continue;
      out.push({ word: e.word, start: tl.entries[i].startSec + e.at, end: tl.entries[i].startSec + (e.end ?? e.at + 0.3) });
    }
  });
  return out;
}

/** Load a project's spec if there is one (video.json), for spec-aware metrics. */
export function specNear(projectDir: string): VideoSpec | null {
  const f = join(projectDir, 'video.json');
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as VideoSpec;
  } catch {
    return null;
  }
}
