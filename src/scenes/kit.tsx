/** Shared building blocks for scene families (keeps every family on the same quality bar). */
import React, { type CSSProperties } from 'react';
import { z } from 'zod';
import { useMotion, useScene, useVideo } from '../engine/context';
import { Text, type TextProps } from '../typography/Text';
import { entranceStyle, progress, float, clamp } from '../motion/primitives';
import type { EntranceFamily } from '../styles/tokens';
import { alpha } from '../brand/color';
import { Icon } from '../components/Icon';
import { toNumerals } from '../typography/arabic';

export const HeadingFields = {
  eyebrow: z.string().max(60).optional(),
  title: z.string().min(1).max(160),
  highlight: z.array(z.string()).optional(),
  subtitle: z.string().max(220).optional(),
};

/** Entrance wrapper for arbitrary elements. */
export function Reveal({
  delay = 0,
  dur = 0.7,
  family,
  children,
  style,
}: {
  delay?: number;
  dur?: number;
  family?: EntranceFamily;
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  const m = useMotion();
  const { tokens, canvas, dir } = useVideo();
  const p = progress(m, delay, dur);
  return <div style={{ ...entranceStyle(family ?? tokens.motion.entrance, p, m.intensity, canvas.u, dir), ...style }}>{children}</div>;
}

export function useSceneTime() {
  const m = useMotion();
  const sc = useScene();
  const holdSec = sc.holdFrames / m.fps;
  return { m, s: m.frame / m.fps, holdSec, durSec: sc.entry.durationInFrames / m.fps, p: (d: number, dur = 0.7) => progress(m, d, dur) };
}

export function Eyebrow({ text, delay = 0, align = 'center' }: { text: string; delay?: number; align?: 'start' | 'center' | 'end' }) {
  const { tokens: t, canvas } = useVideo();
  const u = canvas.u;
  return (
    <Reveal delay={delay} family="fade">
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: u * 1.2,
          padding: `${u * 0.7}px ${u * 2}px`,
          borderRadius: 999,
          background: alpha(t.palette.primary, t.mode === 'dark' ? 0.14 : 0.1),
          border: `1px solid ${alpha(t.palette.primary, 0.35)}`,
          alignSelf: align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end',
        }}
      >
        <div style={{ width: u * 1, height: u * 1, borderRadius: 99, background: t.palette.primary, boxShadow: `0 0 ${u}px ${alpha(t.palette.primary, 0.7)}` }} />
        <Text text={text} role="eyebrow" color={t.palette.textPrimary} animate="none" maxWidth={canvas.safe.width * 0.8} />
      </div>
    </Reveal>
  );
}

export interface HeadlineBlockProps {
  eyebrow?: string;
  title: string;
  highlight?: string[];
  subtitle?: string;
  align?: 'start' | 'center' | 'end';
  delay?: number;
  role?: TextProps['role'];
  maxWidth?: number;
  size?: number;
  titleColor?: string;
  subColor?: string;
  gap?: number;
  maxLines?: number;
  animate?: TextProps['animate'];
  entrance?: EntranceFamily;
}

export function HeadlineBlock(p: HeadlineBlockProps) {
  const { canvas } = useVideo();
  const u = canvas.u;
  const d = p.delay ?? 0;
  const alignItems = p.align === 'start' ? 'flex-start' : p.align === 'end' ? 'flex-end' : 'center';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems, gap: (p.gap ?? 2.2) * u, maxWidth: p.maxWidth }}>
      {p.eyebrow ? <Eyebrow text={p.eyebrow} delay={d} align={p.align} /> : null}
      <Text
        text={p.title}
        highlight={p.highlight}
        role={p.role ?? 'headline'}
        align={p.align ?? 'center'}
        delay={d + (p.eyebrow ? 0.15 : 0)}
        maxWidth={p.maxWidth}
        size={p.size}
        color={p.titleColor}
        maxLines={p.maxLines}
        animate={p.animate}
        entrance={p.entrance}
      />
      {p.subtitle ? <Text text={p.subtitle} role="subtitle" align={p.align ?? 'center'} delay={d + 0.45} maxWidth={p.maxWidth} color={p.subColor} /> : null}
    </div>
  );
}

export function Pill({ children, tone = 'primary', style }: { children: React.ReactNode; tone?: 'primary' | 'surface' | 'accent'; style?: CSSProperties }) {
  const { tokens: t, canvas } = useVideo();
  const u = canvas.u;
  const bg = tone === 'primary' ? t.palette.primary : tone === 'accent' ? t.palette.accent : t.palette.surfaceAlt;
  const fg = tone === 'surface' ? t.palette.textOnSurface : t.palette.textOnPrimary;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: u, padding: `${u * 0.9}px ${u * 2.4}px`, borderRadius: 999, background: bg, color: fg, ...style }}>{children}</div>
  );
}

