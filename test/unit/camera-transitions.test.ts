import { describe, expect, it } from 'vitest';
import { blurHint, clampBounds, fitTarget, focusHandoff, lookAtTargets, unionRect } from '../../src/camera/solver';
import { cameraAt, CAMERA_PRESETS, planMoves, resolvePlan, type CameraPlan } from '../../src/camera/moves';
import { auditFraming } from '../../src/camera/framing';
import { clearance, NEAR, passOpacity, PASS_BAND, perspectiveOf, projectRect, REST } from '../../src/camera/rig';
import { PASS_FADE } from '../../src/camera/spatial';
import { TRANSITIONS, TransitionRegistry } from '../../src/transitions/presentations';
import { wipeGeometry } from '../../src/transitions/advanced';
import { continuityScore, motionVector, refineContinuity, spatialEdge, type SceneEdge } from '../../src/transitions/continuity';
import type { TransitionChoice } from '../../src/transitions/engine';
import { CameraPlanSchema, TransitionSchema } from '../../src/schema/video';

const W = 1080;
const H = 1920;
const D = perspectiveOf(W, H);
const MC = { W, H, durationSec: 4 };

describe('Camera solver', () => {
  it('auto-frames one element: centred and filling the requested fraction', () => {
    const r = { x: 0.1, y: 0.6, w: 0.3, h: 0.1 };
    const cam = fitTarget(r, { W, H, fill: 0.7 });
    const s = projectRect({ x: r.x * W, y: r.y * H, width: r.w * W, height: r.h * H }, 0, cam, W, H, D)!;
    expect(s.x + s.width / 2).toBeCloseTo(W / 2, 0);
    expect(s.y + s.height / 2).toBeCloseTo(H / 2, 0);
    expect(Math.max(s.width / W, s.height / H)).toBeCloseTo(0.7, 2);
  });
  it('frames a group by its union and puts it at an anchor', () => {
    const g = [
      { x: 0.1, y: 0.2, w: 0.2, h: 0.1 },
      { x: 0.5, y: 0.25, w: 0.2, h: 0.1 },
    ];
    const un = unionRect(g);
    expect(un.x).toBeCloseTo(0.1, 9);
    expect(un.w).toBeCloseTo(0.6, 9);
    expect(un.h).toBeCloseTo(0.15, 9);
    const cam = fitTarget(g, { W, H, fill: 0.8, anchor: { x: 0.5, y: 0.4 } });
    const u = unionRect(g);
    const s = projectRect({ x: u.x * W, y: u.y * H, width: u.w * W, height: u.h * H }, 0, cam, W, H, D)!;
    expect(s.y + s.height / 2).toBeCloseTo(0.4 * H, 0);
    expect(s.width / W).toBeCloseTo(0.8, 2);
  });
  it('never brings a protected plane closer than NEAR + margin; the lens zoom does the rest', () => {
    const tiny = { x: 0.48, y: 0.48, w: 0.04, h: 0.02 };
    const cam = fitTarget(tiny, { W, H, fill: 0.8, protect: [-0.32, 0] });
    expect(clearance(-0.32, cam)).toBeGreaterThanOrEqual(NEAR + 0.12 - 1e-6);
    expect(cam.zoom).toBeGreaterThan(1);
  });
  it('smooth look-at: holds, then follows the next target with an eased lag (no jump)', () => {
    const targets = [
      { t: 0, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } },
      { t: 1, rect: { x: 0.6, y: 0.7, w: 0.3, h: 0.1 } },
    ];
    const o = { W, H, lag: 0.8 };
    const a = lookAtTargets(targets, 0.5, o);
    const b = lookAtTargets(targets, 1.0, o);
    const c = lookAtTargets(targets, 2, o);
    expect(a).toEqual(b);
    expect(c).toEqual(fitTarget(targets[1].rect, o));
    // continuity: small steps everywhere along the lag
    let prev = lookAtTargets(targets, 1, o);
    for (let t = 1.02; t <= 1.8; t += 0.02) {
      const cur = lookAtTargets(targets, t, o);
      expect(Math.hypot(cur.x - prev.x, cur.y - prev.y)).toBeLessThan(100);
      prev = cur;
    }
  });
  it('camera bounds keep the visible window inside the world', () => {
    const world = { x: -0.1, y: -0.1, w: 1.2, h: 1.2 };
    const cam = clampBounds({ ...REST, x: 900, y: -2000, dolly: 0.1 }, { world, depth: 0.7, maxDolly: 0.3 }, W, H);
    const d = 0.7;
    const clear = 1 + d - cam.dolly;
    const hw = ((W / 2) * clear) / (1 + d);
    const cx = cam.x / (1 + d);
    expect(cx + hw).toBeLessThanOrEqual((world.x + world.w - 0.5) * W + 1e-6);
    expect(clampBounds({ ...REST, dolly: 2 }, { maxDolly: 0.3 }, W, H).dolly).toBe(0.3);
  });
  it('blur hints are zero for a still camera and follow the direction of a fast move', () => {
    expect(blurHint(REST, REST, 10.8)).toMatchObject({ bx: 0, by: 0, radial: 0 });
    const h = blurHint(REST, { ...REST, x: 60 }, 10.8);
    expect(h.bx).toBeGreaterThan(0);
    expect(h.by).toBe(0);
    expect(h.vx).toBeLessThan(0);
  });
  it('focus handoff racks the focus plane and opens the aperture mid-way', () => {
    const a = { ...REST, focus: -0.3 };
    const b = { ...REST, focus: 0.4, x: 100 };
    expect(focusHandoff(a, b, 0).aperture).toBe(0);
    expect(focusHandoff(a, b, 0.5).aperture).toBeGreaterThan(0.4);
    expect(focusHandoff(a, b, 1).focus).toBeCloseTo(0.4, 6);
  });
});

