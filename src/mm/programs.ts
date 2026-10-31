/**
 * MotionMaxxing shot programs. Each builder returns the markup + the shot program that drives the
 * ORIGINAL MotionMaxxing runtime (M.words, M.count, M.snap, M.whip, M.dive, M.enter/exit with smear,
 * M.press, M.cursor, M.camera, M.drift, M.hero3d, NativeUI.arrive/macro) and the same beats as NITAAQ
 * motion events (frame-exact) for the Sound Director. Timings are computed HERE in frames, then passed
 * to the runtime, so the sound plan and the picture share one number.
 *
 * Craft rules from MotionMaxxing SKILL.md applied in code (not as text): scenes start already moving,
 * arrival decelerates from oversize, land decelerates / leave accelerates (crashOut into the cut),
 * cut on motion, one blur grammar (per-element smear), words at speech rhythm (whole words, never letters),
 * one accent with one meaning, no dead frame (drift), the ending gets smaller.
 */
import type { MotionEventDecl } from '../audio/events';

export interface MMPalette {
  ground: string;
  ground2: string;
  ink: string;
  inkSoft: string;
  accent: string;
  primary: string;
  /** Material colour of the physical hero (coin, mark) — from the brand, not a preset. */
  metal: string;
}

export interface MMProgram {
  css: string;
  body: string;
  script: string;
  events: MotionEventDecl[];
  nativeUi?: boolean;
  hero3d?: boolean;
  /** MotionMaxxing tools this shot really calls (reported in mm_report.json). */
  tools: string[];
}

export interface MMEnv {
  width: number;
  height: number;
  fps: number;
  duration: number;
  palette: MMPalette;
  font: string;
  fontWeight: number;
  dir: 'rtl' | 'ltr';
}

const J = (v: unknown) => JSON.stringify(v);
const norm = (s: string) => s.replace(/[ً-ْـ«»"'.,،!?؟:;]/g, '').trim();
const htmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A ground is a surface, not a swatch: a lit pool + falloff, and a static grain that kills banding. */
export function groundCss(p: MMPalette, kind: 'light' | 'dark', W: number, H: number): string {
  const portrait = H > W;
  const pool = portrait ? 'ellipse 70% 38% at 50% 46%' : 'ellipse 46% 40% at 50% 48%';
  return kind === 'dark'
    ? `#main{background:radial-gradient(${pool}, ${mix(p.primary, p.ground2, 0.28)} 0%, rgba(0,0,0,0) 100%), radial-gradient(ellipse 120% 90% at 50% 38%, ${p.ground2} 0%, ${shade(p.ground2, 0.45)} 100%);color:${p.ground}}`
    : `#main{background:radial-gradient(${pool}, ${tint(p.ground, 0.55)} 0%, rgba(255,255,255,0) 100%), radial-gradient(ellipse 120% 90% at 50% 34%, ${p.ground} 0%, ${shade(p.ground, 0.12)} 100%);color:${p.ink}}`;
}
export const GRAIN_SVG = `<svg id="grain" class="layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style="opacity:.05;mix-blend-mode:multiply;pointer-events:none"><filter id="gn"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/></filter><rect width="100%" height="100%" filter="url(#gn)"/></svg>`;

// ── colour helpers (hex only; deterministic) ─────────────────────────────────────────────
const hex = (c: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number[]) => '#' + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, k: number) => toHex(hex(a).map((v, i) => v * k + hex(b)[i] * (1 - k)));
export const tint = (a: string, k: number) => mix('#ffffff', a, k);
export const shade = (a: string, k: number) => mix('#000000', a, k);

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1. Kinetic words (M.words + M.snap + M.drift + exit with smear / M.dive / M.whip)
// ─────────────────────────────────────────────────────────────────────────────────────────
export interface KineticWordsContent {
  lines: string[];
  accent?: string;
  mech?: 'rise' | 'pop' | 'shrink' | 'slide' | 'focus';
  enter?: 'snap' | 'cut';
  exit?: 'drop' | 'lift' | 'dive' | 'whip' | 'rest';
  ground?: 'light' | 'dark';
  /** Onset frames per line from the voice (mm/sync.ts); otherwise speech-like gaps. */
  onsets?: number[][];
}

export function speechGaps(n: number): number[] {
  // MotionMaxxing craft law 11: whole words 4–6 f apart on a headline, slower last word
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => (i === 0 ? 5 : i === n - 2 ? 7 : 4));
}

