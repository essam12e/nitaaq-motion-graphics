/**
 * Character Actor (pure, deterministic): HOW the character moves, frame by frame.
 *
 * The Director decided the intent of a shot; the Actor performs it with the
 * principles of character animation:
 *   - anticipation → action → overshoot → settle (closed-form damped spring)
 *   - overlapping action / drag: upper arm leads, forearm and hand follow late
 *   - secondary motion: breathing, weight-shift sway, head lag, headwear
 *     follow-through, blinks (rig), talking mouth (rig) or talk bounce (PNG)
 *   - idle presets (premium / casual / energetic / thinking / listening)
 *   - motion amount from the user (subtle / normal / exaggerated)
 *
 * The SAME curves give the sound anchors (start / peak velocity / contact /
 * settle / completion) of every character event, so a gesture's whoosh lands
 * on the frame the arm is fastest and a phone tap on the frame of contact.
 *
 * Units: body offsets are in head-heights (H) — the renderer multiplies by its
 * pixels-per-head — so the same performance works at any shot size.
 */
import { hashString } from '../core/rng';
import { rigPoseFor } from './gestures';
import type { RigPoseInput } from './rig';
import type { Rig } from './schema';
import type { CharacterShot, IdlePreset, MotionAmount, RigTarget } from './director';

export interface ActorCtx {
  shot: CharacterShot;
  fps: number;
  /** Shot length in frames. */
  frames: number;
  rig?: Rig | null;
  personality?: string;
  /** Speech in shot-local seconds (voice-led talking, level 2). */
  speech?: { start: number; end: number }[];
  /** Portrait: the character rises into frame instead of walking in from the side. */
  portrait?: boolean;
}

export interface ActorFrame {
  /** Whole-body offset (H), rotation (deg, about the feet), scale about the feet. */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  opacity: number;
  /** Rig pose for this frame (rig characters only). */
  rig?: RigPoseInput;
  /** 0..1 reaction pop (drives the overlay graphic). */
  react: number;
  /** 0..1 progress of the gesture toward the shot's pose. */
  gesture: number;
  /** Mouth openness 0..1 (rig: state swap; PNG: talk bounce). */
  mouth: number;
  blink: boolean;
  camera: { scale: number; x: number; y: number; rot: number };
}

// ───────────────────────────── curves ─────────────────────────────

