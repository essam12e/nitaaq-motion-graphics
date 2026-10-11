/**
 * React components of the Morphing Engine.
 *
 *   <MorphShape stages=[{ d, at }] />  one body morphing through several shapes
 *   <MorphMask d=… />                  content revealed through a morphing mask (clip-path)
 *   <LiquidBlob />                     slowly breathing organic blob (backgrounds, logo beds)
 *
 * All timing is spring/curve driven from the scene frame — deterministic.
 */
import React, { useMemo, type CSSProperties } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { prepareMorph, morphAt, type MorphPlan } from './path';
import { blobPath } from './shapes';
import { springAt, type SpringOptions } from '../motion/spring';
import { curve } from '../motion/easing';

export interface MorphStage {
  /** Path in the component's viewBox. */
  d: string;
  /** Scene-local seconds when the morph INTO this shape starts (first stage: ignored). */
  at: number;
  /** Seconds the morph takes (curve) — or a spring (overrides). */
  dur?: number;
  spring?: SpringOptions;
  ease?: string;
  fill?: string;
}

const planCache = new Map<string, MorphPlan>();
export function cachedMorph(a: string, b: string, points = 96): MorphPlan {
  const k = `${points}|${a}|${b}`;
  let p = planCache.get(k);
  if (!p) {
    p = prepareMorph(a, b, points);
    if (planCache.size > 400) planCache.clear();
    planCache.set(k, p);
  }
  return p;
}

/** Path + progress of a multi-stage morph at time t (s). */
export function morphStagesAt(stages: MorphStage[], t: number, points = 96, arc = 0): { d: string; index: number; k: number } {
  if (stages.length === 1) return { d: stages[0].d, index: 0, k: 1 };
  let idx = 0;
  for (let i = 1; i < stages.length; i++) if (t >= stages[i].at) idx = i;
  const next = stages[idx + 1];
  const cur = stages[idx];
  // in transit from idx-1 → idx?
  if (idx > 0) {
    const prev = stages[idx - 1];
    const local = t - cur.at;
    const k = cur.spring ? Math.min(1.12, springAt(local, 0, 1, cur.spring).value) : curve(cur.ease ?? 'ease-in-out-cubic')(Math.min(1, local / (cur.dur ?? 0.7)));
    if (k < 1 || cur.spring) return { d: morphAt(cachedMorph(prev.d, cur.d, points), Math.max(0, k), arc), index: idx, k };
  }
  void next;
  return { d: cur.d, index: idx, k: 1 };
}

export function MorphShape({ stages, viewBox = '0 0 100 100', fill, stroke, strokeWidth, style, points = 96, arc = 0, gradient }: { stages: MorphStage[]; viewBox?: string; fill?: string; stroke?: string; strokeWidth?: number; style?: CSSProperties; points?: number; arc?: number; gradient?: [string, string] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { d, index } = morphStagesAt(stages, frame / fps, points, arc);
  const gid = useMemo(() => `mg${Math.abs(stages.map((s) => s.d.length).join('').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}`, [stages]);
  const fillColor = stages[index]?.fill ?? fill;
  return (
    <svg viewBox={viewBox} style={{ overflow: 'visible', ...style }} data-qc="morph">
      {gradient ? (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={gradient[0]} />
            <stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={d} fill={gradient ? `url(#${gid})` : (fillColor ?? 'none')} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" fillRule="evenodd" />
    </svg>
  );
}

/** Content seen through a mask that morphs between shapes (mask morphing / liquid reveal). Coordinates in px of the box. */
export function MorphMask({ stages, children, style, points = 96 }: { stages: MorphStage[]; children: React.ReactNode; style?: CSSProperties; points?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { d } = morphStagesAt(stages, frame / fps, points);
  return <div style={{ position: 'absolute', inset: 0, clipPath: `path('${d}')`, ...style }}>{children}</div>;
}

/** Organic blob that breathes (liquid motion) — periodic, seeded, cheap (one path, no filters). */
export function LiquidBlob({ cx, cy, r, seed, color, speed = 0.6, wobble = 0.2, style, opacity = 1 }: { cx: number; cy: number; r: number; seed: string | number; color: string; speed?: number; wobble?: number; style?: CSSProperties; opacity?: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const d = blobPath(cx, cy, r, seed, { phase: (frame / fps) * speed * Math.PI, wobble });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', opacity, ...style }}>
      <path d={d} fill={color} />
    </svg>
  );
}
