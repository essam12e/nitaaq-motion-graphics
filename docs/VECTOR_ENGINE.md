# Vector Engine 2.0

The user's SVG can be animated from its real geometry. The engine reads the file into a tree of groups, matrices, outlines and paint. Each frame, it draws that tree as inline SVG: traced, filled, assembled, or morphed into a second SVG. The engine never rasterises the art and never replaces it, so the last frame looks like the file as drawn.

Remotion stays the only clock. Every program is a pure function of the scene frame, so renders, stills, `nitaaq seek` and QC agree.

## Giving the director an SVG

```json
"assets": [
  { "path": "emblem.svg", "kind": "svg" },
  { "path": "shield.svg", "kind": "svg" }
]
```

- **Kind `svg` only.** An SVG given as `logo` or `image` keeps its existing treatment: it is shown as an image, and the logo engine still runs for an SVG logo. Nothing about existing SVG logos changes.
- **The module is lazy.** `advanced-vector` is selected only when the brief has an asset of kind `svg`. The node pipeline is imported only then.
- **Scene choice.** With one SVG the director picks `vector-draw` with the `draw` or `build` variant. With two SVGs it picks `sequence` (draw, then morph into the second) or `morph`. The scene is the user's own material, so it is shown once and preferred, like their video or Lottie.

## Scene family `vector-draw`

| Variant | What happens |
|---|---|
| `draw` | Every outline is traced by arc length, in reading order (right to left by default). The pen moves at a speed proportional to length, and each shape gets a minimum time so small details still read. Each shape's fill then floods in. A shape without a stroke is traced in its fill colour, and that guide line fades as the fill arrives. Text and images fade in at the end. |
| `build` | Top-level groups assemble one after another. Each scales and rises from the centre of its own bounds (the transform origin) and settles with a spring. |
| `morph` | Each shape of the first SVG becomes its partner in the second. Shapes are paired by position, size and colour. Shapes left over shrink into their nearest partner or grow out of it. Fills, strokes and gradients interpolate in OKLab. The second SVG is fitted into the first one's view box. |
| `sequence` | Draw, a short hold, then morph into `morphTo`. Without `morphTo` it is just `draw`. |
| `graph` | Procedural art from a Non-Destructive Vector Graph (see below). |

Content fields:

- `svg`: an asset id or path.
- `morphTo`
- `order`: `rtl` (default), `ltr`, `ttb`, `center-out` or `document`.
- `drawSeconds`, `morphSeconds`
- `arc`: Manim-style bend of the morph point paths, in radians.
- `role`: `illustration`, `logo` or `icon`.
- `title`, `eyebrow`, `subtitle`, `caption`.
- `graph`

The timings are in `src/vector/scene-program.ts` and are shared by the scene, `seek`, QC and the effect budget.

## Reading an SVG (`src/vector/svg.ts`)

| Part | Handling |
|---|---|
| Structure | `g`, `a`, `switch`, nested `svg` (its own viewport and viewBox), and `use` of elements or `symbol`s (scaled into their box). Every group keeps its matrix, opacity and clip / mask / filter. |
| CSS | `<style>` rules with tag, `.class` and `#id` compounds, plus descendant and child combinators. Specificity and order are respected, `style=""` wins, and inherited properties flow down. Other selectors are reported, not guessed. |
| Shapes | `path`, `rect` (with rounded corners), `circle`, `ellipse`, `line`, `polyline` and `polygon` become one absolute cubic path each. Each path is measured: length, exact bounds from the curve extrema, segment count. |
| Paint | Fill / stroke, opacities, fill rule, caps, joins, dashes and non-scaling strokes. Colours can be hex, rgb(a), hsl(a) or named. |
| Gradients | Linear and radial gradients, with `href` inheritance of stops and attributes, units, transform and spread. They are read as data so they can be interpolated, and also kept as SVG. |
| Kept as SVG | Clip paths, masks, patterns, filters and markers. Their ids are scoped to each instance, so two copies of the same art never collide. |
| Text / images | Drawn as authored, with inherited styles written onto the element. Text uses the viewer's fonts, and the engine warns about this. Convert text to outlines for exact type. |
| Removed | `script`, `foreignObject`, `on…` handlers, external links (only `#refs` and embedded images stay) and SMIL animation, because the film's timeline drives motion. Each removal is reported. The user's file is never changed. |
| Never throws | Broken input becomes an error ("nothing to draw", missing size), not a crash. More than 20,000 segments gives a warning. |

Geometry (`src/vector/geometry.ts`, `src/vector/matrix.ts`):

