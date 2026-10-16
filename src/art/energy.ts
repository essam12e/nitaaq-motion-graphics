/**
 * P4-I/Y/Z/J/E — Energy Builder, Hook Builder, Climax Builder (hero moment), Rhythm Composer.
 *
 * Energy is not "more motion": it is where the film is fast, dense and causal and where it rests. The
 * builder reads the energy the film wants (film plan curve, else the shot's purpose) against the energy its
 * motion has (camera frozen, src/art/motion-analysis.ts) and gives each shot a phrase (tempo, bounce,
 * stagger, amplitude) — under-energised shots get faster, over-energised ones calmer.
 *
 * The hook gets a VISUAL EVENT in its first 1–2 s (not a fade): the hero slams in and the others answer it,
 * the scattered items land first and the hero lands on them, or an item collides with the hero.
 * The climax gets a HERO MOMENT — a causal interaction between elements (push / pull / become / respond),
 * never just a scale-up, a camera move or a glow.
 * The rhythm composer changes timing INSIDE the shots (shot lengths are the voice's): staggers that
 * accelerate into a peak, decelerate into a rest, and differ from shot to shot.
 * Every builder returns candidates; the preview renders choose. Pure.
 */
import type { StagePlan } from '../stage/plan';
import type { ScriptObj } from '../film/transition-redirector';
import { PHRASES, phraseFor } from './language';
import { shotEnergy } from './motion-analysis';

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; to?: string; style?: string; amount?: number; dur?: number; reason: string; [k: string]: unknown };
type Cast = { id: string; role?: string; enter?: string; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain: Ev[]; emphasisWords?: string[]; expectedEnergy?: number; timing?: { duration?: number }; phrase?: Record<string, unknown>; [k: string]: unknown };

