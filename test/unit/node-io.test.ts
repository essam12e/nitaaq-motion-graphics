import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSpeechSegments, probe } from '../../src/node/audio';
import { ingestAsset, sha1File } from '../../src/node/assets';
import { brandFromLogo } from '../../src/brand/logo-analyzer';
import { contrastRatio } from '../../src/brand/color';
import { requireVoiceProvider } from '../../src/node/tts';
import { checkFontFile } from '../../src/node/fonts';

const fx = (f: string) => join(__dirname, '../fixtures', f);

describe('audio', () => {
  it('detects the phrases of a voiceover within 0.1 s', () => {
    const truth = JSON.parse(readFileSync(fx('simulated-voice.timing.json'), 'utf8')).phrases as { start: number; end: number }[];
    const got = detectSpeechSegments(fx('simulated-voice.wav')).segments;
    expect(got).toHaveLength(truth.length);
    got.forEach((g, i) => {
      expect(Math.abs(g.end - truth[i].end)).toBeLessThan(0.1);
      if (i > 0) expect(Math.abs(g.start - truth[i].start)).toBeLessThan(0.1);
    });
  });
  it('probes music duration', () => {
    expect(probe(fx('music-bed.mp3')).duration).toBeGreaterThan(30);
  });
  it('refuses to fall back to a robotic voice', () => {
    const saved = { e: process.env.ELEVENLABS_API_KEY, o: process.env.OPENAI_API_KEY };
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(() => requireVoiceProvider()).toThrow(/premium voice provider/);
    if (saved.e) process.env.ELEVENLABS_API_KEY = saved.e;
    if (saved.o) process.env.OPENAI_API_KEY = saved.o;
  });
});

describe('assets & brand', () => {
  it('copies user files byte-identical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amd-'));
    const a = await ingestAsset(dir, fx('product.png'), 'product', 'product');
    expect(sha1File(join(dir, a.src))).toBe(sha1File(fx('product.png')));
    expect(a.hasAlpha).toBe(true);
  });
  it('rejects a non-image as a logo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'amd-'));
    await expect(ingestAsset(dir, fx('music-bed.mp3'), 'logo')).rejects.toThrow(/image/);
  });
  it('derives a contrast-safe palette from a logo', async () => {
    const { brand } = await brandFromLogo(fx('test-logo.png'), { projectRelativeLogo: 'assets/logo.png' });
    expect(brand.source).toBe('logo');
    expect(brand.logo).toBe('assets/logo.png');
    expect(contrastRatio(brand.textPrimary, brand.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('fonts', () => {
  it('verifies Arabic support of a font file', () => {
    const ok = checkFontFile(join(__dirname, '../../public/fonts/cairo', readdir('cairo')));
    expect(ok.arabicCapable).toBe(true);
    const latin = checkFontFile(join(__dirname, '../../public/fonts/inter', readdir('inter')));
    expect(latin.arabicCapable).toBe(false);
  });
});
function readdir(id: string): string {
  // first woff2 of the family that covers the relevant script
  const files = readdirSync(join(__dirname, '../../public/fonts', id)).filter((f: string) => f.endsWith('.woff2'));
  return files.find((f: string) => f.includes('arabic-700')) ?? files.find((f: string) => f.includes('latin-400')) ?? files[0];
}
