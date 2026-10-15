/**
 * Voice Map (P0-D): word-level timing of a voice-over, so the voice — not the music — drives timing.
 * Pure: the node side (src/node/voice-map.ts) runs local Whisper (faster-whisper) or ffmpeg
 * silencedetect and hands the raw results here.
 *
 * Every value carries its provenance:
 *   measured  — read from the audio (Whisper word times, silence gaps, RMS energy)
 *   estimated — word times distributed inside measured speech segments by word length (no Whisper)
 *   inferred  — a judgement built on measurements (emphasis candidates, keywords, pause kinds)
 * Nothing here detects emotion. Emphasis candidates are acoustic + lexical cues, not feelings.
 */

export const VOICE_MAP_VERSION = 1;

export type Provenance = 'measured' | 'estimated' | 'inferred';
export type VoiceEngine = 'faster-whisper' | 'silencedetect+transcript' | 'silencedetect';

export interface Span {
  start: number;
  end: number;
}

export interface VoiceWord extends Span {
  text: string;
  /** Normalised form used for matching (no tashkeel/tatweel, unified alef). */
  norm: string;
  /** Whisper word probability (0..1); null when the time is estimated. */
  confidence: number | null;
  source: 'measured' | 'estimated';
  segment: number;
}

export interface VoicePause extends Span {
  sec: number;
  kind: 'breath' | 'phrase' | 'section';
  source: 'measured';
}

export interface EmphasisCandidate extends Span {
  word: string;
  score: number;
  reasons: string[];
  source: 'inferred';
}

export interface VoiceMap {
  version: number;
  audio: string;
  duration: number;
  /** Seconds the audio starts after film time 0 (applied to every time below: times are film seconds). */
  offset: number;
  engine: { name: VoiceEngine; model?: string; language: string; whisper: { available: boolean; reason?: string } };
  transcript: { text: string; source: 'whisper' | 'provided' | 'none' };
  words: VoiceWord[];
  segments: (Span & { text?: string; source: 'measured' })[];
  pauses: VoicePause[];
  speechRate: { wordsPerSec: number; wordsPerMin: number; speechSec: number; source: Provenance; perSegment: { segment: number; wordsPerSec: number }[] };
  energy: { hop: number; curve: number[]; mean: number; source: 'measured'; note: string };
  emphasisCandidates: EmphasisCandidate[];
  keywords: { word: string; count: number; firstAt: number | null; source: 'inferred' }[];
  confidence: { overall: number; timing: 'word-measured' | 'word-estimated' | 'segment-only'; note: string };
  provenance: Record<string, Provenance>;
  notes: string[];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Arabic-aware normalisation for matching words (keeps letters and digits only). */
export function normWord(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '') // tashkeel, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة(?=$|[^\p{L}])/gu, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

/** Split a transcript into words, keeping where clauses end (punctuation) for phrase alignment. */
export function tokenize(text: string): { text: string; clauseEnd: boolean }[] {
  const out: { text: string; clauseEnd: boolean }[] = [];
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue;
    const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, '');
    const end = /[.!?؟،,؛;:…—]$/.test(raw);
    if (!clean) {
      if (end && out.length) out[out.length - 1].clauseEnd = true;
      continue;
    }
    out.push({ text: clean, clauseEnd: end });
  }
  return out;
}

/** Spoken weight of a word: letters (Arabic diacritics don't count) plus a fixed onset cost. */
const weightOf = (w: string) => normWord(w).length + 1.5;

/**
 * Estimated word times when Whisper is unavailable: words are placed only inside measured speech
 * segments. If the transcript's clauses match the segments one-to-one they are aligned clause by
 * clause; otherwise words are distributed over total speech time by spoken weight and never
 * straddle a silence.
 */
