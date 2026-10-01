/**
 * Renderer: validates, stages project files next to the cached bundle and renders
 * H.264 MP4 with a render mode. The safe-area debug overlay and QC probe are
 * never present in draft/production output.
 *
 * Modes (explicit, never production for iteration):
 *   preview    fastest — half size, reduced effects, for frame checks
 *   animatic   half size @15 fps, reduced effects, real timing + audio — story/timing review
 *   draft      ¾ size, full effects, balanced encode
 *   production full size, full effects, quality encode
 *
 * One headless browser is shared by every render/still in the process (opening a
 * browser costs ~1 s each time; QC used to open three per video).
 */
import { renderMedia, selectComposition, renderStill, openBrowser } from '@remotion/renderer';
import { availableParallelism, cpus } from 'node:os';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VideoSchema, type VideoSpec } from '../schema/video';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { getBundle, findBrowser, stageProjectAssets, bundleKey } from './bundle';
export { bundleKey };
import { referencedFiles, assertInsideProject } from './assets';
import { validateSpec } from '../validation/validate';
import { checkFontFile } from './fonts';
import { ffmpegRun } from './audio';
import { blobDir, fileHash, hashOf } from '../cache/store';

export type RenderProfile = 'preview' | 'animatic' | 'draft' | 'production';
export const RENDER_PROFILES: RenderProfile[] = ['preview', 'animatic', 'draft', 'production'];

export interface ProfileSpec {
  scale: number;
  /** Override fps (animatic renders half the frames; timing is in seconds so nothing shifts). */
  fps?: number;
  crf: number;
  x264Preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'medium' | 'slow';
  audioBitrate: `${number}k`;
  jpegQuality: number;
  effects: 'full' | 'reduced';
}

export const PROFILES: Record<RenderProfile, ProfileSpec> = {
  preview: { scale: 0.5, crf: 30, x264Preset: 'ultrafast', audioBitrate: '96k', jpegQuality: 70, effects: 'reduced' },
  animatic: { scale: 0.5, fps: 15, crf: 30, x264Preset: 'veryfast', audioBitrate: '128k', jpegQuality: 75, effects: 'reduced' },
  draft: { scale: 0.75, crf: 23, x264Preset: 'faster', audioBitrate: '160k', jpegQuality: 85, effects: 'full' },
  production: { scale: 1, crf: 18, x264Preset: 'medium', audioBitrate: '192k', jpegQuality: 95, effects: 'full' },
};

/** Workers: every core (measured: 4 workers 21.7 s vs 3 workers 23.1 s per 180 frames on 4 cores). */
export function renderConcurrency(): number {
  const n = typeof availableParallelism === 'function' ? availableParallelism() : cpus().length;
  const env = Number(process.env.NITAAQ_CONCURRENCY);
  return Math.max(1, Math.min(n, env > 0 ? env : 8));
}

type Browser = Awaited<ReturnType<typeof openBrowser>>;
let shared: { browser: Browser; exe: string | null } | null = null;
let opening: Promise<Browser> | null = null;

/** The process-wide headless browser (opened lazily, reused by renders and stills). */
export async function getBrowser(): Promise<Browser> {
  if (shared) return shared.browser;
  if (!opening) {
    const exe = findBrowser();
    opening = openBrowser('chrome', { browserExecutable: exe, logLevel: 'error' }).then((b) => {
      shared = { browser: b, exe };
      opening = null;
      return b;
    });
  }
  return opening;
}

export async function closeBrowser(): Promise<void> {
  const s = shared;
  shared = null;
  if (s) await s.browser.close({ silent: true }).catch(() => undefined);
}

/** Removes `-metadata comment=Made with …` (and any other tool signature) from ffmpeg args. */
export function stripToolMetadata(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-metadata' && /^(comment|encoded_by|encoder|software)=/i.test(args[i + 1] ?? '') && /made with|remotion/i.test(args[i + 1] ?? '')) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

export function loadSpec(file: string): VideoSpec {
  if (!existsSync(file)) throw new MotionError({ code: 'INPUT_INVALID', what: 'video.json not found', where: file });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new MotionError({ code: 'SCHEMA_INVALID', what: 'video.json is not valid JSON', where: file, why: (e as Error).message });
  }
  const r = VideoSchema.safeParse(raw);
  if (!r.success) throw new MotionError({ code: 'SCHEMA_INVALID', what: 'video.json does not match the schema', where: file, why: r.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), action: 'Run `npm run validate -- <project>` for the full list.' });
  return r.data;
}

