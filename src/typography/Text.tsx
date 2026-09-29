/**
 * <Text> — the only way scenes put words on screen.
 * Fits text into its box (balanced Arabic line breaks → width → size),
 * isolates Latin runs for correct bidi, animates by word/line (never by
 * glyph, which would break Arabic joining), applies the style's highlight
 * treatment, and tags itself for automated QC.
 */
import React, { useMemo, type CSSProperties } from 'react';
import { useVideo, useContextScene } from './text-context';
import { fitText } from './fit';
import { canvasMeasure } from './measure-browser';
import { baseDirection, hasArabic, prepareText, safeLetterSpacing, type Token } from './arabic';
import { entranceStyle, progress, clamp, type MotionCtx } from '../motion/primitives';
import { useMotion } from '../engine/context';
import type { EntranceFamily, StyleTokens } from '../styles/tokens';
import { alpha } from '../brand/color';

export type TextRole = 'headline' | 'title' | 'subtitle' | 'body' | 'caption' | 'eyebrow' | 'number' | 'cta' | 'label';

const ROLE: Record<TextRole, { size: number; min: number; font: 'display' | 'body'; weight: 'display' | 'body' | number; lines: number; lh?: number }> = {
  headline: { size: 9.5, min: 5.4, font: 'display', weight: 'display', lines: 3, lh: 1.22 },
  title: { size: 7, min: 4.4, font: 'display', weight: 'display', lines: 3, lh: 1.25 },
  subtitle: { size: 4.3, min: 3.1, font: 'body', weight: 500, lines: 3 },
  body: { size: 3.5, min: 2.7, font: 'body', weight: 'body', lines: 5 },
  caption: { size: 2.9, min: 2.4, font: 'body', weight: 'body', lines: 3 },
  eyebrow: { size: 2.7, min: 2.3, font: 'body', weight: 600, lines: 1 },
  number: { size: 22, min: 9, font: 'display', weight: 'display', lines: 1, lh: 1.1 },
  cta: { size: 5.6, min: 3.8, font: 'display', weight: 'display', lines: 2, lh: 1.25 },
  label: { size: 3.1, min: 2.4, font: 'body', weight: 600, lines: 2 },
};

export interface TextProps {
  text: string;
  highlight?: string[];
  role?: TextRole;
  size?: number;
  minSize?: number;
  maxWidth?: number;
  maxLines?: number;
  maxHeight?: number;
  weight?: number;
  font?: 'display' | 'body' | 'mono' | 'latin';
  align?: 'start' | 'center' | 'end';
  color?: string;
  hlStyle?: StyleTokens['typography']['highlight'];
  hlColor?: string;
  animate?: 'words' | 'lines' | 'block' | 'none';
  entrance?: EntranceFamily;
  delay?: number;
  stagger?: number;
  duration?: number;
  critical?: boolean;
  qcId?: string;
  style?: CSSProperties;
  lineHeight?: number;
  shadow?: boolean;
}

function groupRuns(line: Token[]): Token[][] {
  const out: Token[][] = [];
  for (const t of line) {
    const prev = out[out.length - 1];
    const latin = t.script === 'latin' || t.script === 'neutral';
    if (prev && latin && (prev[0].script === 'latin' || prev[0].script === 'neutral') && !t.highlight && !prev[0].highlight) prev.push(t);
    else out.push([t]);
  }
  return out;
}

