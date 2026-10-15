/**
 * saas-camera-film — one continuous, camera-led product film (9:16 reel).
 *
 * search → question → problem card → zoom-through into the REAL dashboard screenshot → the camera tours
 * real regions of that screenshot (never altered, only framed / lit) → tools lift out and fly back one by
 * one on the spoken words → understanding → CTA.
 * Everything is a pure function of the scene time (deterministic, no Math.random / Date.now).
 * All timings are in film seconds and follow the voice-over (see workspace/mizan/script_timing.md).
 */
import React from 'react';
import { z } from 'zod';
import { Media } from '../../components/Media';
import { defineScene } from '../registry';
import { useSceneTime } from '../kit';
import { useAsset, useVideo } from '../../engine/context';

// ───────────────────────── content
const Lines = z.object({
  query: z.string().default('أفضل متجر عطور'),
  competitorTag: z.string().default('منافسك'),
  results: z.array(z.object({ title: z.string(), url: z.string() })).default([
    { title: 'متجر عطور فاخرة', url: 'متجر منافس ‹ الرئيسية' },
    { title: 'تشكيلة العود والمسك', url: 'متجر آخر ‹ المنتجات' },
    { title: 'عروض وتخفيضات اليوم', url: 'متجر ثالث ‹ العروض' },
  ]),
  q1: z.string().default('كم فرصة'),
  q2: z.string().default('راحت عليك؟'),
  problem: z.string().default('فرص تضيع بسبب ضعف الظهور'),
  issues: z.array(z.string()).default(['عنوان يحتاج تحسينًا', 'صفحة تحتاج مراجعة', 'محتوى يحتاج تطويرًا']),
  siteName: z.string().default('موقعك'),
  reveal1: z.string().default('اعرف وش يعطّل ظهورك'),
  reveal2: z.string().default('ومن وين تبدأ'),
  scanLabel: z.string().default('فحص الموقع'),
  priority: z.string().default('الخطوة التالية'),
  inspect1: z.string().default('افحص موقعك'),
  inspect2: z.string().default('اكتشف مشاكل السيو'),
  keywordsTag: z.string().default('اكتشف فرصك'),
  keywords: z.array(z.string()).default(['عطور رجالية', 'عود فاخر', 'هدايا عطور']),
  content1: z.string().default('حسّن محتوى موقعك'),
  content2: z.string().default('وصفحات منتجاتك'),
  pageTag: z.string().default('صفحة منتج توضيحية'),
  triad: z.array(z.string()).default(['مجالك', 'سوقك']),
  generic: z.string().default('كلام عام للجميع'),
  tailored: z.string().default('توصيات تناسب مشروعك'),
  tools1: z.string().default('أدوات كثيرة؟'),
  together: z.string().default('كلها… في مكان واحد'),
  understood: z.string().default('كل خطوة مبنية على فهم'),
  ctaTitle: z.string().default('ابدأ بفحص موقعك مجانًا'),
  ctaHl: z.string().default('مجانًا'),
  ctaSub: z.string().default('الفحص الأول لكل نطاق — بدون بطاقة ائتمانية'),
  tagline: z.string().default('اعرف وين الخلل، ووين فرصتك'),
  taglineHl: z.string().default('فرصتك'),
  url: z.string().default('mizanseo.com'),
});
const Content = z.object({
  logo: z.string(),
  screenshot: z.string(),
  /** the same screenshot, losslessly up-sampled (lanczos) so deep camera moves stay crisp */
  screenshotHi: z.string().optional(),
  colors: z.object({ deep: z.string().default('#0e1b2b'), mid: z.string().default('#1d3550'), light: z.string().default('#3f6288'), gold: z.string().default('#D9A53C'), ice: z.string().default('#EAF1F8') }).default({}),
  lines: Lines.default({}),
});
type C = z.infer<typeof Content>;

// ───────────────────────── math / easing
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const prog = (t: number, a: number, d: number) => clamp((t - a) / d);
const eIO = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const eOut = (u: number) => 1 - Math.pow(1 - u, 3);
const eExp = (u: number) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
const eIn = (u: number) => u * u * u;
const eBack = (u: number, k = 1.5) => 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
const eSlow = (u: number) => 0.5 - Math.cos(Math.PI * u) / 2; // sine in-out (gentle)
const win = (t: number, a: number, b: number, fi = 0.3, fo = 0.3) => eSlow(prog(t, a, fi)) * (1 - eSlow(prog(t, b - fo, fo)));

// ───────────────────────── dashboard world
const S = 0.6; // world px per screenshot px
const SRC_W = 1600;
const SRC_H = 765;
const wx = (sx: number) => (sx - SRC_W / 2) * S;
const wy = (sy: number) => (sy - SRC_H / 2) * S;
interface Cam { x: number; y: number; z: number }
const fr = (cx: number, cy: number, vis: number): Cam => ({ x: wx(cx), y: wy(cy), z: 1080 / (vis * S) });
interface Key { t: number; c: Cam; ease?: (u: number) => number; dip?: number }
function camAt(keys: Key[], t: number): Cam {
  if (t <= keys[0].t) return keys[0].c;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const u = (b.ease ?? eIO)(prog(t, a.t, b.t - a.t));
      const z = Math.exp(lerp(Math.log(a.c.z), Math.log(b.c.z), u));
      const w = Math.abs(1 / b.c.z - 1 / a.c.z) < 1e-9 ? u : (1 / z - 1 / a.c.z) / (1 / b.c.z - 1 / a.c.z);
      return { x: lerp(a.c.x, b.c.x, w), y: lerp(a.c.y, b.c.y, w), z: z * (1 - (b.dip ?? 0) * Math.sin(Math.PI * u)) };
    }
  }
  return keys[keys.length - 1].c;
}

// screenshot regions (source px) — measured from the user's real dashboard capture
const R = {
  hero: { x: 65, y: 128, w: 320, h: 160 },
  critical: { x: 30, y: 372, w: 296, h: 144 },
  inspect: { x: 1020, y: 622, w: 235, h: 143 },
  keywords: { x: 773, y: 622, w: 235, h: 143 },
  content: { x: 525, y: 622, w: 235, h: 143 },
  monitor: { x: 277, y: 622, w: 235, h: 143 },
  competitors: { x: 1308, y: 626, w: 262, h: 42 },
  sideContent: { x: 1300, y: 476, w: 276, h: 142 },
};
type Rect = { x: number; y: number; w: number; h: number };
const mid = (r: Rect) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
const VIS = 540; // visible source width when framing one card
const OVERVIEW = fr(800, 382, 1800);
const Cs = fr(650, 650, 1040); // the (fixed) camera while the tools float
const hv = fr(200, 325, 820);

