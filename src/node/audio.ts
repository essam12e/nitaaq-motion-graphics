/**
 * Audio tooling (node): ffprobe, silence/speech segmentation for voice sync,
 * conservative voice cleanup, and loudness stats for QC. Processing is opt-in and
 * never rewrites the user's original file (outputs go to a new file).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MotionError } from '../core/errors';
import { ROOT } from './workspace';

function which(bin: string): string | null {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  const p = r.stdout.trim();
  return r.status === 0 && p ? p : null;
}

let ffMemo: { ffmpeg: string; ffprobe: string; source: 'env' | 'system' | 'remotion' } | null = null;

/** ffmpeg/ffprobe: env override → system → Remotion's bundled binaries. Resolved once per process. */
export function findFfmpeg(): { ffmpeg: string; ffprobe: string; source: 'env' | 'system' | 'remotion' } {
  if (ffMemo) return ffMemo;
  ffMemo = findFfmpegUncached();
  return ffMemo;
}

function findFfmpegUncached(): { ffmpeg: string; ffprobe: string; source: 'env' | 'system' | 'remotion' } {
  if (process.env.MOTION_FFMPEG && process.env.MOTION_FFPROBE) return { ffmpeg: process.env.MOTION_FFMPEG, ffprobe: process.env.MOTION_FFPROBE, source: 'env' };
  const sysF = which('ffmpeg');
  const sysP = which('ffprobe');
  if (sysF && sysP) return { ffmpeg: sysF, ffprobe: sysP, source: 'system' };
  for (const pkg of ['compositor-linux-x64-gnu', 'compositor-linux-x64-musl', 'compositor-linux-arm64-gnu', 'compositor-darwin-arm64', 'compositor-darwin-x64', 'compositor-win32-x64-msvc']) {
    const dir = join(ROOT, 'node_modules', '@remotion', pkg);
    const ext = pkg.includes('win32') ? '.exe' : '';
    if (existsSync(join(dir, 'ffprobe' + ext))) return { ffmpeg: join(dir, 'ffmpeg' + ext), ffprobe: join(dir, 'ffprobe' + ext), source: 'remotion' };
  }
  throw new MotionError({ code: 'DEPENDENCY_MISSING', what: 'ffmpeg/ffprobe not found', why: 'Neither a system ffmpeg nor Remotion’s bundled binaries were found.', action: 'Run `npm install` (Remotion ships ffmpeg) or install ffmpeg and ensure it is on PATH.' });
}

function ffEnv(): NodeJS.ProcessEnv {
  const f = findFfmpeg();
  if (f.source !== 'remotion') return process.env;
  const dir = join(f.ffprobe, '..');
  return { ...process.env, LD_LIBRARY_PATH: [dir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'), DYLD_LIBRARY_PATH: [dir, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(':') };
}

export interface ProbeResult {
  duration: number;
  format: string;
  streams: { type: 'audio' | 'video' | 'other'; codec: string; width?: number; height?: number; fps?: number; sampleRate?: number; channels?: number; pixFmt?: string; profile?: string; bitRate?: number; nbFrames?: number }[];
  bitRate?: number;
  size?: number;
  tags: Record<string, string>;
}

export function probe(file: string): ProbeResult {
  if (!existsSync(file)) throw new MotionError({ code: 'AUDIO_MISSING', what: 'Media file not found', where: file });
  const { ffprobe } = findFfmpeg();
  let raw: string;
  try {
    raw = execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 24 });
  } catch (e) {
    throw new MotionError({ code: 'AUDIO_PROBE_FAILED', what: 'ffprobe could not read the file', where: file, why: String((e as Error).message).slice(0, 300), action: 'Check the file is a valid audio/video file (mp3, wav, m4a, mp4).' });
  }
  const j = JSON.parse(raw) as { format: Record<string, string> & { tags?: Record<string, string> }; streams: (Record<string, string | number> & { tags?: Record<string, string> })[] };
  const fps = (r?: string | number) => {
    if (typeof r !== 'string' || !r.includes('/')) return undefined;
    const [a, b] = r.split('/').map(Number);
    return b ? a / b : undefined;
  };
  return {
    duration: Number(j.format.duration ?? 0),
    format: j.format.format_name,
    bitRate: j.format.bit_rate ? Number(j.format.bit_rate) : undefined,
    size: j.format.size ? Number(j.format.size) : undefined,
    tags: { ...Object.fromEntries(j.streams.flatMap((st) => Object.entries(st.tags ?? {}))), ...(j.format.tags ?? {}) },
    streams: j.streams.map((s) => ({
      type: s.codec_type === 'audio' ? 'audio' : s.codec_type === 'video' ? 'video' : 'other',
      codec: String(s.codec_name),
      width: s.width ? Number(s.width) : undefined,
      height: s.height ? Number(s.height) : undefined,
      fps: fps(s.avg_frame_rate as string),
      sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
      channels: s.channels ? Number(s.channels) : undefined,
      pixFmt: s.pix_fmt ? String(s.pix_fmt) : undefined,
      profile: s.profile ? String(s.profile) : undefined,
      bitRate: s.bit_rate ? Number(s.bit_rate) : undefined,
      nbFrames: s.nb_frames ? Number(s.nb_frames) : undefined,
    })),
  };
}

