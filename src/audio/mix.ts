/**
 * Shared audio mixing math: SFX event planning (auto cues with intensity
 * budget), music envelope with fades and smooth ducking under voice.
 */
import type { SceneSpec, VideoSpec } from '../schema/video';
import type { Timeline } from '../core/timeline';
import type { SfxSuggestion } from '../scenes/registry';
import { getSfx } from './sfx-library';
import { hashString } from '../core/rng';

export interface PlannedSfx {
  sceneId: string;
  sound: string;
  file: string;
  atSec: number; // absolute
  volume: number;
  duration: number;
}

/**
 * Turn scene suggestions into concrete cues. Low intensity keeps only the most
 * important cues, and a global density cap (per 10 s) prevents overuse.
 */
export function planSfx(spec: VideoSpec, timeline: Timeline, suggestionsFor: (scene: SceneSpec) => SfxSuggestion[]): PlannedSfx[] {
  const cfg = spec.audio.sfx;
  if (!cfg.enabled) return [];
  // the Sound Director's plan (events → intent → family → variant → sync → mix) wins when present
  if (cfg.cues && cfg.cues.length) return cfg.cues.map((c) => ({ sceneId: c.sceneId, sound: c.sound, file: c.file, atSec: c.atSec, volume: c.volume, duration: c.duration }));
  const out: PlannedSfx[] = [];
  const threshold = 1 - cfg.intensity; // intensity 0.5 → keep weight ≥ 0.5
  spec.scenes.forEach((scene, i) => {
    const e = timeline.entries[i];
    if (!e) return;
    const speed = scene.motion?.speed ?? 1;
    if (scene.sfx === 'none') return;
    if (Array.isArray(scene.sfx)) {
      for (const ev of scene.sfx) {
        const override = cfg.overrides[ev.sound];
        const s = getSfx(ev.sound, hashString(scene.id + ev.sound));
        const file = override ?? s?.file;
        if (!file) continue;
        out.push({ sceneId: scene.id, sound: ev.sound, file, atSec: e.startSec + ev.at, volume: ev.volume * cfg.volume * (s?.gain ?? 1), duration: s?.duration ?? 1 });
      }
      return;
    }
    for (const sug of suggestionsFor(scene)) {
      if (sug.weight < threshold) continue;
      const s = getSfx(sug.category, hashString(scene.id + sug.category + sug.at));
      if (!s) continue;
      const file = cfg.overrides[s.id] ?? cfg.overrides[sug.category] ?? s.file;
      out.push({ sceneId: scene.id, sound: s.id, file, atSec: e.startSec + sug.at / speed, volume: (sug.volume ?? 0.8) * cfg.volume * s.gain, duration: s.duration });
    }
  });
  out.sort((a, b) => a.atSec - b.atSec);
  // Density cap: at most N cues per 10 s window, keep earliest; never two cues within 90 ms.
  const maxPer10 = Math.round(6 + cfg.intensity * 10);
  const kept: PlannedSfx[] = [];
  for (const c of out) {
    const recent = kept.filter((k) => c.atSec - k.atSec < 10).length;
    const tooClose = kept.some((k) => Math.abs(k.atSec - c.atSec) < 0.09);
    if (recent < maxPer10 && !tooClose && c.atSec < timeline.totalSec - 0.05) kept.push(c);
  }
  return kept;
}

/** Voice activity intervals in absolute seconds. */
export function voiceIntervals(spec: VideoSpec): { start: number; end: number }[] {
  const v = spec.audio.voice;
  if (!v || spec.audio.mode === 'none') return [];
  if (v.segments.length) return v.segments.map((s) => ({ start: v.offset + s.start, end: v.offset + s.end }));
  if (v.duration) return [{ start: v.offset, end: v.offset + v.duration }];
  return [];
}

export type DuckCurve = 'smooth' | 'exponential' | 'linear' | 'hold';

/**
 * Ducking gain in [level, 1] at time t (seconds). The default curve is the original smooth S-curve;
 * 'exponential' moves evenly in dB (sounds most natural on long releases), 'linear' is a plain ramp,
 * 'hold' ducks fast and holds the dip through the first half of the release (no pumping between phrases).
 */
