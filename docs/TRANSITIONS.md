# Scene Transition Engine & Shared Elements

Code: `src/transitions/presentations.ts` (TransitionRegistry, 30 presentations), `src/transitions/engine.ts` (`chooseTransitions`), `src/node/shared-rects.ts`, `src/engine/VideoComposition.tsx` (`SharedLayer`).

## Registry

Every transition declares what it **means** (continuity, reveal, energy, calm, contrast, space, ui, brand, time), its energy, and its visual **peak** (0..1 of the window — the Sound Director syncs the transition sound there).

`cut, none, crossfade, fade, slide, push, wipe, mask-wipe, zoom-in, zoom-out, blur, iris, light-sweep, speed-ramp, flip, color-sweep, match-cut, shared, morph, camera-push, camera-pull, whip, depth, shape, text-sweep, object-sweep, color-dip, perspective, page, split`

## How a transition is chosen

`chooseTransitions()` looks at each cut, in order:

1. **Relationship of the two scenes**, first match wins: same identity asset on both sides → `shared`; a cut on a musical beat in a rhythmic film → hard cut; into the hero / a reveal → the personality's reveal family (premium: light-sweep / camera-push / morph …); problem → solution, bridge, tease → the personality's contrast family; montage → mostly hard cuts (whip / speed-ramp sometimes); UI → UI → `page` / `push` / `match-cut`; same kind of content → mostly hard cuts; into the CTA → calm arrival (a cut after an energetic run); product reveal in energetic/playful/sport films → `object-sweep`; kinetic/launch films → one `text-sweep` carried by the next word; otherwise the personality's calm family or a cut.
2. **Meaning first, decoration never** — a cut on a musical beat is a hard cut; same-kind content cuts hard most of the time; "nothing to express" is a hard cut. A **flashy budget** (25 % of cuts for premium/corporate, 40 % otherwise) turns extra flashy picks into cuts, and rhythmic (energetic / launch / music) films keep at least 25 % hard cuts.
3. **Variety** — any one non-cut type is capped at a third of the cuts and is never used back-to-back.
4. **Style family** — the style preset's preferred transitions break ties inside a meaning.

The choice and its reason are written into `video.json` (`scenes[i].transition.reason`) and `shotlist.json`.

Motion QC: `TRANSITION_REPEAT` (back-to-back), `TRANSITION_MONOTONY` (> 50 % of cuts one type).

## Shared-element transitions

When two consecutive scenes show the same logo / product / phone / browser screenshot, the director plans a `shared` transition (`timeline.shared[]`). Before rendering, `produce` measures the asset with the DOM probe — where it really sits in the outgoing scene at the first frame of the transition and in the incoming scene at its last frame — and stores `fromRect` / `toRect`. During the window the film-level `SharedLayer` draws **one** copy that glides on an arc (products) or a straight path (UI/logos) with heavy physics and **uniform** size interpolation (`object-fit: contain`, never stretched), while both scenes hide their own copy (`useSharedHidden`). Pairs that cannot be measured (the asset is off-screen at one edge) keep a normal transition — nothing is guessed. Measurements are cached like QC probes.

Supported kinds in the schema: logo, product, phone, browser, card, text, shape, icon, chart, screenshot (identity media is what is measured today; text/shape continuity is done inside state-driven scenes such as `state-flow`).
