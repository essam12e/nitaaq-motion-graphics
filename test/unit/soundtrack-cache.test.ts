import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoSchema } from '../../src/schema/video';
import { ensureSoundtrack } from '../../src/node/sound';

const makeSpec = () =>
  VideoSchema.parse({
    project: { id: 'st-cache', title: 'soundtrack cache', language: 'ar' },
    canvas: { aspect: '9:16', width: 1080, height: 1920, fps: 30 },
    platform: 'generic',
    style: { preset: 'saudi-modern' },
    modules: ['soundtrack'],
    audio: { mode: 'none' },
    scenes: [
      { id: 's1', type: 'kinetic-title', duration: 3, content: { title: 'أهلاً' } },
      { id: 's2', type: 'cta-clean', duration: 3, content: { title: 'ابدأ الآن' } },
    ],
  });

describe('procedural soundtrack reuse', () => {
  it('attaches the cached track on a re-run of the same project (same spec, music kept)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nmg-st-'));
    try {
      const a = makeSpec();
      const r1 = await ensureSoundtrack(a, dir);
      expect(r1.composed).toBe(true);
      const b = makeSpec();
      const r2 = await ensureSoundtrack(b, dir);
      expect(r2.composed).toBe(false);
      expect(b.audio.music?.src).toBe('soundtrack');
      expect(b.assets.soundtrack).toEqual(a.assets.soundtrack);
      expect(b.audio.soundtrack).toEqual(a.audio.soundtrack);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
