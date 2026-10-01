/**
 * Audio QC (structural, on the planned cues) and motion-variety QC.
 *
 * Audio: repeated files (back-to-back or too often), density, sync error
 * between a file's peak and its motion anchor, detail sounds fighting the
 * voice, key moments (logo / hero / product landing) left silent, SFX doubling
 * the music's own hits. Each finding carries a repair the loop can apply
 * (re-plan with another variation, thin the density, lower the level).
 *
 * Motion variety: the same transition or the same headline text-motion family
 * used too often or back-to-back. Pure.
 */
import type { VideoSpec } from '../schema/video';
import type { QcIssue } from './quality';
import { buildTimeline } from '../core/timeline';
import { voiceIntervals } from '../audio/mix';
import { transitionStats } from '../transitions/engine';

export interface AudioQcStats {
  cues: number;
  uniqueFiles: number;
  maxSameFile: number;
  consecutiveSameFile: number;
  maxPer10s: number;
  syncErrorMaxMs: number;
  voiceDetailOverlaps: number;
}

export function audioQc(spec: VideoSpec, peaks: Map<string, number> = new Map(), keyMoments: { type: string; t: number; scene: string }[] = []): { issues: QcIssue[]; stats: AudioQcStats } {
  const issues: QcIssue[] = [];
  const add = (i: Omit<QcIssue, 'pass'>) => issues.push({ ...i, pass: 'audio' });
  const cues = spec.audio.sfx.enabled ? spec.audio.sfx.cues ?? [] : [];
  const stats: AudioQcStats = { cues: cues.length, uniqueFiles: 0, maxSameFile: 0, consecutiveSameFile: 0, maxPer10s: 0, syncErrorMaxMs: 0, voiceDetailOverlaps: 0 };
  if (!spec.audio.sfx.enabled) return { issues, stats };
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  if (!cues.length) {
    if (!spec.audio.music && !spec.audio.voice) add({ severity: 'warning', code: 'AUDIO_EMPTY', message: 'SFX are on but nothing was planned and there is no music or voice — the film is silent', repair: { action: 'resound' } });
    return { issues, stats };
  }
  const counts = new Map<string, number>();
  cues.forEach((c, i) => {
    counts.set(c.file, (counts.get(c.file) ?? 0) + 1);
    if (i > 0 && cues[i - 1].file === c.file && c.atSec - cues[i - 1].atSec < 4) stats.consecutiveSameFile++;
  });
  stats.uniqueFiles = counts.size;
  stats.maxSameFile = Math.max(...counts.values());
  for (const c of cues) stats.maxPer10s = Math.max(stats.maxPer10s, cues.filter((d) => d.atSec >= c.atSec && d.atSec < c.atSec + 10).length);
  if (stats.consecutiveSameFile > 0) add({ severity: 'error', code: 'SFX_REPEAT_CONSECUTIVE', message: `the same sound file plays back-to-back ${stats.consecutiveSameFile}× — reads as a loop`, fix: 're-plan with another variation; the director scores variants against the last cue', repair: { action: 'resound' } });
  const cap = Math.max(2, Math.ceil(cues.length / 5));
  for (const [file, n] of counts) if (n > cap && !file.includes('explicit')) add({ severity: 'warning', code: 'SFX_REPEAT_OVERUSED', element: file, message: `${file} is used ${n}× in one film (cap ${cap})`, repair: { action: 'resound' } });
  const densityCap = Math.round(6 + spec.audio.sfx.intensity * 10);
  if (stats.maxPer10s > densityCap) add({ severity: 'warning', code: 'SFX_DENSITY', message: `${stats.maxPer10s} sounds in one 10-second window (cap ${densityCap}) — the mix gets busy`, repair: { action: 'thin-sfx', value: 0.15 } });
  // sync: file peak vs anchor (needs the bank's peak table)
  for (const c of cues) {
    if (c.anchorSec === undefined) continue;
    const pk = c.family.startsWith('riser') || c.family.startsWith('swell') ? undefined : peaks.get(c.sound);
    if (pk === undefined) continue;
    const err = Math.abs(c.atSec + pk - c.anchorSec) * 1000;
    stats.syncErrorMaxMs = Math.max(stats.syncErrorMaxMs, Math.round(err));
    if (err > 80) add({ severity: 'warning', code: 'SFX_SYNC', scene: c.sceneId, element: c.sound, time: c.anchorSec, message: `${c.sound} peaks ${Math.round(err)} ms away from its motion anchor (${c.event}/${c.anchor})`, repair: { action: 'resound' } });
  }
  // voice competition
  const voice = voiceIntervals(spec);
  for (const c of cues) {
    const t = c.anchorSec ?? c.atSec;
    if (c.layer === 'detail' && voice.some((v) => t >= v.start && t <= v.end) && c.volume > 0.3) {
      stats.voiceDetailOverlaps++;
    }
  }
  if (stats.voiceDetailOverlaps > 0) add({ severity: 'warning', code: 'SFX_VOICE_CLASH', message: `${stats.voiceDetailOverlaps} detail sound(s) play loud under the voice`, repair: { action: 'lower-sfx', value: 0.75 } });
  // key moments must be heard (when the film has SFX at all)
  for (const k of keyMoments) {
    if (!cues.some((c) => Math.abs((c.anchorSec ?? c.atSec) - k.t) < 0.15)) add({ severity: 'warning', code: 'SFX_KEY_SILENT', scene: k.scene, time: k.t, message: `key moment ${k.type} at ${k.t.toFixed(2)}s has no sound`, repair: { action: 'resound' } });
  }
  // doubling the music's own hits
  const hits = spec.audio.soundtrack?.hits ?? [];
  const doubled = cues.filter((c) => c.layer === 'impact' && hits.some((h) => Math.abs(h - (c.anchorSec ?? c.atSec)) < 0.06) && c.volume > 0.6).length;
  if (doubled) add({ severity: 'info', code: 'SFX_DOUBLES_MUSIC', message: `${doubled} impact(s) sit exactly on soundtrack hits at full level (already reduced by the director when under 0.6)` });
  void tl;
  return { issues, stats };
}

