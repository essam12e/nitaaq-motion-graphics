/** CTA families: cta-clean, cta-logo, cta-button, cta-contact, cta-qr. The CTA text is always critical for QC (never clipped, never hidden). */
import React from 'react';
import { z } from 'zod';
import QRCode from 'qrcode';
import { defineScene, ALL_ASPECTS } from '../registry';
import { HeadingFields, useSceneTime, Button, Eyebrow, Reveal } from '../kit';
import { useVideo } from '../../engine/context';
import { Text } from '../../typography/Text';
import { Media, fitBox, useAspect } from '../../components/Media';
import { Surface } from '../../components/Surface';
import { Icon } from '../../components/Icon';
import { Cursor } from '../../components/Cursor';
import { clamp, progress, float } from '../../motion/primitives';
import { alpha } from '../../brand/color';

const CtaBase = z.object({
  eyebrow: HeadingFields.eyebrow,
  title: z.string().min(1).max(120),
  highlight: HeadingFields.highlight,
  subtitle: HeadingFields.subtitle,
  button: z.string().max(40).optional(),
  buttonIcon: z.string().optional(),
});

function Column({ children, gap = 3 }: { children: React.ReactNode; gap?: number }) {
  const { canvas } = useVideo();
  const s = canvas.safe;
  return <div style={{ position: 'absolute', left: s.x, top: s.y, width: s.width, height: s.height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: canvas.u * gap }}>{children}</div>;
}

function useLogo(explicit?: string) {
  const { spec } = useVideo();
  return explicit ?? spec.brand?.logo;
}

function LogoMark({ src, maxW, maxH, delay = 0 }: { src: string; maxW: number; maxH: number; delay?: number }) {
  const ar = useAspect(src, 1);
  const box = fitBox(ar, maxW, maxH);
  return (
    <Reveal delay={delay} family="scale">
      <Media src={src} role="logo" width={box.width} height={box.height} fit="contain" />
    </Reveal>
  );
}

// ───────────────────────── cta-clean
type CleanC = z.infer<typeof CtaBase>;
export const ctaClean = defineScene<CleanC>(
  {
    id: 'cta-clean',
    version: '1.0.0',
    category: 'cta',
    title: 'Clean CTA',
    description: 'Headline + optional button, calm and clear; variants center / stacked / underline.',
    variants: ['center', 'stacked', 'underline'],
    defaultVariant: 'center',
    content: CtaBase,
    defaultDuration: 3.2,
    minDuration: 2.2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-out', 'push'],
    sfx: [
      { at: 0.1, category: 'whoosh', weight: 0.4 },
      { at: 0.9, category: 'pop', weight: 0.4 },
    ],
    safeArea: 'strict',
    beats: ['cta'],
    energy: 0.5,
    example: { title: 'ابدأ متجرك اليوم', highlight: ['اليوم'], button: 'سجّل مجاناً' },
    editable: ['eyebrow', 'title', 'subtitle', 'button'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    return (
      <Column gap={variant === 'stacked' ? 2 : 3.2}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
        <Text text={c.title} highlight={c.highlight} role="headline" maxLines={3} maxWidth={safe.width} delay={0.1} critical qcId="cta-title" />
        {variant === 'underline' ? <div style={{ width: u * 24 * progress(m, 0.6, 0.6), height: u * 0.6, borderRadius: 99, background: t.palette.primary }} /> : null}
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.5} maxWidth={safe.width} /> : null}
        {c.button ? <Button label={c.button} delay={0.8} icon={c.buttonIcon} /> : null}
      </Column>
    );
  },
);

