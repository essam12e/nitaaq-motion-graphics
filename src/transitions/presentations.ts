/**
 * Transition presentations. Each returns CSS for the exiting and entering
 * scene containers at progress p (0→1), plus an optional overlay spec.
 * Registry-based: add a transition by adding an entry.
 */
import type { CSSProperties } from 'react';
import { clamp, EASE, speedRamp } from '../motion/primitives';
import { CapabilityRegistry } from '../core/registry';

export type OverlayKind = 'light-sweep' | 'color-sweep' | 'color-dip' | 'object-sweep' | 'text-sweep';

export interface TransitionFrame {
  exit: CSSProperties;
  enter: CSSProperties;
  overlay?: { kind: OverlayKind; p: number };
}

/** What a transition says about the relationship between two scenes. */
export type TransitionMeaning = 'continuity' | 'contrast' | 'reveal' | 'energy' | 'calm' | 'space' | 'time' | 'brand' | 'ui';

export interface TransitionDef {
  id: string;
  label: string;
  energy: number;
  /** Suggested SFX category at the cut point. */
  sfx?: string;
  frame: (p: number, dirSign: 1 | -1) => TransitionFrame;
  /** Relationships it expresses (Transition Engine). */
  meaning?: TransitionMeaning[];
  /** Default seconds at medium pace. */
  duration?: number;
  /** Needs something in the scenes: the same identity asset (shared), a product image or a headline word. */
  requires?: 'shared' | 'product' | 'text';
  /** Frame of the transition (0..1) where the visual "hit" happens — the Sound Director syncs here. */
  peak?: number;
}

const e = (p: number) => EASE.inOut(clamp(p));

