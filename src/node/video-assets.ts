/**
 * Video Asset Pipeline (node):
 *
 *   source ─► byte-identical copy (ingest) ─► cache ─► probe ─► normalise ─► proxy ─► segment ─► clip
 *
 *   probe      codec, container, size after rotation, frame rate (and whether it
 *              is variable), pixel format, audio, duration
 *   normalise  only when the file would not decode identically everywhere:
 *              non-H.264/VP8/VP9 codecs (ProRes, HEVC, MPEG-4…), QuickTime .mov,
 *              variable frame rate, rotation metadata, odd sizes, 10-bit/4:4:4
 *              pixels, > 60 fps → constant-frame-rate H.264 yuv420p copy. The
 *              user's original stays untouched next to it (`asset.original`).
 *   proxy      long edge > 1920 px or a very high bitrate → a 960 px proxy that
 *              preview / animatic renders use; production always uses `src`
 *   segment    the best window of the requested length, measured (not assumed to
 *              start at 0): motion energy and contrast, penalising black/flat
 *              frames (fades, slates) and hard cuts inside the window
 *
 * Every step is cached by the source bytes + parameters, so a second run on the
 * same file costs only a hash. Local only: no network, no API.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { blobDir, fileHash, getJson, hashOf, setJson } from '../cache/store';
import { ffEnv, findFfmpeg } from './audio';
import { VIDEO_EXTS } from '../media/video';
import type { AssetSpec } from '../schema/video';

/** Bump when probing / normalising / segment scoring changes (invalidates cached results). */
export const VIDEO_PIPELINE_VERSION = 'video-v1';

/** Codecs that decode the same in Chromium (preview) and Remotion's compositor (render). */
const SAFE_CODECS = ['h264', 'vp8', 'vp9'];
const SAFE_PIX = ['yuv420p', 'yuvj420p'];

export interface VideoInfo {
  duration: number;
  /** Display size (rotation applied). */
  width: number;
  height: number;
  /** Average frame rate. */
  fps: number;
  /** Nominal (r_frame_rate) frame rate. */
  rFps: number;
  vfr: boolean;
  codec: string;
  container: string;
  pixFmt: string;
  rotation: number;
  hasAudio: boolean;
  bytes: number;
  bitRate: number;
}

const ratio = (r?: string) => {
  if (!r || !r.includes('/')) return Number(r) || 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : 0;
};

/** ffprobe of a video file (rotation and frame-rate variability included). */
export function probeVideo(file: string): VideoInfo {
  if (!existsSync(file)) throw new MotionError({ code: 'ASSET_MISSING', what: 'Video file not found', where: file });
  const { ffprobe } = findFfmpeg();
  let raw: string;
  try {
    raw = execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 24 });
  } catch (e) {
    throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'ffprobe could not read the video', where: file, why: String((e as Error).message).slice(0, 300), action: 'Provide an MP4 (H.264), MOV or WebM file.' });
  }
  type Stream = Record<string, unknown> & { codec_type?: string; tags?: Record<string, string>; side_data_list?: { rotation?: number }[] };
  const j = JSON.parse(raw) as { format: Record<string, string>; streams: Stream[] };
  const v = j.streams.find((s) => s.codec_type === 'video' && (s as { disposition?: { attached_pic?: number } }).disposition?.attached_pic !== 1);
  if (!v) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'The file has no video stream', where: file, action: 'Provide a video file (MP4, MOV or WebM).' });
  const rot = Number(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0) || 0;
  const rotation = ((Math.round(rot) % 360) + 360) % 360;
  let width = Number(v.width);
  let height = Number(v.height);
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];
  const fps = ratio(v.avg_frame_rate as string) || ratio(v.r_frame_rate as string);
  const rFps = ratio(v.r_frame_rate as string) || fps;
  const duration = Number(j.format.duration ?? v.duration ?? 0);
  const bytes = Number(j.format.size ?? statSync(file).size);
  return {
    duration,
    width,
    height,
    fps: Math.round(fps * 1000) / 1000,
    rFps: Math.round(rFps * 1000) / 1000,
    vfr: rFps > 0 && Math.abs(rFps - fps) / rFps > 0.01,
    codec: String(v.codec_name),
    container: String(j.format.format_name),
    pixFmt: String(v.pix_fmt ?? ''),
    rotation,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
    bytes,
    bitRate: Number(j.format.bit_rate ?? (duration ? (bytes * 8) / duration : 0)),
  };
}

