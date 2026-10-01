/** Style-driven card/panel surface. The same scene looks glassy, neon, paper or comic per style. */
import React, { type CSSProperties } from 'react';
import { useVideo } from '../engine/context';
import { alpha, mix } from '../brand/color';
import type { SurfaceKind } from '../styles/tokens';

export interface SurfaceProps {
  children?: React.ReactNode;
  style?: CSSProperties;
  kind?: SurfaceKind;
  tone?: 'surface' | 'primary' | 'accent' | 'alt' | 'inverse';
  radius?: number;
  padding?: number;
  glow?: number;
  className?: string;
  qc?: string;
}

export function Surface({ children, style, kind, tone = 'surface', radius, padding, glow, qc }: SurfaceProps) {
  const { tokens: t, canvas, effects } = useVideo();
  const u = canvas.u;
  const k = kind ?? t.surface.kind;
  const r = (radius ?? t.surface.radius) * u;
  const p = t.palette;
  const toneBg = tone === 'primary' ? p.primary : tone === 'accent' ? p.accent : tone === 'alt' ? p.surfaceAlt : tone === 'inverse' ? p.textPrimary : p.surface;
  const g = glow ?? t.glow;
  const shadowCol = t.shadow.color;
  const base: CSSProperties = {
    position: 'relative',
    borderRadius: r,
    padding: padding !== undefined ? padding * u : undefined,
    boxSizing: 'border-box',
  };
  let look: CSSProperties;
  switch (k) {
    case 'glass':
      look = {
        background: tone === 'surface' ? `linear-gradient(145deg, ${alpha(mix(toneBg, '#FFFFFF', 0.12), t.surface.opacity)}, ${alpha(toneBg, t.surface.opacity * 0.7)})` : alpha(toneBg, 0.9),
        border: `${t.surface.borderWidth}px solid ${alpha('#FFFFFF', t.mode === 'dark' ? 0.14 : 0.5)}`,
        // backdrop blur is the most expensive CSS effect we use: full renders only, capped
        backdropFilter: effects === 'full' && t.surface.blur > 0 ? `blur(${Math.min(16, t.surface.blur)}px)` : undefined,
        boxShadow: `0 ${2 * u}px ${6 * u}px ${alpha(shadowCol, 0.35 * t.shadow.strength + 0.1)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.16)}${g > 0 ? `, 0 0 ${4 * u * g}px ${alpha(p.glow, 0.18 * g)}` : ''}`,
      };
      break;
    case 'neon':
      look = {
        background: alpha(toneBg, 0.72),
        border: `${Math.max(2, t.surface.borderWidth)}px solid ${alpha(p.primary, 0.85)}`,
        boxShadow: `0 0 ${2.2 * u}px ${alpha(p.primary, 0.45 * Math.max(0.4, g))}, inset 0 0 ${1.6 * u}px ${alpha(p.primary, 0.18)}`,
      };
      break;
    case 'outline':
      look = { background: alpha(toneBg, tone === 'surface' ? 0.55 : 1), border: `${Math.max(1, t.surface.borderWidth)}px solid ${p.border}` };
      break;
    case 'elevated':
      look = {
        background: toneBg,
        border: t.surface.borderWidth ? `${t.surface.borderWidth}px solid ${p.border}` : undefined,
        boxShadow: `0 ${1.6 * u * t.shadow.spread}px ${5 * u * t.shadow.spread}px ${alpha(shadowCol, 0.18 + 0.5 * t.shadow.strength)}`,
      };
      break;
    case 'soft':
      look = {
        background: toneBg,
        border: t.surface.borderWidth ? `${t.surface.borderWidth}px solid ${p.border}` : undefined,
        boxShadow: `0 ${1.2 * u}px ${4.5 * u}px ${alpha(shadowCol, 0.1 + 0.4 * t.shadow.strength)}, 0 ${0.2 * u}px ${0.6 * u}px ${alpha(shadowCol, 0.08)}`,
      };
      break;
    case 'paper':
      look = { background: toneBg, border: `${t.surface.borderWidth}px solid ${p.border}`, boxShadow: `${0.5 * u}px ${0.6 * u}px 0 ${alpha(shadowCol, 0.12)}` };
      break;
    case 'comic':
      look = { background: toneBg, border: `${t.surface.borderWidth}px solid ${p.border}`, boxShadow: `${0.9 * u}px ${0.9 * u}px 0 ${p.border}` };
      break;
    case 'flat':
    default:
      look = { background: toneBg };
  }
  return (
    <div data-qc="box" data-qc-surface={qc} style={{ ...base, ...look, ...style }}>
      {children}
    </div>
  );
}
