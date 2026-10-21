/**
 * P4.5 (Dynamic Shot Re-Design & Motion-Aware Composition): motion envelopes, reserved motion space, the
 * spatial diagnosis (12 codes), hero dominance through time, the attention corridor, the layout solver
 * (strategies, RTL, 16:9 / 9:16 / 1:1), content preservation, the geometry stage, the Shot Re-Design Gate,
 * re-layout memory, the two-stage preview filter and the fall-back to the P4 version.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileStage, type StageCompileInput } from '../../src/stage/compiler';
import type { StagePlan } from '../../src/stage/plan';
import type { ScriptObj } from '../../src/film/transition-redirector';
import { measurePreview, type PreviewFrame } from '../../src/art/judge';
import {
  SPATIAL_CODES, LAYOUT_STRATEGIES, motionEnvelopes, reservedMotionSpace, spatialDiagnosis, heroDominanceTimeline, attentionCorridor,
  motionCompositionFit, actionNeeds, rankStrategies, strategyFit, layoutCandidates, contentPreserved, geometryCheck, geometryFrames,
  redesignGate, layoutMemoryExclude, rememberLayout, motionFamily, aspectOf, relayoutEligible, motionValueOf, planLayout, _test, type RedesignEvidence, type LayoutMemoryEntry,
} from '../../src/art/shot-redesigner';
import { resultOf, resultEventCandidates } from '../../src/art/result-event';
import { redesignOn, redesignProblem, type RedesignLog } from '../../src/node/shot-redesign';

const ELS = [
  { id: 'text.hook', kind: 'text', role: 'headline', text: 'حجوزات ضائعة بين الواتساب والدفتر' },
  { id: 'text.sub', kind: 'text', role: 'body', text: 'كل يوم موعد يضيع' },
  { id: 'shape.hub', kind: 'shape', shape: 'circle', color: 'primary', size: { w: 0.14, aspect: 1 } },
  { id: 'shape.dot', kind: 'shape', shape: 'circle', color: 'accent', size: { w: 0.05, aspect: 1 } },
  { id: 'shape.dot2', kind: 'shape', shape: 'circle', color: 'accent', size: { w: 0.05, aspect: 1 } },
  { id: 'card.f1', kind: 'card', title: 'تذكير تلقائي', icon: 'Bell' },
  { id: 'card.f2', kind: 'card', title: 'دفع مسبق', icon: 'CreditCard' },
  { id: 'card.f3', kind: 'card', title: 'تقارير', icon: 'ChartColumn' },
  { id: 'card.result', kind: 'card', title: 'ساعة توفّرها أسبوعيًا' },
  { id: 'number.hours', kind: 'number', value: 20, parent: 'card.result' },
  { id: 'logo.brand', kind: 'image', asset: 'logo' },
  { id: 'text.cta', kind: 'text', role: 'cta', text: 'جرّب مجانًا' },
  { id: 'button.cta', kind: 'button', text: 'ابدأ الآن' },
  { id: 'chip.a', kind: 'chip', text: 'واتساب', icon: 'MessageCircle', size: { w: 0.17 } },
  { id: 'chip.b', kind: 'chip', text: 'الدفتر', icon: 'BookOpen', size: { w: 0.17 } },
];
type S = Record<string, unknown>;
const shot = (id: string, over: S = {}): S => ({ id, purpose: 'feature', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', transitionOut: 'cut', transitionReason: 'a clean cut', ...over });
/** Test E: hero + headline + supporting text + 2 chips, the headline deliberately in the collision path. */
const BLOCKED_HOOK = (over: S = {}): S =>
  shot('hook', {
    purpose: 'hook',
    subject: 'shape.hub',
    cast: [
      { id: 'shape.hub', role: 'hero', at: { x: 0.82, y: 0.5 } },
      { id: 'text.hook', role: 'secondary', at: { x: 0.5, y: 0.5 } },
      { id: 'text.sub', role: 'support', at: { x: 0.5, y: 0.7 } },
      { id: 'chip.a', role: 'support', at: { x: 0.14, y: 0.5 } },
      { id: 'chip.b', role: 'support', at: { x: 0.14, y: 0.3 } },
    ],
    motionChain: [
      { id: 'open', element: 'text.hook', action: 'enter', at: 0.05, reason: 'the problem' },
      { id: 'in', element: 'chip.a', action: 'enter', after: 'open.peak', reason: 'a tool' },
      { id: 'hit', element: 'chip.a', action: 'attract', to: 'shape.hub', after: 'in.end', dur: 0.5, reason: 'flies into the hub' },
    ],
    ...over,
  });
