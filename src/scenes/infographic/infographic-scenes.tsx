/** Infographic families: feature-set (10 layouts), process-steps, icon-list, pros-cons, problem-solution. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, HeadlineBlock, useSceneTime, Reveal } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { clamp, progress, float, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { gridShape, orbitPoints } from '../../layout/stage';
import { useLabel } from '../i18n';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);
const Feature = z.object({ title: z.string().min(1).max(50), text: z.string().max(110).optional(), icon: z.string().optional() });
type FeatureT = z.infer<typeof Feature>;

/** One feature card; content is fitted to the card box (never clipped). */
function FeatureCard({ f, w, h, delay, compact, active = 1, horizontal, tone = 'surface' }: { f: FeatureT; w: number; h?: number; delay: number; compact?: boolean; active?: number; horizontal?: boolean; tone?: 'surface' | 'primary' }) {
  const v = useVideo();
  const { m } = useSceneTime();
  const t = v.tokens;
  const u = v.canvas.u;
  const p = progress(m, delay, 0.7);
  // tall rows (few features on a portrait canvas) carry bigger type instead of empty card space
  const big = !compact && (h ?? 0) >= u * (horizontal ? 18 : 26);
  const iconSize = compact ? u * 3.6 : big ? u * 5.6 : u * 4.4;
  const fg = tone === 'primary' ? t.palette.textOnPrimary : t.palette.textOnSurface;
  const pad = compact ? u * 1.8 : u * 2.4;
  const textW = horizontal ? w - pad * 2 - iconSize * 1.9 - u * 2 : w - pad * 2;
  return (
    <div style={{ opacity: clamp(p * 1.6) * (0.35 + 0.65 * active), transform: `translateY(${(1 - p) * u * 5}px) scale(${0.96 + 0.04 * active})` }}>
      <Surface tone={tone} style={{ width: w, height: h, padding: pad, display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: horizontal ? 'center' : 'flex-start', gap: u * (horizontal ? 2 : 1.4), justifyContent: horizontal ? 'flex-start' : 'center' }}>
        <Icon name={f.icon} size={iconSize} color={tone === 'primary' ? t.palette.textOnPrimary : undefined} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u * 0.6, minWidth: 0 }}>
          <Text text={f.title} role="label" size={compact ? 3.8 : big ? 5.6 : 4.4} minSize={2.6} weight={700} animate="none" align="start" maxLines={2} maxWidth={textW} color={fg} />
          {f.text && !compact ? <Text text={f.text} role="body" size={big ? 3.8 : 3} minSize={2.4} animate="none" align="start" maxLines={3} maxWidth={textW} color={tone === 'primary' ? t.palette.textOnPrimary : t.palette.textSecondary} /> : null}
        </div>
      </Surface>
    </div>
  );
}

