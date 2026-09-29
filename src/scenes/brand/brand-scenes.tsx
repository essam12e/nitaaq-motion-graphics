/** Brand families: logo-reveal, logo-spotlight, brand-intro, brand-outro, color-transition. Logos are only the user's own. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime, Accents, Reveal } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, overshoot, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';

function useLogoSrc(explicit?: string): string | undefined {
  const { spec } = useVideo();
  return explicit ?? spec.brand?.logo;
}

/** Brand name as a typographic wordmark — used only when the user has no logo (never a fabricated logo image). */
function Wordmark({ maxW }: { maxW: number }) {
  const { spec } = useVideo();
  if (!spec.brand?.name) return null;
  return <Text text={spec.brand.name} role="headline" size={10} maxWidth={maxW} maxLines={2} animate="none" qcId="wordmark" />;
}

function Logo({ src, maxW, maxH }: { src: string; maxW: number; maxH: number }) {
  const ar = useAspect(src, 1);
  const box = fitBox(ar, maxW, maxH);
  return <Media src={src} role="logo" width={box.width} height={box.height} fit="contain" />;
}

const LogoC = z.object({ logo: z.string().optional(), tagline: z.string().max(80).optional() });
type LC = z.infer<typeof LogoC>;

export const logoReveal = defineScene<LC>(
  {
    id: 'logo-reveal',
    version: '1.0.0',
    category: 'brand',
    title: 'Logo reveal',
    description: "Reveals the user's logo (never altered); variants mask / scale-glow / lines / ring.",
    variants: ['mask', 'scale-glow', 'lines', 'ring'],
    defaultVariant: 'scale-glow',
    content: LogoC,
    defaultDuration: 2.8,
    minDuration: 1.6,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in', 'light-sweep'],
    sfx: [
      { at: 0, category: 'riser', weight: 0.4 },
      { at: 0.45, category: 'impact', weight: 0.6 },
    ],
    safeArea: 'normal',
    beats: ['brand', 'hook', 'cta'],
    energy: 0.6,
    requiresAssets: ['logo'],
    example: { logo: 'lib:demo/logo.png', tagline: 'متجرك، بهوية تشبهك' },
    editable: ['tagline'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t } = useVideo();
    const { m, s } = useSceneTime();
    const u = L.u;
    const src = useLogoSrc(c.logo);
    const maxW = Math.min(L.safe.width * 0.62, u * 70);
    const maxH = u * 30;
    const p = progress(m, 0.1, 1, 'smooth');
    const pop = overshoot(m, 0.3);
    let wrap: React.CSSProperties = {};
    let deco: React.ReactNode = null;
    if (variant === 'mask') wrap = { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
    if (variant === 'scale-glow') {
      wrap = { transform: `scale(${0.7 + 0.3 * pop})`, opacity: clamp(pop * 2) };
      deco = <div style={{ position: 'absolute', width: maxW * 1.6, height: maxW * 1.6, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(t.palette.primary, 0.3 * p)} 0%, transparent 65%)` }} />;
    }
    if (variant === 'lines') {
      wrap = { opacity: clamp((s - 0.45) * 3), transform: `scale(${0.94 + 0.06 * p})` };
      const lp = progress(m, 0, 0.6);
      const lp2 = progress(m, 0.7, 0.5);
      deco = (
        <>
          <div style={{ position: 'absolute', width: maxW * 1.4 * lp, height: 2, background: t.palette.primary, opacity: 1 - lp2, transform: `translateY(${-maxH * 0.8}px)` }} />
          <div style={{ position: 'absolute', width: maxW * 1.4 * lp, height: 2, background: t.palette.primary, opacity: 1 - lp2, transform: `translateY(${maxH * 0.8}px)` }} />
        </>
      );
    }
    if (variant === 'ring') {
      const R = Math.max(maxW, maxH) * 0.75;
      wrap = { transform: `scale(${0.85 + 0.15 * pop})`, opacity: clamp(pop * 2) };
      deco = (
        <svg width={R * 2.4} height={R * 2.4} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
          <circle cx={R * 1.2} cy={R * 1.2} r={R} fill="none" stroke={t.palette.primary} strokeWidth={u * 0.5} strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * (1 - p)} strokeLinecap="round" opacity={0.8} />
        </svg>
      );
    }
    return (
      <Stage>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: maxH * 1.4 }}>
          {deco}
          <div style={wrap}>{src ? <Logo src={src} maxW={maxW} maxH={maxH} /> : <Wordmark maxW={maxW} />}</div>
        </div>
        {c.tagline ? <Text text={c.tagline} role="subtitle" delay={0.8} color={t.palette.textPrimary} /> : null}
      </Stage>
    );
  },
);

export const logoSpotlight = defineScene<LC>(
  {
    id: 'logo-spotlight',
    version: '1.0.0',
    category: 'brand',
    title: 'Logo spotlight',
    description: 'Logo emerges under a moving spotlight or with orbiting rings; variants spotlight / orbit.',
    variants: ['spotlight', 'orbit'],
    defaultVariant: 'spotlight',
    content: LogoC,
    defaultDuration: 3,
    minDuration: 2,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'light-sweep', 'blur'],
    sfx: [{ at: 0.2, category: 'cinematic', weight: 0.5 }],
    safeArea: 'normal',
    beats: ['brand', 'cta'],
    energy: 0.45,
    requiresAssets: ['logo'],
    example: { logo: 'lib:demo/logo.png', tagline: 'جودة تستحق الثقة' },
    editable: ['tagline'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t } = useVideo();
    const { m, s, durSec } = useSceneTime();
    const u = L.u;
    const src = useLogoSrc(c.logo);
    const maxW = Math.min(L.safe.width * 0.58, u * 64);
    const maxH = u * 28;
    const p = progress(m, 0, 1.4, 'cinematic');
    if (variant === 'orbit') {
      const R = Math.max(maxW, maxH) * 0.72;
      return (
        <Stage>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: R * 2.6, height: R * 2.6 }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: R * (1.6 + i * 0.45),
                  height: R * (1.6 + i * 0.45) * 0.42,
                  borderRadius: '50%',
                  border: `${u * 0.25}px solid ${alpha(t.palette.primary, 0.5 - i * 0.12)}`,
                  transform: `rotate(${(i - 1) * 24 + s * (10 + i * 6)}deg) scale(${p})`,
                }}
              />
            ))}
            <div style={{ opacity: p, transform: `scale(${0.9 + 0.1 * p})` }}>{src ? <Logo src={src} maxW={maxW} maxH={maxH} /> : <Wordmark maxW={maxW} />}</div>
          </div>
          {c.tagline ? <Text text={c.tagline} role="subtitle" delay={0.9} color={t.palette.textPrimary} /> : null}
        </Stage>
      );
    }
    const sx = 30 + (s / durSec) * 40;
    return (
      <>
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(40% 30% at ${sx}% 45%, ${alpha(t.palette.textPrimary, 0.12 * p)}, transparent 70%)` }} />
        <Stage>
          <div style={{ opacity: p, filter: `brightness(${0.6 + 0.4 * p})` }}>{src ? <Logo src={src} maxW={maxW} maxH={maxH} /> : <Wordmark maxW={maxW} />}</div>
          {c.tagline ? <Text text={c.tagline} role="subtitle" delay={1} color={t.palette.textPrimary} /> : null}
        </Stage>
      </>
    );
  },
);

