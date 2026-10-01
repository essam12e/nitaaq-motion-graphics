/**
 * Text Motion Engine — registry of text animation families.
 *
 * A family animates text at a granularity (block / line / word / char /
 * number). Arabic is cursive: per-glyph animation would break the joined
 * letterforms, so every family declares an `arabicUnit` (word groups, lines or
 * masks) used whenever the run contains Arabic. Character units are applied to
 * Latin runs only. Tracking on Arabic is simulated with word spacing (safe),
 * never letter-spacing.
 *
 * `unit(p, c)` returns the CSS for one unit at progress p (p may dip below 0 or
 * pass 1 for anticipation / overshoot). `mask` wraps each unit in a clip box so
 * reveals slide out of an invisible edge. Pure functions — deterministic.
 */
import type { CSSProperties } from 'react';
import { CapabilityRegistry } from '../core/registry';

export type TextUnit = 'block' | 'line' | 'word' | 'char';
export type RoleGroup = 'headline' | 'support' | 'cta' | 'number' | 'label';

export interface UnitCtx {
  /** Unit index and count within the text. */
  i: number;
  n: number;
  dir: 'rtl' | 'ltr';
  /** Canvas unit (1% of the short edge) in px. */
  u: number;
  intensity: number;
  /** True when this unit contains Arabic letters. */
  arabic: boolean;
}

export interface TextMotionFamily {
  id: string;
  label: string;
  unit: TextUnit;
  arabicUnit: Exclude<TextUnit, 'char'>;
  roles: RoleGroup[];
  /** 0..1 visual energy (hierarchy: headline ≥ support). */
  energy: number;
  /** Seconds per unit and stagger multiplier on the film stagger. */
  duration: number;
  stagger: number;
  /** Units slide out of a clip box (reveal from an invisible edge). */
  mask?: boolean;
  /** Direction the motion reads in — 'up' families are rationed (banned look: everything slides up). */
  direction: 'up' | 'down' | 'side' | 'depth' | 'none';
  /** Highlight treatment the family draws on emphasised words (overrides the style's). */
  highlight?: 'marker' | 'underline' | 'box' | 'pulse';
  /** Progress curve: 'spring' families may overshoot; 'curve' families never do. */
  curve: 'spring' | 'curve' | 'step';
  unit_(p: number, c: UnitCtx): CSSProperties;
}

export const TextMotionRegistry = new CapabilityRegistry<TextMotionFamily>('text motion');

const c01 = (v: number) => Math.min(1, Math.max(0, v));
const op = (p: number, k = 1.8) => c01(p * k);
const side = (c: UnitCtx) => (c.dir === 'rtl' ? 1 : -1); // reading-start edge: right for RTL

const F: Omit<TextMotionFamily, 'unit_'>[] = [];
const def = (f: Omit<TextMotionFamily, 'unit_'>, unit_: TextMotionFamily['unit_']) => {
  F.push(f);
  if (!TextMotionRegistry.has(f.id)) TextMotionRegistry.register({ ...f, unit_ });
};

