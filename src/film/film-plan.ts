/**
 * Film Plan (P3-A) + Sequence Model / Contracts (P3-B) + Motifs (P3-F) + Motion Phrases (P3-G) +
 * Energy Arc (P3-H) + Camera Arc (P3-J) + Audio Arc (P3-Y).
 *
 *   film_plan.json  (Film → Sequences → Shots → Elements)
 *     └─ applyFilmPlan(script) — the plan CHANGES the shot script before it is compiled:
 *          · planned energy per shot (the critic judges against it; rhythm and SFX follow it)
 *          · camera arc → framing at the end of moving shots; moves against the arc are reported
 *          · motifs → the motif element is cast where the plan says it returns (persist / become /
 *            halo behind / accent), the transition that turns it into something else is set
 *          · motion phrases → the peak beat gets its impact (and the SFX), release hands energy on
 *          · sequence contracts → the boundary between two sequences hands over the delivered element
 *     Every change is listed in film_plan_report.json; a requested change that cannot be made is
 *     reported, never silently dropped.
 *
 * Written by Claude BEFORE the shot script ("what should the viewer feel, understand and look at from
 * the first frame to the last?"). Without one, `deriveFilmPlan` writes a conservative plan from the
 * script (source "derived") so the Sequence / Film critics still have something to judge against.
 * Pure (no node APIs).
 */
import { z } from 'zod';

const Line = z.string().min(2);
const SIZES = ['wide', 'medium', 'close', 'extreme-close', 'insert', 'hero', 'detail'] as const;
const BEATS = ['start', 'build', 'peak', 'release', 'resolution'] as const;

export const MotifSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  element: z.string(),
  identity: Line,
  meaning: Line,
  firstAppearance: z.string(),
  /** persist = the same element continues · become = it turns into `into` at the cut into that shot ·
   *  halo = it returns behind `into` (a ground / halo) · accent = it returns small beside `into`. */
  transformations: z.array(z.object({ shot: z.string(), as: z.enum(['persist', 'become', 'halo', 'accent']), into: z.string().optional(), note: Line })).default([]),
  finalResolution: z.object({ shot: z.string(), as: z.enum(['persist', 'become', 'halo', 'accent']), into: z.string().optional(), note: Line }),
});
export type Motif = z.infer<typeof MotifSchema>;

export const SequenceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: Line,
  shots: z.array(z.string()).min(1),
  purpose: Line,
  narrativeFunction: Line,
  entryState: Line,
  exitState: Line,
  energy: z.object({ start: z.number().min(0).max(1), peak: z.number().min(0).max(1), end: z.number().min(0).max(1) }),
  visualDensity: z.enum(['low', 'medium', 'high']),
  heroElement: z.string(),
  cameraBehavior: Line,
  transitionLanguage: Line,
  persistentElements: z.array(z.string()).default([]),
  audioAnchor: z.string().optional(),
  nextSequenceIntent: z.string().optional(),
  /** Sequence Contract: what it receives from the previous sequence and what it hands to the next. */
  contract: z.object({
    receives: z.object({ element: z.string().optional(), state: z.string().optional() }).nullable().default(null),
    delivers: z.object({ element: z.string(), state: z.object({ direction: z.enum(['left', 'right', 'up', 'down', 'still']).optional(), scale: z.number().optional(), energy: z.number().min(0).max(1).optional(), note: z.string().optional() }) }).nullable().default(null),
  }),
});
export type Sequence = z.infer<typeof SequenceSchema>;

export const PhraseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** The phrase in motion words: anticipate → accelerate → impact → release → settle, collect → compress → burst → resolve … */
  pattern: z.array(z.string()).min(3),
  beats: z.array(z.object({ shot: z.string(), beat: z.enum(BEATS), element: z.string(), note: z.string().optional() })).min(3),
  reason: Line,
});
export type Phrase = z.infer<typeof PhraseSchema>;

