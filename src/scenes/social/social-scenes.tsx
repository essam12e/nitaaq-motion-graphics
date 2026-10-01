/** Social families: comment, testimonial, chat-message, social-proof, stat-highlight. Quotes and numbers require a source; avatars are initials only. */
import React from 'react';
import { z } from 'zod';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, HeroSplit, useSceneTime, Avatar, Stars, formatNumber, Reveal, Eyebrow } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { useUiPalette } from '../../components/Mockups';
import { clamp, progress, countUp, float } from '../../motion/primitives';
import { alpha } from '../../brand/color';
import { gridShape } from '../../layout/stage';

const Heading = z.object({ eyebrow: HeadingFields.eyebrow, title: z.string().max(160).optional(), highlight: HeadingFields.highlight, subtitle: HeadingFields.subtitle });
const heading = (c: { eyebrow?: string; title?: string; highlight?: string[]; subtitle?: string }) => (c.title ? { eyebrow: c.eyebrow, title: c.title, highlight: c.highlight, subtitle: c.subtitle } : undefined);
const Source = z.string().min(1, 'real quotes/numbers need a source — the system never invents social proof');

// ───────────────────────── comment
const CommentC = Heading.extend({
  comments: z.array(z.object({ name: z.string().max(30), text: z.string().min(1).max(140), likes: z.number().int().nonnegative().optional() })).min(1).max(4),
  source: Source,
});
type CC = z.infer<typeof CommentC>;
export const comment = defineScene<CC>(
  {
    id: 'comment',
    version: '1.0.0',
    category: 'social',
    title: 'Comments',
    description: 'Real user comments as social-app comment bubbles (user-supplied only); variants bubbles / reply.',
    variants: ['bubbles', 'reply'],
    defaultVariant: 'bubbles',
    content: CommentC,
    defaultDuration: 4,
    minDuration: 2.6,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'slide'],
    sfx: [
      { at: 0.2, category: 'notification', weight: 0.4 },
      { at: 0.9, category: 'notification', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['social', 'proof', 'hook'],
    energy: 0.5,
    example: { comments: [{ name: 'سارة', text: 'الطلب وصلني بيومين والتغليف مرة حلو 😍', likes: 24 }, { name: 'فهد', text: 'ثاني مرة أطلب ومستحيل أغيّر' }], source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, holdSec } = useSceneTime();
    const t = v.tokens;
    const u = v.canvas.u;
    const per = Math.max(0.4, (holdSec - 0.6) / c.comments.length);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w) => {
          const W = Math.min(w, u * 92);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: u * 2, width: W }}>
              {c.comments.map((cm, i) => {
                const p = progress(m, 0.2 + i * per, 0.55, 'elastic');
                const indent = variant === 'reply' && i > 0 ? u * 8 : 0;
                return (
                  <div key={i} style={{ display: 'flex', gap: u * 1.6, alignItems: 'flex-start', marginInlineStart: indent, opacity: clamp(p * 2), transform: `translateY(${(1 - p) * u * 4}px) scale(${0.9 + 0.1 * p})`, transformOrigin: v.dir === 'rtl' ? 'right top' : 'left top' }}>
                    <Avatar name={cm.name} size={u * 7} tone={i} />
                    <Surface style={{ flex: 1, padding: `${u * 1.6}px ${u * 2.4}px`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: u * 0.6 }}>
                      <Text text={cm.name} role="label" size={3.1} weight={700} animate="none" align="start" maxLines={1} color={t.palette.textOnSurface} />
                      <Text text={cm.text} role="body" size={3.8} minSize={2.6} animate="none" align="start" maxLines={3} maxWidth={W - indent - u * 14} color={t.palette.textOnSurface} />
                      {cm.likes !== undefined ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: u * 0.8, direction: 'ltr' }}>
                          <Icon name="Heart" size={u * 2.8} color={t.palette.negative} treatment="plain" />
                          <span style={{ fontFamily: v.fonts.latin, fontSize: u * 2.6, color: t.palette.textSecondary }}>{formatNumber(countUp(m, 0, cm.likes, 0.4 + i * per, 0.8), { numerals: v.spec.project.numerals })}</span>
                        </div>
                      ) : null}
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

// ───────────────────────── testimonial
const TestiC = z.object({
  quote: z.string().min(1).max(220),
  name: z.string().min(1).max(40),
  role: z.string().max(60).optional(),
  rating: z.number().min(0).max(5).optional(),
  highlight: HeadingFields.highlight,
  source: Source,
});
type TeC = z.infer<typeof TestiC>;
export const testimonial = defineScene<TeC>(
  {
    id: 'testimonial',
    version: '1.0.0',
    category: 'social',
    title: 'Testimonial',
    description: 'A real, sourced customer quote with initials avatar and optional rating; variants card / quote / rating.',
    variants: ['card', 'quote', 'rating'],
    defaultVariant: 'card',
    content: TestiC,
    defaultDuration: 4.4,
    minDuration: 3,
    maxDuration: 10,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'push', 'blur'],
    sfx: [{ at: 0.3, category: 'pop', weight: 0.35 }],
    safeArea: 'normal',
    beats: ['social', 'proof'],
    energy: 0.35,
    textCapacity: { card: 160, quote: 200, rating: 120 },
    example: { quote: 'من أول أسبوع زادت طلباتنا والعملاء صاروا يرجعون', name: 'نورة', role: 'صاحبة متجر', rating: 5, source: 'example' },
    editable: ['quote', 'name', 'role', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const W = Math.min(safe.width, u * 110);
    const person = (
      <Reveal delay={1} family="fade">
        <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.8 }}>
          <Avatar name={c.name} size={u * 8} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Text text={c.name} role="label" size={3.8} weight={700} animate="none" align="start" maxLines={1} color={variant === 'card' ? t.palette.textOnSurface : t.palette.textPrimary} />
            {c.role ? <Text text={c.role} role="caption" animate="none" align="start" maxLines={1} /> : null}
          </div>
        </div>
      </Reveal>
    );
    const quoteMark = <span style={{ fontFamily: v.fonts.latin, fontSize: u * 22, lineHeight: 0.8, color: alpha(t.palette.primary, 0.8), height: u * 9, display: 'block', transform: v.dir === 'rtl' ? 'scaleX(-1)' : undefined }}>“</span>;
    const body = (
      <>
        {variant === 'rating' && c.rating !== undefined ? <Stars value={c.rating} size={u * 6} delay={0.2} /> : quoteMark}
        <Text text={c.quote} highlight={c.highlight} role={variant === 'quote' ? 'title' : 'subtitle'} size={variant === 'quote' ? 6.6 : 5} maxLines={variant === 'quote' ? 5 : 4} maxWidth={W - u * 8} delay={0.3} animate="lines" color={variant === 'card' ? t.palette.textOnSurface : undefined} />
        {variant !== 'rating' && c.rating !== undefined ? <Stars value={c.rating} size={u * 4} delay={0.9} /> : null}
        {person}
        {c.source !== 'example' ? <Text text={c.source} role="caption" size={2.3} minSize={2.2} animate="none" maxLines={1} color={t.palette.textSecondary} /> : null}
      </>
    );
    return (
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: safe.width, height: safe.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {variant === 'card' ? (
          <Reveal delay={0} family="scale">
            <Surface style={{ width: W, padding: u * 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2.4, transform: `translateY(${float(m.frame, m.fps, (m.floatK ?? 1) * u * 0.6, 5)}px)` }}>{body}</Surface>
          </Reveal>
        ) : (
          <div style={{ width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u * 2.6 }}>{body}</div>
        )}
      </div>
    );
  },
);

