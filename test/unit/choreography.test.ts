import { describe, expect, it } from 'vitest';
import { compileChoreo, valueAt, phaseOf, focusAt, activeAt, passedAt, cameraFromChoreo, hasCamera, spanAnchors, ChoreoError, ChoreoSpecSchema, type ChoreoNode } from '../../src/motion/choreography';
import { staggerDelay } from '../../src/motion/orchestrate';
import { interactionOf, cursorAt, cursorPoint, elementAt, cursor } from '../../src/motion/interaction';
import { interactionPhrase, revealPhrase, cameraPhrase } from '../../src/motion/phrases';
import { interactionChoreo, interactionSpec, naturalLength, INTERACTION_VARIANTS } from '../../src/scenes/interaction/program';
import { detectEvents } from '../../src/audio/events';
import { REST } from '../../src/camera/rig';
import { seek } from '../../src/engine/seek';
import { VideoSchema } from '../../src/schema/video';
import { SceneRegistry } from '../../src/scenes/registry';
import '../../src/scenes/index';

const act = (id: string, dur: number, extra: Partial<Extract<ChoreoNode, { type: 'action' }>> = {}): ChoreoNode => ({ type: 'action', id, dur, ...extra });
const C = (timeline: ChoreoNode[], initial?: Record<string, number>) => compileChoreo({ timeline, ...(initial ? { initial } : {}) });

