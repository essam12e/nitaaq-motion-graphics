/**
 * Node side of the Voice Map (P0-D): local word-level timing for a voice-over.
 *
 *   1. faster-whisper (local, CPU by default — the audio never leaves this machine) → measured words
 *   2. Whisper unavailable → ffmpeg silencedetect speech segments + the script text → estimated words
 *   3. no transcript either → segments and pauses only
 *
 * Configure with NITAAQ_WHISPER=off|auto (default auto), NITAAQ_WHISPER_MODEL (default "small";
 * "large-v3" is much better for Arabic and much slower), NITAAQ_WHISPER_OFFLINE=1 (never download a
 * model), NITAAQ_PYTHON (python executable). Results are cached by audio hash + model.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { findFfmpeg, ffEnv, probe, detectSpeechSegments } from './audio';
import { ROOT, workspace } from './workspace';
import { buildVoiceMap, rmsCurve, type VoiceMap, type WhisperResult } from '../audio/voice-map';

export interface WhisperRun {
  result: WhisperResult | null;
  reason?: string;
}

export type WhisperRunner = (audio: string, model: string, language: string, offline: boolean) => WhisperRun;

const SCRIPT = join(ROOT, 'src', 'node', 'whisper', 'whisper_words.py');

/** Default runner: the bundled faster-whisper script in a local Python. */
export const runFasterWhisper: WhisperRunner = (audio, model, language, offline) => {
  const py = process.env.NITAAQ_PYTHON ?? 'python3';
  const check = spawnSync(py, ['-c', 'import faster_whisper'], { encoding: 'utf8' });
  if (check.error || check.status !== 0) return { result: null, reason: `faster-whisper is not installed for ${py} (pip install faster-whisper)` };
  const r = spawnSync(py, [SCRIPT, audio, model, language, ...(offline ? ['--offline'] : [])], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: Number(process.env.NITAAQ_WHISPER_TIMEOUT_MS ?? 15 * 60_000) });
  const line = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  try {
    const j = JSON.parse(line) as WhisperResult & { error?: string; detail?: string };
    if (j.error) return { result: null, reason: `faster-whisper failed: ${j.error}${j.detail ? ` — ${j.detail.slice(0, 200)}` : ''}` };
    return { result: j };
  } catch {
    return { result: null, reason: `faster-whisper failed (exit ${r.status ?? r.signal}): ${(r.stderr ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 300)}` };
  }
};

/** Mono 16 kHz PCM of the audio, for the energy curve. */
function pcm16(audio: string): Int16Array {
  const { ffmpeg } = findFfmpeg();
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { env: ffEnv(), maxBuffer: 1 << 30 });
  const b: Buffer = r.stdout ?? Buffer.alloc(0);
  return new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2));
}

export interface VoiceMapOptions {
  transcript?: string;
  /** Film time at which the audio starts (direct() places the voice 0.35 s in). */
  offset?: number;
  language?: string;
  engine?: 'auto' | 'whisper' | 'silence';
  model?: string;
  out?: string | false;
  runner?: WhisperRunner;
  cache?: boolean;
}

export function voiceMap(audio: string, opts: VoiceMapOptions = {}): { map: VoiceMap; file: string | null } {
  const duration = probe(audio).duration;
  const seg = detectSpeechSegments(audio, { minSilence: 0.18, mergeGap: 0.05, minSegment: 0.08 });
  const engine = opts.engine ?? (process.env.NITAAQ_WHISPER === 'off' ? 'silence' : 'auto');
  const model = opts.model ?? process.env.NITAAQ_WHISPER_MODEL ?? 'small';
  const language = opts.language ?? 'ar';
  let whisper: WhisperResult | null = null;
  let reason: string | undefined = engine === 'silence' ? 'disabled (engine=silence)' : undefined;
  if (engine !== 'silence') {
    const key = createHash('sha1').update(readFileSync(audio)).update(`${model}|${language}`).digest('hex').slice(0, 16);
    const cacheFile = join(workspace().cache, 'voice-map', `${key}.json`);
    if (opts.cache !== false && !opts.runner && existsSync(cacheFile)) whisper = JSON.parse(readFileSync(cacheFile, 'utf8')) as WhisperResult;
    else {
      const run = (opts.runner ?? runFasterWhisper)(audio, model, language, process.env.NITAAQ_WHISPER_OFFLINE === '1');
      whisper = run.result && run.result.words?.length ? run.result : null;
      reason = run.result && !run.result.words?.length ? 'Whisper returned no words' : run.reason;
      if (whisper && opts.cache !== false && !opts.runner) {
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(whisper));
      }
    }
    if (engine === 'whisper' && !whisper) throw new Error(`Whisper was required (engine=whisper) but is unavailable: ${reason}`);
  }
  const hop = 0.05;
  const map = buildVoiceMap({
    audio,
    duration,
    offset: opts.offset ?? 0,
    language,
    speech: seg.segments,
    whisper,
    whisperReason: reason,
    transcript: opts.transcript,
    energy: { hop, curve: rmsCurve(pcm16(audio), 16000, hop) },
  });
  const file = opts.out === false ? null : opts.out ?? join(dirname(audio), 'voice_map.json');
  if (file) writeFileSync(file, JSON.stringify(map, null, 2));
  return { map, file };
}

/** Transcript argument: literal text, or a path to a text file. */
export function readTranscript(arg: string | undefined): string | undefined {
  if (!arg) return undefined;
  try {
    if (existsSync(arg) && statSync(arg).isFile()) return readFileSync(arg, 'utf8');
  } catch {
    /* literal text */
  }
  return arg;
}
