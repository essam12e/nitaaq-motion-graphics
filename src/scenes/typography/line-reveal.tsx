import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { Accents, useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { progress } from '../../motion/primitives';
import { hasArabic } from '../../typography/arabic';
import { alpha } from '../../brand/color';

const Content = z.object({
  lines: z.array(z.string().min(1).max(90)).min(1).max(5),
  highlight: z.array(z.string()).optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
});
type C = z.infer<typeof Content>;

function LineReveal({ content: c, variant }: { content: C; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m } = useSceneTime();
  const u = L.u;
  const align = c.align ?? (L.orientation === 'landscape' ? 'start' : 'center');
  const gap = variant === 'stagger' ? 0.32 : 0.42;
  return (
    <>
      <Accents seed={11} />
      <Stage align={align === 'center' ? 'center' : align === 'start' ? 'flex-start' : 'flex-end'} gap={u * 1.6} style={{ paddingInline: L.orientation === 'landscape' ? u * 6 : 0 }}>
        {c.lines.map((line, i) => {
          const delay = i * gap;
          const isLast = i === c.lines.length - 1;
          if (variant === 'tracking') {
            // Latin: letter-spacing collapse. Arabic: horizontal expand (never letter-spacing — it breaks joining).
            const p = progress(m, delay, 0.9, 'cinematic');
            const arabic = hasArabic(line);
            return (
              <div key={i} style={{ opacity: p, transform: arabic ? `scaleX(${1.25 - 0.25 * p})` : undefined, letterSpacing: arabic ? 0 : `${(1 - p) * 0.5}em` }}>
                <Text text={line} role={isLast ? 'headline' : 'title'} highlight={c.highlight} align={align} animate="none" size={isLast ? 8.5 : 6} />
              </div>
            );
          }
          return (
            <Text
              key={i}
              text={line}
              role={i === 0 && c.lines.length > 1 ? 'title' : 'headline'}
              size={i === 0 && c.lines.length > 1 ? 6 : 8.5}
              highlight={c.highlight}
              align={align}
              animate="block"
              entrance={variant === 'blur' ? 'blur' : variant === 'stagger' ? 'rise' : 'mask'}
              delay={delay}
              duration={0.8}
              color={i === 0 && c.lines.length > 1 ? alpha(t.palette.textPrimary, 0.72) : undefined}
            />
          );
        })}
      </Stage>
    </>
  );
}

export default defineScene<C>(
  {
    id: 'line-reveal',
    version: '1.0.0',
    category: 'typography',
    title: 'Line reveal',
    description: 'Statement revealed line by line; variants mask / blur / stagger / tracking.',
    variants: ['mask', 'blur', 'stagger', 'tracking'],
    defaultVariant: 'mask',
    content: Content,
    defaultDuration: 3.4,
    minDuration: 1.8,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'wipe', 'blur'],
    sfx: [{ at: 0, category: 'sweep', weight: 0.4 }],
    safeArea: 'normal',
    beats: ['problem', 'solution', 'bridge', 'hook'],
    energy: 0.45,
    textCapacity: { mask: 120, blur: 120, stagger: 120, tracking: 70 },
    example: { lines: ['كل يوم بدون محتوى', 'هو فرصة ضايعة'], highlight: ['فرصة'] },
    editable: ['lines'],
  },
  LineReveal,
);
