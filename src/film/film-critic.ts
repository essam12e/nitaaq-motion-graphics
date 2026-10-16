/**
 * Sequence Critic (P3-L) + Film Critic (P3-M) + Film Decision Memory & Repetition (P3-T) +
 * Film-level Energy Arc (P3-H) + Camera Arc (P3-J) + CTA Payoff (P3-O).
 *
 *   Shot Critic (P2)      — is each shot well made?            (critic.json)
 *   Sequence Critic (P3)  — do the shots of a sequence work together?
 *   Film Critic (P3)      — does the film work as a film?       (film_critic.json)
 *
 * The Film Critic never re-checks what the technical layer owns (text in frame, collisions). Every
 * dimension carries its basis — Measured (DOM / pixels), Heuristic (a written rule), Claude Judgment
 * (passed in, never invented) — and heuristic dimensions are capped at 7.5: memorability is not a
 * measurement.
 * Pure (no node APIs).
 */
import type { StagePlan } from '../stage/plan';
import type { CriticReport } from '../qc/critic';
import type { Boundary } from './boundary';
import type { FilmPlan, FilmPlanReport } from './film-plan';
import type { ShotInfo } from './rhythm';
import { moveFamily } from '../stage/direction';

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (v: number, a = 0, b = 10) => Math.max(a, Math.min(b, v));
export type FilmBasis = 'measured' | 'heuristic' | 'judgment';

// ═══════════════════ Film Decision Memory + repetition ═══════════════════

export interface ShotDecision {
  shot: string;
  layout: string;
  camera: string;
  transitionOut: string;
  entrance: string;
  typography: string;
  shotSize: string;
  direction: string;
  duration: number;
  energy: number;
}

export interface FilmMemory {
  version: 1;
  shots: ShotDecision[];
  motifs: string[];
  /** How often each choice was used across the film (counts). */
  used: Record<'layout' | 'camera' | 'transitionOut' | 'entrance' | 'typography' | 'shotSize' | 'direction' | 'duration', Record<string, number>>;
}

const idCache = new WeakMap<object, string[]>();
/** Every action id of the stage choreography (flattened). */
function actionIds(plan: StagePlan): string[] {
  let ids = idCache.get(plan.choreo);
  if (ids) return ids;
  ids = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const o = n as { id?: unknown; children?: unknown[] };
    if (typeof o.id === 'string') ids!.push(o.id);
    for (const c of o.children ?? []) walk(c);
  };
  for (const n of plan.choreo.timeline) walk(n);
  idCache.set(plan.choreo, ids);
  return ids;
}

