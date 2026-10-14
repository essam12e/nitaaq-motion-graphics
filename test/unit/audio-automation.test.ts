import { describe, expect, it } from 'vitest';
import { automationGain, crossfadeGains, duckGain, endingGain, handoffAt, musicNextVolumeAt, musicVolumeAt, preEntryGain } from '../../src/audio/mix';
import { planAutomation } from '../../src/audio/music-director';
import { VideoSchema, type VideoSpec } from '../../src/schema/video';

const BASE = { project: { id: 'au', title: 't', language: 'ar' }, canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 }, style: { preset: 'saudi-modern' } };
const scenes = [{ id: 'a', type: 'title-card', duration: 5, content: { title: 'x' } }, { id: 'b', type: 'title-card', duration: 5, content: { title: 'y' } }];
const spec = (audio: object): VideoSpec => VideoSchema.parse({ ...BASE, scenes, audio }) as VideoSpec;
const music = { src: 'm.mp3', volume: 0.5, fadeIn: 0.5, fadeOut: 1, ducking: { enabled: true, level: 0.3, attack: 0.25, release: 0.6 } };
const voice = { src: 'v.mp3', offset: 0, segments: [{ start: 1, end: 3 }, { start: 3.5, end: 5 }] };

describe('Sound Director — audio automation', () => {
  it('without automation the envelope is exactly the original one', () => {
    const s = spec({ mode: 'user-voice', voice, music });
    // original formula, written out
    const sm = (x: number) => x * x * (3 - 2 * x);
    for (const t of [0, 0.2, 0.9, 2, 3.2, 5.3, 8, 9.5, 10]) {
      const fin = Math.min(1, t / 0.5);
      const fout = Math.min(1, Math.max(0, (10 - t) / 1));
      const duck = duckGain(t, [{ start: 1, end: 3 }, { start: 3.5, end: 5 }], 0.3, 0.25, 0.6);
      expect(musicVolumeAt(t, s, 10)).toBeCloseTo(0.5 * sm(fin) * sm(fout) * duck, 12);
    }
  });
  it('ducking curves: all reach the level inside the voice and 1 outside; shapes differ on the release', () => {
    const iv = [{ start: 2, end: 4 }];
    for (const c of ['smooth', 'exponential', 'linear', 'hold'] as const) {
      expect(duckGain(3, iv, 0.3, 0.25, 1, c), c).toBeCloseTo(0.3, 6);
      expect(duckGain(6, iv, 0.3, 0.25, 1, c), c).toBe(1);
    }
    // hold keeps the dip through the first half of the release; exponential is even in dB (geometric mid)
    expect(duckGain(4.4, iv, 0.3, 0.25, 1, 'hold')).toBeCloseTo(0.3, 6);
    expect(duckGain(4.5, iv, 0.3, 0.25, 1, 'exponential')).toBeCloseTo(Math.sqrt(0.3), 6);
    expect(duckGain(4.5, iv, 0.3, 0.25, 1, 'linear')).toBeCloseTo(0.65, 6);
  });
  it('gain automation interpolates points by the chosen curve, flat outside', () => {
    const p = [{ t: 1, gain: 1 }, { t: 2, gain: 0.5 }];
    expect(automationGain(0, p)).toBe(1);
    expect(automationGain(3, p)).toBe(0.5);
    expect(automationGain(1.5, p, 'linear')).toBeCloseTo(0.75);
    expect(automationGain(1.5, p, 'exponential')).toBeCloseTo(Math.sqrt(0.5));
    expect(automationGain(1.5, p, 'smooth')).toBeCloseTo(0.75);
    expect(automationGain(1.25, p, 'smooth')).toBeGreaterThan(automationGain(1.25, p, 'linear'));
  });
  it('pre-entry swells from `from` to full exactly on the moment, monotonic', () => {
    const pre = { at: 2, lead: 1, from: 0.3 };
    expect(preEntryGain(0.5, pre)).toBeCloseTo(0.3);
    expect(preEntryGain(2, pre)).toBeCloseTo(1);
    let last = 0;
    for (let t = 0.9; t <= 2.01; t += 0.05) {
      const g = preEntryGain(t, pre);
      expect(g).toBeGreaterThanOrEqual(last - 1e-9);
      last = g;
    }
  });
  it('endings all reach silence at the end and are continuous; button holds longest, ring-out decays earliest', () => {
    for (const k of ['fade', 'ring-out', 'button', 'swell'] as const) {
      expect(endingGain(0, k, 1), k).toBeCloseTo(0, 6);
      expect(endingGain(1.01, k, 1), k).toBe(1);
      for (let r = 0; r < 1; r += 0.01) expect(Math.abs(endingGain(r + 0.01, k, 1) - endingGain(r, k, 1)), `${k} @${r}`).toBeLessThan(0.12);
    }
    expect(endingGain(0.5, 'ring-out', 1)).toBeLessThan(endingGain(0.5, 'fade', 1));
    expect(Math.max(...Array.from({ length: 100 }, (_, i) => endingGain(i / 100, 'swell', 1)))).toBeGreaterThan(1.1);
  });
  it('crossfade is equal-power (out² + in² = 1) and the second cue takes over', () => {
    for (let t = 4; t <= 6.5; t += 0.1) {
      const g = crossfadeGains(t, 4.5, 1.5);
      expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 9);
    }
    const s = spec({ mode: 'none', music: { ...music, ducking: { ...music.ducking, enabled: false } }, musicNext: { src: 'm2.mp3', at: 4, crossfade: 2 } });
    expect(musicNextVolumeAt(3.9, s, 10)).toBe(0);
    expect(musicVolumeAt(6.5, s, 10)).toBeCloseTo(0, 9);
    expect(musicNextVolumeAt(6.5, s, 10)).toBeCloseTo(0.5, 6);
    // in the middle both play at −3 dB: sum of powers stays at the original level
    const a = musicVolumeAt(5, s, 10);
    const b = musicNextVolumeAt(5, s, 10);
    expect(a ** 2 + b ** 2).toBeCloseTo(0.25, 6);
  });
  it('VO → music handoff: the music rises out of the duck after the last line and lifts above its level', () => {
    const s = spec({ mode: 'user-voice', voice, music, automation: { handoff: { overlap: 0.8, lift: 1.15 } } });
    expect(handoffAt(s)).toBe(5);
    expect(musicVolumeAt(4.5, s, 10)).toBeCloseTo(0.5 * 0.3, 6);
    expect(musicVolumeAt(6.5, s, 10)).toBeCloseTo(0.5 * 1.15, 6);
    // one gesture: rising monotonically through the overlap
    let last = 0;
    for (let t = 5; t <= 6; t += 0.05) {
      const g = musicVolumeAt(t, s, 10);
      expect(g).toBeGreaterThanOrEqual(last - 1e-9);
      last = g;
    }
  });
  it('automated envelope never exceeds 1, never NaN, ends in silence', () => {
    const s = spec({ mode: 'user-voice', voice, music: { ...music, volume: 0.95 }, sidechainDb: 2, automation: { duckCurve: 'hold', preEntry: { at: 2, lead: 1.2 }, handoff: { lift: 1.5 }, ending: { kind: 'swell' }, music: [{ t: 0, gain: 1.4 }] } });
    for (let t = 0; t <= 10; t += 1 / 30) {
      const g = musicVolumeAt(t, s, 10);
      expect(Number.isFinite(g)).toBe(true);
      expect(g).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
    }
    expect(musicVolumeAt(10, s, 10)).toBeCloseTo(0, 6);
  });
  it('planAutomation decides by the film: hold under close phrases, handoff, pre-entry, ending by personality', () => {
    const a = planAutomation({ personality: 'premium', totalSec: 12, voice: [{ start: 0.5, end: 3 }, { start: 3.4, end: 7 }], firstCut: 2.5, calmOpening: true, heroSec: 6 });
    expect(a.automation.duckCurve).toBe('hold');
    expect(a.automation.handoff).toBeDefined();
    expect(a.automation.preEntry?.at).toBe(2.5);
    expect(a.automation.ending?.kind).toBe('ring-out');
    expect(a.automation.music).toBeUndefined(); // voice-led: no extra gain moves under the voice
    const b = planAutomation({ personality: 'sport', totalSec: 10, voice: [], firstCut: 1.5, calmOpening: false, heroSec: 5 });
    expect(b.automation.ending?.kind).toBe('button');
    expect(b.automation.preEntry).toBeUndefined();
    expect(b.automation.handoff).toBeUndefined();
    expect(b.automation.music?.length).toBe(3);
    expect(planAutomation({ personality: 'cinematic', totalSec: 10, voice: [] }).automation.ending?.kind).toBe('swell');
    // the pre-entry swell landing on the hero is the build: no extra step back on top of it
    const c = planAutomation({ personality: 'premium', totalSec: 20, voice: [], firstCut: 5.2, calmOpening: true, heroSec: 5.2 });
    expect(c.automation.preEntry?.at).toBe(5.2);
    expect(c.automation.music).toBeUndefined();
    // deterministic + schema-valid
    expect(planAutomation({ personality: 'premium', totalSec: 12, voice: [{ start: 0.5, end: 3 }] })).toEqual(planAutomation({ personality: 'premium', totalSec: 12, voice: [{ start: 0.5, end: 3 }] }));
    expect(() => spec({ mode: 'user-voice', voice, music, automation: a.automation })).not.toThrow();
  });
});
