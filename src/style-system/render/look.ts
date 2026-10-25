/**
 * Style Library v2 render look: what a style changes in how a Stage element is DRAWN — its material
 * (light, opacity, edge, shadow, highlight, thickness), corner and stroke. Only generic elements
 * (cards, chips, buttons, shapes, UI chrome) get a material; identity assets (product, logo,
 * screenshot pixels) are never touched. Pure (CSS values).
 */
import type { CSSProperties } from 'react';
import { alpha, mix, isDark } from '../../brand/color';

export interface LookMaterial {
  kind: string;
  lighting: string;
  opacity: number;
  edge: string;
  shadow: string;
  highlight: string;
  texture: string;
  thickness: number;
  radius: number;
  corner: 'sharp' | 'soft' | 'round' | 'pill';
  stroke: 'none' | 'hairline' | 'medium' | 'bold';
}
export interface Look {
  style: string;
  material: LookMaterial;
  decor: { kind: string; intensity: number };
  type: { align: 'start' | 'center'; reveal: 'word' | 'line' | 'block' | 'mask'; emphasis: string; numbers: string; sizeContrast: number; kinetic: string };
  motion: { stepped: boolean; curve: string };
  depth: { planes: number; parallax: number; blurFar: boolean; foreground: boolean };
  ground: string;
  roles: Record<string, string>;
}

export function readLook(raw: unknown): Look | null {
  const l = raw as Partial<Look> | undefined;
  if (!l || !l.material || !l.roles) return null;
  return l as Look;
}

export const strokeW = (m: LookMaterial, u: number) => (m.stroke === 'bold' ? 0.6 : m.stroke === 'medium' ? 0.38 : m.stroke === 'hairline' ? 0.16 : 0.3) * u;

export function cornerRadius(m: LookMaterial, w: number, h: number, u: number): number {
  if (m.corner === 'pill') return Math.min(w, h) / 2;
  if (m.corner === 'sharp') return Math.min(m.radius, 0.6) * u;
  return m.radius * u;
}

/** Materials drawn as an SVG outline whose stroke follows the `draw` track (line-art, blueprint). */
export const isStrokeMaterial = (m: LookMaterial) => m.kind === 'outline' || m.kind === 'blueprint';

/**
 * CSS of a generic surface (card / chip / button / UI frame) in the style's material.
 * `fill` is the element's own tone (surface / primary / accent), already from the brand-adapted palette.
 */