export interface ArtCandidate {
  id: string;
  label: string;
  script: ScriptObj;
  why: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const kindOf = (script: ScriptObj, id: string) => script.stage?.elements.find((e) => e.id === id)?.kind ?? '';
const SMALL = ['card', 'chip', 'icon', 'shape', 'image', 'button', 'number'];

const PURPOSE_WANT: Record<string, number> = { hook: 0.9, problem: 0.7, pain: 0.7, solution: 0.6, demo: 0.55, process: 0.7, feature: 0.8, proof: 0.75, benefit: 0.7, cta: 0.5, logo: 0.4 };

/** The energy curve the film wants (0..1 per shot): the authored film plan when there is one, else purpose. */
export function wantedEnergy(script: ScriptObj, curve?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  script.shots.forEach((s, i) => {
    const sh = s as ShotObj;
    let v = curve?.[sh.id] ?? sh.expectedEnergy ?? PURPOSE_WANT[sh.purpose ?? ''] ?? 0.6;
    // the opening must hook: never under 0.8 in the first shot
    if (i === 0) v = Math.max(v, 0.8);
    out[sh.id] = v;
  });
  const top = Math.max(...Object.values(out));
  for (const k of Object.keys(out)) out[k] = Math.round((out[k] / top) * 1000) / 1000;
  return out;
}

export interface EnergyReport {
  version: 1;
  wanted: Record<string, number>;
  measured: Record<string, number>;
  early: Record<string, number>;
  gaps: Record<string, number>;
  phrases: Record<string, { name?: string; why: string }>;
  climax: string | null;
  issues: string[];
}

/** Energy Builder (I): per-shot phrase from wanted vs measured energy; the climax shot. */
export function buildEnergy(script: ScriptObj, plan: StagePlan, curve?: Record<string, number>): { report: EnergyReport; candidate: ArtCandidate } {
  const wanted = wantedEnergy(script, curve);
  const e = shotEnergy(plan);
  const top = Math.max(1e-6, ...e.map((x) => x.energy));
  const measured: Record<string, number> = {};
  const early: Record<string, number> = {};
  for (const x of e) {
    measured[x.shot] = Math.round((x.energy / top) * 1000) / 1000;
    early[x.shot] = x.early;
  }
  const gaps: Record<string, number> = {};
  const phrases: EnergyReport['phrases'] = {};
  const sc = clone(script);
  sc.shots.forEach((s) => {
    const sh = s as ShotObj;
    gaps[sh.id] = Math.round((wanted[sh.id] - (measured[sh.id] ?? 0)) * 1000) / 1000;
    const ph = phraseFor(sh.purpose ?? '', wanted[sh.id], measured[sh.id]);
    const { why, ...p } = ph;
    sh.phrase = p as never;
    phrases[sh.id] = { name: p.name, why };
  });
  const issues: string[] = [];
  const ids = script.shots.map((s) => s.id);
  if ((early[ids[0]] ?? 0) < 0.3) issues.push(`WEAK_HOOK: the first 1.5 s carry ${Math.round((early[ids[0]] ?? 0) * 100)}% of the film's peak motion`);
  const climax = climaxShot(script, wanted);
  if (climax) {
    const m = measured[climax] ?? 0;
    const others = Object.entries(measured).filter(([k]) => k !== climax && k !== ids[0]).map(([, v]) => v);
    if (others.length && m < Math.max(...others) * 0.85) issues.push(`WEAK_CLIMAX: ${climax} (wanted peak) has ${m.toFixed(2)} vs ${Math.max(...others).toFixed(2)} elsewhere`);
  }
  const ms = Object.values(measured);
  if (ms.length >= 4 && Math.max(...ms) - Math.min(...ms) < 0.25) issues.push('FLAT_FILM: the energy barely changes from shot to shot');
  return { report: { version: 1, wanted, measured, early, gaps, phrases, climax, issues }, candidate: { id: 'energy-phrases', label: 'energy-shaped phrases', script: sc, why: 'each shot moves with the phrase its energy calls for' } };
}

/** The climax: the shot the film wants most energy in, neither the opening nor the closing shot. */
export function climaxShot(script: ScriptObj, wanted: Record<string, number>): string | null {
  const mid = script.shots.slice(1, -1) as ShotObj[];
  if (!mid.length) return null;
  return mid.reduce((a, b) => ((wanted[b.id] ?? 0) > (wanted[a.id] ?? 0) + 1e-6 ? b : a)).id;
}

const named = (chain: Ev[], base: string) => {
  let n = base;
  let k = 2;
  while (chain.some((e) => e.id === n)) n = `${base}-${k++}`;
  return n;
};
const withoutEnter = (chain: Ev[], ids: string[]) => chain.filter((e) => !(e.action === 'enter' && ids.includes(e.element)));

/** Hook Builder (Y): a visual event in the first 1–2 s of the opening shot — 2–3 candidates. */
export function hookCandidates(script: ScriptObj): ArtCandidate[] {
  const s0 = script.shots[0] as ShotObj;
  const cast = s0.cast ?? [];
  const hero = cast.find((c) => c.role === 'hero')?.id ?? (s0.subject as string);
  const supports = cast.filter((c) => c.id !== hero && SMALL.includes(kindOf(script, c.id))).map((c) => c.id);
  const word = (s0.emphasisWords ?? [])[0];
  const out: ArtCandidate[] = [];
  const punch = (sh: ShotObj) => {
    const { use: _u, ...p } = PHRASES.punch;
    sh.phrase = p as never;
  };
  if (!hero) return out;
  // 1 slam: the hero arrives fast and big; the supports are thrown in by its landing
  {
    const sc = clone(script);
    const sh = sc.shots[0] as ShotObj;
    sh.motionChain = withoutEnter(sh.motionChain, [hero, ...supports]);
    const hc = sh.cast!.find((c) => c.id === hero)!;
    hc.enter = 'scale';
    sh.motionChain.unshift({ id: named(sh.motionChain, 'slam'), element: hero, action: 'enter', at: 0.08, reason: 'the hook opens on the problem itself, landing hard' });
    supports.forEach((id, k) => sh.motionChain.push({ id: named(sh.motionChain, `thrown-${k + 1}`), element: id, action: 'enter', after: k === 0 ? 'slam.peak' : `thrown-${k}.peak`, style: 'drop', reason: 'the landing throws the scattered tools onto the frame' }));
    if (word) sh.motionChain.push({ element: `word:${word}`, action: 'emphasis', after: supports.length ? `thrown-${supports.length}.end` : 'slam.end', reason: 'the key word lands when the mess is complete' });
    punch(sh);
    out.push({ id: 'hook-slam', label: 'slam', script: sc, why: `${hero} lands in the first 0.1 s; ${supports.length} element(s) are thrown in by the landing` });
  }
  if (supports.length) {
    // 2 scatter-first: the scattered items land first, the hero lands on them and they recoil
    const sc = clone(script);
    const sh = sc.shots[0] as ShotObj;
    sh.motionChain = withoutEnter(sh.motionChain, [hero, ...supports]);
    supports.forEach((id, k) => {
      const c = sh.cast!.find((x) => x.id === id)!;
      c.enter = 'drop';
      sh.motionChain.push({ id: named(sh.motionChain, `drop-${k + 1}`), element: id, action: 'enter', ...(k === 0 ? { at: 0.05 } : { after: `drop-${k}.peak` }), reason: 'the mess arrives first: scattered tools fall in' });
    });
    sh.motionChain.push({ id: named(sh.motionChain, 'land'), element: hero, action: 'enter', after: `drop-${supports.length}.peak`, reason: 'the problem lands on the mess' });
    for (const id of supports) sh.motionChain.push({ element: id, action: 'respond', style: 'recoil', to: hero, after: 'land.peak', amount: 0.04, reason: 'the landing pushes the tools aside' });
    punch(sh);
    out.push({ id: 'hook-scatter', label: 'scatter-first', script: sc, why: `${supports.length} item(s) fall in from 0.05 s, the hero lands on them and they recoil` });
    // 3 collision: the hero is there at once; an item slides into it and the impact carries
    const sc2 = clone(script);
    const sh2 = sc2.shots[0] as ShotObj;
    sh2.motionChain = withoutEnter(sh2.motionChain, [hero, ...supports]);
    sh2.motionChain.unshift({ id: named(sh2.motionChain, 'open'), element: hero, action: 'enter', at: 0.05, reason: 'the problem is on screen at once' });
    const a = supports[0];
    sh2.cast!.find((x) => x.id === a)!.enter = 'slide';
    sh2.motionChain.push({ id: 'hit-in', element: a, action: 'enter', after: 'open.peak', reason: 'a tool slides in' });
    sh2.motionChain.push({ id: 'hit', element: a, action: 'push', to: hero, after: 'hit-in.end', dur: 0.35, reason: 'and knocks into the problem: the friction is physical' });
    supports.slice(1).forEach((id, k) => sh2.motionChain.push({ element: id, action: 'enter', after: k === 0 ? 'hit.peak' : 'hit.end', style: 'drop', reason: 'the knock shakes the others loose' }));
    punch(sh2);
    out.push({ id: 'hook-collision', label: 'collision', script: sc2, why: `${a} slides into ${hero} within the first second` });
  }
  return out;
}

/** Is this chain a visual EVENT (elements acting on each other), not a scale / camera / glow? */
export function isVisualEvent(chain: { action: string; to?: string; after?: string }[]): boolean {
  return chain.some((e) => ['push', 'attract', 'become', 'respond'].includes(e.action) && (e.to || e.after)) || chain.filter((e) => e.after).length >= 2;
}

/** Climax Builder (Z) / Hero Moment Builder (E): 2–3 hero-moment candidates on the climax shot. */
export function climaxCandidates(script: ScriptObj, shotId: string): ArtCandidate[] {
  const i = script.shots.findIndex((s) => s.id === shotId);
  if (i < 0) return [];
  const s = script.shots[i] as ShotObj;
  const cast = s.cast ?? [];
  const hero = cast.find((c) => c.role === 'hero')?.id ?? (s.subject as string);
  const others = cast.filter((c) => c.id !== hero && c.role !== 'background' && SMALL.concat('text').includes(kindOf(script, c.id))).map((c) => c.id);
  const prevCast = i > 0 ? (script.shots[i - 1].cast ?? []).map((c) => c.id) : [];
  const out: ArtCandidate[] = [];
  const set = (sh: ShotObj, name: string) => {
    const { use: _u, ...p } = PHRASES[name];
    sh.phrase = p as never;
  };
  const dur = s.timing?.duration ?? 3.5;
  // 1 impact chain: the hero strikes, the others answer one after another (counter, echo)
  if (hero && others.length) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    const at = Math.max(0.7, Math.min(dur * 0.45, dur - 1.6));
    sh.motionChain.push({ id: named(sh.motionChain, 'strike'), element: hero, action: 'impact', at, amount: 0.12, reason: 'the climax: the hero strikes' });
    others.forEach((id, k) => sh.motionChain.push({ id: named(sh.motionChain, `answer-${k + 1}`), element: id, action: 'respond', style: k % 2 ? 'echo' : 'recoil', to: hero, after: k === 0 ? 'strike.peak' : `answer-${k}.start`, reason: 'the strike travels through the others' }));
    set(sh, 'punch');
    out.push({ id: 'climax-strike', label: 'strike-and-answer', script: sc, why: `${hero} strikes at ${at.toFixed(1)}s and ${others.length} element(s) answer in a chain` });
  }
  // 2 gather: decorative items are pulled into the hero, which takes the hit (only items that carry no information)
  const decor = others.filter((id) => ['shape', 'icon', 'chip'].includes(kindOf(script, id)) && prevCast.includes(id));
  if (hero && decor.length >= 1) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    decor.forEach((id, k) => sh.motionChain.push({ id: named(sh.motionChain, `pull-${k + 1}`), element: id, action: 'attract', to: hero, ...(k === 0 ? { at: 0.8 } : { after: `pull-${k}.contact` }), dur: 0.5, reason: 'the climax gathers the pieces into the hero' }));
    set(sh, 'punch');
    out.push({ id: 'climax-gather', label: 'gather-into-hero', script: sc, why: `${decor.length} decorative item(s) are pulled into ${hero}` });
  }
  // 3 cascade-and-land: everything that enters arrives as a domino ending on the hero
  const entering = cast.filter((c) => !prevCast.includes(c.id) && c.id !== hero && SMALL.includes(kindOf(script, c.id))).map((c) => c.id);
  if (hero && entering.length >= 2) {
    const sc = clone(script);
    const sh = sc.shots[i] as ShotObj;
    sh.motionChain = withoutEnter(sh.motionChain, entering);
    entering.forEach((id, k) => sh.motionChain.push({ id: named(sh.motionChain, `domino-${k + 1}`), element: id, action: 'enter', ...(k === 0 ? {} : { after: `domino-${k}.peak` }), reason: 'each piece is set off by the one before' }));
    sh.motionChain.push({ element: hero, action: 'respond', style: 'echo', after: `domino-${entering.length}.end`, amount: 0.06, reason: 'the last piece lands and the hero answers' });
    set(sh, 'build');
    out.push({ id: 'climax-domino', label: 'domino-to-hero', script: sc, why: `${entering.length} pieces arrive as a domino and land on ${hero}` });
  }
  return out.filter((c) => isVisualEvent((c.script.shots[i] as ShotObj).motionChain));
}