export const TRANSITIONS: Record<string, TransitionDef> = {
  cut: { id: 'cut', label: 'Cut', energy: 0.9, frame: () => ({ exit: {}, enter: {} }) },
  none: { id: 'none', label: 'None', energy: 0.5, frame: () => ({ exit: {}, enter: {} }) },
  crossfade: { id: 'crossfade', label: 'Crossfade', energy: 0.2, frame: (p) => ({ exit: { opacity: 1 - e(p) }, enter: { opacity: e(p) } }) },
  fade: {
    id: 'fade',
    label: 'Dip',
    energy: 0.15,
    frame: (p) => ({ exit: { opacity: clamp(1 - p * 2) }, enter: { opacity: clamp(p * 2 - 1) } }),
  },
  slide: {
    id: 'slide',
    label: 'Slide over',
    energy: 0.5,
    sfx: 'whoosh',
    frame: (p, d) => ({ exit: { opacity: 1 - e(p) * 0.4, transform: `scale(${1 - e(p) * 0.05})` }, enter: { transform: `translateX(${d * -100 * (1 - e(p))}%)`, boxShadow: '0 0 80px rgba(0,0,0,0.35)' } }),
  },
  push: {
    id: 'push',
    label: 'Push',
    energy: 0.6,
    sfx: 'whoosh',
    frame: (p, d) => ({ exit: { transform: `translateX(${d * 100 * e(p)}%)` }, enter: { transform: `translateX(${d * -100 * (1 - e(p))}%)` } }),
  },
  wipe: {
    id: 'wipe',
    label: 'Wipe',
    energy: 0.4,
    sfx: 'swoosh',
    frame: (p, d) => ({ exit: {}, enter: { clipPath: d === 1 ? `inset(0 0 0 ${100 * (1 - e(p))}%)` : `inset(0 ${100 * (1 - e(p))}% 0 0)` } }),
  },
  'mask-wipe': {
    id: 'mask-wipe',
    label: 'Angled mask',
    energy: 0.55,
    sfx: 'sweep',
    frame: (p, d) => {
      const x = 130 * (1 - e(p)) - 15;
      const poly = d === 1 ? `polygon(${x}% 0, 100% 0, 100% 100%, ${x - 15}% 100%)` : `polygon(0 0, ${100 - x}% 0, ${115 - x}% 100%, 0 100%)`;
      return { exit: { transform: `scale(${1 - 0.04 * e(p)})` }, enter: { clipPath: poly, transform: `scale(${1.05 - 0.05 * e(p)})` } };
    },
  },
  'zoom-in': {
    id: 'zoom-in',
    label: 'Zoom through',
    energy: 0.7,
    sfx: 'whoosh',
    frame: (p) => ({ exit: { transform: `scale(${1 + 0.3 * e(p)})`, opacity: 1 - e(p), filter: `blur(${8 * e(p)}px)` }, enter: { transform: `scale(${0.86 + 0.14 * e(p)})`, opacity: e(p) } }),
  },
  'zoom-out': {
    id: 'zoom-out',
    label: 'Zoom out',
    energy: 0.5,
    sfx: 'whoosh-low',
    frame: (p) => ({ exit: { transform: `scale(${1 - 0.14 * e(p)})`, opacity: 1 - e(p) }, enter: { transform: `scale(${1.22 - 0.22 * e(p)})`, opacity: e(p) } }),
  },
  blur: {
    id: 'blur',
    label: 'Blur dissolve',
    energy: 0.3,
    frame: (p) => ({ exit: { opacity: 1 - e(p), filter: `blur(${22 * e(p)}px)` }, enter: { opacity: e(p), filter: `blur(${22 * (1 - e(p))}px)` } }),
  },
  iris: {
    id: 'iris',
    label: 'Iris',
    energy: 0.6,
    sfx: 'pop',
    frame: (p) => ({ exit: {}, enter: { clipPath: `circle(${Math.max(0.1, 75 * e(p))}% at 50% 50%)` } }),
  },
  'light-sweep': {
    id: 'light-sweep',
    label: 'Light sweep',
    energy: 0.4,
    sfx: 'sweep',
    frame: (p) => ({ exit: { opacity: 1 - e(p) }, enter: { opacity: e(p) }, overlay: { kind: 'light-sweep', p } }),
  },
  'speed-ramp': {
    id: 'speed-ramp',
    label: 'Speed ramp',
    energy: 0.95,
    sfx: 'whoosh',
    frame: (p, d) => {
      const r = speedRamp(p);
      const v = Math.sin(p * Math.PI);
      return {
        exit: { transform: `translateX(${d * 110 * r}%) skewX(${d * -8 * v}deg)`, filter: `blur(${16 * v}px)` },
        enter: { transform: `translateX(${d * -110 * (1 - r)}%) skewX(${d * -8 * v}deg)`, filter: `blur(${16 * v}px)` },
      };
    },
  },
  flip: {
    id: 'flip',
    label: 'Card flip',
    energy: 0.6,
    sfx: 'swoosh',
    frame: (p, d) => ({
      exit: { transform: `perspective(2200px) rotateY(${d * 90 * clamp(p * 2)}deg)`, opacity: p < 0.5 ? 1 : 0 },
      enter: { transform: `perspective(2200px) rotateY(${d * -90 * (1 - clamp(p * 2 - 1))}deg)`, opacity: p >= 0.5 ? 1 : 0 },
    }),
  },
  'color-sweep': {
    id: 'color-sweep',
    label: 'Brand colour sweep',
    energy: 0.7,
    sfx: 'whoosh',
    frame: (p) => ({ exit: { opacity: p < 0.5 ? 1 : 0 }, enter: { opacity: p >= 0.5 ? 1 : 0 }, overlay: { kind: 'color-sweep', p } }),
  },
};

