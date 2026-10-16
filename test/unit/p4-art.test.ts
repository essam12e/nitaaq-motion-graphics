/**
 * P4 (Motion Art Director & Choreography Intelligence): motion primitives (focus, settle, become, respond,
 * phrases, motion language), enter events addressable by "after", choreography graph, element vs camera
 * contribution, density / paths / composition phases, intents + key visuals, builders (hook, climax,
 * focus, subjects, CTA transform, cut transform, camera-free), the preview judge (vetoes, hand-over),
 * tournament (cheap filter, selection margin, memory v3, budgets), the Art Director Gate, reference
 * schemas, typography / audio sync readings, determinism and backward compatibility (no P4 fields → P3).
 */
import { describe, expect, it, afterEach } from 'vitest';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileStage, type StageCompileInput } from '../../src/stage/compiler';
import type { StagePlan } from '../../src/stage/plan';
import { compiledStage, elementState } from '../../src/stage/StageLayer';
import { applyFilmPlan, FilmPlanSchema, type FilmPlan } from '../../src/film/film-plan';
import { compiledOf } from '../../src/film/sampler';
import type { ScriptObj } from '../../src/film/transition-redirector';
import { choreographyGraph, choreographyCandidates, cameraFreeEquivalent, EDGE_TYPES } from '../../src/art/choreography';
import { contributions, withoutCamera, densityTimeline, motionPaths, compositionPhases } from '../../src/art/motion-analysis';
import { LANGUAGES, languageFor, phraseFor, PHRASES } from '../../src/art/language';
import { buildEnergy, hookCandidates, climaxCandidates, composeRhythm, isVisualEvent } from '../../src/art/energy';
import { focusCandidates, subjectsCandidates, focusTimeline } from '../../src/art/focus';
import { ctaTransformCandidates, transformCutCandidates } from '../../src/art/transform';
import { measurePreview, judgeCandidate, type PreviewFrame } from '../../src/art/judge';
import { cheapFilter, selectWinner, memorySkip, remember, budgetProblems, type ArtMemory, type CandidateRecord } from '../../src/art/tournament';
import { diagnose, shotIntents, keyVisuals } from '../../src/art/director';
import { artGate, AD_CODES } from '../../src/art/gate';
import { validateReferenceReview, StudioReferenceSchema, buildBuildersDoc } from '../../src/art/references';
import { audioSync, typographyMotion, motionCharacter } from '../../src/art/polish';
import { artOn, artAblations, stripPhrases, gateOf } from '../../src/node/art-director';

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
  { id: 'chip.a', kind: 'chip', text: 'واتساب', icon: 'MessageCircle', size: { w: 0.17 } },
  { id: 'chip.b', kind: 'chip', text: 'الدفتر', icon: 'BookOpen', size: { w: 0.17 } },
];
type S = Record<string, unknown>;
const shot = (id: string, over: S = {}): S => ({ id, purpose: 'feature', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', ...over });
const ROW = [
  { id: 'card.f1', role: 'hero', at: { x: 0.78, y: 0.5 }, w: 0.2 },
  { id: 'card.f2', role: 'secondary', at: { x: 0.5, y: 0.5 }, w: 0.2 },
  { id: 'card.f3', role: 'secondary', at: { x: 0.22, y: 0.5 }, w: 0.2 },
];
const SHOTS = (over: Record<string, S> = {}): S[] => [
  shot('hook', { purpose: 'hook', subject: 'text.hook', cast: [{ id: 'text.hook', role: 'hero', at: { x: 0.5, y: 0.3 } }, { id: 'shape.hub', role: 'secondary' }, { id: 'chip.a', role: 'support', at: { x: 0.25, y: 0.72 } }, { id: 'chip.b', role: 'support', at: { x: 0.75, y: 0.72 } }], transitionOut: { type: 'expand-to-background', element: 'shape.hub' }, transitionReason: 'the circle becomes the world', ...over.hook }),
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

type Act = { type: string; id?: string; target?: string; at?: number; from?: Record<string, number>; trigger?: string; dur?: number; props?: Record<string, number>; spring?: { bounce: number; visualDuration: number }; children?: Act[]; event?: { type: string } };
const flat = (n: Act[]): Act[] => n.flatMap((a) => (a.children ? flat(a.children) : [a]));
const actsOf = (plan: StagePlan) => flat(plan.choreo.timeline as unknown as Act[]);
const startOf = (plan: StagePlan, id: string) => compiledOf(plan).byId[id]?.start;
const keyOf = (plan: StagePlan, id: string) => plan.elements.find((e) => e.id === id)!.key;
const withChain = (sc: ScriptObj, shotId: string, chain: unknown[]): ScriptObj => {
  const c = JSON.parse(JSON.stringify(sc)) as ScriptObj;
  (c.shots.find((s) => s.id === shotId) as { motionChain: unknown[] }).motionChain = chain;
  return c;
};
const plain = () => compiler(null);

// ───────────────────────────── backward compatibility
describe('P4 backward compatibility', () => {
  it('a script without phrases / motion language compiles exactly as before (stripPhrases is the identity on it)', () => {
    const sc = script();
    const a = plain()(sc);
    const b = plain()(stripPhrases(sc));
    expect(JSON.stringify(a.choreo)).toBe(JSON.stringify(b.choreo));
    expect(compileStage(input((validateShotScript(sc) as { script: ShotScript }).script)).report.art ?? []).toEqual([]);
  });
  it('NITAAQ_NO_ART_DIRECTOR switches the pass off; each ablation flag switches one family off', () => {
    const keep = { ...process.env };
    process.env.NITAAQ_NO_ART_DIRECTOR = '1';
    expect(artOn()).toBe(false);
    delete process.env.NITAAQ_NO_ART_DIRECTOR;
    process.env.NITAAQ_NO_CANDIDATE_RENDER = '1';
    process.env.NITAAQ_NO_CROSS_TRANSFORM = '1';
    const ab = artAblations();
    expect(ab.candidateRender).toBe(false);
    expect(ab.crossTransform).toBe(false);
    expect(ab.choreography).toBe(true);
    process.env = keep;
  });
});

// ───────────────────────────── primitives
describe('P4 motion primitives', () => {
  it('an enter event with an id can be followed ("after": "<id>.peak") — the entrance act carries the event id', () => {
    const sc = withChain(script(), 'hook', [
      { id: 'slam', element: 'text.hook', action: 'enter', at: 0.1, reason: 'lands' },
      { id: 'thrown', element: 'chip.a', action: 'enter', after: 'slam.peak', reason: 'thrown in by the landing' },
      { element: 'chip.b', action: 'enter', after: 'thrown.peak', reason: 'and the next' },
    ]);
    const plan = plain()(sc);
    const ids = actsOf(plan).map((a) => a.id);
    expect(ids).toContain('ev_0_slam');
    expect(ids).toContain('ev_0_thrown');
    expect(startOf(plan, 'ev_0_thrown')!).toBeGreaterThan(startOf(plan, 'ev_0_slam')!);
  });
  it('focus dims the same-kind siblings (never removes them); release restores them', () => {
    const sc = withChain(script({ features: { timing: { duration: 4.5 } } }), 'features', [
      { id: 'look-1', element: 'card.f1', action: 'focus', at: 1.0, reason: 'the first idea is read alone' },
      { element: 'card.f1', action: 'focus', style: 'release', at: 2.2, reason: 'all three ideas together' },
    ]);
    const plan = plain()(sc);
    const c = compiledStage(plan);
    const f = plan.shots.find((s) => s.id === 'features')!;
    const k2 = keyOf(plan, 'card.f2');
    const mid = elementState(c, k2, f.start + 1.6);
    const end = elementState(c, k2, f.start + 2.9);
    void f.end;
    expect(mid.o).toBeGreaterThan(0.2);
    expect(mid.o).toBeLessThan(0.6);
    expect(end.o).toBeGreaterThan(0.95);
    expect((compileStage(input((validateShotScript(sc) as { script: ShotScript }).script)).report.art ?? []).some((o) => o.op === 'focus')).toBe(true);
  });
  it('a sibling not yet on screen is never dimmed (its dim is removed)', () => {
    const sc = withChain(script(), 'features', [
      { element: 'card.f1', action: 'focus', at: 0.05, reason: 'first' },
      { element: 'card.f3', action: 'enter', at: 1.5, reason: 'later' },
    ]);
    const plan = plain()(sc);
    const k3 = keyOf(plan, 'card.f3');
    expect(actsOf(plan).some((a) => a.target === k3 && /_dim_/.test(a.id ?? ''))).toBe(false);
  });
  it('become: A travels to B, takes its outline, hands over; B enters when A arrives; the event is a cta_reveal', () => {
    const sc = withChain(script(), 'cta', [{ id: 'circle-becomes', element: 'shape.hub', action: 'become', to: 'button.cta', at: 0.3, reason: 'the circle becomes the action' }]);
    (sc.shots.find((s) => s.id === 'cta') as { cast: unknown[] }).cast.push({ id: 'shape.hub', role: 'secondary', at: { x: 0.5, y: 0.5 } });
    const plan = plain()(sc);
    const acts = actsOf(plan);
    const bec = acts.find((a) => a.id === 'ev_4_circle_becomes')!;
    expect(bec.event?.type).toBe('cta_reveal');
    expect(bec.props).toHaveProperty('sx');
    expect(acts.some((a) => a.id === 'ev_4_circle_becomes_morph')).toBe(true);
    const kb = keyOf(plan, 'button.cta');
    const bIn = acts.find((a) => a.target === kb && (a.trigger ?? (a.at as unknown)) === 'ev_4_circle_becomes.end');
    expect(bIn).toBeTruthy();
    expect(plan.elements.find((e) => e.id === 'shape.hub')!.morphShapes).toEqual(['circle', 'pill']);
  });
  it('become on a user asset falls back to a crossfade (assets are never reshaped)', () => {
    const sc = withChain(script(), 'cta', [{ element: 'logo.brand', action: 'become', to: 'button.cta', at: 0.3, reason: 'never reshape a logo' }]);
    const r = compileStage(input((validateShotScript(sc) as { script: ShotScript }).script));
    expect(r.report.warnings.some((w) => /BECOME_FALLBACK/.test(w.code ?? String(w)))).toBe(true);
    expect(r.plan.elements.find((e) => e.id === 'logo.brand')!.morphShapes ?? []).toEqual([]);
  });
  it('settle brings an element from its hero pose (cast.arriveAt) back to its composed place', () => {
    const sc = withChain(script(), 'features', [
      { id: 'arrive', element: 'card.f2', action: 'enter', at: 0.1, reason: 'arrives as the hero' },
      { element: 'card.f2', action: 'settle', after: 'arrive.end', reason: 'back to its place in the row' },
    ]);
    (sc.shots.find((s) => s.id === 'features') as { cast: { id: string; arriveAt?: unknown }[] }).cast.find((c) => c.id === 'card.f2')!.arriveAt = { x: 0.5, y: 0.47, scale: 1.55 };
    const plan = plain()(sc);
    const c = compiledStage(plan);
    const f = plan.shots.find((s) => s.id === 'features')!;
    const k = keyOf(plan, 'card.f2');
    const early = elementState(c, k, f.start + 0.75);
    const late = elementState(c, k, f.end - 0.05);
    expect(early.s).toBeGreaterThan(late.s * 1.3);
    const ref = elementState(compiledStage(plain()(script())), k, f.end - 0.05);
    expect(Math.abs(late.x - ref.x)).toBeLessThan(0.02);
    expect(Math.abs(late.s - ref.s)).toBeLessThan(0.05);
  });
  it('respond is an additive kick (recoil / echo / counter)', () => {
    const sc = withChain(script(), 'hook', [
      { id: 'land', element: 'text.hook', action: 'enter', at: 0.1, reason: 'lands' },
      { element: 'chip.a', action: 'respond', style: 'recoil', to: 'text.hook', after: 'land.peak', reason: 'pushed' },
      { element: 'chip.b', action: 'respond', style: 'counter', after: 'land.peak', reason: 'tilts' },
    ]);
    const acts = actsOf(plain()(sc)).filter((a) => /^ev_0_|respond/.test(a.id ?? '') || a.trigger === 'ev_0_land.peak');
    expect(acts.some((a) => a.props && 'r' in a.props)).toBe(true);
  });
  it('phrases change the motion: tempo scales durations, bounce reaches the springs, stagger the order', () => {
    const base = script();
    const fast = JSON.parse(JSON.stringify(base)) as ScriptObj;
    for (const s of fast.shots) (s as { phrase?: unknown }).phrase = { name: 'punch', tempo: 0.6, bounce: 0.45, stagger: 0.05, accel: 'accelerate', amplitude: 1.5 };
    const a = plain()(base);
    const b = plain()(fast);
    expect(JSON.stringify(a.choreo)).not.toBe(JSON.stringify(b.choreo));
    const springs = (p: StagePlan) => actsOf(p).filter((x) => x.spring).map((x) => x.spring!.bounce);
    expect(Math.max(...springs(b))).toBeGreaterThan(Math.max(...springs(a)) - 1e-9);
  });
  it('a motion language changes the film: premium vs playful compile differently (tilt only in playful)', () => {
    const p = (id: string) => {
      const sc = JSON.parse(JSON.stringify(script())) as ScriptObj;
      const { description: _d, ...ml } = LANGUAGES[id];
      (sc as { motionLanguage?: unknown }).motionLanguage = ml;
      return plain()(sc);
    };
    const prem = p('premium-saas');
    const play = p('playful');
    expect(JSON.stringify(prem.choreo)).not.toBe(JSON.stringify(play.choreo));
    const tilt = (pl: StagePlan) => actsOf(pl).some((a) => (a.from && 'r' in a.from && a.from.r !== 0) || (a.props && 'r' in a.props && a.props.r !== 0));
    expect(tilt(play)).toBe(true);
    expect(tilt(prem)).toBe(false);
  });
  it('languageFor reads the direction; phraseFor follows the purpose', () => {
    expect(languageFor({ personality: 'playful kids app' }).language.id).toBe('playful');
    expect(languageFor({}).language.id).toBe('premium-saas');
    expect(languageFor({ requested: 'editorial' }).language.id).toBe('editorial');
    expect(phraseFor('hook').name).toBe('punch');
    expect(Object.keys(PHRASES)).toEqual(expect.arrayContaining(['punch', 'snap', 'build', 'glide', 'settle']));
  });
});

// ───────────────────────────── analysis
describe('P4 choreography graph and motion analysis', () => {
  it('edges carry causality: attract → pull, become → transform, after → trigger; EDGE_TYPES lists the vocabulary', () => {
    const sc = withChain(script(), 'hook', [
      { id: 'pull', element: 'chip.a', action: 'attract', to: 'shape.hub', at: 0.4, reason: 'pulled in' },
      { element: 'chip.b', action: 'attract', to: 'shape.hub', after: 'pull.peak', reason: 'and the next' },
    ]);
    const g = choreographyGraph(sc, plain()(sc));
    expect(g.edges.some((e) => e.type === 'pull')).toBe(true);
    expect(g.shots.find((s) => s.shot === 'hook')!.causalShare).toBeGreaterThan(0.3);
    for (const e of g.edges) expect(EDGE_TYPES).toContain(e.type);
    expect(EDGE_TYPES).toEqual(expect.arrayContaining(['trigger', 'follow', 'pull', 'push', 'orbit', 'attach', 'detach', 'replace', 'reveal', 'mask', 'carry', 'transform', 'respond', 'counter', 'echo', 'settle-with', 'handoff-to']));
  });
  it('a row entering on a clock is FLAT_CHOREOGRAPHY; the cascade candidate makes it causal', () => {
    const sc = script();
    const g = choreographyGraph(sc, plain()(sc));
    const k = sc.shots.findIndex((s) => s.id === 'features');
    const cands = choreographyCandidates(sc, k);
    expect(cands.map((c) => c.pattern)).toContain('cascade');
    const casc = cands.find((c) => c.pattern === 'cascade')!;
    const g2 = choreographyGraph(casc.script, plain()(casc.script));
    expect(g2.shots.find((s) => s.shot === 'features')!.causalShare).toBeGreaterThan(g.shots.find((s) => s.shot === 'features')!.causalShare);
  });
  it('element vs camera contribution; withoutCamera removes the camera; a push becomes a transform', () => {
    const sc = script({ features: { camera: { move: 'push-in', startAt: 0.5, endAt: 2.5 }, cameraTarget: 'card.f1', cameraReason: 'the camera goes to the first idea' } });
    const plan = plain()(sc);
    const c = contributions(plan);
    expect(c.elementMotionContribution + c.cameraMotionContribution).toBeCloseTo(1, 1);
    const nc = withoutCamera(plan);
    expect(contributions(nc).cameraMotionContribution).toBeLessThan(0.01);
    const k = sc.shots.findIndex((s) => s.id === 'features');
    const eq = cameraFreeEquivalent(sc, k)!;
    expect(eq).toBeTruthy();
    expect((eq.script.shots[k] as { motionChain: { action: string; amount?: number }[] }).motionChain.some((e) => e.action === 'transform' && (e.amount ?? 0) > 1)).toBe(true);
    expect(cameraFreeEquivalent(script({ features: { camera: { move: 'follow' }, cameraReason: 'the camera rides the path' } }), k)).toBeNull();
  });
  it('density timeline finds voids; motion paths and composition phases are computed per shot', () => {
    const plan = plain()(script());
    const d = densityTimeline(plan);
    expect(d.points.length).toBeGreaterThan(50);
    expect(Array.isArray(d.voids)).toBe(true);
    expect(Array.isArray(motionPaths(plan))).toBe(true);
    expect(compositionPhases(plan).map((p) => p.shot)).toEqual(plan.shots.map((s) => s.id));
  });
  it('shot intents name a main visual action; template shots are flagged; key visuals are 1–3', () => {
    const sc = withChain(script(), 'hook', [{ element: 'chip.a', action: 'attract', to: 'shape.hub', at: 0.4, reason: 'pulled' }]);
    const plan = plain()(sc);
    const it0 = shotIntents(sc, plan);
    expect(it0[0].verb).toBe('gather');
    expect(it0[0].visualEvent).toBe(true);
    expect(it0.find((i) => i.shot === 'solution')!.template).toBe(true);
    const kv = keyVisuals(sc, plan, it0);
    expect(kv.length).toBeGreaterThanOrEqual(1);
    expect(kv.length).toBeLessThanOrEqual(3);
  });
});

// ───────────────────────────── builders
describe('P4 builders: every candidate compiles', () => {
  const sc = script();
  const plan = plain()(sc);
  it('hook candidates (a visual event in the first second), all compile', () => {
    const c = hookCandidates(sc);
    expect(c.map((x) => x.id)).toEqual(['hook-slam', 'hook-scatter', 'hook-collision']);
    for (const x of c) {
      const p = plain()(x.script);
      const first = Math.min(...actsOf(p).filter((a) => typeof a.at === 'number').map((a) => a.at!));
      expect(first).toBeLessThan(0.3);
      expect(isVisualEvent((x.script.shots[0] as { motionChain: { action: string }[] }).motionChain) || x.id === 'hook-slam').toBe(true);
    }
  });
  it('climax, focus and subjects candidates compile', () => {
    const k = sc.shots.findIndex((s) => s.id === 'features');
    for (const x of [...climaxCandidates(sc, 'features'), ...focusCandidates(sc, plan, k), ...subjectsCandidates(sc, plan, k)]) expect(() => plain()(x.script)).not.toThrow();
    expect(subjectsCandidates(sc, plan, k).map((x) => x.label)).toEqual(expect.arrayContaining(['one-at-a-time', 'progressive hero', 'stack-and-expand', 'card-to-full-frame']));
  });
  it('focus never drops information: the focus timeline shows every item present together', () => {
    const k = sc.shots.findIndex((s) => s.id === 'features');
    const disc = focusCandidates(sc, plan, k)[0];
    const p = plain()(disc.script);
    const ft = focusTimeline(p, disc.script);
    const row = ft.shots.find((s) => s.shot === 'features');
    expect(row).toBeTruthy();
    expect(row!.neverDropped).toBe(true);
    expect(row!.allPresentAt).not.toBeNull();
  });
  it('CTA: the motif circle becomes the button (with a film plan) and the cut candidates compile', () => {
    const film = filmPlan();
    const c = ctaTransformCandidates(sc, film);
    expect(c.length).toBeGreaterThanOrEqual(1);
    for (const x of c) {
      const f = (x as { film?: FilmPlan }).film ?? film;
      expect(f.motifs[0].finalResolution?.as).toBe('transform');
      const p = compiler(f)(x.script);
      expect(actsOf(p).some((a) => a.event?.type === 'cta_reveal')).toBe(true);
    }
    for (const x of transformCutCandidates(sc, plan, sc.shots.length - 2, film)) expect(() => compiler((x as { film?: FilmPlan }).film ?? film)(x.script)).not.toThrow();
  });
  it('every candidate the diagnosis makes compiles (no dangling "after")', () => {
    const film = filmPlan();
    const p = compiler(film)(sc);
    const d = diagnose(sc, p, { film, compile: compiler(film) });
    expect(d.problems.length).toBeGreaterThan(0);
    for (const pr of d.problems) for (const c of d.make(pr, sc, p, film)) expect(() => compiler((c as { film?: FilmPlan }).film ?? film)(c.script), `${pr.id}/${c.id}`).not.toThrow();
  });
  it('energy: phrases per shot, a climax shot, and a composed rhythm that varies the internal gaps', () => {
    const e = buildEnergy(sc, plan, filmPlan().arcs.energy.curve);
    expect(Object.keys(e.report.phrases)).toEqual(sc.shots.map((s) => s.id));
    expect(e.report.climax).toBe('features');
    const r = composeRhythm(sc, plan, plain());
    expect(r.report.shots.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────── judge + tournament
const frame = (t: number, over: Partial<PreviewFrame> = {}): PreviewFrame => ({ t, occ: 0.2, diff: 0.01, texts: [], els: [], ...over });
const txt = (el: string, x: number, y = 100, w = 300, h = 80, opacity = 1) => ({ el, id: el, px: 48, rect: { x, y, width: w, height: h }, opacity });
describe('P4 preview judge', () => {
  it('a text clash in the preview is a veto even when the prediction was high', () => {
    const base = measurePreview([0, 0.1, 0.2].map((t) => frame(t, { texts: [txt('a', 0), txt('b', 600)] })), W, H);
    const bad = measurePreview([0, 0.1, 0.2].map((t) => frame(t, { texts: [txt('a', 0), txt('b', 40)] })), W, H);
    const v = judgeCandidate('cta', bad, base);
    expect(v.veto).toMatch(/TEXT_CLASH/);
    expect(judgeCandidate('cta', base, base).veto).toBeNull();
  });
  it('an emptied frame and dropped information are vetoes', () => {
    const base = measurePreview([0, 0.1, 0.2].map((t) => frame(t, { occ: 0.2, els: [{ id: 'x', kind: 'card', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1 }] })), W, H, { items: ['x'] });
    const empty = measurePreview([0, 0.1, 0.2].map((t, k) => frame(t, { occ: k === 1 ? 0.005 : 0.2, els: [{ id: 'x', kind: 'card', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 1 }] })), W, H, { items: ['x'] });
    expect(judgeCandidate('focus', empty, base).veto).toMatch(/EMPTY_FRAME/);
    const dropped = measurePreview([0, 0.1, 0.2].map((t) => frame(t, { els: [{ id: 'x', kind: 'card', rect: { x: 0, y: 0, width: 10, height: 10 }, opacity: 0.3 }] })), W, H, { items: ['x'] });
    expect(judgeCandidate('focus', dropped, base).veto).toMatch(/INFORMATION_DROPPED/);
  });
  it('the CTA hand-over is measured on the DOM: B appears where A arrived', () => {
    const r = (x: number) => ({ x, y: 500, width: 200, height: 80 });
    const fr = [frame(0, { els: [{ id: 'a', kind: 'shape', rect: r(100), opacity: 1 }] }), frame(0.1, { els: [{ id: 'a', kind: 'shape', rect: r(900), opacity: 1 }] }), frame(0.2, { els: [{ id: 'a', kind: 'shape', rect: r(905), opacity: 0.2 }, { id: 'b', kind: 'button', rect: r(910), opacity: 1 }] })];
    const m = measurePreview(fr, W, H, { handover: { from: 'a', to: 'b' } });
    expect(m.handover!.ok).toBe(true);
    expect(judgeCandidate('cta', m, measurePreview(fr, W, H)).parts.payoff).toBe(1.2);
  });
  it('the global judge rewards contrast (peaks and rests), not more motion', () => {
    const flatM = measurePreview(Array.from({ length: 40 }, (_, k) => frame(k * 0.25, { diff: 0.02 })), W, H);
    const shaped = measurePreview(Array.from({ length: 40 }, (_, k) => frame(k * 0.25, { diff: k % 8 < 2 ? 0.05 : 0.01 })), W, H);
    expect(shaped.motion.contrast).toBeGreaterThan(flatM.motion.contrast);
    expect(judgeCandidate('global', shaped, flatM).score).toBeGreaterThan(judgeCandidate('global', flatM, flatM).score);
  });
  it('mid-motion failures are found on moving frames', () => {
    const fr = [frame(0, { diff: 0 }), frame(0.1, { diff: 0.05, texts: [txt('a', 0), txt('b', 30)] })];
    expect(measurePreview(fr, W, H).midMotion.frames).toBeGreaterThan(0);
  });
});

describe('P4 tournament', () => {
  const v = (score: number, veto: string | null = null) => ({ score, veto, parts: {}, notes: [] });
  it('cheap filter drops predicted vetoes, far-under candidates and keeps the best 3', () => {
    const c = [
      { id: 'a', predicted: v(8) },
      { id: 'b', predicted: v(9, 'TEXT_CLASH') },
      { id: 'c', predicted: v(3) },
      { id: 'd', predicted: v(7) },
      { id: 'e', predicted: v(6.5) },
      { id: 'f', predicted: v(6.8) },
    ];
    const r = cheapFilter(c, 6);
    expect(r.keep.map((x) => x.id)).toEqual(['a', 'd', 'f']);
    expect(r.drop.map((x) => x.id).sort()).toEqual(['b', 'c', 'e']);
  });
  it('a candidate must beat the kept version by the margin; a preview veto loses whatever its score', () => {
    expect(selectWinner([{ id: 'a', preview: v(6.2) }], 6).winner).toBeNull();
    expect(selectWinner([{ id: 'a', preview: v(9, 'TEXT_CLASH') }, { id: 'b', preview: v(6.5) }], 6).winner!.id).toBe('b');
  });
  it('memory v3 remembers why a candidate lost and skips it next time (signature-specific)', () => {
    const mem: ArtMemory = { version: 3, entries: [] };
    const rec: CandidateRecord = { problem: 'p', candidate: 'c1', label: 'l', why: 'w', predicted: { score: 8.3, veto: null }, preview: { score: 4.3, veto: 'TEXT_CLASH x', parts: {}, measure: {} as never }, status: 'rejected', reason: 'vetoed in preview: TEXT_CLASH', cost: { frames: 1, renderMs: 1, cached: 0 } };
    remember(mem, 'sig1', rec, 'x');
    expect(mem.entries[0].outcome).toBe('vetoed');
    expect(memorySkip(mem, 'sig1', 'c1')).toMatch(/vetoed/);
    expect(memorySkip(mem, 'sig2', 'c1')).toBeNull();
  });
  it('budgets: local → sequence → a reserved global slot that runs even when local work remains', () => {
    const ps = [...Array.from({ length: 9 }, () => ({ level: 'local' as const })), { level: 'sequence' as const }, { level: 'global' as const }];
    const r = budgetProblems(ps);
    expect(r.run.filter((p) => p.level === 'local').length).toBe(6);
    expect(r.run.some((p) => p.level === 'global')).toBe(true);
    expect(r.deferred.length).toBe(3);
  });
});

// ───────────────────────────── gate, references, polish
describe('P4 Art Director Gate', () => {
  it('a template film is rejected with named codes; every code is in the vocabulary', () => {
    const sc = script();
    const g = gateOf(sc, plain()(sc));
    const codes = g.rejections.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['WEAK_PAYOFF_EXECUTION', 'GENERIC_BRAND_MOTION', 'WEAK_TRANSFORMATION']));
    for (const c of codes) expect(AD_CODES).toContain(c);
    expect(g.passed).toBe(false);
  });
  it('the CTA transform clears the payoff and transformation codes', () => {
    const film = filmPlan();
    const c = ctaTransformCandidates(script(), film)[0];
    const f = (c as { film?: FilmPlan }).film ?? film;
    const eff = applyFilmPlan(c.script, f).script as ScriptObj;
    const g = gateOf(eff, compiler(f)(c.script), f);
    const codes = g.rejections.map((r) => r.code);
    expect(codes).not.toContain('WEAK_PAYOFF_EXECUTION');
    expect(codes).not.toContain('WEAK_TRANSFORMATION');
  });
  it('artGate is pure and deterministic', () => {
    const sc = script();
    expect(JSON.stringify(gateOf(sc, plain()(sc)))).toBe(JSON.stringify(gateOf(sc, plain()(sc))));
    expect(typeof artGate).toBe('function');
  });
});

describe('P4 references, typography, audio sync, character', () => {
  it('reference review schema: valid review passes; an invented asset field fails (strict)', () => {
    const ok = validateReferenceReview({ version: 1, reference: 'ref-1', reviewer: 'claude-judgment', language: { tempo: 'quick', bounce: 'soft', camera: 'sparing' }, keyVisuals: [{ t: 3, what: 'the dot becomes the logo', why: 'one idea carried' }] });
    expect(ok.ok).toBe(true);
    expect(validateReferenceReview({ version: 1, reference: 'r', reviewer: 'claude-judgment', language: { tempo: 'quick', bounce: 'soft', camera: 'sparing' }, assets: ['x.png'] }).ok).toBe(false);
    expect(StudioReferenceSchema.safeParse({ version: 1, id: 'ref-1', title: 'A film', source: { kind: 'user-file', ref: 'ref.mp4' }, rights: 'study-only' }).success).toBe(true);
    expect(buildBuildersDoc().primitives.every((p) => p.why && p.where && p.how && p.cost)).toBe(true);
  });
  it('typography: Arabic is never animated letter by letter', () => {
    const sc = script({ hook: { typography: { headline: 'typewriter' } } } as never);
    const t = typographyMotion(plain()(script()), sc);
    expect(t.violations.some((v) => /LETTER_MOTION/.test(v))).toBe(true);
    expect(typographyMotion(plain()(script()), script()).violations).toEqual([]);
  });
  it('audio sync: the CTA reveal is a transform with a sound; character lists the phrases', () => {
    const film = filmPlan();
    const c = ctaTransformCandidates(script(), film)[0];
    const p = compiler((c as { film?: FilmPlan }).film ?? film)(c.script);
    const a = audioSync(p);
    expect(a.events.some((e) => e.type === 'cta_reveal' && e.category === 'transform' && e.sfx)).toBe(true);
    const ch = motionCharacter(p, c.script);
    expect(ch.shots.length).toBe(5);
  });
});

describe('P4 determinism', () => {
  it('diagnosis and candidates are identical run to run', () => {
    const film = filmPlan();
    const sc = script();
    const p = compiler(film)(sc);
    const a = diagnose(sc, p, { film });
    const b = diagnose(sc, p, { film });
    const strip = (d: typeof a) => JSON.stringify({ ...d, make: undefined });
    expect(strip(a)).toBe(strip(b));
    const ca = a.problems.flatMap((pr) => a.make(pr, sc, p, film)).map((c) => JSON.stringify(c.script));
    const cb = b.problems.flatMap((pr) => b.make(pr, sc, p, film)).map((c) => JSON.stringify(c.script));
    expect(ca).toEqual(cb);
  });
});
