/**
 * Motion Critic (P1-I): reviews a Stage film from evidence — the stage plan and its report, the DOM
 * motion probes (what the browser drew), the pixel motion metrics of the animatic and the creative
 * direction — and writes critic.json: ten scores out of 10, the problems it found (each with its
 * evidence and the shot it belongs to) and a verdict that can REJECT the film or ask for a repair.
 *
 * It judges directed motion, not the amount of motion: a still CTA hold the script asked for is fine,
 * a camera that moves in six of seven shots is not, unless the direction says why. Thresholds are
 * per shot type / subject (composition targets), never one global number. Pure (no node APIs).
 */
import type { StagePlan } from '../stage/plan';
import type { StageReport } from '../stage/compiler';
import type { Direction } from '../stage/direction';
import type { DomMotionReport } from './stage-probes';
import type { SubjectType } from '../stage/composition';

export const CRITIC_DIMENSIONS = ['motionQuality', 'composition', 'camera', 'transitions', 'typography', 'audioSync', 'visualStorytelling', 'commercialQuality', 'continuity', 'frameUtilization'] as const;
export type CriticDimension = (typeof CRITIC_DIMENSIONS)[number];

export type CriticCode =
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
  | 'WORD_SYNC_MISSING';

export interface CriticIssue {
  code: CriticCode;
  severity: 'critical' | 'major' | 'minor';
  shot?: string;
  dims: CriticDimension[];
  evidence: string;
  /** A concrete repair the loop (or Claude) can apply to shots.json. */
  fix?: string;
}

export interface CriticReport {
  version: 1;
  scores: Record<CriticDimension, number>;
  overall: number;
  issues: CriticIssue[];
  verdict: { status: 'accept' | 'repair' | 'reject'; reasons: string[]; repairShots: string[] };
  evidence: { sources: string[]; dom: boolean; pixel: boolean };
}