describe('choreography: placement', () => {
  it('sequences by default, places parallel blocks together, waits', () => {
    const c = C([act('a', 1), { type: 'wait', dur: 0.5 }, { type: 'par', id: 'p', children: [act('b', 0.4), act('c', 0.8)] }, act('d', 0.2)]);
    expect(c.byId.a).toMatchObject({ start: 0, end: 1 });
    expect(c.byId.b.start).toBe(1.5);
    expect(c.byId.c.start).toBe(1.5);
    expect(c.byId.p.end).toBe(2.3);
    expect(c.byId.d.start).toBe(2.3);
    expect(c.duration).toBe(2.5);
  });

  it('overlap and GSAP-style positions', () => {
    const c = C([act('a', 1), act('b', 1, { at: '-=0.25' }), act('c', 0.5, { at: '<' }), act('d', 0.5, { at: '>+0.1' }), act('e', 0.2, { at: '+=0.3' }), act('f', 0.2, { at: 4 }), act('g', 0.1, { at: '<0.05' })]);
    expect(c.byId.b.start).toBe(0.75);
    expect(c.byId.c.start).toBe(0.75);
    expect(c.byId.d.start).toBe(1.35);
    expect(c.byId.e.start).toBe(2.15);
    expect(c.byId.f.start).toBe(4);
    expect(c.byId.g.start).toBe(4.05);
  });

  it('markers, references with points and offsets, and forward triggers', () => {
    const c = C([
      act('a', 1, { ease: 'linear' }),
      { type: 'marker', id: 'm' },
      act('late', 0.3, { trigger: 'boom' }), // refers to a cue declared further down
      act('b', 0.5, { at: 'a.end-0.2' }),
      act('c', 0.5, { at: 'm+0.4' }),
      { type: 'cue', id: 'boom', at: 'b.end' },
      act('pk', 0.2, { at: 'a.peak' }),
    ]);
    expect(c.markers.m).toBe(1);
    expect(c.byId.b.start).toBe(0.8);
    expect(c.byId.c.start).toBe(1.4);
    expect(c.markers.boom).toBe(1.3);
    expect(c.byId.late.start).toBe(1.3);
    expect(c.byId.pk.start).toBeCloseTo(0.5, 1); // a linear move peaks anywhere; the sampled centre is fine
    expect(passedAt(c, 1.35)).toEqual(['m', 'boom']);
  });

  it('stagger uses the motion engine stagger distribution', () => {
    const c = C([{ type: 'stagger', id: 's', at: 1, each: 0.1, from: 'center', children: [0, 1, 2, 3, 4].map((i) => act(`k${i}`, 0.5)) }]);
    for (let i = 0; i < 5; i++) expect(c.byId[`k${i}`].start).toBeCloseTo(1 + staggerDelay(i, 5, { each: 0.1, from: 'center' }), 6);
    expect(c.byId.s.end).toBeCloseTo(1.7, 6);
  });

  it('follow-through inherits the leader timing; handoff starts while the source finishes', () => {
    const c = C([
      act('lead', 0.8, { target: 'box', props: { x: 1 }, spring: { bounce: 0.3, visualDuration: 0.5 } }),
      { type: 'action', id: 'child', target: 'shadow', follow: { id: 'lead', lag: 0.1 } },
      act('next', 0.6, { target: 'card', handoff: { from: 'lead', at: 0.5 }, props: { focus: 1 } }),
    ]);
    expect(c.byId.child).toMatchObject({ start: 0.1, end: 0.9 });
    expect(valueAt(c, 'shadow.x', 0.1 + 0.3)).toBeCloseTo(valueAt(c, 'box.x', 0.3), 6);
    expect(c.byId.next.start).toBe(0.4);
    expect(c.handoffs).toEqual([{ from: 'box', to: 'card', t0: 0.4, t1: 0.8 }]);
    expect(focusAt(c, 0.3)).toEqual({ box: 1 });
    const mid = focusAt(c, 0.6);
    expect(mid.box).toBeCloseTo(0.5, 2);
    expect(mid.card).toBeCloseTo(0.5, 2);
    expect(focusAt(c, 1)).toEqual({ box: 0, card: 1 });
  });

  it('timeScale stretches durations, waits, absolute times and offsets', () => {
    const spec: ChoreoNode[] = [act('a', 1), { type: 'wait', dur: 0.5 }, act('b', 0.5, { at: '-=0.2' }), act('c', 0.2, { at: 3 })];
    const c = compileChoreo({ timeline: spec }, { timeScale: 0.5 });
    expect(c.byId.a.end).toBe(0.5);
    expect(c.byId.b.start).toBe(0.65);
    expect(c.byId.c.start).toBe(1.5);
  });

  it('refuses unknown references, duplicate ids, cycles and bad ids', () => {
    expect(() => C([act('a', 1, { at: 'nope' })])).toThrow(ChoreoError);
    expect(() => C([act('a', 1), act('a', 1)])).toThrow(/duplicate/);
    expect(() => C([act('a', 1, { at: 'b' }), act('b', 1, { at: 'a.end' })])).toThrow(/cycle/);
    expect(ChoreoSpecSchema.safeParse({ timeline: [{ type: 'action', id: 'card-2', dur: 1 }] }).success).toBe(false);
    expect(ChoreoSpecSchema.safeParse({ timeline: [{ type: 'action', id: 'a', dur: 1, wobble: 2 }] }).success).toBe(false);
  });

  it('is deterministic and serialisable', () => {
    const spec = { timeline: [revealPhrase('folder'), interactionPhrase({ target: 'folder', from: { x: 0.9, y: 0.9 } })] };
    const json = JSON.parse(JSON.stringify(spec));
    const a = compileChoreo(spec);
    const b = compileChoreo(json);
    expect(b.byId).toEqual(a.byId);
    expect(b.events).toEqual(a.events);
    for (const t of [0, 0.5, 1.33, 2.2, 5]) expect(valueAt(b, 'folder.reveal', t)).toBe(valueAt(a, 'folder.reveal', t));
  });
});

