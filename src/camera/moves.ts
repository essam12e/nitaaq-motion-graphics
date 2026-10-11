/**
 * Camera moves and path planning (Camera Engine 2.0).
 *
 * A scene's camera is a small, editable plan (`scene.motion.cameraPlan`):
 * a named move, an amplitude, the subject it serves (focus point), optional
 * waypoints (path planning between subjects) and beat accents. The state at
 * any time is a pure function of the plan — deterministic seek.
 *
 * Moves are cinematographic, not decorative: push-in toward the subject, a
 * truck that reveals real parallax, an orbit around the hero plane, a crane
 * rising into the reveal. Amplitudes are deliberately small; the framing solver
 * (framing.ts) reduces them further when they would endanger text, product or
 * logo framing.
 */
import { curve, RATE } from '../motion/easing';
import { springAt } from '../motion/spring';
import { REST, type CameraState } from './rig';

export const CAMERA_MOVES = [
  'static',
  'drift',
  'push-in',
  'pull-out',
  'dolly-in',
  'dolly-out',
  'truck-left',
  'truck-right',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'pedestal-up',
  'pedestal-down',
  'orbit-left',
  'orbit-right',
  'arc',
  'crane-up',
  'zoom-in',
  'zoom-out',
  'rack-focus',
  'track',
] as const;
export type CameraMoveId = (typeof CAMERA_MOVES)[number];

export interface CameraWaypoint {
  /** Scene-local seconds. */
  t: number;
  /** Subject to frame (fraction of the canvas). */
  focus: { x: number; y: number };
  /** Framing tightness (1 = rest framing, 1.1 = 10% closer). */
  close?: number;
}

export interface CameraPlan {
  move: CameraMoveId;
  /** 0..1.5 strength. The framing solver lowers it when framing would break. */
  amplitude: number;
  /** Fraction of the scene the move occupies. */
  start?: number;
  end?: number;
  /** Subject the move serves (fraction of the canvas, default centre). */
  focus?: { x: number; y: number };
  /** Named curve from motion/easing CURVES. */
  ease?: string;
  /** Beat accents (scene-local seconds): a tiny physical push on each. */
  accents?: number[];
  /** Path planning: subjects to visit (track move). */
  waypoints?: CameraWaypoint[];
  /** Depth of field on (rack focus / product hero). */
  dof?: boolean;
  /** Why this move (motion_spec / review). Not rendered. */
  reason?: string;
}

export interface MoveCtx {
  W: number;
  H: number;
  durationSec: number;
}

type Channel = Partial<CameraState>;

/** Move shapes on eased progress u (0..1) with amplitude a. */
const SHAPES: Record<CameraMoveId, (u: number, a: number, c: MoveCtx, f: { x: number; y: number }) => Channel> = {
  static: () => ({}),
  drift: (u, a, c) => ({ x: Math.sin(u * Math.PI) * 0.01 * c.W * a, y: (0.5 - u) * 0.008 * c.H * a, dolly: 0.015 * u * a }),
  'push-in': (u, a, c, f) => ({ dolly: 0.075 * a * u, x: (f.x - 0.5) * c.W * 0.1 * a * u, y: (f.y - 0.5) * c.H * 0.1 * a * u }),
  'pull-out': (u, a, c, f) => ({ dolly: 0.075 * a * (1 - u), x: (f.x - 0.5) * c.W * 0.1 * a * (1 - u), y: (f.y - 0.5) * c.H * 0.1 * a * (1 - u) }),
  'dolly-in': (u, a) => ({ dolly: 0.12 * a * u }),
  'dolly-out': (u, a) => ({ dolly: 0.12 * a * (1 - u) }),
  'truck-left': (u, a, c) => ({ x: -(u - 0.5) * 0.07 * c.W * a }),
  'truck-right': (u, a, c) => ({ x: (u - 0.5) * 0.07 * c.W * a }),
  'pan-left': (u, a, c) => ({ yaw: (u - 0.5) * 5 * a, x: -(u - 0.5) * 0.015 * c.W * a }),
  'pan-right': (u, a, c) => ({ yaw: -(u - 0.5) * 5 * a, x: (u - 0.5) * 0.015 * c.W * a }),
  'tilt-up': (u, a) => ({ tilt: (u - 0.5) * 4 * a }),
  'tilt-down': (u, a) => ({ tilt: -(u - 0.5) * 4 * a }),
  'pedestal-up': (u, a, c) => ({ y: -(u - 0.5) * 0.05 * c.H * a }),
  'pedestal-down': (u, a, c) => ({ y: (u - 0.5) * 0.05 * c.H * a }),
  'orbit-left': (u, a) => ({ yaw: (u - 0.5) * 10 * a, dolly: 0.02 * a }),
  'orbit-right': (u, a) => ({ yaw: -(u - 0.5) * 10 * a, dolly: 0.02 * a }),
  arc: (u, a) => ({ yaw: (u - 0.5) * 8 * a, dolly: 0.05 * a * u }),
  'crane-up': (u, a, c) => ({ y: (0.5 - u) * 0.06 * c.H * a, tilt: (0.5 - u) * 3 * a, dolly: 0.03 * a * u }),
  'zoom-in': (u, a) => ({ zoom: 1 + 0.07 * a * u }),
  'zoom-out': (u, a) => ({ zoom: 1 + 0.07 * a * (1 - u) }),
  'rack-focus': (u, a) => ({ focus: -0.32 + 0.32 * u, aperture: 0.6 * a, dolly: 0.02 * a * u }),
  track: () => ({}),
};

