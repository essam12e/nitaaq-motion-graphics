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

/** Smooth ducking gain in [level, 1] at time t (seconds). */
export function duckGain(t: number, intervals: { start: number; end: number }[], level: number, attack: number, release: number): number {
  let g = 1;
  for (const iv of intervals) {
    let d = 0;
    if (t >= iv.start && t <= iv.end) d = 1;
    else if (t < iv.start && t > iv.start - attack) d = smooth(1 - (iv.start - t) / attack);
    else if (t > iv.end && t < iv.end + release) d = smooth(1 - (t - iv.end) / release);
    g = Math.min(g, 1 - d * (1 - level));
  }
  return g;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Full music volume at time t (absolute seconds). */
export function musicVolumeAt(t: number, spec: VideoSpec, totalSec: number): number {
  const m = spec.audio.music;
  if (!m) return 0;
  const fin = m.fadeIn > 0 ? Math.min(1, t / m.fadeIn) : 1;
  const fout = m.fadeOut > 0 ? Math.min(1, Math.max(0, (totalSec - t) / m.fadeOut)) : 1;
  const duck = m.ducking.enabled ? duckGain(t, voiceIntervals(spec), m.ducking.level, m.ducking.attack, m.ducking.release) : 1;
  return m.volume * smooth(fin) * smooth(fout) * duck;
}
