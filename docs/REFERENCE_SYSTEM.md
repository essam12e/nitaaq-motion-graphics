# Reference system

The user can point at something they like (an image, a video, or a website) and the film borrows its **principles**, never its content. Code: `src/reference/analyze.ts`, CLI `npx tsx cli/nitaaq.ts reference <file|url>`.

## Input

`brief.reference = { "path": "ref.png" | "ref.mp4", "url": "https://…", "kind": "image|video|website|ui", "note": "what the user likes" }`

- **image / ui screenshot**: analysed directly.
- **video**: frames sampled with ffmpeg (≈1 fps, up to 12) + motion energy (mean frame difference) + scene-cut rate (ffmpeg scene detection).
- **website**: captured with the bundled headless browser (`src/node/capture.ts`, desktop 1440×900 or mobile 390×844), then analysed as a UI reference. In environments whose network policy blocks outside sites, capture fails with `CAPTURE_FAILED` and the user is asked for a screenshot instead.

## What is measured (per frame, at 256 px)

Dominant palette (k-means), background and accent colour, neutral share, mean luminance (dark/light), contrast, saturation (OKLCH chroma), edge density, whitespace (share of large empty blocks), composition balance (centred / left / right / top / bottom weighted), and whether the reference itself uses a dot/grid pattern (same detector as QC).

## Output: `reference_style.json`

```jsonc
{
  "palette": { "dominant": [...], "background": "#F4EFE6", "accent": "#C8553D", "neutralShare": 0.71 },
  "mode": "light", "contrast": 0.62, "saturation": 0.21, "density": 0.18, "whitespace": 0.82,
  "composition": "right-weighted",
  "motion": null,                     // or { energy, cutsPerSecond, avgShotSec, pacing } for video
  "principles": ["light background with a lot of empty space", "one dominant shape", "quiet, low-saturation colour", …],
  "mapping": { "style": "minimal", "personality": "corporate", "background": "soft-gradient", "pace": "slow", "density": "sparse", "reason": "light, sparse, quiet colour" },
  "notCopied": ["layout", "text", "imagery", "logo", …]
}
```

## How it is applied

- **style** (when the brief has none): rule table → `neon`, `luxury`, `cinematic`, `sports`, `dark-premium`, `tech`, `bold-social`, `editorial`, `minimal`, `light-premium`, `saas`.
- **pace** (when the brief has none) from video pacing or whitespace.
- **motion personality** from the style, or from the measured motion energy when it is extreme.
- **palette** only when the user gave no brand at all (no logo, no colours): the reference colour family, contrast-enforced. A user logo or user colours always win.
- **patterns**: if the reference uses dots/grid, that is listed in `principles` and `notCopied`; it is not enabled unless the user explicitly asks.

Nothing from the reference is copied: no layout, text, image, logo or brand mark. Results are cached by file hash (`.cache/nitaaq-motion/ref-v1`).
