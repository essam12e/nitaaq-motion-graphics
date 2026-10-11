import { describe, expect, it } from 'vitest';
import { springAt, springOvershoot, springSettleTime, springFromBounce, inertiaAt, momentumAt, dampingRatio } from '../../src/motion/spring';
import { cubicBezier, anticipate, RATE, steps, curve } from '../../src/motion/easing';
import { staggerDelay, trackAt, sequence, elementProgress, velocityOf } from '../../src/motion/orchestrate';
import { chooseMotion, intentFor, planSceneIntent, rolesOf } from '../../src/motion/intent';
import { project, projectRect, REST, perspectiveOf, clearance } from '../../src/camera/rig';
import { cameraAt, peakSpeed } from '../../src/camera/moves';
import { auditFraming, solveFraming } from '../../src/camera/framing';
import { parsePath, prepareMorph, morphAt, resample, signedArea, midSilhouetteOk, morphTravel } from '../../src/morph/path';
import { shapePath, iconPath, blobPath, circlePath } from '../../src/morph/shapes';
import { traceContours, silhouettePath } from '../../src/morph/trace';

describe('Motion Engine 2.0 — springs', () => {
  it('reaches its target and rests (under/critical/over-damped)', () => {
    for (const o of [{ stiffness: 170, damping: 12, mass: 1 }, { stiffness: 100, damping: 20, mass: 1 }, { stiffness: 100, damping: 40, mass: 1 }]) {
      expect(springAt(10, 0, 1, o).value).toBeCloseTo(1, 4);
      expect(springAt(10, 0, 1, o).done).toBe(true);
    }
  });
  it('is a pure function of time (deterministic seek)', () => {
    const o = { stiffness: 210, damping: 14, mass: 0.8 };
    const a = [0.1, 0.4, 0.2, 0.4, 0.1].map((t) => springAt(t, 0, 1, o).value);
    expect(a[1]).toBe(a[3]);
    expect(a[0]).toBe(a[4]);
  });
  it('bounce 0 = critically damped, no overshoot; bounce 0.4 overshoots', () => {
    const crit = springFromBounce(0, 0.5);
    expect(dampingRatio(crit)).toBeCloseTo(1, 5);
    expect(springOvershoot(crit)).toBeLessThan(1e-3);
    expect(springOvershoot(springFromBounce(0.4, 0.5))).toBeGreaterThan(0.05);
  });
  it('heavier mass settles later; initial velocity is honoured', () => {
    expect(springSettleTime({ stiffness: 120, damping: 14, mass: 2 })).toBeGreaterThan(springSettleTime({ stiffness: 120, damping: 14, mass: 0.6 }));
    const thrown = springAt(0.05, 0, 0, { stiffness: 120, damping: 20, mass: 1, velocity: 4 });
    expect(thrown.value).toBeGreaterThan(0.1);
  });
  it('inertia glides toward power×velocity and boundary springs catch it', () => {
    const free = inertiaAt(5, 0, { velocity: 100 });
    expect(free.value).toBeCloseTo(80, 0);
    const caught = inertiaAt(5, 0, { velocity: 100, max: 40 });
    expect(caught.value).toBeCloseTo(40, 0);
  });
  it('momentum: a retarget keeps the velocity it had (no velocity jump at the hand-off)', () => {
    const legs = [{ at: 0, to: 100, spring: { stiffness: 120, damping: 18 } }, { at: 0.3, to: 300, spring: { stiffness: 120, damping: 18 } }];
    const vBefore = velocityOf((t) => momentumAt(t, 0, legs).value, 0.299);
    const vAfter = velocityOf((t) => momentumAt(t, 0, legs).value, 0.301);
    expect(Math.abs(vAfter - vBefore) / Math.abs(vBefore)).toBeLessThan(0.15);
    expect(momentumAt(6, 0, legs).value).toBeCloseTo(300, 1);
  });
});

