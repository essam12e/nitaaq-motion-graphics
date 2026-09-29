/** Typography families: highlight-text, split-typography, perspective-text, numeric-typography, quote-typography, type-on. */
import React from 'react';
import { z } from 'zod';
import { interpolate } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { Accents, HeadingFields, useSceneTime, formatNumber, Reveal, Eyebrow } from '../kit';
import { Stage, useLayout, splitRects, Box } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { clamp, progress, countUp, EASE, overshoot } from '../../motion/primitives';
import { alpha, bestTextOn, mix } from '../../brand/color';
import { hasArabic, prepareText } from '../../typography/arabic';
import { canvasMeasure } from '../../typography/measure-browser';

// ───────────────────────── highlight-text
const HighlightC = z.object({ ...HeadingFields, highlight: z.array(z.string()).min(1) });
type HC = z.infer<typeof HighlightC>;
export const highlightText = defineScene<HC>(
  {
    id: 'highlight-text',
    version: '1.0.0',
    category: 'typography',
    title: 'Highlight text',
    description: 'Sentence where key words get marked; variants marker / underline / box / color.',
    variants: ['marker', 'underline', 'box', 'color'],
    defaultVariant: 'marker',
    content: HighlightC,
    defaultDuration: 3.2,
    minDuration: 1.8,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'push', 'wipe'],
    sfx: [{ at: 0.6, category: 'sweep', weight: 0.35 }],
    safeArea: 'normal',
    beats: ['problem', 'solution', 'proof', 'bridge'],
    energy: 0.5,
    textCapacity: { marker: 80, underline: 80, box: 70, color: 90 },
    example: { title: 'المتجر الجميل يبيع أكثر من المتجر العادي', highlight: ['يبيع', 'أكثر'], subtitle: 'التصميم جزء من تجربة الشراء' },
    editable: ['eyebrow', 'title', 'subtitle'],
    validate: (c) =>
      c.highlight
        .filter((h) => !c.title.includes(h))
        .map((h) => ({ path: 'content.highlight', message: `highlight "${h}" does not appear in title`, severity: 'warning' as const })),
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    return (
      <>
        <Accents seed={7} />
        <Stage>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          <Text text={c.title} highlight={c.highlight} role="headline" size={8.8} hlStyle={variant as 'marker'} animate="lines" entrance="rise" maxWidth={L.safe.width * (L.isWide ? 0.7 : 0.94)} />
          {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.9} /> : null}
        </Stage>
      </>
    );
  },
);