const FEATURES_ROW = shot('features', {
  subject: 'card.f1',
  cast: [
    { id: 'card.f1', role: 'hero', at: { x: 0.78, y: 0.5 }, w: 0.2 },
    { id: 'card.f2', role: 'secondary', at: { x: 0.5, y: 0.5 }, w: 0.2 },
    { id: 'card.f3', role: 'secondary', at: { x: 0.22, y: 0.5 }, w: 0.2 },
  ],
  motionChain: [{ id: 'hit', element: 'card.f1', action: 'impact', at: 1.2, amount: 0.1, reason: 'the main feature lands' }],
});
const RESULT = shot('result', {
  purpose: 'solution',
  subject: 'card.result',
  cast: [{ id: 'card.result', role: 'hero', at: { x: 0.5, y: 0.5 } }, { id: 'number.hours', role: 'secondary' }],
  motionChain: [{ id: 'count', element: 'number.hours', action: 'count', at: 0.6, dur: 1.1, reason: 'the value' }],
});
const CTA = shot('cta', { purpose: 'cta', subject: 'text.cta', timing: { duration: 2.6 }, cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'logo.brand', role: 'support' }], transitionOut: undefined, transitionReason: undefined, hold: { intentional: true, reason: 'read', maxSec: 1.6 } });

function script(shots: S[]): ShotScript & ScriptObj {
  const v = validateShotScript({ version: 1, stage: { elements: ELS }, shots });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.script as never;
}
const input = (sc: ShotScript, W: number, H: number): StageCompileInput => {
  let t = 0;
  const timing = sc.shots.map((s) => {
    const d = s.timing.duration ?? 3;
    const r = { id: s.id, start: t, duration: d, transition: null, beat: s.purpose };
    t += d;
    return r;
  });
  return { script: sc, timing, voice: null, W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, assets: { logo: { kind: 'logo', aspect: 1 } }, cta: { text: 'جرّب مجانًا', button: 'ابدأ الآن' }, direction: null as never };
};
const compileAt = (W: number, H: number) => (raw: ScriptObj): StagePlan => {
  const v = validateShotScript(raw);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return compileStage(input(v.script, W, H)).plan;
};
const c169 = compileAt(1920, 1080);
const c916 = compileAt(1080, 1920);
const c11 = compileAt(1080, 1080);

describe('P4.5 motion envelope + reserved motion space', () => {
  const sc = script([BLOCKED_HOOK(), CTA]);
  const plan = c169(sc);
  it('measures start / path / settle bounds and phases for every moving element', () => {
    const envs = motionEnvelopes(plan, 0);
    const a = envs.find((e) => e.element === 'chip.a')!;
    expect(a).toBeTruthy();
    expect(a.moving).toBeTruthy();
    expect(a.swept.length).toBeGreaterThan(2);
    expect(a.travel).toBeGreaterThan(0.2);
    for (const k of ['startBounds', 'pathBounds', 'settleBounds', 'motionEnvelope'] as const) expect((a as unknown as Record<string, unknown>)[k]).toBeTruthy();
  });
  it('reserves a gather path and an impact zone for a mover flying into its target', () => {
    const res = reservedMotionSpace(sc, plan, 0);
    expect(res.some((r) => r.kind === 'gather-path' && r.element === 'chip.a' && r.target === 'shape.hub')).toBe(true);
    expect(res.some((r) => r.kind === 'impact-zone')).toBe(true);
  });
});

