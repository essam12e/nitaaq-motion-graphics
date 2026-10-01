/**
 * gsap-sequence — optional Web Animation / GSAP module.
 *
 * Remotion stays the clock: GSAP is loaded with a dynamic import() (its own
 * chunk, fetched only when this family is on screen, under delayRender), the
 * timeline is built PAUSED and every frame calls `tl.seek(frame / fps)`. No
 * requestAnimationFrame, no wall clock, no randomness — the same frame always
 * renders the same pixels. If gsap is not installed (it is an optional
 * dependency) the scene renders the settled end state and QC reports it.
 *
 * Variants: stagger-grid (cards fly in with a reading-order stagger, the key
 * card scales, the rest settle) / cascade (stacked panels cascade then fan).
 * License note: GSAP is under GreenSock's Standard "no charge" license.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { alpha } from '../../brand/color';

const GsapC = z.object({
  title: z.string().max(100).optional(),
  items: z.array(z.object({ label: z.string().min(1).max(36), value: z.string().max(20).optional() })).min(2).max(8),
  emphasis: z.number().int().min(0).optional(),
});
type GC = z.infer<typeof GsapC>;

type Gsap = typeof import('gsap').gsap;
let gsapPromise: Promise<Gsap | null> | null = null;
const loadGsap = () => (gsapPromise ??= import('gsap').then((m) => (m.gsap ?? (m as any).default) as Gsap).catch(() => null));

function GsapSequence({ content: c, variant }: { content: GC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const u = L.u;
  const root = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);
  const [g, setG] = useState<Gsap | null | undefined>(undefined);
  const [handle] = useState(() => delayRender('loading gsap'));
  useEffect(() => {
    let alive = true;
    loadGsap().then((x) => {
      if (alive) setG(x);
      continueRender(handle);
    });
    return () => {
      alive = false;
    };
  }, [handle]);
  const emph = c.emphasis ?? 0;
  useLayoutEffect(() => {
    if (!g || !root.current) return;
    const q = g.utils.selector(root.current);
    const cards = q('[data-card]');
    const t1 = g.timeline({ paused: true, defaults: { ease: 'power3.out' } });
    if (variant === 'cascade') {
      t1.from(cards, { y: -u * 18, opacity: 0, rotate: -6, duration: 0.55, stagger: { each: 0.09, from: 'start' } })
        .to(cards, { y: (i: number) => (i - (cards.length - 1) / 2) * u * 1.2, rotate: (i: number) => (i - (cards.length - 1) / 2) * 3, duration: 0.6, ease: 'power2.inOut' }, '+=0.15')
        .to(cards[emph], { scale: 1.08, duration: 0.35, ease: 'back.out(2)' }, '-=0.2');
    } else {
      t1.from(cards, { x: u * 8, y: u * 4, opacity: 0, scale: 0.9, duration: 0.5, stagger: { each: 0.07, from: 'start', grid: 'auto' } })
        .to(cards, { opacity: (i: number) => (i === emph ? 1 : 0.55), duration: 0.4 }, '+=0.25')
        .to(cards[emph], { scale: 1.1, duration: 0.4, ease: 'back.out(2.2)' }, '<');
    }
    tl.current = t1;
    return () => {
      t1.kill();
      tl.current = null;
    };
  }, [g, variant, u, emph]);
  // Remotion is the clock: seek every frame (no gsap ticker involved)
  useLayoutEffect(() => {
    tl.current?.seek(frame / fps, false);
  }, [frame, fps, g]);
  const cols = variant === 'cascade' ? 1 : c.items.length <= 4 ? 2 : 3;
  const cardW = variant === 'cascade' ? Math.min(L.safe.width * 0.8, u * 70) : (Math.min(L.safe.width, u * 110) - u * 2 * (cols - 1)) / cols;
  return (
    <Stage gap={u * 3}>
      {c.title ? <Text text={c.title} role="title" size={6} /> : null}
      <div ref={root} data-qc-gsap={g ? 'loaded' : g === null ? 'missing' : 'loading'} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gap: variant === 'cascade' ? u * 0.6 : u * 2, direction: 'rtl' }}>
        {c.items.map((it, i) => (
          <div key={i} data-card style={{ padding: `${u * 2}px ${u * 2.4}px`, borderRadius: u * 1.6, background: i === emph ? t.palette.primary : t.palette.surface, border: `${Math.max(1, u * 0.15)}px solid ${alpha(t.palette.textPrimary, 0.1)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: u * 2 }}>
            <Text text={it.label} role="label" size={3.6} animate="none" color={i === emph ? t.palette.textOnPrimary : t.palette.textOnSurface} maxLines={2} align="start" />
            {it.value ? <Text text={it.value} role="label" size={3.6} animate="none" color={i === emph ? t.palette.textOnPrimary : t.palette.accent} maxLines={1} /> : null}
          </div>
        ))}
      </div>
    </Stage>
  );
}

export const gsapSequence = defineScene<GC>(
  {
    id: 'gsap-sequence',
    version: '1.0.0',
    category: 'ui',
    title: 'GSAP staggered sequence (optional module)',
    description: 'Complex staggered UI timeline driven by GSAP, seeked by the Remotion frame (deterministic). gsap is lazy-loaded and optional: stagger-grid / cascade.',
    variants: ['stagger-grid', 'cascade'],
    defaultVariant: 'stagger-grid',
    content: GsapC,
    defaultDuration: 3.6,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['page', 'push', 'cut'],
    sfx: [{ at: 0.1, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['feature', 'demo', 'proof'],
    energy: 0.6,
    example: { title: 'كل شي في مكان واحد', items: [{ label: 'الطلبات', value: '1,240' }, { label: 'العملاء', value: '860' }, { label: 'المدفوعات', value: '98%' }, { label: 'التقييم', value: '4.9' }] },
    editable: ['title'],
    events: (c, v) => [...c.items.map((_, i) => ({ type: 'card_entry' as const, at: (v === 'cascade' ? 0.09 : 0.07) * i, importance: 0.25 })), { type: 'ui_appear' as const, at: v === 'cascade' ? 1.3 : 1.2, importance: 0.5 }],
    module: 'gsap',
  },
  GsapSequence,
);
