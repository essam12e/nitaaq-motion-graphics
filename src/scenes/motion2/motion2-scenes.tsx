/**
 * Motion 2.0 scene families — built on the new engines:
 *
 *   product-depth   2.5D product hero: background / hero / foreground planes so a
 *                   camera move (Camera Engine 2.0) produces real parallax; the
 *                   product lands with a physical spring, never recoloured
 *   morph-story     one shape that BECOMES each idea (true path morph between
 *                   icons or shapes, not a crossfade) with a caption per stage
 *   kinetic-arabic  Arabic kinetic typography 2.0: joining-safe letter groups,
 *                   ink/fill sweeps, weight settle, kashida stretch on the key word
 *
 * All values are pure functions of the frame (deterministic seek).
 */
import React, { useMemo } from 'react';
import { z } from 'zod';
import { AbsoluteFill } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { DepthLayer } from '../../camera/CameraRig';
import { springAt } from '../../motion/spring';
import { staggerDelay } from '../../motion/orchestrate';
import { MorphShape, LiquidBlob, type MorphStage } from '../../morph/Morph';
import { iconPath, shapePath } from '../../morph/shapes';
import type { MotionEventDecl } from '../../audio/events';

// ── product-depth ────────────────────────────────────────────────────────────
const ProductDepthC = z.object({
  image: z.string(),
  name: z.string().max(60).optional(),
  title: z.string().max(90),
  highlight: z.array(z.string()).optional(),
  price: z.string().max(30).optional(),
});
type PD = z.infer<typeof ProductDepthC>;

function ProductDepth({ content: c, variant }: { content: PD; variant: string }) {
  const L = useLayout();
  // the price takes the highlight colour (contrast-checked against the background), not the raw accent
  const { tokens: t, hl } = useVideo();
  const { m, s } = useSceneTime();
  const u = L.u;
  const ar = useAspect(c.image, 1);
  const box = fitBox(ar, L.safe.width * (variant === 'side' ? 0.5 : 0.7), L.safe.height * (variant === 'side' ? 0.5 : 0.42));
  // physical landing: a damped spring from above, plus a settle in rotation (follow-through)
  const land = springAt(Math.max(0, s - 0.1), 0, 1, { stiffness: 140, damping: 14, mass: 1.2 });
  const y = (1 - land.value) * -u * 22;
  const tilt = (1 - land.value) * 4;
  const shadowK = clamp(land.value);
  const glow = progress(m, 0, 1.2, 'smooth');
  const product = (
    <div style={{ position: 'relative', width: box.width, height: box.height, transform: `translateY(${y}px) rotate(${tilt}deg)` }}>
      <Media src={c.image} role="product" width={box.width} height={box.height} fit="contain" />
    </div>
  );
  const shadow = <div style={{ width: box.width * 0.7, height: u * 2.2, margin: `${-u * 1.2}px auto 0`, borderRadius: '50%', background: `radial-gradient(closest-side, ${alpha('#000000', 0.45 * shadowK)}, transparent)`, transform: `scaleX(${0.6 + 0.4 * shadowK})` }} />;
  const words = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: variant === 'side' ? 'flex-start' : 'center', gap: u * 1.2, maxWidth: variant === 'side' ? L.safe.width * 0.46 : undefined }}>
      {c.name ? <Text text={c.name} role="eyebrow" delay={0.5} animate="block" align={variant === 'side' ? 'start' : 'center'} /> : null}
      <Text text={c.title} highlight={c.highlight} role="headline" size={8} delay={0.65} align={variant === 'side' ? 'start' : 'center'} maxWidth={variant === 'side' ? L.safe.width * 0.46 : undefined} />
      {c.price ? <Text text={c.price} role="number" size={7} delay={1.05} align={variant === 'side' ? 'start' : 'center'} color={hl} /> : null}
    </div>
  );
  return (
    <AbsoluteFill>
      {/* background plane: a large soft light form behind the product (moves less than the hero) */}
      <DepthLayer plane="background">
        <AbsoluteFill style={{ background: `radial-gradient(42% 30% at 50% ${variant === 'side' ? 45 : 38}%, ${alpha(t.palette.primary, 0.32 * glow)}, transparent 72%)` }} />
      </DepthLayer>
      <DepthLayer plane="hero">
        <Stage direction={variant === 'side' ? 'row' : 'column'} gap={u * 3} camera={false}>
          {variant === 'side' ? (
            <>
              <div>
                {product}
                {shadow}
              </div>
              {words}
            </>
          ) : (
            <>
              <div>
                {product}
                {shadow}
              </div>
              {words}
            </>
          )}
        </Stage>
      </DepthLayer>
      {/* foreground plane: a thin light streak at the frame edge, never over the product */}
      <DepthLayer plane="foreground">
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: -u * 6, top: '8%', width: u * 30, height: u * 0.5, borderRadius: 99, background: `linear-gradient(90deg, transparent, ${alpha(t.palette.textPrimary, 0.28 * glow)}, transparent)`, transform: 'rotate(-18deg)' }} />
        </AbsoluteFill>
      </DepthLayer>
    </AbsoluteFill>
  );
}