export function Button({ label, delay = 0, width, pressed = 0, icon }: { label: string; delay?: number; width?: number; pressed?: number; icon?: string }) {
  const { tokens: t, canvas } = useVideo();
  const u = canvas.u;
  return (
    <Reveal delay={delay} family="pop">
      <div
        data-qc-cta="1"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: u * 1.6,
          minWidth: width,
          padding: `${u * 2.1}px ${u * 5}px`,
          borderRadius: t.surface.kind === 'comic' ? u * 1.4 : 999,
          background: t.palette.primary,
          boxShadow: `0 ${u * 1.2}px ${u * 4}px ${alpha(t.palette.primary, 0.35)}${t.surface.kind === 'comic' ? `, ${u * 0.8}px ${u * 0.8}px 0 ${t.palette.border}` : ''}`,
          border: t.surface.kind === 'comic' ? `${t.surface.borderWidth}px solid ${t.palette.border}` : undefined,
          transform: `scale(${1 - pressed * 0.06})`,
        }}
      >
        <Text text={label} role="cta" size={4.6} minSize={3.4} color={t.palette.textOnPrimary} animate="none" critical maxWidth={canvas.safe.width * 0.8} maxLines={1} />
        {icon ? <Icon name={icon} size={u * 4.2} color={t.palette.textOnPrimary} treatment="plain" /> : null}
      </div>
    </Reveal>
  );
}

export function Stars({ value, size, delay = 0 }: { value: number; size: number; delay?: number }) {
  const m = useMotion();
  const { tokens: t } = useVideo();
  return (
    <div style={{ display: 'flex', gap: size * 0.2, direction: 'ltr' }}>
      {Array.from({ length: 5 }, (_, i) => {
        const p = progress(m, delay + i * 0.08, 0.4, 'elastic');
        const fill = clamp(value - i);
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" style={{ transform: `scale(${p})` }}>
            <defs>
              <linearGradient id={`st${i}`}>
                <stop offset={`${fill * 100}%`} stopColor={t.palette.accent} />
                <stop offset={`${fill * 100}%`} stopColor={alpha(t.palette.textPrimary, 0.2)} />
              </linearGradient>
            </defs>
            <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" fill={`url(#st${i})`} />
          </svg>
        );
      })}
    </div>
  );
}

