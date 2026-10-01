/**
 * Number counting for text: the first number in a token counts from 0 to its
 * value with the same decimals, grouping and numeral system (Latin or
 * Arabic-Indic). Non-numeric tokens return null. Pure.
 */
const EASTERN = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(EASTERN.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
const toEastern = (s: string) => s.replace(/[0-9]/g, (d) => EASTERN[Number(d)]);

export function countText(token: string, p: number, numerals: 'latin' | 'arabic-indic' = 'latin'): string | null {
  const m = token.match(/[0-9٠-٩][0-9٠-٩,٬.٫]*/);
  if (!m) return null;
  const raw = m[0];
  const latin = toLatin(raw).replace(/[.,]$/, '');
  const grouped = latin.includes(',');
  const value = Number(latin.replace(/,/g, ''));
  if (!isFinite(value)) return null;
  const decimals = (latin.split('.')[1] ?? '').length;
  const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  const v = value * eased;
  let s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
  const eastern = /[٠-٩]/.test(raw) || numerals === 'arabic-indic';
  if (eastern) s = toEastern(s);
  return token.replace(raw.replace(/[.,]$/, ''), s);
}
