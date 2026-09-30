/**
 * Renderer: validates, stages project files next to the cached bundle and renders
 * H.264 MP4 with a render profile. The safe-area debug overlay and QC probe are
 * never present in draft/production output.
 */
import { renderMedia, selectComposition, renderStill, openBrowser } from '@remotion/renderer';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VideoSchema, type VideoSpec } from '../schema/video';
import { MotionError } from '../core/errors';
import { log } from '../core/logger';
import { getBundle, findBrowser, stageProjectAssets } from './bundle';
import { referencedFiles, assertInsideProject } from './assets';
import { validateSpec } from '../validation/validate';
import { checkFontFile } from './fonts';
import { ffmpegRun } from './audio';

export type RenderProfile = 'preview' | 'draft' | 'production';

export const PROFILES: Record<RenderProfile, { scale: number; crf: number; x264Preset: 'veryfast' | 'faster' | 'medium' | 'slow'; audioBitrate: `${number}k`; jpegQuality: number }> = {
  preview: { scale: 0.5, crf: 28, x264Preset: 'veryfast', audioBitrate: '128k', jpegQuality: 70 },
  draft: { scale: 0.75, crf: 23, x264Preset: 'faster', audioBitrate: '160k', jpegQuality: 85 },
  production: { scale: 1, crf: 18, x264Preset: 'medium', audioBitrate: '192k', jpegQuality: 95 },
};

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
export async function prepare(spec: VideoSpec, projectDir: string, mode: 'render' | 'qc' | 'preview' = 'render'): Promise<PreparedRender> {
  const serveUrl = await getBundle();
  const files = referencedFiles(spec);
  const assetBase = stageProjectAssets(serveUrl, spec.project.id, projectDir, files);
  const clean: VideoSpec = mode === 'render' ? { ...spec, safeArea: { ...spec.safeArea, debug: false } } : spec;
  return { serveUrl, inputProps: { spec: clean, assetBase, mode }, browserExecutable: findBrowser() };
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
}

export async function renderVideo(opts: { spec: VideoSpec; projectDir: string; output: string; profile?: RenderProfile; onProgress?: (p: number) => void }): Promise<RenderResult> {
  const profile = opts.profile ?? 'production';
  const P = PROFILES[profile];
  const issues = validateSpec(opts.spec, nodeValidateOptions(opts.projectDir, opts.spec));
  const blocking = issues.filter((i) => i.severity === 'critical');
  if (blocking.length) throw new MotionError({ code: 'SCHEMA_INVALID', what: `video.json has ${blocking.length} critical issue(s)`, why: blocking.slice(0, 5).map((i) => `${i.path}: ${i.message}`).join('; '), action: 'Fix them (or run the auto-repair) before rendering.' });
  const t0 = Date.now();
  const prep = await prepare(opts.spec, opts.projectDir, 'render');
  const browser = await openBrowser('chrome', { browserExecutable: prep.browserExecutable, logLevel: 'error' });
  try {
    const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, browserExecutable: prep.browserExecutable, puppeteerInstance: browser, logLevel: 'error' });
    mkdirSync(dirname(opts.output), { recursive: true });
    log.stage('RENDER', `${profile}: ${composition.width}×${composition.height} @${composition.fps}fps × ${composition.durationInFrames} frames (scale ${P.scale})`);
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
      concurrency: Math.max(1, Math.min(8, Math.floor(cpus().length * 0.75))),
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
    const bytes = statSync(opts.output).size;
    return { output: opts.output, profile, frames: composition.durationInFrames, seconds: composition.durationInFrames / composition.fps, width: Math.round(composition.width * P.scale), height: Math.round(composition.height * P.scale), bytes, renderMs: Date.now() - t0 };
  } catch (e) {
    if (e instanceof MotionError) throw e;
    throw new MotionError({ code: 'RENDER_FAILED', what: 'Remotion render failed', why: String((e as Error).message).slice(0, 500), action: 'Check the scene named in the error; run `npm run quality` on a preview render for details.', cause: e });
  } finally {
    await browser.close({ silent: true });
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
  const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, browserExecutable: prep.browserExecutable, logLevel: 'error' });
  await renderStill({ serveUrl: prep.serveUrl, composition, inputProps: prep.inputProps, frame, output, scale, browserExecutable: prep.browserExecutable, logLevel: 'error' });
}

export function projectPaths(projectDir: string) {
  return { spec: join(projectDir, 'video.json'), renders: join(projectDir, 'renders'), qc: join(projectDir, 'qc') };
}
