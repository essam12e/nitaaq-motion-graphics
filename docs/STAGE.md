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

## 8. Probes → Critic → Repair

- `dom_motion.json`: per element visible / moving seconds, travel, scale; per camera move its
  effect on the target; word reactions; frame and subject occupancy per shot; still runs;
  text collisions.
- `critic.json`: ten scores /10 (motionQuality, composition, camera, transitions, typography,
  audioSync, visualStorytelling, commercialQuality, continuity, frameUtilization), issues
  (POWERPOINT_FEELING, DEAD_HOLD, TINY_SUBJECT, CAMERA_OVERUSE, CAMERA_NO_VISIBLE_EFFECT,
  DISCONNECTED_SHOTS, TEXT_COLLISION, CTA_WEAKNESS, …) and a verdict accept / repair / reject.
  Camera overuse is judged against the direction budget, not a fixed number.
- Repair (`repair_log.json`, `shots.repair{n}.json`): rules edit framing, size, camera, sustain or
  timing (never copy); only the affected frames re-render (frame range + splice). A timing change
  re-renders the whole film.