// ───────────────────────── split-typography
const SplitC = z.object({ first: z.string().min(1).max(60), second: z.string().min(1).max(60), label: z.string().max(40).optional() });
type SC = z.infer<typeof SplitC>;
export const splitTypography = defineScene<SC>(
  {
    id: 'split-typography',
    version: '1.0.0',
    category: 'typography',
    title: 'Split typography',
    description: 'Two contrasting statements on two colour fields; variants halves / diagonal / stacked.',
    variants: ['halves', 'diagonal', 'stacked'],
    defaultVariant: 'halves',
    content: SplitC,
    defaultDuration: 3,
    minDuration: 1.8,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe', 'cut'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.5 },
      { at: 0.5, category: 'impact', weight: 0.3 },
    ],
    safeArea: 'fullbleed',
    beats: ['problem', 'comparison', 'solution', 'bridge'],
    energy: 0.7,
    textCapacity: { halves: 50, diagonal: 40, stacked: 60 },
    example: { first: 'قبل: متجر عادي', second: 'بعد: متجر يبيع', label: 'الفرق' },
    editable: ['first', 'second', 'label'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t } = useVideo();
    const { m } = useSceneTime();
    const u = L.u;
    const p1 = progress(m, 0, 0.7);
    const p2 = progress(m, 0.35, 0.7);
    const bg2 = t.palette.primary;
    const fg2 = t.palette.textOnPrimary;
    const orient = variant === 'stacked' ? 'portrait' : L.orientation === 'landscape' ? 'landscape' : 'portrait';
    const [a, b] = splitRects({ x: 0, y: 0, width: L.W, height: L.H }, orient, 0.5, 0, true);
    const inner = (r: typeof a) => ({ x: r.x + Math.max(L.safe.x - r.x, u * 5), y: Math.max(r.y + u * 4, L.safe.y), width: Math.min(r.width - u * 10, L.safe.width), height: Math.min(r.height, L.safe.y + L.safe.height - Math.max(r.y + u * 4, L.safe.y)) });
    const clipB = variant === 'diagonal' ? (orient === 'landscape' ? `polygon(${(1 - p2) * 100}% 0, 100% 0, 100% 100%, ${(1 - p2) * 100 + 8}% 100%)` : `polygon(0 ${8 + (1 - p2) * 100}%, 100% ${(1 - p2) * 100}%, 100% 100%, 0 100%)`) : undefined;
    return (
      <>
        <Box r={a} style={{ background: t.palette.backgroundAlt, opacity: p1 }} />
        <Box r={b} style={{ background: bg2, clipPath: clipB, transform: variant === 'diagonal' ? undefined : orient === 'landscape' ? `translateX(${(1 - p2) * -100}%)` : `translateY(${(1 - p2) * 100}%)` }} />
        <Box r={inner(a)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text text={c.first} role="title" size={7.5} delay={0.1} maxWidth={inner(a).width} />
        </Box>
        <Box r={inner(b)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text text={c.second} role="title" size={7.5} delay={0.5} color={fg2} maxWidth={inner(b).width} />
        </Box>
        {c.label ? (
          <div style={{ position: 'absolute', left: L.W / 2, top: orient === 'landscape' ? L.H / 2 : b.y, transform: `translate(-50%, -50%) scale(${overshoot(m, 0.7)})` }}>
            <Surface tone="inverse" radius={999} style={{ padding: `${u * 1.2}px ${u * 3}px` }}>
              <Text text={c.label} role="label" color={bestTextOn(t.palette.textPrimary)} animate="none" />
            </Surface>
          </div>
        ) : null}
      </>
    );
  },
);

// ───────────────────────── perspective-text
const PerspC = z.object({ ...HeadingFields });
type PC = z.infer<typeof PerspC>;
export const perspectiveText = defineScene<PC>(
  {
    id: 'perspective-text',
    version: '1.0.0',
    category: 'typography',
    title: 'Perspective text',
    description: '3D-tilted headline with depth echoes; variants tilt / floor / tunnel.',
    variants: ['tilt', 'floor', 'tunnel'],
    defaultVariant: 'tilt',
    content: PerspC,
    defaultDuration: 3,
    minDuration: 1.8,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'blur', 'crossfade'],
    sfx: [{ at: 0, category: 'whoosh', weight: 0.5 }],
    safeArea: 'normal',
    beats: ['hook', 'bridge', 'brand'],
    energy: 0.75,
    textCapacity: { tilt: 45, floor: 40, tunnel: 24 },
    example: { title: 'المستقبل يبدأ الآن', highlight: ['الآن'] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t } = useVideo();
    const { m, s, durSec } = useSceneTime();
    const p = progress(m, 0, 1.1, 'cinematic');
    const drift = s / durSec;
    if (variant === 'tunnel') {
      const layers = [4, 3, 2, 1, 0];
      return (
        <Stage>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: 1400 }}>
            {layers.map((d) => (
              <div key={d} style={{ position: 'absolute', transform: `translateZ(${-d * 260 * p + drift * 120}px)`, opacity: d === 0 ? 1 : 0.22 / d }}>
                <Text text={c.title} highlight={d === 0 ? c.highlight : []} role="headline" size={10} animate="none" maxLines={2} color={d === 0 ? undefined : t.palette.primary} />
              </div>
            ))}
          </div>
          {c.subtitle ? <div style={{ marginTop: L.u * 30 }}><Text text={c.subtitle} role="subtitle" delay={0.8} /></div> : null}
        </Stage>
      );
    }
    const rx = variant === 'floor' ? 58 * (1 - p) + 22 : 0;
    const ry = variant === 'tilt' ? -24 * (1 - p) - 10 + drift * 6 : 0;
    return (
      <>
        <Accents seed={13} />
        <Stage>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          <div style={{ perspective: 1500 }}>
            <div style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg)`, transformStyle: 'preserve-3d', opacity: clamp(p * 2) }}>
              <Text text={c.title} highlight={c.highlight} role="headline" size={10.5} animate="none" shadow />
            </div>
          </div>
          {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.7} /> : null}
        </Stage>
      </>
    );
  },
);

// ───────────────────────── numeric-typography
const NumC = z.object({
  value: z.number(),
  from: z.number().optional(),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(12).optional(),
  label: z.string().min(1).max(80),
  decimals: z.number().int().min(0).max(3).optional(),
  source: z.string().min(1).describe('Where the number comes from — required, never invented'),
});
type NC = z.infer<typeof NumC>;
export const numericTypography = defineScene<NC>(
  {
    id: 'numeric-typography',
    version: '1.0.0',
    category: 'typography',
    title: 'Numeric typography',
    description: 'A single user-provided number as hero type; variants giant / ring / ticker.',
    variants: ['giant', 'ring', 'ticker'],
    defaultVariant: 'giant',
    content: NumC,
    defaultDuration: 3,
    minDuration: 2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'crossfade'],
    sfx: [
      { at: 0, category: 'riser', weight: 0.45 },
      { at: 1.3, category: 'success', weight: 0.4, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'data'],
    energy: 0.65,
    example: { value: 250, suffix: '+', label: 'متجر تم إطلاقه', source: 'example' },
    editable: ['label', 'prefix', 'suffix'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const v = useVideo();
    const { m } = useSceneTime();
    const u = L.u;
    const val = countUp(m, c.from ?? 0, c.value, 0.1, 1.2);
    const txt = formatNumber(val, { decimals: c.decimals ?? (Number.isInteger(c.value) ? 0 : 1), prefix: c.prefix, suffix: c.suffix, numerals: v.spec.project.numerals });
    const finalTxt = formatNumber(c.value, { decimals: c.decimals ?? (Number.isInteger(c.value) ? 0 : 1), prefix: c.prefix, suffix: c.suffix, numerals: v.spec.project.numerals });
    const numberEl = (size: number) => (
      <div style={{ position: 'relative', direction: 'ltr' }}>
        {/* Invisible final value reserves width so the counter never reflows. */}
        <div style={{ visibility: 'hidden' }}>
          <Text text={finalTxt} role="number" size={size} animate="none" color={v.hl} font="latin" />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center' }}>
          <Text text={txt} role="number" size={size} animate="none" color={v.hl} font="latin" qcId="number" />
        </div>
      </div>
    );
    if (variant === 'ring') {
      const p = progress(m, 0.05, 1.3, 'smooth');
      const R = u * 26;
      return (
        <Stage>
          <div style={{ position: 'relative', width: R * 2.3, height: R * 2.3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={R * 2.3} height={R * 2.3} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={alpha(v.tokens.palette.textPrimary, 0.1)} strokeWidth={u * 1.4} />
              <circle cx={R * 1.15} cy={R * 1.15} r={R} fill="none" stroke={v.tokens.palette.primary} strokeWidth={u * 1.4} strokeLinecap="round" strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * (1 - p)} style={{ filter: v.tokens.glow > 0.2 ? `drop-shadow(0 0 ${u * 1.5}px ${alpha(v.tokens.palette.primary, 0.6)})` : undefined }} />
            </svg>
            {numberEl(13)}
          </div>
          <Text text={c.label} role="title" size={5.5} delay={0.6} />
        </Stage>
      );
    }
    if (variant === 'ticker') {
      return (
        <Stage>
          <Surface style={{ padding: `${u * 3}px ${u * 6}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.5 }}>
            <Text text={c.label} role="label" animate="none" />
            {numberEl(15)}
          </Surface>
        </Stage>
      );
    }
    return (
      <>
        <Accents seed={17} />
        <Stage gap={u * 1}>
          {numberEl(24)}
          <Text text={c.label} role="title" size={6} delay={0.5} />
        </Stage>
      </>
    );
  },
);

