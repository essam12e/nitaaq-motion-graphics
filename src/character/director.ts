/**
 * Character Director (pure): decides WHAT the character does and why.
 *
 *   script line → intent (state, emotion, gesture, prop, energy, gaze)
 *              → pose (missing-pose strategy) → shot (side, facing, camera,
 *                 scene kind, phases of the state machine, transition in)
 *
 * The Character Actor (actor.ts) then decides HOW it moves. The Director never
 * draws, never edits the art and never invents poses the art cannot show: a
 * missing state is substituted, framed or carried by a graphic (choosePose).
 *
 * Screen direction is kept for the whole film (the character stays on one side
 * and looks toward the text), except when a pointing pose can only point one
 * way — then the text moves to where the hand points.
 */
import { createRng, hashString } from '../core/rng';
import { choosePose, classifyComplexity, type PoseChoice } from './library';
import { readLabel } from './semantics';
import type { CharacterBeat, CharacterManifest, Complexity, Expression, Gesture, PoseLibrary, PoseState, PropKind } from './schema';

export const CHARACTER_PHASES = ['IDLE', 'NOTICE', 'THINK', 'REACT', 'TALK', 'PRESENT', 'RETURN_TO_IDLE'] as const;
export type CharacterPhase = (typeof CHARACTER_PHASES)[number];

export const SHOT_SIZES = ['wide', 'medium', 'medium-close', 'close'] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
export type SceneKind = 'stage' | 'phone' | 'chat' | 'product' | 'chart' | 'title' | 'cta';
export type CameraMoveKind = 'none' | 'push' | 'pull' | 'drift' | 'handheld';
/** How the cut INTO a shot hides the pose change (never a morph between two drawings). */
export type PoseCut = 'enter' | 'match-cut' | 'cut-on-action' | 'camera-assisted' | 'whip' | 'occlusion' | 'cut' | 'continuous';
export type MotionAmount = 'subtle' | 'normal' | 'exaggerated';
export type IdlePreset = 'premium' | 'casual' | 'energetic' | 'thinking' | 'listening';

export interface LineIntent {
  state: PoseState;
  expression: Expression;
  gesture: Gesture;
  prop: PropKind;
  /** 0..1 */
  energy: number;
  gaze: 'text' | 'camera' | 'prop' | 'down' | 'up';
  scene: SceneKind;
  /** The reading behind the decision (words that triggered it). */
  why: string[];
}

interface Cue {
  re: RegExp;
  state: PoseState;
  expression: Expression;
  gesture: Gesture;
  prop?: PropKind;
  scene?: SceneKind;
  gaze?: LineIntent['gaze'];
  energy: number;
  word: string;
}

/**
 * Script cues, most specific first. Arabic (MSA + Gulf/Saudi) and English.
 * Arabic letters are normalised (أإآ→ا, ة→ه, ى→ي) before matching.
 */