export function duckGain(t: number, intervals: { start: number; end: number }[], level: number, attack: number, release: number, shape: DuckCurve = 'smooth'): number {
  let g = 1;
  const att = shape === 'hold' ? attack * 0.5 : attack;
  for (const iv of intervals) {
    // raw position into the duck: 1 = fully ducked
    let r = 0;
    if (t >= iv.start && t <= iv.end) r = 1;
    else if (t < iv.start && t > iv.start - att) r = 1 - (iv.start - t) / att;
    else if (t > iv.end && t < iv.end + release) {
      const x = (t - iv.end) / release;
      r = shape === 'hold' ? (x < 0.5 ? 1 : 1 - (x - 0.5) * 2) : 1 - x;
    }
    if (r <= 0) continue;
    const gi = shape === 'exponential' ? Math.pow(Math.max(1e-4, level), r) : 1 - (shape === 'linear' ? r : smooth(r)) * (1 - level);
    g = Math.min(g, gi);
  }
  return g;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Sidechain (sound hierarchy Voice > SFX > Music > Ambient): the music dips under
 * impact-layer cues (hero hits, logo stings) so the hit reads without raising it.
 * Gain in (0, 1]; fast attack just before the hit, smooth release after.
 */
export function sidechainGain(t: number, cues: { atSec: number; anchorSec?: number; layer?: string; volume: number }[], depthDb: number): number {
  if (!depthDb) return 1;
  const floor = Math.pow(10, -depthDb / 20);
  let g = 1;
  for (const c of cues) {
    if (c.layer !== 'impact' || c.volume < 0.3) continue;
    const at = c.anchorSec ?? c.atSec;
    let d = 0;
    if (t >= at - 0.04 && t <= at + 0.08) d = 1;
    else if (t < at - 0.04 && t > at - 0.1) d = smooth(1 - (at - 0.04 - t) / 0.06);
    else if (t > at + 0.08 && t < at + 0.5) d = smooth(1 - (t - at - 0.08) / 0.42);
    g = Math.min(g, 1 - d * (1 - floor));
  }
  return g;
}

type Automation = NonNullable<VideoSpec['audio']['automation']>;
type Point = { t: number; gain: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Gain automation: points joined by the curve; flat before the first and after the last point. */
export function automationGain(t: number, points: Point[] | undefined, curve: 'smooth' | 'linear' | 'exponential' = 'smooth'): number {
  if (!points || !points.length) return 1;
  const p = [...points].sort((a, b) => a.t - b.t);
  if (t <= p[0].t) return p[0].gain;
  if (t >= p[p.length - 1].t) return p[p.length - 1].gain;
  let i = 0;
  while (i < p.length - 2 && t > p[i + 1].t) i++;
  const a = p[i];
  const b = p[i + 1];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  if (curve === 'linear') return a.gain + (b.gain - a.gain) * u;
  if (curve === 'exponential' && a.gain > 0 && b.gain > 0) return a.gain * Math.pow(b.gain / a.gain, u);
  return a.gain + (b.gain - a.gain) * smooth(u);
}

/** Music pre-entry: silent (or `from`) until at − lead, then an eased swell that lands on `at`. */
export function preEntryGain(t: number, pre: { at: number; lead: number; from: number }): number {
  const u = clamp01((t - (pre.at - pre.lead)) / pre.lead);
  // ease-in swell: the music arrives with the moment instead of fading up in front of it
  return pre.from + (1 - pre.from) * u * u * (3 - 2 * u) * (0.6 + 0.4 * u);
}

/** VO → music handoff: after the voice the music lifts from 1 to `lift` over `overlap` seconds. */
export function handoffGain(t: number, h: { at: number; overlap: number; lift: number }): number {
  return 1 + (h.lift - 1) * smooth(clamp01((t - h.at) / h.overlap));
}

export type EndingKind = 'fade' | 'ring-out' | 'button' | 'swell';
export const ENDING_LENGTH: Record<EndingKind, number> = { fade: 0.8, 'ring-out': 2.4, button: 0.12, swell: 1.6 };

/** Ending transition, with r = seconds left. Every curve reaches exactly 0 at the end of the film. */
export function endingGain(r: number, kind: EndingKind, length: number): number {
  const L = Math.max(0.05, length);
  if (r >= L) return 1;
  const x = clamp01(r / L); // 1 → 0 across the ending window
  switch (kind) {
    case 'ring-out':
      // a natural decay: even in dB (−48 dB across the window), pulled to silence at the very end
      return Math.pow(10, (-48 * (1 - x)) / 20) * smooth(Math.min(1, x * 6));
    case 'button':
      // full until the button, then a short clean release (no long fade under the final hit)
      return smooth(x);
    case 'swell': {
      // lifts into the last moment then falls away: +1.6 dB peak at 40 % of the window
      const lift = 1 + 0.2 * Math.sin(Math.PI * clamp01((1 - x) / 0.6));
      return x > 0.4 ? lift : lift * smooth(x / 0.4);
    }
    default:
      return smooth(x);
  }
}

/** Equal-power crossfade gains (out, in) for the first track handing over to the next. */
export function crossfadeGains(t: number, at: number, length: number): { out: number; in: number } {
  const u = clamp01((t - at) / Math.max(0.01, length));
  return { out: Math.cos((Math.PI / 2) * u), in: Math.sin((Math.PI / 2) * u) };
}

/** Time the VO → music handoff starts: the explicit `at`, else the end of the last voice interval. */
export function handoffAt(spec: VideoSpec): number | undefined {
  const h = spec.audio.automation?.handoff;
  if (!h) return undefined;
  if (h.at !== undefined) return h.at;
  const iv = voiceIntervals(spec);
  return iv.length ? Math.max(...iv.map((i) => i.end)) : undefined;
}

/** Shared bus gain (everything but the track's own fades / crossfade): ducking, sidechain, automation, handoff. */
function busGain(t: number, spec: VideoSpec, a: Automation): number {
  const m = spec.audio.music!;
  const hAt = handoffAt(spec);
  // with a handoff the last release under the voice is the handoff's overlap (the music takes over in one gesture)
  const release = a.handoff ? a.handoff.overlap : m.ducking.release;
  const duck = m.ducking.enabled ? duckGain(t, voiceIntervals(spec), m.ducking.level, m.ducking.attack, release, a.duckCurve) : 1;
  const side = spec.audio.sidechainDb ? sidechainGain(t, spec.audio.sfx.cues ?? [], spec.audio.sidechainDb) : 1;
  const hand = a.handoff && hAt !== undefined ? handoffGain(t, { at: hAt, overlap: a.handoff.overlap, lift: a.handoff.lift }) : 1;
  return duck * side * automationGain(t, a.music, a.curve) * hand;
}

function endingOf(spec: VideoSpec, a: Automation, totalSec: number, t: number): number {
  const m = spec.audio.music!;
  const kind = a.ending?.kind ?? 'fade';
  const len = a.ending?.length ?? (kind === 'fade' && m.fadeOut > 0 ? m.fadeOut : ENDING_LENGTH[kind]);
  return endingGain(totalSec - t, kind, len);
}

/** Full music volume at time t (absolute seconds). Without `audio.automation` this is exactly the original envelope. */
export function musicVolumeAt(t: number, spec: VideoSpec, totalSec: number): number {
  const m = spec.audio.music;
  if (!m) return 0;
  const a = spec.audio.automation;
  if (!a) {
    const fin = m.fadeIn > 0 ? Math.min(1, t / m.fadeIn) : 1;
    const fout = m.fadeOut > 0 ? Math.min(1, Math.max(0, (totalSec - t) / m.fadeOut)) : 1;
    const duck = m.ducking.enabled ? duckGain(t, voiceIntervals(spec), m.ducking.level, m.ducking.attack, m.ducking.release) : 1;
    const side = spec.audio.sidechainDb ? sidechainGain(t, spec.audio.sfx.cues ?? [], spec.audio.sidechainDb) : 1;
    const xo = spec.audio.musicNext ? crossfadeGains(t, spec.audio.musicNext.at, spec.audio.musicNext.crossfade).out : 1;
    return m.volume * smooth(fin) * smooth(fout) * duck * side * xo;
  }
  const entry = a.preEntry ? preEntryGain(t, a.preEntry) : smooth(m.fadeIn > 0 ? Math.min(1, t / m.fadeIn) : 1);
  const next = spec.audio.musicNext;
  const xf = next ? crossfadeGains(t, next.at, next.crossfade).out : 1;
  return Math.min(1, m.volume * entry * xf * busGain(t, spec, a) * endingOf(spec, a, totalSec, t));
}

/** Volume of the crossfaded second cue (`audio.musicNext`) at time t — 0 before its crossfade starts. */
export function musicNextVolumeAt(t: number, spec: VideoSpec, totalSec: number): number {
  const n = spec.audio.musicNext;
  const m = spec.audio.music;
  if (!n || !m) return 0;
  const a: Automation = spec.audio.automation ?? { curve: 'smooth', duckCurve: 'smooth' };
  const g = crossfadeGains(t, n.at, n.crossfade).in;
  if (g <= 0) return 0;
  return Math.min(1, (n.volume ?? m.volume) * g * busGain(t, spec, a) * endingOf(spec, a, totalSec, t));
}
