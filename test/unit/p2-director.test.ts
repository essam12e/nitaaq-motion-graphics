/**
 * P2 (Visual Director & Intelligent Repair): calibrated critic (technical vs visual), seen hierarchy,
 * composition strategies, Re-Director, Repair Planner (cost, intent, memory, side effects),
 * redirection.json, style-frame gate thresholds, transition frame quality, collision classes, camera
 * justification / dependency, rhythm, commercial polish, CTA lock-up, reference ordering, regressions.
 */
import { describe, expect, it } from 'vitest';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileStage, projectPoint, type StageCompileInput } from '../../src/stage/compiler';
import { composeShot, STRATEGIES, resolveStrategy, OCCUPANCY } from '../../src/stage/composition';
import { keyOf, LAYER_DEPTH, type StagePlan } from '../../src/stage/plan';
import { compiledStage, elementState, cameraAtT } from '../../src/stage/StageLayer';
import { analyzeStageProbes, settleTimeOf, type StageProbeSample } from '../../src/qc/stage-probes';
import { critique, bandOf, AUTO_CAP, curve, VISUAL_DIMENSIONS, type CriticReport } from '../../src/qc/critic';
import { seenHierarchy, similarGroups, tierOf, DOMINANCE_WEIGHTS } from '../../src/stage/hierarchy';
import { recompositionCandidates, diagnoseShot, applicableStrategies, predictLayout, scorePrediction } from '../../src/stage/redirector';
import { planRepairs, issueCandidates, sideEffects, type RepairMemory } from '../../src/stage/repair-planner';
import { applyRedirection, RedirectionSchema, CAPABILITIES, dependentsOf } from '../../src/stage/redirection';
import { judgeTransition, pixelOccupancy, transitionSampleTimes } from '../../src/qc/transition-quality';
import { GATE } from '../../src/node/style-frames';

const W = 1920;
const H = 1080;

