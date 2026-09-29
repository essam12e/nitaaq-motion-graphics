import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTimeline } from '../../src/core/timeline';
import { stripToolMetadata } from '../../src/node/render';
import { assertInsideProject } from '../../src/node/assets';
import { scrubSecrets } from '../../studio/server';
import { redact } from '../../src/core/logger';
import { makeCanvasProfile } from '../../src/layout/canvas';

describe('timeline', () => {
  it('overlaps scenes by the transition and caps it at 45% of a scene', () => {
    const tl = buildTimeline([{ id: 'a', duration: 2, transition: { type: 'push', duration: 0.5 } }, { id: 'b', duration: 1, transition: { type: 'push', duration: 2 } }, { id: 'c', duration: 2 }], 30);
    // 0.5 s = 15 frames, capped at 45% of the 1 s next scene (13 frames)
    expect(tl.entries[1].from).toBe(60 - 13);
    expect(tl.entries[1].transitionOut).toBeLessThanOrEqual(Math.floor(30 * 0.45));
    expect(tl.totalFrames).toBe(tl.entries[2].from + 60);
  });
});

describe('safe areas', () => {
  it('keeps TikTok 9:16 content clear of the bottom UI', () => {
    const c = makeCanvasProfile(1080, 1920, 'tiktok');
    expect(c.safe.y + c.safe.height).toBeLessThanOrEqual(1920 * 0.8 + 1);
    expect(c.isTall).toBe(true);
  });
});

describe('zero watermark & secrets', () => {
  it('removes the encoder "Made with Remotion" tag', () => {
    const args = stripToolMetadata(['-i', 'x', '-metadata', 'comment=Made with Remotion', '-c:v', 'libx264']);
    expect(args.join(' ')).not.toMatch(/remotion/i);
    expect(args).toContain('libx264');
  });
  it('scrubs credential-like fields from studio saves', () => {
    const out = scrubSecrets({ a: 1, apiKey: 'x', nested: { ELEVENLABS_API_KEY: 'y', token: 'z', ok: 'sk-abcdefghijklmnopqrstuvwx' } }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/apiKey|API_KEY|token|sk-/);
    expect(out.a).toBe(1);
  });
  it('redacts secrets from logs', () => {
    process.env.TEST_SECRET_KEY = 'supersecretvalue123';
    expect(redact('using supersecretvalue123 now')).not.toContain('supersecretvalue123');
    expect(redact('xi-api-key: abcdefghijklmnop123')).toContain('[REDACTED]');
    delete process.env.TEST_SECRET_KEY;
  });
  it('blocks path traversal out of a project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'amd-'));
    expect(() => assertInsideProject(dir, '../../etc/passwd')).toThrow();
    expect(assertInsideProject(dir, 'assets/logo.png')).toContain(dir);
  });
});
