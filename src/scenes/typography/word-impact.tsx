import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { overshoot, clamp, progress, EASE } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { interpolate } from 'remotion';

const Content = z.object({
  word: z.string().min(1).max(24),
  line: z.string().max(90).optional(),
  kicker: z.string().max(40).optional(),
});
type C = z.infer<typeof Content>;

function WordImpact({ content: c, variant }: { content: C; variant: string }) {
  const L = useLayout();
  const { tokens: t, hl } = useVideo();
  const { m, s } = useSceneTime();
  const u = L.u;
  if (variant === 'echo') {
    const p = progress(m, 0, 0.9);
    const ghosts = [-2, -1, 1, 2];
    return (
      <Stage>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {ghosts.map((g) => (
            <div key={g} style={{ position: 'absolute', transform: `translateY(${g * 15 * u * p}px)`, opacity: 0.14 / Math.abs(g) }}>
              <Text text={c.word} role="headline" size={19} minSize={9} maxLines={1} animate="none" color={t.palette.textPrimary} />
            </div>
          ))}
          <div style={{ transform: `scale(${0.8 + 0.2 * overshoot(m, 0)})` }}>
            <Text text={c.word} role="headline" size={19} minSize={9} maxLines={1} animate="none" color={hl} />
          </div>
        </div>
        {c.line ? <Text text={c.line} role="subtitle" delay={0.55} /> : null}
      </Stage>
    );
  }
  if (variant === 'zoom') {
    const z = interpolate(s, [0, 0.9], [2.6, 1], { extrapolateRight: 'clamp', easing: EASE.snappy });
    return (
      <Stage>
        {c.kicker ? <Text text={c.kicker} role="eyebrow" delay={0.6} animate="block" /> : null}
        <div style={{ transform: `scale(${z})`, filter: `blur(${Math.max(0, (z - 1) * 6)}px)`, opacity: clamp(s * 4) }}>
          <Text text={c.word} role="headline" size={20} minSize={9} maxLines={1} animate="none" color={hl} />
        </div>
        {c.line ? <Text text={c.line} role="subtitle" delay={0.8} /> : null}
      </Stage>
    );
  }
  // single: the word slams in with a shock ring.
  const p = overshoot(m, 0.05, 200);
  const ring = clamp((s - 0.05) / 0.6);
  return (
    <Stage>
      {c.kicker ? <Text text={c.kicker} role="eyebrow" animate="block" /> : null}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: u * 60, height: u * 60, borderRadius: '50%', border: `${u * 0.6}px solid ${alpha(t.palette.primary, (1 - ring) * 0.6)}`, transform: `scale(${0.3 + ring})` }} />
        <div style={{ transform: `scale(${0.5 + 0.5 * p})`, opacity: clamp(p * 3) }}>
          <Text text={c.word} role="headline" size={21} minSize={9} maxLines={1} animate="none" color={hl} style={{ textShadow: t.glow > 0.3 ? `0 0 ${u * 3}px ${alpha(hl, 0.5)}` : undefined }} />
        </div>
      </div>
      {c.line ? <Text text={c.line} role="title" size={5.5} delay={0.5} /> : null}
    </Stage>
  );
}

export default defineScene<C>(
  {
    id: 'word-impact',
    version: '1.0.0',
    category: 'typography',
    title: 'Word impact',
    description: 'One huge word as a punchline; variants single / echo / zoom.',
    variants: ['single', 'echo', 'zoom'],
    defaultVariant: 'single',
    content: Content,
    defaultDuration: 2.2,
    minDuration: 1.2,
    maxDuration: 5,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'cut', 'speed-ramp'],
    sfx: [
      { at: 0.03, category: 'impact', weight: 0.7 },
      { at: 0, category: 'whoosh', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'bridge', 'problem'],
    energy: 0.9,
    textCapacity: { single: 12, echo: 10, zoom: 12 },
    example: { word: 'أسرع', line: 'من الفكرة إلى الفيديو', kicker: 'النتيجة' },
    editable: ['word', 'line', 'kicker'],
  },
  WordImpact,
);
