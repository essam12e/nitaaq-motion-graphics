/**
 * Style-driven card/panel surface. The same scene looks glassy, neon, paper or comic per style.
 * `glass` (optional) opts into Glass 2.0 (src/components/glass.ts): frost, thickness, edge light,
 * specular sweep, simulated refraction, chromatic edge, camera-driven reflections. Without it every
 * kind renders exactly as before.
 */
import React, { type CSSProperties } from 'react';
import { useMotion, useVideo } from '../engine/context';
import { exitWindow } from '../motion/lifecycle';
import { alpha, mix } from '../brand/color';
import type { SurfaceKind } from '../styles/tokens';
import { useCamera } from '../camera/CameraRig';
import { glassLook, type GlassOptions } from './glass';

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
  /** Glass 2.0 options. Given, the surface is a Glass 2.0 pane whatever the style's kind. */
  glass?: GlassOptions;
}

export function Surface(props: SurfaceProps) {
  if (props.glass) return <GlassSurface {...props} glass={props.glass} />;
  return <ClassicSurface {...props} />;
}

function ClassicSurface({ children, style, kind, tone = 'surface', radius, padding, glow, qc }: SurfaceProps) {
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
  const sheen = useSheen(effects === 'full');
  if (sheen !== null) {
    // principled model: light movement during the hold — one soft pass of light across the surface, under its content
    return (
      <div data-qc="box" data-qc-surface={qc} style={{ ...base, ...look, isolation: 'isolate', ...style }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', overflow: 'hidden', pointerEvents: 'none', zIndex: -1 }}>
          <div style={{ position: 'absolute', top: '-10%', bottom: '-10%', width: '45%', left: `${(-50 + sheen * 160).toFixed(2)}%`, background: `linear-gradient(100deg, transparent, ${alpha('#FFFFFF', t.mode === 'dark' ? 0.07 : 0.22)}, transparent)` }} />
        </div>
        {children}
      </div>
    );
  }
  return (
    <div data-qc="box" data-qc-surface={qc} style={{ ...base, ...look, ...style }}>
      {children}
    </div>
  );
}

/**
 * Principled model only: progress (0..1) of one light pass across a surface during the scene's hold
 * (after the entrances, before the exit). Null when there is no pass (legacy model, short hold,
 * deliberate still hold, reduced effects).
 */
function useSheen(full: boolean): number | null {
  const m = useMotion();
  if (!full || !m.principled || !m.life || m.life.intentionalHold) return null;
  const hold = m.life.holdFrames / m.fps;
  if (hold < 2.6) return null;
  const w = exitWindow(m.life, m.fps);
  const end = (w ? w.start : m.life.holdFrames) / m.fps;
  const start = Math.max(1.2, hold * 0.42);
  const dur = Math.min(1.6, end - start - 0.1);
  if (dur < 0.6) return null;
  const t = m.frame / m.fps;
  if (t <= start || t >= start + dur) return null;
  const x = (t - start) / dur;
  return x * x * (3 - 2 * x);
}

function GlassSurface({ children, style, tone = 'surface', radius, padding, glow, qc, glass }: SurfaceProps & { glass: GlassOptions }) {
  const { tokens: t, canvas, effects } = useVideo();
  const cam = useCamera();
  const u = canvas.u;
  const p = t.palette;
  const toneBg = tone === 'primary' ? p.primary : tone === 'accent' ? p.accent : tone === 'alt' ? p.surfaceAlt : tone === 'inverse' ? p.textPrimary : p.surface;
  const look = glassLook(
    { ...glass, tint: glass.tint ?? toneBg },
    { u, mode: t.mode, surface: toneBg, surfaceOpacity: t.surface.opacity, shadowColor: t.shadow.color, shadowStrength: t.shadow.strength, full: effects === 'full', inCamera: cam.active },
  );
  const g = glow ?? 0;
  const body = g > 0 ? { ...look.body, boxShadow: `${look.body.boxShadow}, 0 0 ${4 * u * g}px ${alpha(p.glow, 0.22 * g)}` } : look.body;
  return (
    <div
      data-qc="box"
      data-qc-surface={qc}
      data-qc-glass={look.live ? 'live' : 'simulated'}
      style={{ position: 'relative', borderRadius: (radius ?? t.surface.radius) * u, padding: padding !== undefined ? padding * u : undefined, boxSizing: 'border-box', ...body, ...style }}
    >
      {look.layers.filter((l) => !l.over).map((l) => <div key={l.key} data-glass-layer={l.key} style={l.style} />)}
      {children}
      {look.layers.filter((l) => l.over).map((l) => <div key={l.key} data-glass-layer={l.key} style={l.style} />)}
    </div>
  );
}
