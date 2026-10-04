# Architecture

One shared engine, thin adapters. Everything below runs from `cli/nitaaq.ts` (Claude Code and Codex call the same commands).

```
brief.json ─► INTAKE (few questions; logo question asked when no logo) ─► CLASSIFY (task class → budget)
   ─► GENRE (ad / product / launch / logo / data / map / explainer / whiteboard / illustrated / kinetic …)
   ─► MODULE SELECTION (core always on; map / soundtrack / gsap / logo / variants import()-ed only if needed)
   │
   ├─► CHARACTER (brief.character → package: poses / rig / bible / pose library, cached by hash; lazy module)
   ├─► BRAND (logo → palette + logo structure, cached)  ├─► REFERENCE (→ reference_style.json)
   ├─► ASSETS (byte-identical copies)                   ├─► BEATS (music → beats.json, cached)
   │                                                    └─► CAPTURE (site → real screenshot)   [parallel, lazy]
   ▼
PLAN (arc, pace, style) ─► STORYBOARD (recipes → families; user material never dropped)
   │   character film: CHARACTER DIRECTOR (line → intent → phases, pose, shot, camera, pose cut) replaces the recipes;
   │   pose cuts become transitions; the CHARACTER ACTOR's exact event anchors feed the Sound Director
   ─► CREATIVE DIRECTOR (personality, motion jobs, hero, camera budget, beat sync)
   ─► TEXT MOTION PLAN + TRANSITION ENGINE (meaning-driven, shared elements planned)
   ─► COMPILE → video.json + project memory files
   ─► SOUND STAGE (soundtrack if needed → events → Sound Director → sound-plan.json)
   ─► produce:
        VALIDATE ─► STRUCTURAL QC (probes, cached) ─► REPAIR
        ─► SHARED-ELEMENT RECTS (measured with the probe)
        ─► SOUND STAGE + AUDIO QC / motion-variety QC ─► REPAIR (≤3 variations)
        ─► contact sheet + phone view ─► [ANIMATIC] ─► RENDER (cached) ─► FINAL QC (+ audio pass)
        ─► post-render repair loop ─► delivery (only with 0 critical)
   ─► variants command: 5 strategies × aspects → recomposed films (same pipeline per job)
```

## Layers

| Layer | Folder | Responsibility |
|---|---|---|
| Schemas | `src/schema/` | Zod: `brief`, `video` (video.json), `plan` (creative plan + storyboard). JSON Schema export: `npm run schema:export` → `schemas/`. |
| Director (pure) | `src/director/` | `intake` (questions), `classify` (task class + budget), `modules` (genre classifier, ModuleRegistry, lazy `loadModules`), `variants` (ad-variant strategies), `direction` (style pick, generated brand without logo), `recipes` (beat → scene family + content built only from the brief), `plan` (arc, pace, duration), `storyboard` (planner + voice sync), `creative` (AI Creative Director: personality, motion jobs, hero, camera budget, beat sync → motion_spec/shotlist), `compile` (→ VideoSpec). Deterministic per seed. |
| Reference / perf / cache | `src/reference/`, `src/perf/`, `src/cache/` | reference analysis, stage timer + effect budget, content-addressed cache. |
| Motion | `src/motion/`, `src/text-motion/`, `src/transitions/` | physics presets (12), Animation Principles Engine (mass, anticipation, follow-through, arcs, squash, sound anchors), text-motion registry (27 families) + planner, transition registry (30) + meaning-driven chooser. |
| Audio | `src/audio/` | beat engine, motion events + anchors, SFX family registry (32 families, 180 variants, synthesised), Sound Director, mix, procedural soundtrack (`soundtrack/compose.ts`, 8 styles). |
| Character | `src/character/`, `src/node/character/`, `src/scenes/character/`, `src/qc/character-qc.ts` | Pure: schema (package format), director (line reading, state machine, shot plan, cuts), actor (springs, anticipation, overlap, secondary motion, idle, talk, exact event anchors), layout (pixels-per-head placement, RTL screen direction), rig + gestures (2D rig solve, arm reach, face states), library (missing-pose strategy, complexity), semantics + silhouette (pose classification, fingerprint). Node: package (prepare, cache, library), ingest (sheet detection, matte), svg (layered SVG → rig), film (character storyboard, events), preview (acting sheet). 5 scene families. See CHARACTER_ENGINE.md. |
| Brand / illustration / maps | `src/brand/`, `src/illustration/`, `src/maps/` | brand-motion.json, logo structure + reveal choice, illustration registry (seeded vector art), GeoJSON projection and route paths. |
| Design rules | `design/banned-patterns.json`, `src/design/` | banned generic looks (spec level), clean background kinds and pattern fallback. |
| Node orchestration | `src/node/` | `direct` (ingest files byte-identical, logo analysis, voice probe/segmentation, TTS, reference + beats in parallel, capture), `recompose` (multi-aspect), `capture` (website screenshot), `beats` (decode + cues), `manifest`, `project-files` (memory files), `render`, `produce` (validation → QC passes → shared rects → sound stage → render → QC → repair loop), `sound` (film events, sfx-history, plan files), `shared-rects` (measured shared-element rects), `brand-motion-store`, `logo-structure`, `preflight`, `audio` (ffprobe, silencedetect, loudness, cleanup), `tts` (VoiceProvider), `fonts` (Arabic coverage check), `assets`, `workspace`, `bundle` (cached Remotion bundle). |
| Engine (React/Remotion) | `src/engine/` | `VideoComposition` knows only the SceneRegistry: timeline, transitions, background/texture, per-scene layout scale/offset, audio (voice, music with ducking, SFX), QC probe (qc mode only). |
| Scenes | `src/scenes/` | 93 families / 268 variants as plugins: `defineScene(manifest, Component)`; manifest = Zod content schema, variants, durations, beats, energy, SFX cues, aspect preferences, text capacity, example. `SceneRegistry.register/alias`. |
| Design system | `src/styles/`, `src/typography/`, `src/layout/`, `src/motion/`, `src/components/`, `src/brand/` | Style tokens (24 presets), font registry (11 families, local woff2), Arabic shaping helpers + text fitter, canvas profiles and platform safe areas, motion primitives (easing, springs, camera, parallax, count-up), shared components (Text, Surface, Icon, Media, mockups), colour science (OKLCH, WCAG contrast), logo analyzer + palette derivation. |
| QC | `src/qc/` | `quality.ts` (structural + final technical QC, scores, acceptance, critique, contact + phone sheets), `audio-qc.ts` (SFX repetition / density / sync / voice clash + motion variety), `pattern-detect.ts` (dot/grid/particle detector), `probes.ts` (cached parallel DOM probes), `repair-loop.ts` (finding → safe spec change). See QUALITY.md. |
| Validation | `src/validation/` | Static validation (issues with severity) + deterministic repair with a repair log. |
| Studio | `studio/` | Local editor (Remotion Player + timeline + inspector + undo/redo + save/validate/render). |

