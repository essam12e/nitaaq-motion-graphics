/** E-commerce families: product-showcase, product-grid, price-offer, shopping-cart, category-showcase. Product images are never altered. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime, Accents, Reveal, Button } from '../kit';
import { Stage, useLayout, gridShape } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { Cursor } from '../../components/Cursor';
import { clamp, progress, EASE, float, overshoot } from '../../motion/primitives';
import { alpha, bestTextOn, contrastRatio, ensureContrast } from '../../brand/color';
import { useLabel } from '../i18n';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);

/** Product image with pedestal glow + shadow. Motion affects framing only; pixels untouched. */
function ProductHero({ src, maxW, maxH, lift = 0, light = 0 }: { src: string; maxW: number; maxH: number; lift?: number; light?: number }) {
  const { tokens: t } = useVideo();
  const ar = useAspect(src, 0.8);
  const box = fitBox(ar, maxW, maxH);
  return (
    <div style={{ position: 'relative', width: box.width, height: box.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: box.width * 1.5, height: box.width * 1.5, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(t.palette.primary, 0.28)} 0%, transparent 62%)`, transform: `translateY(${box.height * 0.05}px)` }} />
      <div style={{ position: 'absolute', bottom: -box.height * 0.04, width: box.width * 0.75, height: box.height * 0.06, borderRadius: '50%', background: 'rgba(0,0,0,0.35)', filter: `blur(${box.height * 0.02}px)`, transform: `scaleX(${1 - lift * 0.15})`, opacity: 1 - lift * 0.3 }} />
      <div style={{ position: 'relative', transform: `translateY(${-lift * box.height * 0.04}px)` }}>
        <Media src={src} role="product" width={box.width} height={box.height} fit="contain" shadow />
        {light > 0 ? (
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(105deg, transparent ${light * 140 - 40}%, rgba(255,255,255,0.22) ${light * 140 - 20}%, transparent ${light * 140}%)`, mixBlendMode: 'screen', pointerEvents: 'none', WebkitMaskImage: undefined }} />
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────── product-showcase
const ProductC = Heading.extend({
  image: z.string().min(1),
  name: z.string().max(60).optional(),
  price: z.string().max(24).optional(),
  features: z.array(z.string().max(30)).max(4).optional(),
});
type PC = z.infer<typeof ProductC>;
export const productShowcase = defineScene<PC>(
  {
    id: 'product-showcase',
    version: '1.0.0',
    category: 'commerce',
    title: 'Product showcase',
    description: "The user's real product with light, framing and callouts (image never changed); variants hero / spotlight / split / orbit.",
    variants: ['hero', 'spotlight', 'split', 'orbit'],
    defaultVariant: 'hero',
    content: ProductC,
    defaultDuration: 3.8,
    minDuration: 2.2,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'light-sweep', 'push'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.55 },
      { at: 0.6, category: 'sweep', weight: 0.35 },
      { at: 1.2, category: 'pop', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['product', 'hook', 'offer', 'feature'],
    energy: 0.6,
    requiresAssets: ['product'],
    example: { image: 'lib:demo/product.png', name: 'عطر العود الملكي', price: '249 ر.س', features: ['ثبات عالي', 'مكونات طبيعية', 'تغليف فاخر'] },
    editable: ['eyebrow', 'title', 'subtitle', 'name', 'price'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const v = useVideo();
    const { m, s, durSec } = useSceneTime();
    const u = L.u;
    const enter = progress(m, 0.05, 1, 'cinematic');
    const lift = float(m.frame, m.fps, (m.floatK ?? 1) * 0.5, 4) + 0.5;
    const light = variant === 'spotlight' || variant === 'hero' ? clamp((s - 0.5) / 1.4) : 0;
    const info = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: L.orientation === 'landscape' ? 'flex-start' : 'center', gap: u * 1.6 }}>
        {c.name ? <Text text={c.name} role="title" size={6.4} delay={0.5} align={L.orientation === 'landscape' ? 'start' : 'center'} maxLines={2} /> : null}
        {c.price ? (
          <Reveal delay={0.9} family="pop">
            <div style={{ padding: `${u * 1}px ${u * 3}px`, borderRadius: 999, background: v.tokens.palette.primary }}>
              <Text text={c.price} role="label" size={4.4} color={v.tokens.palette.textOnPrimary} animate="none" critical maxLines={1} />
            </div>
          </Reveal>
        ) : null}
      </div>
    );
    if (variant === 'orbit' && c.features?.length) {
      const R = Math.min(L.safe.width, L.safe.height) * 0.36;
      const img = Math.min(L.safe.width * 0.5, L.safe.height * 0.42);
      return (
        <Stage>
          {c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={6.5} /> : null}
          <div style={{ position: 'relative', width: R * 2.4, height: R * 2.2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ transform: `scale(${0.85 + 0.15 * enter})`, opacity: enter }}>
              <ProductHero src={c.image} maxW={img} maxH={img} lift={lift} />
            </div>
            {c.features.map((f, i) => {
              const a = -Math.PI / 2 + (i / c.features!.length) * Math.PI * 2 + s * 0.12;
              const p = progress(m, 0.7 + i * 0.18, 0.6, 'elastic');
              return (
                <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -50%) translate(${Math.cos(a) * R * 1.05}px, ${Math.sin(a) * R * 0.9}px) scale(${p})` }}>
                  <Surface style={{ padding: `${u * 1.2}px ${u * 2.4}px`, borderRadius: 999, whiteSpace: 'nowrap' }}>
                    <Text text={f} role="label" size={3.4} animate="none" color={v.tokens.palette.textOnSurface} maxLines={1} />
                  </Surface>
                </div>
              );
            })}
          </div>
          {info}
        </Stage>
      );
    }
    return (
      <>
        {variant === 'spotlight' ? <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(${L.isTall ? '70% 40%' : '45% 60%'} at 50% ${L.isTall ? 48 : 50}%, ${alpha(v.tokens.palette.textPrimary, 0.1 * enter)}, transparent 70%)` }} /> : null}
        <HeroSplit
          heading={variant === 'split' ? heading(c) : undefined}
          visual={(w, h) => {
            const imgH = variant === 'split' ? h * 0.7 : h * (c.title ? 0.5 : 0.62);
            const scale = variant === 'hero' ? 1.12 - 0.12 * EASE.smooth(enter) + (s / durSec) * 0.03 : 0.9 + 0.1 * enter;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 3, width: w }}>
                {variant !== 'split' && c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={7} /> : null}
                <div style={{ transform: `scale(${scale})`, opacity: clamp(enter * 1.4) }}>
                  <ProductHero src={c.image} maxW={w * 0.8} maxH={imgH} lift={lift} light={light} />
                </div>
                {info}
              </div>
            );
          }}
        />
      </>
    );
  },
);