export const FilmPlanSchema = z
  .object({
    version: z.literal(1).default(1),
    source: z.enum(['claude', 'derived', 'human']).default('claude'),
    /** The Film Question: what should the viewer feel, understand and look at, from the first frame to the last? */
    question: z.object({ feel: Line, understand: Line, lookAt: Line }),
    goal: Line,
    audience: Line,
    coreMessage: Line,
    hook: Line,
    promise: Line,
    proof: Line,
    cta: Line,
    arcs: z.object({
      narrative: Line,
      emotional: Line,
      visual: Line,
      typography: Line,
      color: Line,
      density: Line,
      brand: Line,
      /** Planned energy per shot (0..1) and where the numbers come from (narrative, VO, music, density, CTA). */
      energy: z.object({ curve: z.record(z.number().min(0).max(1)), sources: Line }),
      camera: z.object({ shape: Line, stages: z.array(z.object({ shots: z.array(z.string()).min(1), framing: z.enum(SIZES), behavior: Line })).min(1) }),
    }),
    transitionStrategy: z.object({
      language: Line,
      /** Transition kinds repeated on purpose (a visual language, not laziness). */
      intentionalRepeats: z.array(z.string()).default([]),
      /** Boundaries allowed to reset the world / jump the eye, and why ("a->b"). */
      resetsAllowed: z.array(z.object({ boundary: z.string(), why: Line })).default([]),
    }),
    heroElements: z.array(z.string()).default([]),
    motifs: z.array(MotifSchema).max(3).default([]),
    persistentElements: z.array(z.object({ element: z.string(), shots: z.array(z.string()), why: Line })).default([]),
    keyMoments: z.array(z.object({ shot: z.string(), note: Line })).default([]),
    ending: z.object({
      strategy: Line,
      /** CTA payoff: what began in the film and arrives at the end. */
      payoff: z.object({ motif: z.string().optional(), element: z.string().optional(), from: z.string(), how: Line }).optional(),
      /** "Why does this ending feel like the inevitable conclusion of the film?" — empty = the CTA is detached. */
      why: z.string().default(''),
    }),
    sequences: z.array(SequenceSchema).min(1),
    phrases: z.array(PhraseSchema).default([]),
    audio: z.object({ voiceEnergy: z.string().optional(), pauses: z.array(z.string()).default([]), keywords: z.array(z.string()).default([]), music: z.string().optional(), sfxPolicy: Line }).optional(),
  })
  .strict();
export type FilmPlan = z.infer<typeof FilmPlanSchema>;

type Ev = { id?: string; element: string; action: string; at?: number | string; after?: string; reason: string; [k: string]: unknown };
type Cast = { id: string; role?: string; behind?: string; scale?: number; [k: string]: unknown };
type ShotObj = { id: string; purpose?: string; cast?: Cast[]; motionChain?: Ev[]; transitionOut?: unknown; transitionReason?: string; expectedEnergy?: number; camera?: unknown; framing?: { start?: string; end?: string }; [k: string]: unknown };
type ScriptObj = { shots: ShotObj[]; stage?: { elements: { id: string; kind: string; shape?: string }[] }; [k: string]: unknown };

export function validateFilmPlan(input: unknown, script?: ScriptObj): { ok: true; film: FilmPlan; warnings: string[] } | { ok: false; errors: string[] } {
  const r = FilmPlanSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const f = r.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (script) {
    const ids = new Set(script.shots.map((s) => s.id));
    const els = new Set((script.stage?.elements ?? []).map((e) => e.id));
    const covered = f.sequences.flatMap((s) => s.shots);
    for (const s of covered) if (!ids.has(s)) errors.push(`sequence shot "${s}" is not in the script`);
    const order = script.shots.map((s) => s.id);
    if (covered.join(',') !== order.filter((x) => covered.includes(x)).join(',')) errors.push('sequences must list the shots in film order');
    for (const s of order) if (!covered.includes(s)) warnings.push(`shot "${s}" belongs to no sequence`);
    for (const m of f.motifs) {
      if (!els.has(m.element)) errors.push(`motif "${m.id}": element "${m.element}" is not a stage element`);
      for (const t of [...m.transformations, m.finalResolution]) {
        if (!ids.has(t.shot)) errors.push(`motif "${m.id}": shot "${t.shot}" is not in the script`);
        if ((t.as === 'become' || t.as === 'halo' || t.as === 'accent') && (!t.into || !els.has(t.into))) errors.push(`motif "${m.id}" ${t.as} in "${t.shot}" needs "into": a stage element`);
      }
    }
    for (const p of f.phrases) for (const b of p.beats) if (!ids.has(b.shot)) errors.push(`phrase "${p.id}": shot "${b.shot}" is not in the script`);
    for (const st of f.arcs.camera.stages) for (const s of st.shots) if (!ids.has(s)) errors.push(`camera arc: shot "${s}" is not in the script`);
    for (const s of order) if (f.arcs.energy.curve[s] === undefined) warnings.push(`energy arc has no value for "${s}"`);
    if (!f.ending.why.trim()) warnings.push('ending.why is empty: nothing says why the CTA is the conclusion of this film');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, film: f, warnings };
}

