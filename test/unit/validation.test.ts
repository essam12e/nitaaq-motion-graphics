import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VideoSchema, type VideoSpec } from '../../src/schema/video';
import { validateSpec } from '../../src/validation/validate';
import { repairSpec } from '../../src/validation/repair';
import { applyQcRepairs, blockingUnrepairable } from '../../src/qc/repair-loop';
import type { QualityReport } from '../../src/qc/quality';

const demo = (): VideoSpec => VideoSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../src/remotion/demo-spec.json'), 'utf8')));
const codes = (s: VideoSpec) => validateSpec(s).map((i) => `${i.severity}:${i.code}`);

describe('video.json validation', () => {
  it('the demo spec is valid', () => {
    expect(validateSpec(demo()).filter((i) => i.severity === 'critical' || i.severity === 'error')).toEqual([]);
  });
  it('rejects developer signatures / watermarks as critical', () => {
    const s = demo();
    (s.scenes[0].content as Record<string, unknown>).subtitle = 'Made with NITAAQ | Motion Graphics';
    expect(codes(s)).toContain('critical:DEVELOPER_SIGNATURE');
    const s2 = demo();
    (s2.scenes[0].content as Record<string, unknown>).subtitle = 'تابعونا @med3bbas';
    expect(codes(s2)).toContain('critical:DEVELOPER_SIGNATURE');
  });
  it('flags example/placeholder data sources as critical', () => {
    const s = demo();
    s.scenes.push({ ...s.scenes[0], id: 'k', type: 'stat-highlight', variant: undefined, content: { value: 90, label: 'رضا', source: 'example' } });
    expect(codes(s)).toContain('critical:PLACEHOLDER_DATA');
  });
  it('flags invalid scene content as critical (never guessed)', () => {
    const s = demo();
    s.scenes[0].content = {};
    expect(codes(s)).toContain('critical:SCENE_CONTENT_INVALID');
  });
});

describe('auto repair', () => {
  it('repairs structure but never the user’s words', () => {
    const s = demo();
    s.scenes[0].type = 'title'; // alias
    s.scenes[0].variant = 'nope';
    s.scenes[0].duration = 60;
    s.scenes[1].transition = { type: 'teleport', duration: 3 };
    s.canvas.width = 1000;
    const before = s.scenes.map((x) => JSON.stringify(x.content));
    const r = repairSpec(s, {});
    expect(r.ok).toBe(true);
    expect(r.spec.scenes[0].type).toBe('kinetic-title');
    expect(r.spec.scenes[0].variant).not.toBe('nope');
    expect(r.spec.scenes[0].duration).toBeLessThanOrEqual(12);
    expect(r.spec.scenes[1].transition?.type).toBe('crossfade');
    expect(r.spec.canvas.width).toBe(1080);
    expect(r.spec.scenes.map((x) => JSON.stringify(x.content))).toEqual(before);
    expect(r.repairs.length).toBeGreaterThan(0);
  });
  it('leaves content problems unrepaired and not ok', () => {
    const s = demo();
    s.scenes[0].content = {};
    expect(repairSpec(s, {}).ok).toBe(false);
  });
});

describe('QC repair loop mapping', () => {
  const report = (issues: QualityReport['issues']): QualityReport => ({ version: '2.0', project: 'x', video: null, stage: 'structure', createdAt: '', passed: false, summary: { info: 0, warning: 0, error: 0, critical: 0 }, scores: { structure: 0, design: 0, motion: 0, technical: 0, overall: 0 }, acceptance: [], critique: [], checks: {}, issues, samples: [], timings: {} });
  it('maps findings to safe layout/timing changes', () => {
    const s = demo();
    const r = applyQcRepairs(s, report([
      { severity: 'critical', code: 'TEXT_FIT_FAIL', message: '', sceneIndex: 0, repair: { action: 'shrink-text' } },
      { severity: 'warning', code: 'LAYOUT_UNDERFILLED', message: '', sceneIndex: 1, repair: { action: 'grow-layout', value: 1.2 } },
      { severity: 'error', code: 'HOLD_TOO_SHORT', message: '', sceneIndex: 2, repair: { action: 'extend', value: 0.5 } },
    ]), 1);
    expect(r.spec.scenes[0].layout.textScale).toBeLessThan(1);
    expect(r.spec.scenes[1].layout.scale).toBeCloseTo(1.2);
    expect(r.spec.scenes[2].duration).toBeCloseTo(s.scenes[2].duration + 0.5);
    expect(r.spec.scenes.map((x) => x.content)).toEqual(s.scenes.map((x) => x.content));
  });
  it('does not stretch scenes that are synced to a voiceover', () => {
    const s = demo();
    s.audio.voice = { src: 'audio/v.wav', offset: 0, volume: 1, segments: [], provider: 'user', processed: false };
    const r = applyQcRepairs(s, report([{ severity: 'error', code: 'HOLD_TOO_SHORT', message: '', sceneIndex: 0, repair: { action: 'extend', value: 1 } }]), 1);
    expect(r.spec.scenes[0].duration).toBe(s.scenes[0].duration);
  });
  it('stops on findings that have no safe automatic fix', () => {
    expect(blockingUnrepairable(report([{ severity: 'critical', code: 'MEDIA_BROKEN', message: '' }])).length).toBe(1);
  });
});