export interface CriticInput {
  plan: StagePlan;
  report: StageReport;
  dom?: DomMotionReport | null;
  /** Pixel motion metrics of the animatic (motion_metrics.animatic.json → global). */
  pixel?: { stillFrameRatio?: number; longestDeadHold?: number; score?: number } | null;
  direction?: Direction | null;
  /** Arabic text problems the QC probe found (split glyphs, overflow) — count per element id. */
  textProblems?: { id: string; problem: string }[];
  /** The film has a voice (word sync is judged only then). */
  voice?: boolean;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const PENALTY = { critical: 3, major: 1.6, minor: 0.6 } as const;

function subjectTypeOfEl(plan: StagePlan, id?: string): SubjectType | null {
  const e = plan.elements.find((x) => x.id === id);
  if (!e) return null;
  if (e.kind === 'image') return 'image';
  if (e.kind === 'chip' || e.kind === 'icon' || e.kind === 'cursor') return 'small';
  return e.kind as SubjectType;
}

export function critique(input: CriticInput): CriticReport {
  const { plan, report, dom, direction } = input;
  const issues: CriticIssue[] = [];
  const add = (i: CriticIssue) => issues.push(i);
  const shots = plan.shots;
  const n = shots.length;
  const last = shots[n - 1];

  // ── camera
  const moving = shots.filter((s) => s.camera.move !== 'static');
  const share = moving.length / Math.max(1, n);
  const budget = direction?.camera.budget;
  if (budget ? share > budget.maxMovingShare + 1e-6 : share > 0.6) {
    add({ code: 'CAMERA_OVERUSE', severity: share > 0.8 ? 'critical' : 'major', dims: ['camera', 'motionQuality'], evidence: `camera moves in ${moving.length}/${n} shots (${Math.round(share * 100)}%)${budget ? `; direction budget ${Math.round(budget.maxMovingShare * 100)}%` : '; no direction budget justifies it'}`, fix: 'make the move with the smallest visible effect static and let the elements carry that shot' });
  } else if (share > 0.6 && budget) {
    // allowed by the direction — recorded, not penalised
  }
  for (const s of moving) {
    if (!s.camera.target || !s.camera.reason) add({ code: 'RANDOM_CAMERA', severity: 'major', shot: s.id, dims: ['camera'], evidence: `camera "${s.camera.move}" without ${!s.camera.target ? 'a target' : 'a reason'}`, fix: 'give the move a stage target and a reason, or make it static' });
    const d = dom?.camera.shots.find((x) => x.shot === s.id);
    if (d && !d.visible) add({ code: 'CAMERA_NO_VISIBLE_EFFECT', severity: 'major', shot: s.id, dims: ['camera', 'motionQuality'], evidence: d.note, fix: 'tighten the end framing (one shot size closer) or make the shot static' });
    if (d && d.targetScale !== undefined && Math.abs(Math.log(d.bgScale)) > Math.abs(Math.log(d.targetScale)) + 0.02) add({ code: 'SUBJECT_BACKGROUND_COMPETITION', severity: 'minor', shot: s.id, dims: ['camera', 'composition'], evidence: `background changes ×${d.bgScale} but the target only ×${d.targetScale}`, fix: 'move the target to a nearer layer or push less' });
  }

  // ── composition / frame utilisation (per shot type and subject)
  for (const s of shots) {
    const c = s.composition;
    const st = subjectTypeOfEl(plan, c.subject ?? undefined);
    const dShot = dom?.occupancy.byShot.find((x) => x.shot === s.id);
    const subjOcc = dShot ? dShot.subject : c.heroOccupancy;
    if (st && c.target && c.target[0] > 0) {
      const lo = c.target[0];
      if (subjOcc < lo * 0.6) add({ code: 'TINY_SUBJECT', severity: subjOcc < lo * 0.35 ? 'major' : 'minor', shot: s.id, dims: ['composition', 'frameUtilization'], evidence: `subject ${c.subject} fills ${Math.round(subjOcc * 100)}% of the frame (target ${Math.round(c.target[0] * 100)}–${Math.round(c.target[1] * 100)}% for ${st} at this shot size)`, fix: 'give the hero more width (cast w) or a closer shot size' });
    }
    const frameOcc = dShot ? dShot.frame : c.totalOccupancy;
    const quietOnPurpose = st === 'logo' || (s.id === last.id && plan.ending && plan.ending.holdSec <= plan.ending.maxSec);
    if (frameOcc < 0.1 && !quietOnPurpose) add({ code: 'EMPTY_COMPOSITION', severity: 'major', shot: s.id, dims: ['composition', 'frameUtilization'], evidence: `only ${Math.round(frameOcc * 100)}% of the frame carries anything`, fix: 'bring a secondary element on stage or frame closer' });
    if (c.subject && c.totalOccupancy > 0 && c.heroOccupancy / c.totalOccupancy < 0.3 && (s.cast?.length ?? 0) > 1) add({ code: 'WEAK_HIERARCHY', severity: 'minor', shot: s.id, dims: ['composition'], evidence: `the hero is ${Math.round((c.heroOccupancy / c.totalOccupancy) * 100)}% of what is on screen`, fix: 'make the hero larger or the supports smaller' });
  }

  // ── stillness and holds (from the DOM; the scripted final hold is allowed up to its max)
  if (dom) {
    for (const r of dom.still.runs) {
      const len = r.t1 - r.t0;
      const inEnding = plan.ending && r.t0 >= plan.ending.settleAt - 0.1;
      const allowed = inEnding ? plan.ending!.maxSec : 1.0;
      if (len > allowed + 0.15) {
        const sh = shots.find((s) => r.t0 >= s.start && r.t0 < s.end);
        add({ code: 'DEAD_HOLD', severity: len > allowed + 1 ? 'major' : 'minor', shot: sh?.id, dims: ['motionQuality', 'visualStorytelling'], evidence: `nothing moves for ${r1(len)}s (${r1(r.t0)}–${r1(r.t1)}s)${inEnding ? ` — the ending hold is allowed ${plan.ending!.maxSec}s` : ''}`, fix: inEnding ? 'shorten the closing shot' : 'give the hero a reasoned sustain, a word emphasis or a causal event in that window, or shorten the shot' });
      }
    }
    if (dom.still.share > 0.3) add({ code: 'UNDER_ANIMATION', severity: 'major', dims: ['motionQuality'], evidence: `${Math.round(dom.still.share * 100)}% of the film is still on the DOM` });
    const visible = dom.elements.filter((e) => e.visibleSec > 0.5 && e.kind !== 'cursor');
    const busy = visible.length ? visible.reduce((a, e) => a + e.movingSec / e.visibleSec, 0) / visible.length : 0;
    if (dom.still.share < 0.02 && busy > 0.75) add({ code: 'OVER_ANIMATION', severity: 'minor', dims: ['motionQuality', 'commercialQuality'], evidence: `elements move ${Math.round(busy * 100)}% of the time they are visible; the eye never rests`, fix: 'let readable text settle (sustain still)' });
    for (const o of dom.offFrame ?? []) add({ code: 'TEXT_OFF_FRAME', severity: o.worst > 0.25 && o.sec >= 0.4 ? 'critical' : 'major', shot: o.shot, dims: ['typography', 'camera'], evidence: `${o.text} is cut by the frame edge (${Math.round(o.worst * 100)}% of «${o.words.join(' ')}» lost) for ${o.sec}s`, fix: 'end the camera framing one size wider, or move the text inside the push target' });
    for (const c of dom.collisions) add({ code: 'TEXT_COLLISION', severity: c.overlap > 0.3 && c.sec > 0.6 ? 'major' : 'minor', shot: c.shot, dims: ['composition', 'typography'], evidence: `${c.text} is covered ${Math.round(c.overlap * 100)}% by ${c.other} for ${c.sec}s`, fix: `move ${c.other} (cast "at") or let it exit earlier` });
    // sustained holds with no camera and no element motion inside a shot whose subject never moves
    for (const sub of dom.subjects) {
      const sh = shots.find((s) => s.id === sub.shot)!;
      const len = sh.end - sh.start;
      if (sub.subject && sub.movingSec < Math.min(0.5, len * 0.12) && sh.camera.move === 'static' && sh.id !== last.id) add({ code: 'POWERPOINT_FEELING', severity: 'minor', shot: sh.id, dims: ['motionQuality', 'visualStorytelling'], evidence: `the subject ${sub.subject} moves ${sub.movingSec}s of ${r1(len)}s and the camera is static`, fix: 'give the subject a causal event (impact / transform / emphasis) tied to the message' });
    }
  } else if (input.pixel?.stillFrameRatio !== undefined && input.pixel.stillFrameRatio > 0.35) {
    add({ code: 'UNDER_ANIMATION', severity: 'major', dims: ['motionQuality'], evidence: `pixel still-frame ratio ${Math.round(input.pixel.stillFrameRatio * 100)}% (no DOM probes)` });
  }

  // ── rhythm
  const lens = shots.map((s) => s.end - s.start);
  const mean = lens.reduce((a, b) => a + b, 0) / n;
  const cv = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n) / mean;
  if (n >= 4 && cv < 0.08) add({ code: 'REPETITIVE_RHYTHM', severity: 'minor', dims: ['motionQuality', 'visualStorytelling'], evidence: `shot lengths vary only ${Math.round(cv * 100)}% (mean ${r1(mean)}s)`, fix: 'shorten a bridge shot and let the hero shot breathe' });

