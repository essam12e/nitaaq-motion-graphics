/**
 * Arabic Kinetic Typography — typography as the main visual, designed for
 * Arabic first (not mirrored English):
 *
 *  - units are WORD GROUPS (a particle like «في/من/و» stays with its word), lines
 *    and masks — connected letters are never split into per-glyph spans
 *  - wipes travel from the reading-start edge (right for RTL)
 *  - tracking is simulated with word spacing / horizontal scale, never letter-spacing
 *  - Latin runs and numbers are bidi-isolated; digits (not cursive) may roll per digit
 *  - hierarchy by scale and weight, not by effects
 *
 * Families: kinetic-sequence (impact / build / rhythm), kinetic-stack
 * (editorial stack), kinetic-number (count / roll / split), kinetic-mixed
 * (Arabic + English), kinetic-replace (word replacement).
 */
import React from 'react';
import { z } from 'zod';
import { interpolate } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { breakUnits, hasArabic, tokenize, toNumerals } from '../../typography/arabic';
import { clamp, progress } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { canvasMeasure } from '../../typography/measure-browser';
import type { MotionEventDecl } from '../../audio/events';

/** Word groups of a line: particles glued to the following word (Arabic-safe units). */
export function wordGroups(line: string, highlight: string[] = []): { text: string; highlight: boolean }[] {
  const toks = tokenize(line, highlight);
  return breakUnits(toks).map((u) => ({ text: u.map((i) => toks[i].text).join(' '), highlight: u.some((i) => toks[i].highlight) }));
}

// ───────────────────────────── kinetic-sequence
const SeqContent = z.object({
  lines: z.array(z.string().min(1).max(80)).min(1).max(6),
  highlight: z.array(z.string()).optional(),
});
type Seq = z.infer<typeof SeqContent>;

function KineticSequence({ content: c, variant }: { content: Seq; variant: string }) {
  const L = useLayout();
  const { tokens: t, hl } = useVideo();
  const { m, s, holdSec } = useSceneTime();
  const u = L.u;
  const groups = c.lines.flatMap((line, li) => wordGroups(line, c.highlight).map((g) => ({ ...g, line: li })));
  if (variant === 'impact') {
    // phrase impact: one word group owns the frame at a time; the last one holds
    const per = Math.max(0.28, Math.min(0.6, (holdSec * 0.8) / Math.max(1, groups.length)));
    const idx = Math.min(groups.length - 1, Math.floor(s / per));
    const g = groups[idx];
    const local = s - idx * per;
    const last = idx === groups.length - 1;
    const k = clamp(local / 0.18);
    const sc = (g.highlight ? 1.18 : 1.08) - (g.highlight ? 0.18 : 0.08) * (1 - Math.pow(1 - k, 3));
    return (
      <Stage>
        <div key={idx} style={{ transform: `scale(${sc})`, opacity: local < 0.02 ? 0 : 1 }}>
          <Text text={g.text} role="headline" size={g.highlight ? 19 : 15} minSize={7} maxLines={2} animate="none" color={g.highlight ? hl : t.palette.textPrimary} />
        </div>
        {last && c.lines.length > 1 ? <Text text={c.lines.join(' ')} role="subtitle" delay={idx * per + 0.35} highlight={c.highlight} motion="line-reveal" /> : null}
      </Stage>
    );
  }
  if (variant === 'rhythm') {
    // one line at a time, each line with its own reveal (mask from the reading edge, punch, wipe)
    const per = holdSec / c.lines.length;
    const li = Math.min(c.lines.length - 1, Math.floor(s / per));
    const motions = ['wipe-reveal', 'typography-punch', 'mask-reveal', 'horizontal-reveal', 'scale-impact', 'split-reveal'];
    return (
      <Stage>
        <Text key={li} text={c.lines[li]} highlight={c.highlight} role="headline" size={12} minSize={6} maxLines={3} motion={motions[li % motions.length]} delay={li * per} />
      </Stage>
    );
  }
  // build: groups accumulate line by line; emphasised groups are bigger and in the accent colour
  const per = Math.max(0.16, Math.min(0.42, (holdSec * 0.6) / Math.max(1, groups.length)));
  let gi = 0;
  return (
    <Stage gap={u * 0.6}>
      {c.lines.map((line, li) => (
        <div key={li} dir={hasArabic(line) ? 'rtl' : 'ltr'} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', gap: `0 ${u * 1.8}px`, maxWidth: L.safe.width }}>
          {wordGroups(line, c.highlight).map((g, k) => {
            const d = gi++ * per;
            const p = progress(m, d, 0.4, 'snappy');
            return (
              <div key={k} style={{ opacity: clamp(p * 2.5), transform: `translateY(${(1 - p) * 3 * u}px) scale(${0.85 + 0.15 * p})` }}>
                <Text text={g.text} role="headline" size={g.highlight ? 13 : 9} minSize={5} maxLines={1} animate="none" color={g.highlight ? hl : undefined} />
              </div>
            );
          })}
        </div>
      ))}
    </Stage>
  );
}

