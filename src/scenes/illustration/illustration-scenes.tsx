/**
 * Illustration Mode, JavaScript Zero-Asset Animation and Whiteboard families.
 *
 *  illustration-scene  — procedural brand-palette illustrations: hero / trio / explain
 *  diagram-flow        — nodes + connectors explained step by step: linear / hub / cycle
 *  zero-asset-sequence — no images at all: seeded geometry + type: shapes / lines / orbit
 *                        (big, few shapes — never dotted or patterned backgrounds)
 *  whiteboard          — ink drawing on a board: draw (illustrations drawn stroke by stroke) /
 *                        write (text written in with a marker underline)
 *
 * Deterministic: shapes come from createRng(seed), never Math.random.
 */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { useSceneTime } from '../kit';
import { Stage, useLayout } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { clamp, progress, overshoot } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { createRng } from '../../core/rng';
import { Illustration } from '../../illustration/Illustration';
import { ILLUSTRATION_IDS, ILLUSTRATION_STYLES } from '../../illustration/registry';
import type { MotionEventDecl } from '../../audio/events';

const SubjectId = z.string().refine((s) => ILLUSTRATION_IDS.includes(s), { message: `unknown illustration subject (known: ${ILLUSTRATION_IDS.join(', ')})` });

// ───────────────────────── illustration-scene
const IllC = z.object({
  title: z.string().max(120).optional(),
  highlight: z.array(z.string()).optional(),
  subtitle: z.string().max(160).optional(),
  items: z.array(z.object({ subject: SubjectId, label: z.string().max(40).optional() })).min(1).max(3),
  style: z.enum(ILLUSTRATION_STYLES).optional(),
});
type IC = z.infer<typeof IllC>;

function IllustrationScene({ content: c, variant }: { content: IC; variant: string }) {
  const L = useLayout();
  const { m, s } = useSceneTime();
  const u = L.u;
  const style = c.style ?? 'duotone';
  if (variant === 'trio' && c.items.length > 1) {
    const n = c.items.length;
    const size = Math.min((L.safe.width - u * 6) / n, L.safe.height * 0.3, u * 34);
    return (
      <Stage gap={u * 4}>
        {c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={6.4} /> : null}
        <div style={{ display: 'flex', gap: u * 3, justifyContent: 'center' }}>
          {c.items.map((it, i) => {
            const d = progress(m, 0.3 + i * 0.35, 1.1, 'smooth');
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 1.4, width: size }}>
                <div style={{ transform: `translateY(${(1 - clamp(d * 2)) * u * 2}px)` }}>
                  <Illustration id={it.subject} size={size} style={style} draw={d} />
                </div>
                {it.label ? <Text text={it.label} role="label" size={3.8} delay={0.7 + i * 0.35} maxLines={2} /> : null}
              </div>
            );
          })}
        </div>
      </Stage>
    );
  }
  if (variant === 'explain') {
    const land = L.orientation === 'landscape';
    const size = land ? Math.min(L.safe.height * 0.7, L.safe.width * 0.4) : Math.min(L.safe.width * 0.62, L.safe.height * 0.36);
    return (
      <Stage direction={land ? 'row' : 'column'} gap={u * 4}>
        <Illustration id={c.items[0].subject} size={size} style={style} draw={progress(m, 0.1, 1.4, 'smooth')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.6, maxWidth: land ? L.safe.width * 0.5 : L.safe.width }}>
          {c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={6.2} align={land ? 'start' : 'center'} delay={0.3} /> : null}
          {c.subtitle ? <Text text={c.subtitle} role="body" align={land ? 'start' : 'center'} delay={0.7} /> : null}
        </div>
      </Stage>
    );
  }
  const size = Math.min(L.safe.width * 0.6, L.safe.height * 0.42);
  const breathe = 1 + Math.sin(s * 1.6) * 0.012;
  return (
    <Stage gap={u * 3}>
      <div style={{ transform: `scale(${breathe})` }}>
        <Illustration id={c.items[0].subject} size={size} style={style} draw={progress(m, 0.05, 1.3, 'smooth')} />
      </div>
      {c.title ? <Text text={c.title} highlight={c.highlight} role="title" size={7} delay={0.5} /> : null}
      {c.subtitle ? <Text text={c.subtitle} role="body" delay={0.8} /> : null}
    </Stage>
  );
}

