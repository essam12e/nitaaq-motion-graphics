/**
 * Style-driven animated backgrounds + texture overlays. Driven by the global
 * frame so backgrounds flow continuously across scene cuts.
 */
import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { useVideo } from '../engine/context';
import { alpha, mix, adjust } from '../brand/color';
import type { BackgroundKind } from '../styles/tokens';

export function Background({ frame, kind: kindOverride, color, accent }: { frame: number; kind?: string; color?: string; accent?: string }) {
  const { tokens: t, canvas } = useVideo();
  const p = t.palette;
  const W = canvas.width;
  const H = canvas.height;
  const u = canvas.u;
  const kind = (kindOverride ?? t.background.kind) as BackgroundKind;
  const bg = color ?? p.background;
  const ac = accent ?? p.primary;
  const I = t.background.intensity;
  const s = t.background.animate ? frame / 30 : 0;
  const dark = t.mode === 'dark';

  const layer = (k: BackgroundKind, second = false): React.ReactNode => {
    const o = second ? 0.5 : 1;
    switch (k) {
      case 'gradient':
        return <AbsoluteFill style={{ background: `linear-gradient(${160 + Math.sin(s * 0.2) * 10}deg, ${mix(bg, ac, 0.1 * I)} 0%, ${bg} 55%, ${mix(bg, p.secondary, 0.14 * I)} 100%)`, opacity: o }} />;
      case 'noise-gradient':
        return (
          <AbsoluteFill style={{ opacity: o, background: `radial-gradient(120% 80% at ${50 + Math.sin(s * 0.15) * 12}% 0%, ${mix(bg, ac, 0.16 * I)} 0%, ${bg} 60%), ${bg}` }} />
        );
      case 'mesh': {
        const blobs = [
          { x: 0.2 + Math.sin(s * 0.21) * 0.08, y: 0.18 + Math.cos(s * 0.17) * 0.06, r: 0.55, c: ac, a: 0.36 },
          { x: 0.85 + Math.cos(s * 0.19) * 0.07, y: 0.55 + Math.sin(s * 0.23) * 0.07, r: 0.5, c: p.secondary, a: 0.3 },
          { x: 0.3 + Math.sin(s * 0.13) * 0.1, y: 0.92 + Math.cos(s * 0.16) * 0.05, r: 0.45, c: p.accent, a: 0.22 },
        ];
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                {blobs.map((b, i) => (
                  <radialGradient id={`mb${i}`} key={i} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={b.c} stopOpacity={b.a * I * (dark ? 1 : 0.7)} />
                    <stop offset="100%" stopColor={b.c} stopOpacity={0} />
                  </radialGradient>
                ))}
              </defs>
              {blobs.map((b, i) => (
                <ellipse key={i} cx={b.x * W} cy={b.y * H} rx={b.r * Math.max(W, H) * 0.7} ry={b.r * Math.max(W, H) * 0.55} fill={`url(#mb${i})`} />
              ))}
            </svg>
          </AbsoluteFill>
        );
      }
      case 'aurora': {
        const bands = [0, 1, 2];
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                {[ac, p.secondary, p.accent].map((c, i) => (
                  <linearGradient id={`au${i}`} key={i} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0} />
                    <stop offset="50%" stopColor={c} stopOpacity={0.42 * I} />
                    <stop offset="100%" stopColor={c} stopOpacity={0} />
                  </linearGradient>
                ))}
                <filter id="aublur">
                  <feGaussianBlur stdDeviation={u * 7} />
                </filter>
              </defs>
              <g filter="url(#aublur)">
                {bands.map((i) => {
                  const y0 = H * (0.12 + i * 0.22) + Math.sin(s * 0.3 + i) * u * 6;
                  const d = `M ${-W * 0.2} ${y0} C ${W * 0.25} ${y0 - u * 22 + Math.sin(s * 0.4 + i) * u * 8}, ${W * 0.6} ${y0 + u * 26}, ${W * 1.2} ${y0 - u * 8} L ${W * 1.2} ${y0 + u * 18} C ${W * 0.6} ${y0 + u * 40}, ${W * 0.3} ${y0 + u * 4}, ${-W * 0.2} ${y0 + u * 16} Z`;
                  return <path key={i} d={d} fill={`url(#au${i})`} />;
                })}
              </g>
            </svg>
          </AbsoluteFill>
        );
      }
      case 'grid': {
        const step = u * 9;
        const off = (s * u * 1.5) % step;
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                <pattern id="grid" width={step} height={step} patternUnits="userSpaceOnUse" x={0} y={off}>
                  <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke={alpha(p.textPrimary, (dark ? 0.07 : 0.07) * (0.5 + I))} strokeWidth={1} />
                </pattern>
                <radialGradient id="gridfade" cx="50%" cy="45%" r="70%">
                  <stop offset="0%" stopColor="#fff" stopOpacity={1} />
                  <stop offset="100%" stopColor="#fff" stopOpacity={0.1} />
                </radialGradient>
                <mask id="gridmask">
                  <rect width={W} height={H} fill="url(#gridfade)" />
                </mask>
              </defs>
              <rect width={W} height={H} fill="url(#grid)" mask="url(#gridmask)" />
            </svg>
            <AbsoluteFill style={{ background: `radial-gradient(60% 45% at 50% 40%, ${alpha(ac, 0.12 * I)}, transparent 70%)` }} />
          </AbsoluteFill>
        );
      }
      case 'dots': {
        const step = u * 4.2;
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                <pattern id="dots" width={step} height={step} patternUnits="userSpaceOnUse" y={(s * u) % step}>
                  <circle cx={step / 2} cy={step / 2} r={u * 0.22} fill={alpha(p.textPrimary, (dark ? 0.12 : 0.1) * (0.5 + I))} />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="url(#dots)" />
            </svg>
          </AbsoluteFill>
        );
      }
      case 'spotlight':
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: `radial-gradient(${canvas.isTall ? '90% 55%' : '60% 80%'} at ${50 + Math.sin(s * 0.25) * 8}% ${canvas.isTall ? 30 : 38}%, ${alpha(mix(bg, ac, 0.35), 0.9 * I + 0.1)} 0%, ${alpha(bg, 0)} 70%)`,
            }}
          />
        );
      case 'rays': {
        const n = 9;
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ac} stopOpacity={0.22 * I} />
                  <stop offset="100%" stopColor={ac} stopOpacity={0} />
                </linearGradient>
                <filter id="rayblur">
                  <feGaussianBlur stdDeviation={u * 1.6} />
                </filter>
              </defs>
              <g filter="url(#rayblur)" transform={`translate(${W * 0.5} ${-H * 0.05}) rotate(${Math.sin(s * 0.2) * 4})`}>
                {Array.from({ length: n }, (_, i) => {
                  const a = ((i - (n - 1) / 2) * 9 * Math.PI) / 180;
                  const L = Math.max(W, H) * 1.3;
                  const wdt = u * (2 + (i % 3));
                  return <polygon key={i} points={`0,0 ${Math.sin(a) * L - wdt * 3},${Math.cos(a) * L} ${Math.sin(a) * L + wdt * 3},${Math.cos(a) * L}`} fill="url(#ray)" opacity={0.6 + 0.4 * Math.sin(s * 0.8 + i)} />;
                })}
              </g>
            </svg>
          </AbsoluteFill>
        );
      }
      case 'lines': {
        const n = 7;
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              {Array.from({ length: n }, (_, i) => {
                const x = ((i + 1) / (n + 1)) * W;
                return <line key={i} x1={x} y1={0} x2={x} y2={H} stroke={alpha(p.textPrimary, 0.05 + 0.03 * I)} strokeWidth={1} />;
              })}
              <rect x={u * 3} y={u * 3} width={W - u * 6} height={H - u * 6} fill="none" stroke={alpha(p.textPrimary, 0.08)} strokeWidth={1} />
            </svg>
            <AbsoluteFill style={{ background: `radial-gradient(55% 40% at ${50 + Math.sin(s * 0.3) * 10}% ${35 + Math.cos(s * 0.2) * 6}%, ${alpha(ac, 0.16 * I)}, transparent 72%)` }} />
          </AbsoluteFill>
        );
      }
      case 'paper':
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <line x1={u * 5} y1={u * 7} x2={W - u * 5} y2={u * 7} stroke={alpha(p.textPrimary, 0.5)} strokeWidth={u * 0.25} />
              <line x1={u * 5} y1={H - u * 7} x2={W - u * 5} y2={H - u * 7} stroke={alpha(p.textPrimary, 0.35)} strokeWidth={u * 0.15} />
            </svg>
          </AbsoluteFill>
        );
      case 'halftone': {
        const step = u * 2.6;
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              <defs>
                <pattern id="ht" width={step} height={step} patternUnits="userSpaceOnUse" patternTransform={`rotate(20) translate(${(s * u) % step} 0)`}>
                  <circle cx={step / 2} cy={step / 2} r={u * 0.55} fill={alpha(p.primary, 0.22 * (0.4 + I))} />
                </pattern>
                <radialGradient id="htf" cx="85%" cy="15%" r="75%">
                  <stop offset="0%" stopColor="#fff" stopOpacity={1} />
                  <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                </radialGradient>
                <mask id="htm">
                  <rect width={W} height={H} fill="url(#htf)" />
                </mask>
              </defs>
              <rect width={W} height={H} fill="url(#ht)" mask="url(#htm)" />
            </svg>
          </AbsoluteFill>
        );
      }
      case 'stripes': {
        const off = (s * u * 6) % (u * 16);
        return (
          <AbsoluteFill
            style={{
              opacity: o,
              background: `repeating-linear-gradient(-28deg, transparent 0 ${u * 10}px, ${alpha(ac, 0.07 * (0.5 + I))} ${u * 10}px ${u * 16}px)`,
              backgroundPosition: `${off}px 0`,
            }}
          />
        );
      }
      case 'bokeh':
        return (
          <AbsoluteFill style={{ opacity: o }}>
            <svg width={W} height={H} style={{ position: 'absolute' }}>
              {Array.from({ length: 14 }, (_, i) => {
                const x = ((i * 137) % 100) / 100;
                const y = ((i * 71) % 100) / 100;
                const r = u * (2 + (i % 5) * 1.6);
                return <circle key={i} cx={x * W + Math.sin(s * 0.3 + i) * u * 3} cy={y * H + Math.cos(s * 0.25 + i) * u * 3} r={r} fill={i % 2 ? ac : p.accent} opacity={0.08 * I + 0.02} />;
              })}
            </svg>
          </AbsoluteFill>
        );
      case 'solid':
      default:
        return null;
    }
  };

  return (
    <AbsoluteFill style={{ background: bg }}>
      {layer(kind)}
      {t.background.secondaryKind && !kindOverride ? layer(t.background.secondaryKind, true) : null}
    </AbsoluteFill>
  );
}

export function TextureOverlay({ frame }: { frame: number }) {
  const { tokens: t } = useVideo();
  return (
    <>
      {t.texture.vignette > 0 ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${alpha('#000000', t.texture.vignette * (t.mode === 'dark' ? 0.75 : 0.25))} 100%)`, pointerEvents: 'none' }} />
      ) : null}
      {t.texture.grain > 0 ? (
        <AbsoluteFill
          style={{
            backgroundImage: `url(${staticFile('tex/grain.png')})`,
            backgroundSize: '400px 400px',
            backgroundPosition: `${(frame * 37) % 400}px ${(frame * 53) % 400}px`,
            opacity: t.texture.grain,
            mixBlendMode: t.mode === 'dark' ? 'screen' : 'multiply',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
}

export { adjust, Img };
