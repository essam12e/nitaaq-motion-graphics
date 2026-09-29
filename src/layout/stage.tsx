/**
 * Layout engine helpers for scenes: the Stage (safe-area content box with
 * scene scale/offset + camera), responsive split/grid/stack math, and
 * collision-free item placement. No fixed coordinates: everything derives
 * from the canvas profile.
 */
import React, { type CSSProperties } from 'react';
import { AbsoluteFill } from 'remotion';
import { useScene, useVideo, useMotion } from '../engine/context';
import { cameraStyle, type CameraMove } from '../motion/primitives';
import type { Rect } from './canvas';

export function useLayout() {
  const { canvas, tokens } = useVideo();
  const s = canvas.safe;
  const gap = canvas.u * 3 * tokens.spacing.unit;
  return {
    ...canvas,
    W: canvas.width,
    H: canvas.height,
    gap,
    cx: s.x + s.width / 2,
    cy: s.y + s.height / 2,
  };
}

/** Full-frame stage that centres content inside the safe area. */
export function Stage({
  children,
  align = 'center',
  justify = 'center',
  direction = 'column',
  gap,
  style,
  camera = true,
  padding = 0,
}: {
  children: React.ReactNode;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  direction?: 'column' | 'row';
  gap?: number;
  style?: CSSProperties;
  camera?: boolean;
  padding?: number;
}) {
  const { canvas, tokens } = useVideo();
  const sc = useScene();
  const m = useMotion();
  const L = sc.scene.layout;
  const cam = (sc.scene.motion.camera ?? 'none') as CameraMove;
  const t = m.frame / Math.max(1, sc.entry.durationInFrames);
  const camS = camera ? cameraStyle(cam, t, (sc.intensity ?? 0.5) * 1.0, canvas.u) : {};
  const s = canvas.safe;
  const g = gap ?? canvas.u * 3 * tokens.spacing.unit;
  return (
    <AbsoluteFill style={{ ...camS }}>
      <div
        data-qc="stage"
        style={{
          position: 'absolute',
          left: s.x + padding * canvas.u,
          top: s.y + padding * canvas.u,
          width: s.width - padding * 2 * canvas.u,
          height: s.height - padding * 2 * canvas.u,
          display: 'flex',
          flexDirection: direction,
          alignItems: align,
          justifyContent: justify,
          gap: g,
          ...style,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}

/** Split the safe area into [primary, secondary] rects. Landscape: side by side (RTL: primary on the right). Portrait: stacked. */
export function splitRects(safe: Rect, orientation: 'portrait' | 'landscape' | 'square', ratio = 0.5, gap = 0, rtl = true): [Rect, Rect] {
  if (orientation === 'landscape') {
    const w1 = (safe.width - gap) * ratio;
    const w2 = safe.width - gap - w1;
    const a: Rect = { x: rtl ? safe.x + safe.width - w1 : safe.x, y: safe.y, width: w1, height: safe.height };
    const b: Rect = { x: rtl ? safe.x : safe.x + w1 + gap, y: safe.y, width: w2, height: safe.height };
    return [a, b];
  }
  const h1 = (safe.height - gap) * ratio;
  const h2 = safe.height - gap - h1;
  return [
    { x: safe.x, y: safe.y, width: safe.width, height: h1 },
    { x: safe.x, y: safe.y + h1 + gap, width: safe.width, height: h2 },
  ];
}

/** Grid shape for n items in a box, preferring near-square cells matching the box aspect. */
export function gridShape(n: number, boxW: number, boxH: number, cellAspect = 1): { cols: number; rows: number } {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = boxW / cols;
    const ch = boxH / rows;
    const ar = cw / ch;
    const empty = cols * rows - n;
    const score = Math.abs(Math.log(ar / cellAspect)) + empty * 0.35;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

/** Absolutely positioned box helper. */
export function Box({ r, children, style }: { r: Rect; children?: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, ...style }}>{children}</div>;
}

/** Evenly place n points on an ellipse (orbit layouts). */
export function orbitPoints(n: number, rx: number, ry: number, phase = -Math.PI / 2): { x: number; y: number; a: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry, a };
  });
}
