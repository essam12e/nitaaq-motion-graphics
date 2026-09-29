/** Cinematic families: cinematic-title, spotlight-reveal, depth-layers, light-sweep-title, speed-transition. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, useSceneTime, Eyebrow } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { clamp, progress, float, speedRamp } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { hashString, createRng } from '../../core/rng';

const TitleC = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().min(1).max(120), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
type TC = z.infer<typeof TitleC>;

function Centered({ children }: { children: React.ReactNode }) {
  const { canvas } = useVideo();
  const s = canvas.safe;
  return <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.width, height: s.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: canvas.u * 2.4 }}>{children}</div>;
}

// ───────────────────────── cinematic-title
export const cinematicTitle = defineScene<TC>(
  {
    id: 'cinematic-title',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Cinematic title',
    description: 'Film-style title card with slow push, letterbox or particles; variants letterbox / epic / minimal.',
    variants: ['letterbox', 'epic', 'minimal'],
    defaultVariant: 'letterbox',
    content: TitleC,
    defaultDuration: 3.6,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['blur', 'crossfade', 'fade'],
    sfx: [
      { at: 0, category: 'riser', weight: 0.4 },
      { at: 0.8, category: 'impact', weight: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'brand', 'bridge'],
    energy: 0.45,
    textCapacity: { letterbox: 60, epic: 40, minimal: 80 },
    example: { eyebrow: 'قريباً', title: 'الجيل الجديد من التجارة', highlight: ['الجيل الجديد'] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, durSec } = useSceneTime();
    const t = v.tokens;
    const { width: W, height: H, u, safe } = v.canvas;
    const push = 1 + 0.06 * clamp(s / durSec);
    const bars = variant === 'letterbox' ? progress(m, 0, 0.9, 'cinematic') : 0;
    const barH = Math.max(0, (H - W / 2.39) / 2) * bars;
    const barCap = Math.min(barH, safe.y - u);
    const rng = createRng(hashString(c.title)).next;
    const motes = variant === 'epic' ? Array.from({ length: 26 }, () => ({ x: rng(), y: rng(), r: 0.2 + rng() * 0.6, sp: 0.3 + rng() })) : [];
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        {variant === 'epic' ? (
          <>
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 55%, ${alpha(t.palette.primary, 0.35)}, transparent 60%)` }} />
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
              {motes.map((p, i) => (
                <circle key={i} cx={p.x * W} cy={(((p.y - s * 0.02 * p.sp) % 1) + 1) % 1 * H} r={u * p.r} fill={alpha(t.palette.accent, 0.5)} />
              ))}
            </svg>
          </>
        ) : null}
        <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})` }}>
          <Centered>
            {c.eyebrow ? <Eyebrow text={c.eyebrow} delay={0.2} /> : null}
            <Text text={c.title} highlight={c.highlight} role="headline" size={variant === 'epic' ? 11 : variant === 'minimal' ? 8 : 9.5} maxLines={3} maxWidth={safe.width} entrance="blur" delay={0.3} duration={1.1} animate={variant === 'minimal' ? 'lines' : 'words'} shadow={variant === 'epic'} />
            {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={1} maxWidth={safe.width * 0.9} /> : null}
            {variant === 'minimal' ? <div style={{ width: u * 18 * progress(m, 0.8, 0.8), height: u * 0.35, background: t.palette.primary, marginTop: u }} /> : null}
          </Centered>
        </div>
        {variant === 'letterbox' && barCap > 0 ? (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: barCap, background: '#000' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: barCap, background: '#000' }} />
          </>
        ) : null}
      </div>
    );
  },
);

// ───────────────────────── spotlight-reveal
const SpotC = z.object({ title: z.string().max(120).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle, image: z.string().optional(), role: z.enum(['image', 'product', 'logo', 'screenshot']).default('product') }).refine((c) => Boolean(c.title || c.image), { message: 'spotlight-reveal needs a title or an image' });
type SC = z.infer<typeof SpotC>;
export const spotlightReveal = defineScene<SC>(
  {
    id: 'spotlight-reveal',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Spotlight reveal',
    description: 'A moving spotlight searches the dark, then lights the subject (text or user image); variants beam / circle.',
    variants: ['circle', 'beam'],
    defaultVariant: 'circle',
    content: SpotC,
    defaultDuration: 3.6,
    minDuration: 2.4,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['iris', 'fade', 'crossfade'],
    sfx: [
      { at: 0, category: 'cinematic', weight: 0.3 },
      { at: 1.2, category: 'impact', weight: 0.45 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'product', 'brand'],
    energy: 0.5,
    example: { title: 'انتظروا الإطلاق', subtitle: 'تجربة ما شفتوها قبل' } as SC,
    editable: ['title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s } = useSceneTime();
    const t = v.tokens;
    const { width: W, height: H, u, safe } = v.canvas;
    const ar = useAspect(c.image, 1);
    const find = progress(m, 0, 1.2, 'smooth');
    const open = progress(m, 1.1, 0.8, 'cinematic');
    const cx = W * (0.5 + (1 - find) * 0.3 * Math.sin(s * 3));
    const cy = H * (0.48 + (1 - find) * 0.18 * Math.cos(s * 2.3));
    const R = Math.max(W, H) * (0.18 + 0.7 * open);
    const box = c.image ? fitBox(ar, safe.width * 0.8, safe.height * (c.title ? 0.5 : 0.75)) : null;
    const mask =
      variant === 'beam'
        ? `conic-gradient(from ${180 - 22 + (1 - find) * 30 * Math.sin(s * 2)}deg at 50% -10%, transparent 0deg, #000 ${6 + open * 30}deg, #000 ${38 + open * 120}deg, transparent ${44 + open * 130}deg)`
        : `radial-gradient(circle ${R}px at ${cx}px ${cy}px, #000 60%, transparent 100%)`;
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#050507' }}>
        <div style={{ position: 'absolute', inset: 0, WebkitMaskImage: mask, maskImage: mask, background: `radial-gradient(ellipse at 50% 45%, ${alpha(t.palette.primary, 0.3)}, ${t.palette.background} 70%)` }}>
          <Centered>
            {c.image && box ? <Media src={c.image} role={c.role} width={box.width} height={box.height} fit="contain" /> : null}
            {c.title ? <Text text={c.title} highlight={c.highlight} role="headline" size={9} maxLines={3} maxWidth={safe.width} animate="none" color="#FFFFFF" qcId="spot-title" /> : null}
            {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={1.5} maxWidth={safe.width} color="#E6E6EA" /> : null}
          </Centered>
        </div>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(circle ${R * 1.05}px at ${cx}px ${cy}px, ${alpha('#FFFFFF', 0.06 * (1 - open))}, transparent 70%)`, transform: `translateY(${float(m.frame, m.fps, u * 0.3, 3)}px)` }} />
      </div>
    );
  },
);

// ───────────────────────── depth-layers
const DepthC = z.object({ layers: z.array(z.string().min(1).max(40)).min(2).max(5), highlight: HeadingFields.highlight });
type DC = z.infer<typeof DepthC>;
export const depthLayers = defineScene<DC>(
  {
    id: 'depth-layers',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Depth layers',
    description: 'Short words stacked in Z-space; the camera flies through them to the last; variants tunnel / stack.',
    variants: ['tunnel', 'stack'],
    defaultVariant: 'tunnel',
    content: DepthC,
    defaultDuration: 3.4,
    minDuration: 2.2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'blur'],
    sfx: [
      { at: 0.1, category: 'whoosh', weight: 0.5 },
      { at: 0.9, category: 'whoosh', weight: 0.4 },
      { at: 1.8, category: 'impact', weight: 0.45 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'feature', 'bridge'],
    energy: 0.75,
    textCapacity: { tunnel: 20, stack: 30 },
    example: { layers: ['أسرع', 'أذكى', 'أسهل'], highlight: ['أسهل'] },
    editable: [],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const n = c.layers.length;
    const travel = progress(m, 0.1, Math.max(1, holdSec * 0.8), 'smooth');
    return (
      <div style={{ position: 'absolute', inset: 0, perspective: u * 60, perspectiveOrigin: '50% 50%' }}>
        {c.layers.map((word, i) => {
          const depth = i - travel * (n - 1);
          const z = variant === 'tunnel' ? -depth * u * 70 : -depth * u * 30;
          const y = variant === 'stack' ? depth * u * 10 : 0;
          const op = depth < -0.35 ? clamp(1 + (depth + 0.35) * 3) : clamp(1 - depth * 0.35);
          const isLast = i === n - 1;
          return (
            <div key={i} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translate3d(0, ${y}px, ${z}px)`, opacity: op, filter: Math.abs(depth) > 0.3 ? `blur(${Math.min(8, Math.abs(depth) * 4)}px)` : undefined }}>
              <Text text={word} highlight={c.highlight} role="headline" size={isLast ? 16 : 13} minSize={8} maxLines={2} maxWidth={safe.width} animate="none" color={isLast ? t.palette.textPrimary : alpha(t.palette.textPrimary, 0.9)} qcId={isLast ? 'depth-final' : undefined} />
            </div>
          );
        })}
      </div>
    );
  },
);

// ───────────────────────── light-sweep-title
export const lightSweepTitle = defineScene<TC>(
  {
    id: 'light-sweep-title',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Light-sweep title',
    description: 'Premium title with a specular light sweep across it; variants sweep / shine / glint.',
    variants: ['sweep', 'shine', 'glint'],
    defaultVariant: 'sweep',
    content: TitleC,
    defaultDuration: 3,
    minDuration: 2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['light-sweep', 'crossfade', 'zoom-in'],
    sfx: [{ at: 0.8, category: 'sweep', weight: 0.5 }],
    safeArea: 'normal',
    beats: ['brand', 'offer', 'hook', 'product'],
    energy: 0.5,
    example: { title: 'الفخامة في كل تفصيل', highlight: ['الفخامة'] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const sw = progress(m, 0.7, variant === 'glint' ? 0.5 : 1.1, 'smooth');
    const pos = -30 + sw * 160;
    return (
      <Centered>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} delay={0.1} /> : null}
        <div style={{ position: 'relative' }}>
          <Text text={c.title} highlight={c.highlight} role="headline" maxLines={3} maxWidth={safe.width} delay={0.1} entrance="rise" />
          <div
            style={{
              position: 'absolute',
              inset: `-${u * 2}px`,
              pointerEvents: 'none',
              mixBlendMode: t.mode === 'dark' ? 'screen' : 'overlay',
              background: `linear-gradient(${variant === 'shine' ? 90 : 110}deg, transparent ${pos - 12}%, ${alpha('#FFFFFF', variant === 'glint' ? 0.9 : 0.55)} ${pos}%, transparent ${pos + 12}%)`,
              opacity: sw > 0 && sw < 1 ? 1 : 0,
            }}
          />
        </div>
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.9} maxWidth={safe.width} /> : null}
        {variant === 'glint' && sw > 0.9 ? (
          <svg width={u * 8} height={u * 8} style={{ position: 'absolute', top: safe.height * 0.35, [v.dir === 'rtl' ? 'left' : 'right']: safe.width * 0.12, transform: `scale(${progress(m, 1.15, 0.4, 'elastic')}) rotate(${m.frame * 2}deg)` }}>
            <path d={`M${u * 4} 0 L${u * 4.6} ${u * 3.4} L${u * 8} ${u * 4} L${u * 4.6} ${u * 4.6} L${u * 4} ${u * 8} L${u * 3.4} ${u * 4.6} L0 ${u * 4} L${u * 3.4} ${u * 3.4} Z`} fill={t.palette.accent} />
          </svg>
        ) : null}
      </Centered>
    );
  },
);

// ───────────────────────── speed-transition
const SpeedC = z.object({ text: z.string().min(1).max(40), highlight: HeadingFields.highlight });
type SpC = z.infer<typeof SpeedC>;
export const speedTransition = defineScene<SpC>(
  {
    id: 'speed-transition',
    version: '1.0.0',
    category: 'cinematic',
    title: 'Speed transition',
    description: 'Short, high-energy bridge beat: speed lines and a zoom-punch word; variants streaks / burst.',
    variants: ['streaks', 'burst'],
    defaultVariant: 'streaks',
    content: SpeedC,
    defaultDuration: 1.6,
    minDuration: 1,
    maxDuration: 3,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['speed-ramp', 'zoom-in', 'cut'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.6 },
      { at: 0.35, category: 'impact', weight: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['bridge', 'hook', 'solution'],
    energy: 0.95,
    textCapacity: { streaks: 20, burst: 16 },
    example: { text: 'الحل؟', highlight: ['الحل؟'] },
    editable: ['text'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s } = useSceneTime();
    const t = v.tokens;
    const { width: W, height: H, u, safe } = v.canvas;
    const rng = createRng(hashString(c.text) + 7).next;
    const lines = Array.from({ length: 34 }, () => ({ y: rng(), len: 0.2 + rng() * 0.5, sp: 0.8 + rng() * 1.6, th: 0.15 + rng() * 0.5, a: rng() * Math.PI * 2 }));
    const punch = speedRamp(clamp(s / 0.5));
    const pop = progress(m, 0.25, 0.4, 'elastic');
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          {lines.map((l, i) => {
            if (variant === 'burst') {
              const r0 = ((s * l.sp * 1.4 + l.y) % 1) * Math.max(W, H) * 0.8;
              const r1 = r0 + l.len * u * 30;
              return <line key={i} x1={W / 2 + Math.cos(l.a) * r0} y1={H / 2 + Math.sin(l.a) * r0} x2={W / 2 + Math.cos(l.a) * r1} y2={H / 2 + Math.sin(l.a) * r1} stroke={i % 3 ? alpha(t.palette.textPrimary, 0.3) : t.palette.primary} strokeWidth={u * l.th} strokeLinecap="round" />;
            }
            const x = (((l.y * 3 + s * l.sp * 2) % 1.6) - 0.3) * W;
            const dirSign = v.dir === 'rtl' ? -1 : 1;
            const x0 = dirSign > 0 ? x : W - x;
            return <line key={i} x1={x0} y1={l.y * H} x2={x0 - dirSign * l.len * W * 0.5} y2={l.y * H} stroke={i % 4 ? alpha(t.palette.textPrimary, 0.22) : t.palette.primary} strokeWidth={u * l.th} strokeLinecap="round" />;
          })}
        </svg>
        <Centered>
          <div style={{ transform: `scale(${0.4 + 0.6 * pop + 0.04 * punch})`, filter: pop < 0.6 ? `blur(${(1 - pop) * 6}px)` : undefined }}>
            <Text text={c.text} highlight={c.highlight} role="headline" size={15} minSize={8} maxLines={2} maxWidth={safe.width} animate="none" qcId="speed-text" />
          </div>
        </Centered>
      </div>
    );
  },
);
