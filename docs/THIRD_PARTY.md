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