export interface RhythmCompose {
  version: 1;
  shots: { shot: string; stagger: number; accel: string; why: string }[];
  /** coefficient of variation of the internal gaps (entrances / events) before → after (predicted). */
  cvBefore: number;
  cvAfter: number;
}

/** Internal gaps between motion starts inside each shot (compiled plan) — the film's internal rhythm. */
export function internalGaps(plan: StagePlan): number[] {
  const gaps: number[] = [];
  const spans = ((plan as unknown as { choreo: { timeline: { children?: { id?: string; at?: number | string }[] }[] } }).choreo.timeline[0]?.children ?? []) as { id?: string; at?: number | string }[];
  for (const sh of plan.shots) {
    const starts = spans
      .filter((a) => typeof a.at === 'number' && (a.at as number) >= sh.start && (a.at as number) < sh.end && /^(in_|ev_|a_ev_)/.test(a.id ?? ''))
      .map((a) => a.at as number)
      .sort((a, b) => a - b);
    for (let k = 1; k < starts.length; k++) if (starts[k] - starts[k - 1] > 0.02) gaps.push(starts[k] - starts[k - 1]);
  }
  return gaps;
}

const cv = (x: number[]) => {
  if (x.length < 2) return 0;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length) / Math.max(m, 1e-6);
};