describe('Camera presets, targets and pass-through on the existing CameraRig plan', () => {
  it('old plans are untouched (no preset / target)', () => {
    const p: CameraPlan = { move: 'push-in', amplitude: 1 };
    expect(resolvePlan(p)).toBe(p);
    expect(cameraAt(p, 0, MC)).toEqual(REST);
    expect(cameraAt({ move: 'static', amplitude: 1 }, 1, MC)).toEqual(REST);
    expect(planMoves({ move: 'static', amplitude: 1 })).toBe(false);
  });
  it('a preset fills what the plan leaves out', () => {
    const p = resolvePlan({ move: 'static', amplitude: 0.5, preset: 'flythrough' })!;
    expect(p.move).toBe('fly-through');
    expect(p.amplitude).toBe(0.5);
    expect(p.passThrough).toBe(true);
    expect(Object.keys(CAMERA_PRESETS).length).toBeGreaterThanOrEqual(8);
  });
  it('a static plan with a target frames it; a move plays around the framing', () => {
    const rect = { x: 0.2, y: 0.55, w: 0.3, h: 0.1 };
    const still = cameraAt({ move: 'static', amplitude: 1, target: { rect, fill: 0.6 } }, 1, MC);
    expect(still).toEqual(fitTarget(rect, { W, H, fill: 0.6 }));
    const moving = cameraAt({ move: 'push-in', amplitude: 1, target: { rect, fill: 0.6 } }, 4, MC);
    expect(moving.dolly).toBeGreaterThan(still.dolly);
  });
  it('pass-through: planes fade before the lens and are not reported as collisions', () => {
    expect(PASS_FADE).toEqual(PASS_BAND);
    expect(passOpacity(PASS_BAND[0])).toBe(0);
    expect(passOpacity(2)).toBe(1);
    const plan: CameraPlan = { move: 'dolly-in', amplitude: 1.5, passThrough: false };
    const fg = [{ rect: { x: 100, y: 100, width: 200, height: 100 }, depth: -0.32, kind: 'other' as const }];
    const ctx = { ...MC, D, safe: { x: 0, y: 0, width: W, height: H }, u: 10.8 };
    // dolly 0.18 at amplitude 1.5: the foreground plane (clearance 0.5) is not hit either way, so push harder
    const deep: CameraPlan = { ...plan, move: 'track', amplitude: 1.5, waypoints: [{ t: 0, focus: { x: 0.5, y: 0.5 } }, { t: 3, focus: { x: 0.5, y: 0.5 }, close: 1.6 }] };
    const hit = auditFraming(deep, fg, ctx).violations.filter((v) => v.problem === 'collision');
    const pass = auditFraming({ ...deep, passThrough: true }, fg, ctx).violations.filter((v) => v.problem === 'collision');
    expect(hit.length).toBeGreaterThan(0);
    expect(pass.length).toBe(0);
  });
  it('the schema accepts the new camera fields and keeps old plans valid', () => {
    const p = CameraPlanSchema.parse({ preset: 'hero-reveal', target: { rect: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }, targets: [{ t: 1, rect: { x: 0, y: 0, w: 1, h: 1 } }], passThrough: true, motionBlur: true, bounds: { maxDolly: 0.4 } });
    expect(p.move).toBe('static');
    expect(p.preset).toBe('hero-reveal');
    expect(CameraPlanSchema.parse({ move: 'push-in', amplitude: 0.8 })).toEqual({ move: 'push-in', amplitude: 0.8 });
    expect(TransitionSchema.parse({ type: 'scale-match', rect: { x: 0, y: 0, w: 1, h: 1 }, toRect: { x: 0, y: 0, w: 1, h: 1 }, vector: { dx: 1, dy: 0, speed: 0.5 } }).toRect).toBeTruthy();
  });
});

const NEW = ['card-push-through', 'video-match-cut', 'foreground-card-wipe', 'glass-wipe', 'scale-match', 'z-depth-pass', 'directional-blur', 'focus-handoff'];

