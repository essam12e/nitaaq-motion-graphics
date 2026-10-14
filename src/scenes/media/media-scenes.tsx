/** Media families: image-reveal, image-collage, image-parallax, before-after, video-showcase, lottie-moment, vector-draw. User images, videos and Lottie animations are framed and moved, never altered. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, HeadlineBlock, useSceneTime, Reveal } from '../kit';
import { useAssetMeta, useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, float, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { gridShape } from '../../layout/stage';
import { useLabel } from '../i18n';
import { Surface } from '../../components/Surface';
import { LottieMedia } from '../../components/LottieMedia';
import { VectorArt, VectorGraphArt } from '../../vector/VectorArt';
import { vectorPrograms, VECTOR_VARIANTS, GRAPH_START } from '../../vector/scene-program';
import { VectorGraphSchema } from '../../vector/graph';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);
const MediaRole = z.enum(['image', 'product', 'screenshot', 'logo']).default('image');

// ───────────────────────── image-reveal
const RevealC = Heading.extend({ image: z.string().min(1), role: MediaRole, caption: z.string().max(80).optional() });
type RvC = z.infer<typeof RevealC>;
export const imageReveal = defineScene<RvC>(
  {
    id: 'image-reveal',
    version: '1.0.0',
    category: 'media',
    title: 'Image reveal',
    description: 'Reveals one user image through a mask, wipe, zoom or frame; variants mask / wipe / zoom / frame.',
    variants: ['mask', 'wipe', 'zoom', 'frame'],
    defaultVariant: 'mask',
    content: RevealC,
    defaultDuration: 3.4,
    minDuration: 2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['mask-wipe', 'zoom-in', 'crossfade'],
    sfx: [{ at: 0.1, category: 'whoosh', weight: 0.5 }],
    safeArea: 'normal',
    beats: ['hook', 'product', 'demo', 'brand'],
    energy: 0.5,
    requiresAssets: ['image'],
    example: { image: 'lib:demo/product.png', role: 'product', title: 'صُنع بعناية' },
    editable: ['eyebrow', 'title', 'subtitle', 'caption'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, durSec } = useSceneTime();
    const ar = useAspect(c.image, 1);
    const t = v.tokens;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const box = fitBox(ar, w * 0.94, h * (c.caption ? 0.84 : 0.94));
          const p = progress(m, 0.05, 1.1, 'cinematic');
          const drift = 1 + 0.04 * clamp(s / durSec);
          let wrap: React.CSSProperties = {};
          if (variant === 'mask') wrap = { clipPath: `circle(${p * 75}% at 50% 50%)` };
          else if (variant === 'wipe') wrap = { clipPath: v.dir === 'rtl' ? `inset(0 0 0 ${(1 - p) * 100}%)` : `inset(0 ${(1 - p) * 100}% 0 0)` };
          else if (variant === 'zoom') wrap = { transform: `scale(${1.25 - 0.25 * p})`, opacity: clamp(p * 1.6) };
          else wrap = { transform: `translateY(${(1 - p) * u * 8}px) rotate(${(1 - p) * -3}deg)`, opacity: clamp(p * 1.8) };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2 }}>
              <div style={{ position: 'relative', ...wrap }}>
                {variant === 'frame' ? <div style={{ position: 'absolute', inset: -u * 1.6, borderRadius: u * 2.4, border: `${u * 0.5}px solid ${alpha(t.palette.primary, 0.8)}`, transform: `translate(${u * 1.4}px, ${u * 1.4}px)` }} /> : null}
                <div style={{ transform: `scale(${drift})` }}>
                  <Media src={c.image} role={c.role} width={box.width} height={box.height} radius={variant === 'frame' ? 2 : 1.6} shadow fit={c.role === 'image' ? 'cover' : 'contain'} />
                </div>
                {variant === 'wipe' && p < 1 ? <div style={{ position: 'absolute', top: 0, bottom: 0, width: u * 0.8, background: t.palette.primary, [v.dir === 'rtl' ? 'left' : 'right']: `${(1 - p) * 100}%`, boxShadow: `0 0 ${u * 3}px ${t.palette.primary}` }} /> : null}
              </div>
              {c.caption ? <Text text={c.caption} role="caption" delay={0.9} maxLines={2} maxWidth={box.width} /> : null}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── image-collage
const CollageC = Heading.extend({ images: z.array(z.string().min(1)).min(2).max(6), role: MediaRole });
type ClC = z.infer<typeof CollageC>;
function CollageItem({ src, role, w, h, delay, rot, fit }: { src: string; role: ClC['role']; w: number; h: number; delay: number; rot: number; fit: 'contain' | 'cover' }) {
  const { m } = useSceneTime();
  const p = progress(m, delay, 0.7, 'elastic');
  return (
    <div style={{ transform: `scale(${0.6 + 0.4 * p}) rotate(${rot * p}deg)`, opacity: clamp(p * 2) }}>
      <Media src={src} role={role} width={w} height={h} radius={1.4} shadow fit={fit} />
    </div>
  );
}
export const imageCollage = defineScene<ClC>(
  {
    id: 'image-collage',
    version: '1.0.0',
    category: 'media',
    title: 'Image collage',
    description: 'Two to six user images as a grid, polaroid pile or stacked cards; variants grid / polaroid / stack.',
    variants: ['grid', 'polaroid', 'stack'],
    defaultVariant: 'grid',
    content: CollageC,
    defaultDuration: 3.6,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-out', 'crossfade'],
    sfx: [
      { at: 0.1, category: 'pop', weight: 0.35 },
      { at: 0.4, category: 'pop', weight: 0.3 },
      { at: 0.7, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['product', 'social', 'brand', 'feature'],
    energy: 0.55,
    requiresAssets: ['image'],
    example: { images: ['lib:demo/product.png', 'lib:demo/screenshot.png', 'lib:demo/product.png'], role: 'image', title: 'لحظات من عملائنا' },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          const n = c.images.length;
          const fit = c.role === 'image' ? 'cover' : 'contain';
          if (variant === 'grid') {
            const g = gridShape(n, w, h, 1);
            const gap = u * 1.6;
            const cw = (w - gap * (g.cols - 1)) / g.cols;
            const ch = Math.min((h - gap * (g.rows - 1)) / g.rows, cw * 1.2);
            return (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, ${cw}px)`, gap, direction: v.dir }}>
                {c.images.map((src, i) => (
                  <CollageItem key={i} src={src} role={c.role} w={cw} h={ch} delay={0.1 + i * 0.12} rot={0} fit={fit} />
                ))}
              </div>
            );
          }
          const cardW = Math.min(w * 0.55, h * 0.6);
          const cardH = cardW * 1.1;
          return (
            <div style={{ position: 'relative', width: w, height: h }}>
              {c.images.map((src, i) => {
                const k = i - (n - 1) / 2;
                const x = variant === 'polaroid' ? k * (w - cardW) / Math.max(1, n - 1) * 0.9 : k * u * 3;
                const y = variant === 'polaroid' ? ((i % 2) * 2 - 1) * u * 4 : k * u * 3;
                const rot = variant === 'polaroid' ? ((i * 37) % 17) - 8 : k * 4;
                return (
                  <div key={i} style={{ position: 'absolute', left: w / 2 - cardW / 2 + (v.dir === 'rtl' ? -x : x), top: h / 2 - cardH / 2 + y }}>
                    {variant === 'polaroid' ? (
                      <div style={{ background: '#FAFAF7', padding: u * 1.2, paddingBottom: u * 4.5, borderRadius: u * 0.5, boxShadow: `0 ${u}px ${u * 3}px rgba(0,0,0,0.3)` }}>
                        <CollageItem src={src} role={c.role} w={cardW - u * 2.4} h={cardH - u * 5.7} delay={0.1 + i * 0.18} rot={rot} fit={fit} />
                      </div>
                    ) : (
                      <CollageItem src={src} role={c.role} w={cardW} h={cardH} delay={0.1 + i * 0.18} rot={rot} fit={fit} />
                    )}
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

// ───────────────────────── image-parallax
const ParallaxC = z.object({ image: z.string().min(1), role: MediaRole, title: z.string().max(120).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
type PaC = z.infer<typeof ParallaxC>;
export const imageParallax = defineScene<PaC>(
  {
    id: 'image-parallax',
    version: '1.0.0',
    category: 'media',
    title: 'Image parallax',
    description: 'Full-frame image with slow camera and layered title (text sits on a scrim for contrast); variants kenburns / layers / pan.',
    variants: ['kenburns', 'layers', 'pan'],
    defaultVariant: 'kenburns',
    content: ParallaxC,
    defaultDuration: 3.8,
    minDuration: 2.2,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'blur', 'light-sweep'],
    sfx: [{ at: 0, category: 'cinematic', weight: 0.35 }],
    safeArea: 'fullbleed',
    beats: ['hook', 'brand', 'bridge', 'product'],
    energy: 0.35,
    requiresAssets: ['image'],
    example: { image: 'lib:demo/product.png', role: 'product', title: 'تفاصيل تستاهل' },
    editable: ['title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, durSec } = useSceneTime();
    const t = v.tokens;
    const { width: W, height: H, u, safe } = v.canvas;
    const k = clamp(s / durSec);
    const identity = c.role !== 'image';
    const scale = variant === 'kenburns' ? 1.04 + 0.08 * k : 1.08;
    const tx = variant === 'pan' ? (0.5 - k) * W * 0.06 * (v.dir === 'rtl' ? -1 : 1) : variant === 'layers' ? (0.5 - k) * W * 0.03 : 0;
    const ar = useAspect(c.image, 1);
    const box = identity ? fitBox(ar, W * 0.8, H * 0.62) : { width: W, height: H };
    const titleY = variant === 'layers' ? (0.5 - k) * u * 6 : 0;
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        {identity ? (
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 40%, ${alpha(t.palette.primary, 0.3)}, transparent 65%)` }} />
        ) : null}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: identity ? 'flex-start' : 'center', justifyContent: 'center', paddingTop: identity ? safe.y + u * 4 : 0, transform: `translateX(${tx}px) scale(${scale})` }}>
          <Media src={c.image} role={c.role} width={box.width} height={box.height} fit={identity ? 'contain' : 'cover'} />
        </div>
        {c.title ? (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: H * 0.5, background: `linear-gradient(to top, ${alpha(t.palette.background, 0.92)}, ${alpha(t.palette.background, 0)})` }} />
            <div style={{ position: 'absolute', left: safe.x, width: safe.width, bottom: H - safe.y - safe.height, transform: `translateY(${titleY}px)`, display: 'flex', justifyContent: 'center' }}>
              <HeadlineBlock title={c.title} highlight={c.highlight} subtitle={c.subtitle} role="title" maxWidth={safe.width} delay={0.3} />
            </div>
          </>
        ) : null}
        {/* 'layers' parallax comes from the image + title depth; the old floating rings were decoration without a job. */}
      </div>
    );
  },
);