const CUES: Cue[] = [
  { re: /(حمل|نزل|اطلب|سجل|احجز|اشترك|جرب)[^.!؟?]*(الان|اليوم|مجانا)|(download|order|sign up|book|try)[^.!?]*(now|today|free)/, state: 'presenting', expression: 'happy', gesture: 'present', scene: 'cta', gaze: 'camera', energy: 0.75, word: 'call to action (now)' },
  { re: W('اكتب|يكتب|اكتب|ارسل|راسل|type|typing|text me|send'), state: 'typing', expression: 'neutral', gesture: 'type', prop: 'phone', scene: 'chat', gaze: 'prop', energy: 0.4, word: 'typing / sending' },
  { re: W('رساله|رسايل|وصلتني|وصلني|اشعار|نوتيفكيشن|واتساب|whatsapp|message|notification|chat|دردشه|محادثه'), state: 'looking_phone', expression: 'neutral', gesture: 'hold_phone', prop: 'phone', scene: 'chat', gaze: 'prop', energy: 0.45, word: 'message / notification' },
  { re: W('تطبيق|التطبيق|جوال|جوالك|الجوال|موبايل|هاتف|حمل|نزل|app|phone|download|install|اضغط|tap'), state: 'holding_phone', expression: 'happy', gesture: 'hold_phone', prop: 'phone', scene: 'phone', gaze: 'prop', energy: 0.5, word: 'app / phone' },
  { re: W('انتبه|احذر|تحذير|خطر|لا تنس|لا تنسى|warning|careful|beware|don\'t forget'), state: 'warning', expression: 'worried', gesture: 'stop', energy: 0.6, word: 'warning' },
  { re: W('واو|ما توقعت|معقول|صدق|مو معقول|يا سلام|wow|no way|unbelievable|guess what'), state: 'surprised', expression: 'surprised', gesture: 'stop', energy: 0.75, word: 'surprise' },
  { re: W('هلا|اهلا|مرحبا|حياكم|حياك|السلام عليكم|يا هلا|hello|hi|hey|welcome'), state: 'happy', expression: 'happy', gesture: 'wave', gaze: 'camera', energy: 0.65, word: 'greeting' },
  { re: W('٪|%|نسبه|ارتفع|زادت|زاد|نمو|مبيعات|ارقام|رقم|احصائ|growth|sales|percent|data|increase'), state: 'explaining', expression: 'happy', gesture: 'explain', scene: 'chart', energy: 0.55, word: 'numbers' },
  { re: W('هنا|شوف|شف|انظر|لاحظ|تحت|فوق|هذا هو|look|see here|check this|right here'), state: 'pointing', expression: 'happy', gesture: 'point', energy: 0.65, word: 'pointing' },
  { re: W('الحل|اقدم لكم|نقدم|تعرف علي|تعرفوا|جديد|اطلقنا|اكتشف|introduc|meet|presenting|new|the solution'), state: 'presenting', expression: 'happy', gesture: 'present', energy: 0.7, word: 'reveal / solution' },
  { re: W('تم|خلاص|وصل|وصلت|نجح|نجحت|وفرت|ربحت|اخيرا|مبروك|done|finally|success|saved|won'), state: 'celebrating', expression: 'excited', gesture: 'celebrate', energy: 0.9, word: 'success' },
  { re: W('سجل|اطلب|احجز|زورو|زور|تواصل|ابدا|جرب|اشترك|order|sign up|book|start|try|join|get it'), state: 'presenting', expression: 'happy', gesture: 'present', scene: 'cta', gaze: 'camera', energy: 0.75, word: 'call to action' },
  { re: W('اسمع|اسمعوا|بقولك|listen|let me tell'), state: 'talking', expression: 'happy', gesture: 'explain', gaze: 'camera', energy: 0.55, word: 'address the viewer' },
  { re: W('تخيل|فكر|يمكن|خطه|فكره|imagine|think|idea|what if'), state: 'thinking', expression: 'thinking', gesture: 'hand_on_chin', gaze: 'up', energy: 0.35, word: 'thinking' },
  { re: W('محتار|حاير|ما ادري|مدري|ضايع|ضاع|confus|lost|not sure'), state: 'confused', expression: 'confused', gesture: 'shrug', energy: 0.45, word: 'confusion' },
  { re: W('مشكله|تعبت|تعب|زحمه|صعب|نسيت|تاخر|متاخر|مل|زهق|غالي|يضيع|problem|tired|hard|late|expensive|stress'), state: 'confused', expression: 'worried', gesture: 'shrug', energy: 0.45, word: 'problem' },
  { re: W('لان|يعني|بكل بساطه|الطريقه|خطوات|كيف تشتغل|because|simply|how it works|step'), state: 'explaining', expression: 'neutral', gesture: 'explain', energy: 0.5, word: 'explanation' },
  { re: W('سعيد|مبسوط|فرحان|حلو|رائع|ممتاز|happy|great|love|awesome'), state: 'happy', expression: 'happy', gesture: 'hands_together', energy: 0.55, word: 'happy' },
];

/**
 * Word matcher with Arabic-aware boundaries: optional clitics before (و ف ب ل ال …),
 * suffixes allowed after words of 4+ letters (جوالك، التطبيق), exact end for short words (تم، هنا).
 */
function W(alts: string): RegExp {
  const B = '(?:^|[\\s،,.!؟?:«»"\'()-])';
  const E = '(?=$|[\\s،,.!؟?:«»"\'()-])';
  const words = alts.split('|');
  const long = words.filter((w) => w.length >= 4 || /[^\u0600-\u06FF\s]/.test(w));
  const short = words.filter((w) => !long.includes(w));
  const parts: string[] = [];
  if (long.length) parts.push(`${B}(?:و|ف|ب|ل|ال|وال|بال|فال|لل)?(?:${long.join('|')})`);
  if (short.length) parts.push(`${B}(?:و|ف|ب|ال|وال)?(?:${short.join('|')})${E}`);
  return new RegExp(parts.join('|'));
}