// ───────────────────────── feature-set (10 variants)
const FeatureSetC = Heading.extend({ features: z.array(Feature).min(2).max(6) });
type FSC = z.infer<typeof FeatureSetC>;
export const featureSet = defineScene<FSC>(
  {
    id: 'feature-set',
    version: '1.0.0',
    category: 'infographic',
    title: 'Feature set',
    description: 'Two to six features with icons in ten compositions: grid / stack / orbit / carousel / split / floating / perspective / spotlight / staggered / masonry.',
    variants: ['grid', 'stack', 'orbit', 'carousel', 'split', 'floating', 'perspective', 'spotlight', 'staggered', 'masonry'],
    defaultVariant: 'grid',
    content: FeatureSetC,
    defaultDuration: 4.4,
    minDuration: 2.8,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'slide', 'crossfade', 'zoom-in'],
    sfx: [
      { at: 0.2, category: 'pop', weight: 0.4 },
      { at: 0.45, category: 'pop', weight: 0.3 },
      { at: 0.7, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['feature', 'solution', 'product', 'demo'],
    energy: 0.55,
    aspectVariants: {
      portrait: ['stack', 'grid', 'carousel', 'spotlight', 'staggered', 'masonry', 'floating'],
      landscape: ['grid', 'orbit', 'split', 'perspective', 'spotlight', 'masonry', 'floating'],
      square: ['grid', 'orbit', 'stack', 'spotlight', 'carousel'],
    },
    textCapacity: { grid: 60, stack: 90, orbit: 30, carousel: 110, split: 90, floating: 40, perspective: 50, spotlight: 90, staggered: 80, masonry: 80 },
    example: {
      title: 'كل اللي يحتاجه متجرك',
      highlight: ['متجرك'],
      features: [
        { title: 'دفع آمن', text: 'مدى وأبل باي وفيزا', icon: 'ShieldCheck' },
        { title: 'شحن سريع', text: 'ربط مع شركات الشحن', icon: 'Truck' },
        { title: 'تقارير لحظية', text: 'تابع مبيعاتك أول بأول', icon: 'ChartLine' },
        { title: 'دعم عربي', text: 'فريق يفهمك', icon: 'Headset' },
      ],
    },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, holdSec } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const n = c.features.length;
    const rtl = v.dir === 'rtl';
    const per = Math.max(0.6, (holdSec - 0.4) / n);
    return (
      <HeroSplit
        heading={variant === 'orbit' ? undefined : heading(c)}
        visual={(w, h) => {
          switch (variant) {
            case 'stack': {
              const gap = u * 1.6;
              const rowH = Math.min(u * (v.canvas.orientation === 'portrait' && n <= 4 ? 21 : 15), (h - gap * (n - 1)) / n); // few rows on a tall canvas: fill it
              const W = Math.min(w, u * 100);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap }}>
                  {c.features.map((f, i) => (
                    <FeatureCard key={i} f={f} w={W} h={rowH} delay={0.2 + i * 0.15} horizontal />
                  ))}
                </div>
              );
            }
            case 'orbit': {
              const R = Math.min(w, h) / 2;
              const cardW = Math.min(R * 0.78, u * 34);
              const pts = orbitPoints(n, (w / 2 - cardW / 2) * 0.96, (h / 2 - u * 8) * 0.9, -Math.PI / 2);
              const spin = s * 0.04;
              const centerP = progress(m, 0.05, 0.8, 'elastic');
              return (
                <div style={{ position: 'relative', width: w, height: h }}>
                  <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
                    <ellipse cx={w / 2} cy={h / 2} rx={(w / 2 - cardW / 2) * 0.96} ry={(h / 2 - u * 8) * 0.9} fill="none" stroke={alpha(t.palette.primary, 0.3)} strokeWidth={u * 0.25} strokeDasharray={`${u} ${u * 1.5}`} strokeDashoffset={-s * u * 4} />
                  </svg>
                  <div style={{ position: 'absolute', left: w / 2, top: h / 2, transform: `translate(-50%, -50%) scale(${centerP})`, width: Math.min(w * 0.42, R * 0.9) }}>
                    {c.title ? <HeadlineBlock title={c.title} highlight={c.highlight} role="title" size={6} maxLines={3} maxWidth={Math.min(w * 0.42, R * 0.9)} animate="none" /> : <Icon name="Sparkles" size={u * 10} treatment="filled" />}
                  </div>
                  {c.features.map((f, i) => {
                    const pt = pts[i];
                    const x = pt.x * Math.cos(spin) - (pt.y * Math.sin(spin) * w) / h;
                    const y = pt.y + float(m.frame, m.fps, (m.floatK ?? 1) * u * 0.8, 4, i);
                    return (
                      <div key={i} style={{ position: 'absolute', left: w / 2 + (rtl ? -x : x) - cardW / 2, top: h / 2 + y - u * 6 }}>
                        <FeatureCard f={f} w={cardW} delay={0.3 + i * 0.12} compact />
                      </div>
                    );
                  })}
                </div>
              );
            }
            case 'carousel': {
              const cardW = Math.min(w * 0.8, u * 70);
              const cardH = Math.min(h * 0.75, cardW * 0.8);
              const pos = clamp((s - 0.3) / per, 0, n - 1);
              const idx = Math.floor(pos);
              const frac = EASE.smooth(clamp((pos - idx - 0.65) / 0.35));
              const cur = idx + frac;
              return (
                <div style={{ position: 'relative', width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'relative', width: w, height: cardH }}>
                    {c.features.map((f, i) => {
                      const d = i - cur;
                      if (Math.abs(d) > 1.6) return null;
                      const x = d * (cardW + u * 4) * (rtl ? -1 : 1);
                      return (
                        <div key={i} style={{ position: 'absolute', left: w / 2 - cardW / 2 + x, top: 0, transform: `scale(${1 - Math.min(1, Math.abs(d)) * 0.12})`, opacity: 1 - Math.min(1, Math.abs(d)) * 0.55 }}>
                          <Surface style={{ width: cardW, height: cardH, padding: u * 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2.4 }}>
                            <Icon name={f.icon} size={u * 8} treatment="badge" />
                            <Text text={f.title} role="title" size={6.4} minSize={3.6} animate="none" maxLines={2} maxWidth={cardW - u * 8} color={t.palette.textOnSurface} />
                            {f.text ? <Text text={f.text} role="body" size={3.8} animate="none" maxLines={3} maxWidth={cardW - u * 8} color={t.palette.textSecondary} /> : null}
                          </Surface>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: u * 1.2, marginTop: u * 3, direction: v.dir }}>
                    {c.features.map((_, i) => (
                      <div key={i} style={{ width: Math.abs(i - cur) < 0.5 ? u * 5 : u * 1.6, height: u * 1.6, borderRadius: 99, background: Math.abs(i - cur) < 0.5 ? t.palette.primary : alpha(t.palette.textPrimary, 0.25) }} />
                    ))}
                  </div>
                </div>
              );
            }
            case 'split': {
              const [first, ...rest] = c.features;
              const landscape = w > h;
              const bigW = landscape ? w * 0.48 : w;
              const bigH = landscape ? h * 0.8 : h * 0.42;
              const listW = landscape ? w * 0.48 : w;
              const rowH = Math.min(u * 13, ((landscape ? h * 0.8 : h * 0.54) - u * 1.4 * (rest.length - 1)) / Math.max(1, rest.length));
              return (
                <div style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', gap: u * 3, alignItems: 'center', direction: v.dir }}>
                  <Reveal delay={0.1} family="scale">
                    <Surface tone="primary" style={{ width: bigW, height: bigH, padding: u * 3.6, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: u * 2 }}>
                      <Icon name={first.icon} size={u * 7} color={t.palette.textOnPrimary} treatment="plain" />
                      <Text text={first.title} role="title" size={7} minSize={4} animate="none" align="start" maxLines={2} maxWidth={bigW - u * 7.2} color={t.palette.textOnPrimary} />
                      {first.text ? <Text text={first.text} role="body" size={3.8} animate="none" align="start" maxLines={3} maxWidth={bigW - u * 7.2} color={t.palette.textOnPrimary} /> : null}
                    </Surface>
                  </Reveal>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.4 }}>
                    {rest.map((f, i) => (
                      <FeatureCard key={i} f={f} w={listW} h={rowH} delay={0.4 + i * 0.15} horizontal compact={!f.text} />
                    ))}
                  </div>
                </div>
              );
            }
            case 'floating': {
              const cardW = Math.min(w * (n > 3 ? 0.46 : 0.56), u * 42);
              const slots = [
                [0.28, 0.2],
                [0.72, 0.36],
                [0.3, 0.6],
                [0.7, 0.8],
                [0.5, 0.45],
                [0.25, 0.9],
              ];
              return (
                <div style={{ position: 'relative', width: w, height: h }}>
                  {c.features.map((f, i) => {
                    const [fx, fy] = slots[i];
                    const x = (rtl ? 1 - fx : fx) * w;
                    const y = (n <= 3 ? 0.15 + (i / Math.max(1, n - 1)) * 0.7 : fy) * h;
                    return (
                      <div key={i} style={{ position: 'absolute', left: clamp(x - cardW / 2, 0, w - cardW), top: y - u * 6, transform: `translateY(${float(m.frame, m.fps, (m.floatK ?? 1) * u * 1.4, 3.5 + i * 0.6, i * 1.3)}px) rotate(${((i % 2) * 2 - 1) * 2}deg)` }}>
                        <FeatureCard f={f} w={cardW} delay={0.15 + i * 0.18} horizontal compact />
                      </div>
                    );
                  })}
                </div>
              );
            }
            case 'perspective': {
              const g = gridShape(n, w * 0.9, h * 0.9, 1.5);
              const gap = u * 2;
              const cw = (w * 0.92 - gap * (g.cols - 1)) / g.cols;
              const tilt = 24 - 16 * progress(m, 0, 2.4, 'smooth');
              return (
                <div style={{ perspective: u * 160 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, ${cw}px)`, gap, transform: `rotateX(${tilt}deg) rotateY(${(rtl ? 1 : -1) * tilt * 0.5}deg)`, transformStyle: 'preserve-3d', direction: v.dir }}>
                    {c.features.map((f, i) => (
                      <div key={i} style={{ transform: `translateZ(${Math.sin(s * 1.2 + i) * u * 2}px)` }}>
                        <FeatureCard f={f} w={cw} delay={0.1 + i * 0.12} compact={cw < u * 34} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            }
            case 'spotlight': {
              const gap = u * 1.6;
              const rowH = Math.min(u * 15, (h - gap * (n - 1)) / n);
              const W = Math.min(w, u * 100);
              const act = clamp((s - 0.5) / per, 0, n - 0.001);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap }}>
                  {c.features.map((f, i) => {
                    const a = clamp(1 - Math.abs(act - i - 0.5) * 1.4);
                    return <FeatureCard key={i} f={f} w={W} h={rowH} delay={0.1 + i * 0.1} horizontal active={Math.max(a, s > 0.5 + per * n ? 1 : 0)} tone={a > 0.6 ? 'primary' : 'surface'} />;
                  })}
                </div>
              );
            }
            case 'staggered': {
              const gap = u * 1.8;
              const W = Math.min(w * 0.84, u * 86);
              const rowH = Math.min(u * (v.canvas.orientation === 'portrait' && n <= 4 ? 19 : 15), (h - gap * (n - 1)) / n);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap, width: w }}>
                  {c.features.map((f, i) => (
                    <div key={i} style={{ alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end' }}>
                      <FeatureCard f={f} w={W} h={rowH} delay={0.15 + i * 0.18} horizontal />
                    </div>
                  ))}
                </div>
              );
            }
            case 'masonry': {
              const cols = w > h ? 3 : 2;
              const gap = u * 1.6;
              const cw = (w - gap * (cols - 1)) / cols;
              const buckets: { f: FeatureT; i: number }[][] = Array.from({ length: cols }, () => []);
              c.features.forEach((f, i) => buckets[i % cols].push({ f, i }));
              return (
                <div style={{ display: 'flex', gap, alignItems: 'flex-start', direction: v.dir }}>
                  {buckets.map((b, ci) => (
                    <div key={ci} style={{ display: 'flex', flexDirection: 'column', gap, marginTop: ci % 2 ? u * 6 : 0 }}>
                      {b.map(({ f, i }) => (
                        <FeatureCard key={i} f={f} w={cw} h={Math.min(h / 2.4, cw * (i % 3 === 0 ? 1 : 0.75))} delay={0.1 + i * 0.12} tone={i === 0 ? 'primary' : 'surface'} />
                      ))}
                    </div>
                  ))}
                </div>
              );
            }
            case 'grid':
            default: {
              const g = gridShape(n, w, h, 1.1);
              const gap = u * 2;
              const cw = (w - gap * (g.cols - 1)) / g.cols;
              const ch = Math.min((h - gap * (g.rows - 1)) / g.rows, cw * 0.95);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, ${cw}px)`, gap, direction: v.dir }}>
                  {c.features.map((f, i) => (
                    <FeatureCard key={i} f={f} w={cw} h={ch} delay={0.15 + i * 0.12} />
                  ))}
                </div>
              );
            }
          }
        }}
      />
    );
  },
);

