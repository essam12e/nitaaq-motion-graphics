# Stage Mode (P1): one world, directed

Fast Mode and P0 Full Director Mode build a film as a row of scenes. **Stage Mode** builds one
world: elements are declared once, live across shots by id, and the camera, transitions and
choreography act on those elements. Enable it by writing `stage` in `shots.json` with
`sceneFamily: "stage-shot"` shots, plus a `direction.json` (required).

```bash
npx tsx cli/nitaaq.ts direct brief.json --shots shots.json --direction direction.json --project out/
npx tsx cli/nitaaq.ts produce out/          # animatic → probes → critic → repair (≤2 passes) → final
npx tsx cli/stage-probes.ts out/            # DOM probes only → dom_motion.json
npx tsx cli/whisper-check.ts voice.wav --script "…" [--truth words.json]   # local Whisper check
```

`VideoSpec.model` is `legacy | principled | stage`. Legacy specs and P0 scripts are unchanged.

## 1. direction.json first

Written **before** the shot script: visual / motion / camera / typography / transition languages,
composition rules, depth, colour, pacing, **metaphors** (`{id, line, show}`: how a line is shown,
not just typed), **style frames** (`{shot, at: "settle"|sec, note}`) and do / dont.
The compiler checks what is checkable: camera moves outside `camera.allowed`, the camera
budget (`maxMovingShare` + reason), transitions in `avoid`, metaphors never used, style-frame
shots that do not exist.

## 2. Stage elements (`stage.elements`)

Kinds: text · image (asset: logo / product / screenshot — never altered) · ui · card · chip ·
shape · line · number · button · cursor · icon. Optional `layer` (fg / mg / hero / bg), `parent`,
`size {w, aspect}`, `text` + `highlight`, `value` (number: must appear in the copy — never invented).
An element appearing in consecutive shots **persists**: it is not re-created, it moves to its new
place (handoff).

## 3. Shots

Each shot: `purpose`, `message`, `subject`, `shotSize`, `cast[]` (`{id, role: hero|secondary|support|background, at?, w?, enter?, exit?, sustain?}`),
`motionChain[]` (each with `reason`), `camera` + `cameraTarget` + `cameraReason` + `cameraEffect`,
`framing {start,end}`, `transitionOut` + `transitionReason`, optional `hold {intentional, reason, maxSec}`.

**Causality.** An action can start `at` a time, a word (`"word:عشرين"`), or `after` another action
(`"g1.peak"`, `"count.end"`, `"path.start"`). Actions: enter · emphasis · sustain · exit · move ·
transform · impact · draw · count · morph · press · reveal · attract · push. `press` on a button
also presses every cursor of the shot; `attract` pulls an element into another; `push` passes energy
down a row.

**Composition** is judged per shot size and subject: the hero gets the share its shot size calls
for, text reflows (taller, never broken mid-word; Arabic joins kept), and the safe area holds.

## 4. Camera (global, 2.5D)

One camera across the film (no reset per shot). Every move has a target, a reason and an
expected effect; the far background plane moves less than the hero plane (real parallax, no 3D
library). Budget: `direction.camera.budget.maxMovingShare`. DOM probes measure each move's
effect **on its target** (scale / shift on screen); a move that barely changes its target is
`CAMERA_NO_VISIBLE_EFFECT`.

## 5. Object transitions

`shared` (same element continues) · `morph` (shape → shape) · `expand-to-background` (an element
grows into the next world; text on it switches ink for contrast) · `text-mask` (the next shot seen
through the words) · `follow-path` · `push-inside` · `depth-pass` (camera passes through a plane) ·
`shape-transform` (card → button …). Each is validated (both elements exist, on stage at the cut);
an impossible one falls back to a cut and the fallback is listed in `stage_report.json`.

## 6. Voice

`voice_map.json` is the primary timing source (script + silences + energy). Whisper is optional and
**not trusted by default**: run `cli/whisper-check.ts` locally (models `small`, `large-v3`) against the
script (and hand-marked times if you have them) before relying on it for a voice. Nothing is uploaded.

