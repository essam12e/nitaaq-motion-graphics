# NITAAQ Sound Director

Code: `src/audio/events.ts` (motion events + anchors), `src/audio/sfx-families.ts` (intents, personalities, SfxFamilyRegistry), `src/audio/synth/` (deterministic SFX synthesis + bank), `src/audio/sound-director.ts` (`directSound`), `src/node/sound.ts` (film events, history, plan files), `src/qc/audio-qc.ts` (audio QC).

The old mapping "transition → whoosh, button → click" is gone. Every cue goes through:

```
MOTION EVENTS → SEMANTIC ANALYSIS → SOUND INTENT → SFX FAMILY → VARIANT → LAYERING → SYNC → MIX → REPETITION CHECK
```

## 1. Motion events and sound anchors

Scenes declare what happens in them (`manifest.events(content, variant, duration)`), e.g. `product-hero` declares `product_entry` and `product_land`; older families' SFX suggestions are converted to semantic events (`legacyEvent`). Transitions add a `scene_transition` event at the transition's visual peak.

30 event types: scene_start, headline_reveal, word_impact, text_reveal, product_entry, product_peak_velocity, product_land, button_press, success_state, error_state, warning_state, notification, ui_appear, card_entry, swipe, typing, chart_grow, chart_peak, counter_tick, counter_final, price_reveal, logo_reveal, cta_reveal, scene_transition, draw_stroke, map_route, map_pin, camera_move, hero_reveal, tease.

`detectEvents()` resolves each declaration with the **Animation Principles Engine** (the same motion profile the element is animated with) into absolute times and anchors — `start`, `peak` (peak velocity), `contact`/impact, `settle`, `completion` — plus metadata: importance, element, apparent mass, speed, distance, direction, impact strength and scene energy. Each type has a default anchor (product_land → contact, product_entry → peak, logo_reveal → settle, counter_final → completion, button_press → contact …) that a scene may override. A sound is never placed at scene start unless the event really starts there.

## 2. Semantic intent

`intentOf(event, personality)` answers *what happened* and *how it moved*: 26 intents — motion-air / motion-heavy / motion-fast, contact-soft / contact-heavy / contact-punch, ui-tap / ui-confirm / ui-appear / ui-swipe / ui-type, state-success / state-error / state-warning, notify, count-tick / count-final, price, signature, sparkle, reveal-build / reveal-hit, tease, draw, map-pin / map-route. A light icon appearing and a heavy product landing get different intents; some events get **no** intent (silence).

## 3. Families and variants

32 families (`SfxFamilyRegistry`), each with intents, the personalities it suits, its layer (movement / impact / single / detail), gain and duck class: whoosh-air, whoosh-deep, swoosh-fast, swipe-ui, impact-soft, impact-punch, thud-heavy, boom-sub, click-ui, tap-soft, button-press, pop-bubble, blip-digital, tick-soft, chime-success, buzz-error, tone-warning, ding-notify, key-type, riser-tension, swell-reverse, shimmer, glass-ting, light-sweep, coin-chime, logo-stinger, marker-stroke, pluck-pin, route-glide, shutter-camera, glitch-digital, paper-slide.

Variants: **180** files — every family has 3–5 code-synthesised variants (`src/audio/synth/sfx-gen.ts`, seeded DSP: noise/oscillator layers, envelopes, filters, saturation, reverb, normalised) plus the 26 CC0 library sounds mapped into families. The bank (`public/sfx/gen/*.wav` + `index.json` with duration, measured **peak time** and RMS per file) is generated once (~4 s, 11 MB) and regenerated only when the generator version changes. No sound is downloaded.

## 4. Sound personality

luxury (soft, deep, restrained), tech (precise, digital), sport (punchy), playful (light, elastic), cinematic (deep, layered, spacious), corporate (minimal, subtle). Source order: the brief's `audio.soundPersonality` → `brand-motion.json` → the film's motion personality (premium → luxury, energetic → sport …). The same animation is treated differently per personality (family scoring prefers families that list the personality).

## 5. Density budget — silence is a design tool

- Budget = `round(duration × (0.3 + 0.7 × intensity))` cues; key moments (importance ≥ 0.85) first.
- Importance threshold rises as intensity falls; minor events below it stay silent.
- Spacing: no two cues within 0.16 s (0.09 s for key moments) — when events coincide the more important one wins.
- Detail sounds under a voice are dropped unless important; the rest are ducked (accent ×0.6, detail ×0.4).
- Every dropped event is listed with its reason in `sound-plan.json`.

## 6. Variant selection and the repetition guard

Per family: penalties for variants already used in this film (cap per variant), the **same file within 3 s anywhere**, the file just played (excluded), and variants used in the **last 6 films** (`workspace/.sound/sfx-history.json`, last 12 films kept) — so the film is consistent in timbre without looping one sound, and consecutive films do not reuse the same set. Family choice also penalises overused families. Seeded: the same project re-plans to the same cues.

## 7. Layering (controlled)

Only key moments are layered:
- **movement** (whoosh at the peak-velocity anchor, ending into the contact),
- **build** (a riser/swell whose **end** lands exactly on the reveal; a tease build leads into the reveal it precedes),
- **impact** (on contact),
- **detail** (a shimmer / glass accent on brand or product moments for luxury, cinematic and playful personalities).

## 8. Sync

`atSec = anchor − file peak time` using the measured peak of the chosen file; builds align their end. A file that would have to start before 0 s is replaced by a variant that can peak in time (or the cue is dropped). `syncErrorMaxMs` is reported per film (0 ms in the acceptance films; QC warns above 80 ms).

## 9. Mix and music coordination

Loudness-normalised per file (RMS), importance and impact strength scale the level, voice ducking as above. With music (user music or the procedural soundtrack), impacts and singles that coincide with a **downbeat or a soundtrack hit** are lowered (×0.7) so the SFX support the music instead of doubling it.

## 10. Outputs and QC

- `video.json → audio.sfx.cues` (what the renderer plays), `audio.sfx.personality`
- `sound-plan.json` (personality, variation, report, cues, events with anchors)
- `audio-qc.json` (stats + findings), `workspace/.sound/sfx-history.json`

Audio QC (produce's sound stage, merged into the final report as the `audio` pass): `SFX_REPEAT_CONSECUTIVE` (error), `SFX_REPEAT_OVERUSED`, `SFX_DENSITY`, `SFX_SYNC`, `SFX_VOICE_CLASH`, `SFX_KEY_SILENT` (logo / hero / price / CTA / final counter with no sound), `SFX_DOUBLES_MUSIC`, `AUDIO_EMPTY`; final QC still measures clipping and loudness on the MP4. Safe repairs: re-plan with another variation, thin the density, lower SFX — up to 3 rounds.

Explicit per-scene SFX arrays (`"sfx": [{ "sound", "at", "volume" }]`) are the user's choice and are kept verbatim; `"sfx": "none"` silences a scene.
