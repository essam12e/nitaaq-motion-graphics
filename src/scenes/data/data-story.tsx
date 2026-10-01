/**
 * data-story — Data Animation with storytelling: CONTEXT (axis / labels arrive)
 * → BUILD (values grow in reading order) → INSIGHT (the key value is
 * emphasised, the rest dims) → TAKEAWAY (the insight line). The variant is the
 * visualization chosen by src/data/visualize.ts; numbers come only from the
 * content (with a required source, shown on screen) and changes are computed.
 */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS, type ValidationIssue } from '../registry';
import { useSceneTime, formatNumber } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { clamp, progress } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { changePct, checkDataStory, type VizKind } from '../../data/visualize';
import type { MotionEventDecl } from '../../audio/events';

const DataC = z.object({
  title: z.string().max(100).optional(),
  insight: z.string().max(140).optional(),
  labels: z.array(z.string().min(1).max(24)).min(1).max(8),
  values: z.array(z.number()).min(1).max(8),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(12).optional(),
  decimals: z.number().int().min(0).max(2).optional(),
  /** Index to emphasise (defaults to the max value; for lines, the last point). */
  emphasis: z.number().int().min(0).optional(),
  source: z.string().min(1),
});
type DC = z.infer<typeof DataC>;

const T_CONTEXT = 0.15;
const T_BUILD = 0.5;
const buildDur = (n: number) => Math.min(1.6, 0.5 + n * 0.16);

