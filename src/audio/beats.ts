/**
 * Beat engine (pure TypeScript, no native deps): onset envelope by spectral
 * flux → tempo by autocorrelation with a tempo prior → beat positions by
 * dynamic programming (Ellis 2007) → downbeats (4/4 phase with the strongest
 * low-band accents) → onsets by adaptive peak picking → energy curve.
 *
 * Input: mono Float32 samples. Output is plain data (beats.json).
 */

export interface BeatAnalysis {
  version: 1;
  duration: number;
  sampleRate: number;
  bpm: number;
  /** 0..1 — how clearly periodic the onset envelope is. */
  confidence: number;
  beats: number[];
  downbeats: number[];
  onsets: number[];
  energy: { hop: number; values: number[] };
  /** Times of the strongest energy rises (drops, hits) — candidates for hero cuts. */
  peaks: number[];
}

const HOP = 512;
const WIN = 1024;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Onset strength per hop (spectral flux of log magnitude) + low-band flux for downbeats. */
export function onsetEnvelope(x: Float32Array, sr: number): { env: Float64Array; low: Float64Array; rate: number } {
  const frames = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1);
  const env = new Float64Array(frames);
  const low = new Float64Array(frames);
  const hann = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const bins = WIN / 2;
  const lowBin = Math.max(2, Math.round((200 * WIN) / sr));
  let prev = new Float64Array(bins);
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = x[o + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float64Array(bins);
    let flux = 0;
    let lflux = 0;
    for (let k = 1; k < bins; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) {
        flux += d;
        if (k <= lowBin) lflux += d;
      }
    }
    env[f] = flux;
    low[f] = lflux;
    prev = mag;
  }
  // remove the slow trend (local mean) and half-wave rectify
  const w = 16;
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, f - w); k <= Math.min(frames - 1, f + w); k++) {
      s += env[k];
      c++;
    }
    out[f] = Math.max(0, env[f] - s / c);
  }
  const mx = out.reduce((a, b) => Math.max(a, b), 1e-9);
  for (let f = 0; f < frames; f++) out[f] /= mx;
  return { env: out, low, rate: sr / HOP };
}

/** Tempo (BPM) by autocorrelation weighted by a log-normal prior around 120 BPM. */
export function estimateTempo(env: Float64Array, rate: number, min = 60, max = 190): { bpm: number; period: number; confidence: number } {
  const lagMin = Math.floor((60 * rate) / max);
  const lagMax = Math.ceil((60 * rate) / min);
  const n = env.length;
  const ac = new Float64Array(lagMax + 2);
  let zero = 0;
  for (let i = 0; i < n; i++) zero += env[i] * env[i];
  for (let lag = lagMin; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    ac[lag] = s / Math.max(1, n - lag);
  }
  let best = lagMin;
  let bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = (60 * rate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    // harmonic support: a true beat period also correlates at 2× lag
    const h = lag * 2 <= lagMax + 1 ? ac[lag * 2] * 0.5 : 0;
    const score = (ac[lag] + h) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // parabolic refinement
  const y0 = ac[best - 1] ?? ac[best];
  const y1 = ac[best];
  const y2 = ac[best + 1] ?? ac[best];
  const den = y0 - 2 * y1 + y2;
  const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  const period = best + shift;
  const mean = zero / Math.max(1, n);
  const confidence = Math.max(0, Math.min(1, mean > 0 ? y1 / mean : 0));
  return { bpm: Math.round(((60 * rate) / period) * 10) / 10, period, confidence: Math.round(confidence * 100) / 100 };
}

/** Dynamic-programming beat tracker: beats on strong onsets, spaced close to the period. */
export function trackBeats(env: Float64Array, period: number, tightness = 100): number[] {
  const n = env.length;
  if (!n) return [];
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const pen = -tightness * Math.log((t - p) / period) ** 2;
      const s = score[p] + pen;
      if (s > best || arg < 0) {
        best = s;
        arg = p;
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // end on the best-scoring frame in the last period
  let t = n - 1;
  for (let k = Math.max(0, n - Math.round(period)); k < n; k++) if (score[k] > score[t]) t = k;
  const beats: number[] = [];
  while (t >= 0) {
    beats.push(t);
    t = back[t];
  }
  return beats.reverse();
}

export function pickOnsets(env: Float64Array, rate: number, minGap = 0.08): number[] {
  const out: number[] = [];
  const w = 6;
  let last = -Infinity;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(env.length - 1, i + w); k++) {
      s += env[k];
      c++;
    }
    if (env[i] > 0.12 && env[i] > (s / c) * 1.6 && i / rate - last >= minGap) {
      out.push(i / rate);
      last = i / rate;
    }
  }
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function analyzeBeats(x: Float32Array, sr: number): BeatAnalysis {
  const duration = x.length / sr;
  const { env, low, rate } = onsetEnvelope(x, sr);
  const tempo = estimateTempo(env, rate);
  const beatFrames = tempo.confidence > 0.05 ? trackBeats(env, tempo.period) : [];
  // trim beats outside the audible part
  const beats = beatFrames.map((f) => r3(f / rate));
  // downbeat phase: the 4/4 phase whose beats carry the most low-band onset energy
  let phase = 0;
  let bestPhase = -1;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    for (let i = ph; i < beatFrames.length; i += 4) s += low[beatFrames[i]] ?? 0;
    if (s > bestPhase) {
      bestPhase = s;
      phase = ph;
    }
  }
  const downbeats = beats.filter((_, i) => i % 4 === phase);
  // energy: RMS per 0.25 s, normalised
  const hop = 0.25;
  const step = Math.round(sr * hop);
  const values: number[] = [];
  for (let o = 0; o < x.length; o += step) {
    let s = 0;
    const end = Math.min(x.length, o + step);
    for (let i = o; i < end; i++) s += x[i] * x[i];
    values.push(Math.sqrt(s / Math.max(1, end - o)));
  }
  const mx = Math.max(1e-9, ...values);
  const energy = values.map((v) => Math.round((v / mx) * 1000) / 1000);
  // peaks: biggest positive energy jumps (≥ 1.5 s apart)
  const jumps = energy.map((v, i) => ({ t: i * hop, d: i >= 2 ? v - energy[i - 2] : 0 })).filter((j) => j.d > 0.18).sort((a, b) => b.d - a.d);
  const peaks: number[] = [];
  for (const j of jumps) if (peaks.every((p) => Math.abs(p - j.t) >= 1.5)) peaks.push(r3(j.t));
  return {
    version: 1,
    duration: r3(duration),
    sampleRate: sr,
    bpm: beats.length > 3 ? tempo.bpm : 0,
    confidence: tempo.confidence,
    beats,
    downbeats,
    onsets: pickOnsets(env, rate).map(r3),
    energy: { hop, values: energy },
    peaks: peaks.slice(0, 8).sort((a, b) => a - b),
  };
}
