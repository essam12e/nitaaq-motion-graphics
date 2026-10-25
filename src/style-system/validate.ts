/** Style validation: schema + library-level rules (unique ids, valid fonts, notThis targets, distinctness). Pure. */
import { MotionStyleSchema, type MotionStyle } from './schema';
import { getFont } from '../typography/registry';
import { compareStyles } from './similarity';

const FORBIDDEN_REVEAL = /letter|char/i;

export function validateStyle(input: unknown, library: MotionStyle[] = []): { ok: boolean; errors: string[]; warnings: string[] } {
  const r = MotionStyleSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), warnings: [] };
  const s = r.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const f of [s.typographyLanguage.display, s.typographyLanguage.body]) {
    const font = getFont(f);
    if (!font) errors.push(`typography: unknown font "${f}"`);
    else if (!font.arabic) errors.push(`typography: "${f}" has no Arabic glyphs`);
  }
  if (FORBIDDEN_REVEAL.test(s.typographyLanguage.reveal)) errors.push('typography: Arabic is never revealed letter by letter');
  if (!s.signatureMoves.some((m) => m.native)) errors.push('signatureMoves: at least one native move');
  if (!s.compositionGrammar.strategies.default) errors.push('compositionGrammar.strategies.default is required');
  const ids = new Set(library.map((x) => x.id));
  for (const n of s.notThis) if (library.length && !ids.has(n.style)) warnings.push(`notThis: unknown style "${n.style}"`);
  for (const t of s.transitionLanguage.prefer) if (s.transitionLanguage.forbid.includes(t)) errors.push(`transitions: "${t}" is both preferred and forbidden`);
  for (const other of library) {
    if (other.id === s.id || other.renderingTechnique.renderer === 'webgl' || s.renderingTechnique.renderer === 'webgl') continue;
    const c = compareStyles(s, other);
    if (!c.distinct) warnings.push(`too close to ${other.id}: differs only on ${c.differentAxes.join(', ') || 'nothing'}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateLibrary(library: MotionStyle[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of library) {
    if (seen.has(s.id)) problems.push(`duplicate id ${s.id}`);
    seen.add(s.id);
    const v = validateStyle(s, library);
    problems.push(...v.errors.map((e) => `${s.id}: ${e}`), ...v.warnings.map((w) => `${s.id}: ${w}`));
  }
  return { ok: problems.length === 0, problems };
}
