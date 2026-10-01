/**
 * Central motion physics library. Every spring/easing in the engine comes from
 * one of these named presets — scenes never invent their own constants.
 *
 * A preset describes how an element *settles*: spring stiffness/damping/mass,
 * how much it may overshoot, the nominal duration, and a bezier for curve-driven
 * (non-spring) moves. Presets are pure data; `presetProgress` turns one into a
 * 0→1 progress value for a frame, deterministically.
 */
import { Easing, interpolate, spring } from 'remotion';

export type PhysicsId = 'snappy' | 'responsive' | 'soft' | 'heavy' | 'premium' | 'playful' | 'elastic' | 'cinematic' | 'mechanical' | 'sport' | 'corporate' | 'tech';

export interface PhysicsPreset {
  id: PhysicsId;
  description: string;
  /** Spring parameters (Remotion spring). */
  stiffness: number;
  damping: number;
  mass: number;
  /** True = the spring never passes its target. */
  overshootClamping: boolean;
  /** 0..1 how much overshoot is acceptable (documentation + QC/physics checks). */
  overshoot: number;
  /** Nominal settle time in seconds at speed 1. */
  duration: number;
  /** Bezier for curve-driven moves (camera, wipes, masks). */
  bezier: [number, number, number, number];
  /** 'spring' = physical settle; 'curve' = eased tween (better for big/slow objects). */
  drive: 'spring' | 'curve';
  /** How the move ends. */
  settle: 'hard' | 'soft' | 'bounce';
}

export const PHYSICS: Record<PhysicsId, PhysicsPreset> = {
  snappy: { id: 'snappy', description: 'Fast, decisive, tiny overshoot — UI and punchy type.', stiffness: 260, damping: 26, mass: 0.7, overshootClamping: false, overshoot: 0.06, duration: 0.45, bezier: [0.2, 0.9, 0.1, 1], drive: 'spring', settle: 'hard' },
  responsive: { id: 'responsive', description: 'Immediate feedback for buttons, toggles, cursors.', stiffness: 320, damping: 30, mass: 0.6, overshootClamping: false, overshoot: 0.04, duration: 0.35, bezier: [0.25, 1, 0.5, 1], drive: 'spring', settle: 'hard' },
  soft: { id: 'soft', description: 'Gentle ease, no overshoot — body copy, secondary info.', stiffness: 120, damping: 24, mass: 1, overshootClamping: true, overshoot: 0, duration: 0.8, bezier: [0.22, 1, 0.36, 1], drive: 'curve', settle: 'soft' },
  heavy: { id: 'heavy', description: 'Large objects with inertia — dashboards, devices, big panels.', stiffness: 110, damping: 22, mass: 1.6, overshootClamping: false, overshoot: 0.03, duration: 0.95, bezier: [0.3, 0.9, 0.25, 1], drive: 'spring', settle: 'soft' },
  premium: { id: 'premium', description: 'Controlled and deliberate, no bounce — luxury reveals.', stiffness: 90, damping: 26, mass: 1.3, overshootClamping: true, overshoot: 0, duration: 1.15, bezier: [0.16, 1, 0.3, 1], drive: 'curve', settle: 'soft' },
  playful: { id: 'playful', description: 'Springy with visible overshoot — icons, stickers, friendly brands.', stiffness: 180, damping: 11, mass: 0.8, overshootClamping: false, overshoot: 0.22, duration: 0.7, bezier: [0.34, 1.56, 0.64, 1], drive: 'spring', settle: 'bounce' },
  elastic: { id: 'elastic', description: 'Strong elastic settle — pops and badges (use sparingly).', stiffness: 140, damping: 9, mass: 0.8, overshootClamping: false, overshoot: 0.32, duration: 0.85, bezier: [0.34, 1.7, 0.64, 1], drive: 'spring', settle: 'bounce' },
  cinematic: { id: 'cinematic', description: 'Slow in-out for camera and atmospheric reveals.', stiffness: 70, damping: 20, mass: 1.4, overshootClamping: true, overshoot: 0, duration: 1.4, bezier: [0.65, 0, 0.35, 1], drive: 'curve', settle: 'soft' },
  mechanical: { id: 'mechanical', description: 'Linear-ish precise moves — data, tickers, tech UI.', stiffness: 400, damping: 40, mass: 0.5, overshootClamping: true, overshoot: 0, duration: 0.4, bezier: [0.4, 0, 0.2, 1], drive: 'curve', settle: 'hard' },
  sport: { id: 'sport', description: 'Aggressive impact with a short hit — sports and hype.', stiffness: 380, damping: 18, mass: 0.6, overshootClamping: false, overshoot: 0.12, duration: 0.32, bezier: [0.1, 0.9, 0.05, 1], drive: 'spring', settle: 'hard' },
  corporate: { id: 'corporate', description: 'Measured ease-out, no overshoot — institutional, trustworthy.', stiffness: 150, damping: 28, mass: 1, overshootClamping: true, overshoot: 0, duration: 0.65, bezier: [0.25, 0.8, 0.3, 1], drive: 'curve', settle: 'soft' },
  tech: { id: 'tech', description: 'Crisp, exact, a hair of overshoot — product UI and SaaS.', stiffness: 300, damping: 30, mass: 0.7, overshootClamping: false, overshoot: 0.02, duration: 0.42, bezier: [0.3, 1, 0.3, 1], drive: 'spring', settle: 'hard' },
};

