/** Renders a registered illustration subject in the brand palette, with draw-on. */
import React from 'react';
import { useVideo } from '../engine/context';
import { IllustrationRegistry, type IllustrationStyle, type Tone } from './registry';
import { clamp } from '../motion/primitives';
import { alpha } from '../brand/color';

export function Illustration({ id, size, style = 'duotone', draw = 1, ink, mono }: { id: string; size: number; style?: IllustrationStyle; draw?: number; ink?: string; mono?: boolean }) {
  const { tokens: t } = useVideo();
  const subj = IllustrationRegistry.get(id);
  if (!subj) return null;
  const P = t.palette;
  const toneColor: Record<Tone, string> = {
    primary: P.primary,
    secondary: P.secondary,
    accent: P.accent,
    ink: ink ?? P.textPrimary,
    surface: P.surface === P.background ? alpha(P.textPrimary, 0.12) : P.surface,
  };
  const stages = Math.max(...subj.parts.map((p) => p.stage ?? 0)) + 1;
  const sw = style === 'line' || mono ? 5 : 4;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: 'visible' }} data-qc-illustration={id}>
      {subj.parts.map((p, i) => {
        const st = p.stage ?? 0;
        // each stage: stroke draws over the first 60% of its window, fill fades in over the rest
        const a = st / stages;
        const b = (st + 1) / stages;
        const k = clamp((draw - a) / (b - a));
        const strokeK = clamp(k / 0.6);
        const fillK = clamp((k - 0.45) / 0.55);
        const col = mono ? (ink ?? P.textPrimary) : toneColor[p.tone];
        const lineOnly = p.line || style === 'line' || mono;
        const outline = lineOnly || style === 'duotone';
        const outlineCol = lineOnly ? col : alpha(ink ?? P.textPrimary, 0.85);
        return (
          <g key={i}>
            {!lineOnly ? <path d={p.d} fill={col} opacity={style === 'flat' ? fillK : fillK * 0.95} /> : null}
            {outline ? (
              <path d={p.d} fill="none" stroke={outlineCol} strokeWidth={p.line ? sw * 1.1 : style === 'duotone' ? sw * 0.7 : sw} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - strokeK} />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