const EXTRA: Record<string, TransitionDef> = {
  'match-cut': { id: 'match-cut', label: 'Match cut', energy: 0.35, meaning: ['continuity'], duration: 0.14, peak: 0.5, frame: (p) => ({ exit: { transform: `scale(${1 + 0.03 * p})` }, enter: { transform: `scale(${0.97 + 0.03 * p})`, opacity: p < 0.5 ? 0 : 1 } }) },
  shared: { id: 'shared', label: 'Shared element', energy: 0.4, meaning: ['continuity'], duration: 0.7, requires: 'shared', peak: 0.55, frame: (p) => ({ exit: { opacity: 1 - e(p) }, enter: { opacity: e(p) } }) },
  morph: {
    id: 'morph',
    label: 'Morph',
    energy: 0.45,
    meaning: ['continuity', 'reveal'],
    duration: 0.6,
    peak: 0.5,
    frame: (p) => ({ exit: { opacity: 1 - e(p), transform: `scale(${1 - 0.06 * e(p)})`, filter: `blur(${6 * e(p)}px)` }, enter: { clipPath: `inset(${18 * (1 - e(p))}% round ${30 * (1 - e(p))}%)`, transform: `scale(${1.06 - 0.06 * e(p)})` } }),
  },
  'camera-push': {
    id: 'camera-push',
    label: 'Camera push',
    energy: 0.55,
    meaning: ['reveal', 'space'],
    sfx: 'whoosh-low',
    duration: 0.65,
    peak: 0.5,
    frame: (p) => {
      const c = EASE.cinematic(clamp(p));
      return { exit: { transform: `scale(${1 + 0.35 * c})`, opacity: 1 - c }, enter: { transform: `scale(${0.82 + 0.18 * c})`, opacity: c } };
    },
  },
  'camera-pull': {
    id: 'camera-pull',
    label: 'Camera pull',
    energy: 0.45,
    meaning: ['space', 'calm'],
    sfx: 'whoosh-low',
    duration: 0.7,
    peak: 0.5,
    frame: (p) => {
      const c = EASE.cinematic(clamp(p));
      return { exit: { transform: `scale(${1 - 0.22 * c})`, opacity: 1 - c }, enter: { transform: `scale(${1.25 - 0.25 * c})`, opacity: c } };
    },
  },
  whip: {
    id: 'whip',
    label: 'Whip pan',
    energy: 0.95,
    meaning: ['energy', 'time'],
    sfx: 'whoosh',
    duration: 0.28,
    peak: 0.5,
    frame: (p, d) => {
      const r = speedRamp(p);
      const v = Math.sin(p * Math.PI);
      return { exit: { transform: `translateX(${d * 100 * r}%)`, filter: `blur(${24 * v}px)` }, enter: { transform: `translateX(${d * -100 * (1 - r)}%)`, filter: `blur(${24 * v}px)` } };
    },
  },
  depth: {
    id: 'depth',
    label: 'Depth',
    energy: 0.5,
    meaning: ['space', 'reveal'],
    sfx: 'whoosh-low',
    duration: 0.6,
    peak: 0.6,
    frame: (p) => ({ exit: { transform: `scale(${1 - 0.14 * e(p)})`, filter: `brightness(${1 - 0.55 * e(p)}) blur(${4 * e(p)}px)` }, enter: { transform: `scale(${1.14 - 0.14 * e(p)})`, opacity: e(p) } }),
  },
  shape: {
    id: 'shape',
    label: 'Brand shape',
    energy: 0.6,
    meaning: ['brand', 'reveal'],
    sfx: 'pop',
    duration: 0.55,
    peak: 0.45,
    frame: (p) => ({ exit: { transform: `scale(${1 - 0.05 * e(p)})` }, enter: { clipPath: `inset(${50 * (1 - e(p))}% ${50 * (1 - e(p))}% round ${Math.max(4, 48 * (1 - e(p)))}%)` } }),
  },
  'text-sweep': {
    id: 'text-sweep',
    label: 'Text-driven',
    energy: 0.75,
    meaning: ['energy', 'reveal'],
    sfx: 'whoosh',
    duration: 0.55,
    requires: 'text',
    peak: 0.5,
    frame: (p) => ({ exit: { opacity: p < 0.5 ? 1 : 0 }, enter: { opacity: p >= 0.5 ? 1 : 0 }, overlay: { kind: 'text-sweep', p } }),
  },
  'object-sweep': {
    id: 'object-sweep',
    label: 'Product-driven',
    energy: 0.8,
    meaning: ['reveal', 'energy'],
    sfx: 'whoosh',
    duration: 0.55,
    requires: 'product',
    peak: 0.5,
    frame: (p) => ({ exit: { opacity: p < 0.5 ? 1 : 0 }, enter: { opacity: p >= 0.5 ? 1 : 0 }, overlay: { kind: 'object-sweep', p } }),
  },
  'color-dip': {
    id: 'color-dip',
    label: 'Colour transition',
    energy: 0.5,
    meaning: ['brand', 'contrast'],
    duration: 0.5,
    peak: 0.5,
    frame: (p) => ({ exit: { opacity: p < 0.5 ? 1 : 0 }, enter: { opacity: p >= 0.5 ? 1 : 0 }, overlay: { kind: 'color-dip', p } }),
  },
  perspective: {
    id: 'perspective',
    label: 'Perspective turn',
    energy: 0.65,
    meaning: ['space', 'contrast'],
    sfx: 'swoosh',
    duration: 0.6,
    peak: 0.5,
    frame: (p, d) => {
      const c = e(p);
      return {
        exit: { transform: `perspective(1800px) rotateY(${d * 70 * c}deg)`, transformOrigin: d === 1 ? 'left center' : 'right center', opacity: 1 - c * 0.6 },
        enter: { transform: `perspective(1800px) rotateY(${d * -70 * (1 - c)}deg)`, transformOrigin: d === 1 ? 'right center' : 'left center', opacity: 0.4 + 0.6 * c },
      };
    },
  },
  page: {
    id: 'page',
    label: 'Page / UI',
    energy: 0.45,
    meaning: ['ui', 'continuity'],
    sfx: 'swoosh',
    duration: 0.5,
    peak: 0.6,
    frame: (p, d) => ({ exit: { transform: `translateX(${d * 28 * e(p)}%)`, filter: `brightness(${1 - 0.35 * e(p)})` }, enter: { transform: `translateX(${d * -100 * (1 - e(p))}%)`, boxShadow: '0 0 90px rgba(0,0,0,0.35)' } }),
  },
  split: {
    id: 'split',
    label: 'Split',
    energy: 0.55,
    meaning: ['contrast', 'reveal'],
    sfx: 'sweep',
    duration: 0.55,
    peak: 0.5,
    frame: (p) => ({ exit: { transform: `scale(${1 - 0.04 * e(p)})`, filter: `brightness(${1 - 0.3 * e(p)})` }, enter: { clipPath: `inset(${50 * (1 - e(p))}% -2% ${50 * (1 - e(p))}% -2%)` } }),
  },
};
Object.assign(TRANSITIONS, EXTRA);

