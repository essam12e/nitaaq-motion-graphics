# Character Motion Engine

The character is an **actor**, not decoration. For every shot the engine answers: what does the character know, feel and do, where does it look, what should the audience look at, and what is the one gesture that matters. Then it combines **pose + expression + gesture + camera + typography + graphics + sound**. A strong pose with good camera direction beats unnecessary full-body animation.

Code: `src/character/` (pure: schema, director, actor, layout, rig, gestures, library, semantics, silhouette), `src/node/character/` (prepare / cache / package, sheet + PNG ingest, SVG → rig, film assembly, acting sheet), `src/scenes/character/` (5 scene families), `src/qc/character-qc.ts`. Module `character` (lazy; loaded only when the brief has `character`). Remotion stays the render engine.

## Pipeline

```
brief.character ─► INTAKE (sheet / PNG poses / layered SVG / single PNG / saved package)
  ─► CACHE LOOKUP  .cache/nitaaq-motion/characters/<hash>/   (hit → no re-analysis)
  ─► POSES (crop, matte, silhouette analysis, state + gesture + prop, anchors)
  ─► RIG (layered SVG only: parts, hierarchy, pivots, face states)
  ─► CHARACTER BIBLE + POSE LIBRARY + identity lock + contact sheet
  ─► SCRIPT ANALYSIS (content.characterScript, or derived from hook / problem / solution / cta)
  ─► CHARACTER DIRECTOR (intent per line → state machine phases, pose choice, shot size, camera, cut)
  ─► CHARACTER ACTOR (curves: anticipation, overshoot, overlap, secondary motion, idle, talk)
  ─► SCENE DIRECTOR (character-stage / phone / product / data / cta, RTL screen direction)
  ─► SOUND EVENTS (exact anchors from the Actor's own curves → Sound Director)
  ─► ANIMATIC + ACTING SHEET ─► CHARACTER QC ─► REPAIR ─► PRODUCTION RENDER ─► MP4
```

## Input levels

| Level | Brief | What you get | Ceiling |
|---|---|---|---|
| A — character sheet | `character.sheet` (+ optional `sheetLabels`, `crops`) | figures auto-detected, cropped, matted, classified (state, gesture, prop, facing) | POSE_BASED |
| B — PNG poses | `character.poses: [{ path, label? }]` | one pose per file; labels / file names / silhouette decide the state | POSE_BASED |
| C — layered SVG | `character.svg` | a rig (head, arms, face states, headwear) → 17 rig poses, real gestures | PARTIAL / FULL_VECTOR_RIG |
| D — single PNG | `character.image` | one pose; camera, framing, breathing, 2.5D, overlays — **no new gestures** | STATIC |
| saved | `character.use: "<name>"` | the package saved earlier with `saveAs` (no re-analysis) | as saved |

Everything runs locally. Nothing is uploaded (no remove-bg API, no cloud vision). No paid API is required.

## Character Director (intent) vs Character Actor (execution)

- **Director** (`director.ts`): `readLine()` reads each line (Arabic-aware cue lexicon, word boundaries with clitics): question → questioning, «وش الحل؟», «شوف هنا» → pointing, «وصلتني رسالة» → looking_phone, CTA → presenting, problem words → confused / worried, etc. An explicit `action` / `pose` / `scene` in the beat always wins. It then plans each shot: phases from the state machine `IDLE → NOTICE → THINK → REACT → TALK → PRESENT → RETURN_TO_IDLE`, the pose (missing-pose strategy, see CHARACTER_POSES.md), shot size (wide / medium / medium-close / close), camera move, mirroring (only when the art allows it), and the **cut** between poses.
- **Actor** (`actor.ts`): turns a shot into frames. Closed-form damped springs per personality, anticipation before the action, limb overshoot halved, overlapping action (lower arm 0.05 s, hand 0.09 s, head 0.07 s, headwear 0.12 s drag), headwear follow-through driven by head angular velocity, blinks (seeded), breathing, idle presets (casual, premium, energetic, thinking, listening), talking levels 0–3, landing squash, reaction pop. It also reports every event with **exact** anchors (start, peak, contact, settle, completion).