const QUESTION_START = /^(هل|ليش|ليه|كيف|وش|ايش|متي|لماذا|ماذا|كم|why|how|what|when|do you|did you|are you|is it)\b/;

export const normArabic = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');

/** Read one script line (+ the beat's explicit hints) into an intent. Explicit hints always win. */
export function readLine(beat: Pick<CharacterBeat, 'line' | 'action' | 'emotion' | 'pose' | 'prop' | 'scene'>): LineIntent {
  const why: string[] = [];
  const t = normArabic(beat.line);
  let base: Omit<Cue, 're' | 'word'> & { word: string } = { state: 'talking', expression: 'happy', gesture: 'explain', energy: 0.5, word: 'default: the character talks to the viewer', gaze: 'text' };
  const explicit = readLabel(beat.pose) ?? readLabel(beat.action);
  if (explicit) {
    base = { state: explicit.state, expression: explicit.expression ?? 'neutral', gesture: explicit.gesture ?? 'none', prop: explicit.prop, energy: 0.5, word: `asked for: ${beat.pose ?? beat.action}` };
  } else {
    const q = /[؟?]\s*$/.test(beat.line) || QUESTION_START.test(t);
    const hit = CUES.find((c) => c.re.test(t));
    // a question stays a question unless the line is about the phone/chat/data or a warning
    if (hit && !(q && !['holding_phone', 'looking_phone', 'typing', 'warning', 'confused', 'surprised'].includes(hit.state) && hit.scene !== 'chart')) base = { ...hit };
    else if (q) base = { state: 'questioning', expression: 'skeptical', gesture: 'shrug', energy: 0.45, word: 'a question' };
    if (/!\s*$/.test(beat.line) && base.energy < 0.7) {
      base.energy = Math.min(1, base.energy + 0.15);
      why.push('exclamation: +energy');
    }
  }
  why.unshift(base.word);
  if (beat.emotion) {
    const e = readLabel(beat.emotion);
    if (e?.expression) {
      base.expression = e.expression;
      why.push(`emotion: ${beat.emotion}`);
    }
  }
  const prop: PropKind = beat.prop ?? base.prop ?? 'none';
  let scene: SceneKind = beat.scene ?? base.scene ?? (prop === 'phone' ? 'phone' : 'stage');
  if (beat.scene) why.push(`scene: ${beat.scene}`);
  if (scene === 'stage' && prop === 'product') scene = 'product';
  const gaze = base.gaze ?? (scene === 'cta' ? 'camera' : prop === 'phone' ? 'prop' : 'text');
  return { state: base.state, expression: base.expression, gesture: base.gesture, prop, energy: base.energy, gaze, scene, why };
}

export interface ShotPhase {
  phase: CharacterPhase;
  /** Fractions of the shot (0..1). */
  from: number;
  to: number;
}

/** The state machine for one shot, from the intent (beats of acting inside the shot). */
export function phasesFor(intent: LineIntent, first: boolean): ShotPhase[] {
  const seq: [CharacterPhase, number][] = [];
  if (first) seq.push(['IDLE', 0.08]);
  switch (intent.state) {
    case 'thinking':
    case 'confused':
    case 'questioning':
      seq.push(['NOTICE', 0.1], ['THINK', 0.55], ['REACT', 0.15]);
      break;
    case 'surprised':
    case 'warning':
    case 'excited':
    case 'celebrating':
      seq.push(['NOTICE', 0.08], ['REACT', 0.42], ['TALK', 0.3]);
      break;
    case 'pointing':
    case 'presenting':
      seq.push(['NOTICE', 0.1], ['PRESENT', 0.6], ['TALK', 0.15]);
      break;
    case 'holding_phone':
    case 'looking_phone':
    case 'typing':
      seq.push(['NOTICE', 0.12], ['PRESENT', 0.48], ['REACT', 0.2]);
      break;
    case 'listening':
    case 'idle':
    case 'neutral':
      seq.push(['IDLE', 0.6], ['NOTICE', 0.2]);
      break;
    default:
      seq.push(['NOTICE', 0.08], ['TALK', 0.7]);
  }
  seq.push(['RETURN_TO_IDLE', 0.1]);
  const total = seq.reduce((a, [, w]) => a + w, 0);
  let at = 0;
  return seq.map(([phase, w]) => {
    const from = at;
    at += w / total;
    return { phase, from: Math.round(from * 1000) / 1000, to: Math.round(at * 1000) / 1000 };
  });
}