const seqEvents = (c: Seq, variant: string, dur: number): MotionEventDecl[] => {
  const n = c.lines.flatMap((l) => wordGroups(l, c.highlight)).length;
  if (variant === 'impact') {
    const per = Math.max(0.28, Math.min(0.6, (dur * 0.8) / Math.max(1, n)));
    // only emphasised groups and the final group earn a hit — the rest stay silent
    const groups = c.lines.flatMap((l) => wordGroups(l, c.highlight));
    return groups.flatMap((g, i) => (g.highlight || i === groups.length - 1 ? [{ type: 'word_impact' as const, at: i * per, element: 'hero-title' as const, importance: g.highlight ? 0.85 : 0.7, area: 0.15 }] : []));
  }
  if (variant === 'rhythm') return c.lines.map((_, i) => ({ type: i === 0 ? ('headline_reveal' as const) : ('text_reveal' as const), at: (i * dur) / c.lines.length, element: 'hero-title' as const, importance: i === 0 ? 0.65 : 0.4 }));
  return [{ type: 'headline_reveal', at: 0, element: 'hero-title', importance: 0.6 }];
};

export const kineticSequence = defineScene<Seq>(
  {
    id: 'kinetic-sequence',
    version: '1.0.0',
    category: 'typography',
    title: 'Kinetic sequence (Arabic word groups)',
    description: 'Arabic-first kinetic typography: phrase impact / build-up / line rhythm. Units are word groups, never glyphs.',
    variants: ['impact', 'build', 'rhythm'],
    defaultVariant: 'impact',
    content: SeqContent,
    defaultDuration: 3.6,
    minDuration: 1.6,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'text-sweep', 'whip'],
    sfx: [{ at: 0.02, category: 'impact', weight: 0.6 }],
    safeArea: 'normal',
    beats: ['hook', 'bridge', 'tease', 'montage', 'problem', 'solution'],
    energy: 0.9,
    textCapacity: { impact: 90, build: 70, rhythm: 160 },
    example: { lines: ['الفكرة تبدأ بكلمة', 'والكلمة تصنع الحركة'], highlight: ['بكلمة', 'الحركة'] },
    editable: ['lines'],
    events: seqEvents,
    module: 'kinetic-type',
    motion: { elements: ['hero-title'], jobs: ['stop-the-scroll', 'escalate-rhythm'] },
  },
  KineticSequence,
);

// ───────────────────────────── kinetic-stack (editorial)
const StackContent = z.object({
  lines: z.array(z.string().min(1).max(60)).min(2).max(5),
  highlight: z.array(z.string()).optional(),
  kicker: z.string().max(40).optional(),
});
type Stack = z.infer<typeof StackContent>;