  // ── transitions, continuity, handoffs
  const tr = plan.transitions;
  const objectShare = tr.length ? tr.filter((t) => t.status === 'object').length / tr.length : 0;
  if (tr.length && objectShare < 0.4) add({ code: 'GENERIC_TRANSITIONS', severity: 'major', dims: ['transitions', 'continuity'], evidence: `${Math.round(objectShare * 100)}% of the cuts are performed by an element` , fix: 'turn a cut into shared / morph / expand / mask using an element both shots need' });
  for (const t of tr.filter((x) => x.status === 'fallback')) add({ code: 'BROKEN_HANDOFF', severity: 'major', shot: t.from, dims: ['transitions', 'continuity'], evidence: `${t.requested} fell back to ${t.kind}: ${t.why}`, fix: 'fix the element named in the transition or choose a transition the element can perform' });
  for (let i = 0; i < n - 1; i++) {
    const a = shots[i];
    const b = shots[i + 1];
    const shared = plan.elements.some((e) => e.shots.includes(a.id) && e.shots.includes(b.id));
    const obj = tr.some((t) => t.from === a.id && t.status === 'object');
    const hand = plan.handoffs.some((h) => h.t >= a.start && h.t <= b.start + 0.8 && h.kind !== 'camera');
    if (!shared && !obj && !hand) add({ code: 'DISCONNECTED_SHOTS', severity: 'major', shot: a.id, dims: ['continuity', 'transitions', 'visualStorytelling'], evidence: `${a.id} → ${b.id}: no element continues, no object transition, no energy handoff`, fix: 'carry one element across (shared) or hand the exit energy to the next hero' });
  }
  for (const s of shots.slice(0, -1)) {
    const out = plan.elements.filter((e) => e.shots[e.shots.length - 1] === s.id && e.id === s.composition.subject);
    for (const e of out) {
      const carried = tr.some((t) => t.from === s.id && t.element === e.id && t.status === 'object') || plan.handoffs.some((h) => h.from === e.id);
      const fadesOnly = !carried && !plan.choreo.timeline.some((node) => JSON.stringify(node).includes(`"out_${e.key}_`));
      if (fadesOnly) add({ code: 'WEAK_EXIT', severity: 'minor', shot: s.id, dims: ['transitions', 'motionQuality'], evidence: `the hero ${e.id} leaves without an exit of its own` });
    }
  }