const layoutKey = (l: string) => l.split(/[:(]/)[0].trim().replace(/\s+\d+.*$/, '');

/** What the film decided, shot by shot — read from the compiled plan (what the viewer gets), not the intent. */
export function filmMemory(plan: StagePlan, film?: FilmPlan | null, boundaries?: Boundary[]): FilmMemory {
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  const shots: ShotDecision[] = plan.shots.map((s, i) => {
    const tr = plan.transitions.find((t) => t.from === s.id);
    const texts = (s.cast ?? []).map((c) => byId.get(c.id)).filter((e) => e?.kind === 'text');
    const big = texts.map((e) => e!.content.fontU ?? 0).sort((a, b) => b - a)[0] ?? 0;
    const typo = !texts.length ? 'none' : `${texts.length > 1 ? 'multi' : 'single'}-${big >= 9 ? 'display' : big >= 6 ? 'headline' : 'body'}`;
    const ent = actionIds(plan).filter((id) => id.startsWith('in_') && id.endsWith(`_${i}`)).length;
    const b = boundaries?.[i];
    const dur = s.end - s.start;
    return {
      shot: s.id,
      layout: layoutKey(s.composition.layout),
      camera: moveFamily(s.camera.move),
      transitionOut: tr?.kind ?? (i === plan.shots.length - 1 ? 'end' : 'cut'),
      entrance: ent > 2 ? 'cascade' : ent > 0 ? 'single' : 'carried',
      typography: typo,
      shotSize: s.composition.shotSize,
      direction: b ? b.eye.direction : 'end',
      duration: Math.round(dur * 2) / 2,
      energy: r2(s.energy ?? 0.6),
    };
  });
  const used = { layout: {}, camera: {}, transitionOut: {}, entrance: {}, typography: {}, shotSize: {}, direction: {}, duration: {} } as FilmMemory['used'];
  for (const d of shots) for (const k of Object.keys(used) as (keyof FilmMemory['used'])[]) used[k][String(d[k])] = (used[k][String(d[k])] ?? 0) + 1;
  return { version: 1, shots, motifs: (film?.motifs ?? []).map((m) => m.id), used };
}

export interface Repetition {
  what: 'layout' | 'camera' | 'transition' | 'entrance' | 'typography' | 'rhythm' | 'shotSize';
  value: string;
  share: number;
  run: number;
  intentional: boolean;
  why: string;
}

/** Repetition detection: the same choice over and over — intentional (a declared language) or lazy. */
export function repetitions(mem: FilmMemory, film?: FilmPlan | null): Repetition[] {
  const n = mem.shots.length;
  const out: Repetition[] = [];
  const keys: [Repetition['what'], keyof ShotDecision][] = [
    ['layout', 'layout'],
    ['camera', 'camera'],
    ['transition', 'transitionOut'],
    ['entrance', 'entrance'],
    ['typography', 'typography'],
    ['rhythm', 'duration'],
    ['shotSize', 'shotSize'],
  ];
  for (const [what, k] of keys) {
    const vals = mem.shots.filter((d) => !(k === 'transitionOut' && d.transitionOut === 'end')).map((d) => String(d[k]));
    if (vals.length < 4) continue; // three shots are too few to call a habit
    const counts = new Map<string, number>();
    for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    const [value, c] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    let run = 1;
    let best = 1;
    for (let i = 1; i < vals.length; i++) {
      run = vals[i] === vals[i - 1] ? run + 1 : 1;
      best = Math.max(best, run);
    }
    const share = c / vals.length;
    // a static camera / no camera is not a repeated move
    if (what === 'camera' && value === 'static') continue;
    if (share < 0.6 && best < Math.max(3, Math.ceil(n * 0.5))) continue;
    const lang = film?.transitionStrategy.intentionalRepeats ?? [];
    const intentional = lang.includes(value) || (what === 'camera' && /same|one move|constant|throughout/.test(film?.arcs.camera.shape ?? ''));
    out.push({ what, value, share: r2(share), run: best, intentional, why: intentional ? `declared in the film plan (${what} language)` : `${Math.round(share * 100)}% of the film (${c}/${vals.length}), longest run ${best}` });
  }
  return out;
}

// ═══════════════════ Sequence Critic ═══════════════════

export type SequenceCode =
  | 'DISCONNECTED_SHOTS'
  | 'WEAK_HANDOFF'
  | 'BAD_EYE_FLOW'
  | 'TRANSITION_MISMATCH'
  | 'REPEATED_RHYTHM'
  | 'REPEATED_COMPOSITION'
  | 'CAMERA_RESET'
  | 'ENERGY_BREAK'
  | 'MOTIF_LOST'
  | 'NARRATIVE_STALL'
  | 'SEQUENCE_TOO_LONG'
  | 'SEQUENCE_TOO_DENSE'
  | 'SEQUENCE_WITHOUT_PEAK'
  | 'SEQUENCE_WITHOUT_RESOLVE'
  | 'CONTRACT_BROKEN';

export interface SequenceIssue {
  code: SequenceCode;
  severity: 'major' | 'minor';
  sequence: string;
  shots: string[];
  boundary?: string;
  evidence: string;
  basis: FilmBasis;
}

export interface SequenceScore {
  sequence: string;
  shots: string[];
  shotQuality: number;
  boundaryQuality: number;
  continuity: number;
  eyeFlow: number;
  energy: { planned: number[]; measured: number[]; peak: boolean; resolve: boolean };
  score: number;
  issues: SequenceIssue[];
}

export interface SequenceInput {
  plan: StagePlan;
  film: FilmPlan;
  boundaries: Boundary[];
  critic?: CriticReport | null;
  info?: ShotInfo[];
  filmReport?: FilmPlanReport | null;
  mem?: FilmMemory;
}

const measuredEnergy = (critic: CriticReport | null | undefined, shot: string, fallback: number) => critic?.measures.energy.find((e) => e.shot === shot)?.measured ?? fallback;

export function sequenceCritic(inp: SequenceInput): SequenceScore[] {
  const { plan, film, boundaries, critic } = inp;
  const total = plan.shots[plan.shots.length - 1].end;
  const mem = inp.mem ?? filmMemory(plan, film, boundaries);
  return film.sequences.map((seq) => {
    const ids = seq.shots.filter((id) => plan.shots.some((s) => s.id === id));
    const issues: SequenceIssue[] = [];
    const add = (code: SequenceCode, severity: SequenceIssue['severity'], evidence: string, basis: FilmBasis, extra: Partial<SequenceIssue> = {}) => issues.push({ code, severity, sequence: seq.id, shots: ids, evidence, basis, ...extra });
    const shotQ = ids.map((id) => critic?.shots.find((s) => s.shot === id)?.overall ?? 6);
    const inner = boundaries.filter((b) => ids.includes(b.sourceShot) && ids.includes(b.targetShot));
    const exitB = boundaries.find((b) => b.sourceShot === ids[ids.length - 1]);
    const touching = exitB ? [...inner, exitB] : inner;
    for (const b of touching) {
      if (b.worldReset) add('DISCONNECTED_SHOTS', 'major', `${b.id}: ${b.issues.find((x) => x.code === 'WORLD_RESET')?.evidence ?? 'world reset'}`, 'measured', { boundary: b.id });
      if (b.score < 5) add('WEAK_HANDOFF', b.score < 3.5 ? 'major' : 'minor', `${b.id} (${b.transitionType}) scores ${b.score.toFixed(1)}: ${b.issues.map((x) => x.code).join(', ') || 'thin frame'}`, b.quality.source === 'measured' ? 'measured' : 'heuristic', { boundary: b.id });
      if (!b.eye.guided && b.eye.travel >= 0.28) add('BAD_EYE_FLOW', b.eye.travel >= 0.45 ? 'major' : 'minor', `${b.id}: the eye travels ${Math.round(b.eye.travel * 100)}% of the diagonal (${b.eye.exit.id} → ${b.eye.entry.id}) with a blind jump of ${Math.round(b.eye.maxJump * 100)}%`, 'heuristic', { boundary: b.id });
      // camera reset: the camera snaps back across a cut while the shot before had pushed in
      const zo = b.cameraStateOut.zoom;
      const zi = b.cameraStateIn.zoom;
      if (Math.abs(zo - zi) > 0.25 && b.transitionType !== 'depth-pass' && b.transitionType !== 'push-inside') add('CAMERA_RESET', 'minor', `${b.id}: zoom ${zo} → ${zi} across the cut (the push is thrown away)`, 'measured', { boundary: b.id });
      // a fast, high-energy cut done with a slow transition (or the reverse)
      const e = (b.energyOut + b.energyIn) / 2;
      const len = b.t1 - b.t0;
      if ((e >= 0.75 && len > 1.1) || (e <= 0.4 && len < 0.2 && b.transitionType !== 'cut')) add('TRANSITION_MISMATCH', 'minor', `${b.id}: energy ${r2(e)} with a ${r2(len)}s ${b.transitionType}`, 'heuristic', { boundary: b.id });
    }
    // rhythm / composition repeated inside the sequence
    const decs = mem.shots.filter((d) => ids.includes(d.shot));
    if (decs.length >= 3 && new Set(decs.map((d) => d.duration)).size === 1) add('REPEATED_RHYTHM', 'minor', `${decs.length} shots of ${decs[0].duration}s in a row`, 'measured');
    for (let k = 1; k < decs.length; k++) if (decs[k].layout === decs[k - 1].layout && decs[k].shotSize === decs[k - 1].shotSize && decs[k].camera === decs[k - 1].camera) add('REPEATED_COMPOSITION', 'minor', `${decs[k - 1].shot} and ${decs[k].shot}: same layout (${decs[k].layout}), size and camera`, 'measured');
    // energy inside the sequence
    const planned = ids.map((id) => film.arcs.energy.curve[id] ?? plan.shots.find((s) => s.id === id)?.energy ?? 0.6);
    const meas = ids.map((id, k) => r2(measuredEnergy(critic, id, planned[k])));
    for (let k = 1; k < meas.length; k++) if (Math.abs(meas[k] - meas[k - 1]) > 0.4 && Math.abs(planned[k] - planned[k - 1]) < 0.2) add('ENERGY_BREAK', 'minor', `${ids[k - 1]} → ${ids[k]}: measured energy ${meas[k - 1]} → ${meas[k]} (planned ${planned[k - 1]} → ${planned[k]})`, 'measured');
    const peak = ids.length < 2 || Math.max(...meas) - Math.min(...meas) >= 0.08 || plan.handoffs.some((h) => ids.some((id) => (plan.shots.find((s) => s.id === id)?.cast ?? []).some((c) => c.id === h.to)) && (h.kind === 'impact' || h.kind === 'attract' || h.kind === 'push'));
    if (!peak && ids.length >= 2 && seq.energy.peak - Math.min(seq.energy.start, seq.energy.end) >= 0.1) add('SEQUENCE_WITHOUT_PEAK', 'minor', `planned ${seq.energy.start} → ${seq.energy.peak} → ${seq.energy.end}, measured ${meas.join(' / ')} (flat, no impact)`, 'measured');
    const resolve = !exitB || exitB.score >= 5 || ids[ids.length - 1] === plan.shots[plan.shots.length - 1].id;
    if (!resolve && exitB) add('SEQUENCE_WITHOUT_RESOLVE', 'minor', `${seq.id} ends on a ${exitB.score.toFixed(1)} cut (${exitB.transitionType}): it is dropped, not resolved`, 'measured', { boundary: exitB.id });
    // length / density
    const len = ids.reduce((a, id) => {
      const s = plan.shots.find((x) => x.id === id)!;
      return a + (s.end - s.start);
    }, 0);
    if (ids.length > 1 && len / total > 0.5) add('SEQUENCE_TOO_LONG', 'minor', `${r2(len)}s of a ${r2(total)}s film (${Math.round((len / total) * 100)}%)`, 'measured');
    const inf = inp.info?.filter((x) => ids.includes(x.shot)) ?? [];
    if (inf.some((x) => x.overload)) add('SEQUENCE_TOO_DENSE', 'minor', inf.filter((x) => x.overload).map((x) => `${x.shot}: ${x.concepts} concepts in ${x.duration}s (≈${x.readTime}s needed, burst ${x.peakBurst})`).join('; '), 'heuristic');
    // narrative stall: consecutive shots with the same purpose and nothing new
    for (let k = 1; k < ids.length; k++) {
      const a = plan.shots.find((s) => s.id === ids[k - 1])!;
      const b = plan.shots.find((s) => s.id === ids[k])!;
      const fresh = inf.find((x) => x.shot === b.id)?.concepts ?? 1;
      if (a.purpose && a.purpose === b.purpose && fresh < 0.6) add('NARRATIVE_STALL', 'minor', `${a.id} → ${b.id}: same purpose (${a.purpose}) and nothing new`, 'heuristic');
    }
    // motifs planned in this sequence and missing on screen
    for (const m of inp.filmReport?.motifs ?? []) for (const a of m.appearances) if (ids.includes(a.shot) && !a.ok) add('MOTIF_LOST', 'major', `motif ${m.id} does not appear in ${a.shot} as planned (${a.note})`, 'measured');
    for (const c of inp.filmReport?.contracts ?? []) if (c.from === seq.id && !c.kept) add('CONTRACT_BROKEN', 'major', `${seq.id} promises ${c.element} to ${c.to}: ${c.how}`, 'measured', { boundary: c.boundary });
    const bq = touching.length ? touching.reduce((a, b) => a + b.score, 0) / touching.length : 7;
    const cont = touching.length ? (10 * touching.filter((b) => !b.worldReset).length) / touching.length : 8;
    const eye = touching.length ? (10 * touching.filter((b) => b.eye.guided || b.eye.travel < 0.28).length) / touching.length : 8;
    const sq = shotQ.reduce((a, b) => a + b, 0) / Math.max(1, shotQ.length);
    const pen = issues.reduce((a, x) => a + (x.severity === 'major' ? 0.6 : 0.2), 0);
    const score = r2(clamp(0.4 * sq + 0.3 * bq + 0.15 * (cont * 0.9) + 0.15 * (eye * 0.9) - pen, 0, 9.5));
    return { sequence: seq.id, shots: ids, shotQuality: r2(sq), boundaryQuality: r2(bq), continuity: r2(cont), eyeFlow: r2(eye), energy: { planned, measured: meas, peak, resolve }, score, issues };
  });
}

// ═══════════════════ Film Critic ═══════════════════

export type FilmCode =
  | 'FLAT_FILM'
  | 'NO_BUILD'
  | 'EARLY_PEAK'
  | 'WEAK_HOOK'
  | 'WEAK_CLIMAX'
  | 'CTA_TOO_BUSY'
  | 'CTA_TOO_DEAD'
  | 'ENERGY_WHIPLASH'
  | 'REPETITIVE_FILM'
  | 'WEAK_PAYOFF'
  | 'WORLD_RESETS'
  | 'MOTIF_LOST'
  | 'CAMERA_ADDICTION'
  | 'CAMERA_OFF_ARC'
  | 'INFORMATION_OVERLOAD'
  | 'NARRATIVE_UNCLEAR';

export interface FilmIssue {
  code: FilmCode;
  severity: 'major' | 'minor';
  evidence: string;
  basis: FilmBasis;
  /** The level that can fix it (hierarchical repair). */
  level: 'shot' | 'boundary' | 'sequence' | 'film';
  shots?: string[];
}

export const FILM_DIMENSIONS = ['hookStrength', 'narrativeClarity', 'visualProgression', 'visualVariety', 'continuity', 'pacing', 'rhythm', 'energyArc', 'motifDevelopment', 'cameraArc', 'typographyArc', 'transitionLanguage', 'brandIntegration', 'ctaPayoff', 'memorability', 'commercialEffectiveness'] as const;
export type FilmDimension = (typeof FILM_DIMENSIONS)[number];

export interface FilmCriticReport {
  version: 1;
  dims: Record<FilmDimension, { score: number; basis: FilmBasis; evidence: string }>;
  overall: number;
  sequences: SequenceScore[];
  boundaries: { id: string; score: number; source: string; issues: string[] }[];
  energy: { planned: number[]; measured: number[]; correlation: number | null; issues: FilmCode[] };
  repetition: Repetition[];
  payoff: { connected: boolean; how: string; evidence: string[] };
  worldResets: string[];
  issues: FilmIssue[];
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 1e-9 && db > 1e-9 ? r2(n / Math.sqrt(da * db)) : null;
}

/**
 * CTA payoff: is the end the conclusion of the film? Connected when something that began earlier
 * arrives on the CTA — a motif / persistent element cast there, the transition INTO the CTA carried by an
 * element of the film, or a declared payoff whose element is on screen at the end.
 */
export function ctaPayoff(plan: StagePlan, film?: FilmPlan | null): FilmCriticReport['payoff'] {
  const last = plan.shots[plan.shots.length - 1];
  const before = plan.shots.slice(0, -1);
  const evidence: string[] = [];
  const earlier = new Set(before.flatMap((s) => (s.cast ?? []).map((c) => c.id)));
  const cast = (last.cast ?? []).map((c) => c.id);
  const returning = cast.filter((id) => earlier.has(id) && !/^logo|cursor/.test(id));
  if (returning.length) evidence.push(`on the CTA from earlier: ${returning.join(', ')}`);
  const into = plan.transitions.find((t) => t.to === last.id);
  const carried = into && into.status === 'object' && into.kind !== 'cut' ? `${into.kind} (${into.element}${into.into ? ` → ${into.into}` : ''})` : '';
  if (carried) evidence.push(`the cut into the CTA is carried: ${carried}`);
  const motif = film?.motifs.find((m) => m.finalResolution.shot === last.id && cast.includes(m.element));
  if (motif) evidence.push(`motif ${motif.id} resolves on the CTA (${motif.finalResolution.as}${motif.finalResolution.into ? ` ${motif.finalResolution.into}` : ''})`);
  const declared = film?.ending.payoff;
  const declaredOk = Boolean(declared && (declared.element ? cast.includes(declared.element) : true) && film?.ending.why.trim());
  // a payoff from the film's beginning half counts more than one carried from the shot just before
  const deep = returning.some((id) => plan.shots.findIndex((s) => (s.cast ?? []).some((c) => c.id === id)) < plan.shots.length / 2) || Boolean(motif);
  const connected = deep || Boolean(motif) || (declaredOk && (returning.length > 0 || Boolean(carried)));
  const how = motif ? `motif ${motif.id}: ${motif.finalResolution.note}` : deep ? `${returning.join(', ')} began early and arrives at the end` : carried ? `only the last cut is carried (${carried}) — nothing from the film's start reaches the end` : 'nothing that began in the film arrives at the end';
  return { connected, how, evidence };
}

export interface FilmCriticInput extends SequenceInput {
  /** Claude Judgment for the dimensions measurement cannot prove (memorability …) — never invented. */
  judgment?: Partial<Record<FilmDimension, { score: number; note: string }>>;
  rhythmCv?: number;
}

export function filmCritic(inp: FilmCriticInput): FilmCriticReport {
  const { plan, film, boundaries, critic } = inp;
  const mem = inp.mem ?? filmMemory(plan, film, boundaries);
  const seqs = sequenceCritic({ ...inp, mem });
  const reps = repetitions(mem, film);
  const issues: FilmIssue[] = [];
  const add = (code: FilmCode, severity: FilmIssue['severity'], evidence: string, basis: FilmBasis, level: FilmIssue['level'], shots?: string[]) => issues.push({ code, severity, evidence, basis, level, shots });
  const ids = plan.shots.map((s) => s.id);
  const planned = ids.map((id) => film.arcs.energy.curve[id] ?? plan.shots.find((s) => s.id === id)!.energy ?? 0.6);
  const meas = ids.map((id, k) => r2(measuredEnergy(critic, id, planned[k])));
  const haveMeasured = Boolean(critic?.measures.energy.length);
  // ── energy arc (measured vs planned)
  const eIssues: FilmCode[] = [];
  const mean = meas.reduce((a, b) => a + b, 0) / meas.length;
  const sd = Math.sqrt(meas.reduce((a, b) => a + (b - mean) ** 2, 0) / meas.length);
  const corr = pearson(planned, meas);
  if (haveMeasured) {
    if (sd < 0.08) eIssues.push('FLAT_FILM');
    const pk = planned.indexOf(Math.max(...planned));
    const mk = meas.indexOf(Math.max(...meas));
    if (pk >= 2 && mk < Math.max(1, Math.floor(ids.length * 0.25)) && meas[pk] < meas[mk] - 0.1) eIssues.push('EARLY_PEAK');
    if (pk >= 1 && meas[pk] < Math.max(...meas) * 0.85) eIssues.push('WEAK_CLIMAX');
    const firstHalf = meas.slice(0, Math.ceil(meas.length / 2));
    if (Math.max(...meas.slice(Math.ceil(meas.length / 2) - 1)) <= Math.min(...firstHalf) + 0.05 && planned[pk] > planned[0]) eIssues.push('NO_BUILD');
    if (meas[0] < 0.4 || meas[0] < mean - 0.1) eIssues.push('WEAK_HOOK');
    const cta = meas[meas.length - 1];
    const ctaCast = (plan.shots[plan.shots.length - 1].cast ?? []).length;
    if (cta > 0.8 || ctaCast > 6) eIssues.push('CTA_TOO_BUSY');
    if (cta < 0.12) eIssues.push('CTA_TOO_DEAD');
    for (let k = 1; k < meas.length; k++) if (Math.abs(meas[k] - meas[k - 1]) > 0.45 && Math.abs(planned[k] - planned[k - 1]) < 0.25) {
      eIssues.push('ENERGY_WHIPLASH');
      break;
    }
  }
  for (const c of eIssues) add(c, c === 'FLAT_FILM' || c === 'WEAK_HOOK' ? 'major' : 'minor', `planned ${planned.join(' / ')} · measured ${meas.join(' / ')}${corr !== null ? ` · ρ ${corr}` : ''}`, 'measured', c === 'WEAK_HOOK' || c === 'CTA_TOO_BUSY' || c === 'CTA_TOO_DEAD' ? 'shot' : 'film', c === 'WEAK_HOOK' ? [ids[0]] : c.startsWith('CTA') ? [ids[ids.length - 1]] : undefined);
  // ── repetition (lazy only)
  const lazy = reps.filter((r) => !r.intentional);
  if (lazy.length >= 2 || lazy.some((r) => r.share >= 0.85 && r.what !== 'shotSize')) add('REPETITIVE_FILM', lazy.length >= 3 ? 'major' : 'minor', lazy.map((r) => `${r.what} "${r.value}" ${r.why}`).join('; '), 'measured', 'film');
  // ── world resets
  const resets = boundaries.filter((b) => b.worldReset).map((b) => b.id);
  if (resets.length) add('WORLD_RESETS', resets.length >= 2 ? 'major' : 'minor', `${resets.length} boundary(ies) where everything disappears and everything new appears: ${resets.join(', ')}`, 'measured', 'boundary');
  // ── motifs
  const lost = seqs.flatMap((s) => s.issues.filter((x) => x.code === 'MOTIF_LOST'));
  if (lost.length) add('MOTIF_LOST', 'major', lost.map((x) => x.evidence).join('; '), 'measured', 'sequence');
  // ── camera: addiction / arc
  const moving = plan.shots.filter((s) => moveFamily(s.camera.move) !== 'static');
  const dep = critic?.measures.cameraDependency ?? 0;
  if (moving.length / plan.shots.length > 0.6 && dep > 0.4) add('CAMERA_ADDICTION', 'major', `the camera moves in ${moving.length}/${plan.shots.length} shots and carries ${Math.round(dep * 100)}% of the moving time alone`, 'measured', 'film');
  const off: string[] = [];
  for (const st of film.arcs.camera.stages)
    for (const id of st.shots) {
      const s = plan.shots.find((x) => x.id === id);
      if (!s || moveFamily(s.camera.move) === 'static') continue;
      const want = st.framing;
      const fam = moveFamily(s.camera.move);
      const tighter = ['close', 'extreme-close', 'insert', 'detail', 'hero'].includes(want);
      if ((fam === 'pull' && tighter) || (fam === 'push' && want === 'wide')) off.push(`${id}: ${s.camera.move} against the arc stage "${st.behavior}" (${want})`);
    }
  if (off.length) add('CAMERA_OFF_ARC', 'minor', off.join('; '), 'measured', 'shot');
  // ── information
  const over = inp.info?.filter((x) => x.overload) ?? [];
  if (over.length) add('INFORMATION_OVERLOAD', over.length >= 2 ? 'major' : 'minor', over.map((x) => `${x.shot}: ${x.concepts} concepts in ${x.duration}s`).join('; '), 'heuristic', 'shot', over.map((x) => x.shot));
  // ── payoff
  const payoff = ctaPayoff(plan, film);
  if (!payoff.connected) add('WEAK_PAYOFF', 'major', `${payoff.how}${film.ending.why.trim() ? '' : '; the film plan does not say why this ending is the conclusion'}`, 'measured', 'film', [ids[ids.length - 1]]);
  // ── dimensions
  const dims = {} as FilmCriticReport['dims'];
  const set = (d: FilmDimension, score: number, basis: FilmBasis, evidence: string) => {
    const j = inp.judgment?.[d];
    if (j) dims[d] = { score: r2(clamp(j.score)), basis: 'judgment', evidence: `Claude Judgment: ${j.note}` };
    else dims[d] = { score: r2(clamp(score, 0, basis === 'heuristic' ? 7.5 : 9)), basis, evidence };
  };
  const shotScore = (id: string) => critic?.shots.find((s) => s.shot === id)?.overall ?? 6;
  const bq = boundaries.length ? boundaries.reduce((a, b) => a + b.score, 0) / boundaries.length : 7;
  const bMin = boundaries.length ? Math.min(...boundaries.map((b) => b.score)) : 7;
  set('hookStrength', 0.6 * shotScore(ids[0]) + 0.4 * (haveMeasured ? 3 + 7 * Math.min(1, meas[0] / Math.max(0.01, Math.max(...meas))) : 6) - (eIssues.includes('WEAK_HOOK') ? 1.5 : 0), haveMeasured ? 'measured' : 'heuristic', `hook shot ${shotScore(ids[0])}, energy ${meas[0]} of max ${Math.max(...meas)}`);
  const stalls = seqs.flatMap((s) => s.issues.filter((x) => x.code === 'NARRATIVE_STALL')).length;
  set('narrativeClarity', 7.2 - stalls * 0.8 - (film.source === 'derived' ? 1 : 0) - over.length * 0.5, 'heuristic', `${film.sequences.length} sequences (${film.sequences.map((s) => s.id).join(' → ')}), ${stalls} stall(s), ${over.length} overloaded shot(s)${film.source === 'derived' ? ', no authored film plan' : ''}`);
  const changesPer = boundaries.map((b) => b.changes.length);
  set('visualProgression', 4 + 5 * Math.min(1, boundaries.filter((b) => b.changes.includes('object-transformed') || b.changes.includes('object-moved')).length / Math.max(1, boundaries.length)) - resets.length * 1, 'measured', `${boundaries.filter((b) => b.changes.includes('object-transformed') || b.changes.includes('object-moved')).length}/${boundaries.length} cuts move or transform something on screen; changes per cut ${changesPer.join(', ')}`);
  const distinct = (k: keyof FilmMemory['used']) => Object.keys(mem.used[k]).length;
  set('visualVariety', 3 + 6 * Math.min(1, (distinct('layout') / Math.max(1, ids.length) + distinct('transitionOut') / Math.max(1, ids.length - 1) + distinct('shotSize') / 4) / 2.2) - lazy.length * 0.7, 'measured', `${distinct('layout')} layouts, ${distinct('transitionOut')} transition kinds, ${distinct('shotSize')} shot sizes over ${ids.length} shots; lazy repetition: ${lazy.map((r) => r.what).join(', ') || 'none'}`);
  set('continuity', 3 + 6 * (boundaries.filter((b) => !b.worldReset).length / Math.max(1, boundaries.length)) - (critic ? 0 : 0.5), 'measured', `${boundaries.filter((b) => !b.worldReset).length}/${boundaries.length} cuts keep, transform or hand something over`);
  const holds = critic?.issues.filter((i) => i.code === 'DEAD_HOLD').length ?? 0;
  set('pacing', 7.5 - holds * 0.8 - over.length * 0.6 - (inp.rhythmCv !== undefined && inp.rhythmCv < 0.1 ? 1 : 0), 'heuristic', `${holds} dead hold(s), ${over.length} overloaded shot(s), duration variation ${inp.rhythmCv ?? '—'}`);
  const repRh = seqs.some((s) => s.issues.some((x) => x.code === 'REPEATED_RHYTHM'));
  set('rhythm', 4 + 5 * Math.min(1, (inp.rhythmCv ?? 0.2) / 0.25) - (repRh ? 1 : 0) - (lazy.some((r) => r.what === 'rhythm') ? 1 : 0), 'measured', `shot length variation ${inp.rhythmCv ?? '—'}${repRh ? ', a sequence repeats one length' : ''}`);
  set('energyArc', haveMeasured ? 4 + 4.5 * Math.max(0, corr ?? 0) + Math.min(1, sd / 0.15) - eIssues.length * 0.6 : 5, haveMeasured ? 'measured' : 'heuristic', `planned vs measured ρ ${corr ?? '—'}, spread ${r2(sd)}; ${eIssues.join(', ') || 'no arc issue'}`);
  const mot = inp.filmReport?.motifs ?? [];
  const motOk = mot.reduce((a, m) => a + m.appearances.filter((x) => x.ok).length, 0);
  const motAll = mot.reduce((a, m) => a + m.appearances.length, 0);
  set('motifDevelopment', mot.length ? 3 + 6 * (motOk / Math.max(1, motAll)) * Math.min(1, mot.reduce((a, m) => a + m.appearances.length, 0) / (2.5 * mot.length)) : 3, mot.length ? 'measured' : 'heuristic', mot.length ? `${mot.length} motif(s), ${motOk}/${motAll} planned appearances on screen` : 'no motif in the film plan');
  set('cameraArc', moving.length ? 7.5 - off.length * 1.2 - (dep > 0.4 ? 1.5 : 0) : 6.5, 'measured', moving.length ? `${moving.length} moving shot(s), ${off.length} against the arc, camera-only share ${Math.round(dep * 100)}%` : 'no camera move: the arc is carried by the elements');
  const typos = distinct('typography');
  set('typographyArc', 4.5 + Math.min(3.5, typos * 0.9) - (lazy.some((r) => r.what === 'typography') ? 1.2 : 0), 'measured', `${typos} typographic treatments (${Object.keys(mem.used.typography).join(', ')})`);
  const kinds = Object.keys(mem.used.transitionOut).filter((k) => k !== 'end');
  const repT = lazy.find((r) => r.what === 'transition');
  set('transitionLanguage', 0.55 * bq + 0.25 * bMin + 1.5 + Math.min(1, kinds.length / 3) - (repT ? 1.2 : 0), 'measured', `boundary scores mean ${r2(bq)}, weakest ${r2(bMin)}; kinds: ${kinds.join(', ')}${repT ? `; repeated ${repT.value}` : ''}`);
  set('brandIntegration', critic?.visual.scores.brand?.score ?? 6, critic ? 'measured' : 'heuristic', `shot critic brand ${critic?.visual.scores.brand?.score ?? '—'}`);
  set('ctaPayoff', payoff.connected ? 6 + Math.min(3, payoff.evidence.length) : 3 + Math.min(1.5, payoff.evidence.length), 'measured', `${payoff.how}${payoff.evidence.length ? ` (${payoff.evidence.join('; ')})` : ''}`);
  set('memorability', 4 + (payoff.connected ? 1 : 0) + Math.min(1.5, mot.length * 0.75) + (dims.visualVariety.score >= 6.5 ? 0.6 : 0) + (resets.length ? -0.8 : 0.4), 'heuristic', 'heuristic only (motif, payoff, variety, continuity) — memorability is not a measurement; capped at 7.5 without Claude Judgment');
  set('commercialEffectiveness', 0.4 * (critic?.overall ?? 6) + 0.3 * dims.ctaPayoff.score + 0.3 * dims.narrativeClarity.score, 'heuristic', 'heuristic: shot quality, CTA payoff, narrative clarity — capped at 7.5 without Claude Judgment');
  const vals = FILM_DIMENSIONS.map((d) => dims[d].score);
  const meanD = vals.reduce((a, b) => a + b, 0) / vals.length;
  const pen = issues.reduce((a, x) => a + (x.severity === 'major' ? 0.35 : 0.1), 0);
  const overall = r2(clamp(Math.min(meanD - pen, Math.min(...vals) + 3.2), 0, 9.5));
  return { version: 1, dims, overall, sequences: seqs, boundaries: boundaries.map((b) => ({ id: b.id, score: b.score, source: b.quality.source, issues: b.issues.map((x) => x.code) })), energy: { planned, measured: meas, correlation: corr, issues: eIssues }, repetition: reps, payoff, worldResets: resets, issues };
}

/**
 * Sequence-level version score (P3-U): a version is judged by its shots AND its cuts AND its
 * sequences — never a naive average of shot scores. A technical failure always loses.
 */
export function versionScore(critic: CriticReport, film: FilmCriticReport | null): number {
  if (!critic.technical.pass) return -10 + critic.overall / 10;
  if (!film) return critic.overall;
  const seq = film.sequences.length ? film.sequences.reduce((a, s) => a + s.score, 0) / film.sequences.length : critic.overall;
  const bnd = film.boundaries.length ? film.boundaries.reduce((a, b) => a + b.score, 0) / film.boundaries.length : critic.overall;
  const weakest = film.boundaries.length ? Math.min(...film.boundaries.map((b) => b.score)) : critic.overall;
  return r2(0.35 * critic.overall + 0.25 * seq + 0.15 * bnd + 0.1 * weakest + 0.15 * film.overall);
}

/**
 * Local Sequence Score (P3-K): a shot repair is judged with its neighbourhood — the shot, the cut into
 * it, the cut out of it, continuity and eye flow. A better shot that breaks its cuts can score lower.
 */
export function localSequenceScore(shot: string, critic: CriticReport, boundaries: Boundary[]): { score: number; parts: { shot: number; in: number | null; out: number | null; continuity: number; eye: number } } {
  const s = critic.shots.find((x) => x.shot === shot)?.overall ?? critic.overall;
  const bin = boundaries.find((b) => b.targetShot === shot) ?? null;
  const bout = boundaries.find((b) => b.sourceShot === shot) ?? null;
  const near = [bin, bout].filter((b): b is Boundary => Boolean(b));
  const cont = near.length ? (10 * near.filter((b) => !b.worldReset).length) / near.length : 8;
  const eye = near.length ? (10 * near.filter((b) => b.eye.guided || b.eye.travel < 0.28).length) / near.length : 8;
  const bAvg = near.length ? near.reduce((a, b) => a + b.score, 0) / near.length : s;
  const score = r2(0.45 * s + 0.35 * bAvg + 0.1 * cont * 0.9 + 0.1 * eye * 0.9);
  return { score, parts: { shot: s, in: bin ? r2(bin.score) : null, out: bout ? r2(bout.score) : null, continuity: r2(cont), eye: r2(eye) } };
}