describe('choreography: tracks', () => {
  it('to-moves chain from the current value; an interruption is continuous', () => {
    const c = C([act('a', 1, { target: 'x', props: { v: 10 }, ease: 'linear' }), act('b', 1, { target: 'x', props: { v: 0 }, ease: 'linear', at: 0.5 })]);
    expect(valueAt(c, 'x.v', 0.25)).toBeCloseTo(2.5, 6);
    expect(valueAt(c, 'x.v', 0.5)).toBeCloseTo(5, 6);
    expect(valueAt(c, 'x.v', 0.5 + 1e-4)).toBeCloseTo(5, 2);
    expect(valueAt(c, 'x.v', 1)).toBeCloseTo(2.5, 6);
    expect(valueAt(c, 'x.v', 9)).toBe(0);
  });

  it('a spring takes over with the velocity of the move it interrupts', () => {
    const c = C([act('a', 1, { target: 'x', props: { v: 1 }, ease: 'linear' }), act('b', 0.5, { target: 'x', props: { v: 2 }, spring: { bounce: 0.2, visualDuration: 0.5 }, at: 0.5 })]);
    const h = 1 / 600;
    const before = (valueAt(c, 'x.v', 0.5) - valueAt(c, 'x.v', 0.5 - h)) / h;
    const after = (valueAt(c, 'x.v', 0.5 + h) - valueAt(c, 'x.v', 0.5)) / h;
    expect(before).toBeCloseTo(1, 1);
    expect(after).toBeGreaterThan(0.8);
    expect(valueAt(c, 'x.v', 6)).toBeCloseTo(2, 3);
  });

  it('pulse goes there and back; kick swings to its amount and settles; rest values', () => {
    const c = C([act('p', 0.5, { target: 'f', props: { glow: 1 }, shape: 'pulse', ease: 'linear' }), act('k', 0.6, { target: 'camera', props: { dolly: 0.01 }, shape: 'kick', at: 0 })]);
    expect(valueAt(c, 'f.glow', 0.25)).toBeCloseTo(1, 6);
    expect(valueAt(c, 'f.glow', 0.5)).toBe(0);
    let peak = 0;
    for (let t = 0; t < 0.6; t += 1 / 240) peak = Math.max(peak, Math.abs(valueAt(c, 'camera.dolly', t)));
    expect(peak).toBeCloseTo(0.01, 3);
    expect(Math.abs(valueAt(c, 'camera.dolly', 3))).toBeLessThan(1e-4);
    expect(valueAt(c, 'f.scale', 1)).toBe(1);
    expect(valueAt(c, 'camera.close', 1)).toBe(1);
    expect(valueAt(c, 'f.other', 1)).toBe(0);
  });

  it('phaseOf reports before / active / done with eased progress', () => {
    const c = C([act('a', 1, { at: 1, ease: 'linear' })]);
    expect(phaseOf(c, 'a', 0.5).phase).toBe('before');
    expect(phaseOf(c, 'a', 1.5)).toMatchObject({ phase: 'active', p: 0.5 });
    expect(phaseOf(c, 'a', 2.5)).toMatchObject({ phase: 'done', p: 1 });
    expect(activeAt(c, 1.5)).toEqual(['a']);
  });
});

describe('choreography: sound events from the same timeline', () => {
  it('press / click / drag get default events with exact anchors; event:false silences; cues fire exactly', () => {
    const c = C([
      cursor.press('btn', { id: 'pr' }),
      cursor.release('btn'),
      cursor.click('btn', { id: 'ck', dur: 0.4 }),
      cursor.drag('card', 'folder', { id: 'dg', event: false }),
      { type: 'cue', id: 'hit', event: { type: 'success_state', importance: 0.8 } },
      act('open', 0.6, { target: 'folder', props: { open: 1 }, event: { type: 'ui_appear' } }),
    ]);
    const types = c.events.map((e) => e.type);
    expect(types).toEqual(['button_press', 'button_press', 'success_state', 'ui_appear']);
    const pr = c.events[0];
    expect(pr.exact!.contact).toBe(c.byId.pr.end);
    const ck = c.events[1];
    expect(ck.exact!.contact).toBeCloseTo(c.byId.ck.start + 0.4 * 0.45, 6);
    const hit = c.events[2];
    expect(hit.exact).toEqual({ start: c.markers.hit, peak: c.markers.hit, contact: c.markers.hit, settle: c.markers.hit, completion: c.markers.hit });
    // the Sound Director syncs the click to the bottom of the press, not to the scene start
    const ev = detectEvents([{ id: 's', index: 0, startSec: 10, durationSec: 8, speed: 1, energy: 0.5, category: 'ui', decls: c.events }], undefined, 30);
    expect(ev.find((e) => e.type === 'button_press')!.syncSec).toBeCloseTo(10 + c.byId.pr.end, 3);
    expect(ev.find((e) => e.type === 'ui_appear')!.syncSec).toBeCloseTo(10 + spanAnchors(c.spans.find((s) => s.id === 'open')!).peak, 3);
  });
});