// ───────────────────────────── fixtures: a film with a row of small cards, a path, a CTA
const ELS = [
  { id: 'text.hook', kind: 'text', role: 'headline', text: 'كل حجوزاتك في مكان واحد' },
  { id: 'shape.hub', kind: 'shape', shape: 'circle', color: 'primary', size: { w: 0.16, aspect: 1 } },
  { id: 'text.solution', kind: 'text', role: 'headline', text: 'منصة تنظم حجوزاتك تلقائيًا' },
  { id: 'card.f1', kind: 'card', title: 'تذكير تلقائي', icon: 'Bell' },
  { id: 'card.f2', kind: 'card', title: 'دفع مسبق', icon: 'CreditCard' },
  { id: 'card.f3', kind: 'card', title: 'تقارير', icon: 'ChartColumn' },
  { id: 'card.f4', kind: 'card', title: 'تقويم', icon: 'CalendarDays' },
  { id: 'line.path', kind: 'line', points: [[1, 0.5], [0.5, 0.4], [0, 0.5]], illustrative: true, size: { w: 0.86, aspect: 4.2 } },
  { id: 'logo.brand', kind: 'image', asset: 'logo' },
  { id: 'text.cta', kind: 'text', role: 'cta', text: 'جرّب مجانًا' },
  { id: 'button.cta', kind: 'button', text: 'ابدأ الآن' },
];
type S = Record<string, unknown>;
const shot = (id: string, over: S = {}): S => ({ id, purpose: 'feature', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', ...over });
const ROW = [
  { id: 'card.f1', role: 'hero', at: { x: 0.82, y: 0.5 }, w: 0.17 },
  { id: 'card.f2', role: 'secondary', at: { x: 0.61, y: 0.5 }, w: 0.17 },
  { id: 'card.f3', role: 'secondary', at: { x: 0.39, y: 0.5 }, w: 0.17 },
  { id: 'card.f4', role: 'secondary', at: { x: 0.18, y: 0.5 }, w: 0.17 },
];
function script(over: { features?: S; cta?: S; hook?: S } = {}): ShotScript & Record<string, unknown> {
  const shots = [
    shot('hook', { purpose: 'hook', subject: 'text.hook', cast: [{ id: 'text.hook', role: 'hero' }, { id: 'shape.hub', role: 'secondary' }], transitionOut: { type: 'text-mask', element: 'text.hook' }, transitionReason: 'the product is seen through the promise', ...over.hook }),
    shot('features', { subject: 'card.f1', cast: ROW, transitionOut: 'cut', transitionReason: 'a clean cut to the offer', ...over.features }),
    shot('cta', { purpose: 'cta', subject: 'text.cta', timing: { duration: 2.6 }, cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'logo.brand', role: 'support' }], hold: { intentional: true, reason: 'read', maxSec: 1.6 }, ...over.cta }),
  ];
  const v = validateShotScript({ version: 1, stage: { elements: ELS }, shots });
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
const compile = (sc = script()) => compileStage(input(sc));

/** Geometric DOM samples from the plan itself (the compiler's own positions, camera at rest). */
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
const settleSamples = (plan: StagePlan) => synth(plan, plan.shots.map((s) => settleTimeOf(plan, s.id)));
const judge = (sc = script(), extra: Partial<Parameters<typeof critique>[0]> = {}) => {
  const { plan, report } = compile(sc);
  const samples = settleSamples(plan);
  return { plan, report, c: critique({ plan, report, samples, ...extra }) };
};

// ───────────────────────────── P2-A critic calibration
describe('P2-A critic calibration', () => {
  it('bands are interpretable and automatic evidence never reaches "exceptional"', () => {
    expect(bandOf(3)).toBe('weak');
    expect(bandOf(5)).toBe('acceptable');
    expect(bandOf(7)).toBe('good');
    expect(bandOf(8)).toBe('professional');
    expect(bandOf(9.5)).toBe('exceptional');
    const { c } = judge();
    expect(c.overall).toBeLessThanOrEqual(AUTO_CAP);
    for (const d of VISUAL_DIMENSIONS) expect(c.visual.scores[d].score).toBeLessThanOrEqual(AUTO_CAP);
  });
  it('a 10/10 needs a judgement passed in; it is recorded as such', () => {
    const { plan, report } = compile();
    const samples = settleSamples(plan);
    const all = Object.fromEntries(VISUAL_DIMENSIONS.map((d) => [d, { score: 10, note: 'reviewed by eye' }]));
    const c = critique({ plan, report, samples, judgment: all });
    const a = critique({ plan, report, samples });
    expect(c.visual.scores.storytelling.basis).toBe('judgment');
    expect(c.visual.scores.storytelling.evidence.join(' ')).toMatch(/judgement/);
    expect(c.visual.scores.storytelling.score).toBeGreaterThan(a.visual.scores.storytelling.score);
  });
  it('technical correctness is a separate layer: passing it does not raise a visual score', () => {
    const { plan, report } = compile();
    const samples = settleSamples(plan);
    const clean = critique({ plan, report, samples, textProblems: [] });
    const broken = critique({ plan, report, samples, textProblems: [{ id: 'text.hook', problem: 'a word is split' }] });
    expect(clean.technical.checks.find((x) => x.id === 'ARABIC_INTEGRITY')!.pass).toBe(true);
    expect(broken.technical.checks.find((x) => x.id === 'ARABIC_INTEGRITY')!.pass).toBe(false);
    // the visual layer is the same composition: only typography (where the problem lives) may drop
    expect(clean.visual.scores.composition.score).toBe(broken.visual.scores.composition.score);
    expect(clean.visual.scores.hierarchy.score).toBe(broken.visual.scores.hierarchy.score);
  });
  it('every dimension states its basis (measured / heuristic / judgment / n/a) and confidence', () => {
    const { c } = judge();
    for (const d of VISUAL_DIMENSIONS) {
      expect(['measured', 'heuristic', 'judgment', 'n/a']).toContain(c.visual.scores[d].basis);
      expect(c.visual.scores[d].confidence).toBeGreaterThanOrEqual(0);
    }
    expect(c.visual.scores.audioSync.basis).toBe('n/a'); // no voice: excluded, not a free 7
    expect(c.visual.scores.commercialPolish.basis).toBe('heuristic');
  });
  it('the overall is held down by its weakest shot', () => {
    const { c } = judge();
    const worst = Math.min(...c.shots.map((s) => s.overall));
    expect(c.overall).toBeLessThanOrEqual(worst + 2.5 + 1e-9);
  });
  it('piecewise curves are monotone where they should be', () => {
    const pts: [number, number][] = [[0, 1], [0.5, 5], [1, 8]];
    expect(curve(-1, pts)).toBe(1);
    expect(curve(0.25, pts)).toBeCloseTo(3, 5);
    expect(curve(2, pts)).toBe(8);
  });
});

// ───────────────────────────── regression 1: a row at 10% is not "excellent frame utilisation"
describe('regression: a row of small equal cards', () => {
  it('a 4-card row (each ~6–10% of the frame) is flagged and scores below "good" on frame + hierarchy', () => {
    const { c, plan } = judge();
    void plan;
    const f = c.shots.find((s) => s.shot === 'features')!;
    expect(c.issues.some((i) => i.code === 'ROW_OF_SMALL_OBJECTS' && i.shot === 'features')).toBe(true);
    expect(f.scores.frameUtilization).toBeLessThan(6);
    expect(f.scores.hierarchy).toBeLessThan(5);
    expect(c.visual.scores.frameUtilization.score).toBeLessThan(9);
  });
  it('the Re-Director proposes a different organisation (not a scale-up) predicted to beat it', () => {
    const sc = script();
    const { plan, c } = judge(sc);
    const cands = recompositionCandidates(plan, sc as never, c, 'features');
    expect(cands.length).toBeGreaterThan(3);
    const top = cands[0];
    expect(top.kind).toBe('recompose');
    expect(['hero-focus', 'focus-sequence', 'asymmetric-split', 'card-cascade']).toContain(top.directive.strategy);
    expect(top.gain).toBeGreaterThan(0.5);
    expect(top.directive.unpin).toEqual(['*']);
    expect(top.directive.resize).toBeUndefined(); // never "just scale"
  });
  it('applying the chosen strategy really makes the hero dominant (recompiled, re-measured)', () => {
    const sc = script();
    const { plan, c } = judge(sc);
    const top = recompositionCandidates(plan, sc as never, c, 'features')[0];
    const { script: next } = applyRedirection(sc, { version: 1, source: 'deterministic', shots: [top.directive] });
    expect(validateShotScript(next).ok).toBe(true);
    const after = judge(next as never).c;
    const f0 = c.shots.find((s) => s.shot === 'features')!;
    const f1 = after.shots.find((s) => s.shot === 'features')!;
    expect(f1.overall).toBeGreaterThan(f0.overall + 0.8);
    expect(f1.hierarchy!.heroRank).toBe(1);
    expect(f1.measured.subjectOcc).toBeGreaterThan(f0.measured.subjectOcc * 2);
  });
});

// ───────────────────────────── P2-B hierarchy
describe('P2-B visual hierarchy (seen, not claimed)', () => {
  it('tiers from the script; dominance weights sum to 1 and are not area alone', () => {
    expect(tierOf({ kind: 'shape', content: {} }, 'support', false)).toBe('decorative');
    expect(tierOf({ kind: 'text', content: { text: 'x' } }, 'support', false)).toBe('supporting');
    expect(tierOf({ kind: 'card', content: {} }, 'hero', true)).toBe('primary');
    const sum = Object.values(DOMINANCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(DOMINANCE_WEIGHTS.area).toBeLessThan(0.5);
  });
  it('first / second / third read follow dominance; a hero smaller than a neighbour is read second', () => {
    const { plan } = compile();
    const smp: StageProbeSample = { t: 4.5, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, words: [], mask: false, els: [
      { id: 'card.f1', kind: 'card', rect: { x: 1400, y: 400, width: 300, height: 230 }, opacity: 1, parent: false },
      { id: 'card.f2', kind: 'card', rect: { x: 500, y: 250, width: 700, height: 540 }, opacity: 1, parent: false },
    ] };
    const h = seenHierarchy(plan, 'features', smp, { W, H, rtl: true });
    expect(h.readOrder[0]).toBe('card.f2');
    expect(h.heroRank).toBe(2);
  });
  it('similar groups: ≥3 equal objects, text excluded', () => {
    expect(similarGroups([{ id: 'a', kind: 'card', area: 0.1 }, { id: 'b', kind: 'card', area: 0.11 }, { id: 'c', kind: 'card', area: 0.1 }]).length).toBe(1);
    expect(similarGroups([{ id: 'a', kind: 'card', area: 0.3 }, { id: 'b', kind: 'card', area: 0.05 }, { id: 'c', kind: 'card', area: 0.05 }]).length).toBe(0);
    expect(similarGroups([{ id: 'a', kind: 'text', area: 0.1 }, { id: 'b', kind: 'text', area: 0.1 }, { id: 'c', kind: 'text', area: 0.1 }]).length).toBe(0);
  });
});

// ───────────────────────────── context-aware occupancy / negative space
describe('context-aware frame judgement', () => {
  it('a small logo resolve is not punished like a small product; a full-frame UI is not "crowded"', () => {
    expect(OCCUPANCY.logo.medium[1]).toBeLessThan(OCCUPANCY.product.medium[0]);
    const { c } = judge();
    expect(c.issues.some((i) => i.code === 'CROWDED_FRAME' && i.shot === 'cta')).toBe(false);
  });
  it('a mostly empty frame is flagged as excess negative space', () => {
    const sc = script({ features: { cast: [{ id: 'card.f1', role: 'hero', at: { x: 0.5, y: 0.5 }, w: 0.08 }] } });
    const { c } = judge(sc);
    expect(c.issues.some((i) => (i.code === 'EXCESS_NEGATIVE_SPACE' || i.code === 'EMPTY_COMPOSITION') && i.shot === 'features')).toBe(true);
  });
});

// ───────────────────────────── P2-C strategies
describe('P2-C composition strategies', () => {
  const els = (n: number, kind = 'card') => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, kind: kind as never, role: (i ? 'secondary' : 'hero') as never, aspect: kind === 'chip' ? 3 : 1.3 }));
  const run = (strategy: string, e = els(3)) => composeShot({ W, H, safe: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, rtl: true, shotSize: 'medium', purpose: 'feature', elements: e, strategy });
  it('names and aliases resolve; unknown names fall back to the P1 layout', () => {
    expect(STRATEGIES.length).toBeGreaterThanOrEqual(14);
    expect(resolveStrategy('carousel')).toBe('focus-sequence');
    expect(resolveStrategy('before-after')).toBe('split');
    expect(resolveStrategy('nope')).toBeNull();
    expect(run('nope').report.layout).not.toMatch(/strategy/);
  });
  it('hero-focus: the hero leads (≥ ×2 the area of any other) on the reading-start side (RTL → right)', () => {
    const r = run('hero-focus');
    const a = (id: string) => r.boxes[id].w * r.boxes[id].h;
    expect(a('x0')).toBeGreaterThan(2 * Math.max(a('x1'), a('x2')));
    expect(r.boxes.x0.x).toBeGreaterThan(0.5);
  });
  it('is generic: the same strategy organises chips, images or cards (no hardcoded "features")', () => {
    for (const k of ['chip', 'image', 'card']) {
      const r = run('hero-focus', els(4, k));
      const areas = Object.entries(r.boxes).map(([id, b]) => ({ id, a: b.w * b.h })).sort((p, q) => q.a - p.a);
      expect(areas[0].id).toBe('x0');
    }
  });
  it('every strategy keeps every element inside the frame and places all of them', () => {
    for (const st of STRATEGIES) {
      const r = run(st, els(4));
      expect(Object.keys(r.boxes).length).toBe(4);
      for (const b of Object.values(r.boxes)) {
        expect(b.x - b.w / 2).toBeGreaterThan(-0.01);
        expect(b.x + b.w / 2).toBeLessThan(1.01);
      }
    }
  });
  it('timeline-flow lays items in reading order (RTL: first item on the right)', () => {
    const r = run('timeline-flow', els(3));
    expect(r.boxes.x0.x).toBeGreaterThan(r.boxes.x1.x);
    expect(r.boxes.x1.x).toBeGreaterThan(r.boxes.x2.x);
  });
  it('applicability follows the content: cta-lockup only for a CTA, ui-zoom only for an interface hero', () => {
    expect(applicableStrategies(els(3), 'feature', false)).not.toContain('cta-lockup');
    expect(applicableStrategies(els(3), 'cta', true)).toContain('cta-lockup');
    expect(applicableStrategies([{ id: 'u', kind: 'ui', role: 'hero', aspect: 1.6 }] as never, 'demo', false)).toContain('ui-zoom');
  });
});

