/**
 * Sound Production: roles, profiles, licence gate, Openverse (mocked network), tuning, the SFX bus.
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { designPro, roleFor } from '../../src/audio/pro/design';
import { PROFILES } from '../../src/audio/pro/profiles';
import { FAMILY_ROLE, ROLE_RULES } from '../../src/audio/pro/roles';
import { licenseStatus, normaliseLicense, creditLine } from '../../src/audio/pro/license';
import { SfxFamilyRegistry } from '../../src/audio/sfx-families';
import type { MotionEvent } from '../../src/audio/events';
import type { SfxCue } from '../../src/schema/video';
import { openverseUrl, searchOpenverse, stockRole, type OpenverseAudio } from '../../src/node/sound-pro/openverse';
import { tuneNote } from '../../src/node/sound-pro';
import { mixStem, SR, writeWav24, measureTake } from '../../src/node/sound-pro/mixer';

const ev = (type: MotionEvent['type'], t: number, o: Partial<MotionEvent> = {}): MotionEvent => ({
  type,
  at: 0,
  importance: 0.6,
  sceneId: 's1',
  sceneIndex: 0,
  element: 'product',
  startSec: t - 0.4,
  anchors: { start: t - 0.4, peak: t - 0.1, contact: t, settle: t + 0.3, completion: t + 0.6 },
  anchor: 'contact',
  syncSec: t,
  mass: 'medium',
  speed: 1,
  distance: 0.5,
  direction: 'down',
  impact: 0.6,
  sceneEnergy: 0.6,
  ...o,
} as MotionEvent);
const cue = (family: string, t: number, o: Partial<SfxCue> = {}): SfxCue => ({ sceneId: 's1', sound: `${family}-1`, family, file: `sfx/gen/${family}-1.wav`, atSec: Math.max(0, t - 0.05), volume: 0.5, duration: 0.5, anchorSec: t, layer: 'single', pan: 0, ...o });

describe('Sound Production roles', () => {
  it('every Sound Director family has a production role with placement rules', () => {
    for (const f of SfxFamilyRegistry.list()) {
      expect(FAMILY_ROLE[f.id], f.id).toBeDefined();
      expect(ROLE_RULES[FAMILY_ROLE[f.id]]).toBeDefined();
    }
  });
  it('a heavy element turns a short whoosh into a long one; premium softens a light hit into a landing', () => {
    expect(roleFor(cue('whoosh-air', 2, { layer: 'movement' }), ev('product_entry', 2, { mass: 'heavy' }), PROFILES.premium)).toBe('whoosh.long');
    expect(roleFor(cue('impact-punch', 2), ev('product_land', 2, { mass: 'light' }), PROFILES.premium)).toBe('land');
    expect(roleFor(cue('impact-punch', 2), ev('product_land', 2, { mass: 'heavy' }), PROFILES.premium)).toBe('hit');
  });
  it('every profile names only roles that exist, and each role it voices has a sound', () => {
    for (const p of Object.values(PROFILES)) for (const [r, ids] of Object.entries(p.earshot)) {
      expect(ROLE_RULES[r as keyof typeof ROLE_RULES]).toBeDefined();
      expect(ids!.length).toBeGreaterThan(0);
    }
  });
});

describe('designPro', () => {
  const events = [ev('product_entry', 1, { importance: 0.5 }), ev('product_land', 1.6, { importance: 0.9 }), ev('logo_reveal', 5, { importance: 0.9, sceneId: 's2' }), ev('ui_appear', 3, { importance: 0.35 })];
  const cues = [cue('whoosh-air', 1.5, { layer: 'movement', event: 'product_land' }), cue('impact-soft', 1.6, { layer: 'impact', event: 'product_land' }), cue('shimmer', 1.65, { layer: 'detail', event: 'product_land' }), cue('tick-soft', 3, { event: 'ui_appear' }), cue('logo-stinger', 5, { sceneId: 's2', event: 'logo_reveal', layer: 'impact' })];
  const base = { cues, events, totalSec: 6, seed: 'x' };

  it('premium keeps two layers on a moment, drops ticks, rings the logo out before the end', () => {
    const r = designPro({ ...base, profile: PROFILES.premium });
    const land = r.items.filter((i) => Math.abs((i.base.anchorSec ?? 0) - 1.6) < 0.2);
    expect(land.length).toBeLessThanOrEqual(2);
    expect(r.items.some((i) => i.role === 'tick')).toBe(false);
    const sting = r.items.find((i) => i.role === 'sting')!;
    expect(sting.source.kind).toBe('earshot');
    if (sting.source.kind === 'earshot') expect(sting.source.maxDur).toBeLessThanOrEqual(1.26);
    expect(r.dropped.some((d) => /layer|silent|importance/.test(d.why))).toBe(true);
  });
  it('minimal keeps only the key moments, one layer each', () => {
    const r = designPro({ ...base, profile: PROFILES.minimal });
    expect(r.items.every((i) => i.importance >= 0.7)).toBe(true);
    expect(r.items.length).toBeLessThanOrEqual(2);
  });
  it('a whoosh is aimed at the move: its apex is the lead into the moment', () => {
    const r = designPro({ ...base, profile: PROFILES.sport });
    const w = r.items.find((i) => i.role.startsWith('whoosh'));
    expect(w).toBeDefined();
    if (w && w.source.kind === 'earshot') {
      expect(w.source.dur).toBeGreaterThan(w.source.apex!);
      expect(w.source.apex).toBeGreaterThan(0.1);
    }
  });
  it('a cleared library recording is used before a generated sound; uisfx voices interface moments', () => {
    const r = designPro({ ...base, cues: [...cues, cue('ding-notify', 4, { event: 'notification' })], events: [...events, ev('notification', 4, { importance: 0.8 })], profile: PROFILES.tech, library: [{ id: 'openverse:abc', role: 'land', file: '/x.wav', duration: 0.4, source: 'library' }], uisfx: { notification: '/n.mp3' } });
    expect(r.items.find((i) => i.role === 'land')?.source.kind).toBe('library');
    expect(r.items.find((i) => i.role === 'notify')?.source.kind).toBe('uisfx');
  });
  it('details under the voice are dropped, accents step down', () => {
    const r = designPro({ ...base, profile: PROFILES.tech, voice: [{ start: 0, end: 6 }] });
    expect(r.items.some((i) => i.role === 'tick')).toBe(false);
    const premiumNoVoice = designPro({ ...base, profile: PROFILES.tech });
    const a = r.items.find((i) => i.role === 'sting')!;
    const b = premiumNoVoice.items.find((i) => i.role === 'sting')!;
    expect(a.relDb).toBeLessThan(b.relDb);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(designPro({ ...base, profile: PROFILES.premium }))).toBe(JSON.stringify(designPro({ ...base, profile: PROFILES.premium })));
  });
});

describe('licence gate', () => {
  it('clears CC0 / PDM / BY, sends BY-SA to review, blocks NC (commercial), ND and unknown', () => {
    expect(licenseStatus({ code: 'cc0' }).status).toBe('cleared');
    expect(licenseStatus({ code: 'pdm' }).status).toBe('cleared');
    const by = licenseStatus({ code: 'by' });
    expect(by.status).toBe('cleared');
    expect(by.attribution).toBe(true);
    expect(licenseStatus({ code: 'by-sa' }).status).toBe('review');
    expect(licenseStatus({ code: 'by-nc' }).status).toBe('blocked');
    expect(licenseStatus({ code: 'by-nc' }, false).status).toBe('cleared');
    expect(licenseStatus({ code: 'by-nd' }).status).toBe('blocked');
    expect(licenseStatus({ code: '' }).status).toBe('blocked');
    expect(licenseStatus({ code: 'weird' }).status).toBe('blocked');
  });
  it('normalises source spellings', () => {
    expect(normaliseLicense('CC0')).toBe('cc0');
    expect(normaliseLicense('CC-BY-4.0')).toBe('by');
    expect(normaliseLicense('by-nc')).toBe('by-nc');
  });
  it('writes a credit line with author, licence and source', () => {
    expect(creditLine({ code: 'by', version: '4.0', title: 'Swoosh', author: 'Ann', provider: 'Openverse / freesound', url: 'https://creativecommons.org/licenses/by/4.0/' })).toMatch(/"Swoosh" by Ann.*CC BY 4\.0/);
  });
});

describe('Openverse (network mocked)', () => {
  it('asks for short commercial-use sound effects only', () => {
    const u = new URL(openverseUrl('whoosh', { commercial: true }));
    expect(u.pathname).toBe('/v1/audio/');
    expect(u.searchParams.get('license_type')).toBe('commercial');
    expect(u.searchParams.get('license')).toBe('cc0,pdm,by');
    expect(u.searchParams.get('category')).toBe('sound_effect');
    expect(u.searchParams.get('length')).toBe('short');
  });
  it('fails softly when Openverse is unreachable', async () => {
    const r = await searchOpenverse('whoosh', {}, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/unreachable/);
  });
  it('stocks only cleared sounds, records the licence and reuses what it has', async () => {
    process.env.NITAAQ_SOUND_LIBRARY = mkdtempSync(join(tmpdir(), 'nitaaq-lib-'));
    // a real 0.4 s WAV (decaying noise burst) served as the "download"
    const wav = join(process.env.NITAAQ_SOUND_LIBRARY, 'src.wav');
    const x = new Float32Array(Math.round(0.4 * SR) * 2);
    for (let i = 0; i < x.length / 2; i++) x[2 * i] = x[2 * i + 1] = Math.sin(i * 0.05) * Math.exp(-i / (SR * 0.08)) * 0.6;
    writeWav24(wav, x);
    const results: OpenverseAudio[] = [
      { id: 'nc1', title: 'NC whoosh', url: 'https://x/nc.wav', license: 'by-nc', creator: 'A', filetype: 'wav', duration: 400 },
      { id: 'by1', title: 'Whoosh', url: 'https://x/by.wav', license: 'by', license_version: '4.0', creator: 'Bea', foreign_landing_url: 'https://freesound.org/s/1', filetype: 'wav', duration: 400, source: 'freesound' },
      { id: 'cc1', title: 'Air', url: 'https://x/cc.wav', license: 'cc0', creator: 'C', filetype: 'wav', duration: 400 },
    ];
    const fetcher = async (u: string) => (u.includes('/audio/?') ? new Response(JSON.stringify({ results })) : new Response(readFileSync(wav)));
    const r = await stockRole('whoosh.short', 'whoosh', { limit: 3 }, fetcher as never);
    expect(r.added.map((e) => e.id).sort()).toEqual(['openverse:by1', 'openverse:cc1']);
    expect(r.rejected[0].why).toMatch(/non-commercial/);
    const by = r.added.find((e) => e.id === 'openverse:by1')!;
    expect(by.license.author).toBe('Bea');
    expect(by.license.landing).toBe('https://freesound.org/s/1');
    expect(existsSync(by.file)).toBe(true);
    const again = await stockRole('whoosh.short', 'whoosh', { limit: 3 }, fetcher as never);
    expect(again.added.length).toBe(0);
    expect(again.reused.length).toBe(2);
    delete process.env.NITAAQ_SOUND_LIBRARY;
  });
});

describe('tuning and the SFX bus', () => {
  it('tunes a tonal sound to the nearest chord tone of the score', () => {
    expect(tuneNote('B5', 'D minor')).toBe('A5'); // D F A: A5 is 2 st under B5
    expect(tuneNote('E6', 'C major')).toBe('E6');
    expect(tuneNote(undefined, 'C major')).toBeUndefined();
  });
  it('places a take sample-exact, fades at the film end and keeps the bus under −3 dBFS', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nitaaq-bus-'));
    const f = join(dir, 'click.wav');
    const x = new Float32Array(Math.round(0.2 * SR) * 2);
    for (let i = 100; i < 400; i++) x[2 * i] = x[2 * i + 1] = 0.9; // onset at sample 100
    writeWav24(f, x);
    const m = measureTake(f);
    expect(m.onset).toBeCloseTo(100 / SR, 2);
    const s = mixStem([{ file: f, startSec: 1 - m.onset, gain: 4, pan: 0 }, { file: f, startSec: 1.9, gain: 1, pan: 0.5 }], 2);
    expect(s.peakDb).toBeLessThanOrEqual(-2.99);
    expect(s.trimDb).toBeLessThan(0);
    // first non-zero sample of the first take sits at 1.0 s (±5 ms window of the onset detector)
    let first = 0;
    while (Math.abs(s.samples[2 * first]) < 1e-6) first++;
    expect(Math.abs(first / SR - 1)).toBeLessThan(0.006);
    expect(Math.abs(s.samples[s.samples.length - 2])).toBeLessThan(1e-3);
  });
});

describe('the SFX bus reaches the renderer', () => {
  it('stages audio/sfx-stem.wav with the project assets', async () => {
    const { referencedFiles } = await import('../../src/node/assets');
    const spec = { assets: {}, scenes: [], audio: { sfx: { overrides: {}, stem: 'audio/sfx-stem.wav' } } } as never;
    expect(referencedFiles(spec)).toContain('audio/sfx-stem.wav');
  });
});
