/** Device and UI mockups: browser frame, phone frame, generic app UI blocks. Neutral, unbranded. */
import React, { type CSSProperties } from 'react';
import { useVideo } from '../engine/context';
import { alpha, mix } from '../brand/color';
import { Text } from '../typography/Text';
import { Icon } from './Icon';

export function useUiPalette() {
  const { tokens: t } = useVideo();
  const p = t.palette;
  // UI chrome is always a light or dark "app" surface derived from the style for realism.
  const dark = t.mode === 'dark';
  return {
    chrome: dark ? mix(p.surface, '#000000', 0.25) : '#F2F3F5',
    page: dark ? mix(p.surface, '#000000', 0.1) : '#FFFFFF',
    panel: dark ? mix(p.surface, '#FFFFFF', 0.04) : '#F7F8FA',
    line: dark ? alpha('#FFFFFF', 0.08) : alpha('#000000', 0.08),
    text: dark ? '#EEF0F4' : '#15171C',
    muted: dark ? alpha('#EEF0F4', 0.55) : alpha('#15171C', 0.55),
    primary: p.primary,
    onPrimary: p.textOnPrimary,
    accent: p.accent,
    positive: p.positive,
  };
}

export function BrowserFrame({ width, height, url, children, style }: { width: number; height: number; url?: string; children?: React.ReactNode; style?: CSSProperties }) {
  const { canvas, fonts } = useVideo();
  const ui = useUiPalette();
  const u = canvas.u;
  const bar = Math.max(u * 5.5, height * 0.075);
  return (
    <div data-qc="box" style={{ width, height, borderRadius: u * 2, overflow: 'hidden', background: ui.page, boxShadow: `0 ${u * 3}px ${u * 8}px rgba(0,0,0,0.35)`, border: `1px solid ${ui.line}`, display: 'flex', flexDirection: 'column', ...style }}>
      <div dir="ltr" style={{ height: bar, background: ui.chrome, display: 'flex', alignItems: 'center', gap: u * 1.2, padding: `0 ${u * 2}px`, borderBottom: `1px solid ${ui.line}`, flexShrink: 0 }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <div key={c} style={{ width: bar * 0.24, height: bar * 0.24, borderRadius: 99, background: c }} />
        ))}
        <div style={{ flex: 1, marginInline: u * 2, height: bar * 0.56, borderRadius: 99, background: ui.panel, display: 'flex', alignItems: 'center', padding: `0 ${u * 1.6}px`, gap: u }}>
          <Icon name="Lock" size={bar * 0.26} color={ui.muted} treatment="plain" />
          <span style={{ fontFamily: fonts.latin, fontSize: bar * 0.3, color: ui.muted, whiteSpace: 'nowrap', overflow: 'hidden' }}>{url ?? ''}</span>
        </div>
      </div>
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

export function PhoneFrame({ height, children, style, tone = 'dark' }: { height: number; children?: React.ReactNode; style?: CSSProperties; tone?: 'dark' | 'light' }) {
  const width = height * 0.49;
  const r = width * 0.14;
  const bezel = width * 0.035;
  return (
    <div data-qc="box" style={{ width, height, borderRadius: r, background: tone === 'dark' ? '#0B0B0D' : '#E9EAEE', padding: bezel, boxSizing: 'border-box', boxShadow: `0 ${height * 0.04}px ${height * 0.08}px rgba(0,0,0,0.4), inset 0 0 0 ${bezel * 0.25}px rgba(255,255,255,0.08)`, position: 'relative', ...style }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: r - bezel, overflow: 'hidden', background: '#000' }}>
        {children}
        <div style={{ position: 'absolute', top: height * 0.012, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: height * 0.028, borderRadius: 99, background: '#000', zIndex: 10 }} />
      </div>
    </div>
  );
}

