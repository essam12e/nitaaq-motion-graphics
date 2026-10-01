/**
 * Data Animation Engine — pick the honest visualization for the numbers and
 * check the story stays accurate. Pure.
 *
 *   1 value                      → big-number
 *   2 values (before / after)    → change (the % change is COMPUTED, never typed)
 *   parts of a whole (sum≈100%)  → share
 *   ordered labels (years, months, quarters, days) → line
 *   otherwise categories         → bar (zero baseline, always)
 *
 * Accuracy checks: source required, finite numbers, no truncated bar axis,
 * shares must add up, the insight text may not claim a number the data lacks,
 * and growth claims must match the computed direction.
 */
export type VizKind = 'big-number' | 'change' | 'share' | 'line' | 'bar';

export interface DataInput {
  labels: string[];
  values: number[];
  prefix?: string;
  suffix?: string;
  source?: string;
  insight?: string;
}

const ORDERED = /^(\d{4}|q[1-4]|ر[1-4]|الربع|يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|الأسبوع|week|month|شهر|day|يوم|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو)/i;

export function chooseVisualization(d: DataInput): { kind: VizKind; reason: string } {
  const n = d.values.length;
  if (n === 1) return { kind: 'big-number', reason: 'a single number — let it own the frame' };
  const sum = d.values.reduce((a, b) => a + b, 0);
  const pct = d.suffix?.includes('%') || d.suffix?.includes('٪');
  if (n === 2 && !pct) return { kind: 'change', reason: 'two values — before → after with the computed change' };
  if (pct && n >= 2 && n <= 6 && Math.abs(sum - 100) <= 1.5 && d.values.every((v) => v >= 0)) return { kind: 'share', reason: 'parts of a whole that add up to 100%' };
  if (n >= 3 && d.labels.filter((l) => ORDERED.test(l.trim())).length >= Math.ceil(n * 0.6)) return { kind: 'line', reason: 'ordered periods — a trend reads as a line' };
  return { kind: 'bar', reason: 'categories — bars on a zero baseline compare honestly' };
}

export interface DataIssue {
  severity: 'error' | 'warning';
  message: string;
}

export function changePct(a: number, b: number): number | null {
  if (a === 0) return null;
  return Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
}

const numbersIn = (s: string) => (s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));

export function checkDataStory(d: DataInput, kind: VizKind): DataIssue[] {
  const out: DataIssue[] = [];
  if (!d.source || !d.source.trim()) out.push({ severity: 'error', message: 'data has no source — numbers are never shown without one' });
  if (d.labels.length !== d.values.length) out.push({ severity: 'error', message: `labels (${d.labels.length}) and values (${d.values.length}) differ in length` });
  if (d.values.some((v) => !Number.isFinite(v))) out.push({ severity: 'error', message: 'non-finite value' });
  if (kind === 'share') {
    const sum = d.values.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 1.5) out.push({ severity: 'error', message: `shares add up to ${sum}, not 100` });
  }
  if (kind === 'bar' && d.values.some((v) => v < 0) && d.values.some((v) => v > 0)) out.push({ severity: 'warning', message: 'mixed signs — bars grow from the zero line both ways' });
  if (d.insight) {
    // every number the insight claims must be derivable from the data (a value, a computed change, a total or a count)
    const allowed = new Set<number>();
    d.values.forEach((v) => allowed.add(Math.round(Math.abs(v) * 10) / 10));
    allowed.add(Math.round(d.values.reduce((a, b) => a + b, 0) * 10) / 10);
    allowed.add(d.values.length);
    for (let i = 0; i < d.values.length; i++)
      for (let j = 0; j < d.values.length; j++) {
        if (i === j) continue;
        const c = changePct(d.values[i], d.values[j]);
        if (c !== null) {
          allowed.add(Math.abs(c));
          allowed.add(Math.round(Math.abs(c)));
        }
        if (d.values[i] !== 0) {
          const ratio = Math.round((d.values[j] / d.values[i]) * 10) / 10;
          allowed.add(ratio);
          allowed.add(Math.round(ratio));
        }
      }
    for (const lbl of d.labels) for (const x of numbersIn(lbl)) allowed.add(x);
    for (const x of numbersIn(d.insight)) if (!allowed.has(Math.round(x * 10) / 10) && !allowed.has(Math.round(x))) out.push({ severity: 'error', message: `the insight claims "${x}" which the data does not support` });
    const first = d.values[0];
    const last = d.values[d.values.length - 1];
    if (/نمو|زياد|ارتفا|تضاعف|growth|increase|rose|grew|up\b/i.test(d.insight) && last < first) out.push({ severity: 'error', message: 'the insight claims growth but the data goes down' });
    if (/انخفا|تراجع|نقص|decline|drop|fell|down\b/i.test(d.insight) && last > first) out.push({ severity: 'error', message: 'the insight claims a decline but the data goes up' });
  }
  return out;
}