const IntroC = z.object({ name: z.string().max(60).optional(), tagline: z.string().max(90).optional(), logo: z.string().optional() });
type IC = z.infer<typeof IntroC>;

export const brandIntro = defineScene<IC>(
  {
    id: 'brand-intro',
    version: '1.0.0',
    category: 'brand',
    title: 'Brand intro',
    description: "Logo + name + tagline lockup (or a clean wordmark from the user's brand name when there is no logo).",
    variants: ['lockup', 'stacked', 'wordmark'],
    defaultVariant: 'lockup',
    content: IntroC,
    defaultDuration: 3,
    minDuration: 1.8,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'crossfade', 'zoom-in'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.5 },
      { at: 0.4, category: 'pop', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['brand', 'hook'],
    energy: 0.55,
    example: { name: 'متجرك', tagline: 'تصميم متاجر يبيع' },
    editable: ['name', 'tagline'],
    validate: (c) => (!c.name && !c.logo ? [{ path: 'content', message: 'brand-intro needs a logo (brand) or a name', severity: 'warning' }] : []),
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t, spec } = useVideo();
    const { m } = useSceneTime();
    const u = L.u;
    const logoSrc = useLogoSrc(c.logo);
    const src = variant === 'wordmark' ? undefined : logoSrc;
    const name = c.name ?? spec.brand?.name;
    const row = variant === 'lockup' && L.orientation !== 'portrait';
    const lp = progress(m, 0.05, 0.8);
    return (
      <>
        <Accents seed={23} />
        <Stage direction={row ? 'row' : 'column'} gap={u * 3.5}>
          {src ? (
            <div style={{ opacity: lp, transform: `scale(${0.85 + 0.15 * lp})` }}>
              <Logo src={src} maxW={row ? L.safe.width * 0.3 : Math.min(L.safe.width * 0.5, u * 52)} maxH={u * (row ? 26 : 24)} />
            </div>
          ) : null}
          {src && row ? <div style={{ width: 2, height: u * 18, background: alpha(t.palette.textPrimary, 0.25), transform: `scaleY(${lp})` }} /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: row ? 'flex-start' : 'center', gap: u * 1.2 }}>
            {name ? <Text text={name} role="headline" size={variant === 'wordmark' ? 13 : 8} align={row ? 'start' : 'center'} delay={0.25} animate={variant === 'wordmark' ? 'block' : 'words'} entrance={variant === 'wordmark' ? 'blur' : undefined} maxLines={1} /> : null}
            {c.tagline ? <Text text={c.tagline} role="subtitle" align={row ? 'start' : 'center'} delay={0.6} /> : null}
          </div>
        </Stage>
      </>
    );
  },
);