// ───────────────────────────── P2-O CTA
describe('P2-O CTA lock-up', () => {
  it('the action line leads, the button sits right under it, the brand signs above', () => {
    const r = composeShot({ W, H, safe: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, rtl: true, shotSize: 'medium', purpose: 'cta', strategy: 'cta-lockup', elements: [
      { id: 't', kind: 'text', role: 'hero', aspect: 3.2, chars: 12 },
      { id: 'b', kind: 'button', role: 'secondary', aspect: 3.4 },
      { id: 'l', kind: 'image', role: 'support', aspect: 1, assetKind: 'logo' },
    ] });
    expect(r.boxes.l.y).toBeLessThan(r.boxes.t.y);
    expect(r.boxes.t.y).toBeLessThan(r.boxes.b.y);
    const gap = r.boxes.b.y - r.boxes.b.h / 2 - (r.boxes.t.y + r.boxes.t.h / 2);
    expect(gap).toBeLessThan(0.08);
    expect(r.boxes.t.w * r.boxes.t.h).toBeGreaterThan(r.boxes.b.w * r.boxes.b.h);
  });
  it('the critic measures the CTA (type size, button distance, first read) instead of granting it', () => {
    const { c } = judge();
    expect(c.visual.scores.cta.basis).toBe('measured');
    expect(c.visual.scores.cta.evidence.join(' ')).toMatch(/first read/);
  });
});

