# Quality

Nothing is delivered unless every acceptance rule passes. QC runs in stages so problems are caught before the expensive render.

## Pipeline

```
validate (static, src/validation) ─► structural QC (DOM probes on sampled frames + stills, no MP4)
   ─► contact sheet + phone-view sheet ─► auto-repair (≤ 2 passes, a 3rd only while critical issues remain)
   ─► shared-element rects measured ─► sound stage + audio QC + motion-variety QC (≤ 3 re-plans)
   ─► [animatic for ADVANCED/LONG_FORM] ─► production render ─► final technical QC on the MP4
   ─► (post-render repair → re-render if needed) ─► delivery
```

Probes and pattern scans are cached per frame, so a repair pass re-checks only what changed.

## Passes and checks

| Pass | Checks |
|---|---|
| structure | text fit/overflow/off-canvas/outside safe area, overlap, fonts loaded, user media intact (no distortion, no upscaling surprises), CTA visible at the end, debug overlay absent |
| design | banned patterns (`design/banned-patterns.json`, spec level), `PATTERN_IN_FRAME` (pixel detector on stills: dot lattice, particle field, line grid, with text/media/card areas masked), contrast on real pixels, `TEXT_TOO_SMALL`, `PHONE_UNREADABLE` (text measured at phone size: 390 px wide portrait / 640 px landscape; minimum px per role), `LAYOUT_UNDERFILLED` |
| motion | `HOLD_TOO_SHORT`, `VOICE_DRIFT`, `MOTION_NO_PURPOSE`, `CAMERA_OVERUSE`, `TRANSITION_MONOTONY` (> 50 % of ≥ 4 cuts one type), `TRANSITION_REPEAT` (back-to-back), `TEXT_MOTION_REPEAT`, `TEXT_MOTION_OVERUSED`, `PERSONALITY_MISMATCH` |
| audio | `SFX_REPEAT_CONSECUTIVE` (error: same file back-to-back), `SFX_REPEAT_OVERUSED` (one file > max(2, ⌈n/5⌉) times), `SFX_DENSITY` (> round(6 + 10 × intensity) cues per 10 s), `SFX_SYNC` (> 80 ms from its anchor; builds excluded), `SFX_VOICE_CLASH`, `SFX_KEY_SILENT` (logo / hero / price / CTA / final counter with no sound), `SFX_DOUBLES_MUSIC` (info), `AUDIO_EMPTY` — see `SOUND_DIRECTOR.md` |
| spatial (in structure / design / motion) | `DEPTH_TOO_CLOSE` (hero plane inside the near band without pass-through; repair = largest safe amplitude), `DEPTH_OCCLUSION` (a card / layer in front of the hero plane over critical text, product or logo), `HERO_NOT_VISIBLE` / `HERO_TOO_SMALL`, `LOGO_OUTSIDE_SAFE` / `HERO_OUTSIDE_SAFE`, `TRANSITION_CORRIDOR` (the next subject lands against the transition's travel), `TRANSITION_TEXT_CLASH`, `CONTINUITY_BREAK`, `PERF_BUDGET` / `PERF_LAYERS`, `FX_BUDGET` — see below |
| technical (final) | MP4 container, H.264/yuv420p, size, fps, duration, encoder signatures stripped, audio present / not clipping / loudness, blank frames, pattern + contrast re-checked on decoded frames (all sampled frames extracted in one decode), `LOOP_SEAM` for loops |

## Scores and critique

Each pass starts at 100 (the `audio` pass is included when the sound stage ran): critical −40, error −15, warning −5. `overall` = mean of the passes that ran, capped at 59 when any critical issue exists. Every issue carries a concrete `fix` (e.g. "enable layout.scrim or use a contrast-safe text colour from brand.json"), collected in `critique[]`.

## Acceptance rules (all must pass)

zero critical issues · no dot / particle / grid background · no watermark or developer signature · no clipped or off-canvas text · all fonts loaded · user media intact · CTA readable when the film ends on one · no debug overlay · (final) valid H.264/yuv420p MP4 at the right size, fps and duration · audio present and not clipping when planned · no sound file repeated back-to-back · no blank frames.

## Auto-repair (`src/qc/repair-loop.ts`)

Safe, deterministic spec changes only: shrink text/layout, add a scrim, extend a hold, clean the background (`clean-background` → soft-gradient, decorations off), lower music/SFX, move cuts to voice phrases; audio: re-plan SFX with another seeded variation, thin the density (intensity −, min 0.2), lower SFX (×0.75, min 0.3). Issues without a safe fix stop delivery with a readable message.

## Measurement notes

- **Text overflow** is measured, not estimated: the probe measures each text node's real width with a DOM `Range` (spaces included) scaled to the line's layout width; line masks hug their content, so a line wider than its box is measured instead of silently clipped; only text with opacity > 0.05 is checked, and the finding targets the scene that owns the text.
- **Particle fields** are only reported when the blobs are spread over the frame (≥ 12 of 36 grid cells, across ≥ 3 columns and ≥ 3 rows), and diagram shapes and map drawings (`data-qc="box"`) are masked, so circles in a process diagram or coastline islands on a map are not mistaken for a pattern.

## Outputs

`quality_report.json` (v2.0: stage, scores, acceptance, critique, timings, probe cache stats, issues), `qc/…/contact-sheet.png`, `phone-view.png`, `review_log.md` (one entry per run), `audio-qc.json`, `sound-plan.json`.

## Visual QA 2.0 (`src/qc/vqa.ts`)

Beyond the fixed sample grid, QA now samples the **moments that matter**: the middle of each scene, the end of each transition, the hero, the logo and the CTA (`momentSamples`). On those frames:

| Check | Code | Severity / repair |
|---|---|---|
| protected elements (text, product, logo, CTA) inside the safe area for the **whole camera move** — measured rects are unprojected to their rest position, then `auditFraming` / `solveFraming` run on the plan | `CAMERA_FRAMING` | error → `camera-solve` (solved plan, else half amplitude) |
| product / logo recoloured by a CSS filter | `PRODUCT_ALTERED` | critical, never auto-"fixed" |
| product / logo aspect changed (> ±4%) | `PRODUCT_DISTORTED` | critical |
| text covering the product / logo | `PRODUCT_OBSTRUCTED` | > 15% warning, > 30% error → shrink layout |
| frame almost empty | `FRAME_EMPTY` | warning |
| visual weight far off centre | `COMPOSITION_UNBALANCED` | warning |
| Latin punctuation in RTL copy | `RTL_PUNCTUATION` | warning |
| Arabic word split between two letters that connect | `ARABIC_SPLIT_GLYPHS` | critical (splits at non-joining letters are legal) |

**Deterministic seek check:** frame A is rendered, then B, then A again; the two A's must match (mean diff < 0.5, max < 48) — `MOTION_NONDETERMINISTIC` otherwise (critical). `nitaaq seek <project> <t>` prints the film's exact state at any time. `NITAAQ_SKIP_DETERMINISM=1` skips the check.

## Quality scoring as a gate

`quality_report.json → categories`: composition, motion, typography, camera, brand, audio, technical and overall (weighted). Delivery needs **every category ≥ 50 and overall ≥ 70**, in addition to zero critical issues — a single bad category blocks even when the average is high. New acceptance rules: product protection, camera framing, the quality gate.

## Spatial QC (Premium Phase 9)

`src/qc/spatial-qc.ts` runs inside the structural pass on the same cached probes (no extra browser work) and works in fractions of the canvas, so 9:16 and 16:9 share the rules (safe areas come from the canvas profile of each format). The probe now also reports depth layers / spatial cards (`layers`: depth, pass-through opacity, true rect), live micro FX and motion-blur layers.

- **Depth**: the hero plane's clearance is sampled over every camera move; occlusion is measured on settled frames (full-frame decorative layers are ignored, a layer already fading through counts only above 50 %).
- **Hero**: the declared hero scene (else the first reveal / product / brand beat) must show its identity media (else its critical text) fully on screen, ≥ 85 % opaque, at least once while it holds.
- **Transition corridor**: for transitions that travel (push, slide, foreground-card-wipe, glass-wipe, directional-blur) the focal point of B must not land more than 35 % of the frame back against the travel.
- **Motion Continuity Score**: per cut, from the transition's vector, the cameras' measured motion over the last / first 40 % of each scene, or the family's edge; film score = mean. Below 0.45 → `CONTINUITY_BREAK`.
- **Budgets**: the effect cost (performance budget), live videos / motion-blur layers on one frame, and the FX budget (film cap + concurrent cost, hand-placed accents included).

`quality-report.json → spatial` holds the metrics (continuity per cut, hero coverage, corridors, minimum clearance, occlusions, perf, fx, score). Acceptance adds: *hero visible, never hidden behind a depth layer or pushed past the lens*.
