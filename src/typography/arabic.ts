/**
 * Arabic-aware text utilities (shared node + browser).
 * - script detection and direction
 * - punctuation normalisation in Arabic context (، ؛ ؟)
 * - numeral system conversion
 * - word tokenisation that keeps Latin runs isolated for bidi
 * - line-break glue so short particles never dangle at a line end
 * - letter-spacing / per-glyph splitting is forbidden for Arabic (breaks joining)
 */
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_G = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN_G = /[A-Za-zÀ-ɏ]/g;

export type Script = 'arabic' | 'latin' | 'mixed' | 'neutral';

export function hasArabic(s: string): boolean {
  return ARABIC_RE.test(s);
}

export function detectScript(s: string): Script {
  const a = (s.match(ARABIC_G) ?? []).length;
  const l = (s.match(LATIN_G) ?? []).length;
  if (a === 0 && l === 0) return 'neutral';
  if (a > 0 && l === 0) return 'arabic';
  if (l > 0 && a === 0) return 'latin';
  return 'mixed';
}

/** Base direction: Arabic wins as soon as it carries meaningful weight. */
export function baseDirection(s: string, fallback: 'rtl' | 'ltr' = 'rtl'): 'rtl' | 'ltr' {
  const a = (s.match(ARABIC_G) ?? []).length;
  const l = (s.match(LATIN_G) ?? []).length;
  if (a === 0 && l === 0) return fallback;
  return a >= l * 0.35 ? 'rtl' : 'ltr';
}

const WESTERN = '0123456789';
const EASTERN = '٠١٢٣٤٥٦٧٨٩';

export function toNumerals(s: string, system: 'latin' | 'arabic-indic'): string {
  if (system === 'arabic-indic') return s.replace(/[0-9]/g, (d) => EASTERN[Number(d)]);
  return s.replace(/[٠-٩]/g, (d) => WESTERN[EASTERN.indexOf(d)]);
}

/**
 * Arabic punctuation in Arabic context: "?"→"؟", ","→"،", ";"→"؛".
 * Only applied when the character follows an Arabic letter (keeps "SaaS, AI?" intact).
 */
export function normalizeArabicPunctuation(s: string): string {
  return s
    .replace(/([؀-ۿ][ً-ٟ]*)\s*\?/g, '$1؟')
    .replace(/([؀-ۿ][ً-ٟ]*)\s*,/g, '$1،')
    .replace(/([؀-ۿ][ً-ٟ]*)\s*;/g, '$1؛')
    .replace(/\s+([،؛؟!.:])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Normalise text for display: punctuation, numerals, whitespace. Never changes words. */
export function prepareText(s: string, opts: { numerals?: 'latin' | 'arabic-indic' } = {}): string {
  let out = String(s ?? '').replace(/\r/g, '');
  if (hasArabic(out)) out = normalizeArabicPunctuation(out);
  if (opts.numerals) out = toNumerals(out, opts.numerals);
  return out.replace(/[ \t]+/g, ' ').trim();
}

/** Short Arabic particles that should stay glued to the following word. */
const GLUE_NEXT = new Set(['في', 'من', 'على', 'إلى', 'الى', 'عن', 'مع', 'أو', 'و', 'يا', 'لا', 'ما', 'قد', 'لم', 'لن', 'كل', 'هل', 'بـ', 'بين', 'حتى', 'ثم', 'أن', 'إن', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with']);

export interface Token {
  text: string;
  script: Script;
  /** True if this token must not end a line (glued to next). */
  glueNext: boolean;
  highlight: boolean;
}

/** Tokenise into words; `highlight` terms (exact words or substrings) are flagged. */
export function tokenize(text: string, highlight: string[] = []): Token[] {
  const hl = highlight.map((h) => h.trim()).filter(Boolean);
  const words = text.split(/\s+/).filter(Boolean);
  const multi = hl.filter((h) => /\s/.test(h));
  const flags = new Array(words.length).fill(false);
  // Multi-word highlight phrases.
  for (const phrase of multi) {
    const pw = phrase.split(/\s+/);
    for (let i = 0; i + pw.length <= words.length; i++) {
      if (pw.every((p, j) => stripPunct(words[i + j]) === stripPunct(p))) for (let j = 0; j < pw.length; j++) flags[i + j] = true;
    }
  }
  return words.map((w, i) => {
    const bare = stripPunct(w);
    const isHl = flags[i] || hl.some((h) => !/\s/.test(h) && (bare === stripPunct(h) || (stripPunct(h).length >= 3 && bare.includes(stripPunct(h)))));
    return { text: w, script: detectScript(w), glueNext: GLUE_NEXT.has(bare.toLowerCase()) && i < words.length - 1, highlight: isHl };
  });
}

export function stripPunct(w: string): string {
  return w.replace(/^[«»"'“”‘’(\[{.,،؛؟!?:;…-]+|[«»"'“”‘’)\]}.,،؛؟!?:;…-]+$/g, '');
}

/**
 * Group tokens into unbreakable units (particle + next word stay together).
 * Returns arrays of token indexes.
 */
export function breakUnits(tokens: Token[]): number[][] {
  const units: number[][] = [];
  let cur: number[] = [];
  tokens.forEach((t, i) => {
    cur.push(i);
    if (!t.glueNext) {
      units.push(cur);
      cur = [];
    }
  });
  if (cur.length) units.push(cur);
  return units;
}

/** Arabic must never be letter-spaced or split per glyph (breaks cursive joining). */
export function safeLetterSpacing(text: string, wanted: number): number {
  return hasArabic(text) ? 0 : wanted;
}

/** Rough reading-time estimate in seconds for on-screen text. */
export function readingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  // ~3.2 words/sec for short display copy, + perception base.
  return 0.6 + words / 3.2;
}
