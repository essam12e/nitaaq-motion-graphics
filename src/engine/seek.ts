/**
 * Deterministic seek(t): the complete state of the film at time t, computed
 * from video.json alone (no rendering, no history). Every engine value is a
 * pure function of the frame, so this is exactly what the renderer draws at t:
 * which scenes are on screen, their local time, the transition progress, the
 * camera state (Camera Engine 2.0), the music gain and the sounds playing.
 * `nitaaq seek <project> <t> [--png]` prints it (and renders that frame).
 */
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { cameraAt, type CameraPlan } from '../camera/moves';
import type { CameraState } from '../camera/rig';
import { musicVolumeAt } from '../audio/mix';

export interface FrameState {
  t: number;
  frame: number;
  totalFrames: number;
  scenes: { id: string; type: string; variant?: string; localSec: number; progress: number; phase: 'entering' | 'holding' | 'leaving'; transitionIn?: { type: string; progress: number }; transitionOut?: { type: string; progress: number }; camera?: { move: string; state: CameraState } }[];
  audio: { musicGain: number; sfx: { sound: string; at: number; scene: string }[] };
}

export function seek(spec: VideoSpec, t: number): FrameState {
  const fps = spec.canvas.fps;
  const tl = buildTimeline(spec.scenes, fps);
  const frame = Math.max(0, Math.min(tl.totalFrames - 1, Math.round(t * fps)));
  const scenes: FrameState['scenes'] = [];
  tl.entries.forEach((e, i) => {
    if (frame < e.from || frame >= e.from + e.durationInFrames) return;
    const s = spec.scenes[i];
    const local = frame - e.from;
    const prev = spec.scenes[i - 1]?.transition;
    const out = s.transition;
    const tin = e.transitionIn > 0 && local < e.transitionIn ? { type: prev?.type ?? 'cut', progress: Math.round((local / e.transitionIn) * 1000) / 1000 } : undefined;
    const outStart = e.durationInFrames - e.transitionOut;
    const tout = e.transitionOut > 0 && local >= outStart ? { type: out?.type ?? 'cut', progress: Math.round(((local - outStart) / e.transitionOut) * 1000) / 1000 } : undefined;
    const plan = s.motion?.cameraPlan as CameraPlan | undefined;
    const cam = plan ? { move: plan.move, state: cameraAt(plan, local / fps, { W: spec.canvas.width, H: spec.canvas.height, durationSec: e.durationInFrames / fps }) } : undefined;
    scenes.push({ id: s.id, type: s.type, variant: s.variant, localSec: Math.round((local / fps) * 1000) / 1000, progress: Math.round((local / e.durationInFrames) * 1000) / 1000, phase: tin ? 'entering' : tout ? 'leaving' : 'holding', ...(tin ? { transitionIn: tin } : {}), ...(tout ? { transitionOut: tout } : {}), ...(cam ? { camera: cam } : {}) });
  });
  const sec = frame / fps;
  const sfx = (spec.audio.sfx.cues ?? []).filter((c) => sec >= c.atSec && sec <= c.atSec + c.duration).map((c) => ({ sound: c.sound, at: c.atSec, scene: c.sceneId }));
  return { t: Math.round(sec * 1000) / 1000, frame, totalFrames: tl.totalFrames, scenes, audio: { musicGain: Math.round(musicVolumeAt(sec, spec, tl.totalSec) * 1000) / 1000, sfx } };
}
