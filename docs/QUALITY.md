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
| technical (final) | MP4 container, H.264/yuv420p, size, fps, duration, encoder signatures stripped, audio present / not clipping / loudness, blank frames, pattern + contrast re-checked on decoded frames (all sampled frames extracted in one decode), `LOOP_SEAM` for loops |

## Scores and critique

Each pass starts at 100 (the `audio` pass is included when the sound stage ran): critical −40, error −15, warning −5. `overall` = mean of the passes that ran, capped at 59 when any critical issue exists. Every issue carries a concrete `fix` (e.g. "enable layout.scrim or use a contrast-safe text colour from brand.json"), collected in `critique[]`.

## Acceptance rules (all must pass)

zero critical issues · no dot / particle / grid background · no watermark or developer signature · no clipped or off-canvas text · all fonts loaded · user media intact · CTA readable when the film ends on one · no debug overlay · (final) valid H.264/yuv420p MP4 at the right size, fps and duration · audio present and not clipping when planned · no sound file repeated back-to-back · no blank frames.

## Auto-repair (`src/qc/repair-loop.ts`)

Safe, deterministic spec changes only: shrink text/layout, add a scrim, extend a hold, clean the background (`clean-background` → soft-gradient, decorations off), lower music/SFX, move cuts to voice phrases; audio: re-plan SFX with another seeded variation, thin the density (intensity −, min 0.2), lower SFX (×0.75, min 0.3). Issues without a safe fix stop delivery with a readable message.

## Measurement notes

- **Text overflow** is measured, not estimated: the probe measures each text node's real width with a DOM `Range` (spaces included) scaled to the line's layout width; only text with opacity > 0.05 is checked, and the finding targets the scene that owns the text.
- **Particle fields** are only reported when the blobs are spread over the frame (≥ 12 of 36 grid cells, across ≥ 3 columns and ≥ 3 rows), and diagram shapes (`data-qc="box"`) are masked, so circles in a process diagram are not mistaken for a pattern.

## Outputs

`quality_report.json` (v2.0: stage, scores, acceptance, critique, timings, probe cache stats, issues), `qc/…/contact-sheet.png`, `phone-view.png`, `review_log.md` (one entry per run), `audio-qc.json`, `sound-plan.json`.
