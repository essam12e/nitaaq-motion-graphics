/**
 * Gesture + expression library for rigged characters (pure).
 * Gestures are defined by intent (where the hand goes / which way the arm
 * points), solved per rig with FK directions or two-bone IK, so the same
 * library works for any proportions. Expressions pick face-layer states by
 * name (FACE_STATES); missing states fall back to neutral — never invented.
 */
import type { Rig } from './schema';
import { armAngles, armChain, reachAngles, naturalReach, centreX, type ArmChain, type RigPoseInput, type Side } from './rig';
import { FACE_STATES } from './parts';
import type { Expression, Gesture } from './schema';

const part = (rig: Rig, kind: string) => rig.parts.find((p) => p.kind === kind);

/** Which side "toward" a screen direction is (for pointing at text on the left/right). */
export const sideToward = (dir: 'left' | 'right'): Side => (dir === 'left' ? 'L' : 'R');

export interface GestureOptions {
  /** Side that performs one-handed gestures (default: toward the target, else R). */
  side?: Side;
  /** Head tilt (deg, + = clockwise). */
  headTilt?: number;
  /** Pointing direction in degrees from straight down (85 = level, 130 = up toward a headline above). */
  aim?: number;
}

function keepUpright(rig: Rig, chain: ArmChain, a: Record<string, number>) {
  if (chain.hand) a[chain.hand.id] = -((a[chain.upper.id] ?? 0) + (chain.lower ? a[chain.lower.id] ?? 0 : 0));
}

function relaxed(rig: Rig, chain: ArmChain | null): Record<string, number> {
  return chain ? armAngles(rig, chain, { upper: 7, lower: 4 }) : {};
}

/** Rig-space targets the IK uses (chin, chest, belly) — derived from part boxes. */
export function bodyTargets(rig: Rig) {
  const head = part(rig, 'head')?.bbox;
  const torso = part(rig, 'torso')?.bbox;
  const cx = centreX(rig);
  const chin = head ? { x: cx, y: head.y + head.height * 0.98 } : { x: cx, y: rig.viewBox[1] + rig.viewBox[3] * 0.25 };
  const chest = torso ? { x: cx, y: torso.y + torso.height * 0.16 } : { x: cx, y: rig.viewBox[3] * 0.4 };
  const belly = torso ? { x: cx, y: torso.y + torso.height * 0.32 } : { x: cx, y: rig.viewBox[3] * 0.5 };
  const shoulderW = torso ? torso.width * 0.5 : rig.viewBox[2] * 0.2;
  return { chin, chest, belly, cx, shoulderW, headH: head?.height ?? rig.viewBox[3] * 0.15 };
}

/** Which hand (image side) holds the art's phone/prop, from the part hierarchy. */
export function propSide(rig: Rig): Side | null {
  const prop = rig.parts.find((p) => p.kind === 'prop' && Object.keys(p.states).some((s) => /phone|shown|on/.test(s))) ?? rig.parts.find((p) => p.kind === 'prop');
  let cur = prop?.parent;
  for (let i = 0; cur && i < 8; i++) {
    const p = rig.parts.find((x) => x.id === cur);
    if (!p) break;
    const m = /^(hand|lowerArm|upperArm|arm)([LR])$/.exec(p.kind);
    if (m) return m[2] as Side;
    cur = p.parent;
  }
  return null;
}

