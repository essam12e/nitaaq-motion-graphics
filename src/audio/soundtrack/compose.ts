/**
 * Code-Generated Soundtrack (node, lazy module "soundtrack").
 *
 * Used ONLY when the user supplied no music and no licensed track (priority:
 * user music > licensed music > procedural soundtrack > none). Nothing is
 * downloaded and nothing imitates an existing song: the track is synthesised
 * from seeded parameters — style, key, tempo, chord progression, drums, bass,
 * pads, plucks/arps, risers — and STRUCTURED BY THE FILM:
 *
 *   intro (restraint) → build → peak on the hero moment → resolve on the CTA → tail
 *
 * The beat grid is anchored so a downbeat lands exactly on the hero reveal,
 * and the tempo (within the style's range) is chosen to put as many scene
 * cuts as possible on beats. The track's own hits are returned so the Sound
 * Director doesn't double them. Same seed → bit-identical WAV.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRng } from '../../core/rng';
import { SR, bandpass, brown, envAD, highpass, lowpass, mix, mul, noise, osc, reverb, saturate, wavBytes } from '../synth/dsp';

export const SOUNDTRACK_STYLES = ['tech', 'premium', 'cinematic', 'sport', 'playful', 'corporate', 'minimal', 'futuristic'] as const;
export type SoundtrackStyle = (typeof SOUNDTRACK_STYLES)[number];

interface StyleDef {
  bpm: [number, number];
  minor: boolean;
  progression: number[]; // scale degrees (0-based) per bar
  kick: 'four' | 'half' | 'sparse' | 'none';
  snare: 'backbeat' | 'clap' | 'none';
  hats: '8th' | '16th' | 'none';
  bass: 'pulse' | 'root' | 'bounce' | 'none';
  lead: 'arp16' | 'arp8' | 'pluck' | 'marimba' | 'none';
  pad: number; // 0..1 level
  drive: number;
  bright: number; // pad / lead cutoff scale
}

const STYLES: Record<SoundtrackStyle, StyleDef> = {
  tech: { bpm: [112, 124], minor: true, progression: [0, 5, 3, 4], kick: 'four', snare: 'clap', hats: '16th', bass: 'pulse', lead: 'arp16', pad: 0.5, drive: 1.3, bright: 1.1 },
  premium: { bpm: [78, 90], minor: false, progression: [0, 4, 5, 3], kick: 'sparse', snare: 'none', hats: '8th', bass: 'root', lead: 'pluck', pad: 0.75, drive: 1.05, bright: 0.75 },
  cinematic: { bpm: [84, 96], minor: true, progression: [0, 5, 2, 6], kick: 'half', snare: 'backbeat', hats: 'none', bass: 'root', lead: 'pluck', pad: 0.9, drive: 1.2, bright: 0.7 },
  sport: { bpm: [124, 132], minor: true, progression: [0, 0, 5, 6], kick: 'four', snare: 'clap', hats: '16th', bass: 'bounce', lead: 'arp8', pad: 0.35, drive: 1.8, bright: 1.2 },
  playful: { bpm: [106, 118], minor: false, progression: [0, 3, 4, 3], kick: 'half', snare: 'clap', hats: '8th', bass: 'bounce', lead: 'marimba', pad: 0.4, drive: 1.1, bright: 1 },
  corporate: { bpm: [96, 106], minor: false, progression: [0, 4, 5, 3], kick: 'half', snare: 'clap', hats: '8th', bass: 'root', lead: 'pluck', pad: 0.6, drive: 1.1, bright: 0.9 },
  minimal: { bpm: [90, 100], minor: true, progression: [0, 3, 0, 4], kick: 'sparse', snare: 'none', hats: '8th', bass: 'pulse', lead: 'none', pad: 0.55, drive: 1.05, bright: 0.8 },
  futuristic: { bpm: [118, 128], minor: true, progression: [0, 6, 5, 4], kick: 'four', snare: 'clap', hats: '16th', bass: 'pulse', lead: 'arp16', pad: 0.7, drive: 1.5, bright: 1.25 },
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface ComposeInput {
  style: SoundtrackStyle;
  durationSec: number;
  seed: string | number;
  /** Absolute seconds of the hero reveal (downbeat + peak lands here). */
  heroSec?: number;
  /** Absolute seconds where the CTA scene starts (resolve). */
  ctaSec?: number;
  /** Scene cut times — the tempo is chosen to put them on beats. */
  cuts?: number[];
  /** 0..1 energy per scene in order with their start times (drives the arrangement). */
  energy?: { start: number; value: number }[];
}

export interface ComposeResult {
  style: SoundtrackStyle;
  bpm: number;
  key: string;
  beats: number[];
  downbeats: number[];
  hits: number[];
  sections: { name: string; start: number; end: number; energy: number }[];
  cutsOnBeat: number;
  samples: Float32Array;
}