/** Closed-form damped spring from 0 to 1 (ω rad/s, ζ damping ratio), t in seconds. */
export function springAt(t: number, omega: number, zeta: number): number {
  if (t <= 0) return 0;
  if (zeta >= 1) {
    const e = Math.exp(-omega * t);
    return 1 - e * (1 + omega * t);
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * omega * t);
  return 1 - e * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Feel {
  omega: number;
  zeta: number;
  /** Fraction of the move spent backwards before the action. */
  antic: number;
  anticSec: number;
  /** Displacement multiplier for idle / secondary motion. */
  amp: number;
}

const PERSONALITY_FEEL: Record<string, { omega: number; zeta: number; antic: number }> = {
  premium: { omega: 9, zeta: 0.92, antic: 0.05 },
  cinematic: { omega: 8, zeta: 0.9, antic: 0.05 },
  corporate: { omega: 10, zeta: 0.85, antic: 0.06 },
  tech: { omega: 14, zeta: 0.72, antic: 0.08 },
  energetic: { omega: 14, zeta: 0.55, antic: 0.12 },
  playful: { omega: 13, zeta: 0.45, antic: 0.14 },
  sport: { omega: 16, zeta: 0.6, antic: 0.1 },
};

export function feelFor(personality: string | undefined, amount: MotionAmount): Feel {
  const f = PERSONALITY_FEEL[personality ?? ''] ?? { omega: 12, zeta: 0.68, antic: 0.09 };
  if (amount === 'subtle') return { omega: f.omega * 0.9, zeta: Math.min(0.98, f.zeta + 0.12), antic: f.antic * 0.4, anticSec: 0.1, amp: 0.5 };
  if (amount === 'exaggerated') return { omega: f.omega * 1.08, zeta: Math.max(0.35, f.zeta - 0.15), antic: f.antic * 1.7, anticSec: 0.16, amp: 1.6 };
  return { ...f, anticSec: 0.13, amp: 1 };
}

/** Anticipation (a small move backwards) then a spring to 1. */
export function actionCurve(t: number, feel: Feel): number {
  if (t <= 0) return 0;
  if (t < feel.anticSec) return -feel.antic * Math.sin((Math.PI / 2) * (t / feel.anticSec));
  return -feel.antic + (1 + feel.antic) * springAt(t - feel.anticSec, feel.omega, feel.zeta);
}

/** Sound anchors (seconds from the curve start) measured on a sampled curve. */
export function curveAnchors(fn: (t: number) => number, fps: number, maxSec = 2): { start: number; peak: number; contact: number; settle: number; completion: number } {
  let peakV = 0;
  let peak = 0;
  let contact = -1;
  let settle = 0;
  let prev = fn(0);
  const n = Math.ceil(maxSec * fps);
  const vals: number[] = [prev];
  for (let f = 1; f <= n; f++) {
    const v = fn(f / fps);
    vals.push(v);
    const vel = Math.abs(v - prev);
    if (vel > peakV) {
      peakV = vel;
      peak = f;
    }
    if (contact < 0 && v >= 0.995) contact = f;
    prev = v;
  }
  for (let f = 0; f <= n; f++) if (Math.abs(vals[f] - 1) > 0.01) settle = f + 1;
  if (contact < 0 || contact > settle) contact = settle;
  const r = (f: number) => Math.round((f / fps) * 1000) / 1000;
  return { start: 0, peak: r(peak), contact: r(contact), settle: r(Math.min(settle, n)), completion: r(Math.min(n, Math.max(settle, contact) + 2)) };
}

// ───────────────────────────── timing ─────────────────────────────

export interface ShotTiming {
  /** Entrance (first shot): seconds of the walk/rise in. */
  enterSec: number;
  /** When the gesture toward the shot's pose starts (seconds). */
  gestureAt: number;
  /** When the head turns toward the text / prop. */
  noticeAt: number;
  /** Reaction pop (REACT phase), if any. */
  reactAt: number | null;
  /** Talking windows (seconds). */
  talk: { from: number; to: number }[];
  exitAt: number | null;
}

export function shotTiming(ctx: ActorCtx): ShotTiming {
  const s = ctx.shot;
  const dur = ctx.frames / ctx.fps;
  const at = (phase: string) => s.phases.find((p) => p.phase === phase);
  const enterSec = s.enter ? 0.75 : 0;
  const notice = at('NOTICE');
  const noticeAt = notice ? Math.max(enterSec * 0.8, notice.from * dur) : enterSec;
  // cut on action: a new pose starts moving AT the cut; otherwise after the notice beat
  const action = s.phases.find((p) => p.phase === 'PRESENT' || p.phase === 'REACT' || p.phase === 'THINK' || p.phase === 'TALK');
  const gestureAt = s.enter ? enterSec * 0.7 : s.cut.type === 'continuous' || s.cut.type === 'cut-on-action' ? 0.04 : Math.min(dur * 0.3, (action?.from ?? 0.1) * dur);
  const react = at('REACT');
  const reactAt = react ? Math.max(gestureAt + 0.25, react.from * dur) : null;
  const talk = s.talk > 0 ? s.phases.filter((p) => p.phase === 'TALK' || p.phase === 'PRESENT').map((p) => ({ from: Math.max(gestureAt + 0.2, p.from * dur), to: p.to * dur - 0.1 })).filter((w) => w.to - w.from > 0.3) : [];
  return { enterSec, gestureAt, noticeAt, reactAt, talk, exitAt: s.exit ? Math.max(0, dur - 0.6) : null };
}

// ───────────────────────────── idle / secondary ─────────────────────────────

const IDLE: Record<IdlePreset, { breath: number; breathAmp: number; sway: number; swayPeriod: number; bob: number; bobPeriod: number; headAmp: number; headPeriod: number; nod: number }> = {
  premium: { breath: 4.2, breathAmp: 0.005, sway: 0.35, swayPeriod: 6.5, bob: 0, bobPeriod: 3, headAmp: 0.8, headPeriod: 5.5, nod: 0 },
  casual: { breath: 3.6, breathAmp: 0.007, sway: 0.6, swayPeriod: 5.2, bob: 0.01, bobPeriod: 2.6, headAmp: 1.2, headPeriod: 4.4, nod: 0 },
  energetic: { breath: 2.8, breathAmp: 0.009, sway: 0.9, swayPeriod: 3.6, bob: 0.03, bobPeriod: 0.9, headAmp: 1.8, headPeriod: 2.8, nod: 0 },
  thinking: { breath: 4.4, breathAmp: 0.006, sway: 0.3, swayPeriod: 7, bob: 0, bobPeriod: 3, headAmp: 2.2, headPeriod: 6, nod: 0 },
  listening: { breath: 3.8, breathAmp: 0.006, sway: 0.4, swayPeriod: 6, bob: 0, bobPeriod: 3, headAmp: 0.8, headPeriod: 5, nod: 2.4 },
};

/** Blink times (seconds) for a shot — seeded, natural spacing, some double blinks. */
export function blinkTimes(seed: string, durSec: number, extra: number[] = []): number[] {
  let h = hashString(seed);
  const rnd = () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 4294967296;
  };
  const out: number[] = [...extra];
  let t = 0.6 + rnd() * 1.1;
  while (t < durSec - 0.2) {
    out.push(t);
    if (rnd() < 0.15) out.push(t + 0.24);
    t += 2.3 + rnd() * 2.4;
  }
  return out.sort((a, b) => a - b);
}

