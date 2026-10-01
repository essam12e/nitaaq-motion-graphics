# Motion system

Motion in NITAAQ is planned at film level, then executed per element with physics presets. Every move must have a job; motion without a job is removed.

## 1. AI Creative Director (`src/director/creative.ts`)

Runs after the storyboard and writes its decisions to `motion_spec.json` and `shotlist.json`:

- **One motion personality** for the whole film: explicit `brief.motion` → tone words → style → reference motion energy.
- **A motion job per scene** from its story beat (`hook → stop-the-scroll`, `demo → show-how-it-works / connect-states`, `data → make-the-number-land`, `cta → resolve / direct-action`, …).
- **One hero moment**: the strongest product/solution/brand/demo/offer beat in the middle of the film (never the first or last scene).
- **Escalation curve**: hook 0.8 → build → hero 1.0 → CTA 0.7 (the CTA resolves, it does not shout).
- **Camera budget**: at most `ceil(scenes × activity × 0.6)` camera moves, given to hero, hook and CTA first; scenes marked strict-safe-area never move the camera.
- **Transitions** are chosen by meaning by the Transition Engine (`TRANSITIONS.md`): relationship of the two scenes first, a flashy budget, never the same non-cut type back-to-back.
- **Beat sync** (music, no voice): cut points snap to the nearest beat or downbeat within ±0.18 s when the previous scene can absorb the change (never below its minimum duration). Voice-led films follow the voice, never the beat.
- Deterministic: all choices use a seeded RNG. Same brief + seed = same film.

## 2. Personalities (`src/motion/personality.ts`)

| Personality | Feel | Stagger | Max overshoot | Camera activity / moves | Transitions |
|---|---|---|---|---|---|
| premium | controlled, heavy, deliberate | 0.12 s | 1 % | 0.45 · push, drift | crossfade, light-sweep, blur, wipe |
| energetic | fast, punchy, strong impacts | 0.05 s | 12 % | 0.55 · push, pans | push, zoom-in, speed-ramp, slide |
| playful | springs and bounce | 0.06 s | 35 % | 0.40 · drift, push | zoom-in, push, iris, color-sweep |
| corporate | restrained, precise | 0.08 s | 2 % | 0.20 · drift | push, crossfade, wipe |
| cinematic | depth, camera, reveals | 0.12 s | 2 % | 0.75 · push, pull, drift, rise | crossfade, light-sweep, blur, zoom-out |
| tech | precise, UI-aware micro-interactions | 0.05 s | 6 % | 0.40 · push, drift | mask-wipe, push, zoom-in, crossfade |
| sport | aggressive, impact-based | 0.04 s | 14 % | 0.70 · push, pans | speed-ramp, push, wipe, cut |

## 3. Physics library (`src/motion/physics.ts`)

Twelve presets, measured (overshoot and settle frames at 30 fps are computed, and unit-tested):

| Preset | Drive | stiffness/damping/mass | Overshoot | Settle (frames) | Use |
|---|---|---|---|---|---|
| snappy | spring | 260/26/0.7 | 0 % | 10 | UI and punchy type |
| responsive | spring | 320/30/0.6 | 0 % | 9 | buttons, toggles, cursors |
| soft | curve | 120/24/1 | 0 % | 16 | body copy, secondary info |
| heavy | spring | 110/22/1.6 | 1 % | 16 | dashboards, devices, big panels |
| premium | curve | 90/26/1.3 | 0 % | 22 | luxury reveals |
| playful | spring | 180/11/0.8 | 20 % | 18 | icons, stickers |
| elastic | spring | 140/9/0.8 | 23 % | 26 | pops and badges (sparingly) |
| cinematic | curve | 70/20/1.4 | 0 % | 38 | camera, atmosphere |
| mechanical | curve | 400/40/0.5 | 0 % | 11 | data, tickers |
| sport | spring | 380/18/0.6 | 9 % | 8 | sports and hype |
| corporate | curve | 150/28/1 | 0 % | — | institutional, measured ease-out |
| tech | spring | 300/30/0.7 | 2 % | — | product UI and SaaS, crisp |

Default per element type: button/cursor → responsive · card/icon/notification/hero-title → snappy · text/body → soft · panel/dashboard/device/product → heavy · logo → premium · chart/number → mechanical · camera/background → cinematic. Each personality overrides some of these (e.g. premium makes buttons and icons `soft`; sport makes cards and numbers `sport`).

## 3b. Animation Principles Engine (`src/motion/principles.ts`)

One function, `motionProfile(personality, element, areaFraction)`, decides **how** a thing moves from **what** it is, how big/heavy it looks, and the film's personality. Every scene that animates an element asks it rather than hard-coding easing.

- **Apparent mass** (feather → light → medium → heavy → massive) from the element kind and its on-screen area; heavier = longer (`timeScale` 0.75 → 1.35).
- **Anticipation**: a small counter-move before expressive moves (6–10 % of travel for bouncy personalities, 3 % tech); never on buttons, cursors, charts, numbers, or under premium / corporate / cinematic.
- **Overshoot** bounded by the personality's budget ∩ the preset.
- **Follow-through** (`followThrough`): children lag and settle after their parent; **secondary motion** (`secondaryMotion`): shadows/labels/glows react slightly later.
- **Arcs** (`arcPoint`): organic objects (product, icon, logo, card, notification) travel on arcs; UI travels straight.
- **Squash & stretch** (`squashStretch`): volume-preserving, only for light objects in playful (and slightly in sport) films — never on logos or titles.
- **Sound anchors** (`anchorsOf` / `profileAnchors`): the same motion curve yields `start`, `peak` (peak velocity), `contact`, `settle`, `completion` — the Sound Director syncs to these (`SOUND_DIRECTOR.md`), not to scene start.

The profile's `why` string is written to `motion_spec.json`, so every move documents its reason.

## 4. State-based motion and shared elements

`state-flow` (alias `shared-element`, `journey`) moves one element through the product journey (logo → search → result → product → cart → checkout → success): the same surface morphs size, radius and content between states instead of cutting between unrelated cards. `form-fill`, `workflow`, `order-success`, `browser-scene` and `landing-page` are also state-driven (empty → typed → submitted → done). Across scenes, the same logo / product / screenshot is carried by a measured **shared-element transition** (`TRANSITIONS.md`).

## 5. Seamless loop

`brief.loop: true` → `timeline.seamlessLoop`: the last scene returns to the opening frame state; final QC compares first and last frames (`LOOP_SEAM` if the 64×64 grey difference is above 14).

## 6. QC checks on motion

`HOLD_TOO_SHORT`, `VOICE_DRIFT`, `MOTION_NO_PURPOSE`, `CAMERA_OVERUSE` (> 70 % of scenes), `TRANSITION_MONOTONY`, `TRANSITION_REPEAT`, `TEXT_MOTION_REPEAT`, `TEXT_MOTION_OVERUSED`, `PERSONALITY_MISMATCH`. See `QUALITY.md`.
