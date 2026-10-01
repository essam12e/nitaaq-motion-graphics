/**
 * logo-animation — the Logo Animation Engine's scene. The variant is the reveal
 * chosen by src/brand/logo-reveal.ts from the logo's measured structure.
 *
 * Identity rule: every layer is the SAME untouched image at the SAME fitted
 * size; reveals only clip, translate, scale uniformly, blur or light it, and
 * every layer ends at identity, so the settled frame is exactly the logo.
 * No logo → a typographic wordmark of the brand name (never a fabricated mark).
 */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useAsset, useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, overshoot } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { LOGO_REVEAL_IDS } from '../../brand/logo-reveal';
import { createRng } from '../../core/rng';
import type { MotionEventDecl } from '../../audio/events';

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Content = z.object({
  logo: z.string().optional(),
  tagline: z.string().max(80).optional(),
  /** Measured by src/node/logo-structure.ts (filled by the director; optional). */
  structure: z
    .object({
      layout: z.string(),
      contentBox: Rect,
      parts: z.array(z.object({ role: z.enum(['symbol', 'wordmark']), rect: Rect })).default([]),
      symmetry: z.object({ horizontal: z.number(), vertical: z.number() }),
      dominantDirection: z.string(),
    })
    .optional(),
  revealReason: z.string().optional(),
});
type C = z.infer<typeof Content>;

const inset = (r: { x: number; y: number; w: number; h: number }, grow = 0.004) =>
  `inset(${Math.max(0, r.y - grow) * 100}% ${Math.max(0, 1 - r.x - r.w - grow) * 100}% ${Math.max(0, 1 - r.y - r.h - grow) * 100}% ${Math.max(0, r.x - grow) * 100}%)`;

function Layer({ src, w, h, style, clip }: { src: string; w: number; h: number; style?: React.CSSProperties; clip?: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, clipPath: clip, ...style }}>
      <Media src={src} role="logo" width={w} height={h} fit="contain" />
    </div>
  );
}

