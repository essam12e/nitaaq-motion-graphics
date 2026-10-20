# Motion Art Director (P4): render, measure, compare, choose

P4 sits after the Film Director (P3) pre-pass and before the animatic. For every shot it asks *what is the main
visual action of this shot?* and whether the shot performs it (a visual event) or only plays a template (things
appearing on a clock). Each answer it does not like becomes a problem with 2–4 candidate solutions; the candidates
are rendered for the problem's range only, measured on the pixels and the DOM, and the kept version wins unless a
candidate beats it by a margin. It is on by default for stage films with a film plan.

`NITAAQ_NO_ART_DIRECTOR=1` = P3 exactly (same `stage.json`).

## The loop

```
detect → diagnose → 2–4 candidates → cheap filter (predicted) → preview render (half resolution, the
problem's range) → measure → judge (veto on any technical failure) → select (beat the kept version by 0.35)
```

- The prediction only filters. It is often optimistic (white-card worlds especially): a candidate predicted 8.54
  rendered an empty frame and was rejected. Never accept a candidate on its prediction.
- The kept version is measured the same way and always takes part. If nothing beats it, nothing changes.
- Vetoes: `TEXT_CLASH`, `OFF_CANVAS`, `EMPTY_FRAME`, `ELEMENT_FLOODS_FRAME`, `DROPPED` (client information
  missing at the end of its shot). A veto ends a candidate whatever its other numbers.
- Budget: 3 candidates per problem, 6 local problems, 2 sequence, 1 global (reserved: it runs even when local
  problems remain), 1400 preview frames. Order: hook and CTA first, then climax, subjects, focus, camera-free,
  choreography, boundaries, global.
- If the art pass makes the film fail a technical check, the P3 film is restored (`art_fallback.json`).
  `NITAAQ_NO_ART_FALLBACK=1` disables that.

## Builders (candidate sources)

| Problem | Builders |
|---|---|
| weak hook | slam (the hero lands, the others answer), scatter (items land, the hero lands on them), collision. Never glow / blur / particles. |
| weak climax | strike-and-answer, domino, push-out: a causal interaction between elements, never a scale-up or a camera move |
| weak payoff (CTA) | the motif circle `become`s the button; the last card becomes a circle then the button; circle-beat-becomes |
| information overload | progressive disclosure, relay, all-then-focus (the newest is focus, the others dim to 40%, all return to full presence before the cut: nothing is removed) |
| a row of small subjects (steps) | one-at-a-time, born-on-path, progressive hero, stack-and-expand, card-to-full-frame |
| the camera carries a shot | the camera-free equivalent: the element does what the camera did |
| flat choreography | cascade, land-and-react, gather, relay |
| repetitive film (global) | keep the camera habit only at the opening and the payoff, alternate entrances, redistribute durations by energy (never on a voice film) |

## Script additions (compiler)

- `become` (`element` → `to`): the only new motion primitive. A travels to B, takes B's outline and size, and
  hands over to B at the instant it arrives. Cost: compile-time only. A user asset (image, screenshot, UI) is
  never reshaped: it dissolves into B in place (`BECOME_FALLBACK`).
- `focus` / `release`, `settle`, `respond`, and `after: "<event id>.start|peak|end"` to chain an event on another.
- `motionLanguage` (`premium-saas`, `playful`, `editorial`, `energetic-tech`, or set with `NITAAQ_MOTION_LANGUAGE`):
  springs, travel, tilt and the default entrance per element kind.
- Per-shot `phrase` (`punch`, `snap`, `build`, `glide`, `settle`): tempo, bounce, stagger and its acceleration.
- Arabic text always enters as a whole (rise or a mask in the reading direction). Never letter by letter.

## Outputs

| File | What it says |
|---|---|
| `art_director.json` | the intent of every shot, key visuals, problems and their candidates |
| `candidate_tournament.json` | every candidate: predicted, preview-measured, status and why |
| `art_memory.json` | why a candidate failed, keyed by problem signature (not rendered again) |
| `art_gate.json` | the Art Director Gate before and after: 16 codes, 4 blocking (`WEAK_VISUAL_IDEA`, `NO_KEY_VISUAL`, `WEAK_PAYOFF_EXECUTION`, `OVER_ANIMATED`) |
| `choreography_graph.json` | why each thing moves (17 edge types) |
| `contributions.json`, `density_timeline.json`, `motion_paths.json`, `composition_phases.json` | element vs camera, motion clutter / voids, paths crossing text, phases inside each shot |
| `energy_report.json`, `rhythm_compose.json`, `focus_timeline.json` | energy wanted vs measured, internal gaps, who is in focus every 0.1 s |
| `motion_language.json`, `motion_character.json`, `typography_motion.json`, `audio_sync.json` | the brand's way of moving, the phrases compiled, text entrances, SFX only on cause / impact / transform / hand-over / resolution |

Keep the four kinds of evidence apart when reporting: predicted, preview-measured, final-measured, and your own
judgment. Never use judgment to override a technical failure.

## Ablations

`NITAAQ_NO_CHOREOGRAPHY`, `NITAAQ_NO_KEY_VISUAL`, `NITAAQ_NO_CROSS_TRANSFORM`, `NITAAQ_NO_CANDIDATE_RENDER`,
`NITAAQ_NO_ENERGY_BUILDER`, `NITAAQ_NO_INFO_FOCUS`, `NITAAQ_NO_PHRASE_V2`, `NITAAQ_NO_GLOBAL_V2`.

## Cost

Preview renders cost about 0.3 s per half-resolution frame. A 25 s SaaS film spends 6–7 minutes in the art pass
(about 1.7× the P3 production time). The final render time is unchanged.