describe('Motion Engine 2.0 — easing and orchestration', () => {
  it('cubic Bézier matches its endpoints and CSS ease values', () => {
    const ease = cubicBezier(0.25, 0.1, 0.25, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
  });
  it('anticipate dips below zero first; steps and Manim rates behave', () => {
    const a = anticipate();
    expect(Math.min(...[0.05, 0.1, 0.2, 0.3].map(a))).toBeLessThan(0);
    expect(a(1)).toBeCloseTo(1, 2);
    expect(steps(4)(0.6)).toBe(0.5);
    expect(RATE.smooth(0)).toBe(0);
    expect(RATE.smooth(1)).toBeCloseTo(1, 6);
    expect(RATE.thereAndBack(0.5)).toBeCloseTo(1, 6);
    expect(curve('nope')(0.5)).toBeGreaterThan(0.5);
  });
  it('stagger distributions: reading (RTL), centre, edges, grid, capped total', () => {
    expect(staggerDelay(4, 5, { each: 0.1, from: 'reading', dir: 'rtl' })).toBe(0);
    expect(staggerDelay(0, 5, { each: 0.1, from: 'reading', dir: 'rtl' })).toBeCloseTo(0.4);
    expect(staggerDelay(2, 5, { each: 0.1, from: 'center' })).toBe(0);
    expect(staggerDelay(0, 5, { each: 0.1, from: 'edges' })).toBe(0);
    expect(staggerDelay(19, 20, { each: 0.1, maxTotal: 0.6 })).toBeCloseTo(0.6);
    expect(staggerDelay(0, 9, { each: 0.1, from: 'center', grid: [3, 3] })).toBeGreaterThan(staggerDelay(4, 9, { each: 0.1, from: 'center', grid: [3, 3] }));
  });
  it('keyframe tracks interpolate with easing and spring segments carry velocity', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'ease-in-out-cubic' }, { t: 1.5, v: 50, spring: { stiffness: 150, damping: 12 } }];
    expect(trackAt(keys, 0.5)).toBeCloseTo(50, 0);
    expect(trackAt(keys, 1)).toBeCloseTo(100, 3);
    expect(trackAt(keys, 8)).toBeCloseTo(50, 1);
  });
  it('sequence resolves overlap and "with" placement', () => {
    const s = sequence([{ id: 'a', dur: 1 }, { id: 'b', dur: 1, at: -0.3 }, { id: 'c', dur: 0.5, at: 'with' }]);
    expect(s.b.start).toBeCloseTo(0.7);
    expect(s.c.start).toBeCloseTo(0.7);
  });
  it('principled element progress: anticipation dip then overshoot-capable spring', () => {
    const m = { delay: 0, spring: { stiffness: 180, damping: 12, mass: 1 }, anticipation: 0.08, anticipationSec: 0.12 };
    expect(elementProgress(0.06, m)).toBeLessThan(0);
    expect(elementProgress(3, m)).toBeCloseTo(1, 2);
  });
});

describe('Motion Intent System', () => {
  it('derives intent from role and beat', () => {
    expect(intentFor('hero-product', 'product', { hero: true })).toBe('reveal');
    expect(intentFor('cta', 'cta')).toBe('attention');
    expect(intentFor('hero-product', 'feature', { shared: true })).toBe('continuity');
    expect(intentFor('data-viz', 'comparison')).toBe('transformation');
  });
  it('premium never winds up; playful CTA does; decoration is silent', () => {
    expect(chooseMotion('headline', 'emphasis', 'premium').anticipation).toBe(0);
    expect(chooseMotion('cta', 'attention', 'playful').anticipation).toBeGreaterThan(0);
    expect(chooseMotion('decorative', 'storytelling', 'energetic').sound).toBe('silent');
    expect(chooseMotion('hero-product', 'reveal', 'tech', { hero: true }).sound).toBe('hero');
    expect(chooseMotion('logo', 'reveal', 'tech').entrance).toBe('morph');
  });
  it('plans a scene: the camera serves the most important element', () => {
    const p = planSceneIntent({ content: { title: 'x', product: 'product' }, category: 'commerce', beat: 'product', personality: 'premium', hero: true, first: false });
    expect(p.primary.role).toBe('hero-product');
    expect(rolesOf({ cta: 'go' }, 'cta')).toContain('cta');
  });
});