export function nodeValidateOptions(projectDir: string, spec: VideoSpec) {
  return {
    referencedFiles: referencedFiles(spec),
    fileExists: (f: string) => {
      try {
        return existsSync(assertInsideProject(projectDir, f));
      } catch {
        return false;
      }
    },
    fontCheck: (f: string) => {
      try {
        const c = checkFontFile(assertInsideProject(projectDir, f));
        return { ok: c.arabicCapable, reason: c.problems.join('; ') || (c.arabicCapable ? undefined : 'no Arabic glyphs') };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
  };
}

export interface PreparedRender {
  serveUrl: string;
  inputProps: Record<string, unknown>;
  browserExecutable: string | null;
}

/** Bundle + stage; shared by video renders, QC stills and thumbnails. */
export async function prepare(spec: VideoSpec, projectDir: string, mode: 'render' | 'qc' | 'preview' = 'render', effects: 'full' | 'reduced' = 'full', extra: Record<string, unknown> = {}): Promise<PreparedRender> {
  const serveUrl = await getBundle();
  const files = referencedFiles(spec);
  const assetBase = stageProjectAssets(serveUrl, spec.project.id, projectDir, files);
  const clean: VideoSpec = mode === 'render' ? { ...spec, safeArea: { ...spec.safeArea, debug: false } } : spec;
  return { serveUrl, inputProps: { spec: clean, assetBase, mode, effects, ...extra }, browserExecutable: findBrowser() };
}

export interface RenderResult {
  output: string;
  profile: RenderProfile;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  bytes: number;
  renderMs: number;
  /** True when the MP4 came from the render cache (identical inputs rendered before). */
  cached?: boolean;
}

/**
 * Render cache key: everything the pixels and audio depend on — the spec (minus
 * metadata such as createdAt and the repair log), the engine bundle, the render
 * profile and the bytes of every referenced file. Same key ⇒ byte-identical MP4.
 */
export function renderKey(spec: VideoSpec, projectDir: string, profile: RenderProfile): string {
  const files = referencedFiles(spec).map((f) => {
    try {
      return `${f}:${fileHash(join(projectDir, f))}`;
    } catch {
      return `${f}:missing`;
    }
  });
  const { metadata: _m, ...rest } = spec;
  return hashOf('render-v1', bundleKey(), profile, PROFILES[profile], rest, files);
}

export async function renderVideo(opts: { spec: VideoSpec; projectDir: string; output: string; profile?: RenderProfile; onProgress?: (p: number) => void; cache?: boolean }): Promise<RenderResult> {
  const profile = opts.profile ?? 'production';
  const P = PROFILES[profile];
  const issues = validateSpec(opts.spec, nodeValidateOptions(opts.projectDir, opts.spec));
  const blocking = issues.filter((i) => i.severity === 'critical');
  if (blocking.length) throw new MotionError({ code: 'SCHEMA_INVALID', what: `video.json has ${blocking.length} critical issue(s)`, why: blocking.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; '), action: 'Fix them (or run the auto-repair) before rendering.' });
  const t0 = Date.now();
  const useCache = opts.cache !== false && process.env.NITAAQ_NO_CACHE !== '1';
  const key = useCache ? renderKey(opts.spec, opts.projectDir, profile) : '';
  const blob = useCache ? join(blobDir('renders'), `${key}.mp4`) : '';
  const fpsOut = P.fps ?? opts.spec.canvas.fps;
  const total = Math.round(opts.spec.scenes.reduce((a, s) => a + s.duration, 0) * opts.spec.canvas.fps);
  if (useCache && existsSync(blob)) {
    mkdirSync(dirname(opts.output), { recursive: true });
    copyFileSync(blob, opts.output);
    log.stage('RENDER', `${profile}: cache hit (identical inputs rendered before)`);
    const frames = Math.round((total * fpsOut) / opts.spec.canvas.fps);
    return { output: opts.output, profile, frames, seconds: frames / fpsOut, width: Math.round(opts.spec.canvas.width * P.scale), height: Math.round(opts.spec.canvas.height * P.scale), bytes: statSync(opts.output).size, renderMs: Date.now() - t0, cached: true };
  }
  const spec = P.fps ? { ...opts.spec, canvas: { ...opts.spec.canvas, fps: P.fps } } : opts.spec;
  const prep = await prepare(spec, opts.projectDir, 'render', P.effects);
  const browser = await getBrowser();
  try {
    const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, browserExecutable: prep.browserExecutable, puppeteerInstance: browser, logLevel: 'error' });
    mkdirSync(dirname(opts.output), { recursive: true });
    log.stage('RENDER', `${profile}: ${composition.width}×${composition.height} @${composition.fps}fps × ${composition.durationInFrames} frames (scale ${P.scale}, ${P.effects} effects, ${renderConcurrency()} workers)`);
    let last = -1;
    await renderMedia({
      serveUrl: prep.serveUrl,
      composition,
      inputProps: prep.inputProps,
      codec: 'h264',
      outputLocation: opts.output,
      crf: P.crf,
      x264Preset: P.x264Preset,
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      // Zero-watermark policy: strip the renderer's "Made with …" comment tag from the MP4 metadata.
      ffmpegOverride: ({ args }) => stripToolMetadata(args),
      audioCodec: 'aac',
      audioBitrate: P.audioBitrate,
      imageFormat: 'jpeg',
      jpegQuality: P.jpegQuality,
      scale: P.scale,
      concurrency: renderConcurrency(),
      browserExecutable: prep.browserExecutable,
      puppeteerInstance: browser,
      logLevel: 'error',
      timeoutInMilliseconds: 120000,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10);
        if (pct !== last) {
          last = pct;
          opts.onProgress?.(progress);
          if (pct % 2 === 0) log.stage('RENDER', `${Math.round(progress * 100)}%`);
        }
      },
    });
    stripEncoderStrings(opts.output);
    if (useCache) copyFileSync(opts.output, blob);
    const bytes = statSync(opts.output).size;
    return { output: opts.output, profile, frames: composition.durationInFrames, seconds: composition.durationInFrames / composition.fps, width: Math.round(composition.width * P.scale), height: Math.round(composition.height * P.scale), bytes, renderMs: Date.now() - t0 };
  } catch (e) {
    if (e instanceof MotionError) throw e;
    throw new MotionError({ code: 'RENDER_FAILED', what: 'Remotion render failed', why: String((e as Error).message).slice(0, 500), action: 'Check the scene named in the error; run `npm run quality` on a preview render for details.', cause: e });
  }
}

