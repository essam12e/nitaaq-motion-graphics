/**
 * DOM probes for QC: the composition is rendered in `qc` mode at sampled frames
 * and every text/media/box element reports geometry, fit, opacity and state.
 *
 * Speed:
 *  - stills render in parallel tabs of the shared browser (was: one by one),
 *  - reduced effects (no grain/backdrop blur — geometry is identical),
 *  - per-frame cache: the key covers exactly what a frame's DOM depends on
 *    (global look + the scenes on screen at that frame + their timing), so editing
 *    scene 7 re-probes only scene 7's frames.
 */
import { renderStill, selectComposition } from '@remotion/renderer';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import { buildTimeline, holdWindow } from '../core/timeline';
import { prepare, getBrowser, renderConcurrency, bundleKey } from '../node/render';
import type { ProbeResult as DomProbe } from '../engine/QCProbe';
import { blobDir, getJson, hashOf, setJson, pool, fileHash } from '../cache/store';
import { referencedFiles } from '../node/assets';

export interface Sample {
  frame: number;
  time: number;
  scene: string;
  sceneIndex: number;
  kind: 'hold' | 'transition' | 'edge';
}

export function sampleFrames(spec: VideoSpec, maxPerScene = 3): Sample[] {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const out: Sample[] = [];
  tl.entries.forEach((e, i) => {
    const w = holdWindow(e);
    const len = Math.max(1, w.end - w.start);
    const fr = maxPerScene >= 3 ? [0.3, 0.7, 0.97] : maxPerScene === 2 ? [0.45, 0.95] : [0.8];
    for (const f of fr) out.push({ frame: Math.min(tl.totalFrames - 1, Math.round(w.start + len * f)), time: 0, scene: e.id, sceneIndex: i, kind: 'hold' });
    if (e.transitionOut > 0) out.push({ frame: e.from + e.durationInFrames - Math.round(e.transitionOut / 2), time: 0, scene: e.id, sceneIndex: i, kind: 'transition' });
  });
  out.push({ frame: 0, time: 0, scene: tl.entries[0].id, sceneIndex: 0, kind: 'edge' });
  out.push({ frame: tl.totalFrames - 1, time: 0, scene: tl.entries[tl.entries.length - 1].id, sceneIndex: tl.entries.length - 1, kind: 'edge' });
  const uniq = new Map<number, Sample>();
  for (const s of out) if (!uniq.has(s.frame) || s.kind === 'hold') uniq.set(s.frame, { ...s, time: s.frame / spec.canvas.fps });
  return [...uniq.values()].sort((a, b) => a.frame - b.frame);
}

/** Parts of the spec every frame's look depends on (not scenes, audio or metadata). */
export function globalLookKey(spec: VideoSpec, projectDir: string): string {
  const files = referencedFiles(spec).map((f) => {
    try {
      return `${f}:${fileHash(join(projectDir, f))}`;
    } catch {
      return `${f}:missing`;
    }
  });
  return hashOf('look', bundleKey(), spec.canvas, spec.safeArea, spec.brand, spec.style, spec.direction, spec.design, spec.motion, spec.timeline, spec.project.language, spec.project.numerals, spec.captions, spec.assets, files);
}

/** Cache key of one sampled frame: global look + the scenes visible at that frame + timing. */
export function frameKey(spec: VideoSpec, globalKey: string, frame: number, effects: string): string {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const on = tl.entries.filter((e) => frame >= e.from && frame < e.from + e.durationInFrames);
  const parts = on.map((e) => {
    const prev = e.index > 0 ? spec.scenes[e.index - 1].transition : undefined;
    return { scene: spec.scenes[e.index], e: { ...e, startSec: undefined, endSec: undefined }, prev };
  });
  return hashOf('frame', globalKey, frame, effects, tl.totalFrames, parts);
}

export interface ProbeRun {
  probes: Map<number, DomProbe>;
  stills: Map<number, string>;
  rendered: number;
  cached: number;
}

/**
 * Collects DOM probes (+ half-size stills) for the given frames. Stills land in
 * `stillsDir` as probe-<frame>.png (contact sheet + pixel checks read them).
 */
export async function collectProbes(spec: VideoSpec, projectDir: string, frames: number[], stillsDir: string, opts: { effects?: 'full' | 'reduced'; useCache?: boolean } = {}): Promise<ProbeRun> {
  const effects = opts.effects ?? 'reduced';
  mkdirSync(stillsDir, { recursive: true });
  const probes = new Map<number, DomProbe>();
  const stills = new Map<number, string>();
  const gk = globalLookKey(spec, projectDir);
  const blobs = blobDir('probe-stills');
  const todo: { frame: number; key: string }[] = [];
  let cached = 0;
  for (const frame of frames) {
    const key = frameKey(spec, gk, frame, effects);
    const out = join(stillsDir, `probe-${String(frame).padStart(5, '0')}.png`);
    const hit = opts.useCache === false ? undefined : getJson<DomProbe>('probes', key);
    const blob = join(blobs, `${key}.png`);
    if (hit && existsSync(blob)) {
      copyFileSync(blob, out);
      probes.set(frame, { ...hit, frame });
      stills.set(frame, out);
      cached++;
    } else todo.push({ frame, key });
  }
  if (!todo.length) return { probes, stills, rendered: 0, cached };

  const prep = await prepare(spec, projectDir, 'qc', effects);
  const browser = await getBrowser();
  // Remotion echoes browser console lines; keep probe payloads out of the terminal.
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const filt = (orig: typeof process.stdout.write) => ((chunk: unknown, ...rest: unknown[]) => (typeof chunk === 'string' && chunk.includes('__AMD_QC__') ? true : (orig as (...a: unknown[]) => boolean)(chunk, ...rest))) as typeof process.stdout.write;
  process.stdout.write = filt(origOut);
  process.stderr.write = filt(origErr);
  try {
    const composition = await selectComposition({ serveUrl: prep.serveUrl, id: 'Main', inputProps: prep.inputProps, puppeteerInstance: browser, logLevel: 'error' });
    await pool(todo, renderConcurrency(), async ({ frame, key }) => {
      let got: DomProbe | null = null;
      const out = join(stillsDir, `probe-${String(frame).padStart(5, '0')}.png`);
      await renderStill({
        serveUrl: prep.serveUrl,
        composition,
        inputProps: prep.inputProps,
        frame,
        output: out,
        scale: 0.5,
        puppeteerInstance: browser,
        logLevel: 'error',
        onBrowserLog: (l) => {
          const i = l.text.indexOf('__AMD_QC__');
          if (i >= 0) {
            try {
              got = JSON.parse(l.text.slice(i + 10)) as DomProbe;
            } catch {
              /* partial log line: reported as a missing probe */
            }
          }
        },
      });
      stills.set(frame, out);
      if (got) {
        probes.set(frame, got);
        setJson('probes', key, got);
        copyFileSync(out, join(blobs, `${key}.png`));
      }
    });
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { probes, stills, rendered: todo.length, cached };
}