describe('Camera Engine 2.0', () => {
  const W = 1080;
  const H = 1920;
  const D = perspectiveOf(W, H);
  it('rest camera reproduces the authored layout on every plane', () => {
    for (const d of [-0.32, 0, 0.7, 1.6]) {
      const p = project({ x: 100, y: 300 }, d, REST, W, H, D)!;
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(300, 6);
    }
  });
  it('true parallax: a truck moves near planes more than far planes', () => {
    const cam = { ...REST, x: 50 };
    const near = project({ x: 540, y: 960 }, -0.32, cam, W, H, D)!;
    const hero = project({ x: 540, y: 960 }, 0, cam, W, H, D)!;
    const far = project({ x: 540, y: 960 }, 0.7, cam, W, H, D)!;
    expect(Math.abs(near.x - 540)).toBeGreaterThan(Math.abs(hero.x - 540));
    expect(Math.abs(hero.x - 540)).toBeGreaterThan(Math.abs(far.x - 540));
  });
  it('dolly enlarges the hero plane; a plane past the lens is a collision', () => {
    const r = projectRect({ x: 440, y: 860, width: 200, height: 200 }, 0, { ...REST, dolly: 0.1 }, W, H, D)!;
    expect(r.width).toBeGreaterThan(200);
    expect(clearance(-0.32, { ...REST, dolly: 0.6 })).toBeLessThan(0.2);
    expect(project({ x: 0, y: 0 }, -0.32, { ...REST, dolly: 0.6 }, W, H, D)).toBeNull();
  });
  it('moves are deterministic and accents settle', () => {
    const plan = { move: 'push-in' as const, amplitude: 1, accents: [1] };
    const c = { W, H, durationSec: 3 };
    expect(cameraAt(plan, 1.3, c)).toEqual(cameraAt(plan, 1.3, c));
    expect(cameraAt(plan, 3, c).dolly).toBeGreaterThan(cameraAt(plan, 0.5, c).dolly);
    expect(peakSpeed(plan, c, D)).toBeGreaterThan(0);
  });
  it('framing solver shrinks a push that would push edge text out of the safe area', () => {
    const safe = { x: 60, y: 160, width: 960, height: 1500 };
    const els = [{ rect: { x: 70, y: 200, width: 940, height: 160 }, kind: 'text' as const, label: 'headline' }];
    const ctx = { W, H, durationSec: 3, D, safe, u: 10 };
    const plan = { move: 'push-in' as const, amplitude: 1.2 };
    expect(auditFraming(plan, els, ctx).violations.length).toBeGreaterThan(0);
    const solved = solveFraming(plan, els, ctx);
    expect(auditFraming(solved.plan, els, ctx).violations.length).toBe(0);
    expect(solved.scaled).toBeLessThan(1);
  });
  it('framing solver keeps a centred product move untouched', () => {
    const safe = { x: 60, y: 160, width: 960, height: 1500 };
    const els = [{ rect: { x: 340, y: 760, width: 400, height: 400 }, kind: 'product' as const }];
    const r = solveFraming({ move: 'orbit-left', amplitude: 1 }, els, { W, H, durationSec: 3, D, safe, u: 10 });
    expect(r.scaled).toBe(1);
  });
});