const drawEvents = (n: number, base: number, gap: number): MotionEventDecl[] => Array.from({ length: n }, (_, i) => ({ type: 'draw_stroke' as const, at: base + i * gap, importance: 0.35 }));

export const illustrationScene = defineScene<IC>(
  {
    id: 'illustration-scene',
    version: '1.0.0',
    category: 'illustration',
    title: 'Illustration',
    description: 'Procedural vector illustrations in the brand palette (flat / line / duotone), drawn on: hero / trio / explain. No stock art or AI images.',
    variants: ['hero', 'trio', 'explain'],
    defaultVariant: 'hero',
    content: IllC,
    defaultDuration: 3.6,
    minDuration: 2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'shape', 'crossfade', 'cut'],
    sfx: [{ at: 0.2, category: 'pop', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['problem', 'solution', 'feature', 'hook', 'process'],
    energy: 0.5,
    example: { title: 'نمو مبيعاتك أسرع', highlight: ['أسرع'], items: [{ subject: 'growth' }] },
    editable: ['title', 'subtitle'],
    events: (c, v) => (v === 'trio' ? drawEvents(c.items.length, 0.3, 0.35) : drawEvents(1, 0.1, 0)),
    module: 'illustration',
  },
  IllustrationScene,
);

// ───────────────────────── diagram-flow
const DiagC = z.object({
  title: z.string().max(120).optional(),
  nodes: z.array(z.object({ label: z.string().min(1).max(32), subject: SubjectId.optional() })).min(2).max(6),
  center: z.string().max(32).optional(),
});
type DgC = z.infer<typeof DiagC>;

function DiagramFlow({ content: c, variant }: { content: DgC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m } = useSceneTime();
  const u = L.u;
  const n = c.nodes.length;
  const W = L.safe.width;
  const H = L.safe.height * (c.title ? 0.66 : 0.8);
  const per = 0.45;
  const nodeSize = Math.min(u * 16, (variant === 'linear' && L.orientation === 'landscape' ? W / (n + 1) : H / 3.4));
  let pos: { x: number; y: number }[];
  const vertical = variant === 'linear' && L.orientation !== 'landscape';
  if (variant === 'linear') pos = c.nodes.map((_, i) => (vertical ? { x: W / 2, y: ((i + 0.5) / n) * H } : { x: W - ((i + 0.5) / n) * W, y: H / 2 })); // RTL: first node on the right
  else {
    const R = Math.min(W, H) * 0.36;
    pos = c.nodes.map((_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: W / 2 + Math.cos(a) * R * (W > H ? 1.25 : 1), y: H / 2 + Math.sin(a) * R };
    });
  }
  const links: [number, number][] = variant === 'hub' ? c.nodes.map((_, i) => [-1, i]) : c.nodes.slice(0, variant === 'cycle' ? n : n - 1).map((_, i) => [i, (i + 1) % n]);
  const C = { x: W / 2, y: H / 2 };
  return (
    <Stage gap={u * 3}>
      {c.title ? <Text text={c.title} role="title" size={6.2} /> : null}
      <div style={{ position: 'relative', width: W, height: H }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {links.map(([a, b], i) => {
            const A = a < 0 ? C : pos[a];
            const B = pos[b];
            const k = progress(m, 0.35 + (b + (a < 0 ? 0 : 0.5)) * per, 0.4, 'smooth');
            const dx = B.x - A.x;
            const dy = B.y - A.y;
            const d = Math.hypot(dx, dy) || 1;
            const off = nodeSize * 0.62;
            const x1 = A.x + (dx / d) * off, y1 = A.y + (dy / d) * off;
            const x2 = B.x - (dx / d) * off, y2 = B.y - (dy / d) * off;
            const ex = x1 + (x2 - x1) * k, ey = y1 + (y2 - y1) * k;
            const ang = Math.atan2(y2 - y1, x2 - x1);
            const ah = u * 1.4;
            return (
              <g key={i} opacity={k > 0 ? 1 : 0}>
                <line x1={x1} y1={y1} x2={ex} y2={ey} stroke={alpha(t.palette.textPrimary, 0.55)} strokeWidth={Math.max(2, u * 0.3)} strokeLinecap="round" />
                {k > 0.95 && variant !== 'hub' ? <path d={`M${x2},${y2} L${x2 - ah * Math.cos(ang - 0.45)},${y2 - ah * Math.sin(ang - 0.45)} M${x2},${y2} L${x2 - ah * Math.cos(ang + 0.45)},${y2 - ah * Math.sin(ang + 0.45)}`} stroke={alpha(t.palette.textPrimary, 0.55)} strokeWidth={Math.max(2, u * 0.3)} strokeLinecap="round" fill="none" /> : null}
              </g>
            );
          })}
        </svg>
        {variant === 'hub' ? (
          <div style={{ position: 'absolute', left: C.x, top: C.y, transform: `translate(-50%,-50%) scale(${overshoot(m, 0.1)})`, width: nodeSize * 1.3, height: nodeSize * 1.3, borderRadius: '50%', background: t.palette.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: u }}>
            {c.center ? <Text text={c.center} role="label" size={3.4} animate="none" color={t.palette.textOnPrimary} maxLines={2} /> : null}
          </div>
        ) : null}
        {c.nodes.map((nd, i) => {
          const k = overshoot(m, 0.2 + i * per);
          return (
            <div key={i} style={{ position: 'absolute', left: pos[i].x, top: pos[i].y, transform: `translate(-50%,-50%) scale(${clamp(k, 0, 1.2)})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 0.8, width: nodeSize * 1.8 }}>
              <div style={{ width: nodeSize, height: nodeSize, borderRadius: nodeSize * 0.28, background: t.palette.surface, border: `${Math.max(2, u * 0.25)}px solid ${alpha(t.palette.primary, 0.7)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {nd.subject ? <Illustration id={nd.subject} size={nodeSize * 0.72} style="flat" draw={progress(m, 0.3 + i * per, 0.6)} /> : <Text text={String(i + 1)} role="title" size={5} animate="none" color={t.palette.primary} maxLines={1} />}
              </div>
              <Text text={nd.label} role="label" size={3.2} animate="none" maxLines={2} />
            </div>
          );
        })}
      </div>
    </Stage>
  );
}

export const diagramFlow = defineScene<DgC>(
  {
    id: 'diagram-flow',
    version: '1.0.0',
    category: 'illustration',
    title: 'Diagram flow',
    description: 'Explains a system/process as nodes and connectors drawn step by step: linear (RTL) / hub / cycle.',
    variants: ['linear', 'hub', 'cycle'],
    defaultVariant: 'linear',
    content: DiagC,
    defaultDuration: 4.4,
    minDuration: 2.6,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'page', 'cut'],
    sfx: [{ at: 0.2, category: 'tick', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['process', 'solution', 'demo', 'feature'],
    energy: 0.45,
    example: { title: 'كيف يعمل', nodes: [{ label: 'اطلب', subject: 'search' }, { label: 'ادفع', subject: 'payment' }, { label: 'استلم', subject: 'delivery' }] },
    editable: ['title'],
    events: (c) => c.nodes.map((_, i) => ({ type: 'card_entry' as const, at: 0.2 + i * 0.45, importance: 0.35 })),
    module: 'illustration',
  },
  DiagramFlow,
);

// ───────────────────────── zero-asset-sequence
const ZeroC = z.object({ lines: z.array(z.string().min(1).max(60)).min(1).max(3), highlight: z.array(z.string()).optional(), seed: z.union([z.string(), z.number()]).optional() });
type ZC = z.infer<typeof ZeroC>;

function ZeroAsset({ content: c, variant }: { content: ZC; variant: string }) {
  const L = useLayout();
  const { tokens: t, spec } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const rng = createRng(`${c.seed ?? spec.project.id}:${variant}`).next;
  const cols = [t.palette.primary, t.palette.secondary, t.palette.accent];
  let art: React.ReactNode;
  if (variant === 'lines') {
    // a few bold sweeping bands
    const bands = Array.from({ length: 4 }, (_, i) => ({ y: 0.2 + rng() * 0.6, w: u * (2 + rng() * 6), ang: -18 + rng() * 36, delay: i * 0.12, col: cols[i % 3] }));
    art = bands.map((b, i) => {
      const k = progress(m, b.delay, 0.9, 'smooth');
      return <div key={i} style={{ position: 'absolute', left: '-20%', width: `${140 * k}%`, top: `${b.y * 100}%`, height: b.w, background: b.col, transform: `rotate(${b.ang}deg)`, transformOrigin: 'right center', opacity: 0.85, borderRadius: b.w }} />;
    });
  } else if (variant === 'orbit') {
    const R = Math.min(L.W, L.H) * 0.42;
    art = Array.from({ length: 3 }, (_, i) => {
      const k = progress(m, i * 0.15, 1.1, 'smooth');
      const r = R * (0.55 + i * 0.22);
      const a = s * (0.25 + i * 0.12) * (i % 2 ? -1 : 1) + rng() * 6;
      return (
        <div key={i} style={{ position: 'absolute', left: L.W / 2 - r, top: L.H / 2 - r, width: r * 2, height: r * 2, borderRadius: '50%', border: `${u * (0.35 + i * 0.1)}px solid ${alpha(cols[i], 0.55)}`, transform: `scale(${k})` }}>
          <div style={{ position: 'absolute', left: r + Math.cos(a) * r - u * 1.6, top: r + Math.sin(a) * r - u * 1.6, width: u * 3.2, height: u * 3.2, borderRadius: '50%', background: cols[i] }} />
        </div>
      );
    });
  } else {
    // shapes: 3–4 large primitives choreographed around the type
    const kinds = ['circle', 'square', 'pill', 'triangle'];
    art = Array.from({ length: 4 }, (_, i) => {
      const size = Math.min(L.W, L.H) * (0.16 + rng() * 0.16);
      const x = (i % 2 ? 0.72 : 0.08) * L.W + rng() * L.W * 0.12;
      const y = (i < 2 ? 0.1 : 0.62) * L.H + rng() * L.H * 0.12;
      const k = overshoot(m, 0.05 + i * 0.1);
      const drift = Math.sin(s * 0.8 + i) * u * 1.2;
      const rot = (rng() - 0.5) * 60 + s * (i % 2 ? 6 : -6);
      const kind = kinds[i % 4];
      const common: React.CSSProperties = { position: 'absolute', left: x, top: y + drift, width: kind === 'pill' ? size * 1.8 : size, height: size, background: cols[i % 3], transform: `scale(${clamp(k, 0, 1.15)}) rotate(${rot}deg)`, opacity: 0.9 };
      if (kind === 'triangle') return <div key={i} style={{ ...common, clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }} />;
      return <div key={i} style={{ ...common, borderRadius: kind === 'circle' || kind === 'pill' ? size : size * 0.18 }} />;
    });
  }
  const per = Math.max(0.6, (durSec - 0.4) / c.lines.length);
  const li = Math.min(c.lines.length - 1, Math.floor(s / per));
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>{art}</div>
      <Stage>
        <Text key={li} text={c.lines[li]} highlight={c.highlight} role="headline" size={9} maxLines={3} shadow />
      </Stage>
    </>
  );
}

export const zeroAssetSequence = defineScene<ZC>(
  {
    id: 'zero-asset-sequence',
    version: '1.0.0',
    category: 'typography',
    title: 'Zero-asset sequence',
    description: 'No images: seeded geometry choreographed around the type — shapes / lines / orbit. Never dotted or patterned backgrounds.',
    variants: ['shapes', 'lines', 'orbit'],
    defaultVariant: 'shapes',
    content: ZeroC,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['shape', 'color-dip', 'cut'],
    sfx: [{ at: 0.1, category: 'whoosh', weight: 0.4 }],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'solution', 'feature', 'cta', 'tease'],
    energy: 0.7,
    example: { lines: ['بدون صور', 'فقط حركة'] },
    editable: ['lines'],
    events: (c, _v, dur) => {
      const per = Math.max(0.6, (dur - 0.4) / c.lines.length);
      return [{ type: 'headline_reveal', at: 0.05, importance: 0.6 }, ...c.lines.slice(1).map((_, i) => ({ type: 'text_reveal' as const, at: (i + 1) * per, importance: 0.4, anchor: 'start' as const }))];
    },
    module: 'zero-asset',
  },
  ZeroAsset,
);

// ───────────────────────── whiteboard
const WbC = z.object({
  title: z.string().max(100).optional(),
  steps: z.array(z.object({ text: z.string().min(1).max(80), subject: SubjectId.optional() })).min(1).max(4),
});
type WC = z.infer<typeof WbC>;
const BOARD = '#FBFAF6';
const INK = '#1D1D22';

function Whiteboard({ content: c, variant }: { content: WC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const n = c.steps.length;
  const per = Math.max(0.9, (durSec - 0.3) / n);
  const land = L.orientation === 'landscape';
  const size = Math.min(land ? L.safe.width / (n + 0.6) : L.safe.width * 0.42, L.safe.height * (land ? 0.42 : 0.2));
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: BOARD }} />
      <Stage gap={u * 3}>
        {c.title ? <Text text={c.title} role="title" size={6.4} color={INK} motion="wipe-reveal" /> : null}
        <div style={{ display: 'flex', flexDirection: land ? 'row-reverse' : 'column', gap: u * 3, alignItems: 'center', justifyContent: 'center', direction: 'ltr' }}>
          {c.steps.map((st, i) => {
            const k = clamp((s - 0.2 - i * per) / (per * 0.8));
            const written = clamp((s - 0.2 - i * per - per * 0.45) / (per * 0.5));
            const show = s >= 0.2 + i * per - 0.05;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: land ? 'column' : 'row-reverse', alignItems: 'center', gap: u * 1.6, opacity: show ? 1 : 0, width: land ? size * 1.15 : L.safe.width * 0.9 }}>
                {variant === 'draw' && st.subject ? <Illustration id={st.subject} size={size} style="line" mono ink={INK} draw={k} /> : null}
                <div style={{ position: 'relative', direction: 'rtl', clipPath: `inset(0 0 0 ${(1 - (variant === 'write' ? k : written)) * 100}%)`, flex: land ? undefined : 1 }}>
                  <Text text={st.text} role={variant === 'write' ? 'title' : 'label'} size={variant === 'write' ? 6 : 3.8} animate="none" color={INK} maxLines={2} align={land ? 'center' : 'start'} />
                  <svg width="100%" height={u * 1.6} viewBox="0 0 100 10" preserveAspectRatio="none" style={{ display: 'block' }}>
                    <path d="M98,6 C70,3 40,8 2,5" fill="none" stroke={t.palette.accent} strokeWidth={2.2} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(((variant === 'write' ? k : written) - 0.6) / 0.4)} vectorEffect="non-scaling-stroke" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      </Stage>
    </>
  );
}

export const whiteboard = defineScene<WC>(
  {
    id: 'whiteboard',
    version: '1.0.0',
    category: 'illustration',
    title: 'Whiteboard',
    description: 'Whiteboard explainer: ink illustrations drawn stroke by stroke with written labels — draw / write.',
    variants: ['draw', 'write'],
    defaultVariant: 'draw',
    content: WbC,
    defaultDuration: 5,
    minDuration: 2.6,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['page', 'push', 'cut'],
    sfx: [{ at: 0.2, category: 'typing', weight: 0.2 }],
    safeArea: 'normal',
    beats: ['problem', 'solution', 'process', 'feature', 'hook', 'cta'],
    energy: 0.35,
    example: { title: 'الفكرة ببساطة', steps: [{ text: 'تطلب', subject: 'search' }, { text: 'ندفع عنك', subject: 'payment' }, { text: 'يوصلك', subject: 'delivery' }] },
    editable: ['title'],
    events: (c, _v, dur) => {
      const per = Math.max(0.9, (dur - 0.3) / c.steps.length);
      return c.steps.map((_, i) => ({ type: 'draw_stroke' as const, at: 0.2 + i * per, importance: 0.4, anchor: 'start' as const }));
    },
    module: 'whiteboard',
  },
  Whiteboard,
);
