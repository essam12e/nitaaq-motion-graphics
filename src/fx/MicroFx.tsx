/**
 * Draws a scene's Micro FX (src/fx/micro.ts) as one SVG over the scene. Nothing is drawn while no effect
 * is live; the shapes are a pure function of the scene frame.
 */
import React, { useId } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useVideo } from '../engine/context';
import { fxShapes, type MicroFxSpec } from './micro';

export function MicroFxLayer({ fx }: { fx: MicroFxSpec[] }) {
  const v = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const W = v.canvas.width;
  const H = v.canvas.height;
  const accent = v.tokens.palette.accent ?? v.tokens.palette.primary;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const live = fx.map((f, i) => ({ f, i, shapes: fxShapes(f, t, W, H, accent) })).filter((x) => x.shapes.length);
  if (!live.length) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }} data-qc="micro-fx" data-qc-fx={live.map((x) => x.f.kind).join(',')}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          {live.map(({ f, i }) => (
            // a soft glow per effect colour: a radial falloff, no blur filter
            <radialGradient key={i} id={`fxg-${uid}-${i}`}>
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.95} />
              <stop offset="22%" stopColor={f.color ?? accent} stopOpacity={0.8} />
              <stop offset="100%" stopColor={f.color ?? accent} stopOpacity={0} />
            </radialGradient>
          ))}
        </defs>
        {live.map(({ f, i, shapes }) => (
          <g key={i} data-fx={f.kind}>
            {shapes.map((s, j) =>
              s.t === 'circle' ? (
                s.glow ? (
                  <circle key={j} cx={s.cx} cy={s.cy} r={s.r} fill={`url(#fxg-${uid}-${i})`} opacity={s.opacity} />
                ) : (
                  <circle key={j} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill ?? 'none'} stroke={s.stroke} strokeWidth={s.sw} opacity={s.opacity} />
                )
              ) : (
                <line key={j} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.sw} strokeLinecap="round" opacity={s.opacity} />
              ),
            )}
          </g>
        ))}
      </svg>
    </AbsoluteFill>
  );
}