export interface FilmPlanReport {
  version: 1;
  source: FilmPlan['source'];
  applied: { what: string; shot?: string; change: string }[];
  skipped: { what: string; shot?: string; why: string }[];
  sequences: { id: string; shots: string[] }[];
  contracts: { from: string; to: string; element: string; boundary: string; kept: boolean; how: string }[];
  phrases: { id: string; beats: { shot: string; beat: string; element: string; present: boolean; added?: string }[]; complete: boolean }[];
  motifs: { id: string; appearances: { shot: string; as: string; ok: boolean; note: string }[] }[];
}

const trType = (s: ShotObj) => (typeof s.transitionOut === 'string' ? s.transitionOut : (s.transitionOut as { type?: string } | undefined)?.type);
const trEl = (s: ShotObj) => (typeof s.transitionOut === 'object' && s.transitionOut ? (s.transitionOut as { element?: string }).element : undefined);
const PEAK_ACTIONS = ['impact', 'press', 'count', 'emphasis', 'transform', 'attract', 'push', 'morph'];

/** Applies the film plan to a shot script (a copy): energy, camera arc, motifs, phrases, contracts. */
export function applyFilmPlan(input: ScriptObj, film: FilmPlan): { script: ScriptObj; report: FilmPlanReport } {
  const script = JSON.parse(JSON.stringify(input)) as ScriptObj;
  const rep: FilmPlanReport = { version: 1, source: film.source, applied: [], skipped: [], sequences: film.sequences.map((s) => ({ id: s.id, shots: s.shots })), contracts: [], phrases: [], motifs: [] };
  const idx = new Map(script.shots.map((s, i) => [s.id, i]));
  const kinds = new Map((script.stage?.elements ?? []).map((e) => [e.id, e.kind]));
  const shot = (id: string) => script.shots[idx.get(id) ?? -1];
  // ── energy arc
  for (const s of script.shots) {
    const e = film.arcs.energy.curve[s.id];
    if (e !== undefined && Math.abs((s.expectedEnergy ?? 0.6) - e) > 1e-3) {
      rep.applied.push({ what: 'energy', shot: s.id, change: `${s.expectedEnergy ?? 0.6} → ${e}` });
      s.expectedEnergy = e;
    }
  }
  // ── camera arc: a moving shot ends at its stage's framing (unless the script set one)
  for (const st of film.arcs.camera.stages)
    for (const id of st.shots) {
      const s = shot(id);
      if (!s) continue;
      const moving = s.camera && s.camera !== 'static' && (s.camera as { move?: string }).move;
      if (!moving) continue;
      if (!s.framing?.end) {
        s.framing = { ...(s.framing ?? {}), end: st.framing };
        rep.applied.push({ what: 'camera arc', shot: id, change: `framing at the end of the move: ${st.framing} (${st.behavior})` });
      }
    }
  // ── motifs
  for (const m of film.motifs) {
    const apps: FilmPlanReport['motifs'][number]['appearances'] = [];
    const first = shot(m.firstAppearance);
    apps.push({ shot: m.firstAppearance, as: 'first', ok: Boolean(first?.cast?.some((c) => c.id === m.element)), note: first?.cast?.some((c) => c.id === m.element) ? 'introduced' : `${m.element} is not cast in ${m.firstAppearance}` });
    for (const t of [...m.transformations, { ...m.finalResolution, final: true }]) {
      const s = shot(t.shot);
      const i = idx.get(t.shot) ?? -1;
      if (!s) continue;
      const cast = (s.cast ??= []);
      if (t.as === 'persist') {
        if (!cast.some((c) => c.id === m.element)) {
          cast.push({ id: m.element, role: 'support' });
          rep.applied.push({ what: `motif ${m.id}`, shot: t.shot, change: `${m.element} persists into ${t.shot} (cast as support)` });
        }
        apps.push({ shot: t.shot, as: 'persist', ok: true, note: t.note });
      } else if (t.as === 'become') {
        const prev = script.shots[i - 1];
        const into = t.into!;
        if (!prev || !prev.cast?.some((c) => c.id === m.element)) {
          rep.skipped.push({ what: `motif ${m.id}`, shot: t.shot, why: `${m.element} is not on stage in the shot before ${t.shot}: it cannot become ${into} at that cut` });
          apps.push({ shot: t.shot, as: 'become', ok: false, note: 'source not on stage' });
          continue;
        }
        if (!cast.some((c) => c.id === into)) cast.push({ id: into, role: 'secondary' });
        const cur = prev.transitionOut as { type?: string; element?: string; into?: string } | string | undefined;
        const kind = kinds.get(m.element) ?? '';
        const type = ['shape', 'icon', 'chip', 'card', 'button'].includes(kind) ? 'morph' : 'shape-transform';
        const already = typeof cur === 'object' && cur?.element === m.element && cur.into === into;
        if (!already) {
          prev.transitionOut = { type, element: m.element, into };
          prev.transitionReason = `${m.identity} becomes ${into}: ${t.note}`;
          rep.applied.push({ what: `motif ${m.id}`, shot: prev.id, change: `transition into ${t.shot}: ${type} ${m.element} → ${into} (was ${typeof cur === 'string' ? cur : cur?.type ?? 'none'})` });
        }
        // the motif element leaves the cast of the receiving shot (it has become something else)
        s.cast = cast.filter((c) => c.id !== m.element);
        apps.push({ shot: t.shot, as: 'become', ok: true, note: t.note });
      } else {
        // halo / accent: the motif returns around (behind) or beside the element it now serves
        const into = t.into!;
        if (!cast.some((c) => c.id === into)) {
          rep.skipped.push({ what: `motif ${m.id}`, shot: t.shot, why: `${into} is not cast in ${t.shot}` });
          apps.push({ shot: t.shot, as: t.as, ok: false, note: `${into} not cast` });
          continue;
        }
        const has = cast.find((c) => c.id === m.element);
        const entry: Cast = { id: m.element, role: 'background', behind: into, scale: t.as === 'halo' ? 1.9 : 0.5, enter: 'scale' };
        if (has) Object.assign(has, entry);
        else cast.push(entry);
        rep.applied.push({ what: `motif ${m.id}`, shot: t.shot, change: `${m.element} returns ${t.as === 'halo' ? 'behind' : 'beside'} ${into} (${t.note})` });
        apps.push({ shot: t.shot, as: t.as, ok: true, note: t.note });
      }
    }
    rep.motifs.push({ id: m.id, appearances: apps });
  }
  // ── motion phrases: every beat must exist on screen; the peak gets its impact and its sound
  for (const p of film.phrases) {
    const beats: FilmPlanReport['phrases'][number]['beats'] = [];
    for (const b of p.beats) {
      const s = shot(b.shot);
      if (!s) continue;
      const chain = (s.motionChain ??= []);
      const onStage = s.cast?.some((c) => c.id === b.element) || b.element.startsWith('word:');
      if (!onStage) {
        beats.push({ shot: b.shot, beat: b.beat, element: b.element, present: false });
        rep.skipped.push({ what: `phrase ${p.id}`, shot: b.shot, why: `${b.beat}: ${b.element} is not on stage in ${b.shot}` });
        continue;
      }
      const evs = chain.filter((e) => e.element === b.element);
      let present = evs.length > 0 || b.beat === 'start' || b.beat === 'resolution';
      let added: string | undefined;
      if (b.beat === 'peak' && !evs.some((e) => PEAK_ACTIONS.includes(e.action))) {
        const last = [...chain].reverse().find((e) => e.id && e.element !== b.element);
        chain.push({ id: `fp-${p.id}-peak`, element: b.element, action: 'impact', ...(last ? { after: `${last.id}.end` } : { at: 0.9 }), reason: `phrase ${p.id}: the peak (${p.pattern.join(' → ')})` });
        added = 'impact';
        present = true;
      }
      if (b.beat === 'release') {
        const cast = s.cast?.find((c) => c.id === b.element);
        if (cast && !cast.exit) {
          cast.exit = 'handoff';
          added = 'handoff exit';
          present = true;
        }
      }
      if (added) rep.applied.push({ what: `phrase ${p.id}`, shot: b.shot, change: `${b.beat}: ${added} on ${b.element}` });
      beats.push({ shot: b.shot, beat: b.beat, element: b.element, present, added });
    }
    const order = BEATS.filter((x) => beats.some((b) => b.beat === x && b.present));
    rep.phrases.push({ id: p.id, beats, complete: ['build', 'peak', 'release'].every((x) => order.includes(x as never)) || (order.includes('peak') && order.length >= 3) });
  }
  // ── sequence contracts: the cut between two sequences hands over the delivered element
  for (let k = 0; k + 1 < film.sequences.length; k++) {
    const S = film.sequences[k];
    const N = film.sequences[k + 1];
    const d = S.contract.delivers;
    if (!d) continue;
    const a = shot(S.shots[S.shots.length - 1]);
    const b = shot(N.shots[0]);
    if (!a || !b) continue;
    const inA = a.cast?.some((c) => c.id === d.element);
    const inB = b.cast?.some((c) => c.id === d.element);
    const carrier = trEl(a);
    const into = typeof a.transitionOut === 'object' && a.transitionOut ? (a.transitionOut as { into?: string }).into : undefined;
    let kept = Boolean(inA && (inB || carrier === d.element || into === d.element));
    let how = kept ? (inB ? 'persists across the cut' : `carries the cut (${trType(a)})`) : '';
    if (!kept && inA && inB && !carrier) {
      a.transitionOut = { type: 'shared', element: d.element };
      kept = true;
      how = 'set to shared (it was in both shots without carrying the cut)';
      rep.applied.push({ what: `contract ${S.id}→${N.id}`, shot: a.id, change: `transition → shared ${d.element}` });
    }
    if (!kept) how = `${d.element} ${inA ? 'is on stage at the end of ' + S.id : 'is not on stage at the end of ' + S.id} but does not reach ${N.id}`;
    rep.contracts.push({ from: S.id, to: N.id, element: d.element, boundary: `${a.id}->${b.id}`, kept, how });
  }
  return { script, report: rep };
}