function KineticStack({ content: c, variant }: { content: Stack; variant: string }) {
  const L = useLayout();
  const { tokens: t, hl, dir } = useVideo();
  const { m } = useSceneTime();
  const u = L.u;
  const sizes = c.lines.map((line, i) => {
    const emph = (c.highlight ?? []).some((h) => line.includes(h));
    return emph ? 13 : i % 2 === 0 ? 9.5 : 6.5;
  });
  const motions = variant === 'offset' ? ['horizontal-reveal', 'wipe-reveal', 'mask-reveal', 'horizontal-reveal', 'wipe-reveal'] : ['mask-reveal', 'wipe-reveal', 'editorial-title', 'split-reveal', 'mask-reveal'];
  const rule = progress(m, 0.1, 0.9);
  return (
    <Stage align={variant === 'offset' ? 'stretch' : 'center'} gap={u * 1.1}>
      {c.kicker ? <Text text={c.kicker} role="eyebrow" motion="tracking-reveal" color={t.palette.primary} /> : null}
      {c.lines.map((line, i) => {
        const emph = (c.highlight ?? []).some((h) => line.includes(h));
        const align = variant === 'offset' ? (i % 2 === 0 ? 'start' : 'end') : 'center';
        return (
          <div key={i} style={{ display: 'flex', justifyContent: align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center', position: 'relative' }}>
            {emph ? <div style={{ position: 'absolute', inset: `${-u * 0.4}px ${-u * 1.2}px`, background: alpha(hl, 0.14), borderRadius: u * 0.8, transform: `scaleX(${clamp(progress(m, 0.25 + i * 0.22, 0.6))})`, transformOrigin: dir === 'rtl' ? 'right' : 'left' }} /> : null}
            <Text text={line} highlight={c.highlight} role={i === 0 || emph ? 'headline' : 'title'} size={sizes[i]} minSize={4.5} maxLines={2} align={align} motion={motions[i % motions.length]} delay={0.12 + i * 0.22} color={emph ? undefined : i % 2 ? alpha(t.palette.textPrimary, 0.78) : undefined} />
          </div>
        );
      })}
      <div style={{ height: Math.max(2, u * 0.35), width: `${rule * 30}%`, background: t.palette.primary, alignSelf: variant === 'offset' ? (dir === 'rtl' ? 'flex-end' : 'flex-start') : 'center', borderRadius: 99 }} />
    </Stage>
  );
}

export const kineticStack = defineScene<Stack>(
  {
    id: 'kinetic-stack',
    version: '1.0.0',
    category: 'typography',
    title: 'Kinetic editorial stack',
    description: 'Stacked lines with scale/weight hierarchy; each line has its own reveal; emphasis on a soft bar. Variants centered / offset.',
    variants: ['centered', 'offset'],
    defaultVariant: 'centered',
    content: StackContent,
    defaultDuration: 3.8,
    minDuration: 2.2,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'wipe', 'split'],
    sfx: [{ at: 0.1, category: 'sweep', weight: 0.45 }],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'solution', 'tease', 'brand'],
    energy: 0.6,
    textCapacity: { centered: 150, offset: 130 },
    example: { kicker: 'نطاق', lines: ['حركة', 'لها معنى', 'وصوت له سبب'], highlight: ['معنى'] },
    editable: ['lines', 'kicker'],
    events: (c) => [{ type: 'headline_reveal', at: 0.12, importance: 0.55 }, ...c.lines.slice(1).flatMap((l, i) => ((c.highlight ?? []).some((h) => l.includes(h)) ? [{ type: 'word_impact' as const, at: 0.12 + (i + 1) * 0.22, importance: 0.7 }] : []))],
    module: 'kinetic-type',
  },
  KineticStack,
);

// ───────────────────────────── kinetic-number
const NumContent = z.object({
  value: z.number(),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(16).optional(),
  label: z.string().min(1).max(80),
  /** Where the number comes from — required: numbers are never invented. */
  source: z.string().min(1),
  decimals: z.number().int().min(0).max(3).optional(),
});
type Num = z.infer<typeof NumContent>;

