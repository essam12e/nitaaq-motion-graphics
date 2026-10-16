/**
 * P3 (Film Director & Sequence Intelligence): film plan, sequences + contracts, boundary plan, dirty
 * propagation, transition re-director, eye flow, motifs, motion phrases, energy arc, rhythm / information,
 * camera arc, neighbourhood repair + local sequence score, sequence / film critic, global re-director,
 * CTA payoff, multiple small subjects, repetition memory, version score, world reset, determinism and
 * backward compatibility (no film plan → P2 exactly).
 */
import { describe, expect, it } from 'vitest';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileStage, type StageCompileInput } from '../../src/stage/compiler';
import type { StagePlan } from '../../src/stage/plan';
import { compiledStage, elementState } from '../../src/stage/StageLayer';
import { settleTimeOf, type StageProbeSample } from '../../src/qc/stage-probes';
import { critique, type CriticReport } from '../../src/qc/critic';
import { applyFilmPlan, deriveFilmPlan, validateFilmPlan, FilmPlanSchema, type FilmPlan } from '../../src/film/film-plan';
import { sampleStage, massOf, KIND_MASS, timesIn } from '../../src/film/sampler';
import { buildBoundaries, buildBoundary, boundarySignature } from '../../src/film/boundary';
import { boundaryAtRisk, boundaryCandidates, redirectBoundary, transitionDecision, MOVE_COST, type ScriptObj } from '../../src/film/transition-redirector';
import { dirtyOf, neighborhoodRepair } from '../../src/film/dirty';
import { filmCritic, filmMemory, repetitions, sequenceCritic, ctaPayoff, versionScore, localSequenceScore, FILM_DIMENSIONS } from '../../src/film/film-critic';
import { informationFlow, directRhythm } from '../../src/film/rhythm';
import { globalRedirect, multipleSubjects, payoffCandidate } from '../../src/film/global-redirector';
import { ablate, filmScript } from '../../src/node/film-director';
import { OBJECT_TRANSITIONS } from '../../src/director/shot-script';

