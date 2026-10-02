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
import { TextMotionRegistry, effectiveUnit, roleGroupOf, type TextMotionFamily, type UnitCtx } from '../text-motion/families';
import { countText } from '../text-motion/count';

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
  /** Text Motion Engine family id (overrides the scene's text-motion plan). */
  motion?: string;
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
  // the fitter must reserve room for the highlight style that is actually drawn: a text-motion family
  // may draw its own (e.g. a box) instead of the style token's
  const animateEarly = props.animate ?? (role === 'headline' || role === 'title' || role === 'cta' ? 'words' : 'lines');
  const famEarly = TextMotionRegistry.get(props.motion ?? (props.entrance === undefined && animateEarly !== 'none' ? scene?.scene.motion?.text?.[roleGroupOf(role)] : undefined));
  const drawnHl = famEarly?.highlight && famEarly.highlight !== 'pulse' ? famEarly.highlight : hlStyle;
  const hlPad = drawnHl === 'box' ? 0.4 : drawnHl === 'marker' ? 0.12 : 0;

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
        // Latin runs switch to the Latin font only inside RTL lines (see Word `latin`); an LTR text renders
        // every word in its own family, so measuring Latin tokens with the Latin font would mis-size the lines
        latinFamily: dir === 'rtl' ? v.fonts.latin : undefined,
        highlightPad: hlPad,
        measure: canvasMeasure,
      }),
    [text, props.highlight?.join('|'), maxWidth, props.maxHeight, maxLines, maxPx, minPx, lineHeight, weight, family, v.fonts.latin, hlPad, dir],
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
  // Text Motion Engine: an explicit `motion`, or the scene's plan for this role when the scene left the entrance open
  const planned = props.entrance === undefined && animate !== 'none' ? scene?.scene.motion?.text?.[roleGroupOf(role)] : undefined;
  const fam: TextMotionFamily | undefined = TextMotionRegistry.get(props.motion ?? planned);
  const arabicText = hasArabic(text);
  const unit = fam ? (animate === 'block' && !props.motion ? 'block' : effectiveUnit(fam, arabicText)) : undefined;
  const famDur = fam ? (props.duration ?? fam.duration) : dur;
  const famGap = fam ? gap * fam.stagger : gap;
  const famP = (d: number) => {
    if (!fam) return 1;
    if (fam.curve === 'step') return clamp((m.frame / m.fps - d) / Math.max(0.05, famDur));
    return progress(m, d, famDur, fam.curve === 'spring' ? 'snappy' : 'smooth');
  };
  const famCtx = (i: number, n: number, ar: boolean): UnitCtx => ({ i, n, dir, u, intensity: m.intensity, arabic: ar });
  const famHl = fam?.highlight && fam.highlight !== 'pulse' ? fam.highlight : undefined;
  const numericCount = fam?.id === 'number-count' || (fam && role === 'number');
  let unitTotal = 0;
  if (fam && unit === 'word') unitTotal = fit.lines.reduce((a, l) => a + groupRuns(l).length, 0);

  let wordIndex = 0;
  function renderFamilyLines() {
    let wi = 0;
    let gluePrev = false;
    return fit.lines.map((line, li) => {
      const lineStart = delay + li * famGap * 1.6;
      const lp = unit === 'line' ? famP(lineStart) : 1;
      const lineStyle = unit === 'line' ? fam!.unit_(lp, famCtx(li, fit.lines.length, hasArabic(line.map((x) => x.text).join(' ')))) : undefined;
      const runs = groupRuns(line).map((run, ri) => {
        // Arabic word groups: a particle glued to the next word animates with it
        const idx = gluePrev ? Math.max(0, wi - 1) : wi++;
        gluePrev = run[run.length - 1].glueNext;
        const d = unit === 'word' || unit === 'char' ? delay + idx * famGap : unit === 'line' ? lineStart : delay;
        const isLatin = run[0].script === 'latin' || run[0].script === 'neutral';
        const content = run.map((x) => x.text).join(' ');
        const runArabic = hasArabic(content);
        const p = unit === 'word' || unit === 'char' ? famP(d) : unit === 'line' ? lp : famP(delay);
        const wordStyle = unit === 'word' || (unit === 'char' && runArabic) ? fam!.unit_(p, famCtx(idx, unitTotal, runArabic)) : undefined;
        const chars = unit === 'char' && !runArabic ? [...content] : null;
        const settledFor = m.frame / m.fps - (d + famDur);
        const pulse = fam!.highlight === 'pulse' && run[0].highlight && settledFor > 0 ? Math.sin(clamp(settledFor / 0.45) * Math.PI) * 0.09 : 0;
        const word = (
          <Word
            text={content}
            latin={isLatin && dir === 'rtl'}
            latinFamily={v.fonts.latin}
            highlight={run[0].highlight}
            hlStyle={famHl ?? hlStyle}
            hl={hl}
            tokens={t}
            p={p}
            m={m}
            hlDelay={d + famDur * 0.6}
            count={numericCount ? clamp(p) : undefined}
            numerals={v.spec.project.numerals}
            chars={chars ? chars.map((ch, ci) => ({ ch, style: fam!.unit_(famP(d + ci * famGap * 0.35), famCtx(ci, chars.length, false)) })) : undefined}
            style={{ ...(wordStyle ?? {}), ...(pulse ? { transform: `${wordStyle?.transform ?? ''} scale(${1 + pulse})` } : {}) }}
          />
        );
        return (
          <React.Fragment key={ri}>
            {ri > 0 ? ' ' : null}
            {fam!.mask && (unit === 'word' || unit === 'char') ? <MaskBox>{word}</MaskBox> : word}
          </React.Fragment>
        );
      });
      if (unit === 'line' && fam!.mask)
        return (
          <div key={li} style={{ whiteSpace: 'nowrap' }}>
            {/* the mask hugs the line (inline-block): it hides the reveal, never the end of a line that is wider than the box */}
            <div style={{ display: 'inline-block', verticalAlign: 'top', overflow: 'hidden', padding: '0.2em 0.06em', margin: '-0.2em -0.06em' }}>
              <div style={{ whiteSpace: 'nowrap', ...lineStyle }}>{runs}</div>
            </div>
          </div>
        );
      return (
        <div key={li} style={{ whiteSpace: 'nowrap', ...(lineStyle ?? {}) }}>
          {runs}
        </div>
      );
    });
  }
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
        ...(!fam && animate === 'block' ? entranceStyle(entrance, blockP, m.intensity, u, dir) : {}),
        ...(fam && unit === 'block' ? fam.unit_(famP(delay), famCtx(0, 1, arabicText)) : {}),
        ...props.style,
      }}
      data-qc-motion={fam?.id}
    >
      {fam ? renderFamilyLines() : fit.lines.map((line, li) => {
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
  /** Number-count progress (0..1): numeric tokens count up to their value. */
  count?: number;
  numerals?: 'latin' | 'arabic-indic';
  /** Latin-only per-character units (never for Arabic: it would break the joins). */
  chars?: { ch: string; style: CSSProperties }[];
}) {
  const { highlight, hlStyle, hl, tokens: t } = props;
  const counted = props.count !== undefined ? countText(props.text, props.count, props.numerals ?? 'latin') : null;
  if (counted !== null) {
    // the final value reserves the width; the counting value sits on top (no layout jitter)
    return (
      <span style={{ display: 'inline-block', position: 'relative', fontVariantNumeric: 'tabular-nums', ...props.style, ...(highlight ? { color: hl } : {}) }}>
        <span style={{ visibility: 'hidden' }}>{props.text}</span>
        <span style={{ position: 'absolute', inset: 0, textAlign: 'center', whiteSpace: 'nowrap' }}>{counted}</span>
      </span>
    );
  }
  if (props.chars && !hasArabic(props.text)) {
    return (
      <span dir="ltr" style={{ display: 'inline-block', unicodeBidi: 'isolate', ...(props.latin ? { fontFamily: props.latinFamily } : {}), ...(highlight ? { color: hl } : {}) }}>
        {props.chars.map((c, i) => (
          <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', ...c.style }}>
            {c.ch}
          </span>
        ))}
      </span>
    );
  }
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

/** Clip box for mask-style reveals (room for Arabic ascenders, dots and diacritics). */
function MaskBox({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', padding: '0.22em 0.05em', margin: '-0.22em -0.05em' }}>{children}</span>;
}
