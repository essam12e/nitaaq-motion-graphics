/**
 * Content-aware text fitting with Arabic-friendly balanced line breaking.
 * Order of attempts (never silently overflow):
 *   1. break lines (balanced, particle-glued)
 *   2. use available width
 *   3. reduce font size down to a safe minimum
 *   4. report `fits:false` so the layout can switch variant / auto-repair.
 * Pure: the measurer is injected (canvas in the browser, estimator in tests).
 */
import { breakUnits, tokenize, type Token } from './arabic';

export type Measurer = (text: string, font: { size: number; weight: number; family: string }) => number;

export interface FitInput {
  text: string;
  highlight?: string[];
  maxWidth: number;
  maxHeight?: number;
  maxLines: number;
  maxSize: number;
  minSize: number;
  lineHeight: number;
  weight: number;
  family: string;
  latinFamily?: string;
  /** Extra horizontal px per highlighted token (marker padding). */
  highlightPad?: number;
  measure: Measurer;
}

export interface FitResult {
  fontSize: number;
  lines: Token[][];
  width: number;
  height: number;
  fits: boolean;
  reason?: 'word-too-wide' | 'too-many-lines' | 'too-tall';
}

function tokenWidth(t: Token, size: number, inp: FitInput): number {
  const fam = t.script === 'latin' && inp.latinFamily ? inp.latinFamily : inp.family;
  return inp.measure(t.text, { size, weight: inp.weight, family: fam }) + (t.highlight ? (inp.highlightPad ?? 0) * size : 0);
}

function layout(tokens: Token[], widths: number[], space: number, maxWidth: number): { lines: number[][]; widest: number; overflow: boolean } {
  const units = breakUnits(tokens);
  const lines: number[][] = [];
  let cur: number[] = [];
  let curW = 0;
  let widest = 0;
  let overflow = false;
  for (const u of units) {
    const uw = u.reduce((s, i) => s + widths[i], 0) + space * (u.length - 1);
    const add = cur.length ? space + uw : uw;
    if (cur.length && curW + add > maxWidth) {
      lines.push(cur);
      widest = Math.max(widest, curW);
      cur = [...u];
      curW = uw;
    } else {
      cur.push(...u);
      curW += add;
    }
    if (uw > maxWidth) overflow = true;
  }
  if (cur.length) {
    lines.push(cur);
    widest = Math.max(widest, curW);
  }
  return { lines, widest, overflow };
}

export function fitText(inp: FitInput): FitResult {
  const tokens = tokenize(inp.text, inp.highlight ?? []);
  if (!tokens.length) return { fontSize: inp.maxSize, lines: [], width: 0, height: 0, fits: true };
  const step = Math.max(1, inp.maxSize * 0.04);
  let last: FitResult | null = null;
  for (let size = inp.maxSize; size >= inp.minSize - 0.001; size -= step) {
    const s = Math.max(inp.minSize, size);
    const widths = tokens.map((t) => tokenWidth(t, s, inp));
    const space = inp.measure(' ', { size: s, weight: inp.weight, family: inp.family }) || s * 0.28;
    const first = layout(tokens, widths, space, inp.maxWidth);
    const lh = s * inp.lineHeight;
    const height = first.lines.length * lh;
    let reason: FitResult['reason'];
    if (first.overflow) reason = 'word-too-wide';
    else if (first.lines.length > inp.maxLines) reason = 'too-many-lines';
    else if (inp.maxHeight && height > inp.maxHeight) reason = 'too-tall';
    if (!reason) {
      // Balance: shrink width while line count stays the same (avoids orphans).
      let lo = first.widest * 0.5;
      let hi = inp.maxWidth;
      let best = first;
      if (first.lines.length > 1) {
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          const r = layout(tokens, widths, space, mid);
          if (!r.overflow && r.lines.length === first.lines.length) {
            best = r;
            hi = mid;
          } else lo = mid;
        }
      }
      return { fontSize: s, lines: best.lines.map((l) => l.map((i) => tokens[i])), width: best.widest, height, fits: true };
    }
    last = { fontSize: s, lines: first.lines.map((l) => l.map((i) => tokens[i])), width: Math.min(first.widest, inp.maxWidth), height, fits: false, reason };
    if (s <= inp.minSize) break;
  }
  return last!;
}

/** Deterministic estimator for tests / node (average glyph advance by script). */
export const estimateMeasure: Measurer = (text, font) => {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.28;
    else if (/[؀-ۿ]/.test(ch)) w += 0.5;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else if (/[0-9]/.test(ch)) w += 0.58;
    else w += 0.52;
  }
  return w * font.size * (font.weight >= 700 ? 1.06 : 1);
};
