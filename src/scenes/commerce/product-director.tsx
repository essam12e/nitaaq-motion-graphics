/**
 * E-commerce Product Director families + Launch / Hype Director families.
 *
 *  product-hero    — the hero shot: drop-land (heavy landing + contact shadow),
 *                    rim-light (slow push + rim light sweep), dark-reveal (found by light)
 *  product-detail  — detail beats on the SAME product image: macro (uniform zoom
 *                    into a declared point — a crop of the real photo, never a
 *                    generated close-up), callouts (pointer lines only to points
 *                    the user declared), specs (a clean spec rail beside the product)
 *  tease-reveal    — launch tease → reveal: slit (light slit opens on the product
 *                    or logo), countdown (3·2·1 then the reveal word), word-tease
 *                    (tease lines, then the name lands)
 *  feature-montage — fast montage of features: flash (one big word per beat) /
 *                    rail (features stream past the product)
 *
 * Product pixels are never altered: motion moves, scales uniformly, lights
 * around, or crops by zoom; the image keeps object-fit: contain.
 */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, overshoot, float } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { toNumerals } from '../../typography/arabic';
import type { MotionEventDecl } from '../../audio/events';

const Pt = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

// ───────────────────────── product-hero
const HeroC = z.object({
  image: z.string().min(1),
  name: z.string().max(60).optional(),
  title: z.string().max(120).optional(),
  highlight: z.array(z.string()).optional(),
  price: z.string().max(24).optional(),
});
type HC = z.infer<typeof HeroC>;