export interface RigTarget {
  gesture: Gesture;
  expression: Expression;
  side?: 'L' | 'R';
  headTilt?: number;
  eyes?: string;
  mouth?: string;
  /** Pointing aim (deg from down): level at text beside, up at a headline above. */
  aim?: number;
}

export interface CharacterShot {
  id: string;
  index: number;
  line: string;
  intent: LineIntent;
  /** The pose the shot plays (and the one before it, for continuity). */
  poseId: string;
  prevPoseId?: string;
  choice: PoseChoice;
  /** Rig characters: gesture + face to perform (the Actor animates toward it). */
  rig?: RigTarget;
  /** Rig characters: what the body did in the previous shot (the Actor starts there). */
  prevRig?: RigTarget;
  expression: Expression;
  /** Character position on screen and which way it faces (toward the text). */
  side: 'left' | 'right' | 'center';
  textSide: 'left' | 'right' | 'top' | 'bottom';
  mirror: boolean;
  camera: { size: ShotSize; move: CameraMoveKind; why: string };
  scene: SceneKind;
  phases: ShotPhase[];
  cut: { type: PoseCut; why: string };
  overlay?: 'thought' | 'question' | 'exclaim' | 'phone-card';
  idle: IdlePreset;
  messages?: string[];
  seconds: number;
  enter: boolean;
  /** Leaves the frame at the end of the shot. */
  exit: boolean;
  talk: 0 | 1 | 2 | 3;
  lockFace: boolean;
  motion: MotionAmount;
}

export interface CharacterPlan {
  characterId: string;
  complexity: Complexity;
  complexityWhy: string;
  shots: CharacterShot[];
  /** States the film wanted that the art cannot show (step 5: more artwork would help). */
  needsArt: string[];
  warnings: string[];
  /** Human-readable decisions (written to character_direction.md). */
  notes: string[];
}

export interface CharacterDirectorInput {
  beats: CharacterBeat[];
  manifest: CharacterManifest;
  library: PoseLibrary;
  orientation: 'portrait' | 'landscape' | 'square';
  dir: 'rtl' | 'ltr';
  personality?: string;
  seed?: string | number;
  motion?: MotionAmount;
  lockFace?: boolean;
  talk?: 0 | 1 | 2 | 3;
  side?: 'left' | 'right' | 'center';
  /** A voiceover exists (talking level 2 is possible). */
  voiced?: boolean;
}

const SIZE_ORDER: ShotSize[] = ['wide', 'medium', 'medium-close', 'close'];

const IDLE_FOR: Partial<Record<PoseState, IdlePreset>> = { thinking: 'thinking', confused: 'thinking', questioning: 'thinking', listening: 'listening', excited: 'energetic', celebrating: 'energetic', surprised: 'energetic' };

function idleFor(state: PoseState, personality?: string): IdlePreset {
  const s = IDLE_FOR[state];
  if (s) return s;
  if (personality === 'premium' || personality === 'corporate' || personality === 'cinematic') return 'premium';
  if (personality === 'energetic' || personality === 'sport' || personality === 'playful') return 'energetic';
  return 'casual';
}

/** Words per second of Arabic motion copy (+ acting time). */
const secondsFor = (b: CharacterBeat, intent: LineIntent) => b.seconds ?? Math.round(Math.min(6.5, Math.max(2.4, 1.3 + b.line.split(/\s+/).length / 2.6 + (intent.scene === 'chat' ? (b.messages?.length ?? 0) * 0.7 : 0) + (intent.scene === 'cta' ? 0.6 : 0))) * 10) / 10;

