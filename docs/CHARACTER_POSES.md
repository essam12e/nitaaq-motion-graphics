# Poses and the Pose Library

## Recommended character sheet (a recommendation, not a requirement)

8–12 useful states, full body, same scale, same outfit, on a plain or transparent background, with some space between figures:

1. Neutral · 2. Happy · 3. Surprised · 4. Confused · 5. Thinking · 6. Talking · 7. Pointing · 8. Presenting · 9. Holding phone · 10. Looking at phone · 11. Excited · 12. Listening

Labels under each figure («محتار»، "pointing") help; `sheetLabels` in reading order also works. Fewer poses still work — the Director substitutes (below).

## Extraction (sheet)

`detectSheet()` (local, sharp): background colour from the border → flood-fill matte → connected components → figure regions (text labels and small marks are ignored) → reading-order sort → crop + trim each figure. If detection is unsure it does **not** guess: it falls back to `crops` (manual crop manifest) or single-pose mode and says so in the warnings.

## Classification

Each pose gets `semantics.state` with a confidence and evidence from:

1. its label / file name (Arabic + English words: «يشير»، "pointing", «جوال», "phone" …), and
2. its silhouette (arm reach and height per side, symmetry, hand near face, a dark rectangular prop near a hand, facing).

Conflicts between label and silhouette are reported (`<pose>: label says X, silhouette suggests Y`). States: neutral, idle, thinking, confused, surprised, happy, excited, talking, listening, pointing, presenting, holding_phone, looking_phone, typing, celebrating, explaining, warning, questioning.

## Missing-pose strategy (`choosePose`)

1. the exact state exists → use it (mirror it toward the text when allowed)
2. a rig can perform it safely → rig pose
3. another state communicates the same intent → substitute (e.g. pointing → presenting → explaining)
4. composition hides the limit → closest valid pose + tighter shot + a graphic (thought bubble, «؟», «!», a phone card)
5. only then → ask for more artwork (`needsArt` in `character_plan.json` and the direction notes)

The character is never deformed, re-drawn or stretched to fake a pose.

## Single PNG (level D) — honest limits

Possible: camera framing (wide → close), push / pull / drift, 2.5D parallax, breathing, subtle sway, entrance / exit, overlays, speech bubbles, typography beside the character.
Not possible (and never faked): new arm gestures, expression changes, lip sync, turning around. A «شوف هنا» line with a single image keeps the character as drawn and puts the line beside it — no pointing layout, no invented arm.

## Pose library (`pose-library.json`)

`byState`, `byGesture`, `byProp`, `byExpression` → poseIds, plus `uses` per pose (establishing shot, reaction, CTA …). The Director reads it; you can read it to see what the art supports.