/**
 * Zero-watermark policy, container level: a lossless remux that drops every metadata tag, the muxer's
 * "Lavf" encoder tag and the H.264 SEI message where x264 writes its name and settings. Video/audio
 * samples are copied untouched (SEI carries nothing needed for playback).
 */
export function stripEncoderStrings(file: string): void {
  const tmp = `${file}.clean.mp4`;
  try {
    ffmpegRun(['-i', file, '-map', '0', '-c', 'copy', '-bsf:v', 'filter_units=remove_types=6', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', tmp], 'MP4 metadata cleanup');
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    log.warn('RENDER', `could not remove encoder strings from ${file}: ${(e as Error).message}`);
  }
}

/** Renders a single frame (thumbnails, QC). */
export async function renderFrame(prep: PreparedRender, frame: number, output: string, scale = 1): Promise<void> {
  const browser = await getBrowser();
  const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, browserExecutable: prep.browserExecutable, puppeteerInstance: browser, logLevel: 'error' });
  await renderStill({ serveUrl: prep.serveUrl, composition, inputProps: prep.inputProps, frame, output, scale, browserExecutable: prep.browserExecutable, puppeteerInstance: browser, logLevel: 'error' });
}

export function projectPaths(projectDir: string) {
  return { spec: join(projectDir, 'video.json'), renders: join(projectDir, 'renders'), qc: join(projectDir, 'qc') };
}
