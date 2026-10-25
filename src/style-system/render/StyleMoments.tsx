/**
 * Native Style Moments (Style Library v2): the style's signature moves, performed with the style's own
 * forms on the film's real elements — a Swiss column floods the frame and the next shot is printed on
 * it, an isometric plinth rises under the hero and blocks drop onto it, a gold hairline unfolds around
 * the product, brackets scan and lock onto the target … Each one starts from an element (its screen
 * box at that instant, through the camera) and, for boundary moments, ends on the next shot's element.
 * Identity assets are framed, never covered or recoloured. Deterministic: a pure function of t.
 */
import React from 'react';
import { alpha, mix } from '../../brand/color';
import { shapePath } from '../../morph/shapes';
import type { StageStyleMoment } from '../../stage/plan';
import type { Look } from './look';

export interface ScreenBox { cx: number; cy: number; w: number; h: number }
type BoxFn = (id: string | undefined, t: number) => ScreenBox | null;

/** Moments drawn behind the elements (a ground for the hero); the rest are drawn in front. */
export const BACK_MOMENTS = new Set(['iso-assemble', 'bauhaus-build', 'spotlight-stage', 'stamp-burst', 'blob-merge', 'squash-stack', 'rule-divides', 'drafting']);

const c01 = (v: number) => Math.max(0, Math.min(1, v));
const seg = (p: number, a: number, b: number) => c01((p - a) / Math.max(1e-6, b - a));
const outCubic = (x: number) => 1 - (1 - x) ** 3;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const whip = (x: number) => (x < 0.35 ? (x / 0.35) ** 3 * 0.15 : 0.15 + 0.85 * outCubic((x - 0.35) / 0.65));
const back = (x: number, k = 1.7) => 1 + (k + 1) * (x - 1) ** 3 + k * (x - 1) ** 2;

