/**
 * Style frames (P1-N): the key visual moments named in direction.json, frozen as stills BEFORE the
 * film is judged as motion. "settle" = the last calm moment of the shot (just before its exit
 * transition starts). Written to style_frames/<shot>.png + style_frames.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec } from '../schema/video';
import type { StagePlan } from '../stage/plan';
import { prepare, renderFrame } from './render';
import { settleTimeOf } from '../qc/stage-probes';

export function styleFrameTimes(plan: Pick<StagePlan, 'shots' | 'transitions'>, frames: { shot: string; at: number | 'settle'; note: string }[]): { shot: string; t: number; note: string }[] {
  const out: { shot: string; t: number; note: string }[] = [];
  for (const f of frames) {
    const s = plan.shots.find((x) => x.id === f.shot);
    if (!s) continue;
    if (typeof f.at === 'number') {
      out.push({ shot: f.shot, t: Math.min(s.end - 0.04, s.start + f.at), note: f.note });
      continue;
    }
    out.push({ shot: f.shot, t: settleTimeOf(plan, s.id), note: f.note });
  }
  return out;
}

export async function renderStyleFrames(spec: VideoSpec, projectDir: string, scale = 0.5): Promise<{ shot: string; t: number; note: string; file: string }[]> {
  const dirFile = join(projectDir, 'direction.json');
  if (!spec.stage || !existsSync(dirFile)) return [];
  const direction = JSON.parse(readFileSync(dirFile, 'utf8')) as { styleFrames?: { shot: string; at: number | 'settle'; note: string }[] };
  const times = styleFrameTimes(spec.stage as unknown as StagePlan, direction.styleFrames ?? []);
  if (!times.length) return [];
  const outDir = join(projectDir, 'style_frames');
  mkdirSync(outDir, { recursive: true });
  const prep = await prepare(spec, projectDir, 'render');
  const res: { shot: string; t: number; note: string; file: string }[] = [];
  for (const f of times) {
    const file = join(outDir, `${f.shot}.png`);
    await renderFrame(prep, Math.round(f.t * spec.canvas.fps), file, scale);
    res.push({ ...f, file });
  }
  writeFileSync(join(projectDir, 'style_frames.json'), JSON.stringify({ version: 1, frames: res.map((r) => ({ ...r, file: `style_frames/${r.shot}.png` })) }, null, 2));
  return res;
}

// ═════════════════════ P2-F: Style Frame Review & Gate ═════════════════════
import { runStageProbes } from './stage-probes';
import { analyzeStageProbes, settleTimes } from '../qc/stage-probes';
import { critique } from '../qc/critic';
import type { StageReport } from '../stage/compiler';
import { planRepairs, type RepairAttempt } from '../stage/repair-planner';
import { applyRedirection, type Redirection } from '../stage/redirection';
import { log } from '../core/logger';

export interface GateShot {
  shot: string;
  overall: number;
  verdict: 'accept' | 'repair' | 'reject';
  checks: { hierarchy: number; subjectSize: number; readability: number; balance: number; collision: boolean; safeArea: boolean; brand?: boolean };
  issues: string[];
}
export interface GateRound {
  round: number;
  shots: GateShot[];
  redirection?: Redirection;
  rejected?: { shot: string; asked: string; why: string }[];
  /** Shots whose re-direction made their own frame worse, put back. */
  reverted?: string[];
}

/** Gate thresholds (lenient at first: the gate stops weak compositions, it does not chase scores). */
export const GATE = { accept: 5.5, reject: 3.5, minHierarchy: 4.5, minSubject: 4, minReadability: 4.5 } as const;
const BLOCKING = new Set(['ROW_OF_SMALL_OBJECTS', 'ELEMENT_OFF_FRAME', 'ITEMS_OVERLAP', 'NO_DOMINANT_SUBJECT', 'TINY_SUBJECT', 'UNREADABLE_TEXT', 'EMPTY_COMPOSITION', 'WEAK_CTA_COMPOSITION', 'TEXT_OFF_FRAME', 'TEXT_COLLISION', 'SUBJECT_OBSTRUCTION']);