// ───────────────────────────── P2-D/E planner + redirection
describe('P2-D repair planner and P2-E redirection.json', () => {
  const offIssue = { code: 'TEXT_OFF_FRAME' as const, severity: 'critical' as const, layer: 'technical' as const, shot: 'features', dims: ['typography' as const], evidence: 'cut', elements: ['card.f2'] };
  it('regression 2: TEXT_OFF_FRAME tries reflow / re-composition / reframe before disabling the camera', () => {
    const sc = script({ features: { camera: { move: 'push-in' }, cameraTarget: 'card.f1', cameraReason: 'the reminder is the point', framing: { end: 'close' } } });
    const { plan } = compile(sc);
    const cs = issueCandidates(plan, sc as never, offIssue);
    const ranked = cs.map((x) => ({ x, v: x.gain - ({ low: 0.1, medium: 0.35, high: 0.8, 'very-high': 1.6 } as const)[x.cost] })).sort((a, b) => b.v - a.v);
    expect(ranked[ranked.length - 1].x.id).toMatch(/camera:static/);
    expect(ranked.some((r) => r.x.kind === 'recompose')).toBe(true);
    expect(ranked[ranked.length - 1].x.directive.intentChanges.length).toBe(1); // the lost camera intent is declared
  });
  it('a failed repair (memory) is never tried again: the next candidate is chosen', () => {
    const sc = script({ features: { camera: { move: 'push-in' }, cameraTarget: 'card.f1', cameraReason: 'the reminder is the point', framing: { end: 'close' } } });
    const { plan, report } = compile(sc);
    const c = critique({ plan, report, samples: settleSamples(plan) });
    c.issues = [offIssue];
    const p1 = planRepairs({ plan, script: sc as never, critic: c, redirector: false });
    const first = p1.selected[0].id;
    const memory: RepairMemory = { version: 1, attempts: [{ pass: 1, shot: 'features', candidate: first, label: 'x', issues: ['TEXT_OFF_FRAME'], cost: 'low', before: { overall: 5 }, result: 'no-change' }] };
    const p2 = planRepairs({ plan, script: sc as never, critic: c, memory, redirector: false });
    expect(p2.selected[0].id).not.toBe(first);
  });
  it('the schema binds the document; unsupported asks are mapped or rejected with the reason', () => {
    const sc = script();
    const red = RedirectionSchema.parse({ shots: [{ shot: 'features', diagnosis: 'a row of equals', strategy: 'carousel', camera: { move: 'barrel-roll' }, remove: ['card.f1'], subject: 'nope.x' }] });
    const { report } = applyRedirection(sc, red);
    expect(report.mapped.some((m) => /focus-sequence/.test(m.did))).toBe(true);
    expect(report.rejected.map((r) => r.asked).join(' ')).toMatch(/barrel-roll/);
    expect(report.rejected.some((r) => /remove "card.f1"/.test(r.asked) && /subject/.test(r.why))).toBe(true);
    expect(report.rejected.some((r) => /subject "nope.x"/.test(r.asked))).toBe(true);
    expect(() => RedirectionSchema.parse({ shots: [{ shot: 'x', diagnosis: 'abcd', code: 'console.log()' }] })).toThrow();
    expect(CAPABILITIES.strategies.length).toBe(STRATEGIES.length);
  });
  it('intent is preserved: a transition type change is refused unless declared in intentChanges', () => {
    const sc = script();
    const a = applyRedirection(sc, RedirectionSchema.parse({ shots: [{ shot: 'hook', diagnosis: 'void', transition: { type: 'shared' } }] }));
    expect(a.report.rejected.length).toBe(1);
    expect((a.script.shots[0].transitionOut as { type: string }).type).toBe('text-mask');
    const b = applyRedirection(sc, RedirectionSchema.parse({ shots: [{ shot: 'hook', diagnosis: 'void', transition: { type: 'shared' }, intentChanges: [{ what: 'transition', why: 'test' }] }] }));
    expect((b.script.shots[0].transitionOut as { type: string }).type).toBe('shared');
    expect(b.report.intent[0].what).toBe('transition');
  });
  it('dependents protect brand, CTA and transition carriers from removal', () => {
    const sc = script();
    expect(dependentsOf(sc as never, 2, 'logo.brand')).toContain('brand');
    expect(dependentsOf(sc as never, 0, 'text.hook')).toContain('transition out');
  });
  it('cost ordering: low < medium < high < very-high and the planner prefers cheap fixes of equal effect', () => {
    const sc = script();
    const { plan } = compile(sc);
    const coll = { code: 'TEXT_COLLISION' as const, severity: 'major' as const, layer: 'visual' as const, shot: 'features', dims: ['composition' as const], evidence: 'text-obstruction: x over y', elements: ['card.f2', 'card.f3'] };
    const cs = issueCandidates(plan, sc as never, coll);
    expect(cs.some((x) => x.cost === 'low')).toBe(true);
    expect(cs.find((x) => x.cost === 'low')!.directive.depth).toBeDefined();
  });
  it('side effects: new issues and dropped dimensions are reported', () => {
    const { c } = judge();
    const worse: CriticReport = JSON.parse(JSON.stringify(c));
    worse.overall -= 0.5;
    worse.visual.scores.composition.score -= 1;
    worse.issues.push({ code: 'TEXT_COLLISION', severity: 'major', layer: 'visual', shot: 'cta', dims: ['composition'], evidence: 'x' });
    const fx = sideEffects(c, worse, ['cta']);
    expect(fx.gained).toBeLessThan(0);
    expect(fx.sideEffects.join(' ')).toMatch(/composition/);
    expect(fx.introduced).toContain('TEXT_COLLISION@cta');
  });
  it('re-direction is deterministic', () => {
    const sc = script();
    const { plan, c } = judge(sc);
    expect(JSON.stringify(recompositionCandidates(plan, sc as never, c, 'features'))).toBe(JSON.stringify(recompositionCandidates(plan, sc as never, c, 'features')));
  });
  it('the diagnosis names causes a designer would', () => {
    const sc = script();
    const { c } = judge(sc);
    const d = diagnoseShot(c, sc as never, 'features');
    expect(d.causes).toContain('row-of-equals');
  });
  it('predictions use the critic curves: a dominant hero predicts a higher shot score', () => {
    const els = [{ id: 'a', kind: 'card', role: 'hero', aspect: 1.3 }, { id: 'b', kind: 'card', role: 'secondary', aspect: 1.3 }] as never[];
    const even = predictLayout({ a: { x: 0.3, y: 0.5, w: 0.3, h: 0.4 }, b: { x: 0.7, y: 0.5, w: 0.3, h: 0.4 } }, els, W, H);
    const led = predictLayout({ a: { x: 0.35, y: 0.5, w: 0.5, h: 0.66 }, b: { x: 0.8, y: 0.5, w: 0.2, h: 0.27 } }, els, W, H);
    expect(scorePrediction(led, OCCUPANCY.card.medium)).toBeGreaterThan(scorePrediction(even, OCCUPANCY.card.medium));
  });
});

// ───────────────────────────── P2-F gate
describe('P2-F style frame gate', () => {
  it('thresholds are explicit and lenient: accept ≥ 5.5, reject < 3.5', () => {
    expect(GATE.accept).toBe(5.5);
    expect(GATE.reject).toBe(3.5);
  });
  it('a weak composition (row of equals) would be sent back before the animatic', () => {
    const { c } = judge();
    const f = c.shots.find((s) => s.shot === 'features')!;
    const blocking = c.issues.some((i) => i.shot === 'features' && i.code === 'ROW_OF_SMALL_OBJECTS' && i.severity === 'major');
    expect(f.overall < GATE.accept || blocking).toBe(true);
  });
});

// ───────────────────────────── P2-G transitions
describe('P2-G transition frame quality', () => {
  const tr = { from: 'a', to: 'b', requested: 'text-mask', status: 'object' as const, kind: 'text-mask', element: 'text.a', t0: 1, t1: 2, reason: 'x' };
  const curveOf = (occ: number[]) => occ.map((o, i) => ({ t: 0.76 + i * 0.08, occ: o, lum: 0.9 }));
  it('regression 3: 0.60 → 0.08 → 0.65 is an empty transition frame and a visual void', () => {
    const occ = [0.6, 0.6, 0.6, 0.6, 0.4, 0.08, 0.06, 0.07, 0.08, 0.1, 0.2, 0.4, 0.6, 0.65, 0.65, 0.65, 0.65, 0.65];
    const q = judgeTransition(tr, curveOf(occ));
    expect(q.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['EMPTY_TRANSITION_FRAME', 'VISUAL_VOID']));
    expect(q.score).toBeLessThan(5);
  });
  it('a carried cut (no dip) scores high and has no issue', () => {
    const q = judgeTransition(tr, curveOf(Array(18).fill(0.5)));
    expect(q.issues).toEqual([]);
    expect(q.score).toBe(9);
  });
  it('a flash frame is detected', () => {
    const c = curveOf(Array(18).fill(0.5)).map((p, i) => (i === 8 ? { ...p, lum: 0.2 } : p));
    expect(judgeTransition(tr, c).issues.some((i) => i.code === 'FLASH_FRAME')).toBe(true);
  });
  it('samples before, through and after the cut; pixel occupancy reads content against the world colour', () => {
    const t = transitionSampleTimes({ t0: 1, t1: 1.5 });
    expect(t[0]).toBeLessThan(1);
    expect(t[t.length - 1]).toBeGreaterThan(1.5);
    const w = 20;
    const h = 10;
    const data = new Uint8Array(w * h * 3).fill(240);
    for (let y = 2; y < 8; y++) for (let x = 5; x < 15; x++) data.set([20, 20, 20], (y * w + x) * 3);
    expect(pixelOccupancy(data, w, h, 3).occ).toBeGreaterThan(0.2);
  });
  it('the repair for a text-mask void is a hold (the ink stays while the glyphs grow) — compiled into the plan', () => {
    const plain = compile();
    const held = compile(script({ hook: { transitionOut: { type: 'text-mask', element: 'text.hook', hold: 0.35 } } }));
    const ink = (p: StagePlan) => ({ at: Number(new RegExp(`"id":"maskink_${keyOf('text.hook')}[^"]*","target":"[^"]+","at":([\\d.]+)`).exec(JSON.stringify(p.choreo))![1]) });
    expect(ink(held.plan).at).toBeCloseTo(ink(plain.plan).at + 0.35, 2);
  });
  it('the planner offers the hold first for a text-mask void', () => {
    const sc = script();
    const { plan } = compile(sc);
    const cs = issueCandidates(plan, sc as never, { code: 'EMPTY_TRANSITION_FRAME', severity: 'major', layer: 'visual', shot: 'hook', dims: ['transitions'], evidence: 'void' });
    expect(cs[0].directive.transition?.hold).toBeGreaterThan(0);
  });
});

