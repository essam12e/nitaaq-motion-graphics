/**
 * Rhythm & Pacing Director (P3-I) + Information Flow (P3-X).
 *
 * Per shot: what it asks the viewer to take in (new concepts: words of new text, numbers, new objects,
 * a logo, a CTA), how long it gives them (shot duration, the voice rate when there is a voice), how
 * much moves (motion density), how long its cuts take, and its holds — an INTENTIONAL hold (a read, a
 * resolve, declared) versus a DEAD hold (nothing to read, nothing moving, not declared).
 *
 * The director's adjustments are bounded and reported: without a voice, a shot that cannot be read in
 * its time is lengthened (≤ +25%) and a sparse high-energy shot is tightened (≤ −15%); with a voice the
 * voice keeps the time and an overload is only reported. Durations that repeat across the film are
 * varied by a step (Repeated Rhythm).
 * Pure (no node APIs).
 */
import type { StagePlan } from '../stage/plan';

const r2 = (x: number) => Math.round(x * 100) / 100;

export interface ShotInfo {
  shot: string;
  duration: number;
  /** New concepts the shot introduces (a short phrase ≈ 1, a long line ≈ 2–3, a number 1, an object 0.5, a logo / CTA 1). */
  concepts: number;
  words: number;
  newElements: string[];
  /** Concepts per second. */
  density: number;
  /** Seconds a viewer needs to take it in (Arabic ≈ 3 words/s + 0.35 s per new object + a beat). */
  readTime: number;
  /** concepts arriving within 0.6 s of each other at the busiest moment. */
  peakBurst: number;
  overload: boolean;
  sparse: boolean;
}

/** Information density per shot from the compiled plan (+ the voice: words actually spoken in the shot). */
export function informationFlow(plan: StagePlan, voiceWords?: { word: string; start: number; end: number }[]): ShotInfo[] {
  const byId = new Map(plan.elements.map((e) => [e.id, e]));
  return plan.shots.map((s, i) => {
    const prev = new Set(i > 0 ? (plan.shots[i - 1].cast ?? []).map((c) => c.id) : []);
    const fresh = (s.cast ?? []).map((c) => byId.get(c.id)).filter((e): e is NonNullable<typeof e> => Boolean(e && !prev.has(e.id) && e.kind !== 'cursor' && !e.parent));
    let concepts = 0;
    let words = 0;
    const arrivals: number[] = [];
    for (const e of fresh) {
      const text = e.content.text ?? e.content.title ?? '';
      const w = text.split(/\s+/).filter(Boolean).length;
      words += w;
      const c = e.kind === 'text' ? Math.max(1, Math.ceil(w / 4)) : e.kind === 'number' ? 1 : e.kind === 'image' && e.content.asset === 'logo' ? 1 : e.kind === 'button' ? 1 : e.kind === 'line' || e.kind === 'shape' ? 0.3 : e.kind === 'card' || e.kind === 'chip' ? 0.5 + Math.min(1, w / 6) : 0.5;
      concepts += c;
      arrivals.push(Math.max(s.start, e.life.from));
    }
    arrivals.sort((a, b) => a - b);
    let peakBurst = 0;
    for (let k = 0; k < arrivals.length; k++) peakBurst = Math.max(peakBurst, arrivals.filter((t) => t >= arrivals[k] && t <= arrivals[k] + 0.6).length);
    const dur = s.end - s.start;
    const spoken = voiceWords?.filter((w) => w.start >= s.start && w.start < s.end).length ?? 0;
    const readTime = r2(0.6 + Math.max(words, spoken) / 3 + 0.35 * fresh.filter((e) => e.kind !== 'text').length);
    const density = r2(concepts / Math.max(0.3, dur));
    return { shot: s.id, duration: r2(dur), concepts: r2(concepts), words, newElements: fresh.map((e) => e.id), density, readTime, peakBurst, overload: readTime > dur * 1.05 || peakBurst >= 5 || density > 1.6, sparse: concepts <= 0.6 && dur > 3 };
  });
}

export interface RhythmAdjust {
  shot: string;
  from: number;
  to: number;
  why: string;
}