function chooseTempo(def: StyleDef, input: ComposeInput, anchor: number): number {
  const cuts = input.cuts ?? [];
  let best = Math.round((def.bpm[0] + def.bpm[1]) / 2);
  let bestScore = -1;
  for (let bpm = def.bpm[0]; bpm <= def.bpm[1]; bpm++) {
    const beat = 60 / bpm;
    const score = cuts.filter((c) => {
      const k = Math.round((c - anchor) / (beat / 2)); // half-beats count too
      return Math.abs(anchor + k * (beat / 2) - c) < 0.06;
    }).length;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  return best;
}

export function composeSoundtrack(input: ComposeInput): ComposeResult {
  const def = STYLES[input.style];
  const r = createRng(`soundtrack:${input.seed}:${input.style}`).next;
  const D = Math.max(3, input.durationSec);
  const hero = input.heroSec !== undefined && input.heroSec > 1 && input.heroSec < D - 0.5 ? input.heroSec : D * 0.55;
  const bpm = chooseTempo(def, input, hero);
  const beat = 60 / bpm;
  const bar = beat * 4;
  // grid anchored on the hero: downbeat exactly at `hero`
  const firstBeat = hero - Math.floor(hero / beat) * beat;
  const beats: number[] = [];
  for (let t = firstBeat; t < D; t += beat) beats.push(Math.round(t * 1000) / 1000);
  const heroBeatIdx = beats.findIndex((b) => Math.abs(b - hero) < 1e-3);
  const downbeats = beats.filter((_, i) => (i - heroBeatIdx) % 4 === 0);
  const cta = input.ctaSec && input.ctaSec > hero ? input.ctaSec : Math.max(hero + bar, D - 2.5);
  const sections = [
    { name: 'intro', start: 0, end: Math.min(hero - bar * 2, D * 0.25), energy: 0.35 },
    { name: 'build', start: 0, end: hero, energy: 0.6 },
    { name: 'peak', start: hero, end: Math.min(cta, D), energy: 1 },
    { name: 'resolve', start: Math.min(cta, D), end: D, energy: 0.5 },
  ];
  sections[0].end = Math.max(0, sections[0].end);
  sections[1].start = sections[0].end;
  const energyAt = (t: number) => {
    const s = sections.find((x) => t >= x.start && t < x.end) ?? sections[sections.length - 1];
    let e = s.energy;
    if (s.name === 'build') e = 0.45 + 0.4 * ((t - s.start) / Math.max(0.1, s.end - s.start));
    const film = input.energy?.filter((x) => x.start <= t).pop()?.value;
    return film !== undefined ? e * 0.7 + film * 0.3 : e;
  };
  // key + chords
  const root = 45 + Math.floor(r() * 7); // A2..D#3
  const scale = def.minor ? MINOR : MAJOR;
  const keyName = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#'][root - 45] + (def.minor ? ' minor' : ' major');
  // per-section harmony (separate stream so the rest of the seed is unchanged):
  // the peak re-voices the progression (rotation or one substituted degree),
  // the resolve section leans home (ends each cycle on the tonic).
  const hr = createRng(`soundtrack-harmony:${input.seed}:${input.style}`).next;
  const base = def.progression;
  const rotate = hr() < 0.5;
  const subIdx = 1 + Math.floor(hr() * (base.length - 1));
  const peakProg = rotate ? [...base.slice(2), ...base.slice(0, 2)] : base.map((d, i) => (i === subIdx ? (d + 2) % 7 : d));
  const resolveProg = [...base.slice(0, base.length - 1), 0];
  const chordAt = (t: number) => {
    const barIdx = Math.floor((t - firstBeat + bar * 64) / bar);
    const name = (sections.find((x) => t >= x.start && t < x.end) ?? sections[sections.length - 1]).name;
    const prog = name === 'peak' ? peakProg : name === 'resolve' ? resolveProg : def.progression;
    const deg = prog[barIdx % prog.length];
    const tones = [0, 2, 4].map((k) => {
      const d = deg + k;
      return root + scale[d % 7] + 12 * Math.floor(d / 7);
    });
    return tones;
  };
  const N = Math.round((D + 1.2) * SR);
  const out = new Float32Array(N);
  const at = (t: number) => Math.round(t * SR);
  const place = (sig: Float32Array, t: number, g: number) => mix(out, sig, g, t);

  // ── drums (synth one-shots, placed on the grid)
  const kickSig = (k: number) => {
    const n = Math.round(0.35 * SR);
    const s = osc(n, (tt) => 46 * (1 + 2.6 * Math.exp(-tt * 38)), 'sine');
    return saturate(mul(s, envAD(n, 0.001, 0.2 + 0.05 * k)), 1.4);
  };
  const snareSig = (seed: number) => {
    const n = Math.round(0.25 * SR);
    const nz = bandpass(noise(n, `sn${seed}`), 1900, 0.9);
    mix(nz, osc(n, () => 190, 'tri'), 0.35);
    return mul(nz, envAD(n, 0.001, 0.12));
  };
  const clapSig = (seed: number) => {
    const n = Math.round(0.22 * SR);
    const nz = bandpass(noise(n, `cl${seed}`), 1400, 1.4);
    const e = new Float32Array(n);
    for (const off of [0, 0.011, 0.023]) {
      const o = at(off);
      for (let i = o; i < n; i++) e[i] = Math.max(e[i], Math.exp(-(i - o) / SR / 0.02));
    }
    for (let i = at(0.03); i < n; i++) e[i] = Math.max(e[i], 0.6 * Math.exp(-(i - at(0.03)) / SR / 0.09));
    return mul(nz, e);
  };
  const hatSig = (seed: number, open = false) => {
    const n = Math.round((open ? 0.18 : 0.05) * SR);
    return mul(highpass(noise(n, `hh${seed}`), 7000), envAD(n, 0.0005, open ? 0.09 : 0.02));
  };
  const kicks = [kickSig(0), kickSig(1)];
  beats.forEach((t, i) => {
    const rel = i - heroBeatIdx;
    const inBar = ((rel % 4) + 4) % 4;
    const e = energyAt(t);
    if (t > D - 0.3) return;
    const resolve = t >= cta;
    // kick
    const kOn = def.kick === 'four' ? e > 0.5 : def.kick === 'half' ? e > 0.5 && (inBar === 0 || inBar === 2) : def.kick === 'sparse' ? e > 0.55 && inBar === 0 : false;
    if (kOn && !(resolve && inBar !== 0)) place(kicks[inBar === 0 ? 1 : 0], t, 0.8 * e);
    // snare / clap on 2 and 4
    if (def.snare !== 'none' && e > 0.62 && (inBar === 1 || inBar === 3) && !resolve) place(def.snare === 'clap' ? clapSig(i % 4) : snareSig(i % 4), t, 0.45 * e);
    // hats
    if (def.hats !== 'none' && e > 0.4) {
      const subs = def.hats === '16th' && e > 0.7 ? 4 : 2;
      for (let s = 0; s < subs; s++) {
        const tt = t + (s * beat) / subs;
        const accent = s === subs / 2 ? 1 : 0.6;
        place(hatSig((i * 4 + s) % 7, s === subs / 2 && def.hats === '8th' && e > 0.8), tt, 0.12 * accent * e);
      }
    }
  });

  // ── bass
  if (def.bass !== 'none') {
    beats.forEach((t, i) => {
      const e = energyAt(t);
      if (e < 0.45 || t > D - 0.2) return;
      const ch = chordAt(t);
      const f = midi(ch[0] - 12);
      const steps = def.bass === 'pulse' ? [0, 0.5] : def.bass === 'bounce' ? [0, 0.75] : [0];
      for (const st of steps) {
        const dur = def.bass === 'root' ? beat * 0.95 : beat * 0.4;
        const n = Math.round(dur * SR);
        const s = lowpass(osc(n, () => (st === 0.75 ? f * 2 : f), 'saw'), 260 + 500 * e * def.bright);
        place(mul(s, envAD(n, 0.004, dur * 0.8, dur * 0.2)), t + st * beat, 0.32 * e);
      }
      void i;
    });
  }

  // ── pad (chord per bar, slow attack, detuned saws)
  if (def.pad > 0) {
    for (let t = firstBeat - bar; t < D; t += bar) {
      const start = Math.max(0, t);
      const len = Math.min(bar + 0.4, D + 0.8 - start);
      if (len <= 0.05) continue;
      const n = Math.round(len * SR);
      const ch = chordAt(start + 0.01);
      const e = energyAt(start);
      const sig = new Float32Array(n);
      for (const note of ch) for (const det of [-0.08, 0.08]) mix(sig, osc(n, () => midi(note + det), 'saw', r()), 0.12);
      const lp = lowpass(sig, (tt) => (500 + 1300 * e) * def.bright * (0.8 + 0.2 * Math.sin(tt * 1.3)));
      const env = new Float32Array(n);
      for (let i = 0; i < n; i++) env[i] = Math.min(1, i / (0.35 * SR)) * Math.min(1, (n - i) / (0.4 * SR));
      place(mul(lp, env), start, def.pad * (0.35 + 0.35 * e));
    }
  }

  // ── lead (arp / pluck / marimba)
  if (def.lead !== 'none') {
    const sub = def.lead === 'arp16' ? 4 : def.lead === 'arp8' || def.lead === 'marimba' ? 2 : 1;
    beats.forEach((t, i) => {
      const e = energyAt(t);
      if (e < (def.lead === 'pluck' ? 0.3 : 0.5) || t > D - 0.4) return;
      const ch = chordAt(t);
      for (let s = 0; s < sub; s++) {
        if (def.lead === 'pluck' && ((i + s) % 2 === 1) && e < 0.8) continue;
        const note = ch[(i * sub + s) % 3] + 12 + (def.lead === 'arp16' && s === 3 ? 12 : 0);
        const dur = def.lead === 'pluck' ? beat * 0.9 : (beat / sub) * 0.9;
        const n = Math.round(dur * SR);
        const shape = def.lead === 'marimba' ? 'sine' : def.lead === 'pluck' ? 'tri' : 'square';
        let sig = osc(n, () => midi(note), shape);
        if (def.lead === 'marimba') mix(sig, osc(n, () => midi(note) * 4, 'sine'), 0.15);
        sig = lowpass(sig, 1800 * def.bright + 1500 * e);
        place(mul(sig, envAD(n, 0.002, def.lead === 'pluck' ? 0.35 : 0.12)), t + (s * beat) / sub, (def.lead === 'arp16' ? 0.07 : 0.1) * e);
      }
    });
  }

  // ── riser into the hero, impact on it
  const riseLen = Math.min(bar * 2, hero - 0.2);
  if (riseLen > 0.8) {
    const n = Math.round(riseLen * SR);
    const rs = bandpass(noise(n, `riser:${input.seed}`), (tt) => 300 * Math.pow(15, tt / riseLen), 1.4);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = Math.pow(i / n, 2.6);
    place(mul(rs, env), hero - riseLen, 0.22);
  }
  {
    const n = Math.round(1.6 * SR);
    const boom = osc(n, (tt) => 40 * (1 + 1.2 * Math.exp(-tt * 8)), 'sine');
    mul(boom, envAD(n, 0.003, 1.0));
    mix(boom, mul(lowpass(brown(n, `boom:${input.seed}`), 600), envAD(n, 0.002, 0.3)), 0.4);
    place(saturate(boom, 1.3), hero, 0.55);
  }
  // ── final chord on the CTA resolve (ring out)
  {
    const len = Math.min(3, D - cta + 1);
    if (len > 0.5) {
      const n = Math.round(len * SR);
      const ch = chordAt(cta);
      const sig = new Float32Array(n);
      for (const note of [...ch, ch[0] + 12]) mix(sig, osc(n, () => midi(note + 12), 'tri'), 0.1);
      place(mul(lowpass(sig, 2500), envAD(n, 0.01, len * 0.8)), cta, 0.5);
    }
  }

  // ── master: gentle saturation, small room, fades, normalise
  let master = reverb(out, 0.12, 1.1, 0.8).subarray(0, N);
  master = saturate(new Float32Array(master), def.drive);
  const fadeIn = Math.min(0.6, hero * 0.2);
  for (let i = 0; i < master.length; i++) {
    const t = i / SR;
    const fi = Math.min(1, t / Math.max(0.01, fadeIn));
    const fo = Math.min(1, Math.max(0, (D + 0.6 - t) / 1.2));
    master[i] *= fi * fo;
  }
  let peak = 0;
  for (let i = 0; i < master.length; i++) peak = Math.max(peak, Math.abs(master[i]));
  if (peak > 0) mul(master, Math.pow(10, -3 / 20) / peak);
  const cutsOnBeat = (input.cuts ?? []).filter((c) => beats.some((b) => Math.abs(b - c) < 0.06) || beats.some((b) => Math.abs(b + beat / 2 - c) < 0.06)).length;
  return {
    style: input.style,
    bpm,
    key: keyName,
    beats,
    downbeats,
    hits: [Math.round(hero * 1000) / 1000, Math.round(cta * 1000) / 1000],
    sections: sections.map((s) => ({ ...s, start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 })),
    cutsOnBeat,
    samples: master.subarray(0, Math.round((D + 0.3) * SR)),
  };
}

/** Compose and write a 16-bit WAV. */
export function writeSoundtrack(file: string, input: ComposeInput): Omit<ComposeResult, 'samples'> & { file: string; duration: number } {
  const res = composeSoundtrack(input);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, wavBytes([res.samples, res.samples]));
  const { samples, ...meta } = res;
  return { ...meta, file, duration: samples.length / SR };
}

/** Film personality → default soundtrack style. */
export const SOUNDTRACK_FOR_MOTION: Record<string, SoundtrackStyle> = { premium: 'premium', cinematic: 'cinematic', corporate: 'corporate', tech: 'tech', energetic: 'sport', sport: 'sport', playful: 'playful' };
