# Quality

Nothing is delivered unless every acceptance rule passes. QC runs in stages so problems are caught before the expensive render.

## Pipeline

```
validate (static, src/validation) ─► structural QC (DOM probes on sampled frames + stills, no MP4)
   ─► contact sheet + phone-view sheet ─► auto-repair (≤ 2 passes, a 3rd only while critical issues remain)
   ─► [animatic for ADVANCED/LONG_FORM] ─► production render ─► final technical QC on the MP4
   ─► (post-render repair → re-render if needed) ─► delivery
```

Probes and pattern scans are cached per frame, so a repair pass re-checks only what changed.

## Passes and checks

| Pass | Checks |
|---|---|
| structure | text fit/overflow/off-canvas/outside safe area, overlap, fonts loaded, user media intact (no distortion, no upscaling surprises), CTA visible at the end, debug overlay absent |
| design | banned patterns (`design/banned-patterns.json`, spec level), `PATTERN_IN_FRAME` (pixel detector on stills: dot lattice, particle field, line grid, with text/media/card areas masked), contrast on real pixels, `TEXT_TOO_SMALL`, `PHONE_UNREADABLE` (text measured at phone size: 390 px wide portrait / 640 px landscape; minimum px per role), `LAYOUT_UNDERFILLED` |
| motion | `HOLD_TOO_SHORT`, `VOICE_DRIFT`, `MOTION_NO_PURPOSE`, `CAMERA_OVERUSE`, `TRANSITION_MONOTONY`, `PERSONALITY_MISMATCH` |
| technical (final) | MP4 container, H.264/yuv420p, size, fps, duration, encoder signatures stripped, audio present / not clipping / loudness, blank frames, pattern + contrast re-checked on decoded frames (all sampled frames extracted in one decode), `LOOP_SEAM` for loops |

## Scores and critique

Each pass starts at 100: critical −40, error −15, warning −5. `overall` = mean of the passes that ran, capped at 59 when any critical issue exists. Every issue carries a concrete `fix` (e.g. "enable layout.scrim or use a contrast-safe text colour from brand.json"), collected in `critique[]`.

## Acceptance rules (all must pass)

zero critical issues · no dot / particle / grid background · no watermark or developer signature · no clipped or off-canvas text · all fonts loaded · user media intact · CTA readable when the film ends on one · no debug overlay · (final) valid H.264/yuv420p MP4 at the right size, fps and duration · audio present and not clipping when planned · no blank frames.

## Auto-repair (`src/qc/repair-loop.ts`)

Safe, deterministic spec changes only: shrink text/layout, add a scrim, extend a hold, clean the background (`clean-background` → soft-gradient, decorations off), lower music/SFX, move cuts to voice phrases. Issues without a safe fix stop delivery with a readable message.

## Outputs

`quality_report.json` (v2.0: stage, scores, acceptance, critique, timings, probe cache stats, issues), `qc/…/contact-sheet.png`, `phone-view.png`, `review_log.md` (one entry per run).
