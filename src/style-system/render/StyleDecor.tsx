/**
 * Style Library v2 decor: the style's world (rules, floor, light, colour fields) and its frame
 * (letterbox, HUD, hairline frame). Large intentional forms only — never scattered decoration; the
 * blueprint grid is the one pattern, and it renders only because the style was chosen (the pattern
 * allowance is written into the spec with that reason). Deterministic: a pure function of t.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, mix } from '../../brand/color';
import { shapePath } from '../../morph/shapes';
import type { Look } from './look';

const WORLD = new Set(['swiss-rules', 'editorial-rules', 'blueprint-grid', 'iso-floor', 'aurora', 'liquid-blobs', 'bauhaus-field', 'spotlight-floor', 'speed-slash', 'paper-scraps', 'soft-room', 'color-field', 'sunburst']);
const FRAME = new Set(['letterbox', 'hud-brackets', 'luxury-frame']);

export function StyleWorld({ look, W, H, u, t, rtl, reduced }: { look: Look; W: number; H: number; u: number; t: number; rtl: boolean; reduced: boolean }) {
  const k = look.decor.kind;
  if (!WORLD.has(k)) return null;
  const R = look.roles;
  const I = look.decor.intensity;
  const startX = (f: number) => (rtl ? W * (1 - f) : W * f);
  let body: React.ReactNode = null;
  switch (k) {
    case 'swiss-rules':
      body = (
        <>
          <rect x={startX(4 / 6) - (rtl ? 0 : 0.5 * u)} y={0} width={0.5 * u} height={H} fill={alpha(R.ink, 0.85 * I)} />
          <rect x={0} y={H * 0.76} width={W} height={0.5 * u} fill={alpha(R.ink, 0.85 * I)} />
          <rect x={rtl ? W - 9 * u : 3 * u} y={3 * u} width={6 * u} height={6 * u} fill={R.signal} />
        </>
      );
      break;
    case 'editorial-rules':
      body = (
        <>
          <rect x={4 * u} y={H * 0.07} width={W - 8 * u} height={0.35 * u} fill={alpha(R.ink, 0.8 * I)} />
          <rect x={4 * u} y={H * 0.07 + 0.9 * u} width={W - 8 * u} height={0.12 * u} fill={alpha(R.ink, 0.8 * I)} />
          <rect x={4 * u} y={H * 0.93} width={W - 8 * u} height={0.12 * u} fill={alpha(R.ink, 0.6 * I)} />
          <rect x={rtl ? W - 4.6 * u : 4 * u} y={H * 0.07} width={0.6 * u} height={3.2 * u} fill={R.signal} />
        </>
      );
      break;
    case 'blueprint-grid': {
      const minor = 5 * u;
      const lines: React.ReactNode[] = [];
      for (let x = 0, i = 0; x <= W; x += minor, i++) lines.push(<rect key={`x${i}`} x={x} y={0} width={i % 5 ? 0.06 * u : 0.14 * u} height={H} fill={alpha(R.keyline, i % 5 ? 0.07 * I : 0.16 * I)} />);
      for (let y = 0, i = 0; y <= H; y += minor, i++) lines.push(<rect key={`y${i}`} x={0} y={y} width={W} height={i % 5 ? 0.06 * u : 0.14 * u} fill={alpha(R.keyline, i % 5 ? 0.07 * I : 0.16 * I)} />);
      body = <>{lines}</>;
      break;
    }
    case 'iso-floor': {
      const cx = W / 2;
      const cy = H * 0.6;
      const rx = Math.min(W, H * 1.6) * 0.46;
      const ry = rx * Math.tan(Math.PI / 6);
      const d = `M${cx} ${cy - ry} L${cx + rx} ${cy} L${cx} ${cy + ry} L${cx - rx} ${cy} Z`;
      const th = 2.2 * u;
      body = (
        <>
          <path d={`M${cx - rx} ${cy} L${cx} ${cy + ry} L${cx} ${cy + ry + th} L${cx - rx} ${cy + th} Z`} fill={alpha(R.faceLeft, 0.55 * I)} />
          <path d={`M${cx + rx} ${cy} L${cx} ${cy + ry} L${cx} ${cy + ry + th} L${cx + rx} ${cy + th} Z`} fill={alpha(R.faceRight, 0.55 * I)} />
          <path d={d} fill={alpha(mix(R.ground, R.faceTop, 0.45), I)} />
        </>
      );
      break;
    }
    case 'aurora': {
      const blobs = [
        { c: R.signal, x: 0.25 + 0.06 * Math.sin(t * 0.35), y: 0.3 + 0.05 * Math.cos(t * 0.3), r: 0.55 },
        { c: R.second, x: 0.78 + 0.05 * Math.cos(t * 0.28), y: 0.62 + 0.06 * Math.sin(t * 0.33), r: 0.6 },
        { c: R.third, x: 0.45 + 0.07 * Math.sin(t * 0.22 + 1), y: 0.85, r: 0.5 },
      ];
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          {blobs.map((b, i) => (
            <div key={i} style={{ position: 'absolute', left: b.x * W - b.r * W, top: b.y * H - b.r * W, width: b.r * W * 2, height: b.r * W * 2, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(b.c, 0.55 * I)}, ${alpha(b.c, 0)} 65%)`, filter: reduced ? undefined : `blur(${4 * u}px)` }} />
          ))}
        </AbsoluteFill>
      );
    }
    case 'liquid-blobs': {
      const m = Math.max(W, H);
      const one = (seed: number, x: number, y: number, size: number, col: string, ph: number) => {
        const sc = size * (1 + 0.04 * Math.sin(t * 0.8 + ph));
        const d = shapePath('blob', 100, seed);
        return (
          <g key={seed} transform={`translate(${x - sc / 2} ${y - sc / 2}) scale(${sc / 100}) rotate(${(t * 6 + ph * 20) % 360} 50 50)`}>
            <path d={d} fill={`url(#lq${seed})`} />
            <defs>
              <linearGradient id={`lq${seed}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={mix(col, '#FFFFFF', 0.35)} />
                <stop offset="0.6" stopColor={col} />
                <stop offset="1" stopColor={mix(col, '#000000', 0.15)} />
              </linearGradient>
            </defs>
          </g>
        );
      };
      body = (
        <g opacity={I}>
          {one(3, rtl ? W * 0.02 : W * 0.98, H * 0.06, m * 0.42, R.signal, 0)}
          {one(7, rtl ? W * 0.96 : W * 0.04, H * 0.94, m * 0.48, R.second, 1.3)}
          {one(11, rtl ? W * 0.2 : W * 0.8, H * 0.82, m * 0.16, R.third, 2.1)}
        </g>
      );
      break;
    }
    case 'bauhaus-field': {
      const m = Math.min(W, H);
      body = (
        <g opacity={I}>
          <circle cx={startX(0.96)} cy={H * 0.92} r={m * 0.34} fill={R.signal} />
          <path d={`M${startX(0)} ${0} L${startX(0.42)} 0 L${startX(0)} ${m * 0.42} Z`} fill={R.third} />
          <rect x={W * 0.06} y={H * 0.04} width={W * 0.88} height={1.2 * u} fill={R.ink} />
        </g>
      );
      break;
    }
    case 'spotlight-floor':
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: H * 0.8, background: `conic-gradient(from 168deg at 50% -8%, transparent 0deg, ${alpha(R.light, 0.22 * I)} 12deg, ${alpha(R.light, 0.3 * I)} 24deg, transparent 36deg)` }} />
          <div style={{ position: 'absolute', left: W * 0.14, width: W * 0.72, top: H * 0.66, height: H * 0.16, borderRadius: '50%', background: `radial-gradient(ellipse, ${alpha(R.light, 0.32 * I)}, ${alpha(R.light, 0)} 70%)` }} />
        </AbsoluteFill>
      );
    case 'speed-slash': {
      const dx = (t * 0.02) % 0.1;
      const band = (y0: number, h: number, col: string, o: number, key: string) => {
        const sk = H * 0.18;
        const x0 = -W * 0.1 + dx * W;
        return <path key={key} d={`M${x0} ${y0 + sk} L${x0 + W * 1.2} ${y0} L${x0 + W * 1.2} ${y0 + h} L${x0} ${y0 + sk + h} Z`} fill={alpha(col, o * I)} />;
      };
      body = (
        <g transform={rtl ? `scale(-1 1) translate(${-W} 0)` : undefined}>
          {band(H * 0.02, H * 0.05, R.signal, 0.9, 'a')}
          {band(H * 0.1, H * 0.012, R.ink, 0.6, 'b')}
          {band(H * 0.84, H * 0.06, R.signal, 0.85, 'c')}
          {band(H * 0.93, H * 0.012, R.ink, 0.5, 'd')}
        </g>
      );
      break;
    }
    case 'paper-scraps': {
      const scrap = (x: number, y: number, w: number, h: number, r: number, col: string, key: string) => (
        <g key={key} transform={`rotate(${r} ${x} ${y})`}>
          <rect x={x - w / 2 + 0.6 * u} y={y - h / 2 + 0.8 * u} width={w} height={h} fill={alpha('#000000', 0.18)} />
          <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill={col} />
          <rect x={x - w * 0.18} y={y - h / 2 - 1.2 * u} width={w * 0.36} height={2.4 * u} fill={alpha('#FFFFFF', 0.65)} />
        </g>
      );
      body = (
        <g opacity={I}>
          {scrap(startX(0.12), H * 0.1, W * 0.28, H * 0.09, -8, R.second, 'a')}
          {scrap(startX(0.88), H * 0.9, W * 0.32, H * 0.1, 6, R.third, 'b')}
          {scrap(startX(0.92), H * 0.14, W * 0.12, W * 0.12, 12, R.signal, 'c')}
        </g>
      );
      break;
    }
    case 'soft-room':
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: H * 0.64, bottom: 0, background: `linear-gradient(180deg, ${alpha(mix(R.ground, R.signal, 0.25), 0.7 * I)}, ${alpha(mix(R.ground, R.signal, 0.12), 0.9 * I)})` }} />
          <div style={{ position: 'absolute', left: W * 0.18, width: W * 0.64, top: H * 0.62, height: H * 0.08, borderRadius: '50%', background: `radial-gradient(ellipse, ${alpha('#FFFFFF', 0.5 * I)}, transparent 70%)` }} />
        </AbsoluteFill>
      );
    case 'color-field': {
      const m = Math.max(W, H);
      body = (
        <g opacity={I}>
          <circle cx={startX(1.02)} cy={H * 0.98} r={m * 0.32} fill={R.second} />
          <circle cx={startX(-0.04)} cy={H * 0.04} r={m * 0.2} fill={R.third} />
        </g>
      );
      break;
    }
    case 'sunburst': {
      const n = 18;
      const cx = W / 2;
      const cy = H * 0.48;
      const L = Math.hypot(W, H);
      const rot = (t * 8) % 360;
      body = (
        <g transform={`rotate(${rot} ${cx} ${cy})`} opacity={I}>
          {Array.from({ length: n }, (_, i) => {
            const a0 = (i / n) * Math.PI * 2;
            const a1 = a0 + Math.PI / n;
            return <path key={i} d={`M${cx} ${cy} L${cx + Math.cos(a0) * L} ${cy + Math.sin(a0) * L} L${cx + Math.cos(a1) * L} ${cy + Math.sin(a1) * L} Z`} fill={alpha(i % 2 ? R.second : '#FFFFFF', 0.16)} />;
          })}
        </g>
      );
      break;
    }
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} data-qc="style-decor" data-qc-decor={k}>
      {body}
    </svg>
  );
}

export function StyleFrame({ look, W, H, u }: { look: Look; W: number; H: number; u: number }) {
  const k = look.decor.kind;
  if (!FRAME.has(k)) return null;
  const R = look.roles;
  const I = look.decor.intensity;
  if (k === 'letterbox') {
    const bar = W / H > 1.05 ? H * 0.11 : H * 0.045;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }} data-qc="style-frame" data-qc-decor={k}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: bar, background: '#000' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bar, background: '#000' }} />
      </AbsoluteFill>
    );
  }
  if (k === 'hud-brackets') {
    const m = 3 * u;
    const L = 6 * u;
    const sw = 0.3 * u;
    const col = alpha(R.signal, 0.75 * I);
    const corner = (x: number, y: number, dx: number, dy: number, key: string) => <path key={key} d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} stroke={col} strokeWidth={sw} fill="none" />;
    return (
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-qc="style-frame" data-qc-decor={k}>
        {corner(m, m, 1, 1, 'a')}
        {corner(W - m, m, -1, 1, 'b')}
        {corner(m, H - m, 1, -1, 'c')}
        {corner(W - m, H - m, -1, -1, 'd')}
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={m + 1.2 * u} y={H * 0.3 + i * 1.6 * u} width={i % 4 ? 0.8 * u : 1.8 * u} height={0.14 * u} fill={col} />
        ))}
      </svg>
    );
  }
  // luxury hairline frame (metal from the brand accent)
  const m = 3.4 * u;
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-qc="style-frame" data-qc-decor={k}>
      <defs>
        <linearGradient id="lux-metal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={R.metal} />
          <stop offset="0.5" stopColor={R.metalDark} />
          <stop offset="1" stopColor={R.metal} />
        </linearGradient>
      </defs>
      <rect x={m} y={m} width={W - 2 * m} height={H - 2 * m} fill="none" stroke="url(#lux-metal)" strokeWidth={0.12 * u} opacity={I} />
      {[
        [W / 2, m],
        [W / 2, H - m],
      ].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 0.8 * u} L${x + 0.8 * u} ${y} L${x} ${y + 0.8 * u} L${x - 0.8 * u} ${y} Z`} fill={R.metal} opacity={I} />
      ))}
    </svg>
  );
}
