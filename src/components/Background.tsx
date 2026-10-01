/**
 * Background Engine. Backgrounds support the composition instead of competing
 * with it: every clean kind is built from 1–5 LARGE intentional forms (light,
 * gradients, geometry, depth planes) — never dozens of tiny repeated objects.
 *
 * Rules enforced here:
 *  - Pattern kinds (dots/grid/halftone/bokeh/stripes/lines/particles) render only
 *    when `design.allowPatterns` names them; otherwise they resolve to a clean kind.
 *  - Pure CSS gradients/transforms (no SVG blur filters, no backdrop-filter): the
 *    background is the one layer painted on every frame, so it must stay cheap.
 *  - Driven by the global frame (continuous across cuts) and periodic over the
 *    video length when `timeline.seamlessLoop` is on.
 *  - Seeded variation per project (geometry placement) — deterministic.
 */
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { useVideo } from '../engine/context';
import { alpha, mix, adjust } from '../brand/color';
import type { BackgroundKind } from '../styles/tokens';
import { resolveBackgroundKind } from '../design/patterns';
import { createRng, hashString } from '../core/rng';

/** Deterministic slow oscillator. Periodic over the whole film in loop mode. */
export function makeWave(frame: number, fps: number, loopFrames: number | null) {
  return (hz: number, phase = 0) => {
    if (loopFrames) {
      const cycles = Math.max(1, Math.round((hz * loopFrames) / fps));
      return Math.sin((2 * Math.PI * cycles * frame) / loopFrames + phase);
    }
    return Math.sin(2 * Math.PI * hz * (frame / fps) + phase);
  };
}