  // ── typography and word sync
  for (const p of input.textProblems ?? []) add({ code: 'POOR_ARABIC_LAYOUT', severity: 'major', dims: ['typography'], evidence: `${p.id}: ${p.problem}`, fix: 'enlarge the text box or shorten the copy (never split letters)' });
  if (dom) {
    const missed = dom.words.filter((w) => !w.reacted);
    if (missed.length) add({ code: 'WORD_SYNC_MISSING', severity: missed.length > dom.words.length / 2 ? 'major' : 'minor', dims: ['typography', 'audioSync'], evidence: `${missed.length}/${dom.words.length} emphasised words did not visibly react (${missed.map((w) => w.word).join(', ')})` });
  }

  // ── CTA and ending
  if (report.cta?.status === 'enforced') add({ code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['commercialQuality'], evidence: `the closing shot had no CTA copy; added from the brief (${report.cta.added?.join(', ')})`, fix: 'author the CTA text and button in the closing shot cast' });
  if (plan.ending) {
    if (plan.ending.holdSec > plan.ending.maxSec + 0.25) add({ code: 'CTA_WEAKNESS', severity: 'minor', shot: last.id, dims: ['commercialQuality', 'motionQuality'], evidence: `the final hold lasts ${plan.ending.holdSec}s (max ${plan.ending.maxSec}s)`, fix: `shorten the closing shot by ${r1(plan.ending.holdSec - plan.ending.maxSec)}s` });
    if (plan.ending.holdSec < 0.6) add({ code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['commercialQuality'], evidence: `the CTA rests only ${plan.ending.holdSec}s: it cannot be read`, fix: 'lengthen the closing shot' });
  }
  const ctaEl = plan.elements.find((e) => e.shots.includes(last.id) && (e.content.role === 'cta' || e.kind === 'button'));
  if (!ctaEl && report.cta?.status !== 'none' && report.cta?.status !== 'override') add({ code: 'CTA_WEAKNESS', severity: 'major', shot: last.id, dims: ['commercialQuality'], evidence: 'no CTA text or button on stage at the end' });

  // ── direction compliance
  for (const v of report.direction?.violations ?? []) add({ code: 'MOTION_WITHOUT_REASON', severity: 'minor', dims: ['visualStorytelling'], evidence: `direction: ${v}` });

  // ── scores
  const scores = Object.fromEntries(CRITIC_DIMENSIONS.map((d) => [d, 10])) as Record<CriticDimension, number>;
  // the first dimension of an issue takes the full penalty, the others half
  for (const i of issues) i.dims.forEach((d, k) => (scores[d] = Math.max(0, scores[d] - PENALTY[i.severity] * (k === 0 ? 1 : 0.5))));
  // positive evidence: things done well raise the floor of what they prove
  if (!input.voice) scores.audioSync = Math.min(scores.audioSync, 7); // no voice: sync cannot be proven beyond the music grid
  if (objectShare >= 0.6) scores.transitions = Math.min(10, scores.transitions + 0.5);
  for (const d of CRITIC_DIMENSIONS) scores[d] = r1(scores[d]);
  const overall = r1(CRITIC_DIMENSIONS.reduce((a, d) => a + scores[d], 0) / CRITIC_DIMENSIONS.length);

  // ── verdict
  const reasons: string[] = [];
  const crit = issues.filter((i) => i.severity === 'critical');
  const low = CRITIC_DIMENSIONS.filter((d) => scores[d] < 5);
  if (crit.length) reasons.push(...crit.map((c) => `${c.code}: ${c.evidence}`));
  if (low.length) reasons.push(`below 5/10: ${low.join(', ')}`);
  const repairShots = [...new Set(issues.filter((i) => i.shot && i.fix && i.severity !== 'minor').map((i) => i.shot!))];
  const status: CriticReport['verdict']['status'] = crit.length || low.length >= 3 ? 'reject' : repairShots.length || low.length ? 'repair' : 'accept';
  if (status === 'repair' && !reasons.length) reasons.push(`${repairShots.length} shot(s) with major issues: ${repairShots.join(', ')}`);
  return {
    version: 1,
    scores,
    overall,
    issues,
    verdict: { status, reasons, repairShots },
    evidence: { sources: ['stage.json', 'stage_report.json', ...(dom ? ['dom_motion.json'] : []), ...(input.pixel ? ['motion_metrics.animatic.json'] : []), ...(direction ? ['direction.json'] : [])], dom: Boolean(dom), pixel: Boolean(input.pixel) },
  };
}
