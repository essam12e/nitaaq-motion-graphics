/**
 * Character Motion Engine: pure engines (director, actor, layout, gestures, QC) and the local
 * preparation pipeline on the Saudi fixtures (svg / poses / sheet / single), cache hit and graceful failures.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readLine, directCharacter, CHARACTER_PHASES } from '../../src/character/director';
import { actionCurve, curveAnchors, feelFor, performFrame, shotEvents, springAt } from '../../src/character/actor';
import { characterPlacement, headBox } from '../../src/character/layout';
import { gestureAngles, propSide } from '../../src/character/gestures';
import { choosePose } from '../../src/character/library';
import { prepareCharacter, type PreparedCharacter } from '../../src/node/character/package';
import { characterStructuralQc } from '../../src/qc/character-qc';
import { makeCanvasProfile } from '../../src/layout/canvas';
import { CUT_TRANSITION } from '../../src/node/character/film';
import { detectEvents } from '../../src/audio/events';

const FIX = join(__dirname, '../fixtures/characters/saudi');
const cache = mkdtempSync(join(tmpdir(), 'nitaaq-char-'));
process.env.NITAAQ_CACHE = cache;

const BEATS = [
  { line: 'تعبت من الزحمة كل يوم؟' },
  { line: 'وش الحل؟' },
  { line: 'تطبيق مشوار يوصلك بسرعة', scene: 'phone' as const },
  { line: 'وصلتني رسالة من المندوب', scene: 'chat' as const, messages: ['المندوب عند الباب', 'تمام، جاي'] },
  { line: 'شوف هنا كل شي واضح' },
  { line: 'حمّل التطبيق الآن', scene: 'cta' as const },
];

let svg: PreparedCharacter;
let poses: PreparedCharacter;
beforeAll(async () => {
  svg = await prepareCharacter({ svg: join(FIX, 'saudi-layered.svg'), name: 'أبو فهد' }, { baseDir: FIX });
  const files = ['neutral', 'confused', 'holding-phone', 'looking-phone', 'pointing', 'presenting'];
  const { readdirSync } = await import('node:fs');
  const all = readdirSync(join(FIX, 'poses')).filter((f) => f.endsWith('.png'));
  poses = await prepareCharacter({ poses: all.filter((f) => files.some((n) => f.includes(n))).map((f) => ({ path: join(FIX, 'poses', f) })), name: 'أبو فهد' }, { baseDir: FIX });
}, 120_000);

describe('Character Director — reading the line', () => {
  it.each([
    ['وش الحل؟', 'questioning'],
    ['تعبت من الزحمة كل يوم؟', 'confused'],
    ['شوف هنا كل شي واضح', 'pointing'],
    ['حمّل التطبيق الآن', 'presenting'],
    ['وصلتني رسالة من المندوب', 'looking_phone'],
  ])('%s → %s', (line, state) => {
    const r = readLine({ line });
    expect(r.state === state || (state === 'presenting' && r.scene === 'cta') || (state === 'happy' && ['happy', 'celebrating'].includes(r.state))).toBe(true);
  });
  it('«تمام» is a happy talk line, not a success «تم»', () => {
    const r = readLine({ line: 'تمام' });
    expect(r.expression).toBe('happy');
    expect(r.state).not.toBe('celebrating');
  });
  it('a greeting waves at the camera', () => {
    const r = readLine({ line: 'هلا والله' });
    expect(r.gesture).toBe('wave');
    expect(r.gaze).toBe('camera');
  });
  it('an explicit pose wins over the words', () => {
    expect(readLine({ line: 'وش الحل؟', pose: 'pointing' }).state).toBe('pointing');
  });
  it('a question in a phone scene stays a phone beat', () => {
    expect(readLine({ line: 'وين الطلب؟', scene: 'phone' }).scene).toBe('phone');
  });
});

describe('Character Director — the plan', () => {
  it('plans every beat with phases from the state machine, RTL screen direction and intentional cuts', () => {
    const plan = directCharacter({ beats: BEATS, manifest: svg.manifest, library: svg.library, orientation: 'portrait', dir: 'rtl' });
    expect(plan.shots).toHaveLength(BEATS.length);
    for (const s of plan.shots) {
      expect(s.phases.length).toBeGreaterThan(0);
      for (const p of s.phases) expect(CHARACTER_PHASES).toContain(typeof p === 'string' ? p : p.phase);
      expect(s.cut.type).toBeTruthy();
    }
    expect(plan.shots[0].cut.type).toBe('enter');
    expect(plan.shots[2].scene).toBe('phone');
    expect(plan.shots[3].scene).toBe('chat');
    expect(plan.shots[5].scene).toBe('cta');
    // never morph: every pose change is a named cut
    for (const s of plan.shots.slice(1)) expect(['continuous', 'match-cut', 'occlusion', 'whip', 'camera-assisted', 'cut-on-action']).toContain(s.cut.type);
  });
  it('landscape RTL keeps the character on the left looking at the text on the right', () => {
    const plan = directCharacter({ beats: BEATS, manifest: svg.manifest, library: svg.library, orientation: 'landscape', dir: 'rtl' });
    expect(plan.shots.every((s) => s.side === 'left')).toBe(true);
  });
  it('is deterministic for the same input', () => {
    const a = directCharacter({ beats: BEATS, manifest: poses.manifest, library: poses.library, orientation: 'portrait', dir: 'rtl' });
    const b = directCharacter({ beats: BEATS, manifest: poses.manifest, library: poses.library, orientation: 'portrait', dir: 'rtl' });
    expect(JSON.stringify(a.shots)).toBe(JSON.stringify(b.shots));
  });
  it('poses mode picks the matching supplied pose and never invents one', () => {
    const plan = directCharacter({ beats: BEATS, manifest: poses.manifest, library: poses.library, orientation: 'portrait', dir: 'rtl' });
    const ids = new Set(poses.manifest.poses.map((p) => p.poseId));
    for (const s of plan.shots) expect(ids.has(s.poseId)).toBe(true);
    expect(poses.manifest.poses.find((p) => p.poseId === plan.shots[4].poseId)?.semantics.state).toBe('pointing');
  });
  it('lockFace / subtle motion are honoured', () => {
    const plan = directCharacter({ beats: BEATS, manifest: svg.manifest, library: svg.library, orientation: 'portrait', dir: 'rtl', lockFace: true, motion: 'subtle' });
    expect(plan.shots.every((s) => s.lockFace && s.motion === 'subtle' && s.talk === 0)).toBe(true);
  });
});

describe('Character Actor — motion principles', () => {
  it('the spring settles at 1 and overshoots only when under-damped', () => {
    expect(springAt(3, 12, 0.7)).toBeCloseTo(1, 2);
    const peak = Math.max(...Array.from({ length: 60 }, (_, i) => springAt(i / 30, 12, 0.5)));
    expect(peak).toBeGreaterThan(1);
    const crit = Math.max(...Array.from({ length: 60 }, (_, i) => springAt(i / 30, 12, 1)));
    expect(crit).toBeLessThanOrEqual(1.0001);
  });
  it('anticipation dips before the action and the anchors are ordered', () => {
    const f = feelFor('playful', 'normal');
    const min = Math.min(...Array.from({ length: 10 }, (_, i) => actionCurve(i / 60, f)));
    expect(min).toBeLessThan(0);
    const a = curveAnchors((t) => actionCurve(t, f), 30);
    expect(a.start).toBeLessThanOrEqual(a.peak);
    expect(a.contact).toBeLessThanOrEqual(a.settle);
    expect(a.settle).toBeLessThanOrEqual(a.completion);
  });
  it('exaggerated moves more than subtle', () => {
    expect(feelFor('playful', 'exaggerated').amp).toBeGreaterThan(feelFor('playful', 'subtle').amp);
  });
  it('performs frames and emits sound events with exact anchors inside the shot', () => {
    const plan = directCharacter({ beats: BEATS, manifest: svg.manifest, library: svg.library, orientation: 'portrait', dir: 'rtl' });
    const fps = 30;
    for (const shot of plan.shots) {
      const frames = Math.round(shot.seconds * fps);
      const ctx = { shot, fps, frames, rig: svg.rig, portrait: true };
      const last = performFrame(ctx, frames - 1);
      expect(Number.isFinite(last.x + last.y + last.rot)).toBe(true);
      expect(last.sx).toBeCloseTo(last.sy, 1); // uniform scale — never stretched
      for (const e of shotEvents(ctx)) {
        expect(e.anchors.start).toBeGreaterThanOrEqual(0);
        expect(e.anchors.peak).toBeGreaterThanOrEqual(e.anchors.start);
        expect(e.anchors.completion).toBeLessThanOrEqual(shot.seconds + 0.01);
      }
    }
    const kinds = new Set(plan.shots.flatMap((shot) => shotEvents({ shot, fps, frames: Math.round(shot.seconds * fps), rig: svg.rig, portrait: true }).map((e) => e.type)));
    expect(kinds.has('character_enter')).toBe(true);
    expect(kinds.has('phone_pickup') || kinds.has('phone_tap')).toBe(true);
  });
  it('exact anchors pass straight through to the sound director', () => {
    const ev = detectEvents([{ id: 's', index: 0, startSec: 2, durationSec: 3, speed: 1, energy: 0.5, category: 'character', decls: [{ type: 'gesture_peak', at: 0.4, importance: 0.6, exact: { start: 0.4, peak: 0.5, contact: 0.55, settle: 0.7, completion: 0.8 } }] }] as never, undefined, 30);
    const g = ev.find((e) => e.type === 'gesture_peak')!;
    expect(g.anchors.peak).toBeCloseTo(2.5, 2);
  });
});

describe('Character layout — scale consistency', () => {
  const ref = { bodyHeads: 5.7, widthHeads: 1.6, framing: 'full-body' as const };
  it.each([[1080, 1920], [1920, 1080], [1080, 1080], [1080, 1350]])('%i×%i: one size per shot size, head inside the frame', (w, h) => {
    const c = makeCanvasProfile(w, h, 'tiktok' as never);
    for (const size of ['wide', 'medium', 'medium-close', 'close'] as const) {
      const a = characterPlacement(c, { size, side: 'left' }, ref);
      const b = characterPlacement(c, { size, side: 'right' }, ref);
      expect(Math.abs(a.pxPerHead - b.pxPerHead) / a.pxPerHead).toBeLessThan(0.01);
      const h = headBox(a);
      expect(h.y).toBeGreaterThanOrEqual(0);
      expect(h.x).toBeGreaterThanOrEqual(0);
      expect(h.x + h.width).toBeLessThanOrEqual(c.width);
    }
    const sizes = (['wide', 'medium', 'medium-close', 'close'] as const).map((size) => characterPlacement(c, { size, side: 'left' }, ref).pxPerHead);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1] * 0.98);
  });
});

describe('Rig gestures', () => {
  it('the phone stays in the hand that holds it', () => {
    const side = propSide(svg.rig!);
    const g = gestureAngles(svg.rig!, 'hold_phone');
    expect(side).toBeTruthy();
    const moved = Object.keys(g.angles).filter((k) => Math.abs(g.angles[k]) > 5);
    expect(moved.some((k) => k.endsWith(side === 'L' ? 'L' : 'R') || k.includes(side === 'L' ? 'left' : 'right'))).toBe(true);
  });
  it('pointing honours the aim angle', () => {
    const lo = gestureAngles(svg.rig!, 'point', { aim: 86 });
    const hi = gestureAngles(svg.rig!, 'point', { aim: 128 });
    expect(JSON.stringify(lo.angles)).not.toBe(JSON.stringify(hi.angles));
  });
});

describe('Preparation pipeline (local, cached)', () => {
  it('layered SVG → full vector rig with the Saudi identity lock', () => {
    expect(svg.rig).toBeTruthy();
    expect(svg.manifest.hasRig).toBe(true);
    const lock = svg.bible.identityLock.join(' ');
    expect(lock).toMatch(/shemagh|ghutra/);
    expect(lock).toMatch(/agal/);
    expect(lock).toMatch(/thobe/);
  });
  it('a second prepare of the same art is a cache hit', async () => {
    const again = await prepareCharacter({ svg: join(FIX, 'saudi-layered.svg'), name: 'أبو فهد' }, { baseDir: FIX });
    expect(again.cache).toBe('hit');
    expect(again.dir).toContain(cache);
  });
  it('a single PNG is honest: one pose, STATIC ceiling, no fake gestures', async () => {
    const one = await prepareCharacter({ image: join(FIX, 'saudi-single.png') }, { baseDir: FIX });
    expect(one.manifest.poses).toHaveLength(1);
    expect(one.manifest.restrictedActions.join(' ')).toMatch(/gesture/);
    const plan = directCharacter({ beats: BEATS, manifest: one.manifest, library: one.library, orientation: 'portrait', dir: 'rtl' });
    expect(plan.needsArt.length).toBeGreaterThan(0);
  });
  it('a character sheet is split into poses and the pointing pose is found', async () => {
    const sheet = await prepareCharacter({ sheet: join(FIX, 'saudi-sheet.png') }, { baseDir: FIX });
    expect(sheet.manifest.poses.length).toBeGreaterThanOrEqual(8);
    expect(choosePose(sheet.manifest, sheet.library, { state: 'pointing' }).match).toBe('exact');
  }, 60_000);
  it('fails clearly on a missing file and on a broken image', async () => {
    await expect(prepareCharacter({ image: join(FIX, 'nope.png') }, { baseDir: FIX })).rejects.toThrow();
    const bad = join(cache, 'broken.png');
    writeFileSync(bad, 'not an image');
    await expect(prepareCharacter({ image: bad }, { baseDir: FIX })).rejects.toThrow();
  });
});

describe('Character QC', () => {
  it('flags text on the face and a missing character', () => {
    const spec = { character: { poses: {} }, canvas: { width: 1080, height: 1920 }, scenes: [{ id: 's1', type: 'character-stage' }, { id: 's2', type: 'character-stage' }] } as never;
    const samples = [
      { frame: 10, time: 0.3, scene: 's1', sceneIndex: 0, kind: 'hold' },
      { frame: 50, time: 1.6, scene: 's2', sceneIndex: 1, kind: 'hold' },
    ];
    const probes = new Map([
      [10, { texts: [{ text: 'وش الحل؟', role: 'title', opacity: 1, rect: { x: 400, y: 500, width: 300, height: 200 } }], characters: [{ scene: 's1', opacity: 1, head: { x: 450, y: 520, width: 160, height: 160 }, pose: 'p', size: 'medium', mode: 'rig', pxPerHead: 200, rect: { x: 300, y: 500, width: 400, height: 1200 } }] }],
      [50, { texts: [], characters: [] }],
    ]) as never;
    const issues: { code: string }[] = [];
    expect(characterStructuralQc(spec, samples, probes, (i) => issues.push(i))).toBe('fail');
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['CHARACTER_TEXT_ON_FACE', 'CHARACTER_MISSING']));
  });
  it('maps every planned cut to a real transition (no morphing)', () => {
    for (const k of ['match-cut', 'camera-assisted', 'whip']) expect(CUT_TRANSITION[k]).toBeTruthy();
  });
});
