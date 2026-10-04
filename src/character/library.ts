/**
 * Pose Library (pure): semantic index over a character's poses, the standard
 * pose set a rig can perform, complexity classification and the missing-pose
 * strategy.
 */
import type { CharacterManifest, Complexity, Expression, Gesture, Pose, PoseLibrary, PoseState } from './schema';
import { POSE_STATES } from './schema';

/** Poses a layered rig performs out of the box (gesture × expression), when the art supports them. */
export const RIG_POSE_SET: { poseId: string; state: PoseState; gesture: Gesture; expression: Expression; side?: 'L' | 'R'; headTilt?: number; eyes?: string; mouth?: string; needsProp?: boolean }[] = [
  { poseId: 'neutral', state: 'neutral', gesture: 'none', expression: 'neutral' },
  { poseId: 'happy', state: 'happy', gesture: 'hands_together', expression: 'happy' },
  { poseId: 'surprised', state: 'surprised', gesture: 'stop', expression: 'surprised', side: 'L' },
  { poseId: 'confused', state: 'confused', gesture: 'shrug', expression: 'confused', headTilt: -7 },
  { poseId: 'questioning', state: 'questioning', gesture: 'shrug', expression: 'skeptical', headTilt: 6 },
  { poseId: 'thinking', state: 'thinking', gesture: 'hand_on_chin', expression: 'thinking', side: 'R', headTilt: 5 },
  { poseId: 'talking', state: 'talking', gesture: 'explain', expression: 'happy', side: 'R', mouth: 'open' },
  { poseId: 'explaining', state: 'explaining', gesture: 'explain', expression: 'neutral', side: 'L' },
  { poseId: 'pointing-left', state: 'pointing', gesture: 'point', expression: 'happy', side: 'L' },
  { poseId: 'pointing-right', state: 'pointing', gesture: 'point', expression: 'happy', side: 'R' },
  { poseId: 'presenting', state: 'presenting', gesture: 'present', expression: 'happy', mouth: 'open-smile' },
  { poseId: 'holding-phone', state: 'holding_phone', gesture: 'hold_phone', expression: 'happy', side: 'R', needsProp: true },
  { poseId: 'looking-phone', state: 'looking_phone', gesture: 'hold_phone', expression: 'focused', side: 'R', headTilt: 4, eyes: 'down', needsProp: true },
  { poseId: 'typing', state: 'typing', gesture: 'type', expression: 'focused', headTilt: 3, eyes: 'down', needsProp: true },
  { poseId: 'excited', state: 'excited', gesture: 'celebrate', expression: 'excited' },
  { poseId: 'listening', state: 'listening', gesture: 'hands_together', expression: 'neutral', headTilt: -6 },
  { poseId: 'warning', state: 'warning', gesture: 'stop', expression: 'worried', side: 'R' },
];

/** Which states can stand in for a missing one (same intent, best first). */
export const STATE_SUBSTITUTES: Record<PoseState, PoseState[]> = {
  neutral: ['idle', 'listening', 'happy'],
  idle: ['neutral', 'listening'],
  thinking: ['questioning', 'confused', 'listening', 'neutral'],
  confused: ['questioning', 'thinking', 'surprised', 'neutral'],
  surprised: ['excited', 'confused', 'happy', 'neutral'],
  happy: ['talking', 'excited', 'neutral'],
  excited: ['celebrating', 'happy', 'surprised', 'presenting'],
  talking: ['explaining', 'happy', 'presenting', 'neutral'],
  listening: ['neutral', 'idle', 'happy'],
  pointing: ['presenting', 'explaining', 'talking'],
  presenting: ['pointing', 'explaining', 'happy'],
  holding_phone: ['looking_phone', 'typing'],
  looking_phone: ['holding_phone', 'typing'],
  typing: ['looking_phone', 'holding_phone'],
  celebrating: ['excited', 'happy', 'presenting'],
  explaining: ['talking', 'presenting', 'pointing', 'happy'],
  warning: ['surprised', 'explaining', 'pointing'],
  questioning: ['confused', 'thinking', 'talking'],
};

export function buildPoseLibrary(characterId: string, poses: Pose[]): PoseLibrary {
  const add = (m: Record<string, string[]>, k: string, id: string) => {
    m[k] = [...(m[k] ?? []), id];
  };
  const byState: Record<string, string[]> = {};
  const byExpression: Record<string, string[]> = {};
  const byGesture: Record<string, string[]> = {};
  const byProp: Record<string, string[]> = {};
  const sorted = [...poses].sort((a, b) => b.semantics.confidence - a.semantics.confidence);
  for (const p of sorted) {
    add(byState, p.semantics.state, p.poseId);
    add(byExpression, p.expression, p.poseId);
    add(byGesture, p.gesture, p.poseId);
    if (p.prop !== 'none') add(byProp, p.prop, p.poseId);
  }
  const missing = POSE_STATES.filter((s) => !byState[s]);
  return { schema: 'nitaaq.pose-library/1', characterId, byState, byExpression, byGesture, byProp, missing };
}

