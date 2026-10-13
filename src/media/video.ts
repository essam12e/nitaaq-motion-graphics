/**
 * Media kinds and the video clip model (pure, browser-safe).
 *
 * A clip says WHICH part of a source video plays and HOW: a source segment
 * [startFrom, endAt) in seconds, a playback rate, loop or hold, and when it
 * starts inside the scene (delay). The source time shown at any scene-local
 * time is a pure function of the clip (`videoTimeAt`), so the renderer, the
 * deterministic seek and the tests all agree on the exact frame — Remotion's
 * frame stays the only clock; the video element never plays by itself.
 */

export type MediaKind = 'image' | 'video' | 'svg' | 'lottie';

export const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.m4v'];
const SVG_EXTS = ['.svg'];
const LOTTIE_EXTS = ['.lottie', '.json'];

const extOf = (src: string) => {
  const clean = src.split(/[?#]/)[0].toLowerCase();
  const i = clean.lastIndexOf('.');
  return i >= 0 ? clean.slice(i) : '';
};

/**
 * What a media reference is. The asset entry's kind wins (it was measured at
 * ingest); otherwise the file extension decides. Unknown → image (the old
 * behaviour of <Media>).
 */
export function detectMediaKind(src: string | undefined, meta?: { kind?: string } | null): MediaKind {
  if (meta?.kind === 'video') return 'video';
  if (meta?.kind === 'svg') return 'svg';
  if (meta?.kind === 'lottie') return 'lottie';
  if (!src) return 'image';
  if (/^data:video\//.test(src)) return 'video';
  const ext = extOf(src);
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (SVG_EXTS.includes(ext)) return 'svg';
  if (LOTTIE_EXTS.includes(ext)) return 'lottie';
  return 'image';
}

export interface VideoClip {
  /** Source second the clip starts at (trim in). Default 0. */
  startFrom?: number;
  /** Source second the clip ends at (trim out, exclusive). Default: end of the source. */
  endAt?: number;
  /** Repeat the segment while the scene lasts (otherwise the last frame holds). */
  loop?: boolean;
  /** Source seconds per scene second (0.25–4). Default 1. */
  playbackRate?: number;
  /** Scene seconds before the clip starts (the first frame is shown meanwhile). */
  delay?: number;
  /** Video audio is off unless asked for (the Sound Director owns the mix). */
  muted?: boolean;
  /** 0–1 gain of the video's own audio when not muted. */
  volume?: number;
}

export interface ResolvedClip {
  start: number;
  end: number;
  /** Segment length in source seconds. */
  length: number;
  rate: number;
  loop: boolean;
  delay: number;
  muted: boolean;
  volume: number;
}

export const MIN_RATE = 0.25;
export const MAX_RATE = 4;

/** Clamps a clip to the source (duration in seconds; unknown → open-ended). */
export function resolveClip(clip: VideoClip | undefined, sourceDuration?: number): ResolvedClip {
  const c = clip ?? {};
  const dur = sourceDuration && sourceDuration > 0 ? sourceDuration : Infinity;
  const start = Math.min(Math.max(0, c.startFrom ?? 0), Number.isFinite(dur) ? Math.max(0, dur - 0.04) : Infinity);
  let end = c.endAt !== undefined ? Math.min(c.endAt, dur) : dur;
  if (!(end > start)) end = Number.isFinite(dur) ? dur : start + 1;
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, c.playbackRate ?? 1));
  return {
    start,
    end,
    length: end - start,
    rate,
    loop: Boolean(c.loop),
    delay: Math.max(0, c.delay ?? 0),
    muted: c.muted !== false,
    volume: Math.min(1, Math.max(0, c.volume ?? 1)),
  };
}

export type ClipPhase = 'before' | 'playing' | 'held';

export interface ClipTime {
  /** Source second to show. */
  time: number;
  phase: ClipPhase;
  /** How many times the segment has wrapped (loop). */
  loopIndex: number;
}

/** Last showable instant of a segment (one source frame before `end`). */
const lastInstant = (r: ResolvedClip, sourceFps: number) => Math.max(r.start, r.end - 1 / Math.max(1, sourceFps));

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Source time shown at scene-local second `localSec`. Pure: the same inputs
 * give the same frame on every worker and every seek.
 */
export function videoTimeAt(localSec: number, clip: ResolvedClip, sourceFps = 30): ClipTime {
  const t = localSec - clip.delay;
  if (t < 0) return { time: round6(clip.start), phase: 'before', loopIndex: 0 };
  const travelled = t * clip.rate;
  if (Number.isFinite(clip.length) && clip.length > 0) {
    if (clip.loop) {
      const k = Math.floor(travelled / clip.length + 1e-9);
      const within = travelled - k * clip.length;
      return { time: round6(Math.min(clip.start + within, lastInstant(clip, sourceFps))), phase: 'playing', loopIndex: k };
    }
    const last = lastInstant(clip, sourceFps);
    const time = clip.start + travelled;
    if (time >= last) return { time: round6(last), phase: 'held', loopIndex: 0 };
    return { time: round6(time), phase: 'playing', loopIndex: 0 };
  }
  return { time: round6(clip.start + travelled), phase: 'playing', loopIndex: 0 };
}

/** Scene seconds one pass of the segment takes (∞ for an open-ended source). */
export function clipSceneLength(clip: ResolvedClip): number {
  return clip.length / clip.rate;
}

/** Merges clip layers: asset defaults < scene content < component props. */
export function mergeClips(...layers: (VideoClip | undefined)[]): VideoClip {
  const out: VideoClip = {};
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
