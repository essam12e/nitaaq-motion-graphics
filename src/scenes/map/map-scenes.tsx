/**
 * map-story — Map Animation family. Draws ONLY precomputed geometry from the
 * node-side resolver (src/maps/geo.ts → Natural Earth data): the render bundle
 * carries SVG path strings, never GeoJSON. Nothing is placed that the data or
 * the user did not provide. Variants:
 *   focus   — land fades in, the focus area draws its outline and fills, camera settles on it
 *   regions — highlighted regions light up one by one with their labels/values
 *   pins    — pins drop in sequence with labels
 *   route   — routes draw between places (stroke-dashoffset on the precomputed arc)
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
import type { MotionEventDecl } from '../../audio/events';

const Geo = z.object({
  viewBox: z.tuple([z.number(), z.number()]),
  land: z.string(),
  focus: z.object({ id: z.string(), label: z.string(), path: z.string() }).nullable(),
  regions: z.array(z.object({ id: z.string(), label: z.string(), path: z.string(), cx: z.number(), cy: z.number(), value: z.string().optional() })).default([]),
  pins: z.array(z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number(), value: z.string().optional(), capital: z.boolean().default(false) })).default([]),
  routes: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), path: z.string(), length: z.number() })).default([]),
  source: z.string(),
  warnings: z.array(z.string()).default([]),
});
const MapC = z.object({ title: z.string().max(100).optional(), subtitle: z.string().max(140).optional(), geo: Geo });
type MC = z.infer<typeof MapC>;

const step = (n: number, dur: number, start: number) => Math.max(0.25, Math.min(0.8, (dur - start - 0.8) / Math.max(1, n)));

function MapStory({ content: c, variant }: { content: MC; variant: string }) {
  const L = useLayout();
  const { tokens: t } = useVideo();
  const { m, s, durSec } = useSceneTime();
  const u = L.u;
  const g = c.geo;
  const [vw, vh] = g.viewBox;
  const panelW = L.safe.width;
  const panelH = L.safe.height * (c.title ? 0.72 : 0.86);
  const scale = Math.min(panelW / vw, panelH / vh);
  const W = vw * scale;
  const H = vh * scale;
  const landK = progress(m, 0, 0.6, 'smooth');
  const focusK = progress(m, 0.2, 1.1, 'smooth');
  const cam = 1.08 - 0.08 * progress(m, 0, 1.6, 'cinematic');
  const stroke = Math.max(1, 1.2 / scale);
  const ink = t.palette.textPrimary;
  const start = 0.9;
  const regionsStep = step(g.regions.length, durSec, start);
  const pinsStep = step(g.pins.length, durSec, start);
  const routeStep = step(g.routes.length, durSec, start);
  const label = (x: number, y: number, text: string, value: string | undefined, k: number, key: string) => (
    <div key={key} style={{ position: 'absolute', left: x * scale, top: y * scale - u * 5.4, transform: `translate(-50%, ${(1 - k) * u}px)`, opacity: k, whiteSpace: 'nowrap', textAlign: 'center' }}>
      <Text text={text} role="label" size={3.2} animate="none" maxLines={1} />
      {value ? <Text text={value} role="label" size={3} animate="none" color={t.palette.accent} maxLines={1} /> : null}
    </div>
  );
  return (
    <>
    {/* the whole frame is map drawing (context land runs past the svg box): QC must not read coastline islands as a pattern */}
    <div data-qc="box" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
    <Stage gap={u * 2}>
      {c.title ? <Text text={c.title} role="title" size={6.2} /> : null}
      <div style={{ position: 'relative', width: W, height: H, transform: `scale(${cam})` }}>
        <svg width={W} height={H} viewBox={`0 0 ${vw} ${vh}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <path d={g.land} fill={alpha(ink, 0.06 * landK)} stroke={alpha(ink, 0.18 * landK)} strokeWidth={stroke} />
          {g.focus ? (
            <path d={g.focus.path} fill={alpha(t.palette.primary, (variant === 'focus' ? 0.32 : 0.14) * focusK)} stroke={alpha(t.palette.primary, 0.9)} strokeWidth={stroke * 1.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - focusK} />
          ) : null}
          {g.regions.map((r, i) => {
            const k = variant === 'regions' ? progress(m, start + i * regionsStep, 0.5, 'smooth') : variant === 'focus' ? 0 : 0.6 * focusK;
            return <path key={r.id} d={r.path} fill={alpha(t.palette.accent, 0.55 * k)} stroke={alpha(t.palette.accent, k)} strokeWidth={stroke * 1.2} />;
          })}
          {g.routes.map((r, i) => {
            const k = variant === 'route' ? progress(m, start + i * routeStep, Math.min(1.2, routeStep * 1.6), 'smooth') : 0;
            return k > 0 ? <path key={i} d={r.path} fill="none" stroke={t.palette.accent} strokeWidth={stroke * 2.4} strokeLinecap="round" strokeDasharray={r.length} strokeDashoffset={r.length * (1 - k)} /> : null;
          })}
          {g.pins.map((p, i) => {
            const k = variant === 'pins' ? overshoot(m, start + i * pinsStep) : variant === 'route' ? progress(m, start * 0.7 + i * 0.1, 0.4) : variant === 'regions' ? 0 : progress(m, 1 + i * 0.12, 0.4);
            const r = (p.capital ? 9 : 7) / Math.max(0.6, scale);
            return k > 0 ? (
              <g key={p.id} transform={`translate(${p.x},${p.y}) scale(${clamp(k, 0, 1.3)})`}>
                <circle r={r * 2.2} fill={alpha(t.palette.primary, 0.18)} />
                <circle r={r} fill={t.palette.primary} stroke={t.palette.background} strokeWidth={stroke * 1.5} />
              </g>
            ) : null;
          })}
        </svg>
        {variant === 'regions' ? g.regions.map((r, i) => label(r.cx, r.cy + 26, r.label, r.value, progress(m, start + i * regionsStep + 0.2, 0.4), `r${i}`)) : null}
        {variant === 'pins' || variant === 'route' ? g.pins.map((p, i) => label(p.x, p.y, p.label, p.value, variant === 'pins' ? progress(m, start + i * pinsStep + 0.15, 0.4) : progress(m, start * 0.7 + i * 0.1 + 0.2, 0.4), `p${i}`)) : null}
        {variant === 'focus' && g.focus ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: -u * 6, opacity: progress(m, 1, 0.5) }}><Text text={g.focus.label} role="subtitle" animate="none" maxLines={1} /></div> : null}
      </div>
      {c.subtitle ? <Text text={c.subtitle} role="body" delay={1.2} maxLines={2} /> : null}
      <div style={{ position: 'absolute', bottom: L.safe.y + u, insetInlineStart: L.safe.x, opacity: 0.55 }}>
        <Text text={`المصدر: ${g.source}`} role="caption" size={2.4} animate="none" maxLines={1} align="start" />
      </div>
    </Stage>
    </>
  );
}

export const mapStory = defineScene<MC>(
  {
    id: 'map-story',
    version: '1.0.0',
    category: 'map',
    title: 'Map story',
    description: 'Animated map from bundled Natural Earth geometry (Saudi regions, countries, places) — focus / regions / pins / route. Places without data are never guessed.',
    variants: ['focus', 'regions', 'pins', 'route'],
    defaultVariant: 'pins',
    content: MapC,
    defaultDuration: 5,
    minDuration: 2.8,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['camera-push', 'crossfade', 'cut'],
    sfx: [{ at: 0.2, category: 'sweep', weight: 0.3 }],
    safeArea: 'normal',
    beats: ['map', 'proof', 'feature'],
    energy: 0.5,
    example: {
      title: 'نغطي المملكة',
      geo: { viewBox: [1000, 1000], land: 'M100,100L900,100L900,900L100,900Z', focus: null, regions: [], pins: [{ id: 'a', label: 'الرياض', x: 560, y: 480, capital: true }], routes: [], source: 'Natural Earth', warnings: [] },
    },
    editable: ['title', 'subtitle'],
    validate: (c) => (c.geo.warnings.length ? c.geo.warnings.map((w) => ({ path: 'geo', severity: 'warning' as const, message: w })) : []),
    events: (c, v, dur) => {
      const ev: MotionEventDecl[] = [{ type: 'camera_move', at: 0, importance: 0.3 }];
      const n = v === 'regions' ? c.geo.regions.length : v === 'pins' ? c.geo.pins.length : v === 'route' ? c.geo.routes.length : 0;
      const st = step(n, dur, 0.9);
      for (let i = 0; i < n; i++) ev.push({ type: v === 'route' ? 'map_route' : v === 'regions' ? 'ui_appear' : 'map_pin', at: 0.9 + i * st, importance: v === 'route' ? 0.5 : 0.45 });
      if (v === 'focus') ev.push({ type: 'draw_stroke', at: 0.2, importance: 0.4 });
      return ev;
    },
    module: 'map',
  },
  MapStory,
);