describe('Morphing Engine', () => {
  it('parses every command family into cubic segments', () => {
    const subs = parsePath('M10 10 h20 v20 H10 z m40 0 l10 10 q5 5 10 0 t10 0 c1 1 2 2 3 3 s4 4 5 5 a5 5 0 0 1 10 0 Z');
    expect(subs.length).toBe(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].segs.length).toBeGreaterThan(5);
  });
  it('resamples by arc length to an exact point count', () => {
    const pts = resample(parsePath(circlePath(50, 50, 40))[0], 64);
    expect(pts.length).toBe(64);
    const d = pts.map((p) => Math.hypot(p.x - 50, p.y - 50));
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(0.5);
  });
  it('morphs square → circle with endpoints exact and a valid in-between silhouette', () => {
    const plan = prepareMorph(shapePath('square'), shapePath('circle'));
    expect(midSilhouetteOk(plan)).toBe(true);
    const end = parsePath(morphAt(plan, 1))[0];
    const ring = resample(end, 64);
    const r = ring.map((p) => Math.hypot(p.x - 50, p.y - 50));
    expect(Math.max(...r) - Math.min(...r)).toBeLessThan(1);
    expect(morphTravel(plan)).toBeGreaterThan(1);
  });
  it('aligns winding so the shape never turns inside out', () => {
    const cw = 'M0 0 L100 0 L100 100 L0 100 Z';
    const ccw = 'M0 0 L0 100 L100 100 L100 0 Z';
    const plan = prepareMorph(cw, ccw);
    expect(Math.abs(signedArea(resample(parsePath(morphAt(plan, 0.5))[0], 64)))).toBeGreaterThan(5000);
  });
  it('unequal sub-path counts grow/shrink from centroids', () => {
    const plan = prepareMorph(shapePath('circle'), `${circlePath(30, 50, 15)} ${circlePath(70, 50, 15)}`);
    expect(plan.rings.length).toBe(2);
    expect(morphAt(plan, 0.5).split('M').length - 1).toBe(2);
  });
  it('icons and blobs resolve to paths; blobs are seeded', () => {
    expect(iconPath('shopping-cart')).toMatch(/^M/);
    expect(iconPath('Heart')).toBeTruthy();
    expect(iconPath('no-such-icon')).toBeNull();
    expect(blobPath(50, 50, 40, 'a')).toBe(blobPath(50, 50, 40, 'a'));
    expect(blobPath(50, 50, 40, 'a')).not.toBe(blobPath(50, 50, 40, 'b'));
  });
  it('traces a silhouette from a mask (logo morph target)', () => {
    const w = 40;
    const h = 30;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 25; y++) for (let x = 5; x < 35; x++) m[y * w + x] = 1;
    for (let y = 12; y < 18; y++) for (let x = 15; x < 25; x++) m[y * w + x] = 0; // a hole
    const rings = traceContours(m, w, h);
    expect(rings.length).toBe(2);
    const p = silhouettePath(m, w, h, { x: 0, y: 0, width: 100, height: 100 })!;
    expect(p).toMatch(/^M/);
    expect(parsePath(p).length).toBe(1); // holes dropped: outer body only
  });
});

import { joiningClusters, kashida, isSafeBreak, joinsNext, joinsPrev } from '../../src/typography/arabic';
import { TextMotionRegistry, effectiveUnit } from '../../src/text-motion/families';

describe('Arabic Kinetic Typography 2.0', () => {
  it('splits words only where letters do not connect (identical letterforms)', () => {
    expect(joiningClusters('مواعيدك')).toEqual(['مو', 'ا', 'عيد', 'ك']);
    expect(joiningClusters('السلام')).toEqual(['ا', 'لسلا', 'م']);
    expect(joiningClusters('لا')).toEqual(['لا']); // lam-alef ligature never split
    expect(joiningClusters('مرطّب').join('')).toBe('مرطّب'); // marks stay with their base
    for (const w of ['مواعيدك', 'السلام', 'بشرتك', 'تستاهل', 'فوضى', 'حجوزاتك']) {
      const g = joiningClusters(w);
      expect(g.join('')).toBe(w);
      for (let i = 1; i < g.length; i++) expect(isSafeBreak(g[i - 1], g[i])).toBe(true);
    }
  });
  it('knows the joining types', () => {
    expect(joinsNext('م')).toBe(true);
    expect(joinsNext('ا')).toBe(false);
    expect(joinsNext('ة')).toBe(false);
    expect(joinsPrev('ا')).toBe(true);
    expect(joinsPrev('ء')).toBe(false);
    expect(isSafeBreak('م', 'ع')).toBe(false);
    expect(isSafeBreak('و', 'ا')).toBe(true);
    expect(isSafeBreak('ل', 'ا')).toBe(false);
  });
  it('inserts kashida only at a legal joined connection', () => {
    expect(kashida('بشرتك', 2)).toBe('بشرتــك');
    expect(kashida('ورد', 3)).toBe('ورد'); // no connection to stretch
    expect(kashida('لا', 3)).toBe('لا');
    expect(kashida('Hello', 3)).toBe('Hello');
  });
  it('Arabic-first families animate joining-safe clusters, never characters', () => {
    for (const id of ['ar-cluster-rise', 'ar-cluster-cascade', 'ar-cluster-drop']) expect(effectiveUnit(TextMotionRegistry.get(id)!, true)).toBe('cluster');
    for (const id of ['ar-fill-sweep', 'ar-weight-settle', 'ar-kashida-stretch', 'ar-ink-sweep']) expect(TextMotionRegistry.get(id)).toBeTruthy();
  });
});

