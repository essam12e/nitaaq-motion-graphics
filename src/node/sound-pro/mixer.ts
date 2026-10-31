/**
 * The SFX bus (node): decodes every take once, measures it, and mixes the
 * production cue sheet into one stereo stem at 48 kHz, sample exact:
 *
 *  - each take is placed so its onset / peak / end lands on the visual moment
 *    (frame-accurate: the stem is one file, so there is no per-<Audio> rounding);
 *  - its level is set from its own loudest 50 ms against the music bed's median
 *    level in the second before the moment (earshot's bed rule), or against a
 *    fixed reference without music;
 *  - overlapping effects are kept apart: a cue that would be the 3rd+ sounding
 *    at once, or that sits on top of a louder accent, steps down;
 *  - every take gets a 2 ms fade in and a fade out at the film's end (no clicks);
 *  - the bus peak is held under −3 dBFS (no clipping before the master limiter).
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { findFfmpeg, ffEnv } from '../audio';

export const SR = 48000;

const decodeCache = new Map<string, Float32Array>();
/** Stereo interleaved float32 at 48 kHz. */
export function decodeStereo(file: string): Float32Array {
  const hit = decodeCache.get(file);
  if (hit) return hit;
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30, env: ffEnv() });
  if (r.status !== 0 || !r.stdout) throw new Error(`cannot decode ${file}: ${String(r.stderr).slice(0, 200)}`);
  const b = r.stdout as Buffer;
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  decodeCache.set(file, x);
  return x;
}

const db = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/** Per-50 ms RMS (dBFS) of a stereo signal. */
export function rms50(x: Float32Array, gain: (t: number) => number = () => 1): number[] {
  const hop = Math.round(SR * 0.05);
  const frames = Math.floor(x.length / 2 / hop);
  const out: number[] = new Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const g = gain((f + 0.5) * 0.05);
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const l = x[2 * i] * g;
      const r = x[2 * i + 1] * g;
      s += (l * l + r * r) / 2;
    }
    out[f] = 10 * Math.log10(s / hop + 1e-18);
  }
  return out;
}

export interface TakeMeasure {
  /** Seconds from file start: first audible sample (−30 dB under the peak), loudest 5 ms, last audible (−40 dB). */
  onset: number;
  peak: number;
  end: number;
  duration: number;
  /** Loudest 50 ms RMS, dBFS. */
  loud50: number;
  peakDb: number;
}

export function measureTake(file: string): TakeMeasure {
  const x = decodeStereo(file);
  const n = x.length / 2;
  const w = Math.round(SR * 0.005);
  let pk = 0;
  let pkI = 0;
  const env: number[] = [];
  for (let i = 0; i < n; i += w) {
    let m = 0;
    for (let k = i; k < Math.min(n, i + w); k++) m = Math.max(m, Math.abs(x[2 * k]), Math.abs(x[2 * k + 1]));
    env.push(m);
    if (m > pk) {
      pk = m;
      pkI = env.length - 1;
    }
  }
  const on = env.findIndex((m) => m >= pk * 10 ** (-30 / 20));
  let end = env.length - 1;
  while (end > pkI && env[end] < pk * 10 ** (-40 / 20)) end--;
  const loud = Math.max(...rms50(x), -120);
  return { onset: (Math.max(0, on) * w) / SR, peak: ((pkI + 0.5) * w) / SR, end: Math.min(n, (end + 1) * w) / SR, duration: n / SR, loud50: loud, peakDb: db(pk) };
}

/** Music bed level (median 50 ms RMS, dBFS) in the second before t, after the mix's own volume envelope. */
export function bedLevelAt(frames: number[], t: number): number {
  const a = Math.max(0, Math.floor((t - 1) / 0.05));
  const b = Math.max(a + 1, Math.floor(t / 0.05));
  const w = frames.slice(a, b).filter((v) => v > -100);
  if (!w.length) return -100;
  const s = [...w].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

export interface StemCue {
  file: string;
  /** Absolute seconds where the FILE starts (may be negative: the head is cut). */
  startSec: number;
  gain: number;
  pan: number;
}

export interface StemResult {
  samples: Float32Array;
  peakDb: number;
  trimDb: number;
}

/** Mix the cues into one stereo bus of `totalSec` (fades, equal-power pan, −3 dBFS peak ceiling). */
export function mixStem(cues: StemCue[], totalSec: number): StemResult {
  const n = Math.ceil(totalSec * SR);
  const out = new Float32Array(n * 2);
  const fadeIn = Math.round(SR * 0.002);
  const fadeEnd = Math.round(SR * 0.04);
  for (const c of cues) {
    const x = decodeStereo(c.file);
    const len = x.length / 2;
    const s0 = Math.round(c.startSec * SR);
    const pl = Math.cos(((c.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const pr = Math.sin(((c.pan + 1) * Math.PI) / 4) * Math.SQRT2;
    const head = Math.max(0, -s0);
    for (let i = head; i < len; i++) {
      const o = s0 + i;
      if (o >= n) break;
      let g = c.gain;
      if (head > 0 && i - head < fadeIn) g *= (i - head) / fadeIn; // a cut head fades in
      if (n - o < fadeEnd) g *= (n - o) / fadeEnd; // the film's end: no cut tail
      out[2 * o] += x[2 * i] * g * pl;
      out[2 * o + 1] += x[2 * i + 1] * g * pr;
    }
  }
  let pk = 0;
  for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
  const ceiling = 10 ** (-3 / 20);
  let trimDb = 0;
  if (pk > ceiling) {
    const k = ceiling / pk;
    trimDb = db(k);
    for (let i = 0; i < out.length; i++) out[i] *= k;
    pk = ceiling;
  }
  return { samples: out, peakDb: db(pk), trimDb };
}

/** 24-bit PCM stereo WAV. */
export function writeWav24(file: string, x: Float32Array): void {
  const frames = x.length / 2;
  const data = Buffer.alloc(frames * 6);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    const s = Math.round(v * 8388607);
    data.writeIntLE(s, i * 3, 3);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 6, 28);
  h.writeUInt16LE(6, 32);
  h.writeUInt16LE(24, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}
