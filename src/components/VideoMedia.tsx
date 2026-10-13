/**
 * VideoMedia — a user video inside a scene, driven by Remotion's frame.
 *
 * The picture is an <OffthreadVideo> frozen at the exact source time computed
 * by `videoTimeAt` (src/media/video.ts): trim, playback rate, loop/hold and the
 * start delay are pure maths on the scene frame, so every render worker, every
 * still and `nitaaq seek` show the same source frame — the video never plays
 * on its own clock. Its audio (off by default; the Sound Director owns the
 * mix) is a separate <Audio> with the same trim / rate / loop.
 *
 * The box behaves like <Media>: object-fit, radius, frame, shadow, masks
 * (a named shape from the morph library or any CSS clip-path), opacity and
 * transforms via `style`, so it drops into cards, surfaces and masks, and
 * several can play in one scene.
 */
import React, { useId, type CSSProperties } from 'react';
import { Audio, Freeze, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { useAsset, useAssetMeta, useSharedHidden, useVideo } from '../engine/context';
import { alpha } from '../brand/color';
import { mergeClips, resolveClip, videoTimeAt, type VideoClip } from '../media/video';
import { SHAPE_NAMES, shapePath } from '../morph/shapes';

export interface VideoMediaProps {
  src: string;
  width: number;
  height: number;
  /** cover (default for video) or contain (identity roles: product / screenshot). */
  fit?: 'contain' | 'cover';
  radius?: number;
  shadow?: boolean;
  frame?: boolean;
  /** A morph-library shape name (circle, squircle, phone, blob, …) or a raw CSS clip-path. */
  mask?: string;
  /** Overrides of the asset's default clip. */
  clip?: VideoClip;
  role?: 'product' | 'screenshot' | 'image' | 'background' | 'video';
  objectPosition?: string;
  style?: CSSProperties;
  videoStyle?: CSSProperties;
}

const IDENTITY = ['product', 'screenshot'];

export function VideoMedia(p: VideoMediaProps) {
  const resolve = useAsset();
  const meta = useAssetMeta()(p.src);
  const { tokens: t, canvas } = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const maskId = `vm-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const url = resolve(p.src);
  const role = p.role ?? 'video';
  const identity = IDENTITY.includes(role);
  const fit = identity ? 'contain' : p.fit ?? 'cover';
  const r = (p.radius ?? 0) * canvas.u;
  const clip = resolveClip(mergeClips(meta?.clip, p.clip), meta?.duration);
  const at = videoTimeAt(frame / fps, clip, meta?.fps ?? fps);
  const handedOff = useSharedHidden(p.src);
  const named = p.mask && (SHAPE_NAMES as readonly string[]).includes(p.mask) ? p.mask : undefined;
  const clipPath = named ? `url(#${maskId})` : p.mask;
  return (
    <div
      data-qc="media"
      data-qc-kind="video"
      data-qc-role={role}
      data-qc-src={p.src}
      data-qc-fit={fit}
      data-qc-identity={identity ? '1' : '0'}
      data-qc-video-time={at.time.toFixed(3)}
      data-qc-video-phase={at.phase}
      style={{
        position: 'relative',
        width: p.width,
        height: p.height,
        borderRadius: r,
        // the clip lives on the picture itself: Chrome's anti-aliasing of a clipped container around a
        // changing video frame varies between render runs; on the <img> it is identical every time.
        // (the box keeps it only when it also draws a frame / shadow that must follow the shape)
        clipPath: p.frame || p.shadow ? clipPath : undefined,
        boxShadow: p.shadow ? `0 ${2 * canvas.u}px ${6 * canvas.u}px ${alpha(t.shadow.color, 0.25 + 0.4 * t.shadow.strength)}` : undefined,
        border: p.frame ? `${Math.max(2, canvas.u * 0.35)}px solid ${alpha(t.palette.textPrimary, 0.12)}` : undefined,
        background: fit === 'contain' || (clipPath && !(p.frame || p.shadow)) ? 'transparent' : alpha('#000000', 0.9),
        ...p.style,
      }}
    >
      {named ? (
        <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
          <clipPath id={maskId} clipPathUnits="objectBoundingBox">
            <path d={shapePath(named, 100, p.src)} transform="scale(0.01)" />
          </clipPath>
        </svg>
      ) : null}
      {url ? (
        // Freeze pins the video to the computed source time: frame = seconds × fps of the composition
        <Freeze frame={at.time * fps}>
          <OffthreadVideo
            src={url}
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: fit,
              objectPosition: p.objectPosition ?? 'center',
              display: 'block',
              borderRadius: r,
              clipPath,
              ...p.videoStyle,
              ...(handedOff ? { opacity: 0 } : {}),
            }}
          />
        </Freeze>
      ) : null}
      {url && !clip.muted ? (
        <Sequence from={Math.round(clip.delay * fps)} layout="none">
          <Audio
            src={url}
            trimBefore={Math.round(clip.start * fps)}
            trimAfter={Number.isFinite(clip.end) ? Math.round(clip.end * fps) : undefined}
            playbackRate={clip.rate}
            loop={clip.loop}
            volume={clip.volume}
          />
        </Sequence>
      ) : null}
    </div>
  );
}
