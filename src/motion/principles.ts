/**
 * Animation Principles Engine — motion design, not "opacity 0 → 1".
 *
 * One place decides HOW a thing moves from WHAT it is (element kind), HOW BIG /
 * HEAVY it looks (apparent mass) and the film's personality:
 *
 *   anticipation   small counter-move before a big move (never on premium/corporate UI)
 *   overshoot      bounded by the personality's overshoot budget
 *   settle         spring settle or soft curve, from the physics preset
 *   follow-through children lag their parent and settle after it
 *   secondary      small delayed reaction (shadow, label, glow) to a primary move
 *   arcs           organic objects travel on arcs, UI travels straight
 *   squash/stretch volume-preserving, only for light playful objects
 *   timing/spacing duration scales with travel distance and mass
 *
 * Every function is pure (frame in → value out). The same profile also yields
 * the motion's SOUND ANCHORS (start, peak velocity, contact, settle, completion)
 * so the Sound Director can sync sound to the real motion, not to scene start.
 */
import type { CSSProperties } from 'react';
import { PHYSICS, presetProgress, type ElementKind, type PhysicsPreset } from './physics';
import { PERSONALITIES, physicsFor, type MotionPersonalityId } from './personality';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Apparent mass from an element's on-screen size (fraction of canvas area) and kind. */
export type Mass = 'feather' | 'light' | 'medium' | 'heavy' | 'massive';
const KIND_MASS: Partial<Record<ElementKind, number>> = { icon: 0.15, button: 0.2, cursor: 0.05, notification: 0.25, number: 0.35, text: 0.25, body: 0.2, 'hero-title': 0.45, card: 0.4, logo: 0.5, chart: 0.5, panel: 0.6, product: 0.7, device: 0.75, dashboard: 0.8, camera: 0.9, background: 1 };
export function apparentMass(kind: ElementKind, areaFraction = 0.1): Mass {
  const m = (KIND_MASS[kind] ?? 0.4) * 0.6 + Math.min(1, Math.sqrt(Math.max(0, areaFraction)) * 1.4) * 0.4;
  return m < 0.18 ? 'feather' : m < 0.32 ? 'light' : m < 0.5 ? 'medium' : m < 0.7 ? 'heavy' : 'massive';
}

export interface MotionProfile {
  element: ElementKind;
  mass: Mass;
  preset: PhysicsPreset;
  /** 0..1 counter-move amplitude as a fraction of travel (0 = none). */
  anticipation: number;
  /** Seconds the anticipation takes before the main move. */
  anticipationSec: number;
  /** Max overshoot allowed (personality budget ∩ preset). */
  overshoot: number;
  /** Seconds children lag behind (follow-through) and amplitude of their extra swing. */
  followLag: number;
  followAmp: number;
  /** Curved path bend (0 = straight). */
  arc: number;
  /** Max squash/stretch (0 = rigid). */
  squash: number;
  /** Duration multiplier from mass (heavier = longer). */
  timeScale: number;
  /** Why this profile (documentation, motion_spec.json). */
  why: string;
}

const MASS_TIME: Record<Mass, number> = { feather: 0.75, light: 0.88, medium: 1, heavy: 1.18, massive: 1.35 };
const ORGANIC: ElementKind[] = ['product', 'icon', 'logo', 'notification', 'card'];