describe('P4.5 spatial diagnosis', () => {
  it('Test E: text in the collision path → TEXT_BLOCKS_ACTION (a spatial failure, not a motion one)', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const d = spatialDiagnosis(sc, c169(sc), 0);
    expect(d.codes).toContain('TEXT_BLOCKS_ACTION');
    expect(d.spatial).toBe(true);
    expect(d.motionFailure).toBe(false);
  });
  it('a measured TEXT_CLASH veto is read spatially (mover × blocker)', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const d = spatialDiagnosis(sc, c169(sc), 0, { failure: { veto: 'TEXT_CLASH (chip.a × text.hook)' } });
    expect(d.conflicts.some((c) => c.mover === 'chip.a' && c.blocker === 'text.hook')).toBe(true);
  });
  it('3 equal cards → SUPPORTING_ELEMENTS_DOMINATE', () => {
    const sc = script([FEATURES_ROW, CTA]);
    expect(spatialDiagnosis(sc, c169(sc), 0).codes).toContain('SUPPORTING_ELEMENTS_DOMINATE');
  });
  it('a candidate that lost on its own numbers, with no conflict, is a motion failure (Test F)', () => {
    const sc = script([shot('calm', { purpose: 'hook', subject: 'text.hook', cast: [{ id: 'text.hook', role: 'hero', at: { x: 0.5, y: 0.5 } }] }), CTA]);
    const d = spatialDiagnosis(sc, c169(sc), 0, { failure: { scoreGap: -0.6 } });
    expect(d.spatial).toBe(false);
    expect(d.motionFailure).toBe(true);
    expect(relayoutEligible({ motionValue: 5.4, keptValue: 6, veto: null, midMotion: [], diagnosis: d }).eligible).toBe(false);
  });
  it('declares the 12 spatial codes', () => {
    expect(SPATIAL_CODES).toHaveLength(12);
    for (const c of ['MOTION_PATH_BLOCKED', 'ATTENTION_BREAK', 'RTL_FLOW_CONFLICT', 'LOGO_IN_ACTION_PATH', 'CTA_NO_TRANSFORM_SPACE']) expect(SPATIAL_CODES).toContain(c);
  });
});

const fr = (t: number, els: { id: string; kind: string; x: number; y: number; w: number; h: number; o?: number }[]): PreviewFrame => ({
  t,
  occ: 0.2,
  diff: 0.01,
  texts: els.filter((e) => e.kind === 'text').map((e) => ({ el: e.id, id: e.id, px: 40, rect: { x: e.x, y: e.y, width: e.w, height: e.h }, opacity: e.o ?? 1 })),
  els: els.map((e) => ({ id: e.id, kind: e.kind, rect: { x: e.x, y: e.y, width: e.w, height: e.h }, opacity: e.o ?? 1 })),
});

describe('P4.5 hero dominance timeline + attention corridor', () => {
  it('measures the hero share by phase; a hero that grows dominates at impact and settle', () => {
    const frames = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.9, 1.2].map((t) => {
      const k = Math.min(1, t / 0.5);
      return fr(t, [
        { id: 'hero', kind: 'card', x: 800 - 200 * k, y: 400 - 100 * k, w: 300 + 400 * k, h: 200 + 200 * k },
        { id: 'peer', kind: 'card', x: 100, y: 100, w: 250, h: 180 },
      ]);
    });
    const d = heroDominanceTimeline(frames, 'hero', 1920, 1080);
    expect(d.settle.share).toBeGreaterThan(0.6);
    expect(d.settle.share).toBeGreaterThan(d.anticipation.share || 0);
    expect(d.min).toBeLessThanOrEqual(d.mean);
  });
  it('an eye that is sent away from the next read raises ATTENTION_BREAK', () => {
    // the mover runs right-to-left, the next read sits far right
    const frames = [0, 0.1, 0.2, 0.3, 0.4].map((t) => ({ ...fr(t, [{ id: 'm', kind: 'chip', x: 1500 - 3000 * t, y: 500, w: 200, h: 60 }, { id: 'txt', kind: 'text', x: 1500, y: 200, w: 300, h: 80 }]), diff: 0.01 + t * 0.05 }));
    const a = attentionCorridor(frames, 1920, 1080, { next: { x: 0.92, y: 0.2, who: 'txt' } });
    expect(a.breaks.length).toBeGreaterThan(0);
    expect(a.score).toBeLessThan(10);
  });
  it('a calm corridor has no break', () => {
    const frames = [0, 0.1, 0.2].map((t) => fr(t, [{ id: 'txt', kind: 'text', x: 800, y: 500, w: 300, h: 80 }]));
    expect(attentionCorridor(frames, 1920, 1080).breaks).toHaveLength(0);
  });
});