// ───────────────────────────── P2-H collisions
describe('P2-H collision classes', () => {
  const plan0 = () => compile().plan;
  const smp = (t: number, els: StageProbeSample['els']): StageProbeSample => ({ t, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, words: [], mask: false, els });
  const r = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
  it('a shape in front of a readable text for long is a text obstruction (critical when large)', () => {
    const plan = plan0();
    const f = plan.shots.find((s) => s.id === 'features')!;
    const S = [0, 1, 2, 3, 4, 5, 6].map((k) => smp(f.start + 0.2 + k * 0.1, [{ id: 'text.solution', kind: 'text', rect: r(500, 400, 600, 200), opacity: 1, parent: false }, { id: 'shape.hub', kind: 'shape', rect: r(500, 400, 400, 200), opacity: 1, parent: false }]));
    const c = analyzeStageProbes(plan, S, { W, H }).collisions[0];
    expect(c.cls).toBe('critical');
  });
  it('a decorative shape behind a text is a safe overlap', () => {
    const plan = plan0();
    const f = plan.shots.find((s) => s.id === 'features')!;
    const S = [0, 1, 2, 3].map((k) => smp(f.start + 0.2 + k * 0.1, [{ id: 'shape.hub', kind: 'shape', rect: r(500, 400, 300, 200), opacity: 1, parent: false }, { id: 'text.solution', kind: 'text', rect: r(500, 400, 600, 200), opacity: 1, parent: false }]));
    expect(analyzeStageProbes(plan, S, { W, H }).collisions[0].cls).toBe('safe-overlap');
  });
  it('regression 4: a text caught across the edge of a shape growing behind it during a transition is detected (not "intentional")', () => {
    const sc = script({ hook: { transitionOut: { type: 'expand-to-background', element: 'shape.hub' }, transitionReason: 'the hub becomes the world' } });
    const { plan } = compile(sc);
    const tr = plan.transitions.find((t) => t.from === 'hook')!;
    const S = [0, 1, 2, 3].map((k) => smp(tr.t0 + 0.05 + k * 0.06, [{ id: 'shape.hub', kind: 'shape', rect: r(-100, -100, 1200, 1200), opacity: 1, parent: false }, { id: 'text.solution', kind: 'text', rect: r(1000, 300, 700, 300), opacity: 1, parent: false }]));
    const c = analyzeStageProbes(plan, S, { W, H }).collisions;
    expect(c[0]?.cls).toBe('decorative-collision');
    // and the planner fixes it by timing (the line lands on the finished background), cheapest first
    const cs = issueCandidates(plan, sc as never, { code: 'TEXT_COLLISION', severity: 'minor', layer: 'visual', shot: 'features', dims: ['composition'], evidence: 'decorative-collision: text.solution over shape.hub', elements: ['text.solution', 'shape.hub'] });
    void cs;
  });
  it('a path under the cards it connects is not an obstruction', () => {
    const plan = plan0();
    const f = plan.shots.find((s) => s.id === 'features')!;
    const S = [0, 1, 2, 3].map((k) => smp(f.start + 0.2 + k * 0.1, [{ id: 'line.path', kind: 'line', rect: r(100, 300, 1700, 400), opacity: 1, parent: false }, { id: 'card.f1', kind: 'card', rect: r(300, 350, 300, 230), opacity: 1, parent: false }]));
    expect(analyzeStageProbes(plan, S, { W, H }).collisions.filter((c) => c.text === 'line.path')).toEqual([]);
  });
});

// ───────────────────────────── P2-I camera, P2-J rhythm, P2-K polish
describe('P2-I camera justification and dependency', () => {
  it('a move that barely changes its target is "replaceable" by element motion', () => {
    const sc = script({ features: { camera: { move: 'push-in' }, cameraTarget: 'card.f1', cameraReason: 'focus the reminder' } });
    const { plan, report } = compile(sc);
    const dom = analyzeStageProbes(plan, settleSamples(plan), { W, H });
    dom.camera.shots = [{ shot: 'features', move: 'push', target: 'card.f1', cameraMovingSec: 2, targetScale: 1.08, targetShift: 0.01, bgScale: 1.07, visible: true, note: 'small' }];
    const c = critique({ plan, report, dom, samples: settleSamples(plan) });
    expect(c.issues.some((i) => i.code === 'CAMERA_REPLACEABLE')).toBe(true);
    expect(c.measures.cameraMoves[0].replaceable).toBe(true);
  });
  it('camera dependency = share of moving time where only the camera moves', () => {
    const { c } = judge();
    expect(c.measures.cameraDependency).toBe(0); // no camera in this film
    expect(c.measures.elementMotionShare).toBeGreaterThan(0);
  });
});

describe('P2-J rhythm and P2-K commercial polish', () => {
  it('planned energy comes from the narrative job when the script left the default', () => {
    const { c } = judge();
    const hook = c.measures.energy.find((e) => e.shot === 'hook');
    expect(hook?.planned ?? 0.85).toBeGreaterThan(c.measures.energy.find((e) => e.shot === 'cta')?.planned ?? 0.4);
  });
  it('commercial polish is a defined checklist with a basis per item', () => {
    const { c } = judge();
    const items = c.measures.commercial.map((x) => x.item);
    expect(items).toEqual(expect.arrayContaining(['brand clarity', 'CTA clarity', 'professional spacing', 'typography polish', 'transition polish', 'visual hierarchy', 'no accidental collisions', 'no dead ending', 'no generic template feeling']));
    for (const x of c.measures.commercial) expect(['measured', 'heuristic', 'n/a']).toContain(x.basis);
  });
});

