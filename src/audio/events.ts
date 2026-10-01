/**
 * Motion Event Detector — what happens on screen, when, and how it moves.
 *
 * Scenes declare semantic motion events (`manifest.events(content, variant)`):
 * a product enters, a word slams, a button is pressed, a counter lands. Each
 * event carries metadata (element kind, apparent size/mass, direction,
 * distance, importance). The detector resolves every event against the
 * Animation Principles Engine to get its SOUND ANCHORS — the frames where the
 * motion starts, peaks in velocity, makes contact, settles and completes — so
 * the Sound Director syncs sound to the real motion, never to scene start by
 * default.
 *
 * Families that predate events are mapped from their legacy SFX suggestions
 * (category → semantic event) using the scene's category, so every scene
 * exposes events. Transitions add `scene_transition` events at their visual peak.
 * Pure and deterministic.
 */
import type { ElementKind } from '../motion/physics';
import { motionProfile, profileAnchors, type SoundAnchors } from '../motion/principles';
import type { MotionPersonalityId } from '../motion/personality';

export const MOTION_EVENT_TYPES = [
  'scene_start',
  'headline_reveal',
  'word_impact',
  'text_reveal',
  'product_entry',
  'product_peak_velocity',
  'product_land',
  'button_press',
  'success_state',
  'error_state',
  'warning_state',
  'notification',
  'ui_appear',
  'card_entry',
  'swipe',
  'typing',
  'chart_grow',
  'chart_peak',
  'counter_tick',
  'counter_final',
  'price_reveal',
  'logo_reveal',
  'cta_reveal',
  'scene_transition',
  'draw_stroke',
  'map_route',
  'map_pin',
  'camera_move',
  'hero_reveal',
  'tease',
] as const;
export type MotionEventType = (typeof MOTION_EVENT_TYPES)[number];

export type AnchorName = 'start' | 'peak' | 'contact' | 'settle' | 'completion';

/** What a scene declares (scene-local seconds). */
export interface MotionEventDecl {
  type: MotionEventType;
  /** Seconds after scene start where the motion BEGINS (anchors are derived from it). */
  at: number;
  element?: ElementKind;
  /** On-screen area as a fraction of the canvas (drives apparent mass). */
  area?: number;
  /** 0..1 how much the moment matters to the story. */
  importance?: number;
  direction?: 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'none';
  /** Travel distance as a fraction of the canvas short edge. */
  distance?: number;
  /** Force a specific anchor instead of the semantic default. */
  anchor?: AnchorName;
  /** Repeating events (counter ticks, typing) every `every` s, `count` times. */
  repeat?: { count: number; every: number };
}

/** A resolved event on the film timeline. */
export interface MotionEvent extends Required<Pick<MotionEventDecl, 'type' | 'at' | 'importance'>> {
  sceneId: string;
  sceneIndex: number;
  element: ElementKind;
  /** Absolute seconds of the motion start. */
  startSec: number;
  anchors: { start: number; peak: number; contact: number; settle: number; completion: number };
  /** Anchor the sound belongs on (semantic default or declared). */
  anchor: AnchorName;
  /** Absolute seconds of that anchor. */
  syncSec: number;
  mass: string;
  speed: number;
  distance: number;
  direction: NonNullable<MotionEventDecl['direction']>;
  /** 0..1 strength of the physical hit (mass × speed). */
  impact: number;
  /** 0..1 scene energy at that moment. */
  sceneEnergy: number;
  /** Filled for scene_transition events. */
  transition?: string;
}

/** Default anchor per semantic event: where a professional would put the sound. */
export const DEFAULT_ANCHOR: Record<MotionEventType, AnchorName> = {
  scene_start: 'start',
  headline_reveal: 'peak',
  word_impact: 'contact',
  text_reveal: 'peak',
  product_entry: 'peak',
  product_peak_velocity: 'peak',
  product_land: 'contact',
  button_press: 'contact',
  success_state: 'contact',
  error_state: 'contact',
  warning_state: 'contact',
  notification: 'contact',
  ui_appear: 'peak',
  card_entry: 'peak',
  swipe: 'peak',
  typing: 'start',
  chart_grow: 'start',
  chart_peak: 'completion',
  counter_tick: 'start',
  counter_final: 'completion',
  price_reveal: 'contact',
  logo_reveal: 'settle',
  cta_reveal: 'contact',
  scene_transition: 'peak',
  draw_stroke: 'start',
  map_route: 'start',
  map_pin: 'contact',
  camera_move: 'peak',
  hero_reveal: 'contact',
  tease: 'start',
};

const DEFAULT_ELEMENT: Partial<Record<MotionEventType, ElementKind>> = {
  headline_reveal: 'hero-title',
  word_impact: 'hero-title',
  text_reveal: 'text',
  product_entry: 'product',
  product_peak_velocity: 'product',
  product_land: 'product',
  button_press: 'button',
  success_state: 'icon',
  error_state: 'icon',
  warning_state: 'icon',
  notification: 'notification',
  ui_appear: 'panel',
  card_entry: 'card',
  swipe: 'card',
  chart_grow: 'chart',
  chart_peak: 'chart',
  counter_tick: 'number',
  counter_final: 'number',
  price_reveal: 'number',
  logo_reveal: 'logo',
  cta_reveal: 'button',
  scene_transition: 'transition',
  camera_move: 'camera',
  hero_reveal: 'product',
  map_pin: 'icon',
  map_route: 'chart',
  draw_stroke: 'chart',
};