function KineticNumber({ content: c, variant }: { content: Num; variant: string }) {
  const L = useLayout();
  const { tokens: t, hl, spec, fonts, dir } = useVideo();
  const { m, s } = useSceneTime();
  const u = L.u;
  const numerals = spec.project.numerals;
  const dec = c.decimals ?? (Math.abs(c.value) < 10 && c.value % 1 !== 0 ? 1 : 0);
  const final = c.value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const p = interpolate(s, [0.15, 1.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const eased = 1 - Math.pow(1 - p, 3);
  const size = u * (L.orientation === 'landscape' ? 26 : 30);
  const numStyle: React.CSSProperties = { fontFamily: fonts.latin, fontWeight: 800, fontSize: size, lineHeight: 1, color: hl, direction: 'ltr', unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  let num: React.ReactNode;
  if (variant === 'roll') {
    // digits are not cursive: each digit column rolls to its value (odometer)
    const chars = [...final];
    num = (
      <div style={{ ...numStyle, display: 'flex' }}>
        {chars.map((ch, i) => {
          if (!/\d/.test(ch)) return <span key={i}>{toNumerals(ch, numerals)}</span>;
          const target = Number(ch);
          const pp = clamp((s - 0.15 - i * 0.08) / 1.1);
          const v = (1 - Math.pow(1 - pp, 3)) * (10 + target);
          return (
            <span key={i} style={{ display: 'inline-block', height: size, overflow: 'hidden' }}>
              <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-v * size}px)` }}>
                {Array.from({ length: 21 }, (_, k) => (
                  <span key={k} style={{ height: size }}>{toNumerals(String(k % 10), numerals)}</span>
                ))}
              </span>
            </span>
          );
        })}
      </div>
    );
  } else {
    const shown = (c.value * eased).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    num = (
      <div style={{ ...numStyle, position: 'relative' }}>
        <span style={{ visibility: 'hidden' }}>{toNumerals(final, numerals)}</span>
        <span style={{ position: 'absolute', inset: 0, textAlign: 'center' }}>{toNumerals(shown, numerals)}</span>
      </div>
    );
  }
  const affix = (x?: string) => (x ? <span style={{ fontFamily: hasArabic(x) ? fonts.display : fonts.latin, fontWeight: 700, fontSize: size * (hasArabic(x) ? 0.32 : 0.5), color: t.palette.textPrimary, alignSelf: 'center' }}>{x}</span> : null);
  const settled = clamp((s - 1.5) / 0.5);
  const row = (
    <div dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: u * 1.2, transform: `scale(${1 + 0.04 * Math.sin(settled * Math.PI)})` }}>
      {affix(c.prefix)}
      {num}
      {affix(c.suffix)}
    </div>
  );
  if (variant === 'split' && L.orientation === 'landscape') {
    return (
      <Stage direction="row" gap={u * 6} style={{ flexDirection: dir === 'rtl' ? 'row-reverse' : 'row' }}>
        {row}
        <div style={{ width: Math.max(2, u * 0.3), alignSelf: 'stretch', background: alpha(t.palette.textPrimary, 0.2), transform: `scaleY(${progress(m, 0.3, 0.7)})` }} />
        <div style={{ maxWidth: L.safe.width * 0.38 }}>
          <Text text={c.label} role="title" align="start" motion="wipe-reveal" delay={0.45} />
        </div>
      </Stage>
    );
  }
  return (
    <Stage gap={u * 2.4}>
      {row}
      <Text text={c.label} role="title" size={5.6} motion="line-reveal" delay={0.5} />
      <Text text={c.source} role="caption" size={2.4} animate="block" entrance="fade" delay={1.1} color={alpha(t.palette.textSecondary, 0.8)} />
    </Stage>
  );
}

export const kineticNumber = defineScene<Num>(
  {
    id: 'kinetic-number',
    version: '1.0.0',
    category: 'data',
    title: 'Kinetic number + Arabic label',
    description: 'One real number counts or rolls (digits are safe to animate per digit) beside its Arabic label; source shown. Variants count / roll / split.',
    variants: ['count', 'roll', 'split'],
    defaultVariant: 'count',
    content: NumContent,
    defaultDuration: 3,
    minDuration: 2.2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'push', 'mask-wipe'],
    sfx: [{ at: 1.5, category: 'impact', weight: 0.6 }],
    safeArea: 'normal',
    beats: ['data', 'proof', 'hook'],
    energy: 0.7,
    textCapacity: { count: 80, roll: 80, split: 80 },
    validate: (c) => (/example|placeholder|lorem/i.test(c.source) ? [{ path: 'source', message: 'placeholder source — numbers must come from the user', severity: 'error' }] : []),
    example: { value: 183, suffix: '%', label: 'نمو الطلبات خلال سنة', source: 'بيانات المتجر 2025' },
    editable: ['label', 'source'],
    events: (_c, variant) => {
      const ev: MotionEventDecl[] = [{ type: 'counter_final', at: 1.5, anchor: 'start', importance: 0.8, element: 'number' }];
      if (variant !== 'roll') ev.unshift({ type: 'counter_tick', at: 0.25, repeat: { count: 5, every: 0.24 }, importance: 0.12 });
      return ev;
    },
    module: 'kinetic-type',
    motion: { elements: ['number', 'text'], jobs: ['make-the-number-land'] },
  },
  KineticNumber,
);

// ───────────────────────────── kinetic-mixed (Arabic + English)
const MixedContent = z.object({
  arabic: z.string().min(1).max(80),
  english: z.string().min(1).max(40),
  highlight: z.array(z.string()).optional(),
});
type Mixed = z.infer<typeof MixedContent>;

function KineticMixed({ content: c, variant }: { content: Mixed; variant: string }) {
  const L = useLayout();
  const { tokens: t, fonts, hl } = useVideo();
  const { m } = useSceneTime();
  const u = L.u;
  const p = progress(m, 0.05, 0.9);
  const enSize = u * (variant === 'interlock' ? 15 : 9);
  // English is a separate LTR run in the Latin face; Arabic keeps its own shaping and direction
  const english = (
    <div dir="ltr" style={{ fontFamily: fonts.latin, fontWeight: 800, fontSize: enSize, lineHeight: 1, letterSpacing: `${(1 - p) * -0.06}em`, color: variant === 'interlock' ? alpha(hl, 0.9) : t.palette.textPrimary, opacity: clamp(p * 1.6), unicodeBidi: 'isolate', whiteSpace: 'nowrap', transform: `translateX(${(1 - p) * -4 * u}px)` }}>
      {c.english}
    </div>
  );
  if (variant === 'interlock') {
    return (
      <Stage gap={0}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {english}
          <div style={{ marginTop: -enSize * 0.28 }}>
            <Text text={c.arabic} highlight={c.highlight} role="headline" size={8.5} maxLines={2} motion="wipe-reveal" delay={0.35} />
          </div>
        </div>
      </Stage>
    );
  }
  return (
    <Stage gap={u * 2}>
      <Text text={c.arabic} highlight={c.highlight} role="headline" size={9} maxLines={2} motion="mask-reveal" delay={0.1} />
      <div style={{ height: Math.max(2, u * 0.3), width: `${progress(m, 0.3, 0.6) * 18}%`, background: t.palette.primary, borderRadius: 99 }} />
      {english}
    </Stage>
  );
}

export const kineticMixed = defineScene<Mixed>(
  {
    id: 'kinetic-mixed',
    version: '1.0.0',
    category: 'typography',
    title: 'Arabic + English composition',
    description: 'Arabic line and an English term composed together (each in its own face and direction, bidi-isolated). Variants stacked / interlock.',
    variants: ['stacked', 'interlock'],
    defaultVariant: 'stacked',
    content: MixedContent,
    defaultDuration: 3,
    minDuration: 2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'mask-wipe', 'push'],
    sfx: [{ at: 0.1, category: 'sweep', weight: 0.45 }],
    safeArea: 'normal',
    beats: ['hook', 'solution', 'brand', 'reveal'],
    energy: 0.6,
    textCapacity: { stacked: 80, interlock: 60 },
    example: { arabic: 'كل مؤشراتك في مكان واحد', english: 'Dashboard', highlight: ['مكان واحد'] },
    editable: ['arabic', 'english'],
    events: () => [{ type: 'headline_reveal', at: 0.1, importance: 0.6 }],
    module: 'kinetic-type',
  },
  KineticMixed,
);

// ───────────────────────────── kinetic-replace (word replacement)
const ReplaceContent = z.object({
  prefix: z.string().min(1).max(50),
  words: z.array(z.string().min(1).max(20)).min(2).max(6),
  suffix: z.string().max(50).optional(),
});
type Replace = z.infer<typeof ReplaceContent>;

function KineticReplace({ content: c }: { content: Replace; variant: string }) {
  const L = useLayout();
  const { tokens: t, fonts, hl, dir } = useVideo();
  const { s, holdSec } = useSceneTime();
  const u = L.u;
  const fontSize = u * (L.orientation === 'landscape' ? 8 : 9);
  const per = Math.max(0.55, (holdSec - 0.6) / c.words.length);
  const idx = Math.min(c.words.length - 1, Math.floor(Math.max(0, s - 0.4) / per));
  const local = Math.max(0, s - 0.4 - idx * per);
  const k = clamp(local / 0.35);
  const e = 1 - Math.pow(1 - k, 3);
  const widthOf = (w: string) => canvasMeasure(w, { size: fontSize, weight: fonts.displayWeight, family: fonts.display }) + fontSize * 0.5;
  const wPrev = widthOf(c.words[Math.max(0, idx - 1)]);
  const wCur = widthOf(c.words[idx]);
  const slotW = idx === 0 ? wCur : wPrev + (wCur - wPrev) * e;
  const lastHold = idx === c.words.length - 1 && local > 0.5;
  return (
    <Stage gap={u * 1.4}>
      <Text text={c.prefix} role="title" size={6.5} motion="line-reveal" />
      <div style={{ position: 'relative', width: slotW, height: fontSize * 1.45, overflow: 'hidden', borderRadius: u, background: alpha(hl, 0.12) }}>
        {[idx - 1, idx].map((wi) =>
          wi < 0 || (wi === idx - 1 && k >= 1) ? null : (
            <div key={wi} dir={dir} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontWeight: fonts.displayWeight, fontSize, color: hl, transform: `translateY(${wi === idx ? (1 - (idx === 0 ? clamp(s / 0.4) : e)) * 100 : -e * 100}%)`, whiteSpace: 'nowrap' }}>
              {c.words[wi]}
            </div>
          ),
        )}
      </div>
      {c.suffix ? <Text text={c.suffix} role="subtitle" delay={0.3} color={lastHold ? t.palette.textPrimary : undefined} motion="blur-reveal" /> : null}
    </Stage>
  );
}

export const kineticReplace = defineScene<Replace>(
  {
    id: 'kinetic-replace',
    version: '1.0.0',
    category: 'typography',
    title: 'Word replacement',
    description: 'A fixed phrase with a rotating key word (masked vertical replacement; the slot width eases between words).',
    variants: ['slot'],
    defaultVariant: 'slot',
    content: ReplaceContent,
    defaultDuration: 3.6,
    minDuration: 2.4,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'push'],
    sfx: [{ at: 0.4, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['hook', 'feature', 'solution', 'montage'],
    energy: 0.65,
    textCapacity: { slot: 100 },
    example: { prefix: 'فيديو موشن', words: ['أسرع', 'أوضح', 'أذكى'], suffix: 'بهويتك أنت' },
    editable: ['prefix', 'words', 'suffix'],
    events: (c, _v, dur) => {
      const per = Math.max(0.55, (dur - 0.6) / c.words.length);
      return c.words.map((_, i) => ({ type: i === c.words.length - 1 ? ('word_impact' as const) : ('text_reveal' as const), at: 0.4 + i * per, importance: i === c.words.length - 1 ? 0.7 : 0.3, element: 'hero-title' as const }));
    },
    module: 'kinetic-type',
  },
  KineticReplace,
);