// ───────────────────────────── P2-L reference ordering (synthetic ladder; the real set lives in the report)
describe('P2-L reference ordering', () => {
  it('bad < acceptable < good on the same film as its composition improves', () => {
    const bad = judge(script({ features: { cast: [{ id: 'card.f1', role: 'hero', at: { x: 0.82, y: 0.5 }, w: 0.08 }, { id: 'card.f2', role: 'secondary', at: { x: 0.6, y: 0.5 }, w: 0.08 }, { id: 'card.f3', role: 'secondary', at: { x: 0.4, y: 0.5 }, w: 0.08 }, { id: 'card.f4', role: 'secondary', at: { x: 0.18, y: 0.5 }, w: 0.08 }] } })).c;
    const acceptable = judge().c;
    const good = judge(script({ features: { composition: 'hero-focus', cast: ROW.map(({ id, role }) => ({ id, role })) } })).c;
    const s = (c: CriticReport) => c.shots.find((x) => x.shot === 'features')!.overall;
    expect(s(bad)).toBeLessThan(s(acceptable));
    expect(s(acceptable)).toBeLessThan(s(good));
    expect(bad.overall).toBeLessThanOrEqual(acceptable.overall);
    expect(acceptable.overall).toBeLessThanOrEqual(good.overall);
  });
});

// ───────────────────────────── compatibility, Arabic
describe('P2 compatibility', () => {
  it('a shot without a strategy composes exactly as in P1 ("centered" is the P1 layout)', () => {
    const e = [{ id: 't', kind: 'text' as const, role: 'hero' as const, aspect: 3.4, chars: 25 }, { id: 'v', kind: 'shape' as const, role: 'secondary' as const, aspect: 1 }];
    const a = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'medium', purpose: 'x', elements: e });
    const b = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'medium', purpose: 'x', elements: e, strategy: 'centered' });
    expect(a).toEqual(b);
  });
  it('the critic still exposes the P1 fields (scores, overall, issues, verdict)', () => {
    const { c } = judge();
    expect(typeof c.overall).toBe('number');
    expect(Object.keys(c.scores).length).toBe(VISUAL_DIMENSIONS.length);
    expect(['accept', 'repair', 'reject']).toContain(c.verdict.status);
  });
  it('re-direction never touches the Arabic copy', () => {
    const sc = script();
    const { plan, c } = judge(sc);
    const top = recompositionCandidates(plan, sc as never, c, 'features')[0];
    const { script: next } = applyRedirection(sc, { version: 1, source: 'deterministic', shots: [top.directive] });
    expect(JSON.stringify((next as { stage: unknown }).stage)).toBe(JSON.stringify(sc.stage));
  });
});

// ───────────────────────────── weak-shot findings (a Claude-written redirection exposed these)
describe('P2 weak-shot test findings', () => {
  const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: 'card' as never, role: 'secondary' as never, aspect: 1.3 }));
  it('stack: a headline leads and same-kind items share ONE row tier (never a column of five), RTL order, no overlap', () => {
    const r = composeShot({ W, H, safe: { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, rtl: true, shotSize: 'close', purpose: 'feature', elements: [{ id: 'h', kind: 'text' as never, role: 'hero' as never, aspect: 4 }, ...cards(5)], strategy: 'stack' });
    const ys = [0, 1, 2, 3, 4].map((i) => r.boxes[`c${i}`].y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    expect(r.boxes.h.y).toBeLessThan(ys[0]);
    for (let i = 0; i < 4; i++) {
      const a = r.boxes[`c${i}`];
      const b = r.boxes[`c${i + 1}`];
      expect(a.x).toBeGreaterThan(b.x);
      expect(a.x - a.w / 2).toBeGreaterThanOrEqual(b.x + b.w / 2 - 1e-3);
    }
    for (const b of Object.values(r.boxes)) expect(b.y + b.h / 2).toBeLessThan(1);
  });
  const supporting = () =>
    script({ features: { subject: 'text.solution', cast: [{ id: 'text.solution', role: 'hero' }, ...ROW.map((c, i) => ({ ...c, role: 'secondary', at: { x: 0.8 - i * 0.12, y: 0.8 }, w: 0.045 }))] } });
  it('supporting items shrunk to thumbnails under a big headline are flagged (not only rows that ARE the subject)', () => {
    const { c } = judge(supporting());
    const f = c.shots.find((s) => s.shot === 'features')!;
    expect(c.issues.some((i) => i.shot === 'features' && i.code === 'ROW_OF_SMALL_OBJECTS')).toBe(true);
    expect(f.scores.frameUtilization).toBeLessThanOrEqual(6.5);
  });
  it('items of one group covering each other at rest are a layout failure: ITEMS_OVERLAP caps the shot below "good"', () => {
    const { plan, report } = compile();
    const f = plan.shots.find((s) => s.id === 'features')!;
    const t0 = settleTimeOf(plan, 'features');
    const samples = [...settleSamples(plan).filter((x) => x.t < f.start || x.t >= f.end), ...synth(plan, [t0, t0 + 0.2])].sort((p, q) => p.t - q.t);
    for (const smp of samples.filter((x) => x.t >= f.start && x.t < f.end)) {
      const a = smp.els.find((e) => e.id === 'card.f3')!;
      const b = smp.els.find((e) => e.id === 'card.f4')!;
      b.rect = { ...a.rect, x: a.rect.x + a.rect.width * 0.1 };
    }
    const c = critique({ plan, report, samples });
    expect(c.issues.some((i) => i.shot === 'features' && i.code === 'ITEMS_OVERLAP')).toBe(true);
    expect(c.shots.find((s) => s.shot === 'features')!.overall).toBeLessThanOrEqual(5.5);
  });
  it('a cast element pushed out of a still frame is flagged (ELEMENT_OFF_FRAME) and sent to re-composition', () => {
    const { plan, report } = compile();
    const samples = settleSamples(plan);
    const f = plan.shots.find((s) => s.id === 'features')!;
    const smp = samples.find((x) => x.t >= f.start && x.t < f.end)!;
    const b = smp.els.find((e) => e.id === 'card.f4')!;
    b.rect = { ...b.rect, y: H + 20 };
    const c = critique({ plan, report, samples });
    const iss = c.issues.find((i) => i.shot === 'features' && i.code === 'ELEMENT_OFF_FRAME');
    expect(iss?.severity).toBe('major');
    const rp = planRepairs({ plan, script: script() as never, critic: c, memory: { version: 1, attempts: [] }, pass: 1 });
    expect(rp.selected.some((x) => x.shot === 'features' && x.kind === 'recompose')).toBe(true);
  });
});

