# Advanced Morphing

True path morphing (not a crossfade), reimplemented from the published ideas of flubber / Manim's `Transform` — no code copied, no dependency added.

| File | Role |
|---|---|
| `src/morph/path.ts` | SVG path parser (all commands → cubic segments), arc-length `resample`, `alignRing` (rotation + winding that minimises travel), `prepareMorph` (sub-path matching: biggest bodies pair; extra sub-paths shrink into / grow from the nearest body), `morphAt(plan, t, arc)` (`arc` bends travel around the common centre, like Manim's `path_arc`), `midSilhouetteOk` |
| `src/morph/shapes.ts` | `shapePath` (circle, squircle, hexagon, star, blob…), `blobPath` (seeded organic body), `iconPath` (any Lucide icon as one path; every element's leading relative `m` is anchored, so joined elements stay in place) |
| `src/morph/trace.ts` | `traceContours` / `silhouettePath` — an image's alpha → its outline path |
| `src/morph/useSilhouette.ts` | browser hook: traces a logo/product silhouette (delayRender, cached) |
| `src/morph/Morph.tsx` | `<MorphShape stages>` (spring-timed stages), `<MorphMask>`, `<LiquidBlob>` |

## Where it is used

- `morph-story` scene family: one body becomes each step (icons as line art, or filled shapes), caption per stage.
- Logo reveal `liquid-morph`: a breathing blob springs into the logo's traced silhouette, then the real logo fades in — the settled frame is always the untouched logo (needs a logo with transparency).
- Transitions `morph` / `shape-match` / `liquid` (Transition Intelligence).
- Background kind `liquid` (two large organic bodies breathing slowly).

All of it is a pure function of the frame (deterministic seek).
