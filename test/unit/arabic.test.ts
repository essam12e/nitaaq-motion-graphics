import { describe, expect, it } from 'vitest';
import { baseDirection, detectScript, hasArabic, normalizeArabicPunctuation, safeLetterSpacing, toNumerals, tokenize } from '../../src/typography/arabic';
import { estimateMeasure, fitText } from '../../src/typography/fit';

describe('Arabic text handling', () => {
  it('detects scripts and base direction for mixed copy', () => {
    expect(hasArabic('مرحبا')).toBe(true);
    expect(detectScript('Dashboard')).toBe('latin');
    expect(detectScript('لوحة Dashboard')).toBe('mixed');
    expect(baseDirection('Dashboard واحد يكفي')).toBe('rtl');
    expect(baseDirection('Start free trial', 'rtl')).toBe('ltr');
    expect(baseDirection('مع Insightly')).toBe('rtl');
  });
  it('converts numerals only when asked', () => {
    expect(toNumerals('خصم 30%', 'arabic-indic')).toContain('٣٠');
    expect(toNumerals('خصم 30%', 'latin')).toBe('خصم 30%');
  });
  it('uses Arabic punctuation in Arabic sentences', () => {
    const s = normalizeArabicPunctuation('هل تريد؟ نعم, الآن');
    expect(s).toContain('،');
    expect(s).toContain('؟');
  });
  it('never letter-spaces Arabic (would break joining)', () => {
    expect(safeLetterSpacing('موعد', 4)).toBe(0);
    expect(safeLetterSpacing('ABC', 4)).toBe(4);
  });
  it('keeps highlighted phrases as whole tokens', () => {
    const t = tokenize('Dashboard واحد يحوّل بياناتك', ['بياناتك']);
    expect(t.some((x) => x.text.includes('بياناتك') && x.highlight)).toBe(true);
  });
});

describe('text fitting (never silently overflows)', () => {
  const base = { maxLines: 3, maxSize: 90, minSize: 30, lineHeight: 1.25, weight: 700, family: 'IBM Plex Sans Arabic', measure: estimateMeasure };
  it('fits a normal headline inside the box', () => {
    const r = fitText({ ...base, text: 'موعد ينظّم حجوزاتك في مكان واحد', maxWidth: 900 });
    expect(r.fits).toBe(true);
    expect(r.width).toBeLessThanOrEqual(900);
    expect(r.lines.length).toBeLessThanOrEqual(3);
  });
  it('shrinks long copy before failing', () => {
    const r = fitText({ ...base, text: 'كيف نحافظ على بياناتنا الشخصية في عالم رقمي متسارع تتزايد فيه محاولات الاحتيال', maxWidth: 900 });
    expect(r.fontSize).toBeLessThan(90);
  });
  it('reports failure instead of overflowing when impossible', () => {
    const r = fitText({ ...base, text: 'كلمة '.repeat(60), maxWidth: 300, maxLines: 2 });
    expect(r.fits).toBe(false);
    expect(r.reason).toBeDefined();
  });
});