describe('P4.5 layout candidates (strategies, RTL, aspect)', () => {
  it('names 15 strategies, each with a reason tied to the motion', () => {
    expect(LAYOUT_STRATEGIES).toHaveLength(15);
    const sc = script([BLOCKED_HOOK(), CTA]);
    const n = actionNeeds(sc, c169(sc), 0);
    const ranked = rankStrategies(n);
    expect(ranked.length).toBeGreaterThan(1);
    for (const r of ranked) expect(r.why.length).toBeGreaterThan(10);
    expect(strategyFit(ranked[0].strategy, n)).toBeTruthy();
  });
  it('Test E: 2–3 re-layouts clear the path, keep every element and the text size (16:9)', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const plan = c169(sc);
    const lcs = layoutCandidates(sc, plan, 0, { max: 3 });
    expect(lcs.length).toBeGreaterThanOrEqual(1);
    expect(lcs.length).toBeLessThanOrEqual(3);
    let passed = 0;
    for (const c of lcs) {
      expect(contentPreserved(sc, c.script).ok).toBe(true);
      const g = geometryCheck(c.script, c169(c.script), 0, { plan });
      expect(g.minTextScale).toBeGreaterThanOrEqual(0.92);
      if (g.pass && !g.diagnosis.codes.includes('TEXT_BLOCKS_ACTION')) passed++;
    }
    expect(passed).toBeGreaterThanOrEqual(1);
  });
  it('RTL: the copy keeps the reading-start (right) side in a side-by-side layout', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const lc = layoutCandidates(sc, c169(sc), 0, { max: 3 }).find((c) => /text-right|hero-left/.test(c.strategy));
    if (!lc) return;
    const t = (lc.script.shots[0].cast as { id: string; at?: { x: number } }[]).find((c) => c.id === 'text.hook')!;
    expect(t.at!.x).toBeGreaterThan(0.5);
  });
  it('9:16 is mobile-first: stacked bands, not side columns', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const n = actionNeeds(sc, c916(sc), 0);
    expect(n.vertical).toBe(true);
    const ranked = rankStrategies(n).map((r) => r.strategy);
    expect(ranked.slice(0, 2).some((s) => /top-copy|bottom-copy|progressive|focus-stage|impact|corridor|center/.test(s))).toBe(true);
    expect(ranked.slice(0, 2)).not.toContain('hero-left/text-right');
  });
  it('1:1 and 16:9 produce candidates that pass geometry for the features row', () => {
    for (const comp of [c169, c11]) {
      const sc = script([FEATURES_ROW, CTA]);
      const plan = comp(sc);
      const lcs = layoutCandidates(sc, plan, 0, { max: 3 });
      expect(lcs.length).toBeGreaterThanOrEqual(1);
      const ok = lcs.filter((c) => geometryCheck(c.script, comp(c.script), 0, { plan }).pass);
      expect(ok.length).toBeGreaterThanOrEqual(1);
    }
  });
  it('Test C: hero + supporting — the hero card grows, the two others become a smaller supporting group, nothing removed', () => {
    const sc = script([FEATURES_ROW, CTA]);
    const plan = c169(sc);
    const lc = layoutCandidates(sc, plan, 0, { max: 3 })[0];
    const cast = lc.script.shots[0].cast as { id: string; w?: number }[];
    const w = (id: string) => cast.find((c) => c.id === id)!.w ?? 0.2;
    expect(w('card.f1')).toBeGreaterThan(w('card.f2') * 1.4);
    expect(contentPreserved(sc, lc.script).ok).toBe(true);
    const after = geometryCheck(lc.script, c169(lc.script), 0, { plan });
    const before = geometryCheck(sc, plan, 0, { plan });
    expect(after.dominance.settle.share).toBeGreaterThan(before.dominance.settle.share);
    expect(after.diagnosis.codes).not.toContain('SUPPORTING_ELEMENTS_DOMINATE');
  });
});

