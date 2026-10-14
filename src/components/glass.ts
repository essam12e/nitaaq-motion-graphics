/**
 * Glass 2.0 — the optics of a glass pane as pure style data.
 *
 * `Surface kind="glass"` (gradient + border + capped backdrop blur + inner
 * highlight) is unchanged. A surface that passes `glass={…}` opts into this
 * model instead:
 *
 *   frost       how much the pane blurs what is behind it (backdrop blur)
 *   thickness   a bevel: lit top-left edge, shaded bottom-right edge
 *   edgeLight   a rim of light around the edge, brightest toward the light
 *   specular    a light band that sweeps across the pane (0 → 1 crosses it)
 *   refraction  simulated: the light bent through the thickness gathers as a
 *               bright caustic along the far edge and shifts against the light
 *   chroma      a chromatic fringe (warm on one side, cool on the other)
 *   light       where the light comes from (−1..1); scenes feed the camera
 *               here so reflections move as the camera moves
 *   grain       a fine, fixed frost texture
 *
 * Backdrop blur inside a 3D (preserve-3d) camera has bad paths in Chromium, so
 * `backdrop: 'auto'` uses the live blur only in full-effects renders outside an
 * active 3D camera; otherwise the pane is a simulated frost (more opaque, milky),
 * which also costs nothing. Everything here is a pure function of its inputs.
 */
import type { CSSProperties } from 'react';
import { alpha, mix } from '../brand/color';

export interface GlassOptions {
  /** 0..1 backdrop blur (live) or milkiness (simulated). Default 0.5. */
  frost?: number;
  /** Pane colour. Default: the style's surface colour. */
  tint?: string;
  /** 0..1 fill strength of the tint. Default: the style's surface opacity. */
  opacity?: number;
  /** 0..1 bevel depth. Default 0.5. */
  thickness?: number;
  /** 0..1 lit rim. Default 0.6. */
  edgeLight?: number;
  /** Position of the specular sweep across the pane (−0.3 before it, 1.3 past it). Omitted: no sweep. */
  specular?: number;
  /** 0..1 strength of the sweep. Default 0.55. */
  specularStrength?: number;
  /** 0..1 simulated refraction. Default 0.3. */
  refraction?: number;
  /** 0..1 chromatic edge. Default 0. */
  chroma?: number;
  /** Light direction, −1..1 on each axis (0,0 = light from the top-left default). */
  light?: { x: number; y: number };
  /** 0..1 frost grain texture. Default 0. */
  grain?: number;
  /** live backdrop blur, simulated frost, or auto (see the module note). */
  backdrop?: 'auto' | 'live' | 'simulated';
}

export interface GlassContext {
  u: number;
  mode: 'light' | 'dark';
  surface: string;
  surfaceOpacity: number;
  shadowColor: string;
  shadowStrength: number;
  /** effects === 'full' */
  full: boolean;
  /** inside an active 3D camera */
  inCamera: boolean;
}

export interface GlassLayer {
  key: string;
  /** under the content (inside the pane) or over it (on its surface) */
  over: boolean;
  style: CSSProperties;
}

export interface GlassLook {
  body: CSSProperties;
  layers: GlassLayer[];
  live: boolean;
  /** resolved values (seek / QC / tests) */
  resolved: Required<Omit<GlassOptions, 'specular' | 'tint' | 'backdrop'>> & { specular: number | null; tint: string; backdrop: 'live' | 'simulated' };
}

const c01 = (x: number) => Math.min(1, Math.max(0, x));
const f = (x: number, d = 2) => Number(x.toFixed(d));

/** A fixed feTurbulence tile (same seed every frame and every render). */
const GRAIN_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>\")";

/** Live blur radius in px for a frost amount (capped like the original glass: ≤ 24px at u = 10.8). */
export function frostBlur(frost: number, u: number): number {
  return f(Math.min(24, c01(frost) * 2.2 * u), 2);
}

