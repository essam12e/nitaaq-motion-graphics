/**
 * Audio tooling (node): ffprobe, silence/speech segmentation for voice sync,
 * conservative voice cleanup, and loudness stats for QC. Processing is opt-in and
 * never rewrites the user's original file (outputs go to a new file).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MotionError } from '../core/errors';
import { ROOT } from './workspace';

function which(bin: string): string | null {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  const p = r.stdout.trim();
  return r.status === 0 && p ? p : null;
}

/** ffmpeg/ffprobe: env override → system → Remotion's bundled binaries. */
export function findFfmpeg(): { ffmpeg: string; ffprobe: string; source: 'env' | 'system' | 'remotion' } {
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