const W = 1920;
const H = 1080;
const ELS = [
  { id: 'text.hook', kind: 'text', role: 'headline', text: 'كل حجوزاتك في مكان واحد' },
  { id: 'shape.hub', kind: 'shape', shape: 'circle', color: 'primary', size: { w: 0.16, aspect: 1 } },
  { id: 'text.solution', kind: 'text', role: 'headline', text: 'منصة تنظم حجوزاتك تلقائيًا' },
  { id: 'card.f1', kind: 'card', title: 'تذكير تلقائي', icon: 'Bell' },
  { id: 'card.f2', kind: 'card', title: 'دفع مسبق', icon: 'CreditCard' },
  { id: 'card.f3', kind: 'card', title: 'تقارير', icon: 'ChartColumn' },
  { id: 'line.path', kind: 'line', points: [[1, 0.5], [0.5, 0.4], [0, 0.5]], illustrative: true, size: { w: 0.86, aspect: 4.2 } },
  { id: 'logo.brand', kind: 'image', asset: 'logo' },
  { id: 'text.cta', kind: 'text', role: 'cta', text: 'جرّب مجانًا' },
  { id: 'button.cta', kind: 'button', text: 'ابدأ الآن' },
];
type S = Record<string, unknown>;
const shot = (id: string, over: S = {}): S => ({ id, purpose: 'feature', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', ...over });
const ROW = [
  { id: 'card.f1', role: 'hero', at: { x: 0.78, y: 0.5 }, w: 0.2 },
  { id: 'card.f2', role: 'secondary', at: { x: 0.5, y: 0.5 }, w: 0.2 },
  { id: 'card.f3', role: 'secondary', at: { x: 0.22, y: 0.5 }, w: 0.2 },
];
const SHOTS = (over: Record<string, S> = {}): S[] => [
  shot('hook', { purpose: 'hook', subject: 'text.hook', cast: [{ id: 'text.hook', role: 'hero' }, { id: 'shape.hub', role: 'secondary' }], transitionOut: { type: 'expand-to-background', element: 'shape.hub' }, transitionReason: 'the circle becomes the world', ...over.hook }),
  shot('solution', { purpose: 'solution', subject: 'text.solution', cast: [{ id: 'text.solution', role: 'hero' }, { id: 'logo.brand', role: 'support' }], transitionOut: 'cut', transitionReason: 'a clean cut', ...over.solution }),
  shot('features', { subject: 'card.f1', cast: ROW, transitionOut: 'cut', transitionReason: 'a clean cut to the path', ...over.features }),
  shot('steps', { purpose: 'process', subject: 'line.path', cast: [{ id: 'line.path', role: 'hero' }], transitionOut: 'cut', transitionReason: 'a cut to the offer', ...over.steps }),
  shot('cta', { purpose: 'cta', subject: 'text.cta', timing: { duration: 2.6 }, cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'logo.brand', role: 'support' }], hold: { intentional: true, reason: 'read', maxSec: 1.6 }, ...over.cta }),
];
function script(over: Record<string, S> = {}, shots?: S[]): ShotScript & ScriptObj {
  const v = validateShotScript({ version: 1, stage: { elements: ELS }, shots: shots ?? SHOTS(over) });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.script as never;
}
const input = (sc: ShotScript): StageCompileInput => {
  let t = 0;
  const timing = sc.shots.map((s) => {
    const d = s.timing.duration ?? 3;
    const r = { id: s.id, start: t, duration: d, transition: null, beat: s.purpose };
    t += d;
    return r;
  });
  return { script: sc, timing, voice: null, W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, assets: { logo: { kind: 'logo', aspect: 1 } }, cta: { text: 'جرّب مجانًا', button: 'ابدأ الآن' }, direction: null as never };
};
const compileRaw = (sc: ShotScript) => compileStage(input(sc));
/** The Film Director's compile function: script (raw) → plan (validated, defaults filled). */
const compiler = (film?: FilmPlan | null) => (raw: ScriptObj): StagePlan => {
  const eff = film ? applyFilmPlan(raw, film).script : raw;
  const v = validateShotScript(eff);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return compileStage(input(v.script)).plan;
};
function synth(plan: StagePlan, times: number[]): StageProbeSample[] {
  const c = compiledStage(plan);
  return times.map((t) => ({
    t,
    cam: { x: 0, y: 0, dolly: 0, zoom: 1 },
    els: [...plan.elements]
      .sort((a, b) => a.z - b.z)
      .filter((e) => !e.parent && t >= e.life.from && t <= e.life.to)
      .map((e) => {
        const st = elementState(c, e.key, t);
        const w = e.box.w * W * st.s * st.sx;
        const h = e.box.h * H * st.s * st.sy;
        return { id: e.id, kind: e.kind, rect: { x: st.x * W - w / 2, y: st.y * H - h / 2, width: w, height: h }, opacity: st.o, parent: false, z: st.z };
      })
      .filter((e) => e.opacity > 0.01),
    words: [],
    mask: false,
  }));
}
const criticOf = (plan: StagePlan, report: ReturnType<typeof compileRaw>['report']): CriticReport => critique({ plan, report, samples: synth(plan, plan.shots.map((s) => settleTimeOf(plan, s.id))) });