/** Judges every shot at its settle frame (DOM, not pixels: hierarchy, subject size, readability, balance, collisions, safe area, brand). */
export async function judgeStyleFrames(spec: VideoSpec, projectDir: string, tag: string): Promise<{ shots: GateShot[]; critic: ReturnType<typeof critique> }> {
  const plan = spec.stage as unknown as StagePlan;
  const times = settleTimes(plan);
  const pr = await runStageProbes(spec, projectDir, { times, out: join(projectDir, `style_frame_dom${tag}.json`), samplesOut: false });
  const samples = pr?.samples ?? [];
  const dom = analyzeStageProbes(plan, samples, { W: spec.canvas.width, H: spec.canvas.height });
  const report = JSON.parse(readFileSync(join(projectDir, 'stage_report.json'), 'utf8')) as StageReport;
  // settle frames only: still / motion dimensions are not judged here, only the frames
  const c = critique({ plan, report, samples, dom: { ...dom, collisions: [], still: { sec: 0, share: 0, longest: 0, runs: [] }, camera: { movingSec: 0, shots: [] }, words: [], subjects: [] }, direction: null });
  const shots: GateShot[] = c.shots.map((v) => {
    const iss = c.issues.filter((i) => i.shot === v.shot && i.severity !== 'minor');
    const off = (dom.offFrame ?? []).some((o) => o.shot === v.shot);
    const brandShot = /logo/.test(String(v.hierarchy?.firstRead ?? ''));
    const checks = { hierarchy: v.scores.hierarchy, subjectSize: v.scores.frameUtilization, readability: v.scores.typography, balance: v.scores.composition, collision: iss.some((i) => i.code === 'TEXT_COLLISION' || i.code === 'SUBJECT_OBSTRUCTION'), safeArea: !off, ...(brandShot ? { brand: true } : {}) };
    const blocking = iss.filter((i) => BLOCKING.has(i.code));
    const verdict: GateShot['verdict'] = v.overall < GATE.reject ? 'reject' : v.overall < GATE.accept || blocking.length || checks.hierarchy < GATE.minHierarchy || checks.subjectSize < GATE.minSubject || checks.readability < GATE.minReadability || !checks.safeArea ? 'repair' : 'accept';
    return { shot: v.shot, overall: v.overall, verdict, checks, issues: iss.map((i) => `${i.code}: ${i.evidence}`) };
  });
  return { shots, critic: c };
}

/**
 * The gate (Direction → Shot Script → Stage → Style Frames → Visual Critic → Re-Director → approved
 * frames → Animatic): weak compositions are re-directed BEFORE a single frame of motion is rendered.
 * Up to `rounds` re-direction rounds; the best set of frames is kept. Writes style_frame_gate.json.
 */