export function StyleMoments({ look, moments, layer, t, W, H, u, rtl, boxOf, shotEnd, reduced }: {
  look: Look;
  moments: StageStyleMoment[];
  layer: 'back' | 'front';
  t: number;
  W: number;
  H: number;
  u: number;
  rtl: boolean;
  boxOf: BoxFn;
  shotEnd: (shot: string) => number;
  reduced: boolean;
}) {
  const R = look.roles;
  const out: React.ReactNode[] = [];
  const svgParts: React.ReactNode[] = [];
  for (const m of moments) {
    if ((layer === 'back') !== BACK_MOMENTS.has(m.builder)) continue;
    const persistent = m.at !== 'end';
    const end = persistent ? Math.max(m.t1, shotEnd(m.shot)) : m.t1;
    if (t < m.t0 || t > end) continue;
    const p = c01((t - m.t0) / Math.max(1e-3, m.t1 - m.t0));
    // a persistent moment fades out over the last 0.3 s of its shot
    const tail = persistent ? c01((end - t) / 0.3) : 1;
    const a = boxOf(m.element, t) ?? { cx: W / 2, cy: H / 2, w: W * 0.4, h: H * 0.25 };
    const b = boxOf(m.into, Math.min(m.t1 + 0.35, t + 0.6)) ?? { cx: W / 2, cy: H / 2, w: W * 0.4, h: H * 0.25 };
    const key = `${m.id}-${m.shot}`;
    const sx = rtl ? -1 : 1;
    let g: React.ReactNode = null;
    switch (m.builder) {
      case 'grid-flood': {
        // one column at the reading start rises, floods the frame toward the reading end, then retracts the same way
        const cw = W / 6;
        // stops one column short of the far edge: a frame is never one flat colour (QC blank-frame rule)
        const r = cw + whip(seg(p, 0.15, 0.5)) * (W - 2 * cw);
        const l = whip(seg(p, 0.62, 1)) * r;
        const y = H * (1 - outCubic(seg(p, 0, 0.22)));
        g = <rect x={rtl ? W - r : l} y={y} width={Math.max(0, r - l)} height={H - y} fill={R.signal} />;
        break;
      }
      case 'knife-cut': {
        const draw = whip(seg(p, 0, 0.3));
        const close = inOut(seg(p, 0.3, 0.55));
        const open = inOut(seg(p, 0.62, 1));
        const k = 0.8 * close * (1 - open); // the blades never fully close (a frame is never one flat colour)
        const y = a.cy;
        g = (
          <>
            <rect x={0} y={0} width={W} height={y * k} fill={R.ink} />
            <rect x={0} y={H - (H - y) * k} width={W} height={(H - y) * k} fill={R.ink} />
            <rect x={rtl ? W * (1 - draw) : 0} y={y - 0.35 * u} width={W * draw} height={0.7 * u} fill={R.signal} opacity={1 - open} />
          </>
        );
        break;
      }
      case 'rule-divides': {
        const d = outCubic(seg(p, 0, 0.7));
        const x = a.cx - (sx * a.w) / 2 - sx * 2.2 * u;
        const top = Math.max(H * 0.1, a.cy - a.h * 0.9);
        const len = Math.min(H * 0.8, a.h * 1.8);
        g = (
          <g opacity={tail}>
            <rect x={x - 0.18 * u} y={top} width={0.36 * u} height={len * d} fill={R.ink} />
            <rect x={rtl ? a.cx + a.w / 2 - a.w * d : a.cx - a.w / 2} y={a.cy + a.h / 2 + 1.6 * u} width={a.w * d} height={0.22 * u} fill={R.signal} />
          </g>
        );
        break;
      }
      case 'color-block-wipe':
      case 'word-slam': {
        // the element's own form grows into a full colour field, then gathers into the next element
        const grow = m.builder === 'word-slam' ? back(seg(p, 0, 0.45), 1.2) : inOut(seg(p, 0, 0.5));
        const gather = inOut(seg(p, 0.55, 1));
        const cx = a.cx + (b.cx - a.cx) * gather;
        const cy = a.cy + (b.cy - a.cy) * gather;
        const col = m.builder === 'word-slam' ? R.signal : R.second;
        if (m.builder === 'word-slam') {
          const w0 = a.w * 1.1;
          const h0 = a.h * 1.1;
          const w = (w0 + (W * 0.82 - w0) * c01(grow)) * (1 - gather) + b.w * 1.1 * gather;
          const h = (h0 + (H * 0.78 - h0) * c01(grow)) * (1 - gather) + b.h * 1.1 * gather;
          g = <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} fill={col} opacity={1 - seg(p, 0.85, 1)} />;
        } else {
          const r0 = Math.min(a.w, a.h) / 2;
          // the field peaks short of the corners (a frame is never one flat colour)
          const r = (r0 + (Math.max(W, H) * 0.46 - r0) * grow) * (1 - gather) + (Math.min(b.w, b.h) / 2) * gather;
          g = <circle cx={cx} cy={cy} r={r} fill={col} opacity={1 - seg(p, 0.88, 1)} />;
        }
        break;
      }
      case 'slash-wipe': {
        const x = -W * 0.6 + whip(p) * W * 2.2;
        const sk = W * 0.35;
        const band = (off: number, w: number, col: string, k: string) => <path key={k} d={`M${x + off} 0 L${x + off + w} 0 L${x + off + w - sk} ${H} L${x + off - sk} ${H} Z`} fill={col} />;
        g = (
          <g transform={rtl ? `scale(-1 1) translate(${-W} 0)` : undefined}>
            {band(-W * 0.12, W * 0.05, alpha(R.ink, 0.9), 'a')}
            {band(0, W * 0.75, R.signal, 'b')}
            {band(W * 0.8, W * 0.04, alpha('#FFFFFF', 0.85), 'c')}
          </g>
        );
        break;
      }
      case 'foreground-pass': {
        // a dark near-lens form crosses the frame (end → start), the next shot is behind it
        const x = W * 1.3 - inOut(p) * W * 1.9;
        const xx = rtl ? W - x : x;
        g = <ellipse cx={xx} cy={H * 0.55} rx={W * 0.42} ry={H * 0.85} fill={mix(R.ground, '#000000', 0.6)} style={{ filter: reduced ? undefined : `blur(${2.5 * u}px)` }} />;
        break;
      }
      case 'shape-relay':
      case 'card-becomes-cta': {
        // the element's outline travels and re-shapes into the next element (a ring that becomes a pill)
        const q = inOut(seg(p, 0.05, 0.9));
        const cx = a.cx + (b.cx - a.cx) * q;
        const cy = a.cy + (b.cy - a.cy) * q;
        const w = a.w + (b.w - a.w) * q;
        const h = a.h + (b.h - a.h) * q;
        const r0 = Math.min(a.w, a.h) / 2;
        const r1 = Math.min(b.w, b.h) / 2;
        const rr = r0 + (r1 - r0) * q;
        g = <rect x={cx - w / 2 - u} y={cy - h / 2 - u} width={w + 2 * u} height={h + 2 * u} rx={rr + u} fill={m.builder === 'card-becomes-cta' ? alpha(R.signal, 0.16) : 'none'} stroke={R.signal} strokeWidth={0.45 * u} opacity={Math.sin(Math.PI * c01(p))} />;
        break;
      }
      case 'line-thread': {
        const d = outCubic(seg(p, 0, 0.75));
        const x0 = a.cx;
        const y0 = a.cy + a.h / 2;
        const x1 = b.cx;
        const y1 = b.cy - b.h / 2;
        const mx = (x0 + x1) / 2 + sx * W * 0.18;
        const path = `M${x0} ${y0} Q${mx} ${(y0 + y1) / 2 + H * 0.12} ${x1} ${y1}`;
        const len = Math.hypot(x1 - x0, y1 - y0) * 1.4 + 1;
        g = <path d={path} fill="none" stroke={R.signal} strokeWidth={0.45 * u} strokeLinecap="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - d)} opacity={1 - seg(p, 0.85, 1)} />;
        break;
      }
      case 'blob-merge': {
        const q = seg(p, 0, 0.7);
        const swell = Math.sin(Math.PI * seg(p, 0.6, 1));
        const drops = [0, 1, 2, 3].map((i) => {
          const ang = (i / 4) * Math.PI * 2 + 0.6;
          const dist = Math.max(W, H) * 0.6 * (1 - outCubic(q));
          const r = Math.min(a.w, a.h) * (0.16 - 0.08 * q);
          return <circle key={i} cx={a.cx + Math.cos(ang) * dist} cy={a.cy + Math.sin(ang) * dist} r={Math.max(0, r)} fill={i % 2 ? R.second : R.signal} opacity={1 - seg(p, 0.62, 0.72)} />;
        });
        const base = Math.max(a.w, a.h) * 0.62;
        g = (
          <g opacity={tail}>
            <path d={shapePath('blob', 100, 5)} transform={`translate(${a.cx - base} ${a.cy - base}) scale(${(base * 2 * (0.9 + 0.12 * swell) * c01(seg(p, 0.55, 0.8) + (p >= 0.8 ? 1 : 0))) / 100})`} fill={alpha(R.signal, 0.35)} />
            {drops}
          </g>
        );
        break;
      }
      case 'iso-assemble': {
        // a plinth rises under the hero, blocks drop onto its corners and land with a small squash
        const pw = Math.max(a.w * 1.25, W * 0.3);
        const ph = pw * Math.tan(Math.PI / 6);
        const cx = a.cx;
        const cy = a.cy + a.h * 0.45;
        const rise = outCubic(seg(p, 0, 0.35));
        const th = 2.4 * u * rise;
        const top = `M${cx} ${cy - ph / 2} L${cx + pw / 2} ${cy} L${cx} ${cy + ph / 2} L${cx - pw / 2} ${cy} Z`;
        const blocks = [[-0.32, 0], [0.32, 0], [0, 0.3]].map(([fx, fy], i) => {
          const land = seg(p, 0.3 + i * 0.15, 0.55 + i * 0.15);
          if (land <= 0) return null;
          const bs = pw * 0.12;
          const y = cy + fy * ph - bs * 0.5 - (1 - outCubic(land)) * H * 0.3;
          const sq = land > 0.85 ? 1 - 0.15 * Math.sin(Math.PI * seg(land, 0.85, 1)) : 1;
          const x = cx + fx * pw * sx;
          const h2 = bs * 0.5;
          return (
            <g key={i} transform={`translate(${x} ${y}) scale(1 ${sq})`}>
              <path d={`M0 ${-h2} L${bs} 0 L0 ${h2} L${-bs} 0 Z`} fill={R.faceTop} />
              <path d={`M${-bs} 0 L0 ${h2} L0 ${h2 + bs} L${-bs} ${bs} Z`} fill={R.faceLeft} />
              <path d={`M${bs} 0 L0 ${h2} L0 ${h2 + bs} L${bs} ${bs} Z`} fill={R.faceRight} />
            </g>
          );
        });
        g = (
          <g opacity={tail}>
            <path d={`M${cx - pw / 2} ${cy} L${cx} ${cy + ph / 2} L${cx} ${cy + ph / 2 + th} L${cx - pw / 2} ${cy + th} Z`} fill={R.faceLeft} />
            <path d={`M${cx + pw / 2} ${cy} L${cx} ${cy + ph / 2} L${cx} ${cy + ph / 2 + th} L${cx + pw / 2} ${cy + th} Z`} fill={R.faceRight} />
            <path d={top} fill={R.faceTop} opacity={rise} />
            {blocks}
          </g>
        );
        break;
      }
      case 'scan-lock': {
        const scan = seg(p, 0, 0.5);
        const lock = outCubic(seg(p, 0.4, 0.8));
        const flash = Math.sin(Math.PI * seg(p, 0.78, 1));
        const pad = 2.5 * u + (1 - lock) * Math.max(W, H) * 0.25;
        const L = Math.min(a.w, a.h) * 0.22 + 2 * u;
        const x0 = a.cx - a.w / 2 - pad;
        const x1 = a.cx + a.w / 2 + pad;
        const y0 = a.cy - a.h / 2 - pad;
        const y1 = a.cy + a.h / 2 + pad;
        const col = R.signal;
        const sw = 0.35 * u;
        g = (
          <g opacity={tail}>
            {scan > 0 && scan < 1 ? <rect x={a.cx - a.w / 2 - 2 * u} y={a.cy - a.h / 2 + a.h * scan} width={a.w + 4 * u} height={0.25 * u} fill={col} opacity={0.9} /> : null}
            {[[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].map(([x, y, dx, dy], i) => (
              <path key={i} d={`M${x + dx * L} ${y} L${x} ${y} L${x} ${y + dy * L}`} stroke={col} strokeWidth={sw} fill="none" opacity={lock} />
            ))}
            {flash > 0 ? <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={col} strokeWidth={0.15 * u} opacity={flash} /> : null}
          </g>
        );
        break;
      }
      case 'sticker-slap': {
        const spots = [[0.55, -0.62, -12], [-0.6, 0.55, 9], [0.62, 0.5, 14]];
        g = (
          <g opacity={tail}>
            {spots.map(([fx, fy, rot], i) => {
              const k = seg(p, i * 0.22, i * 0.22 + 0.3);
              if (k <= 0) return null;
              const s = k < 0.6 ? 1.6 - k : 1;
              const sz = Math.min(W, H) * 0.09;
              const x = a.cx + fx * (a.w / 2 + sz * 0.6) * sx;
              const y = a.cy + fy * (a.h / 2 + sz * 0.6);
              const d = shapePath(i % 2 ? 'burst' : 'star', 100);
              return (
                <g key={i} transform={`translate(${x} ${y}) rotate(${rot}) scale(${(s * sz) / 100}) translate(-50 -50)`}>
                  <path d={d} fill={alpha('#000000', 0.3)} transform="translate(5 6)" />
                  <path d={d} fill={i % 2 ? R.third : R.signal} stroke={R.stickerBorder} strokeWidth={9} strokeLinejoin="round" />
                </g>
              );
            })}
          </g>
        );
        break;
      }
      case 'bauhaus-build': {
        const m0 = Math.max(a.w, a.h) * 0.75;
        const parts = [
          { k: seg(p, 0, 0.45), el: (q: number) => <circle cx={a.cx - sx * m0 * 0.55} cy={a.cy - m0 * 0.15} r={m0 * 0.5 * q} fill={R.signal} /> },
          { k: seg(p, 0.2, 0.65), el: (q: number) => <rect x={a.cx + sx * m0 * 0.1 - (rtl ? m0 * 0.7 : 0)} y={a.cy - m0 * 0.55} width={m0 * 0.7} height={m0 * 0.7} fill={R.second} transform={`rotate(${(1 - q) * 90 * sx} ${a.cx} ${a.cy})`} opacity={q} /> },
          { k: seg(p, 0.4, 0.85), el: (q: number) => <path d={`M${a.cx} ${a.cy + m0 * 0.25} L${a.cx + m0 * 0.5} ${a.cy + m0 * 0.85} L${a.cx - m0 * 0.5} ${a.cy + m0 * 0.85} Z`} fill={R.third} transform={`rotate(${(1 - q) * -90} ${a.cx} ${a.cy + m0 * 0.6})`} opacity={q} /> },
        ];
        g = <g opacity={tail}>{parts.map((x, i) => (x.k > 0 ? <g key={i}>{x.el(back(x.k, 1.2))}</g> : null))}</g>;
        break;
      }
      case 'drafting': {
        const d = outCubic(seg(p, 0, 0.75));
        const pad = 1.8 * u;
        const x0 = a.cx - a.w / 2 - pad;
        const y0 = a.cy - a.h / 2 - pad;
        const w = a.w + 2 * pad;
        const h = a.h + 2 * pad;
        const per = 2 * (w + h);
        const kl = R.keyline;
        g = (
          <g opacity={tail}>
            <rect x={x0} y={y0} width={w} height={h} fill="none" stroke={kl} strokeWidth={0.14 * u} strokeDasharray={`${per} ${per}`} strokeDashoffset={per * (1 - d)} />
            <g opacity={seg(p, 0.5, 0.9)}>
              <line x1={x0} y1={y0 - 2.4 * u} x2={x0 + w} y2={y0 - 2.4 * u} stroke={kl} strokeWidth={0.12 * u} />
              <line x1={x0} y1={y0 - 3.2 * u} x2={x0} y2={y0 - 1.6 * u} stroke={kl} strokeWidth={0.12 * u} />
              <line x1={x0 + w} y1={y0 - 3.2 * u} x2={x0 + w} y2={y0 - 1.6 * u} stroke={kl} strokeWidth={0.12 * u} />
              <line x1={x0 + w + 2.4 * u} y1={y0} x2={x0 + w + 2.4 * u} y2={y0 + h} stroke={kl} strokeWidth={0.12 * u} />
              <circle cx={a.cx} cy={a.cy} r={0.5 * u} fill="none" stroke={R.signal} strokeWidth={0.14 * u} />
            </g>
          </g>
        );
        break;
      }
      case 'spotlight-stage': {
        const open = outCubic(seg(p, 0, 0.6));
        const lift = seg(p, 0.55, 1);
        const r = Math.max(a.w, a.h) * (0.2 + 0.7 * open);
        const id = `spot-${key}`;
        g = (
          <>
            <defs>
              <radialGradient id={id} cx={a.cx / W} cy={a.cy / H} r={r / Math.max(W, H)} gradientUnits="objectBoundingBox">
                <stop offset="0" stopColor="#000" stopOpacity={0} />
                <stop offset="0.7" stopColor="#000" stopOpacity={0.2} />
                <stop offset="1" stopColor="#000" stopOpacity={0.85} />
              </radialGradient>
            </defs>
            <rect x={0} y={0} width={W} height={H} fill={`url(#${id})`} opacity={(1 - lift) * 0.9} />
            <ellipse cx={a.cx} cy={a.cy + a.h * 0.55} rx={a.w * 0.7 * open} ry={a.h * 0.09 * open + 0.5 * u} fill={alpha(R.light, 0.35 * tail)} />
          </>
        );
        break;
      }
      case 'squash-stack': {
        const pills = [0, 1, 2].map((i) => {
          const land = seg(p, i * 0.2, i * 0.2 + 0.35);
          if (land <= 0) return null;
          const w = a.w * (0.9 - i * 0.18);
          const h = Math.max(2.2 * u, a.h * 0.14);
          const yRest = a.cy + a.h / 2 + 1.2 * u + (2 - i) * (h + 0.6 * u);
          const y = yRest - (1 - outCubic(land)) * H * 0.4;
          const sq = land > 0.8 ? 1 + 0.18 * Math.sin(Math.PI * seg(land, 0.8, 1)) : 1;
          const col = [R.signal, R.second, R.third][i];
          return <rect key={i} x={a.cx - (w * sq) / 2} y={y - h / sq / 2} width={w * sq} height={h / sq} rx={h / 2} fill={col} />;
        });
        g = <g opacity={tail}>{pills}</g>;
        break;
      }
      case 'stamp-burst': {
        const k = seg(p, 0, 0.5);
        const s = k < 1 ? 1.35 - 0.35 * outCubic(k) : 1;
        const sz = Math.min(W, H) * 0.24;
        const x = a.cx + sx * (a.w / 2) * 0.85;
        const y = a.cy - a.h / 2 * 0.85;
        g = k > 0 ? (
          <g opacity={tail * c01(k * 3)} transform={`translate(${x} ${y}) rotate(${(t * 20) % 360}) scale(${(s * sz) / 100}) translate(-50 -50)`}>
            <path d={shapePath('burst', 100)} fill={R.third} stroke={R.ink} strokeWidth={3} />
          </g>
        ) : null;
        break;
      }
      case 'frost-clear': {
        const clear = inOut(seg(p, 0.1, 0.9));
        const pad = 3 * u;
        const sweep = seg(p, 0.2, 0.8);
        out.push(
          <div key={key} data-qc-style-moment={m.id} style={{ position: 'absolute', left: a.cx - a.w / 2 - pad, top: a.cy - a.h / 2 - pad, width: a.w + 2 * pad, height: a.h + 2 * pad, borderRadius: 3 * u, background: alpha('#FFFFFF', 0.22 * (1 - clear)), border: `1px solid ${alpha('#FFFFFF', 0.5 * (1 - clear))}`, backdropFilter: reduced ? undefined : `blur(${(2.4 * u * (1 - clear)).toFixed(1)}px)`, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '18%', left: `${(rtl ? 1 - sweep : sweep) * 110 - 14}%`, background: `linear-gradient(90deg, transparent, ${alpha('#FFFFFF', 0.4 * (1 - clear * 0.6))}, transparent)` }} />
          </div>,
        );
        continue;
      }
      case 'hairline-frame': {
        const d = inOut(seg(p, 0, 0.75));
        const pad = 2.6 * u;
        const x0 = a.cx - a.w / 2 - pad;
        const y0 = a.cy - a.h / 2 - pad;
        const w = a.w + 2 * pad;
        const h = a.h + 2 * pad;
        const per = 2 * (w + h);
        const di = seg(p, 0.7, 1);
        g = (
          <g opacity={tail}>
            <rect x={x0} y={y0} width={w} height={h} fill="none" stroke={R.metal} strokeWidth={0.14 * u} strokeDasharray={`${(per * d) / 2} ${per}`} strokeDashoffset={-w / 2} />
            <rect x={x0} y={y0} width={w} height={h} fill="none" stroke={R.metal} strokeWidth={0.14 * u} strokeDasharray={`${(per * d) / 2} ${per}`} strokeDashoffset={-w / 2 - per / 2} />
            {[[a.cx, y0], [a.cx, y0 + h]].map(([x, y], i) => (
              <path key={i} d={`M${x} ${y - 0.8 * u * di} L${x + 0.8 * u * di} ${y} L${x} ${y + 0.8 * u * di} L${x - 0.8 * u * di} ${y} Z`} fill={R.metal} />
            ))}
          </g>
        );
        break;
      }
      default:
        break;
    }
    if (g) svgParts.push(<g key={key} data-qc-style-moment={m.id}>{g}</g>);
  }
  if (!out.length && !svgParts.length) return null;
  const svg = svgParts;
  const divs = out;
  return (
    <>
      {svg.length ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }} data-qc="style-moment" data-qc-layer={layer}>
          {svg}
        </svg>
      ) : null}
      {divs}
    </>
  );
}