/** A generic mock web page built from the user's own words (no fake claims). */
export function MockPage({ title, subtitle, menu = [], cta, scroll = 0, width, accentBlocks = 6 }: { title: string; subtitle?: string; menu?: string[]; cta?: string; scroll?: number; width: number; accentBlocks?: number }) {
  const { canvas } = useVideo();
  const ui = useUiPalette();
  const u = canvas.u;
  const pad = width * 0.06;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, padding: pad, display: 'flex', flexDirection: 'column', gap: pad * 0.8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ width: width * 0.14, height: width * 0.035, borderRadius: 99, background: ui.primary }} />
        <div style={{ display: 'flex', gap: width * 0.03 }}>
          {menu.slice(0, 4).map((m, i) => (
            <span key={i} style={{ fontSize: width * 0.028, color: ui.muted, fontWeight: 500 }}>
              {m}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: pad * 0.4, paddingTop: pad * 0.6 }}>
        <Text text={title} role="title" size={(width * 0.06) / u} minSize={2.4} align="start" animate="none" color={ui.text} maxWidth={width * 0.85} />
        {subtitle ? <Text text={subtitle} role="body" size={(width * 0.03) / u} minSize={2} align="start" animate="none" color={ui.muted} maxWidth={width * 0.8} /> : null}
        {cta ? (
          <div style={{ alignSelf: 'flex-start', padding: `${width * 0.016}px ${width * 0.04}px`, borderRadius: 99, background: ui.primary, color: ui.onPrimary, fontSize: width * 0.03, fontWeight: 700 }}>{cta}</div>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: pad * 0.4 }}>
        {Array.from({ length: accentBlocks }, (_, i) => (
          <div key={i} style={{ borderRadius: width * 0.02, background: ui.panel, border: `1px solid ${ui.line}`, padding: width * 0.02, display: 'flex', flexDirection: 'column', gap: width * 0.012 }}>
            <div style={{ height: width * 0.14, borderRadius: width * 0.014, background: i % 3 === 0 ? alpha(ui.primary, 0.35) : i % 3 === 1 ? alpha(ui.accent, 0.35) : alpha(ui.text, 0.1) }} />
            <div style={{ height: width * 0.014, width: '80%', borderRadius: 99, background: alpha(ui.text, 0.18) }} />
            <div style={{ height: width * 0.014, width: '55%', borderRadius: 99, background: alpha(ui.text, 0.1) }} />
          </div>
        ))}
      </div>
      <div style={{ height: width * 0.4, borderRadius: width * 0.02, background: `linear-gradient(135deg, ${alpha(ui.primary, 0.3)}, ${alpha(ui.accent, 0.2)})` }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: pad * 0.4 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} style={{ height: width * 0.16, borderRadius: width * 0.02, background: ui.panel, border: `1px solid ${ui.line}` }} />
        ))}
      </div>
    </div>
  );
}

export function UiRow({ label, value, icon, width, active = 0 }: { label: string; value?: string; icon?: string; width: number; active?: number }) {
  const ui = useUiPalette();
  const { fonts, canvas } = useVideo();
  const h = width * 0.12;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: h * 0.3, height: h, padding: `0 ${h * 0.3}px`, borderRadius: h * 0.25, background: active > 0 ? alpha(ui.primary, 0.14 * active) : 'transparent' }}>
      {icon ? <Icon name={icon} size={h * 0.4} color={active > 0.5 ? ui.primary : ui.muted} treatment="plain" /> : null}
      <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
        <Text text={label} role="label" size={(h * 0.36) / canvas.u} minSize={Math.min(2.2, (h * 0.26) / canvas.u)} maxLines={1} animate="none" align="start" color={ui.text} weight={500} maxWidth={width - h * (icon ? 1.3 : 0.6) - (value ? h * 2.4 : 0)} />
      </div>
      {value ? <span style={{ fontSize: h * 0.32, color: ui.muted, fontFamily: fonts.latin, direction: 'ltr' }}>{value}</span> : null}
    </div>
  );
}