export interface RhythmReport {
  version: 1;
  info: ShotInfo[];
  durations: number[];
  /** Coefficient of variation of the shot durations (0 = every shot the same length). */
  durationCv: number;
  repeatedRhythm: boolean;
  adjustments: RhythmAdjust[];
  holds: { shot: string; sec: number; class: 'intentional' | 'dead'; why: string }[];
  notes: string[];
}

type ShotObj = { id: string; purpose?: string; expectedEnergy?: number; timing?: { duration?: number }; hold?: { intentional?: boolean; reason?: string; maxSec?: number }; [k: string]: unknown };

/**
 * Rhythm Director: proposes duration changes for a script without a voice (bounded), from information
 * density and planned energy. `stillRuns` (DOM still runs) classify holds as intentional or dead.
 */
export function directRhythm(plan: StagePlan, script: { shots: ShotObj[] }, opts: { voice: boolean; energy?: Record<string, number>; stillRuns?: { t0: number; t1: number }[]; voiceWords?: { word: string; start: number; end: number }[] } = { voice: false }): RhythmReport {
  const info = informationFlow(plan, opts.voiceWords);
  const durations = info.map((x) => x.duration);
  const mean = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const sd = Math.sqrt(durations.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, durations.length));
  const cv = r2(sd / Math.max(0.01, mean));
  const adjustments: RhythmAdjust[] = [];
  const notes: string[] = [];
  for (const x of info) {
    const s = script.shots.find((y) => y.id === x.shot);
    if (!s) continue;
    const e = opts.energy?.[x.shot] ?? s.expectedEnergy ?? 0.6;
    if (opts.voice) {
      if (x.overload) notes.push(`${x.shot}: ${x.concepts} concepts in ${x.duration}s (needs ≈${x.readTime}s) — the voice keeps the time: reported, not changed`);
      continue;
    }
    if (x.readTime > x.duration * 1.05) {
      const to = r2(Math.min(x.duration * 1.25, x.readTime + 0.2));
      adjustments.push({ shot: x.shot, from: x.duration, to, why: `${x.words} words / ${x.newElements.length} new objects need ≈${x.readTime}s; the shot had ${x.duration}s` });
    } else if (e >= 0.75 && x.readTime < x.duration * 0.6 && x.duration > 2.4) {
      const to = r2(Math.max(x.duration * 0.85, x.readTime + 0.8));
      adjustments.push({ shot: x.shot, from: x.duration, to, why: `high planned energy (${e}) and only ≈${x.readTime}s to read in ${x.duration}s: tightened` });
    }
  }
  // repeated rhythm: three or more consecutive shots of (almost) the same length
  let run = 1;
  let repeated = false;
  for (let k = 1; k < durations.length; k++) {
    run = Math.abs(durations[k] - durations[k - 1]) < 0.2 ? run + 1 : 1;
    if (run >= 3) repeated = true;
  }
  if (repeated && !opts.voice) notes.push('three or more consecutive shots of the same length: the energy arc decides which to tighten');
  // holds: still runs inside shots
  const holds: RhythmReport['holds'] = [];
  for (const r of opts.stillRuns ?? []) {
    const sec = r2(r.t1 - r.t0);
    if (sec < 0.6) continue;
    const s = plan.shots.find((x) => r.t0 >= x.start && r.t0 < x.end);
    if (!s) continue;
    const decl = script.shots.find((y) => y.id === s.id)?.hold;
    const last = s.id === plan.shots[plan.shots.length - 1].id;
    const inf = info.find((x) => x.shot === s.id)!;
    const reading = inf.words >= 4 && sec <= inf.readTime;
    const intentional = Boolean(decl?.intentional && sec <= (decl.maxSec ?? 9)) || (last && sec <= 1.8) || reading;
    holds.push({ shot: s.id, sec, class: intentional ? 'intentional' : 'dead', why: intentional ? (decl?.reason ?? (last ? 'ending hold' : `a read: ${inf.words} words need ≈${inf.readTime}s`)) : `${sec}s with nothing moving and nothing new to read` });
  }
  return { version: 1, info, durations, durationCv: cv, repeatedRhythm: repeated, adjustments, holds, notes };
}
