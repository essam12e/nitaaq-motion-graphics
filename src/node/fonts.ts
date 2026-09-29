/**
 * Font manager (node side). Verifies bundled font files exist for the weights a
 * style needs and checks user fonts for real Arabic support (glyph coverage +
 * contextual shaping tables) before they are allowed into an Arabic project.
 * Never silently substitutes an unsuitable font: failures are explicit.
 */
// @ts-expect-error fontkit ships no types
import * as fontkit from 'fontkit';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, getFont, nearestWeight } from '../typography/registry';
import { MotionError } from '../core/errors';
import { ROOT } from './workspace';

const ARABIC_CORE = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي'.split('').map((c) => c.codePointAt(0)!);
const ARABIC_EXTRA = ['ء', 'آ', 'أ', 'إ', 'ؤ', 'ئ', 'ة', 'ى', '،', '؟', '٠', '١'].map((c) => c.codePointAt(0)!);
const LATIN_CORE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map((c) => c.codePointAt(0)!);

export interface FontCheck {
  file: string;
  family: string;
  postscriptName?: string;
  arabicCoverage: number;
  arabicExtraCoverage: number;
  latinCoverage: number;
  /** GSUB features for Arabic joining forms. */
  shaping: { init: boolean; medi: boolean; fina: boolean; rlig: boolean };
  arabicCapable: boolean;
  latinCapable: boolean;
  weight?: number;
  problems: string[];
}

interface FkFont {
  familyName: string;
  postscriptName?: string;
  hasGlyphForCodePoint(cp: number): boolean;
  availableFeatures?: string[];
  'OS/2'?: { usWeightClass?: number };
  fonts?: FkFont[];
}

export function checkFontFile(file: string): FontCheck {
  if (!existsSync(file)) throw new MotionError({ code: 'FONT_MISSING', what: `Font file not found`, where: file, action: 'Provide the .ttf/.otf/.woff2 file.' });
  let font: FkFont;
  try {
    font = fontkit.openSync(file) as FkFont;
    if (font.fonts?.length) font = font.fonts[0];
  } catch (e) {
    throw new MotionError({ code: 'FONT_MISSING', what: 'Font file could not be parsed', where: file, why: String((e as Error).message), action: 'Re-export the font as TTF/OTF/WOFF2.' });
  }
  const cov = (cps: number[]) => cps.filter((cp) => font.hasGlyphForCodePoint(cp)).length / cps.length;
  const feats = new Set(font.availableFeatures ?? []);
  const shaping = { init: feats.has('init'), medi: feats.has('medi'), fina: feats.has('fina'), rlig: feats.has('rlig') || feats.has('liga') };
  const arabicCoverage = cov(ARABIC_CORE);
  const arabicExtraCoverage = cov(ARABIC_EXTRA);
  const latinCoverage = cov(LATIN_CORE);
  const problems: string[] = [];
  if (arabicCoverage > 0 && arabicCoverage < 1) problems.push(`missing ${Math.round((1 - arabicCoverage) * 28)} core Arabic letters`);
  if (arabicCoverage === 1 && !(shaping.init && shaping.medi && shaping.fina)) problems.push('Arabic glyphs present but no init/medi/fina shaping — letters would render disconnected');
  if (arabicCoverage === 1 && arabicExtraCoverage < 0.8) problems.push('missing hamza forms / Arabic punctuation');
  const arabicCapable = arabicCoverage === 1 && shaping.init && shaping.medi && shaping.fina && arabicExtraCoverage >= 0.8;
  return {
    file,
    family: font.familyName,
    postscriptName: font.postscriptName,
    arabicCoverage,
    arabicExtraCoverage,
    latinCoverage,
    shaping,
    arabicCapable,
    latinCapable: latinCoverage > 0.95,
    weight: font['OS/2']?.usWeightClass,
    problems,
  };
}

/**
 * Validates a user font for its intended role. An Arabic project may only use a
 * user font for Arabic text if it passes checkFontFile().arabicCapable.
 */
export function assertUserFont(file: string, role: 'arabic' | 'latin'): FontCheck {
  const c = checkFontFile(file);
  if (role === 'arabic' && !c.arabicCapable) {
    throw new MotionError({
      code: 'FONT_NOT_ARABIC',
      what: `The font "${c.family}" cannot render Arabic correctly`,
      where: file,
      why: c.problems.join('; ') || 'No Arabic glyphs found.',
      action: 'Use an Arabic-capable font (e.g. IBM Plex Sans Arabic, Tajawal, Cairo) or use this font only for Latin text (brand.latinFont).',
    });
  }
  if (role === 'latin' && !c.latinCapable) {
    throw new MotionError({ code: 'FONT_NOT_ARABIC', what: `The font "${c.family}" lacks basic Latin glyphs`, where: file, action: 'Choose a font with Latin coverage for English text.' });
  }
  return c;
}

export interface BundledFontReport {
  id: string;
  ok: boolean;
  missing: string[];
}

/** Checks the synced font files exist on disk for the given font ids / weights. */
export function verifyBundledFonts(ids = FONTS.map((f) => f.id), weights: number[] = []): BundledFontReport[] {
  return ids.map((id) => {
    const f = getFont(id);
    if (!f) return { id, ok: false, missing: ['(unknown font id)'] };
    const need = weights.length ? [...new Set(weights.map((w) => nearestWeight(f, w)))] : f.weights;
    const missing: string[] = [];
    for (const w of need) {
      const files = f.files.filter((x) => x.weight === w);
      if (!files.length) missing.push(`weight ${w}`);
      for (const x of files) if (!existsSync(join(ROOT, 'public', x.file))) missing.push(x.file);
    }
    return { id, ok: missing.length === 0, missing };
  });
}