describe('P4.5 content preservation', () => {
  it('a candidate that drops an element, a word or a number is refused', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const dropped = JSON.parse(JSON.stringify(sc)) as ScriptObj;
    (dropped.shots[0] as { cast: unknown[] }).cast.pop();
    expect(contentPreserved(sc, dropped).ok).toBe(false);
    const reworded = JSON.parse(JSON.stringify(sc)) as ScriptObj;
    (reworded.stage!.elements as { id: string; text?: string }[]).find((e) => e.id === 'text.hook')!.text = 'حجوزات';
    expect(contentPreserved(sc, reworded).ok).toBe(false);
  });
});

describe('P4.5 motion composition fit', () => {
  it('is 0..10 and lower when the path is blocked', () => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const plan = c169(sc);
    const bad = geometryCheck(sc, plan, 0, { plan });
    const lc = layoutCandidates(sc, plan, 0, { max: 3 })[0];
    const good = geometryCheck(lc.script, c169(lc.script), 0, { plan });
    expect(bad.fit.score).toBeGreaterThanOrEqual(0);
    expect(good.fit.score).toBeLessThanOrEqual(10);
    expect(good.fit.score).toBeGreaterThan(bad.fit.score);
    expect(Object.keys(bad.fit.parts).length).toBeGreaterThanOrEqual(8);
    expect(typeof motionCompositionFit).toBe('function');
  });
});

const dom = (s: number) => ({ anticipation: { t: null, share: s, ratio: 1, area: 0.1 }, movement: { t: 0.5, share: s, ratio: 1, area: 0.1 }, impact: { t: 0.8, share: s, ratio: 1, area: 0.1 }, settle: { t: 1.5, share: s, ratio: 1, area: 0.1 }, min: s, mean: s }) as never;
const ev = (o: Partial<RedesignEvidence> = {}): RedesignEvidence => ({ veto: null, score: 7, fit: 8, dominance: dom(0.5), minTextPx: 40, midMotion: 0, clash: 0, presenceOk: true, ...o });

describe('P4.5 Shot Re-Design Gate (10 checks)', () => {
  it('accepts a rescue that beats the kept version by the margin everywhere', () => {
    const g = redesignGate(ev({ score: 7.6, fit: 8.6, dominance: dom(0.6) }), ev());
    expect(g.checks).toHaveLength(10);
    expect(g.accept).toBe(true);
    expect(g.code).toBe('REDESIGN_ACCEPTED');
  });
  it('Test G: P4 is better → NO_REDESIGN_IMPROVEMENT', () => {
    const g = redesignGate(ev({ score: 7.1, fit: 8.1 }), ev());
    expect(g.accept).toBe(false);
    expect(g.code).toBe('NO_REDESIGN_IMPROVEMENT');
  });
  it('refuses smaller text, lost information, a harmed boundary, a dirtier path', () => {
    const better = { score: 8, fit: 9, dominance: dom(0.7) };
    expect(redesignGate(ev(better), ev(), { minTextScale: 0.85 }).accept).toBe(false);
    expect(redesignGate(ev(better), ev(), { preserved: { ok: false, lost: ['chip.a'] } }).accept).toBe(false);
    expect(redesignGate(ev({ ...better, boundary: 5 }), ev({ boundary: 7 })).accept).toBe(false);
    expect(redesignGate(ev({ ...better, midMotion: 2 }), ev()).accept).toBe(false);
    expect(redesignGate(ev({ ...better, veto: 'EMPTY_FRAME' }), ev()).accept).toBe(false);
  });
  it('composition mode: same motion, better hierarchy and fit, no motion loss', () => {
    expect(redesignGate(ev({ score: 6.95, fit: 8.5, dominance: dom(0.6) }), ev(), { mode: 'composition' }).accept).toBe(true);
    expect(redesignGate(ev({ score: 6.95, fit: 8.5, dominance: dom(0.5) }), ev(), { mode: 'composition' }).accept).toBe(false);
    // Test C: the supporting cards stop covering the hero (occlusion gone) — a composition gain without a share change
    expect(redesignGate(ev({ score: 7.2, fit: 9, dominance: dom(0.5), clash: 0 }), ev({ clash: 0.12 }), { mode: 'composition' }).accept).toBe(true);
  });
});