// ───────────────────────── before-after
const BeforeAfterC = Heading.extend({
  before: z.string().min(1),
  after: z.string().min(1),
  role: MediaRole,
  beforeLabel: z.string().max(20).optional(),
  afterLabel: z.string().max(20).optional(),
});
type BAC = z.infer<typeof BeforeAfterC>;
export const beforeAfter = defineScene<BAC>(
  {
    id: 'before-after',
    version: '1.0.0',
    category: 'media',
    title: 'Before / after',
    description: 'Two user images compared with a sliding divider, side by side, or a flip; variants slider / side / flip.',
    variants: ['slider', 'side', 'flip'],
    defaultVariant: 'slider',
    content: BeforeAfterC,
    defaultDuration: 4,
    minDuration: 2.6,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['wipe', 'push', 'crossfade'],
    sfx: [
      { at: 0.8, category: 'sweep', weight: 0.5 },
      { at: 2, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['comparison', 'solution', 'proof'],
    energy: 0.5,
    requiresAssets: ['image'],
    example: { before: 'lib:demo/screenshot.png', after: 'lib:demo/screenshot.png', role: 'screenshot', title: 'من الفوضى إلى الوضوح' },
    editable: ['eyebrow', 'title', 'subtitle', 'beforeLabel', 'afterLabel'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const L = useLabel();
    const ar = useAspect(c.after, 1.4);
    const fit = c.role === 'image' ? 'cover' : 'contain';
    const bl = c.beforeLabel ?? L('before');
    const al = c.afterLabel ?? L('after');
    const tag = (text: string, good: boolean) => (
      <div style={{ padding: `${v.canvas.u * 0.6}px ${v.canvas.u * 2}px`, borderRadius: 99, background: good ? t.palette.primary : alpha('#000000', 0.6) }}>
        <Text text={text} role="label" size={3.2} animate="none" maxLines={1} color={good ? t.palette.textOnPrimary : '#FFFFFF'} />
      </div>
    );
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = v.canvas.u;
          if (variant === 'side') {
            const landscape = w > h * 1.2;
            const box = landscape ? fitBox(ar, (w - u * 3) / 2, h * 0.9) : fitBox(ar, w * 0.92, (h - u * 3) / 2);
            const pb = progress(m, 0.1, 0.6);
            const pa = progress(m, 0.6, 0.7, 'elastic');
            return (
              <div style={{ display: 'flex', flexDirection: landscape ? 'row' : 'column', gap: u * 3, direction: v.dir }}>
                <div style={{ position: 'relative', opacity: pb * 0.85, transform: `scale(${0.94 + 0.04 * pb})` }}>
                  <Media src={c.before} role={c.role} width={box.width} height={box.height} radius={1.4} fit={fit} />
                  <div style={{ position: 'absolute', top: u * 1.4, insetInlineStart: u * 1.4 }}>{tag(bl, false)}</div>
                </div>
                <div style={{ position: 'relative', opacity: clamp(pa * 2), transform: `scale(${0.9 + 0.1 * pa})` }}>
                  <Media src={c.after} role={c.role} width={box.width} height={box.height} radius={1.4} fit={fit} shadow />
                  <div style={{ position: 'absolute', top: u * 1.4, insetInlineStart: u * 1.4 }}>{tag(al, true)}</div>
                </div>
              </div>
            );
          }
          const box = fitBox(ar, w * 0.95, h * 0.92);
          if (variant === 'flip') {
            const f = progress(m, Math.max(0.6, holdSec * 0.4), 0.8, 'smooth');
            const showAfter = f > 0.5;
            return (
              <div style={{ perspective: u * 200 }}>
                <div style={{ position: 'relative', transform: `rotateY(${f * 180}deg)`, transformStyle: 'preserve-3d' }}>
                  <div style={{ transform: showAfter ? 'rotateY(180deg)' : undefined }}>
                    <Media src={showAfter ? c.after : c.before} role={c.role} width={box.width} height={box.height} radius={1.4} fit={fit} shadow />
                    <div style={{ position: 'absolute', top: u * 1.4, insetInlineStart: u * 1.4 }}>{tag(showAfter ? al : bl, showAfter)}</div>
                  </div>
                </div>
              </div>
            );
          }
          const start = 0.5;
          const sp = progress(m, start, Math.max(0.9, holdSec * 0.55), 'smooth');
          const pos = 0.92 - 0.84 * sp + 0.06 * Math.sin(sp * Math.PI);
          const splitX = box.width * (v.dir === 'rtl' ? 1 - pos : pos);
          return (
            <div style={{ position: 'relative', width: box.width, height: box.height }}>
              <Media src={c.after} role={c.role} width={box.width} height={box.height} radius={1.4} fit={fit} shadow />
              <div style={{ position: 'absolute', inset: 0, clipPath: v.dir === 'rtl' ? `inset(0 0 0 ${splitX}px)` : `inset(0 ${box.width - splitX}px 0 0)` }}>
                <Media src={c.before} role={c.role} width={box.width} height={box.height} radius={1.4} fit={fit} />
              </div>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: splitX - u * 0.3, width: u * 0.6, background: '#FFFFFF', boxShadow: `0 0 ${u * 2}px rgba(0,0,0,0.4)` }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', width: u * 7, height: u * 7, marginLeft: -u * 3.5, marginTop: -u * 3.5, borderRadius: 99, background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: u * 3, fontFamily: v.fonts.latin, fontWeight: 800 }}>⟷</div>
              </div>
              <div style={{ position: 'absolute', top: u * 1.4, [v.dir === 'rtl' ? 'right' : 'left']: u * 1.4, opacity: clamp(1 - sp * 1.5) + 0.3 }}>{tag(bl, false)}</div>
              <div style={{ position: 'absolute', top: u * 1.4, [v.dir === 'rtl' ? 'left' : 'right']: u * 1.4, opacity: clamp(sp * 1.5) }}>{tag(al, true)}</div>
            </div>
          );
        }}
      />
    );
  },
);

