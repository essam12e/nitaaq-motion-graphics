/**
 * tsx cli/whisper-check.ts <audio> --script "<the exact spoken text>" [--truth words.json] [--models small,large-v3] [--out whisper_check.json]
 *
 * P1-G: Whisper is NOT treated as proven. This checks it, locally only (faster-whisper on this machine,
 * no API, the audio never leaves the machine), against what we know is true:
 *   - the script text  → word accuracy (how many script words Whisper heard, in order)
 *   - optional truth   → timing error per matched word ({words:[{text,start,end?}]}: e.g. hand-marked, or a TTS provider's word marks)
 * Run it once per voice / model on your machine before trusting Whisper timings for that voice.
 * The pipeline never depends on it: voice_map (script + silence + energy) stays the primary timing source.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normWord, tokenize } from '../src/audio/voice-map';

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};

interface W {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

/** Longest common subsequence alignment of normalized words → matched index pairs (order kept). */
export function alignWords(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

function main() {
  const audio = resolve(process.argv[2] ?? '');
  const script = arg('--script');
  if (!process.argv[2] || !script) throw new Error('usage: whisper-check <audio> --script "<text>" [--truth words.json] [--models small,large-v3]');
  const models = (arg('--models') ?? 'small,large-v3').split(',');
  const truth = arg('--truth') ? (JSON.parse(readFileSync(arg('--truth')!, 'utf8')) as { words: { text: string; start: number }[] }).words : null;
  const scriptWords = tokenize(script).map((t) => normWord(t.text)).filter(Boolean);
  const py = process.env.NITAAQ_PYTHON ?? 'python3';
  const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'node', 'whisper', 'whisper_words.py');
  const results = models.map((model) => {
    const t0 = Date.now();
    const r = spawnSync(py, [runner, audio, model, arg('--lang') ?? 'ar'], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const ms = Date.now() - t0;
    let j: { error?: string; detail?: string; text?: string; words?: W[] } = {};
    try {
      j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
    } catch {
      j = { error: `exit ${r.status}`, detail: (r.stderr ?? '').slice(-300) };
    }
    if (j.error || !j.words) return { model, ok: false, error: `${j.error}${j.detail ? ` — ${j.detail.slice(0, 200)}` : ''}`, ms };
    const heard = j.words.map((w) => normWord(w.word)).filter(Boolean);
    const pairs = alignWords(scriptWords, heard);
    const timing = truth
      ? (() => {
          const tw = truth.map((w) => ({ n: normWord(w.text), start: w.start }));
          const tp = alignWords(tw.map((w) => w.n), heard);
          const errs = tp.map(([a, b]) => Math.abs(tw[a].start - j.words![b].start));
          errs.sort((x, y) => x - y);
          return errs.length ? { matched: errs.length, meanAbsErr: +(errs.reduce((s, e) => s + e, 0) / errs.length).toFixed(3), p90: errs[Math.floor(errs.length * 0.9)] ?? errs[errs.length - 1], max: errs[errs.length - 1] } : null;
        })()
      : null;
    return {
      model,
      ok: true,
      ms,
      text: j.text,
      wordAccuracy: +(pairs.length / Math.max(1, scriptWords.length)).toFixed(3),
      extraWords: heard.length - pairs.length,
      missed: scriptWords.filter((_, i) => !pairs.some(([a]) => a === i)),
      meanProbability: +(j.words.reduce((s, w) => s + (w.probability ?? 0), 0) / Math.max(1, j.words.length)).toFixed(3),
      timing,
    };
  });
  const verdict = results.map((r) =>
    !r.ok
      ? `${r.model}: not available here (${r.error})`
      : `${r.model}: ${Math.round((r.wordAccuracy ?? 0) * 100)}% of script words heard${r.timing ? `, timing error mean ${r.timing.meanAbsErr}s / p90 ${r.timing.p90}s` : ''} — ${(r.wordAccuracy ?? 0) >= 0.9 && (!r.timing || r.timing.p90 <= 0.15) ? 'usable for word sync on this voice' : 'NOT reliable for word sync on this voice: keep voice_map estimates'}`,
  );
  const out = { version: 1, audio, script, models: results, verdict, note: 'local faster-whisper only; nothing uploaded. Accuracy is per voice: re-run for a new voice or language.' };
  writeFileSync(arg('--out') ?? 'whisper_check.json', JSON.stringify(out, null, 2));
  for (const v of verdict) console.log(v);
}

if (process.argv[1]?.endsWith('whisper-check.ts')) main();
