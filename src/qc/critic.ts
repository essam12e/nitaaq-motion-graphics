/**
 * Visual Critic (P2-A, replaces the P1 Motion Critic's scoring).
 *
 * P1's critic started every dimension at 10 and subtracted penalties: anything it could not see was
 * "perfect" (frameUtilization 10 with a 10%-occupancy shot, commercialQuality 10 with no standard).
 * This critic scores from POSITIVE EVIDENCE on an interpretable scale, in two layers that never mix:
 *
 *   TECHNICAL — pass / fail checks (text inside the frame, no critical collision, CTA present,
 *               Arabic intact, transitions resolved, word sync, ending hold). Passing them proves
 *               the film is correct; it does not raise a single visual score.
 *   VISUAL    — 14 dimensions, each built from measured evidence (DOM probes, pixel curves) or
 *               marked heuristic, per shot and per film, judged in context (shot purpose, subject
 *               type, shot size) — a logo resolve is not judged like a hero product.
 *
 * Scale (all scores 0..10):
 *   0–3.9  weak            — a viewer sees the problem
 *   4–5.9  acceptable      — technically correct, visually weak
 *   6–7.4  good            — competent, nothing wrong, nothing memorable
 *   7.5–8.9 professional   — deliberate hierarchy, composition and motion
 *   9–10   exceptional     — rare; automatic evidence alone caps at 9.0 (a 9+ needs a human or
 *                            Claude visual judgement passed in as `judgment`)
 * The overall is a weighted mean held down by its weakest link: a film is never better than
 * three points above its worst dimension, nor 2.5 above its worst shot.
 * Pure (no node APIs).
 */
import type { StagePlan } from '../stage/plan';
import { CAMERA_KEY } from '../stage/plan';
import type { StageReport } from '../stage/compiler';
import type { Direction } from '../stage/direction';
import type { DomMotionReport, StageProbeSample } from './stage-probes';
import { settleTimeOf, unionCover } from './stage-probes';
import { seenHierarchy, similarGroups, type SeenHierarchy } from '../stage/hierarchy';
import type { TransitionQuality } from './transition-quality';
import { compileChoreo } from '../motion/choreography';

export const VISUAL_DIMENSIONS = ['composition', 'hierarchy', 'frameUtilization', 'typography', 'motionChoreography', 'transitions', 'continuity', 'camera', 'audioSync', 'rhythm', 'storytelling', 'brand', 'cta', 'commercialPolish'] as const;
export type VisualDimension = (typeof VISUAL_DIMENSIONS)[number];
/** P1 name kept for callers that only need the list of scored dimensions. */
export const CRITIC_DIMENSIONS = VISUAL_DIMENSIONS;
export type CriticDimension = VisualDimension;

export type Basis = 'measured' | 'heuristic' | 'judgment' | 'n/a';
export type Band = 'weak' | 'acceptable' | 'good' | 'professional' | 'exceptional';
export const BANDS: { band: Band; from: number; label: string }[] = [
  { band: 'weak', from: 0, label: 'ضعيف — المشكلة يراها المشاهد' },
  { band: 'acceptable', from: 4, label: 'مقبول تقنيًا، ضعيف بصريًا' },
  { band: 'good', from: 6, label: 'جيد — متقن بلا تميّز' },
  { band: 'professional', from: 7.5, label: 'احترافي — هرمية وتكوين وحركة مقصودة' },
  { band: 'exceptional', from: 9, label: 'استثنائي ونادر — يحتاج حكمًا بصريًا' },
];
export const bandOf = (s: number): Band => [...BANDS].reverse().find((b) => s >= b.from)!.band;
/** Automatic evidence never proves "exceptional". */
export const AUTO_CAP = 9.0;

export type CriticCode =
  // P1 codes (still produced)
  | 'POWERPOINT_FEELING'
  | 'DEAD_HOLD'
  | 'TINY_SUBJECT'
  | 'EMPTY_COMPOSITION'
  | 'RANDOM_CAMERA'
  | 'CAMERA_NO_VISIBLE_EFFECT'
  | 'CAMERA_OVERUSE'
  | 'REPETITIVE_RHYTHM'
  | 'WEAK_HIERARCHY'
  | 'DISCONNECTED_SHOTS'
  | 'GENERIC_TRANSITIONS'
  | 'MOTION_WITHOUT_REASON'
  | 'WEAK_EXIT'
  | 'BROKEN_HANDOFF'
  | 'TEXT_COLLISION'
  | 'TEXT_OFF_FRAME'
  | 'POOR_ARABIC_LAYOUT'
  | 'CTA_WEAKNESS'
  | 'OVER_ANIMATION'
  | 'UNDER_ANIMATION'
  | 'SUBJECT_BACKGROUND_COMPETITION'
  | 'WORD_SYNC_MISSING'
  // P2 visual codes
  | 'NO_DOMINANT_SUBJECT'
  | 'ROW_OF_SMALL_OBJECTS'
  | 'ELEMENT_OFF_FRAME'
  | 'ITEMS_OVERLAP'
  | 'UNREADABLE_TEXT'
  | 'FLAT_TYPOGRAPHY'
  | 'EXCESS_NEGATIVE_SPACE'
  | 'CROWDED_FRAME'
  | 'UNBALANCED'
  | 'SUBJECT_OBSTRUCTION'
  | 'EMPTY_TRANSITION_FRAME'
  | 'VISUAL_VOID'
  | 'FLASH_FRAME'
  | 'OVERLAP_TRANSITION'
  | 'BROKEN_CONTINUITY'
  | 'CAMERA_REPLACEABLE'
  | 'CAMERA_DEPENDENCY'
  | 'FLAT_ENERGY'
  | 'ENERGY_MISMATCH'
  | 'WEAK_CTA_COMPOSITION'
  | 'WEAK_BRAND_PRESENCE'
  | 'TEMPLATE_FEELING';

export interface CriticIssue {
  code: CriticCode;
  severity: 'critical' | 'major' | 'minor';
  /** technical: correctness (pass / fail) · visual: quality. */
  layer: 'technical' | 'visual';
  shot?: string;
  dims: CriticDimension[];
  evidence: string;
  /** What a repair should achieve (the Repair Planner chooses HOW). */
  fix?: string;
  /** Element(s) involved, for the repair planner. */
  elements?: string[];
}

export interface DimScore {
  score: number;
  band: Band;
  basis: Basis;
  /** 0..1: how much the evidence behind the score can be trusted. */
  confidence: number;
  evidence: string[];
}

export interface ShotVisual {
  shot: string;
  purpose?: string;
  t: number;
  scores: { frameUtilization: number; hierarchy: number; composition: number; typography: number; cleanliness: number };
  overall: number;
  band: Band;
  measured: {
    subjectOcc: number;
    contentOcc: number;
    target: [number, number];
    negativeSpace: number;
    balanceOffset: number;
    minTextPx?: number;
    headlinePx?: number;
    typeRatio?: number;
  };
  hierarchy?: Pick<SeenHierarchy, 'readOrder' | 'heroRank' | 'margin' | 'groups'> & { firstRead?: string; secondRead?: string; thirdRead?: string };
  basis: Basis;
}

export interface TechnicalCheck {
  id: string;
  pass: boolean;
  severity: 'critical' | 'major' | 'minor';
  evidence: string;
}

export interface CriticReport {
  version: 2;
  scale: typeof BANDS;
  technical: { pass: boolean; checks: TechnicalCheck[] };
  visual: { scores: Record<VisualDimension, DimScore>; overall: number; band: Band; confidence: number };
  shots: ShotVisual[];
  /** Film-level measurements the report and the repair planner use. */
  measures: {
    cameraDependency: number;
    elementMotionShare: number;
    stillShare?: number;
    energy: { shot: string; planned: number; measured: number }[];
    energyCorrelation?: number;
    energyContrast?: number;
    cameraMoves: { shot: string; score: number; visible: boolean; replaceable: boolean; note: string }[];
    commercial: { item: string; pass: boolean; basis: Basis; note: string }[];
  };
  /** Compatibility (P1 callers): the visual scores as plain numbers and the visual overall. */
  scores: Record<VisualDimension, number>;
  overall: number;
  issues: CriticIssue[];
  verdict: { status: 'accept' | 'repair' | 'reject'; reasons: string[]; repairShots: string[] };
  evidence: { sources: string[]; dom: boolean; pixel: boolean; samples: boolean; transitions: boolean };
}