const DEFAULT_IMPORTANCE: Partial<Record<MotionEventType, number>> = {
  logo_reveal: 0.95,
  hero_reveal: 0.95,
  cta_reveal: 0.85,
  product_land: 0.85,
  product_entry: 0.75,
  word_impact: 0.8,
  success_state: 0.8,
  error_state: 0.75,
  price_reveal: 0.8,
  counter_final: 0.75,
  chart_peak: 0.7,
  button_press: 0.65,
  headline_reveal: 0.6,
  scene_transition: 0.5,
  notification: 0.55,
  map_pin: 0.6,
  map_route: 0.5,
  tease: 0.55,
  card_entry: 0.35,
  ui_appear: 0.4,
  text_reveal: 0.3,
  counter_tick: 0.15,
  typing: 0.2,
  draw_stroke: 0.3,
  swipe: 0.35,
  chart_grow: 0.35,
  camera_move: 0.3,
  scene_start: 0.2,
  warning_state: 0.65,
  product_peak_velocity: 0.6,
};

/** Legacy SFX category → semantic event, given the scene category. */
export function legacyEvent(category: string, sceneCategory: string): MotionEventType {
  switch (category) {
    case 'impact':
      return sceneCategory === 'commerce' ? 'product_land' : sceneCategory === 'brand' ? 'logo_reveal' : sceneCategory === 'cta' ? 'cta_reveal' : 'word_impact';
    case 'whoosh':
    case 'transition':
      return sceneCategory === 'commerce' ? 'product_entry' : sceneCategory === 'brand' ? 'logo_reveal' : 'headline_reveal';
    case 'sweep':
      return sceneCategory === 'brand' ? 'logo_reveal' : 'text_reveal';
    case 'click':
      return 'button_press';
    case 'pop':
      return sceneCategory === 'social' || sceneCategory === 'mobile' ? 'notification' : 'card_entry';
    case 'tick':
      return sceneCategory === 'data' ? 'counter_tick' : 'ui_appear';
    case 'success':
      return 'success_state';
    case 'notification':
      return 'notification';
    case 'typing':
      return 'typing';
    case 'riser':
      return 'tease';
    case 'glitch':
      return 'text_reveal';
    case 'shutter':
      return 'ui_appear';
    case 'cinematic':
      return 'hero_reveal';
    default:
      return 'ui_appear';
  }
}

export interface SceneEventSource {
  id: string;
  index: number;
  startSec: number;
  durationSec: number;
  speed: number;
  energy: number;
  category: string;
  decls: MotionEventDecl[];
}

/** Resolve declared events to absolute times + sound anchors. */
export function detectEvents(scenes: SceneEventSource[], personality: MotionPersonalityId | undefined, fps = 30): MotionEvent[] {
  const out: MotionEvent[] = [];
  const anchorCache = new Map<string, SoundAnchors>();
  for (const s of scenes) {
    for (const d of s.decls) {
      const element = d.element ?? DEFAULT_ELEMENT[d.type] ?? 'card';
      const area = d.area ?? (element === 'product' || element === 'device' || element === 'dashboard' ? 0.25 : element === 'hero-title' || element === 'logo' ? 0.12 : 0.03);
      const prof = motionProfile(personality, element, area);
      const key = `${prof.preset.id}|${prof.anticipation}|${prof.timeScale}|${s.speed}`;
      let a = anchorCache.get(key);
      if (!a) {
        a = profileAnchors(prof, fps, 0, s.speed);
        anchorCache.set(key, a);
      }
      const reps = d.repeat ? Math.max(1, Math.min(40, d.repeat.count)) : 1;
      for (let r = 0; r < reps; r++) {
        const local = d.at / s.speed + (d.repeat ? (r * d.repeat.every) / s.speed : 0);
        if (local > s.durationSec - 0.05) break;
        const startSec = s.startSec + local;
        const toSec = (f: number) => startSec + f / fps;
        const anchors = { start: startSec, peak: toSec(a.peakVelocityFrame), contact: toSec(a.contactFrame), settle: toSec(a.settleFrame), completion: toSec(a.completionFrame) };
        const anchor = d.anchor ?? DEFAULT_ANCHOR[d.type];
        const speed = a.peakVelocity;
        const massK = { feather: 0.15, light: 0.3, medium: 0.5, heavy: 0.75, massive: 0.95 }[prof.mass] ?? 0.5;
        out.push({
          type: d.type,
          at: local,
          importance: d.importance ?? DEFAULT_IMPORTANCE[d.type] ?? 0.4,
          sceneId: s.id,
          sceneIndex: s.index,
          element,
          startSec,
          anchors,
          anchor,
          syncSec: Math.round(anchors[anchor] * 1000) / 1000,
          mass: prof.mass,
          speed,
          distance: d.distance ?? 0.2,
          direction: d.direction ?? 'none',
          impact: Math.round(Math.min(1, massK * 0.6 + Math.min(1, speed / 8) * 0.4) * 100) / 100,
          sceneEnergy: s.energy,
        });
      }
    }
  }
  return out.sort((x, y) => x.syncSec - y.syncSec);
}