def({ id: 'mask-reveal', label: 'Mask reveal', unit: 'line', arabicUnit: 'line', roles: ['headline', 'support', 'cta'], energy: 0.5, duration: 0.75, stagger: 1.4, mask: true, direction: 'up', curve: 'curve' }, (p) => ({ transform: `translateY(${(1 - p) * 105}%)` }));
def({ id: 'line-reveal', label: 'Line reveal', unit: 'line', arabicUnit: 'line', roles: ['support', 'headline', 'label'], energy: 0.3, duration: 0.7, stagger: 1.5, direction: 'up', curve: 'curve' }, (p, c) => ({ opacity: op(p, 1.4), transform: `translateY(${(1 - p) * 2.2 * c.u}px)` }));
def({ id: 'word-stagger', label: 'Word stagger', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support', 'cta'], energy: 0.55, duration: 0.55, stagger: 1, direction: 'up', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.2), transform: `translateY(${(1 - p) * 3.5 * c.u}px)` }));
def({ id: 'char-stagger', label: 'Character stagger (Latin only)', unit: 'char', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.6, duration: 0.42, stagger: 0.35, direction: 'up', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.5), transform: `translateY(${(1 - p) * 2.6 * c.u}px) rotate(${(1 - p) * (c.arabic ? 0 : 6)}deg)` }));
def({ id: 'tracking-reveal', label: 'Tracking reveal', unit: 'block', arabicUnit: 'block', roles: ['headline', 'label'], energy: 0.35, duration: 1.1, stagger: 1, direction: 'none', curve: 'curve' }, (p, c) =>
  // Latin: tight → normal letter-spacing. Arabic: word-spacing only (letter-spacing breaks the joins). Never wider than the fitted text.
  c.arabic ? { opacity: op(p, 1.3), wordSpacing: `${(p - 1) * 0.28}em` } : { opacity: op(p, 1.3), letterSpacing: `${(p - 1) * 0.12}em` },
);
def({ id: 'scale-impact', label: 'Scale impact', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.85, duration: 0.45, stagger: 1.2, direction: 'depth', curve: 'spring' }, (p) => ({ opacity: op(p, 3), transform: `scale(${1.6 - 0.6 * p})` }));
def({ id: 'blur-reveal', label: 'Blur reveal', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support'], energy: 0.3, duration: 0.8, stagger: 0.9, direction: 'depth', curve: 'curve' }, (p, c) => ({ opacity: op(p, 1.3), filter: `blur(${(1 - c01(p)) * 1.6 * c.u}px)` }));
def({ id: 'vertical-reveal', label: 'Vertical reveal', unit: 'word', arabicUnit: 'word', roles: ['support', 'label', 'headline'], energy: 0.45, duration: 0.6, stagger: 1, mask: true, direction: 'down', curve: 'curve' }, (p) => ({ transform: `translateY(${-(1 - p) * 110}%)` }));
def({ id: 'horizontal-reveal', label: 'Horizontal reveal', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support'], energy: 0.5, duration: 0.6, stagger: 1, mask: true, direction: 'side', curve: 'curve' }, (p, c) => ({ transform: `translateX(${side(c) * (1 - p) * 105}%)` }));
def({ id: 'split-reveal', label: 'Split reveal', unit: 'line', arabicUnit: 'line', roles: ['headline'], energy: 0.55, duration: 0.8, stagger: 1.2, direction: 'none', curve: 'curve' }, (p) => ({ clipPath: `inset(${(1 - c01(p)) * 50}% -5% ${(1 - c01(p)) * 50}% -5%)` }));
def({ id: 'slide-reveal', label: 'Slide reveal', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support', 'cta'], energy: 0.65, duration: 0.5, stagger: 0.9, direction: 'side', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.4), transform: `translateX(${side(c) * (1 - p) * 6 * c.u}px)` }));
def({ id: 'wipe-reveal', label: 'Wipe reveal', unit: 'line', arabicUnit: 'line', roles: ['headline', 'support', 'label'], energy: 0.45, duration: 0.7, stagger: 1.3, direction: 'side', curve: 'curve' }, (p, c) =>
  c.dir === 'rtl' ? { clipPath: `inset(-25% 0 -25% ${(1 - c01(p)) * 100}%)` } : { clipPath: `inset(-25% ${(1 - c01(p)) * 100}% -25% 0)` },
);
def({ id: 'perspective-reveal', label: 'Perspective reveal', unit: 'line', arabicUnit: 'line', roles: ['headline'], energy: 0.6, duration: 0.85, stagger: 1.3, direction: 'depth', curve: 'curve' }, (p, c) => ({ opacity: op(p, 1.6), transform: `perspective(${60 * c.u}px) rotateX(${(1 - p) * 70}deg)`, transformOrigin: '50% 100%' }));
def({ id: 'rotation-reveal', label: 'Rotation reveal', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.7, duration: 0.55, stagger: 1, direction: 'depth', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.2), transform: `rotate(${(1 - p) * -side(c) * 12}deg) translateY(${(1 - p) * 2 * c.u}px)`, transformOrigin: c.dir === 'rtl' ? '100% 100%' : '0% 100%' }));
def({ id: 'compress-expand', label: 'Compression / expansion', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.75, duration: 0.5, stagger: 1, direction: 'none', curve: 'spring' }, (p) => ({ opacity: op(p, 2.5), transform: `scaleX(${0.35 + 0.65 * p}) scaleY(${1.25 - 0.25 * p})` }));
def({ id: 'word-replace', label: 'Word replacement', unit: 'word', arabicUnit: 'word', roles: ['headline'], energy: 0.6, duration: 0.5, stagger: 1.1, mask: true, direction: 'up', curve: 'spring' }, (p) => ({ transform: `translateY(${(1 - p) * 100}%)`, opacity: op(p, 3) }));
def({ id: 'number-count', label: 'Number count', unit: 'word', arabicUnit: 'word', roles: ['number', 'headline'], energy: 0.6, duration: 0.6, stagger: 1, direction: 'none', curve: 'curve' }, (p, c) => ({ opacity: op(p, 2.5), transform: `translateY(${(1 - p) * 1.5 * c.u}px)` }));
def({ id: 'underline-draw', label: 'Underline draw', unit: 'line', arabicUnit: 'line', roles: ['headline', 'support'], energy: 0.4, duration: 0.7, stagger: 1.4, direction: 'none', highlight: 'underline', curve: 'curve' }, (p, c) => ({ opacity: op(p, 1.5), transform: `translateY(${(1 - p) * 1.5 * c.u}px)` }));
def({ id: 'marker-highlight', label: 'Marker highlight', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support'], energy: 0.45, duration: 0.55, stagger: 1, direction: 'none', highlight: 'marker', curve: 'curve' }, (p) => ({ opacity: op(p, 1.8) }));
def({ id: 'background-highlight', label: 'Background highlight', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.55, duration: 0.55, stagger: 1, direction: 'side', highlight: 'box', curve: 'curve' }, (p, c) => ({ opacity: op(p, 2), transform: `translateX(${side(c) * (1 - p) * 2 * c.u}px)` }));
def({ id: 'phrase-emphasis', label: 'Phrase emphasis', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support'], energy: 0.5, duration: 0.6, stagger: 0.9, direction: 'none', highlight: 'pulse', curve: 'curve' }, (p, c) => ({ opacity: op(p, 1.6), filter: `blur(${(1 - c01(p)) * 0.8 * c.u}px)` }));
def({ id: 'controlled-bounce', label: 'Controlled bounce', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.7, duration: 0.6, stagger: 1, direction: 'down', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.5), transform: `translateY(${-(1 - p) * 5 * c.u}px)` }));
def({ id: 'cinematic-title', label: 'Cinematic title', unit: 'block', arabicUnit: 'block', roles: ['headline'], energy: 0.4, duration: 1.6, stagger: 1, direction: 'depth', curve: 'curve' }, (p, c) =>
  c.arabic
    ? { opacity: op(p, 1.2), transform: `scale(${1.08 - 0.08 * p})`, filter: `blur(${(1 - c01(p)) * 1.2 * c.u}px)`, wordSpacing: `${(1 - p) * 0.25}em` }
    : { opacity: op(p, 1.2), transform: `scale(${1.08 - 0.08 * p})`, filter: `blur(${(1 - c01(p)) * 1.2 * c.u}px)`, letterSpacing: `${(p - 1) * 0.08}em` },
);
def({ id: 'editorial-title', label: 'Editorial title', unit: 'line', arabicUnit: 'line', roles: ['headline', 'support'], energy: 0.35, duration: 1, stagger: 1.8, mask: true, direction: 'up', curve: 'curve' }, (p) => ({ transform: `translateY(${(1 - p) * 60}%)`, opacity: op(p, 1.2) }));
def({ id: 'typography-punch', label: 'Typography punch', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.95, duration: 0.38, stagger: 1.3, direction: 'depth', curve: 'spring' }, (p) => ({ opacity: p > 0.02 ? 1 : 0, transform: `scale(${2.1 - 1.1 * p})` }));
def({ id: 'follow-through', label: 'Text follow-through', unit: 'word', arabicUnit: 'word', roles: ['headline', 'support'], energy: 0.6, duration: 0.7, stagger: 0.8, direction: 'side', curve: 'spring' }, (p, c) => ({ opacity: op(p, 2.2), transform: `translateX(${side(c) * (1 - p) * 4 * c.u}px) skewX(${-side(c) * (1 - p) * 10}deg)` }));
def({ id: 'kinetic-sequence', label: 'Kinetic word sequencing', unit: 'word', arabicUnit: 'word', roles: ['headline', 'cta'], energy: 0.9, duration: 0.28, stagger: 1.8, direction: 'none', curve: 'step' }, (p) => ({ opacity: p > 0.01 ? 1 : 0, transform: `scale(${1.12 - 0.12 * c01(p)})` }));

export const TEXT_MOTION_IDS = () => TextMotionRegistry.ids();

/** The unit a family actually animates for this text (Arabic never goes below word groups). */
export function effectiveUnit(f: TextMotionFamily, hasArabicText: boolean): TextUnit {
  return hasArabicText && f.unit === 'char' ? f.arabicUnit : f.unit;
}

export function roleGroupOf(role: string): RoleGroup {
  if (role === 'headline' || role === 'title') return 'headline';
  if (role === 'cta') return 'cta';
  if (role === 'number') return 'number';
  if (role === 'label' || role === 'eyebrow') return 'label';
  return 'support';
}

/** Family list snapshot (docs / tests). */
export const TEXT_MOTION_FAMILIES = F;
