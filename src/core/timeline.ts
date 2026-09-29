/**
 * Timeline math shared by the engine, audio planner and QC so they agree on
 * exactly when each scene starts. Scene i+1 starts `transition.duration`
 * seconds before scene i ends (overlap), except for cuts.
 */
import type { SceneSpec } from '../schema/video';

export interface TimelineEntry {
  index: number;
  id: string;
  from: number; // frame
  durationInFrames: number;
  /** Frames overlapped with the next scene (outgoing transition). */
  transitionOut: number;
  /** Frames overlapped with the previous scene (incoming transition). */
  transitionIn: number;
  startSec: number;
  endSec: number;
}

export interface Timeline {
  fps: number;
  entries: TimelineEntry[];
  totalFrames: number;
  totalSec: number;
}

export const secToFrames = (s: number, fps: number) => Math.max(0, Math.round(s * fps));

export function buildTimeline(scenes: Pick<SceneSpec, 'id' | 'duration' | 'transition'>[], fps: number): Timeline {
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  let prevOut = 0;
  scenes.forEach((s, i) => {
    const dur = Math.max(1, secToFrames(s.duration, fps));
    const isLast = i === scenes.length - 1;
    const tType = s.transition?.type ?? 'cut';
    let out = isLast || tType === 'cut' || tType === 'none' ? 0 : secToFrames(s.transition?.duration ?? 0.5, fps);
    // A transition may never consume more than 45% of either neighbouring scene.
    if (!isLast) {
      const nextDur = Math.max(1, secToFrames(scenes[i + 1].duration, fps));
      out = Math.min(out, Math.floor(dur * 0.45), Math.floor(nextDur * 0.45));
    }
    const from = i === 0 ? 0 : cursor - prevOut;
    entries.push({
      index: i,
      id: s.id,
      from,
      durationInFrames: dur,
      transitionOut: out,
      transitionIn: prevOut,
      startSec: from / fps,
      endSec: (from + dur) / fps,
    });
    cursor = from + dur;
    prevOut = out;
  });
  const totalFrames = entries.length ? entries[entries.length - 1].from + entries[entries.length - 1].durationInFrames : 1;
  return { fps, entries, totalFrames, totalSec: totalFrames / fps };
}

/** Seconds of content-visible time for a scene (excludes overlaps). */
export function holdWindow(e: TimelineEntry): { start: number; end: number } {
  return { start: e.from + e.transitionIn, end: e.from + e.durationInFrames - e.transitionOut };
}
