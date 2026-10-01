/** Mobile families: phone-mockup, app-walkthrough, notification-stack, multi-phone. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { PhoneFrame, useUiPalette } from '../../components/Mockups';
import { Media, useAspect } from '../../components/Media';
import { Icon } from '../../components/Icon';
import { clamp, progress, EASE, float, overshoot } from '../../motion/primitives';
import { alpha } from '../../brand/color';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);

const ScreenSchema = z.object({
  screenshot: z.string().optional(),
  appName: z.string().max(30).optional(),
  headline: z.string().max(60).optional(),
  items: z.array(z.string().max(40)).max(5).optional(),
  button: z.string().max(24).optional(),
});
type Screen = z.infer<typeof ScreenSchema>;

/** App screen: the user's screenshot (contain, scrollable) or a clean mock from their words. */
function AppScreen({ screen, width, height, scroll = 0 }: { screen: Screen; width: number; height: number; scroll?: number }) {
  const ui = useUiPalette();
  const v = useVideo();
  const ar = useAspect(screen.screenshot, width / height);
  const u = width / 100;
  if (screen.screenshot) {
    const imgH = width / ar;
    return (
      <div style={{ position: 'absolute', inset: 0, background: ui.page, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: -Math.max(0, imgH - height) * scroll }}>
          <Media src={screen.screenshot} role="screenshot" width={width} height={imgH} fit="contain" />
        </div>
      </div>
    );
  }
  const items = screen.items ?? [];
  return (
    <div style={{ position: 'absolute', inset: 0, background: ui.page, padding: `${u * 16}px ${u * 7}px ${u * 7}px`, display: 'flex', flexDirection: 'column', gap: u * 4, transform: `translateY(${-scroll * u * 30}px)` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {screen.appName ? <Text text={screen.appName} role="label" size={(u * 6) / v.canvas.u} minSize={1.6} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={width * 0.6} weight={700} /> : <div />}
        <div style={{ width: u * 10, height: u * 10, borderRadius: 99, background: alpha(ui.primary, 0.25) }} />
      </div>
      <div style={{ borderRadius: u * 6, padding: u * 6, background: `linear-gradient(140deg, ${ui.primary}, ${alpha(ui.accent, 0.9)})`, minHeight: u * 40, display: 'flex', alignItems: 'flex-end' }}>
        {screen.headline ? <Text text={screen.headline} role="title" size={(u * 7) / v.canvas.u} minSize={1.8} animate="none" align="start" color={ui.onPrimary} maxLines={2} maxWidth={width * 0.75} /> : null}
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: u * 4, padding: u * 4, borderRadius: u * 4, background: ui.panel, border: `1px solid ${ui.line}` }}>
          <div style={{ width: u * 12, height: u * 12, borderRadius: u * 3, background: alpha(i % 2 ? ui.accent : ui.primary, 0.3), flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text text={it} role="label" size={(u * 5) / v.canvas.u} minSize={1.5} animate="none" align="start" color={ui.text} maxLines={1} maxWidth={width * 0.62} />
          </div>
        </div>
      ))}
      {screen.button ? (
        <div style={{ marginTop: 'auto', height: u * 14, borderRadius: u * 4, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text text={screen.button} role="label" size={(u * 5.2) / v.canvas.u} minSize={1.6} animate="none" color={ui.onPrimary} maxLines={1} />
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────── phone-mockup
const PhoneC = Heading.extend({ screen: ScreenSchema });
type PC = z.infer<typeof PhoneC>;
export const phoneMockup = defineScene<PC>(
  {
    id: 'phone-mockup',
    version: '1.0.0',
    category: 'mobile',
    title: 'Phone mockup',
    description: 'App screen in a phone; variants float / tilt / scroll / hero.',
    variants: ['float', 'tilt', 'scroll', 'hero'],
    defaultVariant: 'float',
    content: PhoneC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'slide'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.55 },
      { at: 0.5, category: 'pop', weight: 0.25 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'product', 'solution', 'feature'],
    energy: 0.55,
    example: { title: 'تطبيقك في جيب عميلك', highlight: ['جيب'], screen: { appName: 'متجري', headline: 'تشكيلة الموسم', items: ['عطور', 'بخور', 'هدايا'], button: 'تسوق الآن' } },
    editable: ['eyebrow', 'title', 'subtitle', 'screen.appName', 'screen.headline', 'screen.button'],
  },
  ({ content: c, variant }) => {
    const { m, s, durSec } = useSceneTime();
    const v = useVideo();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const H = Math.min(h * 0.96, (w / 0.49) * 0.95);
          const W = H * 0.49;
          const enter = progress(m, 0.05, 0.9);
          const fy = float(m.frame, m.fps, (m.floatK ?? 1) * v.canvas.u * 1.4, 4);
          const t = s / durSec;
          let tf = `translateY(${(1 - enter) * H * 0.35 + fy}px)`;
          if (variant === 'tilt') tf = `perspective(2200px) rotateY(${-22 + 14 * enter + 6 * t}deg) rotateX(${8 - 4 * t}deg) translateY(${(1 - enter) * H * 0.3}px)`;
          if (variant === 'hero') tf = `scale(${1.25 - 0.25 * EASE.smooth(enter)}) rotate(${(1 - enter) * -6}deg)`;
          const scroll = variant === 'scroll' ? EASE.inOut(clamp((s - 0.9) / Math.max(1, durSec - 1.8))) : 0;
          return (
            <div style={{ position: 'relative', transform: tf, opacity: clamp(enter * 1.6) }}>
              <div style={{ position: 'absolute', left: '50%', bottom: -H * 0.04, width: W * 0.9, height: H * 0.05, transform: 'translateX(-50%)', borderRadius: '50%', background: 'rgba(0,0,0,0.35)', filter: `blur(${H * 0.02}px)` }} />
              <PhoneFrame height={H}>
                <AppScreen screen={c.screen} width={W * 0.93} height={H * 0.965} scroll={scroll} />
              </PhoneFrame>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── app-walkthrough
const WalkC = Heading.extend({ screens: z.array(ScreenSchema.extend({ caption: z.string().max(50).optional() })).min(2).max(4) });
type WC = z.infer<typeof WalkC>;
export const appWalkthrough = defineScene<WC>(
  {
    id: 'app-walkthrough',
    version: '1.0.0',
    category: 'mobile',
    title: 'App walkthrough',
    description: 'Steps through several app screens with captions; variants sequence / carousel.',
    variants: ['sequence', 'carousel'],
    defaultVariant: 'sequence',
    content: WalkC,
    defaultDuration: 5.5,
    minDuration: 3.5,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'crossfade'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.5 },
      { at: 1.8, category: 'swoosh', weight: 0.45 },
      { at: 3.4, category: 'swoosh', weight: 0.4 },
    ],
    safeArea: 'normal',
    beats: ['demo', 'process', 'feature'],
    energy: 0.55,
    example: { title: 'ثلاث خطوات وتطلب', highlight: ['ثلاث'], screens: [{ appName: 'متجري', headline: 'اختر المنتج', caption: 'تصفّح', items: ['عطور', 'بخور'] }, { appName: 'متجري', headline: 'أضف للسلة', caption: 'أضف', button: 'أضف للسلة' }, { appName: 'متجري', headline: 'ادفع بسهولة', caption: 'ادفع', button: 'ادفع الآن' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const { m, s, holdSec } = useSceneTime();
    const v = useVideo();
    const n = c.screens.length;
    const per = (holdSec - 0.4) / n;
    const idxF = clamp((s - 0.3) / per, 0, n - 0.001);
    const idx = Math.floor(idxF);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const H = Math.min(h * 0.86, (w / 0.49) * (variant === 'carousel' ? 0.55 : 0.9));
          const W = H * 0.49;
          const enter = progress(m, 0.05, 0.8);
          const u = v.canvas.u;
          if (variant === 'carousel') {
            const pos = EASE.inOut(clamp(idxF - idx > 0.75 ? (idxF - idx - 0.75) * 4 : 0)) + idx;
            return (
              <div style={{ position: 'relative', width: w, height: H * 1.12, opacity: enter }}>
                {c.screens.map((sc, i) => {
                  const d = i - pos;
                  const dirSign = v.dir === 'rtl' ? -1 : 1;
                  return (
                    <div key={i} style={{ position: 'absolute', left: '50%', top: 0, transform: `translateX(calc(-50% + ${dirSign * d * W * 1.08}px)) scale(${1 - Math.min(1, Math.abs(d)) * 0.16})`, opacity: 1 - Math.min(1, Math.abs(d)) * 0.5, zIndex: 10 - Math.round(Math.abs(d) * 2) }}>
                      <PhoneFrame height={H}>
                        <AppScreen screen={sc} width={W * 0.93} height={H * 0.965} />
                      </PhoneFrame>
                    </div>
                  );
                })}
              </div>
            );
          }
          const local = idxF - idx;
          const inP = EASE.smooth(clamp(local * 4));
          const sc = c.screens[idx];
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2.5, opacity: enter }}>
              <PhoneFrame height={H}>
                {c.screens.map((scr, i) => (
                  <div key={i} style={{ position: 'absolute', inset: 0, opacity: i === idx ? inP : i === idx - 1 ? 1 - inP : 0, transform: `translateX(${i === idx ? (1 - inP) * (v.dir === 'rtl' ? -1 : 1) * -30 : 0}%)` }}>
                    <AppScreen screen={scr} width={W * 0.93} height={H * 0.965} />
                  </div>
                ))}
              </PhoneFrame>
              <div style={{ display: 'flex', gap: u * 1.2, direction: v.dir }}>
                {c.screens.map((_, i) => (
                  <div key={i} style={{ width: i === idx ? u * 5 : u * 1.6, height: u * 1.6, borderRadius: 99, background: i === idx ? v.tokens.palette.primary : alpha(v.tokens.palette.textPrimary, 0.25) }} />
                ))}
              </div>
              {sc.caption ? <Text key={idx} text={`${idx + 1}. ${sc.caption}`} role="subtitle" animate="none" color={v.tokens.palette.textPrimary} maxLines={1} /> : null}
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── notification-stack
const NotifC = Heading.extend({ notifications: z.array(z.object({ app: z.string().max(24), text: z.string().max(70), icon: z.string().optional() })).min(1).max(4), time: z.string().max(10).optional() });
type NC = z.infer<typeof NotifC>;
export const notificationStack = defineScene<NC>(
  {
    id: 'notification-stack',
    version: '1.0.0',
    category: 'mobile',
    title: 'Mobile notifications',
    description: 'Notifications landing on a phone lock screen or as banners; variants lockscreen / banners.',
    variants: ['lockscreen', 'banners'],
    defaultVariant: 'lockscreen',
    content: NotifC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'zoom-in', 'crossfade'],
    sfx: [
      { at: 0.5, category: 'notification', weight: 0.7 },
      { at: 1.0, category: 'notification', weight: 0.45 },
      { at: 1.5, category: 'notification', weight: 0.35 },
    ],
    safeArea: 'normal',
    beats: ['hook', 'proof', 'social', 'problem'],
    energy: 0.6,
    example: { title: 'الإشعار اللي تنتظره', highlight: ['تنتظره'], time: '9:41', notifications: [{ app: 'متجري', text: 'وصلك طلب جديد', icon: 'ShoppingBag' }, { app: 'متجري', text: 'عميل أضاف منتج للسلة', icon: 'ShoppingCart' }] },
    editable: ['eyebrow', 'title', 'subtitle', 'time'],
  },
  ({ content: c, variant }) => {
    const { m } = useSceneTime();
    const v = useVideo();
    const ui = useUiPalette();
    const notif = (n: NC['notifications'][number], i: number, width: number) => {
      const u = width / 100;
      const p = overshoot(m, 0.45 + i * 0.5, 190);
      return (
        <div key={i} style={{ width, transform: `translateY(${(1 - clamp(p)) * -u * 30}px) scale(${0.85 + 0.15 * p})`, opacity: clamp(p * 2), background: alpha(v.tokens.mode === 'dark' ? '#2A2B30' : '#FFFFFF', 0.9), backdropFilter: 'blur(20px)', borderRadius: u * 6, padding: u * 4.4, display: 'flex', gap: u * 3.6, alignItems: 'center', boxShadow: `0 ${u * 2}px ${u * 6}px rgba(0,0,0,0.25)` }}>
          <div style={{ width: u * 14, height: u * 14, borderRadius: u * 3.6, background: ui.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={n.icon ?? 'Bell'} size={u * 7} color={ui.onPrimary} treatment="plain" />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u }}>
            <Text text={n.app} role="caption" size={(u * 4) / v.canvas.u} minSize={1.5} animate="none" align="start" color={v.tokens.mode === 'dark' ? '#C9CBD2' : '#555'} maxLines={1} weight={600} maxWidth={width * 0.7} />
            <Text text={n.text} role="label" size={(u * 5.2) / v.canvas.u} minSize={1.6} animate="none" align="start" color={v.tokens.mode === 'dark' ? '#FFFFFF' : '#111'} maxLines={2} maxWidth={width * 0.7} />
          </div>
        </div>
      );
    };
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          if (variant === 'banners') {
            const W = Math.min(w, v.canvas.u * 90);
            return <div style={{ display: 'flex', flexDirection: 'column', gap: v.canvas.u * 2.4, width: W }}>{c.notifications.map((n, i) => notif(n, i, W))}</div>;
          }
          const H = Math.min(h * 0.96, (w / 0.49) * 0.95);
          const W = H * 0.49;
          const enter = progress(m, 0, 0.7);
          const u = W / 100;
          return (
            <div style={{ transform: `translateY(${(1 - enter) * H * 0.2}px)`, opacity: enter }}>
              <PhoneFrame height={H}>
                <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(170deg, ${v.tokens.palette.secondary}, ${v.tokens.palette.background} 60%, ${v.tokens.palette.primary})` }} />
                <div style={{ position: 'absolute', top: H * 0.1, left: 0, right: 0, textAlign: 'center', color: '#FFFFFF', fontFamily: v.fonts.latin, fontWeight: 300, fontSize: u * 22, direction: 'ltr' }}>{c.time ?? ''}</div>
                <div style={{ position: 'absolute', top: H * 0.36, left: u * 4, right: u * 4, display: 'flex', flexDirection: 'column', gap: u * 3 }}>{c.notifications.map((n, i) => notif(n, i, W * 0.85))}</div>
              </PhoneFrame>
            </div>
          );
        }}
      />
    );
  },
);

// ───────────────────────── multi-phone
const MultiC = Heading.extend({ screens: z.array(ScreenSchema).min(2).max(3) });
type MC = z.infer<typeof MultiC>;
export const multiPhone = defineScene<MC>(
  {
    id: 'multi-phone',
    version: '1.0.0',
    category: 'mobile',
    title: 'Multi-phone composition',
    description: 'Two or three phones composed together; variants fan / row / staggered.',
    variants: ['fan', 'row', 'staggered'],
    defaultVariant: 'fan',
    content: MultiC,
    defaultDuration: 3.8,
    minDuration: 2.4,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'crossfade'],
    sfx: [
      { at: 0.05, category: 'whoosh', weight: 0.5 },
      { at: 0.35, category: 'whoosh', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['product', 'feature', 'demo'],
    energy: 0.6,
    example: { title: 'تجربة متكاملة', highlight: ['متكاملة'], screens: [{ appName: 'متجري', headline: 'الرئيسية', items: ['عطور', 'بخور'] }, { appName: 'متجري', headline: 'المنتج', button: 'أضف للسلة' }, { appName: 'متجري', headline: 'الدفع', button: 'ادفع الآن' }] },
    editable: ['eyebrow', 'title', 'subtitle'],
  },
  ({ content: c, variant }) => {
    const { m } = useSceneTime();
    const v = useVideo();
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const n = c.screens.length;
          const H = Math.min(h * 0.9, ((w / (n * 0.49)) * 1.25) / (variant === 'row' ? 1.1 : 1));
          const W = H * 0.49;
          return (
            <div style={{ position: 'relative', width: w, height: H * 1.05 }}>
              {c.screens.map((sc, i) => {
                const mid = (n - 1) / 2;
                const d = i - mid;
                const p = progress(m, 0.05 + Math.abs(d) * 0.18, 0.9);
                const dirSign = v.dir === 'rtl' ? -1 : 1;
                let tf = '';
                if (variant === 'fan') tf = `translateX(${dirSign * d * W * 0.62 * p}px) rotate(${dirSign * d * 9 * p}deg) translateY(${Math.abs(d) * H * 0.05}px) scale(${1 - Math.abs(d) * 0.1})`;
                else if (variant === 'row') tf = `translateX(${dirSign * d * W * 1.08}px) translateY(${(1 - p) * H * 0.3}px)`;
                else tf = `translateX(${dirSign * d * W * 0.78}px) translateY(${d * H * 0.08 + (1 - p) * H * 0.3}px) scale(${1 - Math.abs(d) * 0.05})`;
                return (
                  <div key={i} style={{ position: 'absolute', left: '50%', top: 0, marginLeft: -W / 2, transform: tf, opacity: clamp(p * 1.5), zIndex: 10 - Math.abs(d) }}>
                    <PhoneFrame height={H}>
                      <AppScreen screen={sc} width={W * 0.93} height={H * 0.965} />
                    </PhoneFrame>
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