import { searchAudio, expandQuery, licenseOk, validateEntry, stems, type AudioEntry } from '../../src/audio/registry';
import { planMusic, musicTarget } from '../../src/audio/music-director';
import { sidechainGain } from '../../src/audio/mix';

describe('Audio Engine 2.0', () => {
  const e = (id: string, o: Partial<AudioEntry>): AudioEntry => ({ id, filename: `${id}.mp3`, path: `sfx/${id}.mp3`, category: 'misc', tags: [], mood: [], energy: 0.5, duration: 0.5, intensity: 0.5, recommended_use: [], license: 'CC0-1.0', source: 'test', local_available: true, kind: 'sfx', ...o });
  const lib = [
    e('whoosh-a', { category: 'whoosh', tags: ['transition', 'air'] }),
    e('coin', { category: 'cash', tags: ['price', 'coin'] }),
    e('logo-hit', { category: 'logo', tags: ['signature', 'reveal'], mood: ['luxury'] }),
    e('bad-licence', { category: 'whoosh', license: 'unknown' }),
    e('music-lux', { category: 'music', kind: 'music', mood: ['luxury', 'calm'], duration: 30 }),
  ];
  it('searches bilingually through the ontology and never returns unlicensed files', () => {
    expect(searchAudio(lib, { text: 'سعر خصم' })[0].entry.id).toBe('coin');
    expect(searchAudio(lib, { text: 'صوت فاخر لظهور الشعار' })[0].entry.id).toBe('logo-hit');
    expect(searchAudio(lib, { text: 'انتقال سريع' })[0].entry.id).toBe('whoosh-a');
    expect(searchAudio(lib, { text: 'whoosh' }).some((h) => h.entry.id === 'bad-licence')).toBe(false);
    expect(searchAudio(lib, { text: 'موسيقى هادئة فاخرة', kind: 'music' })[0].entry.id).toBe('music-lux');
    expect(stems('الشعار')).toContain('شعار');
    expect(expandQuery('نقرة').has('click')).toBe(true);
  });
  it('enforces the licence allow-list and attribution', () => {
    expect(licenseOk('CC0-1.0')).toBe(true);
    expect(licenseOk('GPL-3.0')).toBe(false);
    expect(licenseOk(undefined)).toBe(false);
    expect(validateEntry({ ...lib[0], license: 'CC-BY-4.0' })).toContain('attribution required');
  });
  it('music director: user > library > procedural > none, with a hierarchy', () => {
    const base = { personality: 'premium' as const, durationSec: 20, voiceLed: false, wantLibrary: true, proceduralAllowed: true, sfx: true };
    expect(planMusic({ ...base, userMusic: { file: 'a.mp3' }, library: [] }).source).toBe('user');
    expect(planMusic({ ...base, library: searchAudio(lib, { text: 'luxury music', kind: 'music' }) }).source).toBe('library');
    expect(planMusic({ ...base, library: [] }).source).toBe('procedural');
    const none = planMusic({ ...base, wantLibrary: false, proceduralAllowed: false, library: [], voiceLed: true });
    expect(none.source).toBe('none');
    expect(none.hierarchy.order).toEqual(['voice', 'sfx', 'music', 'ambient']);
    expect(musicTarget('sport', 'fast').energy).toBeGreaterThan(musicTarget('premium', 'slow').energy);
  });
  it('sidechain dips the music under impact cues only', () => {
    const cues = [{ atSec: 5, anchorSec: 5, layer: 'impact', volume: 0.8 }, { atSec: 8, layer: 'single', volume: 0.8 }];
    expect(sidechainGain(5, cues, 3)).toBeCloseTo(Math.pow(10, -3 / 20), 3);
    expect(sidechainGain(8, cues, 3)).toBe(1);
    expect(sidechainGain(6, cues, 3)).toBe(1);
    expect(sidechainGain(5, cues, 0)).toBe(1);
  });
});