/** Rhythm Composer (J): staggers per shot (inside its voice window) that differ and accelerate / settle. */
export function composeRhythm(script: ScriptObj, plan: StagePlan, compile?: (s: ScriptObj) => StagePlan): { report: RhythmCompose; candidate: ArtCandidate } {
  const sc = clone(script);
  const n = sc.shots.length;
  const shots: RhythmCompose['shots'] = [];
  sc.shots.forEach((s, i) => {
    const sh = s as ShotObj;
    const role = sh.purpose ?? '';
    const pos = i / Math.max(1, n - 1);
    // short-short-long: builds accelerate, the ending decelerates, others alternate tight / open
    const accel = ['process', 'feature', 'proof', 'benefit', 'hook'].includes(role) ? 'accelerate' : role === 'cta' || pos > 0.9 ? 'decelerate' : 'even';
    const stagger = Math.round((accel === 'accelerate' ? 0.24 : accel === 'decelerate' ? 0.2 : i % 2 ? 0.09 : 0.17) * 100) / 100;
    sh.phrase = { ...(sh.phrase ?? { tempo: 1, amplitude: 1 }), stagger, accel } as never;
    shots.push({ shot: sh.id, stagger, accel, why: accel === 'accelerate' ? 'a build: each item sooner than the last' : accel === 'decelerate' ? 'the ending comes to rest' : i % 2 ? 'a tight beat' : 'an open beat' });
  });
  const before = cv(internalGaps(plan));
  let after = before;
  if (compile) {
    try {
      after = cv(internalGaps(compile(sc)));
    } catch {
      /* reported as unchanged */
    }
  }
  return { report: { version: 1, shots, cvBefore: Math.round(before * 1000) / 1000, cvAfter: Math.round(after * 1000) / 1000 }, candidate: { id: 'rhythm-composed', label: 'composed internal rhythm', script: sc, why: 'staggers that differ shot to shot, accelerate into builds and settle at the end' } };
}
