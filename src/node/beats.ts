/**
 * Node side of the beat engine: decodes audio once (ffmpeg → mono f32 22.05 kHz)
 * and caches the analysis by the audio file's hash, so the same track is never
 * analysed twice. Also writes audio_cues.json — the audio master timeline.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBeats, type BeatAnalysis } from '../audio/beats';
import { cached, fileHashAsync, hashOf } from '../cache/store';
import { findFfmpeg } from './audio';
import { MotionError } from '../core/errors';
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { planSfx, voiceIntervals, musicVolumeAt } from '../audio/mix';
import { SceneRegistry } from '../scenes';
import { getSfx } from '../audio/sfx-library';

const SR = 22050;

export function decodeMono(file: string, maxSec = 600): Float32Array {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-t', String(maxSec), '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { maxBuffer: 4 * SR * maxSec + 1024, env: { ...process.env, LC_ALL: 'C' } });
  if (r.status !== 0) throw new MotionError({ code: 'AUDIO_PROBE_FAILED', what: 'Could not decode audio for beat analysis', where: file, why: String(r.stderr ?? '').slice(0, 300) });
  const buf = r.stdout as Buffer;
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

export async function beatsFor(file: string): Promise<BeatAnalysis & { source: string; hash: string }> {
  const hash = await fileHashAsync(file);
  const res = await cached('beats', hashOf('beats-v1', hash), () => analyzeBeats(decodeMono(file), SR));
  return { ...res, source: file, hash };
}

/** The audio master timeline: every voice phrase, music envelope point and SFX cue on one clock. */
export function audioCues(spec: VideoSpec, beats?: BeatAnalysis | null) {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const sfx = planSfx(spec, tl, (sc) => SceneRegistry.get(sc.type)?.manifest.sfx ?? []);
  const m = spec.audio.music;
  const env: { t: number; volume: number }[] = [];
  if (m) for (let t = 0; t <= tl.totalSec + 1e-6; t += 0.25) env.push({ t: Math.round(t * 100) / 100, volume: Math.round(musicVolumeAt(t, spec, tl.totalSec) * 1000) / 1000 });
  return {
    version: 1,
    duration: Math.round(tl.totalSec * 100) / 100,
    settings: {
      mode: spec.audio.mode,
      musicVolume: m?.volume ?? 0,
      voiceVolume: spec.audio.voice?.volume ?? 0,
      duckAmount: m?.ducking.enabled ? Math.round((1 - m.ducking.level) * 100) / 100 : 0,
      attack: m?.ducking.attack ?? 0,
      release: m?.ducking.release ?? 0,
      sfxEnabled: spec.audio.sfx.enabled,
      sfxIntensity: spec.audio.sfx.intensity,
      sfxVolume: spec.audio.sfx.volume,
    },
    scenes: tl.entries.map((e) => ({ id: e.id, start: Math.round(e.startSec * 100) / 100, end: Math.round(e.endSec * 100) / 100 })),
    voice: voiceIntervals(spec).map((v) => ({ start: Math.round(v.start * 100) / 100, end: Math.round(v.end * 100) / 100 })),
    music: m ? { src: m.src, fadeIn: m.fadeIn, fadeOut: m.fadeOut, envelope: env } : null,
    sfx: sfx.map((c) => ({ at: Math.round(c.atSec * 100) / 100, scene: c.sceneId, sound: c.sound, categories: getSfx(c.sound)?.categories ?? [], volume: Math.round(c.volume * 100) / 100 })),
    beats: beats ? { bpm: beats.bpm, count: beats.beats.length, downbeats: beats.downbeats.filter((d) => d <= tl.totalSec) } : null,
  };
}

export function writeAudioCues(projectDir: string, spec: VideoSpec, beats?: BeatAnalysis | null) {
  const cues = audioCues(spec, beats);
  writeFileSync(join(projectDir, 'audio_cues.json'), JSON.stringify(cues, null, 2));
  return cues;
}