// ───────────────────────── process-steps
const StepsC = Heading.extend({ steps: z.array(Feature).min(2).max(5) });
type StC = z.infer<typeof StepsC>;
export const processSteps = defineScene<StC>(
  {
    id: 'process-steps',
    version: '1.0.0',
    category: 'infographic',
    title: 'Process steps',
    description: 'Numbered steps connected by a path; variants path / cards / numbered.',
    variants: ['path', 'cards', 'numbered'],
    defaultVariant: 'path',
    content: StepsC,
    defaultDuration: 4.6,
    minDuration: 3,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'slide'],
    sfx: [
      { at: 0.3, category: 'tick', weight: 0.4 },
      { at: 1.1, category: 'tick', weight: 0.35 },
      { at: 1.9, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['process', 'solution', 'demo'],
    energy: 0.5,
    example: { title: 'ثلاث خطوات وتبدأ', steps: [{ title: 'سجّل حسابك', icon: 'UserPlus' }, { title: 'أضف منتجاتك', icon: 'PackagePlus' }, { title: 'ابدأ البيع', icon: 'Rocket' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const n = c.steps.length;
    const per = Math.max(0.35, (holdSec - 0.6) / n);
    const L = useLabel();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const horizontal = w > h * 1.1 && variant !== 'numbered';
          if (variant === 'cards' || (variant === 'path' && horizontal)) {
            const gap = u * (variant === 'path' ? 5 : 2.4);
            const cw = horizontal ? (w - gap * (n - 1)) / n : Math.min(w, u * 90);
            const tall = !horizontal && v.canvas.orientation === 'portrait' && n <= 4; // few steps on a tall canvas: bigger cards and type
            const ch = horizontal ? Math.min(h * 0.8, cw * 1.25) : Math.min(u * (tall ? 21 : 16), (h - gap * (n - 1)) / n);
            return (
              <div style={{ position: 'relative', display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap, direction: v.dir }}>
                {c.steps.map((st, i) => {
                  const p = progress(m, 0.2 + i * per, 0.6, 'elastic');
                  return (
                    <div key={i} style={{ position: 'relative', opacity: clamp(p * 2), transform: `scale(${0.85 + 0.15 * p})` }}>
                      <Surface style={{ width: cw, height: ch, padding: u * 2.4, display: 'flex', flexDirection: horizontal ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: u * 2 }}>
                        <div style={{ width: u * 8, height: u * 8, borderRadius: 99, background: t.palette.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 3.8, color: t.palette.textOnPrimary }}>{i + 1}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: horizontal ? 'center' : 'flex-start', gap: u * 0.6 }}>
                          <Text text={st.title} role="label" size={tall ? 5.6 : 4.4} minSize={2.6} weight={700} animate="none" align={horizontal ? 'center' : 'start'} maxLines={2} maxWidth={horizontal ? cw - u * 4.8 : cw - u * 15} color={t.palette.textOnSurface} />
                          {st.text ? <Text text={st.text} role="body" size={3} animate="none" align={horizontal ? 'center' : 'start'} maxLines={3} maxWidth={horizontal ? cw - u * 4.8 : cw - u * 15} color={t.palette.textSecondary} /> : null}
                        </div>
                      </Surface>
                      {variant === 'path' && i < n - 1 ? (
                        <div style={{ position: 'absolute', top: '50%', [v.dir === 'rtl' ? 'left' : 'right']: -gap, width: gap, height: u * 0.5, marginTop: -u * 0.25, background: `linear-gradient(90deg, ${t.palette.primary}, ${t.palette.accent})`, transform: `scaleX(${progress(m, 0.2 + i * per + 0.4, 0.4)})`, transformOrigin: v.dir === 'rtl' ? 'right' : 'left' }} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          }
          // vertical path / numbered
          const rowH = Math.min(u * 20, h / n);
          const W = Math.min(w, u * 90);
          const lineP = progress(m, 0.2, per * n, 'smooth');
          const side = v.dir === 'rtl' ? 'right' : 'left';
          return (
            <div style={{ position: 'relative', width: W, height: rowH * n }}>
              <div style={{ position: 'absolute', [side]: u * 4.6, top: rowH * 0.25, width: u * 0.5, height: rowH * (n - 1) * lineP, background: alpha(t.palette.primary, 0.7) }} />
              {c.steps.map((st, i) => {
                const p = progress(m, 0.2 + i * per, 0.6, 'elastic');
                return (
                  <div key={i} style={{ position: 'absolute', top: i * rowH, left: 0, right: 0, display: 'flex', alignItems: 'flex-start', gap: u * 3, opacity: clamp(p * 2) }}>
                    <div data-qc="box" style={{ width: u * 9.6, height: u * 9.6, borderRadius: variant === 'numbered' ? u * 2 : 99, background: t.palette.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${p})`, flexShrink: 0, boxShadow: `0 0 0 ${u}px ${alpha(t.palette.primary, 0.2)}` }}>
                      {variant === 'numbered' || !st.icon ? <span style={{ fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 4.4, color: t.palette.textOnPrimary }}>{i + 1}</span> : <Icon name={st.icon} size={u * 4.6} color={t.palette.textOnPrimary} treatment="plain" />}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u * 0.4, paddingTop: u * 0.6 }}>
                      <Text text={`${L('step')} ${i + 1}`} role="eyebrow" animate="none" align="start" color={v.hl} maxLines={1} />
                      <Text text={st.title} role="title" size={5.2} minSize={3} animate="none" align="start" maxLines={2} maxWidth={W - u * 13} />
                      {st.text ? <Text text={st.text} role="body" size={3.2} animate="none" align="start" maxLines={2} maxWidth={W - u * 13} color={t.palette.textSecondary} /> : null}
                    </div>
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

// ───────────────────────── icon-list
const IconListC = Heading.extend({ items: z.array(z.object({ text: z.string().min(1).max(70), icon: z.string().optional() })).min(2).max(6) });
type ILC = z.infer<typeof IconListC>;
export const iconList = defineScene<ILC>(
  {
    id: 'icon-list',
    version: '1.0.0',
    category: 'infographic',
    title: 'Icon list',
    description: 'Checklist of short benefits; variants checklist / bullets / chips.',
    variants: ['checklist', 'bullets', 'chips'],
    defaultVariant: 'checklist',
    content: IconListC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'crossfade', 'wipe'],
    sfx: [
      { at: 0.3, category: 'tick', weight: 0.4 },
      { at: 0.6, category: 'tick', weight: 0.35 },
      { at: 0.9, category: 'tick', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['feature', 'solution', 'offer'],
    energy: 0.45,
    example: { title: 'ليش تختارنا؟', items: [{ text: 'بدون عمولة على المبيعات' }, { text: 'تصميم يناسب هويتك' }, { text: 'إطلاق خلال أسبوعين' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          if (variant === 'chips') {
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: u * 1.8, maxWidth: w, direction: v.dir }}>
                {c.items.map((it, i) => {
                  const p = progress(m, 0.2 + i * 0.12, 0.5, 'elastic');
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.2, padding: `${u * 1.4}px ${u * 3}px`, borderRadius: 99, background: i % 2 ? alpha(t.palette.primary, 0.15) : t.palette.primary, transform: `scale(${p})`, border: `1px solid ${alpha(t.palette.primary, 0.5)}` }}>
                      <Icon name={it.icon ?? 'Check'} size={u * 3.6} color={i % 2 ? t.palette.primary : t.palette.textOnPrimary} treatment="plain" stroke={2.6} />
                      <Text text={it.text} role="label" size={3.8} animate="none" maxLines={1} maxWidth={w * 0.8} color={i % 2 ? t.palette.textPrimary : t.palette.textOnPrimary} />
                    </div>
                  );
                })}
              </div>
            );
          }
          const n = c.items.length;
          const W = Math.min(w, u * 95);
          const rowGap = Math.min(u * 3, h / n / 3);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, width: W }}>
              {c.items.map((it, i) => {
                const p = progress(m, 0.25 + i * 0.28, 0.5);
                const check = progress(m, 0.35 + i * 0.28, 0.4, 'elastic');
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 2.4, opacity: p, transform: `translateX(${(1 - p) * u * 6 * (v.dir === 'rtl' ? 1 : -1)}px)` }}>
                    {variant === 'checklist' ? (
                      <div style={{ width: u * 6.4, height: u * 6.4, borderRadius: u * 1.6, background: t.palette.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transform: `scale(${check})` }}>
                        <Icon name={it.icon ?? 'Check'} size={u * 3.8} color={t.palette.textOnPrimary} treatment="plain" stroke={3} />
                      </div>
                    ) : (
                      <div style={{ width: u * 2.2, height: u * 2.2, borderRadius: 99, background: t.palette.primary, flexShrink: 0, transform: `scale(${check})` }} />
                    )}
                    <Text text={it.text} role="subtitle" size={4.8} minSize={3} animate="none" align="start" maxLines={2} maxWidth={W - u * 10} color={t.palette.textPrimary} />
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

// ───────────────────────── pros-cons
const ProsConsC = Heading.extend({ prosTitle: z.string().max(30).optional(), consTitle: z.string().max(30).optional(), pros: z.array(z.string().max(60)).min(1).max(5), cons: z.array(z.string().max(60)).min(1).max(5) });
type PCC = z.infer<typeof ProsConsC>;
export const prosCons = defineScene<PCC>(
  {
    id: 'pros-cons',
    version: '1.0.0',
    category: 'infographic',
    title: 'Pros & cons',
    description: 'Two columns of pros and cons (or old way vs new way); variants columns / cards.',
    variants: ['columns', 'cards'],
    defaultVariant: 'columns',
    content: ProsConsC,
    defaultDuration: 4.6,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'wipe'],
    sfx: [
      { at: 0.3, category: 'glitch', weight: 0.3, volume: 0.4 },
      { at: 1.3, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['comparison', 'problem', 'solution'],
    energy: 0.45,
    example: { title: 'الطريقة القديمة والجديدة', consTitle: 'الطريقة القديمة', prosTitle: 'مع منصتنا', cons: ['طلبات ضايعة', 'متابعة يدوية'], pros: ['كل الطلبات بمكان واحد', 'تنبيهات فورية'] },
    editable: ['eyebrow', 'title', 'subtitle', 'prosTitle', 'consTitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const L = useLabel();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const landscape = w > h;
          const colW = landscape ? (w - u * 3) / 2 : Math.min(w, u * 95);
          const col = (title: string, items: string[], good: boolean, delay: number) => (
            <Surface tone={variant === 'cards' && good ? 'primary' : 'surface'} style={{ width: colW, padding: u * 3, display: 'flex', flexDirection: 'column', gap: u * 1.6, opacity: good ? 1 : 0.88 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.4 }}>
                <Icon name={good ? 'CircleCheck' : 'CircleX'} size={u * 4.6} color={variant === 'cards' && good ? t.palette.textOnPrimary : good ? t.palette.positive : t.palette.negative} treatment="plain" />
                <Text text={title} role="title" size={5} minSize={3} animate="none" align="start" maxLines={1} maxWidth={colW - u * 13} color={variant === 'cards' && good ? t.palette.textOnPrimary : t.palette.textOnSurface} />
              </div>
              {items.map((it, i) => {
                const p = progress(m, delay + i * 0.2, 0.5);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.4, opacity: p, transform: `translateY(${(1 - p) * u * 2}px)` }}>
                    <div style={{ width: u * 1.4, height: u * 1.4, borderRadius: 99, flexShrink: 0, background: variant === 'cards' && good ? t.palette.textOnPrimary : good ? t.palette.positive : t.palette.negative }} />
                    <Text text={it} role="body" size={3.8} minSize={2.5} animate="none" align="start" maxLines={2} maxWidth={colW - u * 10} color={variant === 'cards' && good ? t.palette.textOnPrimary : t.palette.textOnSurface} />
                  </div>
                );
              })}
            </Surface>
          );
          return (
            <div style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', gap: u * 3, direction: v.dir, alignItems: 'stretch' }}>
              <Reveal delay={0.1}>{col(c.consTitle ?? L('cons'), c.cons, false, 0.3)}</Reveal>
              <Reveal delay={0.7} family="scale">{col(c.prosTitle ?? L('pros'), c.pros, true, 0.9)}</Reveal>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── problem-solution
const PSC = z.object({ eyebrow: HeadingFields.eyebrow, problem: z.string().min(1).max(120), solution: z.string().min(1).max(120), problemIcon: z.string().optional(), solutionIcon: z.string().optional(), highlight: HeadingFields.highlight });
type PSCT = z.infer<typeof PSC>;
export const problemSolution = defineScene<PSCT>(
  {
    id: 'problem-solution',
    version: '1.0.0',
    category: 'infographic',
    title: 'Problem → solution',
    description: 'States the pain then flips to the solution in one scene; variants flip / split / strike.',
    variants: ['flip', 'split', 'strike'],
    defaultVariant: 'strike',
    content: PSC,
    defaultDuration: 4,
    minDuration: 2.8,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'color-sweep', 'wipe'],
    sfx: [
      { at: 0.2, category: 'glitch', weight: 0.3, volume: 0.4 },
      { at: 1.6, category: 'whoosh', weight: 0.45 },
      { at: 1.9, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['problem', 'solution', 'hook'],
    energy: 0.6,
    textCapacity: { flip: 110, split: 160, strike: 100 },
    example: { problem: 'تضيع طلبات عملائك بين الواتساب والإيميل؟', solution: 'لوحة واحدة تجمع كل طلباتك', highlight: ['لوحة واحدة'] },
    editable: ['eyebrow', 'problem', 'solution'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const safe = v.canvas.safe;
    const L = useLabel();
    const flipAt = Math.max(1.1, holdSec * 0.45);
    const f = progress(m, flipAt, 0.6, 'smooth');
    const W = safe.width;
    if (variant === 'split') {
      const landscape = v.canvas.orientation === 'landscape';
      const colW = landscape ? (W - u * 4) / 2 : W;
      const block = (label: string, text: string, icon: string, good: boolean, delay: number) => (
        <Reveal delay={delay} family={good ? 'scale' : 'fade'}>
          <Surface tone={good ? 'primary' : 'surface'} style={{ width: colW, padding: u * 3.4, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u * 1.8, opacity: good ? 1 : 0.85 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.4 }}>
              <Icon name={icon} size={u * 4.4} color={good ? t.palette.textOnPrimary : t.palette.negative} treatment="plain" />
              <Text text={label} role="eyebrow" animate="none" align="start" color={good ? t.palette.textOnPrimary : t.palette.textSecondary} maxLines={1} />
            </div>
            <Text text={text} highlight={good ? c.highlight : undefined} role="title" size={6} minSize={3.4} animate={good ? 'words' : 'none'} delay={delay + 0.2} align="start" maxLines={4} maxWidth={colW - u * 6.8} color={good ? t.palette.textOnPrimary : t.palette.textOnSurface} hlColor={good ? t.palette.textOnPrimary : undefined} />
          </Surface>
        </Reveal>
      );
      return (
        <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: W, height: safe.height, display: 'flex', flexDirection: landscape ? 'row' : 'column', gap: u * 4, alignItems: 'center', justifyContent: 'center', direction: v.dir }}>
          {block(L('problem'), c.problem, c.problemIcon ?? 'CircleAlert', false, 0.1)}
          {block(L('solution'), c.solution, c.solutionIcon ?? 'Sparkles', true, flipAt * 0.8)}
        </div>
      );
    }
    if (variant === 'flip') {
      return (
        <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: W, height: safe.height, display: 'flex', alignItems: 'center', justifyContent: 'center', perspective: u * 200 }}>
          <div style={{ transform: `rotateX(${f * 180}deg)`, transformStyle: 'preserve-3d', position: 'relative' }}>
            <div style={{ transform: f > 0.5 ? 'rotateX(180deg)' : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2.4 }}>
              <Icon name={f > 0.5 ? c.solutionIcon ?? 'Sparkles' : c.problemIcon ?? 'CircleAlert'} size={u * 7} treatment="badge" color={f > 0.5 ? t.palette.primary : t.palette.negative} />
              <Text text={f > 0.5 ? L('solution') : L('problem')} role="eyebrow" animate="none" color={t.palette.textSecondary} />
              <Text text={f > 0.5 ? c.solution : c.problem} highlight={f > 0.5 ? c.highlight : undefined} role="headline" size={8} maxLines={4} maxWidth={W} animate={f > 0.5 ? 'none' : 'words'} delay={0.1} qcId={f > 0.5 ? 'ps-solution' : 'ps-problem'} />
            </div>
          </div>
        </div>
      );
    }
    // strike: problem text, a line crosses it, solution rises beneath
    const strike = progress(m, flipAt - 0.4, 0.5, 'smooth');
    return (
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: W, height: safe.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 4 }}>
        {c.eyebrow ? <Text text={c.eyebrow} role="eyebrow" animate="none" /> : null}
        <div style={{ position: 'relative', opacity: 1 - 0.55 * f, transform: `scale(${1 - 0.12 * f}) translateY(${-f * u * 2}px)` }}>
          <Text text={c.problem} role="title" size={7} maxLines={3} maxWidth={W} delay={0.1} color={t.palette.textPrimary} qcId="ps-problem" />
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: u * 0.8, background: t.palette.negative, transform: `scaleX(${strike}) rotate(-2deg)`, transformOrigin: v.dir === 'rtl' ? 'right' : 'left', borderRadius: 99 }} />
        </div>
        <div style={{ opacity: f, transform: `translateY(${(1 - f) * u * 6}px)` }}>
          <Surface tone="primary" style={{ padding: `${u * 2.6}px ${u * 4}px`, display: 'flex', alignItems: 'center', gap: u * 2 }}>
            <Icon name={c.solutionIcon ?? 'Sparkles'} size={u * 5} color={t.palette.textOnPrimary} treatment="plain" />
            <Text text={c.solution} role="title" size={6.4} minSize={3.6} maxLines={3} maxWidth={W - u * 16} animate="none" color={t.palette.textOnPrimary} qcId="ps-solution" />
          </Surface>
        </div>
      </div>
    );
  },
);