export async function styleFrameGate(opts: { spec: VideoSpec; projectDir: string; brief: unknown; baseDir: string; rounds?: number; redirector?: boolean }): Promise<{ spec: VideoSpec; rounds: GateRound[]; passed: boolean; changed: boolean }> {
  let spec = opts.spec;
  const { projectDir } = opts;
  const rounds: GateRound[] = [];
  const max = opts.rounds ?? 2;
  let changed = false;
  let bestScript: unknown = null;
  let bestScore = -1;
  // per-shot memory: a re-direction that made its own frame worse is undone for that shot
  const bestShot = new Map<string, { score: number; entry: unknown }>();
  let reverted: string[] = [];
  const gateMem: { version: 1; attempts: RepairAttempt[] } = existsSync(join(projectDir, 'repair_memory.json')) ? JSON.parse(readFileSync(join(projectDir, 'repair_memory.json'), 'utf8')) : { version: 1, attempts: [] };
  let pending: RepairAttempt[] = [];
  for (let r = 0; ; r++) {
    const { shots, critic } = await judgeStyleFrames(spec, projectDir, `.r${r}`);
    const round: GateRound = { round: r, shots };
    rounds.push(round);
    const score = shots.reduce((a, s) => a + s.overall, 0) / Math.max(1, shots.length);
    const script = JSON.parse(readFileSync(join(projectDir, 'shots.json'), 'utf8')) as { shots: { id: string }[] };
    reverted = [];
    for (const s of shots) {
      const entry = script.shots.find((x) => x.id === s.shot);
      const prev = bestShot.get(s.shot);
      if (!prev || s.overall >= prev.score) bestShot.set(s.shot, { score: s.overall, entry });
      else if (entry) {
        script.shots[script.shots.indexOf(entry)] = prev.entry as never;
        reverted.push(s.shot);
      }
    }
    if (reverted.length) round.reverted = reverted;
    for (const a of pending) {
      const now = shots.find((x) => x.shot === a.shot)?.overall ?? 0;
      a.after = { overall: score, shot: now };
      a.result = now > (a.before.shot ?? 0) + 0.05 ? 'improved' : now < (a.before.shot ?? 0) - 0.05 ? 'regressed' : 'no-change';
    }
    pending = [];
    if (score > bestScore) {
      bestScore = score;
      bestScript = script;
    }
    const failing = shots.filter((s) => s.verdict !== 'accept');
    log.stage('GATE', `style frames round ${r}: ${shots.map((s) => `${s.shot} ${s.overall}${s.verdict === 'accept' ? '' : ` (${s.verdict})`}`).join(' · ')}`);
    if (reverted.length) log.stage('GATE', `undone for ${reverted.join(', ')}: the re-direction made the frame worse`);
    if (!failing.length || r >= max || opts.redirector === false) {
      if (reverted.length) {
        const { direct } = await import('./direct');
        const direction = existsSync(join(projectDir, 'direction.json')) ? JSON.parse(readFileSync(join(projectDir, 'direction.json'), 'utf8')) : undefined;
        spec = (await direct({ brief: opts.brief, baseDir: opts.baseDir, projectDir, shots: script, direction })).spec!;
      }
      break;
    }
    // re-direct the failing frames (composition only: timing, camera and transitions are judged on the animatic)
    const comp = { ...critic, issues: critic.issues.filter((i) => failing.some((f) => f.shot === i.shot) && BLOCKING.has(i.code)) };
    const rp = planRepairs({ plan: spec.stage as unknown as StagePlan, script: script as never, critic: comp, memory: gateMem as never, pass: r + 1 });
    // the gate judges composition only: camera, timing and transition directives wait for the animatic
    const recompose = rp.selected.filter((c) => (c.kind === 'recompose' || c.kind === 'local' || c.kind === 'depth') && !c.directive.camera && !c.directive.retime && !c.directive.transition && !c.directive.timing);
    if (!recompose.length) break;
    for (const c of recompose) {
      const a: RepairAttempt = { pass: r + 1, shot: c.shot, candidate: c.id, label: `gate: ${c.label}`, issues: c.directive.issues ?? [], cost: c.cost, before: { overall: score, shot: shots.find((x) => x.shot === c.shot)?.overall } };
      pending.push(a);
      gateMem.attempts.push(a);
    }
    const red: Redirection = { version: 1, source: 'deterministic', pass: r + 1, shots: recompose.map((c) => c.directive), notes: 'style frame gate' };
    round.redirection = red;
    const { script: next, report } = applyRedirection(script as never, red);
    round.rejected = report.rejected;
    for (const c of recompose) log.stage('GATE', `re-direct [${c.shot}] ${c.label} — ${c.directive.expected ?? ''}`);
    const { direct } = await import('./direct');
    const direction = existsSync(join(projectDir, 'direction.json')) ? JSON.parse(readFileSync(join(projectDir, 'direction.json'), 'utf8')) : undefined;
    spec = (await direct({ brief: opts.brief, baseDir: opts.baseDir, projectDir, shots: next, direction })).spec!;
    changed = true;
  }
  const last = rounds[rounds.length - 1];
  const lastScore = last.shots.reduce((a, s) => a + s.overall, 0) / Math.max(1, last.shots.length);
  if (changed && lastScore < bestScore - 0.01 && bestScript) {
    // the last round was worse: the best frames win
    const { direct } = await import('./direct');
    const direction = existsSync(join(projectDir, 'direction.json')) ? JSON.parse(readFileSync(join(projectDir, 'direction.json'), 'utf8')) : undefined;
    spec = (await direct({ brief: opts.brief, baseDir: opts.baseDir, projectDir, shots: bestScript, direction })).spec!;
    log.stage('GATE', `kept the best style frames (mean ${bestScore.toFixed(2)})`);
  }
  if (gateMem.attempts.length) writeFileSync(join(projectDir, 'repair_memory.json'), JSON.stringify(gateMem, null, 2));
  const passed = rounds[rounds.length - 1].shots.every((s) => s.verdict !== 'reject');
  writeFileSync(join(projectDir, 'style_frame_gate.json'), JSON.stringify({ version: 1, thresholds: GATE, rounds, attempts: gateMem.attempts.filter((a) => a.label.startsWith('gate:')), passed, best: Math.round(bestScore * 100) / 100 }, null, 2));
  await renderStyleFrames(spec, projectDir);
  return { spec, rounds, passed, changed };
}