describe('interaction: cursor and target states', () => {
  const resolve = (r: string | { x: number; y: number }) => (typeof r === 'string' ? ({ folder: { x: 500, y: 1000 }, card: { x: 200, y: 400 } } as Record<string, { x: number; y: number }>)[r] : { x: r.x * 1000, y: r.y * 2000 });
  const c = compileChoreo({ timeline: [interactionPhrase({ target: 'folder', from: { x: 0.9, y: 0.95 }, leaveTo: { x: 1.05, y: 1 }, hideAfter: true })] });
  const ix = interactionOf(c);
  const id = 'folder_interaction';
  it('the phrase runs approach → hover → press → response → release → consequence in order', () => {
    const b = c.byId;
    expect(b[`${id}_approach`].start).toBeGreaterThanOrEqual(b[`${id}_appear`].end - 1e-9);
    expect(b[`${id}_hover`].start).toBe(b[`${id}_approach`].end);
    expect(b[`${id}_press`].start).toBe(b[`${id}_hover`].end);
    expect(b[`${id}_response`].start).toBe(b[`${id}_press`].end);
    expect(b[`${id}_release`].start).toBeCloseTo(b[`${id}_press`].end + 0.06, 6);
    expect(b[`${id}_consequence`].start).toBeCloseTo(b[`${id}_release`].start + 0.04, 6);
    expect(c.markers[`${id}_click`]).toBe(b[`${id}_press`].end);
  });

  it('pointer path: starts at origin, arcs, arrives on the target', () => {
    const ap = c.byId[`${id}_approach`];
    expect(cursorPoint(ix, 0, resolve)).toEqual({ x: 900, y: 1900 });
    expect(cursorPoint(ix, ap.end, resolve)).toEqual({ x: 500, y: 1000 });
    // the midpoint is off the straight line (a hand's arc)
    const mid = cursorPoint(ix, (ap.start + ap.end) / 2, resolve);
    const cross = (500 - 900) * (mid.y - 1900) - (1000 - 1900) * (mid.x - 900);
    expect(Math.abs(cross)).toBeGreaterThan(1000);
  });

  it('target responds: hover, compression held while pressed, pop on release, click pulse, released transition', () => {
    const b = c.byId;
    expect(elementAt(ix, 'folder', b[`${id}_approach`].start).hover).toBe(0);
    expect(elementAt(ix, 'folder', b[`${id}_hover`].end - 0.01).hover).toBeGreaterThan(0.9);
    const bottom = elementAt(ix, 'folder', b[`${id}_press`].end + 0.03);
    expect(bottom.press).toBeCloseTo(1, 3);
    expect(bottom.click).toBeGreaterThan(0.5);
    let minPress = 1;
    for (let t = b[`${id}_release`].start; t < b[`${id}_release`].start + 0.6; t += 1 / 120) minPress = Math.min(minPress, elementAt(ix, 'folder', t).press);
    expect(minPress).toBeLessThan(-0.01); // springs past rest: a small pop
    expect(elementAt(ix, 'folder', b[`${id}_release`].start + 1).released).toBe(1);
    expect(elementAt(ix, 'folder', 20).hover).toBe(0); // the pointer left
    const cur = cursorAt(ix, b[`${id}_press`].end, resolve);
    expect(cur.press).toBeCloseTo(1, 3);
    expect(cursorAt(ix, b[`${id}_press`].end + 0.3, resolve).ripple).toBeCloseTo(0.5, 3);
    expect(cursorAt(ix, 20, resolve).visible).toBe(0);
  });

  it('drag carries the element with the hand and releases at the end', () => {
    const d = compileChoreo({ timeline: [cursor.appear({ x: 0.5, y: 0.5 }), cursor.move('card', { id: 'mv' }), cursor.drag('card', 'folder', { id: 'dg', dur: 1 })] });
    const dix = interactionOf(d);
    expect(dix.presses).toHaveLength(1);
    expect(dix.presses[0]).toMatchObject({ target: 'card', drag: true, r0: d.byId.dg.end });
    const mid = elementAt(dix, 'card', d.byId.dg.start + 0.5, resolve);
    expect(mid.dragging).toBe(1);
    expect(Math.hypot(mid.drag.x, mid.drag.y)).toBeGreaterThan(50);
    const end = elementAt(dix, 'card', d.byId.dg.end + 1, resolve);
    expect(end.dragging).toBe(0);
    expect(end.drag.x).toBeCloseTo(300, 0);
    expect(end.drag.y).toBeCloseTo(600, 0);
  });
});