/** Syllable-like mouth rhythm (≈5.5 Hz) with short pauses between words. */
function mouthAt(t: number, line: string, w: { from: number; to: number }[], speech?: { start: number; end: number }[]): number {
  const inWin = w.some((x) => t >= x.from && t <= x.to);
  if (!inWin) return 0;
  if (speech && speech.length && !speech.some((s) => t >= s.start && t <= s.end)) return 0;
  const words = Math.max(1, line.split(/\s+/).length);
  const win = w.find((x) => t >= x.from && t <= x.to)!;
  const u = (t - win.from) / Math.max(0.3, win.to - win.from);
  const wordPos = (u * words) % 1;
  if (wordPos > 0.82) return 0; // gap between words
  const syl = Math.sin(t * Math.PI * 2 * 5.5 + hashString(line) % 7);
  return clamp(0.35 + syl * 0.65, 0, 1);
}

// ───────────────────────────── rig poses ─────────────────────────────

const poseCache = new WeakMap<Rig, Map<string, RigPoseInput>>();
export function rigTargetPose(rig: Rig, t: RigTarget | undefined): RigPoseInput {
  const key = JSON.stringify(t ?? null);
  let m = poseCache.get(rig);
  if (!m) poseCache.set(rig, (m = new Map()));
  let p = m.get(key);
  if (!p) {
    p = t ? rigPoseFor(rig, t.gesture, t.expression, { side: t.side, headTilt: t.headTilt, eyes: t.eyes, mouth: t.mouth, aim: t.aim }) : rigPoseFor(rig, 'none', 'neutral');
    m.set(key, p);
  }
  return p;
}

