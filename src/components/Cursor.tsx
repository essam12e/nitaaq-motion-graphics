/** Animated pointer that travels along keyframes and clicks (ripple). */
import React from 'react';
import { interpolate } from 'remotion';
import { useMotion, useVideo } from '../engine/context';
import { EASE } from '../motion/primitives';
import { alpha } from '../brand/color';

export interface CursorKey {
  t: number; // seconds
  x: number;
  y: number;
  click?: boolean;
}

export function Cursor({ keys, size = 5 }: { keys: CursorKey[]; size?: number }) {
  const m = useMotion();
  const { canvas, tokens } = useVideo();
  const u = canvas.u;
  const s = m.frame / m.fps;
  if (!keys.length) return null;
  let x = keys[0].x;
  let y = keys[0].y;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (s >= a.t && s <= b.t) {
      const p = EASE.smooth((s - a.t) / Math.max(0.001, b.t - a.t));
      x = a.x + (b.x - a.x) * p;
      y = a.y + (b.y - a.y) * p;
    } else if (s > b.t) {
      x = b.x;
      y = b.y;
    }
  }
  const clicks = keys.filter((k) => k.click);
  let press = 0;
  let ripple = -1;
  for (const c of clicks) {
    const d = s - c.t;
    if (d >= 0 && d < 0.18) press = Math.sin((d / 0.18) * Math.PI);
    if (d >= 0 && d < 0.6) ripple = d / 0.6;
  }
  const appear = interpolate(s, [keys[0].t - 0.3, keys[0].t], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const sz = size * u;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, zIndex: 50, opacity: appear, pointerEvents: 'none' }}>
      {ripple >= 0 ? (
        <div
          style={{
            position: 'absolute',
            left: -sz * 0.9,
            top: -sz * 0.9,
            width: sz * 1.8,
            height: sz * 1.8,
            borderRadius: '50%',
            border: `${u * 0.3}px solid ${alpha(tokens.palette.primary, 1 - ripple)}`,
            transform: `scale(${0.3 + ripple})`,
          }}
        />
      ) : null}
      <svg width={sz} height={sz} viewBox="0 0 24 24" style={{ transform: `scale(${1 - press * 0.15})`, transformOrigin: '0 0', filter: `drop-shadow(0 ${u * 0.3}px ${u * 0.5}px rgba(0,0,0,0.35))` }}>
        <path d="M3 2 L20 11 L12.5 13 L9 21 Z" fill="#FFFFFF" stroke="#111111" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
