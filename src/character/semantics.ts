/**
 * Pose semantics: what a pose MEANS (state, expression, gesture, prop), from
 *   1. the label the user/sheet gave (file name, sheet label) — Arabic or English;
 *   2. what the silhouette shows (raised / extended arms, a held object);
 * combined with a confidence and the evidence for it. Disagreement between a
 * label and the silhouette is reported, not silently resolved.
 */
import type { Expression, Gesture, PoseState, PropKind } from './schema';
import type { SilhouetteFeatures } from './silhouette';

interface Lex {
  state: PoseState;
  expression?: Expression;
  gesture?: Gesture;
  prop?: PropKind;
  re: RegExp;
}

/** Order matters: specific before generic. */
const LEXICON: Lex[] = [
  { state: 'looking_phone', expression: 'focused', gesture: 'hold_phone', prop: 'phone', re: /look(ing)?[\s_-]*(at[\s_-]*)?(the[\s_-]*)?(phone|mobile|screen)|reading|يقرأ|يقرا|يطالع (ب)?الجوال|ينظر (الى|إلى) الجوال|يشوف الجوال/ },
  { state: 'typing', expression: 'focused', gesture: 'type', prop: 'phone', re: /typ(e|ing)|texting|يكتب|يطقطق/ },
  { state: 'holding_phone', expression: 'neutral', gesture: 'hold_phone', prop: 'phone', re: /phone|mobile|cell|smartphone|جوال|هاتف|موبايل|تلفون/ },
  { state: 'pointing', expression: 'happy', gesture: 'point', re: /point(ing)?|يشير|يأشر|يؤشر|إشارة|اشارة/ },
  { state: 'presenting', expression: 'happy', gesture: 'present', re: /present(ing)?|show(ing|case)?|reveal|introduc|يعرض|يقدم|يقدّم|يكشف/ },
  { state: 'celebrating', expression: 'excited', gesture: 'celebrate', re: /celebrat|cheer|win|victory|hooray|يحتفل|فرحان جدا|فوز/ },
  { state: 'excited', expression: 'excited', gesture: 'celebrate', re: /excit|thrill|wow|yay|متحمس|حماس|منبهر/ },
  { state: 'surprised', expression: 'surprised', re: /surpris|shock|amaz|astonish|مندهش|متفاجئ|مصدوم|مستغرب جدا/ },
  { state: 'confused', expression: 'confused', gesture: 'shrug', re: /confus|puzzl|shrug|huh|wonder|مستغرب|محتار|حاير|مرتبك/ },
  { state: 'questioning', expression: 'skeptical', gesture: 'shrug', re: /question|ask(ing)?|why|what|skeptic|doubt|يسأل|يتساءل|متشكك|سؤال/ },
  { state: 'thinking', expression: 'thinking', gesture: 'hand_on_chin', re: /think|ponder|idea|consider|hmm|يفكر|تفكير|متأمل/ },
  { state: 'warning', expression: 'worried', gesture: 'stop', re: /warn|stop|caution|alert|danger|careful|تحذير|يحذر|انتبه|توقف/ },
  { state: 'explaining', expression: 'happy', gesture: 'explain', re: /explain|teach|describ|يشرح|يوضح|شرح/ },
  { state: 'talking', expression: 'happy', gesture: 'explain', re: /talk|speak|say|chat|يتكلم|يتحدث|يقول|كلام/ },
  { state: 'listening', expression: 'neutral', gesture: 'hands_together', re: /listen|attentive|يستمع|يسمع|منصت/ },
  { state: 'happy', expression: 'happy', re: /happy|smil|joy|glad|pleased|سعيد|مبتسم|مبسوط|فرحان/ },
  { state: 'idle', expression: 'neutral', re: /idle|wait|stand(ing)?|واقف|ينتظر/ },
  { state: 'neutral', expression: 'neutral', re: /neutral|default|base|front|normal|محايد|عادي|افتراضي|أمامي/ },
];

const EXPR_ONLY: [RegExp, Expression][] = [
  [/worr|anxious|nervous|قلق|خايف|متوتر/, 'worried'],
  [/focus|serious|concentrat|مركز|جاد/, 'focused'],
  [/skeptic|doubt|متشكك/, 'skeptical'],
];