export function estimateWordTimes(text: string, segments: Span[]): VoiceWord[] {
  const toks = tokenize(text);
  if (!toks.length || !segments.length) return [];
  const clauses: { text: string; clauseEnd: boolean }[][] = [[]];
  toks.forEach((t, i) => {
    clauses[clauses.length - 1].push(t);
    if (t.clauseEnd && i < toks.length - 1) clauses.push([]);
  });
  const place = (words: { text: string }[], segs: { s: Span; i: number }[]): VoiceWord[] => {
    const total = segs.reduce((a, x) => a + (x.s.end - x.s.start), 0);
    const wsum = words.reduce((a, w) => a + weightOf(w.text), 0);
    // map a weight position to speech time (skipping silences)
    const at = (pos: number): { t: number; seg: number } => {
      let need = (pos / wsum) * total;
      for (const x of segs) {
        const len = x.s.end - x.s.start;
        if (need <= len + 1e-9) return { t: x.s.start + need, seg: x.i };
        need -= len;
      }
      const last = segs[segs.length - 1];
      return { t: last.s.end, seg: last.i };
    };
    const out: VoiceWord[] = [];
    let cum = 0;
    for (const w of words) {
      const a = at(cum);
      cum += weightOf(w.text);
      const b = at(cum);
      let start = a.t;
      let end = b.t;
      let seg = a.seg;
      if (a.seg !== b.seg) {
        // straddles a silence: keep the word whole in the segment holding most of it
        const sa = segments[a.seg];
        const sb = segments[b.seg];
        if (sa.end - a.t >= b.t - sb.start) end = sa.end;
        else {
          start = sb.start;
          seg = b.seg;
        }
      }
      out.push({ text: w.text, norm: normWord(w.text), start: r3(start), end: r3(Math.max(start + 0.05, end)), confidence: null, source: 'estimated', segment: seg });
    }
    return out;
  };
  if (clauses.length === segments.length && clauses.length > 1) return clauses.flatMap((c, i) => place(c, [{ s: segments[i], i }]));
  return place(toks, segments.map((s, i) => ({ s, i })));
}

/**
 * Refine estimated word boundaries with the measured energy curve: inside one speech segment the
 * boundary between two words moves to the quietest hop within ±0.25 s, when that hop is a real dip
 * (< 25 % of the louder neighbour). Still an estimate — just a better-anchored one.
 */
export function refineWithEnergy(words: VoiceWord[], energy: { hop: number; curve: number[] }): VoiceWord[] {
  if (!energy.curve.length || words.length < 2) return words;
  const out = words.map((w) => ({ ...w }));
  const { hop, curve } = energy;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (a.segment !== b.segment) continue;
    const at = b.start;
    const lo = Math.max(Math.ceil((a.start + 0.12) / hop), Math.floor((at - 0.25) / hop));
    const hi = Math.min(Math.floor((b.end - 0.12) / hop), Math.ceil((at + 0.25) / hop), curve.length - 1);
    if (hi <= lo) continue;
    let k = lo;
    for (let j = lo; j <= hi; j++) if (curve[j] < curve[k] || (curve[j] === curve[k] && Math.abs(j * hop - at) < Math.abs(k * hop - at))) k = j;
    const peak = Math.max(...curve.slice(Math.max(0, lo - 4), Math.min(curve.length, hi + 5)));
    if (curve[k] >= peak * 0.25) continue;
    // the dip hop is silence: the previous word ends at its start, the next begins at its end
    let e = k;
    while (e + 1 <= hi && curve[e + 1] < peak * 0.25) e++;
    let s0 = k;
    while (s0 - 1 >= lo && curve[s0 - 1] < peak * 0.25) s0--;
    a.end = r3(Math.max(a.start + 0.05, s0 * hop));
    b.start = r3(Math.min(b.end - 0.05, (e + 1) * hop));
  }
  return out;
}

/** Gaps between speech segments, classified by length (measured gaps, inferred kinds). */
export function pausesFrom(segments: Span[]): VoicePause[] {
  const out: VoicePause[] = [];
  for (let i = 1; i < segments.length; i++) {
    const start = segments[i - 1].end;
    const end = segments[i].start;
    const sec = end - start;
    if (sec <= 0.08) continue;
    out.push({ start: r3(start), end: r3(end), sec: r3(sec), kind: sec < 0.35 ? 'breath' : sec < 0.8 ? 'phrase' : 'section', source: 'measured' });
  }
  return out;
}

/** RMS of 16-bit mono PCM in hops of `hop` seconds, normalised to the loudest hop (0..1). */
export function rmsCurve(pcm: Int16Array, sampleRate: number, hop = 0.05): number[] {
  const n = Math.max(1, Math.round(sampleRate * hop));
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += n) {
    let s = 0;
    const end = Math.min(pcm.length, i + n);
    for (let k = i; k < end; k++) s += (pcm[k] / 32768) ** 2;
    out.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const max = Math.max(1e-9, ...out);
  return out.map((x) => r3(x / max));
}

