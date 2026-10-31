/**
 * Word timings → frame table, ported from MotionMaxxing scripts/sync.mjs (Apache-2.0, see public/mm/NOTICE).
 * On-screen words land `lead` frames BEFORE they are heard (default 2). Pure; used by the mm-kinetic scene
 * to put each word's onset on the voice (NITAAQ's own voice map / Whisper words feed it — no ElevenLabs needed).
 */
export interface TimedWord {
  word: string;
  start: number;
  end: number;
}
export interface SyncedWord extends TimedWord {
  i: number;
  startFrame: number;
  endFrame: number;
  durFrames: number;
  onsetFrame: number;
}

export function syncWords(words: TimedWord[], fps = 30, lead = 2): SyncedWord[] {
  if (!(fps > 0)) throw new Error('syncWords: fps must be > 0');
  if (!Number.isFinite(lead) || lead < 0) throw new Error('syncWords: lead must be >= 0');
  const fr = (s: number) => Math.round(s * fps);
  return words.map((w, i) => {
    if (typeof w.start !== 'number' || typeof w.end !== 'number' || w.end < w.start) throw new Error(`syncWords: bad timing at word #${i}`);
    const s = fr(w.start);
    const e = Math.max(fr(w.end), s + 1);
    return { i, word: w.word, start: +w.start.toFixed(3), end: +w.end.toFixed(3), startFrame: s, endFrame: e, durFrames: e - s, onsetFrame: Math.max(0, s - lead) };
  });
}

/**
 * Onset frames (relative to a shot that starts at `shotStart` seconds) for the words of one on-screen line,
 * matched in order against the voice words. Returns null when the line is not found in the voice.
 */
export function lineOnsets(line: string, voice: TimedWord[], shotStart: number, fps = 30, lead = 2): number[] | null {
  const norm = (s: string) => s.replace(/[ً-ْـ«»"'.,،!?؟:;]/g, '').trim();
  const want = line.split(/\s+/).filter(Boolean).map(norm);
  const synced = syncWords(voice, fps, lead);
  const startF = Math.round(shotStart * fps);
  for (let i = 0; i + want.length <= synced.length; i++) {
    if (synced[i].startFrame < startF - fps) continue;
    if (want.every((w, k) => norm(synced[i + k].word) === w)) return want.map((_, k) => Math.max(0, synced[i + k].onsetFrame - startF));
  }
  return null;
}

/** Gaps between consecutive onsets (what M.words takes as `gaps`). */
export const gapsOf = (onsets: number[]): number[] => onsets.slice(1).map((f, i) => Math.max(1, f - onsets[i]));
