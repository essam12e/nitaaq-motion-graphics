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

## Transition Intelligence 2.0 (`src/transitions/continuity.ts`)

Reads how scene A ends and scene B begins and upgrades a plain cut to a continuity device when one exists: A's subject shape becomes B's frame (morph / shape-match), both scenes share a colour (color-match), A ends on a lateral camera move (camera-match), A's subject travels toward the next idea (motion-match), B is the hero reveal (zoom-through / liquid). It never overrides a shared-element transition, a beat cut, or the rhythm floor of energetic films, and rations itself to ≤ 40% of cuts. Each upgrade states its reason in `transition.reason` and carries its hints (focus, rect, shape, colour). Continuity transitions get silent or soft sound.

## Spatial transitions (Premium Phase 6)

Eight transitions extend the same engine (`src/transitions/advanced.ts`, same `TransitionFrame` contract, same overlay layer):

| Id | What happens |
|---|---|
| `card-push-through` | the camera pushes into a card of the outgoing scene (`rect`); the card is a window onto the next scene that grows to the frame |
| `video-match-cut` | a video frame of A becomes the video frame of B (rect → full frame) with a short exposure match |
| `foreground-card-wipe` | a card passes in front of the lens; the cut happens behind it (complementary clips — no doubled frame) |
| `glass-wipe` | a pane of frosted glass slides across; the next scene is already behind it |
| `scale-match` | the matched element (`rect` → `toRect`) carries the scale change across the cut |
| `z-depth-pass` | A flies past the lens toward `focus` while B arrives from depth |
| `directional-blur` | a whip along the motion `vector` with a directional SVG blur on both scenes |
| `focus-handoff` | a rack focus across the cut: A blurs out, B racks in, the two barely overlap |

**Motion Continuity vectors.** A scene edge may carry a `MotionVector` (direction, speed, depth, energy). `continuityScore(out, into, transition)` scores a cut 0..1 (still → still = 0.75; continuity transitions bridge +0.15). `refineContinuity` picks the spatial transitions first (video → video = match cut, matched rects = scale match, forward depth = push-through / z-depth, fast lateral = directional blur, depth of field = focus handoff, glass = glass wipe) — only the spatial / video families declare these edges, so every other film is chosen exactly as before.