describe('P4.5 re-layout memory', () => {
  const e = (o: Partial<LayoutMemoryEntry> = {}): LayoutMemoryEntry => ({ motionCandidate: 'hook-collision', layoutCandidate: 'bottom-copy/upper-action', spatialFailure: ['TEXT_BLOCKS_ACTION'], successfulLayout: false, brand: 'tech', shotType: 'problem', aspectRatio: '16:9', why: 'x', ...o });
  it('skips a strategy that failed for the same motion family, shot type, aspect and reason', () => {
    const mem = [e()];
    expect(layoutMemoryExclude(mem, { motionCandidate: 'hook-collision', shotType: 'problem', aspectRatio: '16:9', spatialFailure: ['TEXT_BLOCKS_ACTION'] }).has('bottom-copy/upper-action')).toBe(true);
    expect(layoutMemoryExclude(mem, { motionCandidate: 'hook-collision', shotType: 'problem', aspectRatio: '9:16', spatialFailure: ['TEXT_BLOCKS_ACTION'] }).size).toBe(0);
    expect(layoutMemoryExclude([e({ successfulLayout: true })], { motionCandidate: 'hook-collision', shotType: 'problem', aspectRatio: '16:9', spatialFailure: ['TEXT_BLOCKS_ACTION'] }).size).toBe(0);
  });
  it('keeps one entry per (family, strategy, shot type, aspect, brand) and names families, not ids', () => {
    const m = rememberLayout(rememberLayout([], e()), e({ successfulLayout: true }));
    expect(m).toHaveLength(1);
    expect(m[0].successfulLayout).toBe(true);
    expect(motionFamily('hook-collision')).toBe('collision');
    expect(aspectOf(1080, 1920)).toBe('9:16');
    expect(aspectOf(1080, 1080)).toBe('1:1');
  });
});

describe('P4.5 result as a visual event (Voice "20")', () => {
  it('finds the number and its card and builds gather / expand / rise candidates that never invent a value', () => {
    const sc = script([BLOCKED_HOOK(), RESULT, CTA]);
    expect(resultOf(sc, 1)).toMatchObject({ number: 'number.hours', carrier: 'card.result' });
    const cs = resultEventCandidates(sc, 1);
    expect(cs.map((c) => c.label)).toEqual(expect.arrayContaining(['expand-into-result', 'rise-to-result']));
    for (const c of cs) {
      expect((c.script.stage!.elements as { id: string; value?: number }[]).find((d) => d.id === 'number.hours')!.value).toBe(20);
      expect(() => c169(c.script)).not.toThrow();
    }
    expect(resultEventCandidates(script([BLOCKED_HOOK(), CTA]), 0)).toHaveLength(0);
  });
});

const measure = (pf: PreviewFrame[]) => measurePreview(pf, 1920, 1080);