// ───────────────────────── product-grid
const GridC = Heading.extend({ products: z.array(z.object({ image: z.string().optional(), name: z.string().max(40), price: z.string().max(20).optional() })).min(2).max(6) });
type GC = z.infer<typeof GridC>;
export const productGrid = defineScene<GC>(
  {
    id: 'product-grid',
    version: '1.0.0',
    category: 'commerce',
    title: 'Product grid',
    description: 'Several products as cards; variants grid / masonry / carousel.',
    variants: ['grid', 'masonry', 'carousel'],
    defaultVariant: 'grid',
    content: GridC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'crossfade'],
    sfx: [
      { at: 0.1, category: 'pop', weight: 0.5 },
      { at: 0.3, category: 'pop', weight: 0.3 },
      { at: 0.5, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['product', 'feature', 'offer'],
    energy: 0.55,
    example: { title: 'تشكيلة تناسب الجميع', products: [{ name: 'عطر العود', price: '249 ر.س', image: 'lib:demo/product.png' }, { name: 'بخور ملكي', price: '120 ر.س', image: 'lib:demo/product.png' }, { name: 'دهن عود', price: '399 ر.س', image: 'lib:demo/product.png' }, { name: 'مجموعة هدايا', price: '499 ر.س', image: 'lib:demo/product.png' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, holdSec } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const n = c.products.length;
          const u = v.canvas.u;
          const card = (p: GC['products'][number], i: number, cw: number, ch: number) => (
            <Surface key={i} style={{ width: cw, height: ch, padding: cw * 0.07, display: 'flex', flexDirection: 'column', gap: cw * 0.04, overflow: 'hidden' }}>
              <div style={{ flex: 1, minHeight: 0, borderRadius: cw * 0.05, background: alpha(v.tokens.palette.primary, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {p.image ? <Media src={p.image} role="product" width={cw * 0.8} height={ch * 0.55} fit="contain" /> : <Icon name="Package" size={cw * 0.3} treatment="plain" />}
              </div>
              <Text text={p.name} role="label" size={Math.min(3.6, (cw * 0.09) / u)} minSize={1.8} animate="none" align="start" color={v.tokens.palette.textOnSurface} maxLines={1} maxWidth={cw * 0.86} />
              {p.price ? <Text text={p.price} role="label" size={Math.min(3.4, (cw * 0.085) / u)} minSize={1.8} animate="none" align="start" color={v.hl} maxLines={1} weight={700} maxWidth={cw * 0.86} /> : null}
            </Surface>
          );
          if (variant === 'carousel') {
            const cw = Math.min(w * 0.55, h * 0.6);
            const ch = cw * 1.3;
            const shift = EASE.inOut(clamp((s - 0.6) / Math.max(1, holdSec - 1.2))) * (n - 1);
            return (
              <div style={{ position: 'relative', width: w, height: ch }}>
                {c.products.map((p, i) => {
                  const d = i - shift;
                  const dirSign = v.dir === 'rtl' ? -1 : 1;
                  return (
                    <div key={i} style={{ position: 'absolute', left: '50%', top: 0, marginLeft: -cw / 2, transform: `translateX(${dirSign * d * cw * 0.85}px) scale(${1 - Math.min(1, Math.abs(d)) * 0.18}) rotateY(${dirSign * d * -12}deg)`, opacity: 1 - Math.min(1, Math.abs(d)) * 0.45, zIndex: 10 - Math.round(Math.abs(d) * 2) }}>
                      {card(p, i, cw, ch)}
                    </div>
                  );
                })}
              </div>
            );
          }
          const { cols, rows } = gridShape(n, w, h, 0.78);
          const gap = u * 2.2;
          const cw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * 0.78);
          const ch = cw / 0.78;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap, alignItems: 'start' }}>
              {c.products.map((p, i) => {
                const pp = progress(m, 0.1 + i * 0.1, 0.6, v.tokens.motion.easing === 'elastic' ? 'elastic' : 'smooth');
                const off = variant === 'masonry' && i % cols === 1 ? ch * 0.18 : 0;
                return (
                  <div key={i} style={{ transform: `translateY(${off + (1 - pp) * u * 8}px) scale(${0.9 + 0.1 * pp})`, opacity: clamp(pp * 1.5) }}>
                    {card(p, i, cw, ch * (variant === 'masonry' && i % 3 === 0 ? 1.08 : 1))}
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

// ───────────────────────── price-offer
const OfferC = z.object({
  headline: z.string().min(1).max(60),
  price: z.string().max(24).optional(),
  oldPrice: z.string().max(24).optional(),
  badge: z.string().max(20).optional(),
  note: z.string().max(80).optional(),
  image: z.string().optional(),
});
type OC = z.infer<typeof OfferC>;
export const priceOffer = defineScene<OC>(
  {
    id: 'price-offer',
    version: '1.0.0',
    category: 'commerce',
    title: 'Price / offer',
    description: 'Offer with price, optional struck old price and badge (only user-provided offers); variants tag / badge / slash.',
    variants: ['tag', 'badge', 'slash'],
    defaultVariant: 'badge',
    content: OfferC,
    defaultDuration: 3.2,
    minDuration: 2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'color-sweep'],
    sfx: [
      { at: 0.1, category: 'impact', weight: 0.55 },
      { at: 0.9, category: 'pop', weight: 0.45 },
    ],
    safeArea: 'normal',
    beats: ['offer', 'cta', 'product'],
    energy: 0.8,
    example: { headline: 'عرض الإطلاق', price: '199 ر.س', oldPrice: '249 ر.س', badge: 'لفترة محدودة', note: 'الشحن مجاني لكل المدن' },
    editable: ['headline', 'price', 'oldPrice', 'badge', 'note'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const v = useVideo();
    const t = v.tokens;
    const { m } = useSceneTime();
    const u = L.u;
    const strike = progress(m, 0.8, 0.4);
    const pop = overshoot(m, 0.35);
    return (
      <>
        <Accents seed={29} />
        <Stage gap={u * 3}>
          {c.badge ? (
            <Reveal family="pop" delay={0.05}>
              <div style={{ padding: `${u * 1}px ${u * 3}px`, borderRadius: 999, background: badgeBg(t.palette.accent), transform: variant === 'badge' ? 'rotate(-4deg)' : undefined }}>
                <Text text={c.badge} role="label" size={3.6} color={bestOn(badgeBg(t.palette.accent))} animate="none" maxLines={1} />
              </div>
            </Reveal>
          ) : null}
          <Text text={c.headline} role="headline" size={9} animate="words" />
          {c.image ? (
            <Reveal delay={0.2} family="scale">
              <ProductHero src={c.image} maxW={L.safe.width * 0.5} maxH={L.safe.height * 0.3} />
            </Reveal>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: u * 3, flexDirection: 'row' }}>
            {c.price ? (
              <div style={{ transform: `scale(${0.6 + 0.4 * pop})`, opacity: clamp(pop * 2) }}>
                {variant === 'tag' ? (
                  <div style={{ position: 'relative', padding: `${u * 2}px ${u * 5}px ${u * 2}px ${u * 6}px`, background: t.palette.primary, clipPath: 'polygon(12% 0, 100% 0, 100% 100%, 12% 100%, 0 50%)', borderRadius: u }}>
                    <Text text={c.price} role="number" size={9} minSize={5} color={t.palette.textOnPrimary} animate="none" critical font="display" />
                  </div>
                ) : (
                  <div style={{ padding: `${u * 1.6}px ${u * 4}px`, borderRadius: u * 3, background: variant === 'badge' ? t.palette.primary : 'transparent' }}>
                    <Text text={c.price} role="number" size={10} minSize={5} color={variant === 'badge' ? t.palette.textOnPrimary : v.hl} animate="none" critical font="display" />
                  </div>
                )}
              </div>
            ) : null}
            {c.oldPrice ? (
              <div style={{ position: 'relative', opacity: 0.75 }}>
                <Text text={c.oldPrice} role="title" size={5} animate="block" entrance="fade" delay={0.5} color={t.palette.textSecondary} />
                <div style={{ position: 'absolute', left: -u, right: -u, top: '52%', height: u * 0.6, background: t.palette.negative, transform: `scaleX(${strike}) rotate(-8deg)`, transformOrigin: v.dir === 'rtl' ? 'right' : 'left', borderRadius: 99 }} />
              </div>
            ) : null}
          </div>
          {c.note ? <Text text={c.note} role="subtitle" delay={1} /> : null}
        </Stage>
      </>
    );
  },
);

function bestOn(bg: string) {
  return bestTextOn(bg);
}

/** A mid-tone accent passes 4.5:1 with neither white nor black text: shift its lightness just enough. */
function badgeBg(accent: string) {
  const fg = bestTextOn(accent);
  return contrastRatio(fg, accent) >= 4.5 ? accent : ensureContrast(accent, fg, 4.6);
}

// ───────────────────────── shopping-cart
const CartC = Heading.extend({ image: z.string().optional(), name: z.string().max(40), price: z.string().max(20).optional(), button: z.string().max(24).optional() });
type CC = z.infer<typeof CartC>;
export const shoppingCart = defineScene<CC>(
  {
    id: 'shopping-cart',
    version: '1.0.0',
    category: 'commerce',
    title: 'Add to cart',
    description: 'Product card → add-to-cart click → item flies into the cart with a badge; variants add / summary.',
    variants: ['add', 'summary'],
    defaultVariant: 'add',
    content: CartC,
    defaultDuration: 3.6,
    minDuration: 2.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in'],
    sfx: [
      { at: 1.2, category: 'click', weight: 0.65 },
      { at: 1.5, category: 'whoosh', weight: 0.4 },
      { at: 2.0, category: 'pop', weight: 0.55 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'product', 'offer'],
    energy: 0.6,
    example: { title: 'تجربة شراء سلسة', highlight: ['سلسة'], image: 'lib:demo/product.png', name: 'عطر العود الملكي', price: '249 ر.س' },
    editable: ['eyebrow', 'title', 'subtitle', 'name', 'price', 'button'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s } = useSceneTime();
    const tl = useLabel();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w * 0.8, h * 0.62);
          const u = W / 100;
          const enter = progress(m, 0.05, 0.8);
          const fly = EASE.inOut(clamp((s - 1.35) / 0.6));
          const badge = progress(m, 1.95, 0.4, 'elastic');
          const pressed = s > 1.2 && s < 1.38 ? 1 : 0;
          return (
            <div style={{ position: 'relative', width: W, opacity: enter, transform: `translateY(${(1 - enter) * u * 8}px)` }}>
              <div style={{ position: 'absolute', top: -u * 6, [v.dir === 'rtl' ? 'left' : 'right']: -u * 4, width: u * 20, height: u * 20, borderRadius: 99, background: v.tokens.palette.surface, border: `1px solid ${v.tokens.palette.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5, transform: `scale(${1 + badge * 0.08})` }}>
                <Icon name="ShoppingCart" size={u * 9} treatment="plain" />
                <div style={{ position: 'absolute', top: u * 1.5, right: u * 1.5, width: u * 7, height: u * 7, borderRadius: 99, background: v.tokens.palette.negative, color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: v.fonts.latin, fontWeight: 800, fontSize: u * 3.8, transform: `scale(${badge})` }}>1</div>
              </div>
              <Surface style={{ padding: u * 5, display: 'flex', flexDirection: 'column', gap: u * 3, alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '100%', height: W * 0.75, borderRadius: u * 3, background: alpha(v.tokens.palette.primary, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {c.image ? (
                    <div style={{ transform: `translate(${fly * (v.dir === 'rtl' ? -1 : 1) * W * 0.45}px, ${-fly * W * 0.62}px) scale(${1 - fly * 0.8})`, opacity: 1 - clamp((fly - 0.8) * 5) }}>
                      <Media src={c.image} role="product" width={W * 0.6} height={W * 0.62} fit="contain" />
                    </div>
                  ) : (
                    <Icon name="Package" size={W * 0.3} treatment="plain" />
                  )}
                  {c.image && fly > 0.9 ? (
                    <div style={{ position: 'absolute', opacity: 0.35 }}>
                      <Media src={c.image} role="product" width={W * 0.6} height={W * 0.62} fit="contain" />
                    </div>
                  ) : null}
                </div>
                <Text text={c.name} role="title" size={(u * 6) / v.canvas.u} minSize={2.2} animate="none" color={v.tokens.palette.textOnSurface} maxLines={2} maxWidth={W * 0.85} />
                {c.price ? <Text text={c.price} role="label" size={(u * 5) / v.canvas.u} minSize={2} animate="none" color={v.hl} maxLines={1} weight={700} /> : null}
                <div style={{ width: '100%', height: u * 13, borderRadius: u * 3, background: v.tokens.palette.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: u * 2, transform: `scale(${1 - pressed * 0.04})` }}>
                  <Icon name={variant === 'summary' ? 'CreditCard' : 'Plus'} size={u * 5} color={v.tokens.palette.textOnPrimary} treatment="plain" />
                  <Text text={c.button ?? tl('addToCart')} role="label" size={(u * 4.6) / v.canvas.u} minSize={2} animate="none" color={v.tokens.palette.textOnPrimary} maxLines={1} critical />
                </div>
              </Surface>
              <div style={{ position: 'absolute', inset: 0 }}>
                <Cursor keys={[{ t: 0.5, x: W * 0.9, y: W * 1.6 }, { t: 1.2, x: W * 0.5, y: W * 1.33, click: true }, { t: 2.2, x: W * 0.6, y: W * 1.5 }]} size={5.5 * (W / 1000)} />
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── category-showcase
const CatC = Heading.extend({ categories: z.array(z.object({ label: z.string().max(30), icon: z.string().optional(), image: z.string().optional() })).min(2).max(6) });
type CaC = z.infer<typeof CatC>;
export const categoryShowcase = defineScene<CaC>(
  {
    id: 'category-showcase',
    version: '1.0.0',
    category: 'commerce',
    title: 'Category showcase',
    description: 'Store categories as tiles or a rolling strip; variants tiles / strip / circles.',
    variants: ['tiles', 'strip', 'circles'],
    defaultVariant: 'tiles',
    content: CatC,
    defaultDuration: 3.4,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'crossfade'],
    sfx: [
      { at: 0.1, category: 'pop', weight: 0.45 },
      { at: 0.35, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['product', 'feature'],
    energy: 0.55,
    example: { title: 'كل ما تحتاجه', categories: [{ label: 'عطور', icon: 'Sparkles' }, { label: 'بخور', icon: 'Flame' }, { label: 'هدايا', icon: 'Gift' }, { label: 'عناية', icon: 'Heart' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const n = c.categories.length;
          const u = v.canvas.u;
          if (variant === 'circles') {
            const size = Math.min((w - u * 3 * (Math.min(n, 3) - 1)) / Math.min(n, 3), h / Math.ceil(n / 3) - u * 8);
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: u * 3, width: w }}>
                {c.categories.map((ct, i) => {
                  const p = progress(m, 0.1 + i * 0.1, 0.6, 'elastic');
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.2, transform: `scale(${p})` }}>
                      <div style={{ width: size * 0.8, height: size * 0.8, borderRadius: 999, background: alpha(v.tokens.palette.primary, 0.14), border: `2px solid ${alpha(v.tokens.palette.primary, 0.5)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {ct.image ? <Media src={ct.image} role="product" width={size * 0.62} height={size * 0.62} fit="contain" /> : <Icon name={ct.icon} size={size * 0.3} treatment="plain" />}
                      </div>
                      <Text text={ct.label} role="label" size={3.6} animate="none" maxLines={1} maxWidth={size} color={v.tokens.palette.textPrimary} />
                    </div>
                  );
                })}
              </div>
            );
          }
          if (variant === 'strip') {
            const cw = Math.min(w * 0.42, h * 0.55);
            const { s } = { s: m.frame / m.fps };
            const offset = s * cw * 0.35;
            return (
              <div style={{ width: w, height: cw * 1.1, position: 'relative', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(90deg, transparent, black 12%, black 88%, transparent)' }}>
                <div style={{ position: 'absolute', top: 0, display: 'flex', gap: u * 2.4, transform: `translateX(${(v.dir === 'rtl' ? 1 : -1) * offset}px)`, [v.dir === 'rtl' ? 'right' : 'left']: 0 }}>
                  {[...c.categories, ...c.categories].map((ct, i) => (
                    <Surface key={i} tone={i % 2 ? 'alt' : 'surface'} style={{ width: cw, height: cw, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2, flexShrink: 0 }}>
                      {ct.image ? <Media src={ct.image} role="product" width={cw * 0.55} height={cw * 0.5} fit="contain" /> : <Icon name={ct.icon} size={cw * 0.22} treatment="duotone" />}
                      <Text text={ct.label} role="label" size={4} animate="none" maxLines={1} maxWidth={cw * 0.85} color={v.tokens.palette.textOnSurface} />
                    </Surface>
                  ))}
                </div>
              </div>
            );
          }
          const { cols, rows } = gridShape(n, w, h, 1.1);
          const gap = u * 2.2;
          const cw = Math.min((w - gap * (cols - 1)) / cols, ((h - gap * (rows - 1)) / rows) * 1.1);
          return (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap }}>
              {c.categories.map((ct, i) => {
                const p = progress(m, 0.1 + i * 0.08, 0.6);
                return (
                  <div key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * u * 5}px)` }}>
                    <Surface tone={i === 0 ? 'primary' : 'surface'} style={{ width: cw, height: cw / 1.1, padding: cw * 0.08, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      {ct.image ? <Media src={ct.image} role="product" width={cw * 0.5} height={cw * 0.4} fit="contain" /> : <Icon name={ct.icon} size={cw * 0.2} treatment="plain" color={i === 0 ? v.tokens.palette.textOnPrimary : undefined} />}
                      <Text text={ct.label} role="title" size={Math.min(5, (cw * 0.12) / u)} minSize={2} animate="none" align="start" maxLines={1} maxWidth={cw * 0.84} color={i === 0 ? v.tokens.palette.textOnPrimary : v.tokens.palette.textOnSurface} />
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

export { Button };