/** Transition / text-motion repetition in the compiled film. */
export function motionVarietyQc(spec: VideoSpec): QcIssue[] {
  const issues: QcIssue[] = [];
  const types = spec.scenes.slice(0, -1).map((s) => s.transition?.type ?? 'cut');
  if (types.length >= 3) {
    const st = transitionStats(types);
    if (st.consecutiveRepeats > 0) issues.push({ severity: 'warning', pass: 'motion', code: 'TRANSITION_REPEAT', message: `the same non-cut transition is used back-to-back ${st.consecutiveRepeats}×` });
    if (st.maxShare > 0.5 && types.length >= 4) issues.push({ severity: 'warning', pass: 'motion', code: 'TRANSITION_MONOTONY', message: `one transition type covers ${Math.round(st.maxShare * 100)}% of the cuts` });
  }
  const heads = spec.scenes.map((s) => (s.motion as { text?: Record<string, string> } | undefined)?.text?.headline).filter((x): x is string => Boolean(x));
  let rep = 0;
  heads.forEach((h, i) => i > 0 && h === heads[i - 1] && rep++);
  if (rep) issues.push({ severity: 'warning', pass: 'motion', code: 'TEXT_MOTION_REPEAT', message: `the same headline text motion is used in consecutive scenes ${rep}×` });
  const counts: Record<string, number> = {};
  for (const h of heads) counts[h] = (counts[h] ?? 0) + 1;
  const cap = Math.max(2, Math.ceil(heads.length / 3));
  for (const [h, n] of Object.entries(counts)) if (n > cap) issues.push({ severity: 'warning', pass: 'motion', code: 'TEXT_MOTION_OVERUSED', element: h, message: `headline motion ${h} used ${n}× (cap ${cap})` });
  return issues;
}