/** the spoken words that bring each tool home (film seconds) */
const GATHER = [23.82, 24.58, 25.34, 26.02, 27.29];
const LIFT = 20.7;

const KEYS: Key[] = [
  { t: 7.6, c: OVERVIEW },
  { t: 8.75, c: OVERVIEW },
  { t: 9.45, c: fr(mid(R.critical).cx + 40, mid(R.critical).cy, 640) },
  { t: 9.75, c: fr(mid(R.critical).cx + 40, mid(R.critical).cy, 640) },
  { t: 10.45, c: fr(mid(R.inspect).cx, mid(R.inspect).cy, VIS), dip: 0.14 },
  { t: 11.6, c: fr(mid(R.inspect).cx, mid(R.inspect).cy, VIS) },
  { t: 12.3, c: fr(mid(R.keywords).cx, mid(R.keywords).cy, VIS), dip: 0.1 },
  { t: 13.45, c: fr(mid(R.keywords).cx, mid(R.keywords).cy, VIS) },
  { t: 14.2, c: fr(mid(R.content).cx, mid(R.content).cy, VIS), dip: 0.1 },
  { t: 15.9, c: fr(mid(R.content).cx, mid(R.content).cy, VIS) },
  { t: 16.7, c: fr(mid(R.sideContent).cx, mid(R.sideContent).cy, 470), dip: 0.1 },
  { t: 18.2, c: fr(mid(R.sideContent).cx, mid(R.sideContent).cy, 470) },
  { t: 19.2, c: fr(1050, 560, 950) },
  { t: 20.45, c: fr(1050, 560, 950) },
  { t: 21.2, c: Cs },
  { t: 25.0, c: Cs },
  { t: 28.5, c: OVERVIEW },
  { t: 29.9, c: OVERVIEW },
  { t: 30.8, c: hv },
  { t: 33.8, c: hv },
  { t: 35.0, c: OVERVIEW },
  { t: 42.5, c: fr(800, 382, 1900), ease: eSlow },
];

// ───────────────────────── small pieces
const font = (v: ReturnType<typeof useVideo>) => ({ d: `${v.fonts.display}, 'IBM Plex Sans Arabic', 'Tajawal', sans-serif`, b: `${v.fonts.body}, 'IBM Plex Sans Arabic', 'Tajawal', sans-serif`, l: `${v.fonts.latin}, 'Inter', sans-serif` });