export function directCharacter(input: CharacterDirectorInput): CharacterPlan {
  const { manifest: m, library: lib } = input;
  const rng = createRng(input.seed ?? hashString(input.beats.map((b) => b.line).join('|'))).next;
  const mirrorOk = !m.restrictedActions.some((r) => r.startsWith('mirroring'));
  const hasRig = m.hasRig && m.animationCapabilities.armRig;
  const motion = input.motion ?? 'normal';
  const lockFace = input.lockFace ?? false;
  const notes: string[] = [];
  const warnings: string[] = [];
  const needsArt = new Set<string>();

  // screen direction: RTL text reads from the right → text on the right, character on the left looking at it
  const portrait = input.orientation === 'portrait';
  const homeSide: 'left' | 'right' | 'center' = input.side ?? (input.dir === 'rtl' ? 'left' : 'right');
  notes.push(`screen direction: character ${portrait ? 'below the text' : `on the ${homeSide}`}, looking toward the text (${input.dir.toUpperCase()} reading order); kept for the whole film`);

  const talkLevel: 0 | 1 | 2 | 3 = lockFace ? 0 : input.talk ?? (input.voiced ? 2 : 1);
  if (input.talk === 3) warnings.push('talking level 3 (phoneme lip sync) needs mouth shapes per phoneme and a forced alignment; level 2 (voice-energy mouth) is used instead');

  const shots: CharacterShot[] = [];
  let prevSize: ShotSize | undefined;
  let prevPose: string | undefined;
  input.beats.forEach((b, i) => {
    const intent = readLine(b);
    const first = i === 0;
    const last = i === input.beats.length - 1;
    const wantSide = intent.gesture === 'point' ? (homeSide === 'left' ? 'right' : 'left') : undefined;
    const choice = choosePose(m, lib, { state: intent.state, prop: intent.prop, side: wantSide, avoid: undefined });
    if (choice.step >= 4) needsArt.add(intent.state);
    const pose = m.poses.find((p) => p.poseId === choice.poseId)!;

    // facing: the character looks/points toward the text; a pose that faces away is mirrored only when safe
    let side = homeSide;
    let mirror = false;
    const toward = homeSide === 'left' ? 'right' : homeSide === 'right' ? 'left' : undefined;
    const facesAway = toward && pose.bodyDirection !== 'front' && pose.bodyDirection !== toward;
    if (facesAway && !hasRig) {
      if (mirrorOk) mirror = true;
      else if (!portrait) {
        side = homeSide === 'left' ? 'right' : 'left';
        notes.push(`shot ${i + 1}: ${pose.poseId} faces ${pose.bodyDirection} and the art may not be mirrored → the character moves to the ${side} for this shot so it still faces the text`);
      }
    }
    const textSide: CharacterShot['textSide'] = portrait ? 'top' : side === 'left' ? 'right' : side === 'right' ? 'left' : 'top';

    // camera: emotion decides the size; never the same size twice for the same pose (no jump cut)
    let size: ShotSize = b.camera ?? (intent.scene === 'chat' || intent.scene === 'phone' || intent.scene === 'product' || intent.scene === 'chart' ? 'medium' : intent.scene === 'cta' ? 'medium' : intent.state === 'thinking' || intent.state === 'surprised' || intent.state === 'confused' ? 'medium-close' : intent.state === 'celebrating' || intent.state === 'excited' || intent.state === 'pointing' || intent.state === 'presenting' ? 'wide' : first ? 'wide' : 'medium');
    if (choice.compensate?.camera && !b.camera) size = choice.compensate.camera;
    if (pose.framing !== 'full-body' && size === 'wide') size = 'medium';
    if (!b.camera && prevPose === choice.poseId && prevSize === size) size = SIZE_ORDER[(SIZE_ORDER.indexOf(size) + 1) % 3];
    const move: CameraMoveKind = intent.state === 'thinking' || intent.state === 'confused' ? 'push' : intent.state === 'surprised' || intent.state === 'warning' ? 'push' : intent.scene === 'cta' ? 'pull' : intent.energy > 0.8 && motion !== 'subtle' ? 'handheld' : rng() < 0.5 ? 'drift' : 'none';
    const camWhy = size === 'close' || size === 'medium-close' ? 'tight: the face carries this beat' : size === 'wide' ? 'wide: the whole body gesture reads' : 'medium: character and graphic share the frame';

    // cut into the shot: hide the pose change with the right edit (never a morph)
    let cut: CharacterShot['cut'];
    if (first) cut = { type: 'enter', why: 'the character enters and settles before the first line' };
    else if (hasRig) cut = { type: 'continuous', why: 'rig: the body animates from the previous pose to the new one (no cut needed)' };
    else if (prevPose === choice.poseId) cut = { type: 'match-cut', why: 'same pose, new shot size: a cut-in keeps continuity' };
    else if (intent.scene === 'phone' || intent.scene === 'chat' || intent.scene === 'product') cut = { type: 'occlusion', why: `the ${intent.scene === 'product' ? 'product' : 'phone screen'} passes in front and hides the pose swap` };
    else if (intent.energy >= 0.75 && motion !== 'subtle' && input.personality !== 'premium') cut = { type: 'whip', why: 'high-energy beat: a whip pan carries the change' };
    else if (SIZE_ORDER.indexOf(size) > SIZE_ORDER.indexOf(prevSize ?? 'wide')) cut = { type: 'camera-assisted', why: 'the camera pushes in through the cut, so the new pose reads as a new angle' };
    else cut = { type: 'cut-on-action', why: 'cut on the start of the gesture: the eye follows the action, not the drawing change' };

    const rigTarget = hasRig ? rigTargetFor(intent, m, choice, homeSide, lockFace, portrait) : undefined;
    const expression = lockFace ? (hasRig ? 'neutral' : pose.expression) : hasRig ? intent.expression : pose.expression;
    const overlay = choice.compensate?.overlay ?? (intent.state === 'thinking' && rng() < 0.6 ? 'thought' : intent.state === 'questioning' ? 'question' : undefined);
    const shot: CharacterShot = {
      id: `c${i + 1}`,
      index: i,
      line: b.line,
      intent,
      poseId: choice.poseId,
      prevPoseId: prevPose,
      choice,
      rig: rigTarget,
      prevRig: shots[i - 1]?.rig,
      expression,
      side,
      textSide,
      mirror,
      camera: { size, move, why: camWhy },
      scene: intent.scene,
      phases: phasesFor(intent, first),
      cut,
      overlay,
      idle: idleFor(intent.state, input.personality),
      messages: b.messages,
      seconds: secondsFor(b, intent),
      enter: first,
      exit: false,
      talk: intent.scene === 'title' ? 0 : talkLevel,
      lockFace,
      motion: last && intent.scene === 'cta' && motion === 'exaggerated' ? 'normal' : motion,
    };
    shots.push(shot);
    notes.push(`shot ${i + 1} «${b.line}» → ${intent.state} (${intent.why.join('; ')}) · pose ${choice.poseId} [${choice.match}, step ${choice.step}: ${choice.why}] · ${size}${move !== 'none' ? ` + ${move}` : ''} · cut ${cut.type}`);
    prevPose = choice.poseId;
    prevSize = size;
  });

  const distinct = new Set(shots.map((s) => s.poseId)).size;
  const gestures = new Set(shots.map((s) => s.rig?.gesture ?? s.intent.gesture).filter((g) => g !== 'none')).size;
  const cx = classifyComplexity(m, { distinctStates: distinct, gestures, talking: talkLevel > 0 && !lockFace });
  if (needsArt.size) warnings.push(`the art has no pose for: ${[...needsArt].join(', ')} — carried by the closest pose + framing/graphics. A sheet with these poses would make those beats stronger.`);
  return { characterId: m.characterId, complexity: cx.complexity, complexityWhy: cx.why, shots, needsArt: [...needsArt], warnings, notes };
}

