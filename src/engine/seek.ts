/**
 * Deterministic seek(t): the complete state of the film at time t, computed
 * from video.json alone (no rendering, no history). Every engine value is a
 * pure function of the frame, so this is exactly what the renderer draws at t:
 * which scenes are on screen, their local time, the transition progress, the
 * camera state (Camera Engine 2.0), the music gain and the sounds playing.
 * `nitaaq seek <project> <t> [--png]` prints it (and renders that frame).
 */
import { lottieFrameAt, mergeLottieClips, resolveLottieClip, type LottieClip, lottieLogoPlays } from '../media/lottie';
import type { VideoSpec } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { cameraAt, type CameraPlan } from '../camera/moves';
import type { CameraState } from '../camera/rig';
import { musicVolumeAt } from '../audio/mix';
import { mergeClips, resolveClip, videoTimeAt, type ClipPhase, type VideoClip } from '../media/video';
import { vectorPrograms, vectorStateAt, GRAPH_START, type VectorSceneState } from '../vector/scene-program';
import { graphDuration, type VectorGraph } from '../vector/graph';
import { activeAt, cameraFromChoreo, focusAt, hasCamera, passedAt } from '../motion/choreography';
import { interactionOf, cursorAt, elementAt } from '../motion/interaction';
import { interactionChoreo, type InteractionContent } from '../scenes/interaction/program';

export interface FrameState {
  t: number;
  frame: number;
  totalFrames: number;
  scenes: { id: string; type: string; variant?: string; localSec: number; progress: number; phase: 'entering' | 'holding' | 'leaving'; transitionIn?: { type: string; progress: number }; transitionOut?: { type: string; progress: number }; camera?: { move: string; state: CameraState }; videos?: { asset: string; time: number; phase: ClipPhase; loopIndex: number }[]; lotties?: { asset: string; frame: number; phase: ClipPhase; loopIndex: number }[]; vectors?: SceneVector[]; choreography?: SceneChoreography }[];
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
    const videos = sceneVideos(spec, s.content, local / fps);
    const lotties = sceneLotties(spec, s.content, local / fps, s.type);
    const vectors = sceneVectors(s.type, s.variant, s.content, local / fps, e.durationInFrames / fps);
    const choreo = sceneChoreography(s.type, s.variant, s.content, (local / fps) * (s.motion?.speed ?? 1), e.durationInFrames / fps, spec.canvas.width, spec.canvas.height, Boolean(plan));
    scenes.push({ id: s.id, type: s.type, variant: s.variant, localSec: Math.round((local / fps) * 1000) / 1000, progress: Math.round((local / e.durationInFrames) * 1000) / 1000, phase: tin ? 'entering' : tout ? 'leaving' : 'holding', ...(tin ? { transitionIn: tin } : {}), ...(tout ? { transitionOut: tout } : {}), ...(cam ? { camera: cam } : {}), ...(videos.length ? { videos } : {}), ...(lotties.length ? { lotties } : {}), ...(vectors.length ? { vectors } : {}), ...(choreo ? { choreography: choreo } : {}) });
  });
  const sec = frame / fps;
  const sfx = (spec.audio.sfx.cues ?? []).filter((c) => sec >= c.atSec && sec <= c.atSec + c.duration).map((c) => ({ sound: c.sound, at: c.atSec, scene: c.sceneId }));
  return { t: Math.round(sec * 1000) / 1000, frame, totalFrames: tl.totalFrames, scenes, audio: { musicGain: Math.round(musicVolumeAt(sec, spec, tl.totalSec) * 1000) / 1000, sfx } };
}

/**
 * Source time of every video a scene shows (same maths as <VideoMedia>): the
 * asset's clip, overridden by the scene's `clip` (for `video`) or `clips[i]`
 * (for `videos[i]`).
 */
export function sceneVideos(spec: VideoSpec, content: Record<string, unknown>, localSec: number): { asset: string; time: number; phase: ClipPhase; loopIndex: number }[] {
  const out: { asset: string; time: number; phase: ClipPhase; loopIndex: number }[] = [];
  const assetOf = (ref: unknown) => (typeof ref === 'string' ? (spec.assets[ref] ? { id: ref, a: spec.assets[ref] } : Object.entries(spec.assets).map(([id, a]) => ({ id, a })).find((x) => x.a.src === ref)) : undefined);
  const push = (ref: unknown, override?: VideoClip) => {
    const hit = assetOf(ref);
    if (!hit || hit.a.kind !== 'video') return;
    const t = videoTimeAt(localSec, resolveClip(mergeClips(hit.a.clip, override), hit.a.duration), hit.a.fps ?? spec.canvas.fps);
    out.push({ asset: hit.id, ...t });
  };
  push(content.video, content.clip as VideoClip | undefined);
  if (Array.isArray(content.videos)) content.videos.forEach((v, i) => push(v, (content.clips as VideoClip[] | undefined)?.[i]));
  for (const [k, v] of Object.entries(content)) if (k !== 'video' && k !== 'videos' && (typeof v === 'string' || Array.isArray(v))) [v].flat().forEach((x) => push(x));
  return out;
}

/**
 * Lottie frames a scene shows at scene-local second `localSec` (same clip model as video, through the
 * animation's own frame rate). The scene's `lottie` field plays with `content.clip`; a Lottie logo used
 * anywhere else is a still in its finished pose (as <Media> draws it).
 */