const productDepthEvents = (c: PD): MotionEventDecl[] => [
  { type: 'product_land', at: 0.42, element: 'product', importance: 0.9, anchor: 'contact' },
  { type: 'text_reveal', at: 0.65, importance: 0.4 },
  ...(c.price ? [{ type: 'price_reveal' as const, at: 1.05, importance: 0.6 }] : []),
];

export const productDepth = defineScene<PD>(
  {
    id: 'product-depth',
    version: '1.0.0',
    category: 'commerce',
    title: '2.5D product hero (depth planes)',
    description: 'The product lands with a physical spring on the hero plane, a light form sits on the background plane and a streak on the foreground plane: a camera move produces real parallax. The product is never recoloured or distorted.',
    variants: ['center', 'side'],
    defaultVariant: 'center',
    content: ProductDepthC,
    defaultDuration: 4,
    minDuration: 2.4,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    aspectVariants: { portrait: ['center'], landscape: ['side', 'center'], square: ['center'] },
    preferredTransitions: ['morph', 'zoom-through', 'camera-push', 'crossfade'],
    sfx: [{ at: 0.42, category: 'impact', weight: 0.7 }],
    safeArea: 'normal',
    beats: ['product', 'reveal', 'solution'],
    energy: 0.65,
    requiresAssets: ['image'],
    textCapacity: { center: 60, side: 70 },
    example: { image: 'lib:demo/product.png', name: 'مرطّب ندى', title: 'ترطيب يدوم طول اليوم', highlight: ['يدوم'], price: '89 ر.س' },
    editable: ['name', 'title', 'price'],
    cost: 'MEDIUM',
    motion: { elements: ['product', 'hero-title', 'camera'], jobs: ['hero-reveal', 'show-the-product'] },
    events: productDepthEvents,
  },
  ProductDepth,
);

// ── morph-story ──────────────────────────────────────────────────────────────
const MorphStoryC = z.object({
  title: z.string().max(80).optional(),
  stages: z
    .array(z.object({ icon: z.string().optional(), shape: z.string().optional(), label: z.string().max(40) }))
    .min(2)
    .max(5),
});
type MS = z.infer<typeof MorphStoryC>;

