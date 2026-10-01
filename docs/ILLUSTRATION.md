# Illustration Mode & Zero-Asset JavaScript Animation

Code: `src/illustration/registry.ts` (IllustrationRegistry), `src/illustration/Illustration.tsx` (renderer), `src/scenes/illustration/illustration-scenes.tsx`. Module ids `illustration` and `zero-asset` (lazy; selected only when the film needs them).

## Illustration Mode

Illustrations are **code**: SVG parts (shape + tone + stage + optional line) rendered in the film's palette, drawn on with stroke dash-offsets, deterministic per seed, editable in `video.json`. No stock art and no AI images are needed.

- **16 subjects**: growth, network, security, speed, delivery, team, idea, data, cloud, payment, chat, search, location, time, gift, rocket. `matchIllustrations(text)` maps Arabic and English copy to subjects (e.g. «نمو» → growth, "secure" → security).
- **3 styles**: flat, line, duotone (`ILLUSTRATION_STYLES`); the illustrated genre uses flat, explainers use duotone.
- Scenes:
  - `illustration-scene` — hero (one subject with the message), trio (three features, one subject each), explain (subject + explanation side by side).
  - `diagram-flow` — a system/process as nodes and connectors drawn step by step: linear (reads right-to-left in Arabic), hub, cycle.

When it is selected: genre `illustrated` («رسوم», «فلات», "illustration", `visualMode: "illustration"`), and explainer / SaaS / procedural films when copy matches a subject. The `illustration` style preset (warm field, two brand tones + one accent, rounded geometry) is used for illustrated films unless the user picked a style.

## Zero-Asset JavaScript Animation

`zero-asset-sequence` builds a full scene from typography + seeded procedural geometry only (variants shapes / lines / orbit). Placement, timing jitter and colour order come from `createRng(seed)` — never `Math.random()` — so the same project renders the same frames. Large forms only: the scene never produces dot grids, particle fields or patterned backgrounds (pattern QC would block them).

Selected for genre `procedural` («بدون صور», "zero-asset", "generative", `visualMode: "zero-asset"`) and for kinetic films with no image assets.

## Tests

`test/unit/v3-modules.test.ts` (subject matching, seed reproducibility), acceptance videos 13 (illustrated) and 16 (English kinetic + zero-asset) in `docs/TEST_RESULTS.md`.