export interface Segment {
  start: number;
  end: number;
}

/**
 * Speech segments = complement of silences (ffmpeg silencedetect). Short gaps are
 * merged and tiny blips dropped so scene cuts land on real phrase boundaries.
 */
export function detectSpeechSegments(file: string, opts: { noiseDb?: number; minSilence?: number; minSegment?: number; mergeGap?: number } = {}): { duration: number; segments: Segment[]; silences: Segment[] } {
  const { ffmpeg } = findFfmpeg();
  const noise = opts.noiseDb ?? -35;
  const minSil = opts.minSilence ?? 0.35;
  const duration = probe(file).duration;
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noise}dB:d=${minSil}`, '-f', 'null', '-'], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 24 });
  const log = r.stderr ?? '';
  const silences: Segment[] = [];
  let cur: number | null = null;
  for (const line of log.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = Math.max(0, Number(s[1]));
    if (e) {
      silences.push({ start: cur ?? 0, end: Number(e[1]) });
      cur = null;
    }
  }
  if (cur !== null) silences.push({ start: cur, end: duration });
  let segs: Segment[] = [];
  let t = 0;
  for (const s of silences) {
    if (s.start > t) segs.push({ start: t, end: s.start });
    t = s.end;
  }
  if (t < duration) segs.push({ start: t, end: duration });
  const mergeGap = opts.mergeGap ?? 0.18;
  const merged: Segment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < mergeGap) last.end = s.end;
    else merged.push({ ...s });
  }
  segs = merged.filter((s) => s.end - s.start >= (opts.minSegment ?? 0.12));
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { duration, segments: segs.map((s) => ({ start: round(s.start), end: round(s.end) })), silences: silences.map((s) => ({ start: round(s.start), end: round(s.end) })) };
}

/**
 * Conservative voice cleanup: gentle high-pass, light de-noise and loudness
 * normalisation to −16 LUFS (speech). No pitch/time changes, no "AI" effects.
 * Writes a NEW file; the original user recording is kept untouched.
 */
export function cleanVoice(input: string, output: string, opts: { denoise?: boolean; targetLufs?: number } = {}): { output: string; filters: string } {
  const { ffmpeg } = findFfmpeg();
  const chain = ['highpass=f=70', opts.denoise ? 'afftdn=nr=8:nf=-45' : null, `loudnorm=I=${opts.targetLufs ?? -16}:TP=-1.5:LRA=11`].filter(Boolean).join(',');
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-af', chain, '-ar', '48000', '-ac', '1', output], { encoding: 'utf8', env: ffEnv() });
  if (r.status !== 0) throw new MotionError({ code: 'AUDIO_UNSUPPORTED', what: 'Voice cleanup failed', where: input, why: (r.stderr ?? '').slice(0, 300), action: 'Use the original file (cleanup is optional) or convert it to WAV.' });
  return { output, filters: chain };
}

export interface LoudnessStats {
  integratedLufs: number | null;
  truePeak: number | null;
  meanVolume: number | null;
  maxVolume: number | null;
}

/** Loudness measurement (ebur128 + volumedetect) for QC. */
export function loudness(file: string): LoudnessStats {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true,volumedetect', '-f', 'null', '-'], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 26 });
  const log = r.stderr ?? '';
  const num = (re: RegExp) => {
    const all = [...log.matchAll(re)];
    const m = all[all.length - 1];
    return m ? Number(m[1]) : null;
  };
  return {
    integratedLufs: num(/I:\s+(-?[\d.]+) LUFS/g),
    truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/g),
    meanVolume: num(/mean_volume: (-?[\d.]+) dB/g),
    maxVolume: num(/max_volume: (-?[\d.]+) dB/g),
  };
}

/** Runs ffmpeg with args; throws a readable error on failure. */
export function ffmpegRun(args: string[], what: string): void {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new MotionError({ code: 'RENDER_FAILED', what, why: (r.stderr ?? '').slice(0, 400) });
}

export interface MasterReport {
  applied: boolean;
  targetLufs: number;
  before: { integratedLufs: number | null; truePeak: number | null; lra: number | null };
  after?: LoudnessStats;
  clippedSamples: number;
  filters?: string;
  note: string;
}

/**
 * Master bus (Audio Engine 2.0): two-pass EBU R128 loudness normalisation to the
 * delivery target (social −14 LUFS, true peak −1 dBTP), then a brickwall limiter
 * and a clipping count. Video is stream-copied; only the audio is re-encoded.
 * Sparse films (very quiet) are lifted by at most +12 LU so silence stays silence.
 */
export function masterAudio(file: string, opts: { targetLufs?: number; truePeak?: number; bitrate?: string } = {}): MasterReport {
  const { ffmpeg } = findFfmpeg();
  const target = opts.targetLufs ?? -14;
  const tp = opts.truePeak ?? -1;
  const m = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `loudnorm=I=${target}:TP=${tp}:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 26 });
  const js = (m.stderr ?? '').match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)?.[0];
  if (!js) return { applied: false, targetLufs: target, before: { integratedLufs: null, truePeak: null, lra: null }, clippedSamples: 0, note: 'no measurable audio — master skipped' };
  const j = JSON.parse(js) as Record<string, string>;
  const inI = Number(j.input_i);
  const before = { integratedLufs: inI, truePeak: Number(j.input_tp), lra: Number(j.input_lra) };
  if (!Number.isFinite(inI) || inI < -70) return { applied: false, targetLufs: target, before, clippedSamples: 0, note: 'silent mix — master skipped' };
  const eff = Math.min(target, inI + 12);
  // 0.5 dB under the target: the AAC encoder overshoots the limiter by a few tenths (measured -0.9 dBTP at -1 target)
  const filters = `loudnorm=I=${eff}:TP=${tp}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000,alimiter=limit=${Math.pow(10, (tp - 0.5) / 20).toFixed(4)}:attack=5:release=60:level=disabled`;
  const tmp = `${file}.master.mp4`;
  ffmpegRun(['-i', file, '-map', '0:v?', '-map', '0:a', '-c:v', 'copy', '-af', filters, '-c:a', 'aac', '-b:a', opts.bitrate ?? '192k', '-ar', '48000', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', tmp], 'audio mastering');
  renameSync(tmp, file);
  const after = loudness(file);
  const clippedSamples = countClipped(file);
  return { applied: true, targetLufs: eff, before, after, clippedSamples, filters, note: `${inI.toFixed(1)} → ${after.integratedLufs ?? '?'} LUFS, true peak ${after.truePeak ?? '?'} dBFS${eff !== target ? ` (sparse mix: lifted by ≤12 LU, target ${eff.toFixed(1)})` : ''}` };
}

/** Samples at (or within 0.01 dB of) full scale — digital clipping. */
export function countClipped(file: string): number {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ar', '48000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 28, env: ffEnv() });
  if (r.status !== 0 || !r.stdout) return 0;
  const b = r.stdout as Buffer;
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  let n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) >= 0.999) n++;
  return n;
}