/** Meaning / duration / peak metadata for the original transitions. */
const META: Record<string, Pick<TransitionDef, 'meaning' | 'duration' | 'peak'>> = {
  cut: { meaning: ['continuity', 'energy', 'time'], duration: 0, peak: 0 },
  none: { meaning: ['continuity'], duration: 0, peak: 0 },
  crossfade: { meaning: ['calm', 'time'], duration: 0.55, peak: 0.5 },
  fade: { meaning: ['calm', 'time'], duration: 0.6, peak: 0.5 },
  slide: { meaning: ['ui', 'continuity'], duration: 0.5, peak: 0.55 },
  push: { meaning: ['continuity', 'ui'], duration: 0.45, peak: 0.5 },
  wipe: { meaning: ['contrast'], duration: 0.45, peak: 0.5 },
  'mask-wipe': { meaning: ['contrast', 'reveal'], duration: 0.5, peak: 0.5 },
  'zoom-in': { meaning: ['reveal', 'energy'], duration: 0.45, peak: 0.45 },
  'zoom-out': { meaning: ['space', 'calm'], duration: 0.55, peak: 0.5 },
  blur: { meaning: ['calm', 'time'], duration: 0.6, peak: 0.5 },
  iris: { meaning: ['reveal'], duration: 0.5, peak: 0.4 },
  'light-sweep': { meaning: ['reveal', 'brand', 'calm'], duration: 0.6, peak: 0.5 },
  'speed-ramp': { meaning: ['energy', 'time'], duration: 0.4, peak: 0.5 },
  flip: { meaning: ['contrast'], duration: 0.55, peak: 0.5 },
  'color-sweep': { meaning: ['brand', 'energy'], duration: 0.5, peak: 0.5 },
};
for (const [id, m] of Object.entries(META)) if (TRANSITIONS[id]) Object.assign(TRANSITIONS[id], { ...m, ...TRANSITIONS[id], meaning: TRANSITIONS[id].meaning ?? m.meaning, duration: TRANSITIONS[id].duration ?? m.duration, peak: TRANSITIONS[id].peak ?? m.peak });

/** Registry view of the transitions (TransitionRegistry.register adds plugins). */
export const TransitionRegistry = new CapabilityRegistry<TransitionDef>('transition');
for (const t of Object.values(TRANSITIONS)) if (!TransitionRegistry.has(t.id)) TransitionRegistry.register(t);
TransitionRegistry.alias('hard-cut', 'cut');
TransitionRegistry.alias('dissolve', 'crossfade');
TransitionRegistry.alias('shared-element', 'shared');

export function isKnownTransition(id: string): boolean {
  return Boolean(TRANSITIONS[id]) || TransitionRegistry.has(id);
}

export const TRANSITION_IDS = () => Object.keys(TRANSITIONS);
