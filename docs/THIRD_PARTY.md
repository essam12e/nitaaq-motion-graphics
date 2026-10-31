# Third-party code, assets and licences

## Runtime dependencies (unchanged by Motion 2.0)

| Package | Licence | Use |
|---|---|---|
| remotion, @remotion/* 4.0.530 | Remotion License (free for individuals and companies ≤ 3 people; larger companies need a company licence — see remotion.dev/license) | rendering |
| react / react-dom 18.3.1 | MIT | UI |
| zod | MIT | schemas |
| lucide-react 0.460.0 | ISC | icons (also as morph paths) |
| qrcode | MIT | QR codes |
| lottie-web 5.13.0 (optional, light SVG build, no expression engine) | MIT | playing user Lottie animations, frame by frame (`src/components/LottieMedia.tsx`) |

Motion 2.0 added **no dependency**. The Premium upgrade added one optional dependency, lottie-web (MIT), loaded only when a film shows a Lottie. Dev tooling (vitest, tsx, sharp, pngjs, pixelmatch, TypeScript) is MIT / Apache-2.0 / ISC.

## Ideas reimplemented (no code copied)

| Idea | Source studied | Licence of the source | What we did |
|---|---|---|---|
| spring physics (bounce/visual-duration parameterisation), inertia | Framer Motion / Motion One docs, physics textbooks | MIT | own closed-form damped-oscillator solver (`src/motion/spring.ts`) |
| path morphing with sub-path matching and arc travel | flubber, Manim `Transform` / `path_arc` | MIT / MIT | own parser, resampler and matcher (`src/morph/path.ts`) |
| contour tracing of an alpha mask | marching squares (public algorithm) | — | `src/morph/trace.ts` |
| 2.5D camera over depth planes | CSS 3D transforms spec | W3C | `src/camera/rig.ts` |
| visual QA by sampling moments (overlap, framing, balance) | anymotion's QA approach | — | own checks on our DOM probes (`src/qc/vqa.ts`) |
| loudness normalisation | EBU R128 / ffmpeg `loudnorm` | LGPL (ffmpeg, called as a program, not linked) | `masterAudio` |

**No GPL code is in the core.** Manim (MIT) is **not** a dependency, not even optional at runtime: only ideas were reimplemented. Nothing is downloaded at build time.

## Bundled assets

- `public/sfx/` — CC0-1.0 sounds (Kenney via AtomCut Library and the Open Game SFX Index); provenance per file in `public/sfx/CREDITS.md`, sha256 recorded when fetched (`cli/curate-sfx.ts`).
- Fonts — SIL Open Font License (see `public/fonts`).
- `public/demo/` — demo images made for this project.

## Sounds fetched at run time (optional)

Only with `NITAAQ_AUDIO_ONLINE=1`, only CC0 (or CC-BY with a recorded attribution), each with a provenance sidecar `.json` (source URL, licence, author, sha256, fetched date). Files with an unknown licence are rejected.

## Dependency strategy

1. Core stays small: Remotion + React + Zod. New capabilities are written in TypeScript in this repo.
2. Heavy or experimental tools (CLAP embeddings, Manim, ML models) are optional adapters behind a hook (`setSemanticBackend`) — never required, never installed by default.
3. No paid API is needed for anything; paid TTS stays optional.
4. The internet is never required: every online feature has an offline fallback.

## Concepts studied (no code copied)

- **lemo-opuscar** (github.com/lemomo-ai/lemo-opuscar, MIT, Copyright 2026 LemoLab) — studied for Style Library v2: a style as a rules document (essence and "not this", material, colour logic, type, motion quality, a camera table, native moves with "fits content like…", transitions from the medium). These ideas were re-expressed as NITAAQ data (`src/style-system/`) over NITAAQ's own primitives. No file or function was copied, nothing is vendored, and its three.js / WebGL renderers are not used (a style that needs one is marked `REQUIRES_OPTIONAL_RENDERER`).

## MotionMaxxing (optional module `motionmaxxing`)

Source: https://github.com/Tejashmakwana/motionmaxxing (commit in `vendor/motionmaxxing/UPSTREAM_COMMIT`), © Tejas Makwana.
Licence: **Apache License 2.0** — full text and the upstream NOTICE are kept unchanged in `public/mm/LICENSE`, `public/mm/NOTICE`,
`vendor/motionmaxxing/LICENSE`, `vendor/motionmaxxing/NOTICE`.

| Bundled | Licence | Notes |
|---|---|---|
| `public/mm/runtime/motion.js`, `native-ui/`, `hero3d/hero3d.js`, `hero3d/tools/fontconv.py`, `fonts.css` | Apache-2.0 | unmodified |
| `public/mm/runtime/hero3d/vendor/` three.js r186 + addons, fflate | MIT (EXR loader keeps TinyEXR/OpenEXR BSD-3 notices; SVGLoader includes svg-numbers MIT) | unmodified |
| `public/mm/runtime/hero3d/vendor/opentype.module.js` 1.3.4 | MIT | unmodified |
| Inter (`public/mm/runtime/fonts/`, `hero3d/fonts/`) | SIL OFL 1.1 | unmodified |
| `vendor/motionmaxxing/scripts/` brand.mjs, fetch_logo.mjs, _cdp.mjs, sync.mjs, render.mjs, lint.mjs | Apache-2.0 | unmodified; brand.mjs/fetch_logo.mjs run by `cli/brand-capture.ts` |
| `docs/motionmaxxing/*.md` | Apache-2.0 | reference docs, unmodified |
| `src/mm/eases.ts` (the 12 curves), `src/mm/sync.ts` (sync.mjs port), `grainFilter` (render.mjs grain) | Apache-2.0 (derived) | ported, attribution in the file headers |

**GSAP**: MotionMaxxing ships GSAP 3.12.5 (`runtime/vendor/gsap.min.js`); we do **not** redistribute that copy.
The runtime uses NITAAQ's existing optional dependency `gsap` (^3.15, GreenSock Standard "no charge" licence, not
open source; no Club/bonus plugins), copied into `public/mm/runtime/vendor/` (git-ignored) by `npm run mm:sync`.
Read the GreenSock Standard Licence before redistributing a build that contains it.

Showcase brands in MotionMaxxing's docs (Cluely, Spotify, Wispr Flow) are not copied. Logos fetched by
`fetch_logo.mjs` stay their owners' trademarks (nominative use, unmodified).