describe('P4.5 two-stage filter + fall-back (redesignProblem with an injected preview)', () => {
  const env = process.env.NITAAQ_NO_SHOT_REDESIGN;
  afterEach(() => {
    if (env === undefined) delete process.env.NITAAQ_NO_SHOT_REDESIGN;
    else process.env.NITAAQ_NO_SHOT_REDESIGN = env;
  });
  it('NITAAQ_NO_SHOT_REDESIGN=1 turns P4.5 off (the P4 path)', () => {
    process.env.NITAAQ_NO_SHOT_REDESIGN = '1';
    expect(redesignOn()).toBe(false);
    delete process.env.NITAAQ_NO_SHOT_REDESIGN;
    expect(redesignOn()).toBe(true);
  });
  const setup = (previewScore: number) => {
    const sc = script([BLOCKED_HOOK(), CTA]);
    const plan = c169(sc);
    const pf = geometryFrames(plan, 0);
    const log: RedesignLog = { version: 1, problems: [], memory: [], totals: { motionSources: 0, eligible: 0, layoutCandidates: 0, geometryPassed: 0, previewed: 0, accepted: 0, rescued: 0, geometryMs: 0, previewMs: 0, previewFrames: 0, cacheHits: 0 } };
    let calls = 0;
    const preview = (async (_s: unknown, _d: unknown, pl: StagePlan) => {
      calls++;
      const f = geometryFrames(pl, 0);
      return { measure: measure(f), frames: 10, rendered: 10, cached: 0, ms: 5, pf: f };
    }) as never;
    const failed = { id: 'hook-collision', label: 'collision', why: 'x', script: sc, film: null, plan, predicted: { score: 6.2, veto: 'TEXT_CLASH (chip.a × text.hook)', parts: { energy: 2.5, clash: -2 }, notes: [] }, preview: null, rec: {} as never };
    const x = {
      spec: {} as never,
      projectDir: '/tmp',
      problem: { id: 'hook', kind: 'hook', shots: ['hook'], range: [0, 3] as [number, number], code: 'WEAK_HOOK_EXECUTION', why: 'x' } as never,
      rec: { candidates: [] } as never,
      live: [failed] as never,
      winner: null,
      base: { measure: measure(pf), pf },
      baseScore: previewScore,
      basePredicted: 6,
      cur: sc,
      curPlan: plan,
      curFilm: null,
      compile: (s: ScriptObj) => c169(s),
      src: undefined as never,
      memory: {},
      trOf: () => undefined,
      handoverOf: () => undefined,
      stepOf: 0.1,
      log,
      preview,
      budget: { previews: 2 },
    };
    return { x, log, calls: () => calls };
  };
  it('previews at most 2 geometry survivors and logs every layout with its reason', async () => {
    const { x, log, calls } = setup(6);
    const r = await redesignProblem(x as never).catch((e) => ({ error: e }));
    expect('error' in r ? String((r as { error: unknown }).error) : '').toBe('');
    expect(calls()).toBeLessThanOrEqual(2);
    expect(log.problems[0].sources.some((s) => s.candidate === 'hook-collision' && s.eligible)).toBe(true);
    expect(log.problems[0].layouts.length).toBeGreaterThanOrEqual(1);
    for (const l of log.problems[0].layouts) expect(l.why.length).toBeGreaterThan(0);
  });
  it('Test G: when the preview does not beat P4 the P4 version stays (NO_REDESIGN_IMPROVEMENT)', async () => {
    const { x, log } = setup(9.9);
    const r = await redesignProblem(x as never);
    expect(r.winner).toBeNull();
    expect(log.problems[0].outcome).not.toBe('REDESIGN_ACCEPTED');
  });
  it('Test F / good shots: a candidate that lost on its own motion (no veto, no clash) is not re-laid out, nothing is rendered', async () => {
    const { x, log, calls } = setup(7);
    (x.live as { predicted: unknown }[])[0].predicted = { score: 6.1, veto: null, parts: { energy: 0.1 }, notes: [] };
    const r = await redesignProblem(x as never);
    expect(r.winner).toBeNull();
    expect(calls()).toBe(0);
    expect(log.problems[0].outcome).toBe('NOT_ELIGIBLE');
  });
  it('motionValueOf ignores the spatial penalties', () => {
    expect(motionValueOf({ energy: 1.5, clash: -2, midMotion: -1 }, 4.5)).toBe(7.5);
  });
});