export { EASE, Reveal };

// ───────────────────────── video-showcase
// User video clips in the scene: a card on a Surface, several clips playing at once, a clip inside a
// shape mask, or one full-bleed clip under the title. Every clip is frame-driven (VideoMedia): trim,
// loop and playback rate come from the asset's clip and can be overridden per clip here.
const ClipC = z.object({
  startFrom: z.number().min(0).optional(),
  endAt: z.number().positive().optional(),
  loop: z.boolean().optional(),
  playbackRate: z.number().min(0.25).max(4).optional(),
  delay: z.number().min(0).optional(),
  /** The clip's own sound (off by default: the Sound Director owns the mix). */
  muted: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
});
const VideoShowcaseC = Heading.extend({
  video: z.string().min(1),
  /** More clips that play at the same time (split variant). */
  videos: z.array(z.string().min(1)).max(3).optional(),
  role: z.enum(['video', 'product', 'screenshot']).default('video'),
  /** Mask variant: a morph-library shape name. */
  mask: z.string().max(20).optional(),
  clip: ClipC.optional(),
  /** Per-clip overrides for `videos` (same order). */
  clips: z.array(ClipC).max(3).optional(),
  caption: z.string().max(80).optional(),
});
type VsC = z.infer<typeof VideoShowcaseC>;