- Affine matrices that parse every SVG transform function, compose around an origin, decompose, recompose, and interpolate with the shortest rotation.
- Arc length (Gauss–Legendre).
- Exact cubic splitting.
- After-Effects-style trim paths (start / end / offset, wrapping, sequential or parallel over sub-paths).
- Bounds, flattening and simplification.

## Vector Asset Pipeline (`src/node/vector-assets.ts`)

| Step | What happens |
|---|---|
| Source | The SVG is copied **byte-identical** to `assets/<hash>-<name>.svg` and verified. It stays the asset's `src`. |
| Parse | The sanitised VectorDoc is written next to it as `*.vector.json` (`asset.vector.doc`). The render reads this file, so it never re-parses and never meets anything the sanitiser removed. |
| Inspect | Shapes, groups, segments, clips, masks, gradients, text and images, a complexity score, and the colours actually painted (a mask's ramp is not a brand colour). |
| Refuse | An SVG with nothing to draw, or a file that is not `.svg`. |
| Cache | Keyed by the file hash. |

CLI:

- `nitaaq vector inspect <file.svg>`
- `nitaaq vector prepare <file.svg> --project <dir> [--id] [--kind svg|logo|icon|image]`
- `nitaaq vector frame <graph.json> <t>` prints a graph as SVG at second t.

## Booleans (`src/vector/boolean.ts`)

- **render** is stable and the default. The renderer performs the operation: intersect is a clip path, subtract is a mask, union draws both shapes as one group, and exclude uses even-odd. It is exact at every pixel for any curves.
- **exact** is EXPERIMENTAL. It runs Greiner–Hormann polygon clipping on the outlines: corners are kept exactly and curves are sampled. The result is a real outline that can be traced or morphed.
  - Each input must be one ring.
  - A degenerate touch is resolved by a fixed, deterministic nudge.
  - When it cannot give a trustworthy answer, it returns the reason, and the graph falls back to `render` with a warning.
  - Tests compare its areas against the textbook values for squares and against the circle-lens formula.

## Non-Destructive Vector Graph (`src/vector/graph.ts`)

Procedural, animatable vector art stored as plain JSON. The schema is zod-validated and versioned. Missing inputs, duplicate ids and cycles are refused.

```
shape → transform → boolean → mask → fill / stroke (gradient) → effect → group → output
```

| Node | Parameters |
|---|---|
| `shape` | `rect` (radius), `ellipse`, `polygon`, `star` (sides, inner radius), `path` (d); `x y width height` |
| `transform` | `x y rotate scale scaleX scaleY`, origin as a fraction of the input's bounds |
| `boolean` | `a b op` (union / subtract / intersect / exclude), `mode` (render / exact) |
| `fill` | `color` or `gradient` (linear with angle, or radial, keyframable stops), `opacity` |
| `stroke` | `color width cap join`, trim `start end offset` (drawing on), `keepFill` |
| `mask` | `input mask`, `mode` (clip / alpha / invert) |
| `effect` | `shadow`, `glow` or `blur`, with `amount color x y` |
| `group` | `inputs`, `opacity` |

Any number can be a constant or keyframes `{ "k": [{ "t": 0, "v": 0 }, { "t": 1.2, "v": 1, "ease": "back-out" }] }`, with time in seconds. Colours can be keyed too. Easing names come from the motion system, plus `linear` and `hold`.

Evaluation is pure. Each node's result is memoised by its resolved parameters and its inputs. A node whose values do not change between frames is not recomputed; after the last key, a frame recomputes nothing.

The Creative Director writes graphs into `video.json` as scene `vector-draw`, variant `graph`. The example is `test/fixtures/vector/graph-badge.json`. It contains:

- A rounded plate with a hole cut by an exact boolean.
- An animated gradient.
- A ring drawn on by a trimmed stroke.
- A star that spins in with a glow.

## Seek, QC, budget

- `nitaaq seek` lists `vectors` per scene: asset, `morphTo`, `mode` (draw / build / morph / graph), `progress`, `phase` and `step` / `steps` for a sequence.
- QC reads `data-qc-kind="vector"`. The probe waits while vector art is loading. Art that fails to load is a critical `MEDIA_BROKEN` with the reason.
- The effect budget adds "vector art (path rebuild per frame)" while a program runs. It uses the measured complexity of both documents for a morph, and the node count for a graph.

## Limits (honest)

- Text inside an SVG uses the viewer's fonts. Outlines are exact.
- A morph pairs whole shapes and cannot morph text or images, which crossfade in place. A shape's clip or mask changes by a crossfade when its partner sits in a different context.
- An object-bounding-box gradient on a rotated shape is measured on the world-space outline during a morph.
- Exact booleans take one ring per input. Anything else uses render booleans.
- Patterns, filters and markers are drawn as authored; they are not animated.
