/**
 * P4-R/AJ/AI/V — candidate tournament, candidate cost, Repair Memory v3, budgets (Global Re-Director v2).
 *
 *   detect → diagnose → 2–4 candidates → cheap filter (predicted) → preview render (measured)
 *          → judge (veto on technical failure) → select (must beat the kept version by a margin)
 *
 * The kept version (P3 / the current film) always takes part, measured the same way; when no candidate
 * beats it, it stays — the fail-safe at the level of one problem. Every candidate is recorded with its
 * predicted score, its preview-measured score and why it won or lost (candidate_tournament.json), and the
 * memory remembers WHY a candidate failed so the same idea is not rendered again for the same problem
 * signature (art_memory.json). Budgets: local problems first, then sequence, then a RESERVED global pass —
 * the global level runs even while lower levels still have work (P3's global pass never ran because the
 * lower levels always found something). Pure.
 */
import type { ProblemKind, PreviewMeasure, Verdict } from './judge';

export interface CandidateRecord {
  problem: string;
  candidate: string;
  label: string;
  why: string;
  predicted: { score: number; veto: string | null; notes?: string[] } | null;
  preview: { score: number; veto: string | null; parts: Record<string, number>; measure: Pick<PreviewMeasure, 'motion' | 'clash' | 'void' | 'midMotion' | 'presence' | 'boundary'> } | null;
  status: 'accepted' | 'rejected' | 'filtered' | 'kept' | 'compile-failed' | 'memory-skip';
  reason: string;
  cost: { frames: number; renderMs: number; cached: number };
}

export interface ProblemRecord {
  problem: string;
  kind: ProblemKind;
  code: string;
  level: 'local' | 'sequence' | 'global';
  shots: string[];
  range: [number, number];
  why: string;
  base: { predicted: number | null; preview: number | null };
  winner: string | null;
  candidates: CandidateRecord[];
  ms: number;
}

export interface Tournament {
  version: 1;
  problems: ProblemRecord[];
  totals: { candidates: number; rendered: number; accepted: number; rejected: number; filtered: number; previewFrames: number; previewMs: number; cacheHits: number };
}

/** Cheap filter: drop what the prediction already rejects; keep the best `max` by predicted score. */
export function cheapFilter<T extends { id: string; predicted: Verdict | null }>(cands: T[], basePredicted: number | null, max = 3): { keep: T[]; drop: { id: string; why: string }[] } {
  const drop: { id: string; why: string }[] = [];
  const ok = cands.filter((c) => {
    if (!c.predicted) return true;
    if (c.predicted.veto) {
      drop.push({ id: c.id, why: `predicted veto: ${c.predicted.veto}` });
      return false;
    }
    if (basePredicted !== null && c.predicted.score < basePredicted - 1.5) {
      drop.push({ id: c.id, why: `predicted ${c.predicted.score} far under the kept version (${basePredicted})` });
      return false;
    }
    return true;
  });
  const sorted = [...ok].sort((a, b) => (b.predicted?.score ?? 0) - (a.predicted?.score ?? 0));
  for (const c of sorted.slice(max)) drop.push({ id: c.id, why: `budget: only the ${max} best predicted are rendered` });
  return { keep: sorted.slice(0, max), drop };
}

/** The winner: the best preview score with no veto that beats the kept version by `margin` (else none). */
export function selectWinner<T extends { id: string; preview: Verdict | null }>(cands: T[], basePreview: number, margin = 0.35): { winner: T | null; why: string } {
  const live = cands.filter((c) => c.preview && !c.preview.veto).sort((a, b) => b.preview!.score - a.preview!.score);
  const best = live[0];
  if (!best) return { winner: null, why: 'no candidate survives the preview (every one vetoed or none rendered): the kept version stays' };
  if (best.preview!.score < basePreview + margin) return { winner: null, why: `the best candidate (${best.id} ${best.preview!.score}) does not beat the kept version (${basePreview}) by ${margin}: kept` };
  return { winner: best, why: `${best.id} ${best.preview!.score} > kept ${basePreview} (+${(best.preview!.score - basePreview).toFixed(2)})` };
}

export interface ArtMemory {
  version: 3;
  entries: { signature: string; problem: string; candidate: string; outcome: 'won' | 'lost' | 'vetoed'; why: string; predicted: number | null; preview: number | null; at: string }[];
}

/** Repair Memory v3: a candidate that lost / was vetoed for this exact problem signature is not rendered again. */
export function memorySkip(mem: ArtMemory | null, signature: string, candidate: string): string | null {
  const e = mem?.entries.find((x) => x.signature === signature && x.candidate === candidate && x.outcome !== 'won');
  return e ? `memory: ${e.outcome} before (${e.why})` : null;
}

export function remember(mem: ArtMemory, signature: string, rec: CandidateRecord, at: string): void {
  if (!['accepted', 'rejected'].includes(rec.status)) return;
  const outcome = rec.status === 'accepted' ? 'won' : rec.preview?.veto ? 'vetoed' : 'lost';
  mem.entries = mem.entries.filter((x) => !(x.signature === signature && x.candidate === rec.candidate));
  mem.entries.push({ signature, problem: rec.problem, candidate: rec.candidate, outcome, why: rec.reason, predicted: rec.predicted?.score ?? null, preview: rec.preview?.score ?? null, at });
}

export interface Budget {
  /** candidates rendered per problem (excluding the kept version). */
  perProblem: number;
  local: number;
  sequence: number;
  global: number;
  /** preview frames for the whole pass. */
  frames: number;
}
export const DEFAULT_BUDGET: Budget = { perProblem: 3, local: 6, sequence: 2, global: 1, frames: 1400 };

/** Orders problems local → sequence → global and keeps each level within its budget (the global slot is reserved). */
export function budgetProblems<P extends { level: 'local' | 'sequence' | 'global' }>(problems: P[], b: Budget = DEFAULT_BUDGET): { run: P[]; deferred: P[] } {
  const by = (l: P['level']) => problems.filter((p) => p.level === l);
  const run = [...by('local').slice(0, b.local), ...by('sequence').slice(0, b.sequence), ...by('global').slice(0, b.global)];
  return { run, deferred: problems.filter((p) => !run.includes(p)) };
}