/** A Claude-authored film plan for the fixture film. */
function filmPlan(over: Partial<FilmPlan> = {}): FilmPlan {
  const base = {
    version: 1,
    source: 'claude',
    question: { feel: 'relief', understand: 'one place for every booking', lookAt: 'the circle, then the button' },
    goal: 'a trial',
    audience: 'small clinics',
    coreMessage: 'one place',
    hook: 'the circle gathers',
    promise: 'organised automatically',
    proof: 'three features',
    cta: 'start now',
    arcs: {
      narrative: 'gather → promise → proof → how → decide',
      emotional: 'friction → relief → decision',
      visual: 'circle → type → row → path → button',
      typography: 'large promise, short CTA',
      color: 'brand blue',
      density: 'low → medium → low',
      brand: 'the circle returns behind the button',
      energy: { curve: { hook: 0.7, solution: 0.6, features: 0.85, steps: 0.65, cta: 0.6 }, sources: 'narrative' },
      camera: { shape: 'still', stages: [{ shots: ['hook', 'solution', 'features', 'steps', 'cta'], framing: 'medium', behavior: 'still' }] },
    },
    transitionStrategy: { language: 'objects carry the cuts', intentionalRepeats: [], resetsAllowed: [] },
    heroElements: ['shape.hub', 'button.cta'],
    motifs: [{ id: 'one-place', element: 'shape.hub', identity: 'the circle', meaning: 'one place', firstAppearance: 'hook', transformations: [], finalResolution: { shot: 'cta', as: 'halo', into: 'button.cta', note: 'the circle returns behind the button' } }],
    persistentElements: [],
    keyMoments: [],
    ending: { strategy: 'the circle frames the button', payoff: { motif: 'one-place', element: 'shape.hub', from: 'hook', how: 'returns behind the button' }, why: 'the film began by gathering into the circle' },
    sequences: [
      { id: 'open', name: 'the gathering', shots: ['hook', 'solution'], purpose: 'hook and promise', narrativeFunction: 'setup', entryState: 'film start', exitState: 'promise read', energy: { start: 0.6, peak: 0.7, end: 0.6 }, visualDensity: 'low', heroElement: 'shape.hub', cameraBehavior: 'still', transitionLanguage: 'expand', persistentElements: [], contract: { receives: null, delivers: { element: 'logo.brand', state: { note: 'signs the promise' } } } },
      { id: 'proof', name: 'proof', shots: ['features', 'steps'], purpose: 'proof', narrativeFunction: 'proof', entryState: 'after the promise', exitState: 'the path', energy: { start: 0.7, peak: 0.85, end: 0.65 }, visualDensity: 'medium', heroElement: 'card.f1', cameraBehavior: 'still', transitionLanguage: 'cut', persistentElements: [], contract: { receives: null, delivers: null } },
      { id: 'decide', name: 'decision', shots: ['cta'], purpose: 'act', narrativeFunction: 'cta', entryState: 'after the path', exitState: 'film end', energy: { start: 0.6, peak: 0.65, end: 0.55 }, visualDensity: 'low', heroElement: 'button.cta', cameraBehavior: 'still', transitionLanguage: 'none', persistentElements: [], contract: { receives: null, delivers: null } },
    ],
    phrases: [{ id: 'prove', pattern: ['push', 'peak', 'settle'], beats: [{ shot: 'features', beat: 'build', element: 'card.f2' }, { shot: 'features', beat: 'peak', element: 'card.f1' }, { shot: 'steps', beat: 'release', element: 'line.path' }], reason: 'the proof is one gesture' }],
    ...over,
  };
  return FilmPlanSchema.parse(base);
}

