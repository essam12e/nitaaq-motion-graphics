/** Data families: line-chart, bar-chart, donut-chart, kpi-counter, comparison-table, timeline, progress-bars, ranking. Numbers require a source. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS, type ValidationIssue } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime, formatNumber, Reveal } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { clamp, progress, countUp, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { gridShape } from '../../layout/stage';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);
const Source = z.string().min(1, 'numbers need a source — the system never invents statistics');

function SourceNote({ text }: { text?: string }) {
  const v = useVideo();
  if (!text || text === 'example') return null;
  return (
    <div style={{ marginTop: v.canvas.u * 1.5, opacity: 0.8 }}>
      <Text text={text} role="caption" size={2.4} minSize={2.2} animate="none" color={v.tokens.palette.textSecondary} maxLines={1} />
    </div>
  );
}

// ───────────────────────── line-chart
const LineC = Heading.extend({
  labels: z.array(z.string().max(16)).min(2).max(12),
  values: z.array(z.number()).min(2).max(12),
  prefix: z.string().max(6).optional(),
  suffix: z.string().max(8).optional(),
  source: Source,
});
type LC = z.infer<typeof LineC>;
const lengthsMatch = (c: { labels: string[]; values: number[] }): ValidationIssue[] =>
  c.labels.length !== c.values.length ? [{ path: 'content.values', message: `labels (${c.labels.length}) and values (${c.values.length}) differ in length`, severity: 'error' }] : [];

export const lineChart = defineScene<LC>(
  {
    id: 'line-chart',
    version: '1.0.0',
    category: 'data',
    title: 'Line chart',
    description: 'Animated line/area chart with the final value called out; variants line / area / glow.',
    variants: ['line', 'area', 'glow'],
    defaultVariant: 'area',
    content: LineC,
    defaultDuration: 4,
    minDuration: 2.6,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'riser', weight: 0.45 },
      { at: 1.8, category: 'pop', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['data', 'proof'],
    energy: 0.55,
    example: { title: 'نمو المبيعات', labels: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو'], values: [12, 18, 16, 27, 34], suffix: 'K', source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'source'],
    validate: lengthsMatch,
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w, h * 1.6);
          const H = Math.min(h * 0.82, W * 0.75);
          const u = v.canvas.u;
          const p = progress(m, 0.25, 1.6, 'smooth');
          const max = Math.max(...c.values);
          const min = Math.min(0, Math.min(...c.values));
          const rtl = v.dir === 'rtl';
          const pts = c.values.map((val, i) => {
            const pad = u * 6;
            const x = pad + (i / (c.values.length - 1)) * (W - pad * 2);
            return [rtl ? W - x : x, H - ((val - min) / (max - min || 1)) * H * 0.82 - H * 0.06];
          });
          const d = pts.map((pt, i) => `${i ? 'L' : 'M'} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
          const len = pts.reduce((acc, pt, i) => (i ? acc + Math.hypot(pt[0] - pts[i - 1][0], pt[1] - pts[i - 1][1]) : 0), 0);
          const last = pts[pts.length - 1];
          const lp = progress(m, 1.7, 0.5, 'elastic');
          const val = formatNumber(c.values[c.values.length - 1], { prefix: c.prefix, suffix: c.suffix, numerals: v.spec.project.numerals });
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: W, height: H + u * 7 }}>
                <svg width={W} height={H} style={{ overflow: 'visible' }}>
                  <defs>
                    <linearGradient id="lcfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={t.palette.primary} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={t.palette.primary} stopOpacity={0} />
                    </linearGradient>
                    <clipPath id="lcclip">
                      <rect x={rtl ? W * (1 - p) : 0} y={-20} width={W * p + 2} height={H + 40} />
                    </clipPath>
                  </defs>
                  {[0.25, 0.5, 0.75, 1].map((g) => (
                    <line key={g} x1={0} x2={W} y1={H * (1 - g * 0.82) - H * 0.06} y2={H * (1 - g * 0.82) - H * 0.06} stroke={alpha(t.palette.textPrimary, 0.08)} strokeWidth={1} strokeDasharray="6 8" />
                  ))}
                  {variant !== 'line' ? <path d={`${d} L ${last[0]} ${H} L ${pts[0][0]} ${H} Z`} fill="url(#lcfill)" clipPath="url(#lcclip)" /> : null}
                  <path d={d} fill="none" stroke={t.palette.primary} strokeWidth={u * 0.9} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} style={{ filter: variant === 'glow' || t.glow > 0.3 ? `drop-shadow(0 0 ${u * 1.4}px ${alpha(t.palette.primary, 0.7)})` : undefined }} />
                  {pts.map((pt, i) => {
                    const dp = clamp((p * (pts.length - 1) - i + 0.5) * 2);
                    return <circle key={i} cx={pt[0]} cy={pt[1]} r={u * 1.1 * dp} fill={t.palette.background} stroke={t.palette.primary} strokeWidth={u * 0.5} />;
                  })}
                </svg>
                <div style={{ position: 'absolute', left: last[0], top: last[1] - u * 12, transform: `translate(${last[0] < W * 0.2 ? '-10%' : last[0] > W * 0.8 ? '-90%' : '-50%'}, 0) scale(${lp})`, transformOrigin: 'bottom center' }}>
                  <Surface tone="primary" radius={1.6} style={{ padding: `${u * 0.8}px ${u * 2}px`, whiteSpace: 'nowrap', direction: 'ltr' }}>
                    <Text text={val} role="label" size={4.2} font="latin" animate="none" color={t.palette.textOnPrimary} maxLines={1} />
                  </Surface>
                </div>
                <div style={{ position: 'absolute', left: 0, right: 0, top: H + u * 2, height: u * 5 }}>
                  {c.labels.map((lb, i) => (
                    <div key={i} style={{ position: 'absolute', left: pts[i][0], transform: 'translateX(-50%)', opacity: clamp(p * 3 - i * 0.2) }}>
                      <Text text={lb} role="caption" size={2.6} minSize={2.2} animate="none" maxLines={1} />
                    </div>
                  ))}
                </div>
              </div>
              <SourceNote text={c.source} />
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── bar-chart
const BarC = LineC.extend({ highlightIndex: z.number().int().min(0).optional() });
type BaC = z.infer<typeof BarC>;
export const barChart = defineScene<BaC>(
  {
    id: 'bar-chart',
    version: '1.0.0',
    category: 'data',
    title: 'Bar chart',
    description: 'Bars grow with values; variants vertical / horizontal / race.',
    variants: ['vertical', 'horizontal', 'race'],
    defaultVariant: 'vertical',
    content: BarC,
    defaultDuration: 4,
    minDuration: 2.6,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe'],
    sfx: [
      { at: 0.3, category: 'whoosh', weight: 0.3 },
      { at: 0.5, category: 'tick', weight: 0.4 },
      { at: 1.5, category: 'pop', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['data', 'proof', 'comparison'],
    energy: 0.55,
    aspectVariants: { portrait: ['horizontal', 'vertical', 'race'], landscape: ['vertical', 'race'] },
    example: { title: 'الأكثر طلباً', labels: ['عطور', 'بخور', 'هدايا', 'عناية'], values: [42, 28, 19, 11], suffix: '%', source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'source'],
    validate: lengthsMatch,
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const max = Math.max(...c.values);
    const hi = c.highlightIndex ?? c.values.indexOf(max);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const n = c.values.length;
          if (variant === 'horizontal' || variant === 'race') {
            const order = variant === 'race' ? [...c.values.keys()].sort((a, b) => c.values[b] - c.values[a]) : [...c.values.keys()];
            const rowH = Math.min(u * 11, (h * 0.85) / n);
            return (
              <div style={{ width: w, display: 'flex', flexDirection: 'column', gap: rowH * 0.3 }}>
                {order.map((i, rank) => {
                  const p = progress(m, 0.3 + rank * 0.12, 1.1);
                  const val = countUp(m, 0, c.values[i], 0.3 + rank * 0.12, 1.1);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 2 }}>
                      <div style={{ width: w * 0.24, flexShrink: 0 }}>
                        <Text text={c.labels[i]} role="label" size={3.6} minSize={2.3} animate="none" align="start" maxLines={1} maxWidth={w * 0.24} color={t.palette.textPrimary} />
                      </div>
                      <div style={{ flex: 1, height: rowH * 0.62, background: alpha(t.palette.textPrimary, 0.07), borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${(c.values[i] / max) * 100 * p}%`, height: '100%', borderRadius: 99, background: i === hi ? t.palette.primary : alpha(t.palette.primary, 0.45), boxShadow: i === hi && t.glow > 0.3 ? `0 0 ${u * 2}px ${alpha(t.palette.primary, 0.6)}` : undefined }} />
                      </div>
                      <div style={{ width: w * 0.16, flexShrink: 0, direction: 'ltr' }}>
                        <Text text={formatNumber(val, { prefix: c.prefix, suffix: c.suffix, decimals: Number.isInteger(c.values[i]) ? 0 : 1, numerals: v.spec.project.numerals })} role="label" size={3.6} minSize={2.3} font="latin" animate="none" maxLines={1} color={i === hi ? v.hl : t.palette.textSecondary} />
                      </div>
                    </div>
                  );
                })}
                <SourceNote text={c.source} />
              </div>
            );
          }
          const W = Math.min(w, h * 1.5);
          const H = Math.min(h * 0.7, W * 0.8);
          const bw = (W / n) * 0.62;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: W, height: H + u * 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', direction: v.dir }}>
                {c.values.map((val, i) => {
                  const p = progress(m, 0.3 + i * 0.1, 1);
                  return (
                    <div key={i} style={{ width: bw, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u }}>
                      <div style={{ opacity: clamp(p * 2), direction: 'ltr' }}>
                        <Text text={formatNumber(countUp(m, 0, val, 0.3 + i * 0.1, 1), { prefix: c.prefix, suffix: c.suffix, decimals: Number.isInteger(val) ? 0 : 1, numerals: v.spec.project.numerals })} role="label" size={3.4} minSize={2.2} font="latin" animate="none" maxLines={1} color={i === hi ? v.hl : t.palette.textSecondary} />
                      </div>
                      <div style={{ width: bw, height: (val / max) * H * p, borderRadius: `${u * 1.4}px ${u * 1.4}px ${u * 0.4}px ${u * 0.4}px`, background: i === hi ? t.palette.primary : alpha(t.palette.primary, 0.4), boxShadow: i === hi && t.glow > 0.3 ? `0 0 ${u * 2}px ${alpha(t.palette.primary, 0.6)}` : undefined }} />
                      <Text text={c.labels[i]} role="caption" size={2.9} minSize={2.2} animate="none" maxLines={1} maxWidth={W / n} />
                    </div>
                  );
                })}
              </div>
              <SourceNote text={c.source} />
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── donut-chart
const DonutC = Heading.extend({
  segments: z.array(z.object({ label: z.string().max(24), value: z.number().nonnegative() })).min(1).max(5),
  centerLabel: z.string().max(30).optional(),
  suffix: z.string().max(6).optional(),
  source: Source,
});
type DoC = z.infer<typeof DonutC>;
export const donutChart = defineScene<DoC>(
  {
    id: 'donut-chart',
    version: '1.0.0',
    category: 'data',
    title: 'Donut / gauge',
    description: 'Share of total as donut with legend, or a single gauge; variants donut / gauge.',
    variants: ['donut', 'gauge'],
    defaultVariant: 'donut',
    content: DonutC,
    defaultDuration: 3.8,
    minDuration: 2.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'sweep', weight: 0.45 },
      { at: 1.5, category: 'pop', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['data', 'proof'],
    energy: 0.5,
    example: { title: 'من أين يأتي العملاء؟', segments: [{ label: 'انستقرام', value: 48 }, { label: 'تيك توك', value: 32 }, { label: 'بحث', value: 20 }], suffix: '%', source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'centerLabel', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const cols = [t.palette.primary, t.palette.accent, t.palette.secondary, alpha(t.palette.textPrimary, 0.5), alpha(t.palette.primary, 0.45)];
    const total = c.segments.reduce((a, s) => a + s.value, 0) || 1;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const landscape = w > h;
          const D = Math.min(landscape ? w * 0.5 : w * 0.7, h * (landscape ? 0.8 : 0.58));
          const R = D / 2 - u * 3;
          const sw = u * (variant === 'gauge' ? 4 : 5.5);
          const p = progress(m, 0.2, 1.4);
          const C = 2 * Math.PI * R;
          let acc = 0;
          const first = c.segments[0];
          const centerVal = variant === 'gauge' ? formatNumber(countUp(m, 0, first.value, 0.2, 1.4), { suffix: c.suffix, numerals: v.spec.project.numerals }) : formatNumber(countUp(m, 0, (first.value / total) * 100, 0.2, 1.4), { suffix: '%', numerals: v.spec.project.numerals });
          return (
            <div style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', alignItems: 'center', gap: u * 4 }}>
              <div style={{ position: 'relative', width: D, height: variant === 'gauge' ? D * 0.62 : D }}>
                <svg width={D} height={D} style={{ transform: variant === 'gauge' ? 'rotate(180deg)' : 'rotate(-90deg)', position: 'absolute', top: 0 }}>
                  <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={alpha(t.palette.textPrimary, 0.08)} strokeWidth={sw} strokeDasharray={variant === 'gauge' ? `${C / 2} ${C}` : undefined} />
                  {variant === 'gauge' ? (
                    <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={t.palette.primary} strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(C / 2) * clamp(first.value / 100) * p} ${C}`} />
                  ) : (
                    c.segments.map((sg, i) => {
                      const frac = sg.value / total;
                      const start = acc;
                      acc += frac;
                      const visible = clamp((p - start) / Math.max(0.001, frac)) * frac;
                      return <circle key={i} cx={D / 2} cy={D / 2} r={R} fill="none" stroke={cols[i]} strokeWidth={sw} strokeDasharray={`${Math.max(0, C * visible - u * 0.6)} ${C}`} strokeDashoffset={-C * start} />;
                    })
                  )}
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: variant === 'gauge' ? 'flex-end' : 'center', gap: u * 0.4, paddingBottom: variant === 'gauge' ? u * 2 : 0 }}>
                  <div style={{ direction: 'ltr' }}>
                    <Text text={centerVal} role="number" size={D / u / 5.2} minSize={4} font="latin" animate="none" color={v.hl} maxLines={1} />
                  </div>
                  {c.centerLabel ? <Text text={c.centerLabel} role="caption" size={3} animate="none" maxLines={1} maxWidth={R * 1.3} /> : null}
                </div>
              </div>
              {variant === 'donut' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.4 }}>
                  {c.segments.map((sg, i) => (
                    <Reveal key={i} delay={0.4 + i * 0.15}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.6 }}>
                        <div style={{ width: u * 2.4, height: u * 2.4, borderRadius: u * 0.6, background: cols[i] }} />
                        <Text text={sg.label} role="label" size={3.6} animate="none" maxLines={1} color={t.palette.textPrimary} />
                        <div style={{ direction: 'ltr' }}>
                          <Text text={formatNumber(sg.value, { suffix: c.suffix, numerals: v.spec.project.numerals })} role="label" size={3.6} font="latin" animate="none" maxLines={1} color={t.palette.textSecondary} />
                        </div>
                      </div>
                    </Reveal>
                  ))}
                  <SourceNote text={c.source} />
                </div>
              ) : (
                <SourceNote text={c.source} />
              )}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── kpi-counter
const KpiC = Heading.extend({
  kpis: z.array(z.object({ value: z.number(), label: z.string().max(40), prefix: z.string().max(6).optional(), suffix: z.string().max(8).optional(), icon: z.string().optional() })).min(1).max(4),
  source: Source,
});
type KC = z.infer<typeof KpiC>;
export const kpiCounter = defineScene<KC>(
  {
    id: 'kpi-counter',
    version: '1.0.0',
    category: 'data',
    title: 'KPI counters',
    description: 'One to four counters with labels; variants row / grid / cards.',
    variants: ['row', 'grid', 'cards'],
    defaultVariant: 'cards',
    content: KpiC,
    defaultDuration: 3.4,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'crossfade'],
    sfx: [
      { at: 0.2, category: 'riser', weight: 0.35 },
      { at: 1.3, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'data'],
    energy: 0.6,
    example: { title: 'أرقام نفتخر فيها', kpis: [{ value: 250, suffix: '+', label: 'متجر', icon: 'Store' }, { value: 98, suffix: '%', label: 'رضا العملاء', icon: 'Smile' }, { value: 14, label: 'يوم للإطلاق', icon: 'Rocket' }], source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const n = c.kpis.length;
          const shape = variant === 'row' ? { cols: w > h ? n : 1, rows: w > h ? 1 : n } : gridShape(n, w, h, variant === 'cards' ? 1.2 : 1.6);
          const gap = u * 2.4;
          const cw = (w - gap * (shape.cols - 1)) / shape.cols;
          const ch = Math.min((h - gap * (shape.rows - 1)) / shape.rows, cw / (variant === 'row' ? 2.2 : 1.1));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shape.cols}, ${cw}px)`, gap }}>
                {c.kpis.map((k, i) => {
                  const p = progress(m, 0.15 + i * 0.15, 0.7);
                  const val = formatNumber(countUp(m, 0, k.value, 0.2 + i * 0.15, 1.1), { prefix: k.prefix, suffix: k.suffix, decimals: Number.isInteger(k.value) ? 0 : 1, numerals: v.spec.project.numerals });
                  const inner = (
                    <div style={{ display: 'flex', flexDirection: variant === 'row' && w <= h ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: u * 1.4, height: '100%' }}>
                      {k.icon ? <Icon name={k.icon} size={Math.min(ch * 0.18, u * 6)} treatment={t.icon.style === 'line' ? 'duotone' : t.icon.style} /> : null}
                      <div style={{ direction: 'ltr' }}>
                        <Text text={val} role="number" size={Math.min(ch * 0.3, cw * 0.22) / u} minSize={4} font="latin" animate="none" color={v.hl} maxLines={1} maxWidth={cw * 0.9} />
                      </div>
                      <Text text={k.label} role="label" size={3.6} animate="none" maxLines={2} maxWidth={cw * 0.85} color={variant === 'cards' ? t.palette.textOnSurface : t.palette.textPrimary} />
                    </div>
                  );
                  return (
                    <div key={i} style={{ height: ch, opacity: p, transform: `translateY(${(1 - p) * u * 5}px)` }}>
                      {variant === 'cards' ? <Surface style={{ height: '100%', padding: u * 2 }}>{inner}</Surface> : inner}
                    </div>
                  );
                })}
              </div>
              <SourceNote text={c.source} />
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── comparison-table
const CompC = Heading.extend({
  leftTitle: z.string().max(30),
  rightTitle: z.string().max(30),
  rows: z.array(z.object({ label: z.string().max(40), left: z.union([z.boolean(), z.string().max(24)]), right: z.union([z.boolean(), z.string().max(24)]) })).min(2).max(6),
});
type CoC = z.infer<typeof CompC>;
export const comparisonTable = defineScene<CoC>(
  {
    id: 'comparison-table',
    version: '1.0.0',
    category: 'data',
    title: 'Comparison',
    description: 'Us-vs-them or before/after table; variants table / versus.',
    variants: ['table', 'versus'],
    defaultVariant: 'table',
    content: CompC,
    defaultDuration: 4.5,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe'],
    sfx: [
      { at: 0.3, category: 'tick', weight: 0.35 },
      { at: 0.6, category: 'tick', weight: 0.3 },
      { at: 0.9, category: 'tick', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['comparison', 'proof', 'solution'],
    energy: 0.5,
    example: { title: 'الفرق واضح', leftTitle: 'متجر عادي', rightTitle: 'متجرنا', rows: [{ label: 'تصميم مخصص', left: false, right: true }, { label: 'سرعة التحميل', left: 'بطيء', right: 'سريع' }, { label: 'دعم فني', left: false, right: true }] },
    editable: ['eyebrow', 'title', 'subtitle', 'leftTitle', 'rightTitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const cell = (val: boolean | string, good: boolean, size: number) =>
      typeof val === 'boolean' ? (
        <Icon name={val ? 'CircleCheck' : 'CircleX'} size={size} color={val ? t.palette.positive : alpha(t.palette.negative, 0.85)} treatment="plain" />
      ) : (
        <Text text={val} role="label" size={3.4} minSize={2.2} animate="none" maxLines={1} color={good ? v.hl : t.palette.textSecondary} />
      );
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const W = Math.min(w, u * 110);
          const rowH = Math.min(u * 11, (h * 0.8) / (c.rows.length + 1));
          if (variant === 'versus') {
            const colW = (W - u * 10) / 2;
            const side = (title: string, key: 'left' | 'right', good: boolean, delay: number) => (
              <Reveal delay={delay} family={good ? 'scale' : 'fade'}>
                <Surface tone={good ? 'primary' : 'surface'} style={{ width: colW, padding: u * 3, display: 'flex', flexDirection: 'column', gap: u * 1.8, opacity: good ? 1 : 0.8 }}>
                  <Text text={title} role="title" size={5} animate="none" maxLines={1} color={good ? t.palette.textOnPrimary : t.palette.textOnSurface} />
                  {c.rows.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.4 }}>
                      {typeof r[key] === 'boolean' ? <Icon name={r[key] ? 'Check' : 'X'} size={u * 3.6} color={good ? t.palette.textOnPrimary : t.palette.textSecondary} treatment="plain" stroke={3} /> : null}
                      <Text text={typeof r[key] === 'string' ? `${r.label}: ${r[key]}` : r.label} role="label" size={3.3} minSize={2.2} animate="none" align="start" maxLines={2} maxWidth={colW - u * 10} color={good ? t.palette.textOnPrimary : t.palette.textOnSurface} />
                    </div>
                  ))}
                </Surface>
              </Reveal>
            );
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: u * 2, direction: v.dir }}>
                {side(c.leftTitle, 'left', false, 0.1)}
                <div style={{ width: u * 8, height: u * 8, borderRadius: 99, background: t.palette.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Text text="VS" role="label" font="latin" size={3.2} animate="none" color={t.palette.textPrimary} />
                </div>
                {side(c.rightTitle, 'right', true, 0.4)}
              </div>
            );
          }
          return (
            <Surface style={{ width: W, padding: u * 2.4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr', alignItems: 'center', rowGap: 0 }}>
                <div />
                <div style={{ textAlign: 'center', padding: u }}><Text text={c.leftTitle} role="label" size={3.4} animate="none" maxLines={1} color={t.palette.textSecondary} /></div>
                <div style={{ textAlign: 'center', padding: u, background: alpha(t.palette.primary, 0.14), borderRadius: `${u * 1.4}px ${u * 1.4}px 0 0` }}><Text text={c.rightTitle} role="label" size={3.6} animate="none" maxLines={1} color={v.hl} weight={700} /></div>
                {c.rows.map((r, i) => {
                  const p = progress(m, 0.3 + i * 0.25, 0.5);
                  return (
                    <React.Fragment key={i}>
                      <div style={{ height: rowH, display: 'flex', alignItems: 'center', borderTop: `1px solid ${t.palette.border}`, opacity: p }}>
                        <Text text={r.label} role="label" size={3.4} minSize={2.2} animate="none" align="start" maxLines={1} color={t.palette.textOnSurface} maxWidth={W * 0.45} />
                      </div>
                      <div style={{ height: rowH, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${t.palette.border}`, opacity: p }}>{cell(r.left, false, u * 4.4)}</div>
                      <div style={{ height: rowH, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${t.palette.border}`, background: alpha(t.palette.primary, 0.14), opacity: p, transform: `scale(${0.8 + 0.2 * p})` }}>{cell(r.right, true, u * 4.4)}</div>
                    </React.Fragment>
                  );
                })}
              </div>
            </Surface>
          );
        }}
      />
    );
  },
);

// ───────────────────────── timeline
const TimeC = Heading.extend({ events: z.array(z.object({ label: z.string().max(20), text: z.string().max(60) })).min(2).max(6) });
type TC = z.infer<typeof TimeC>;
export const timeline = defineScene<TC>(
  {
    id: 'timeline',
    version: '1.0.0',
    category: 'data',
    title: 'Timeline',
    description: 'Milestones along a drawn path; variants horizontal / vertical / milestones.',
    variants: ['horizontal', 'vertical', 'milestones'],
    defaultVariant: 'vertical',
    content: TimeC,
    defaultDuration: 4.6,
    minDuration: 3,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe', 'crossfade'],
    sfx: [
      { at: 0.2, category: 'sweep', weight: 0.35 },
      { at: 0.8, category: 'pop', weight: 0.3 },
      { at: 1.6, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['process', 'brand', 'proof'],
    energy: 0.45,
    aspectVariants: { portrait: ['vertical', 'milestones'], landscape: ['horizontal', 'milestones'], square: ['vertical', 'horizontal'] },
    example: { title: 'من الفكرة للإطلاق', events: [{ label: 'اليوم 1', text: 'نفهم مشروعك' }, { label: 'اليوم 5', text: 'نصمم الهوية والواجهة' }, { label: 'اليوم 10', text: 'نبني المتجر' }, { label: 'اليوم 14', text: 'الإطلاق' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const n = c.events.length;
    const per = Math.max(0.35, (holdSec - 1) / n);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const lineP = progress(m, 0.2, per * n, 'smooth');
          const vertical = variant === 'vertical' || (variant === 'milestones' && h > w);
          if (vertical) {
            const rowH = Math.min(u * 18, h / n);
            return (
              <div style={{ position: 'relative', width: Math.min(w, u * 90), height: rowH * n }}>
                <div style={{ position: 'absolute', [v.dir === 'rtl' ? 'right' : 'left']: u * 3.4, top: rowH * 0.3, width: u * 0.5, height: (rowH * (n - 1)) * lineP, background: t.palette.primary, borderRadius: 99 }} />
                {c.events.map((e, i) => {
                  const p = progress(m, 0.25 + i * per, 0.5, 'elastic');
                  return (
                    <div key={i} style={{ position: 'absolute', top: i * rowH, [v.dir === 'rtl' ? 'right' : 'left']: 0, [v.dir === 'rtl' ? 'left' : 'right']: 0, display: 'flex', alignItems: 'flex-start', gap: u * 3, opacity: clamp(p * 2) }}>
                      <div style={{ width: u * 7.3, height: u * 7.3, borderRadius: 99, background: variant === 'milestones' ? t.palette.primary : t.palette.background, border: `${u * 0.6}px solid ${t.palette.primary}`, transform: `scale(${p})`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.palette.textOnPrimary, fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 3 }}>{variant === 'milestones' ? i + 1 : ''}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u * 0.3 }}>
                        <Text text={e.label} role="label" size={3.2} animate="none" align="start" color={v.hl} maxLines={1} />
                        <Text text={e.text} role="title" size={4.8} minSize={2.8} animate="none" align="start" maxLines={2} maxWidth={Math.min(w, u * 90) - u * 12} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          const colW = w / n;
          return (
            <div style={{ position: 'relative', width: w, height: Math.min(h, u * 40) }}>
              <div style={{ position: 'absolute', top: u * 12, [v.dir === 'rtl' ? 'right' : 'left']: colW / 2, width: (w - colW) * lineP, height: u * 0.5, background: t.palette.primary, borderRadius: 99 }} />
              {c.events.map((e, i) => {
                const p = progress(m, 0.25 + i * per, 0.5, 'elastic');
                return (
                  <div key={i} style={{ position: 'absolute', top: 0, [v.dir === 'rtl' ? 'right' : 'left']: i * colW, width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.5, opacity: clamp(p * 2) }}>
                    <Text text={e.label} role="label" size={3.2} animate="none" color={v.hl} maxLines={1} maxWidth={colW * 0.95} />
                    <div style={{ width: u * 6, height: u * 6, borderRadius: 99, background: t.palette.primary, transform: `scale(${p})`, boxShadow: `0 0 0 ${u}px ${alpha(t.palette.primary, 0.25)}` }} />
                    <Text text={e.text} role="label" size={3.8} minSize={2.3} animate="none" maxLines={3} maxWidth={colW * 0.92} color={t.palette.textPrimary} />
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── progress-bars
const ProgC = Heading.extend({ items: z.array(z.object({ label: z.string().max(40), value: z.number().min(0).max(100) })).min(1).max(5), source: Source });
type PrC = z.infer<typeof ProgC>;
export const progressBars = defineScene<PrC>(
  {
    id: 'progress-bars',
    version: '1.0.0',
    category: 'data',
    title: 'Progress',
    description: 'Percentages as bars, rings or steps; variants bars / rings.',
    variants: ['bars', 'rings'],
    defaultVariant: 'bars',
    content: ProgC,
    defaultDuration: 3.6,
    minDuration: 2.4,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'crossfade'],
    sfx: [{ at: 0.3, category: 'riser', weight: 0.35 }],
    safeArea: 'normal',
    beats: ['data', 'proof'],
    energy: 0.45,
    example: { title: 'جودة في كل تفصيل', items: [{ label: 'سرعة الموقع', value: 95 }, { label: 'تجربة الجوال', value: 98 }], source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          if (variant === 'rings') {
            const n = c.items.length;
            const D = Math.min(w / Math.min(n, 3) - u * 3, h * 0.55);
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: u * 3 }}>
                {c.items.map((it, i) => {
                  const p = progress(m, 0.2 + i * 0.15, 1.2);
                  const R = D / 2 - u * 2;
                  const C = 2 * Math.PI * R;
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.4 }}>
                      <div style={{ position: 'relative', width: D, height: D }}>
                        <svg width={D} height={D} style={{ transform: 'rotate(-90deg)' }}>
                          <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={alpha(t.palette.textPrimary, 0.08)} strokeWidth={u * 2} />
                          <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={t.palette.primary} strokeWidth={u * 2} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - (it.value / 100) * p)} />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', direction: 'ltr' }}>
                          <Text text={formatNumber(it.value * p, { suffix: '%', decimals: 0, numerals: v.spec.project.numerals })} role="number" size={D / u / 4.5} minSize={3.5} font="latin" animate="none" color={v.hl} maxLines={1} />
                        </div>
                      </div>
                      <Text text={it.label} role="label" size={3.6} animate="none" maxLines={2} maxWidth={D * 1.1} color={t.palette.textPrimary} />
                    </div>
                  );
                })}
                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}><SourceNote text={c.source} /></div>
              </div>
            );
          }
          return (
            <div style={{ width: Math.min(w, u * 95), display: 'flex', flexDirection: 'column', gap: u * 3.4 }}>
              {c.items.map((it, i) => {
                const p = progress(m, 0.2 + i * 0.18, 1.2);
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: u * 1.2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Text text={it.label} role="label" size={4} animate="none" align="start" maxLines={1} color={t.palette.textPrimary} />
                      <div style={{ direction: 'ltr' }}>
                        <Text text={formatNumber(it.value * p, { suffix: '%', decimals: 0, numerals: v.spec.project.numerals })} role="label" size={4} font="latin" animate="none" maxLines={1} color={v.hl} />
                      </div>
                    </div>
                    <div style={{ height: u * 2.4, borderRadius: 99, background: alpha(t.palette.textPrimary, 0.08), overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${it.value * p}%`, borderRadius: 99, background: `linear-gradient(90deg, ${t.palette.primary}, ${t.palette.accent})`, marginInlineStart: 0 }} />
                    </div>
                  </div>
                );
              })}
              <SourceNote text={c.source} />
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── ranking
const RankC = Heading.extend({ items: z.array(z.object({ label: z.string().max(40), note: z.string().max(40).optional() })).min(3).max(5) });
type RC = z.infer<typeof RankC>;
export const ranking = defineScene<RC>(
  {
    id: 'ranking',
    version: '1.0.0',
    category: 'data',
    title: 'Ranking',
    description: 'Top-N list or podium (order provided by the user); variants list / podium.',
    variants: ['list', 'podium'],
    defaultVariant: 'list',
    content: RankC,
    defaultDuration: 4,
    minDuration: 2.6,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'pop', weight: 0.35 },
      { at: 0.6, category: 'pop', weight: 0.3 },
      { at: 0.9, category: 'impact', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'data', 'feature'],
    energy: 0.55,
    example: { title: 'الأكثر مبيعاً هذا الشهر', items: [{ label: 'عطر العود' }, { label: 'دهن الورد' }, { label: 'بخور ملكي' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          if (variant === 'podium') {
            const top = c.items.slice(0, 3);
            const order = [1, 0, 2];
            const colW = Math.min(w / 3.3, u * 30);
            return (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: u * 2, direction: 'ltr' }}>
                {order.map((idx) => {
                  const it = top[idx];
                  const hh = [h * 0.5, h * 0.36, h * 0.28][idx];
                  const p = progress(m, 0.2 + (2 - idx) * 0.25, 0.8, 'elastic');
                  return (
                    <div key={idx} style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.4 }}>
                      <div style={{ opacity: clamp(p * 2) }}>
                        <Text text={it.label} role="label" size={3.8} animate="none" maxLines={2} maxWidth={colW} color={t.palette.textPrimary} />
                      </div>
                      <div style={{ width: colW, height: hh * p, borderRadius: `${u * 2}px ${u * 2}px 0 0`, background: idx === 0 ? t.palette.primary : alpha(t.palette.primary, 0.35 + (2 - idx) * 0.1), display: 'flex', justifyContent: 'center', paddingTop: u * 2, boxSizing: 'border-box' }}>
                        <span style={{ fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 9, color: idx === 0 ? t.palette.textOnPrimary : t.palette.textPrimary, opacity: clamp(p) }}>{idx + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          const W = Math.min(w, u * 95);
          return (
            <div style={{ width: W, display: 'flex', flexDirection: 'column', gap: u * 2 }}>
              {c.items.map((it, i) => {
                const p = progress(m, 0.2 + (c.items.length - 1 - i) * 0.2, 0.6);
                return (
                  <div key={i} style={{ opacity: p, transform: `translateX(${(1 - p) * (v.dir === 'rtl' ? 1 : -1) * u * 10}px)` }}>
                    <Surface tone={i === 0 ? 'primary' : 'surface'} style={{ padding: `${u * 2}px ${u * 3}px`, display: 'flex', alignItems: 'center', gap: u * 3 }}>
                      <span style={{ fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 6, width: u * 7, textAlign: 'center', color: i === 0 ? t.palette.textOnPrimary : v.hl }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <Text text={it.label} role="title" size={4.8} minSize={2.6} animate="none" align="start" maxLines={1} maxWidth={W - u * 16} color={i === 0 ? t.palette.textOnPrimary : t.palette.textOnSurface} />
                        {it.note ? <Text text={it.note} role="caption" animate="none" align="start" maxLines={1} maxWidth={W - u * 16} color={i === 0 ? t.palette.textOnPrimary : undefined} /> : null}
                      </div>
                    </Surface>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    );
  },
);

export { EASE };