/** Joint angles for a gesture (arms only; head/torso added by the actor). */
export function gestureAngles(rig: Rig, g: Gesture, opts: GestureOptions = {}): { angles: Record<string, number>; states: Record<string, string>; scales: Record<string, { sx: number; sy: number }> } {
  const L = armChain(rig, 'L');
  const R = armChain(rig, 'R');
  // a held prop (phone) lives in one hand of the art: that hand performs prop gestures, whatever side was asked
  const propHand = g === 'hold_phone' ? propSide(rig) : null;
  const one = propHand ?? opts.side ?? 'R';
  const act = one === 'L' ? L : R;
  const other = one === 'L' ? R : L;
  const t = bodyTargets(rig);
  const out: Record<string, number> = {};
  const states: Record<string, string> = {};
  const scales: Record<string, { sx: number; sy: number }> = {};
  const reach = (c: ArmChain, tg: { x: number; y: number }, elbow = 14) => {
    const r = naturalReach(rig, c, tg, elbow);
    Object.assign(out, r.angles);
    Object.assign(scales, r.scales);
  };
  const handState = (c: ArmChain | null, s: string) => {
    if (c?.hand && Object.keys(c.hand.states).includes(s)) states[c.hand.id] = s;
  };
  const sgn = (c: ArmChain) => (c.side === 'L' ? -1 : 1);
  switch (g) {
    case 'none':
      Object.assign(out, relaxed(rig, L), relaxed(rig, R));
      break;
    case 'point':
      if (act) {
        const aim = opts.aim ?? 85;
        Object.assign(out, armAngles(rig, act, { upper: aim - 3, lower: aim + 3, hand: 0 }));
      }
      Object.assign(out, relaxed(rig, other));
      handState(act, 'point');
      break;
    case 'present':
      for (const c of [L, R]) if (c) Object.assign(out, armAngles(rig, c, { upper: 30, lower: 62, hand: 0 }));
      handState(L, 'open');
      handState(R, 'open');
      break;
    case 'explain':
      if (act) Object.assign(out, armAngles(rig, act, { upper: 22, lower: -38 }));
      Object.assign(out, relaxed(rig, other));
      handState(act, 'open');
      break;
    case 'celebrate':
      for (const c of [L, R]) if (c) Object.assign(out, armAngles(rig, c, { upper: 148, lower: 165 }));
      handState(L, 'fist');
      handState(R, 'fist');
      break;
    case 'wave':
      if (act) Object.assign(out, armAngles(rig, act, { upper: 118, lower: 170 }));
      Object.assign(out, relaxed(rig, other));
      handState(act, 'open');
      break;
    case 'thumbs_up':
      if (act) Object.assign(out, armAngles(rig, act, { upper: 18, lower: -95 }));
      Object.assign(out, relaxed(rig, other));
      handState(act, 'thumb');
      break;
    case 'shrug':
      for (const c of [L, R]) if (c) Object.assign(out, armAngles(rig, c, { upper: 22, lower: 64 }));
      handState(L, 'open');
      handState(R, 'open');
      break;
    case 'stop':
      if (act) reach(act, { x: t.cx + sgn(act) * t.shoulderW * 1.15, y: t.chin.y + t.headH * 0.1 }, 30);
      if (act) keepUpright(rig, act, out);
      Object.assign(out, relaxed(rig, other));
      handState(act, 'open');
      break;
    case 'hand_on_chin':
      if (act) reach(act, { x: t.chin.x + sgn(act) * t.headH * 0.05, y: t.chin.y + t.headH * 0.06 }, 10);
      if (act && act.hand) out[act.hand.id] = 0;
      Object.assign(out, relaxed(rig, other));
      handState(act, 'fist');
      break;
    case 'hold_phone':
      if (act) {
        reach(act, { x: t.cx + sgn(act) * t.shoulderW * 0.15, y: t.chest.y + t.headH * 0.12 }, 12);
        keepUpright(rig, act, out);
      }
      Object.assign(out, relaxed(rig, other));
      handState(act, 'hold');
      for (const p of rig.parts) if (p.kind === 'prop' && Object.keys(p.states).some((s) => /phone|shown|on/.test(s))) states[p.id] = Object.keys(p.states).find((s) => /phone|shown|on/.test(s))!;
      break;
    case 'type':
      for (const c of [L, R]) if (c) {
        reach(c, { x: t.cx + sgn(c) * t.shoulderW * 0.18, y: t.chest.y + t.headH * 0.3 }, 12);
        keepUpright(rig, c, out);
      }
      handState(L, 'hold');
      handState(R, 'hold');
      for (const p of rig.parts) if (p.kind === 'prop' && Object.keys(p.states).some((s) => /phone|shown|on/.test(s))) states[p.id] = Object.keys(p.states).find((s) => /phone|shown|on/.test(s))!;
      break;
    case 'hands_together':
      for (const c of [L, R]) if (c) {
        reach(c, { x: t.cx + sgn(c) * t.shoulderW * 0.06, y: t.belly.y }, 10);
        keepUpright(rig, c, out);
      }
      break;
  }
  return { angles: out, states, scales };
}

/** Face-layer states for an expression (only states the art actually has). */
export function expressionStates(rig: Rig, e: Expression, extra: { eyes?: string; mouth?: string } = {}): Record<string, string> {
  const want = FACE_STATES[e] ?? FACE_STATES.neutral;
  const out: Record<string, string> = {};
  for (const kind of ['eyes', 'eyebrows', 'mouth'] as const) {
    const p = part(rig, kind);
    if (!p) continue;
    const avail = Object.keys(p.states);
    const pref = kind === 'eyes' && extra.eyes ? [extra.eyes, ...want.eyes] : kind === 'mouth' && extra.mouth ? [extra.mouth, ...want.mouth] : want[kind];
    const hit = pref.find((s) => avail.includes(s)) ?? FACE_STATES.neutral[kind].find((s) => avail.includes(s));
    if (hit) out[p.id] = hit;
  }
  return out;
}

/** Which expressions the rig can really show (≥1 face state differs from neutral). */
export function availableExpressions(rig: Rig): Expression[] {
  const neutral = JSON.stringify(expressionStates(rig, 'neutral'));
  return (Object.keys(FACE_STATES) as Expression[]).filter((e) => e === 'neutral' || JSON.stringify(expressionStates(rig, e)) !== neutral);
}

export function rigPoseFor(rig: Rig, g: Gesture, e: Expression, opts: GestureOptions & { eyes?: string; mouth?: string } = {}): RigPoseInput {
  const { angles, states, scales } = gestureAngles(rig, g, opts);
  const head = part(rig, 'head');
  if (head && opts.headTilt) angles[head.id] = opts.headTilt;
  return { angles, scales, states: { ...states, ...expressionStates(rig, e, opts) } };
}