function ProductHeroScene({ content: c, variant }: { content: HC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const ar = useAspect(c.image, 0.8);
  const box = fitBox(ar, L.safe.width * (L.orientation === 'landscape' ? 0.42 : 0.72), L.safe.height * (c.title ? 0.46 : 0.58));
  let tf = '';
  let op = 1;
  let shadowK = 1;
  let deco: React.ReactNode = null;
  if (variant === 'drop-land') {
    const k = overshoot(m, 0.05, 120);
    const y = (1 - k) * -L.safe.height * 0.45;
    tf = `translateY(${y}px)`;
    op = clamp(k * 4);
    shadowK = clamp(k);
  } else if (variant === 'dark-reveal') {
    const k = progress(m, 0, 1.5, 'cinematic');
    op = k;
    tf = `scale(${1.04 - 0.04 * k})`;
    deco = <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(${L.isTall ? '60% 35%' : '35% 55%'} at 50% 48%, ${alpha(t.palette.textPrimary, 0.13 * k)}, transparent 70%)` }} />;
  } else {
    // rim-light: slow push, light band sweeps across the frame behind/around the product
    const k = progress(m, 0, 0.9, 'smooth');
    op = k;
    tf = `scale(${1 + (s / durSec) * 0.05})`;
  }
  const lift = variant === 'drop-land' ? 0 : float(m.frame, m.fps, 0.4, 4) + 0.4;
  const sweep = variant === 'rim-light' ? clamp((s - 0.4) / 1.6) : 0;
  return (
    <>
      {deco}
      <Stage gap={u * 3}>
        {c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={7} delay={variant === 'drop-land' ? 0.45 : 0.2} /> : null}
        <div style={{ position: 'relative', width: box.width, height: box.height }}>
          <div style={{ position: 'absolute', left: '12%', right: '12%', bottom: -box.height * 0.04, height: box.height * 0.06, borderRadius: '50%', background: 'rgba(0,0,0,0.4)', filter: `blur(${box.height * 0.02}px)`, opacity: shadowK * (1 - lift * 0.3) }} />
          {sweep > 0 && sweep < 1 ? <div style={{ position: 'absolute', inset: `-10% -30%`, background: `linear-gradient(100deg, transparent ${sweep * 140 - 35}%, ${alpha(t.palette.primary, 0.35)} ${sweep * 140 - 15}%, transparent ${sweep * 140 + 5}%)` }} /> : null}
          <div style={{ position: 'relative', transform: `${tf} translateY(${-lift * box.height * 0.03}px)`, opacity: op }}>
            <Media src={c.image} role="product" width={box.width} height={box.height} fit="contain" shadow />
          </div>
        </div>
        {c.name ? <Text text={c.name} role="subtitle" delay={0.8} maxLines={2} /> : null}
        {c.price ? <Text text={c.price} role="label" size={4.6} delay={1.1} color={t.palette.accent} maxLines={1} critical /> : null}
      </Stage>
    </>
  );
}

export const productHero = defineScene<HC>(
  {
    id: 'product-hero',
    version: '1.0.0',
    category: 'commerce',
    title: 'Product hero shot',
    description: "Hero shot of the user's real product (pixels never altered); variants drop-land / rim-light / dark-reveal.",
    variants: ['drop-land', 'rim-light', 'dark-reveal'],
    defaultVariant: 'rim-light',
    content: HeroC,
    defaultDuration: 3.4,
    minDuration: 2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['camera-push', 'light-sweep', 'cut'],
    sfx: [{ at: 0.3, category: 'impact', weight: 0.6 }],
    safeArea: 'normal',
    beats: ['product', 'reveal', 'hook'],
    energy: 0.75,
    requiresAssets: ['product'],
    example: { image: 'lib:demo/product.png', name: 'عطر العود الملكي', title: 'حضور لا يُنسى', price: '249 ر.س' },
    editable: ['title', 'name', 'price'],
    events: (_c, v) =>
      v === 'drop-land'
        ? [{ type: 'product_entry', at: 0.05, area: 0.25, direction: 'down' }, { type: 'product_land', at: 0.05, area: 0.25, anchor: 'contact', importance: 0.9 }]
        : v === 'dark-reveal'
          ? [{ type: 'hero_reveal', at: 0, area: 0.25, anchor: 'settle' }]
          : [{ type: 'product_entry', at: 0, area: 0.25 }, { type: 'camera_move', at: 0.4, importance: 0.3 }],
    module: 'product-commercial',
  },
  ProductHeroScene,
);

// ───────────────────────── product-detail
const DetailC = z.object({
  image: z.string().min(1),
  title: z.string().max(100).optional(),
  details: z
    .array(z.object({ label: z.string().min(1).max(40), value: z.string().max(30).optional(), at: Pt.optional() }))
    .min(1)
    .max(5),
});
type DC = z.infer<typeof DetailC>;

function ProductDetailScene({ content: c, variant }: { content: DC; variant: string }) {
  const L = useLayout();
  const { tokens: t, spec } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const ar = useAspect(c.image, 0.8);
  const land = L.orientation === 'landscape';
  const box = fitBox(ar, L.safe.width * (land ? 0.44 : 0.7), L.safe.height * (land ? 0.7 : 0.46));
  const n = c.details.length;
  if (variant === 'macro') {
    // one declared point at a time: uniform zoom into it (a crop of the real photo)
    const pts = c.details.map((d, i) => d.at ?? { x: 0.5, y: 0.3 + (0.4 * i) / Math.max(1, n - 1) });
    const per = durSec / n;
    const i = Math.min(n - 1, Math.floor(s / per));
    const local = s - i * per;
    const k = progress({ ...m, frame: Math.round(local * m.fps) }, 0, Math.min(0.9, per * 0.5), 'smooth');
    const z = 1 + 1.4 * k;
    const p = pts[i];
    const fw = Math.min(L.safe.width * 0.9, box.width * 1.25);
    const fh = Math.min(L.safe.height * 0.6, box.height * 1.1);
    return (
      <Stage gap={u * 3}>
        {c.title ? <Text text={c.title} role="title" size={6} /> : null}
        <div style={{ position: 'relative', width: fw, height: fh, overflow: 'hidden', borderRadius: u * 2, background: alpha(t.palette.surface, 0.4) }}>
          <div style={{ position: 'absolute', left: (fw - box.width) / 2, top: (fh - box.height) / 2, transformOrigin: `${p.x * box.width}px ${p.y * box.height}px`, transform: `scale(${z})` }}>
            <Media src={c.image} role="product" width={box.width} height={box.height} fit="contain" />
          </div>
        </div>
        <div key={i} style={{ display: 'flex', gap: u * 2, alignItems: 'baseline' }}>
          <Text text={c.details[i].label} role="title" size={5.6} motion="mask-reveal" maxLines={1} />
          {c.details[i].value ? <Text text={toNumerals(c.details[i].value!, spec.project.numerals)} role="label" size={4.6} color={t.palette.accent} maxLines={1} /> : null}
        </div>
      </Stage>
    );
  }
  if (variant === 'callouts') {
    const rtl = true;
    return (
      <Stage gap={u * 2}>
        {c.title ? <Text text={c.title} role="title" size={6} /> : null}
        <div style={{ position: 'relative', width: box.width, height: box.height, margin: `0 ${u * 16}px` }}>
          <Media src={c.image} role="product" width={box.width} height={box.height} fit="contain" shadow />
          {c.details.map((d, i) => {
            const k = progress(m, 0.5 + i * 0.35, 0.6, 'smooth');
            const side = (i % 2 === 0) === rtl ? 1 : -1;
            const anchor = d.at;
            const ly = anchor ? anchor.y * box.height : ((i + 0.5) / n) * box.height;
            const lx = side > 0 ? box.width + u * 3 : -u * 3;
            return (
              <React.Fragment key={i}>
                {anchor ? (
                  <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width={box.width} height={box.height}>
                    <circle cx={anchor.x * box.width} cy={anchor.y * box.height} r={u * 0.8 * k} fill={t.palette.accent} />
                    <line x1={anchor.x * box.width} y1={anchor.y * box.height} x2={anchor.x * box.width + (lx - anchor.x * box.width) * k} y2={ly} stroke={t.palette.accent} strokeWidth={Math.max(2, u * 0.25)} />
                  </svg>
                ) : null}
                <div style={{ position: 'absolute', top: ly, [side > 0 ? 'left' : 'right']: box.width + u * 4, transform: 'translateY(-50%)', opacity: k, width: u * 22 }}>
                  <Text text={d.label} role="label" size={3.6} animate="none" align={side > 0 ? 'start' : 'end'} maxLines={2} />
                  {d.value ? <Text text={toNumerals(d.value, spec.project.numerals)} role="label" size={3.2} animate="none" color={t.palette.accent} align={side > 0 ? 'start' : 'end'} maxLines={1} /> : null}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </Stage>
    );
  }
  // specs rail
  return (
    <Stage direction={land ? 'row' : 'column'} gap={u * 4}>
      <div style={{ transform: `scale(${0.94 + 0.06 * progress(m, 0, 0.8)})`, opacity: progress(m, 0, 0.5) }}>
        <Media src={c.image} role="product" width={box.width * (land ? 1 : 0.85)} height={box.height * (land ? 1 : 0.85)} fit="contain" shadow />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.6, minWidth: u * 30 }}>
        {c.title ? <Text text={c.title} role="title" size={5.4} align="start" /> : null}
        {c.details.map((d, i) => {
          const k = progress(m, 0.35 + i * 0.16, 0.5, 'smooth');
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: u * 3, padding: `${u * 1}px 0`, borderBottom: `${Math.max(1, u * 0.12)}px solid ${alpha(t.palette.textPrimary, 0.18 * k)}`, opacity: k, transform: `translateX(${(1 - k) * u * 3}px)` }}>
              <Text text={d.label} role="label" size={3.6} animate="none" maxLines={1} />
              {d.value ? <Text text={toNumerals(d.value, spec.project.numerals)} role="label" size={3.6} animate="none" color={t.palette.accent} maxLines={1} /> : null}
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

export const productDetail = defineScene<DC>(
  {
    id: 'product-detail',
    version: '1.0.0',
    category: 'commerce',
    title: 'Product details',
    description: 'Detail beats on the real product photo: macro (zoom into declared points), callouts (pointer lines only to declared points), specs (spec rail).',
    variants: ['macro', 'callouts', 'specs'],
    defaultVariant: 'specs',
    content: DetailC,
    defaultDuration: 4,
    minDuration: 2.4,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'push', 'match-cut'],
    sfx: [{ at: 0.4, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['detail', 'feature', 'product'],
    energy: 0.45,
    requiresAssets: ['product'],
    example: { image: 'lib:demo/product.png', title: 'تفاصيل الصنعة', details: [{ label: 'زجاج مصقول', value: '100 مل' }, { label: 'غطاء معدني' }, { label: 'ثبات 12 ساعة', value: '12h' }] },
    editable: ['title'],
    events: (c, v, dur) =>
      v === 'macro'
        ? c.details.map((_, i) => ({ type: 'camera_move' as const, at: (i * dur) / c.details.length, importance: 0.35 }))
        : c.details.map((_, i) => ({ type: (v === 'callouts' ? 'ui_appear' : 'card_entry') as MotionEventDecl['type'], at: (v === 'callouts' ? 0.5 + i * 0.35 : 0.35 + i * 0.16), importance: 0.3 })),
    module: 'product-commercial',
  },
  ProductDetailScene,
);

// ───────────────────────── tease-reveal
const TeaseC = z.object({
  tease: z.array(z.string().min(1).max(60)).max(3).optional(),
  reveal: z.string().min(1).max(60),
  image: z.string().optional(),
  date: z.string().max(40).optional(),
});
type TC = z.infer<typeof TeaseC>;

function TeaseReveal({ content: c, variant }: { content: TC; variant: string }) {
  const L = useLayout();
  const { tokens: t, spec } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const src = c.image ?? spec.brand?.logo;
  const ar = useAspect(src, 1);
  const box = fitBox(ar, L.safe.width * 0.6, L.safe.height * 0.36);
  const revealAt = Math.min(durSec * 0.55, variant === 'countdown' ? 1.6 : 1.1 + 0.5 * (c.tease?.length ?? 0));
  const before = s < revealAt;
  const rs = Math.max(0, s - revealAt);
  const rk = clamp(rs / 0.5);
  if (variant === 'slit') {
    const open = progress({ ...m, frame: Math.round(rs * m.fps) }, 0, 0.9, 'cinematic');
    const slitH = Math.max(2, u * 0.25) + open * L.H;
    return (
      <>
        <div style={{ position: 'absolute', left: 0, right: 0, top: L.H / 2 - slitH / 2, height: slitH, background: alpha(t.palette.surface, 0.5), boxShadow: `0 0 ${u * 6}px ${alpha(t.palette.primary, 0.6 * (1 - open))}`, opacity: s > 0.2 ? 1 : s * 5 }} />
        <Stage gap={u * 3}>
          {before && c.tease?.length ? <Text key={Math.floor(s / Math.max(0.4, revealAt / c.tease.length))} text={c.tease[Math.min(c.tease.length - 1, Math.floor(s / Math.max(0.4, revealAt / c.tease.length)))]} role="subtitle" motion="tracking-reveal" maxLines={2} /> : null}
          {!before ? (
            <>
              {src ? (
                <div style={{ clipPath: `inset(${(1 - open) * 50}% 0 ${(1 - open) * 50}% 0)` }}>
                  <Media src={src} role={c.image ? 'product' : 'logo'} width={box.width} height={box.height} fit="contain" />
                </div>
              ) : null}
              <Text text={c.reveal} role="headline" size={9} delay={0} motion="cinematic-title" maxLines={2} />
              {c.date ? <Text text={toNumerals(c.date, spec.project.numerals)} role="label" delay={0.5} color={t.palette.accent} maxLines={1} /> : null}
            </>
          ) : null}
        </Stage>
      </>
    );
  }
  if (variant === 'countdown') {
    const n = Math.max(0, 3 - Math.floor(s / (revealAt / 3)));
    const local = (s % (revealAt / 3)) / (revealAt / 3);
    return (
      <Stage gap={u * 3}>
        {before ? (
          <div key={n} style={{ transform: `scale(${1.25 - 0.25 * clamp(local * 3)})`, opacity: 1 - clamp((local - 0.75) * 4) }}>
            <Text text={toNumerals(String(n), spec.project.numerals)} role="headline" size={22} animate="none" maxLines={1} color={t.palette.primary} />
          </div>
        ) : (
          <>
            <div style={{ transform: `scale(${1.15 - 0.15 * overshoot({ ...m, frame: Math.round(rs * m.fps) }, 0)})` }}>
              <Text text={c.reveal} role="headline" size={10} motion="typography-punch" maxLines={2} />
            </div>
            {src ? <div style={{ opacity: rk }}><Media src={src} role={c.image ? 'product' : 'logo'} width={box.width * 0.7} height={box.height * 0.7} fit="contain" /></div> : null}
            {c.date ? <Text text={toNumerals(c.date, spec.project.numerals)} role="label" delay={0.4} color={t.palette.accent} maxLines={1} /> : null}
          </>
        )}
      </Stage>
    );
  }
  // word-tease
  const lines = c.tease?.length ? c.tease : [];
  const per = lines.length ? revealAt / lines.length : revealAt;
  const li = Math.min(lines.length - 1, Math.floor(s / per));
  return (
    <Stage gap={u * 3}>
      {before && lines.length ? <Text key={li} text={lines[li]} role="title" size={7} motion="blur-reveal" maxLines={2} /> : null}
      {!before ? (
        <>
          <Text text={c.reveal} role="headline" size={10} motion="scale-impact" maxLines={2} />
          {src ? <div style={{ opacity: rk, transform: `translateY(${(1 - rk) * u * 2}px)` }}><Media src={src} role={c.image ? 'product' : 'logo'} width={box.width * 0.8} height={box.height * 0.8} fit="contain" /></div> : null}
          {c.date ? <Text text={toNumerals(c.date, spec.project.numerals)} role="label" delay={0.4} color={t.palette.accent} maxLines={1} /> : null}
        </>
      ) : null}
    </Stage>
  );
}

const revealTime = (c: TC, v: string, dur: number) => Math.min(dur * 0.55, v === 'countdown' ? 1.6 : 1.1 + 0.5 * (c.tease?.length ?? 0));

export const teaseReveal = defineScene<TC>(
  {
    id: 'tease-reveal',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Tease → reveal',
    description: 'Launch tease that withholds, then reveals the name / product / logo: slit / countdown / word-tease.',
    variants: ['slit', 'countdown', 'word-tease'],
    defaultVariant: 'slit',
    content: TeaseC,
    defaultDuration: 3.6,
    minDuration: 2.4,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'color-dip', 'camera-push'],
    sfx: [
      { at: 0, category: 'riser', weight: 0.5 },
      { at: 1.4, category: 'impact', weight: 0.8 },
    ],
    safeArea: 'normal',
    beats: ['tease', 'reveal', 'hook'],
    energy: 0.85,
    example: { tease: ['شيء جديد', 'قريب جداً'], reveal: 'نطاق 2', date: '15 أكتوبر' },
    editable: ['tease', 'reveal', 'date'],
    events: (c, v, dur) => {
      const r = revealTime(c, v, dur);
      const ev: MotionEventDecl[] = [{ type: 'tease', at: 0, importance: 0.55 }];
      if (v === 'countdown') for (let i = 0; i < 3; i++) ev.push({ type: 'counter_tick', at: (i * r) / 3, importance: 0.45, anchor: 'start' });
      ev.push({ type: 'hero_reveal', at: Math.max(0, r - 0.02), importance: 0.98, anchor: 'start' });
      return ev;
    },
    module: 'launch-film',
  },
  TeaseReveal,
);

// ───────────────────────── feature-montage
const MontageC = z.object({
  features: z.array(z.string().min(1).max(40)).min(2).max(8),
  image: z.string().optional(),
  title: z.string().max(80).optional(),
});
type MC = z.infer<typeof MontageC>;

function FeatureMontage({ content: c, variant }: { content: MC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const n = c.features.length;
  const per = durSec / n;
  const i = Math.min(n - 1, Math.floor(s / per));
  const local = s - i * per;
  const ar = useAspect(c.image, 0.8);
  if (variant === 'flash') {
    const k = clamp(local / 0.14);
    const bgs = [t.palette.background, t.palette.primary, t.palette.surface];
    const bg = bgs[i % bgs.length];
    const fg = bg === t.palette.primary ? t.palette.textOnPrimary : t.palette.textPrimary;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: bg }} />
        <Stage>
          <div key={i} style={{ transform: `scale(${1.12 - 0.12 * (1 - Math.pow(1 - k, 3))})` }}>
            <Text text={c.features[i]} role="headline" size={9.5} animate="none" color={fg} maxLines={2} />
          </div>
        </Stage>
      </>
    );
  }
  // rail: product steady, features stream past in reading direction (right → left for RTL)
  const box = fitBox(ar, L.safe.width * 0.5, L.safe.height * 0.38);
  return (
    <Stage gap={u * 4}>
      {c.title ? <Text text={c.title} role="title" size={6} /> : null}
      {c.image ? <div style={{ transform: `scale(${1 + (s / durSec) * 0.06})` }}><Media src={c.image} role="product" width={box.width} height={box.height} fit="contain" shadow /></div> : null}
      <div style={{ position: 'relative', width: L.safe.width, height: u * 10, overflow: 'hidden' }}>
        {c.features.map((f, j) => {
          const x = (s - j * per) / per; // 0 → entering, 1 → leaving
          if (x < -0.1 || x > 1.2) return null;
          const k = clamp(x / 0.25);
          const out = clamp((x - 0.8) / 0.3);
          return (
            <div key={j} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateX(${(-(1 - k) + out) * -L.safe.width * 0.4}px)`, opacity: k * (1 - out) }}>
              <Text text={f} role="title" size={6.4} animate="none" color={j % 2 ? t.palette.accent : t.palette.textPrimary} maxLines={1} />
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

export const featureMontage = defineScene<MC>(
  {
    id: 'feature-montage',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Feature montage',
    description: 'Fast montage of features on the beat: flash (one big word per beat) / rail (features stream past the product).',
    variants: ['flash', 'rail'],
    defaultVariant: 'flash',
    content: MontageC,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'whip'],
    sfx: [{ at: 0, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['montage', 'feature'],
    energy: 0.9,
    example: { features: ['أسرع', 'أذكى', 'أخف', 'أجمل'] },
    editable: ['features', 'title'],
    events: (c, v, dur) => c.features.map((_, i) => ({ type: (v === 'flash' ? 'word_impact' : 'text_reveal') as MotionEventDecl['type'], at: (i * dur) / c.features.length, importance: v === 'flash' ? 0.6 : 0.35, anchor: 'start' as const })),
    module: 'launch-film',
  },
  FeatureMontage,
);