export function Text(props: TextProps) {
  const v = useVideo();
  const scene = useContextScene();
  const m = useMotion();
  const role = props.role ?? 'body';
  const r = ROLE[role];
  const t = v.tokens;
  const layout = scene?.scene.layout;
  // Tall canvases have more room per short-edge unit: type reads bigger there.
  const orient = v.canvas.isTall ? 1.22 : v.canvas.orientation === 'portrait' ? 1.1 : v.canvas.orientation === 'square' ? 1.04 : 1;
  const scale = t.typography.scale * (layout?.textScale ?? 1) * orient;
  const u = v.canvas.u;
  const text = useMemo(() => prepareText(props.text ?? '', { numerals: v.spec.project.numerals }), [props.text, v.spec.project.numerals]);
  const dir = baseDirection(text, v.dir);
  const fontKey = props.font ?? r.font;
  const family = fontKey === 'mono' ? v.fonts.mono : fontKey === 'latin' ? v.fonts.latin : fontKey === 'display' ? v.fonts.display : v.fonts.body;
  const weight = props.weight ?? (r.weight === 'display' ? v.fonts.displayWeight : r.weight === 'body' ? v.fonts.bodyWeight : r.weight);
  const hlStyle = props.hlStyle ?? t.typography.highlight;
  const maxWidth = props.maxWidth ?? v.canvas.safe.width * (layout?.maxWidth ?? 0.92);
  const lineHeight = props.lineHeight ?? r.lh ?? t.typography.lineHeight;
  const maxLines = props.maxLines ?? layout?.maxLines ?? r.lines;
  const minPx = Math.max((props.minSize ?? r.min) * u * Math.min(1, scale), 2 * u);
  const maxPx = Math.max(minPx, (props.size ?? r.size) * u * scale);
  const hlPad = hlStyle === 'box' ? 0.4 : hlStyle === 'marker' ? 0.12 : 0;

  const fit = useMemo(
    () =>
      fitText({
        text,
        highlight: props.highlight,
        maxWidth,
        maxHeight: props.maxHeight,
        maxLines,
        maxSize: maxPx,
        minSize: minPx,
        lineHeight,
        weight,
        family,
        latinFamily: v.fonts.latin,
        highlightPad: hlPad,
        measure: canvasMeasure,
      }),
    [text, props.highlight?.join('|'), maxWidth, props.maxHeight, maxLines, maxPx, minPx, lineHeight, weight, family, v.fonts.latin, hlPad],
  );

  const color = props.color ?? layout?.textColor ?? (role === 'caption' || role === 'body' || role === 'eyebrow' ? t.palette.textSecondary : t.palette.textPrimary);
  const hl = props.hlColor ?? v.hl;
  const animate = props.animate ?? (role === 'headline' || role === 'title' || role === 'cta' ? 'words' : 'lines');
  const entrance = props.entrance ?? t.motion.entrance;
  const delay = props.delay ?? 0;
  const gap = props.stagger ?? t.motion.stagger;
  const dur = props.duration ?? 0.7;
  const align = props.align ?? 'center';
  const textAlign: CSSProperties['textAlign'] = align === 'center' ? 'center' : align === 'start' ? (dir === 'rtl' ? 'right' : 'left') : dir === 'rtl' ? 'left' : 'right';
  const letterSpacing = role === 'eyebrow' ? safeLetterSpacing(text, 0.14) : 0;
  const upper = role === 'eyebrow' && t.typography.eyebrowCase === 'upper' && !hasArabic(text);
  const blockP = animate === 'block' ? progress(m, delay, dur) : 1;

  let wordIndex = 0;
  const shadow = props.shadow ? `0 ${0.4 * u}px ${2 * u}px ${alpha('#000000', t.mode === 'dark' ? 0.45 : 0.12)}` : undefined;

  return (
    <div
      dir={dir}
      data-qc="text"
      data-qc-role={role}
      data-qc-id={props.qcId}
      data-qc-fit={fit.fits ? 'ok' : 'fail'}
      data-qc-reason={fit.reason}
      data-qc-font-size={fit.fontSize.toFixed(1)}
      data-qc-min-size={minPx.toFixed(1)}
      data-qc-lines={fit.lines.length}
      data-qc-critical={props.critical || role === 'headline' || role === 'cta' ? '1' : '0'}
      data-qc-color={color}
      data-qc-arabic={hasArabic(text) ? '1' : '0'}
      data-qc-text={text.slice(0, 160)}
      style={{
        fontFamily: family,
        fontWeight: weight,
        fontSize: fit.fontSize,
        lineHeight,
        color,
        textAlign,
        maxWidth,
        letterSpacing: `${letterSpacing}em`,
        textTransform: upper ? 'uppercase' : undefined,
        textShadow: shadow,
        fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
        ...(layout?.scrim && role !== 'number' && role !== 'eyebrow' ? { background: alpha(t.palette.background, 0.74), padding: '0.12em 0.42em', borderRadius: '0.28em', boxShadow: `0 0 ${2 * u}px ${alpha(t.palette.background, 0.5)}` } : {}),
        ...(animate === 'block' ? entranceStyle(entrance, blockP, m.intensity, u, dir) : {}),
        ...props.style,
      }}
    >
      {fit.lines.map((line, li) => {
        const lineP = animate === 'lines' ? progress(m, delay + li * gap * 1.6, dur) : 1;
        return (
          <div key={li} style={{ whiteSpace: 'nowrap', ...(animate === 'lines' ? entranceStyle(entrance, lineP, m.intensity, u, dir) : {}) }}>
            {groupRuns(line).map((run, ri) => {
              const wi = wordIndex++;
              const p = animate === 'words' ? progress(m, delay + wi * gap, dur) : 1;
              const isLatin = run[0].script === 'latin' || run[0].script === 'neutral';
              const content = run.map((x) => x.text).join(' ');
              const token = run[0];
              return (
                <React.Fragment key={ri}>
                  {ri > 0 ? ' ' : null}
                  <Word
                    text={content}
                    latin={isLatin && dir === 'rtl'}
                    latinFamily={v.fonts.latin}
                    highlight={token.highlight}
                    hlStyle={hlStyle}
                    hl={hl}
                    tokens={t}
                    p={p}
                    m={m}
                    hlDelay={delay + wi * gap + dur * 0.5}
                    style={animate === 'words' ? entranceStyle(entrance, p, m.intensity, u, dir) : undefined}
                  />
                </React.Fragment>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Word(props: {
  text: string;
  latin: boolean;
  latinFamily: string;
  highlight: boolean;
  hlStyle: StyleTokens['typography']['highlight'];
  hl: string;
  tokens: StyleTokens;
  p: number;
  m: MotionCtx;
  hlDelay: number;
  style?: CSSProperties;
}) {
  const { highlight, hlStyle, hl, tokens: t } = props;
  const base: CSSProperties = {
    display: 'inline-block',
    position: 'relative',
    ...(props.latin ? { unicodeBidi: 'isolate', direction: 'ltr', fontFamily: props.latinFamily } : {}),
    ...props.style,
  };
  if (!highlight) return <span style={base} dir={props.latin ? 'ltr' : undefined}>{props.text}</span>;
  const hp = clamp(progress(props.m, props.hlDelay, 0.55, 'smooth'));
  const arabic = hasArabic(props.text);
  switch (hlStyle) {
    case 'box':
      return (
        <span dir={props.latin ? 'ltr' : undefined} style={{ ...base, color: t.palette.textOnPrimary, padding: '0 0.2em', isolation: 'isolate' }}>
          <span style={{ position: 'absolute', inset: '0.04em 0 -0.02em 0', background: hl, borderRadius: '0.12em', transform: `scaleX(${hp})`, transformOrigin: arabic ? 'right' : 'left', zIndex: -1 }} />
          {props.text}
        </span>
      );
    case 'marker':
      return (
        <span dir={props.latin ? 'ltr' : undefined} style={{ ...base, padding: '0 0.06em', isolation: 'isolate' }}>
          <span style={{ position: 'absolute', left: 0, right: 0, top: '48%', bottom: '4%', background: alpha(t.palette.accent, 0.42), borderRadius: '0.08em', transform: `scaleX(${hp}) skewX(-8deg)`, transformOrigin: arabic ? 'right' : 'left', zIndex: -1 }} />
          {props.text}
        </span>
      );
    case 'underline':
      return (
        <span dir={props.latin ? 'ltr' : undefined} style={{ ...base, color: hl }}>
          {props.text}
          <span style={{ position: 'absolute', left: 0, right: 0, bottom: '-0.02em', height: '0.08em', background: t.palette.accent, borderRadius: 99, transform: `scaleX(${hp})`, transformOrigin: arabic ? 'right' : 'left' }} />
        </span>
      );
    case 'glow':
      return (
        <span dir={props.latin ? 'ltr' : undefined} style={{ ...base, color: hl, textShadow: `0 0 ${0.3 * hp}em ${alpha(hl, 0.55)}, 0 0 ${0.9 * hp}em ${alpha(hl, 0.3)}` }}>
          {props.text}
        </span>
      );
    case 'outline':
      if (!arabic)
        return (
          <span dir="ltr" style={{ ...base, color: 'transparent', WebkitTextStroke: `0.035em ${hl}` }}>
            {props.text}
          </span>
        );
      return <span style={{ ...base, color: hl }}>{props.text}</span>;
    case 'color':
    default:
      return (
        <span dir={props.latin ? 'ltr' : undefined} style={{ ...base, color: hl }}>
          {props.text}
        </span>
      );
  }
}
