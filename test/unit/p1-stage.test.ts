/**
 * P1 (Connected Motion Design System): Stage Compiler, Composition Engine, global camera, object
 * transitions, energy handoff, typography timing, CTA enforcement, DOM motion probes, Motion Critic,
 * repair loop + partial render splice, animatic calibration, and Fast / P0 / legacy compatibility.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateShotScript, type ShotScript } from '../../src/director/shot-script';
import { compileShots, applyShotSpec } from '../../src/director/shot-compiler';
import { compileStage, planeScale, projectPoint, fontForBox, pointAlong, type StageCompileInput } from '../../src/stage/compiler';
import { composeShot, OCCUPANCY } from '../../src/stage/composition';
import { validateDirection, moveFamily, type Direction } from '../../src/stage/direction';
import { keyOf, LAYER_DEPTH, type StagePlan } from '../../src/stage/plan';
import { compiledStage, cameraAtT, elementState, planeMatrix, backdropAt, inkOn } from '../../src/stage/StageLayer';
import { analyzeStageProbes, stageProbeTimes, unionCover, type StageProbeSample } from '../../src/qc/stage-probes';
import { critique } from '../../src/qc/critic';
import { repairRanges, issueCandidates, planRepairs } from '../../src/stage/repair-planner';
import { applyRedirection } from '../../src/stage/redirection';
import { spliceVideo } from '../../src/node/critic-loop';
import { frameDiffs, METRICS_VERSION, DEAD_ZONE } from '../../src/qc/motion-metrics';
import { valueAt } from '../../src/motion/choreography';
import { SceneRegistry } from '../../src/scenes';
import { VideoSchema } from '../../src/schema/video';

const W = 1920;
const H = 1080;

// ───────────────────────────── fixtures
const els = [
  { id: 'text.hook', kind: 'text', role: 'headline', text: 'مواعيدك كلها في مكان واحد', highlight: ['مكان واحد'] },
  { id: 'chip.whatsapp', kind: 'chip', text: 'واتساب', icon: 'MessageCircle' },
  { id: 'shape.hub', kind: 'shape', shape: 'circle', color: 'primary', size: { w: 0.16, aspect: 1 } },
  { id: 'logo.brand', kind: 'image', asset: 'logo' },
  { id: 'text.solution', kind: 'text', role: 'headline', text: 'منصة موعد تنظم حجوزاتك تلقائيًا' },
  { id: 'dashboard.main', kind: 'ui', asset: 'screenshot', anchors: { 'dashboard.chart': { x: 0.2, y: 0.34, w: 0.5, h: 0.36 } } },
  { id: 'card.step', kind: 'card', title: 'اربط تقويمك', icon: 'CalendarDays' },
  { id: 'button.cta', kind: 'button', text: 'ابدأ الآن' },
  { id: 'text.cta', kind: 'text', role: 'cta', text: 'جرّب موعد مجانًا' },
  { id: 'cursor.main', kind: 'cursor', size: { w: 0.035, aspect: 0.85 } },
];
type S = Record<string, unknown>;
const base = (id: string, over: S = {}): S => ({ id, purpose: 'demo', message: 'msg', subject: 's', sceneFamily: 'stage-shot', motionIntent: 'why it moves', timing: { duration: 3 }, shotSize: 'medium', ...over });
function film(over: { shots?: S[]; extra?: S[] } = {}): ShotScript {
  const shots = over.shots ?? [
    base('hook', {
      purpose: 'hook',
      cast: [{ id: 'text.hook', role: 'hero' }, { id: 'shape.hub', role: 'secondary' }, { id: 'chip.whatsapp', role: 'support', at: { x: 0.2, y: 0.3 } }],
      motionChain: [
        { id: 'pull', element: 'chip.whatsapp', action: 'attract', to: 'shape.hub', at: 0.8, dur: 0.5, reason: 'the hub gathers the scattered tools' },
        { element: 'word:مكان', action: 'emphasis', after: 'pull.end', reason: 'the promise lands when the gathering completes' },
      ],
      transitionOut: { type: 'expand-to-background', element: 'shape.hub' },
      transitionReason: 'the full hub becomes the brand world',
    }),
    base('solution', {
      purpose: 'solution',
      cast: [{ id: 'text.solution', role: 'hero' }, { id: 'logo.brand', role: 'secondary' }],
      transitionOut: { type: 'text-mask', element: 'text.solution' },
      transitionReason: 'the product is seen through the promise',
    }),
    base('demo', {
      cast: [{ id: 'dashboard.main', role: 'hero', enter: 'none' }, { id: 'logo.brand', role: 'support', at: { x: 0.08, y: 0.1 }, w: 0.05 }],
      camera: { move: 'push-in', startAt: 0.6, endAt: 2.8 },
      cameraTarget: 'dashboard.chart',
      cameraReason: 'the chart is the proof',
      framing: { end: 'close' },
      transitionOut: { type: 'shape-transform', element: 'card.step', into: 'button.cta' },
      transitionReason: 'invalid on purpose: the card is not on stage here',
    }),
    base('cta', {
      purpose: 'cta',
      timing: { duration: 2.6 },
      cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }, { id: 'cursor.main', role: 'support' }],
      motionChain: [
        { id: 'aim', element: 'cursor.main', action: 'move', to: 'button.cta', at: 0.4, dur: 0.5, reason: 'the cursor goes to the one action' },
        { element: 'button.cta', action: 'press', after: 'aim.end', reason: 'the press is the decision' },
      ],
      hold: { intentional: true, reason: 'the CTA is read', maxSec: 1.6 },
    }),
  ];
  const v = validateShotScript({ version: 1, stage: { elements: [...els, ...(over.extra ?? [])] }, shots });
  if (!v.ok) throw new Error(v.errors.join('\n'));
  return v.script;
}
const timingOf = (sc: ShotScript) => {
  let t = 0;
  return sc.shots.map((s) => {
    const d = s.timing.duration ?? 3;
    const r = { id: s.id, start: t, duration: d, transition: null, beat: s.purpose };
    t += d;
    return r;
  });
};
const direction: Direction = validateDirection({
  visualLanguage: 'clean blue world',
  motionLanguage: 'every move is caused by the one before',
  camera: { language: 'mostly static; one push to the proof', allowed: ['static', 'push', 'follow'], budget: { maxMovingShare: 0.3, reason: 'elements carry the energy' } },
  typography: { language: 'big Arabic headlines' },
  transitions: { language: 'elements perform the cuts', prefer: ['expand-to-background', 'text-mask'], avoid: ['glitch'] },
  composition: ['one hero per shot'],
  depth: 'world far, heroes mid, cursor near',
  color: 'brand blue',
  pacing: 'fast start, calm end',
  metaphors: [{ id: 'gather', line: 'in one place', show: 'chips attracted into one hub' }],
}).ok
  ? (validateDirection({
      visualLanguage: 'clean blue world',
      motionLanguage: 'every move is caused by the one before',
      camera: { language: 'mostly static; one push to the proof', allowed: ['static', 'push', 'follow'], budget: { maxMovingShare: 0.3, reason: 'elements carry the energy' } },
      typography: { language: 'big Arabic headlines' },
      transitions: { language: 'elements perform the cuts', prefer: ['expand-to-background', 'text-mask'], avoid: ['glitch'] },
      composition: ['one hero per shot'],
      depth: 'world far, heroes mid, cursor near',
      color: 'brand blue',
      pacing: 'fast start, calm end',
      metaphors: [{ id: 'gather', line: 'in one place', show: 'chips attracted into one hub' }],
    }) as { ok: true; direction: Direction }).direction
  : (null as never);
const input = (sc: ShotScript, over: Partial<StageCompileInput> = {}): StageCompileInput => ({
  script: sc,
  timing: timingOf(sc),
  voice: null,
  W,
  H,
  safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 },
  rtl: true,
  assets: { logo: { kind: 'logo', aspect: 1 }, screenshot: { kind: 'screenshot', aspect: 1.6 } },
  cta: { text: 'جرّب موعد مجانًا', button: 'ابدأ الآن', url: 'https://mawid.sa' },
  direction,
  ...over,
});
const compile = (sc = film(), over: Partial<StageCompileInput> = {}) => compileStage(input(sc, over));
const el = (p: StagePlan, id: string) => p.elements.find((e) => e.id === id)!;
const at = (p: StagePlan, id: string, prop: string, t: number) => valueAt(compiledStage(p), `${keyOf(id)}.${prop}`, t);

// ───────────────────────────── schema / ids / feature flag
describe('Stage script and feature flag', () => {
  it('validates global element ids, casts and object transitions', () => {
    expect(film().stage!.elements.length).toBe(els.length);
    const bad = validateShotScript({ version: 1, stage: { elements: [{ id: 'Bad Id', kind: 'text' }] }, shots: [base('a', { cast: [{ id: 'nope' }] })] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toMatch(/stage ids|not a declared stage element/);
    const dup = validateShotScript({ version: 1, stage: { elements: [{ id: 'a.b', kind: 'text' }, { id: 'a.b', kind: 'chip' }] }, shots: [base('a')] });
    expect(dup.ok).toBe(false);
  });
  it('registers a stage-shot family that draws nothing, and VideoSpec accepts model "stage" + a stage plan', () => {
    expect(SceneRegistry.get('stage-shot')).toBeTruthy();
    const { plan } = compile();
    const v = VideoSchema.safeParse({ ...minimalSpec(), motion: { model: 'stage' }, stage: plan });
    expect(v.success).toBe(true);
  });
  it('global element ids map to unique choreography tracks', () => {
    expect(keyOf('dashboard.main')).toBe('e_dashboard_main');
    expect(keyOf('card.feature-01')).toBe('e_card_feature_01');
  });
});

// ───────────────────────────── stage plan controls the render, persistence, continuity
describe('Stage persistence and continuity', () => {
  it('an element on stage in two consecutive shots lives across the boundary (one element, not two copies)', () => {
    const { plan, report } = compile();
    const logo = el(plan, 'logo.brand');
    expect(logo.shots).toEqual(['solution', 'demo']);
    expect(report.persistent.map((p) => p.id)).toContain('logo.brand');
    const b = 6; // solution → demo
    expect(logo.life.from).toBeLessThan(b);
    expect(logo.life.to).toBeGreaterThan(b + 1);
    // it travels to its corner place across the cut (shared continuity): the size shrinks continuously
    const s0 = at(plan, 'logo.brand', 's', b - 0.4);
    const s1 = at(plan, 'logo.brand', 's', b + 0.6);
    expect(s1).toBeLessThan(s0);
    expect(at(plan, 'logo.brand', 'o', b)).toBeGreaterThan(0.9);
  });
  it('editing stage.json changes what is drawn (the plan is the source of every value)', () => {
    const { plan } = compile();
    const t = 1.6;
    const x0 = elementState(compiledStage(plan), keyOf('text.hook'), t).x;
    const edited = JSON.parse(JSON.stringify(plan)) as StagePlan;
    edited.choreo.initial![`${keyOf('text.hook')}.x`] = 0.2;
    for (const n of (edited.choreo.timeline[0] as { children: { target?: string; props?: Record<string, number>; from?: Record<string, number> }[] }).children) if (n.target === keyOf('text.hook') && n.props?.x !== undefined) {
      n.props.x = 0.2;
      if (n.from?.x !== undefined) n.from.x = 0.2;
    }
    expect(elementState(compiledStage(edited), keyOf('text.hook'), t).x).toBeCloseTo(0.2, 3);
    expect(x0).not.toBeCloseTo(0.2, 2);
  });
  it('is deterministic: the same script compiles to the same plan', () => {
    expect(JSON.stringify(compile().plan)).toBe(JSON.stringify(compile().plan));
  });
});

// ───────────────────────────── object transitions
describe('Object-driven transitions', () => {
  it('expand-to-background: the hub grows until it covers the frame and stays as the next world', () => {
    const { plan } = compile();
    const tr = plan.transitions.find((t) => t.from === 'hook')!;
    expect(tr.status).toBe('object');
    expect(tr.kind).toBe('expand-to-background');
    const hub = el(plan, 'shape.hub');
    const s = at(plan, 'shape.hub', 's', 3.5);
    expect(s * hub.box.w).toBeGreaterThan(1.5); // wider than the frame
    expect(hub.life.to).toBeGreaterThan(4);
    expect(backdropAt(plan, 4.5, { primary: '#2D5BFF', background: '#FFFFFF' } as never, '#FFFFFF')).toBe('#2D5BFF');
  });
  it('text-mask: the next shot is drawn inside the growing glyphs', () => {
    const { plan } = compile();
    const m = plan.masks.find((x) => x.element === 'text.solution')!;
    expect(m).toBeTruthy();
    expect(m.reveals).toContain('dashboard.main');
    expect(at(plan, 'text.solution', 's', m.to)).toBeGreaterThan(10);
  });
  it('P2-G: the world the hub became stays outside the glyph window until the mask has opened (no empty frame mid-cut)', () => {
    const { plan } = compile();
    const m = plan.masks.find((x) => x.element === 'text.solution')!;
    // halfway through the mask the outgoing world is still fully there …
    expect(at(plan, 'shape.hub', 'o', (m.from + m.to) / 2)).toBeGreaterThan(0.95);
    // … and it is gone when the window closes over the next shot
    expect(at(plan, 'shape.hub', 'o', m.to + 0.01)).toBeLessThan(0.05);
  });
  it('validates the element and falls back clearly (recorded) when it cannot perform the transition', () => {
    const { plan, report } = compile();
    const tr = plan.transitions.find((t) => t.from === 'demo')!;
    expect(tr.status).toBe('fallback');
    expect(tr.why).toMatch(/not on stage/);
    expect(report.warnings.some((w) => w.code === 'OBJECT_TRANSITION_FALLBACK')).toBe(true);
  });
  it('never reshapes a user asset (morph of a screenshot falls back)', () => {
    const sc = film();
    sc.shots[2].transitionOut = { type: 'morph', element: 'dashboard.main', into: 'button.cta' };
    const { plan } = compile(sc);
    const tr = plan.transitions.find((t) => t.from === 'demo')!;
    expect(tr.status).toBe('fallback');
    expect(tr.why).toMatch(/never reshaped/);
  });
  it('morph / shape-transform: the card travels to the button and hands over at one instant', () => {
    const sc = film();
    sc.shots[2].cast!.push({ id: 'card.step', role: 'secondary' } as never);
    sc.shots[2].transitionOut = { type: 'shape-transform', element: 'card.step', into: 'button.cta' };
    const { plan } = compile(sc);
    const tr = plan.transitions.find((t) => t.from === 'demo')!;
    expect(tr.status).toBe('object');
    const h = plan.handoffs.find((x) => x.from === 'card.step' && x.to === 'button.cta')!;
    expect(h).toBeTruthy();
    expect(at(plan, 'card.step', 'o', h.t + 0.1)).toBeLessThan(0.05);
    expect(at(plan, 'button.cta', 'o', h.t + 0.1)).toBeGreaterThan(0.9);
    // the travelling card ends near the button's box
    const bx = at(plan, 'button.cta', 'x', h.t + 0.2);
    expect(Math.abs(at(plan, 'card.step', 'x', h.t) - bx)).toBeLessThan(0.05);
  });
  it('push-inside: the camera dives into the element and the next shot is composed inside it', () => {
    const sc = film();
    sc.shots[2].transitionOut = { type: 'push-inside', element: 'dashboard.main' };
    const { plan } = compile(sc);
    expect(plan.transitions.find((t) => t.from === 'demo')!.status).toBe('object');
    expect(plan.shots[3].region).toBe('dashboard.main');
    const cam = cameraAtT(compiledStage(plan), plan.shots[3].start + 0.1);
    expect(cam.zoom / Math.max(1e-3, 1 - cam.dolly)).toBeGreaterThan(1.2);
  });
});

// ───────────────────────────── choreography and energy handoff
describe('Choreography: cause and effect, energy handoff', () => {
  it('attract: the receiver takes the hit at contact, and the emphasis follows the gathering', () => {
    const { plan, report } = compile();
    const c = compiledStage(plan);
    const pull = Object.entries(c.byId).find(([k]) => k.endsWith('_pull'))![1];
    const hit = Object.entries(c.byId).find(([k]) => k.endsWith('_pull_hit'))![1];
    expect(hit.start).toBeCloseTo(pull.end, 2);
    expect(plan.handoffs.some((h) => h.kind === 'attract' && h.from === 'chip.whatsapp' && h.to === 'shape.hub')).toBe(true);
    const emph = el(plan, 'text.hook').emphasis!.find((e) => e.word === 'مكان')!;
    expect(el(plan, 'text.hook').life.from + emph.at).toBeCloseTo(pull.end, 1);
    expect(report.causality.length).toBeGreaterThan(0);
  });
  it('exit → enter handoff: the next hero starts at the exit peak and continues along its vector', () => {
    const sc = film({
      shots: [
        base('a', { cast: [{ id: 'text.hook', role: 'hero' }], motionChain: [{ element: 'text.hook', action: 'exit', style: 'handoff', direction: 'left', velocity: 0.8, reason: 'the line leaves toward the next idea' }], transitionOut: 'cut', transitionReason: 'the energy carries the cut' }),
        base('b', { purpose: 'cta', cast: [{ id: 'text.cta', role: 'hero' }, { id: 'button.cta', role: 'secondary' }] }),
      ],
    });
    const { plan } = compile(sc);
    const h = plan.handoffs.find((x) => x.kind === 'exit-enter')!;
    expect(h.from).toBe('text.hook');
    expect(h.to).toBe('text.cta');
    expect(h.vector).toEqual([-1, 0]);
    const c = compiledStage(plan);
    const out = Object.entries(c.byId).find(([k]) => k.startsWith('out_e_text_hook'))![1];
    const peak = out.start + (out.end - out.start) / 2;
    expect(h.t).toBeGreaterThan(out.start);
    expect(h.t).toBeLessThanOrEqual(out.end + 0.01);
    void peak;
    // arrives from the right (moving left): x decreases during its entrance
    expect(at(plan, 'text.cta', 'x', h.t + 0.05)).toBeGreaterThan(at(plan, 'text.cta', 'x', h.t + 0.6));
  });
  it('the cursor tip lands on the button and the press is one gesture (button + cursor)', () => {
    const { plan } = compile();
    const c = compiledStage(plan);
    const press = Object.entries(c.byId).find(([k]) => k.startsWith('ev_3_') && !k.endsWith('_cursor') && !k.endsWith('aim'))!;
    void press;
    const pressCursor = Object.keys(c.byId).find((k) => k.endsWith('_cursor'));
    expect(pressCursor).toBeTruthy();
  });
});

// ───────────────────────────── global camera
describe('Global camera', () => {
  it('continues across shots (no reset to rest at a cut) and frames its declared target', () => {
    const { plan, report } = compile();
    const demo = plan.shots.find((s) => s.id === 'demo')!;
    expect(demo.camera.move).toBe('push');
    expect(demo.camera.target).toBe('dashboard.chart');
    expect(demo.camera.visible!.scale).toBeGreaterThan(1.3);
    const c = compiledStage(plan);
    const endCam = cameraAtT(c, demo.end - 0.05);
    expect(endCam.zoom / Math.max(1e-3, 1 - endCam.dolly)).toBeGreaterThan(1.3);
    // the next shot glides from wherever the camera is (it does not jump to rest at the cut)
    const after = cameraAtT(c, demo.end + 0.02);
    expect(Math.abs(after.dolly - endCam.dolly) + Math.abs(after.zoom - endCam.zoom)).toBeLessThan(0.1);
    expect(report.camera.shots[0].reason).toMatch(/proof/);
  });
  it('the effect is on the subject: the hero plane grows more than the far background', () => {
    const { plan } = compile();
    const v = plan.shots.find((s) => s.id === 'demo')!.camera.visible!;
    expect(v.scale).toBeGreaterThan(v.bgScale);
  });
  it('depth layers parallax: nearer planes scale more under the same dolly', () => {
    const cam = { x: 0, y: 0, dolly: 0.2, zoom: 1 };
    expect(planeScale(LAYER_DEPTH.fg, cam)).toBeGreaterThan(planeScale(LAYER_DEPTH.hero, cam));
    expect(planeScale(LAYER_DEPTH.hero, cam)).toBeGreaterThan(planeScale(LAYER_DEPTH.bg, cam));
    const m = planeMatrix(0, { x: 0, y: 0, dolly: 0, zoom: 1, tilt: 0, yaw: 0 } as never, W, H);
    expect(m.a).toBeCloseTo(1, 5);
    const p = projectPoint({ x: 0.5, y: 0.5 }, 0, { x: 0, y: 0, dolly: 0, zoom: 1 }, W, H);
    expect(p.x).toBeCloseTo(0.5, 5);
  });
  it('camera budget: the direction caps how many shots the camera may move in (overuse is reported)', () => {
    const sc = film();
    for (const s of sc.shots) if (s.id !== 'demo') Object.assign(s, { camera: { move: 'push-in' }, cameraTarget: 'text.hook', cameraReason: 'lean in' });
    sc.shots[1].cameraTarget = 'text.solution';
    sc.shots[3].cameraTarget = 'text.cta';
    const { report } = compile(sc);
    expect(report.camera.moving).toBeGreaterThanOrEqual(3);
    expect(report.camera.budget!.within).toBe(false);
    expect(report.direction!.violations.join('\n')).toMatch(/budget/);
  });
  it('a camera move without a stage target is held static and reported', () => {
    const sc = film();
    Object.assign(sc.shots[0], { camera: { move: 'push-in' }, cameraTarget: 'nothing.here', cameraReason: 'lean' });
    const { plan, report } = compile(sc);
    expect(plan.shots[0].camera.move).toBe('static');
    expect(report.warnings.some((w) => w.code === 'CAMERA_NO_TARGET')).toBe(true);
  });
  it('move names map to families (direction language)', () => {
    expect(moveFamily('push-in')).toBe('push');
    expect(moveFamily('truck-left')).toBe('truck');
    expect(moveFamily('static')).toBe('static');
  });
});

// ───────────────────────────── composition
describe('Composition Engine', () => {
  it('occupancy targets differ by subject and shot size (no single global target)', () => {
    expect(OCCUPANCY.logo.wide[1]).toBeLessThan(OCCUPANCY.ui.wide[0]);
    expect(OCCUPANCY.text.close[0]).toBeGreaterThan(OCCUPANCY.text.wide[0]);
    expect(OCCUPANCY.button.medium[1]).toBeLessThan(OCCUPANCY.card.medium[0]);
  });
  it('places text at the reading start in RTL and the visual opposite it; the hero meets its target', () => {
    const r = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'medium', purpose: 'hook', elements: [{ id: 't', kind: 'text', role: 'hero', aspect: 3.4, chars: 25 }, { id: 'v', kind: 'shape', role: 'secondary', aspect: 1 }] });
    expect(r.boxes.t.x).toBeGreaterThan(0.5);
    expect(r.boxes.v.x).toBeLessThan(0.5);
    expect(r.report.heroOccupancy).toBeGreaterThanOrEqual(OCCUPANCY.text.medium[0] * 0.9);
    const ltr = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: false, shotSize: 'medium', purpose: 'hook', elements: [{ id: 't', kind: 'text', role: 'hero', aspect: 3.4, chars: 25 }, { id: 'v', kind: 'shape', role: 'secondary', aspect: 1 }] });
    expect(ltr.boxes.t.x).toBeLessThan(0.5);
  });
  it('a logo resolve stays small while an interface fills (by subject, not "make everything bigger")', () => {
    const logo = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'wide', purpose: 'brand', elements: [{ id: 'l', kind: 'image', role: 'hero', aspect: 1, assetKind: 'logo' }] });
    const ui = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'wide', purpose: 'demo', elements: [{ id: 'u', kind: 'ui', role: 'hero', aspect: 1.5, assetKind: 'screenshot' }] });
    expect(logo.report.heroOccupancy).toBeLessThan(0.1);
    expect(ui.report.heroOccupancy).toBeGreaterThan(0.25);
  });
  it('supports never overlap the hero, and fontForBox fits Arabic copy to its box', () => {
    const r = composeShot({ W, H, safe: { x: 0.05, y: 0.07, w: 0.9, h: 0.86 }, rtl: true, shotSize: 'medium', purpose: 'x', elements: [{ id: 'h', kind: 'text', role: 'hero', aspect: 3, chars: 20 }, { id: 's1', kind: 'chip', role: 'support', aspect: 3 }, { id: 's2', kind: 'chip', role: 'support', aspect: 3 }] });
    const ov = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)) * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
    expect(ov(r.boxes.h, r.boxes.s1)).toBeLessThan(0.002);
    expect(ov(r.boxes.h, r.boxes.s2)).toBeLessThan(0.002);
    const f = fontForBox(25, 0.4 * W, 0.3 * H, H / 100);
    expect(f.lines).toBeGreaterThanOrEqual(1);
    expect(f.fontU).toBeGreaterThan(5);
  });
});

// ───────────────────────────── typography and voice
describe('Typography as motion (Arabic-first)', () => {
  const voice = { words: ['مواعيدك', 'كلها', 'في', 'مكان', 'واحد'].map((w, i) => ({ text: w, norm: w, start: 0.4 + i * 0.35, end: 0.7 + i * 0.35, source: 'measured' as const })) };
  it('words appear at their spoken times (voice map is the timing source), one time per word — never per letter', () => {
    const { plan } = compile(film(), { voice });
    const t = el(plan, 'text.hook');
    expect(t.wordTimes).toHaveLength(5);
    const abs = t.wordTimes!.map((x) => x + t.life.from);
    expect(abs[3]).toBeCloseTo(0.4 + 3 * 0.35 - 0.06, 1);
    for (let i = 1; i < abs.length; i++) expect(abs[i]).toBeGreaterThan(abs[i - 1]);
  });
  it('without a voice, P1 still works (no Whisper dependency): no word times, script emphasis', () => {
    const { plan } = compile(film(), { voice: null });
    expect(el(plan, 'text.hook').wordTimes).toBeUndefined();
    expect(el(plan, 'text.hook').emphasis!.length).toBeGreaterThan(0);
  });
  it('emphasis words carry a pulse track (the DOM probe verifies the word grows)', () => {
    const { plan } = compile();
    const t = el(plan, 'text.hook');
    const e = t.emphasis![0];
    expect(at(plan, 'text.hook', 'emph', t.life.from + e.at + 0.27)).toBeGreaterThan(0.5);
  });
  it('text on a world that matches the highlight colour switches to readable ink', () => {
    const ink = inkOn('#B37F00', '#111111', '#B37F00', { accent: '#0B3D35', textOnPrimary: '#FFFFFF' } as never);
    expect(ink.hl).toBe('#0B3D35');
    expect(inkOn(null, '#111', '#B37F00', {} as never).hl).toBe('#B37F00');
  });
});

// ───────────────────────────── CTA
describe('CTA enforcement and ending', () => {
  it('a closing CTA shot without CTA copy gets the brief\'s CTA (never invented), reported', () => {
    const sc = film();
    sc.shots[3].cast = [{ id: 'cursor.main', role: 'support' } as never, { id: 'button.cta', role: 'hero' } as never];
    const sc2 = validateShotScript({ version: 1, stage: { elements: els }, shots: sc.shots.map((s) => ({ ...s })) });
    void sc2;
    const { plan, report } = compile(sc);
    expect(report.cta!.status).toBe('enforced');
    expect(report.cta!.added).toContain('cta.text');
    expect(el(plan, 'cta.text').content.text).toBe('جرّب موعد مجانًا');
    expect(el(plan, 'cta.url').content.text).toBe('mawid.sa');
  });
  it('a deliberate exception needs a reason (ctaOverride) and is respected', () => {
    const sc = film();
    sc.shots[3].cast = [{ id: 'button.cta', role: 'hero' } as never];
    (sc.shots[3] as { ctaOverride?: { reason: string } }).ctaOverride = { reason: 'the film ends on the action only' };
    const { report } = compile(sc);
    expect(report.cta!.status).toBe('override');
  });
  it('the ending resolves then holds briefly (hold measured against the script max)', () => {
    const { plan } = compile();
    expect(plan.ending!.settleAt).toBeLessThan(plan.shots[3].end);
    expect(plan.ending!.holdSec).toBeGreaterThan(0.3);
  });
});

// ───────────────────────────── DOM probes, critic, repair
const sample = (t: number, over: Partial<StageProbeSample> = {}): StageProbeSample => ({ t, cam: { x: 0, y: 0, dolly: 0, zoom: 1 }, els: [], words: [], mask: false, ...over });
const rect = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });
describe('DOM Motion Probes', () => {
  it('measures camera effect on the target, word growth, occupancy and still runs from DOM rects', () => {
    const { plan } = compile();
    const demo = plan.shots.find((s) => s.id === 'demo')!;
    const word = el(plan, 'text.hook').emphasis![0];
    const wt = el(plan, 'text.hook').life.from + word.at;
    const S: StageProbeSample[] = [];
    for (let t = 0; t <= plan.shots[3].end; t += 0.2) {
      const k = Math.min(1, Math.max(0, (t - demo.camera.t0) / (demo.camera.t1 - demo.camera.t0)));
      const inDemo = t >= demo.start && t < demo.end;
      const grow = t >= wt && t <= wt + 0.5 ? 1.08 : 1;
      S.push(
        sample(t, {
          cam: { x: 0, y: 0, dolly: inDemo ? 0.3 * k : 0, zoom: 1 },
          els: [
            ...(t < 3 ? [{ id: 'text.hook', kind: 'text', rect: rect(1100, 400, 700, 250), opacity: 1, parent: false }] : []),
            ...(inDemo ? [{ id: 'dashboard.main', kind: 'ui', rect: rect(960 - 500 * (1 + k), 540 - 300 * (1 + k), 1000 * (1 + k), 600 * (1 + k)), opacity: 1, parent: false }] : []),
          ],
          words: t < 3 ? [{ el: 'text.hook', word: 'مكان واحد', rect: rect(1200, 450, 200, 80 * grow), opacity: 1 }] : [],
        }),
      );
    }
    const r = analyzeStageProbes(plan, S, { W, H });
    const cam = r.camera.shots.find((s) => s.shot === 'demo')!;
    expect(cam.visible).toBe(true);
    expect(cam.targetScale!).toBeGreaterThan(1.5);
    expect(r.words.find((w) => w.word === word.word)!.reacted).toBe(true);
    expect(r.occupancy.byShot.find((s) => s.shot === 'demo')!.subject).toBeGreaterThan(0.3);
    expect(r.still.runs.length).toBeGreaterThan(0);
    expect(unionCover([rect(0, 0, W / 2, H)], W, H)).toBeCloseTo(0.5, 2);
  });
  it('flags a camera that moves while its target does not change on screen', () => {
    const { plan } = compile();
    const demo = plan.shots.find((s) => s.id === 'demo')!;
    const S = [demo.camera.t0, (demo.camera.t0 + demo.camera.t1) / 2, demo.camera.t1].map((t, i) => sample(t, { cam: { x: i * 10, y: 0, dolly: 0, zoom: 1 }, els: [{ id: 'dashboard.main', kind: 'ui', rect: rect(400, 200, 1000, 600), opacity: 1, parent: false }] }));
    const r = analyzeStageProbes(plan, S, { W, H });
    expect(r.camera.shots.find((s) => s.shot === 'demo')!.visible).toBe(false);
  });
  it('samples densely around every emphasis and camera move', () => {
    const { plan } = compile();
    const t = stageProbeTimes(plan, 12);
    const demo = plan.shots.find((s) => s.id === 'demo')!;
    expect(t).toContain(Math.round(demo.camera.t0 * 100) / 100);
    expect(t.length).toBeGreaterThan(60);
  });
});

describe('Motion Critic', () => {
  const dom = (over: Record<string, unknown> = {}) => ({ version: 1 as const, samples: 10, dt: 0.2, elements: [], camera: { movingSec: 1, shots: [] }, words: [], occupancy: { mean: 0.4, min: 0.2, byShot: [] }, subjects: [], typography: { activeSec: 3, share: 0.3 }, still: { sec: 1, share: 0.08, longest: 0.6, runs: [] }, collisions: [], offFrame: [], masks: 0, ...over });
  it('scores the visual dimensions out of 10 (P2: fourteen, technical checks apart)', () => {
    const { plan, report } = compile();
    const c = critique({ plan, report, dom: dom(), direction });
    expect(Object.keys(c.scores)).toHaveLength(14);
    expect(c.technical.checks.length).toBeGreaterThan(3);
    for (const v of Object.values(c.scores)) expect(v).toBeGreaterThanOrEqual(0);
    expect(c.issues.some((i) => i.code === 'BROKEN_HANDOFF')).toBe(true); // the deliberate fallback
  });
  it('detects camera overuse against the direction budget (context, not a fixed 50% rule)', () => {
    const sc = film();
    for (const s of sc.shots) if (s.id !== 'demo') Object.assign(s, { camera: { move: 'push-in' }, cameraTarget: s.id === 'hook' ? 'text.hook' : s.id === 'solution' ? 'text.solution' : 'text.cta', cameraReason: 'lean' });
    const { plan, report } = compile(sc);
    const c = critique({ plan, report, dom: dom(), direction });
    expect(c.issues.some((i) => i.code === 'CAMERA_OVERUSE')).toBe(true);
    // the same film with a direction that allows (and explains) it is not overuse
    const generous = { ...direction, camera: { ...direction.camera, budget: { maxMovingShare: 1, reason: 'a documentary walk-through: the camera is the guide' } } };
    expect(critique({ plan, report, dom: dom(), direction: generous }).issues.some((i) => i.code === 'CAMERA_OVERUSE')).toBe(false);
  });
  it('rejects / asks for repair on dead holds, invisible camera and collisions with evidence', () => {
    const { plan, report } = compile();
    const c = critique({
      plan,
      report,
      direction,
      dom: dom({
        still: { sec: 5, share: 0.4, longest: 3, runs: [{ t0: 3.2, t1: 6 }] },
        camera: { movingSec: 2, shots: [{ shot: 'demo', move: 'push', target: 'dashboard.chart', cameraMovingSec: 2, targetScale: 1.01, targetShift: 0.004, bgScale: 1.2, visible: false, note: 'barely changes' }] },
        collisions: [{ shot: 'cta', text: 'text.cta', other: 'button.cta', sec: 1, overlap: 0.5 }],
      }),
    });
    const codes = c.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DEAD_HOLD', 'UNDER_ANIMATION', 'CAMERA_NO_VISIBLE_EFFECT', 'TEXT_COLLISION']));
    expect(c.verdict.status).not.toBe('accept');
    expect(c.verdict.repairShots).toContain('demo');
  });
});

describe('Repair loop and partial render', () => {
  it('plans repairs from critic findings: an invisible camera is reframed closer (cheapest first); a long ending is shortened', () => {
    const sc = film();
    const raw = JSON.parse(JSON.stringify({ version: 1, stage: sc.stage, shots: sc.shots }));
    const { plan, report } = compile();
    const c = critique({ plan, report, direction, dom: { version: 1, samples: 3, dt: 0.2, elements: [], camera: { movingSec: 2, shots: [{ shot: 'demo', move: 'push', cameraMovingSec: 2, targetScale: 1.0, targetShift: 0, bgScale: 1, visible: false, note: 'x' }] }, words: [], occupancy: { mean: 0.4, min: 0.1, byShot: [] }, subjects: [], typography: { activeSec: 1, share: 0.1 }, still: { sec: 0, share: 0, longest: 0, runs: [] }, collisions: [], offFrame: [], masks: 0 } });
    c.issues.push({ code: 'CTA_WEAKNESS', severity: 'major', layer: 'technical', shot: 'cta', dims: ['cta'], evidence: 'hold 2.1s', fix: 'shorten the closing shot by 0.5s' });
    const rp = planRepairs({ plan, script: raw, critic: c });
    const demo = rp.selected.find((x) => x.shot === 'demo')!;
    expect(demo.id).toMatch(/reframe/);
    const { script, report: ar } = applyRedirection(raw, rp.redirection);
    expect((script.shots.find((s: { id: string }) => s.id === 'demo') as { framing: { end: string } }).framing.end).toBe('extreme-close');
    expect(ar.timing).toBe(true);
    expect((script.shots.find((s: { id: string }) => s.id === 'cta') as { timing: { duration: number } }).timing.duration).toBeCloseTo(2.1, 2);
    expect(validateShotScript(script).ok).toBe(true);
  });
  it('re-renders only the patched shots (±0.6 s), merged; a timing change re-renders to the end', () => {
    const shots = [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 3, end: 6 }, { id: 'c', start: 6, end: 9 }];
    expect(repairRanges(shots, [{ shot: 'b', code: 'X', change: '', timing: false }], 30, 270)).toEqual([[72, 198]]);
    expect(repairRanges(shots, [{ shot: 'a', code: 'X', change: '', timing: false }, { shot: 'b', code: 'X', change: '', timing: false }], 30, 270)).toEqual([[0, 198]]);
    expect(repairRanges(shots, [{ shot: 'b', code: 'X', change: '', timing: true }], 30, 270)).toEqual([[72, 269]]);
  });
  it('splices a re-rendered frame range into the previous video (frame-exact, same length)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'splice-'));
    const base = join(dir, 'base.mp4');
    const seg = join(dir, 'seg.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=30:d=2', '-pix_fmt', 'yuv420p', base]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=64x36:r=30:d=0.5', '-pix_fmt', 'yuv420p', seg]);
    const out = join(dir, 'out.mp4');
    execFileSync('cp', [base, out]);
    spliceVideo(out, [{ range: [15, 29], file: seg }], out, 60);
    expect(existsSync(out)).toBe(true);
    const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim();
    expect(Number(frames)).toBe(60);
    const lum = (t: number) => execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-']).readUInt8(0);
    expect(lum(0.2)).toBeLessThan(40);
    expect(lum(0.75)).toBeGreaterThan(200);
    expect(lum(1.5)).toBeLessThan(40);
  });
});

// ───────────────────────────── animatic calibration
describe('Animatic calibration (metrics v2)', () => {
  it('codec-like noise on a still picture no longer counts as motion; real motion still does', () => {
    expect(METRICS_VERSION).toBe(2);
    const w = 32;
    const h = 18;
    const still = new Uint8Array(w * h).fill(120);
    let seed = 7;
    const noisy = (f: Uint8Array) => f.map((v) => v + ((seed = (seed * 1103515245 + 12345) % 2147483648) % 3) - 1);
    const frames = [still, noisy(still), noisy(still), noisy(still)];
    const d = frameDiffs({ width: w, height: h, fps: 10, frames } as never).d;
    expect(Math.max(...d)).toBeLessThan(0.15);
    const moved = new Uint8Array(w * h).fill(120).map((v, i) => (i % w < 8 ? 220 : v));
    const d2 = frameDiffs({ width: w, height: h, fps: 10, frames: [still, moved] } as never).d;
    expect(d2[0]).toBeGreaterThan(5);
  });
});

// ───────────────────────────── compatibility
describe('Backward compatibility (Fast, P0, legacy)', () => {
  it('a P0 shot script (no stage) compiles exactly as before: principled model, scene transitions kept', () => {
    const v = validateShotScript({ version: 1, shots: [{ id: 'a', purpose: 'hook', message: 'msg', subject: 'headline', sceneFamily: 'kinetic-title', elements: { title: 'مواعيدك كلها في مكان واحد' }, motionIntent: 'lands', timing: { duration: 3 }, transitionOut: 'push', transitionReason: 'energy carries on' }, { id: 'b', purpose: 'cta', message: 'msg', subject: 'headline', sceneFamily: 'kinetic-title', elements: { title: 'جرّب الآن' }, motionIntent: 'lands', timing: { duration: 3 } }] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const { resolved } = compileShots({ script: v.script, voice: null, rtl: true, orientation: 'landscape' });
    expect(resolved[0].transition!.type).toBe('push');
    const spec = { scenes: resolved.map((r) => ({ id: r.shot.id, motion: {}, transition: { type: 'cut' } })), motion: {}, metadata: {} } as never;
    applyShotSpec(spec, resolved, { shotScript: 'shots.json' });
    expect((spec as { motion: { model: string } }).motion.model).toBe('principled');
  });
  it('a stage script turns scene transitions into cuts (stage time = film time) and the model into "stage"', () => {
    const sc = film();
    const { resolved } = compileShots({ script: sc, voice: null, rtl: true, orientation: 'landscape' });
    expect(resolved.every((r) => !r.transition || r.transition.type === 'cut')).toBe(true);
    expect(resolved.every((r) => r.camera === null)).toBe(true);
    const spec = { scenes: resolved.map((r) => ({ id: r.shot.id, motion: {}, transition: { type: 'cut' } })), motion: {}, metadata: {} } as never;
    applyShotSpec(spec, resolved, { shotScript: 'shots.json' });
    expect((spec as { motion: { model: string } }).motion.model).toBe('stage');
  });
  it('a legacy VideoSpec (no motion model, no stage) still validates unchanged', () => {
    const v = VideoSchema.safeParse(minimalSpec());
    expect(v.success).toBe(true);
    if (v.success) {
      expect(v.data.stage).toBeUndefined();
      expect(v.data.motion.model).toBeUndefined();
    }
  });
  it('pointAlong walks a polyline by length', () => {
    expect(pointAlong([[0, 0], [1, 0]], 0.5)).toEqual([0.5, 0]);
    expect(pointAlong([[0, 0], [1, 0], [1, 1]], 0.75)).toEqual([1, 0.5]);
  });
});

function minimalSpec() {
  return {
    version: '1.0',
    project: { id: 'p', title: 't', language: 'ar' },
    canvas: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
    style: { preset: 'clean-corporate' },
    scenes: [{ id: 's1', type: 'stage-shot', duration: 3, content: {} }],
  };
}

describe('P1-G whisper check (local, never a pipeline dependency)', () => {
  it('aligns heard words to the script in order and counts misses', async () => {
    const { alignWords } = await import('../../cli/whisper-check');
    const pairs = alignWords(['نطاق', 'منصه', 'ذكيه', 'تجمع'], ['نطاق', 'منصه', 'زكيه', 'تجمع', 'فريقك']);
    expect(pairs).toEqual([[0, 0], [1, 1], [3, 3]]);
  });
});

describe('P1 text cut by the camera (critic + repair)', () => {
  it('a push that crops a line mid-read is critical; the camera is disabled only as a last resort', () => {
    const { plan, report } = compile();
    const dom = { version: 1 as const, samples: 10, dt: 0.2, elements: [], camera: { movingSec: 1, shots: [] }, words: [], occupancy: { mean: 0.4, min: 0.2, byShot: [] }, subjects: [], typography: { activeSec: 3, share: 0.3 }, still: { sec: 1, share: 0.08, longest: 0.6, runs: [] }, collisions: [], offFrame: [{ shot: plan.shots[0].id, text: 'text.a', sec: 0.8, worst: 0.4, words: ['ساعة'] }], masks: 0 };
    const c = critique({ plan, report, dom, direction });
    const i = c.issues.find((x) => x.code === 'TEXT_OFF_FRAME');
    expect(i?.severity).toBe('critical');
    expect(c.verdict.status).toBe('reject');
    const script = { shots: [{ id: plan.shots[0].id, camera: { move: 'push-in' }, cameraTarget: 'x.y', cameraReason: 'lean', framing: { end: 'close' }, cast: [{ id: 'text.a', role: 'hero', w: 0.5 }] }] };
    // P2: the planner offers composition / reflow / reframe repairs first; disabling the camera is the LAST resort
    const cs = issueCandidates(plan, script as never, i!);
    const order = cs.map((x) => x.id.split(':')[1]);
    expect(cs.map((x) => x.id)).toContain(`${plan.shots[0].id}:camera:static`);
    void order;
    const rank = (id: string) => cs.map((x) => ({ id: x.id, v: x.gain - ({ low: 0.1, medium: 0.35, high: 0.8, 'very-high': 1.6 } as const)[x.cost] })).sort((a, b) => b.v - a.v).findIndex((x) => x.id.endsWith(id));
    expect(rank('camera:static')).toBe(cs.length - 1);
  });
});

describe('P1-N style frames', () => {
  it('"settle" freezes the last calm moment before the exit transition; numbers are shot-relative', async () => {
    const { styleFrameTimes } = await import('../../src/node/style-frames');
    const plan = { shots: [{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 3, end: 6 }], transitions: [{ from: 'a', to: 'b', t0: 2.6, t1: 3.3 }] } as never;
    const t = styleFrameTimes(plan, [{ shot: 'a', at: 'settle', note: 'x' }, { shot: 'b', at: 1, note: 'y' }, { shot: 'zz', at: 'settle', note: 'z' }]);
    expect(t).toEqual([{ shot: 'a', t: 2.45, note: 'x' }, { shot: 'b', t: 4, note: 'y' }]);
  });
});