export function Background({ frame, kind: kindOverride, color, accent }: { frame: number; kind?: string; color?: string; accent?: string }) {
  const { tokens: t, canvas, spec, effects, loopFrames } = useVideo();
  const p = t.palette;
  const W = canvas.width;
  const H = canvas.height;
  const u = canvas.u;
  const allow = spec.design?.allowPatterns ?? [];
  const kind = resolveBackgroundKind(kindOverride ?? t.background.kind, allow) ?? 'solid';
  const secondary = !kindOverride && t.background.secondaryKind ? resolveBackgroundKind(t.background.secondaryKind, allow) : undefined;
  const bg = color ?? p.background;
  const ac = accent ?? p.primary;
  const I = t.background.intensity;
  const fps = spec.canvas.fps || 30;
  const wv = makeWave(t.background.animate ? frame : 0, fps, loopFrames);
  const dark = t.mode === 'dark';
  const light = dark ? mix(bg, ac, 0.32) : mix(bg, '#FFFFFF', 0.85);
  const seed = createRng(hashString(`${spec.metadata?.seed ?? spec.project.id}:bg`)).next;
  const side = seed() < 0.5 ? 1 : -1; // which side gets the key light / big form

  const layer = (k: BackgroundKind, second = false): React.ReactNode => {
    const o = second ? 0.5 : 1;
    switch (k) {
      case 'solid':
        return null;
      case 'brand-solid':
        return <AbsoluteFill style={{ background: mix(bg, ac, 0.1 * I), opacity: o }} />;
      case 'gradient':
      case 'soft-gradient':
        return <AbsoluteFill style={{ opacity: o, background: `linear-gradient(${170 + wv(0.02) * 6}deg, ${mix(bg, ac, 0.1 * I)} 0%, ${bg} 55%, ${mix(bg, p.secondary, 0.14 * I)} 100%)` }} />;
      case 'directional-gradient':
        return <AbsoluteFill style={{ opacity: o, background: `linear-gradient(${side > 0 ? 135 : 225}deg, ${mix(bg, ac, 0.3 * I)} 0%, ${bg} 58%, ${mix(bg, p.secondary, 0.16 * I)} 100%)` }} />;
      case 'spotlight':
      case 'radial-light':
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: `radial-gradient(${canvas.isTall ? '95% 55%' : '65% 85%'} at ${50 + wv(0.025) * 6}% ${canvas.isTall ? 24 : 30}%, ${alpha(light, 0.55 * I + 0.15)} 0%, ${alpha(bg, 0)} 70%)`,
            }}
          />
        );
      case 'rays':
      case 'cinematic-light': {
        const kx = side > 0 ? 28 : 72;
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: [
                `radial-gradient(${canvas.isTall ? '90% 45%' : '55% 75%'} at ${kx + wv(0.02) * 4}% 12%, ${alpha(mix(bg, p.accent, 0.4), 0.45 * I + 0.1)} 0%, transparent 70%)`,
                k === 'rays' ? `conic-gradient(from ${180 + side * 12 + wv(0.015) * 3}deg at ${kx}% -8%, transparent 0deg, ${alpha(light, 0.1 * I)} 8deg, transparent 18deg, ${alpha(light, 0.07 * I)} 30deg, transparent 44deg, transparent 360deg)` : '',
                `linear-gradient(180deg, transparent 55%, ${alpha('#000000', dark ? 0.35 : 0.08)} 100%)`,
              ]
                .filter(Boolean)
                .join(', '),
            }}
          />
        );
      }
      case 'vignette':
        return <AbsoluteFill style={{ opacity: o, background: `radial-gradient(ellipse at 50% 45%, transparent 50%, ${alpha('#000000', dark ? 0.45 : 0.12)} 100%)` }} />;
      case 'mesh':
      case 'brand-shapes': {
        const blobs = [
          { x: 22 + wv(0.03, 1) * 7, y: 18 + wv(0.025, 2) * 5, r: 60, c: ac, a: 0.34 },
          { x: 84 + wv(0.028, 3) * 6, y: 58 + wv(0.032) * 6, r: 55, c: p.secondary, a: 0.28 },
          { x: 32 + wv(0.02, 4) * 8, y: 94 + wv(0.024, 5) * 4, r: 50, c: p.accent, a: 0.2 },
        ];
        const k2 = dark ? 1 : 0.65;
        return <AbsoluteFill style={{ opacity: o, background: blobs.map((b) => `radial-gradient(${b.r}% ${b.r * 0.75}% at ${b.x}% ${b.y}%, ${alpha(b.c, b.a * I * k2)} 0%, transparent 70%)`).join(', ') }} />;
      }
      case 'noise-gradient':
      case 'atmosphere':
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: [
                `radial-gradient(75% 55% at ${side > 0 ? 15 : 85}% ${8 + wv(0.02) * 3}%, ${alpha(ac, (dark ? 0.26 : 0.14) * I)} 0%, transparent 70%)`,
                `radial-gradient(70% 50% at ${side > 0 ? 90 : 10}% 95%, ${alpha(p.secondary, (dark ? 0.22 : 0.12) * I)} 0%, transparent 70%)`,
                `linear-gradient(180deg, ${mix(bg, ac, 0.05 * I)} 0%, ${bg} 100%)`,
              ].join(', '),
            }}
          />
        );
      case 'aurora': {
        const bands = [0, 1].map((i) => `linear-gradient(${158 + i * 24 + wv(0.02, i) * 5}deg, transparent ${28 + i * 18}%, ${alpha(i ? p.secondary : ac, 0.22 * I)} ${40 + i * 18}%, transparent ${54 + i * 18}%)`);
        return <AbsoluteFill style={{ opacity: o, background: bands.join(', ') }} />;
      }
      case 'geometry': {
        // 1 huge disc + 1 ring + 1 diagonal slab: big, quiet, off-centre.
        const D = Math.max(W, H) * (1 + seed() * 0.2);
        const cx = side > 0 ? W * (0.85 + seed() * 0.1) : W * (0.05 + seed() * 0.1);
        const cy = H * (0.12 + seed() * 0.15);
        const rot = wv(0.012) * 2;
        return (
          <AbsoluteFill style={{ opacity: o, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: cx - D / 2, top: cy - D / 2 + wv(0.02) * u * 1.5, width: D, height: D, borderRadius: '50%', background: `radial-gradient(circle at 40% 40%, ${alpha(ac, (dark ? 0.12 : 0.08) * (0.5 + I))}, ${alpha(ac, 0.02)} 70%)` }} />
            <div style={{ position: 'absolute', left: cx - D * 0.36, top: cy - D * 0.36, width: D * 0.72, height: D * 0.72, borderRadius: '50%', border: `${Math.max(1, u * 0.18)}px solid ${alpha(p.textPrimary, dark ? 0.07 : 0.06)}` }} />
            <div style={{ position: 'absolute', left: -W * 0.2, top: H * (0.7 + seed() * 0.1), width: W * 1.4, height: H * 0.5, transform: `rotate(${side * -8 + rot}deg)`, transformOrigin: 'center', background: `linear-gradient(180deg, ${alpha(p.secondary, (dark ? 0.1 : 0.06) * (0.5 + I))}, transparent 80%)` }} />
          </AbsoluteFill>
        );
      }
      case 'depth-layers': {
        const planes = [0, 1, 2];
        return (
          <AbsoluteFill style={{ opacity: o, overflow: 'hidden' }}>
            {planes.map((i) => {
              const d = 1 - i * 0.3;
              const w = W * (0.9 - i * 0.12);
              const h = H * (0.55 - i * 0.08);
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: (W - w) / 2 + side * (i - 1) * W * 0.12 + wv(0.02, i) * u * 2 * d,
                    top: H * (0.18 + i * 0.16) + wv(0.018, i + 2) * u * 1.5 * d,
                    width: w,
                    height: h,
                    borderRadius: u * 4,
                    background: `linear-gradient(160deg, ${alpha(mix(bg, ac, 0.25), (dark ? 0.16 : 0.1) * d)}, ${alpha(bg, 0)})`,
                  }}
                />
              );
            })}
          </AbsoluteFill>
        );
      }
      case 'glass-depth':
        return (
          <AbsoluteFill style={{ opacity: o, overflow: 'hidden', background: `radial-gradient(70% 50% at ${side > 0 ? 80 : 20}% 20%, ${alpha(ac, 0.22 * I)}, transparent 70%)` }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: side > 0 ? W * (0.42 - i * 0.3) : W * (-0.12 + i * 0.3),
                  top: H * (0.1 + i * 0.42) + wv(0.02, i) * u,
                  width: W * 0.7,
                  height: H * 0.34,
                  borderRadius: u * 5,
                  transform: `rotate(${side * (i ? -6 : 8)}deg)`,
                  background: `linear-gradient(145deg, ${alpha('#FFFFFF', dark ? 0.07 : 0.4)}, ${alpha('#FFFFFF', dark ? 0.02 : 0.12)})`,
                  border: `1px solid ${alpha('#FFFFFF', dark ? 0.1 : 0.5)}`,
                }}
              />
            ))}
          </AbsoluteFill>
        );
      case 'editorial':
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, [side > 0 ? 'right' : 'left']: 0, width: canvas.isTall ? W * 0.16 : W * 0.24, background: mix(bg, ac, 0.12 * (0.5 + I)) }} />
            <div style={{ position: 'absolute', left: u * 5, right: u * 5, top: canvas.safe.y - u * 2, height: Math.max(1, u * 0.2), background: alpha(p.textPrimary, 0.35) }} />
          </AbsoluteFill>
        );
      case 'product-stage': {
        const hz = canvas.isTall ? 0.66 : 0.7;
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: [
                `radial-gradient(${canvas.isTall ? '80% 30%' : '45% 40%'} at 50% ${hz * 100 + 2}%, ${alpha('#000000', dark ? 0.45 : 0.14)} 0%, transparent 70%)`,
                `radial-gradient(${canvas.isTall ? '95% 50%' : '60% 75%'} at 50% ${hz * 100 - 22}%, ${alpha(light, 0.5 * I + 0.12)} 0%, transparent 70%)`,
                `linear-gradient(180deg, ${bg} 0%, ${bg} ${hz * 100}%, ${mix(bg, dark ? '#000000' : ac, dark ? 0.35 : 0.06)} 100%)`,
              ].join(', '),
            }}
          />
        );
      }
      case 'paper':
        return (
          <AbsoluteFill style={{ opacity: o, background: `linear-gradient(180deg, ${mix(bg, '#FFFFFF', 0.25)} 0%, ${bg} 60%, ${mix(bg, '#000000', 0.04)} 100%)` }}>
            <div style={{ position: 'absolute', left: u * 5, right: u * 5, top: u * 7, height: Math.max(1, u * 0.22), background: alpha(p.textPrimary, 0.4) }} />
          </AbsoluteFill>
        );
      case 'light-sweep': {
        const period = 7;
        const ph = loopFrames ? ((frame / loopFrames) * Math.max(1, Math.round(loopFrames / fps / period))) % 1 : ((frame / fps) / period) % 1;
        const x = -40 + ph * 180;
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: `linear-gradient(${side > 0 ? 110 : 70}deg, transparent ${x - 22}%, ${alpha(light, 0.18 * I + 0.04)} ${x}%, transparent ${x + 22}%), linear-gradient(170deg, ${mix(bg, ac, 0.08 * I)}, ${bg})`,
            }}
          />
        );
      }
      case 'shadow-field':
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: `linear-gradient(180deg, ${alpha('#000000', dark ? 0.35 : 0.08)} 0%, transparent 28%, transparent 72%, ${alpha('#000000', dark ? 0.4 : 0.1)} 100%), radial-gradient(60% 40% at 50% 45%, ${alpha(ac, 0.1 * I)}, transparent 70%)`,
            }}
          />
        );

      // ── Pattern kinds: only reachable when design.allowPatterns names them ──
      case 'grid': {
        const step = u * 9;
        return <AbsoluteFill style={{ opacity: o * 0.8, backgroundImage: `linear-gradient(${alpha(p.textPrimary, 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(p.textPrimary, 0.06)} 1px, transparent 1px)`, backgroundSize: `${step}px ${step}px`, maskImage: 'radial-gradient(70% 60% at 50% 45%, #000, transparent)', WebkitMaskImage: 'radial-gradient(70% 60% at 50% 45%, #000, transparent)' }} />;
      }
      case 'lines':
        return (
          <AbsoluteFill style={{ opacity: o }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: ((i + 1) / 6) * W, width: 1, background: alpha(p.textPrimary, 0.06) }} />
            ))}
          </AbsoluteFill>
        );
      case 'dots': {
        const step = u * 4.2;
        return <AbsoluteFill style={{ opacity: o, backgroundImage: `radial-gradient(${alpha(p.textPrimary, dark ? 0.12 : 0.1)} ${u * 0.22}px, transparent ${u * 0.26}px)`, backgroundSize: `${step}px ${step}px` }} />;
      }
      case 'halftone': {
        const step = u * 2.6;
        return <AbsoluteFill style={{ opacity: o, backgroundImage: `radial-gradient(${alpha(p.primary, 0.22)} ${u * 0.55}px, transparent ${u * 0.6}px)`, backgroundSize: `${step}px ${step}px`, maskImage: 'radial-gradient(75% 75% at 85% 15%, #000, transparent)', WebkitMaskImage: 'radial-gradient(75% 75% at 85% 15%, #000, transparent)' }} />;
      }
      case 'stripes':
        return <AbsoluteFill style={{ opacity: o, background: `repeating-linear-gradient(-28deg, transparent 0 ${u * 10}px, ${alpha(ac, 0.07 * (0.5 + I))} ${u * 10}px ${u * 16}px)` }} />;
      case 'bokeh':
      case 'particles':
        return (
          <AbsoluteFill style={{ opacity: o }}>
            {Array.from({ length: k === 'bokeh' ? 10 : 18 }, (_, i) => {
              const x = ((i * 137) % 100) / 100;
              const y = ((i * 71) % 100) / 100;
              const r = u * (k === 'bokeh' ? 2 + (i % 5) * 1.6 : 0.3 + (i % 3) * 0.2);
              return <div key={i} style={{ position: 'absolute', left: x * W + wv(0.05, i) * u * 3 - r, top: y * H + wv(0.04, i + 1) * u * 3 - r, width: r * 2, height: r * 2, borderRadius: '50%', background: i % 2 ? ac : p.accent, opacity: 0.08 * I + 0.02 }} />;
            })}
          </AbsoluteFill>
        );
      default:
        return null;
    }
  };

  // Grain lives inside the background (under content): a separate full-frame overlay
  // with a blend mode measured as ~30% of render time for no readable gain.
  const grain = effects === 'full' && t.texture.grain > 0 ? Math.min(0.14, t.texture.grain) : 0;
  return (
    <AbsoluteFill style={{ background: bg }}>
      {layer(kind)}
      {secondary && secondary !== kind ? layer(secondary, true) : null}
      {grain ? <AbsoluteFill style={{ backgroundImage: `url(${staticFile(dark ? 'tex/grain-light.png' : 'tex/grain-dark.png')})`, backgroundSize: `${Math.round(u * 24)}px`, opacity: grain * 4 }} /> : null}
    </AbsoluteFill>
  );
}

export function TextureOverlay() {
  const { tokens: t } = useVideo();
  if (t.texture.vignette <= 0) return null;
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${alpha('#000000', t.texture.vignette * (t.mode === 'dark' ? 0.75 : 0.25))} 100%)`, pointerEvents: 'none' }} />;
}

export { adjust, Img };
