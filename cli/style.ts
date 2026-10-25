/**
 * Style Library v2 tools.
 *   tsx cli/style.ts list                       the styles (id, Arabic name, category, renderer)
 *   tsx cli/style.ts validate                   schema + rules + distinctness of the whole library
 *   tsx cli/style.ts similarity [--json]        pairwise structural distance (fails under 6 axes)
 *   tsx cli/style.ts compat [--json]            compatibility of every pair for mixing
 *   tsx cli/style.ts recipe <brief.json>        the style_recipe.json a brief would get (no render)
 *   tsx cli/style.ts show <id>                  one style as JSON
 */
import { readFileSync } from 'node:fs';
import { STYLE_LIBRARY, RENDERABLE_STYLES, STYLE_BY_ID, validateLibrary, similarityMatrix, compatibilityMatrix, recipeForBrief } from '../src/style-system';

const [cmd, arg, ...rest] = process.argv.slice(2);
const json = rest.includes('--json') || arg === '--json';

switch (cmd) {
  case 'list':
    for (const s of STYLE_LIBRARY) console.log(`${s.id.padEnd(20)} ${s.nameAr.padEnd(22)} ${s.category.padEnd(11)} ${s.renderingTechnique.renderer}${s.renderingTechnique.optional ? ' (REQUIRES_OPTIONAL_RENDERER)' : ''}`);
    console.log(`${STYLE_LIBRARY.length} styles, ${RENDERABLE_STYLES.length} renderable with the current engine`);
    break;
  case 'validate': {
    const r = validateLibrary(STYLE_LIBRARY);
    console.log(r.ok ? `library ok: ${STYLE_LIBRARY.length} styles` : r.problems.join('\n'));
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  case 'similarity': {
    const m = similarityMatrix(RENDERABLE_STYLES);
    if (json) console.log(JSON.stringify(m, null, 2));
    else {
      const sorted = [...m.pairs].sort((a, b) => a.differentAxes.length - b.differentAxes.length);
      for (const p of sorted.slice(0, 10)) console.log(`${p.a} × ${p.b}: ${p.differentAxes.length} axes differ (${p.distinct ? 'distinct' : 'TOO CLOSE'})`);
      console.log(`${m.pairs.length} pairs, ${m.failures.length} too close`);
    }
    process.exitCode = m.failures.length ? 1 : 0;
    break;
  }
  case 'compat': {
    const m = compatibilityMatrix(RENDERABLE_STYLES);
    if (json) console.log(JSON.stringify(m, null, 2));
    else {
      const count: Record<string, number> = {};
      for (const row of Object.values(m)) for (const v of Object.values(row)) count[v] = (count[v] ?? 0) + 1;
      console.log(count);
    }
    break;
  }
  case 'recipe': {
    if (!arg) throw new Error('usage: tsx cli/style.ts recipe <brief.json>');
    const r = recipeForBrief(JSON.parse(readFileSync(arg, 'utf8')));
    console.log(JSON.stringify({ ...r.recipe, warnings: r.warnings }, null, 2));
    break;
  }
  case 'show':
    console.log(JSON.stringify(STYLE_BY_ID[arg ?? ''] ?? null, null, 2));
    break;
  default:
    console.log('usage: tsx cli/style.ts list | validate | similarity | compat | recipe <brief.json> | show <id>');
}
