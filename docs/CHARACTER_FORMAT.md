# Character Package Format (`nitaaq.character/1`)

A prepared character is a folder. It is portable (copy it to another machine, or point `character.use` at it) and is what the cache and the character library store.

```
<package>/
  character.json         manifest (written LAST — an interrupted run never looks complete)
  CHARACTER_BIBLE.md      human-readable bible (identity lock, poses, capabilities, behaviour)
  bible.json              the same, structured
  pose-library.json       byState / byGesture / byProp / byExpression indexes
  anchors.json            poseId → anchors (fractions of the pose image)
  anchors.override.json   manual anchor corrections (optional, survive re-analysis)
  rig.json                layered SVG rig (level C only)
  poses/<poseId>.png      transparent, trimmed pose images (PNG levels)
  thumbnails/<poseId>.png + thumbnails/contact.png   pose contact sheet
```

Where it lives:

- cache: `.cache/nitaaq-motion/characters/<hash>/` (or `$NITAAQ_CACHE/characters/…`). The hash covers the engine version (`ce-1.0.0`), the bytes of every source file, labels and crops — the same art is never analysed twice, changed art is never served stale.
- library: `<workspace>/characters/<name>/` when the brief says `"saveAs": "<name>"`; reuse with `"use": "<name>"` (or a folder path).

## `character.json` (manifest, abridged)

| field | meaning |
|---|---|
| `schema`, `engineVersion`, `characterId`, `name`, `sourceType` | identity of the package; `sourceType` ∈ sheet, poses, svg, single, package |
| `poses[]` | `poseId`, `file`, `source{asset, rect, label}`, `width`, `height`, `angle`, `expression`, `gesture`, `handState`, `prop`, `bodyDirection`, `headDirection`, `energy`, `semantics{state, confidence, evidence[]}`, `anchors`, `fingerprint`, `framing`, `rigPose` (rig) |
| `palette`, `lighting`, `style` | measured visual identity |
| `hasRig`, `animationCapabilities` | `complexity` ceiling (STATIC / POSE_BASED / PARTIAL_RIG / FULL_VECTOR_RIG), `headSeparable`, `blink`, `mouthStates`, `expressionLayers`, `armRig` |
| `allowedActions`, `restrictedActions`, `preferredCameraAngles` | what the Director may and may not ask for (e.g. «new arm gestures» restricted for flat PNGs, «mirroring» restricted for asymmetric art) |
| `identity` | palette + garments + lock rules (see CHARACTER_QC.md) |

## Anchors (per pose, fractions of the image)

`headTop`, `headCenter`, `neck`, `shoulderL/R`, `elbowL/R?`, `wristL/R?`, `handL/R`, `torsoCenter`, `hips`, `feet`, `headHeight` (scale reference: the engine sizes characters in pixels-per-head, never by bounding box), `confidence`, `source` (auto / rig / manual), `headSeparable`.

Manual correction in the brief (wins over detection, persisted in `anchors.override.json`):

```json
"character": { "poses": [...], "anchors": { "holding-phone": { "handR": { "x": 0.71, "y": 0.52 } } } }
```

## Brief fields (`brief.character`)

`use`, `name`, `sheet`, `sheetLabels[]`, `crops[{x,y,width,height,label?}]`, `poses[{path,label?}]`, `svg`, `image`, `saveAs`, `anchors`, `motion` (subtle / normal / exaggerated), `lockFace`, `talk` (0–3), `side` (left / right / center), `garments[]`. Beats: `content.characterScript[]` (1–24) with `line`, `action?`, `emotion?`, `pose?`, `prop?`, `camera?`, `scene?` (stage, phone, chat, product, chart, title, cta), `messages?`, `seconds?`.

## In `video.json`

`video.character` carries what the renderer needs: `id`, `name`, `complexity`, `mode` (rig | poses), `poses{poseId → asset, width, height, state, bodyDirection, framing, prop, anchors, headHeight}`, `rig`, `identity{palette, garments, lock}`. Pose PNGs are ingested as `avatar` assets (`char-<poseId>`), byte-identical, never edited.
