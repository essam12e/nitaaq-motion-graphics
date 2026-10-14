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
   ─► CREATIVE DIRECTOR (personality, motion jobs + intents, hero, camera plans 2.5D, beat accents)
   ─► TEXT MOTION PLAN + TRANSITION ENGINE (meaning-driven, shared elements planned)
   ─► COMPILE → video.json ─► ANTI-TEMPLATE (vs. workspace history) ─► RHYTHM PLAN + MOTION LANGUAGE
   ─► project memory files (rhythm_plan.json, anti_template.json, music_plan.json …)
   ─► SOUND STAGE (soundtrack if needed → events → Sound Director → sound-plan.json)
   ─► produce:
        VALIDATE ─► STRUCTURAL QC (probes, cached) + VISUAL QA 2.0 (moments, camera framing, product protection,
        determinism) ─► REPAIR (camera-solve …)
        ─► SHARED-ELEMENT RECTS (measured with the probe)
        ─► SOUND STAGE + AUDIO QC / motion-variety QC ─► REPAIR (≤3 variations)
        ─► contact sheet + phone view ─► [ANIMATIC] ─► RENDER (cached) ─► MASTER (−14 LUFS, −1 dBTP) ─► FINAL QC (category gate) (+ audio pass)
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
| Audio | `src/audio/` | beat engine, motion events + anchors, SFX family registry (32 families, 180 variants, synthesised), Sound Director, mix with music automation (gain points, duck curves, pre-entry, VO → music handoff, crossfade, endings), procedural soundtrack (`soundtrack/compose.ts`, 8 styles). |
| Character | `src/character/`, `src/node/character/`, `src/scenes/character/`, `src/qc/character-qc.ts` | Pure: schema (package format), director (line reading, state machine, shot plan, cuts), actor (springs, anticipation, overlap, secondary motion, idle, talk, exact event anchors), layout (pixels-per-head placement, RTL screen direction), rig + gestures (2D rig solve, arm reach, face states), library (missing-pose strategy, complexity), semantics + silhouette (pose classification, fingerprint). Node: package (prepare, cache, library), ingest (sheet detection, matte), svg (layered SVG → rig), film (character storyboard, events), preview (acting sheet). 5 scene families. See CHARACTER_ENGINE.md. |
| Choreography Engine | `src/motion/choreography.ts`, `src/motion/interaction.ts`, `src/motion/phrases.ts`, `src/scenes/interaction/` | Pure: one timeline per moment (sequence / parallel / overlap / wait / marker / cue / trigger / follow / stagger / handoff) compiled to frame functions on top of the motion primitives; property tracks (to / pulse / kick); focus handoff; Sound Director events with exact anchors; camera channels for the Camera Engine (`CameraRig state`). Interaction: cursor move / hover / press / click / release / drag and the target's response (`Cursor state`). Motion Phrases (reveal / interaction / camera). Scene `interaction-flow`. See CHOREOGRAPHY.md. |
| Glass + Spatial | `src/components/glass.ts`, `src/components/GlassPortfolioFolder.tsx`, `src/components/glass-folder-state.ts`, `src/camera/spatial.ts`, `src/scenes/spatial/` | Glass 2.0 (opt-in `Surface glass`: frost, thickness, edge light, specular sweep, simulated refraction, chromatic edge, camera-driven reflections; live backdrop blur only outside a 3D camera). GlassPortfolioFolder with six states read from one pose. Spatial camera: cards in depth, tour camera, pass-through fade, plane maps identical to the rig for planes facing the camera (drawn in 2D for deterministic raster). Scenes `glass-folder`, `spatial-gallery`. See SPATIAL.md. |
| Camera Solver + spatial transitions | `src/camera/solver.ts`, `src/camera/moves.ts` (presets, targets, bounds), `src/fx/directional-blur.tsx`, `src/transitions/advanced.ts`, `src/transitions/continuity.ts` | Pure: auto framing of an element / group, smooth look-at, bounds, velocity blur hints, focus handoff; camera presets and pass-through on the existing rig. Eight spatial transitions on the existing engine; Motion Continuity vectors and score. See CAMERA.md, TRANSITIONS.md. |
| Micro FX | `src/fx/micro.ts`, `src/fx/plan.ts`, `src/fx/MicroFx.tsx` | Nine seeded SVG accents; auto placement from motion events × Motion Intent × personality; FX budget joined to the effect budget. See MICRO_FX.md. |
| Spatial QC | `src/qc/spatial-qc.ts` | Depth / occlusion, hero visibility, safe areas for identity media, transition corridors, continuity score, performance and FX budgets — on the structural probes. See QUALITY.md. |
| Vector Engine 2.0 | `src/vector/`, `src/node/vector-assets.ts` | Pure: affine matrices, geometry (arc length, exact trim, bounds), paint (OKLab colours, gradients), SVG tree (CSS, use/symbol, clips, masks, sanitising), draw / build / morph programs, booleans (render + experimental exact), Non-Destructive Vector Graph. React: `VectorArt`, `VectorGraphArt` (scene `vector-draw`). Node: SVG ingest + prepared `*.vector.json`. See VECTOR_ENGINE.md. |
| Brand / illustration / maps | `src/brand/`, `src/illustration/`, `src/maps/` | brand-motion.json, logo structure + reveal choice, illustration registry (seeded vector art), GeoJSON projection and route paths. |
| Design rules | `design/banned-patterns.json`, `src/design/` | banned generic looks (spec level), clean background kinds and pattern fallback. |
| Node orchestration | `src/node/` | `direct` (ingest files byte-identical, logo analysis, voice probe/segmentation, TTS, reference + beats in parallel, capture), `recompose` (multi-aspect), `capture` (website screenshot), `beats` (decode + cues), `manifest`, `project-files` (memory files), `render`, `produce` (validation → QC passes → shared rects → sound stage → render → QC → repair loop), `sound` (film events, sfx-history, plan files), `shared-rects` (measured shared-element rects), `brand-motion-store`, `logo-structure`, `preflight`, `audio` (ffprobe, silencedetect, loudness, cleanup), `tts` (VoiceProvider), `fonts` (Arabic coverage check), `assets`, `workspace`, `bundle` (cached Remotion bundle). |
| Engine (React/Remotion) | `src/engine/` | `VideoComposition` knows only the SceneRegistry: timeline, transitions, background/texture, per-scene layout scale/offset, audio (voice, music with ducking, SFX), QC probe (qc mode only). |
| Scenes | `src/scenes/` | 102 families / 295 variants as plugins: `defineScene(manifest, Component)`; manifest = Zod content schema, variants, durations, beats, energy, SFX cues, aspect preferences, text capacity, example. `SceneRegistry.register/alias`. |
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