/** Overlapping action: how late each part follows the action (seconds). */
const DRAG: [RegExp, number][] = [
  [/^upperArm|^arm[LR]$/, 0],
  [/^lowerArm/, 0.05],
  [/^hand/, 0.09],
  [/^head$/, 0.07],
  [/^headwear$/, 0.12],
];
const dragOf = (kind: string) => DRAG.find(([re]) => re.test(kind))?.[1] ?? 0.03;

// ───────────────────────────── perform ─────────────────────────────

export function performFrame(ctx: ActorCtx, frame: number): ActorFrame {
  const s = ctx.shot;
  const t = frame / ctx.fps;
  const dur = ctx.frames / ctx.fps;
  const feel = feelFor(ctx.personality, s.motion);
  const tm = shotTiming(ctx);
  const idle = IDLE[s.idle];
  const amp = feel.amp;
  const dirOut = s.side === 'right' ? 1 : -1; // which frame edge the character came from

  // ── body: entrance / exit
  let x = 0;
  let y = 0;
  let opacity = 1;
  let sx = 1;
  let sy = 1;
  if (s.enter) {
    const e = actionCurve(t, { ...feel, antic: 0, anticSec: 0 });
    const p = clamp(e, -0.2, 1.2);
    if (ctx.portrait) y = (1 - p) * 2.4;
    else x = (1 - p) * 3.2 * dirOut;
    opacity = smooth(t / 0.22);
    // landing squash: a short compression at the contact frame, recovering
    const land = t - tm.enterSec * 0.55;
    if (land > 0 && land < 0.3) {
      const k = Math.sin((land / 0.3) * Math.PI) * 0.025 * amp;
      sy -= k;
      sx += k * 0.6;
    }
  }
  if (tm.exitAt !== null && t > tm.exitAt) {
    const p = smooth((t - tm.exitAt) / 0.6);
    x += p * 3.2 * dirOut;
    opacity *= 1 - smooth((t - tm.exitAt - 0.35) / 0.25);
  }

  // ── idle: breathing, weight shift, bob
  const phase = (hashString(s.id) % 100) / 100;
  const breath = Math.sin((t / idle.breath + phase) * Math.PI * 2);
  sy *= 1 + breath * idle.breathAmp * amp;
  let rot = Math.sin((t / idle.swayPeriod + phase) * Math.PI * 2) * idle.sway * amp * 0.5;
  y += idle.bob ? -Math.abs(Math.sin((t / idle.bobPeriod) * Math.PI)) * idle.bob * amp : 0;

  // ── gesture (PNG: the new pose settles in, carrying the motion across the cut)
  const g = t < tm.gestureAt ? 0 : actionCurve(t - tm.gestureAt, feel);
  if (!ctx.rig && !s.enter && s.cut.type !== 'match-cut') {
    const k = 1 - clamp(g, -0.3, 1.3);
    x += k * 0.12 * -dirOut * amp;
    rot += k * 1.4 * -dirOut * amp;
  }

  // ── reaction pop
  let react = 0;
  if (tm.reactAt !== null && t >= tm.reactAt) {
    const u = t - tm.reactAt;
    const pop = u < 0.5 ? Math.sin((u / 0.5) * Math.PI) * Math.exp(-u * 2) : 0;
    const k = s.intent.state === 'surprised' || s.intent.state === 'warning' ? 0.05 : 0.03;
    sy *= 1 + pop * k * amp;
    sx *= 1 - pop * k * 0.4 * amp;
    y -= pop * 0.08 * amp;
    react = clamp(u / 0.35, 0, 1);
  }

  // ── talking
  const mouth = s.lockFace ? 0 : mouthAt(t, s.line, tm.talk, ctx.speech);
  if (!ctx.rig && mouth > 0) y -= mouth * 0.012 * amp; // flat art cannot lip-sync: a small talk bounce instead

  // ── blink (rig only; also on head turns)
  const blinks = s.lockFace ? [] : blinkTimes(s.id, dur, [tm.noticeAt]);
  const blink = blinks.some((b) => t >= b && t < b + 0.12);

  // ── camera director
  const cam = { scale: 1, x: 0, y: 0, rot: 0 };
  const u = clamp(t / dur, 0, 1);
  const camAmp = s.motion === 'subtle' ? 0.5 : s.motion === 'exaggerated' ? 1.4 : 1;
  if (s.camera.move === 'push') cam.scale = 1 + 0.06 * smooth(u) * camAmp;
  else if (s.camera.move === 'pull') cam.scale = 1.06 - 0.06 * smooth(u) * camAmp;
  else if (s.camera.move === 'drift') cam.x = (u - 0.5) * 0.02 * -dirOut * camAmp;
  else if (s.camera.move === 'handheld') {
    cam.x = (Math.sin(t * 2.1 + phase * 6) * 0.6 + Math.sin(t * 3.7) * 0.4) * 0.004 * camAmp;
    cam.y = (Math.sin(t * 1.7 + 1) * 0.6 + Math.sin(t * 4.3) * 0.4) * 0.004 * camAmp;
    cam.rot = Math.sin(t * 1.3 + phase * 3) * 0.18 * camAmp;
  }
  if (s.cut.type === 'camera-assisted') cam.scale *= 1 + 0.05 * (1 - smooth(t / 0.55));

  const out: ActorFrame = { x, y, rot, sx, sy, opacity, react, gesture: clamp(g, -0.5, 1.5), mouth, blink, camera: cam };
  if (ctx.rig) out.rig = rigFrame(ctx, t, tm, feel, { mouth, blink, phase });
  return out;
}