/** Common Arabic and English function words: never keywords, rarely emphasis. */
export const STOPWORDS = new Set(
  [
    'في', 'من', 'على', 'الى', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين', 'ان', 'أن', 'إن', 'كان', 'كانت', 'لا', 'ما', 'لم', 'لن', 'قد', 'ثم', 'او', 'أو', 'و', 'ف', 'كل', 'بعد', 'قبل', 'عند', 'حتى', 'هو', 'هي', 'هم', 'نحن', 'انت', 'أنت', 'انا', 'أنا', 'لك', 'لكم', 'له', 'لها', 'به', 'بها', 'فيه', 'فيها', 'منه', 'منها', 'اليوم', 'الآن', 'يا', 'بين', 'غير', 'كما', 'لكن', 'إذا', 'اذا', 'هل',
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was', 'be', 'it', 'this', 'that', 'you', 'your', 'we', 'our', 'at', 'by', 'from', 'as', 'not', 'no', 'so', 'but', 'if', 'all',
  ].map(normWord),
);

const isNumberish = (w: string) => /\p{N}/u.test(w) || /%$/.test(w);

export function keywordsOf(words: { text: string; start: number | null }[], limit = 8): VoiceMap['keywords'] {
  const m = new Map<string, { word: string; count: number; firstAt: number | null }>();
  for (const w of words) {
    const n = normWord(w.text);
    if (!n || STOPWORDS.has(n) || (n.length < 3 && !isNumberish(n))) continue;
    // fold the Arabic definite article for counting ("المنصة" and "منصة" are one keyword)
    const key = n.startsWith('ال') && n.length > 4 ? n.slice(2) : n;
    const e = m.get(key);
    if (e) e.count++;
    else m.set(key, { word: w.text, count: 1, firstAt: w.start });
  }
  return [...m.values()]
    .map((e) => ({ ...e, score: e.count * 2 + normWord(e.word).length * 0.15 + (isNumberish(e.word) ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || (a.firstAt ?? 0) - (b.firstAt ?? 0))
    .slice(0, limit)
    .map(({ word, count, firstAt }) => ({ word, count, firstAt, source: 'inferred' as const }));
}

/**
 * Emphasis candidates (inferred): words that stand out acoustically or lexically —
 * louder than their phrase, followed by a pause, stretched, a number, a keyword, or the first word
 * after a section break. At most about one per 2.5 s of speech so emphasis stays meaningful.
 */
export function emphasisCandidates(words: VoiceWord[], pauses: VoicePause[], energy: { hop: number; curve: number[] }, keywords: Set<string>): EmphasisCandidate[] {
  if (!words.length) return [];
  const eAt = (w: Span) => {
    const a = Math.floor(w.start / energy.hop);
    const b = Math.max(a + 1, Math.ceil(w.end / energy.hop));
    const sl = energy.curve.slice(a, b);
    return sl.length ? Math.max(...sl) : 0;
  };
  const segE = new Map<number, number>();
  for (const w of words) segE.set(w.segment, Math.max(segE.get(w.segment) ?? 0, 0) + eAt(w));
  const segCount = new Map<number, number>();
  for (const w of words) segCount.set(w.segment, (segCount.get(w.segment) ?? 0) + 1);
  const perChar = words.map((w) => (w.end - w.start) / Math.max(1, w.norm.length));
  const medPerChar = [...perChar].sort((a, b) => a - b)[Math.floor(perChar.length / 2)];
  const measured = words[0].source === 'measured';
  const cands = words.map((w, i) => {
    const reasons: string[] = [];
    let score = 0;
    if (STOPWORDS.has(w.norm) || w.norm.length < 2) return { w, score: -1, reasons };
    const segMean = (segE.get(w.segment) ?? 0) / Math.max(1, segCount.get(w.segment) ?? 1);
    const e = eAt(w);
    if (energy.curve.length && segMean > 0 && e > segMean * 1.15) {
      score += 1.2;
      reasons.push(`louder than its phrase (${Math.round((e / segMean) * 100)}%)`);
    }
    const after = pauses.find((p) => Math.abs(p.start - w.end) < 0.12);
    if (after && after.sec >= 0.25) {
      score += after.kind === 'section' ? 1.2 : 0.8;
      reasons.push(`followed by a ${after.sec.toFixed(2)} s pause`);
    }
    const before = pauses.find((p) => Math.abs(p.end - w.start) < 0.12 && p.kind === 'section');
    if (before) {
      score += 0.5;
      reasons.push('first word after a section pause');
    }
    if (measured && perChar[i] > medPerChar * 1.35) {
      score += 0.8;
      reasons.push('stretched (slower than the speaker’s median)');
    }
    if (isNumberish(w.text)) {
      score += 1.2;
      reasons.push('number');
    }
    const key = w.norm.startsWith('ال') && w.norm.length > 4 ? w.norm.slice(2) : w.norm;
    if (keywords.has(key)) {
      score += 0.8;
      reasons.push('keyword');
    }
    return { w, score, reasons };
  });
  const speech = words[words.length - 1].end - words[0].start;
  const max = Math.max(1, Math.round(speech / 2.5));
  const picked = cands
    .filter((c) => c.score >= 1)
    .sort((a, b) => b.score - a.score)
    .filter((c, _, arr) => !arr.some((o) => o !== c && o.score > c.score && Math.abs(o.w.start - c.w.start) < 0.8))
    .slice(0, max)
    .sort((a, b) => a.w.start - b.w.start);
  return picked.map((c) => ({ word: c.w.text, start: c.w.start, end: c.w.end, score: r3(c.score), reasons: c.reasons, source: 'inferred' as const }));
}

export interface WhisperResult {
  language: string;
  model: string;
  text: string;
  segments: { start: number; end: number; text: string }[];
  words: { word: string; start: number; end: number; probability: number }[];
}

export interface VoiceMapInput {
  audio: string;
  duration: number;
  offset?: number;
  language?: string;
  /** Speech segments from silencedetect (always measured; used for pauses and as Whisper fallback). */
  speech: Span[];
  whisper?: WhisperResult | null;
  whisperReason?: string;
  /** Script text, when known (used to estimate word times without Whisper). */
  transcript?: string;
  energy?: { hop: number; curve: number[] };
}

export function buildVoiceMap(input: VoiceMapInput): VoiceMap {
  const off = input.offset ?? 0;
  const shift = (x: number) => r3(x + off);
  const w = input.whisper;
  const useWhisper = Boolean(w && w.words.length);
  // segments: Whisper's own when it ran (measured from speech), else silencedetect's
  const segs: Span[] = useWhisper ? w!.segments.map((s) => ({ start: s.start, end: s.end })) : input.speech;
  let words: VoiceWord[];
  if (useWhisper) {
    words = w!.words
      .map((x) => ({ text: x.word.trim(), start: x.start, end: x.end, p: x.probability }))
      .filter((x) => normWord(x.text))
      .map((x) => {
        const seg = Math.max(0, segs.findIndex((s) => x.start >= s.start - 0.05 && x.start < s.end + 0.05));
        return { text: x.text, norm: normWord(x.text), start: r3(x.start), end: r3(x.end), confidence: r3(x.p), source: 'measured' as const, segment: seg };
      });
  } else words = input.transcript ? refineWithEnergy(estimateWordTimes(input.transcript, input.speech), input.energy ?? { hop: 0.05, curve: [] }) : [];

  // pauses come from the measured silences (Whisper segments can swallow short breaths)
  const pauses = pausesFrom(input.speech);
  const speechSec = input.speech.reduce((a, s) => a + (s.end - s.start), 0);
  const energy = input.energy ?? { hop: 0.05, curve: [] };
  const kw = keywordsOf(words.map((x) => ({ text: x.text, start: x.start })));
  const kwSet = new Set(kw.map((k) => (normWord(k.word).startsWith('ال') && normWord(k.word).length > 4 ? normWord(k.word).slice(2) : normWord(k.word))));
  const emph = emphasisCandidates(words, pauses, energy, kwSet);
  const perSegment = segs.map((s, i) => {
    const n = words.filter((x) => x.segment === i).length;
    return { segment: i, wordsPerSec: r3(n / Math.max(0.1, s.end - s.start)) };
  });
  const timing = useWhisper ? 'word-measured' : words.length ? 'word-estimated' : 'segment-only';
  const conf = useWhisper ? r3(words.reduce((a, x) => a + (x.confidence ?? 0), 0) / Math.max(1, words.length)) : words.length ? 0.4 : 0.2;
  const transcriptText = useWhisper ? w!.text.trim() : input.transcript?.trim() ?? '';

  return {
    version: VOICE_MAP_VERSION,
    audio: input.audio,
    duration: r3(input.duration),
    offset: off,
    engine: {
      name: useWhisper ? 'faster-whisper' : words.length ? 'silencedetect+transcript' : 'silencedetect',
      model: w?.model,
      language: w?.language ?? input.language ?? 'ar',
      whisper: { available: useWhisper, reason: useWhisper ? undefined : input.whisperReason ?? 'not run' },
    },
    transcript: { text: transcriptText, source: useWhisper ? 'whisper' : input.transcript ? 'provided' : 'none' },
    words: words.map((x) => ({ ...x, start: shift(x.start), end: shift(x.end) })),
    segments: segs.map((s, i) => ({ start: shift(s.start), end: shift(s.end), text: useWhisper ? w!.segments[i]?.text.trim() : undefined, source: 'measured' as const })),
    pauses: pauses.map((p) => ({ ...p, start: shift(p.start), end: shift(p.end) })),
    speechRate: { wordsPerSec: r3(words.length / Math.max(0.1, speechSec)), wordsPerMin: Math.round((words.length / Math.max(0.1, speechSec)) * 60), speechSec: r3(speechSec), source: useWhisper ? 'measured' : 'estimated', perSegment },
    energy: { hop: energy.hop, curve: energy.curve, mean: r3(energy.curve.length ? energy.curve.reduce((a, x) => a + x, 0) / energy.curve.length : 0), source: 'measured', note: 'RMS loudness per hop, normalised to the loudest hop (audio time, before offset)' },
    emphasisCandidates: emph.map((e) => ({ ...e, start: shift(e.start), end: shift(e.end) })),
    keywords: kw.map((k) => ({ ...k, firstAt: k.firstAt === null ? null : shift(k.firstAt) })),
    confidence: {
      overall: conf,
      timing,
      note: useWhisper
        ? 'word times measured by local Whisper (mean word probability)'
        : words.length
          ? 'Whisper unavailable: word times ESTIMATED inside measured speech segments by word length (on clean synthetic Arabic speech: mean ≈ 45 ms, worst ≈ 160 ms; natural speech with fewer gaps will be worse); pauses and segments are measured'
          : 'Whisper unavailable and no transcript: only speech segments and pauses are known',
    },
    provenance: {
      words: useWhisper ? 'measured' : 'estimated',
      segments: 'measured',
      pauses: 'measured',
      'pauses.kind': 'inferred',
      speechRate: useWhisper ? 'measured' : 'estimated',
      energy: 'measured',
      emphasisCandidates: 'inferred',
      keywords: 'inferred',
      transcript: useWhisper ? 'measured' : 'inferred',
    },
    notes: [
      'No emotion detection: Whisper and silencedetect give words, times and loudness only. Emphasis candidates are acoustic/lexical cues, not feelings.',
      'All times are film seconds (audio time + offset).',
      'Voice is the primary timing source; music beats only sweeten (secondary motion, micro accents, transitions).',
    ],
  };
}

/** Find a spoken word (normalised, Arabic-aware) at or after `from` seconds. */
export function findWord(map: Pick<VoiceMap, 'words'>, word: string, from = 0): VoiceWord | undefined {
  const n = normWord(word);
  if (!n) return undefined;
  const strip = (x: string) => (x.startsWith('ال') && x.length > 3 ? x.slice(2) : x);
  return (
    map.words.find((w) => w.start >= from - 0.05 && w.norm === n) ??
    map.words.find((w) => w.start >= from - 0.05 && strip(w.norm) === strip(n)) ??
    map.words.find((w) => w.start >= from - 0.05 && n.length >= 3 && (w.norm.includes(n) || (w.norm.length >= 3 && n.includes(w.norm))))
  );
}
