/**
 * Flow families — product stories told with STATE, not cuts:
 *   state-flow       one shared element morphs logo → search → result → product → cart → checkout → success
 *   workflow         connected steps light up in order (automation / process)
 *   integration-hub  your product at the centre, connected apps attach one by one
 *   data-table       a table assembles row by row; one row is emphasised
 *   order-success    order placed: check, order number, delivery time, next action
 *   product-details  the user's product with callouts pointing at real features
 *   form-fill        fields fill in, submit, confirmed
 *   landing-page     a landing page built from the user's words (or their screenshot) in a browser
 */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { BrowserFrame, useUiPalette } from '../../components/Mockups';
import { Media, fitBox, useAspect } from '../../components/Media';
import { Cursor } from '../../components/Cursor';
import { Icon } from '../../components/Icon';
import { Surface } from '../../components/Surface';
import { clamp, lerp, motionFor, EASE } from '../../motion/primitives';
import { alpha, bestTextOn, mix } from '../../brand/color';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);

// ════════════════════════════════════════════════════════════════════ state-flow
const STATE_KINDS = ['logo', 'search', 'result', 'product', 'cart', 'checkout', 'success'] as const;
const StateFlowC = Heading.extend({
  states: z
    .array(
      z.object({
        kind: z.enum(STATE_KINDS),
        label: z.string().min(1).max(40),
        /** search query, price, item count, order total … */
        value: z.string().max(40).optional(),
        /** asset id / path (product image or logo) — shown unchanged */
        image: z.string().optional(),
        items: z.array(z.string().max(32)).max(3).optional(),
      }),
    )
    .min(2)
    .max(7),
});
type SFC = z.infer<typeof StateFlowC>;

interface Geo {
  w: number;
  h: number;
  r: number;
}
const GEO: Record<(typeof STATE_KINDS)[number], Geo> = {
  logo: { w: 30, h: 30, r: 15 },
  search: { w: 82, h: 13, r: 6.5 },
  result: { w: 82, h: 46, r: 4 },
  product: { w: 62, h: 70, r: 5 },
  cart: { w: 76, h: 15, r: 7.5 },
  checkout: { w: 82, h: 54, r: 4 },
  success: { w: 34, h: 34, r: 17 },
};