// ───────────────────────────── P3-A film plan
describe('P3-A Film Plan', () => {
  it('validates against the script: unknown shots / motif elements are errors, a missing "why" is a warning', () => {
    const sc = script();
    expect(validateFilmPlan(filmPlan(), sc).ok).toBe(true);
    const bad = filmPlan({ motifs: [{ id: 'x', element: 'shape.nope', identity: 'nope', meaning: 'nope', firstAppearance: 'hook', transformations: [], finalResolution: { shot: 'ghost', as: 'halo', note: 'nothing' } }] });
    const r = validateFilmPlan(bad, sc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(/shape\.nope[\s\S]*ghost|ghost[\s\S]*shape\.nope/);
    const w = validateFilmPlan(filmPlan({ ending: { strategy: 'just ends', why: '' } }), sc);
    expect(w.ok && w.warnings.some((x) => /ending\.why/.test(x))).toBe(true);
  });
  it('the film plan changes the script: energy, motif halo behind the CTA action, phrase peak, all reported', () => {
    const { script: out, report } = applyFilmPlan(script(), filmPlan());
    expect(out.shots.find((s) => s.id === 'features')!.expectedEnergy).toBe(0.85);
    const cta = out.shots.find((s) => s.id === 'cta')!;
    const halo = cta.cast!.find((c) => c.id === 'shape.hub')!;
    expect(halo).toMatchObject({ role: 'background', behind: 'button.cta' });
    expect(report.applied.some((a) => a.what.startsWith('motif'))).toBe(true);
    // the peak of the phrase lands on card.f1 (it had no peak action): an impact is added
    expect(out.shots.find((s) => s.id === 'features')!.motionChain!.some((e) => e.element === 'card.f1' && e.action === 'impact')).toBe(true);
    // the build beat (card.f2) has no action in the script: the phrase is reported as it is, never faked
    const ph = report.phrases[0];
    expect(ph.beats.find((b) => b.beat === 'peak')!.added).toBe('impact');
    expect(ph.beats.find((b) => b.beat === 'build')!.present).toBe(false);
    expect(ph.beats.find((b) => b.beat === 'release')!.added).toBe('handoff exit');
  });
  it('the halo is placed centred behind its target, taller than it but capped, and drawn behind it', () => {
    const plan = compiler(filmPlan())(script());
    const t = plan.shots[4].end - 0.3;
    const s = sampleStage(plan, t);
    const hub = s.sampled.find((e) => e.id === 'shape.hub')!;
    const btn = s.sampled.find((e) => e.id === 'button.cta')!;
    const c = (r: { x: number; y: number; width: number; height: number }) => [r.x + r.width / 2, r.y + r.height / 2];
    expect(Math.abs(c(hub.rect)[0] - c(btn.rect)[0])).toBeLessThan(W * 0.02);
    expect(hub.rect.height).toBeGreaterThan(btn.rect.height);
    // a ground, not a wall: the halo never covers more than ~42% of the frame height
    expect(hub.rect.height).toBeLessThanOrEqual(H * 0.43);
    const z = (id: string) => plan.elements.find((e) => e.id === id)!.z;
    expect(z('shape.hub')).toBeLessThan(z('button.cta'));
  });
  it('a "behind" whose target is not on screen is reported (never silently placed)', () => {
    const sc = script({ cta: { cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'shape.hub', role: 'background', behind: 'card.f1' }] } });
    const { report } = compileRaw(sc);
    expect(report.warnings.some((w) => w.code === 'BEHIND_TARGET_MISSING')).toBe(true);
  });
  it('a derived plan invents nothing: no motif, no payoff, an empty "why"', () => {
    const f = deriveFilmPlan(script());
    expect(f.source).toBe('derived');
    expect(f.motifs).toHaveLength(0);
    expect(f.ending.payoff).toBeUndefined();
    expect(f.ending.why).toBe('');
    expect(validateFilmPlan(f, script()).ok).toBe(true);
  });
  it('is deterministic', () => {
    const a = applyFilmPlan(script(), filmPlan());
    const b = applyFilmPlan(script(), filmPlan());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ───────────────────────────── P3-B sequences + contracts
describe('P3-B Sequence model and contracts', () => {
  it('a contract is kept when the delivered element carries the cut, set to shared when both shots have it, else reported broken', () => {
    const { report } = applyFilmPlan(script(), filmPlan());
    const c = report.contracts.find((x) => x.from === 'open')!;
    expect(c.boundary).toBe('solution->features');
    // logo.brand is not in "features": the contract cannot be kept
    expect(c.kept).toBe(false);
    const sc2 = script({ features: { cast: [...ROW, { id: 'logo.brand', role: 'support' }] } });
    const r2 = applyFilmPlan(sc2, filmPlan()).report.contracts.find((x) => x.from === 'open')!;
    expect(r2.kept).toBe(true);
  });
  it('the sequence critic scores sequences and names its problems', () => {
    const film = filmPlan();
    const { plan, report } = compileRaw(script());
    const seqs = sequenceCritic({ plan, film, boundaries: buildBoundaries(plan), critic: criticOf(plan, report) });
    expect(seqs.map((s) => s.sequence)).toEqual(['open', 'proof', 'decide']);
    for (const s of seqs) expect(s.score).toBeGreaterThanOrEqual(0);
  });
});

// ───────────────────────────── sampler (analytic boundary model)
describe('P3 analytic sampler', () => {
  it('mass weights are fitted constants; a full-frame world is not content', () => {
    expect(KIND_MASS.button).toBeGreaterThan(KIND_MASS.card);
    const plan = compiler()(script());
    // in "solution" the circle has become the background: its mass is not counted
    const s = sampleStage(plan, plan.shots[1].start + 1.5);
    expect(massOf(plan, s)).toBeLessThan(0.5);
    expect(JSON.stringify(sampleStage(plan, 2.2))).toBe(JSON.stringify(sampleStage(plan, 2.2)));
    expect(timesIn(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

// ───────────────────────────── P3-C boundary plan + dirty propagation
describe('P3-C Boundary Intelligence and dirty propagation', () => {
  it('every boundary carries the listed fields', () => {
    const plan = compiler()(script());
    const bs = buildBoundaries(plan);
    expect(bs).toHaveLength(4);
    for (const b of bs) {
      for (const k of ['sourceShot', 'targetShot', 'sourceSubject', 'targetSubject', 'sharedElements', 'handoffElement', 'transitionType', 'transitionReason', 'sourceExitState', 'targetEntryState', 'eye', 'motionDirection', 'energyOut', 'energyIn', 'cameraStateOut', 'cameraStateIn', 'audioAnchor', 'continuityRequirements', 'worldReset', 'quality', 'score', 'signature']) expect(b).toHaveProperty(k);
      expect(b.quality.source).toBe('predicted');
      expect(b.score).toBeGreaterThanOrEqual(0);
      expect(b.score).toBeLessThanOrEqual(10);
    }
  });
  it('the signature depends on A tail / transition / B head only', () => {
    const plan = compiler()(script());
    const sig = [0, 1, 2, 3].map((i) => boundarySignature(plan, i));
    // change the body of "steps" (its cut to the CTA keeps its length): only the steps boundaries move
    const plan2 = compiler()(script({ steps: { cast: [{ id: 'line.path', role: 'hero' }, { id: 'card.f2', role: 'secondary' }] } }));
    const sig2 = [0, 1, 2, 3].map((i) => boundarySignature(plan2, i));
    expect(sig2[0]).toBe(sig[0]);
    expect(sig2[1]).toBe(sig[1]);
    expect(sig2[2]).not.toBe(sig[2]);
    expect(sig2[3]).not.toBe(sig[3]);
  });
  it('a change to shot B marks B, A→B and B→C dirty — not the far boundaries', () => {
    const before = compiler()(script());
    const after = compiler()(script({ features: { cast: ROW.map((c) => ({ ...c, at: { x: c.at.x, y: 0.42 } })) } }));
    const d = dirtyOf(before, after, ['features']);
    const ids = d.dirtyBoundaries.map((b) => b.id);
    expect(ids).toContain('solution->features');
    expect(ids).toContain('features->steps');
    expect(ids).not.toContain('hook->solution');
    expect(d.energyNeighbours.sort()).toEqual(['solution', 'steps']);
  });
  it('world reset: nothing kept, nothing carried — unless the film plan allows it', () => {
    // the cards fade out (no energy handoff), nothing persists into "steps"
    const plan = compiler()(script({ features: { cast: ROW.map((c) => ({ ...c, exit: 'fade' })) } }));
    const b = buildBoundary(plan, 2);
    expect(b.worldReset).toBe(true);
    expect(b.issues.map((x) => x.code)).toContain('WORLD_RESET');
    const ok = buildBoundary(plan, 2, { intentional: { 'features->steps': 'a deliberate change of world' } });
    expect(ok.worldReset).toBe(false);
    // the expand-to-background cut transforms an element: never a reset
    expect(buildBoundary(plan, 0).worldReset).toBe(false);
  });
});

// ───────────────────────────── P3-D transition re-director + P3-E eye flow
describe('P3-D Transition Re-Director and P3-E eye flow', () => {
  it('eye flow: exit and entry points, travel, guidance, RTL direction', () => {
    const plan = compiler()(script());
    const b = buildBoundary(plan, 1);
    expect(b.eye.exit.id).toBeTruthy();
    expect(b.eye.entry.id).toBeTruthy();
    expect(b.eye.travel).toBeGreaterThanOrEqual(0);
    expect(['with-reading', 'against-reading', 'vertical', 'still']).toContain(b.eye.direction);
  });
  it('asks the editor questions and offers only existing transition types', () => {
    const sc = script();
    const plan = compiler()(sc);
    const b = buildBoundary(plan, 1);
    const d = transitionDecision(b, plan, sc);
    expect(d).toHaveProperty('eyeNow');
    expect(d).toHaveProperty('cutBetter');
    const known = new Set<string>(['cut', ...OBJECT_TRANSITIONS, 'crossfade']);
    for (const c of boundaryCandidates(sc, plan, b)) {
      expect(MOVE_COST[c.move]).toBeGreaterThan(0);
      const tr = c.script!.shots[1].transitionOut;
      const type = typeof tr === 'string' ? tr : (tr as { type: string }).type;
      expect(known.has(type)).toBe(true);
    }
  });
  it('a cut that empties the frame is re-directed (A tail / B head), and the neighbourhood is checked', () => {
    const sc = script();
    const plan = compiler()(sc);
    const bs = buildBoundaries(plan);
    const worst = bs.filter(boundaryAtRisk).sort((a, b) => a.score - b.score)[0];
    expect(worst).toBeTruthy();
    const i = worst.index;
    const r = redirectBoundary(sc, plan, i, compiler());
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.chosen).not.toBeNull();
    expect(r.chosen!.predicted!.boundary).toBeGreaterThan(r.before.score);
    expect(r.chosen!.predicted!.neighbours.length).toBeGreaterThanOrEqual(2);
  });
  it('a hard cut ({type:"cut", hard:true}) keeps A on screen to the cut and B there on it; a plain "cut" keeps the P2 timing', () => {
    const plain = compiler()(script());
    const hard = compiler()(script({ solution: { transitionOut: { type: 'cut', hard: true } } }));
    const cut = plain.shots[1].end;
    const at = (p: StagePlan, t: number) => massOf(p, sampleStage(p, t));
    expect(at(hard, cut - 0.06)).toBeGreaterThan(at(plain, cut - 0.06));
    expect(at(hard, cut + 0.02)).toBeGreaterThan(at(plain, cut + 0.02));
  });
});

// ───────────────────────────── P3-K neighbourhood repair (real test 2) + local sequence score
describe('P3-K Neighborhood Repair', () => {
  it('real test 2: a repair of shot B that breaks A→B is detected (dirty) and the neighbourhood re-directed', () => {
    const film = null;
    const BIG = ROW.map((c) => ({ ...c, w: 0.27 }));
    const sc = script({ solution: { transitionOut: { type: 'cut', hard: true } }, features: { cast: BIG } });
    const ref = compiler(film)(sc);
    // a "repair" of features that makes its arrival late: everything enters at 1.6 s (breaks solution→features)
    const broken = JSON.parse(JSON.stringify(sc)) as ScriptObj;
    broken.shots[2].motionChain = BIG.map((c) => ({ element: c.id, action: 'enter', at: 1.6, reason: 'a shot-level repair re-timed the entrances' })) as never;
    const p1 = compiler(film)(broken);
    const before = buildBoundaries(ref).find((b) => b.id === 'solution->features')!.score;
    const afterBreak = buildBoundaries(p1).find((b) => b.id === 'solution->features')!.score;
    expect(afterBreak).toBeLessThan(before - 1);
    expect(buildBoundaries(p1).find((b) => b.id === 'solution->features')!.issues.map((x) => x.code)).toContain('BOUNDARY_VOID');
    const d = dirtyOf(ref, p1, ['features']);
    const r = neighborhoodRepair({ script: broken, plan: p1, compile: compiler(film), only: d.dirtyBoundaries.map((b) => b.id), reference: ref, changed: ['features'] });
    expect(r.report.steps.length).toBeGreaterThan(0);
    const repaired = buildBoundaries(r.plan).find((b) => b.id === 'solution->features')!.score;
    expect(repaired).toBeGreaterThan(afterBreak + 1);
    expect(r.report.steps.find((x) => x.boundary === 'solution->features')!.move).toBeTruthy();
    expect(r.report.dirty?.dirtyBoundaries.map((b) => b.id)).toContain('solution->features');
  });
  it('local sequence score combines the shot and both of its cuts', () => {
    const { plan, report } = compileRaw(script());
    const c = criticOf(plan, report);
    const l = localSequenceScore('features', c, buildBoundaries(plan));
    expect(l.parts.in).not.toBeNull();
    expect(l.parts.out).not.toBeNull();
    expect(l.score).toBeGreaterThan(0);
  });
});

// ───────────────────────────── P3-H energy, P3-I rhythm, P3-X information
describe('P3-H/I/X energy arc, rhythm and information density', () => {
  it('an overloaded shot is found; without a voice the rhythm director lengthens it (≤ +25%)', () => {
    const els = [...ELS, { id: 'text.long', kind: 'text', role: 'body', text: 'نص طويل جدا يحتوي على كلمات كثيرة تحتاج وقتا اطول للقراءة من مدة اللقطة القصيرة' }];
    const v = validateShotScript({ version: 1, stage: { elements: els }, shots: [shot('a', { timing: { duration: 1.6 }, cast: [{ id: 'text.long', role: 'hero' }], transitionOut: 'cut', transitionReason: 'a clean cut to the offer' }), shot('b', { cast: [{ id: 'text.cta', role: 'hero' }] })] });
    if (!v.ok) throw new Error(v.errors.join());
    const plan = compileStage(input(v.script)).plan;
    const info = informationFlow(plan);
    expect(info[0].overload).toBe(true);
    const r = directRhythm(plan, v.script as never, { voice: false });
    const adj = r.adjustments.find((x) => x.shot === 'a')!;
    expect(adj.to).toBeLessThanOrEqual(1.6 * 1.25 + 1e-9);
    // with a voice the voice keeps the time: reported only
    expect(directRhythm(plan, v.script as never, { voice: true }).adjustments).toHaveLength(0);
  });
  it('dead vs intentional holds', () => {
    const plan = compiler()(script());
    const r = directRhythm(plan, script() as never, { voice: false, stillRuns: [{ t0: plan.shots[3].start + 0.5, t1: plan.shots[3].start + 2.4 }, { t0: plan.shots[4].end - 1.2, t1: plan.shots[4].end - 0.1 }] });
    expect(r.holds.find((h) => h.shot === 'steps')!.class).toBe('dead');
    expect(r.holds.find((h) => h.shot === 'cta')!.class).toBe('intentional');
  });
  it('a flat measured energy is FLAT_FILM (measured), and every film dimension says its basis', () => {
    const { plan, report } = compileRaw(script());
    const c = criticOf(plan, report);
    const flat = { ...c, measures: { ...c.measures, energy: plan.shots.map((s) => ({ shot: s.id, planned: 0.6, measured: 0.5 })) } } as CriticReport;
    const fc = filmCritic({ plan, film: filmPlan(), boundaries: buildBoundaries(plan), critic: flat });
    expect(fc.energy.issues).toContain('FLAT_FILM');
    expect(Object.keys(fc.dims).sort()).toEqual([...FILM_DIMENSIONS].sort());
    for (const d of FILM_DIMENSIONS) expect(['measured', 'heuristic', 'judgment']).toContain(fc.dims[d].basis);
    // heuristics never pass 7.5; memorability is heuristic without a judgement
    expect(fc.dims.memorability.score).toBeLessThanOrEqual(7.5);
    const judged = filmCritic({ plan, film: filmPlan(), boundaries: buildBoundaries(plan), critic: flat, judgment: { memorability: { score: 8, note: 'the circle returning is memorable' } } });
    expect(judged.dims.memorability.basis).toBe('judgment');
  });
});

// ───────────────────────────── P3-T repetition (real test 3) + P3-N global re-director
describe('P3-T Film memory and repetition (real test 3)', () => {
  const same = (id: string, k: number, last = false): S =>
    shot(id, { subject: `card.f${(k % 3) + 1}`, cast: [{ id: `card.f${(k % 3) + 1}`, role: 'hero' }], camera: 'push-in', cameraReason: 'the same push every time', cameraTarget: `card.f${(k % 3) + 1}`, ...(last ? {} : { transitionOut: 'cut', transitionReason: 'the same cut every time' }) });
  const boring = () => script({}, [same('s1', 0), same('s2', 1), same('s3', 2), same('s4', 3), same('s5', 4), same('s6', 5, true)]);
  it('the same composition, camera, rhythm and transition everywhere is flagged as a boring film', () => {
    const sc = boring();
    const plan = compiler()(sc);
    const film = deriveFilmPlan(sc);
    const mem = filmMemory(plan, film);
    const reps = repetitions(mem, film);
    expect(reps.filter((r) => !r.intentional).map((r) => r.what)).toEqual(expect.arrayContaining(['camera', 'transition']));
    const fc = filmCritic({ plan, film, boundaries: buildBoundaries(plan) });
    expect(fc.issues.map((i) => i.code)).toContain('REPETITIVE_FILM');
  });
  it('a repetition declared in the film plan is intentional (a language, not laziness)', () => {
    const sc = boring();
    const plan = compiler()(sc);
    const film = deriveFilmPlan(sc);
    film.transitionStrategy.intentionalRepeats = ['cut'];
    expect(repetitions(filmMemory(plan, film), film).find((r) => r.what === 'transition')?.intentional).toBe(true);
  });
  it('the global re-director changes at most 3 shots and varies the repeated transition / camera', () => {
    const sc = boring();
    const plan = compiler()(sc);
    const film = deriveFilmPlan(sc);
    const { report } = compileRaw(sc);
    const critic = criticOf(plan, report);
    const fc = filmCritic({ plan, film, boundaries: buildBoundaries(plan), critic });
    const g = globalRedirect({ plan, script: sc, film, report: fc, critic, compile: compiler(), maxShots: 3 });
    const touched = new Set(g.actions.flatMap((a) => a.shots));
    expect(touched.size).toBeGreaterThan(0);
    expect(touched.size).toBeLessThanOrEqual(3);
    for (const a of g.actions) expect(a.level).toBe('film');
  });
});

// ───────────────────────────── P3-O CTA payoff (real test 4) + P3-F motifs
describe('P3-O CTA payoff and P3-F motifs (real test 4)', () => {
  it('a CTA that receives nothing from the film is WEAK_PAYOFF; the global re-director links the early shape and the payoff connects', () => {
    const sc = script();
    const plan = compiler()(sc);
    const film = deriveFilmPlan(sc);
    expect(ctaPayoff(plan, film).connected).toBe(false);
    const fc = filmCritic({ plan, film, boundaries: buildBoundaries(plan) });
    expect(fc.issues.map((i) => i.code)).toContain('WEAK_PAYOFF');
    expect(payoffCandidate(plan, sc, film)?.element).toBe('shape.hub');
    const g = globalRedirect({ plan, script: sc, film, report: fc, compile: compiler(), only: ['WEAK_PAYOFF'] });
    expect(g.changed).toBe(true);
    const plan2 = compiler()(g.script);
    const po = ctaPayoff(plan2, g.film);
    expect(po.connected).toBe(true);
    expect(g.film.ending.why).not.toBe('');
  });
  it('an authored motif that resolves on the CTA is a connected payoff', () => {
    const film = filmPlan();
    const plan = compiler(film)(script());
    expect(ctaPayoff(plan, film).connected).toBe(true);
  });
  it('the motifs ablation removes motifs and phrases (and only them)', () => {
    process.env.NITAAQ_NO_MOTIFS = '1';
    try {
      const f = ablate(filmPlan());
      expect(f.motifs).toHaveLength(0);
      expect(f.phrases).toHaveLength(0);
      expect(f.sequences).toHaveLength(3);
    } finally {
      delete process.env.NITAAQ_NO_MOTIFS;
    }
  });
});

// ───────────────────────────── P3-Q multiple small subjects
describe('P3-Q multiple small subjects', () => {
  it('a row of small items is judged all-at-once vs progressive emphasis vs focus-sequence, with scores', () => {
    const sc = script();
    const plan = compiler()(sc);
    const r = multipleSubjects(plan, sc, 'features', compiler());
    expect(Object.keys(r.scores)).toEqual(expect.arrayContaining(['all-at-once', 'progressive-emphasis', 'focus-sequence']));
    expect(['all-at-once', 'progressive-emphasis', 'focus-sequence']).toContain(r.choice);
    if (r.choice !== 'all-at-once') expect(r.scores[r.choice].value).toBeGreaterThan(r.scores['all-at-once'].value);
    const r2 = multipleSubjects(plan, sc, 'features', compiler());
    expect(JSON.stringify(r2.scores)).toBe(JSON.stringify(r.scores));
  });
});

// ───────────────────────────── P3-U version score, backward compatibility
describe('P3-U version score and backward compatibility', () => {
  it('a technical failure always loses; the version score is not the shot average', () => {
    const { plan, report } = compileRaw(script());
    const c = criticOf(plan, report);
    const fc = filmCritic({ plan, film: filmPlan(), boundaries: buildBoundaries(plan), critic: c });
    const v = versionScore(c, fc);
    expect(v).not.toBe(c.overall);
    expect(versionScore({ ...c, technical: { ...c.technical, pass: false } }, fc)).toBeLessThan(-9);
  });
  it('without a film plan the script compiles exactly as in P2 (the derived plan is never applied)', () => {
    const sc = script();
    const fs = filmScript(sc, deriveFilmPlan(sc));
    expect(fs.report).toBeNull();
    expect(JSON.stringify(fs.script)).toBe(JSON.stringify(sc));
    expect(JSON.stringify(compileRaw(sc).plan)).toBe(JSON.stringify(compiler()(sc)));
  });
  it('NITAAQ_NO_FILM_DIRECTOR=1 ignores even an authored plan', () => {
    process.env.NITAAQ_NO_FILM_DIRECTOR = '1';
    try {
      const sc = script();
      expect(filmScript(sc, filmPlan()).report).toBeNull();
    } finally {
      delete process.env.NITAAQ_NO_FILM_DIRECTOR;
    }
  });
  it('boundaries and the film critic are deterministic', () => {
    const plan = compiler(filmPlan())(script());
    expect(JSON.stringify(buildBoundaries(plan))).toBe(JSON.stringify(buildBoundaries(plan)));
    const a = filmCritic({ plan, film: filmPlan(), boundaries: buildBoundaries(plan) });
    const b = filmCritic({ plan, film: filmPlan(), boundaries: buildBoundaries(plan) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