// ───────────────────────── chat-message
const ChatC = Heading.extend({
  messages: z.array(z.object({ from: z.enum(['me', 'them']), text: z.string().min(1).max(120) })).min(1).max(6),
  contact: z.string().max(30).optional(),
});
type ChC = z.infer<typeof ChatC>;
export const chatMessage = defineScene<ChC>(
  {
    id: 'chat-message',
    version: '1.0.0',
    category: 'social',
    title: 'Chat conversation',
    description: 'Messaging-app conversation with typing indicator (generic UI, no third-party branding); variants messenger / dm / support.',
    variants: ['messenger', 'dm', 'support'],
    defaultVariant: 'messenger',
    content: ChatC,
    defaultDuration: 4.8,
    minDuration: 2.6,
    maxDuration: 12,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['push', 'slide', 'crossfade'],
    sfx: [
      { at: 0.3, category: 'notification', weight: 0.4 },
      { at: 1.2, category: 'notification', weight: 0.35 },
      { at: 2.1, category: 'notification', weight: 0.3 },
    ],
    safeArea: 'normal',
    beats: ['problem', 'demo', 'social', 'hook'],
    energy: 0.5,
    example: { contact: 'خدمة العملاء', messages: [{ from: 'me', text: 'متى يوصل طلبي؟' }, { from: 'them', text: 'طلبك بالطريق، يوصلك بكرة 🚚' }, { from: 'me', text: 'شكراً 🙏' }] },
    editable: ['eyebrow', 'title', 'subtitle', 'contact'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, holdSec } = useSceneTime();
    const ui = useUiPalette();
    const t = v.tokens;
    const u = v.canvas.u;
    const n = c.messages.length;
    const per = Math.max(0.55, (holdSec - 0.4) / n);
    return (
      <HeroSplit
        heading={heading(c)}
        visual={(w, h) => {
          const W = Math.min(w, h * 0.75, u * 90);
          const H = Math.min(h, W * 1.5, u * 22 + n * u * 13);
          const bubbleMax = W * 0.74;
          const shown = c.messages.filter((_, i) => s >= 0.25 + i * per);
          const nextIdx = shown.length;
          const typing = nextIdx < n && c.messages[nextIdx].from === 'them' && s >= 0.25 + nextIdx * per - 0.45;
          const meBg = variant === 'dm' ? `linear-gradient(135deg, ${t.palette.primary}, ${t.palette.accent})` : t.palette.primary;
          return (
            <Reveal delay={0} family="rise">
              <div style={{ width: W, height: H, borderRadius: u * 3, background: ui.page, border: `1px solid ${ui.line}`, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: `0 ${u * 2}px ${u * 6}px ${alpha('#000', 0.3)}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.6, padding: `${u * 2}px ${u * 2.4}px`, background: ui.panel, borderBottom: `1px solid ${ui.line}` }}>
                  {variant === 'support' ? <Icon name="Headset" size={u * 3.6} treatment="badge" /> : <Avatar name={c.contact ?? '•'} size={u * 6} />}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <Text text={c.contact ?? ' '} role="label" size={3.4} weight={700} animate="none" align="start" maxLines={1} color={ui.text} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: u * 0.6 }}>
                      <div style={{ width: u, height: u, borderRadius: 99, background: t.palette.positive }} />
                    </div>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: u * 1.4, padding: u * 2.4, overflow: 'hidden' }}>
                  {shown.map((msg, i) => {
                    const p = progress(m, 0.25 + i * per, 0.4, 'elastic');
                    const me = msg.from === 'me';
                    return (
                      <div key={i} style={{ alignSelf: me ? 'flex-start' : 'flex-end', maxWidth: bubbleMax, transform: `scale(${0.6 + 0.4 * p})`, transformOrigin: me ? (v.dir === 'rtl' ? 'right bottom' : 'left bottom') : v.dir === 'rtl' ? 'left bottom' : 'right bottom', opacity: clamp(p * 2) }}>
                        <div style={{ padding: `${u * 1.4}px ${u * 2.2}px`, borderRadius: u * 2.6, background: me ? meBg : ui.panel, border: me ? undefined : `1px solid ${ui.line}` }}>
                          <Text text={msg.text} role="body" size={3.6} minSize={2.6} animate="none" align="start" maxLines={4} maxWidth={bubbleMax - u * 4.4} color={me ? t.palette.textOnPrimary : ui.text} />
                        </div>
                      </div>
                    );
                  })}
                  {typing ? (
                    <div style={{ alignSelf: 'flex-end', display: 'flex', gap: u * 0.7, padding: `${u * 1.6}px ${u * 2.2}px`, borderRadius: u * 2.6, background: ui.panel, border: `1px solid ${ui.line}` }}>
                      {[0, 1, 2].map((d) => (
                        <div key={d} style={{ width: u * 1.2, height: u * 1.2, borderRadius: 99, background: ui.muted, transform: `translateY(${Math.sin(s * 10 - d) * u * 0.4}px)` }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </Reveal>
          );
        }}
      />
    );
  },
);

// ───────────────────────── social-proof
const ProofC = Heading.extend({
  value: z.number().nonnegative(),
  prefix: z.string().max(6).optional(),
  suffix: z.string().max(8).optional(),
  label: z.string().min(1).max(60),
  rating: z.number().min(0).max(5).optional(),
  names: z.array(z.string().max(30)).max(5).optional(),
  source: Source,
});
type PrC = z.infer<typeof ProofC>;
export const socialProof = defineScene<PrC>(
  {
    id: 'social-proof',
    version: '1.0.0',
    category: 'social',
    title: 'Social proof',
    description: 'Sourced customer count / rating with initials avatars; variants avatars / rating / badge.',
    variants: ['avatars', 'rating', 'badge'],
    defaultVariant: 'avatars',
    content: ProofC,
    defaultDuration: 3.4,
    minDuration: 2.2,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade', 'push'],
    sfx: [
      { at: 0.3, category: 'riser', weight: 0.35 },
      { at: 1.3, category: 'success', weight: 0.4, volume: 0.5 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'social', 'cta'],
    energy: 0.55,
    example: { value: 1200, suffix: '+', label: 'عميل يثق فينا', rating: 4.8, names: ['سارة', 'فهد', 'نورة', 'خالد'], source: 'example' },
    editable: ['eyebrow', 'title', 'subtitle', 'label', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const val = formatNumber(countUp(m, 0, c.value, 0.3, 1.2), { prefix: c.prefix, suffix: c.suffix, decimals: Number.isInteger(c.value) ? 0 : 1, numerals: v.spec.project.numerals });
    const names = c.names ?? [];
    return (
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: safe.width, height: safe.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 3 }}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
        {c.title ? <Text text={c.title} highlight={c.highlight} role="title" maxLines={2} maxWidth={safe.width} /> : null}
        {variant === 'avatars' && names.length ? (
          <div style={{ display: 'flex', direction: 'ltr' }}>
            {names.map((nm, i) => {
              const p = progress(m, 0.1 + i * 0.1, 0.5, 'elastic');
              return (
                <div key={i} style={{ marginLeft: i ? -u * 2.4 : 0, transform: `scale(${p})`, border: `${u * 0.5}px solid ${t.palette.background}`, borderRadius: 99 }}>
                  <Avatar name={nm} size={u * 11} tone={i} />
                </div>
              );
            })}
          </div>
        ) : null}
        {variant === 'badge' ? (
          <Reveal delay={0.1} family="pop">
            <div style={{ width: u * 44, height: u * 44, borderRadius: 99, background: `conic-gradient(from ${m.frame}deg, ${t.palette.primary}, ${t.palette.accent}, ${t.palette.primary})`, padding: u * 1, boxSizing: 'border-box' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 99, background: t.palette.background, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u }}>
                <div style={{ direction: 'ltr' }}><Text text={val} role="number" size={10} minSize={6} font="latin" animate="none" color={v.hl} maxLines={1} maxWidth={u * 38} /></div>
                <Text text={c.label} role="label" size={3.4} animate="none" maxLines={2} maxWidth={u * 34} color={t.palette.textPrimary} />
              </div>
            </div>
          </Reveal>
        ) : (
          <>
            <div style={{ direction: 'ltr' }}><Text text={val} role="number" size={variant === 'rating' ? 16 : 18} font="latin" animate="none" color={v.hl} maxLines={1} maxWidth={safe.width} /></div>
            <Text text={c.label} role="subtitle" size={5} delay={0.5} maxLines={2} maxWidth={safe.width} color={t.palette.textPrimary} />
          </>
        )}
        {c.rating !== undefined ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: u * 1.6, direction: 'ltr' }}>
            <Stars value={c.rating} size={u * (variant === 'rating' ? 6.4 : 4.6)} delay={0.8} />
            <span style={{ fontFamily: v.fonts.latin, fontWeight: 700, fontSize: u * 3.6, color: t.palette.textPrimary }}>{formatNumber(c.rating, { decimals: 1, numerals: v.spec.project.numerals })}</span>
          </div>
        ) : null}
        {c.source !== 'example' ? <Text text={c.source} role="caption" size={2.3} minSize={2.2} animate="none" maxLines={1} color={t.palette.textSecondary} /> : null}
      </div>
    );
  },
);

// ───────────────────────── stat-highlight
const StatC = z.object({
  eyebrow: HeadingFields.eyebrow,
  value: z.number(),
  prefix: z.string().max(6).optional(),
  suffix: z.string().max(8).optional(),
  label: z.string().min(1).max(90),
  highlight: HeadingFields.highlight,
  icon: z.string().optional(),
  source: Source,
});
type StC = z.infer<typeof StatC>;
export const statHighlight = defineScene<StC>(
  {
    id: 'stat-highlight',
    version: '1.0.0',
    category: 'social',
    title: 'Stat highlight',
    description: 'One big sourced number with context line; variants center / split / ring.',
    variants: ['center', 'split', 'ring'],
    defaultVariant: 'center',
    content: StatC,
    defaultDuration: 3.2,
    minDuration: 2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'push', 'crossfade'],
    sfx: [
      { at: 0.2, category: 'riser', weight: 0.4 },
      { at: 1.2, category: 'impact', weight: 0.45 },
    ],
    safeArea: 'normal',
    beats: ['proof', 'data', 'hook', 'problem'],
    energy: 0.65,
    example: { value: 73, suffix: '%', label: 'من المتسوقين يشترون من الجوال', source: 'example' },
    editable: ['eyebrow', 'label', 'source'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const val = formatNumber(countUp(m, 0, c.value, 0.15, 1.1), { prefix: c.prefix, suffix: c.suffix, decimals: Number.isInteger(c.value) ? 0 : 1, numerals: v.spec.project.numerals });
    const landscape = v.canvas.orientation === 'landscape';
    const numberEl = (size: number) => (
      <div style={{ direction: 'ltr' }}>
        <Text text={val} role="number" size={size} font="latin" animate="none" color={v.hl} maxLines={1} maxWidth={landscape && variant === 'split' ? safe.width * 0.5 : safe.width} shadow={t.glow > 0.4} />
      </div>
    );
    const src = c.source !== 'example' ? <Text text={c.source} role="caption" size={2.3} minSize={2.2} animate="none" maxLines={1} color={t.palette.textSecondary} /> : null;
    if (variant === 'ring') {
      const D = Math.min(safe.width * 0.75, safe.height * 0.5);
      const R = D / 2 - u * 2;
      const C = 2 * Math.PI * R;
      const p = progress(m, 0.15, 1.1);
      const frac = c.suffix === '%' ? clamp(c.value / 100) : 1;
      return (
        <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: safe.width, height: safe.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u * 3 }}>
          {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
          <div style={{ position: 'relative', width: D, height: D }}>
            <svg width={D} height={D} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={alpha(t.palette.textPrimary, 0.08)} strokeWidth={u * 2.4} />
              <circle cx={D / 2} cy={D / 2} r={R} fill="none" stroke={t.palette.primary} strokeWidth={u * 2.4} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac * p)} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{numberEl(D / u / 4.4)}</div>
          </div>
          <Text text={c.label} highlight={c.highlight} role="title" size={5.6} delay={0.6} maxLines={3} maxWidth={safe.width} />
          {src}
        </div>
      );
    }
    const split = variant === 'split' && landscape;
    return (
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: safe.width, height: safe.height, display: 'flex', flexDirection: split ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: u * (split ? 5 : 2.4), direction: v.dir }}>
        {c.eyebrow && !split ? <Eyebrow text={c.eyebrow} /> : null}
        {c.icon && !split ? <Icon name={c.icon} size={u * 6} treatment="badge" /> : null}
        {numberEl(split ? 24 : 26)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: split ? 'flex-start' : 'center', gap: u * 1.6, maxWidth: split ? safe.width * 0.45 : safe.width }}>
          {c.eyebrow && split ? <Eyebrow text={c.eyebrow} align="start" /> : null}
          <Text text={c.label} highlight={c.highlight} role="title" size={6} delay={0.6} align={split ? 'start' : 'center'} maxLines={3} maxWidth={split ? safe.width * 0.45 : safe.width} />
          {src}
        </div>
      </div>
    );
  },
);

export { gridShape };