export const stateFlow = defineScene<SFC>(
  {
    id: 'state-flow',
    version: '1.0.0',
    category: 'ui',
    title: 'State flow (shared element)',
    description: 'One shared element morphs through product states (logo → search → result → product → cart → checkout → success). Continuity instead of cuts: the eye never loses the subject.',
    variants: ['morph', 'morph-trail'],
    defaultVariant: 'morph',
    content: StateFlowC,
    defaultDuration: 7,
    minDuration: 3.5,
    maxDuration: 16,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in'],
    sfx: [
      { at: 0.2, category: 'pop', weight: 0.5 },
      { at: 1.6, category: 'typing', weight: 0.35 },
      { at: 3.2, category: 'click', weight: 0.4 },
      { at: 5.2, category: 'success', weight: 0.6 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'solution', 'process', 'product'],
    energy: 0.6,
    cost: 'MEDIUM',
    motion: { elements: ['card', 'button', 'icon', 'text'], jobs: ['connect-states', 'show-how-it-works'] },
    example: {
      title: 'من البحث إلى الطلب في ثواني',
      highlight: ['ثواني'],
      states: [
        { kind: 'search', label: 'ابحث', value: 'عطر عود' },
        { kind: 'result', label: 'النتائج', items: ['عود ملكي', 'مسك أبيض', 'عنبر'] },
        { kind: 'product', label: 'عطر العود الملكي', value: '249 ر.س', image: 'lib:demo/product.png' },
        { kind: 'cart', label: 'أضفته للسلة', value: '1' },
        { kind: 'checkout', label: 'الدفع', value: '249 ر.س', items: ['الشحن مجاني', 'الدفع عند الاستلام'] },
        { kind: 'success', label: 'تم الطلب' },
      ],
    },
    editable: ['title', 'subtitle'],
    validate: (c) => (c.states.filter((s) => s.kind === 'product' && !s.image).length ? [{ path: 'content.states', message: 'a product state without an image shows the name only (no invented product photo)', severity: 'warning' }] : []),
  },
  ({ content: c, variant }) => {
    const { m, s, durSec } = useSceneTime();
    const ui = useUiPalette();
    const { canvas, tokens: t, fonts } = useVideo();
    const n = c.states.length;
    const seg = Math.max(0.9, (durSec - 0.5) / n);
    const idx = Math.min(n - 1, Math.floor(clamp(s - 0.15, 0, durSec) / seg));
    return (
      <HeroSplit
        heading={heading(c)}
        headingShare={canvas.orientation === 'landscape' ? 0.4 : 0.24}
        visual={(w, h) => {
          const k = Math.min(w / 90, h / 82);
          const geoAt = (i: number) => GEO[c.states[Math.max(0, Math.min(n - 1, i))].kind];
          // morph progress from the previous state into the current one (physics of a card)
          const p = idx === 0 ? motionFor(m, 'card', 0.1, 0.6) : motionFor(m, 'card', idx * seg + 0.15, 0.65);
          const a = geoAt(idx === 0 ? 0 : idx - 1);
          const b = geoAt(idx);
          const g = idx === 0 ? { w: b.w * (0.7 + 0.3 * p), h: b.h * (0.7 + 0.3 * p), r: b.r } : { w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p), r: lerp(a.r, b.r, p) };
          const st = c.states[idx];
          const inner = clamp((p - 0.45) / 0.45);
          const W = g.w * k;
          const H = g.h * k;
          const fs = (x: number) => (x * k) / canvas.u;
          const body = (() => {
            switch (st.kind) {
              case 'logo':
                return st.image ? <Media src={st.image} role="logo" width={W * 0.62} height={H * 0.62} fit="contain" /> : <Text text={st.label} role="title" size={fs(6)} maxWidth={W * 0.8} maxLines={2} animate="none" color={ui.text} />;
              case 'search': {
                const q = st.value ?? st.label;
                const typed = q.slice(0, Math.round(q.length * clamp((s - idx * seg - 0.5) / 0.9)));
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: k * 2.5, width: '100%', padding: `0 ${k * 4}px` }}>
                    <Icon name="Search" size={k * 5} color={ui.muted} treatment="plain" />
                    <div style={{ flex: 1, display: 'flex' }}>
                      <Text text={typed || ' '} role="body" size={fs(4.4)} maxWidth={W * 0.7} maxLines={1} animate="none" align="start" color={ui.text} />
                    </div>
                  </div>
                );
              }
              case 'result':
              case 'checkout': {
                const rows = st.items ?? [st.label];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: k * 2.4, width: '100%', padding: k * 4.5 }}>
                    <Text text={st.label} role="label" size={fs(3.6)} maxWidth={W * 0.85} maxLines={1} animate="none" align="start" color={ui.muted} />
                    {rows.map((r, i) => {
                      const ri = clamp((p - 0.5 - i * 0.12) / 0.3);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: k * 2.4, height: k * 9, padding: `0 ${k * 2.4}px`, borderRadius: k * 2.2, background: i === 0 ? alpha(ui.primary, 0.12) : ui.panel, opacity: ri, transform: `translateY(${(1 - ri) * k * 3}px)` }}>
                          <div style={{ width: k * 5, height: k * 5, borderRadius: k * 1.4, background: i === 0 ? ui.primary : alpha(ui.text, 0.12) }} />
                          <div style={{ flex: 1, display: 'flex' }}>
                            <Text text={r} role="body" size={fs(3.8)} maxWidth={W * 0.6} maxLines={1} animate="none" align="start" color={ui.text} />
                          </div>
                        </div>
                      );
                    })}
                    {st.kind === 'checkout' ? (
                      <div style={{ marginTop: k * 1.5, height: k * 9.5, borderRadius: k * 4.75, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: k * 2 }}>
                        <Text text={st.value ?? st.label} role="cta" size={fs(4.2)} maxWidth={W * 0.7} maxLines={1} animate="none" color={ui.onPrimary} critical />
                      </div>
                    ) : null}
                  </div>
                );
              }
              case 'product':
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: k * 2.5, padding: k * 4 }}>
                    {st.image ? <Media src={st.image} role="product" width={W * 0.78} height={H * 0.55} fit="contain" /> : <Icon name="Package" size={k * 14} color={ui.primary} />}
                    <Text text={st.label} role="title" size={fs(5)} maxWidth={W * 0.85} maxLines={2} animate="none" color={ui.text} />
                    {st.value ? <span style={{ fontFamily: fonts.latin, fontSize: k * 4.6, fontWeight: 700, color: ui.primary, direction: 'ltr' }}>{st.value}</span> : null}
                  </div>
                );
              case 'cart':
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: `0 ${k * 5}px` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: k * 2.5 }}>
                      <div style={{ position: 'relative' }}>
                        <Icon name="ShoppingBag" size={k * 6} color={ui.onPrimary} treatment="plain" />
                        <div style={{ position: 'absolute', top: -k * 1.6, insetInlineEnd: -k * 2, minWidth: k * 4.4, height: k * 4.4, borderRadius: k * 2.2, background: ui.accent, color: '#fff', fontSize: k * 2.8, fontFamily: fonts.latin, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * EASE.out(inner)})` }}>{st.value ?? '1'}</div>
                      </div>
                      <Text text={st.label} role="cta" size={fs(4.4)} maxWidth={W * 0.62} maxLines={1} animate="none" color={ui.onPrimary} align="start" />
                    </div>
                    <Icon name="ArrowLeft" size={k * 5} color={ui.onPrimary} treatment="plain" />
                  </div>
                );
              case 'success':
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: k * 1.5 }}>
                    <div style={{ transform: `scale(${0.5 + 0.5 * EASE.out(inner)})` }}>
                      <Icon name="Check" size={k * 14} color={ui.onPrimary} treatment="plain" stroke={3} />
                    </div>
                  </div>
                );
            }
          })();
          const filled = st.kind === 'cart' || st.kind === 'success';
          const prevFilled = idx > 0 && (c.states[idx - 1].kind === 'cart' || c.states[idx - 1].kind === 'success');
          const fill = idx === 0 ? (filled ? 1 : 0) : lerp(prevFilled ? 1 : 0, filled ? 1 : 0, p);
          const bg = mix(ui.page, ui.primary, fill);
          return (
            <div style={{ position: 'relative', width: w, height: h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: k * 5 }}>
              {variant === 'morph-trail' ? (
                <div style={{ display: 'flex', gap: k * 2 }}>
                  {c.states.map((x, i) => (
                    <div key={i} style={{ width: i === idx ? k * 7 : k * 2.2, height: k * 2.2, borderRadius: k * 1.1, background: i <= idx ? t.palette.primary : alpha(t.palette.textPrimary, 0.2) }} />
                  ))}
                </div>
              ) : null}
              <div
                data-qc-box="state-flow"
                style={{
                  width: W,
                  height: H,
                  borderRadius: g.r * k,
                  background: bg,
                  boxShadow: `0 ${k * 3}px ${k * 10}px ${alpha('#000', t.mode === 'dark' ? 0.45 : 0.14)}`,
                  border: `1px solid ${ui.line}`,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div style={{ opacity: inner, transform: `translateY(${(1 - inner) * k * 2}px)`, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{body}</div>
              </div>
              {st.kind !== 'cart' && st.kind !== 'result' && st.kind !== 'checkout' ? (
                <div style={{ opacity: inner }}>
                  <Text text={st.kind === 'search' ? st.label : st.kind === 'product' ? st.value ?? '' : st.label} role="caption" size={fs(4.6)} maxWidth={w * 0.9} maxLines={1} animate="none" color={t.palette.textPrimary} />
                </div>
              ) : null}
            </div>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ workflow
const WorkflowC = Heading.extend({
  steps: z.array(z.object({ label: z.string().min(1).max(36), icon: z.string().optional() })).min(3).max(6),
});
type WFC = z.infer<typeof WorkflowC>;
export const workflow = defineScene<WFC>(
  {
    id: 'workflow',
    version: '1.0.0',
    category: 'infographic',
    title: 'Workflow / automation',
    description: 'Connected steps light up one after another along a drawn path — automations, pipelines, "how it works".',
    variants: ['path', 'stack'],
    defaultVariant: 'path',
    content: WorkflowC,
    defaultDuration: 5.5,
    minDuration: 3,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['slide', 'crossfade'],
    sfx: [
      { at: 0.4, category: 'tick', weight: 0.4 },
      { at: 2.2, category: 'digital', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['process', 'demo', 'solution'],
    energy: 0.5,
    cost: 'LOW',
    motion: { elements: ['card', 'icon'], jobs: ['guide-through-steps'] },
    aspectVariants: { landscape: ['path'], portrait: ['stack', 'path'], square: ['stack'] },
    example: { title: 'أتمتة كاملة بدون تدخل', steps: [{ label: 'طلب جديد', icon: 'Inbox' }, { label: 'تأكيد تلقائي', icon: 'CircleCheck' }, { label: 'فاتورة', icon: 'Receipt' }, { label: 'إشعار للعميل', icon: 'Bell' }] },
    editable: ['title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const { m, s, durSec } = useSceneTime();
    const { canvas, tokens: t } = useVideo();
    const n = c.steps.length;
    const landscape = canvas.orientation === 'landscape';
    // a horizontal path only reads at ≤3 steps; longer flows stack (bigger, legible nodes)
    const horizontal = variant === 'path' && landscape && n <= 3;
    const per = Math.max(0.45, (durSec - 1.2) / n);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          // nodes + connectors + flex gaps must fit: n·0.95 + (n−1)·0.54 node widths
          const node = horizontal ? Math.min((w * 0.96) / (0.95 * n + 0.54 * (n - 1)), h * 0.5) : Math.min(h / (n * 0.82 + (n - 1) * 0.36), w * 0.8);
          const k = node / 100;
          return (
            <div style={{ position: 'relative', display: 'flex', flexDirection: horizontal ? 'row' : 'column', alignItems: 'center', gap: horizontal ? node * 0.18 : node * 0.12 }}>
              {c.steps.map((st, i) => {
                const at = 0.3 + i * per;
                const on = motionFor(m, 'card', at, 0.55);
                const lit = clamp((s - at - 0.2) / 0.3) * (i === n - 1 || s < at + per + 0.2 ? 1 : 0.55);
                const link = i < n - 1 ? clamp((s - at - 0.35) / (per * 0.7)) : 0;
                return (
                  <React.Fragment key={i}>
                    <Surface qc="workflow" radius={3.2} style={{ width: horizontal ? node * 0.95 : Math.min(w * 0.82, node * 3.4), height: horizontal ? node * 0.95 : node * 0.82, display: 'flex', flexDirection: horizontal ? 'column' : 'row', alignItems: 'center', justifyContent: horizontal ? 'center' : 'flex-start', gap: k * 10, padding: k * 12, opacity: on, transform: `scale(${0.9 + 0.1 * on})`, border: `${Math.max(1, k * 2)}px solid ${alpha(t.palette.primary, 0.2 + 0.8 * lit)}` }}>
                      <Icon name={st.icon ?? 'Circle'} size={k * 26} color={lit > 0.5 ? t.palette.primary : t.palette.textSecondary} />
                      <Text text={st.label} role="label" size={(k * (horizontal ? 13 : 15)) / canvas.u} maxWidth={horizontal ? node * 0.85 : node * 2.4} maxLines={2} animate="none" align={horizontal ? 'center' : 'start'} color={t.palette.textPrimary} />
                    </Surface>
                    {i < n - 1 ? (
                      <div style={{ position: 'relative', width: horizontal ? node * 0.18 : Math.max(2, k * 3), height: horizontal ? Math.max(2, k * 3) : node * 0.12, background: alpha(t.palette.textPrimary, 0.15), borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: 0, background: t.palette.primary, transformOrigin: horizontal ? 'right' : 'top', transform: horizontal ? `scaleX(${link})` : `scaleY(${link})` }} />
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </div>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ integration-hub
const HubC = Heading.extend({
  center: z.string().min(1).max(30),
  centerLogo: z.string().optional(),
  apps: z.array(z.object({ label: z.string().min(1).max(20), icon: z.string().optional() })).min(3).max(8),
});
type HC = z.infer<typeof HubC>;
export const integrationHub = defineScene<HC>(
  {
    id: 'integration-hub',
    version: '1.0.0',
    category: 'ui',
    title: 'Integration hub',
    description: 'Your product in the centre; connected tools attach one by one along drawn links. No third-party logos are drawn — tools are named and shown with neutral icons.',
    variants: ['orbit', 'columns'],
    defaultVariant: 'orbit',
    content: HubC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'pop', weight: 0.4 },
      { at: 1.4, category: 'click', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['feature', 'demo', 'solution'],
    energy: 0.55,
    cost: 'LOW',
    motion: { elements: ['card', 'icon', 'logo'], jobs: ['connect', 'show-ecosystem'] },
    example: { title: 'يتكامل مع أدواتك', center: 'منصتك', apps: [{ label: 'المتجر', icon: 'Store' }, { label: 'الدفع', icon: 'CreditCard' }, { label: 'الشحن', icon: 'Truck' }, { label: 'المحاسبة', icon: 'Calculator' }, { label: 'واتساب', icon: 'MessageCircle' }, { label: 'البريد', icon: 'Mail' }] },
    editable: ['title', 'subtitle', 'center'],
  },
  ({ content: c, variant }) => {
    const { m, s } = useSceneTime();
    const { canvas, tokens: t } = useVideo();
    const n = c.apps.length;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const R = Math.min(w, h) * 0.36;
          const k = Math.min(w, h) / 100;
          const cx = w / 2;
          const cy = h / 2;
          const hub = motionFor(m, 'logo', 0.1, 0.7);
          const pos = (i: number) => {
            if (variant === 'columns') {
              const side = i % 2 === 0 ? 1 : -1;
              const row = Math.floor(i / 2);
              const rows = Math.ceil(n / 2);
              return { x: cx + side * Math.min(w * 0.36, R * 1.1), y: cy + (row - (rows - 1) / 2) * Math.min(h / rows, k * 24) };
            }
            const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
            return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
          };
          return (
            <div style={{ position: 'relative', width: w, height: h }}>
              <svg width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
                {c.apps.map((_, i) => {
                  const p = pos(i);
                  const at = 0.5 + i * 0.22;
                  const d = clamp((s - at) / 0.45);
                  return <line key={i} x1={cx} y1={cy} x2={lerp(cx, p.x, d)} y2={lerp(cy, p.y, d)} stroke={alpha(t.palette.primary, 0.55)} strokeWidth={Math.max(1.5, k * 0.5)} strokeLinecap="round" />;
                })}
              </svg>
              {c.apps.map((a, i) => {
                const p = pos(i);
                const on = motionFor(m, 'icon', 0.75 + i * 0.22, 0.5);
                return (
                  <div key={i} style={{ position: 'absolute', left: p.x, top: p.y, transform: `translate(-50%,-50%) scale(${0.6 + 0.4 * on})`, opacity: on, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: k * 1.2 }}>
                    <Surface qc="hub-app" radius={3} style={{ width: k * 15, height: k * 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={a.icon ?? 'Plug'} size={k * 6.5} color={t.palette.primary} treatment="plain" />
                    </Surface>
                    <Text text={a.label} role="label" size={(k * 3.6) / canvas.u} maxWidth={k * 26} maxLines={1} animate="none" color={t.palette.textPrimary} />
                  </div>
                );
              })}
              <div style={{ position: 'absolute', left: cx, top: cy, transform: `translate(-50%,-50%) scale(${0.7 + 0.3 * hub})`, opacity: hub }}>
                <Surface qc="hub-center" tone="primary" radius={6} glow={0.5} style={{ width: k * 26, height: k * 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: k * 3 }}>
                  {c.centerLogo ? <Media src={c.centerLogo} role="logo" width={k * 18} height={k * 18} fit="contain" /> : <Text text={c.center} role="title" size={(k * 5) / canvas.u} maxWidth={k * 21} maxLines={2} animate="none" color={t.palette.textOnPrimary} />}
                </Surface>
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ data-table
const TableC = Heading.extend({
  columns: z.array(z.string().min(1).max(20)).min(2).max(4),
  rows: z.array(z.array(z.string().max(24))).min(2).max(6),
  highlightRow: z.number().int().min(0).optional(),
  source: z.string().optional(),
});
type TC = z.infer<typeof TableC>;
export const dataTable = defineScene<TC>(
  {
    id: 'data-table',
    version: '1.0.0',
    category: 'data',
    title: 'Data table',
    description: 'A clean table assembles row by row; one row is emphasised. Numbers only from the user (with a source).',
    variants: ['rows', 'highlight'],
    defaultVariant: 'rows',
    content: TableC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['slide', 'crossfade'],
    sfx: [{ at: 0.4, category: 'tick', weight: 0.35 }],
    safeArea: 'normal',
    beats: ['data', 'proof', 'comparison'],
    energy: 0.4,
    cost: 'LOW',
    motion: { elements: ['card', 'text', 'number'], jobs: ['make-the-number-land'] },
    example: { title: 'الباقات', columns: ['الباقة', 'المستخدمين', 'السعر'], rows: [['أساسية', '3', '49'], ['احترافية', '10', '99'], ['أعمال', 'غير محدود', '199']], highlightRow: 1 },
    editable: ['title', 'subtitle'],
    validate: (c) => (c.rows.some((r) => r.some((x) => /\d+\s*%/.test(x))) && !c.source ? [{ path: 'content.source', message: 'percentages in a table need a source (no invented statistics)', severity: 'error' }] : []),
  },
  ({ content: c, variant }) => {
    const { m, s } = useSceneTime();
    const { canvas, tokens: t, fonts } = useVideo();
    const ui = useUiPalette();
    const hl = c.highlightRow ?? (variant === 'highlight' ? 0 : -1);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const tw = Math.min(w, h * 1.4);
          const rowH = Math.min(h / (c.rows.length + 1.6), tw * 0.13);
          const k = rowH / 10;
          const cols = c.columns.length;
          const cell = (x: string, i: number, color: string, weight: number) => {
            const numeric = /^[\d.,%+\-\s$€£ر.س]+$/.test(x);
            return (
              <div key={i} style={{ flex: i === 0 ? 1.4 : 1, display: 'flex', justifyContent: i === 0 ? 'flex-start' : 'center' }}>
                {numeric ? <span style={{ fontFamily: fonts.latin, fontSize: k * 3.6, fontWeight: weight, color, direction: 'ltr' }}>{x}</span> : <Text text={x} role="body" size={(k * 3.4) / canvas.u} maxWidth={(tw / cols) * 0.9} maxLines={1} animate="none" align={i === 0 ? 'start' : 'center'} color={color} weight={weight} />}
              </div>
            );
          };
          const head = motionFor(m, 'panel', 0.1, 0.6);
          return (
            <Surface qc="data-table" radius={3} style={{ width: tw, padding: `${k * 2}px ${k * 4}px`, opacity: head, transform: `translateY(${(1 - head) * k * 4}px)` }}>
              <div style={{ display: 'flex', height: rowH, alignItems: 'center', borderBottom: `1px solid ${ui.line}` }}>{c.columns.map((x, i) => cell(x, i, t.palette.textSecondary, 600))}</div>
              {c.rows.map((r, ri) => {
                const on = motionFor(m, 'card', 0.45 + ri * 0.18, 0.5);
                const em = ri === hl ? clamp((s - 0.45 - c.rows.length * 0.18 - 0.3) / 0.4) : 0;
                return (
                  <div key={ri} style={{ display: 'flex', height: rowH, alignItems: 'center', opacity: on, transform: `translateX(${(1 - on) * k * 6}px) scale(${1 + em * 0.03})`, borderRadius: k * 2, background: alpha(t.palette.primary, 0.14 * em), borderBottom: ri < c.rows.length - 1 ? `1px solid ${ui.line}` : 'none' }}>
                    {r.slice(0, cols).map((x, i) => cell(x, i, em > 0.5 && i > 0 ? t.palette.primary : t.palette.textPrimary, em > 0.5 ? 700 : 500))}
                  </div>
                );
              })}
            </Surface>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ order-success
const OrderC = z.object({
  title: z.string().min(1).max(80),
  orderId: z.string().max(24).optional(),
  eta: z.string().max(60).optional(),
  button: z.string().max(28).optional(),
});
type OC = z.infer<typeof OrderC>;
export const orderSuccess = defineScene<OC>(
  {
    id: 'order-success',
    version: '1.0.0',
    category: 'commerce',
    title: 'Order success',
    description: 'The payoff state: a check that draws itself, the order number, delivery time and the next action.',
    variants: ['card', 'full'],
    defaultVariant: 'card',
    content: OrderC,
    defaultDuration: 3.5,
    minDuration: 2.2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade'],
    sfx: [{ at: 0.35, category: 'success', weight: 0.7 }],
    safeArea: 'normal',
    beats: ['solution', 'cta', 'proof'],
    energy: 0.55,
    cost: 'LOW',
    motion: { elements: ['icon', 'card', 'button'], jobs: ['resolve', 'reward'] },
    example: { title: 'تم استلام طلبك', orderId: '#10482', eta: 'يوصلك بكرة قبل الساعة 5', button: 'تتبّع الطلب' },
    editable: ['title', 'orderId', 'eta', 'button'],
  },
  ({ content: c, variant }) => {
    const { m, s } = useSceneTime();
    const { canvas, tokens: t, fonts } = useVideo();
    const u = canvas.u;
    const size = Math.min(canvas.safe.width, canvas.safe.height) / 100;
    const ring = motionFor(m, 'icon', 0.1, 0.6);
    const draw = clamp((s - 0.35) / 0.45);
    const text = motionFor(m, 'text', 0.6, 0.6);
    const card = variant === 'card';
    const inner = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 4 }}>
        <div style={{ width: size * 30, height: size * 30, borderRadius: '50%', background: t.palette.positive ?? t.palette.primary, transform: `scale(${ring})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 ${size * 3 * ring}px ${alpha(t.palette.positive ?? t.palette.primary, 0.18)}` }}>
          <svg width={size * 16} height={size * 16} viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={bestTextOn(t.palette.positive ?? t.palette.primary)} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={24} strokeDashoffset={24 * (1 - draw)} />
          </svg>
        </div>
        <div style={{ opacity: text, transform: `translateY(${(1 - text) * u * 2}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 2 }}>
          <Text text={c.title} role="headline" size={7} maxWidth={canvas.safe.width * 0.85} maxLines={2} animate="none" />
          {c.orderId ? <span style={{ fontFamily: fonts.latin, fontSize: size * 4.2, color: t.palette.textSecondary, direction: 'ltr', letterSpacing: 1 }}>{c.orderId}</span> : null}
          {c.eta ? <Text text={c.eta} role="subtitle" maxWidth={canvas.safe.width * 0.8} maxLines={2} animate="none" color={t.palette.textSecondary} /> : null}
        </div>
        {c.button ? (
          <div data-qc-cta="1" style={{ opacity: motionFor(m, 'button', 1.1, 0.5), padding: `${size * 2.6}px ${size * 7}px`, borderRadius: 999, background: t.palette.primary }}>
            <Text text={c.button} role="cta" animate="none" color={t.palette.textOnPrimary} critical maxWidth={canvas.safe.width * 0.7} maxLines={1} />
          </div>
        ) : null}
      </div>
    );
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {card ? (
          <Surface qc="order-card" radius={4} style={{ padding: `${size * 9}px ${size * 8}px`, width: Math.min(canvas.safe.width, size * 120) }}>
            {inner}
          </Surface>
        ) : (
          inner
        )}
      </div>
    );
  },
);