const OutroC = z.object({ name: z.string().max(60).optional(), line: z.string().max(90).optional(), contact: z.string().max(80).optional(), logo: z.string().optional() });
type OC = z.infer<typeof OutroC>;

export const brandOutro = defineScene<OC>(
  {
    id: 'brand-outro',
    version: '1.0.0',
    category: 'brand',
    title: 'Brand outro',
    description: 'Closing brand card with logo/name, line and contact; variants lockup / minimal.',
    variants: ['lockup', 'minimal'],
    defaultVariant: 'lockup',
    content: OutroC,
    defaultDuration: 3,
    minDuration: 2,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'blur'],
    sfx: [{ at: 0.1, category: 'success', weight: 0.35, volume: 0.5 }],
    safeArea: 'strict',
    beats: ['brand', 'cta'],
    energy: 0.35,
    example: { name: 'متجرك', line: 'نصمم متجرك من البداية للإطلاق', contact: 'www.example.com' },
    editable: ['name', 'line', 'contact'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t, spec } = useVideo();
    const u = L.u;
    const src = useLogoSrc(c.logo);
    const name = c.name ?? spec.brand?.name;
    return (
      <Stage gap={u * 3}>
        {src ? (
          <Reveal family="scale">
            <Logo src={src} maxW={Math.min(L.safe.width * 0.5, u * 50)} maxH={u * 22} />
          </Reveal>
        ) : name ? (
          <Text text={name} role="headline" size={9} animate="block" entrance="blur" maxLines={1} />
        ) : null}
        {variant === 'lockup' && c.line ? <Text text={c.line} role="subtitle" delay={0.4} color={t.palette.textPrimary} /> : null}
        {c.contact ? (
          <Reveal delay={0.7} family="fade">
            <div style={{ padding: `${u * 1.1}px ${u * 3}px`, borderRadius: 999, border: `1.5px solid ${alpha(t.palette.textPrimary, 0.25)}` }}>
              <Text text={c.contact} role="label" color={t.palette.textPrimary} animate="none" critical />
            </div>
          </Reveal>
        ) : null}
      </Stage>
    );
  },
);