describe('Phase 6 transitions', () => {
  it('are registered with meaning, duration and a sound peak', () => {
    for (const id of NEW) {
      const d = TransitionRegistry.get(id) ?? TRANSITIONS[id];
      expect(d, id).toBeTruthy();
      expect(d!.meaning?.length, id).toBeGreaterThan(0);
      expect(d!.duration, id).toBeGreaterThan(0);
      expect(d!.peak, id).toBeGreaterThan(0);
    }
  });
  it('end on the incoming scene untouched (no leftover clip, blur or scale)', () => {
    const ctx = { W, H, rect: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, toRect: { x: 0.1, y: 0.5, w: 0.5, h: 0.25 }, focus: { x: 0.5, y: 0.5 } };
    for (const id of NEW) {
      const f = TRANSITIONS[id].frame(1, 1, ctx);
      const e = f.enter;
      expect(e.opacity ?? 1, id).toBe(1);
      if (typeof e.transform === 'string') expect(e.transform, id).toMatch(/scale\(1(\.0+)?\)|translate\(0\.000%, 0\.000%\)|^translate\(-?0\.000%, -?0\.000%\) scale\(1\.0000\)$|^translateX\(-?0\.000%\)$/);
      if (typeof e.filter === 'string') expect(e.filter, id).toMatch(/blur\(0\.00px\)/);
      if (typeof e.clipPath === 'string') expect(e.clipPath, id).toMatch(/inset\(0(\.000)?%? 0(\.000)?%? 0(\.000)?%? 0(\.000)?%?|inset\(0 0\.000% 0 0\)|inset\(0 0 0 0\.000%\)/);
      expect(f.blur?.enter ?? [0, 0], id).toEqual([0, 0].map((x) => x));
    }
  });
  it('wipes: the pane always covers the reveal edge', () => {
    for (const kind of ['card-wipe', 'glass-wipe'] as const) {
      for (let p = 0.05; p < 1; p += 0.05) {
        const g = wipeGeometry(kind, p);
        if (g.shown <= 0 || g.shown >= 1) continue;
        expect(g.shown, `${kind} ${p}`).toBeGreaterThanOrEqual(g.lo);
        expect(g.shown, `${kind} ${p}`).toBeLessThanOrEqual(g.lo + g.w);
      }
    }
  });
  it('scale match maps the matched rect onto the incoming rect', () => {
    const A = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
    const B = { x: 0.1, y: 0.5, w: 0.8, h: 0.4 };
    const f = TRANSITIONS['scale-match'].frame(1, 1, { W, H, rect: A, toRect: B });
    // exit at p = 1 maps A → B: translate(Bc − Ac·s) scale(s) with s = 2
    expect(f.exit.transform).toBe('translate(-30.000%, -10.000%) scale(2.0000)');
  });
});

describe('Motion Continuity vectors', () => {
  it('scores a continued motion above a reversed one, and still → still as neutral', () => {
    const right = motionVector(400, 0, W, H, 0, 0.6);
    const left = motionVector(-400, 0, W, H, 0, 0.6);
    expect(continuityScore(right, right)).toBeGreaterThan(0.9);
    expect(continuityScore(right, left)).toBeLessThan(continuityScore(right, right) - 0.3);
    expect(continuityScore(undefined, undefined)).toBe(0.75);
    expect(continuityScore(right, left, 'directional-blur')).toBeGreaterThan(continuityScore(right, left));
  });
  it('spatial edges upgrade the cut; scenes without them choose exactly as before', () => {
    const base: SceneEdge[] = [
      { id: 'a', beat: 'feature', category: 'media' },
      { id: 'b', beat: 'feature', category: 'media' },
    ];
    const choices: TransitionChoice[] = [{ type: 'push', duration: 0.5, reason: 'x' }];
    const plain = refineContinuity({ scenes: base, choices, personality: 'premium', seed: 1, rhythmic: false });
    const withEmpty = refineContinuity({ scenes: base.map((e) => ({ ...e, ...spatialEdge('hero-headline') })), choices, personality: 'premium', seed: 1, rhythmic: false });
    expect(withEmpty).toEqual(plain);
    const spatial = refineContinuity({ scenes: [{ ...base[0], ...spatialEdge('spatial-gallery', 'corridor') }, { ...base[1], ...spatialEdge('spatial-gallery', 'wall') }], choices, personality: 'premium', seed: 1, rhythmic: false });
    expect(spatial[0].type).toBe('video-match-cut');
    const deep = refineContinuity({ scenes: [{ ...base[0], vector: { dx: 0, dy: 0, speed: 0.05, depth: 0.6 }, rect: { x: 0.2, y: 0.2, w: 0.4, h: 0.3 } }, base[1]], choices, personality: 'premium', seed: 1, rhythmic: false });
    expect(deep[0].type).toBe('card-push-through');
  });
});