// ════════════════════════════════════════════════════════════════════ product-details
const DetailsC = Heading.extend({
  image: z.string().min(1),
  name: z.string().max(60).optional(),
  specs: z.array(z.string().min(1).max(36)).min(2).max(4),
  price: z.string().max(24).optional(),
});
type PDC = z.infer<typeof DetailsC>;
export const productDetails = defineScene<PDC>(
  {
    id: 'product-details',
    version: '1.0.0',
    category: 'commerce',
    title: 'Product details',
    description: "The user's product (unchanged) with callouts that draw out to its real features, one by one.",
    variants: ['callouts', 'list'],
    defaultVariant: 'callouts',
    content: DetailsC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'whoosh', weight: 0.4 },
      { at: 1.2, category: 'pop', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['product', 'feature'],
    energy: 0.5,
    cost: 'MEDIUM',
    requiresAssets: ['image'],
    motion: { elements: ['product', 'card', 'text'], jobs: ['show-the-product', 'sequence-benefits'] },
    example: { name: 'سماعة برو', image: 'lib:demo/product.png', specs: ['عزل ضوضاء نشط', 'بطارية 30 ساعة', 'مقاومة للماء'], price: '399 ر.س' },
    editable: ['name', 'price'],
  },
  ({ content: c, variant }) => {
    const { m, s } = useSceneTime();
    const { canvas, tokens: t, dir } = useVideo();
    const ar = useAspect(c.image, 1);
    const landscape = canvas.orientation === 'landscape';
    return (
      <HeroSplit
        heading={c.title ? heading(c) : c.name ? { title: c.name } : undefined}
        headingShare={landscape ? 0.34 : 0.2}
        visual={(w, h) => {
          const k = Math.min(w, h) / 100;
          const side = landscape || variant === 'list';
          const imgBox = fitBox(ar, side ? w * 0.48 : w * 0.8, side ? h * 0.85 : h * 0.52);
          const enter = motionFor(m, 'product', 0.05, 0.8);
          const specs = c.specs.map((sp, i) => {
            const on = motionFor(m, 'card', 0.7 + i * 0.32, 0.5);
            const line = clamp((s - 0.6 - i * 0.32) / 0.35);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: k * 2, opacity: on, transform: `translateX(${(dir === 'rtl' ? -1 : 1) * (1 - on) * k * 4}px)` }}>
                <div style={{ width: k * 7 * line, height: Math.max(2, k * 0.5), background: t.palette.primary, borderRadius: 99 }} />
                <Surface qc="spec" radius={2.4} style={{ padding: `${k * 1.8}px ${k * 3}px`, display: 'flex', alignItems: 'center', gap: k * 1.6 }}>
                  <Icon name="Check" size={k * 3.6} color={t.palette.primary} treatment="plain" />
                  <Text text={sp} role="label" size={(k * 3.8) / canvas.u} maxWidth={side ? w * 0.4 : w * 0.7} maxLines={1} animate="none" align="start" color={t.palette.textPrimary} />
                </Surface>
              </div>
            );
          });
          return (
            <div style={{ display: 'flex', flexDirection: side ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: k * 5, width: w, height: h }}>
              <div style={{ opacity: clamp(enter * 1.4), transform: `scale(${0.9 + 0.1 * enter})` }}>
                <Media src={c.image} role="product" width={imgBox.width} height={imgBox.height} fit="contain" shadow />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: k * 2.4, alignItems: 'flex-start' }}>
                {specs}
                {c.price ? (
                  <div style={{ opacity: motionFor(m, 'number', 0.8 + c.specs.length * 0.32, 0.5), marginTop: k * 1.5 }}>
                    <Text text={c.price} role="number" size={(k * 7) / canvas.u} animate="none" color={t.palette.primary} maxWidth={w * 0.5} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ form-fill
const FormC = Heading.extend({
  fields: z.array(z.object({ label: z.string().min(1).max(24), value: z.string().min(1).max(36) })).min(1).max(4),
  button: z.string().min(1).max(24),
  done: z.string().max(40).optional(),
});
type FC = z.infer<typeof FormC>;
export const formFill = defineScene<FC>(
  {
    id: 'form-fill',
    version: '1.0.0',
    category: 'ui',
    title: 'Form fill',
    description: 'Fields fill in one by one, the button is pressed, the form confirms — sign-up, booking, request flows.',
    variants: ['card', 'phone'],
    defaultVariant: 'card',
    content: FormC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['slide', 'crossfade'],
    sfx: [
      { at: 0.6, category: 'typing', weight: 0.4 },
      { at: 3.4, category: 'click', weight: 0.45 },
      { at: 3.9, category: 'success', weight: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'process', 'cta'],
    energy: 0.45,
    cost: 'LOW',
    motion: { elements: ['card', 'text', 'button', 'cursor'], jobs: ['show-how-it-works'] },
    example: { title: 'احجز موعدك بثواني', fields: [{ label: 'الاسم', value: 'سارة' }, { label: 'الجوال', value: '05x xxx xxxx' }, { label: 'الموعد', value: 'الخميس 7:30 م' }], button: 'تأكيد الحجز', done: 'تم الحجز' },
    editable: ['title', 'subtitle', 'button', 'done'],
  },
  ({ content: c }) => {
    const { m, s, durSec } = useSceneTime();
    const { canvas, tokens: t } = useVideo();
    const ui = useUiPalette();
    const n = c.fields.length;
    const per = Math.min(0.9, (durSec - 1.8) / (n + 1));
    const press = 0.4 + n * per + 0.2;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const fw = Math.min(w * 0.86, h * 0.9);
          const k = fw / 100;
          const card = motionFor(m, 'panel', 0.05, 0.6);
          const done = clamp((s - press - 0.35) / 0.4);
          const btnBg = done > 0.5 ? t.palette.positive ?? ui.primary : ui.primary;
          const btnFg = btnBg === ui.primary ? ui.onPrimary : bestTextOn(btnBg);
          return (
            <div style={{ position: 'relative' }}>
              <Surface qc="form" radius={3.5} style={{ width: fw, padding: k * 6, display: 'flex', flexDirection: 'column', gap: k * 4, opacity: card, transform: `translateY(${(1 - card) * k * 5}px)` }}>
                {c.fields.map((f, i) => {
                  const at = 0.4 + i * per;
                  const typed = f.value.slice(0, Math.round(f.value.length * clamp((s - at) / (per * 0.75))));
                  const focus = s >= at && s < at + per ? 1 : 0;
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: k * 1.5 }}>
                      <Text text={f.label} role="label" size={(k * 3.6) / canvas.u} maxWidth={fw * 0.8} maxLines={1} animate="none" align="start" color={ui.muted} />
                      <div style={{ height: k * 11, borderRadius: k * 2.4, border: `${Math.max(1, k * 0.35)}px solid ${focus ? ui.primary : ui.line}`, background: ui.panel, display: 'flex', alignItems: 'center', padding: `0 ${k * 3}px` }}>
                        <Text text={typed || ' '} role="body" size={(k * 4.2) / canvas.u} maxWidth={fw * 0.8} maxLines={1} animate="none" align="start" color={ui.text} />
                      </div>
                    </div>
                  );
                })}
                <div data-qc-cta="1" style={{ height: k * 12, borderRadius: k * 6, background: btnBg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: k * 2, transform: `scale(${1 - 0.05 * clamp(1 - Math.abs(s - press) / 0.15)})` }}>
                  {done > 0.5 ? <Icon name="Check" size={k * 5} color={btnFg} treatment="plain" /> : null}
                  <Text text={done > 0.5 && c.done ? c.done : c.button} role="cta" size={(k * 4.6) / canvas.u} maxWidth={fw * 0.7} maxLines={1} animate="none" color={btnFg} critical />
                </div>
              </Surface>
              <div style={{ position: 'absolute', inset: 0 }}>
                <Cursor keys={[{ t: 0.3, x: fw * 0.8, y: k * 20 }, { t: press - 0.3, x: fw * 0.55, y: k * (20 + n * 18 + 6) }, { t: press, x: fw * 0.5, y: k * (20 + n * 18 + 8), click: true }]} size={k * 1.2} />
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ════════════════════════════════════════════════════════════════════ landing-page
const LandingC = Heading.extend({
  url: z.string().max(80).optional(),
  screenshot: z.string().optional(),
  pageTitle: z.string().max(80),
  pageSubtitle: z.string().max(140).optional(),
  pageCta: z.string().max(24).optional(),
  features: z.array(z.string().max(30)).max(3).optional(),
});
type LC = z.infer<typeof LandingC>;
export const landingPage = defineScene<LC>(
  {
    id: 'landing-page',
    version: '1.0.0',
    category: 'ui',
    title: 'Landing page',
    description: "A landing page from the user's words (or their real screenshot) in a browser: hero, then a smooth scroll to features, then the CTA is pressed.",
    variants: ['scroll', 'hero'],
    defaultVariant: 'scroll',
    content: LandingC,
    defaultDuration: 5,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in'],
    sfx: [
      { at: 0.2, category: 'whoosh', weight: 0.45 },
      { at: 3.6, category: 'click', weight: 0.45 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'product', 'solution'],
    energy: 0.5,
    cost: 'MEDIUM',
    motion: { elements: ['dashboard', 'cursor', 'button'], jobs: ['show-how-it-works'] },
    aspectVariants: { landscape: ['scroll', 'hero'], portrait: ['scroll'] },
    example: { title: 'صفحة هبوط تبيع عنك', url: 'brand.sa', pageTitle: 'قهوة مختصة تصلك لباب البيت', pageSubtitle: 'محمصة محلية، توصيل نفس اليوم', pageCta: 'اطلب الآن', features: ['تحميص أسبوعي', 'توصيل مجاني', 'اشتراك شهري'] },
    editable: ['title', 'subtitle', 'pageTitle', 'pageSubtitle', 'pageCta'],
  },
  ({ content: c, variant }) => {
    const { m, s, durSec } = useSceneTime();
    const { canvas } = useVideo();
    const ar = useAspect(c.screenshot, 16 / 10);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const box = fitBox(canvas.orientation === 'portrait' ? 10 / 14 : 16 / 11, w, h * 0.94);
          const bw = box.width;
          const bh = box.height;
          const enter = motionFor(m, 'dashboard', 0.05, 0.8);
          const scrollT = variant === 'scroll' ? EASE.inOut(clamp((s - 1.2) / Math.max(1, durSec - 2.6))) : 0;
          const contentH = bh - bw * 0.075;
          const scroll = c.screenshot ? Math.max(0, bw / ar - contentH) * scrollT : Math.min(bh * 0.12, bw * 0.08) * scrollT;
          return (
            <div style={{ position: 'relative', opacity: clamp(enter * 1.4), transform: `translateY(${(1 - enter) * bw * 0.05}px) scale(${0.96 + 0.04 * enter})` }}>
              <BrowserFrame width={bw} height={bh} url={c.url}>
                {c.screenshot ? (
                  <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll }}>
                    <Media src={c.screenshot} role="screenshot" width={bw} height={bw / ar} fit="contain" />
                  </div>
                ) : (
                  <LandingMock c={c} width={bw} scroll={scroll} />
                )}
              </BrowserFrame>
              <div style={{ position: 'absolute', inset: 0 }}>
                <Cursor keys={[{ t: 0.6, x: bw * 0.75, y: bh * 0.85 }, { t: durSec - 1.1, x: bw * 0.5, y: bh * 0.55 }, { t: durSec - 0.8, x: bw * 0.5, y: bh * 0.56, click: true }]} size={5.5 * (bw / 1000)} />
              </div>
            </div>
          );
        }}
      />
    );
  },
);