export function surfaceCss(look: Look, fill: string, w: number, h: number, u: number, opts: { reduced: boolean; button?: boolean }): CSSProperties {
  const m = look.material;
  const R = look.roles;
  const r = opts.button ? Math.min(w, h) / 2 : cornerRadius(m, w, h, u);
  const dark = isDark(R.ground ?? '#000000');
  const base: CSSProperties = { borderRadius: r, boxSizing: 'border-box' };
  switch (m.kind) {
    case 'soft-ui':
      return { ...base, background: fill, boxShadow: `0 ${1.4 * u}px ${4.5 * u}px ${alpha('#000000', dark ? 0.45 : 0.14)}, inset 0 1px 0 ${alpha('#FFFFFF', dark ? 0.1 : 0.7)}` };
    case 'glass':
    case 'frosted':
      return {
        ...base,
        background: `linear-gradient(150deg, ${alpha('#FFFFFF', dark ? 0.16 : 0.55)}, ${alpha('#FFFFFF', dark ? 0.05 : 0.25)})${opts.button ? `, ${alpha(fill, 0.85)}` : ''}`,
        border: `1px solid ${alpha('#FFFFFF', dark ? 0.3 : 0.7)}`,
        backdropFilter: opts.reduced ? undefined : `blur(${(2.2 * u).toFixed(1)}px) saturate(1.4)`,
        boxShadow: `0 0 ${4 * u}px ${alpha(R.signal ?? fill, 0.22)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.45)}, inset 1px 0 0 ${alpha('#FFFFFF', 0.18)}`,
      };
    case 'paper':
      return { ...base, background: fill, border: `1px solid ${alpha(R.ink ?? '#000', 0.12)}`, boxShadow: `0 ${0.25 * u}px ${0.7 * u}px ${alpha('#000000', 0.12)}` };
    case 'print':
      return { ...base, background: fill, border: `${0.35 * u}px solid ${R.ink}`, boxShadow: `${0.8 * u}px ${0.8 * u}px 0 ${R.ink}` };
    case 'clay':
      return {
        ...base,
        borderRadius: Math.max(r, Math.min(w, h) * 0.22),
        background: `radial-gradient(circle at 32% 24%, ${mix(fill, '#FFFFFF', 0.35)}, ${fill} 55%, ${mix(fill, '#000000', 0.12)})`,
        boxShadow: `0 ${1.1 * u}px ${2.2 * u}px ${alpha(R.shadow ?? '#000', 0.22)}, inset ${-0.5 * u}px ${-0.7 * u}px ${1.4 * u}px ${alpha('#000000', 0.12)}, inset ${0.5 * u}px ${0.5 * u}px ${1.1 * u}px ${alpha('#FFFFFF', 0.55)}`,
      };
    case 'gloss':
      return {
        ...base,
        borderRadius: Math.max(r, Math.min(w, h) * 0.3),
        background: `linear-gradient(160deg, ${mix(fill, '#FFFFFF', 0.35)}, ${fill} 50%, ${mix(fill, '#000000', 0.18)})`,
        boxShadow: `0 ${1.2 * u}px ${3 * u}px ${alpha(fill, 0.35)}, inset 0 ${0.6 * u}px ${1.2 * u}px ${alpha('#FFFFFF', 0.5)}`,
      };
    case 'iso': {
      const t = Math.max(0.6 * u, m.thickness * Math.min(w, h) * 0.22);
      return { ...base, background: fill === R.surface ? R.faceTop : fill, boxShadow: `${t * 0.6}px ${t}px 0 ${R.faceRight}, ${t * 0.6}px ${t}px ${1.4 * u}px ${alpha('#000000', 0.22)}` };
    }
    case 'neon':
      return { ...base, background: alpha(R.signal ?? fill, opts.button ? 0.9 : 0.07), border: `1px solid ${R.signal ?? fill}`, boxShadow: `0 0 ${1.4 * u}px ${alpha(R.signal ?? fill, 0.8)}, inset 0 0 ${1.2 * u}px ${alpha(R.signal ?? fill, 0.35)}` };
    case 'metallic':
      return {
        ...base,
        border: '1px solid transparent',
        background: `linear-gradient(${opts.button ? alpha(R.metal, 0.16) : alpha(R.ground ?? '#000', 0.6)}, ${opts.button ? alpha(R.metal, 0.16) : alpha(R.ground ?? '#000', 0.6)}) padding-box, linear-gradient(135deg, ${R.metal}, ${R.metalDark}, ${R.metal}) border-box`,
      };
    case 'sticker':
      return { ...base, background: fill, border: `${0.55 * u}px solid ${R.stickerBorder ?? '#FFFFFF'}`, boxShadow: `${0.7 * u}px ${0.9 * u}px 0 ${alpha('#000000', 0.32)}` };
    case 'studio':
      return { ...base, background: `linear-gradient(180deg, ${mix(fill, '#FFFFFF', 0.06)}, ${fill})`, boxShadow: `0 ${2 * u}px ${5 * u}px ${alpha('#000000', 0.5)}, inset 0 1px 0 ${alpha('#FFFFFF', 0.22)}` };
    case 'film':
      return { ...base, background: alpha(fill, 0.88), boxShadow: `0 ${1.6 * u}px ${5 * u}px ${alpha('#000000', 0.45)}` };
    case 'outline':
    case 'blueprint':
      // the outline is an SVG stroke (drawn with the `draw` track); the box itself is nearly empty
      return { ...base, background: m.kind === 'blueprint' ? alpha('#FFFFFF', 0.04) : 'transparent' };
    case 'flat':
    default:
      return { ...base, background: fill, boxShadow: m.shadow === 'long-soft' ? `0 ${1 * u}px 0 ${alpha('#000000', 0.12)}` : m.shadow === 'hard-offset' ? `${0.8 * u}px ${0.8 * u}px 0 ${R.ink}` : 'none' };
  }
}

/** Colour a generic shape is filled / stroked with in the style's material (SVG). */
export function shapePaint(look: Look, fill: string): { fill: string; stroke?: string; strokeW?: number; glow?: boolean; extrude?: string; border?: string; shadow?: string; gradient?: [string, string, string] } {
  const m = look.material;
  const R = look.roles;
  switch (m.kind) {
    case 'outline':
    case 'blueprint':
      return { fill: 'none', stroke: m.kind === 'blueprint' ? R.keyline : fill, strokeW: 1 };
    case 'neon':
      return { fill: alpha(fill, 0.1), stroke: fill, strokeW: 1, glow: true };
    case 'metallic':
      return { fill: 'none', stroke: R.metal, strokeW: 0.6 };
    case 'iso':
      return { fill: R.faceTop, extrude: R.faceRight };
    case 'sticker':
      return { fill, border: R.stickerBorder ?? '#FFFFFF', shadow: alpha('#000000', 0.32) };
    case 'gloss':
    case 'clay':
      return { fill, gradient: [mix(fill, '#FFFFFF', 0.4), fill, mix(fill, '#000000', 0.18)] };
    case 'print':
      return { fill, border: R.ink, shadow: R.ink };
    default:
      return { fill };
  }
}
