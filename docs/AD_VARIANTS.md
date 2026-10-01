# Ad Creative Variants

Code: `src/director/variants.ts` (`STRATEGIES`, `planVariants`), CLI `variants`, brief field `variants`.

```bash
npx tsx cli/nitaaq.ts variants brief.json --strategies problem-first,product-first,offer-first --aspects 9:16,4:5,1:1,16:9 [--plan-only] [--out dir]
```

or in the brief: `"variants": { "strategies": ["problem-first", "offer-first"], "aspects": ["9:16", "1:1"] }`.

## Strategies (they change the story, not the colours)

| Strategy | Needs in the brief | Opening / order | Pace |
|---|---|---|---|
| problem-first | a problem | hook → problem → bridge → solution → feature → proof → cta | brief |
| product-first | a product | **product** in the first second → feature → detail → offer → proof → cta | brief |
| benefit-first | features or a solution | hook (benefit) → feature → product → demo → proof → cta | brief |
| offer-first | an offer or price | **offer** first → product → feature → social → cta; CTA earlier and held longer | fast |
| result-first | a sourced stat / series / testimonial | proof → data → solution → feature → cta | brief |

A strategy whose material is missing is **skipped with the reason** (`unsupported` in the report) — nothing is invented to make a variant possible.

Each variant keeps the brand identity (logo, colours, brand motion) and gets its own hook copy, arc (`preferences.arc`), pacing, seed (`<base>:<strategy>`) and therefore its own typography emphasis and transitions. The explicit arc may open on its own first beat (product / offer) instead of a generic hook.

## Aspects are recomposed, not cropped

Every aspect is **directed separately**: layouts, text fitting, safe areas, map projection heights and scene choices are computed for 9:16, 4:5, 1:1 and 16:9 (e.g. feature grids become stacks in portrait). Each job runs the full pipeline (QC included) and the command writes `<base>.variants-report.json` with every variant's scenes, delivery path and scores.
