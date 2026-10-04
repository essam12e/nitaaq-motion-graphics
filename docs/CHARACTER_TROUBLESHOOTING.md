# Character Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `character file not found` | path in `brief.character` is wrong (paths are relative to the brief) | fix the path |
| `automatic sheet detection found 1 figure(s) … single-pose mode` | figures touch each other, or the background is busy | add `character.crops` (x, y, width, height in sheet pixels, reading order), or export the poses as separate PNGs |
| a pose is classified wrongly | no label, ambiguous silhouette | label it (`poses[].label`, `sheetLabels`) or name the file («character-pointing.png»); the label wins and the conflict is reported |
| `<pose>: low-confidence anchors` | unusual proportions / cropped art | props go on a foreground card instead of the hand; correct with `character.anchors` |
| `colours differ from <pose>` | one pose has a different outfit or colour grade | check it is the same character; otherwise remove that pose |
| the SVG character does not move its arms | layers not named / grouped | name the groups (see CHARACTER_RIGGING.md); without parts it runs in grouped mode (moves as one) |
| an arm bends the wrong way | a wrong pivot | add `data-pivot="x,y"` to that group |
| «شوف هنا» but the character does not point | single image or no pointing pose | expected: the engine never invents a gesture; add a pointing pose or a layered SVG |
| the character is small next to the phone / chart | shared frame by design (graphic layouts are a separate size group) | use `camera: "medium-close"` on that beat or let the phone carry the shot |
| text over the face (`CHARACTER_TEXT_ON_FACE`) | very long line in a tight shot | shorten the line; the repair loop shrinks the layout once |
| mirrored pose looks wrong (logo / text on clothes flipped) | art is asymmetric | the analyser restricts mirroring for asymmetric art; add a pose facing the other way |
| the second film still re-analyses | the art bytes or labels changed, or the engine version changed | expected; otherwise check `NITAAQ_CACHE` points to the same folder |
| talking level 3 requested | phoneme lip sync needs mouth shapes per phoneme + alignment | level 2 (voice-energy mouth) is used and reported |

Logs: the `[CHARACTER]` stage line shows source, pose count, complexity, cache (hit / miss) and the state → pose of every shot. Details: `character_direction.md`, `character_plan.json`, and the package's `CHARACTER_BIBLE.md`.