/** Initials avatar — never a fake photo of a person. */
export function Avatar({ name, size, tone = 0 }: { name: string; size: number; tone?: number }) {
  const { tokens: t, fonts } = useVideo();
  const colors = [t.palette.primary, t.palette.secondary, t.palette.accent];
  const bg = colors[Math.abs(tone) % colors.length];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (
    <div style={{ width: size, height: size, borderRadius: size, background: bg, color: t.palette.textOnPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontWeight: 700, fontSize: size * 0.4, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

export function Skeleton({ width, height, tone = 0.12, radius }: { width: number | string; height: number; tone?: number; radius?: number }) {
  const { tokens: t } = useVideo();
  return <div style={{ width, height, borderRadius: radius ?? height / 2, background: alpha(t.palette.textPrimary, tone) }} />;
}

export function formatNumber(v: number, opts: { decimals?: number; prefix?: string; suffix?: string; numerals?: 'latin' | 'arabic-indic'; grouping?: boolean } = {}): string {
  const d = opts.decimals ?? (Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: opts.grouping ?? true });
  return `${opts.prefix ?? ''}${toNumerals(s, opts.numerals ?? 'latin')}${opts.suffix ?? ''}`;
}

/**
 * Scattered decorations (rings, plus marks, lines, bursts). Banned by default
 * (design/banned-patterns.json: random-decorations) — rendered only when the
 * project sets design.decorations (user asked for it / a reference needs it).
 */
export function Accents({ seed = 0 }: { seed?: number }) {
  const { tokens: t, canvas, spec } = useVideo();
  const m = useMotion();
  const u = canvas.u;
  const W = canvas.width;
  const H = canvas.height;
  const a = t.accents;
  if (!spec.design?.decorations) return null;
  if (a.shape === 'none' || a.amount <= 0) return null;
  if (a.shape === 'dots' && !spec.design.allowPatterns.includes('dots')) return null;
  const n = Math.round(2 + a.amount * 4);
  const items = Array.from({ length: n }, (_, i) => {
    const k = (seed * 7 + i * 13) % 17;
    return { x: ((k * 53) % 100) / 100, y: ((k * 31 + i * 17) % 100) / 100, s: 1 + (k % 4) * 0.6, i };
  });
  const col = alpha(t.palette.primary, 0.22 + a.amount * 0.2);
  return (
    <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {items.map(({ x, y, s, i }) => {
        const px = x * W;
        const py = y * H + float(m.frame, m.fps, (m.floatK ?? 1) * u * 1.2, 5 + i, i);
        const pr = progress(m, 0.1 + i * 0.07, 0.8);
        const sz = u * 2.2 * s * pr;
        switch (a.shape) {
          case 'ring':
            return <circle key={i} cx={px} cy={py} r={sz * 1.6} fill="none" stroke={col} strokeWidth={u * 0.25} />;
          case 'plus':
            return (
              <g key={i} stroke={col} strokeWidth={u * 0.35} strokeLinecap="round">
                <line x1={px - sz} y1={py} x2={px + sz} y2={py} />
                <line x1={px} y1={py - sz} x2={px} y2={py + sz} />
              </g>
            );
          case 'dots':
            return <circle key={i} cx={px} cy={py} r={sz * 0.35} fill={col} />;
          case 'line':
            return <line key={i} x1={px - sz * 3} y1={py} x2={px + sz * 3} y2={py} stroke={col} strokeWidth={u * 0.2} />;
          case 'burst':
            return (
              <g key={i} stroke={col} strokeWidth={u * 0.35} strokeLinecap="round">
                {[0, 45, 90, 135].map((deg) => {
                  const r = (deg * Math.PI) / 180;
                  return <line key={deg} x1={px - Math.cos(r) * sz} y1={py - Math.sin(r) * sz} x2={px + Math.cos(r) * sz} y2={py + Math.sin(r) * sz} />;
                })}
              </g>
            );
          case 'blob':
            return <ellipse key={i} cx={px} cy={py} rx={sz * 2.2} ry={sz * 1.6} fill={alpha(t.palette.accent, 0.12)} />;
          default:
            return null;
        }
      })}
    </svg>
  );
}

export const LABEL_SCHEMA = z.string().min(1).max(80);

/**
 * Responsive "heading + visual" composition used by many families.
 * Landscape: heading and visual side by side (heading on the reading-start side).
 * Portrait/square: heading on top, visual fills the rest. `visual` gets its box size.
 */
export function HeroSplit({
  heading,
  visual,
  headingShare,
  visualFirst = false,
  align,
}: {
  heading?: HeadlineBlockProps;
  visual: (w: number, h: number) => React.ReactNode;
  headingShare?: number;
  visualFirst?: boolean;
  align?: 'start' | 'center';
}) {
  const { canvas, dir } = useVideo();
  const sc = useScene();
  const L = sc.scene.layout;
  const u = canvas.u;
  const s = canvas.safe;
  const gap = u * 4;
  const landscape = canvas.orientation === 'landscape';
  const share = heading ? headingShare ?? (landscape ? 0.42 : canvas.isTall ? 0.3 : 0.34) : 0;
  let hRect = { x: s.x, y: s.y, width: s.width, height: 0 };
  let vRect = { x: s.x, y: s.y, width: s.width, height: s.height };
  if (heading) {
    if (landscape) {
      const hw = (s.width - gap) * share;
      const vw = s.width - gap - hw;
      const rtl = dir === 'rtl';
      const headingOnRight = rtl !== visualFirst;
      hRect = { x: headingOnRight ? s.x + s.width - hw : s.x, y: s.y, width: hw, height: s.height };
      vRect = { x: headingOnRight ? s.x : s.x + hw + gap, y: s.y, width: vw, height: s.height };
    } else {
      const hh = (s.height - gap) * share;
      const vh = s.height - gap - hh;
      hRect = { x: s.x, y: visualFirst ? s.y + vh + gap : s.y, width: s.width, height: hh };
      vRect = { x: s.x, y: visualFirst ? s.y : s.y + hh + gap, width: s.width, height: vh };
    }
  }
  const hAlign = align ?? (landscape ? 'start' : 'center');
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {heading ? (
        <div style={{ position: 'absolute', left: hRect.x, top: hRect.y, width: hRect.width, height: hRect.height, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: hAlign === 'start' ? 'flex-start' : 'center' }}>
          <HeadlineBlock {...heading} align={hAlign} maxWidth={hRect.width} role={heading.role ?? 'title'} maxLines={heading.maxLines ?? (landscape ? 4 : 3)} />
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: vRect.x, top: vRect.y, width: vRect.width, height: vRect.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {visual(vRect.width, vRect.height)}
      </div>
    </div>
  );
}