function DataStory({ content: c, variant }: { content: DC; variant: string }) {
  const L = useLayout();
  const { tokens: t, spec } = useVideo();
  const { m, s } = useSceneTime();
  const u = L.u;
  const kind = variant as VizKind;
  const n = c.values.length;
  const nums = spec.project.numerals;
  const fmt = (v: number) => formatNumber(v, { decimals: c.decimals ?? (Number.isInteger(v) ? 0 : 1), prefix: c.prefix, suffix: c.suffix, numerals: nums, grouping: true });
  const emph = c.emphasis ?? (kind === 'line' ? n - 1 : c.values.indexOf(Math.max(...c.values)));
  const bd = buildDur(n);
  const insightAt = T_BUILD + bd + 0.15;
  const ik = progress(m, insightAt, 0.5, 'smooth');
  const W = Math.min(L.safe.width, u * 120);
  const H = L.safe.height * (L.orientation === 'landscape' ? 0.5 : 0.36);
  const ctx = progress(m, T_CONTEXT, 0.5, 'smooth');
  let viz: React.ReactNode = null;

  if (kind === 'big-number' || kind === 'change') {
    const a = c.values[0];
    const b = c.values[n - 1];
    const k = progress(m, T_BUILD, bd, 'smooth');
    if (kind === 'big-number') {
      viz = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u }}>
          <div style={{ position: 'relative' }}>
            <span style={{ visibility: 'hidden' }}><Text text={fmt(a)} role="number" size={18} animate="none" maxLines={1} /></span>
            <div style={{ position: 'absolute', inset: 0 }}><Text text={fmt(a * k)} role="number" size={18} animate="none" maxLines={1} color={t.palette.primary} /></div>
          </div>
          <Text text={c.labels[0]} role="subtitle" delay={T_CONTEXT} maxLines={2} />
        </div>
      );
    } else {
      const pct = changePct(a, b);
      viz = (
        <div style={{ display: 'flex', flexDirection: 'row-reverse', direction: 'ltr', alignItems: 'center', gap: u * 4 }}>
          <div style={{ textAlign: 'center', opacity: 1 - ik * 0.45 }}>
            <Text text={fmt(a)} role="number" size={9} animate="none" maxLines={1} />
            <Text text={c.labels[0]} role="label" animate="none" maxLines={1} />
          </div>
          <svg width={u * 12} height={u * 4} style={{ opacity: ctx }}>
            <path d={`M${u * 11},${u * 2} H${u * 1 + u * 10 * (1 - k)}`} stroke={alpha(t.palette.textPrimary, 0.6)} strokeWidth={u * 0.4} strokeLinecap="round" />
            {k > 0.9 ? <path d={`M${u * 2.6},${u * 0.6} L${u},${u * 2} L${u * 2.6},${u * 3.4}`} stroke={alpha(t.palette.textPrimary, 0.6)} strokeWidth={u * 0.4} fill="none" strokeLinecap="round" /> : null}
          </svg>
          <div style={{ textAlign: 'center', opacity: k }}>
            <Text text={fmt(a + (b - a) * k)} role="number" size={11} animate="none" maxLines={1} color={t.palette.primary} />
            <Text text={c.labels[n - 1]} role="label" animate="none" maxLines={1} />
          </div>
          {pct !== null ? (
            <div style={{ position: 'absolute', marginTop: u * 22, opacity: ik, transform: `scale(${0.9 + 0.1 * ik})`, width: '100%', textAlign: 'center' }}>
              <Text text={`${pct > 0 ? '+' : ''}${formatNumber(pct, { decimals: Number.isInteger(pct) ? 0 : 1, suffix: '٪', numerals: nums })}`} role="title" size={6} animate="none" color={pct >= 0 ? t.palette.accent : t.palette.textSecondary} maxLines={1} />
            </div>
          ) : null}
        </div>
      );
    }
  } else if (kind === 'share') {
    // one horizontal 100% bar, segments in reading order (right → left), labels below
    const tot = c.values.reduce((x, y) => x + y, 0) || 1;
    const cols = [t.palette.primary, t.palette.secondary, t.palette.accent, alpha(t.palette.textPrimary, 0.45), alpha(t.palette.primary, 0.5), alpha(t.palette.accent, 0.5)];
    let acc = 0;
    viz = (
      <div style={{ width: W, display: 'flex', flexDirection: 'column', gap: u * 2.4 }}>
        <div style={{ position: 'relative', height: u * 7, borderRadius: u * 1.4, overflow: 'hidden', background: alpha(t.palette.textPrimary, 0.08 * ctx) }}>
          {c.values.map((v, i) => {
            const k = progress(m, T_BUILD + i * (bd / n), bd / n + 0.2, 'smooth');
            const start = acc / tot;
            acc += v;
            return <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, right: `${start * 100}%`, width: `${(v / tot) * 100 * k}%`, background: cols[i % cols.length], opacity: i === emph ? 1 : 1 - ik * 0.5 }} />;
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: u * 2, justifyContent: 'center' }}>
          {c.values.map((v, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 0.8, opacity: progress(m, T_BUILD + i * (bd / n) + 0.2, 0.4) * (i === emph ? 1 : 1 - ik * 0.4) }}>
              <div style={{ width: u * 1.6, height: u * 1.6, borderRadius: u * 0.4, background: cols[i % cols.length] }} />
              <Text text={`${c.labels[i]} ${fmt(v)}`} role="label" size={3.2} animate="none" maxLines={1} />
            </div>
          ))}
        </div>
      </div>
    );
  } else if (kind === 'line') {
    const min = Math.min(...c.values);
    const max = Math.max(...c.values);
    const lo = min >= 0 && min / (max || 1) < 0.5 ? 0 : min - (max - min) * 0.15;
    const hi = max + (max - lo) * 0.08;
    const X = (i: number) => W - (i / (n - 1)) * W; // RTL: time runs right → left
    const Y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
    const k = progress(m, T_BUILD, bd, 'smooth');
    const pts = c.values.map((v, i) => [X(i), Y(v)] as const);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
    const area = `${d}L${X(n - 1)},${H}L${X(0)},${H}Z`;
    viz = (
      <div style={{ position: 'relative', width: W, height: H + u * 6 }}>
        <svg width={W} height={H} style={{ overflow: 'visible' }}>
          <line x1={0} y1={H} x2={W} y2={H} stroke={alpha(t.palette.textPrimary, 0.25 * ctx)} strokeWidth={Math.max(1, u * 0.15)} />
          <path d={area} fill={alpha(t.palette.primary, 0.14 * k)} />
          <path d={d} fill="none" stroke={t.palette.primary} strokeWidth={u * 0.55} strokeLinejoin="round" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - k} />
          {pts.map(([x, y], i) => (k >= i / (n - 1) - 0.001 ? <circle key={i} cx={x} cy={y} r={u * (i === emph ? 1.1 + 0.4 * ik : 0.7)} fill={i === emph ? t.palette.accent : t.palette.primary} /> : null))}
        </svg>
        {c.labels.map((l, i) => (
          <div key={i} style={{ position: 'absolute', top: H + u, left: X(i), transform: 'translateX(-50%)', opacity: ctx }}>
            <Text text={l} role="label" size={2.8} animate="none" maxLines={1} />
          </div>
        ))}
        <div style={{ position: 'absolute', left: pts[emph][0], top: pts[emph][1] - u * 7, transform: 'translateX(-50%)', opacity: ik }}>
          <Text text={fmt(c.values[emph])} role="title" size={5} animate="none" color={t.palette.accent} maxLines={1} />
        </div>
        {lo !== 0 ? <div style={{ position: 'absolute', top: H - u * 3, insetInlineEnd: -u * 1, opacity: 0.6 * ctx }}><Text text={fmt(lo)} role="caption" size={2.4} animate="none" maxLines={1} /></div> : null}
      </div>
    );
  } else {
    // bar: zero baseline, reading order right → left (landscape) / top → bottom (portrait)
    const max = Math.max(...c.values.map(Math.abs)) || 1;
    const horizontalBars = L.orientation !== 'landscape';
    viz = horizontalBars ? (
      <div style={{ width: W, display: 'flex', flexDirection: 'column', gap: u * 1.6 }}>
        {c.values.map((v, i) => {
          const k = progress(m, T_BUILD + i * (bd / n), 0.6, 'smooth');
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.6, opacity: i === emph ? 1 : 1 - ik * 0.45 }}>
              <div style={{ width: W * 0.28 }}><Text text={c.labels[i]} role="label" size={3.2} animate="none" align="start" maxLines={1} /></div>
              <div style={{ flex: 1, height: u * 4, position: 'relative' }}>
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${(Math.abs(v) / max) * 100 * k}%`, borderRadius: u * 0.8, background: i === emph ? t.palette.primary : alpha(t.palette.primary, 0.55) }} />
              </div>
              <div style={{ width: W * 0.16, opacity: k }}><Text text={fmt(v * k)} role="label" size={3.2} animate="none" maxLines={1} /></div>
            </div>
          );
        })}
      </div>
    ) : (
      <div style={{ width: W, height: H + u * 8, display: 'flex', flexDirection: 'row-reverse', direction: 'ltr', alignItems: 'flex-end', gap: u * 2, borderBottom: `${Math.max(1, u * 0.15)}px solid ${alpha(t.palette.textPrimary, 0.25 * ctx)}`, paddingBottom: 0 }}>
        {c.values.map((v, i) => {
          const k = progress(m, T_BUILD + i * (bd / n), 0.6, 'smooth');
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 0.6, opacity: i === emph ? 1 : 1 - ik * 0.45 }}>
              <div style={{ opacity: k }}><Text text={fmt(v * k)} role="label" size={3.2} animate="none" maxLines={1} /></div>
              <div style={{ width: '70%', height: (Math.abs(v) / max) * H * k, borderRadius: `${u * 0.8}px ${u * 0.8}px 0 0`, background: i === emph ? t.palette.primary : alpha(t.palette.primary, 0.55) }} />
              <Text text={c.labels[i]} role="label" size={2.9} animate="none" maxLines={1} />
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <Stage gap={u * 3}>
      {c.title ? <Text text={c.title} role="title" size={6} /> : null}
      <div style={{ position: 'relative' }}>{viz}</div>
      {c.insight ? <Text text={c.insight} role="subtitle" delay={insightAt + 0.15} maxLines={2} color={t.palette.textPrimary} /> : null}
      <div style={{ opacity: 0.6 * clamp(s * 2) }}>
        <Text text={`المصدر: ${c.source}`} role="caption" size={2.4} animate="none" maxLines={1} />
      </div>
    </Stage>
  );
}

export const dataStory = defineScene<DC>(
  {
    id: 'data-story',
    version: '1.0.0',
    category: 'data',
    title: 'Data story',
    description: 'Context → build → insight → takeaway with the honest visualization for the numbers (big-number / change / share / line / bar). Source required and shown; changes are computed.',
    variants: ['bar', 'line', 'share', 'change', 'big-number'],
    defaultVariant: 'bar',
    content: DataC,
    defaultDuration: 4.6,
    minDuration: 2.8,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'cut', 'match-cut'],
    sfx: [{ at: 0.5, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['data', 'proof'],
    energy: 0.5,
    example: { title: 'نمو المبيعات', labels: ['2022', '2023', '2024', '2025'], values: [120, 180, 260, 410], suffix: 'ألف', insight: 'نمو 242% خلال ثلاث سنوات', source: 'تقارير الشركة السنوية' },
    editable: ['title', 'insight'],
    validate: (c) => {
      // variant-independent checks here; the director re-checks with the chosen visualization (share sums etc.)
      const issues: ValidationIssue[] = [];
      for (const i of checkDataStory(c, 'bar')) issues.push({ path: 'values', message: i.message, severity: i.severity });
      return issues;
    },
    events: (c) => {
      const n = c.values.length;
      const bd = buildDur(n);
      return [{ type: 'chart_grow', at: T_BUILD, importance: 0.35 } as MotionEventDecl, ...(n > 1 ? [{ type: 'chart_peak' as const, at: T_BUILD + bd, importance: 0.6, anchor: 'start' as const }] : [{ type: 'counter_final' as const, at: T_BUILD + bd, importance: 0.7, anchor: 'start' as const }]), { type: 'text_reveal', at: T_BUILD + bd + 0.3, importance: 0.35 }];
    },
    module: 'data',
  },
  DataStory,
);