export function sceneLotties(spec: VideoSpec, content: Record<string, unknown>, localSec: number, sceneType?: string): { asset: string; frame: number; phase: ClipPhase; loopIndex: number }[] {
  const out: { asset: string; frame: number; phase: ClipPhase; loopIndex: number }[] = [];
  const assetOf = (ref: unknown) => (typeof ref === 'string' ? (spec.assets[ref] ? { id: ref, a: spec.assets[ref] } : Object.entries(spec.assets).map(([id, a]) => ({ id, a })).find((x) => x.a.src === ref)) : undefined);
  const push = (ref: unknown, override: LottieClip | undefined, still: boolean) => {
    const hit = assetOf(ref);
    if (!hit?.a.lottie) return;
    const timing = { fr: hit.a.fps ?? 30, ip: hit.a.lottie.ip, op: hit.a.lottie.op, markers: hit.a.lottie.markers };
    const clip = resolveLottieClip(mergeLottieClips(hit.a.clip as LottieClip | undefined, override), timing);
    const at = still ? lottieFrameAt(1e6, { ...clip, loop: false, rate: 1, delay: 0 }, timing) : lottieFrameAt(localSec, clip, timing);
    out.push({ asset: hit.id, frame: at.frame, phase: at.phase, loopIndex: at.loopIndex });
  };
  push(content.lottie, content.clip as LottieClip | undefined, false);
  for (const [k, v] of Object.entries(content)) {
    // `role` names what the media is (e.g. "logo"), not an asset reference
    if (k === 'lottie' || k === 'role' || !(typeof v === 'string' || Array.isArray(v))) continue;
    [v].flat().forEach((x) => push(x, undefined, assetOf(x)?.a.kind === 'logo' && !lottieLogoPlays(sceneType)));
  }
  return out;
}

export interface SceneVector extends Omit<VectorSceneState, 'mode'> {
  asset: string;
  mode: VectorSceneState['mode'] | 'graph';
  morphTo?: string;
}

/**
 * Where a vector scene's program is at scene-local second `localSec` (same numbers as <VectorArt>):
 * which program (draw / build / morph / graph), its progress and phase.
 */
export function sceneVectors(type: string, variant: string | undefined, content: Record<string, unknown>, localSec: number, sceneSec: number): SceneVector[] {
  if (type !== 'vector-draw') return [];
  const graph = content.graph as VectorGraph | undefined;
  if (graph && (variant === 'graph' || !content.svg)) {
    const dur = graphDuration(graph);
    const t = localSec - GRAPH_START;
    const progress = dur > 0 ? Math.round(Math.min(1, Math.max(0, t / dur)) * 1e4) / 1e4 : 1;
    return [{ asset: 'graph', mode: 'graph', progress, phase: t <= 0 ? 'before' : progress >= 1 ? 'done' : 'running', step: 0, steps: 1 }];
  }
  if (typeof content.svg !== 'string') return [];
  const programs = vectorPrograms(variant, content as { morphTo?: string }, sceneSec);
  const st = vectorStateAt(programs, localSec);
  return [{ asset: content.svg, ...(typeof content.morphTo === 'string' ? { morphTo: content.morphTo } : {}), ...st }];
}

export interface SceneChoreography {
  /** Seconds on the scene's choreography (scene time × motion speed). */
  t: number;
  duration: number;
  /** Named actions running now. */
  active: string[];
  /** Markers and cues already passed (latest last). */
  passed: string[];
  cursor?: { action: string; visible: number; press: number; hover: number };
  /** Element responses to the pointer (hover / press / click / released). */
  elements?: Record<string, { hover: number; press: number; click: number; released: number }>;
  focus?: Record<string, number>;
  camera?: CameraState;
}

/**
 * Where a choreographed scene is at scene-local second `localSec` (same numbers the scene draws):
 * running actions, passed cues, the pointer, element responses, focus and the timeline's camera.
 */
export function sceneChoreography(type: string, variant: string | undefined, content: Record<string, unknown>, localSec: number, sceneSec: number, W: number, H: number, shellCamera = false): SceneChoreography | undefined {
  if (type !== 'interaction-flow') return undefined;
  const c = interactionChoreo(variant ?? 'folder', content as InteractionContent, sceneSec);
  const t = localSec;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const ix = interactionOf(c);
  const out: SceneChoreography = { t: r(t), duration: c.duration, active: activeAt(c, t), passed: passedAt(c, t) };
  if (ix.moves.length || ix.presses.length) {
    const cur = cursorAt(ix, t, () => ({ x: 0, y: 0 }));
    const span = [...c.spans].reverse().find((s) => s.target === 'cursor' && s.start <= t);
    out.cursor = { action: span?.kind ?? 'idle', visible: r(cur.visible), press: r(cur.press), hover: r(cur.hover) };
    out.elements = Object.fromEntries(ix.targets.map((n) => {
      const e = elementAt(ix, n, t);
      return [n, { hover: r(e.hover), press: r(e.press), click: r(e.click), released: r(e.released) }];
    }));
  }
  const f = focusAt(c, t);
  if (Object.keys(f).length) out.focus = f;
  if (hasCamera(c) && !shellCamera) {
    const cam = cameraFromChoreo(c, t, W, H);
    out.camera = Object.fromEntries(Object.entries(cam).map(([k, v]) => [k, r(v)])) as unknown as CameraState;
  }
  return out;
}