/** What a rig should perform for an intent (only gestures/faces the rig really has). */
function rigTargetFor(intent: LineIntent, m: CharacterManifest, choice: PoseChoice, homeSide: 'left' | 'right' | 'center', lockFace: boolean, portrait: boolean): RigTarget {
  const towardText: 'L' | 'R' = homeSide === 'right' ? 'L' : 'R';
  const pose = m.poses.find((p) => p.poseId === choice.poseId);
  const base = intent.prop === 'phone' && !m.props.includes('phone') ? 'explain' : intent.gesture;
  // beside a chart or a product the open hand presents the graphic (the eye follows the hand to the number)
  const gesture = (intent.scene === 'chart' || intent.scene === 'product') && (base === 'explain' || base === 'none' || base === 'hands_together') ? 'present' : base;
  const side: 'L' | 'R' = gesture === 'point' || gesture === 'present' || gesture === 'explain' || gesture === 'stop' ? towardText : gesture === 'hand_on_chin' || gesture === 'hold_phone' ? (towardText === 'R' ? 'L' : 'R') : towardText;
  const headTilt = intent.state === 'thinking' ? (side === 'R' ? -5 : 5) : intent.state === 'confused' ? -7 : intent.state === 'questioning' ? 6 : intent.state === 'listening' ? -5 : intent.state === 'looking_phone' || intent.state === 'typing' ? 4 : undefined;
  const eyes = intent.state === 'looking_phone' || intent.state === 'typing' ? 'down' : intent.state === 'thinking' ? 'up' : undefined;
  void pose;
  // on a tall frame the line sits above the character: point up at it
  const aim = gesture === 'point' ? (portrait ? 128 : 86) : undefined;
  return { gesture, expression: lockFace ? 'neutral' : intent.expression, side, headTilt: gesture === 'point' && portrait ? (side === 'R' ? -6 : 6) : headTilt, eyes: gesture === 'point' && portrait ? 'up' : eyes, aim };
}
