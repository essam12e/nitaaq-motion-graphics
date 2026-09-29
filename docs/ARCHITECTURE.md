# Architecture

One shared engine, thin adapters. Everything below runs from `cli/amd.ts` (Claude Code and Codex call the same commands).

```
brief.json ─► INTAKE ─► BRAND ─► DIRECTOR ─► STORYBOARD ─► video.json ─► VALIDATION+REPAIR
                │          │          │            │                              │
         questions   logo → palette   plan.json    storyboard.json                ▼
         (exit 2)    or generated     (arc, pace,  (families, variants,     QC PROBE PASSES (≤3)
                     direction        style, audio) timing, transitions)    DOM probe + repair
                                                                                   │
                                                                                   ▼
                                                     MP4 ◄─ RENDER (Remotion, H.264, yuv420p, bt709)
                                                      │
                                                      ▼
                                   FULL QC (DOM + pixels from the MP4 + ffprobe + loudness)
                                                      │ critical = 0 ?
                                              yes ────┴──── no → repair → re-render (≤3 passes) or fail clearly
                                               ▼
                                   renders/final/<name>.mp4 + quality-report.json + contact-sheet.png
```

## Layers

| Layer | Folder | Responsibility |
|---|---|---|
| Schemas | `src/schema/` | Zod: `brief`, `video` (video.json), `plan` (creative plan + storyboard). JSON Schema export: `npm run schema:export` → `schemas/`. |
| Director (pure) | `src/director/` | `intake` (questions), `direction` (style pick, generated brand without logo), `recipes` (beat → scene family + content built only from the brief), `plan` (arc, pace, duration), `storyboard` (planner + motion composer + voice sync), `compile` (→ VideoSpec). Deterministic per seed. |
| Node orchestration | `src/node/` | `direct` (ingest files byte-identical, logo analysis, voice probe/segmentation, TTS), `render`, `produce` (validation → QC passes → render → QC → repair loop), `preflight`, `audio` (ffprobe, silencedetect, loudness, cleanup), `tts` (VoiceProvider), `fonts` (Arabic coverage check), `assets`, `workspace`, `bundle` (cached Remotion bundle). |
| Engine (React/Remotion) | `src/engine/` | `VideoComposition` knows only the SceneRegistry: timeline, transitions, background/texture, per-scene layout scale/offset, audio (voice, music with ducking, SFX), QC probe (qc mode only). |
| Scenes | `src/scenes/` | 63 families / 185 variants as plugins: `defineScene(manifest, Component)`; manifest = Zod content schema, variants, durations, beats, energy, SFX cues, aspect preferences, text capacity, example. `SceneRegistry.register/alias`. |
| Design system | `src/styles/`, `src/typography/`, `src/layout/`, `src/motion/`, `src/components/`, `src/brand/` | Style tokens (18 presets), font registry (11 families, local woff2), Arabic shaping helpers + text fitter, canvas profiles and platform safe areas, motion primitives (easing, springs, camera, parallax, count-up), shared components (Text, Surface, Icon, Media, mockups), colour science (OKLCH, WCAG contrast), logo analyzer + palette derivation. |
| QC | `src/qc/` | `quality.ts` (checks + report + contact sheet), `repair-loop.ts` (finding → safe spec change). |
| Validation | `src/validation/` | Static validation (issues with severity) + deterministic repair with a repair log. |
| Studio | `studio/` | Local editor (Remotion Player + timeline + inspector + undo/redo + save/validate/render). |

## Key rules enforced in code

- **Text never silently overflows.** `fitText` shrinks within `minSize`, re-wraps by Arabic-aware break units, and reports `fits:false`; the QC probe reports `TEXT_FIT_FAIL`/`TEXT_OVERFLOW` → repair shrinks text/layout or the video is not delivered.
- **Arabic:** RTL base direction per line, no letter-spacing on Arabic (`ARABIC_LETTER_SPACING`), no per-letter spans (`ARABIC_SPLIT_GLYPHS`), Arabic punctuation, numeral system per project, mixed Latin runs isolated.
- **User media is sacred:** ingest copies byte-identical (SHA-1 verified); identity media (logo/product/screenshot) always `object-fit: contain`; QC fails on distortion.
- **No invented data:** data/testimonial families require `source`; the Director only builds them from brief fields; `example`/`placeholder` sources are critical.
- **Zero watermark:** developer signatures are critical in validation and QC; encoder "Made with Remotion" tag is stripped and checked in the MP4.
- **Delivery gate:** `produce` copies the MP4 to the delivery folder only when the final QC has 0 critical issues.

## Extending

- New scene: see `docs/SCENE_LIBRARY.md` → "Adding a scene family".
- New style: `registerStyle(tokens)` or add to `src/styles/presets.ts`.
- New voice provider: implement `VoiceProvider` (`available`, `listVoices`, `synthesize`, `validate`) and `registerVoiceProvider()`.
- New QC check: add to `runQuality` with a `repair` hint; map the hint in `applyQcRepairs` if a safe fix exists, otherwise list the code in `NON_REPAIRABLE`.

## Paths

`MOTION_WORKSPACE` (default `./workspace`), `MOTION_UPLOADS`, `MOTION_OUTPUT`, `MOTION_CACHE`. Projects live in `<workspace>/projects/<id>/` with `brief.json`, `plan.json`, `storyboard.json`, `video.json`, `assets/`, `audio/`, `fonts/`, `qc/`, `renders/`.
