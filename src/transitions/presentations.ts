/**
 * Transition presentations. Each returns CSS for the exiting and entering
 * scene containers at progress p (0→1), plus an optional overlay spec.
 * Registry-based: add a transition by adding an entry.
 */
import type { CSSProperties } from 'react';
import { clamp, EASE, speedRamp } from '../motion/primitives';

export interface TransitionFrame {
  exit: CSSProperties;
  enter: CSSProperties;
  overlay?: { kind: 'light-sweep' | 'color-sweep'; p: number };
}

export interface TransitionDef {
  id: string;
  label: string;
  energy: number;
  /** Suggested SFX category at the cut point. */
  sfx?: string;
  frame: (p: number, dirSign: 1 | -1) => TransitionFrame;
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

export function isKnownTransition(id: string): boolean {
  return Boolean(TRANSITIONS[id]);
}

export const TRANSITION_IDS = () => Object.keys(TRANSITIONS);