function rigFrame(ctx: ActorCtx, t: number, tm: ShotTiming, feel: Feel, sec: { mouth: number; blink: boolean; phase: number }): RigPoseInput {
  const rig = ctx.rig!;
  const s = ctx.shot;
  const idle = IDLE[s.idle];
  const from = rigTargetPose(rig, s.enter ? undefined : s.prevRig ?? s.rig);
  const to = rigTargetPose(rig, s.rig);
  const angles: Record<string, number> = {};
  const scales: Record<string, { sx: number; sy: number }> = {};
  // limbs overshoot half as far as the curve (a 90° arm move must not swing 20° past its target)
  const curve = (lag: number) => {
    const v = t - tm.gestureAt - lag < 0 ? 0 : actionCurve(t - tm.gestureAt - lag, feel);
    return v > 1 ? 1 + (v - 1) * 0.5 : v;
  };
  const ids = new Set([...Object.keys(from.angles ?? {}), ...Object.keys(to.angles ?? {})]);
  const byId = new Map(rig.parts.map((p) => [p.id, p]));
  for (const id of ids) {
    const kind = byId.get(id)?.kind ?? '';
    angles[id] = lerp(from.angles?.[id] ?? 0, to.angles?.[id] ?? 0, curve(dragOf(kind)));
  }
  for (const id of new Set([...Object.keys(from.scales ?? {}), ...Object.keys(to.scales ?? {})])) {
    const a = from.scales?.[id] ?? { sx: 1, sy: 1 };
    const b = to.scales?.[id] ?? { sx: 1, sy: 1 };
    const k = clamp(curve(dragOf(byId.get(id)?.kind ?? '')), 0, 1);
    scales[id] = { sx: lerp(a.sx, b.sx, k), sy: lerp(a.sy, b.sy, k) };
  }
  // state swaps (hand shapes, props) at the middle of the move — pose-to-pose, never a morph
  const states: Record<string, string> = { ...(curve(0.05) >= 0.5 ? to.states : from.states) };
  // face: changes on the notice beat (the thought arrives before the gesture)
  if (!s.lockFace) {
    const faceFrom = from.states ?? {};
    const faceTo = to.states ?? {};
    for (const p of rig.parts) if (p.kind === 'eyes' || p.kind === 'eyebrows' || p.kind === 'mouth') {
      const v = t >= tm.noticeAt ? faceTo[p.id] : faceFrom[p.id];
      if (v) states[p.id] = v;
      else delete states[p.id];
    }
  } else for (const p of rig.parts) if (p.kind === 'eyes' || p.kind === 'eyebrows' || p.kind === 'mouth') delete states[p.id];

  const head = rig.parts.find((p) => p.kind === 'head');
  const torso = rig.parts.find((p) => p.kind === 'torso');
  // breathing on the torso; head lags the body sway (overlapping action), idle head drift, listening nods
  if (torso) {
    const b = Math.sin((t / idle.breath + sec.phase) * Math.PI * 2);
    scales[torso.id] = { sx: 1 + b * idle.breathAmp * 0.4 * feel.amp, sy: 1 + b * idle.breathAmp * feel.amp };
  }
  let headExtra = 0;
  if (head) {
    const sway = Math.sin(((t - 0.12) / idle.swayPeriod + sec.phase) * Math.PI * 2) * idle.sway * 0.6;
    const drift = Math.sin((t / idle.headPeriod + sec.phase * 2) * Math.PI * 2) * idle.headAmp * 0.5;
    const nod = idle.nod ? Math.max(0, Math.sin((t / 1.8) * Math.PI * 2)) * idle.nod : 0;
    // notice: a small turn toward the text / prop, eased
    const toward = s.textSide === 'left' ? -1 : s.textSide === 'right' ? 1 : 0;
    const notice = smooth((t - tm.noticeAt) / 0.35) * toward * 2.5 * (s.intent.gaze === 'camera' ? 0.3 : 1);
    headExtra = (sway + drift + nod + notice) * feel.amp;
    angles[head.id] = (angles[head.id] ?? 0) + headExtra;
  }
  // headwear follow-through: swings against the head's angular velocity, then settles (ghutra / shemagh)
  const hw = rig.parts.filter((p) => p.kind === 'headwear' || p.kind === 'hair');
  if (hw.length && head) {
    const dt = 1 / ctx.fps;
    const headAt = (tt: number) => {
      const g = tt - tm.gestureAt - dragOf('head') < 0 ? 0 : actionCurve(tt - tm.gestureAt - dragOf('head'), feel);
      return lerp(from.angles?.[head.id] ?? 0, to.angles?.[head.id] ?? 0, g) + Math.sin(((tt - 0.12) / idle.swayPeriod + sec.phase) * Math.PI * 2) * idle.sway * 0.6 * feel.amp;
    };
    let follow = 0;
    // damped response to the recent head velocity (last 0.4 s)
    for (let k = 1; k <= 12; k++) {
      const tt = t - k * dt;
      const v = (headAt(tt) - headAt(tt - dt)) / dt;
      follow += -v * Math.exp(-k * 0.28) * 0.012;
    }
    follow = clamp(follow * feel.amp, -4, 4);
    for (const p of hw) angles[p.id] = (angles[p.id] ?? 0) + follow;
  }
  // talking mouth and blinks (only states the art has)
  const mouthPart = rig.parts.find((p) => p.kind === 'mouth');
  if (mouthPart && sec.mouth > 0.5 && !s.lockFace) {
    const avail = Object.keys(mouthPart.states);
    const open = (s.expression === 'happy' || s.expression === 'excited') && avail.includes('open-smile') ? 'open-smile' : avail.includes('open') ? 'open' : avail.find((x) => /open|o$/.test(x));
    if (open) states[mouthPart.id] = open;
  }
  const eyes = rig.parts.find((p) => p.kind === 'eyes');
  if (eyes && sec.blink && 'closed' in eyes.states) states[eyes.id] = 'closed';
  return { angles, scales, states };
}

