# Text Motion Engine & Arabic Kinetic Typography

Code: `src/text-motion/families.ts` (registry), `src/text-motion/planner.ts` (film-level plan), `src/typography/Text.tsx` (renderer), `src/scenes/kinetic/` (kinetic scene families).

## Families (27, `TextMotionRegistry`)

Each family declares its unit for Latin text and the unit it falls back to for Arabic, the roles it suits, energy, duration, stagger, direction and curve.

| Family | Latin unit | Arabic unit | Typical role |
|---|---|---|---|
| mask-reveal, line-reveal, split-reveal, wipe-reveal, perspective-reveal, editorial-title, underline-draw | line | line | headline / support |
| word-stagger, scale-impact, blur-reveal, vertical-reveal, horizontal-reveal, slide-reveal, rotation-reveal, compress-expand, word-replace, number-count, marker-highlight, background-highlight, phrase-emphasis, controlled-bounce, typography-punch, follow-through, kinetic-sequence | word | word | headline / CTA / number |
| char-stagger | char | **word** | Latin headline only |
| tracking-reveal, cinematic-title | block | block | premium titles / labels |

Granularity supported by the renderer: block, line, word, character (Latin only), phrase / highlighted phrase (`emphasis` words), number (count-up with the project's numeral system), and **Arabic word groups** (a particle glued to the next word — و، ف، ب، ل، ال… — animates with it).

## Arabic rules (enforced in code and QC)

- No per-glyph animation on Arabic: `effectiveUnit()` never returns `char` for Arabic text; QC flags `ARABIC_SPLIT_GLYPHS` (critical) if a single Arabic letter ever ends up in its own span.
- No letter-spacing on Arabic (`ARABIC_LETTER_SPACING`): `tracking-reveal` uses **word-spacing** for Arabic, letter-spacing only for Latin, and never widens past the fitted width.
- RTL base direction per line; Latin runs and numbers are isolated inside RTL lines (mixed Arabic + English + numbers). Directional families (`slide`, `horizontal`, `wipe`, `follow-through`, `rotation`) mirror for RTL.
- Masks, clip-paths and line segmentation are used where a Latin design would split characters.
- Line breaking is Arabic-aware (`fitText`) and re-runs per aspect; the text fitter reports overflow instead of clipping.

## Film-level plan

`planTextMotion(scenes, personality, seed)` assigns per scene a family for each role group (headline / support / CTA / number / label):

- headline families come from the personality's palette (`HEADLINE_FAMILIES`), weighted by beat (hook → impact families, data → number-count, CTA → punch/scale), **never the same headline family in two consecutive scenes**, with a usage cap per film;
- the brand's `brand-motion.json` preferred / avoided families bias the choice (consistency across films without identical films);
- the plan is written to `motion_spec.json` and to each scene's `motion.text`.

Motion QC (`src/qc/audio-qc.ts → motionVarietyQc`) reports `TEXT_MOTION_REPEAT` and `TEXT_MOTION_OVERUSED`.

## Kinetic typography scenes

`kinetic-sequence` (rhythm / impact / build), `kinetic-stack`, `kinetic-number`, `kinetic-mixed` (Arabic + English), `kinetic-replace` (word replacement). `content.lines` in the brief is a kinetic script; the director keeps lines in order and uses word groups as units.

## Tests

`test/unit/v3-modules.test.ts` (Arabic never per glyph, English per char allowed, no back-to-back headline family, ≥26 families), `test/unit/arabic.test.ts`, visual baselines in `test/visual/baseline/`.
