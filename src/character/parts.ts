/**
 * Logical part names for layered characters. Artists name layers in many ways
 * («arm_upper_left», «LeftUpperArm», «ذراع يمين», «Forearm R»…); this maps a layer
 * name to one logical kind. Sides are IMAGE sides (screen left / right).
 */
export const PART_KINDS = [
  'torso',
  'hips',
  'legs',
  'neck',
  'head',
  'hair',
  'headwear',
  'ears',
  'eyes',
  'eyebrows',
  'mouth',
  'nose',
  'facialHair',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'armL',
  'armR',
  'clothing',
  'accessory',
  'prop',
  'shadow',
] as const;
export type PartKind = (typeof PART_KINDS)[number];

const norm = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_\-.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function sideOf(n: string): 'L' | 'R' | null {
  const t = ` ${n} `;
  if (/ (l|left|lft|يسار|اليسار|يسرى|اليسرى) /.test(t) || /^l /.test(n) || / l$/.test(n)) return 'L';
  if (/ (r|right|rgt|يمين|اليمين|يمنى|اليمنى) /.test(t) || /^r /.test(n) || / r$/.test(n)) return 'R';
  return null;
}

const RULES: [RegExp, string][] = [
  [/shadow|ظل/, 'shadow'],
  [/upper ?arm|arm ?upper|bicep|shoulder ?arm|عضد|ذراع علوي/, 'upperArm'],
  [/lower ?arm|arm ?lower|fore ?arm|ساعد|ذراع سفلي/, 'lowerArm'],
  [/hand|palm|fist|finger|يد|كف/, 'hand'],
  [/^arm\b|\barm$|\barm |sleeve|ذراع/, 'arm'],
  [/eye ?brow|brow|حاجب|حواجب/, 'eyebrows'],
  [/eye|pupil|عين|عيون/, 'eyes'],
  [/mouth|lip|فم|شفاه/, 'mouth'],
  [/nose|انف|أنف/, 'nose'],
  [/beard|mustache|moustache|facial ?hair|لحية|شنب|شارب/, 'facialHair'],
  [/ghutra|shemagh|shmagh|keffiyeh|kufiya|agal|iqal|egal|hijab|headscarf|turban|cap|hat|غترة|شماغ|عقال|حجاب|طاقية|قبعة/, 'headwear'],
  [/hair|شعر/, 'hair'],
  [/\bears?\b|اذن|أذن/, 'ears'],
  [/head|face|skull|راس|رأس|وجه/, 'head'],
  [/neck|رقبة/, 'neck'],
  [/torso|body|chest|thobe|thawb|dishdasha|shirt|jacket|coat|abaya|بشت|ثوب|جسم|صدر|قميص|عباية/, 'torso'],
  [/hip|pelvis|waist|حوض|خصر/, 'hips'],
  [/leg|feet|foot|shoe|sandal|trouser|pants|ساق|رجل|قدم|حذاء|نعال/, 'legs'],
  [/phone|mobile|laptop|tablet|prop|product|card|sign|جوال|هاتف|لابتوب|منتج/, 'prop'],
  [/watch|ring|glasses|bag|necklace|ساعة|نظارة|شنطة/, 'accessory'],
  [/collar|belt|pocket|button|ياقة|جيب|زر/, 'clothing'],
];

/** Logical kind of a layer name, or null when it is not a recognised part. */
export function kindOf(name: string): PartKind | null {
  const n = norm(name);
  if (!n) return null;
  for (const [re, k] of RULES) {
    if (!re.test(n)) continue;
    if (k === 'upperArm' || k === 'lowerArm' || k === 'hand' || k === 'arm') {
      const s = sideOf(n);
      if (!s) return null;
      return `${k}${s}` as PartKind;
    }
    return k as PartKind;
  }
  return null;
}

/** «mouth--smile», «eyes:closed», data-state → state name. */
export function stateOf(id: string, dataState?: string): string | null {
  if (dataState) return dataState.toLowerCase();
  const m = /(?:--|::|__state_|#)([a-z0-9_-]+)$/i.exec(id);
  return m ? m[1].toLowerCase() : null;
}

/** Default parent when the SVG does not nest parts. */
export function defaultParent(kind: string, present: Set<string>): string | undefined {
  const first = (...ks: string[]) => ks.find((k) => present.has(k));
  if (kind === 'torso') return first('hips');
  if (kind === 'legs' || kind === 'hips' || kind === 'shadow') return undefined;
  if (kind === 'neck') return first('torso');
  if (kind === 'head') return first('neck', 'torso');
  if (['hair', 'headwear', 'ears', 'eyes', 'eyebrows', 'mouth', 'nose', 'facialHair'].includes(kind)) return first('head');
  const m = /^(upperArm|lowerArm|hand|arm)([LR])$/.exec(kind);
  if (m) {
    const s = m[2];
    if (m[1] === 'upperArm' || m[1] === 'arm') return first('torso');
    if (m[1] === 'lowerArm') return first(`upperArm${s}`, `arm${s}`, 'torso');
    return first(`lowerArm${s}`, `arm${s}`, `upperArm${s}`, 'torso');
  }
  if (kind === 'clothing' || kind === 'accessory') return first('torso');
  if (kind === 'prop') return first('handR', 'handL', 'torso');
  return first('torso');
}

/** Rotation limits per kind (deg) — keeps rig poses anatomically plausible. */
export function limitsOf(kind: string): [number, number] | undefined {
  if (kind === 'head') return [-28, 28];
  if (kind === 'neck') return [-10, 10];
  if (kind === 'torso') return [-14, 14];
  if (/^upperArm|^arm[LR]$/.test(kind)) return [-185, 185];
  if (/^lowerArm/.test(kind)) return [-165, 165];
  if (/^hand/.test(kind)) return [-70, 70];
  if (kind === 'headwear' || kind === 'hair') return [-12, 12];
  return undefined;
}

/** Expression → preferred state names for each face part (first match wins). */
export const FACE_STATES: Record<string, { eyes: string[]; eyebrows: string[]; mouth: string[] }> = {
  neutral: { eyes: ['open', 'neutral'], eyebrows: ['neutral', 'normal'], mouth: ['neutral', 'closed', 'smile-soft'] },
  happy: { eyes: ['happy', 'open'], eyebrows: ['raised-soft', 'neutral'], mouth: ['smile', 'happy', 'grin'] },
  excited: { eyes: ['wide', 'happy', 'open'], eyebrows: ['raised', 'neutral'], mouth: ['open-smile', 'grin', 'open', 'smile'] },
  surprised: { eyes: ['wide', 'open'], eyebrows: ['raised'], mouth: ['o', 'surprised', 'open'] },
  confused: { eyes: ['open', 'half'], eyebrows: ['skeptic', 'confused', 'furrow'], mouth: ['flat', 'smirk', 'neutral'] },
  skeptical: { eyes: ['half', 'open'], eyebrows: ['skeptic', 'raised-one', 'furrow'], mouth: ['smirk', 'flat'] },
  thinking: { eyes: ['up', 'half', 'open'], eyebrows: ['furrow', 'skeptic', 'neutral'], mouth: ['flat', 'neutral'] },
  worried: { eyes: ['open', 'wide'], eyebrows: ['worried', 'sad', 'raised'], mouth: ['frown', 'worried', 'flat'] },
  focused: { eyes: ['down', 'half', 'open'], eyebrows: ['furrow', 'neutral'], mouth: ['flat', 'neutral'] },
};