## Key rules enforced in code

- **Text never silently overflows.** `fitText` shrinks within `minSize`, re-wraps by Arabic-aware break units, and reports `fits:false`; the QC probe reports `TEXT_FIT_FAIL`/`TEXT_OVERFLOW` → repair shrinks text/layout or the video is not delivered.
- **Arabic:** RTL base direction per line, no letter-spacing on Arabic (`ARABIC_LETTER_SPACING`), no per-letter spans (`ARABIC_SPLIT_GLYPHS`), Arabic punctuation, numeral system per project, mixed Latin runs isolated.
- **User media is sacred:** ingest copies byte-identical (SHA-1 verified); identity media (logo/product/screenshot) always `object-fit: contain`; QC fails on distortion.
- **No invented data:** data/testimonial families require `source`; the Director only builds them from brief fields; `example`/`placeholder` sources are critical.
- **Zero watermark:** developer signatures are critical in validation and QC; encoder "Made with Remotion" tag is stripped and checked in the MP4.
- **Delivery gate:** `produce` copies the MP4 to the delivery folder only when the final QC has 0 critical issues.

- **Deterministic:** no `Math.random` / `Date.now` in render code; every choice uses `createRng(seed)` (unit-tested).
- **Never fabricate:** no invented numbers, map coordinates, reviews or product changes; missing data → the scene is not built.

## Extending

- New scene: see `docs/SCENE_LIBRARY.md` → "Adding a scene family".
- New style: `registerStyle(tokens)` or add to `src/styles/presets.ts`.
- New voice provider: implement `VoiceProvider` (`available`, `listVoices`, `synthesize`, `validate`) and `registerVoiceProvider()`.
- New SFX family / transition / text-motion family / module: register it in its registry (`SfxFamilyRegistry`, `TransitionRegistry`, `TextMotionRegistry`, `ModuleRegistry`); the director picks it up by meaning.
- New QC check: add to `runQuality` with a `repair` hint; map the hint in `applyQcRepairs` if a safe fix exists, otherwise list the code in `NON_REPAIRABLE`.

## Paths

`MOTION_WORKSPACE` (default `./workspace`), `MOTION_UPLOADS`, `MOTION_OUTPUT`, `MOTION_CACHE`. Projects live in `<workspace>/projects/<id>/` with `brief.json`, `plan.json`, `video.json`, the memory files (`project_brief.md`, `brand.json`, `reference_style.json`, `assets_manifest.json`, `storyboard.json`, `shotlist.json`, `motion_spec.json`, `audio_cues.json`, `beats.json`, `sound-plan.json`, `audio-qc.json`, `brand-motion.json`, `quality_report.json`, `performance_report.json`, `review_log.md`, `ANIMATION_GUIDE.md` for long-form), `assets/`, `audio/`, `fonts/`, `qc/`, `renders/`. Cache: `.cache/nitaaq-motion/` (see PERFORMANCE.md); prepared characters in `.cache/nitaaq-motion/characters/<hash>/`, saved ones in `<workspace>/characters/<name>/`.

## Claude Code and Codex

Both call the same CLI: Claude Code follows `SKILL.md` (installed under `~/.claude/skills/nitaaq-motion-graphics`), Codex follows `AGENTS.md` (`install.sh` adds a pointer to `~/.codex/AGENTS.md`). No behaviour differs between them.
