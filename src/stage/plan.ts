/**
 * Stage plan (P1-A): the compiled, render-ready form of a Stage — written to stage.json and carried
 * in the VideoSpec (`spec.stage`). It is what draws the film: the StageLayer renders every global
 * element and the camera ONLY from this plan (elements + one choreography in film seconds), so
 * editing stage.json changes the picture.
 *
 *   shots.json ─► Stage Compiler ─► stage.json ─► StageLayer (render)
 *                                   (elements, tracks, camera track, masks, handoffs, transitions)
 */
import type { ChoreoSpec } from '../motion/choreography';
import type { StageKind } from '../director/shot-script';
import type { CompositionReport } from './composition';

/** Choreography target for a stage element id ("dashboard.main" → "e_dashboard_main"). */
export const keyOf = (id: string) => `e_${id.replace(/[.\-]/g, '_')}`;
export const CAMERA_KEY = 'camera';

/** Depth (fraction of the perspective distance) of each layer. Hero = 0 keeps authored layout exact. */
export const LAYER_DEPTH = { fg: -0.14, mg: -0.06, hero: 0, bg: 0.45 } as const;
export type StageLayerName = keyof typeof LAYER_DEPTH;

export interface FracRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageElement {
  id: string;
  key: string;
  kind: StageKind;
  layer: StageLayerName;
  /** Stacking order (higher = in front). */
  z: number;
  /** Base box size: fractions of the canvas (children: of the parent box). Tracks scale it. */
  box: { w: number; h: number };
  parent?: string;
  content: {
    text?: string;
    highlight?: string[];
    role?: string;
    asset?: string;
    icon?: string;
    title?: string;
    subtitle?: string;
    shape?: string;
    color?: string;
    url?: string;
    value?: number;
    prefix?: string;
    suffix?: string;
    points?: [number, number][];
    illustrative?: boolean;
    /** Font size (u) the composition chose for the box (text). */
    fontU?: number;
    maxLines?: number;
  };
  /** Film seconds the element is drawn (entrance start → exit end). */
  life: { from: number; to: number };
  /** Text: when each word appears (seconds after life.from) — from the voice map when there is one. */
  wordTimes?: number[];
  /** Text: emphasised words and when (seconds after life.from). */
  emphasis?: { word: string; at: number; source: string }[];
  /** Shapes the `morph` track moves through (index 0 = the element's own shape). */
  morphShapes?: string[];
  /** Named regions (fractions of the box) — camera and transition targets. */
  anchors?: Record<string, FracRect>;
  /** Shot ids the element is on stage in. */
  shots: string[];
}

export interface StageHandoff {
  from: string;
  to: string;
  /** Film seconds of the hand-over (the source's peak). */
  t: number;
  vector: [number, number];
  velocity: number;
  momentum: number;
  kind: 'exit-enter' | 'attract' | 'push' | 'impact' | 'camera';
  reason?: string;
}

export interface StageTransition {
  from: string;
  to: string;
  requested: string;
  /** object = the element performs it; fallback = an existing scene transition (reported). */
  status: 'object' | 'fallback' | 'legacy';
  kind: string;
  element?: string;
  into?: string;
  t0: number;
  t1: number;
  reason: string;
  why?: string;
}

export interface StageMask {
  /** Text element whose glyphs are the window. */
  element: string;
  from: number;
  to: number;
  /** Elements drawn inside the text during the window. */
  reveals: string[];
  /** World colour seen through the text. */
  color?: string;
}

export interface ShotCamera {
  move: string;
  target?: string;
  reason?: string;
  effect?: string;
  t0: number;
  t1: number;
  /** Analytic visible effect on the target: screen-size ratio end/start and centre shift (frame fractions). */
  visible?: { scale: number; shift: number; bgScale: number };
}

export interface StageShot {
  id: string;
  start: number;
  end: number;
  region?: string;
  camera: ShotCamera;
  composition: CompositionReport;
  cast: { id: string; role: string }[];
  /** P2: the shot's narrative job and planned energy (0..1) — the Visual Critic judges in that context. */
  purpose?: string;
  metaphor?: string;
  energy?: number;
}

export interface StagePlan {
  version: 1;
  W: number;
  H: number;
  rtl: boolean;
  world: { color?: string };
  elements: StageElement[];
  /** One choreography for the whole film (seconds): element tracks + the camera track. */
  choreo: ChoreoSpec;
  masks: StageMask[];
  shots: StageShot[];
  handoffs: StageHandoff[];
  transitions: StageTransition[];
  ending?: { settleAt: number; holdSec: number; maxSec: number; reason: string };
  /** Style Library v2: the render look and the Native Style Moments (film seconds). Absent → the P4.5 look. */
  style?: StageStyle;
}

export interface StageStyleMoment {
  id: string;
  builder: string;
  shot: string;
  element?: string;
  into?: string;
  at: 'start' | 'settle' | 'end';
  dur: number;
  t0: number;
  t1: number;
}

export interface StageStyle {
  id: string;
  look: Record<string, unknown>;
  moments: StageStyleMoment[];
  identity: string[];
}
