import React, { createContext, useContext, useMemo } from 'react';
import { staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneSpec, VideoSpec } from '../schema/video';
import type { StyleTokens } from '../styles/tokens';
import type { CanvasProfile } from '../layout/canvas';
import type { Timeline, TimelineEntry } from '../core/timeline';
import type { MotionCtx } from '../motion/primitives';
import { highlightColor } from '../styles/resolve';
import { PERSONALITIES } from '../motion/personality';

export interface FontFamilies {
  display: string;
  body: string;
  latin: string;
  mono: string;
  displayWeight: number;
  bodyWeight: number;
}

export interface VideoCtxValue {
  spec: VideoSpec;
  tokens: StyleTokens;
  canvas: CanvasProfile;
  timeline: Timeline;
  fonts: FontFamilies;
  /** Base for project assets: URL (studio) or staticFile prefix (render). */
  assetBase: string;
  mode: 'render' | 'preview' | 'qc';
  debugSafeArea: boolean;
  dir: 'rtl' | 'ltr';
  hl: string;
  /** 'reduced' = animatic/preview: expensive effects (backdrop blur, grain, heavy shadows) are skipped. */
  effects: 'full' | 'reduced';
  /** Total frames when the film loops seamlessly (ambient motion becomes periodic). */
  loopFrames: number | null;
}

export const VideoCtx = createContext<VideoCtxValue | null>(null);

export function useVideo(): VideoCtxValue {
  const v = useContext(VideoCtx);
  if (!v) throw new Error('useVideo() must be used inside <VideoProvider>');
  return v;
}

export interface SceneCtxValue {
  scene: SceneSpec;
  index: number;
  entry: TimelineEntry;
  variant: string;
  intensity: number;
  speed: number;
  /** Frames the scene is fully on screen (excludes outgoing overlap). */
  holdFrames: number;
}

export const SceneCtx = createContext<SceneCtxValue | null>(null);

export function useScene(): SceneCtxValue {
  const s = useContext(SceneCtx);
  if (!s) throw new Error('useScene() must be used inside a scene');
  return s;
}

/** Motion context at the current (scene-local) frame. */
export function useMotion(): MotionCtx {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = useVideo();
  const s = useContext(SceneCtx);
  return useMemo(
    () => ({
      frame,
      fps,
      intensity: s?.intensity ?? v.tokens.motion.intensity,
      easing: v.tokens.motion.easing,
      speed: s?.speed ?? 1,
      personality: v.tokens.motion.personality,
      floatK: PERSONALITIES[v.tokens.motion.personality]?.float ?? 1,
    }),
    [frame, fps, s?.intensity, s?.speed, v.tokens.motion.intensity, v.tokens.motion.easing, v.tokens.motion.personality],
  );
}

const ABSOLUTE = /^(https?:|data:|blob:)/;

export function resolveAssetUrl(src: string, assetBase: string): string {
  if (!src) return src;
  if (ABSOLUTE.test(src)) return src;
  if (src.startsWith('lib:')) return staticFile(src.slice(4));
  const clean = src.replace(/^\.?\//, '');
  if (ABSOLUTE.test(assetBase)) return `${assetBase.replace(/\/$/, '')}/${clean}`;
  return staticFile(`${assetBase ? assetBase.replace(/\/$/, '') + '/' : ''}${clean}`);
}

export function useAsset(): (src: string | undefined) => string | undefined {
  const { assetBase, spec } = useVideo();
  return (src) => {
    if (!src) return undefined;
    // Asset ids declared in spec.assets resolve to their src.
    const a = spec.assets[src];
    return resolveAssetUrl(a ? a.src : src, assetBase);
  };
}

export function useAssetMeta() {
  const { spec } = useVideo();
  return (src: string | undefined) => {
    if (!src) return undefined;
    return spec.assets[src] ?? Object.values(spec.assets).find((a) => a.src === src);
  };
}

export { highlightColor };

export function VideoProvider({ value, children }: { value: VideoCtxValue; children: React.ReactNode }) {
  return <VideoCtx.Provider value={value}>{children}</VideoCtx.Provider>;
}
