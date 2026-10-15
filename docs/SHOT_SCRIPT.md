# Shot Script — Full Director Mode

The automatic director (Fast Mode) plans a film from a brief with seeded choices. In **Full Director
Mode** you (Claude) direct it shot by shot in `shots.json`; the engine renders what you decided.

```
shots.json → validation → shot compiler → existing VideoSpec → structural QC → animatic (½ size, 15 fps)
          → motion metrics → motion review → final render → final QC + motion metrics
```

```bash
npx tsx cli/nitaaq.ts create brief.json --shots shots.json
npx tsx cli/nitaaq.ts direct brief.json --shots shots.json --project <dir>   # plan only
```

The brief still supplies brand, assets, audio and copy. The script supplies the direction.

## Rules

- **A reason for every decision.** A camera move without `cameraReason`, a transition without
  `transitionReason`, or a motion-chain event without `reason` is a validation error.
- **Every shot but the last has a `transitionOut`.** A hard cut is a decision too (`"cut"`).
- **The script wins.** In Full Director Mode no random choice overrides a camera move,
  transition, typography family, variant or timing the script specifies. What the script leaves
  out is filled deterministically by the engine and listed in `shot_compile_report.json`
  (`decisions[].source = script | engine | mapped | fallback | voice`).
- **Nothing is dropped silently.** An unknown camera move or transition maps to the nearest one
  that exists; an unknown variant falls back to the family's variant for this aspect; anything the
  engine cannot do yet is recorded as a warning.
- **Better directed, not more.** Sustain motion is for things that should feel alive; text that
  has to be read stays settled. Declare a deliberate still frame with `hold` instead of filling it.

## Shot fields

| field | meaning |
|---|---|
| `id` | lowercase id (`hook`, `demo`, …) |
| `purpose` | narrative job: hook, problem, solution, demo, feature, process, proof, offer, brand, cta, … |
| `message` | the one thing the viewer must take from the shot |
| `voiceAnchor` | `{ text }`: the words spoken during this shot (found in the voice map), or `{ start, end }` film seconds |
| `timing` | `{ duration, minHold }`; required when there is no voice anchor. With a voice, the voice wins |
| `subject` | what the eye should land on |
| `shotSize` | wide · medium · close · extreme-close · insert (needs `cameraTarget` to frame) |
| `composition` | free text, recorded |
| `sceneFamily`, `variant` | an existing scene family (`npx tsx cli/nitaaq.ts scenes`) |
| `elements` | the family's content (its own schema); omitted → built from the brief by the family's recipe |
| `motionIntent` | why things move in this shot |
| `motionChain[]` | `{ element, action: enter/emphasis/sustain/exit, at, style, direction, velocity, reason }` |
| `camera` | `"static"`, a move/preset name, or `{ move, amplitude, startAt, endAt, ease, accents }` |
| `cameraTarget`, `cameraReason` | the element the camera serves (headline, logo, screenshot, a word …) and why it moves |
| `typography` | `{ headline, support, cta, label }` text motion families |
| `emphasisWords` | words to accent; with a voice they pulse when spoken |
| `transitionOut`, `transitionTarget`, `transitionReason` | the cut, the next shot's id, and why |
| `audioCues` | recorded; the Sound Director still places cues (cue authoring is P1) |
| `continuity` | recorded (element persistence across shots is P1) |
| `expectedEnergy` | 0..1 → scene intensity |
| `hold` | `{ reason, maxSec }`: a deliberate still hold (Motion Metrics counts it as intentional up to `maxSec`) |

Times inside a shot (`at`, `startAt`, `endAt`, `accents`) are scene-local seconds or a spoken word:
`"word:منصة"`.

## What each decision becomes

| script | engine |
|---|---|
| camera move / preset | `motion.cameraPlan` (move, amplitude, start/end, ease, accents, reason) |
| `cameraTarget` + `shotSize` | measured with DOM probes on the settled frame → camera `focus`; medium/close sizes add a solver framing (`camera_targets.json`) |
| transition | `transition` (type, duration, reason); `shared` → `scale-match` (P1: measured persistence) |
| typography | `motion.text` |
| motion chain sustain / exit / hold | `motion.lifecycle` (principled model) |
| emphasis words | `motion.lifecycle.emphasis` (voice-timed when found) + the copy's `highlight` (only words that occur in it) |
| voice anchors | shot durations: the next shot is on screen 0.12 s before its words begin |
| voice emphasis | scene accents (voice first); music downbeats stay as secondary micro accents |

Full Director Mode also sets `motion.model = "principled"` (anticipation → entrance → settle →
sustain → exit/handoff in the shared components) and `metadata.director.mode = "full"`. Fast Mode
keeps the legacy motion model, so older projects render exactly as before.

## Not in P0

Stage composition (per-element entrance timing), element persistence / global camera, object
morphs, a rebuilt transition set, audio cue authoring and a full motion critic are later phases.
The compiler records these requests as warnings instead of pretending.