/** The single source of truth for how an element moves under a personality. */
export function motionProfile(personality: MotionPersonalityId | undefined, element: ElementKind, areaFraction?: number): MotionProfile {
  const pid = personality ?? 'tech';
  const P = PERSONALITIES[pid] ?? PERSONALITIES.tech;
  const preset = physicsFor(pid, element);
  const mass = apparentMass(element, areaFraction);
  const restrained = pid === 'premium' || pid === 'corporate' || pid === 'cinematic';
  const bouncy = pid === 'playful' || pid === 'energetic' || pid === 'sport';
  const big = mass === 'heavy' || mass === 'massive';
  // anticipation: a wind-up before big expressive moves; UI precision and luxury never wind up
  const anticipation = restrained || element === 'button' || element === 'cursor' || element === 'chart' || element === 'number' ? 0 : bouncy ? (big ? 0.06 : 0.1) : pid === 'tech' ? 0.03 : 0.05;
  const overshoot = Math.min(P.overshootMax, preset.overshoot + (bouncy && !big ? 0.04 : 0));
  const squash = pid === 'playful' && (mass === 'feather' || mass === 'light') && element !== 'hero-title' && element !== 'logo' ? 0.12 : pid === 'sport' && !big ? 0.05 : 0;
  const arc = ORGANIC.includes(element) && !restrained ? (bouncy ? 0.22 : 0.12) : element === 'product' && restrained ? 0.06 : 0;
  return {
    element,
    mass,
    preset,
    anticipation,
    anticipationSec: anticipation ? 0.12 * MASS_TIME[mass] : 0,
    overshoot,
    followLag: restrained ? 0.12 : bouncy ? 0.06 : 0.08,
    followAmp: restrained ? 0 : bouncy ? 0.08 : 0.04,
    arc,
    squash,
    timeScale: MASS_TIME[mass],
    why: `${element} (${mass}) under ${P.label}: ${preset.id} physics${anticipation ? ', anticipation' : ''}${overshoot ? `, overshoot ≤${Math.round(overshoot * 100)}%` : ', no overshoot'}${arc ? ', arc path' : ''}${squash ? ', squash/stretch' : ''}`,
  };
}

/**
 * Principled 0→1 progress: anticipation dip (negative), physics move, overshoot capped
 * by the profile. Returns values slightly outside [0,1] by design (wind-up / overshoot).
 */
export function principledProgress(prof: MotionProfile, frame: number, fps: number, delay = 0, speed = 1, dur?: number): number {
  const antF = (prof.anticipationSec * fps) / speed;
  const start = (delay * fps) / speed;
  const f = frame - start;
  if (f <= 0) return 0;
  if (antF > 0 && f < antF) {
    const x = f / antF;
    return -prof.anticipation * Math.sin(x * Math.PI * 0.5) * (1 - x * 0.2);
  }
  const main = presetProgress(prof.preset, f - antF, fps, 0, dur ? dur * prof.timeScale : prof.preset.drive === 'curve' ? prof.preset.duration * prof.timeScale : undefined, speed);
  const antRelease = antF > 0 ? -prof.anticipation * Math.max(0, 1 - (f - antF) / (antF * 1.5)) * 0.8 : 0;
  // clamp the overshoot to the profile budget (springs may exceed the personality's taste)
  return Math.min(1 + prof.overshoot, main + antRelease * (1 - main));
}

/** A child that follows its parent with lag and an extra swing (follow-through / overlapping action). */
export function followThrough(prof: MotionProfile, frame: number, fps: number, delay = 0, speed = 1, index = 1): number {
  const lagged = principledProgress(prof, frame, fps, delay + prof.followLag * index, speed);
  if (!prof.followAmp) return lagged;
  const settled = clamp01((frame / fps - delay - prof.followLag * index) / 1.2);
  return lagged + Math.sin(settled * Math.PI * 2) * prof.followAmp * (1 - settled) * clamp01(lagged);
}

/** Secondary motion: a small delayed reaction (0..1 envelope) after the primary peaks. */
export function secondaryMotion(prof: MotionProfile, frame: number, fps: number, delay = 0, speed = 1): number {
  const t = frame / fps - delay - (prof.preset.duration * prof.timeScale * 0.5) / speed;
  if (t <= 0) return 0;
  return Math.sin(clamp01(t / 0.5) * Math.PI) * (1 - clamp01(t / 0.9));
}

/** Point on a curved path from a to b (bend = fraction of distance, perpendicular). */
export function arcPoint(a: { x: number; y: number }, b: { x: number; y: number }, t: number, bend: number): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}

/** Volume-preserving squash/stretch from normalised velocity (−1..1 along the move axis). */
export function squashStretch(prof: MotionProfile, velocity: number, axis: 'x' | 'y' = 'y'): { scaleX: number; scaleY: number } {
  if (!prof.squash) return { scaleX: 1, scaleY: 1 };
  const s = 1 + Math.max(-1, Math.min(1, velocity)) * prof.squash;
  return axis === 'y' ? { scaleX: 1 / Math.sqrt(s), scaleY: s } : { scaleX: s, scaleY: 1 / Math.sqrt(s) };
}

