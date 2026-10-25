# Style Library v2 (visual direction)

A style in v2 is not a palette and a font. It is data plus rules that change **what is on screen and how it behaves**: composition grammar, shape language, material, depth, Arabic typography, motion curve and tempo, transitions, camera, rhythm, 2–5 signature moves, decor of the world, rendering technique and (optionally) sound. The old 24 presets (`docs/STYLE_LIBRARY.md`) still exist as the token layer; every v2 style names the preset it starts from and overrides it.

Code: `src/style-system/`. Switch off: `NITAAQ_NO_STYLE_V2=1` (the film is produced exactly as in P4.5).

## Flow

```
brief.style | brief.styleMix | nothing
  → recipe.ts      explicit / mix / legacy preset / auto selection (whyThisStyle) / fallback
  → brand.ts       brand colours fed into the style's colour + material rules
  → style_recipe.json (deterministic hash)
  → apply-script.ts  the shot script: composition strategy per purpose, shot-size bias, shapes,
                     entrances/exits, tilt, grid snap, camera budget, transitions, 1–2 native moments
  → tokens.ts        the legacy token path (fonts, surfaces, background, motion family)
  → Stage Compiler   constrainScript() on every compile (film director, art director, redesigner, repair)
  → StageLayer       look: material per element, world decor, frame, moments, type align/reveal/scale
```

Every recompile keeps the style because it lives in the shot script (`script.style`) and is enforced by the compiler.

## Library

21 styles, 20 renderable with the current engine. `glass-product-3d` needs a WebGL renderer: it is marked `REQUIRES_OPTIONAL_RENDERER` and falls back to `aurora-glass`. No dependency is installed.

`npx tsx cli/style.ts list | validate | similarity | compat | recipe <brief.json> | show <id>`

## Rules the validator enforces

- fonts exist and cover Arabic; reveal is word / line / block / mask (never letters);
- at least one native signature move; a default composition strategy; preferred transitions are not forbidden;
- distinctness: every pair of renderable styles differs on ≥ 6 of 12 structural axes (composition, shape, material, depth, typography, motion, transitions, camera, rhythm, decor, colour behaviour, signature builders). A style that differs only in colour / easing / radius fails.

## Brief fields

- `style`: a v2 id, an English or Arabic alias («سويسري», «متساوي القياس»…), or an old preset (mapped).
- `styleMix`: `{ "motion": "liquid", "camera": "cinematic" }` — axes taken from other styles, with a compatibility verdict (compatible / partially-compatible / conflicting) in the recipe.
- `signatureMove`: force one of the style's moves.

## Product preservation

Identity assets (product, logo, screenshots) are never given a material, tint, outline, morph, shape-transform, rotation or tilt; entrances are fade / rise / scale only; style moments never target them. The style changes the world around the product.

## Outputs per project

`style_recipe.json` (the recipe, hash, whyThisStyle, brand roles, protected assets) and `style_report.json` (changes made to the script, moments, nearest styles).
