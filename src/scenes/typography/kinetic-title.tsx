import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeadlineBlock, Accents, useSceneTime, Eyebrow } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { overshoot, progress, clamp } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { tokenize } from '../../typography/arabic';

const Content = z.object({ ...HeadingFields });
type C = z.infer<typeof Content>;

function KineticTitle({ content: c, variant }: { content: C; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m, s, holdSec } = useSceneTime();
  const u = L.u;
  if (variant === 'slam') {
    // Each word takes the screen briefly, then the full line settles.
    const words = tokenize(c.title, c.highlight ?? []);
    const per = Math.min(0.42, (holdSec * 0.55) / Math.max(1, words.length));
    const settleAt = words.length * per;
    const idx = Math.min(words.length - 1, Math.floor(s / per));
    if (s < settleAt) {
      const w = words[idx];
      const local = (s - idx * per) / per;
      const sc = 1.25 - 0.25 * clamp(local * 3);
      return (
        <Stage>
          <div style={{ transform: `scale(${sc})` }}>
            <Text text={w.text} role="headline" size={20} minSize={8} maxLines={1} animate="none" color={w.highlight ? undefined : t.palette.textPrimary} highlight={w.highlight ? [w.text] : []} hlStyle="color" />
          </div>
        </Stage>
      );
    }
    return (
      <Stage>
        <HeadlineBlock title={c.title} highlight={c.highlight} subtitle={c.subtitle} delay={settleAt} entrance="scale" animate="block" />
      </Stage>
    );
  }
  if (variant === 'impact') {
    const p = overshoot(m, 0.05);
    return (
      <>
        <Accents seed={3} />
        <Stage>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          <div style={{ transform: `scale(${0.6 + 0.4 * p})`, opacity: clamp(p * 2) }}>
            <Text text={c.title} highlight={c.highlight} role="headline" size={12} minSize={6} animate="none" />
          </div>
          {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.5} /> : null}
        </Stage>
      </>
    );
  }
  if (variant === 'side') {
    const barP = progress(m, 0, 0.8);
    const landscape = L.orientation === 'landscape';
    return (
      <>
        <Accents seed={5} />
        <Stage align={landscape ? 'flex-start' : 'center'} style={landscape ? { paddingInline: u * 4 } : undefined}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', gap: u * 3, maxWidth: landscape ? L.safe.width * 0.7 : L.safe.width }}>
            <div style={{ width: u * 1, borderRadius: 99, background: t.palette.primary, transform: `scaleY(${barP})`, transformOrigin: 'top', boxShadow: `0 0 ${u * 2 * t.glow}px ${alpha(t.palette.primary, 0.6)}` }} />
            <HeadlineBlock eyebrow={c.eyebrow} title={c.title} highlight={c.highlight} subtitle={c.subtitle} align="start" maxWidth={(landscape ? L.safe.width * 0.7 : L.safe.width) - u * 5} />
          </div>
        </Stage>
      </>
    );
  }
  // stack (default): classic centred hierarchy with subtle accents.
  return (
    <>
      <Accents seed={1} />
      <Stage>
        <HeadlineBlock eyebrow={c.eyebrow} title={c.title} highlight={c.highlight} subtitle={c.subtitle} maxWidth={L.safe.width * (L.isWide ? 0.75 : 0.95)} />
      </Stage>
    </>
  );
}

export default defineScene<C>(
  {
    id: 'kinetic-title',
    version: '1.0.0',
    category: 'typography',
    title: 'Kinetic title',
    description: 'Headline with word-by-word kinetic entrance; variants stack / impact / slam / side.',
    variants: ['stack', 'impact', 'slam', 'side'],
    defaultVariant: 'stack',
    content: Content,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'mask-wipe'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.6 },
      { at: 0.05, category: 'impact', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'solution', 'bridge', 'brand'],
    energy: 0.7,
    textCapacity: { stack: 60, impact: 36, slam: 40, side: 70 },
    aspectVariants: { portrait: ['stack', 'impact', 'slam'], landscape: ['side', 'stack', 'impact'], square: ['stack', 'impact'] },
    example: { eyebrow: 'جديد', title: 'فكرتك تستاهل فيديو يليق فيها', highlight: ['فيديو'], subtitle: 'موشن جرافيك احترافي خلال دقائق' },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  KineticTitle,
);