// ───────────────────────── quote-typography
const QuoteC = z.object({ quote: z.string().min(1).max(220), author: z.string().max(60).optional(), role: z.string().max(60).optional(), highlight: z.array(z.string()).optional() });
type QC = z.infer<typeof QuoteC>;
export const quoteTypography = defineScene<QC>(
  {
    id: 'quote-typography',
    version: '1.0.0',
    category: 'typography',
    title: 'Quote typography',
    description: 'Editorial quote treatment; variants editorial / centered / bar. Quotes must be real (user-provided).',
    variants: ['editorial', 'centered', 'bar'],
    defaultVariant: 'centered',
    content: QuoteC,
    defaultDuration: 4,
    minDuration: 2.5,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'blur', 'wipe'],
    sfx: [{ at: 0, category: 'sweep', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['social', 'proof', 'brand'],
    energy: 0.35,
    textCapacity: { editorial: 140, centered: 120, bar: 140 },
    example: { quote: 'البساطة هي قمة التعقيد', author: 'ليوناردو دافنشي' },
    editable: ['quote', 'author', 'role'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t, fonts } = useVideo();
    const { m } = useSceneTime();
    const u = L.u;
    const qp = progress(m, 0, 0.8);
    const align = variant === 'centered' ? 'center' : 'start';
    const mark = (
      <div style={{ fontFamily: fonts.display, fontSize: u * 26, lineHeight: 0.8, color: t.palette.primary, opacity: 0.85 * qp, transform: `translateY(${(1 - qp) * u * 4}px)`, height: u * 12 }}>
        {hasArabic(c.quote) ? '”' : '“'}
      </div>
    );
    const body = (
      <>
        <Text text={c.quote} highlight={c.highlight} role="title" size={6.6} align={align} animate="lines" entrance="blur" delay={0.25} maxWidth={L.safe.width * (L.isWide ? 0.7 : 0.9)} maxLines={5} />
        {c.author ? (
          <Reveal delay={0.9}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'center' ? 'center' : 'flex-start', gap: u * 0.4 }}>
              <Text text={`— ${c.author}`} role="label" color={t.palette.textPrimary} animate="none" align={align} />
              {c.role ? <Text text={c.role} role="caption" animate="none" align={align} /> : null}
            </div>
          </Reveal>
        ) : null}
      </>
    );
    if (variant === 'bar') {
      return (
        <Stage align="flex-start" style={{ paddingInline: u * 4 }}>
          <div style={{ display: 'flex', gap: u * 3 }}>
            <div style={{ width: u * 0.8, background: t.palette.primary, borderRadius: 99, transform: `scaleY(${qp})`, transformOrigin: 'top' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: u * 2.5, alignItems: 'flex-start' }}>{body}</div>
          </div>
        </Stage>
      );
    }
    if (variant === 'editorial') {
      return (
        <Stage align="flex-start" gap={u * 2.5} style={{ paddingInline: u * 3 }}>
          {mark}
          {body}
          <div style={{ height: u * 0.4, width: `${qp * 40}%`, background: t.palette.accent, marginTop: u }} />
        </Stage>
      );
    }
    return (
      <Stage gap={u * 3}>
        {mark}
        {body}
      </Stage>
    );
  },
);