## Pose transitions — intentional, never morphing

| Cut | When | Rendered as |
|---|---|---|
| continuous | rig: same character, new pose → joints rotate through the motion | no cut |
| match-cut | similar silhouettes / same framing | `match-cut` 0.14 s |
| camera-assisted | shot size changes | `camera-push` 0.35 s |
| whip | big energy change (surprise, excitement) | `whip` 0.3 s |
| occlusion | a phone / card sweeps across the body | occlusion sweep in the scene |
| cut-on-action | PNG poses: cut at the gesture peak + settle | hard cut + settle |

## Scenes

| Family | Variants | Use |
|---|---|---|
| `character-stage` | side, bubble, title | talk, react, think, point, present; kinetic typography (`title`) |
| `character-phone` | phone, chat | phone in hand, mock app screen, chat bubbles, typing |
| `character-product` | present | the user's product image at the hand anchor (never altered) |
| `character-data` | stat, bars | the user's number / series with its source (nothing invented) |
| `character-cta` | button, logo | final call to action |

Screen direction (RTL): landscape and 1:1 → character on the left looking at the text on the right; portrait / 4:5 → text above, character below. Kept for the whole film.

## User control phrases

Write them into the brief: «خلي الحركة بسيطة» → `character.motion: "subtle"`, «مبالغ فيها» → `"exaggerated"`, «لا تحرك الوجه» → `lockFace: true`, «بدون كلام» → `talk: 0`, «خلي الشخصية يمين» → `side: "right"`. Per beat: `action`, `emotion`, `pose`, `prop`, `camera`, `scene`, `messages`, `seconds`.

## Brief example

```json
{
  "request": "فيديو موشن بشخصية سعودية يشرح تطبيق توصيل",
  "language": "ar", "dialect": "saudi", "platform": "tiktok",
  "character": { "sheet": "abu-fahad-sheet.png", "name": "أبو فهد", "saveAs": "abu-fahad" },
  "content": {
    "characterScript": [
      { "line": "تعبت من الزحمة كل يوم؟" },
      { "line": "وش الحل؟" },
      { "line": "تطبيق مشوار يوصلك بسرعة", "scene": "phone" },
      { "line": "وصلتني رسالة من المندوب", "messages": ["المندوب عند الباب", "تمام، جاي"] },
      { "line": "شوف هنا كل شي واضح" },
      { "line": "حمّل التطبيق الآن", "scene": "cta" }
    ],
    "ui": { "appName": "مشوار", "headline": "وين تبي تروح؟", "items": ["البيت", "الدوام", "المطار"] },
    "cta": { "text": "حمّل التطبيق الآن", "button": "حمّل مجاناً" }
  }
}
```

No `characterScript`? The Director derives the beats from `hook`, `problem`, `solution`, `features`, `stats`, `cta`.

## Files written per project

`character/` (copy of the package: `character.json`, `CHARACTER_BIBLE.md`, `bible.json`, `pose-library.json`, `anchors.json`, `rig.json`, `poses-contact.png`), `character_plan.json` (every shot: intent, pose, match, camera, cut, phases), `character_direction.md` (readable direction notes), `qc/character-acting.png` (acting sheet, from `animatic`).

## CLI

```bash
npx tsx cli/nitaaq.ts character prepare <brief.json | sheet.png --as sheet | pose-folder | char.svg>   # package + bible + contact sheet
npx tsx cli/nitaaq.ts character inspect <package-dir>
npx tsx cli/nitaaq.ts character bench   <same inputs>     # cold vs warm preparation
npx tsx cli/nitaaq.ts animatic <projectDir>               # fast preview + qc/character-acting.png
npx tsx cli/nitaaq.ts character sheet <projectDir> [--video final.mp4]
npx tsx cli/test-characters.ts [--only a,f]               # acceptance tests A–J + benchmark
```

See also: CHARACTER_FORMAT.md · CHARACTER_POSES.md · CHARACTER_RIGGING.md · CHARACTER_QC.md · CHARACTER_PERFORMANCE.md · CHARACTER_TROUBLESHOOTING.md.