## 7. Ending + CTA

The CTA comes from the brief only (never fabricated); a stage film without one fails unless the
script gives `ctaOverride` with a reason. Ending: motion resolves → brand settles → CTA readable →
short hold (`hold.maxSec`, default 1.6 s) → end. `END_HOLD_LONG` if the hold overruns.

## 8. Probes → Critic → Re-Director → Repair (P2)

- `dom_motion.json`: per element visible / moving seconds, travel, scale; per camera move its
  effect on the target; word reactions; frame and subject occupancy per shot; still runs;
  collisions with a class (critical / text-obstruction / subject-obstruction / decorative-collision /
  safe-overlap / intentional).
- `critic.json` v2 has two layers. **technical** (pass/fail checks: text in frame, collisions,
  transitions resolved, ending hold …) never raises a visual score. **visual**: 14 dimensions /10, each
  with a band (weak < 4 ≤ acceptable < 6 ≤ good < 7.5 ≤ professional < 9 ≤ exceptional), a basis
  (measured / heuristic / judgment / n/a) and evidence. Automatic evidence is capped at 9.0; above it
  only with a `judgment` passed in. The overall is held to ≤ weakest dimension + 3 and ≤ weakest shot + 2.5.
  Shots are judged at their settle frame in context (subject type × shot size): frame utilisation,
  seen hierarchy (first / second / third read from DOM dominance, not metadata), composition,
  typography, cleanliness. Rows of equal small objects, thumbnails under a headline, items covering
  each other (`ITEMS_OVERLAP`) and cast elements out of a still frame (`ELEMENT_OFF_FRAME`) are flagged.
- `transition_quality.json` + `qc/transitions/*.png`: frames before / through / after each cut, pixel
  occupancy curve; `EMPTY_TRANSITION_FRAME`, `VISUAL_VOID`, `FLASH_FRAME`, `OVERLAP_TRANSITION`,
  `UNREADABLE_MORPH`, `BROKEN_CONTINUITY`.
- **Style-frame gate** (`style_frame_gate.json`, before the animatic): settle frames judged on
  composition only (accept ≥ 5.5, reject < 3.5); failing shots are re-composed (never camera / timing
  here); a re-direction that makes its own frame worse is undone for that shot.
- **Re-Director** (`src/stage/redirector.ts`): diagnoses a weak shot (row of equals, weak subject,
  too much space …) and predicts candidate organisations (strategy × subject × shot size) with the
  critic's own curves. Strategies: centered, hero-focus, asymmetric-split, split, stack, card-cascade,
  spatial-cluster, focus-sequence, center-stage, full-frame-typography, ui-zoom, timeline-flow, radial,
  cta-lockup (generic: any row of objects).
- **Repair planner** (`repair_plan.passN.json`): candidates per issue with cost (low / medium / high /
  very-high), predicted gain, risk and intent changes; cheaper repairs first; disabling the camera is
  the very-high last resort and must declare the lost intent. Memory (`repair_memory.json`) never
  retries a failed repair; side effects (new issues, dropped dimensions) are recorded.
- **Loop V2** (`repair_log.json` v2): 2 passes (a 3rd only when both improved); stops on regression,
  no improvement or issue churn; the best pass is restored. Only affected frames re-render.
- **redirection.json** (the same document Claude or a human writes): `nitaaq redirect request <project>`
  writes `redirection_request.json` (critic, diagnosis, capabilities, JSON schema, previous attempts);
  `nitaaq redirect apply <project> <redirection.json>` validates, maps or rejects each ask with a reason,
  and re-directs. It changes organisation only (strategy, size, subject, roles, placement, depth, motion,
  camera, transition hold, timing) — never copy, logos, screenshots or new libraries.
- Ablations: `NITAAQ_NO_GATE=1`, `NITAAQ_NO_REDIRECTOR=1`, `NITAAQ_NO_REPAIR=1`, `NITAAQ_NO_CRITIC=1`.