describe('camera choreography', () => {
  it('rest before the move, pushes toward the subject, settles', () => {
    const c = compileChoreo({ timeline: [cameraPhrase({ at: 1, focus: { x: 0.5, y: 0.3 }, close: 1.1, transferTo: { x: 0.6, y: 0.4 } })] });
    expect(hasCamera(c)).toBe(true);
    expect(cameraFromChoreo(c, 0.5, 1080, 1920)).toEqual({ ...REST, x: 0, y: 0 });
    const end = cameraFromChoreo(c, 10, 1080, 1920);
    expect(end.dolly).toBeCloseTo(0.09, 3);
    expect(end.x).toBeCloseTo(0.1 * 1080 * 0.14, 3);
    expect(end.y).toBeCloseTo(-0.1 * 1920 * 0.14, 3);
  });
});

describe('interaction-flow scene program', () => {
  it('every variant compiles, fits its default duration and is heard (click on the press)', () => {
    const m = SceneRegistry.get('interaction-flow')!.manifest;
    for (const v of INTERACTION_VARIANTS) {
      expect(naturalLength(v, m.example)).toBeLessThanOrEqual(m.defaultDuration - 0.7);
      const c = interactionChoreo(v, m.example, m.defaultDuration);
      const ev = m.events!(m.example, v, m.defaultDuration);
      expect(ev).toEqual(c.events);
      if (v !== 'drag') {
        const press = c.spans.find((s) => s.kind === 'press')!;
        expect(ev.find((e) => e.type === 'button_press')!.exact!.contact).toBe(press.end);
      } else expect(ev.some((e) => e.type === 'object_land')).toBe(true);
    }
  });

  it('a short scene compresses the timeline; an edited choreography replaces the built-in one', () => {
    const c = interactionChoreo('folder', {}, 3);
    expect(c.duration).toBeLessThanOrEqual(2.3 + 1e-6);
    const custom = { choreography: { timeline: [cursor.appear({ x: 0.5, y: 0.5 }), cursor.click('folder', { id: 'only' })] } };
    const k = interactionChoreo('folder', custom, 5);
    expect(Object.keys(k.byId)).toContain('only');
    expect(k.events.map((e) => e.type)).toEqual(['button_press']);
    expect(interactionSpec('folder', { items: [1, 2, 3, 4, 5] }).timeline.length).toBe(2);
  });

  it('seek reports the choreography state at t (same numbers the scene draws)', () => {
    const spec = VideoSchema.parse({
      project: { id: 'ch', title: 't', language: 'ar' },
      canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
      style: { preset: 'saudi-modern' },
      scenes: [{ id: 'a', type: 'interaction-flow', variant: 'folder', duration: 6, content: { folder: 'x' } }],
    });
    const c = interactionChoreo('folder', {}, 6);
    const press = c.spans.find((s) => s.kind === 'press')!;
    const st = seek(spec, press.end + 0.01).scenes[0].choreography!;
    expect(st.cursor!.action).toBe('press');
    expect(st.elements!.folder.press).toBeGreaterThan(0.9);
    expect(st.passed).toContain('folder_interaction_click');
    const late = seek(spec, 5.5).scenes[0].choreography!;
    expect(late.focus).toMatchObject({ cards: 1 });
    expect(late.camera!.dolly).toBeGreaterThan(0.05);
    expect(late.cursor!.visible).toBe(0);
  });
});