const add = (base: CameraState, ch: Channel): CameraState => ({
  x: base.x + (ch.x ?? 0),
  y: base.y + (ch.y ?? 0),
  dolly: base.dolly + (ch.dolly ?? 0),
  zoom: base.zoom * (ch.zoom ?? 1),
  tilt: base.tilt + (ch.tilt ?? 0),
  yaw: base.yaw + (ch.yaw ?? 0),
  roll: base.roll + (ch.roll ?? 0),
  focus: ch.focus ?? base.focus,
  aperture: Math.max(base.aperture, ch.aperture ?? 0),
});

/** Path planning: smooth Catmull-Rom path through the waypoints, eased between them. */
function trackState(plan: CameraPlan, t: number, c: MoveCtx): Channel {
  const wps = [...(plan.waypoints ?? [])].sort((a, b) => a.t - b.t);
  if (!wps.length) return {};
  const pts = wps.map((w) => ({ x: (w.focus.x - 0.5) * c.W * 0.14 * plan.amplitude, y: (w.focus.y - 0.5) * c.H * 0.14 * plan.amplitude, d: ((w.close ?? 1) - 1) * 0.9 * plan.amplitude }));
  if (t <= wps[0].t) return { x: pts[0].x, y: pts[0].y, dolly: pts[0].d };
  const last = wps.length - 1;
  if (t >= wps[last].t) return { x: pts[last].x, y: pts[last].y, dolly: pts[last].d };
  let i = 0;
  while (i < last && t > wps[i + 1].t) i++;
  const span = Math.max(1e-3, wps[i + 1].t - wps[i].t);
  const u = curve(plan.ease ?? 'camera-dolly')((t - wps[i].t) / span);
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(last, i + 2)];
  const cr = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u * u * u);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), dolly: Math.max(0, cr(p0.d, p1.d, p2.d, p3.d)) };
}

/** Camera state of a plan at scene-local time t (seconds). Pure. */
export function cameraAt(plan: CameraPlan | undefined, t: number, c: MoveCtx): CameraState {
  if (!plan || plan.move === 'static' || plan.amplitude <= 0) return { ...REST };
  const f = plan.focus ?? { x: 0.5, y: 0.5 };
  let state: CameraState;
  if (plan.move === 'track') state = add(REST, trackState(plan, t, c));
  else {
    const s0 = (plan.start ?? 0) * c.durationSec;
    const s1 = Math.max(s0 + 0.1, (plan.end ?? 1) * c.durationSec);
    const raw = Math.min(1, Math.max(0, (t - s0) / (s1 - s0)));
    const u = plan.ease ? curve(plan.ease)(raw) : RATE.smooth(raw);
    state = add(REST, SHAPES[plan.move](u, plan.amplitude, c, f));
  }
  // beat accents: a short physical push that settles by itself (spring from rest with a kick)
  for (const a of plan.accents ?? []) {
    if (t < a || t > a + 1.2) continue;
    const kick = springAt(t - a, 0, 0, { stiffness: 260, damping: 18, mass: 1, velocity: 0.22 * Math.min(1, plan.amplitude) });
    state = { ...state, dolly: state.dolly + kick.value };
  }
  return state;
}

/** Peak camera speed over the plan (hero-plane px/s) — used for readability checks. */
export function peakSpeed(plan: CameraPlan | undefined, c: MoveCtx, D: number, samples = 48): number {
  if (!plan) return 0;
  let peak = 0;
  let prev = cameraAt(plan, 0, c);
  const dt = c.durationSec / samples;
  for (let i = 1; i <= samples; i++) {
    const s = cameraAt(plan, i * dt, c);
    const dx = s.x - prev.x;
    const dy = s.y - prev.y;
    const dz = (s.dolly - prev.dolly) * D * 0.35 + (s.zoom - prev.zoom) * c.W * 0.5;
    const dr = (Math.abs(s.yaw - prev.yaw) + Math.abs(s.tilt - prev.tilt)) * (D * Math.PI) / 180;
    peak = Math.max(peak, Math.hypot(dx, dy, dz, dr) / dt);
    prev = s;
  }
  return peak;
}

/** Legacy `motion.camera` names → Camera Engine 2.0 moves (old video.json keeps working). */
export const LEGACY_MOVE: Record<string, CameraMoveId> = {
  none: 'static',
  push: 'push-in',
  pull: 'pull-out',
  'pan-left': 'truck-left',
  'pan-right': 'truck-right',
  rise: 'pedestal-up',
  fall: 'pedestal-down',
  tilt: 'tilt-up',
  drift: 'drift',
  orbit: 'orbit-left',
};
