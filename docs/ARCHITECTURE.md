# Architecture

One shared engine, thin adapters. Everything below runs from `cli/nitaaq.ts` (Claude Code and Codex call the same commands).

```
brief.json ─► INTAKE (few questions) ─► CLASSIFY (SIMPLE/STANDARD/ADVANCED/LONG_FORM → budget)
   │
   ├─► BRAND (logo → palette, cached by hash)   ├─► REFERENCE (image/video/site → reference_style.json)
   ├─► ASSETS (byte-identical copies)           ├─► BEATS (music → beats.json, cached by hash)
   │                                            └─► CAPTURE (site → real screenshot)        [parallel, lazy]
   ▼
PLAN (story arc, pace, style) ─► STORYBOARD (recipes → scene families, user material never dropped)
   ─► AI CREATIVE DIRECTOR (personality, motion jobs, hero, escalation, camera budget, transitions, beat sync)
   ─► COMPILE → video.json + project memory files
   ─► VALIDATE (+ banned patterns, effect budget) ─► STRUCTURAL QC (probes + stills, cached) ─► REPAIR (≤2, 3rd if critical)
   ─► contact sheet + phone view ─► [ANIMATIC] ─► PRODUCTION RENDER (cached by content) ─► FINAL TECHNICAL QC
   ─► delivery (+ RECOMPOSE to extra formats → same pipeline per format)
```

## Layers

| Layer | Folder | Responsibility |
|---|---|---|
| Schemas | `src/schema/` | Zod: `brief`, `video` (video.json), `plan` (creative plan + storyboard). JSON Schema export: `npm run schema:export` → `schemas/`. |
| Director (pure) | `src/director/` | `intake` (questions), `classify` (task class + budget), `direction` (style pick, generated brand without logo), `recipes` (beat → scene family + content built only from the brief), `plan` (arc, pace, duration), `storyboard` (planner + voice sync), `creative` (AI Creative Director: personality, motion jobs, hero, camera budget, beat sync → motion_spec/shotlist), `compile` (→ VideoSpec). Deterministic per seed. |
| Reference / audio / perf / cache | `src/reference/`, `src/audio/beats.ts`, `src/perf/`, `src/cache/` | reference analysis, beat engine (spectral flux, tempo, DP beat tracking, downbeats, energy), stage timer + effect budget, content-addressed cache. |
| Design rules | `design/banned-patterns.json`, `src/design/` | banned generic looks (spec level), clean background kinds and pattern fallback. |
| Node orchestration | `src/node/` | `direct` (ingest files byte-identical, logo analysis, voice probe/segmentation, TTS, reference + beats in parallel, capture), `recompose` (multi-aspect), `capture` (website screenshot), `beats` (decode + cues), `manifest`, `project-files` (memory files), `render`, `produce` (validation → QC passes → render → QC → repair loop), `preflight`, `audio` (ffprobe, silencedetect, loudness, cleanup), `tts` (VoiceProvider), `fonts` (Arabic coverage check), `assets`, `workspace`, `bundle` (cached Remotion bundle). |
| Engine (React/Remotion) | `src/engine/` | `VideoComposition` knows only the SceneRegistry: timeline, transitions, background/texture, per-scene layout scale/offset, audio (voice, music with ducking, SFX), QC probe (qc mode only). |
| Scenes | `src/scenes/` | 71 families / 201 variants as plugins: `defineScene(manifest, Component)`; manifest = Zod content schema, variants, durations, beats, energy, SFX cues, aspect preferences, text capacity, example. `SceneRegistry.register/alias`. |
| Design system | `src/styles/`, `src/typography/`, `src/layout/`, `src/motion/`, `src/components/`, `src/brand/` | Style tokens (21 presets), font registry (11 families, local woff2), Arabic shaping helpers + text fitter, canvas profiles and platform safe areas, motion primitives (easing, springs, camera, parallax, count-up), shared components (Text, Surface, Icon, Media, mockups), colour science (OKLCH, WCAG contrast), logo analyzer + palette derivation. |
| QC | `src/qc/` | `quality.ts` (structural + final technical QC, scores, acceptance, critique, contact + phone sheets), `pattern-detect.ts` (dot/grid/particle detector), `probes.ts` (cached parallel DOM probes), `repair-loop.ts` (finding → safe spec change). See QUALITY.md. |
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

`MOTION_WORKSPACE` (default `./workspace`), `MOTION_UPLOADS`, `MOTION_OUTPUT`, `MOTION_CACHE`. Projects live in `<workspace>/projects/<id>/` with `brief.json`, `plan.json`, `video.json`, the memory files (`project_brief.md`, `brand.json`, `reference_style.json`, `assets_manifest.json`, `storyboard.json`, `shotlist.json`, `motion_spec.json`, `audio_cues.json`, `beats.json`, `quality_report.json`, `performance_report.json`, `review_log.md`, `ANIMATION_GUIDE.md` for long-form), `assets/`, `audio/`, `fonts/`, `qc/`, `renders/`. Cache: `.cache/nitaaq-motion/` (see PERFORMANCE.md).

## Claude Code and Codex

Both call the same CLI: Claude Code follows `SKILL.md` (installed under `~/.claude/skills/nitaaq-motion-graphics`), Codex follows `AGENTS.md` (`install.sh` adds a pointer to `~/.codex/AGENTS.md`). No behaviour differs between them.