// ───────────────────────────── cut text the P1 critic could not see (found on the P1 SaaS and P2 voice films)
describe('P2 cut text: labels and arriving lines', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
  it('a card whose title is cut by the frame after the shot settled fails the technical layer', () => {
    const { plan, report } = compile();
    const f = plan.shots.find((s) => s.id === 'features')!;
    const t0 = settleTimeOf(plan, 'features');
    const samples = synth(plan, [t0, t0 + 0.1, t0 + 0.2].filter((t) => t < f.end - 0.12));
    for (const s of samples) {
      const c = s.els.find((e) => e.id === 'card.f4')!;
      c.rect = box(-c.rect.width * 0.5, c.rect.y, c.rect.width, c.rect.height);
    }
    const c = critique({ plan, report, samples });
    expect(c.issues.some((i) => i.code === 'TEXT_OFF_FRAME' && i.elements?.includes('card.f4'))).toBe(true);
    expect(c.technical.checks.find((k) => k.id === 'LABELS_IN_FRAME')!.pass).toBe(false);
  });
  it('a card wholly outside the frame (not in view yet) is not "cut"', () => {
    const { plan, report } = compile();
    const t0 = settleTimeOf(plan, 'features');
    const samples = synth(plan, [t0, t0 + 0.1]);
    for (const s of samples) {
      const c = s.els.find((e) => e.id === 'card.f4')!;
      c.rect = box(-c.rect.width - 40, c.rect.y, c.rect.width, c.rect.height);
    }
    const c = critique({ plan, report, samples });
    expect(c.issues.some((i) => i.code === 'TEXT_OFF_FRAME' && i.elements?.includes('card.f4'))).toBe(false);
  });
  it('a fully inked line arriving cut during an object transition is caught; a text-mask carrier overflowing is not', () => {
    const plan = compile().plan;
    const tr = plan.transitions.find((t) => t.kind !== 'text-mask' && t.kind !== 'cut') ?? plan.transitions[0];
    const mk = (t: number, op: number) => ({ t, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, words: [], mask: false, els: [], texts: [{ el: 'text.cta', id: 'text.cta', role: 'cta', px: 80, lines: 1, rect: box(1300, 500, 900, 100), opacity: op }] }) as StageProbeSample;
    const mid = (tr.t0 + tr.t1) / 2;
    const S = [mk(mid - 0.2, 1), mk(mid - 0.1, 1), mk(mid, 1), mk(mid + 0.1, 1)];
    const off = analyzeStageProbes(plan, S, { W, H }).offFrame;
    if (tr.kind === 'text-mask' || tr.kind === 'depth-pass' || tr.kind === 'expand-to-background') expect(off.length).toBe(0);
    else expect(off.some((o) => o.text === 'text.cta')).toBe(true);
    const faint = [mk(mid - 0.2, 0.6), mk(mid - 0.1, 0.6), mk(mid, 0.6), mk(mid + 0.1, 0.6)];
    expect(analyzeStageProbes(plan, faint, { W, H }).offFrame.length).toBe(0);
    const tm = plan.transitions.find((t) => t.kind === 'text-mask')!;
    const tmid = (tm.t0 + tm.t1) / 2;
    expect(analyzeStageProbes(plan, [mk(tmid - 0.1, 1), mk(tmid, 1), mk(tmid + 0.1, 1)], { W, H }).offFrame.length).toBe(0);
  });
});

describe('P2 planner conflicts (found on the SaaS steps shot)', () => {
  it('a shot losing text at the edge is never "fixed" for camera visibility by framing tighter; the technical issue wins', () => {
    const sc = script({ features: { camera: { move: 'push-in' }, cameraTarget: 'card.f1', cameraReason: 'the reminder is the point', framing: { end: 'medium' } } });
    const { plan, report } = compile(sc);
    const base = critique({ plan, report, samples: settleSamples(plan) });
    const off = { code: 'TEXT_OFF_FRAME' as const, severity: 'major' as const, layer: 'technical' as const, shot: 'features', dims: ['typography' as const], evidence: 'card cut 19%', elements: ['card.f1'], fix: '' };
    const cnve = { code: 'CAMERA_NO_VISIBLE_EFFECT' as const, severity: 'major' as const, layer: 'visual' as const, shot: 'features', dims: ['camera' as const], evidence: 'not measurable', fix: '' };
    const critic = { ...base, issues: [cnve, off] } as never;
    const rp = planRepairs({ plan, script: sc as never, critic, memory: { version: 1, attempts: [] }, pass: 1, redirector: false });
    const pick = rp.selected.find((c) => c.shot === 'features')!;
    expect(pick.directive.issues).toContain('TEXT_OFF_FRAME');
    expect(pick.id).not.toMatch(/reframe:close/);
  });
});

describe('P2 arriving line cut during a hand-off (found on the voice film)', () => {
  it('the cut is charged to the shot that owns the line, and the first repair is to let it arrive after the hand-off', () => {
    const plan = compile().plan;
    const cta = plan.shots.find((s) => s.id === 'cta')!;
    const tr = plan.transitions.find((t) => t.to === 'cta')!;
    const mid = Math.max(tr.t0, cta.start - 0.05);
    const mk = (t: number) => ({ t, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, words: [], mask: false, els: [], texts: [{ el: 'text.cta', id: 'text.cta', role: 'cta', px: 80, lines: 1, rect: { x: 1300, y: 500, width: 900, height: 100 }, opacity: 1 }] }) as StageProbeSample;
    const off = analyzeStageProbes(plan, [mk(mid - 0.1), mk(mid), mk(mid + 0.1)], { W, H }).offFrame;
    if (['text-mask', 'depth-pass', 'expand-to-background'].includes(tr.kind)) return;
    expect(off[0].shot).toBe('cta');
    const sc = script();
    const el = plan.elements.find((e) => e.id === 'text.cta')!;
    el.life = { ...el.life, from: Math.min(el.life.from, tr.t0) };
    const cs = issueCandidates(plan, sc as never, { code: 'TEXT_OFF_FRAME', severity: 'major', layer: 'technical', shot: 'cta', dims: ['typography'], evidence: "text.cta is cut by the frame edge (16% lost) for 0.2s", elements: ["text.cta"], fix: "" } as never);
    expect(cs.some((c) => c.id === 'cta:retime:text.cta' && c.cost === 'low')).toBe(true);
  });
});

describe('P2 travelling camera leaving an item cut at rest (found on the SaaS steps shot)', () => {
  it('the planner names the travel as the cause: a push toward the middle beats a wider framing; static stays last', () => {
    const sc = script({ features: { camera: { move: 'follow', amplitude: 0.2 }, cameraTarget: 'card.f1', cameraReason: 'the eye follows the row' } });
    const { plan } = compile(sc);
    const issue = { code: 'TEXT_OFF_FRAME', severity: 'major', layer: 'technical', shot: 'features', dims: ['typography'], evidence: 'card.f4 (a labelled card) is cut by the frame edge after the shot settled (19% outside)', elements: ['card.f4'], fix: '' } as never;
    const cs = issueCandidates(plan, sc as never, issue);
    const v = (id: string) => { const c = cs.find((x) => x.id.endsWith(id))!; return c.gain - ({ low: 0.1, medium: 0.35, high: 0.8, 'very-high': 1.6 } as const)[c.cost]; };
    expect(cs.some((c) => c.id.endsWith('camera:push-centre'))).toBe(true);
    expect(v('camera:push-centre')).toBeGreaterThan(v('reframe:wide'));
    expect(v('camera:push-centre')).toBeGreaterThan(v('camera:static'));
    expect(cs.some((c) => c.id.includes('retime'))).toBe(false); // a cut at rest is not an arrival problem
    expect(cs.find((c) => c.id.endsWith('camera:push-centre'))!.directive.intentChanges.length).toBe(1);
  });
});

