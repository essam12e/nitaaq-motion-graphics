/**
 * Tiny deterministic DSP kit (pure TypeScript) for code-generated SFX and
 * soundtracks: seeded noise, oscillators, envelopes, one-pole / biquad
 * filters, saturation, simple reverb, and a 16-bit WAV writer.
 * Same seed → bit-identical output. No Math.random, no wall clock.
 */
import { createRng } from '../../core/rng';

export const SR = 44100;

export const buf = (sec: number) => new Float32Array(Math.max(1, Math.round(sec * SR)));

export function noise(n: number, seed: string | number): Float32Array {
  const r = createRng(seed).next;
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = r() * 2 - 1;
  return o;
}

/** Brown-ish noise (integrated white) for rumbles and air. */
export function brown(n: number, seed: string | number): Float32Array {
  const w = noise(n, seed);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (y + 0.02 * w[i]) / 1.02;
    w[i] = y * 3.5;
  }
  return w;
}

/** Oscillator with per-sample frequency (Hz) function. */
export function osc(n: number, freq: (t: number) => number, shape: 'sine' | 'tri' | 'saw' | 'square' = 'sine', phase0 = 0): Float32Array {
  const o = new Float32Array(n);
  let ph = phase0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += freq(t) / SR;
    const p = ph - Math.floor(ph);
    o[i] = shape === 'sine' ? Math.sin(2 * Math.PI * p) : shape === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : shape === 'saw' ? 2 * p - 1 : p < 0.5 ? 1 : -1;
  }
  return o;
}

/** Attack/decay envelope (exponential decay), optional hold. */
export function envAD(n: number, attack: number, decay: number, hold = 0, curve = 4): Float32Array {
  const o = new Float32Array(n);
  const a = Math.max(1, attack * SR);
  const h = hold * SR;
  for (let i = 0; i < n; i++) {
    if (i < a) o[i] = Math.pow(i / a, 1.6);
    else if (i < a + h) o[i] = 1;
    else o[i] = Math.exp((-(i - a - h) / SR / Math.max(1e-4, decay)) * curve * 0.25);
  }
  return o;
}

/** Swell envelope: rises to a peak at `peak` seconds, then falls (whooshes). */
export function envSwell(n: number, peak: number, tail: number, shape = 2.2): Float32Array {
  const o = new Float32Array(n);
  const p = Math.max(1, peak * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    o[i] = i < p ? Math.pow(i / p, shape) : Math.exp(-(t - peak) / Math.max(1e-3, tail) * 3);
  }
  return o;
}

export const mul = (a: Float32Array, b: Float32Array | number) => {
  for (let i = 0; i < a.length; i++) a[i] *= typeof b === 'number' ? b : b[i] ?? 0;
  return a;
};
export const mix = (dst: Float32Array, src: Float32Array, gain = 1, offsetSec = 0) => {
  const off = Math.round(offsetSec * SR);
  for (let i = 0; i < src.length; i++) {
    const j = i + off;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
  return dst;
};

/** One-pole low-pass with per-sample cutoff (Hz). */
export function lowpass(x: Float32Array, cutoff: number | ((t: number) => number)): Float32Array {
  let y = 0;
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff(i / SR);
    const a = 1 - Math.exp((-2 * Math.PI * Math.max(10, fc)) / SR);
    y += a * (x[i] - y);
    o[i] = y;
  }
  return o;
}
export function highpass(x: Float32Array, cutoff: number): Float32Array {
  const lp = lowpass(x, cutoff);
  const o = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) o[i] = x[i] - lp[i];
  return o;
}

/** RBJ biquad band-pass with per-sample centre frequency. */
export function bandpass(x: Float32Array, center: number | ((t: number) => number), q = 2): Float32Array {
  const o = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const f = Math.min(SR * 0.45, Math.max(20, typeof center === 'number' ? center : center(i / SR)));
    const w = (2 * Math.PI * f) / SR;
    const al = Math.sin(w) / (2 * q);
    const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al;
    const y = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    o[i] = y;
  }
  return o;
}

export function saturate(x: Float32Array, drive = 1.5): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k;
  return x;
}

/** Small feedback-comb reverb (deterministic) for space/tails. */
export function reverb(x: Float32Array, wet = 0.25, size = 1, tailSec = 0.6): Float32Array {
  const out = new Float32Array(x.length + Math.round(tailSec * SR));
  out.set(x);
  const delays = [1116, 1188, 1277, 1356].map((d) => Math.round(d * size * (SR / 44100)));
  const fb = 0.78;
  for (const d of delays) {
    const line = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const v = (i < x.length ? x[i] : 0) + (i >= d ? line[i - d] * fb : 0);
      line[i] = v;
    }
    for (let i = 0; i < out.length; i++) out[i] += (line[i] * wet) / delays.length;
  }
  return out;
}

export function fadeOut(x: Float32Array, sec = 0.02): Float32Array {
  const n = Math.min(x.length, Math.round(sec * SR));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/** Normalise to a peak (dBFS) and report where the peak is. */
export function normalize(x: Float32Array, peakDb = -1): { peak: number; peakAt: number } {
  let m = 0;
  let at = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > m) {
      m = a;
      at = i;
    }
  }
  const target = Math.pow(10, peakDb / 20);
  if (m > 0) mul(x, target / m);
  return { peak: target, peakAt: at / SR };
}

/** Peak time of the smoothed envelope (perceived "hit" moment, 10 ms RMS window). */
export function envelopePeak(x: Float32Array): number {
  const w = Math.round(0.01 * SR);
  let best = 0;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] * x[i];
    if (i >= w) acc -= x[i - w] * x[i - w];
    if (acc > best) {
      best = acc;
      at = i - w / 2;
    }
  }
  return Math.max(0, at / SR);
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** 16-bit PCM WAV (mono or interleaved stereo). */
export function wavBytes(ch: Float32Array[], sampleRate = SR): Buffer {
  const n = ch[0].length;
  const c = ch.length;
  const data = Buffer.alloc(n * c * 2);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < c; k++) {
      const v = Math.max(-1, Math.min(1, ch[k][i] ?? 0));
      data.writeInt16LE(Math.round(v * 32767), (i * c + k) * 2);
    }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(c, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * c * 2, 28);
  h.writeUInt16LE(c * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