function MorphStory({ content: c, variant }: { content: MS; variant: string }) {
  const L = useLayout();
  const { tokens: t, hl } = useVideo();
  const { s, durSec } = useSceneTime();
  const u = L.u;
  const size = Math.min(L.safe.width * 0.62, L.safe.height * 0.36);
  const n = c.stages.length;
  const start = 0.35;
  const span = Math.max(0.9, (durSec - start - 0.6) / n);
  const icons = variant === 'icons';
  const stages: MorphStage[] = useMemo(
    () =>
      c.stages.map((st, i) => {
        const d = (icons ? (st.icon ? iconPath(st.icon) : null) : null) ?? shapePath(st.shape ?? ['circle', 'squircle', 'blob', 'hexagon', 'star'][i % 5], icons ? 24 : 100, `morph-story-${i}`);
        return { d, at: start + i * span, spring: { stiffness: 90, damping: 15, mass: 1 } };
      }),
    [c.stages, icons, span],
  );
  // the caption follows the shape: the old word holds until the morph starts, the new one rises in
  // while the body is still travelling (never an empty caption mid-morph)
  const idx = Math.max(0, Math.min(n - 1, Math.floor((s - start) / span)));
  const local = s - (start + idx * span);
  const enter = idx === 0 ? clamp(s / 0.4) : clamp(local / 0.3);
  return (
    <Stage gap={u * 3}>
      {c.title ? <Text text={c.title} role="title" size={6} delay={0.1} /> : null}
      <div style={{ position: 'relative', width: size, height: size }}>
        <MorphShape stages={stages} viewBox={icons ? '0 0 24 24' : '0 0 100 100'} style={{ width: size, height: size }} {...(icons ? { stroke: hl, strokeWidth: 1.6, fill: 'none' } : { gradient: [t.palette.primary, t.palette.accent] as [string, string] })} arc={icons ? 0 : 0.25} points={icons ? 128 : 96} />
      </div>
      <div style={{ position: 'relative', height: u * 9, width: L.safe.width * 0.9 }}>
        {c.stages.map((st, i) =>
          i === idx ? (
            <div key={i} style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'center', opacity: enter, transform: `translateY(${(1 - enter) * u * 1.5}px)` }}>
              <Text text={st.label} role="subtitle" size={5.2} animate="none" color={t.palette.textPrimary} />
            </div>
          ) : null,
        )}
      </div>
      {/* progress dots replaced by a hairline track (no dot patterns) */}
      <div style={{ width: L.safe.width * 0.4, height: Math.max(2, u * 0.25), background: alpha(t.palette.textPrimary, 0.15), borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${((idx + clamp(local / span)) / n) * 100}%`, height: '100%', background: hl, transformOrigin: 'right' }} />
      </div>
    </Stage>
  );
}

export const morphStory = defineScene<MS>(
  {
    id: 'morph-story',
    version: '1.0.0',
    category: 'illustration',
    title: 'Morph story (one shape becomes each idea)',
    description: 'A single body morphs (true path morph with sub-path matching and spring timing) from idea to idea — icons as line art or filled organic shapes — with one caption per stage.',
    variants: ['icons', 'shapes'],
    defaultVariant: 'icons',
    content: MorphStoryC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['morph', 'shape-match', 'crossfade'],
    sfx: [{ at: 0.35, category: 'whoosh', weight: 0.45 }],
    safeArea: 'normal',
    beats: ['solution', 'process', 'feature', 'demo', 'bridge'],
    energy: 0.5,
    textCapacity: { icons: 60, shapes: 60 },
    example: { title: 'من الفكرة للنتيجة', stages: [{ icon: 'lightbulb', label: 'فكرة' }, { icon: 'pencil-ruler', label: 'تصميم' }, { icon: 'rocket', label: 'إطلاق' }] },
    editable: ['title'],
    cost: 'LOW',
    motion: { elements: ['icon', 'hero-title'], jobs: ['connect-states', 'explain-the-idea'] },
    events: (c, _v, dur) => {
      const n = c.stages.length;
      const span = Math.max(0.9, (dur - 0.35 - 0.6) / n);
      return c.stages.slice(1).map((_, i) => ({ type: 'hero_reveal' as const, at: 0.35 + (i + 1) * span, importance: 0.45 }));
    },
  },
  MorphStory,
);

// ── kinetic-arabic ───────────────────────────────────────────────────────────
const KineticArabicC = z.object({
  lines: z.array(z.string().max(40)).min(1).max(3),
  highlight: z.array(z.string()).optional(),
  kicker: z.string().max(40).optional(),
});
type KA = z.infer<typeof KineticArabicC>;

const LINE_FAMILIES: Record<string, string[]> = {
  stack: ['ar-cluster-cascade', 'ar-fill-sweep', 'ar-weight-settle'],
  'hero-word': ['ar-kashida-stretch', 'ar-ink-sweep', 'ar-ink-sweep'],
  rise: ['ar-cluster-rise', 'ar-cluster-rise', 'ar-ink-sweep'],
};

function KineticArabic({ content: c, variant }: { content: KA; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { s } = useSceneTime();
  const u = L.u;
  const fams = LINE_FAMILIES[variant] ?? LINE_FAMILIES.stack;
  const n = c.lines.length;
  // a soft ink pool breathes behind the words (large form, never a pattern)
  return (
    <AbsoluteFill>
      <DepthLayer plane="background">
        <LiquidBlob cx={L.width / 2} cy={L.height * 0.48} r={Math.min(L.width, L.height) * 0.3} seed="kinetic-ar" color={alpha(t.palette.primary, 0.16)} speed={0.35} wobble={0.16} />
      </DepthLayer>
      <DepthLayer plane="hero">
        <Stage gap={u * 1.6} camera={false}>
          {c.kicker ? <Text text={c.kicker} role="eyebrow" animate="block" /> : null}
          {c.lines.map((line, i) => {
            const delay = 0.15 + staggerDelay(i, n, { each: 0.42, from: 'first' });
            const hero = variant === 'hero-word' ? i === 0 : i === 0;
            return <Text key={i} text={line} highlight={c.highlight} role={hero ? 'headline' : 'title'} size={hero ? (variant === 'hero-word' ? 15 : 11) : 7.5} maxLines={2} delay={delay} motion={fams[Math.min(i, fams.length - 1)]} />;
          })}
          <div style={{ width: L.safe.width * 0.22 * clamp((s - 0.4) / 0.6), height: Math.max(2, u * 0.3), background: t.palette.accent, borderRadius: 99, marginInlineStart: 'auto', marginInlineEnd: 'auto' }} />
        </Stage>
      </DepthLayer>
    </AbsoluteFill>
  );
}

export const kineticArabic = defineScene<KA>(
  {
    id: 'kinetic-arabic',
    version: '1.0.0',
    category: 'typography',
    title: 'Arabic kinetic typography 2.0',
    description: 'Arabic lines animated by joining-safe letter groups (split only where letters do not connect), ink/fill sweeps in reading direction, weight settle, and a kashida stretch on the key word. Never letter-spacing, never a broken join.',
    variants: ['stack', 'hero-word', 'rise'],
    defaultVariant: 'stack',
    content: KineticArabicC,
    defaultDuration: 3.4,
    minDuration: 2,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'mask-wipe', 'push', 'camera-match'],
    sfx: [{ at: 0.15, category: 'whoosh', weight: 0.4 }],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'tease', 'bridge', 'cta'],
    energy: 0.7,
    textCapacity: { stack: 70, 'hero-word': 40, rise: 70 },
    example: { kicker: 'نطاق', lines: ['الحركة لغة', 'تُقرأ قبل الكلمات'], highlight: ['الحركة'] },
    editable: ['kicker', 'lines'],
    cost: 'LOW',
    motion: { elements: ['hero-title', 'text'], jobs: ['stop-the-scroll', 'establish-hierarchy'] },
    events: (c) => c.lines.map((_, i) => ({ type: 'text_reveal' as const, at: 0.15 + i * 0.42, importance: i === 0 ? 0.6 : 0.35 })),
  },
  KineticArabic,
);