/** Normalised velocity (progress units per second) by finite difference — deterministic. */
export function velocityAt(fn: (frame: number) => number, frame: number, fps: number): number {
  return (fn(frame + 0.5) - fn(frame - 0.5)) * fps;
}

/**
 * Full principled entrance: element travels `from` → rest along the profile, with
 * arc, squash/stretch and anticipation. Distances are in px; returns a CSS transform.
 */
export function principledEntrance(
  prof: MotionProfile,
  frame: number,
  fps: number,
  from: { x?: number; y?: number; scale?: number; rotate?: number; opacity?: boolean },
  delay = 0,
  speed = 1,
): CSSProperties {
  const p = principledProgress(prof, frame, fps, delay, speed);
  const inv = 1 - p;
  const pos = prof.arc ? arcPoint({ x: from.x ?? 0, y: from.y ?? 0 }, { x: 0, y: 0 }, clamp01(p), prof.arc) : { x: (from.x ?? 0) * inv, y: (from.y ?? 0) * inv };
  const v = velocityAt((f) => principledProgress(prof, f, fps, delay, speed), frame, fps);
  const axis = Math.abs(from.x ?? 0) > Math.abs(from.y ?? 0) ? 'x' : 'y';
  const ss = squashStretch(prof, Math.min(1, v / 6) * (p < 1 ? 1 : -0.5), axis);
  const sc = from.scale !== undefined ? from.scale + (1 - from.scale) * p : 1;
  const rot = (from.rotate ?? 0) * inv;
  return {
    transform: `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${(sc * ss.scaleX).toFixed(4)}, ${(sc * ss.scaleY).toFixed(4)})`,
    ...(from.opacity === false ? {} : { opacity: clamp01(p * 2.2) }),
  };
}

/** Sound anchors of a motion (scene-local seconds). */
export interface SoundAnchors {
  startFrame: number;
  peakVelocityFrame: number;
  /** First frame the element reaches its rest position (contact / landing / impact). */
  contactFrame: number;
  impactFrame: number;
  settleFrame: number;
  completionFrame: number;
  /** Peak normalised velocity (progress/s) — feeds "motion speed" in motion events. */
  peakVelocity: number;
}

/** Sample a progress function to find where a sound belongs. Pure and cheap (≤ 4 s @ fps). */
export function anchorsOf(fn: (frame: number) => number, fps: number, delay = 0, speed = 1): SoundAnchors {
  const start = Math.round((delay * fps) / speed);
  let peakV = 0;
  let peakF = start;
  let contact = -1;
  let settle = start;
  const end = start + Math.round(fps * 4);
  let prev = fn(start);
  for (let f = start + 1; f <= end; f++) {
    const cur = fn(f);
    const v = (cur - prev) * fps;
    if (v > peakV) {
      peakV = v;
      peakF = f;
    }
    if (contact < 0 && cur >= 0.985) contact = f;
    if (Math.abs(cur - 1) > 0.01) settle = f + 1;
    prev = cur;
  }
  if (contact < 0) contact = settle;
  return { startFrame: start, peakVelocityFrame: peakF, contactFrame: contact, impactFrame: contact, settleFrame: settle, completionFrame: Math.max(settle, contact), peakVelocity: Math.round(peakV * 100) / 100 };
}

/** Anchors of a profile-driven move. */
export function profileAnchors(prof: MotionProfile, fps: number, delay = 0, speed = 1): SoundAnchors {
  return anchorsOf((f) => principledProgress(prof, f, fps, delay, speed), fps, delay, speed);
}

/** Named presets the spec asks for, mapped onto the central physics (no scattered easing values). */
export const MOTION_PRESETS = ['premium', 'snappy', 'responsive', 'soft', 'heavy', 'playful', 'elastic', 'cinematic', 'mechanical', 'sport', 'corporate', 'tech'] as const;
export type MotionPresetId = (typeof MOTION_PRESETS)[number];
export const presetById = (id: MotionPresetId): PhysicsPreset => PHYSICS[id];