export function glassLook(o: GlassOptions, ctx: GlassContext): GlassLook {
  const u = ctx.u;
  const dark = ctx.mode === 'dark';
  const frost = c01(o.frost ?? 0.5);
  const thick = c01(o.thickness ?? 0.5);
  const edge = c01(o.edgeLight ?? 0.6);
  const refr = c01(o.refraction ?? 0.3);
  const chroma = c01(o.chroma ?? 0);
  const grain = c01(o.grain ?? 0);
  const specStrength = c01(o.specularStrength ?? 0.55);
  const lx = Math.max(-1, Math.min(1, o.light?.x ?? 0));
  const ly = Math.max(-1, Math.min(1, o.light?.y ?? 0));
  const tint = o.tint ?? ctx.surface;
  const op = c01(o.opacity ?? ctx.surfaceOpacity);
  const mode = o.backdrop ?? 'auto';
  const live = mode === 'live' || (mode === 'auto' && ctx.full && !ctx.inCamera);
  // simulated frost: without the blur behind it the pane must hide more of what is behind it
  const fill = live ? op : c01(op + frost * 0.28);
  const milk = live ? 0.1 : 0.1 + frost * 0.16;
  const top = alpha(mix(tint, '#FFFFFF', milk + (dark ? 0.04 : 0.1)), fill);
  const bottom = alpha(mix(tint, dark ? '#000000' : '#FFFFFF', dark ? 0.12 : 0.02), fill * 0.72);
  // the light angle: default light from the top-left; light.x / light.y rotate it
  const angle = f(135 + lx * 40 - ly * 25, 1);
  const bevel = Math.max(1, u * 0.3 * thick);
  const shadows = [
    `0 ${f(1.6 * u)}px ${f(5.5 * u)}px ${alpha(ctx.shadowColor, f(0.18 + 0.32 * ctx.shadowStrength, 3))}`,
    `inset ${f(bevel)}px ${f(bevel)}px ${f(bevel * 1.6)}px ${alpha('#FFFFFF', f((dark ? 0.12 : 0.3) * thick, 3))}`,
    `inset ${f(-bevel)}px ${f(-bevel)}px ${f(bevel * 1.8)}px ${alpha('#000000', f((dark ? 0.28 : 0.12) * thick, 3))}`,
  ];
  if (chroma > 0) {
    const cw = Math.max(1, u * 0.16 * chroma);
    shadows.push(`inset ${f(cw)}px 0 0 ${alpha('#FF4D7A', f(0.32 * chroma, 3))}`, `inset ${f(-cw)}px 0 0 ${alpha('#4DA3FF', f(0.32 * chroma, 3))}`);
  }
  const body: CSSProperties = {
    background: `linear-gradient(${angle}deg, ${top}, ${bottom})`,
    backdropFilter: live && frost > 0 ? `blur(${frostBlur(frost, u)}px) saturate(1.35)` : undefined,
    boxShadow: shadows.join(', '),
    overflow: 'hidden',
  };
  const layers: GlassLayer[] = [];
  const fill0: CSSProperties = { position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none' };
  if (grain > 0) layers.push({ key: 'grain', over: false, style: { ...fill0, backgroundImage: GRAIN_URI, backgroundSize: `${f(16 * u)}px`, opacity: f(0.1 * grain + (live ? 0 : 0.05 * grain), 3), mixBlendMode: 'overlay' } });
  if (refr > 0) {
    // caustic: light gathered along the far edge, shifted against the light
    const cx = f(50 - lx * 22, 1);
    layers.push({
      key: 'refraction',
      over: false,
      style: { ...fill0, background: `radial-gradient(120% 55% at ${cx}% ${f(104 - ly * 6, 1)}%, ${alpha('#FFFFFF', f(0.26 * refr, 3))}, ${alpha('#FFFFFF', 0)} 70%)` },
    });
  }
  // static reflection: a soft sheen near the light, moving with it
  layers.push({
    key: 'sheen',
    over: true,
    style: { ...fill0, background: `radial-gradient(90% 60% at ${f(22 - lx * 26, 1)}% ${f(-8 - ly * 18, 1)}%, ${alpha('#FFFFFF', f((dark ? 0.16 : 0.26) * (0.5 + edge * 0.5), 3))}, ${alpha('#FFFFFF', 0)} 62%)` },
  });
  const spec = o.specular;
  if (spec !== undefined && spec > -0.35 && spec < 1.35 && specStrength > 0) {
    const p = spec * 100;
    layers.push({
      key: 'specular',
      over: true,
      style: {
        ...fill0,
        background: `linear-gradient(${f(angle - 30, 1)}deg, ${alpha('#FFFFFF', 0)} ${f(p - 22, 1)}%, ${alpha('#FFFFFF', f(0.42 * specStrength, 3))} ${f(p, 1)}%, ${alpha('#FFFFFF', 0)} ${f(p + 22, 1)}%)`,
        mixBlendMode: 'screen',
      },
    });
  }
  if (edge > 0) {
    // the lit rim as inset edge lines (plain box shadows rasterise identically run to run; a
    // mask-composite ring did not): bright on the side facing the light, fainter opposite
    const rim = Math.max(1, f(u * (0.12 + 0.14 * thick), 2));
    const a = ((angle - 90) * Math.PI) / 180; // direction the light travels across the pane
    const dx = f(-Math.cos(a) * rim, 2);
    const dy = f(-Math.sin(a) * rim, 2);
    layers.push({
      key: 'rim',
      over: true,
      style: {
        ...fill0,
        boxShadow: `inset ${dx}px ${dy}px 0 ${alpha('#FFFFFF', f(0.7 * edge, 3))}, inset ${f(-dx)}px ${f(-dy)}px 0 ${alpha('#FFFFFF', f(0.28 * edge, 3))}, inset 0 0 0 ${f(rim * 0.5, 2)}px ${alpha('#FFFFFF', f(0.12 * edge, 3))}`,
      },
    });
  }
  return {
    body,
    layers,
    live,
    resolved: { frost, opacity: op, thickness: thick, edgeLight: edge, specular: spec ?? null, specularStrength: specStrength, refraction: refr, chroma, light: { x: lx, y: ly }, grain, tint, backdrop: live ? 'live' : 'simulated' },
  };
}