export interface CriticInput {
  plan: StagePlan;
  report: StageReport;
  dom?: DomMotionReport | null;
  /** Raw DOM samples (dom_samples.json): settle frames → hierarchy, readability, balance. */
  samples?: StageProbeSample[] | null;
  /** Pixel motion metrics of the animatic (motion_metrics.animatic.json → global). */
  pixel?: { stillFrameRatio?: number; longestDeadHold?: number; score?: number } | null;
  direction?: Direction | null;
  textProblems?: { id: string; problem: string }[];
  voice?: boolean;
  /** transition_quality.json → transitions (pixel occupancy through every cut). */
  transitions?: TransitionQuality[] | null;
  /** Visual judgement scores (Claude / a human) for dimensions that measurement cannot prove. */
  judgment?: Partial<Record<VisualDimension, { score: number; note: string }>>;
  /** Only judge these shots (style frame gate). */
  onlyShots?: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (v: number, a = 0, b = 10) => Math.max(a, Math.min(b, v));
/** Piecewise-linear map through anchor points [[x, y], …] (x ascending). */
export function curve(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const wmean = (a: { v: number; w: number }[]) => {
  const W = a.reduce((x, y) => x + y.w, 0);
  return W ? a.reduce((x, y) => x + y.v * y.w, 0) / W : 0;
};
const PENALTY = { critical: 2.5, major: 1.2, minor: 0.4 } as const;
/** The least a member of a row needs to read as an object of its own (frame fraction). */
const OCCUPANCY_ITEM_MIN = 0.09;

/** Planned energy per narrative job (when the script left every shot at the default). */
export const PURPOSE_ENERGY: Record<string, number> = { hook: 0.85, problem: 0.5, pain: 0.5, setup: 0.5, solution: 0.75, reveal: 0.85, demo: 0.6, explanation: 0.45, process: 0.6, feature: 0.65, benefit: 0.65, proof: 0.7, offer: 0.75, brand: 0.5, cta: 0.4 };

function nearest(samples: StageProbeSample[], t: number): StageProbeSample | undefined {
  let best: StageProbeSample | undefined;
  for (const s of samples) if (!best || Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best;
}

/** Spearman rank correlation. */
function spearman(a: number[], b: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  if (n < 3) return 0;
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

export function critique(input: CriticInput): CriticReport {
  const { plan, report, dom, direction } = input;
  const samples = input.samples ?? null;
  const W = plan.W;
  const H = plan.H;
  const issues: CriticIssue[] = [];
  const add = (i: Omit<CriticIssue, 'layer'> & { layer?: CriticIssue['layer'] }) => issues.push({ layer: 'visual', ...i });
  const allShots = plan.shots;
  const shots = input.onlyShots ? allShots.filter((s) => input.onlyShots!.includes(s.id)) : allShots;
  const n = allShots.length;
  const last = allShots[n - 1];
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  const checks: TechnicalCheck[] = [];
  const check = (id: string, pass: boolean, severity: TechnicalCheck['severity'], evidence: string) => checks.push({ id, pass, severity, evidence });

  // ═════ TECHNICAL LAYER ═════
  const off = dom?.offFrame ?? [];
  check('TEXT_IN_FRAME', !off.some((o) => o.worst > 0.05), 'critical', off.length ? off.map((o) => `${o.text} cut ${Math.round(o.worst * 100)}% for ${o.sec}s`).join('; ') : dom ? 'every readable word inside the frame' : 'not measured (no DOM probes)');
  for (const o of off) add({ layer: 'technical', code: 'TEXT_OFF_FRAME', severity: o.worst > 0.25 && o.sec >= 0.4 ? 'critical' : 'major', shot: o.shot, dims: ['typography', 'camera'], evidence: `${o.text} is cut by the frame edge (${Math.round(o.worst * 100)}% of «${o.words.join(' ')}» lost) for ${o.sec}s`, fix: 'keep the line inside the frame without losing the shot’s intent', elements: [o.text] });
  // labelled objects (card / chip / button titles) cut by the frame once the shot has settled: the words are
  // lost even though they are not a text element (a close camera end framing is the usual cause)
  const LABELLED = new Set(['card', 'chip', 'button']);
  const cutLabels: string[] = [];
  if (samples?.length) {
    for (const s of shots) {
      const t0 = settleTimeOf(plan, s.id);
      // at rest = after the settle frame AND the camera still (a glide into the next shot is motion, not a resting cut)
      const late = samples.filter((x, k) => {
        if (x.t < t0 - 0.01 || x.t > s.end - 0.12) return false;
        const p = samples[k - 1];
        return !p || Math.abs(p.cam.x - x.cam.x) + Math.abs(p.cam.y - x.cam.y) < 1.5 && Math.abs(p.cam.dolly - x.cam.dolly) + Math.abs(p.cam.zoom - x.cam.zoom) < 0.004;
      });
      const worst = new Map<string, { inside: number; n: number }>();
      for (const x of late)
        for (const e of x.els) {
          if (e.parent || e.opacity < 0.5 || !LABELLED.has(e.kind) || e.rect.width * e.rect.height <= 0) continue;
          if (!byId.get(e.id)?.content.title && !byId.get(e.id)?.content.text) continue;
          const ix = Math.max(0, Math.min(W, e.rect.x + e.rect.width) - Math.max(0, e.rect.x));
          const iy = Math.max(0, Math.min(H, e.rect.y + e.rect.height) - Math.max(0, e.rect.y));
          const inside = (ix * iy) / (e.rect.width * e.rect.height);
          if (inside > 0.04 && inside < 0.97) {
            const w = worst.get(e.id) ?? { inside: 1, n: 0 };
            worst.set(e.id, { inside: Math.min(w.inside, inside), n: w.n + 1 });
          }
        }
      // a line of type whose box sits flush on the frame edge has its glyphs clipped (Arabic ascenders and
      // dots overhang the box): found on the voice film, where a re-composed headline ended at y = 1px
      const flush = new Map<string, number>();
      const m = 0.004 * Math.min(W, H);
      for (const x of late)
        for (const e of x.els) {
          if (e.parent || e.kind !== 'text' || e.opacity < 0.5 || e.rect.width * e.rect.height <= 0) continue;
          const r = e.rect;
          const fullyIn = r.x >= -1 && r.y >= -1 && r.x + r.width <= W + 1 && r.y + r.height <= H + 1;
          if (fullyIn && Math.min(r.x, r.y, W - r.x - r.width, H - r.y - r.height) < m) flush.set(e.id, (flush.get(e.id) ?? 0) + 1);
        }
      for (const [id, n] of flush) {
        if (n < 2 || worst.has(id)) continue;
        cutLabels.push(`${id} at the edge`);
        add({ layer: 'technical', code: 'TEXT_OFF_FRAME', severity: 'major', shot: s.id, dims: ['typography', 'composition'], evidence: `${id} sits flush on the frame edge after the shot settled: its glyphs are clipped`, fix: 'keep a margin between the type and the frame edge (wider end framing, re-composition)', elements: [id] });
      }
      for (const [id, w] of worst) {
        if (w.n < 2) continue;
        cutLabels.push(`${id} ${Math.round((1 - w.inside) * 100)}%`);
        add({ layer: 'technical', code: 'TEXT_OFF_FRAME', severity: w.inside < 0.75 ? 'critical' : 'major', shot: s.id, dims: ['typography', 'camera'], evidence: `${id} (a labelled ${byId.get(id)?.kind}) is cut by the frame edge after the shot settled (${Math.round((1 - w.inside) * 100)}% outside)`, fix: 'keep the labelled object inside the frame (wider end framing, re-composition) without losing the shot’s intent', elements: [id] });
      }
    }
  }
  check('LABELS_IN_FRAME', !cutLabels.length, 'critical', cutLabels.length ? `cut after settle: ${cutLabels.join(', ')}` : samples?.length ? 'every labelled object inside the frame once settled' : 'not measured (no DOM probes)');
  const coll = dom?.collisions ?? [];
  const critColl = coll.filter((c) => c.cls === 'critical');
  check('NO_CRITICAL_COLLISION', !critColl.length, 'critical', critColl.length ? critColl.map((c) => `${c.other} covers ${c.text} ${Math.round(c.overlap * 100)}%`).join('; ') : `${coll.length} overlap(s), none critical`);
  for (const c of coll) {
    if (c.cls === 'intentional' || c.cls === 'safe-overlap') continue;
    const code: CriticCode = c.cls === 'subject-obstruction' ? 'SUBJECT_OBSTRUCTION' : 'TEXT_COLLISION';
    const sev = c.cls === 'critical' ? 'critical' : c.cls === 'decorative-collision' ? 'minor' : c.overlap > 0.2 || c.sec > 0.6 ? 'major' : 'minor';
    add({ layer: c.cls === 'critical' ? 'technical' : 'visual', code, severity: sev, shot: c.shot, dims: ['composition', 'typography'], evidence: `${c.cls}: ${c.front ?? c.other} over ${c.front === c.text ? c.other : c.text} ${Math.round(c.overlap * 100)}% for ${c.sec}s${c.t0 !== undefined ? ` from ${c.t0}s` : ''}`, fix: 'separate the two (position, scale, depth or timing) without breaking the layout', elements: [c.text, c.other] });
  }
  const ctaEl = plan.elements.find((e) => e.shots.includes(last.id) && (e.content.role === 'cta' || e.kind === 'button'));
  const ctaOk = Boolean(ctaEl) || report.cta?.status === 'none' || report.cta?.status === 'override';
  check('CTA_PRESENT', ctaOk, 'major', ctaEl ? `${ctaEl.id} on stage at the end (${report.cta?.status ?? 'ok'})` : report.cta?.note ?? 'no CTA');
  if (!ctaOk) add({ layer: 'technical', code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['cta'], evidence: 'no CTA text or button on stage at the end' });
  if (report.cta?.status === 'enforced') add({ code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['cta'], evidence: `the closing shot had no CTA copy; added from the brief (${report.cta.added?.join(', ')})`, fix: 'author the CTA text and button in the closing shot cast' });
  const tp = input.textProblems ?? [];
  check('ARABIC_INTEGRITY', !tp.length, 'major', tp.length ? tp.map((p) => `${p.id}: ${p.problem}`).join('; ') : 'no split joins or overflowing lines reported');
  for (const p of tp) add({ layer: 'technical', code: 'POOR_ARABIC_LAYOUT', severity: 'major', dims: ['typography'], evidence: `${p.id}: ${p.problem}`, fix: 'enlarge the text box or shorten the copy (never split letters)' });
  const fallbacks = plan.transitions.filter((t) => t.status === 'fallback');
  check('TRANSITIONS_RESOLVED', !fallbacks.length, 'minor', fallbacks.length ? fallbacks.map((t) => `${t.requested}→${t.kind}: ${t.why}`).join('; ') : `${plan.transitions.length} transition(s) performed as written`);
  for (const t of fallbacks) add({ code: 'BROKEN_HANDOFF', severity: 'major', shot: t.from, dims: ['transitions', 'continuity'], evidence: `${t.requested} fell back to ${t.kind}: ${t.why}`, fix: 'fix the element named in the transition or choose a transition the element can perform' });
  if (input.voice && dom) {
    const missed = dom.words.filter((w) => !w.reacted);
    check('WORD_SYNC', missed.length <= dom.words.length / 2, 'major', `${dom.words.length - missed.length}/${dom.words.length} emphasised words reacted when spoken`);
    if (missed.length) add({ code: 'WORD_SYNC_MISSING', severity: missed.length > dom.words.length / 2 ? 'major' : 'minor', dims: ['audioSync', 'typography'], evidence: `${missed.length}/${dom.words.length} emphasised words did not visibly react (${missed.map((w) => w.word).join(', ')})` });
  }
  if (plan.ending) {
    const e = plan.ending;
    check('ENDING_HOLD', e.holdSec >= 0.6 && e.holdSec <= e.maxSec + 0.25, 'minor', `final hold ${e.holdSec}s (allowed ${e.maxSec}s)`);
    if (e.holdSec > e.maxSec + 0.25) add({ layer: 'technical', code: 'CTA_WEAKNESS', severity: 'minor', shot: last.id, dims: ['cta', 'motionChoreography'], evidence: `the final hold lasts ${e.holdSec}s (max ${e.maxSec}s)`, fix: `shorten the closing shot by ${r1(e.holdSec - e.maxSec)}s` });
    if (e.holdSec < 0.6) add({ layer: 'technical', code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['cta'], evidence: `the CTA rests only ${e.holdSec}s: it cannot be read`, fix: 'lengthen the closing shot' });
  }
  const technicalPass = checks.every((c) => c.pass || c.severity !== 'critical');

  // ═════ VISUAL LAYER: per shot (settle frame) ═════
  const shotVis: ShotVisual[] = [];
  const seen = new Map<string, SeenHierarchy>();
  for (const s of shots) {
    const t = settleTimeOf(plan, s.id);
    const smp = samples?.length ? nearest(samples.filter((x) => x.t >= s.start - 0.01 && x.t < s.end + 0.01), t) : undefined;
    const prev = smp && samples ? nearest(samples.filter((x) => x.t < smp.t - 0.05), smp.t - 0.2) : undefined;
    const comp = s.composition;
    const target = comp.target ?? [0, 0];
    const subjType = comp.subjectType;
    let subjectOcc: number;
    let contentOcc: number;
    let hier: SeenHierarchy | undefined;
    let basis: Basis = 'measured';
    let balanceOffset = 0;
    let minTextPx: number | undefined;
    let headlinePx: number | undefined;
    let typeRatio: number | undefined;
    let unreadable: string[] = [];
    let composition0Penalty = 0;
    if (smp) {
      hier = seenHierarchy(plan, s.id, smp, { W, H, rtl: plan.rtl, prev });
      seen.set(s.id, hier);
      const content = smp.els.filter((e) => !e.parent && e.opacity > 0.3 && e.kind !== 'cursor' && !(e.kind === 'shape' && e.rect.width >= W * 0.98 && e.rect.height >= H * 0.98));
      contentOcc = unionCover(content.map((e) => e.rect), W, H);
      const se = comp.subject ? smp.els.find((e) => e.id === comp.subject && e.opacity > 0.3) : undefined;
      subjectOcc = se ? unionCover([se.rect], W, H) : 0;
      // balance: the dominance-weighted centre of what is on screen
      const wsum = hier.elements.reduce((a, e) => a + e.score * e.area, 0);
      if (wsum > 0) {
        const cx = hier.elements.reduce((a, e) => { const r = smp.els.find((x) => x.id === e.id)!.rect; return a + (e.score * e.area * (r.x + r.width / 2)) / W; }, 0) / wsum;
        const cy = hier.elements.reduce((a, e) => { const r = smp.els.find((x) => x.id === e.id)!.rect; return a + (e.score * e.area * (r.y + r.height / 2)) / H; }, 0) / wsum;
        balanceOffset = Math.hypot(cx - 0.5, (cy - 0.5) * 0.8);
      }
      // typography: the rendered type sizes
      const texts = (smp.texts ?? []).filter((x) => x.opacity > 0.5 && x.px > 0);
      if (texts.length) {
        const sizes = texts.map((x) => x.px / H);
        minTextPx = Math.min(...texts.map((x) => x.px));
        const heads = texts.filter((x) => x.role === 'headline' || x.role === 'cta' || x.role === 'number');
        headlinePx = heads.length ? Math.max(...heads.map((x) => x.px)) : undefined;
        const sorted = [...new Set(sizes.map((v) => Math.round(v * 400) / 400))].sort((a, b) => b - a);
        typeRatio = sorted.length >= 2 ? r3(sorted[0] / sorted[1]) : undefined;
        unreadable = texts.filter((x) => x.px / H < (x.role === 'headline' || x.role === 'cta' ? 0.035 : 0.019)).map((x) => `${x.id || x.el} (${Math.round(x.px)}px)`);
      }
    } else {
      // no DOM: the composition engine's prediction (lower confidence)
      basis = 'heuristic';
      subjectOcc = comp.heroOccupancy;
      contentOcc = comp.totalOccupancy;
    }
    const negativeSpace = 1 - contentOcc;
    const logoShot = subjType === 'logo';
    const fillShot = subjType === 'ui' || subjType === 'image' || subjType === 'product'; // a full frame is the point
    // ── frame utilisation, in context (subject type × shot size); a row is judged as the row and each item
    const lo = Math.max(1e-3, target[0]);
    const hi = Math.max(lo, target[1]);
    const r = subjectOcc / lo;
    let fu = subjectOcc <= hi ? curve(r, [[0, 0.5], [0.35, 2], [0.6, 3.8], [0.8, 5.2], [1, 7]]) : curve(subjectOcc / hi, [[1, 7.4], [1.5, 7], [2.4, 5.5], [4, 4.5]]);
    if (subjectOcc >= lo && subjectOcc <= hi) fu = 7 + 1.2 * Math.min(1, (subjectOcc - lo) / Math.max(1e-3, (hi - lo) * 0.6));
    const contentScore = logoShot ? 7.5 : curve(contentOcc, [[0, 0.5], [0.08, 2], [0.15, 4], [0.25, 6.5], [0.35, 8], [0.62, 8.2], [0.8, 7], [0.95, 6]]);
    let frameUtilization = 0.65 * fu + 0.35 * contentScore;
    // ── hierarchy (seen dominance, never the metadata)
    let hierarchy = 6;
    if (hier) {
      if (hier.heroRank === 1) hierarchy = curve(hier.margin, [[1, 4.8], [1.12, 5.8], [1.3, 7], [1.6, 8.2], [2.4, 8.9]]);
      else if (hier.heroRank > 1) hierarchy = Math.max(1.5, 4 - (hier.heroRank - 2) * 0.8);
      else hierarchy = 1.5; // the subject is not on screen at its settle frame
      // a row of similar objects is judged when it IS the subject, or when the subject is only its connector (a path, a shape)
      const subjKind = byId.get(comp.subject ?? '')?.kind;
      const group = hier.groups.find((g) => g.ids.includes(comp.subject ?? '')) ?? (subjKind === 'line' || subjKind === 'shape' ? similarGroups(hier.elements.filter((e) => e.id !== comp.subject), 2).find((g) => g.meanArea * g.ids.length > 0.08) : undefined);
      if (group && !logoShot) {
        const ref = group.ids.includes(comp.subject ?? '') ? lo : OCCUPANCY_ITEM_MIN;
        hierarchy = Math.min(hierarchy, 4.8);
        frameUtilization = Math.min(frameUtilization, curve(group.meanArea / ref, [[0, 1], [0.6, 3.5], [1, 6], [1.6, 7]]));
        add({ code: 'ROW_OF_SMALL_OBJECTS', severity: group.meanArea < ref ? 'major' : 'minor', shot: s.id, dims: ['hierarchy', 'frameUtilization', 'composition'], evidence: `${group.ids.length} ${group.kind}s of equal weight (sizes within ×${group.sizeSpread}, each ${Math.round(group.meanArea * 100)}% of the frame; ${ref === lo ? `the hero target is ${Math.round(lo * 100)}–${Math.round(hi * 100)}%` : `the subject ${comp.subject} only connects them, each item needs ≥ ${Math.round(ref * 100)}%`})`, fix: 're-compose the row: one hero with supporting items, a cascade, or a focus sequence', elements: group.ids });
      }
      // supporting items read as a strip of thumbnails when each is tiny (a headline over a row/column of chips)
      const SUPPORT_ITEM_MIN = 0.02;
      const thumbs = !group && !logoShot ? hier.groups.find((g) => !g.ids.includes(comp.subject ?? '') && g.ids.length >= 3 && g.meanArea < SUPPORT_ITEM_MIN) : undefined;
      if (thumbs) {
        frameUtilization = Math.min(frameUtilization, curve(thumbs.meanArea / SUPPORT_ITEM_MIN, [[0, 2], [0.3, 3.5], [0.6, 5], [1, 6.5]]));
        add({ code: 'ROW_OF_SMALL_OBJECTS', severity: thumbs.meanArea < SUPPORT_ITEM_MIN / 2 ? 'major' : 'minor', shot: s.id, dims: ['frameUtilization', 'composition'], evidence: `${thumbs.ids.length} supporting ${thumbs.kind}s are thumbnails (each ${(thumbs.meanArea * 100).toFixed(1)}% of the frame; a readable supporting item needs ≥ ${SUPPORT_ITEM_MIN * 100}%)`, fix: 'give the supporting group a real tier (a row under the hero, a cluster, a sequence) or show fewer items larger', elements: thumbs.ids });
      }
      // supporting items of one kind covering each other once the shot has settled: one of them is partly lost
      // (a layout failure — or a displacement written for another layout — not a choice)
      {
        const sup = s.cast.filter((c) => (c.role === 'secondary' || c.role === 'support') && !['text', 'line', 'shape', 'cursor'].includes(byId.get(c.id)?.kind ?? '')).map((c) => c.id);
        const rest = samples!.filter((x) => x.t >= t - 0.01 && x.t <= s.end - 0.12);
        const worst = new Map<string, { ov: number; n: number }>();
        for (const x of rest)
          for (let a = 0; a < sup.length; a++)
            for (let b = a + 1; b < sup.length; b++) {
              if (byId.get(sup[a])?.kind !== byId.get(sup[b])?.kind) continue;
              const A = x.els.find((e) => e.id === sup[a] && !e.parent && e.opacity > 0.5)?.rect;
              const B = x.els.find((e) => e.id === sup[b] && !e.parent && e.opacity > 0.5)?.rect;
              if (!A || !B) continue;
              const ov = Math.max(0, Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x)) * Math.max(0, Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y));
              const small = Math.min(A.width * A.height, B.width * B.height);
              if (small <= 0 || ov / small <= 0.08) continue;
              const k = `${sup[a]}/${sup[b]}`;
              const w = worst.get(k) ?? { ov: 0, n: 0 };
              worst.set(k, { ov: Math.max(w.ov, ov / small), n: w.n + 1 });
            }
        const hidden = [...worst].filter(([, w]) => w.n >= 2).map(([k, w]) => ({ k, ov: w.ov }));
        if (hidden.length) {
          const top = Math.max(...hidden.map((h) => h.ov));
          composition0Penalty = Math.max(composition0Penalty, top > 0.3 ? (hidden.length > 1 ? 2.5 : 1.5) : 0.8);
          add({ code: 'ITEMS_OVERLAP', severity: 'major', shot: s.id, dims: ['composition'], evidence: `items of one kind cover each other at rest: ${hidden.slice(0, 3).map((h) => `${h.k} ${Math.round(h.ov * 100)}%`).join(', ')}`, fix: 're-compose the group so each item has its own place, or drop the displacement that drives one into another', elements: [...new Set(hidden.flatMap((h) => h.k.split('/')))] });
        }
      }
      if (hier.heroRank !== 1) add({ code: 'NO_DOMINANT_SUBJECT', severity: hier.heroRank === 0 ? 'major' : 'major', shot: s.id, dims: ['hierarchy', 'composition'], evidence: hier.heroRank === 0 ? `the subject ${comp.subject} is not on screen at the settle frame (${t}s)` : `the subject ${comp.subject} is read ${hier.heroRank}${hier.heroRank === 2 ? 'nd' : 'th'}: ${hier.readOrder.slice(0, 3).join(' → ')} (dominance)`, fix: 'make the subject the first read (size, position, contrast, isolation) or change the subject', elements: [comp.subject ?? '', hier.readOrder[0]].filter(Boolean) });
      else if (hier.margin < 1.15 && !group) add({ code: 'WEAK_HIERARCHY', severity: 'minor', shot: s.id, dims: ['hierarchy'], evidence: `the hero leads the next element by only ×${hier.margin} in dominance`, fix: 'separate the hero from the rest (scale, isolation, depth)', elements: [comp.subject ?? ''] });
    } else if (comp.totalOccupancy > 0 && comp.heroOccupancy / comp.totalOccupancy < 0.3) hierarchy = 5;
    // ── composition: negative space + balance
    const ns = logoShot || (fillShot && negativeSpace < 0.38) ? 7.5 : curve(negativeSpace, [[0.1, 4.5], [0.25, 6.5], [0.38, 8.2], [0.62, 8.2], [0.75, 6.5], [0.85, 4.5], [0.93, 2.5]]);
    const bal = curve(balanceOffset, [[0, 8.4], [0.1, 8.2], [0.17, 7], [0.24, 5.5], [0.32, 4]]);
    let composition = basis === 'measured' ? 0.55 * ns + 0.45 * bal : 0.5 * ns + 3.2;
    if (negativeSpace > 0.85 && !logoShot) add({ code: 'EXCESS_NEGATIVE_SPACE', severity: negativeSpace > 0.92 ? 'major' : 'minor', shot: s.id, dims: ['composition', 'frameUtilization'], evidence: `${Math.round(negativeSpace * 100)}% of the frame is empty at the settle frame`, fix: 'give the subject the space (closer framing or a larger hero), not more decoration' });
    if (negativeSpace < 0.12 && !fillShot) add({ code: 'CROWDED_FRAME', severity: 'minor', shot: s.id, dims: ['composition'], evidence: `only ${Math.round(negativeSpace * 100)}% of the frame is free`, fix: 'remove or delay a supporting element' });
    // a cast element pushed (mostly) out of a still frame: the layout lost it (a moving camera frames on purpose)
    if (smp && s.camera.move === 'static') {
      for (const c of s.cast) {
        const pe = byId.get(c.id);
        if (!pe || pe.kind === 'cursor' || c.role === 'background' || pe.life.from > t || pe.life.to < t) continue;
        const e = smp.els.find((x) => x.id === c.id && !x.parent);
        if (!e || e.opacity < 0.3 || e.rect.width * e.rect.height <= 0) continue;
        const ix = Math.max(0, Math.min(W, e.rect.x + e.rect.width) - Math.max(0, e.rect.x));
        const iy = Math.max(0, Math.min(H, e.rect.y + e.rect.height) - Math.max(0, e.rect.y));
        const inside = (ix * iy) / (e.rect.width * e.rect.height);
        if (inside < 0.6) composition0Penalty = Math.max(composition0Penalty, inside < 0.2 ? 2.5 : 1.2);
        if (inside < 0.6) add({ code: 'ELEMENT_OFF_FRAME', severity: inside < 0.2 ? 'major' : 'minor', shot: s.id, dims: ['composition', 'frameUtilization'], evidence: `${c.id} is ${Math.round((1 - inside) * 100)}% outside the frame at the settle frame (${t}s)`, fix: 're-compose so every cast element has a place in the frame, or drop it from the shot', elements: [c.id] });
      }
    }
    composition = Math.max(1, composition - composition0Penalty);
    if (balanceOffset > 0.24) add({ code: 'UNBALANCED', severity: 'minor', shot: s.id, dims: ['composition'], evidence: `the visual weight sits ${Math.round(balanceOffset * 100)}% off centre with nothing answering it`, fix: 'counterweight the heavy side or re-centre the group' });
    // ── typography (readability + hierarchy)
    let typography = 6.5;
    if (minTextPx !== undefined) {
      const head = headlinePx !== undefined ? curve(headlinePx / H, [[0.02, 2], [0.035, 4.5], [0.05, 6.5], [0.065, 7.8], [0.09, 8.6]]) : 6.5;
      const small = curve(minTextPx / H, [[0.01, 1.5], [0.019, 4], [0.024, 6], [0.03, 7.5], [0.04, 8.2]]);
      const ratio = typeRatio === undefined ? 7 : curve(typeRatio, [[1, 4.5], [1.2, 5.8], [1.4, 7.2], [1.8, 8.2], [3, 8.5]]);
      typography = 0.4 * head + 0.35 * small + 0.25 * ratio;
      if (unreadable.length) add({ code: 'UNREADABLE_TEXT', severity: 'major', shot: s.id, dims: ['typography', 'commercialPolish'], evidence: `too small to read on a phone: ${unreadable.slice(0, 4).join(', ')}`, fix: 'give the copy a larger box (fewer, larger items) — never shrink the type', elements: unreadable.map((x) => x.split(' ')[0]) });
      if (typeRatio !== undefined && typeRatio < 1.15) add({ code: 'FLAT_TYPOGRAPHY', severity: 'minor', shot: s.id, dims: ['typography', 'hierarchy'], evidence: `the two largest type sizes differ only ×${typeRatio}`, fix: 'one line leads, the rest supports' });
    }
    // ── cleanliness (collisions / off-frame in this shot)
    const dirt = issues.filter((i) => i.shot === s.id && (i.code === 'TEXT_COLLISION' || i.code === 'SUBJECT_OBSTRUCTION' || i.code === 'TEXT_OFF_FRAME')).reduce((a, i) => a + PENALTY[i.severity] * 1.4, 0);
    const cleanliness = clamp(8.5 - dirt);
    composition = clamp(composition);
    frameUtilization = clamp(frameUtilization);
    const sc = { frameUtilization: r1(frameUtilization), hierarchy: r1(hierarchy), composition: r1(composition), typography: r1(typography), cleanliness: r1(cleanliness) };
    let ov = 0.24 * sc.frameUtilization + 0.28 * sc.hierarchy + 0.2 * sc.composition + 0.18 * sc.typography + 0.1 * sc.cleanliness;
    ov = Math.min(ov, Math.min(...Object.values(sc)) + 3);
    // a lost element (covered by its neighbour, or out of a still frame) caps the shot below "good": the viewer misses it
    if (issues.some((i) => i.shot === s.id && i.severity !== 'minor' && ((i.code === 'ITEMS_OVERLAP' && / (3\d|[4-9]\d|100)%/.test(i.evidence)) || i.code === 'ELEMENT_OFF_FRAME'))) ov = Math.min(ov, 5.5);
    if (subjType && subjectOcc < lo * 0.6 && !(hier?.groups.some((g) => g.ids.includes(comp.subject ?? '')))) add({ code: 'TINY_SUBJECT', severity: subjectOcc < lo * 0.35 ? 'major' : 'minor', shot: s.id, dims: ['frameUtilization', 'hierarchy'], evidence: `subject ${comp.subject} fills ${Math.round(subjectOcc * 100)}% of the frame (target ${Math.round(lo * 100)}–${Math.round(hi * 100)}% for a ${subjType} at a ${comp.shotSize} size)`, fix: 'review the shot strategy (shot size, number of elements, focus) before scaling', elements: [comp.subject ?? ''] });
    if (contentOcc < 0.1 && !logoShot && !(s.id === last.id && plan.ending && plan.ending.holdSec <= plan.ending.maxSec)) add({ code: 'EMPTY_COMPOSITION', severity: 'major', shot: s.id, dims: ['composition', 'frameUtilization'], evidence: `only ${Math.round(contentOcc * 100)}% of the frame carries anything`, fix: 'frame closer or give the subject the space' });
    shotVis.push({
      shot: s.id,
      purpose: s.purpose,
      t: smp?.t ?? t,
      scores: sc,
      overall: r1(Math.min(AUTO_CAP, ov)),
      band: bandOf(ov),
      measured: { subjectOcc: r3(subjectOcc), contentOcc: r3(contentOcc), target, negativeSpace: r3(negativeSpace), balanceOffset: r3(balanceOffset), minTextPx: minTextPx !== undefined ? Math.round(minTextPx) : undefined, headlinePx: headlinePx !== undefined ? Math.round(headlinePx) : undefined, typeRatio },
      hierarchy: hier ? { readOrder: hier.readOrder, heroRank: hier.heroRank, margin: hier.margin, groups: hier.groups, firstRead: hier.readOrder[0], secondRead: hier.readOrder[1], thirdRead: hier.readOrder[2] } : undefined,
      basis,
    });
  }

  // ═════ VISUAL LAYER: film dimensions ═════
  const durOf = (id: string) => { const s = allShots.find((x) => x.id === id)!; return s.end - s.start; };
  const shotDim = (k: keyof ShotVisual['scores'], minW = 0.4) => {
    if (!shotVis.length) return 5;
    const m = wmean(shotVis.map((x) => ({ v: x.scores[k], w: durOf(x.shot) })));
    const lo = Math.min(...shotVis.map((x) => x.scores[k]));
    return (1 - minW) * m + minW * lo;
  };
  const sv = (score: number, basis: Basis, confidence: number, evidence: string[]): DimScore => { if (!Number.isFinite(score)) throw new Error(`critic: non-finite score (${evidence.join("; ")})`); return ({ score: r1(clamp(score, 0, AUTO_CAP)), band: bandOf(clamp(score, 0, 10)), basis, confidence, evidence }); };
  const shotBasis: Basis = shotVis.every((x) => x.basis === 'measured') && shotVis.length ? 'measured' : 'heuristic';
  const conf = shotBasis === 'measured' ? 0.8 : 0.45;
  const scores = {} as Record<VisualDimension, DimScore>;
  scores.composition = sv(shotDim('composition', 0.35), shotBasis, conf, shotVis.map((x) => `${x.shot}: ${x.scores.composition} (free ${Math.round(x.measured.negativeSpace * 100)}%, balance offset ${x.measured.balanceOffset})`));
  scores.hierarchy = sv(shotDim('hierarchy', 0.45), shotBasis, conf, shotVis.map((x) => `${x.shot}: ${x.scores.hierarchy}${x.hierarchy ? ` (hero rank ${x.hierarchy.heroRank}, margin ×${x.hierarchy.margin})` : ''}`));
  scores.frameUtilization = sv(shotDim('frameUtilization', 0.45), shotBasis, conf, shotVis.map((x) => `${x.shot}: ${x.scores.frameUtilization} (subject ${Math.round(x.measured.subjectOcc * 100)}% vs ${Math.round(x.measured.target[0] * 100)}–${Math.round(x.measured.target[1] * 100)}%, content ${Math.round(x.measured.contentOcc * 100)}%)`));
  scores.typography = sv(shotDim('typography', 0.5) - (issues.some((i) => i.code === 'POOR_ARABIC_LAYOUT') ? 2 : 0), shotVis.some((x) => x.measured.minTextPx !== undefined) ? 'measured' : 'heuristic', conf, shotVis.filter((x) => x.measured.minTextPx !== undefined).map((x) => `${x.shot}: smallest ${x.measured.minTextPx}px, headline ${x.measured.headlinePx ?? '—'}px, ratio ×${x.measured.typeRatio ?? '—'}`));

  // ── motion choreography: element motion vs stillness, causality, camera dependency
  const compiled = (() => {
    try {
      return compileChoreo(plan.choreo);
    } catch {
      return null;
    }
  })();
  const total = allShots[n - 1].end - allShots[0].start;
  const step = 0.1;
  let elT = 0;
  let camOnly = 0;
  let anyT = 0;
  if (compiled) {
    for (let t = 0; t < total; t += step) {
      const live = compiled.spans.filter((sp) => sp.start <= t && sp.end > t);
      const el = live.some((sp) => sp.target && sp.target !== CAMERA_KEY);
      const cam = live.some((sp) => sp.target === CAMERA_KEY && Object.keys(sp.props).some((k) => k !== 'o'));
      if (el) elT += step;
      if (cam && !el) camOnly += step;
      if (el || cam) anyT += step;
    }
  }
  const cameraDependency = anyT > 0 ? r3(camOnly / anyT) : 0;
  const elementMotionShare = total > 0 ? r3(elT / total) : 0;
  const still = dom?.still.share ?? input.pixel?.stillFrameRatio;
  let motion = still !== undefined ? curve(still, [[0.05, 7.2], [0.15, 8], [0.25, 7.2], [0.33, 6], [0.42, 4.8], [0.55, 3.5], [0.7, 2]]) : 5;
  const causal = report.causality.filter((c) => c.t >= 0).length;
  if (causal >= Math.max(2, n / 2)) motion += 0.5;
  if (dom) {
    for (const r of dom.still.runs) {
      const len = r.t1 - r.t0;
      const inEnding = plan.ending && r.t0 >= plan.ending.settleAt - 0.1;
      const allowed = inEnding ? plan.ending!.maxSec : 1.0;
      if (len > allowed + 0.15) {
        const sh = allShots.find((s) => r.t0 >= s.start && r.t0 < s.end);
        add({ code: 'DEAD_HOLD', severity: len > allowed + 1 ? 'major' : 'minor', shot: sh?.id, dims: ['motionChoreography', 'rhythm'], evidence: `nothing moves for ${r1(len)}s (${r1(r.t0)}–${r1(r.t1)}s)${inEnding ? ` — the ending hold is allowed ${plan.ending!.maxSec}s` : ''}`, fix: inEnding ? 'shorten the closing shot' : 'a reasoned event in that window (or a shorter shot) — not decoration' });
      }
    }
    if (dom.still.share > 0.3) add({ code: 'UNDER_ANIMATION', severity: 'major', dims: ['motionChoreography'], evidence: `${Math.round(dom.still.share * 100)}% of the film is still on the DOM` });
    const visible = dom.elements.filter((e) => e.visibleSec > 0.5 && e.kind !== 'cursor');
    const busy = visible.length ? mean(visible.map((e) => e.movingSec / e.visibleSec)) : 0;
    if (dom.still.share < 0.03 && busy > 0.75) {
      motion = Math.min(motion, 6);
      add({ code: 'OVER_ANIMATION', severity: 'minor', dims: ['motionChoreography', 'commercialPolish'], evidence: `elements move ${Math.round(busy * 100)}% of the time they are visible; the eye never rests`, fix: 'let readable text settle' });
    }
    for (const sub of dom.subjects) {
      const sh = allShots.find((s) => s.id === sub.shot)!;
      const len = sh.end - sh.start;
      if (sub.subject && sub.movingSec < Math.min(0.5, len * 0.12) && sh.camera.move === 'static' && sh.id !== last.id) add({ code: 'POWERPOINT_FEELING', severity: 'minor', shot: sh.id, dims: ['motionChoreography', 'storytelling'], evidence: `the subject ${sub.subject} moves ${sub.movingSec}s of ${r1(len)}s and the camera is static`, fix: 'a causal event on the subject tied to the message' });
    }
  }
  if (cameraDependency > 0.35) {
    motion -= curve(cameraDependency, [[0.35, 0.3], [0.6, 1.5]]);
    add({ code: 'CAMERA_DEPENDENCY', severity: cameraDependency > 0.55 ? 'major' : 'minor', dims: ['motionChoreography', 'camera'], evidence: `the camera is the only thing moving in ${Math.round(cameraDependency * 100)}% of the moving time`, fix: 'let the elements carry part of that energy (handoffs, causal events)' });
  }
  scores.motionChoreography = sv(motion, dom ? 'measured' : 'heuristic', dom ? 0.75 : 0.4, [`still ${still !== undefined ? Math.round(still * 100) + '%' : '—'}`, `element motion ${Math.round(elementMotionShare * 100)}% of the film`, `camera-only ${Math.round(cameraDependency * 100)}% of the moving time`, `${causal} causal links`]);

  // ── transitions (measured through the cut when transition_quality is present)
  const tr = plan.transitions;
  const objectShare = tr.length ? tr.filter((t) => t.status === 'object').length / tr.length : 0;
  let trScore = tr.length ? 4.5 + 3 * objectShare : 6;
  if (tr.length && objectShare < 0.4) add({ code: 'GENERIC_TRANSITIONS', severity: 'major', dims: ['transitions', 'continuity'], evidence: `${Math.round(objectShare * 100)}% of the cuts are performed by an element`, fix: 'an element both shots need performs the cut' });
  const tq = input.transitions ?? null;
  if (tq?.length) {
    trScore = 0.4 * trScore + 0.6 * mean(tq.map((q) => q.score));
    for (const q of tq)
      for (const i of q.issues)
        add({ code: i.code as CriticCode, severity: i.severity, shot: q.from, dims: ['transitions'], evidence: `${q.from} → ${q.to} (${q.kind}): ${i.evidence}`, fix: i.code === 'EMPTY_TRANSITION_FRAME' || i.code === 'VISUAL_VOID' ? 'keep the frame carried through the cut: overlap the incoming hero earlier, or shorten / rescale the transition' : 'clean the cut', elements: [q.element ?? ''].filter(Boolean) });
  }
  scores.transitions = sv(trScore, tq?.length ? 'measured' : 'heuristic', tq?.length ? 0.75 : 0.4, tq?.length ? tq.map((q) => `${q.from}→${q.to} ${q.kind}: ${q.score} (content ${Math.round(q.pre * 100)}→${Math.round(q.min * 100)}→${Math.round(q.post * 100)}%)`) : [`${Math.round(objectShare * 100)}% object transitions (no frame measurement)`]);

  // ── continuity
  let linked = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = allShots[i];
    const b = allShots[i + 1];
    const shared = plan.elements.some((e) => e.shots.includes(a.id) && e.shots.includes(b.id));
    const obj = tr.some((t) => t.from === a.id && t.status === 'object');
    const hand = plan.handoffs.some((h) => h.t >= a.start && h.t <= b.start + 0.8 && h.kind !== 'camera');
    if (shared || obj || hand) linked++;
    else add({ code: 'DISCONNECTED_SHOTS', severity: 'major', shot: a.id, dims: ['continuity', 'transitions'], evidence: `${a.id} → ${b.id}: no element continues, no object transition, no energy handoff`, fix: 'carry one element across or hand the exit energy to the next hero' });
  }
  const linkShare = n > 1 ? linked / (n - 1) : 1;
  const broken = issues.filter((i) => i.code === 'BROKEN_CONTINUITY').length;
  scores.continuity = sv(4 + 4.3 * linkShare - broken * 1.5, 'measured', 0.7, [`${linked}/${n - 1} shot boundaries carried by an element, an object transition or a handoff`, `${plan.elements.filter((e) => e.shots.length > 1).length} persistent elements`]);

  // ── camera: every move must justify itself on screen
  const moves = allShots.filter((s) => s.camera.move !== 'static');
  const camMoves: CriticReport['measures']['cameraMoves'] = [];
  for (const s of moves) {
    const d = dom?.camera.shots.find((x) => x.shot === s.id);
    const ts = d?.targetScale ?? s.camera.visible?.scale;
    const sh = d?.targetShift ?? s.camera.visible?.shift ?? 0;
    const bg = d?.bgScale ?? s.camera.visible?.bgScale ?? 1;
    const change = ts !== undefined ? Math.max(Math.abs(Math.log(ts)), sh * 2.2) : 0;
    let ms = curve(change, [[0, 2], [0.05, 3.5], [0.12, 5.5], [0.22, 7], [0.4, 8.2], [0.8, 8.6]]);
    if (!s.camera.target || !s.camera.reason) {
      ms -= 2;
      add({ code: 'RANDOM_CAMERA', severity: 'major', shot: s.id, dims: ['camera'], evidence: `camera "${s.camera.move}" without ${!s.camera.target ? 'a target' : 'a reason'}`, fix: 'give the move a stage target and a reason, or let the elements carry the shot' });
    }
    const parallax = ts !== undefined ? Math.abs(Math.log(ts) - Math.log(bg)) : 0;
    if (parallax > 0.12) ms += 0.4;
    const visible = d ? d.visible : change > 0.08;
    // could the elements have done it? a small change with no depth and no reveal = replaceable
    const replaceable = change < 0.22 && parallax < 0.12;
    if (!visible) add({ code: 'CAMERA_NO_VISIBLE_EFFECT', severity: 'major', shot: s.id, dims: ['camera', 'motionChoreography'], evidence: d?.note ?? `the target changes ×${ts ?? '?'}`, fix: 'reframe so the move shows on its target, or replace it with element motion' });
    else if (replaceable) add({ code: 'CAMERA_REPLACEABLE', severity: 'minor', shot: s.id, dims: ['camera'], evidence: `the move changes its target only ×${ts ?? '?'} with no depth: element motion could do the same`, fix: 'prefer element motion here, or make the move reveal / focus something' });
    camMoves.push({ shot: s.id, score: r1(clamp(ms, 0, 9)), visible, replaceable, note: d?.note ?? `analytic ×${ts ?? '?'}` });
  }
  for (let i = 1; i < moves.length; i++) {
    const a = moves[i - 1];
    const b = moves[i];
    if (a.camera.move === b.camera.move && allShots.indexOf(b) - allShots.indexOf(a) === 1) add({ code: 'REPETITIVE_RHYTHM', severity: 'minor', shot: b.id, dims: ['camera', 'rhythm'], evidence: `the same camera move (${b.camera.move}) twice in a row`, fix: 'vary the move or let one shot be static' });
  }
  const share = moves.length / Math.max(1, n);
  const budget = direction?.camera.budget;
  if (budget ? share > budget.maxMovingShare + 1e-6 : share > 0.6) add({ code: 'CAMERA_OVERUSE', severity: share > 0.8 ? 'critical' : 'major', dims: ['camera', 'motionChoreography'], evidence: `camera moves in ${moves.length}/${n} shots (${Math.round(share * 100)}%)${budget ? `; direction budget ${Math.round(budget.maxMovingShare * 100)}%` : ''}`, fix: 'the move with the least visible effect becomes element motion' });
  let cam = moves.length ? mean(camMoves.map((m) => m.score)) : 6.8;
  if (budget && share > budget.maxMovingShare + 1e-6) cam -= 1.5;
  if (cameraDependency > 0.55) cam -= 1;
  scores.camera = sv(cam, dom ? 'measured' : 'heuristic', dom ? 0.75 : 0.5, moves.length ? camMoves.map((m) => `${m.shot}: ${m.score} — ${m.note}${m.replaceable ? ' (replaceable)' : ''}`) : ['no camera move: the elements carry the film (neutral, not a merit)']);

  // ── audio / motion sync
  if (input.voice && dom) {
    const words = dom.words;
    const ok = words.length ? words.filter((w) => w.reacted).length / words.length : 0;
    const anchored = report.causality.length;
    scores.audioSync = sv(words.length ? 3.5 + 4.5 * ok + (anchored ? 0.4 : 0) : 5, 'measured', 0.7, [`${words.filter((w) => w.reacted).length}/${words.length} emphasised words reacted when spoken`]);
  } else scores.audioSync = { score: 0, band: 'weak', basis: 'n/a', confidence: 0, evidence: ['no voice: not judged (excluded from the overall)'] };

  // ── rhythm: planned vs measured energy, contrast in motion
  const scripted = allShots.map((s) => s.energy ?? 0.6);
  const flatScript = scripted.every((e) => Math.abs(e - 0.6) < 1e-6);
  const planned = allShots.map((s, i) => (flatScript ? PURPOSE_ENERGY[s.purpose ?? ''] ?? 0.6 : scripted[i]));
  const energy: CriticReport['measures']['energy'] = [];
  if (samples?.length) {
    for (const [i, s] of allShots.entries()) {
      const inShot = samples.filter((x) => x.t >= s.start && x.t < s.end).sort((a, b) => a.t - b.t);
      let e = 0;
      let k = 0;
      for (let j = 1; j < inShot.length; j++) {
        const a = inShot[j - 1];
        const b = inShot[j];
        const dt = b.t - a.t;
        if (dt <= 0 || dt > 0.3) continue;
        let m = 0;
        for (const x of b.els) {
          if (x.parent || x.opacity < 0.2) continue;
          const y = a.els.find((q) => q.id === x.id);
          if (!y) {
            m += 0.02;
            continue;
          }
          m += Math.hypot(x.rect.x - y.rect.x, x.rect.y - y.rect.y) / Math.hypot(W, H) + Math.abs(Math.log(Math.max(1, x.rect.width) / Math.max(1, y.rect.width))) * 0.4 + Math.abs(x.opacity - y.opacity) * 0.05;
        }
        e += Math.min(1, (m / dt) * 1.6);
        k++;
      }
      energy.push({ shot: s.id, planned: planned[i], measured: r3(k ? e / k : 0) });
    }
  }
  let rhythm = 5.5;
  let rho: number | undefined;
  let contrast: number | undefined;
  if (energy.length >= 3) {
    const m = energy.map((e) => e.measured);
    const mx = Math.max(...m, 1e-6);
    const norm = m.map((x) => x / mx);
    rho = r3(spearman(energy.map((e) => e.planned), m));
    contrast = r3(Math.sqrt(mean(norm.map((x) => (x - mean(norm)) ** 2))));
    rhythm = 4.5 + 2.2 * Math.max(0, rho) + curve(contrast, [[0.05, -0.5], [0.12, 0.6], [0.22, 1.5], [0.35, 1.8]]);
    if (contrast < 0.1) add({ code: 'FLAT_ENERGY', severity: 'minor', dims: ['rhythm'], evidence: `every shot moves with about the same energy (spread ${Math.round(contrast * 100)}%)`, fix: 'contrast in motion: let a calm shot follow a busy one' });
    if (rho < 0) add({ code: 'ENERGY_MISMATCH', severity: 'minor', dims: ['rhythm', 'storytelling'], evidence: `measured energy runs against the planned curve (ρ ${rho})`, fix: 'move the energy to the shots whose job needs it (hook, reveal)' });
  }
  const lens = allShots.map((s) => s.end - s.start);
  const lm = mean(lens);
  const cv = Math.sqrt(mean(lens.map((l) => (l - lm) ** 2))) / Math.max(1e-6, lm);
  if (n >= 4 && cv < 0.08) {
    rhythm -= 0.7;
    add({ code: 'REPETITIVE_RHYTHM', severity: 'minor', dims: ['rhythm'], evidence: `shot lengths vary only ${Math.round(cv * 100)}%`, fix: 'shorten a bridge shot and let the hero shot breathe' });
  }
  scores.rhythm = sv(rhythm, energy.length >= 3 ? 'measured' : 'heuristic', energy.length >= 3 ? 0.6 : 0.3, [`planned vs measured energy ρ ${rho ?? '—'}`, `energy contrast ${contrast ?? '—'}`, `shot length variation ${Math.round(cv * 100)}%`]);

  // ── storytelling (heuristic: metaphors shown, causal chains, a narrative arc)
  const metaphors = direction?.metaphors ?? [];
  const usedMeta = metaphors.filter((m) => allShots.some((s) => s.metaphor === m.id)).length;
  const arc = (allShots[0].purpose === 'hook' || allShots[0].purpose === 'problem' || allShots[0].purpose === 'pain' ? 1 : 0) + (last.purpose === 'cta' ? 1 : 0);
  let story = 3.8 + (metaphors.length ? 2 * (usedMeta / metaphors.length) : 0.6) + Math.min(1.4, causal * 0.25) + arc * 0.4;
  for (const v of report.direction?.violations ?? []) {
    story -= 0.4;
    add({ code: 'MOTION_WITHOUT_REASON', severity: 'minor', dims: ['storytelling'], evidence: `direction: ${v}` });
  }
  scores.storytelling = sv(Math.min(7.8, story), 'heuristic', 0.35, [`${usedMeta}/${metaphors.length} direction metaphors shown`, `${causal} causal links`, arc === 2 ? 'opens on a hook / problem and closes on the CTA' : 'the arc is incomplete']);

  // ── brand presence (measured: the logo on screen, how big, at the end)
  const logo = plan.elements.find((e) => e.kind === 'image' && /logo/.test(e.id + String(e.content.asset ?? '')));
  if (logo && samples?.length) {
    const areas = samples.map((x) => x.els.find((e) => e.id === logo.id && e.opacity > 0.5)).filter(Boolean).map((e) => unionCover([e!.rect], W, H));
    const peak = areas.length ? Math.max(...areas) : 0;
    const endS = nearest(samples, last.end - 0.1);
    const atEnd = Boolean(endS?.els.some((e) => e.id === logo.id && e.opacity > 0.5));
    const visShare = areas.length / samples.length;
    let b = curve(peak, [[0, 1], [0.004, 3.5], [0.012, 5.5], [0.03, 7], [0.06, 8]]) + (atEnd ? 0.6 : -1.2) + (visShare > 0.3 ? 0.3 : 0);
    if (!atEnd || peak < 0.012) add({ code: 'WEAK_BRAND_PRESENCE', severity: 'minor', shot: last.id, dims: ['brand'], evidence: `logo peak ${Math.round(peak * 1000) / 10}% of the frame${atEnd ? '' : ', not on screen at the end'}`, fix: 'give the brand one moment where it is the first read, and sign the ending' });
    b = Math.min(b, 8.6);
    scores.brand = sv(b, 'measured', 0.7, [`logo visible ${Math.round(visShare * 100)}% of the samples, peak ${Math.round(peak * 1000) / 10}% of the frame`, atEnd ? 'signs the ending' : 'absent at the end']);
  } else scores.brand = logo ? sv(6, 'heuristic', 0.3, ['logo on stage (not measured)']) : { score: 0, band: 'weak', basis: 'n/a', confidence: 0, evidence: ['no logo asset: not judged'] };

  // ── CTA composition (measured at the last settle frame)
  const endShot = shotVis.find((x) => x.shot === last.id);
  if (ctaEl && samples?.length) {
    const fin = nearest(samples, Math.max(last.start, (plan.ending?.settleAt ?? last.end - 0.6) + 0.2));
    const ctaTexts = (fin?.texts ?? []).filter((x) => x.opacity > 0.5 && (x.role === 'cta' || x.role === 'headline'));
    const ctaPx = ctaTexts.length ? Math.max(...ctaTexts.map((x) => x.px)) : 0;
    const btn = fin?.els.find((e) => e.kind === 'button' && e.opacity > 0.5);
    const txt = fin?.els.find((e) => (byId.get(e.id)?.content.role === 'cta' || byId.get(e.id)?.content.role === 'headline') && e.kind === 'text' && e.opacity > 0.5);
    const gap = btn && txt ? Math.max(0, Math.max(btn.rect.x, txt.rect.x) - Math.min(btn.rect.x + btn.rect.width, txt.rect.x + txt.rect.width), Math.max(btn.rect.y, txt.rect.y) - Math.min(btn.rect.y + btn.rect.height, txt.rect.y + txt.rect.height)) / H : 1;
    const count = fin ? fin.els.filter((e) => !e.parent && e.opacity > 0.5 && e.kind !== 'cursor').length : 9;
    const first = endShot?.hierarchy?.firstRead;
    const firstOk = Boolean(first && (first === ctaEl.id || byId.get(first)?.content.role === 'cta' || byId.get(first)?.kind === 'button' || byId.get(first)?.content.role === 'headline'));
    let c = curve(ctaPx / H, [[0, 1], [0.035, 4], [0.055, 6], [0.075, 7.4], [0.1, 8.2]]) * 0.45 + curve(gap, [[0, 8], [0.06, 8], [0.14, 6.5], [0.3, 4]]) * 0.25 + (firstOk ? 8 : 4.5) * 0.2 + curve(count, [[2, 8], [4, 8], [6, 6.5], [8, 5]]) * 0.1;
    if (!btn) c -= 1;
    if (plan.ending && plan.ending.holdSec < 0.6) c -= 2;
    if (c < 6) add({ code: 'WEAK_CTA_COMPOSITION', severity: 'major', shot: last.id, dims: ['cta', 'commercialPolish'], evidence: `CTA type ${Math.round(ctaPx)}px, action ${btn ? `${Math.round(gap * 100)}% of the height away` : 'missing'}, first read ${first ?? '—'}, ${count} elements on screen`, fix: 'one clear lock-up: the action line leads, the button sits with it, the brand signs, nothing else competes', elements: [ctaEl.id] });
    scores.cta = sv(c, 'measured', 0.7, [`CTA type ${Math.round(ctaPx)}px (${Math.round((ctaPx / H) * 1000) / 10}% of the height)`, btn ? `button ${Math.round(gap * 100)}% of the height from the line` : 'no button', `first read: ${first ?? '—'}`, `${count} elements on screen`]);
  } else scores.cta = ctaEl ? sv(5.5, 'heuristic', 0.3, ['CTA on stage (not measured)']) : sv(2, 'measured', 0.6, ['no CTA on stage at the end']);

  // ── commercial polish: a defined checklist; what cannot be measured is marked heuristic
  const commercial: CriticReport['measures']['commercial'] = [];
  const item = (name: string, pass: boolean, basis: Basis, note: string) => commercial.push({ item: name, pass, basis, note });
  item('brand clarity', scores.brand.basis !== 'n/a' ? scores.brand.score >= 6 : true, scores.brand.basis === 'n/a' ? 'n/a' : 'measured', scores.brand.evidence.join('; '));
  const prod = shotVis.find((x) => ['ui', 'product', 'image'].includes(allShots.find((s) => s.id === x.shot)!.composition.subjectType ?? ''));
  item('product / service clarity', prod ? prod.scores.frameUtilization >= 6.5 : false, prod ? 'measured' : 'heuristic', prod ? `${prod.shot}: subject ${Math.round(prod.measured.subjectOcc * 100)}% of the frame` : 'no product / interface shot');
  item('CTA clarity', scores.cta.score >= 6.5, scores.cta.basis, scores.cta.evidence.join('; '));
  item('professional spacing', shotVis.every((x) => x.scores.composition >= 6), shotBasis, `lowest composition ${Math.min(...shotVis.map((x) => x.scores.composition), 10)}`);
  item('typography polish', scores.typography.score >= 6.5 && !issues.some((i) => i.code === 'UNREADABLE_TEXT'), scores.typography.basis, `typography ${scores.typography.score}`);
  item('motion consistency', !issues.some((i) => i.code === 'OVER_ANIMATION' || i.code === 'CAMERA_DEPENDENCY' && i.severity === 'major'), 'heuristic', 'one motion language: no over-animation, the camera does not carry the film alone');
  item('transition polish', scores.transitions.score >= 6.5 && !issues.some((i) => i.code === 'EMPTY_TRANSITION_FRAME' || i.code === 'VISUAL_VOID' || i.code === 'FLASH_FRAME'), scores.transitions.basis, `transitions ${scores.transitions.score}`);
  item('visual hierarchy', scores.hierarchy.score >= 6.5, scores.hierarchy.basis, `hierarchy ${scores.hierarchy.score}`);
  item('no accidental collisions', !issues.some((i) => (i.code === 'TEXT_COLLISION' || i.code === 'SUBJECT_OBSTRUCTION') && i.severity !== 'minor'), dom ? 'measured' : 'heuristic', `${coll.filter((c) => c.cls !== 'intentional' && c.cls !== 'safe-overlap').length} unintended overlap(s)`);
  item('no dead ending', !issues.some((i) => i.code === 'CTA_WEAKNESS' && /hold/.test(i.evidence)) && !issues.some((i) => i.code === 'DEAD_HOLD' && i.shot === last.id), dom ? 'measured' : 'heuristic', plan.ending ? `hold ${plan.ending.holdSec}s / ${plan.ending.maxSec}s` : '—');
  const rows = shotVis.filter((x) => x.hierarchy?.groups.length).length;
  item('no placeholder feeling', !issues.some((i) => i.code === 'UNREADABLE_TEXT' || i.code === 'EMPTY_COMPOSITION'), 'heuristic', 'no unreadable labels, no empty frames');
  const tmpl = rows >= 2 || shotVis.filter((x) => x.hierarchy && x.hierarchy.margin < 1.15).length >= Math.max(2, shotVis.length / 2);
  item('no generic template feeling', !tmpl, 'heuristic', tmpl ? 'repeated equal-weight rows / flat hierarchies' : 'shots have distinct, led compositions');
  if (tmpl) add({ code: 'TEMPLATE_FEELING', severity: 'minor', dims: ['commercialPolish', 'hierarchy'], evidence: `${rows} shot(s) built as equal rows; flat hierarchy in ${shotVis.filter((x) => x.hierarchy && x.hierarchy.margin < 1.15).length}`, fix: 'lead every shot with one thing' });
  const applicable = commercial.filter((c) => c.basis !== 'n/a');
  const wPass = applicable.reduce((a, c) => a + (c.pass ? (c.basis === 'heuristic' ? 0.5 : 1) : 0), 0);
  const wAll = applicable.reduce((a, c) => a + (c.basis === 'heuristic' ? 0.5 : 1), 0);
  scores.commercialPolish = sv(2.5 + 6 * (wAll ? wPass / wAll : 0), 'heuristic', 0.5, commercial.map((c) => `${c.pass ? '✓' : '✗'} ${c.item} [${c.basis}]`));

  // ── issue penalties on the dimension that owns them (first dim full, others half)
  // codes whose evidence is already IN a measured score (shot scores, transition curves) are not charged twice
  const IN_SCORE = new Set<CriticCode>(['ELEMENT_OFF_FRAME', 'ITEMS_OVERLAP', 'TEXT_COLLISION', 'SUBJECT_OBSTRUCTION', 'TEXT_OFF_FRAME', 'TINY_SUBJECT', 'ROW_OF_SMALL_OBJECTS', 'NO_DOMINANT_SUBJECT', 'WEAK_HIERARCHY', 'EXCESS_NEGATIVE_SPACE', 'CROWDED_FRAME', 'UNBALANCED', 'UNREADABLE_TEXT', 'FLAT_TYPOGRAPHY', 'EMPTY_COMPOSITION', 'EMPTY_TRANSITION_FRAME', 'VISUAL_VOID', 'FLASH_FRAME', 'OVERLAP_TRANSITION', 'CAMERA_NO_VISIBLE_EFFECT', 'CAMERA_DEPENDENCY', 'WEAK_CTA_COMPOSITION', 'WEAK_BRAND_PRESENCE', 'FLAT_ENERGY', 'ENERGY_MISMATCH', 'TEMPLATE_FEELING', 'DISCONNECTED_SHOTS', 'GENERIC_TRANSITIONS', 'RANDOM_CAMERA', 'MOTION_WITHOUT_REASON', 'OVER_ANIMATION']);
  for (const i of issues) {
    if (IN_SCORE.has(i.code)) continue;
    if (i.layer === 'technical' && i.severity !== 'critical') continue;
    i.dims.forEach((d, k) => {
      const s = scores[d];
      if (!s || s.basis === 'n/a') return;
      s.score = r1(clamp(s.score - PENALTY[i.severity] * (k === 0 ? 0.5 : 0.25), 0, AUTO_CAP));
      s.band = bandOf(s.score);
    });
  }
  // ── judgement (Claude / human) for what measurement cannot prove: blended, recorded, the only way past 9
  for (const [d, j] of Object.entries(input.judgment ?? {}) as [VisualDimension, { score: number; note: string }][]) {
    const s = scores[d];
    if (!s) continue;
    s.score = r1(clamp(s.basis === 'n/a' ? j.score : 0.5 * s.score + 0.5 * j.score, 0, 10));
    s.band = bandOf(s.score);
    s.basis = s.basis === 'measured' ? 'measured' : 'judgment';
    s.evidence.push(`judgement: ${j.note}`);
  }

  // ── overall: weighted, held down by its weakest dimension and its weakest shot
  const WEIGHTS: Record<VisualDimension, number> = { composition: 1.2, hierarchy: 1.3, frameUtilization: 1, typography: 1.1, motionChoreography: 1, transitions: 0.9, continuity: 0.7, camera: 0.6, audioSync: 0.8, rhythm: 0.7, storytelling: 0.7, brand: 0.6, cta: 0.9, commercialPolish: 0.8 };
  const live = VISUAL_DIMENSIONS.filter((d) => scores[d].basis !== 'n/a');
  let overall = wmean(live.map((d) => ({ v: scores[d].score, w: WEIGHTS[d] * (0.5 + 0.5 * scores[d].confidence) })));
  const worstDim = Math.min(...live.map((d) => scores[d].score));
  overall = Math.min(overall, worstDim + 3);
  if (shotVis.length) overall = Math.min(overall, Math.min(...shotVis.map((x) => x.overall)) + 2.5);
  if (!input.judgment) overall = Math.min(overall, AUTO_CAP);
  overall = r1(overall);
  const confidence = r3(mean(live.map((d) => scores[d].confidence)));

  // ── verdict
  const reasons: string[] = [];
  const crit = issues.filter((i) => i.severity === 'critical');
  const low = live.filter((d) => scores[d].score < 5);
  const weakShots = shotVis.filter((x) => x.overall < 6);
  if (crit.length) reasons.push(...crit.map((c) => `${c.code}: ${c.evidence}`));
  if (low.length) reasons.push(`below 5/10: ${low.join(', ')}`);
  if (weakShots.length) reasons.push(`shots below "good" (6): ${weakShots.map((x) => `${x.shot} ${x.overall}`).join(', ')}`);
  const repairShots = [...new Set([...issues.filter((i) => i.shot && i.fix && i.severity !== 'minor').map((i) => i.shot!), ...weakShots.map((x) => x.shot)])];
  const status: CriticReport['verdict']['status'] = !technicalPass || overall < 4 || low.length >= 4 ? 'reject' : repairShots.length || low.length ? 'repair' : 'accept';
  const plain = Object.fromEntries(VISUAL_DIMENSIONS.map((d) => [d, scores[d].score])) as Record<VisualDimension, number>;
  return {
    version: 2,
    scale: BANDS,
    technical: { pass: technicalPass, checks },
    visual: { scores, overall, band: bandOf(overall), confidence },
    shots: shotVis,
    measures: { cameraDependency, elementMotionShare, stillShare: still, energy, energyCorrelation: rho, energyContrast: contrast, cameraMoves: camMoves, commercial },
    scores: plain,
    overall,
    issues,
    verdict: { status, reasons, repairShots },
    evidence: { sources: ['stage.json', 'stage_report.json', ...(dom ? ['dom_motion.json'] : []), ...(samples ? ['dom_samples.json'] : []), ...(input.pixel ? ['motion_metrics.animatic.json'] : []), ...(tq ? ['transition_quality.json'] : []), ...(direction ? ['direction.json'] : [])], dom: Boolean(dom), pixel: Boolean(input.pixel), samples: Boolean(samples), transitions: Boolean(tq) },
  };
}