const ColorC = z.object({ word: z.string().min(1).max(40), sub: z.string().max(80).optional() });
type CC = z.infer<typeof ColorC>;

export const colorTransition = defineScene<CC>(
  {
    id: 'color-transition',
    version: '1.0.0',
    category: 'brand',
    title: 'Brand colour transition',
    description: 'Brand colours sweep across the frame and land a word; variants sweep / circles / bars.',
    variants: ['sweep', 'circles', 'bars'],
    defaultVariant: 'bars',
    content: ColorC,
    defaultDuration: 2.2,
    minDuration: 1.2,
    maxDuration: 4,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut', 'push', 'zoom-in'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.7 },
      { at: 0.5, category: 'pop', weight: 0.4 },
    ],
    safeArea: 'fullbleed',
    beats: ['bridge', 'brand', 'solution'],
    energy: 0.85,
    example: { word: 'الحل؟', sub: 'متجر مصمم ليبيع' },
    editable: ['word', 'sub'],
  },
  ({ content: c, variant }) => {
    const L = useLayout();
    const { tokens: t } = useVideo();
    const { m, s } = useSceneTime();
    const u = L.u;
    const cols = [t.palette.secondary, t.palette.accent, t.palette.primary];
    let layers: React.ReactNode;
    if (variant === 'circles') {
      const R = Math.hypot(L.W, L.H);
      layers = cols.map((col, i) => {
        const p = EASE.smooth(clamp((s - i * 0.12) / 0.6));
        return <div key={i} style={{ position: 'absolute', left: L.W / 2 - R, top: L.H / 2 - R, width: R * 2, height: R * 2, borderRadius: '50%', background: col, transform: `scale(${p})` }} />;
      });
    } else if (variant === 'sweep') {
      layers = cols.map((col, i) => {
        const p = EASE.smooth(clamp((s - i * 0.1) / 0.55));
        return <div key={i} style={{ position: 'absolute', inset: 0, background: col, clipPath: `polygon(${100 - p * 130}% 0, 100% 0, 100% 100%, ${100 - p * 130 - 20}% 100%)` }} />;
      });
    } else {
      const n = 6;
      layers = Array.from({ length: n }, (_, i) => {
        const p = EASE.snappy(clamp((s - i * 0.045) / 0.45));
        const vertical = L.orientation !== 'landscape';
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              background: i % 2 ? t.palette.primary : mix2(t.palette.primary, t.palette.secondary),
              ...(vertical ? { left: 0, right: 0, top: (i / n) * L.H, height: L.H / n + 1, transform: `scaleX(${p})`, transformOrigin: i % 2 ? 'left' : 'right' } : { top: 0, bottom: 0, left: (i / n) * L.W, width: L.W / n + 1, transform: `scaleY(${p})`, transformOrigin: i % 2 ? 'top' : 'bottom' }),
            }}
          />
        );
      });
    }
    return (
      <>
        {layers}
        <Stage>
          <div style={{ transform: `scale(${0.7 + 0.3 * overshoot(m, 0.45)})`, opacity: clamp((s - 0.4) * 5) }}>
            <Text text={c.word} role="headline" size={14} color={t.palette.textOnPrimary} animate="none" maxLines={2} />
          </div>
          {c.sub ? <Text text={c.sub} role="subtitle" color={t.palette.textOnPrimary} delay={0.7} /> : null}
        </Stage>
      </>
    );
  },
);

function mix2(a: string, b: string) {
  // Keep bars within the brand's primary family.
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const m = (i: number) => Math.round(parseInt(ah.slice(i, i + 2), 16) * 0.8 + parseInt(bh.slice(i, i + 2), 16) * 0.2).toString(16).padStart(2, '0');
  return `#${m(0)}${m(2)}${m(4)}`;
}