function ShowcaseCard({ src, role, w, h, delay, clip, tilt }: { src: string; role: VsC['role']; w: number; h: number; delay: number; clip?: VsC['clip']; tilt: number }) {
  const { m } = useSceneTime();
  const v = useVideo();
  const u = v.canvas.u;
  const p = progress(m, delay, 0.8, 'elastic');
  return (
    <div style={{ transform: `perspective(${u * 120}px) translateY(${(1 - p) * u * 6}px) rotateY(${(1 - p) * tilt}deg) scale(${0.86 + 0.14 * p})`, opacity: clamp(p * 1.8) }}>
      <Surface radius={2.2} padding={0.9} qc="video-card">
        <Media src={src} role={role === 'video' ? undefined : role} width={w} height={h} radius={1.5} clip={clip} />
      </Surface>
    </div>
  );
}

export const videoShowcase = defineScene<VsC>(
  {
    id: 'video-showcase',
    version: '1.0.0',
    category: 'media',
    title: 'Video showcase',
    description: 'The user’s own video clips inside the film (frame-accurate trim / loop / speed): a card on a surface, up to four clips playing together, a clip inside a shape mask, or one full-bleed clip under the title; variants card / split / mask / full.',
    variants: ['card', 'split', 'mask', 'full'],
    defaultVariant: 'card',
    content: VideoShowcaseC,
    defaultDuration: 4,
    minDuration: 2,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'mask-wipe'],
    sfx: [{ at: 0.1, category: 'whoosh', weight: 0.4 }],
    safeArea: 'normal',
    beats: ['hook', 'demo', 'product', 'feature', 'social'],
    energy: 0.55,
    requiresAssets: ['video'],
    example: { video: 'lib:demo/clip.mp4', role: 'video', title: 'شوفه وهو يشتغل' },
    editable: ['eyebrow', 'title', 'subtitle', 'caption'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, durSec } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const ar = useAspect(c.video, 16 / 9);
    const metaOf = useAssetMeta();
    if (variant === 'full') {
      const { width: W, height: H, safe } = v.canvas;
      const k = clamp(s / durSec);
      return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, transform: `scale(${1.03 + 0.05 * k})` }}>
            <Media src={c.video} width={W} height={H} fit="cover" clip={c.clip} />
          </div>
          {c.title ? (
            <>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: H * 0.55, background: `linear-gradient(to top, ${alpha(t.palette.background, 0.92)}, ${alpha(t.palette.background, 0)})` }} />
              <div style={{ position: 'absolute', left: safe.x, width: safe.width, bottom: H - safe.y - safe.height, display: 'flex', justifyContent: 'center' }}>
                <HeadlineBlock title={c.title} highlight={c.highlight} subtitle={c.subtitle} role="title" maxWidth={safe.width} delay={0.3} />
              </div>
            </>
          ) : null}
        </div>
      );
    }
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          if (variant === 'split') {
            const all = [c.video, ...(c.videos ?? [])];
            const clips = [c.clip, ...(c.clips ?? [])];
            const n = all.length;
            // each clip keeps its own shape (a 9:16 phone clip next to a 16:9 one is not cropped), and the
            // grid is the one whose smallest clip is largest (no clip shrinks to a thumbnail), then the most picture
            const ars = all.map((src) => {
              const mt = metaOf(src);
              return mt?.width && mt?.height ? mt.width / mt.height : 16 / 9;
            });
            const gap = u * 1.6;
            const cellOf = (cols: number) => {
              const rows = Math.ceil(n / cols);
              return { cols, cellW: (w - gap * (cols - 1)) / cols, cellH: (h - gap * (rows - 1)) / rows };
            };
            const areas = (c: ReturnType<typeof cellOf>) => ars.map((r) => { const b = fitBox(r, c.cellW - u * 1.8, c.cellH - u * 1.8); return b.width * b.height; });
            const score = (c: ReturnType<typeof cellOf>) => { const a = areas(c); return Math.min(...a) + 0.1 * a.reduce((x, y) => x + y, 0) / n; };
            const g = Array.from({ length: n }, (_, i) => cellOf(i + 1)).reduce((best, c) => (score(c) > score(best) * 1.02 ? c : best));
            const { cellW, cellH } = g;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.cols}, ${cellW}px)`, gap, direction: v.dir, justifyItems: 'center', alignItems: 'center' }}>
                {all.map((src, i) => {
                  const box = fitBox(ars[i], cellW - u * 1.8, cellH - u * 1.8);
                  return <ShowcaseCard key={i} src={src} role={c.role} w={box.width} h={box.height} delay={0.1 + i * 0.14} clip={clips[i]} tilt={(v.dir === 'rtl' ? -1 : 1) * 12} />;
                })}
              </div>
            );
          }
          if (variant === 'mask') {
            const side = Math.min(w, h * (c.caption ? 0.84 : 0.94));
            const p = progress(m, 0.05, 1, 'cinematic');
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2 }}>
                <div style={{ transform: `scale(${0.6 + 0.4 * p}) rotate(${(1 - p) * -8}deg)`, opacity: clamp(p * 1.6) }}>
                  <Media src={c.video} width={side} height={side} fit="cover" mask={c.mask ?? 'squircle'} clip={c.clip} />
                </div>
                {c.caption ? <Text text={c.caption} role="caption" delay={0.9} maxLines={2} maxWidth={side} /> : null}
              </div>
            );
          }
          const box = fitBox(ar, w * 0.9, h * (c.caption ? 0.8 : 0.9));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2 }}>
              <ShowcaseCard src={c.video} role={c.role} w={box.width} h={box.height} delay={0.05} clip={c.clip} tilt={(v.dir === 'rtl' ? -1 : 1) * 16} />
              {c.caption ? <Text text={c.caption} role="caption" delay={0.9} maxLines={2} maxWidth={box.width} /> : null}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── lottie-moment
// The user's own Lottie animation as the scene's subject (frame-driven LottieMedia): a logo that plays its
// own reveal and then lets the name / tagline land, an animated icon on a tile next to a message, or a large
// illustration with its headline. Trim (seconds or a marker), loop and speed come from the asset's clip and
// can be overridden here.
const LottieClipC = ClipC.pick({ startFrom: true, endAt: true, loop: true, playbackRate: true, delay: true }).extend({ marker: z.string().max(80).optional() });
const LottieMomentC = Heading.extend({
  lottie: z.string().min(1),
  clip: LottieClipC.optional(),
  caption: z.string().max(80).optional(),
});
type LmC = z.infer<typeof LottieMomentC>;

export const lottieMoment = defineScene<LmC>(
  {
    id: 'lottie-moment',
    version: '1.0.0',
    category: 'media',
    title: 'Lottie moment',
    description: 'The user’s own Lottie animation, frame-accurate (trim by seconds or marker, loop, speed): a logo that plays its own reveal before the name lands, an animated icon on a tile beside the message, or a large illustration with its headline; variants logo / icon / hero.',
    variants: ['logo', 'icon', 'hero'],
    defaultVariant: 'hero',
    content: LottieMomentC,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'mask-wipe'],
    sfx: [{ at: 0.1, category: 'whoosh', weight: 0.35 }],
    safeArea: 'normal',
    beats: ['brand', 'reveal', 'hook', 'feature', 'solution', 'cta'],
    energy: 0.5,
    requiresAssets: ['lottie'],
    example: { lottie: 'lib:demo/mark.json', title: 'حركة من ملفك نفسه' },
    editable: ['eyebrow', 'title', 'subtitle', 'caption'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const ar = useAspect(c.lottie, 1);
    const metaOf = useAssetMeta();
    const meta = metaOf(c.lottie);
    if (variant === 'logo') {
      // the mark plays its own reveal; the words wait for it (its measured length, capped)
      const playSec = meta?.duration ? Math.min(2.2, (c.clip?.endAt ?? meta.duration) - (c.clip?.startFrom ?? 0)) / (c.clip?.playbackRate ?? 1) : 1.2;
      const { safe } = v.canvas;
      const side = Math.min(safe.width * 0.62, safe.height * (c.title ? 0.42 : 0.6));
      const box = fitBox(ar, side, side);
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 3 }}>
          <LottieMedia src={c.lottie} width={box.width} height={box.height} clip={c.clip} role="logo" />
          {c.title ? <HeadlineBlock eyebrow={c.eyebrow} title={c.title} highlight={c.highlight} subtitle={c.subtitle} align="center" role="title" maxWidth={safe.width * 0.86} delay={Math.max(0.3, playSec * 0.85)} /> : null}
        </div>
      );
    }
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const p = progress(m, 0.05, 0.7, 'elastic');
          if (variant === 'icon') {
            const tile = Math.min(w, h) * 0.62;
            const inner = fitBox(ar, tile * 0.7, tile * 0.7);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2, transform: `scale(${0.8 + 0.2 * p})`, opacity: clamp(p * 1.8) }}>
                <Surface radius={3.2} padding={0} qc="lottie-tile">
                  <div style={{ width: tile, height: tile, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `radial-gradient(circle at 50% 40%, ${alpha(t.palette.primary, 0.16)}, transparent 70%)` }}>
                    <LottieMedia src={c.lottie} width={inner.width} height={inner.height} clip={c.clip} role="icon" />
                  </div>
                </Surface>
                {c.caption ? <Text text={c.caption} role="caption" delay={0.6} maxLines={2} maxWidth={tile * 1.4} /> : null}
              </div>
            );
          }
          const box = fitBox(ar, w * 0.96, h * (c.caption ? 0.84 : 0.96));
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2, opacity: clamp(p * 2) }}>
              <LottieMedia src={c.lottie} width={box.width} height={box.height} clip={c.clip} role="illustration" />
              {c.caption ? <Text text={c.caption} role="caption" delay={0.8} maxLines={2} maxWidth={box.width} /> : null}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── vector-draw
// The user's own SVG as a living drawing (Vector Engine 2.0, src/vector): traced by its real outlines and
// then filled (draw), assembled group by group from each group's own centre (build), turned into a second
// SVG shape by shape with colours and gradients blending (morph), or all of it in turn (sequence). The art
// is parsed, never rasterised: gradients, clips and masks are kept, and the last frame is the file as drawn.
const VectorDrawC = Heading.extend({
  /** The SVG (asset id or path); not needed when the scene draws a `graph`. */
  svg: z.string().min(1).optional(),
  /** graph: procedural vector art as a Non-Destructive Vector Graph (src/vector/graph.ts). */
  graph: VectorGraphSchema.optional(),
  /** morph / sequence: the SVG the art becomes. */
  morphTo: z.string().min(1).optional(),
  order: z.enum(['document', 'rtl', 'ltr', 'ttb', 'center-out']).optional(),
  drawSeconds: z.number().min(0.4).max(8).optional(),
  morphSeconds: z.number().min(0.3).max(4).optional(),
  /** Bend of the morph's point paths (radians at the midpoint); 0 = straight. */
  arc: z.number().min(-3.2).max(3.2).optional(),
  role: z.enum(['illustration', 'logo', 'icon']).default('illustration'),
  caption: z.string().max(80).optional(),
}).refine((c) => Boolean(c.svg || c.graph), { message: 'vector-draw needs `svg` (or `graph`)' });
type VdC = z.infer<typeof VectorDrawC>;

export const vectorDraw = defineScene<VdC>(
  {
    id: 'vector-draw',
    version: '1.0.0',
    category: 'media',
    title: 'Vector draw',
    description: 'The user’s own SVG brought to life from its real geometry: outlines traced then filled, groups assembled from their own centres, or morphed shape by shape into a second SVG with colours and gradients blending; variants draw / build / morph / sequence (draw, then morph) / graph (procedural art from a non-destructive vector graph: shapes, transforms, booleans, masks, fills, trimmed strokes, effects, all keyframable).',
    variants: [...VECTOR_VARIANTS],
    defaultVariant: 'draw',
    content: VectorDrawC,
    defaultDuration: 4,
    minDuration: 2,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'mask-wipe'],
    sfx: [{ at: 0.15, category: 'whoosh', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['hook', 'reveal', 'brand', 'feature', 'solution', 'proof'],
    energy: 0.45,
    requiresAssets: ['svg'],
    example: { svg: 'lib:demo/emblem.svg', role: 'illustration', title: 'رسم من ملفك نفسه' },
    editable: ['eyebrow', 'title', 'subtitle', 'caption'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { durSec } = useSceneTime();
    const u = v.canvas.u;
    const ar = useAspect(c.svg, c.graph ? c.graph.width / c.graph.height : 1);
    const programs = vectorPrograms(variant, c, durSec);
    const art = (w: number, h: number) => {
      const box = fitBox(c.graph && (variant === 'graph' || !c.svg) ? c.graph.width / c.graph.height : ar, w, h);
      if (c.graph && (variant === 'graph' || !c.svg)) return <VectorGraphArt graph={c.graph} start={GRAPH_START} width={box.width} height={box.height} role={c.role} />;
      if (!c.svg) return null;
      return <VectorArt src={c.svg} morphTo={c.morphTo} programs={programs} arc={c.arc} width={box.width} height={box.height} role={c.role} ink={v.tokens.palette.textPrimary} />;
    };
    if (!c.title) {
      const { safe } = v.canvas;
      return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2 }}>
          {art(safe.width * 0.86, safe.height * (c.caption ? 0.7 : 0.8))}
          {c.caption ? <Text text={c.caption} role="caption" delay={Math.max(0.6, durSec * 0.5)} maxLines={2} maxWidth={safe.width * 0.8} /> : null}
        </div>
      );
    }
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2 }}>
            {art(w * 0.96, h * (c.caption ? 0.84 : 0.96))}
            {c.caption ? <Text text={c.caption} role="caption" delay={0.8} maxLines={2} maxWidth={w * 0.9} /> : null}
          </div>
        )}
      />
    );
  },
);