const ANGLE_HINTS: [RegExp, 'front' | 'three_quarter_left' | 'three_quarter_right' | 'side_left' | 'side_right' | 'back'][] = [
  [/3[\s/-]?4[\s_-]*left|three[\s_-]*quarter[\s_-]*left|ربع يسار/, 'three_quarter_left'],
  [/3[\s/-]?4[\s_-]*right|three[\s_-]*quarter[\s_-]*right|ربع يمين/, 'three_quarter_right'],
  [/side[\s_-]*left|profile[\s_-]*left|جانب(ي)? يسار/, 'side_left'],
  [/side[\s_-]*right|profile[\s_-]*right|جانب(ي)? يمين/, 'side_right'],
  [/\bback\b|rear|خلف/, 'back'],
];

export function cleanLabel(s: string): string {
  return s
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(character|char|pose|img|image|png|final|v\d+|copy|\d+)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LabelReading {
  state: PoseState;
  expression?: Expression;
  gesture?: Gesture;
  prop?: PropKind;
  angle?: 'front' | 'three_quarter_left' | 'three_quarter_right' | 'side_left' | 'side_right' | 'back';
  word: string;
}

export function readLabel(label?: string): LabelReading | null {
  if (!label) return null;
  const t = cleanLabel(label);
  if (!t) return null;
  const hit = LEXICON.find((l) => l.re.test(t));
  const angle = ANGLE_HINTS.find(([re]) => re.test(t))?.[1];
  const ex = EXPR_ONLY.find(([re]) => re.test(t))?.[1];
  if (!hit && !ex && !angle) return null;
  return { state: hit?.state ?? 'neutral', expression: ex ?? hit?.expression, gesture: hit?.gesture, prop: hit?.prop, angle, word: t };
}

export interface PoseReading {
  state: PoseState;
  expression: Expression;
  gesture: Gesture;
  prop: PropKind;
  handState: 'relaxed' | 'raised' | 'extended' | 'holding' | 'together' | 'hidden';
  bodyDirection: 'left' | 'right' | 'front';
  headDirection: 'left' | 'right' | 'front' | 'up' | 'down';
  angle: 'front' | 'three_quarter_left' | 'three_quarter_right' | 'side_left' | 'side_right' | 'back';
  energy: number;
  confidence: number;
  evidence: string[];
  /** Label and silhouette disagree (reported in the manifest warnings). */
  conflict?: string;
}

const ENERGY: Record<PoseState, number> = {
  neutral: 0.3, idle: 0.25, thinking: 0.35, confused: 0.45, surprised: 0.75, happy: 0.55, excited: 0.9, talking: 0.55, listening: 0.3, pointing: 0.65,
  presenting: 0.7, holding_phone: 0.4, looking_phone: 0.35, typing: 0.4, celebrating: 0.95, explaining: 0.55, warning: 0.6, questioning: 0.45,
};

/** What the silhouette alone suggests. */
export function readSilhouette(f: SilhouetteFeatures): { state: PoseState; gesture: Gesture; prop: PropKind; evidence: string[]; confidence: number; pointSide?: 'L' | 'R' } {
  const ev: string[] = [];
  if (f.armRaisedL && f.armRaisedR) {
    ev.push('both arms raised above the shoulders');
    return { state: 'celebrating', gesture: 'celebrate', prop: 'none', evidence: ev, confidence: 0.6 };
  }
  if (f.heldObject) ev.push(`compact saturated object at (${f.heldObject.x.toFixed(2)}, ${f.heldObject.y.toFixed(2)}) — held prop`);
  const ext = Math.max(f.armExtendedL, f.armExtendedR);
  const one = f.armExtendedL > 2.6 !== f.armExtendedR > 2.6;
  if (one && ext > 2.6 && !f.heldObject) {
    const side = f.armExtendedL > f.armExtendedR ? 'L' : 'R';
    ev.push(`one arm extended ${ext.toFixed(1)} head-heights to the ${side === 'L' ? 'left' : 'right'}`);
    return { state: 'pointing', gesture: 'point', prop: 'none', evidence: ev, confidence: 0.55, pointSide: side };
  }
  if (f.armExtendedL > 1.6 && f.armExtendedR > 1.6 && !f.heldObject) {
    ev.push('both arms open away from the body');
    return { state: 'presenting', gesture: 'present', prop: 'none', evidence: ev, confidence: 0.45 };
  }
  if (f.armRaisedL || f.armRaisedR) {
    ev.push('one hand raised');
    return { state: f.heldObject ? 'holding_phone' : 'explaining', gesture: f.heldObject ? 'hold_phone' : 'explain', prop: f.heldObject ? 'phone' : 'none', evidence: ev, confidence: 0.4 };
  }
  if (f.heldObject) return { state: 'holding_phone', gesture: 'hold_phone', prop: 'phone', evidence: ev, confidence: 0.5 };
  ev.push('arms close to the body');
  return { state: 'neutral', gesture: 'none', prop: 'none', evidence: ev, confidence: 0.35 };
}

export function classifyPose(label: string | undefined, f: SilhouetteFeatures | null): PoseReading {
  const lab = readLabel(label);
  const sil = f ? readSilhouette(f) : null;
  const evidence: string[] = [];
  let state: PoseState;
  let confidence: number;
  let conflict: string | undefined;
  if (lab) {
    state = lab.state;
    confidence = 0.85;
    evidence.push(`label "${lab.word}" → ${lab.state}`);
    if (sil) {
      evidence.push(...sil.evidence);
      const gestureClash = lab.gesture && sil.gesture !== 'none' && lab.gesture !== sil.gesture && !(lab.gesture === 'explain' && sil.gesture !== 'celebrate');
      if (sil.gesture === lab.gesture) confidence = 0.95;
      else if (gestureClash && sil.confidence >= 0.5) {
        conflict = `label says ${lab.state} but the silhouette shows ${sil.state}`;
        confidence = 0.6;
      }
    }
  } else if (sil) {
    state = sil.state;
    confidence = sil.confidence;
    evidence.push('no usable label — read from the silhouette', ...sil.evidence);
  } else {
    state = 'neutral';
    confidence = 0.2;
    evidence.push('no label and no readable silhouette');
  }
  const gesture: Gesture = lab?.gesture ?? sil?.gesture ?? 'none';
  const prop: PropKind = lab?.prop ?? sil?.prop ?? 'none';
  const expression: Expression = lab?.expression ?? 'neutral';
  if (!lab?.expression) evidence.push('expression not labelled — treated as neutral (faces are not guessed from pixels)');
  const handState: PoseReading['handState'] = prop !== 'none' ? 'holding' : gesture === 'point' ? 'extended' : gesture === 'celebrate' || gesture === 'stop' ? 'raised' : gesture === 'hands_together' ? 'together' : gesture === 'present' ? 'extended' : 'relaxed';
  const pointSide = sil?.pointSide;
  const bodyDirection: PoseReading['bodyDirection'] = pointSide === 'L' ? 'left' : pointSide === 'R' ? 'right' : 'front';
  const tilt = f?.headTilt ?? 0;
  const headDirection: PoseReading['headDirection'] = state === 'looking_phone' || state === 'typing' ? 'down' : state === 'thinking' ? 'up' : tilt > 4 ? 'right' : tilt < -4 ? 'left' : 'front';
  return { state, expression, gesture, prop, handState, bodyDirection, headDirection, angle: lab?.angle ?? 'front', energy: ENERGY[state], confidence: Math.round(confidence * 100) / 100, evidence, conflict };
}

/** Uses a pose is good for (Director hints, CHARACTER_BIBLE.md). */
export const STATE_USES: Record<PoseState, string[]> = {
  neutral: ['establishing shot', 'listening to the voice-over', 'return to idle'],
  idle: ['waiting', 'holding the frame'],
  thinking: ['problem', 'question', 'consideration'],
  confused: ['problem', 'pain point', 'hook question'],
  surprised: ['reveal reaction', 'notification', 'offer'],
  happy: ['solution', 'result', 'friendly CTA'],
  excited: ['offer', 'launch', 'big result'],
  talking: ['explaining', 'voice-over line'],
  listening: ['testimonial', 'other speaker'],
  pointing: ['direct attention to a title / price / button'],
  presenting: ['reveal a product / feature / card'],
  holding_phone: ['app', 'message', 'order', 'phone scene'],
  looking_phone: ['reading a message', 'notification'],
  typing: ['chat', 'search', 'form'],
  celebrating: ['success', 'win', 'final CTA'],
  explaining: ['features', 'steps', 'how it works'],
  warning: ['mistake to avoid', 'problem'],
  questioning: ['hook question', 'objection'],
};