// ───────────────────────── type-on
const TypeC = z.object({ text: z.string().min(1).max(90), label: z.string().max(60).optional(), result: z.string().max(90).optional(), icon: z.string().optional() });
type TC = z.infer<typeof TypeC>;
export const typeOn = defineScene<TC>(
  {
    id: 'type-on',
    version: '1.0.0',
    category: 'typography',
    title: 'Type-on',
    description: 'Text typed into a field (search, prompt, terminal). Arabic is typed per character with correct contextual shaping — no split glyphs.',
    variants: ['search', 'prompt', 'terminal'],
    defaultVariant: 'search',
    content: TypeC,
    defaultDuration: 3.4,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'typing', weight: 0.5, volume: 0.5 },
      { at: 0.6, category: 'typing', weight: 0.6, volume: 0.5 },
      { at: 0.9, category: 'typing', weight: 0.7, volume: 0.5 },
      { at: 1.9, category: 'click', weight: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'demo'],
    energy: 0.55,
    textCapacity: { search: 45, prompt: 80, terminal: 60 },
    example: { text: 'كيف أصمم متجر يبيع؟', label: 'سؤال كل صاحب مشروع', icon: 'Search' },
    editable: ['text', 'label', 'result'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const v = useVideo();
    const t = v.tokens;
    const { s, m, holdSec } = useSceneTime();
    const u = L.u;
    const full = prepareText(c.text, { numerals: v.spec.project.numerals });
    const chars = Array.from(full);
    const typeDur = Math.min(holdSec * 0.5, 0.35 + chars.length * 0.045);
    const n = Math.round(interpolate(s, [0.3, 0.3 + typeDur], [0, chars.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    const shown = chars.slice(0, n).join('');
    const caret = Math.floor(s * 2.2) % 2 === 0 || n < chars.length;
    const boxW = Math.min(L.safe.width, u * (L.isWide ? 110 : 90));
    const mono = variant === 'terminal';
    const dir = hasArabic(full) ? 'rtl' : 'ltr';
    // Fit the single-line field: shrink within limits, flag (never hide) overflow.
    const avail = boxW - u * 6.4 - u * 6.5;
    const base = u * 4.4;
    const fam = mono ? v.fonts.mono : v.fonts.body;
    const w = canvasMeasure(full, { size: base, weight: 500, family: fam });
    const fs = variant === 'prompt' ? base : Math.max(u * 2.6, Math.min(base, (base * avail) / Math.max(1, w)));
    const fits = variant === 'prompt' || canvasMeasure(full, { size: fs, weight: 500, family: fam }) <= avail + 1;
    const field = (
      <Surface
        kind={variant === 'terminal' ? 'flat' : undefined}
        style={{
          width: boxW,
          padding: `${u * 2.6}px ${u * 3.2}px`,
          display: 'flex',
          alignItems: variant === 'prompt' ? 'flex-start' : 'center',
          gap: u * 2,
          flexDirection: 'row',
          background: variant === 'terminal' ? mix(t.palette.background, '#000000', 0.5) : undefined,
          borderRadius: variant === 'search' ? 999 : undefined,
          minHeight: variant === 'prompt' ? u * 22 : undefined,
        }}
      >
        {variant !== 'terminal' ? <Icon name={c.icon ?? (variant === 'prompt' ? 'Sparkles' : 'Search')} size={u * 4.4} treatment="plain" color={t.palette.primary} /> : <span style={{ color: t.palette.primary, fontFamily: v.fonts.mono, fontSize: u * 4 }}>›</span>}
        <div dir={dir} style={{ flex: 1, minWidth: 0 }}>
          <span
            data-qc="text"
            data-qc-role="body"
            data-qc-fit={fits ? 'ok' : 'fail'}
            data-qc-reason={fits ? undefined : 'word-too-wide'}
            data-qc-font-size={fs.toFixed(1)}
            data-qc-min-size={(u * 2.4).toFixed(1)}
            data-qc-arabic={dir === 'rtl' ? '1' : '0'}
            data-qc-text={shown}
            data-qc-color={t.palette.textOnSurface}
            style={{ fontFamily: mono ? v.fonts.mono : v.fonts.body, fontWeight: 500, fontSize: fs, color: variant === 'terminal' ? '#E8F0FF' : t.palette.textOnSurface, whiteSpace: variant === 'prompt' ? 'normal' : 'nowrap', lineHeight: 1.45 }}
          >
            {shown}
            <span style={{ display: 'inline-block', width: u * 0.45, height: u * 5, marginInlineStart: u * 0.4, background: t.palette.primary, verticalAlign: 'middle', opacity: caret ? 1 : 0 }} />
          </span>
        </div>
      </Surface>
    );
    const resP = progress(m, 0.4 + typeDur + 0.4, 0.6);
    return (
      <>
        <Accents seed={19} />
        <Stage gap={u * 4}>
          {c.label ? <Text text={c.label} role="title" size={6} /> : null}
          <Reveal delay={0.05} family="scale">{field}</Reveal>
          {c.result ? (
            <div style={{ opacity: resP, transform: `translateY(${(1 - resP) * u * 3}px)` }}>
              <Text text={c.result} role="subtitle" color={t.palette.textPrimary} animate="none" />
            </div>
          ) : null}
        </Stage>
      </>
    );
  },
);

export { EASE, bestTextOn };