export function kineticWords(c: KineticWordsContent, env: MMEnv): MMProgram {
  const { width: W, height: H, fps } = env;
  const total = Math.round(env.duration * fps);
  const portrait = H > W;
  const fs = Math.round(Math.min(portrait ? 0.075 * H : 0.1 * H, 0.15 * W));
  const lh = Math.round(fs * 1.28);
  const blockH = lh * c.lines.length;
  const top0 = Math.round(H * 0.47 - blockH / 2);
  const dark = (c.ground ?? 'light') === 'dark';
  const ink = dark ? env.palette.ground : env.palette.ink;
  const mech = c.mech ?? 'rise';
  const accentN = c.accent ? norm(c.accent) : null;
  // onsets: voice first, otherwise speech-like gaps
  const plan: { at: number; gaps: number[]; onsets: number[]; accentIdx: number }[] = [];
  let f = 3;
  c.lines.forEach((line, li) => {
    const words = line.split(/\s+/).filter(Boolean);
    const voice = c.onsets?.[li];
    const onsets = voice && voice.length === words.length ? voice : [];
    if (!onsets.length) {
      const g = speechGaps(words.length);
      let x = f;
      words.forEach((_, i) => {
        onsets.push(x);
        x += g[i] ?? 0;
      });
    }
    const gaps = onsets.slice(1).map((o, i) => Math.max(1, o - onsets[i]));
    const accentIdx = accentN ? words.findIndex((w) => norm(w) === accentN || norm(w).includes(accentN)) : -1;
    plan.push({ at: onsets[0], gaps: gaps.length ? gaps : [4], onsets, accentIdx });
    f = onsets[onsets.length - 1] + 8;
  });
  const exit = c.exit ?? 'drop';
  const exitAt = Math.max(f + 6, total - 9);
  const lines = c.lines
    .map((l, i) => `<div id="l${i}" class="line" style="top:${top0 + i * lh}px">${htmlEsc(l)}</div>`)
    .join('');
  const css = `${groundCss(env.palette, dark ? 'dark' : 'light', W, H)}
.line{position:absolute;left:0;width:${W}px;text-align:center;white-space:pre;font-family:"${env.font}";font-weight:${env.fontWeight};font-size:${fs}px;line-height:${lh}px;color:${ink};filter:var(--fx,none)}
.line .mw{padding:0 .04em}`;
  const body = `<div id="drift" class="layer"><div id="cam" class="layer">${lines}</div></div>`;
  const tools = ['M.words', 'M.drift', 'smear'];
  let s = '';
  plan.forEach((p, i) => {
    s += `  fit('#l${i}', W * 0.86);\n`;
    s += `  M.words('#l${i}', { at: ${p.at}, mech: ${J(mech)}, gaps: ${J(p.gaps)}, dist: ${Math.round(H * 0.05)}, frames: 13, ease: 'softLand', smear: true${
      p.accentIdx >= 0 ? `, accent: { color: ACC, frames: 24, word: ${p.accentIdx} }, words: (i) => (i === ${p.accentIdx} ? { dist: ${Math.round(H * 0.1)}, scale: 1.25 } : null)` : ''
    } });\n`;
  });
  if ((c.enter ?? 'snap') === 'snap') {
    s += `  M.snap('#cam', { at: 0, from: { scale: 1.45 }, to: { scale: 1 }, firstFrameShare: .55, tail: 14, origin: '${Math.round(W / 2)}px ${Math.round(H * 0.47)}px' });\n`;
    tools.push('M.snap');
  }
  s += `  M.drift('#drift', { prop: 'scale', from: 1, to: 1.045, start: 0, end: ${total} });\n`;
  const events: MotionEventDecl[] = [];
  const sec = (fr: number) => +(fr / fps).toFixed(3);
  plan.forEach((p, li) => {
    events.push({ type: 'headline_reveal', at: sec(p.at), importance: li === 0 ? 0.55 : 0.35, element: 'hero-title' });
    if (p.accentIdx >= 0) {
      const a = p.onsets[p.accentIdx];
      events.push({ type: 'word_impact', at: sec(a), importance: 0.75, element: 'hero-title', exact: { start: sec(a), peak: sec(a + 2), contact: sec(a + 3), settle: sec(a + 13), completion: sec(a + 24) } });
    }
  });
  if (exit === 'drop' || exit === 'lift') {
    const dy = exit === 'drop' ? Math.round(H * 0.62) : -Math.round(H * 0.62);
    s += `  M.exit('#cam', { at: ${exitAt}, frames: ${total - exitAt}, ease: 'crashOut', to: { y: ${dy} }, smear: { axis: 'y', px: 70, frames: 4 }, hide: false });\n`;
    events.push({ type: 'scene_transition', at: sec(exitAt), importance: 0.5, direction: exit === 'drop' ? 'down' : 'up' });
    tools.push('M.exit');
  } else if (exit === 'whip') {
    s += `  M.whip('#cam', { at: ${exitAt}, dx: ${env.dir === 'rtl' ? W : -W}, frames: ${total - exitAt}, smearPx: 80 });\n`;
    events.push({ type: 'swipe', at: sec(exitAt), importance: 0.5, direction: env.dir === 'rtl' ? 'right' : 'left' });
    tools.push('M.whip');
  } else if (exit === 'dive') {
    // constant-octave zoom into the accent word (or the line centre): the frame becomes that word
    s += `  { const t = document.querySelector('#l${Math.max(0, plan.findIndex((p) => p.accentIdx >= 0))} .mw:nth-of-type(${Math.max(1, (plan.find((p) => p.accentIdx >= 0)?.accentIdx ?? 0) + 1)})') || document.querySelector('#l0');
    const r = t.getBoundingClientRect(); M.dive('#cam', { at: ${exitAt}, frames: ${total - exitAt}, perStep: 1.45, origin: [r.left + r.width / 2, r.top + r.height / 2] }); }\n`;
    events.push({ type: 'scene_transition', at: sec(exitAt), importance: 0.55, direction: 'in' });
    tools.push('M.dive');
  }
  return { css, body, script: s, events, tools };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2. Count (M.count + M.snap from oversize + M.words + logo lockup crashIn + M.drift)
// ─────────────────────────────────────────────────────────────────────────────────────────
export interface CountContent {
  value: number;
  from?: number;
  suffix?: string;
  label?: string;
  numerals?: 'arab' | 'latn';
  lockup?: { logo?: string; name?: string; line?: string };
  ground?: 'light' | 'dark';
}

export function countShot(c: CountContent, env: MMEnv): MMProgram {
  const { width: W, height: H, fps } = env;
  const total = Math.round(env.duration * fps);
  const portrait = H > W;
  const dark = (c.ground ?? 'light') === 'dark';
  const ink = dark ? env.palette.ground : env.palette.ink;
  const numPx = Math.round(Math.min(portrait ? 0.19 * H : 0.26 * H, 0.3 * W));
  const labPx = Math.round(numPx * 0.3);
  const countAt = 2;
  const countFrames = 26;
  const labelAt = countAt + countFrames + 3;
  const hasLock = !!c.lockup && !!(c.lockup.logo || c.lockup.name);
  const lockAt = hasLock ? Math.max(labelAt + 22, total - 48) : total;
  const fmt = c.numerals === 'arab' ? `v => new Intl.NumberFormat('ar-SA').format(v)` : `'comma'`;
  const css = `${groundCss(env.palette, dark ? 'dark' : 'light', W, H)}
#numg{position:absolute;left:0;top:${Math.round(H * 0.4 - numPx * 0.6)}px;width:${W}px;display:flex;justify-content:center;align-items:baseline;gap:${Math.round(numPx * 0.12)}px;color:${ink};font-family:"${env.font}";direction:${env.dir}}
#num{font-size:${numPx}px;line-height:1;font-weight:${Math.min(700, env.fontWeight + 100)};letter-spacing:-.01em}
#cur{font-size:${Math.round(numPx * 0.3)}px;font-weight:${env.fontWeight};color:${env.palette.accent}}
#lab{position:absolute;left:0;top:${Math.round(H * 0.4 + numPx * 0.62)}px;width:${W}px;text-align:center;white-space:pre;font-family:"${env.font}";font-weight:${env.fontWeight};font-size:${labPx}px;line-height:${Math.round(labPx * 1.3)}px;color:${dark ? tint(env.palette.inkSoft, 0.6) : env.palette.inkSoft}}
#lock{position:absolute;left:0;top:${Math.round(H * 0.5 - (portrait ? 0.11 : 0.16) * H)}px;width:${W}px;display:flex;flex-direction:column;align-items:center;gap:${Math.round(H * 0.022)}px}
#lock img{height:${Math.round((portrait ? 0.1 : 0.17) * H)}px;width:auto;object-fit:contain}
#lname{font-family:"${env.font}";font-weight:${Math.min(700, env.fontWeight + 100)};font-size:${Math.round((portrait ? 0.05 : 0.08) * H)}px;line-height:1.2;color:${ink}}
#lline{font-family:"${env.font}";font-weight:${env.fontWeight};font-size:${Math.round((portrait ? 0.024 : 0.04) * H)}px;color:${dark ? tint(env.palette.inkSoft, 0.6) : env.palette.inkSoft};white-space:pre}`;
  const lock = hasLock
    ? `<div id="lock">${c.lockup!.logo ? `<img src="${htmlEsc(c.lockup!.logo)}" alt="">` : ''}${c.lockup!.name ? `<div id="lname">${htmlEsc(c.lockup!.name)}</div>` : ''}${c.lockup!.line ? `<div id="lline">${htmlEsc(c.lockup!.line)}</div>` : ''}</div>`
    : '';
  const body = `<div id="drift" class="layer"><div id="cam" class="layer"><div id="numw" class="layer"><div id="numg"><span id="num">0</span>${c.suffix ? `<span id="cur">${htmlEsc(c.suffix)}</span>` : ''}</div>${
    c.label ? `<div id="lab">${htmlEsc(c.label)}</div>` : ''
  }</div>${lock}</div></div>`;
  const cy = Math.round(H * 0.4);
  let s = `  fit('#numg', W * 0.88);\n`;
  s += `  M.snap('#numw', { at: 0, from: { scale: 2.4 }, to: { scale: 1 }, firstFrameShare: .6, tail: 16, origin: '${Math.round(W / 2)}px ${cy}px' });\n`;
  s += `  M.count('#num', { at: ${countAt}, from: ${c.from ?? 0}, to: ${c.value}, frames: ${countFrames}, round: true, format: ${fmt}, skip: .12, seed: 2 });\n`;
  if (c.label) s += `  fit('#lab', W * 0.86);\n  M.words('#lab', { at: ${labelAt}, mech: 'rise', dist: ${Math.round(H * 0.03)}, frames: 12, smear: true });\n`;
  const tools = ['M.count', 'M.snap', 'M.words', 'M.drift', 'smear'];
  const sec = (fr: number) => +(fr / fps).toFixed(3);
  const events: MotionEventDecl[] = [
    { type: 'counter_tick', at: sec(countAt), importance: 0.35, repeat: { count: 6, every: +((countFrames / 6 / fps).toFixed(3)) } },
    { type: 'counter_final', at: sec(countAt + countFrames), importance: 0.8, element: 'number', exact: { start: sec(countAt + countFrames - 1), peak: sec(countAt + countFrames), contact: sec(countAt + countFrames), settle: sec(countAt + countFrames + 4), completion: sec(countAt + countFrames + 10) } },
  ];
  if (c.label) events.push({ type: 'text_reveal', at: sec(labelAt), importance: 0.3 });
  if (hasLock) {
    s += `  M.exit('#numw', { at: ${lockAt - 4}, frames: 10, ease: 'accelExit', to: { y: ${-Math.round(H * 0.08)}, scale: .82, blur: 10 }, smear: { axis: 'y', px: 30, frames: 3 } });\n`;
    s += `  M.enter('#lock', { at: ${lockAt + 3}, frames: 20, ease: 'snapSettle', from: { scale: 3.5, blur: 12 } });\n`;
    s += `  M.drift('#lock', { prop: 'scale', from: 1, to: .94, start: ${lockAt + 23}, end: ${total} });\n`;
    events.push({ type: 'logo_reveal', at: sec(lockAt + 3), importance: 0.9, element: 'logo' });
    tools.push('M.enter', 'M.exit', 'crashIn-lockup');
  }
  s += `  M.drift('#drift', { prop: 'scale', from: 1, to: 1.04, start: 0, end: ${total} });\n`;
  return { css, body, script: s, events, tools };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3. Phone (NativeUI lock screen + NativeUI.arrive + NativeUI.macro + M.cursor + M.press),
//    with an object-driven entry: the carried coin shrinks into the notification's app icon.
// ─────────────────────────────────────────────────────────────────────────────────────────
export interface PhoneContent {
  app: string;
  title: string;
  body: string;
  time?: string;
  clock?: string;
  date?: string;
  icon?: string;
  older?: { app?: string; title: string; body: string; time?: string };
  /** A real screenshot of the app (when supplied it is shown instead of the built lock screen). */
  screenshot?: string;
  carrier?: 'coin' | 'none';
  press?: boolean;
  ground?: 'light' | 'dark';
}

export function phoneShot(c: PhoneContent, env: MMEnv): MMProgram {
  const { width: W, height: H, fps } = env;
  const total = Math.round(env.duration * fps);
  const s = +((H * 0.64) / 852).toFixed(3);
  const devW = Math.round(393 * s);
  const devH = Math.round(852 * s);
  const left = Math.round((W - devW) / 2);
  const top = Math.round((H - devH) / 2);
  const p = env.palette;
  const carrier = (c.carrier ?? 'none') === 'coin' && !c.screenshot;
  const arriveAt = carrier ? 2 : 8;
  const macroAt = Math.round(total * 0.3);
  const macroEnd = macroAt + 28;
  const press = c.press !== false && !c.screenshot;
  const pressAt = total - 6;
  const touchIn = pressAt - 16;
  const iconHtml = c.icon ? `<img src="${htmlEsc(c.icon)}" alt="" style="width:76%;height:76%;object-fit:contain">` : '';
  const css = `${groundCss(p, (c.ground ?? 'dark') === 'dark' ? 'dark' : 'light', W, H)}
#ui{position:absolute;left:${left}px;top:${top}px;--s:${s};--app-font:"${env.font}"}
#ui .nu-screen{box-shadow:none}
#ui .nu-notif-title,#ui .nu-notif-body,#ui .nu-notif-time{font-family:"${env.font}"}
#shot{position:absolute;left:${left}px;top:${top}px;width:${devW}px;height:${devH}px;border-radius:${Math.round(55 * s)}px;overflow:hidden;background:#000}
#shot img{width:100%;height:100%;object-fit:contain}
#carrier{position:absolute;left:0;top:0;width:${Math.round(W * 0.9)}px;height:${Math.round(W * 0.9)}px;margin-left:${-Math.round(W * 0.45)}px;margin-top:${-Math.round(W * 0.45)}px;border-radius:50%;
  background:radial-gradient(circle at 34% 28%, ${tint(p.metal, 0.45)} 0%, ${p.metal} 46%, ${shade(p.metal, 0.62)} 100%);box-shadow:inset 0 0 0 ${Math.round(W * 0.03)}px ${shade(p.metal, 0.8)}}
#touch{position:absolute;left:0;top:0;width:0;height:0}
#touch i{position:absolute;left:${-Math.round(W * 0.045)}px;top:${-Math.round(W * 0.045)}px;width:${Math.round(W * 0.09)}px;height:${Math.round(W * 0.09)}px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 0 ${Math.round(W * 0.006)}px rgba(255,255,255,.8),0 ${Math.round(W * 0.01)}px ${Math.round(W * 0.04)}px rgba(0,0,0,.35)}`;
  const body = `<div id="drift" class="layer"><div id="cam" class="layer">${
    c.screenshot ? `<div id="shot"><img src="${htmlEsc(c.screenshot)}" alt=""></div>` : `<div id="ui" class="nu" dir="${env.dir}"></div>`
  }</div></div><div id="carrier"></div><div id="touch"><i></i></div>`;
  const tools: string[] = [];
  const sec = (fr: number) => +(fr / fps).toFixed(3);
  const events: MotionEventDecl[] = [];
  let sc = '';
  if (c.screenshot) {
    // a real screen: never rebuilt, never restyled; the camera reads it (macro) — MotionMaxxing ui-demo rule
    sc += `  M.enter('#shot', { at: 0, frames: 14, ease: 'softLand', from: { y: ${Math.round(H * 0.06)}, scale: .94 }, smear: { axis: 'y', px: 24, frames: 3 } });\n`;
    sc += `  M.camera('#cam', [[${macroAt}, { scale: 1 }], [${macroEnd}, { scale: 1.5 }, 'glide']], { origin: '${Math.round(W / 2)}px ${Math.round(H * 0.4)}px' });\n`;
    events.push({ type: 'ui_appear', at: 0, importance: 0.6, element: 'device' }, { type: 'camera_move', at: sec(macroAt), importance: 0.4 });
    tools.push('M.enter', 'M.camera');
  } else {
    sc += `  const icon = NativeUI.appIcon({ bg: ${J(`linear-gradient(180deg, ${tint(p.primary, 0.12)}, ${shade(p.primary, 0.8)})`)}, glyph: ${J(iconHtml)}, letter: ${J(c.app.slice(0, 1))} });\n`;
    sc += `  const icon2 = NativeUI.appIcon({ bg: 'linear-gradient(180deg,#ff6a5f,#e23b30)', letter: ${J((c.older?.app ?? 'ت').slice(0, 1))} });\n`;
    sc += `  const notifs = [${c.older ? `{ icon: icon2, title: ${J(c.older.title)}, time: ${J(c.older.time ?? '')}, body: ${J(c.older.body)} }, ` : ''}{ icon, title: ${J(c.title)}, time: ${J(c.time ?? '')}, body: ${J(c.body)} }];\n`;
    sc += `  document.getElementById('ui').innerHTML = NativeUI.phone(NativeUI.lockScreen({ time: ${J(c.clock ?? '9:41')}, date: ${J(c.date ?? '')}, wallpaper: ${J(
      `radial-gradient(120% 70% at 18% 8%, ${tint(p.primary, 0.35)} 0%, rgba(0,0,0,0) 56%), radial-gradient(90% 70% at 92% 78%, ${p.metal} 0%, rgba(0,0,0,0) 62%), linear-gradient(172deg, ${shade(p.primary, 0.6)}, ${shade(p.ground2, 0.5)})`,
    )}, notifs }), { time: ${J(c.clock ?? '9:41')} });\n`;
    sc += `  const newest = '#ui .nu-notif:last-child';\n`;
    sc += `  const landed = NativeUI.arrive(M, newest, { at: ${arriveAt}, dir: 'up', frames: 14${c.older ? `, push: ['#ui .nu-notif:first-child']` : ''} });\n`;
    tools.push('NativeUI.phone', 'NativeUI.lockScreen', 'NativeUI.arrive');
    events.push({ type: 'notification', at: sec(arriveAt), importance: 0.75, element: 'notification', direction: 'up' });
    if (carrier) {
      // object-driven transition: the coin that filled the last frame of the previous shot shrinks into the app icon
      sc += `  { const ic = document.querySelector(newest + ' .nu-icon'); const r = ic.getBoundingClientRect();
    const k = r.width / ${Math.round(W * 0.9)}, x1 = r.left + r.width / 2, y1 = r.top + r.height / 2;
    M.show('#carrier', 0, landed);
    M.kf('#carrier', 'x', [[0, ${Math.round(W / 2)}], [landed, x1, 'whip']]);
    M.kf('#carrier', 'y', [[0, ${Math.round(H / 2)}], [landed, y1, 'whip']]);
    M.kf('#carrier', 'scale', [[0, 1.6], [landed, k, 'whip']]); }\n`;
      tools.push('object-carrier (M.kf whip)');
      events.push({ type: 'object_land', at: sec(arriveAt + 14), importance: 0.6, element: 'icon' });
    }
    sc += `  NativeUI.macro(M, newest, { at: ${macroAt}, frames: 28, world: '#cam', fill: ${H > W ? 0.88 : 0.62} });\n`;
    tools.push('NativeUI.macro (M.camera)');
    events.push({ type: 'camera_move', at: sec(macroAt), importance: 0.45, direction: 'in' });
    if (press) {
      sc += `  M.cursor('#touch', { keys: [[${touchIn}, ${Math.round(W * 0.72)}, ${Math.round(H * 0.95)}, 2.6, 0], [${touchIn + 13}, ${Math.round(W * 0.56)}, ${Math.round(H * 0.5)}, 1, 0]], ease: 'glide' });\n`;
      sc += `  M.press('#touch', newest, { at: ${pressAt}, cursorDepth: .8, targetDepth: .94, lag: 1, frames: 3, release: false });\n`;
      tools.push('M.cursor', 'M.press');
      events.push({ type: 'phone_tap', at: sec(pressAt), importance: 0.7, element: 'button', exact: { start: sec(pressAt), peak: sec(pressAt + 1), contact: sec(pressAt + 1), settle: sec(pressAt + 3), completion: sec(pressAt + 4) } });
    }
  }
  sc += `  M.drift('#drift', { prop: 'scale', from: 1, to: 1.04, start: 0, end: ${total} });\n`;
  tools.push('M.drift');
  return { css, body, script: sc, events, tools, nativeUi: !c.screenshot };
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 4. Hero3D (M.hero3d: real light, depth, material, camera — ONE hero object, ONE event)
// ─────────────────────────────────────────────────────────────────────────────────────────
export interface Hero3DContent {
  object: 'coin' | 'logo' | 'glass-slab' | 'phone';
  /** Filled SVG path data of the brand mark (holes by winding). Never invented: from the brand's own logo. */
  mark?: string[];
  material?: 'satin' | 'brandPlastic' | 'chrome' | 'glass' | 'iridescent';
  line?: string;
  accent?: string;
  ground?: 'light' | 'dark';
  /** Phone screen texture (a real screenshot) for object "phone". */
  screen?: string;
  exit?: 'to-camera' | 'rest';
}

export function hero3dShot(c: Hero3DContent, env: MMEnv): MMProgram {
  const { width: W, height: H, fps } = env;
  const D = env.duration;
  const total = Math.round(D * fps);
  const p = env.palette;
  const portrait = H > W;
  const dark = (c.ground ?? 'light') === 'dark';
  const ink = dark ? p.ground : p.ink;
  const land = 0.5;
  const exitT = c.exit === 'to-camera' ? +(D - 0.4).toFixed(3) : D + 1;
  const fs = Math.round(Math.min(portrait ? 0.056 * H : 0.085 * H, 0.12 * W));
  const lineTop = Math.round(H * (portrait ? 0.74 : 0.78));
  const lineAt = Math.round((land + 0.55) * fps);
  const fov = portrait ? 42 : 30;
  const mat = c.material ?? 'satin';
  const objects: Record<string, unknown>[] = [];
  const mark = (c.mark ?? []).filter(Boolean);
  if (c.object === 'coin') {
    objects.push({ id: 'hero', kind: 'group' });
    objects.push({ id: 'coin', parent: 'hero', kind: 'coin', radius: 1.25, thickness: 0.2, material: mat, color: p.metal, materialParams: { metalness: 0.92, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.12, warp: { amount: 0.08, scale: 1.1 } } });
    if (mark.length) {
      objects.push({ id: 'face', parent: 'hero', kind: 'logo', svg: mark, size: 1.25, depth: 0.05, bevelThickness: 0.02, bevelSize: 0.014, material: 'brandPlastic', color: p.primary, materialParams: { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }, position: [0, 0, 0.06] });
      objects.push({ id: 'back', parent: 'hero', kind: 'logo', svg: mark, size: 1.25, depth: 0.05, bevelThickness: 0.02, bevelSize: 0.014, material: 'brandPlastic', color: p.primary, materialParams: { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }, position: [0, 0, -0.06], rotation: [0, Math.PI, 0] });
    }
  } else if (c.object === 'logo') {
    if (!mark.length) throw new Error('mm-hero3d logo: the brand mark (SVG path data) is required; a logo is never invented');
    objects.push({ id: 'hero', kind: 'logo', svg: mark, size: 2.6, depth: 0.14, bevelThickness: 0.03, bevelSize: 0.022, material: mat, color: p.primary, materialParams: { warp: { amount: 0.1, scale: 0.9 } } });
  } else if (c.object === 'glass-slab') {
    objects.push({ id: 'hero', kind: 'group' });
    objects.push({ id: 'slab', parent: 'hero', kind: 'glassSlab', dimensions: [2.2, 2.9, 0.26], material: 'glass', color: tint(p.primary, 0.5) });
    if (mark.length) objects.push({ id: 'face', parent: 'hero', kind: 'logo', svg: mark, size: 1.2, depth: 0.06, material: 'brandPlastic', color: p.primary, position: [0, 0, 0.2] });
  } else {
    objects.push({ id: 'hero', kind: 'phone', dimensions: [1.25, 2.6, 0.13], material: 'satin', color: shade(p.ink, 0.9), ...(c.screen ? { screen: c.screen } : {}) });
  }
  const css = `${groundCss(p, dark ? 'dark' : 'light', W, H)}
#gl{position:absolute;left:0;top:0;width:${W}px;height:${H}px;display:block}
#line{position:absolute;left:0;top:${lineTop}px;width:${W}px;text-align:center;white-space:pre;font-family:"${env.font}";font-weight:${env.fontWeight};font-size:${fs}px;line-height:${Math.round(fs * 1.3)}px;color:${ink}}`;
  const body = `<canvas id="gl"></canvas>${c.line ? `<div id="line">${htmlEsc(c.line)}</div>` : ''}`;
  const camZ = portrait ? 9.2 : 11;
  const words = (c.line ?? '').split(/\s+/).filter(Boolean);
  const accentIdx = c.accent ? words.findIndex((w) => norm(w) === norm(c.accent!) || norm(w).includes(norm(c.accent!))) : -1;
  let s = `  const hero = M.hero3d('#gl', {
    envMap: 'studio', toneMapping: 'neutral', exposure: ${dark ? 1.0 : 1.15},
    key: { position: [-3, 8, 6], intensity: 2.2 }, rim: { position: [6, 3, -6], intensity: 4 },
    ground: { y: ${portrait ? -1.75 : -1.5}, opacity: ${dark ? 0.5 : 0.36} },
    sweep: { width: 0.8, intensity: 10 },
    camera: { fov: ${fov}, position: [0, 0.4, ${camZ + 1.6}], target: [0, ${portrait ? 0.25 : 0}, 0] },
    objects: ${J(objects)},
    state: (t, o, { key, pulse }) => {
      const land = ${land}, since = Math.max(0, t - land), wob = 0.05 * Math.exp(-since * 6) * Math.sin(since * 40) * (t >= land ? 1 : 0);
      const exitT = ${exitT}, out = t > exitT ? Math.min(1, (t - exitT) / ${(Math.max(0.1, D - exitT)).toFixed(3)}) : 0, oe = Math.pow(out, 3.97);   // crashOut into the cut
      const rot = key(t, [[0, [0.9, -2.6, 0.25]], [land, [0.16, -0.42, 0.04], 'snapSettle'], [${Math.max(land + 0.1, Math.min(exitT, D)).toFixed(3)}, [0.06, -0.12, 0], 'cruise']]);
      const pos = key(t, [[0, [0.25, 3.4, -0.6]], [land, [0, 0, 0], 'gentleIn']]);
      return {
        camera: { position: key(t, [[0, [0.9, 0.9, ${camZ + 1.6}]], [${(D * 0.85).toFixed(3)}, [0, 0.35, ${camZ}], 'glide']]), target: [0, ${portrait ? 0.25 : 0}, 0], fov: ${fov} },
        objects: { hero: { position: [pos[0], pos[1] + oe * 0.25, pos[2] + oe * ${(camZ - 1.4).toFixed(2)}], rotation: [ (rot[0] + wob * 0.6) * (1 - oe), rot[1] * (1 - oe), (rot[2] + wob) * (1 - oe)] } },
        keyPosition: key(t, [[0, [-3, 8, 6]], [${D.toFixed(3)}, [-1.5, 7, 7.5], 'cruise']]),
        keyIntensity: 2.2 + 1.8 * pulse(t, land + 0.03, 0.09),
        sweep: key(t, [[land + 0.2, 0], [${Math.min(D, land + 1.8).toFixed(3)}, 1, 'softInOut']]),
      };
    },
  });\n`;
  if (c.line) {
    s += `  fit('#line', W * 0.86);\n`;
    s += `  M.words('#line', { at: ${lineAt}, mech: 'rise', dist: ${Math.round(H * 0.035)}, gaps: ${J(speechGaps(words.length).length ? speechGaps(words.length) : [5])}, smear: true${accentIdx >= 0 ? `, accent: { color: ACC, frames: 24, word: ${accentIdx} }` : ''} });\n`;
    if (c.exit === 'to-camera') s += `  M.exit('#line', { at: ${Math.round(exitT * fps)}, frames: ${total - Math.round(exitT * fps)}, ease: 'accelExit', to: { y: ${Math.round(H * 0.08)}, blur: 8 }, smear: { axis: 'y', px: 30, frames: 3 }, hide: false });\n`;
  }
  const sec = (x: number) => +x.toFixed(3);
  const events: MotionEventDecl[] = [
    { type: 'product_entry', at: 0, importance: 0.5, element: 'product', direction: 'down' },
    { type: 'product_land', at: sec(land - 0.2), importance: 0.9, element: 'product', exact: { start: 0, peak: sec(land - 0.04), contact: sec(land), settle: sec(land + 0.35), completion: sec(land + 0.8) } },
    { type: 'hero_reveal', at: sec(land + 0.2), importance: 0.4 },
  ];
  if (c.line) events.push({ type: 'headline_reveal', at: sec(lineAt / fps), importance: 0.4 });
  if (c.exit === 'to-camera') events.push({ type: 'scene_transition', at: sec(exitT), importance: 0.6, direction: 'in' });
  const tools = ['M.hero3d', `hero3d:${c.object}`, `material:${mat}`, 'hero3d.sweep', 'hero3d.key/pulse', 'hero3d.camera'];
  if (c.line) tools.push('M.words');
  return { css, body, script: s, events, tools, hero3d: true };
}