export const PHYSICS_IDS = Object.keys(PHYSICS) as PhysicsId[];

/** Element kinds the physics map understands. */
export type ElementKind = 'button' | 'icon' | 'card' | 'panel' | 'dashboard' | 'device' | 'hero-title' | 'text' | 'body' | 'logo' | 'product' | 'chart' | 'number' | 'camera' | 'background' | 'cursor' | 'notification' | 'transition';
export const ELEMENT_KINDS: ElementKind[] = ['button', 'icon', 'card', 'panel', 'dashboard', 'device', 'hero-title', 'text', 'body', 'logo', 'product', 'chart', 'number', 'camera', 'background', 'cursor', 'notification', 'transition'];

/** Physical defaults by element size/role, before personality is applied. */
export const ELEMENT_DEFAULT: Record<ElementKind, PhysicsId> = {
  button: 'responsive',
  cursor: 'responsive',
  notification: 'snappy',
  icon: 'snappy',
  card: 'snappy',
  panel: 'heavy',
  dashboard: 'heavy',
  device: 'heavy',
  'hero-title': 'snappy',
  text: 'soft',
  body: 'soft',
  logo: 'premium',
  product: 'heavy',
  chart: 'mechanical',
  number: 'mechanical',
  camera: 'cinematic',
  background: 'cinematic',
  transition: 'snappy',
};

const bezierCache = new Map<string, (t: number) => number>();
export function presetEasing(p: PhysicsPreset): (t: number) => number {
  const k = p.bezier.join(',');
  let e = bezierCache.get(k);
  if (!e) {
    e = Easing.bezier(...p.bezier);
    bezierCache.set(k, e);
  }
  return e;
}

/**
 * 0→1 progress of a preset at `frame` (scene-local), starting `delay` seconds in.
 * `dur` stretches/compresses curve presets; springs use their own physics but are
 * time-scaled by `speed`. Pure function of its inputs.
 */
export function presetProgress(p: PhysicsPreset, frame: number, fps: number, delay = 0, dur?: number, speed = 1): number {
  const f = frame - (delay * fps) / speed;
  if (f <= 0) return 0;
  if (p.drive === 'spring') {
    // durationInFrames would re-time the spring and erase its character; scale time instead.
    const k = dur ? Math.max(0.35, Math.min(2.5, p.duration / dur)) : 1;
    return spring({ frame: f * k * speed, fps, config: { stiffness: p.stiffness, damping: p.damping, mass: p.mass, overshootClamping: p.overshootClamping } });
  }
  const d = Math.max(1, ((dur ?? p.duration) * fps) / speed);
  return interpolate(f, [0, d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: presetEasing(p) });
}

/** Peak overshoot of a preset (measured, frame-sampled) — used by tests and docs. */
export function measuredOvershoot(p: PhysicsPreset, fps = 30): number {
  let peak = 0;
  for (let f = 0; f < fps * 4; f++) peak = Math.max(peak, presetProgress(p, f, fps));
  return Math.max(0, peak - 1);
}

/** Frames until the preset stays within 1% of its target. */
export function settleFrames(p: PhysicsPreset, fps = 30): number {
  let last = 0;
  for (let f = 0; f < fps * 6; f++) if (Math.abs(presetProgress(p, f, fps) - 1) > 0.01) last = f;
  return last + 1;
}
