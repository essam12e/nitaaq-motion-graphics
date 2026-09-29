/** UI / Web families: browser-scene, dashboard, saas-interface, login-screen, search-interface, checkout-flow, order-notification, screenshot-focus. */
import React from 'react';
import { z } from 'zod';
import { interpolate } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime, formatNumber, Reveal } from '../kit';
import { useLayout, Stage } from '../../layout/stage';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { BrowserFrame, MockPage, UiRow, useUiPalette } from '../../components/Mockups';
import { Media, fitBox, useAspect } from '../../components/Media';
import { Cursor } from '../../components/Cursor';
import { Icon } from '../../components/Icon';
import { Surface } from '../../components/Surface';
import { clamp, progress, EASE, countUp, overshoot, float } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { useLabel } from '../i18n';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);

// ───────────────────────── browser-scene
const BrowserC = Heading.extend({
  url: z.string().max(80).optional(),
  screenshot: z.string().optional(),
  pageTitle: z.string().max(80).optional(),
  pageSubtitle: z.string().max(120).optional(),
  menu: z.array(z.string().max(20)).max(5).optional(),
  pageCta: z.string().max(24).optional(),
});
type BC = z.infer<typeof BrowserC>;
export const browserScene = defineScene<BC>(
  {
    id: 'browser-scene',
    version: '1.0.0',
    category: 'ui',
    title: 'Browser',
    description: "Website in a browser frame (user's screenshot or a clean mock built from their words); variants focus / scroll / zoom / navigate.",
    variants: ['focus', 'scroll', 'zoom', 'navigate'],
    defaultVariant: 'focus',
    content: BrowserC,
    defaultDuration: 4,
    minDuration: 2.5,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'slide'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.5 },
      { at: 1.4, category: 'click', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'solution', 'product'],
    energy: 0.55,
    aspectVariants: { landscape: ['focus', 'scroll', 'navigate', 'zoom'], portrait: ['scroll', 'zoom', 'focus'] },
    example: { title: 'موقعك يشتغل عنك ٢٤ ساعة', highlight: ['٢٤'], url: 'store.example.com', pageTitle: 'تسوّق أحدث التشكيلات', pageSubtitle: 'شحن سريع لكل المدن', menu: ['الرئيسية', 'المنتجات', 'العروض'], pageCta: 'تسوق الآن' },
    editable: ['eyebrow', 'title', 'subtitle', 'url', 'pageTitle', 'pageSubtitle', 'pageCta'],
  },
  ({ content: c, variant }) => {
    const { m, s, durSec } = useSceneTime();
    const ar = useAspect(c.screenshot, 16 / 10);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const u = w / 100;
          const box = c.screenshot ? fitBox(ar, w, h * 0.92) : fitBox(16 / 11, w, h * 0.92);
          const bw = Math.min(box.width, w);
          const bh = c.screenshot ? Math.min(h * 0.92, (bw / ar) * (variant === 'scroll' ? 0.6 : 1) + bw * 0.06) : Math.min(h * 0.92, bw / (16 / 11));
          const enter = progress(m, 0.1, 0.9);
          const t = s / durSec;
          const tilt = variant === 'focus' ? `perspective(2000px) rotateY(${(1 - enter) * -18 + 4 * (0.5 - t)}deg) rotateX(${(1 - enter) * 10}deg)` : '';
          const zoom = variant === 'zoom' ? 1 + 0.35 * EASE.inOut(clamp((s - 1) / 1.6)) : 1;
          const contentH = bh - bw * 0.075;
          const scrollMax = c.screenshot ? Math.max(0, (bw / ar) - contentH) : bw * 0.8;
          const scroll = variant === 'scroll' ? scrollMax * EASE.inOut(clamp((s - 0.8) / Math.max(1, durSec - 1.6))) : 0;
          const typed = variant === 'navigate' ? (c.url ?? '').slice(0, Math.round(interpolate(s, [0.4, 1.2], [0, (c.url ?? '').length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))) : c.url;
          const loaded = variant === 'navigate' ? clamp((s - 1.35) / 0.5) : 1;
          return (
            <div style={{ position: 'relative', transform: `${tilt} translateY(${(1 - enter) * u * 12}px) scale(${0.96 + 0.04 * enter})`, opacity: clamp(enter * 1.5) }}>
              <BrowserFrame width={bw} height={bh} url={typed}>
                <div style={{ position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: '60% 30%', opacity: loaded }}>
                  {c.screenshot ? (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll }}>
                      <Media src={c.screenshot} role="screenshot" width={bw} height={bw / ar} fit="contain" />
                    </div>
                  ) : (
                    <MockPage title={c.pageTitle ?? c.title ?? ''} subtitle={c.pageSubtitle} menu={c.menu} cta={c.pageCta} scroll={scroll} width={bw} />
                  )}
                </div>
                {variant === 'navigate' && loaded < 1 ? <div style={{ position: 'absolute', top: 0, left: 0, height: 4, width: `${clamp((s - 1.1) / 0.6) * 100}%`, background: 'currentColor', color: '#3B82F6' }} /> : null}
              </BrowserFrame>
              {variant === 'focus' || variant === 'navigate' ? (
                <div style={{ position: 'absolute', inset: 0 }}>
                  <Cursor
                    keys={[
                      { t: 0.6, x: bw * 0.8, y: bh * 0.9 },
                      { t: 1.4, x: bw * 0.2, y: bh * 0.52, click: true },
                      { t: 2.6, x: bw * 0.3, y: bh * 0.7 },
                    ]}
                    size={5.5 * (bw / 1000)}
                  />
                </div>
              ) : null}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── dashboard
const DashC = Heading.extend({
  appName: z.string().max(30).optional(),
  menu: z.array(z.string().max(24)).max(6).optional(),
  kpis: z.array(z.object({ label: z.string().max(30), value: z.number(), prefix: z.string().optional(), suffix: z.string().optional() })).max(4).optional(),
  series: z.object({ labels: z.array(z.string()).min(2), values: z.array(z.number()).min(2) }).optional(),
  source: z.string().optional(),
});
type DC = z.infer<typeof DashC>;
export const dashboard = defineScene<DC>(
  {
    id: 'dashboard',
    version: '1.0.0',
    category: 'ui',
    title: 'Dashboard',
    description: 'Analytics dashboard UI. Shows numbers only from user data (with source); otherwise an illustrative, number-free UI. Variants analytics / kpi-grid / sales.',
    variants: ['analytics', 'kpi-grid', 'sales'],
    defaultVariant: 'analytics',
    content: DashC,
    defaultDuration: 4.2,
    minDuration: 2.5,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'mask-wipe'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.5 },
      { at: 0.8, category: 'tick', weight: 0.35 },
      { at: 1.6, category: 'pop', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'data', 'proof', 'solution'],
    energy: 0.6,
    example: { title: 'كل أرقامك في مكان واحد', highlight: ['مكان', 'واحد'], appName: 'Insights', menu: ['نظرة عامة', 'المبيعات', 'العملاء', 'التقارير'] },
    editable: ['eyebrow', 'title', 'subtitle', 'appName'],
    validate: (c) => ((c.kpis?.length || c.series) && !c.source ? [{ path: 'content.source', message: 'Dashboard numbers need a source (no invented statistics).', severity: 'error' }] : []),
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m, s } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        headingShare={v.canvas.orientation === 'landscape' ? 0.36 : undefined}
        visual={(w, h) => {
          const W = Math.min(w, h * 1.5);
          const H = Math.min(h * 0.95, W * (v.canvas.orientation === 'landscape' ? 0.66 : 0.9));
          const u = W / 100;
          const enter = progress(m, 0.05, 0.8);
          const sidebar = variant !== 'kpi-grid' && W > 500;
          const menu = c.menu ?? [];
          const kpis = c.kpis ?? [];
          const vals = c.series?.values ?? [3, 5, 4, 7, 6, 9, 8, 11];
          const max = Math.max(...vals);
          const chartP = progress(m, 0.6, 1.3);
          const pts = vals.map((val, i) => [(i / (vals.length - 1)) * 100, 100 - (val / max) * 85]);
          const path = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
          return (
            <div style={{ width: W, height: H, transform: `perspective(2400px) rotateX(${(1 - enter) * 14}deg) translateY(${(1 - enter) * u * 8}px)`, opacity: clamp(enter * 1.4), borderRadius: u * 2.2, background: ui.page, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.35)`, display: 'flex', overflow: 'hidden' }}>
              {sidebar ? (
                <div style={{ width: W * 0.24, background: ui.panel, borderInlineEnd: `1px solid ${ui.line}`, padding: u * 2, display: 'flex', flexDirection: 'column', gap: u * 0.8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: u, marginBottom: u * 2 }}>
                    <div style={{ width: u * 4, height: u * 4, borderRadius: u, background: ui.primary }} />
                    {c.appName ? <Text text={c.appName} role="label" size={(u * 2.6) / v.canvas.u} minSize={1.6} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={W * 0.14} /> : null}
                  </div>
                  {menu.map((label, i) => (
                    <UiRow key={i} label={label} icon={['LayoutDashboard', 'ShoppingBag', 'Users', 'FileText', 'Settings', 'Bell'][i % 6]} width={W * 0.2} active={i === 0 ? 1 : 0} />
                  ))}
                </div>
              ) : null}
              <div style={{ flex: 1, padding: u * 3, display: 'flex', flexDirection: 'column', gap: u * 2.4 }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(2, Math.min(4, kpis.length || 3))}, 1fr)`, gap: u * 1.6 }}>
                  {(kpis.length ? kpis : [0, 1, 2]).map((k, i) => {
                    const kp = progress(m, 0.3 + i * 0.12, 0.6);
                    const isData = typeof k === 'object';
                    return (
                      <div key={i} style={{ background: ui.panel, borderRadius: u * 1.4, padding: u * 2, border: `1px solid ${ui.line}`, opacity: kp, transform: `translateY(${(1 - kp) * u * 3}px)` }}>
                        {isData ? (
                          <>
                            <Text text={k.label} role="caption" size={(u * 2.2) / v.canvas.u} minSize={1.6} animate="none" align="start" color={ui.muted} maxLines={1} maxWidth={W * 0.2} />
                            <div dir="ltr" style={{ fontFamily: v.fonts.latin, fontWeight: 700, fontSize: u * 4.6, color: ui.text, marginTop: u * 0.6 }}>
                              {formatNumber(countUp(m, 0, k.value, 0.4 + i * 0.12, 1.1), { prefix: k.prefix, suffix: k.suffix, decimals: Number.isInteger(k.value) ? 0 : 1, numerals: v.spec.project.numerals })}
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ height: u * 1.4, width: '60%', borderRadius: 99, background: alpha(ui.text, 0.12) }} />
                            <div style={{ height: u * 3.2, width: `${50 + i * 12}%`, borderRadius: u * 0.6, background: i === 0 ? alpha(ui.primary, 0.8) : alpha(ui.text, 0.2), marginTop: u * 1.2 }} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ flex: 1, background: ui.panel, borderRadius: u * 1.4, border: `1px solid ${ui.line}`, padding: u * 2.4, display: 'flex', flexDirection: 'column', gap: u }}>
                  <div style={{ height: u * 1.3, width: '30%', borderRadius: 99, background: alpha(ui.text, 0.14) }} />
                  <div style={{ flex: 1, position: 'relative' }}>
                    {variant === 'sales' ? (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: u * 1.2, direction: 'ltr' }}>
                        {vals.map((val, i) => {
                          const bp = progress(m, 0.6 + i * 0.07, 0.7);
                          return <div key={i} style={{ flex: 1, height: `${(val / max) * 100 * bp}%`, borderRadius: `${u * 0.8}px ${u * 0.8}px 0 0`, background: i === vals.length - 1 ? ui.primary : alpha(ui.primary, 0.35) }} />;
                        })}
                      </div>
                    ) : (
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
                        <defs>
                          <linearGradient id="dashfill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ui.primary} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={ui.primary} stopOpacity={0} />
                          </linearGradient>
                          <clipPath id="dashclip">
                            <rect x={0} y={-5} width={100 * chartP} height={110} />
                          </clipPath>
                        </defs>
                        <g clipPath="url(#dashclip)">
                          <path d={`${path} L 100 100 L 0 100 Z`} fill="url(#dashfill)" />
                          <path d={path} fill="none" stroke={ui.primary} strokeWidth={1.2} vectorEffect="non-scaling-stroke" style={{ strokeWidth: u * 0.5 }} />
                        </g>
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── saas-interface
const SaasC = Heading.extend({
  appName: z.string().max(30).optional(),
  items: z.array(z.string().max(40)).min(2).max(6),
  action: z.string().max(24).optional(),
});
type SaC = z.infer<typeof SaasC>;
export const saasInterface = defineScene<SaC>(
  {
    id: 'saas-interface',
    version: '1.0.0',
    category: 'ui',
    title: 'SaaS interface',
    description: 'Product UI with a cursor completing a task; variants tasks / kanban / toggles.',
    variants: ['tasks', 'kanban', 'toggles'],
    defaultVariant: 'tasks',
    content: SaasC,
    defaultDuration: 4.2,
    minDuration: 2.8,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'slide'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.4 },
      { at: 1.5, category: 'click', weight: 0.6 },
      { at: 1.6, category: 'pop', weight: 0.4 },
      { at: 2.3, category: 'click', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'solution', 'feature'],
    energy: 0.55,
    example: { title: 'أنجز شغلك بضغطة', highlight: ['بضغطة'], appName: 'Flow', items: ['تصميم الصفحة الرئيسية', 'رفع المنتجات', 'ربط بوابة الدفع', 'إطلاق المتجر'], action: 'تم' },
    editable: ['eyebrow', 'title', 'subtitle', 'appName', 'items', 'action'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m, s } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w, h * (variant === 'kanban' ? 1.6 : 1.1));
          const u = W / 100;
          const enter = progress(m, 0.05, 0.8);
          const rowH = u * (variant === 'toggles' ? 13 : 12);
          const doneAt = (i: number) => 1.3 + i * 0.55;
          if (variant === 'kanban') {
            const cols = [c.items.slice(0, Math.ceil(c.items.length / 2)), c.items.slice(Math.ceil(c.items.length / 2))];
            const move = EASE.inOut(clamp((s - 1.4) / 0.8));
            const cardW = (W - u * 10) / 3;
            return (
              <div style={{ width: W, opacity: enter, transform: `translateY(${(1 - enter) * u * 6}px)` }}>
                <div style={{ display: 'flex', gap: u * 2.5, background: ui.page, borderRadius: u * 2, padding: u * 2.5, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.3)`, position: 'relative' }}>
                  {[0, 1, 2].map((col) => (
                    <div key={col} style={{ width: cardW, background: ui.panel, borderRadius: u * 1.4, padding: u * 1.6, display: 'flex', flexDirection: 'column', gap: u * 1.2, minHeight: u * 40 }}>
                      <div style={{ height: u * 1.4, width: '50%', borderRadius: 99, background: col === 2 ? alpha(ui.positive, 0.6) : alpha(ui.text, 0.18) }} />
                      {(cols[col] ?? []).map((it, i) => {
                        const moving = col === 0 && i === 0;
                        return (
                          <div key={i} style={{ background: ui.page, borderRadius: u, padding: u * 1.4, border: `1px solid ${ui.line}`, transform: moving ? `translateX(${-move * (cardW + u * 2.5) * 2 * (v.dir === 'rtl' ? -1 : 1) * -1}px)` : undefined, boxShadow: moving && move > 0 && move < 1 ? '0 10px 30px rgba(0,0,0,0.3)' : undefined, zIndex: moving ? 2 : 1 }}>
                            <Text text={it} role="caption" size={(u * 2.6) / v.canvas.u} minSize={1.6} animate="none" align="start" color={ui.text} maxWidth={cardW - u * 3} maxLines={2} />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <div style={{ width: W, opacity: enter, transform: `translateY(${(1 - enter) * u * 6}px) scale(${0.97 + 0.03 * enter})` }}>
              <div style={{ background: ui.page, borderRadius: u * 2.4, padding: u * 3, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.3)`, display: 'flex', flexDirection: 'column', gap: u * 1.2, position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.5, marginBottom: u }}>
                  <div style={{ width: u * 5, height: u * 5, borderRadius: u * 1.2, background: ui.primary }} />
                  {c.appName ? <Text text={c.appName} role="label" size={(u * 3.4) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.text} maxLines={1} /> : null}
                </div>
                {c.items.map((it, i) => {
                  const dp = progress(m, doneAt(i), 0.35, 'elastic');
                  const rp = progress(m, 0.25 + i * 0.1, 0.5);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 2, height: rowH, padding: `0 ${u * 2}px`, borderRadius: u * 1.4, background: ui.panel, border: `1px solid ${ui.line}`, opacity: rp, transform: `translateY(${(1 - rp) * u * 2}px)` }}>
                      {variant === 'toggles' ? (
                        <div style={{ width: u * 9, height: u * 5, borderRadius: 99, background: dp > 0.5 ? ui.primary : alpha(ui.text, 0.2), position: 'relative', flexShrink: 0, direction: 'ltr' }}>
                          <div style={{ position: 'absolute', top: u * 0.5, left: u * 0.5 + clamp(dp) * u * 4, width: u * 4, height: u * 4, borderRadius: 99, background: '#FFFFFF' }} />
                        </div>
                      ) : (
                        <div style={{ width: u * 5, height: u * 5, borderRadius: u * 1.2, border: `${u * 0.4}px solid ${dp > 0.1 ? ui.positive : alpha(ui.text, 0.3)}`, background: dp > 0.1 ? ui.positive : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <div style={{ transform: `scale(${dp})` }}>
                            <Icon name="Check" size={u * 3.4} color="#FFFFFF" treatment="plain" stroke={3} />
                          </div>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0, opacity: variant === 'tasks' && dp > 0.5 ? 0.55 : 1 }}>
                        <Text text={it} role="label" size={(u * 3.3) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={W - u * 16} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ position: 'absolute', inset: 0 }}>
                  <Cursor keys={c.items.map((_, i) => ({ t: doneAt(i) - 0.05, x: variant === 'toggles' ? u * 8 : u * 8.5, y: u * 11 + i * (rowH + u * 1.2) + rowH / 2, click: true })).reduce<{ t: number; x: number; y: number; click?: boolean }[]>((acc, k) => [...acc, { ...k, t: k.t - 0.35, click: false }, k], [{ t: 0.8, x: W * 0.8, y: u * 60 }])} size={5 * (W / 1000)} />
                </div>
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── login-screen
const LoginC = Heading.extend({ appName: z.string().max(30).optional(), button: z.string().max(24).default('تسجيل الدخول'), success: z.string().max(40).optional() });
type LoC = z.infer<typeof LoginC>;
export const loginScreen = defineScene<LoC>(
  {
    id: 'login-screen',
    version: '1.0.0',
    category: 'ui',
    title: 'Login screen',
    description: 'Sign-in card: fields fill, button clicks, success state; variants card / split.',
    variants: ['card', 'split'],
    defaultVariant: 'card',
    content: LoginC,
    defaultDuration: 3.6,
    minDuration: 2.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'crossfade'],
    sfx: [
      { at: 0.5, category: 'typing', weight: 0.4, volume: 0.5 },
      { at: 1.7, category: 'click', weight: 0.6 },
      { at: 2.1, category: 'success', weight: 0.5, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'solution'],
    energy: 0.5,
    example: { title: 'دخول آمن بخطوة', highlight: ['آمن'], appName: 'بوابتي', button: 'تسجيل الدخول', success: 'أهلاً بك' },
    editable: ['eyebrow', 'title', 'subtitle', 'appName', 'button', 'success'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m, s } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w * (variant === 'split' ? 1 : 0.8), h * (variant === 'split' ? 1.5 : 0.8));
          const u = W / 100;
          const enter = progress(m, 0.05, 0.8);
          const dots = Math.round(interpolate(s, [0.9, 1.4], [0, 8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
          const email = 'name@example.com'.slice(0, Math.round(interpolate(s, [0.35, 0.85], [0, 16], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
          const pressed = s > 1.7 && s < 1.9 ? 1 : 0;
          const ok = progress(m, 2.0, 0.5, 'elastic');
          const field = (content: React.ReactNode) => (
            <div dir="ltr" style={{ height: u * 11, borderRadius: u * 1.6, background: ui.panel, border: `1px solid ${ui.line}`, display: 'flex', alignItems: 'center', padding: `0 ${u * 3}px`, fontFamily: v.fonts.latin, fontSize: u * 3.6, color: ui.text }}>{content}</div>
          );
          const card = (
            <div style={{ width: variant === 'split' ? W * 0.5 : W, padding: u * 5, display: 'flex', flexDirection: 'column', gap: u * 2.4, position: 'relative' }}>
              <div style={{ width: u * 9, height: u * 9, borderRadius: u * 2.4, background: ui.primary, alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="Lock" size={u * 4.6} color={ui.onPrimary} treatment="plain" />
              </div>
              {c.appName ? <Text text={c.appName} role="label" size={(u * 4) / v.canvas.u} minSize={1.8} animate="none" color={ui.text} /> : null}
              {field(email)}
              {field(<span style={{ letterSpacing: u * 0.8 }}>{'•'.repeat(dots)}</span>)}
              <div style={{ height: u * 11, borderRadius: u * 1.6, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 - pressed * 0.04})` }}>
                <Text text={c.button} role="label" size={(u * 3.6) / v.canvas.u} minSize={1.8} animate="none" color={ui.onPrimary} maxLines={1} critical />
              </div>
              {ok > 0.01 ? (
                <div style={{ position: 'absolute', inset: 0, background: alpha(ui.page, 0.94 * clamp(ok)), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 2, borderRadius: u * 3 }}>
                  <div style={{ transform: `scale(${ok})`, width: u * 16, height: u * 16, borderRadius: 99, background: ui.positive, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="Check" size={u * 9} color="#FFFFFF" treatment="plain" stroke={3} />
                  </div>
                  {c.success ? <Text text={c.success} role="title" size={(u * 5) / v.canvas.u} minSize={2} animate="none" color={ui.text} /> : null}
                </div>
              ) : null}
              <div style={{ position: 'absolute', inset: 0 }}>
                <Cursor keys={[{ t: 0.9, x: W * 0.9, y: u * 90 }, { t: 1.7, x: (variant === 'split' ? W * 0.25 : W * 0.5), y: u * 66, click: true }]} size={5 * (W / 1000)} />
              </div>
            </div>
          );
          return (
            <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * u * 6}px)`, display: 'flex', background: ui.page, borderRadius: u * 3, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.3)`, overflow: 'hidden' }}>
              {variant === 'split' ? <div style={{ width: W * 0.5, background: `linear-gradient(145deg, ${ui.primary}, ${ui.accent})` }} /> : null}
              {card}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── search-interface
const SearchC = Heading.extend({ query: z.string().min(1).max(60), results: z.array(z.string().max(60)).max(5).optional() });
type SeC = z.infer<typeof SearchC>;
export const searchInterface = defineScene<SeC>(
  {
    id: 'search-interface',
    version: '1.0.0',
    category: 'ui',
    title: 'Search interface',
    description: 'Search/command palette: query types, results cascade in; variants results / command.',
    variants: ['results', 'command'],
    defaultVariant: 'results',
    content: SearchC,
    defaultDuration: 3.8,
    minDuration: 2.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push'],
    sfx: [
      { at: 0.3, category: 'typing', weight: 0.5, volume: 0.5 },
      { at: 0.7, category: 'typing', weight: 0.6, volume: 0.5 },
      { at: 1.3, category: 'pop', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'demo'],
    energy: 0.55,
    example: { title: 'عملاؤك يبحثون عنك', highlight: ['يبحثون'], query: 'أفضل متجر عطور', results: ['متجرك — عطور فاخرة', 'تشكيلة جديدة', 'عروض الأسبوع'] },
    editable: ['eyebrow', 'title', 'subtitle', 'query', 'results'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m, s } = useSceneTime();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w, h * 1.3);
          const u = W / 100;
          const chars = Array.from(c.query);
          const n = Math.round(interpolate(s, [0.25, 0.25 + chars.length * 0.05], [0, chars.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
          const res = c.results ?? [];
          const enter = progress(m, 0, 0.6);
          return (
            <div style={{ width: W, opacity: enter, transform: `scale(${0.95 + 0.05 * enter})` }}>
              <div style={{ background: ui.page, borderRadius: variant === 'command' ? u * 3 : u * 4, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.3)`, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: u * 2.4, padding: `${u * 3.2}px ${u * 3.6}px`, borderBottom: res.length ? `1px solid ${ui.line}` : undefined }}>
                  <Icon name="Search" size={u * 5} color={ui.primary} treatment="plain" />
                  <div style={{ flex: 1, fontFamily: v.fonts.body, fontSize: u * 4.6, color: ui.text, whiteSpace: 'nowrap' }} data-qc="text" data-qc-role="body" data-qc-fit="ok" data-qc-font-size={(u * 4.6).toFixed(1)} data-qc-min-size={(u * 2).toFixed(1)} data-qc-text={c.query} data-qc-arabic="1" data-qc-color={ui.text}>
                    {chars.slice(0, n).join('')}
                    <span style={{ display: 'inline-block', width: u * 0.4, height: u * 5, background: ui.primary, verticalAlign: 'middle', opacity: Math.floor(s * 2.2) % 2 === 0 || n < chars.length ? 1 : 0 }} />
                  </div>
                  {variant === 'command' ? <div dir="ltr" style={{ fontFamily: v.fonts.mono, fontSize: u * 2.6, color: ui.muted, border: `1px solid ${ui.line}`, borderRadius: u, padding: `${u * 0.4}px ${u}px` }}>⌘K</div> : null}
                </div>
                {res.map((r, i) => {
                  const rp = progress(m, 0.35 + chars.length * 0.05 + 0.2 + i * 0.12, 0.5);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 2.4, padding: `${u * 2.4}px ${u * 3.6}px`, opacity: rp, transform: `translateY(${(1 - rp) * u * 2}px)`, background: i === 0 ? alpha(ui.primary, 0.1) : undefined }}>
                      <Icon name={i === 0 ? 'Star' : 'ArrowUpLeft'} size={u * 3.8} color={i === 0 ? ui.primary : ui.muted} treatment="plain" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text text={r} role="label" size={(u * 3.8) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={W - u * 16} weight={i === 0 ? 700 : 500} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── checkout-flow
const CheckoutC = Heading.extend({
  items: z.array(z.object({ name: z.string().max(40), price: z.string().max(20).optional() })).min(1).max(4),
  total: z.string().max(24).optional(),
  button: z.string().max(24).default('ادفع الآن'),
  success: z.string().max(40).default('تم الدفع بنجاح'),
});
type CoC = z.infer<typeof CheckoutC>;
export const checkoutFlow = defineScene<CoC>(
  {
    id: 'checkout-flow',
    version: '1.0.0',
    category: 'commerce',
    title: 'Checkout & payment success',
    description: 'Order summary → pay click → success state; variants card / steps / receipt.',
    variants: ['card', 'steps', 'receipt'],
    defaultVariant: 'card',
    content: CheckoutC,
    defaultDuration: 4,
    minDuration: 2.8,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'slide'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.4 },
      { at: 1.8, category: 'click', weight: 0.6 },
      { at: 2.2, category: 'success', weight: 0.7, volume: 0.6 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'offer', 'solution', 'product'],
    energy: 0.55,
    example: { title: 'دفع سهل وآمن', highlight: ['سهل'], items: [{ name: 'عطر عود', price: '249 ر.س' }, { name: 'شحن', price: 'مجاني' }], total: '249 ر.س', button: 'ادفع الآن', success: 'تم الدفع بنجاح' },
    editable: ['eyebrow', 'title', 'subtitle', 'total', 'button', 'success'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m, s } = useSceneTime();
    const tl = useLabel();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w * 0.9, h * 0.85);
          const u = W / 100;
          const enter = progress(m, 0.05, 0.8);
          const pressed = s > 1.75 && s < 1.95 ? 1 : 0;
          const ok = progress(m, 2.1, 0.55, 'elastic');
          const steps = [tl('cart'), tl('shipping'), tl('payment')];
          const stepAt = Math.min(2, Math.floor(interpolate(s, [0.3, 1.6], [0, 2.99], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
          return (
            <div style={{ width: W, opacity: enter, transform: `translateY(${(1 - enter) * u * 6}px)`, background: ui.page, borderRadius: u * 3.2, border: `1px solid ${ui.line}`, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.3)`, padding: u * 5, display: 'flex', flexDirection: 'column', gap: u * 2.6, position: 'relative', overflow: 'hidden' }}>
              {variant === 'steps' ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: u * 2, marginBottom: u }}>
                  {steps.map((st, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 1.2, flex: 1 }}>
                      <div style={{ width: u * 6, height: u * 6, borderRadius: 99, background: i <= stepAt ? ui.primary : alpha(ui.text, 0.15), color: ui.onPrimary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: v.fonts.latin, fontWeight: 700, fontSize: u * 3 }}>{i + 1}</div>
                      <Text text={st} role="caption" size={(u * 3) / v.canvas.u} minSize={1.6} animate="none" color={i <= stepAt ? ui.text : ui.muted} maxLines={1} />
                    </div>
                  ))}
                </div>
              ) : null}
              {c.items.map((it, i) => {
                const rp = progress(m, 0.3 + i * 0.12, 0.5);
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 2.4, opacity: rp }}>
                    <div style={{ width: u * 12, height: u * 12, borderRadius: u * 2, background: alpha(ui.primary, 0.18), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={i === 0 ? 'ShoppingBag' : 'Truck'} size={u * 5.4} color={ui.primary} treatment="plain" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text text={it.name} role="label" size={(u * 4) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={W * 0.5} />
                    </div>
                    {it.price ? <Text text={it.price} role="label" size={(u * 3.8) / v.canvas.u} minSize={1.8} animate="none" color={ui.text} maxLines={1} weight={700} /> : null}
                  </div>
                );
              })}
              <div style={{ height: 1, background: ui.line }} />
              {c.total ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text text={tl('total')} role="label" size={(u * 4) / v.canvas.u} minSize={1.8} animate="none" color={ui.muted} maxLines={1} />
                  <Text text={c.total} role="title" size={(u * 5.4) / v.canvas.u} minSize={2} animate="none" color={ui.text} maxLines={1} />
                </div>
              ) : null}
              <div style={{ height: u * 12, borderRadius: u * 2, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 - pressed * 0.04})` }}>
                <Text text={c.button} role="label" size={(u * 4.2) / v.canvas.u} minSize={1.8} animate="none" color={ui.onPrimary} maxLines={1} critical />
              </div>
              {ok > 0.01 ? (
                <div style={{ position: 'absolute', inset: 0, background: alpha(ui.page, clamp(ok) * 0.97), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 3 }}>
                  <div style={{ transform: `scale(${ok})`, width: u * 22, height: u * 22, borderRadius: 99, background: ui.positive, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 ${u * 3 * (1 - clamp(ok))}px ${alpha(ui.positive, 0.25)}` }}>
                    <Icon name="Check" size={u * 12} color="#FFFFFF" treatment="plain" stroke={3} />
                  </div>
                  <Text text={c.success} role="title" size={(u * 6) / v.canvas.u} minSize={2.2} animate="none" color={ui.text} critical />
                  {variant === 'receipt' && c.total ? <Text text={c.total} role="subtitle" size={(u * 4.4) / v.canvas.u} minSize={1.8} animate="none" color={ui.muted} /> : null}
                </div>
              ) : null}
              <div style={{ position: 'absolute', inset: 0 }}>
                <Cursor keys={[{ t: 1.0, x: W * 0.85, y: W * 0.2 }, { t: 1.8, x: W * 0.5, y: W * (variant === 'steps' ? 0.82 : 0.72), click: true }]} size={5.5 * (W / 1000)} />
              </div>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── order-notification
const OrderC = Heading.extend({
  items: z.array(z.object({ title: z.string().max(40), detail: z.string().max(40).optional() })).min(1).max(5),
  appLabel: z.string().max(24).optional(),
});
type OrC = z.infer<typeof OrderC>;
export const orderNotification = defineScene<OrC>(
  {
    id: 'order-notification',
    version: '1.0.0',
    category: 'commerce',
    title: 'New order notifications',
    description: 'Order/notification toasts stacking in; variants stack / single / cascade. Uses only the items given.',
    variants: ['stack', 'single', 'cascade'],
    defaultVariant: 'stack',
    content: OrderC,
    defaultDuration: 3.6,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'notification', weight: 0.7 },
      { at: 0.75, category: 'notification', weight: 0.5 },
      { at: 1.2, category: 'notification', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'solution', 'offer'],
    energy: 0.65,
    example: { title: 'وخلّ الطلبات تتكلم', highlight: ['الطلبات'], appLabel: 'متجري', items: [{ title: 'طلب جديد', detail: 'عطر عود — 249 ر.س' }, { title: 'طلب جديد', detail: 'بخور ملكي — 120 ر.س' }, { title: 'طلب جديد', detail: 'مجموعة هدايا — 399 ر.س' }] },
    editable: ['eyebrow', 'title', 'subtitle', 'appLabel'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const ui = useUiPalette();
    const { m } = useSceneTime();
    const items = variant === 'single' ? c.items.slice(0, 1) : c.items;
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w * 0.95, v.canvas.u * 92);
          const u = W / 100;
          const cardH = u * 20;
          return (
            <div style={{ width: W, height: Math.min(h, cardH * (items.length + 1.2)), position: 'relative' }}>
              {items.map((it, i) => {
                const p = progress(m, 0.3 + i * 0.45, 0.6, 'elastic');
                const pushDown = variant === 'stack' ? items.slice(i + 1).reduce((acc, _, j) => acc + clamp(progress(m, 0.3 + (i + 1 + j) * 0.45, 0.5)), 0) : 0;
                const y = variant === 'cascade' ? i * (cardH + u * 3) : pushDown * (cardH * 0.26);
                const sc = variant === 'stack' ? 1 - pushDown * 0.05 : 1;
                const floatY = variant === 'single' ? float(m.frame, m.fps, u * 1.2, 3.5) : 0;
                return (
                  <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: y + floatY + (variant === 'cascade' ? 0 : u * 4), transform: `translateY(${(1 - p) * -u * 18}px) scale(${sc * (0.9 + 0.1 * clamp(p))})`, opacity: clamp(p * 2) * (variant === 'stack' ? 1 - pushDown * 0.25 : 1), zIndex: 10 + i }}>
                    <Surface kind="glass" style={{ background: alpha(ui.page, 0.92), padding: `${u * 3}px ${u * 3.6}px`, display: 'flex', alignItems: 'center', gap: u * 3, borderRadius: u * 4.2 }}>
                      <div style={{ width: u * 11, height: u * 11, borderRadius: u * 3, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="ShoppingBag" size={u * 5.5} color={ui.onPrimary} treatment="plain" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: u * 0.6, alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text text={it.title} role="label" size={(u * 4.2) / v.canvas.u} minSize={2} animate="none" align="start" color={ui.text} maxLines={1} weight={700} maxWidth={W * 0.5} />
                          {c.appLabel ? <Text text={c.appLabel} role="caption" size={(u * 2.8) / v.canvas.u} minSize={1.6} animate="none" color={ui.muted} maxLines={1} maxWidth={W * 0.25} /> : null}
                        </div>
                        {it.detail ? <Text text={it.detail} role="caption" size={(u * 3.4) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.muted} maxLines={1} maxWidth={W * 0.7} /> : null}
                      </div>
                    </Surface>
                  </div>
                );
              })}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── screenshot-focus
const ShotC = Heading.extend({
  screenshot: z.string().min(1),
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.05).max(1), h: z.number().min(0.05).max(1) }).optional(),
  callouts: z.array(z.object({ text: z.string().max(40), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(3).optional(),
});
type ShC = z.infer<typeof ShotC>;
export const screenshotFocus = defineScene<ShC>(
  {
    id: 'screenshot-focus',
    version: '1.0.0',
    category: 'media',
    title: 'Screenshot focus',
    description: "Highlights a region of the user's screenshot (never altered); variants spotlight / zoom-region / callouts.",
    variants: ['spotlight', 'zoom-region', 'callouts'],
    defaultVariant: 'spotlight',
    content: ShotC,
    defaultDuration: 4,
    minDuration: 2.5,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade', 'push'],
    sfx: [
      { at: 0.9, category: 'pop', weight: 0.5 },
      { at: 0.1, category: 'whoosh', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'feature', 'solution'],
    energy: 0.5,
    requiresAssets: ['screenshot'],
    example: { title: 'كل شيء واضح', screenshot: 'lib:demo/screenshot.png', focus: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s } = useSceneTime();
    const ar = useAspect(c.screenshot, 16 / 10);
    const f = c.focus ?? { x: 0.25, y: 0.25, w: 0.5, h: 0.4 };
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const box = fitBox(ar, w, h * 0.95);
          const u = box.width / 100;
          const enter = progress(m, 0.05, 0.7);
          const fp = progress(m, 0.8, 0.8);
          const z = variant === 'zoom-region' ? 1 + (Math.min(1 / f.w, 1 / f.h) * 0.8 - 1) * EASE.inOut(clamp((s - 0.9) / 1.2)) : 1;
          const ox = (f.x + f.w / 2) * 100;
          const oy = (f.y + f.h / 2) * 100;
          return (
            <div style={{ position: 'relative', width: box.width, height: box.height, opacity: enter, transform: `scale(${0.96 + 0.04 * enter})`, borderRadius: u * 2, overflow: 'hidden', boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.35)` }}>
              <div style={{ position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: `${ox}% ${oy}%` }}>
                <Media src={c.screenshot} role="screenshot" width={box.width} height={box.height} fit="contain" />
              </div>
              {variant === 'spotlight' ? (
                <svg width={box.width} height={box.height} style={{ position: 'absolute', inset: 0 }}>
                  <defs>
                    <mask id="spot">
                      <rect width="100%" height="100%" fill="white" />
                      <rect x={f.x * box.width} y={f.y * box.height} width={f.w * box.width} height={f.h * box.height} rx={u * 1.5} fill="black" />
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill={`rgba(0,0,0,${0.6 * fp})`} mask="url(#spot)" />
                  <rect x={f.x * box.width} y={f.y * box.height} width={f.w * box.width} height={f.h * box.height} rx={u * 1.5} fill="none" stroke={v.tokens.palette.primary} strokeWidth={u * 0.5} opacity={fp} />
                </svg>
              ) : null}
              {variant === 'callouts'
                ? (c.callouts ?? []).map((co, i) => {
                    const cp = progress(m, 0.8 + i * 0.35, 0.5, 'elastic');
                    return (
                      <div key={i} style={{ position: 'absolute', left: co.x * box.width, top: co.y * box.height, transform: `translate(-50%, -50%) scale(${cp})` }}>
                        <Surface tone="primary" radius={999} style={{ padding: `${u * 1.2}px ${u * 2.4}px`, whiteSpace: 'nowrap' }}>
                          <Text text={co.text} role="label" size={(u * 3.2) / v.canvas.u} minSize={2} animate="none" color={v.tokens.palette.textOnPrimary} maxLines={1} />
                        </Surface>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        }}
      />
    );
  },
);

export { Stage, Reveal, overshoot, useLayout };