/** Why a source must be normalised before rendering (empty → used as is). */
export function normalizeReasons(info: VideoInfo, ext: string): string[] {
  const r: string[] = [];
  if (!SAFE_CODECS.includes(info.codec)) r.push(`codec ${info.codec} is not decoded identically everywhere (→ H.264)`);
  if (ext === '.mov' || /mov/.test(info.container) && !/mp4/.test(info.container)) r.push('QuickTime container (→ MP4)');
  if (info.vfr) r.push(`variable frame rate (${info.fps} avg vs ${info.rFps} nominal → constant)`);
  if (info.rotation) r.push(`rotation metadata ${info.rotation}° (→ baked into the pixels)`);
  if (info.width % 2 || info.height % 2) r.push(`odd size ${info.width}×${info.height} (→ even)`);
  if (info.pixFmt && !SAFE_PIX.includes(info.pixFmt) && info.codec === 'h264') r.push(`pixel format ${info.pixFmt} (→ yuv420p)`);
  if (info.fps > 60.5) r.push(`${info.fps} fps (→ 60)`);
  return r;
}

/** A proxy pays off for large sources (long edge > 1920 px, > 20 Mbit/s or > 80 MB). */
export function needsProxy(info: VideoInfo): boolean {
  return Math.max(info.width, info.height) > 1920 || info.bitRate > 20e6 || info.bytes > 80e6;
}

function runFfmpeg(args: string[], what: string): void {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { encoding: 'utf8', env: ffEnv(), maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what, why: (r.stderr ?? '').slice(0, 400), action: 'Check that the video plays in a normal player; re-export it as MP4 (H.264).' });
}

const targetFps = (info: VideoInfo) => {
  const f = info.vfr ? info.rFps || info.fps : info.fps;
  return Math.min(60, Math.round(f * 1000) / 1000 || 30);
};

/** Constant-frame-rate H.264 yuv420p copy (visually lossless). */
export function normalizeVideo(src: string, out: string, info: VideoInfo): void {
  const fps = targetFps(info);
  runFfmpeg(
    [
      '-i', src,
      '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0?'] : []),
      '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-threads', '1',
      ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags', '+faststart', '-map_metadata', '-1',
      out,
    ],
    'Video normalisation failed',
  );
}

/** Long edge of a preview proxy: 960 px, never upscaled (even). */
export const proxyEdge = (info: Pick<VideoInfo, 'width' | 'height'>) => Math.min(960, Math.floor(Math.max(info.width, info.height) / 2) * 2);

/** Light preview proxy: 960 px long edge (or the source's, if smaller), same timing. */
export function makeProxy(src: string, out: string, info: VideoInfo): void {
  const landscape = info.width >= info.height;
  const edge = proxyEdge(info);
  runFfmpeg(
    [
      '-i', src,
      '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0?'] : []),
      '-vf', `fps=${targetFps(info)},scale=${landscape ? `${edge}:-2` : `-2:${edge}`},format=yuv420p`,
      '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-threads', '1',
      ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']),
      '-movflags', '+faststart', '-map_metadata', '-1',
      out,
    ],
    'Video proxy failed',
  );
}

// ── segment selection ────────────────────────────────────────────────────────────

export interface MotionSample {
  t: number;
  /** Mean luma 0..1. */
  mean: number;
  /** Luma standard deviation 0..1 (contrast / detail). */
  std: number;
  /** Mean absolute difference to the previous sample 0..1 (motion). */
  diff: number;
}

/** Samples luma statistics at `rate` per second on a tiny grey version of the video. */
export function sampleMotion(file: string, rate = 4): MotionSample[] {
  const { ffmpeg } = findFfmpeg();
  const W = 48;
  const H = 27;
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-vf', `fps=${rate},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1'], { env: ffEnv(), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'Could not decode the video for segment analysis', where: file, why: String(r.stderr ?? '').slice(0, 300) });
  const buf = r.stdout as Buffer;
  const n = Math.floor(buf.length / (W * H));
  const out: MotionSample[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < n; i++) {
    const f = buf.subarray(i * W * H, (i + 1) * W * H);
    let sum = 0;
    let sq = 0;
    let d = 0;
    for (let k = 0; k < f.length; k++) {
      const v = f[k] / 255;
      sum += v;
      sq += v * v;
      if (prev) d += Math.abs(v - prev[k] / 255);
    }
    const mean = sum / f.length;
    out.push({ t: i / rate, mean, std: Math.sqrt(Math.max(0, sq / f.length - mean * mean)), diff: prev ? d / f.length : 0 });
    prev = f;
  }
  return out;
}