// ───────────────────────── cta-logo
const LogoCtaC = CtaBase.extend({ logo: z.string().optional() });
type LC = z.infer<typeof LogoCtaC>;
export const ctaLogo = defineScene<LC>(
  {
    id: 'cta-logo',
    version: '1.0.0',
    category: 'cta',
    title: 'Logo CTA',
    description: "End card with the user's logo (only if provided) + CTA; variants lockup / reveal. Falls back to brand-name text, never a fake logo.",
    variants: ['lockup', 'reveal'],
    defaultVariant: 'lockup',
    content: LogoCtaC,
    defaultDuration: 3.4,
    minDuration: 2.4,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-out', 'crossfade', 'light-sweep'],
    sfx: [
      { at: 0, category: 'whoosh', weight: 0.4 },
      { at: 0.5, category: 'impact', weight: 0.45 },
    ],
    safeArea: 'strict',
    beats: ['cta', 'brand'],
    energy: 0.5,
    example: { title: 'اطلب الآن', button: 'تسوّق الآن' },
    editable: ['eyebrow', 'title', 'subtitle', 'button'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const logo = useLogo(c.logo);
    const name = v.spec.brand?.name;
    const glow = progress(m, 0.2, 1.2);
    return (
      <Column gap={3}>
        {variant === 'reveal' ? <div style={{ position: 'absolute', width: safe.width, height: safe.width, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(t.palette.primary, 0.25 * glow)}, transparent 60%)`, pointerEvents: 'none' }} /> : null}
        {logo ? (
          <LogoMark src={logo} maxW={Math.min(safe.width * 0.5, u * 50)} maxH={u * (v.canvas.isTall ? 22 : 18)} delay={0} />
        ) : name ? (
          <Text text={name} role="title" size={6} delay={0} animate="block" maxLines={1} maxWidth={safe.width} color={t.palette.textPrimary} />
        ) : null}
        <Text text={c.title} highlight={c.highlight} role="headline" size={8.4} maxLines={3} maxWidth={safe.width} delay={0.35} critical qcId="cta-title" />
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.6} maxWidth={safe.width} /> : null}
        {c.button ? <Button label={c.button} delay={0.9} icon={c.buttonIcon} /> : null}
      </Column>
    );
  },
);

// ───────────────────────── cta-button
type BC = z.infer<typeof CtaBase>;
export const ctaButton = defineScene<BC>(
  {
    id: 'cta-button',
    version: '1.0.0',
    category: 'cta',
    title: 'Button CTA',
    description: 'The button is the hero: a cursor/tap presses it, or it pulses; variants press / pulse / tap.',
    variants: ['press', 'pulse', 'tap'],
    defaultVariant: 'press',
    content: CtaBase.extend({ button: z.string().min(1).max(40) }),
    defaultDuration: 3.2,
    minDuration: 2.2,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['zoom-in', 'crossfade'],
    sfx: [
      { at: 0.2, category: 'pop', weight: 0.35 },
      { at: 1.5, category: 'click', weight: 0.55 },
      { at: 1.6, category: 'success', weight: 0.35, volume: 0.5 },
    ],
    safeArea: 'strict',
    beats: ['cta'],
    energy: 0.6,
    example: { title: 'جرّبه مجاناً ١٤ يوم', button: 'ابدأ الآن', buttonIcon: 'ArrowLeft' },
    editable: ['eyebrow', 'title', 'subtitle', 'button'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s, holdSec } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const pressAt = Math.min(1.5, holdSec * 0.6);
    const pressed = variant === 'pulse' ? 0 : clamp(1 - Math.abs(s - pressAt) / 0.12);
    const pulse = variant === 'pulse' ? 1 + 0.04 * Math.sin(s * 5) : 1;
    const ring = variant === 'pulse' ? (s * 0.8) % 1 : clamp((s - pressAt) / 0.6);
    const btnW = Math.min(safe.width * 0.8, u * 64);
    return (
      <Column gap={4}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} /> : null}
        <Text text={c.title} highlight={c.highlight} role="headline" size={8.6} maxLines={3} maxWidth={safe.width} delay={0.1} critical qcId="cta-title" />
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.4} maxWidth={safe.width} /> : null}
        <div style={{ position: 'relative', transform: `scale(${pulse * 1.12})`, marginTop: u * 2 }}>
          {ring > 0 && ring < 1 ? <div style={{ position: 'absolute', inset: -u * 3 * ring, borderRadius: 999, border: `${u * 0.5}px solid ${alpha(t.palette.primary, 1 - ring)}` }} /> : null}
          <Button label={c.button ?? ''} delay={0.5} width={btnW} pressed={pressed} icon={c.buttonIcon} />
          {variant !== 'pulse' ? (
            <Cursor
              size={variant === 'tap' ? 7 : 5}
              keys={[
                { t: 0.6, x: btnW * 0.95, y: u * 22 },
                { t: pressAt - 0.1, x: btnW * 0.56, y: u * 5 },
                { t: pressAt, x: btnW * 0.56, y: u * 5, click: true },
                { t: pressAt + 1, x: btnW * 0.62, y: u * 9 },
              ]}
            />
          ) : null}
        </div>
      </Column>
    );
  },
);

// ───────────────────────── cta-contact
const ContactC = CtaBase.extend({
  contacts: z
    .array(z.object({ kind: z.enum(['phone', 'whatsapp', 'website', 'email', 'handle', 'location', 'store']), value: z.string().min(1).max(60) }))
    .min(1)
    .max(4),
  logo: z.string().optional(),
});
type CoC = z.infer<typeof ContactC>;
const CONTACT_ICON: Record<CoC['contacts'][number]['kind'], string> = {
  phone: 'Phone',
  whatsapp: 'MessageCircle',
  website: 'Globe',
  email: 'Mail',
  handle: 'AtSign',
  location: 'MapPin',
  store: 'Store',
};
export const ctaContact = defineScene<CoC>(
  {
    id: 'cta-contact',
    version: '1.0.0',
    category: 'cta',
    title: 'Contact CTA',
    description: "The user's own contact details (phone, website, handle…) with icons; variants card / list.",
    variants: ['card', 'list'],
    defaultVariant: 'card',
    content: ContactC,
    defaultDuration: 3.8,
    minDuration: 2.6,
    maxDuration: 8,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'push'],
    sfx: [
      { at: 0.2, category: 'pop', weight: 0.35 },
      { at: 0.6, category: 'tick', weight: 0.3 },
    ],
    safeArea: 'strict',
    beats: ['cta'],
    energy: 0.4,
    example: { title: 'تواصل معنا', contacts: [{ kind: 'whatsapp', value: '+966 5X XXX XXXX' }, { kind: 'website', value: 'example.com' }] },
    editable: ['eyebrow', 'title', 'subtitle', 'button'],
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const logo = useLogo(c.logo);
    const W = Math.min(safe.width, u * 92);
    const rows = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: u * 1.8, width: W - (variant === 'card' ? u * 6 : 0) }}>
        {c.contacts.map((ct, i) => (
          <Reveal key={i} delay={0.5 + i * 0.15}>
            <div style={{ display: 'flex', alignItems: 'center', gap: u * 2 }}>
              <Icon name={CONTACT_ICON[ct.kind]} size={u * 3.6} treatment="badge" />
              <Text text={ct.value} role="subtitle" size={4.6} minSize={3} animate="none" align="start" maxLines={1} maxWidth={W - u * 16} critical color={variant === 'card' ? t.palette.textOnSurface : t.palette.textPrimary} qcId={`contact-${i}`} />
            </div>
          </Reveal>
        ))}
      </div>
    );
    return (
      <Column gap={3}>
        {logo ? <LogoMark src={logo} maxW={u * 36} maxH={u * 14} /> : null}
        <Text text={c.title} highlight={c.highlight} role="headline" size={8.4} maxLines={2} maxWidth={safe.width} delay={0.15} critical qcId="cta-title" />
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" delay={0.3} maxWidth={safe.width} /> : null}
        {variant === 'card' ? (
          <Reveal delay={0.35} family="rise">
            <Surface style={{ padding: u * 3 }}>{rows}</Surface>
          </Reveal>
        ) : (
          rows
        )}
        {c.button ? <Button label={c.button} delay={1} icon={c.buttonIcon} /> : null}
      </Column>
    );
  },
);

// ───────────────────────── cta-qr
const QrC = CtaBase.extend({ url: z.string().min(1).max(300), caption: z.string().max(60).optional() });
type QC = z.infer<typeof QrC>;

function QrCode({ value, size, fg, bg }: { value: string; size: number; fg: string; bg: string }) {
  const qr = React.useMemo(() => QRCode.create(value, { errorCorrectionLevel: 'M' }), [value]);
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  const rects: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) rects.push(<rect key={`${x}-${y}`} x={(x + quiet) * cell} y={(y + quiet) * cell} width={cell + 0.3} height={cell + 0.3} />);
  return (
    <svg width={size} height={size} data-qc="qr" data-qc-value={value} style={{ background: bg, borderRadius: cell * 1.5, display: 'block' }}>
      <g fill={fg}>{rects}</g>
    </svg>
  );
}

export const ctaQr = defineScene<QC>(
  {
    id: 'cta-qr',
    version: '1.0.0',
    category: 'cta',
    title: 'QR CTA',
    description: 'Scannable QR code (always dark-on-light for scan reliability) generated from the user URL; variants card / side.',
    variants: ['card', 'side'],
    defaultVariant: 'card',
    content: QrC,
    defaultDuration: 4,
    minDuration: 3,
    maxDuration: 9,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['crossfade', 'zoom-in'],
    sfx: [
      { at: 0.4, category: 'pop', weight: 0.4 },
      { at: 1.2, category: 'digital', weight: 0.4 },
    ],
    safeArea: 'strict',
    beats: ['cta'],
    energy: 0.4,
    example: { title: 'امسح الكود وابدأ', url: 'https://example.com', caption: 'example.com' },
    editable: ['eyebrow', 'title', 'subtitle', 'url', 'caption'],
    validate: (c) => (/^(https?:\/\/|mailto:|tel:|WIFI:)/i.test(c.url) ? [] : [{ path: 'content.url', message: 'QR url should start with https://, mailto: or tel:', severity: 'warning' }]),
  },
  ({ content: c, variant }) => {
    const v = useVideo();
    const { m, s } = useSceneTime();
    const t = v.tokens;
    const { u, safe } = v.canvas;
    const landscape = v.canvas.orientation === 'landscape';
    const side = variant === 'side' && landscape;
    const size = Math.min(side ? safe.height * 0.62 : safe.width * 0.5, side ? safe.width * 0.34 : safe.height * 0.34, u * 60);
    const scan = (s * 0.7) % 1;
    const p = progress(m, 0.3, 0.7, 'elastic');
    const qr = (
      <div style={{ transform: `scale(${p}) translateY(${float(m.frame, m.fps, u * 0.4, 4)}px)`, position: 'relative' }}>
        <div style={{ padding: u * 1.6, borderRadius: u * 3, background: '#FFFFFF', boxShadow: `0 ${u * 2}px ${u * 6}px ${alpha('#000', 0.3)}, 0 0 0 ${u * 0.5}px ${alpha(t.palette.primary, 0.6)}` }}>
          <QrCode value={c.url} size={size} fg="#0B0B0F" bg="#FFFFFF" />
        </div>
        {p > 0.9 ? <div style={{ position: 'absolute', left: u * 1.6, right: u * 1.6, top: u * 1.6 + scan * size, height: u * 0.5, background: alpha(t.palette.primary, 0.7), boxShadow: `0 0 ${u * 2}px ${t.palette.primary}` }} /> : null}
      </div>
    );
    const text = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: side ? 'flex-start' : 'center', gap: u * 2, maxWidth: side ? safe.width * 0.55 : safe.width }}>
        {c.eyebrow ? <Eyebrow text={c.eyebrow} align={side ? 'start' : 'center'} /> : null}
        <Text text={c.title} highlight={c.highlight} role="headline" size={8.4} align={side ? 'start' : 'center'} maxLines={3} maxWidth={side ? safe.width * 0.55 : safe.width} delay={0.1} critical qcId="cta-title" />
        {c.subtitle ? <Text text={c.subtitle} role="subtitle" align={side ? 'start' : 'center'} delay={0.4} maxWidth={side ? safe.width * 0.55 : safe.width} /> : null}
        {c.caption ? (
          <div style={{ direction: 'ltr' }}>
            <Text text={c.caption} role="label" size={3.8} font="latin" animate="none" maxLines={1} color={v.hl} />
          </div>
        ) : null}
      </div>
    );
    return (
      <div style={{ position: 'absolute', left: safe.x, top: safe.y, width: safe.width, height: safe.height, display: 'flex', flexDirection: side ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', gap: u * (side ? 6 : 3.4), direction: v.dir }}>
        {text}
        {qr}
      </div>
    );
  },
);
