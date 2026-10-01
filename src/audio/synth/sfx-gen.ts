/**
 * Code-generated SFX bank (node). Every family in src/audio/sfx-families.ts
 * gets N deterministic variants synthesised from seeded parameters (pitch,
 * length, filter, noise colour, body), written once to public/sfx/gen/*.wav
 * (gitignored, regenerated when GEN_VERSION changes). The CC0 library files
 * are measured too, so every variant carries duration, envelope-peak time and
 * loudness: the Sound Director shifts each file so its PEAK lands on the
 * motion anchor, and evens out loudness between variants.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../../core/rng';
import { ROOT } from '../../node/workspace';
import { SfxFamilyRegistry, type SfxBankIndex, type SfxVariant } from '../sfx-families';
import { SFX } from '../sfx-library';
import { SR, bandpass, brown, buf, envAD, envSwell, envelopePeak, fadeOut, highpass, lowpass, mix, mul, noise, normalize, osc, reverb, rms, saturate, wavBytes } from './dsp';

export const GEN_VERSION = 3;

type Synth = (v: number, r: () => number) => Float32Array;
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const NOTES = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5];

function whoosh(dur: number, peak: number, lo: number, hi: number, seed: string, q = 1.2, heavy = false): Float32Array {
  const n = Math.round(dur * SR);
  const x = heavy ? brown(n, seed) : noise(n, seed);
  const sweep = (t: number) => lo * Math.pow(hi / lo, t < peak ? t / peak : Math.max(0, 1 - (t - peak) / (dur - peak)) * 0.85);
  const y = bandpass(x, sweep, q);
  return mul(y, envSwell(n, peak, (dur - peak) * 0.6));
}
function tone(dur: number, f: number, decay: number, shape: 'sine' | 'tri' = 'sine', harmonics: [number, number][] = []): Float32Array {
  const n = Math.round(dur * SR);
  const o = osc(n, () => f, shape);
  for (const [h, g] of harmonics) mix(o, osc(n, () => f * h, 'sine'), g);
  return mul(o, envAD(n, 0.003, decay));
}

const SYNTHS: Record<string, Synth> = {
  'whoosh-air': (v, r) => whoosh(0.5 + r() * 0.35, 0.2 + r() * 0.15, 400 + r() * 300, 2500 + r() * 2500, `wa${v}`, 0.8 + r()),
  'whoosh-deep': (v, r) => {
    const w = whoosh(0.7 + r() * 0.4, 0.3 + r() * 0.15, 90 + r() * 60, 700 + r() * 500, `wd${v}`, 0.9, true);
    return saturate(w, 1.3);
  },
  'swoosh-fast': (v, r) => whoosh(0.22 + r() * 0.12, 0.08 + r() * 0.05, 700 + r() * 500, 5000 + r() * 3000, `sf${v}`, 1.4 + r()),
  'swipe-ui': (v, r) => {
    const d = 0.14 + r() * 0.08;
    const n = Math.round(d * SR);
    const y = bandpass(noise(n, `su${v}`), (t) => 1500 + (t / d) * (2500 + r() * 2000), 3);
    return mul(y, envSwell(n, d * 0.45, d * 0.4, 1.5));
  },
  'impact-soft': (v, r) => {
    const d = 0.45 + r() * 0.25;
    const n = Math.round(d * SR);
    const body = osc(n, (t) => (70 + r() * 40) * (1 + 1.5 * Math.exp(-t * 30)), 'sine');
    mul(body, envAD(n, 0.002, 0.25 + r() * 0.15));
    const click = lowpass(noise(n, `is${v}`), 2500 + r() * 1500);
    mul(click, envAD(n, 0.001, 0.03));
    return reverb(mix(body, click, 0.35), 0.12, 0.8, 0.3);
  },
  'impact-punch': (v, r) => {
    const d = 0.35 + r() * 0.2;
    const n = Math.round(d * SR);
    const body = osc(n, (t) => (55 + r() * 30) * (1 + 3 * Math.exp(-t * 45)), 'sine');
    mul(body, envAD(n, 0.001, 0.18 + r() * 0.1));
    const snap = highpass(noise(n, `ip${v}`), 1200);
    mul(snap, envAD(n, 0.0005, 0.04 + r() * 0.03));
    return saturate(mix(body, snap, 0.6), 2.2);
  },
  'thud-heavy': (v, r) => {
    const d = 0.55 + r() * 0.3;
    const n = Math.round(d * SR);
    const body = osc(n, (t) => (42 + r() * 20) * (1 + 1.2 * Math.exp(-t * 18)), 'sine');
    mul(body, envAD(n, 0.002, 0.4 + r() * 0.2));
    const dirt = lowpass(brown(n, `th${v}`), 400);
    mul(dirt, envAD(n, 0.001, 0.08));
    return saturate(mix(body, dirt, 0.8), 1.6);
  },
  'boom-sub': (v, r) => {
    const d = 1.1 + r() * 0.6;
    const n = Math.round(d * SR);
    const body = osc(n, (t) => (38 + r() * 14) * (1 + 0.8 * Math.exp(-t * 6)), 'sine');
    mul(body, envAD(n, 0.004, 0.9 + r() * 0.4));
    const air = lowpass(noise(n, `bs${v}`), (t) => 3000 * Math.exp(-t * 4) + 200);
    mul(air, envAD(n, 0.002, 0.25));
    return reverb(saturate(mix(body, air, 0.25), 1.4), 0.18, 1.3, 0.6);
  },
  'click-ui': (v, r) => {
    const n = Math.round(0.06 * SR);
    const y = bandpass(noise(n, `cu${v}`), 2500 + r() * 3500, 4 + r() * 4);
    return mul(y, envAD(n, 0.0003, 0.012 + r() * 0.01));
  },
  'tap-soft': (v, r) => {
    const n = Math.round(0.12 * SR);
    const body = osc(n, () => 300 + r() * 250, 'sine');
    mul(body, envAD(n, 0.001, 0.04 + r() * 0.03));
    const t = lowpass(noise(n, `ts${v}`), 1800);
    mul(t, envAD(n, 0.0005, 0.01));
    return mix(body, t, 0.4);
  },
  'button-press': (v, r) => {
    const n = Math.round(0.18 * SR);
    const click = bandpass(noise(n, `bp${v}`), 3000 + r() * 1500, 5);
    mul(click, envAD(n, 0.0003, 0.012));
    const body = osc(n, (t) => (180 + r() * 120) * (1 + Math.exp(-t * 60)), 'sine');
    mul(body, envAD(n, 0.001, 0.06));
    return mix(body, click, 0.8, 0.0);
  },
  'pop-bubble': (v, r) => {
    const d = 0.12 + r() * 0.08;
    const n = Math.round(d * SR);
    const f0 = 300 + r() * 300;
    const o = osc(n, (t) => f0 * (1 + 4 * Math.min(1, t / 0.03)), 'sine');
    return mul(o, envAD(n, 0.001, 0.05 + r() * 0.03));
  },
  'blip-digital': (v, r) => {
    const n = Math.round((0.05 + r() * 0.05) * SR);
    const o = osc(n, () => pick(r, NOTES) * (1 + Math.floor(r() * 2)), 'square');
    return mul(lowpass(o, 5000), envAD(n, 0.001, 0.025));
  },
  'tick-soft': (v, r) => {
    const n = Math.round(0.07 * SR);
    const o = osc(n, () => 1800 + r() * 1400, 'sine');
    return mul(o, envAD(n, 0.0005, 0.012 + r() * 0.01));
  },
  'chime-success': (v, r) => {
    const base = pick(r, [523.25, 587.33, 659.25]);
    const n = Math.round(1.0 * SR);
    const o = new Float32Array(n);
    const chord = r() < 0.5 ? [1, 1.25, 1.5] : [1, 1.335, 2];
    chord.forEach((k, i) => mix(o, tone(0.8, base * k, 0.5 + r() * 0.3, 'sine', [[2, 0.15]]), 0.4, i * (0.06 + r() * 0.04)));
    return reverb(o, 0.2, 1, 0.4);
  },
  'buzz-error': (v, r) => {
    const n = Math.round((0.3 + r() * 0.15) * SR);
    const f = 140 + r() * 60;
    const o = lowpass(osc(n, () => f, 'saw'), 1800);
    const am = osc(n, () => 18 + r() * 10, 'sine');
    for (let i = 0; i < n; i++) o[i] *= 0.6 + 0.4 * am[i];
    return mul(o, envAD(n, 0.005, 0.25, 0.08));
  },
  'tone-warning': (v, r) => {
    const n = Math.round(0.5 * SR);
    const f = 660 + r() * 120;
    const o = new Float32Array(n);
    mix(o, tone(0.2, f, 0.12, 'tri'), 0.5);
    mix(o, tone(0.25, f * 0.84, 0.15, 'tri'), 0.5, 0.2);
    return o;
  },
  'ding-notify': (v, r) => reverb(tone(0.7, pick(r, NOTES) * (r() < 0.4 ? 2 : 1), 0.35 + r() * 0.2, 'sine', [[2.76, 0.2], [5.4, 0.08]]), 0.15, 0.9, 0.3),
  'key-type': (v, r) => {
    const n = Math.round(0.06 * SR);
    const y = bandpass(noise(n, `kt${v}`), 1800 + r() * 1800, 2.5);
    return mul(y, envAD(n, 0.0004, 0.015));
  },
  'riser-tension': (v, r) => {
    const d = 1.2 + r() * 1.0;
    const n = Math.round(d * SR);
    const y = bandpass(noise(n, `rt${v}`), (t) => 300 * Math.pow(12 + r() * 8, t / d), 1.5);
    const o = osc(n, (t) => 200 * Math.pow(3, t / d), 'saw');
    mix(y, lowpass(o, 2500), 0.15);
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) e[i] = Math.pow(i / n, 2.4);
    return fadeOut(mul(y, e), 0.01);
  },
  'swell-reverse': (v, r) => {
    const d = 0.9 + r() * 0.7;
    const n = Math.round(d * SR);
    const x = reverb(mul(lowpass(noise(Math.round(0.25 * SR), `sr${v}`), 3000), envAD(Math.round(0.25 * SR), 0.001, 0.1)), 0.9, 1.4, d);
    const rev = new Float32Array(n);
    for (let i = 0; i < n; i++) rev[i] = x[Math.min(x.length - 1, n - 1 - i)] ?? 0;
    return fadeOut(rev, 0.005);
  },
  shimmer: (v, r) => {
    const n = Math.round(1.2 * SR);
    const o = new Float32Array(n);
    const base = pick(r, [1046.5, 1174.66, 1318.5]);
    for (let k = 0; k < 6; k++) mix(o, tone(0.6, base * [1, 1.5, 2, 2.5, 3, 4][k] * (1 + (r() - 0.5) * 0.01), 0.3 + r() * 0.2), 0.18, k * (0.03 + r() * 0.03));
    return reverb(highpass(o, 600), 0.35, 1.2, 0.6);
  },
  'glass-ting': (v, r) => reverb(tone(0.9, 1600 + r() * 1400, 0.5, 'sine', [[2.32, 0.3], [4.25, 0.15]]), 0.25, 1, 0.5),
  'light-sweep': (v, r) => {
    const d = 0.8 + r() * 0.5;
    const n = Math.round(d * SR);
    const y = bandpass(noise(n, `ls${v}`), (t) => 2000 + 6000 * Math.sin((Math.PI * t) / d), 6);
    return mul(y, envSwell(n, d * 0.5, d * 0.4, 1.6));
  },
  'coin-chime': (v, r) => {
    const n = Math.round(0.7 * SR);
    const o = new Float32Array(n);
    const f = 1318.5 + r() * 400;
    mix(o, tone(0.4, f, 0.25, 'sine', [[2.4, 0.3]]), 0.5);
    mix(o, tone(0.5, f * 1.5, 0.35, 'sine', [[2.4, 0.3]]), 0.5, 0.07);
    return o;
  },
  'logo-stinger': (v, r) => {
    const n = Math.round(1.6 * SR);
    const o = new Float32Array(n);
    const root = pick(r, [130.81, 146.83, 164.81, 110]);
    const chord = pick(r, [[1, 1.5, 2, 2.5], [1, 1.2, 1.5, 2], [1, 1.335, 2, 3]]);
    for (const k of chord) mix(o, mul(lowpass(osc(n, () => root * k, 'saw'), (t) => 600 + 3000 * Math.exp(-t * 3)), envAD(n, 0.004, 1 + r() * 0.5)), 0.2);
    const hit = osc(n, (t) => 55 * (1 + 2 * Math.exp(-t * 30)), 'sine');
    mix(o, mul(hit, envAD(n, 0.001, 0.25)), 0.6);
    return reverb(saturate(o, 1.2), 0.25, 1.3, 0.8);
  },
  'marker-stroke': (v, r) => {
    const d = 0.35 + r() * 0.35;
    const n = Math.round(d * SR);
    const y = bandpass(noise(n, `ms${v}`), (t) => 2500 + 1500 * Math.sin(t * (18 + r() * 10)), 1.8);
    const e = envAD(n, 0.02, d * 0.9, d * 0.4);
    const am = osc(n, () => 9 + r() * 6, 'sine');
    for (let i = 0; i < n; i++) e[i] *= 0.7 + 0.3 * am[i];
    return mul(y, e);
  },
  'pluck-pin': (v, r) => {
    // Karplus-Strong pluck
    const f = pick(r, [392, 440, 523.25, 587.33]);
    const n = Math.round(0.6 * SR);
    const p = Math.round(SR / f);
    const o = new Float32Array(n);
    const nz = noise(p, `pp${v}`);
    for (let i = 0; i < n; i++) o[i] = i < p ? nz[i] : 0.497 * (o[i - p] + o[i - p + 1 < i ? i - p + 1 : i - p]);
    return o;
  },
  'route-glide': (v, r) => {
    const d = 0.9 + r() * 0.6;
    const n = Math.round(d * SR);
    const o = osc(n, (t) => 300 * Math.pow(1.8, t / d), 'tri');
    return mul(lowpass(o, 1800), envSwell(n, d * 0.7, d * 0.3, 1.4));
  },
  'shutter-camera': (v, r) => {
    const n = Math.round(0.16 * SR);
    const o = new Float32Array(n);
    const c1 = bandpass(noise(n, `sc${v}`), 2200 + r() * 800, 3);
    mix(o, mul(c1, envAD(n, 0.0003, 0.02)), 1);
    mix(o, mul(bandpass(noise(n, `sd${v}`), 1500, 3), envAD(n, 0.0003, 0.02)), 0.8, 0.06 + r() * 0.02);
    return o;
  },
  'glitch-digital': (v, r) => {
    const n = Math.round((0.12 + r() * 0.1) * SR);
    const o = osc(n, () => pick(r, [220, 440, 880, 1760]), 'square');
    const gate = Math.round(SR * (0.008 + r() * 0.01));
    for (let i = 0; i < n; i++) if (Math.floor(i / gate) % 3 === 1) o[i] = 0;
    return mul(lowpass(o, 4000), envAD(n, 0.001, 0.08));
  },
  'paper-slide': (v, r) => {
    const d = 0.3 + r() * 0.2;
    const n = Math.round(d * SR);
    return mul(bandpass(noise(n, `ps${v}`), 3500 + r() * 1500, 0.8), envSwell(n, d * 0.4, d * 0.5, 1.8));
  },
};

export function sfxBankDir(): string {
  return join(ROOT, 'public', 'sfx', 'gen');
}

/** Decode any audio file to mono f32 at 44.1 kHz (ffmpeg), for measuring library sounds. */
async function decode44(file: string): Promise<Float32Array> {
  const { spawnSync } = await import('node:child_process');
  const { findFfmpeg } = await import('../../node/audio');
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`decode failed: ${file}`);
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Generate (once) and index the whole bank. Returns the index (with peak/rms metadata). */
export async function ensureSfxBank(force = false): Promise<SfxBankIndex> {
  const dir = sfxBankDir();
  const idxFile = join(dir, 'index.json');
  if (!force && existsSync(idxFile)) {
    try {
      const idx = JSON.parse(readFileSync(idxFile, 'utf8')) as SfxBankIndex;
      if (idx.version === GEN_VERSION && idx.variants.every((v) => existsSync(join(ROOT, 'public', v.file)))) return idx;
    } catch {
      /* regenerate */
    }
  }
  mkdirSync(dir, { recursive: true });
  const variants: SfxVariant[] = [];
  for (const fam of SfxFamilyRegistry.list()) {
    const synth = SYNTHS[fam.id];
    if (!synth) continue;
    for (let v = 0; v < fam.variants; v++) {
      const r = createRng(`sfx:${fam.id}:${v}:${GEN_VERSION}`).next;
      const x = fadeOut(synth(v, r), 0.008);
      normalize(x, -1.5);
      const file = `sfx/gen/${fam.id}-${v + 1}.wav`;
      writeFileSync(join(ROOT, 'public', file), wavBytes([x]));
      variants.push({ id: `${fam.id}-${v + 1}`, family: fam.id, file, duration: Math.round((x.length / SR) * 1000) / 1000, peakAt: Math.round(envelopePeak(x) * 1000) / 1000, rms: Math.round(rms(x) * 10000) / 10000, source: 'generated' });
    }
    for (const libId of fam.library ?? []) {
      const s = SFX.find((x) => x.id === libId);
      if (!s) continue;
      try {
        const x = await decode44(join(ROOT, 'public', s.file));
        variants.push({ id: `lib-${libId}`, family: fam.id, file: s.file, duration: Math.round((x.length / SR) * 1000) / 1000, peakAt: Math.round(envelopePeak(x) * 1000) / 1000, rms: Math.round(rms(x) * 10000) / 10000, source: 'library' });
      } catch {
        /* ffmpeg missing: library file stays unindexed (generated variants still cover the family) */
      }
    }
  }
  const idx: SfxBankIndex = { version: GEN_VERSION, variants };
  writeFileSync(idxFile, JSON.stringify(idx, null, 1));
  return idx;
}

export const _synthIds = () => Object.keys(SYNTHS);
export { buf };