const PURPOSE_ENERGY: Record<string, number> = { hook: 0.85, problem: 0.55, pain: 0.55, solution: 0.7, demo: 0.6, process: 0.55, feature: 0.65, proof: 0.6, benefit: 0.6, cta: 0.45, logo: 0.4 };
const GROUP: Record<string, string> = { hook: 'hook', problem: 'problem', pain: 'problem', solution: 'transformation', demo: 'transformation', reveal: 'transformation', process: 'proof', feature: 'proof', proof: 'proof', benefit: 'proof', social: 'proof', cta: 'resolve', logo: 'resolve' };

/**
 * A conservative film plan from the script alone (no Claude): sequences grouped by purpose, energy from
 * the shots, camera arc from their framing, persistent elements; NO motifs and NO payoff are invented —
 * the Film Critic then reports what is missing (WEAK_PAYOFF, MOTIF_LOST …).
 */
export function deriveFilmPlan(script: ScriptObj, opts: { title?: string; cta?: string } = {}): FilmPlan {
  const groups: { id: string; shots: ShotObj[] }[] = [];
  for (const s of script.shots) {
    const g = GROUP[s.purpose ?? ''] ?? 'body';
    const last = groups[groups.length - 1];
    if (last && last.id.replace(/-\d+$/, '') === g) last.shots.push(s);
    else groups.push({ id: groups.some((x) => x.id === g) ? `${g}-${groups.length + 1}` : g, shots: [s] });
  }
  const energyOf = (s: ShotObj) => s.expectedEnergy ?? PURPOSE_ENERGY[s.purpose ?? ''] ?? 0.6;
  const curve = Object.fromEntries(script.shots.map((s) => [s.id, energyOf(s)]));
  const runs = new Map<string, string[]>();
  for (const s of script.shots) for (const c of s.cast ?? []) runs.set(c.id, [...(runs.get(c.id) ?? []), s.id]);
  const persistent = [...runs.entries()].filter(([, v]) => v.length >= 2).map(([element, shots]) => ({ element, shots, why: 'cast in consecutive shots (derived)' }));
  const sizeOf = (s: ShotObj) => (s.framing?.end ?? (s as { shotSize?: string }).shotSize ?? 'medium') as (typeof SIZES)[number];
  const sequences: Sequence[] = groups.map((g, k) => {
    const e = g.shots.map(energyOf);
    const hero = (g.shots[0].subject as string | undefined) ?? g.shots[0].cast?.find((c) => c.role === 'hero')?.id ?? g.shots[0].cast?.[0]?.id ?? '';
    const lastShot = g.shots[g.shots.length - 1];
    const carrier = trEl(lastShot);
    return {
      id: g.id,
      name: g.id,
      shots: g.shots.map((s) => s.id),
      purpose: g.shots.map((s) => s.purpose ?? '—').join(' + '),
      narrativeFunction: `derived from shot purposes (${g.shots.map((s) => s.purpose).join(', ')})`,
      entryState: k === 0 ? 'film start' : `after ${groups[k - 1].id}`,
      exitState: k === groups.length - 1 ? 'film end' : `into ${groups[k + 1].id}`,
      energy: { start: e[0], peak: Math.max(...e), end: e[e.length - 1] },
      visualDensity: (() => {
        const n = Math.max(...g.shots.map((s) => (s.cast ?? []).length));
        return n >= 5 ? 'high' : n >= 3 ? 'medium' : 'low';
      })(),
      heroElement: hero,
      cameraBehavior: g.shots.some((s) => s.camera && s.camera !== 'static') ? 'moves' : 'still',
      transitionLanguage: [...new Set(g.shots.map(trType).filter(Boolean))].join(', ') || 'cut',
      persistentElements: persistent.filter((p) => p.shots.some((x) => g.shots.some((s) => s.id === x))).map((p) => p.element),
      contract: { receives: null, delivers: carrier && k < groups.length - 1 ? { element: carrier, state: { note: 'carries the cut (derived)' } } : null },
    };
  });
  return {
    version: 1,
    source: 'derived',
    question: { feel: 'not stated (derived plan)', understand: 'not stated (derived plan)', lookAt: 'the hero of each shot' },
    goal: opts.title ?? 'not stated',
    audience: 'not stated',
    coreMessage: 'not stated',
    hook: script.shots[0]?.id ?? '—',
    promise: 'not stated',
    proof: 'not stated',
    cta: opts.cta ?? 'not stated',
    arcs: {
      narrative: groups.map((g) => g.id).join(' → '),
      emotional: 'not stated',
      visual: 'not stated',
      typography: 'not stated',
      color: 'not stated',
      density: 'not stated',
      brand: 'not stated',
      energy: { curve, sources: 'the shots\' expected energy or their purpose (derived)' },
      camera: { shape: 'as scripted (derived)', stages: script.shots.map((s) => ({ shots: [s.id], framing: sizeOf(s), behavior: s.camera && s.camera !== 'static' ? 'moves' : 'still' })) },
    },
    transitionStrategy: { language: 'as scripted (derived)', intentionalRepeats: [], resetsAllowed: [] },
    heroElements: [...new Set(sequences.map((s) => s.heroElement).filter(Boolean))],
    motifs: [],
    persistentElements: persistent,
    keyMoments: [],
    ending: { strategy: 'as scripted (derived)', why: '' },
    sequences,
    phrases: [],
  };
}