// ───────────────────────────── sound anchors ─────────────────────────────

export type CharacterEventType = 'character_enter' | 'head_turn' | 'phone_pickup' | 'phone_tap' | 'gesture_peak' | 'point' | 'reaction' | 'object_land' | 'character_exit';

export interface CharacterEvent {
  type: CharacterEventType;
  /** Shot-local seconds of each anchor (exact, from the Actor's own curves). */
  anchors: { start: number; peak: number; contact: number; settle: number; completion: number };
  importance: number;
  direction?: 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'none';
}

/** Every character event of a shot with exact anchors (what the Sound Director syncs to). */
export function shotEvents(ctx: ActorCtx): CharacterEvent[] {
  const s = ctx.shot;
  const fps = ctx.fps;
  const dur = ctx.frames / fps;
  const feel = feelFor(ctx.personality, s.motion);
  const tm = shotTiming(ctx);
  const out: CharacterEvent[] = [];
  const shift = (a: CharacterEvent['anchors'], by: number) => ({ start: r3(a.start + by), peak: r3(a.peak + by), contact: r3(a.contact + by), settle: r3(a.settle + by), completion: r3(a.completion + by) });
  const inShot = (e: CharacterEvent) => e.anchors.start < dur - 0.1;
  const dirIn: CharacterEvent['direction'] = ctx.portrait ? 'up' : s.side === 'right' ? 'left' : 'right';
  if (s.enter) out.push({ type: 'character_enter', anchors: curveAnchors((t) => actionCurve(t, { ...feel, antic: 0, anticSec: 0 }), fps), importance: 0.55, direction: dirIn });
  const act = curveAnchors((t) => actionCurve(t, feel), fps);
  const moved = Boolean(ctx.rig) || (!s.enter && s.cut.type !== 'match-cut');
  if (moved && s.rig?.gesture !== 'none' && s.intent.gesture !== 'none') {
    const g = s.rig?.gesture ?? s.intent.gesture;
    const base = shift(act, tm.gestureAt);
    const imp = ctx.rig ? 0.45 : 0.3;
    if (g === 'point') out.push({ type: 'point', anchors: base, importance: 0.55, direction: s.textSide === 'left' ? 'left' : 'right' });
    else if (g === 'hold_phone') out.push({ type: 'phone_pickup', anchors: base, importance: 0.45 });
    else out.push({ type: 'gesture_peak', anchors: base, importance: g === 'celebrate' ? 0.65 : imp, direction: g === 'celebrate' ? 'up' : 'none' });
  }
  if (ctx.rig && !s.lockFace && Math.abs(tm.noticeAt - tm.gestureAt) > 0.25 && s.intent.gaze !== 'camera') {
    const a = curveAnchors((t) => smooth(t / 0.35), fps, 0.6);
    out.push({ type: 'head_turn', anchors: shift(a, tm.noticeAt), importance: 0.15, direction: s.textSide === 'left' ? 'left' : 'right' });
  }
  if (tm.reactAt !== null) {
    const a = { start: 0, peak: 0.12, contact: 0.18, settle: 0.5, completion: 0.6 };
    out.push({ type: 'reaction', anchors: shift(a, tm.reactAt), importance: s.intent.state === 'surprised' || s.intent.state === 'warning' ? 0.65 : 0.4 });
  }
  if (s.rig?.gesture === 'type' || s.intent.gesture === 'type') {
    const from = tm.gestureAt + act.settle;
    for (let k = 0; k < 4; k++) {
      const at = from + 0.3 + k * 0.32;
      out.push({ type: 'phone_tap', anchors: { start: r3(at), peak: r3(at + 0.05), contact: r3(at + 0.07), settle: r3(at + 0.15), completion: r3(at + 0.2) }, importance: 0.2 });
    }
  }
  if (tm.exitAt !== null) out.push({ type: 'character_exit', anchors: shift(curveAnchors((t) => smooth(t / 0.6), fps, 0.8), tm.exitAt), importance: 0.4, direction: s.side === 'right' ? 'right' : 'left' });
  return out.filter(inShot);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