function LogoAnimation({ content: c, variant }: { content: C; variant: string }) {
  const L = useLayout();
  const { tokens: t, spec } = useVideo();
  const resolve = useAsset();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const src = c.logo ?? spec.brand?.logo;
  const ar = useAspect(src, 1);
  const box = fitBox(ar, Math.min(L.safe.width * 0.64, u * 72), u * 32);
  const { width: W, height: H } = box;
  const st = c.structure;
  const cb = st?.contentBox ?? { x: 0, y: 0, w: 1, h: 1 };
  const rtl = true;
  const p = progress(m, 0.1, 0.9, 'smooth');
  const pop = overshoot(m, 0.15);
  let body: React.ReactNode;
  let deco: React.ReactNode = null;

  if (!src) {
    body = spec.brand?.name ? <Text text={spec.brand.name} role="headline" size={10} maxWidth={W} maxLines={2} motion="cinematic-title" qcId="wordmark" /> : null;
  } else if (variant === 'mask') {
    const dir = st?.dominantDirection === 'vertical' ? 'v' : 'h';
    const k = (1 - p) * 100;
    body = <Layer src={src} w={W} h={H} clip={dir === 'h' ? (rtl ? `inset(0 0 0 ${k}%)` : `inset(0 ${k}% 0 0)`) : `inset(${k}% 0 0 0)`} />;
  } else if (variant === 'stroke') {
    // frame trace around the ink box, then the logo fills in
    const tp = progress(m, 0, 1.1, 'smooth');
    const fp = progress(m, 0.9, 0.6, 'smooth');
    const bx = cb.x * W - u, by = cb.y * H - u, bw = cb.w * W + 2 * u, bh = cb.h * H + 2 * u;
    const per = 2 * (bw + bh);
    deco = (
      <svg width={W + 4 * u} height={H + 4 * u} style={{ position: 'absolute', left: -2 * u, top: -2 * u, overflow: 'visible' }}>
        <rect x={bx + 2 * u} y={by + 2 * u} width={bw} height={bh} rx={u * 0.8} fill="none" stroke={t.palette.primary} strokeWidth={Math.max(2, u * 0.3)} strokeDasharray={per} strokeDashoffset={per * (1 - tp)} opacity={1 - fp * 0.85} />
      </svg>
    );
    body = <Layer src={src} w={W} h={H} style={{ opacity: fp }} clip={`inset(${(1 - fp) * 50}% 0 ${(1 - fp) * 50}% 0)`} />;
  } else if (variant === 'shape-assembly') {
    const cols = 4;
    const rows = Math.max(2, Math.round(4 / Math.max(0.6, ar)));
    const rng = createRng(`${src}:tiles`).next;
    const tiles = [];
    for (let r = 0; r < rows; r++)
      for (let q = 0; q < cols; q++) {
        const i = r * cols + q;
        const dx = (rng() - 0.5) * W * 1.2;
        const dy = (rng() - 0.5) * H * 2;
        const rot = (rng() - 0.5) * 40;
        const k = progress(m, 0.05 + i * 0.035, 0.7, 'smooth');
        const e = 1 - k;
        tiles.push(
          <Layer key={i} src={src} w={W} h={H} clip={inset({ x: q / cols, y: r / rows, w: 1 / cols, h: 1 / rows }, 0.002)} style={{ transform: `translate(${dx * e}px, ${dy * e}px) rotate(${rot * e}deg)`, opacity: clamp(k * 3) }} />,
        );
      }
    body = <>{tiles}</>;
  } else if (variant === 'scale') {
    const k = overshoot(m, 0.1, 140);
    body = <Layer src={src} w={W} h={H} style={{ transform: `scale(${0.6 + 0.4 * k})`, opacity: clamp(k * 2.5) }} />;
  } else if (variant === 'spotlight') {
    const k = progress(m, 0, 1.6, 'cinematic');
    const sx = 20 + 30 * k;
    deco = <div style={{ position: 'absolute', left: -W, top: -H * 2, width: W * 3, height: H * 5, background: `radial-gradient(28% 22% at ${sx + 15}% 50%, ${alpha(t.palette.textPrimary, 0.16 * k)}, transparent 70%)` }} />;
    body = <Layer src={src} w={W} h={H} style={{ opacity: k, filter: `brightness(${0.55 + 0.45 * k})` }} />;
  } else if (variant === 'light-sweep') {
    const url = resolve(src);
    const k = progress(m, 0, 0.6, 'smooth');
    const sweep = progress(m, 0.45, 1.1, 'smooth');
    const pos = -40 + 180 * sweep;
    body = (
      <>
        <Layer src={src} w={W} h={H} style={{ opacity: k }} />
        {url ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(105deg, transparent ${pos - 18}%, ${alpha('#FFFFFF', 0.7)} ${pos}%, transparent ${pos + 18}%)`,
              WebkitMaskImage: `url("${url}")`,
              WebkitMaskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskImage: `url("${url}")`,
              maskSize: 'contain',
              maskRepeat: 'no-repeat',
              maskPosition: 'center',
              mixBlendMode: 'screen',
              opacity: sweep > 0 && sweep < 1 ? 1 : 0,
            }}
          />
        ) : null}
      </>
    );
  } else if (variant === 'split-assembly') {
    const horiz = (st?.symmetry.horizontal ?? 1) >= (st?.symmetry.vertical ?? 0);
    const k = progress(m, 0.05, 0.85, 'smooth');
    const e = 1 - k;
    const d = (horiz ? W : H) * 0.35 * e;
    body = horiz ? (
      <>
        <Layer src={src} w={W} h={H} clip="inset(0 50% 0 0)" style={{ transform: `translateX(${-d}px)`, opacity: clamp(k * 2) }} />
        <Layer src={src} w={W} h={H} clip="inset(0 0 0 50%)" style={{ transform: `translateX(${d}px)`, opacity: clamp(k * 2) }} />
      </>
    ) : (
      <>
        <Layer src={src} w={W} h={H} clip="inset(0 0 50% 0)" style={{ transform: `translateY(${-d}px)`, opacity: clamp(k * 2) }} />
        <Layer src={src} w={W} h={H} clip="inset(50% 0 0 0)" style={{ transform: `translateY(${d}px)`, opacity: clamp(k * 2) }} />
      </>
    );
  } else if (variant === 'typography-reveal') {
    // reading-direction block reveal of the wordmark (same image, column blocks)
    const n = 6;
    const blocks = [];
    for (let i = 0; i < n; i++) {
      const idx = rtl ? n - 1 - i : i;
      const k = progress(m, 0.05 + i * 0.09, 0.45, 'smooth');
      blocks.push(<Layer key={i} src={src} w={W} h={H} clip={inset({ x: cb.x + (idx / n) * cb.w, y: 0, w: cb.w / n, h: 1 }, 0.002)} style={{ transform: `translateY(${(1 - k) * H * 0.25}px)`, opacity: k }} />);
    }
    body = <>{blocks}</>;
  } else if (variant === 'icon-wordmark' && st && st.parts.length === 2) {
    const sym = st.parts.find((q) => q.role === 'symbol')!;
    const word = st.parts.find((q) => q.role === 'wordmark')!;
    const ks = overshoot(m, 0.1, 150);
    const kw = progress(m, 0.65, 0.7, 'smooth');
    // symbol starts centred on the logo box, then slides to its true place as the wordmark unmasks
    const symCx = (sym.rect.x + sym.rect.w / 2) * W;
    const symCy = (sym.rect.y + sym.rect.h / 2) * H;
    const slide = progress(m, 0.55, 0.7, 'smooth');
    const ox = (W / 2 - symCx) * (1 - slide);
    const oy = (H / 2 - symCy) * (1 - slide);
    const horizontalLayout = Math.abs(sym.rect.y - word.rect.y) < 0.05;
    const wordFromStart = horizontalLayout ? (word.rect.x < sym.rect.x ? 'right' : 'left') : 'top';
    const k = (1 - kw) * 100;
    const wordClip =
      wordFromStart === 'right'
        ? `inset(${word.rect.y * 100}% ${(1 - word.rect.x - word.rect.w) * 100 + 0}% ${(1 - word.rect.y - word.rect.h) * 100}% ${word.rect.x * 100 + (word.rect.w * k)}%)`
        : wordFromStart === 'left'
          ? `inset(${word.rect.y * 100}% ${(1 - word.rect.x - word.rect.w) * 100 + word.rect.w * k}% ${(1 - word.rect.y - word.rect.h) * 100}% ${word.rect.x * 100}%)`
          : `inset(${word.rect.y * 100}% ${(1 - word.rect.x - word.rect.w) * 100}% ${(1 - word.rect.y - word.rect.h) * 100 + word.rect.h * k}% ${word.rect.x * 100}%)`;
    body = (
      <>
        <Layer src={src} w={W} h={H} clip={inset(sym.rect)} style={{ transform: `translate(${ox}px, ${oy}px) scale(${0.5 + 0.5 * ks})`, transformOrigin: `${symCx}px ${symCy}px`, opacity: clamp(ks * 2.5) }} />
        <Layer src={src} w={W} h={H} clip={wordClip} style={{ opacity: kw > 0 ? 1 : 0 }} />
      </>
    );
  } else if (variant === 'depth') {
    const k = progress(m, 0, 1.2, 'cinematic');
    body = <Layer src={src} w={W} h={H} style={{ transform: `scale(${1.35 - 0.35 * k})`, filter: `blur(${(1 - k) * u * 1.6}px)`, opacity: clamp(k * 1.6) }} />;
  } else if (variant === 'minimal-premium') {
    const k = progress(m, 0.1, 1.4, 'smooth');
    const line = progress(m, 0.9, 0.9, 'smooth');
    deco = <div style={{ position: 'absolute', top: H + u * 3, left: (W - W * 0.5 * line) / 2, width: W * 0.5 * line, height: Math.max(1, u * 0.15), background: alpha(t.palette.textPrimary, 0.5) }} />;
    body = <Layer src={src} w={W} h={H} style={{ opacity: k, transform: `translateY(${(1 - k) * u * 1.2}px)` }} />;
  } else {
    // energetic: punch-in + colour flash + burst lines (around, never on the logo)
    const k = overshoot(m, 0.05, 220);
    const flash = clamp(1 - Math.abs(s - 0.22) / 0.12);
    const burst = progress(m, 0.15, 0.5, 'smooth');
    deco = (
      <>
        <div style={{ position: 'absolute', left: -W, top: -H * 2, width: W * 3, height: H * 5, background: alpha(t.palette.primary, 0.35 * flash) }} />
        <svg width={W * 2} height={H * 4} style={{ position: 'absolute', left: -W / 2, top: -H * 1.5, overflow: 'visible' }}>
          {Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            const r0 = Math.max(W, H) * (0.55 + 0.25 * burst);
            const r1 = r0 + Math.max(W, H) * 0.2 * (1 - burst);
            return <line key={i} x1={W + Math.cos(a) * r0} y1={H * 2 + Math.sin(a) * r0} x2={W + Math.cos(a) * r1} y2={H * 2 + Math.sin(a) * r1} stroke={t.palette.accent} strokeWidth={u * 0.4} strokeLinecap="round" opacity={1 - burst} />;
          })}
        </svg>
      </>
    );
    body = <Layer src={src} w={W} h={H} style={{ transform: `scale(${1.6 - 0.6 * k})`, opacity: clamp(k * 3) }} />;
  }

  const taglineDelay = Math.min(durSec * 0.55, variant === 'icon-wordmark' ? 1.4 : 1);
  return (
    <Stage>
      <div data-qc-logo-reveal={variant} style={{ position: 'relative', width: W, height: H, margin: `${u * 2}px auto` }}>
        {deco}
        {body}
      </div>
      {c.tagline ? <Text text={c.tagline} role="subtitle" delay={taglineDelay} color={t.palette.textPrimary} /> : null}
    </Stage>
  );
}

const events = (c: C, variant: string): MotionEventDecl[] => {
  const ev: MotionEventDecl[] = [];
  if (variant === 'icon-wordmark') ev.push({ type: 'logo_reveal', at: 0.1, element: 'logo', importance: 0.8, anchor: 'contact' }, { type: 'text_reveal', at: 0.65, importance: 0.45 });
  else if (variant === 'energetic' || variant === 'scale') ev.push({ type: 'logo_reveal', at: 0.05, element: 'logo', importance: 0.95, anchor: 'contact' });
  else if (variant === 'shape-assembly') ev.push({ type: 'logo_reveal', at: 0.05, element: 'logo', importance: 0.9, anchor: 'completion' });
  else if (variant === 'light-sweep') ev.push({ type: 'logo_reveal', at: 0.0, element: 'logo', importance: 0.7 }, { type: 'text_reveal', at: 0.45, importance: 0.35 });
  else ev.push({ type: 'logo_reveal', at: 0.1, element: 'logo', importance: 0.9 });
  if (c.tagline) ev.push({ type: 'text_reveal', at: 1, importance: 0.3 });
  return ev;
};

export const logoAnimation = defineScene<C>(
  {
    id: 'logo-animation',
    version: '1.0.0',
    category: 'brand',
    title: 'Logo animation (structure-aware)',
    description: "Reveals the user's logo with a reveal chosen from its measured structure (symbol/wordmark split, symmetry, direction). The logo is never distorted: every layer is the same image, ending at identity.",
    variants: LOGO_REVEAL_IDS,
    defaultVariant: 'mask',
    content: Content,
    defaultDuration: 3,
    minDuration: 1.2,
    maxDuration: 6,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'light-sweep', 'camera-push', 'cut'],
    sfx: [{ at: 0.3, category: 'impact', weight: 0.6 }],
    safeArea: 'normal',
    beats: ['brand', 'hook', 'cta', 'reveal'],
    energy: 0.6,
    requiresAssets: ['logo'],
    example: { logo: 'lib:demo/logo.png', tagline: 'متجرك، بهوية تشبهك' },
    editable: ['tagline'],
    events,
    module: 'logo-animation',
  },
  LogoAnimation,
);
