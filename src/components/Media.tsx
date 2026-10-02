/**
 * User media, identity-preserving. Product photos, logos and screenshots are
 * always rendered with object-fit: contain (or a declared crop for
 * non-identity images), never recoloured, warped or regenerated. Treatments
 * (frames, shadows, lighting) are applied AROUND the image, not to it —
 * except for `image`/`background` kinds where tone treatments are allowed.
 */
import React, { type CSSProperties } from 'react';
import { Img } from 'remotion';
import { useAsset, useAssetMeta, useSharedHidden, useVideo } from '../engine/context';
import { alpha } from '../brand/color';

export interface MediaProps {
  src: string;
  width: number;
  height: number;
  /** contain = identity-safe (default). cover is only allowed for non-identity images. */
  fit?: 'contain' | 'cover';
  radius?: number;
  shadow?: boolean;
  frame?: boolean;
  style?: CSSProperties;
  imgStyle?: CSSProperties;
  role?: 'logo' | 'product' | 'screenshot' | 'image' | 'background' | 'avatar';
  treatment?: 'none' | 'duotone' | 'mono' | 'grain';
  objectPosition?: string;
  alt?: string;
}

const IDENTITY: MediaProps['role'][] = ['logo', 'product', 'screenshot'];

export function Media(p: MediaProps) {
  const resolve = useAsset();
  const meta = useAssetMeta()(p.src);
  const { tokens: t, canvas } = useVideo();
  const url = resolve(p.src);
  const role = p.role ?? (meta?.kind as MediaProps['role']) ?? 'image';
  const identity = IDENTITY.includes(role) || meta?.preserve === true && meta.kind !== 'image' && meta.kind !== 'background';
  const fit = identity ? 'contain' : p.fit ?? 'cover';
  const treatment = identity ? 'none' : p.treatment ?? 'none';
  const filter = treatment === 'mono' ? 'grayscale(1) contrast(1.05)' : undefined;
  const r = (p.radius ?? 0) * canvas.u;
  const handedOff = useSharedHidden(p.src);
  return (
    <div
      data-qc="media"
      data-qc-role={role}
      data-qc-src={p.src}
      data-qc-fit={fit}
      data-qc-identity={identity ? '1' : '0'}
      style={{
        position: 'relative',
        width: p.width,
        height: p.height,
        borderRadius: r,
        overflow: fit === 'cover' || p.frame ? 'hidden' : 'visible',
        boxShadow: p.shadow ? `0 ${2 * canvas.u}px ${6 * canvas.u}px ${alpha(t.shadow.color, 0.25 + 0.4 * t.shadow.strength)}` : undefined,
        border: p.frame ? `${Math.max(2, canvas.u * 0.35)}px solid ${alpha(t.palette.textPrimary, 0.12)}` : undefined,
        ...p.style,
      }}
    >
      {url ? (
        <Img
          src={url}
          alt={p.alt ?? meta?.alt ?? ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            objectPosition: p.objectPosition ?? 'center',
            filter,
            display: 'block',
            // Product/logo shadows follow the alpha shape (drop-shadow), never alter pixels.
            ...(role === 'product' && p.shadow ? { filter: `drop-shadow(0 ${2.5 * canvas.u}px ${3 * canvas.u}px ${alpha('#000000', 0.35)})` } : {}),
            ...p.imgStyle,
            // during a shared-element transition only the asset itself is handed to the film-level layer;
            // its card/frame stays and fades with its scene, so nothing pops in or out
            ...(handedOff ? { opacity: 0 } : {}),
          }}
        />
      ) : null}
      {treatment === 'duotone' ? <div style={{ position: 'absolute', inset: 0, background: t.palette.primary, mixBlendMode: 'color', opacity: 0.55 }} /> : null}
    </div>
  );
}

/** Fit a box of aspect `ar` (w/h) inside max w/h. */
export function fitBox(ar: number, maxW: number, maxH: number): { width: number; height: number } {
  if (!ar || !isFinite(ar)) return { width: maxW, height: maxH };
  let w = maxW;
  let h = w / ar;
  if (h > maxH) {
    h = maxH;
    w = h * ar;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

export function useAspect(src: string | undefined, fallback = 1): number {
  const meta = useAssetMeta()(src);
  if (meta?.width && meta?.height) return meta.width / meta.height;
  return fallback;
}