export interface SegmentChoice {
  start: number;
  end: number;
  score: number;
  reason: string;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Best window of `want` seconds (pure, deterministic; ties → earliest).
 * Score = motion (normalised) + contrast, minus black/flat frames and hard cuts
 * inside the window. Returns the whole source when it is not longer than `want`.
 */
export function selectSegment(samples: MotionSample[], duration: number, want: number): SegmentChoice {
  const len = Math.min(want, duration);
  if (duration <= want + 0.05 || samples.length < 3) return { start: 0, end: Math.round(duration * 1000) / 1000, score: 0, reason: duration <= want + 0.05 ? 'source is not longer than the clip: whole video' : 'too short to analyse: from the start' };
  const dt = samples[1].t - samples[0].t || 0.25;
  const diffs = samples.slice(1).map((s) => s.diff);
  const maxDiff = Math.max(1e-6, ...diffs);
  const maxStd = Math.max(1e-6, ...samples.map((s) => s.std));
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const cutAt = Math.max(0.12, median * 5);
  const per = Math.max(2, Math.round(len / dt));
  let best: SegmentChoice | null = null;
  for (let i = 0; i + per <= samples.length; i++) {
    const win = samples.slice(i, i + per);
    const motion = avg(win.slice(1).map((s) => s.diff)) / maxDiff;
    const contrast = avg(win.map((s) => s.std)) / maxStd;
    const dark = win.filter((s) => s.mean < 0.06 || s.std < 0.02).length / win.length;
    const cuts = win.slice(1).filter((s) => s.diff >= cutAt).length;
    const score = 0.55 * motion + 0.35 * contrast - 0.9 * dark - 0.3 * cuts;
    if (!best || score > best.score + 1e-9) {
      const start = Math.round(samples[i].t * 100) / 100;
      best = {
        start,
        end: Math.round(Math.min(duration, start + len) * 1000) / 1000,
        score: Math.round(score * 1000) / 1000,
        reason: `best ${len.toFixed(1)} s window: motion ${(motion * 100).toFixed(0)}%, contrast ${(contrast * 100).toFixed(0)}%${dark ? `, ${(dark * 100).toFixed(0)}% dark/flat` : ''}${cuts ? `, ${cuts} cut(s)` : ', no cut inside'}`,
      };
    }
  }
  return best!;
}

// ── the pipeline ─────────────────────────────────────────────────────────────────

export interface PrepareVideoOptions {
  /** Asset id in video.json (default "video"). */
  id?: string;
  /** Wanted clip length in seconds → segment selection. Omitted: the whole video plays. */
  segment?: number | { start: number; end: number };
  /** Proxy policy (default auto: large sources only). */
  proxy?: 'auto' | 'always' | 'never';
  loop?: boolean;
  playbackRate?: number;
}

export interface PreparedVideo {
  id: string;
  asset: AssetSpec;
  info: VideoInfo;
  normalized: string[];
  cached: boolean;
}

function intoProject(projectDir: string, blob: string, rel: string): string {
  const dest = join(projectDir, rel);
  mkdirSync(join(dest, '..'), { recursive: true });
  if (!existsSync(dest) || statSync(dest).size !== statSync(blob).size) copyFileSync(blob, dest);
  return rel;
}

/**
 * Ingests one user video into a project and returns its asset entry. The
 * original is copied byte-identical; normalised / proxy copies are new files.
 */
export function prepareVideoAsset(projectDir: string, file: string, opts: PrepareVideoOptions = {}): PreparedVideo {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new MotionError({ code: 'ASSET_MISSING', what: `File not found: ${file}`, where: abs, action: 'Check the path and try again.' });
  const ext = extname(abs).toLowerCase();
  if (!VIDEO_EXTS.includes(ext)) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: `video must be ${VIDEO_EXTS.join(', ')}, got ${ext || 'no extension'}`, where: abs, action: 'Export the clip as MP4 (H.264), MOV or WebM.' });
  const id = opts.id ?? 'video';
  const hash = fileHash(abs);
  const safe = basename(abs, ext).replace(/[^\w.\-]+/g, '_');
  const tag = hash.slice(0, 8);
  // 1. original, byte-identical
  const originalRel = `assets/${tag}-${safe}${ext}`;
  const originalAbs = join(projectDir, originalRel);
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  if (!existsSync(originalAbs)) copyFileSync(abs, originalAbs);
  if (fileHash(originalAbs) !== hash) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'Copied video differs from the original', where: originalAbs, action: 'Retry; check free disk space.' });
  // 2. probe (cached by bytes)
  const infoKey = hashOf(VIDEO_PIPELINE_VERSION, 'probe', hash);
  let cachedAll = true;
  let info = getJson<VideoInfo>('video', infoKey);
  if (!info) {
    cachedAll = false;
    info = setJson('video', infoKey, probeVideo(abs));
  }
  if (!(info.duration > 0)) throw new MotionError({ code: 'ASSET_UNSUPPORTED', what: 'The video has no measurable duration', where: abs, action: 'Re-export the clip; it may be truncated.' });
  // 3. normalise when needed
  const reasons = normalizeReasons(info, ext);
  let srcRel = originalRel;
  let srcAbs = originalAbs;
  let renderInfo = info;
  if (reasons.length) {
    const key = hashOf(VIDEO_PIPELINE_VERSION, 'normalize', hash);
    const blob = join(blobDir('video'), `${key}.mp4`);
    if (!existsSync(blob)) {
      cachedAll = false;
      log.stage('VIDEO', `${basename(abs)}: normalising — ${reasons.join('; ')}`);
      normalizeVideo(abs, `${blob}.tmp.mp4`, info);
      copyFileSync(`${blob}.tmp.mp4`, blob);
    }
    srcRel = intoProject(projectDir, blob, `assets/${tag}-${safe}.norm.mp4`);
    srcAbs = join(projectDir, srcRel);
    const nKey = hashOf(VIDEO_PIPELINE_VERSION, 'probe-norm', key);
    renderInfo = getJson<VideoInfo>('video', nKey) ?? setJson('video', nKey, probeVideo(srcAbs));
  }
  // 4. proxy
  let proxyRel: string | undefined;
  const wantProxy = opts.proxy === 'always' || (opts.proxy !== 'never' && needsProxy(renderInfo));
  if (wantProxy) {
    const key = hashOf(VIDEO_PIPELINE_VERSION, 'proxy', hash);
    const blob = join(blobDir('video'), `${key}.mp4`);
    if (!existsSync(blob)) {
      cachedAll = false;
      log.stage('VIDEO', `${basename(abs)}: proxy for previews (${renderInfo.width}×${renderInfo.height} → ${proxyEdge(renderInfo)} px)`);
      makeProxy(srcAbs, `${blob}.tmp.mp4`, renderInfo);
      copyFileSync(`${blob}.tmp.mp4`, blob);
    }
    proxyRel = intoProject(projectDir, blob, `assets/${tag}-${safe}.proxy.mp4`);
  }
  // 5. segment
  let clip: AssetSpec['clip'] | undefined;
  let segmentReason: string | undefined;
  if (typeof opts.segment === 'number') {
    const key = hashOf(VIDEO_PIPELINE_VERSION, 'segment', hash, opts.segment);
    let seg = getJson<SegmentChoice>('video', key);
    if (!seg) {
      cachedAll = false;
      seg = setJson('video', key, selectSegment(sampleMotion(srcAbs), renderInfo.duration, opts.segment));
    }
    clip = { startFrom: seg.start, endAt: seg.end };
    segmentReason = seg.reason;
  } else if (opts.segment) {
    clip = { startFrom: Math.max(0, opts.segment.start), endAt: Math.min(renderInfo.duration, opts.segment.end) };
    segmentReason = 'segment given by the user';
  }
  if (opts.loop !== undefined || opts.playbackRate !== undefined) clip = { ...(clip ?? {}), ...(opts.loop !== undefined ? { loop: opts.loop } : {}), ...(opts.playbackRate !== undefined ? { playbackRate: opts.playbackRate } : {}) };
  const asset: AssetSpec = {
    kind: 'video',
    src: srcRel,
    width: renderInfo.width,
    height: renderInfo.height,
    hash,
    userSupplied: true,
    preserve: true,
    duration: Math.round(renderInfo.duration * 1000) / 1000,
    fps: renderInfo.fps,
    hasAudio: renderInfo.hasAudio,
    codec: renderInfo.codec,
    ...(srcRel !== originalRel ? { original: originalRel } : {}),
    ...(proxyRel ? { proxy: proxyRel } : {}),
    ...(clip ? { clip } : {}),
    ...(segmentReason ? { segmentReason } : {}),
  };
  return { id, asset, info, normalized: reasons, cached: cachedAll };
}

/**
 * Preview / animatic renders swap each video for its proxy (same timing, a
 * fraction of the decode cost). Production and draft keep the full source.
 */
export function withVideoProxies<T extends { assets: Record<string, AssetSpec> }>(spec: T): T {
  let changed = false;
  const assets: Record<string, AssetSpec> = {};
  for (const [k, a] of Object.entries(spec.assets)) {
    if (a.kind === 'video' && a.proxy) {
      assets[k] = { ...a, src: a.proxy };
      changed = true;
    } else assets[k] = a;
  }
  return changed ? { ...spec, assets } : spec;
}