export interface PoseChoice {
  poseId: string;
  /** exact: the state exists; substitute: same intent from another state; closest: fallback. */
  match: 'exact' | 'rig' | 'substitute' | 'closest';
  /** Missing-pose strategy step that resolved it (1–5) and why. */
  step: 1 | 2 | 3 | 4 | 5;
  why: string;
  /** Extra direction the scene must apply to sell the intent (camera / composition). */
  compensate?: { camera?: 'close' | 'medium-close'; overlay?: 'thought' | 'question' | 'exclaim' | 'phone-card'; mirror?: boolean };
}

/**
 * Missing-pose strategy:
 *  1. the state exists → use it (or the existing pose + camera sells it)
 *  2. a rig can perform it safely → rig
 *  3. another state communicates the same intent → substitute
 *  4. composition hides the limit (closest pose + camera / overlay)
 *  5. only then: ask for more artwork (reported in `needsArt`)
 */
export function choosePose(m: Pick<CharacterManifest, 'poses' | 'hasRig'>, lib: PoseLibrary, want: { state: PoseState; prop?: string; side?: 'left' | 'right'; avoid?: string }): PoseChoice {
  const pick = (ids: string[] | undefined) => {
    if (!ids?.length) return undefined;
    const ok = ids.filter((id) => id !== want.avoid || ids.length === 1);
    if (want.side) {
      const sided = ok.find((id) => m.poses.find((p) => p.poseId === id)?.bodyDirection === want.side);
      if (sided) return sided;
    }
    return ok[0];
  };
  const exact = pick(lib.byState[want.state]);
  if (exact) {
    const p = m.poses.find((x) => x.poseId === exact)!;
    const mirror = want.side && p.bodyDirection !== 'front' && p.bodyDirection !== want.side ? true : undefined;
    return { poseId: exact, match: m.hasRig && p.rigPose ? 'rig' : 'exact', step: 1, why: `${want.state} pose available`, compensate: mirror ? { mirror } : undefined };
  }
  if (want.prop && want.prop !== 'none') {
    const withProp = pick(lib.byProp[want.prop]);
    if (withProp) return { poseId: withProp, match: 'substitute', step: 3, why: `no ${want.state} pose; ${withProp} already holds the ${want.prop}` };
  }
  for (const s of STATE_SUBSTITUTES[want.state] ?? []) {
    const id = pick(lib.byState[s]);
    if (id) return { poseId: id, match: 'substitute', step: 3, why: `no ${want.state} pose; ${s} communicates the same intent` };
  }
  const neutral = pick(lib.byState.neutral) ?? pick(lib.byState.idle) ?? m.poses[0].poseId;
  const overlay = want.state === 'thinking' ? 'thought' : want.state === 'confused' || want.state === 'questioning' ? 'question' : want.state === 'surprised' || want.state === 'excited' || want.state === 'warning' ? 'exclaim' : ['holding_phone', 'looking_phone', 'typing'].includes(want.state) ? 'phone-card' : undefined;
  return {
    poseId: neutral,
    match: 'closest',
    step: 4,
    why: `no pose for ${want.state}: closest valid pose ${neutral}${overlay ? ` + ${overlay} graphic` : ''} + a tighter shot carry the intent (the character is not deformed)`,
    compensate: { camera: 'medium-close', overlay },
  };
}

/** Lowest sufficient complexity for what the film asks of the character. */
export function classifyComplexity(m: Pick<CharacterManifest, 'poses' | 'hasRig' | 'animationCapabilities'>, need: { distinctStates: number; gestures: number; talking: boolean }): { complexity: Complexity; why: string } {
  const cap = m.animationCapabilities.complexity;
  if (need.distinctStates <= 1 && need.gestures === 0 && !need.talking) return { complexity: 'STATIC', why: 'one pose for the whole film: camera + breathing + blink is enough' };
  // the art cannot exceed its own ceiling: one flat image is STATIC whatever the script asks
  if (cap === 'STATIC' || m.poses.length <= 1) return { complexity: 'STATIC', why: `the art has ${m.poses.length} pose(s): the script's ${need.distinctStates} states are carried by camera, framing, typography and graphics — the character is never re-posed` };
  if (!m.hasRig) return { complexity: 'POSE_BASED', why: `${need.distinctStates} states from ${m.poses.length} prepared poses (no rig needed)` };
  if (cap === 'FULL_VECTOR_RIG' && need.gestures >= 2) return { complexity: 'FULL_VECTOR_RIG', why: `${need.gestures} gesture changes: articulated arms + face layers` };
  return { complexity: 'PARTIAL_RIG', why: 'head / face / arm moves on the rig; no full-body articulation needed' };
}