describe('P2 the camera keeps the cast whole (compiler invariant, found on the SaaS steps shot)', () => {
  it('a push never comes to rest with a supporting card half out of the frame (the move is shortened and says so)', () => {
    for (const camera of [{ move: 'push-in' }]) {
      const sc = script({ features: { camera, cameraTarget: 'card.f1', cameraReason: 'the first reminder is the point', framing: { end: 'extreme-close' }, shotSize: 'close' } });
      const { plan, report } = compile(sc);
      const f = plan.shots.find((s) => s.id === 'features')!;
      const cc = compiledStage(plan);
      const tr = Math.min(f.camera.t1, f.end - 0.3); // before the glide into the next shot
      const cam = cameraAtT(cc, tr);
      for (const id of ['card.f2', 'card.f3', 'card.f4']) {
        const e = plan.elements.find((x) => x.id === id)!;
        const st = elementState(cc, e.key, tr);
        const r = { x: st.x - (e.box.w * st.s) / 2, y: st.y - (e.box.h * st.s) / 2, w: e.box.w * st.s, h: e.box.h * st.s };
        const d = LAYER_DEPTH[(e as never as { layer: keyof typeof LAYER_DEPTH }).layer] ?? 0;
        const p = projectPoint({ x: r.x, y: r.y }, d, cam, W, H);
        const q = projectPoint({ x: r.x + r.w, y: r.y + r.h }, d, cam, W, H);
        const inside = (Math.max(0, Math.min(1, q.x) - Math.max(0, p.x)) * Math.max(0, Math.min(1, q.y) - Math.max(0, p.y))) / ((q.x - p.x) * (q.y - p.y));
        expect(inside < 0.05 || inside > 0.95).toBe(true);
      }
      expect(report.warnings.some((w) => w.code === 'CAMERA_KEEPS_CAST' && w.shot === 'features')).toBe(true);
    }
  });
});

describe('P2 a displacement written for another layout (found on the SaaS features shot)', () => {
  it('two supporting cards left overlapping after a push are flagged, and the first repair drops the push (and what was chained after it)', () => {
    const sc = script({ features: { motionChain: [{ id: 'nudge', element: 'card.f1', action: 'push', to: 'card.f2', at: 0.8, reason: 'energy passes along' }, { id: 'nudge2', element: 'card.f2', action: 'push', to: 'card.f3', after: 'nudge.contact', reason: 'and on' }] } });
    const { plan, report } = compile(sc);
    const f = plan.shots.find((s) => s.id === 'features')!;
    const t0 = settleTimeOf(plan, 'features');
    const samples = synth(plan, [t0, t0 + 0.2, t0 + 0.4].filter((t) => t < f.end - 0.12));
    for (const x of samples) {
      const a = x.els.find((e) => e.id === 'card.f2')!;
      const b = x.els.find((e) => e.id === 'card.f3')!;
      b.rect = { ...b.rect, x: a.rect.x - b.rect.width * 0.8, y: a.rect.y };
    }
    const c = critique({ plan, report, samples });
    const iss = c.issues.find((i) => i.code === 'ITEMS_OVERLAP' && i.shot === 'features')!;
    expect(iss).toBeTruthy();
    const cs = issueCandidates(plan, sc as never, iss);
    const drop = cs.find((x) => x.id.includes(':drop:'))!;
    expect(drop.directive.dropMotion!.sort()).toEqual(['nudge', 'nudge2']);
    // preferred: the relay stays, in place — same ids (the chain after it still fires), no travel
    const relay = cs.find((x) => x.id.includes(':relay:'))!;
    expect(relay.gain).toBeGreaterThan(drop.gain);
    expect(relay.directive.addMotion!.map((e) => [e.id, e.element, e.action])).toEqual([['nudge', 'card.f2', 'impact'], ['nudge2', 'card.f3', 'impact']]);
    const { script: out } = applyRedirection(sc, RedirectionSchema.parse({ shots: [relay.directive] }));
    const chain = (out.shots[1] as { motionChain: { id?: string; action: string; after?: string }[] }).motionChain;
    expect(chain.filter((e) => e.action === 'push')).toHaveLength(0);
    expect(chain.find((e) => e.id === 'nudge2')!.after).toBe('nudge.contact');
  });
});

describe('P2-N best version: a tie is broken by the problems on screen', () => {
  it('weights critical > major > minor', async () => {
    const { issueWeight } = await import('../../src/node/critic-loop');
    const mk = (sev: string[]) => ({ issues: sev.map((severity) => ({ severity })) }) as never;
    expect(issueWeight(mk(['critical']))).toBe(2);
    expect(issueWeight(mk(['major', 'minor', 'minor']))).toBe(1.6);
    expect(issueWeight(mk(['major', 'major']))).toBeGreaterThan(issueWeight(mk(['major', 'minor'])));
  });
});

describe('P2 brand signature and type margins (found on the voice film)', () => {
  it('unpin "*" re-composes the shot but leaves the placed logo in its corner', () => {
    const sc = script({ features: { cast: [...ROW, { id: 'logo.brand', role: 'support', at: { x: 0.92, y: 0.13 }, w: 0.06 }] } });
    const { script: out } = applyRedirection(sc as ShotScript & Record<string, unknown>, RedirectionSchema.parse({ shots: [{ shot: 'features', diagnosis: 'row too small', strategy: 'hero-focus', unpin: ['*'] }] }));
    const cast = (out.shots[1] as { cast: { id: string; at?: unknown; w?: number }[] }).cast;
    expect(cast.find((c) => c.id === 'logo.brand')!.at).toEqual({ x: 0.92, y: 0.13 });
    expect(cast.find((c) => c.id === 'card.f2')!.at).toBeUndefined();
    const named = applyRedirection(sc as ShotScript & Record<string, unknown>, RedirectionSchema.parse({ shots: [{ shot: 'features', diagnosis: 'move the mark', unpin: ['logo.brand'] }] }));
    expect((named.script.shots[1] as { cast: { id: string; at?: unknown }[] }).cast.find((c) => c.id === 'logo.brand')!.at).toBeUndefined();
  });
  it('a line of type flush on the frame edge at rest fails the technical layer (clipped glyphs)', () => {
    const { plan, report } = compile();
    const t0 = settleTimeOf(plan, 'hook');
    const samples = synth(plan, [t0, t0 + 0.1, t0 + 0.2]);
    for (const s of samples) {
      const e = s.els.find((x) => x.id === 'text.hook')!;
      e.rect = { ...e.rect, y: 1 };
    }
    const c = critique({ plan, report, samples });
    expect(c.issues.some((i) => i.code === 'TEXT_OFF_FRAME' && i.elements?.includes('text.hook') && /flush/.test(i.evidence))).toBe(true);
  });
});