/** Landing page built only from the user's words: hero (title, subtitle, CTA) then feature cards. */
function LandingMock({ c, width, scroll }: { c: LC; width: number; scroll: number }) {
  const { canvas, tokens: t } = useVideo();
  const ui = useUiPalette();
  const u = canvas.u;
  const portrait = canvas.orientation === 'portrait';
  const pad = width * (portrait ? 0.07 : 0.04);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, padding: pad, display: 'flex', flexDirection: 'column', gap: pad * 0.9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: width * 0.16, height: width * 0.04, borderRadius: 99, background: ui.primary }} />
        <div style={{ width: width * 0.08, height: width * 0.025, borderRadius: 99, background: alpha(ui.text, 0.2) }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: pad * 0.45, padding: `${pad * 0.6}px 0`, borderRadius: width * 0.03 }}>
        <Text text={c.pageTitle} role="title" size={(width * (portrait ? 0.085 : 0.06)) / u} minSize={2.6} align="start" animate="none" color={ui.text} maxWidth={width * 0.86} maxLines={3} />
        {c.pageSubtitle ? <Text text={c.pageSubtitle} role="body" size={(width * (portrait ? 0.045 : 0.03)) / u} minSize={2} align="start" animate="none" color={ui.muted} maxWidth={width * 0.8} maxLines={2} /> : null}
        {c.pageCta ? (
          <div data-qc-cta="1" style={{ alignSelf: 'flex-start', padding: `${width * 0.02}px ${width * 0.05}px`, borderRadius: 99, background: ui.primary }}>
            <Text text={c.pageCta} role="cta" size={(width * (portrait ? 0.042 : 0.03)) / u} animate="none" color={ui.onPrimary} maxWidth={width * 0.5} maxLines={1} />
          </div>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: portrait ? '1fr' : 'repeat(3, 1fr)', gap: pad * 0.4 }}>
        {(c.features?.length ? c.features : ['', '', '']).slice(0, 3).map((f, i) => (
          <div key={i} style={{ borderRadius: width * 0.025, background: ui.panel, border: `1px solid ${ui.line}`, padding: width * 0.03, display: 'flex', flexDirection: 'row', alignItems: 'center', gap: width * 0.025 }}>
            <div style={{ width: width * (portrait ? 0.1 : 0.045), height: width * (portrait ? 0.1 : 0.045), borderRadius: width * 0.02, background: alpha(i === 1 ? t.palette.accent : ui.primary, 0.22), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="Check" size={width * 0.04} color={i === 1 ? t.palette.accent : ui.primary} treatment="plain" />
            </div>
            {f ? <Text text={f} role="label" size={(width * (portrait ? 0.045 : 0.024)) / u} minSize={2} align="start" animate="none" color={ui.text} maxWidth={width * (portrait ? 0.62 : 0.2)} maxLines={2} /> : <div style={{ height: width * 0.02, width: '70%', borderRadius: 99, background: alpha(ui.text, 0.15) }} />}
          </div>
        ))}
      </div>
    </div>
  );
}