function Icon({ kind, size, color, sw = 2.2 }: { kind: 'search' | 'check' | 'warn' | 'arrow' | 'cursor'; size: number; color: string; sw?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: sw, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'search') return <svg {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" /></svg>;
  if (kind === 'check') return <svg {...p}><path d="M4.5 12.8l4.6 4.6L19.5 6.8" /></svg>;
  if (kind === 'warn') return <svg {...p}><path d="M12 4l9.2 16H2.8z" /><path d="M12 10v5M12 17.8v.1" /></svg>;
  if (kind === 'arrow') return <svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.6L9.9 19z" fill="#fff" stroke="#10213a" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}

const Glass: React.FC<{ style?: React.CSSProperties; children?: React.ReactNode; tone?: 'light' | 'dark' | 'gold'; reduced?: boolean }> = ({ style, children, tone = 'dark', reduced }) => {
  const bg = tone === 'light' ? 'linear-gradient(160deg,rgba(255,255,255,.96),rgba(236,243,250,.92))' : tone === 'gold' ? 'linear-gradient(160deg,rgba(236,186,84,.96),rgba(206,148,40,.96))' : 'linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,.07))';
  const border = tone === 'light' ? '1.5px solid rgba(255,255,255,.9)' : tone === 'gold' ? '1.5px solid rgba(255,236,190,.7)' : '1.5px solid rgba(255,255,255,.28)';
  return <div style={{ background: bg, border, borderRadius: 40, boxShadow: '0 22px 60px rgba(4,12,24,.38), inset 0 1px 0 rgba(255,255,255,.35)', backdropFilter: reduced || tone !== 'dark' ? undefined : 'blur(14px)', ...style }}>{children}</div>;
};

// ───────────────────────── the film
export const saasCameraFilm = defineScene<C>(
  {
    id: 'saas-camera-film',
    version: '2.0.0',
    category: 'cinematic',
    title: 'SaaS camera film',
    description: 'One continuous camera-led product film: search → question → problem → zoom-through into the real dashboard → camera tour of real regions → tools gather on the spoken words → CTA.',
    variants: ['reel'],
    defaultVariant: 'reel',
    content: Content,
    defaultDuration: 42.5,
    minDuration: 20,
    maxDuration: 90,
    aspectRatios: ['9:16'],
    preferredTransitions: ['none'],
    sfx: [],
    safeArea: 'normal',
    beats: ['hook', 'problem', 'solution', 'demo', 'cta'],
    energy: 0.7,
    cost: 'HIGH',
    requiresAssets: ['logo', 'screenshot'],
    example: { logo: 'lib:demo/logo.png', screenshot: 'lib:demo/screenshot.png' } as C,
    editable: ['lines.query', 'lines.q1', 'lines.q2', 'lines.ctaTitle', 'lines.tagline', 'lines.url'],
  },
  ({ content: raw }) => {
    const c = Content.parse(raw); // video.json may carry a partial `lines` — fill the defaults
    const v = useVideo();
    const resolve = useAsset();
    const { s: t } = useSceneTime();
    const F = font(v);
    const col = c.colors;
    const L = c.lines;
    const reduced = v.effects === 'reduced';
    const hi = resolve(c.screenshotHi ?? c.screenshot) as string;

    // ── camera for the dashboard world + derived motion
    const cam = camAt(KEYS, t);
    const dt = 1 / 30;
    const cA = camAt(KEYS, t - dt);
    const cB = camAt(KEYS, t + dt);
    const vx = ((cB.x - cA.x) * cam.z) / (2 * dt); // screen px / s
    const vy = ((cB.y - cA.y) * cam.z) / (2 * dt);
    const vz = Math.abs(Math.log(cB.z / cA.z)) / (2 * dt); // 1/s
    const tiltY = clamp(-vx / 520, -1, 1) * 5.5; // gentle arc while tracking sideways
    const tiltX = clamp(vy / 700, -1, 1) * 3;
    const mbX = Math.min(9, Math.abs(vx) / 150 + vz * 5);
    const mbY = Math.min(9, Math.abs(vy) / 150 + vz * 5);

    // ── backgrounds: slow animated gradient (light ⇄ deep brand navy), camera-coupled glow
    const breathe = 0.5 + 0.5 * Math.sin(t * 0.34 - 0.6);
    const driftX = Math.sin(t * 0.21) * 90 - cam.x * 0.06 * (t > 7 ? 1 : 0);
    const driftY = Math.cos(t * 0.17) * 80 - cam.y * 0.05 * (t > 7 ? 1 : 0);
    const Background = (
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${165 + Math.sin(t * 0.12) * 14}deg, ${col.deep} 0%, ${col.mid} ${46 + breathe * 10}%, ${col.deep} 100%)` }}>
        <div style={{ position: 'absolute', width: 1500, height: 1500, left: -320 + driftX, top: 120 + driftY, borderRadius: '50%', background: `radial-gradient(circle, ${col.light}cc 0%, ${col.light}00 62%)`, opacity: 0.35 + 0.5 * breathe }} />
        <div style={{ position: 'absolute', width: 1300, height: 1300, left: 260 - driftX, top: 880 - driftY * 1.2, borderRadius: '50%', background: `radial-gradient(circle, ${col.light}b0 0%, ${col.light}00 62%)`, opacity: 0.8 - 0.45 * breathe }} />
        <div style={{ position: 'absolute', width: 900, height: 900, left: 420 + driftX * 1.4, top: -160 + driftY, borderRadius: '50%', background: `radial-gradient(circle, ${col.gold}55 0%, ${col.gold}00 64%)`, opacity: 0.32 + 0.2 * Math.sin(t * 0.25 + 1) }} />
      </div>
    );

    // ═════════════════ S1 — search + competitor + the question (0 → 5.7)
    const s1On = t < 5.9;
    const S1 = (() => {
      if (!s1On) return null;
      const enter = eOut(prog(t, 0, 0.45));
      const push = eIO(prog(t, 3.1, 1.1)); // dolly in on the results, "…منافسك قبلك"
      const slow = prog(t, 0, 5) * 0.04;
      const exitU = eIn(prog(t, 4.9, 0.8));
      const scale = 1 + slow + 0.22 * push + 0.9 * exitU;
      const opacity = (1 - clamp(prog(t, 5.15, 0.6))) * (0.55 + 0.45 * enter);
      const blurExit = exitU * 16;
      const chars = Array.from(L.query);
      const typed = Math.round(clamp((t - 0.45) / 1.4) * chars.length);
      const caret = typed < chars.length || Math.floor(t * 2.4) % 2 === 0;
      // cursor enters in the "…" pause, hovers the competitor, then leaves toward result 2
      const cu = eIO(prog(t, 2.3, 0.7));
      const cm = eIO(prog(t, 3.5, 0.55));
      const cx = lerp(lerp(780, 650, cu), 600, cm);
      const cy = lerp(lerp(1500, 860, cu), 1100, cm);
      const cursorOn = clamp(prog(t, 2.3, 0.25)) * (1 - clamp(prog(t, 4.05, 0.25)));
      const hl1 = win(t, 2.75, 4.35, 0.3, 0.3);
      const hl2 = win(t, 3.6, 4.35, 0.25, 0.25);
      const qIn = prog(t, 4.15, 0.5);
      const dimQ = eSlow(prog(t, 4.1, 0.4));
      const qScale = lerp(1.35, 1, eBack(qIn, 1.2));
      return (
        <div style={{ position: 'absolute', inset: 0, opacity, transform: `scale(${scale})`, transformOrigin: '540px 1000px', filter: blurExit > 0.2 ? `blur(${blurExit}px)` : undefined }}>
          <div style={{ position: 'absolute', inset: 0, filter: dimQ > 0.01 ? `blur(${dimQ * 9}px)` : undefined, opacity: 1 - 0.55 * dimQ }}>
            {/* search bar */}
            <div style={{ position: 'absolute', left: 90, top: 520 + (1 - enter) * 40, width: 900, height: 150, borderRadius: 75, background: 'linear-gradient(180deg,#ffffff,#eef3f9)', boxShadow: '0 28px 70px rgba(3,10,22,.45), 0 0 0 6px rgba(255,255,255,.14)', opacity: enter, display: 'flex', alignItems: 'center', direction: 'rtl', padding: '0 46px', gap: 26 }}>
              <Icon kind="search" size={64} color={col.mid} sw={2.4} />
              <div style={{ flex: 1, fontFamily: F.b, fontWeight: 600, fontSize: 58, color: '#14263a', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'right' }}>
                {chars.slice(0, typed).join('')}
                <span style={{ display: 'inline-block', width: 4, height: 62, background: col.gold, verticalAlign: 'middle', marginInlineStart: 6, opacity: caret ? 1 : 0 }} />
              </div>
            </div>
            {/* results */}
            {L.results.slice(0, 3).map((r, i) => {
              const a = eBack(prog(t, 2.2 + i * 0.2, 0.55), 0.9);
              const emph = i === 0 ? hl1 : i === 1 ? hl2 : 0;
              return (
                <div key={i} style={{ position: 'absolute', left: 90, top: 740 + i * 232 + (1 - a) * 60, width: 900, height: 206, borderRadius: 34, opacity: clamp(a), background: 'linear-gradient(180deg,rgba(255,255,255,.96),rgba(240,245,251,.94))', boxShadow: `0 20px 50px rgba(3,10,22,.35)${emph > 0.01 ? `, 0 0 0 ${3 + emph * 3}px ${col.gold}, 0 0 ${60 * emph}px ${col.gold}88` : ''}`, direction: 'rtl', padding: '30px 38px', display: 'flex', gap: 26 }}>
                  <div style={{ width: 70, height: 70, borderRadius: '50%', background: `linear-gradient(135deg,${col.light},${col.mid})`, flex: 'none' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F.d, fontWeight: 700, fontSize: 44, color: '#14263a', whiteSpace: 'nowrap' }}>{r.title}</div>
                    <div style={{ fontFamily: F.b, fontWeight: 500, fontSize: 28, color: '#6b7a8e', marginTop: 6, whiteSpace: 'nowrap' }}>{r.url}</div>
                    <div style={{ height: 14, borderRadius: 7, background: '#dfe6ef', marginTop: 20, width: '88%' }} />
                    <div style={{ height: 14, borderRadius: 7, background: '#e7ecf3', marginTop: 12, width: '64%' }} />
                  </div>
                  {i === 0 ? <div style={{ position: 'absolute', left: 34, top: 28, padding: '8px 22px', borderRadius: 999, background: col.gold, color: '#1a2a3c', fontFamily: F.d, fontWeight: 700, fontSize: 28, opacity: emph }}>{L.competitorTag}</div> : null}
                </div>
              );
            })}
            {/* cursor */}
            <div style={{ position: 'absolute', left: cx, top: cy, opacity: cursorOn, filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
              <Icon kind="cursor" size={74} color="#fff" />
            </div>
          </div>
          {/* "كم فرصة راحت عليك؟" — lands with the sentence */}
          {qIn > 0 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 690, display: 'flex', justifyContent: 'center', transform: `scale(${qScale / scale})`, opacity: clamp(qIn * 2.2) }}>
              <div style={{ direction: 'rtl', textAlign: 'center', fontFamily: F.d, fontWeight: 800, fontSize: 150, lineHeight: 1.2, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 12px 50px rgba(2,8,18,.55)', clipPath: `inset(-30px 0 -30px ${(1 - eOut(clamp(qIn * 1.4))) * 100}%)` }}>
                <div>{L.q1}</div>
                <div style={{ color: col.gold, textShadow: `0 0 70px ${col.gold}99` }}>{L.q2}</div>
              </div>
            </div>
          ) : null}
        </div>
      );
    })();

    // ═════════════════ S2 — problem (4.9 → 7.7): pull-back reveal, site card, 3 issues, zoom-through
    const s2On = t > 4.85 && t < 7.8;
    const S2 = (() => {
      if (!s2On) return null;
      const inU = eExp(prog(t, 5.0, 1.2));
      const sc0 = lerp(1.7, 1, inU);
      const o0 = eSlow(prog(t, 5.0, 0.5));
      const zu = prog(t, 6.5, 1.0); // zoom-through into the card (as "مع ميزان سيو" starts)
      const sc1 = 1 + 1.7 * eIn(zu);
      const o1 = 1 - clamp(prog(t, 6.78, 0.5));
      const bl = Math.max(lerp(14, 0, inU) * (t < 6 ? 1 : 0), Math.sin(Math.PI * clamp(zu * 1.15)) * 14);
      const scale = sc0 * sc1;
      const issues = [
        { text: L.issues[0] ?? '', x: 548, y: 662, w: 420, cx: 760, cy: 860, ax: 760, ay: 714 },
        { text: L.issues[1] ?? '', x: 112, y: 1196, w: 420, cx: 330, cy: 1030, ax: 330, ay: 1196 },
        { text: L.issues[2] ?? '', x: 548, y: 1326, w: 420, cx: 760, cy: 1070, ax: 760, ay: 1326 },
      ];
      const T0 = 5.45;
      const badge = eBack(prog(t, 6.2, 0.4), 1.8);
      return (
        <div style={{ position: 'absolute', inset: 0, opacity: o0 * o1, transform: `scale(${scale})`, transformOrigin: '540px 960px', filter: bl > 0.3 ? `blur(${bl}px)` : undefined }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 410, textAlign: 'center', direction: 'rtl', fontFamily: F.d, fontWeight: 800, fontSize: 66, lineHeight: 1.3, color: '#fff', opacity: eSlow(prog(t, 5.25, 0.45)), transform: `translateY(${(1 - eOut(prog(t, 5.25, 0.6))) * 40}px)`, textShadow: '0 8px 30px rgba(2,8,18,.5)' }}>{L.problem}</div>
          {/* site card (aspect equals the dashboard overview so the zoom-through lands exactly) */}
          <div style={{ position: 'absolute', left: 180, top: 788, width: 720, height: 344, borderRadius: 26, background: 'linear-gradient(180deg,#f7f9fc,#e9eff6)', boxShadow: '0 40px 90px rgba(2,8,18,.5), 0 0 0 1.5px rgba(255,255,255,.55)', overflow: 'hidden', direction: 'rtl' }}>
            <div style={{ height: 44, background: '#dde5ef', display: 'flex', alignItems: 'center', padding: '0 18px', gap: 9 }}>
              {[0, 1, 2].map((k) => <div key={k} style={{ width: 13, height: 13, borderRadius: '50%', background: ['#ee7b72', '#f2c55c', '#6fcf8e'][k] }} />)}
              <div style={{ marginInlineStart: 18, height: 24, width: 250, borderRadius: 12, background: '#f7f9fc', fontFamily: F.b, fontSize: 16, color: '#8392a6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{L.siteName}</div>
            </div>
            <div style={{ position: 'absolute', top: 66, right: 26, left: 26, bottom: 24 }}>
              <div style={{ position: 'absolute', right: 0, top: 6, width: 300, height: 26, borderRadius: 13, background: '#b9c6d8' }} />
              <div style={{ position: 'absolute', right: 0, top: 50, width: 210, height: 14, borderRadius: 7, background: '#d3dce8' }} />
              <div style={{ position: 'absolute', left: 0, top: 6, width: 270, height: 200, borderRadius: 16, background: 'linear-gradient(135deg,#c6d3e4,#a9bbd2)' }} />
              {[0, 1, 2, 3].map((k) => <div key={k} style={{ position: 'absolute', right: 0, top: 96 + k * 26, width: [380, 330, 360, 250][k], height: 12, borderRadius: 6, background: '#dbe3ee' }} />)}
            </div>
          </div>
          {/* issue tags + connectors (few, calm) */}
          <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
            {issues.map((it, i) => {
              const a = eOut(prog(t, T0 + 0.1 + i * 0.3, 0.45));
              return <path key={i} d={`M ${it.ax} ${it.ay} L ${it.cx} ${it.cy}`} stroke={col.gold} strokeWidth={3} strokeLinecap="round" strokeDasharray="14 10" fill="none" opacity={a * 0.9} />;
            })}
            {issues.map((it, i) => {
              const a = eOut(prog(t, T0 + 0.1 + i * 0.3, 0.45));
              return <circle key={i} cx={it.cx} cy={it.cy} r={9 * a} fill={col.gold} />;
            })}
          </svg>
          {issues.map((it, i) => {
            const a = eBack(prog(t, T0 + i * 0.3, 0.45), 1.3);
            return (
              <div key={i} style={{ position: 'absolute', left: it.x, top: it.y + (1 - clamp(a)) * 30, width: it.w, height: 72, opacity: clamp(a), transform: `scale(${0.9 + 0.1 * clamp(a)})` }}>
                <Glass style={{ width: '100%', height: '100%', borderRadius: 36, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px', direction: 'rtl' }} reduced={reduced}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: col.gold, display: 'grid', placeItems: 'center', flex: 'none' }}><Icon kind="warn" size={24} color="#1a2a3c" /></div>
                  <div style={{ fontFamily: F.d, fontWeight: 700, fontSize: 31, color: '#fff', whiteSpace: 'nowrap' }}>{it.text}</div>
                </Glass>
              </div>
            );
          })}
          {/* scan marker: the focus moves from here into the real dashboard */}
          <div style={{ position: 'absolute', left: 160, top: 770, width: 86, height: 86, opacity: clamp(badge), transform: `scale(${clamp(badge, 0, 1.2)})` }}>
            <div style={{ position: 'absolute', inset: -14 + Math.sin(t * 7) * 3, borderRadius: '50%', border: `3px solid ${col.gold}`, opacity: 0.55 }} />
            <div style={{ width: 86, height: 86, borderRadius: '50%', background: `linear-gradient(135deg,#f1c35e,${col.gold})`, display: 'grid', placeItems: 'center', boxShadow: `0 10px 34px ${col.gold}77` }}><Icon kind="check" size={46} color="#1a2a3c" sw={3} /></div>
          </div>
        </div>
      );
    })();

    // ═════════════════ the real dashboard world (6.4 → end)
    const dashOn = t > 6.4;
    const arrive = prog(t, 6.55, 1.1);
    // card-sized (0.75) while inside the card, grows with a small overshoot and settles (Zoom Through arrival)
    const dashScale = lerp(0.75, 1, eBack(arrive, 2.2));
    const dashO = eSlow(prog(t, 6.65, 0.45));
    const mbArrive = Math.sin(Math.PI * clamp(arrive * 1.2)) * 10;
    const ctaIn = eIO(prog(t, 33.9, 1.1)); // dashboard recedes behind the CTA
    const worldBlur = ctaIn * 7;

    const scanU = prog(t, 7.9, 1.0);
    const scanX = lerp(wx(SRC_W + 120), wx(-120), eIO(scanU)); // right → left (RTL)
    const scanOn = scanU > 0 && scanU < 1;
    const checkU = eBack(prog(t, 8.85, 0.4), 1.8);

    const spot = (r: Rect, a: number, b: number, pad = 10, strong = 0.5) => {
      const k = win(t, a, b, 0.4, 0.4);
      if (k < 0.01) return null;
      return (
        <div key={`${a}`} style={{ position: 'absolute', left: wx(r.x) - pad * S, top: wy(r.y) - pad * S, width: (r.w + pad * 2) * S, height: (r.h + pad * 2) * S, borderRadius: 16 * S + 6, boxShadow: `0 0 0 4000px rgba(7,16,30,${strong * k}), 0 0 0 ${(3.2 / Math.max(cam.z, 1)) * 1.6}px ${col.gold}, 0 0 ${46 / Math.max(cam.z, 1)}px ${col.gold}aa`, opacity: k }} />
      );
    };

    // lifted tool cards: they leave the dashboard, float in three depth layers, then fly home on the spoken words
    const sPos = (sx: number, sy: number) => ({ x: Cs.x + (sx - 540) / Cs.z, y: Cs.y + (sy - 960) / Cs.z });
    const tools: { r: Rect; n: string; at: { x: number; y: number }; w: number; blur: number }[] = [
      { r: R.inspect, n: 'inspect', at: { x: 690, y: 640 }, w: 430, blur: 0 },
      { r: R.keywords, n: 'keywords', at: { x: 350, y: 850 }, w: 360, blur: 2.2 },
      { r: R.content, n: 'content', at: { x: 700, y: 1040 }, w: 410, blur: 0 },
      { r: R.competitors, n: 'competitors', at: { x: 360, y: 1235 }, w: 500, blur: 1.4 },
      { r: R.monitor, n: 'monitor', at: { x: 690, y: 1420 }, w: 330, blur: 3 },
    ];
    const imgBox = (r: Rect, extra?: React.CSSProperties) => ({ width: r.w * S, height: r.h * S, backgroundImage: `url(${hi})`, backgroundSize: `${SRC_W * S}px ${SRC_H * S}px`, backgroundPosition: `${-r.x * S}px ${-r.y * S}px`, backgroundRepeat: 'no-repeat' as const, borderRadius: 14 * S + 4, ...extra });

    const ToolCards = tools.map((tc, i) => {
      const cw = tc.r.w * S;
      const ch = tc.r.h * S;
      const home = { x: wx(tc.r.x), y: wy(tc.r.y) };
      const liftAt = LIFT + 0.12 * i;
      const lift = eBack(prog(t, liftAt, 0.9), 1.0);
      const lc = clamp(lift);
      const drift = Math.sin(t * 1.15 + i * 1.7) * 9 * lc * (1 - prog(t, GATHER[i], 0.4));
      const gu = eIO(prog(t, GATHER[i], 0.95));
      const sc0 = sPos(tc.at.x, tc.at.y);
      const target = { x: sc0.x - cw / 2, y: sc0.y - ch / 2 };
      const sFloat = tc.w / (cw * Cs.z);
      const sx = lerp(home.x, target.x, lift);
      const sy = lerp(home.y, target.y, lift) + drift / Cs.z;
      const ctrl = { x: (target.x + home.x) / 2 + (i % 2 ? 120 : -120), y: (target.y + home.y) / 2 - 90 };
      const bx = (1 - gu) * (1 - gu) * sx + 2 * (1 - gu) * gu * ctrl.x + gu * gu * home.x;
      const by = (1 - gu) * (1 - gu) * sy + 2 * (1 - gu) * gu * ctrl.y + gu * gu * home.y;
      const scale = lerp(lerp(1, sFloat, lift), 1, gu);
      const visible = t >= liftAt - 0.05;
      const land = prog(t, GATHER[i] + 0.95, 0.5);
      const glow = lc * (1 - gu) * 0.7 + Math.sin(Math.PI * land) * 0.9;
      const blurPx = tc.blur * lc * (1 - gu);
      if (!visible) return null;
      const mid2 = (p: { x: number; y: number }) => ({ x: p.x + cw / 2, y: p.y + ch / 2 });
      const A = mid2(target);
      const Bq = mid2(ctrl);
      const H = mid2(home);
      return (
        <React.Fragment key={tc.n}>
          <div style={{ position: 'absolute', left: home.x, top: home.y, width: cw, height: ch, borderRadius: 14 * S + 4, background: 'rgba(14,27,43,.7)', opacity: lc * (1 - gu), boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.18)' }} />
          {gu > 0.02 && gu < 0.98 ? (
            <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={1} height={1}>
              <path d={`M ${A.x} ${A.y} Q ${Bq.x} ${Bq.y} ${H.x} ${H.y}`} stroke={col.gold} strokeWidth={2.6 / Math.max(cam.z, 1)} fill="none" strokeLinecap="round" strokeDasharray={`${10 / cam.z} ${9 / cam.z}`} opacity={0.8 * Math.sin(Math.PI * gu)} />
            </svg>
          ) : null}
          <div style={{ position: 'absolute', left: bx, top: by, transform: `scale(${scale})`, transformOrigin: 'center', filter: blurPx > 0.1 ? `blur(${blurPx}px)` : undefined, borderRadius: 14 * S + 4, boxShadow: `0 ${(26 * lc) / Math.max(cam.z, 1)}px ${(70 * lc) / Math.max(cam.z, 1)}px rgba(2,8,18,${0.5 * lc}), 0 0 ${(40 * glow) / Math.max(cam.z, 1)}px ${col.gold}${glow > 0.05 ? 'aa' : '00'}`, outline: lc > 0.05 ? `${2 / Math.max(cam.z, 1)}px solid rgba(255,255,255,${0.5 * lc})` : undefined }}>
            <div style={imgBox(tc.r)} />
          </div>
        </React.Fragment>
      );
    });

    const floatDim = 1 - 0.72 * eSlow(prog(t, LIFT + 0.05, 0.8)) * (1 - eSlow(prog(t, 24.0, 4.4))); // the dashboard recedes while its tools float
    const gatherPulse = Math.sin(Math.PI * prog(t, 28.6, 1.1));
    const sheen = prog(t, 28.7, 1.1);
    const dashRect = { x: -(SRC_W * S) / 2, y: -(SRC_H * S) / 2, w: SRC_W * S, h: SRC_H * S };
    const Dash = !dashOn ? null : (
      <div style={{ position: 'absolute', inset: 0, opacity: dashO * (1 - 0.62 * ctaIn), transform: `scale(${dashScale})`, transformOrigin: '540px 960px', filter: worldBlur > 0.2 ? `blur(${worldBlur}px)` : undefined }}>
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id="mbf" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={`${(mbX + mbArrive * 0.5).toFixed(2)} ${(mbY + mbArrive * 0.5).toFixed(2)}`} /></filter>
        </svg>
        <div style={{ position: 'absolute', inset: 0, perspective: 2400, perspectiveOrigin: '50% 50%', filter: mbX + mbY + mbArrive > 0.9 ? 'url(#mbf)' : undefined }}>
          <div style={{ position: 'absolute', left: 540, top: 960, transformStyle: 'preserve-3d', transform: `rotateY(${tiltY}deg) rotateX(${tiltX}deg) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)` }}>
            {/* the real screenshot — framed, lit, never edited */}
            <div style={{ position: 'absolute', left: dashRect.x, top: dashRect.y, width: dashRect.w, height: dashRect.h, borderRadius: 18, boxShadow: `0 50px 120px rgba(2,8,18,.55), 0 0 0 ${2 / cam.z}px rgba(255,255,255,.55), 0 0 ${120 * gatherPulse}px ${col.gold}88`, overflow: 'hidden', background: '#fbfaf7', opacity: floatDim }}>
              <Media src={c.screenshotHi ?? c.screenshot} role="screenshot" width={dashRect.w} height={dashRect.h} fit="contain" style={{ position: 'absolute', left: 0, top: 0 }} />
              {scanOn ? (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: scanX - dashRect.x - 70, width: 140, background: `linear-gradient(90deg, ${col.gold}00, ${col.gold}55 45%, #fff9e6dd 50%, ${col.gold}55 55%, ${col.gold}00)`, mixBlendMode: 'screen' }} />
              ) : null}
              {sheen > 0 && sheen < 1 ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: lerp(dashRect.w + 100, -300, eIO(sheen)), width: 200, background: 'linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55),rgba(255,255,255,0))', transform: 'skewX(-18deg)' }} /> : null}
            </div>
            {spot(R.critical, 8.95, 9.9, 8, 0.55)}
            {spot(R.inspect, 10.2, 11.75, 10, 0.55)}
            {spot(R.keywords, 12.4, 13.6, 10, 0.55)}
            {spot(R.content, 14.4, 16.0, 10, 0.55)}
            {spot(R.sideContent, 16.9, 18.3, 8, 0.5)}
            {spot(R.hero, 30.4, 32.0, 10, 0.5)}
            {spot(R.critical, 32.0, 33.9, 10, 0.5)}
            {ToolCards}
          </div>
        </div>
      </div>
    );

    // ── screen-space overlays (text, chips, logo)
    const chip = (text: string, a: number, b: number, y: number, o: { tone?: 'dark' | 'gold' | 'light'; size?: number; icon?: React.ReactNode } = {}) => {
      const k = win(t, a, b, 0.3, 0.3);
      if (k < 0.01) return null;
      const rise = (1 - eOut(prog(t, a, 0.5))) * 34;
      const size = o.size ?? 58;
      return (
        <div key={`${text}${a}`} style={{ position: 'absolute', left: 0, right: 0, top: y + rise, display: 'flex', justifyContent: 'center', opacity: k }}>
          <Glass tone={o.tone ?? 'dark'} reduced={reduced} style={{ borderRadius: 999, padding: '20px 46px', display: 'flex', alignItems: 'center', gap: 20, direction: 'rtl' }}>
            {o.icon}
            <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: size, color: o.tone === 'gold' ? '#17283b' : '#fff', whiteSpace: 'nowrap', textShadow: o.tone === 'gold' ? 'none' : '0 4px 20px rgba(2,8,18,.45)' }}>{text}</div>
          </Glass>
        </div>
      );
    };

    // logo: large reveal on "مع ميزان سيو…", then a small badge during the tour, then the CTA hero
    const logoBig = eBack(prog(t, 6.95, 0.75), 1.3);
    const logoToBadge = eIO(prog(t, 9.05, 0.7));
    const logoHide = 1 - eSlow(prog(t, 20.35, 0.5));
    const logoCard = (size: number, o: number, y: number, sc = 1) => (
      <div style={{ position: 'absolute', left: 540 - size / 2, top: y, width: size, height: size, opacity: o, transform: `scale(${sc})`, borderRadius: size * 0.2, background: '#fff', boxShadow: '0 30px 80px rgba(2,8,18,.5), 0 0 0 1.5px rgba(255,255,255,.7)', overflow: 'hidden' }}>
        <Media src={c.logo} role="logo" width={size} height={size} fit="contain" />
      </div>
    );
    const bigSize = 280;
    const badgeSize = 150;
    const logoMain = (() => {
      if (t < 6.9 || t > 20.9) return null;
      const size = lerp(bigSize, badgeSize, logoToBadge);
      const y = lerp(300, 262, logoToBadge);
      const o = clamp(logoBig) * logoHide;
      return logoCard(size, o, y, 0.7 + 0.3 * clamp(logoBig, 0, 1.15));
    })();

    // "اعرف وش يعطّل ظهورك، ومن وين تبدأ"
    const reveal1 = win(t, 7.85, 9.0, 0.4, 0.3);
    const reveal2 = win(t, 8.45, 9.35, 0.35, 0.3);
    const scanPill = win(t, 7.9, 9.0, 0.3, 0.3);

    // triad / generic-vs-tailored ("بتوصيات تراعي مجالك وسوقك… مو كلام عام")
    const triadOn = win(t, 16.3, 18.4, 0.4, 0.4);
    const Triad = triadOn > 0.01 ? (
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1230, display: 'flex', justifyContent: 'center', gap: 22, direction: 'rtl', opacity: triadOn }}>
        {L.triad.map((w, i) => {
          const a = eBack(prog(t, 16.4 + i * 0.55, 0.5), 1.3);
          return (
            <React.Fragment key={i}>
              {i > 0 ? <div style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, background: col.gold, opacity: clamp(a) }} /> : null}
              <div style={{ opacity: clamp(a), transform: `translateY(${(1 - clamp(a)) * 28}px)` }}>
                <Glass tone={i === 1 ? 'gold' : 'dark'} reduced={reduced} style={{ borderRadius: 999, padding: '16px 44px' }}>
                  <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 56, color: i === 1 ? '#17283b' : '#fff', whiteSpace: 'nowrap' }}>{w}</div>
                </Glass>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    ) : null;
    const gOn = win(t, 18.45, 20.5, 0.4, 0.4);
    const strike = eIO(prog(t, 18.95, 0.5));
    const Generic = gOn > 0.01 ? (
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1210, opacity: gOn }}>
        <div style={{ display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - eOut(prog(t, 18.5, 0.5))) * 30}px)` }}>
          <Glass reduced={reduced} style={{ borderRadius: 999, padding: '16px 48px', position: 'relative', opacity: 1 - 0.35 * strike }}>
            <div style={{ fontFamily: F.d, fontWeight: 700, fontSize: 50, color: '#cfd9e6', whiteSpace: 'nowrap', direction: 'rtl' }}>{L.generic}</div>
            <div style={{ position: 'absolute', top: '50%', right: 30, height: 5, borderRadius: 3, background: col.gold, width: `calc(${strike * 100}% - 60px)`, transformOrigin: 'right' }} />
          </Glass>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 34, opacity: eSlow(prog(t, 19.2, 0.5)), transform: `translateY(${(1 - eOut(prog(t, 19.2, 0.6))) * 30}px)` }}>
          <Glass tone="gold" reduced={reduced} style={{ borderRadius: 999, padding: '20px 54px' }}>
            <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 56, color: '#17283b', whiteSpace: 'nowrap', direction: 'rtl' }}>{L.tailored}</div>
          </Glass>
        </div>
      </div>
    ) : null;

    // keyword chips: one emphasised at a time, illustrative labels only (no volumes / scores)
    const kwOn = win(t, 12.15, 13.7, 0.35, 0.35);
    const KW = kwOn > 0.01 ? (
      <div style={{ position: 'absolute', left: 0, right: 0, top: 560, opacity: kwOn }}>
        {L.keywords.slice(0, 3).map((k, i) => {
          const a = eBack(prog(t, 12.25 + i * 0.25, 0.45), 1.2);
          const active = t >= 12.55 + i * 0.38 && t < 12.55 + (i + 1) * 0.38 + (i === 2 ? 0.5 : 0);
          return (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * 112, display: 'flex', justifyContent: 'center', opacity: clamp(a), transform: `translateY(${(1 - clamp(a)) * 30}px) scale(${active ? 1.06 : 1})` }}>
              <Glass tone={active ? 'gold' : 'dark'} reduced={reduced} style={{ borderRadius: 999, padding: '14px 52px', direction: 'rtl', minWidth: 420, textAlign: 'center' }}>
                <div style={{ fontFamily: F.d, fontWeight: 700, fontSize: 48, color: active ? '#17283b' : '#fff', whiteSpace: 'nowrap' }}>{k}</div>
              </Glass>
            </div>
          );
        })}
      </div>
    ) : null;

    // the highlighted keyword becomes an illustrative product-page card ("وصفحات منتجاتك")
    const pageU = prog(t, 14.45, 0.7);
    const pageO = win(t, 14.45, 16.3, 0.45, 0.45);
    const PageCard = pageO > 0.01 ? (
      <div style={{ position: 'absolute', left: 540 - 250, top: 1150 + (1 - eOut(pageU)) * 50, width: 500, opacity: pageO }}>
        <Glass tone="light" style={{ borderRadius: 30, padding: '24px 30px', direction: 'rtl' }}>
          <div style={{ fontFamily: F.b, fontWeight: 600, fontSize: 24, color: '#6b7a8e', marginBottom: 6 }}>{L.pageTag}</div>
          <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 44, color: '#14263a', whiteSpace: 'nowrap' }}>{L.keywords[0]}</div>
          <div style={{ height: 12, borderRadius: 6, background: '#d7dfea', marginTop: 16, width: '92%' }} />
          <div style={{ height: 12, borderRadius: 6, background: '#e2e8f0', marginTop: 10, width: '66%' }} />
        </Glass>
      </div>
    ) : null;

    const together = win(t, 28.6, 30.5, 0.5, 0.5);

    // CTA — "ابدأ بفحص أول مجاني… بدون بطاقة ائتمانية" then "ميزان سيو… اعرف وين الخلل، ووين فرصتك"
    const cta = {
      logo: eBack(prog(t, 34.3, 0.9), 1.1),
      title: eOut(prog(t, 34.4, 0.8)),
      sub: eOut(prog(t, 35.4, 0.7)),
      url: eBack(prog(t, 36.0, 0.7), 1.2),
      tag: eOut(prog(t, 38.1, 0.9)),
    };
    const logoPulse = 1 + 0.05 * Math.sin(Math.PI * prog(t, 37.0, 0.8));
    const ctaParts = L.ctaTitle.split(L.ctaHl);
    const tagParts = L.tagline.split(L.taglineHl);
    const Cta = t < 34.2 ? null : (
      <div style={{ position: 'absolute', inset: 0 }}>
        {logoCard(360, clamp(cta.logo), 400, (0.78 + 0.22 * clamp(cta.logo, 0, 1.1)) * logoPulse)}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 790, textAlign: 'center', direction: 'rtl', opacity: cta.title, transform: `translateY(${(1 - cta.title) * 36}px)`, clipPath: `inset(-30px 0 -30px ${(1 - eOut(clamp(cta.title * 1.3))) * 100}%)` }}>
          <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 80, lineHeight: 1.25, color: '#fff', textShadow: '0 10px 40px rgba(2,8,18,.55)', whiteSpace: 'nowrap' }}>
            {ctaParts[0]}
            <span style={{ color: col.gold }}>{L.ctaHl}</span>
            {ctaParts[1]}
          </div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 905, textAlign: 'center', direction: 'rtl', fontFamily: F.b, fontWeight: 600, fontSize: 40, color: '#d8e3ef', opacity: cta.sub, transform: `translateY(${(1 - cta.sub) * 22}px)`, whiteSpace: 'nowrap' }}>{L.ctaSub}</div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 1010, display: 'flex', justifyContent: 'center', opacity: clamp(cta.url), transform: `scale(${0.85 + 0.15 * clamp(cta.url, 0, 1.15)})` }}>
          <div style={{ padding: '26px 74px', borderRadius: 999, background: `linear-gradient(160deg,#f2c765,${col.gold})`, boxShadow: `0 20px 60px ${col.gold}66, inset 0 1px 0 rgba(255,255,255,.55)`, fontFamily: F.l, fontWeight: 700, fontSize: 64, letterSpacing: 1, color: '#14263a', direction: 'ltr' }}>{L.url}</div>
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 1190, textAlign: 'center', direction: 'rtl', opacity: cta.tag, transform: `translateY(${(1 - cta.tag) * 26}px)`, clipPath: `inset(-20px 0 -20px ${(1 - eOut(clamp(cta.tag * 1.3))) * 100}%)` }}>
          <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 62, color: '#fff', whiteSpace: 'nowrap', textShadow: '0 8px 30px rgba(2,8,18,.5)' }}>
            {tagParts[0]}
            <span style={{ color: col.gold }}>{L.taglineHl}</span>
            {tagParts[1]}
          </div>
        </div>
      </div>
    );

    const vignette = <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 55%, rgba(3,9,18,.42) 100%)', pointerEvents: 'none' }} />;

    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: col.deep }}>
        {Background}
        {S1}
        {S2}
        {Dash}
        {/* captions & chips */}
        <div style={{ position: 'absolute', inset: 0 }}>
          {logoMain}
          {reveal1 > 0.01 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 608, textAlign: 'center', direction: 'rtl', opacity: reveal1, transform: `translateY(${(1 - eOut(prog(t, 7.85, 0.6))) * 40}px)` }}>
              <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 74, lineHeight: 1.25, color: '#fff', textShadow: '0 8px 30px rgba(2,8,18,.5)', whiteSpace: 'nowrap', clipPath: `inset(-20px 0 -20px ${(1 - eOut(clamp(prog(t, 7.85, 0.6)))) * 100}%)` }}>{L.reveal1}</div>
            </div>
          ) : null}
          {reveal2 > 0.01 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 1310, textAlign: 'center', direction: 'rtl', opacity: reveal2, transform: `translateY(${(1 - eOut(prog(t, 8.45, 0.5))) * 30}px)` }}>
              <div style={{ fontFamily: F.d, fontWeight: 800, fontSize: 68, color: col.gold, textShadow: '0 8px 30px rgba(2,8,18,.5)', whiteSpace: 'nowrap' }}>{L.reveal2}</div>
            </div>
          ) : null}
          {scanPill > 0.01 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 1224, display: 'flex', justifyContent: 'center', opacity: scanPill }}>
              <Glass reduced={reduced} style={{ borderRadius: 999, padding: '16px 34px', display: 'flex', alignItems: 'center', gap: 22, direction: 'rtl' }}>
                <div style={{ fontFamily: F.d, fontWeight: 700, fontSize: 36, color: '#fff', whiteSpace: 'nowrap' }}>{L.scanLabel}</div>
                <div style={{ width: 260, height: 12, borderRadius: 6, background: 'rgba(255,255,255,.2)', overflow: 'hidden', direction: 'rtl' }}>
                  <div style={{ height: '100%', width: `${eIO(scanU) * 100}%`, background: `linear-gradient(90deg,${col.gold},#f6d98c)`, borderRadius: 6, marginInlineStart: 'auto' }} />
                </div>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: col.gold, display: 'grid', placeItems: 'center', transform: `scale(${clamp(checkU, 0, 1.2)})`, opacity: clamp(checkU) }}><Icon kind="check" size={28} color="#17283b" sw={3.2} /></div>
              </Glass>
            </div>
          ) : null}
          {chip(L.priority, 8.95, 9.9, 1290, { tone: 'gold', size: 56, icon: <Icon kind="arrow" size={46} color="#17283b" sw={3} /> })}
          {chip(L.inspect1, 9.8, 10.7, 1270, { size: 62 })}
          {chip(L.inspect2, 10.65, 11.95, 1270, { size: 62 })}
          {chip(L.keywordsTag, 12.2, 13.7, 1290, { tone: 'gold', size: 58 })}
          {KW}
          {chip(L.content1, 14.0, 15.0, 1400, { size: 58 })}
          {chip(L.content2, 14.95, 16.3, 1400, { tone: 'gold', size: 58 })}
          {PageCard}
          {Triad}
          {Generic}
          {chip(L.tools1, 20.95, 23.7, 440, { size: 66 })}
          {together > 0.01 ? (
            <div style={{ position: 'absolute', left: 0, right: 0, top: 330, display: 'flex', justifyContent: 'center', opacity: together, transform: `scale(${lerp(1.18, 1, eBack(prog(t, 28.6, 0.6), 1.1))})` }}>
              <Glass tone="dark" reduced={reduced} style={{ borderRadius: 999, padding: '22px 64px', background: 'linear-gradient(160deg,rgba(14,27,43,.78),rgba(29,53,80,.7))' }}>
                <div style={{ direction: 'rtl', fontFamily: F.d, fontWeight: 800, fontSize: 84, color: '#fff', textShadow: `0 0 60px ${col.gold}66`, whiteSpace: 'nowrap' }}>{L.together}</div>
              </Glass>
            </div>
          ) : null}
          {chip(L.understood, 30.0, 33.9, 1460, { size: 62 })}
          {Cta}
        </div>
        {vignette}
      </div>
    );
  },
);

export default saasCameraFilm;
