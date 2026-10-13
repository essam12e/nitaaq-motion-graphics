# Lottie media

A user's Lottie animation (`.json` or dotLottie `.lottie`) plays inside the film like an image or a video clip: `<Media src=…>` detects it and hands it to `<LottieMedia>`. Remotion stays the only clock. The player never runs on its own; every frame seeks it to the exact Lottie frame computed from the scene frame, so renders, stills, `nitaaq seek` and QC agree.

## Giving the director a Lottie

```json
"brand": { "name": "وصل", "logo": "logo.json" },
"assets": [
  { "path": "check.json", "kind": "icon", "clip": { "marker": "draw" } },
  { "path": "hero.lottie", "kind": "lottie", "clip": { "loop": true, "playbackRate": 1.2 } }
]
```

- **Kinds:** `lottie`, an `icon` given as a Lottie file, or a logo that is a Lottie file. A `.json` / `.lottie` listed as `image` is also handled as a Lottie.
- **The module is lazy:** `lottie` is selected only when the brief has a Lottie. The node pipeline is imported only then, and the player (lottie-web, about 390 KB) is a separate render chunk that the browser loads only when a scene shows a Lottie.
- **Lottie logo:** no raster analysis runs on it, and the raster logo engine (`logo-animation`) is not used. When the brief names no colours, the logo's own static colours give the palette.

## Lottie Asset Pipeline (`src/node/lottie-assets.ts`)

| Step | What happens |
|---|---|
| Source | The original is copied **byte-identical** to `assets/<hash>-<name>` and verified. |
| Unpack | A dotLottie is read with a built-in ZIP reader (stored and deflate entries, 64 MB cap). The first animation in its manifest is used. |
| Images | Images referenced by path (next to the JSON or inside the dotLottie) are embedded as data URIs. A missing image is an error, never a blank. |
| Inspect | Size, frame rate, frame range, markers, layers, masks, mattes, effects, text, images, 3D, a complexity score and the static colours. |
| Refuse | Expressions (script inside the renderer, not deterministic) and broken timing or size are refused with a clear reason. 3D layers, AE effects, live text without glyphs and very heavy files render with a warning. |
| Cache | Keyed by file hash plus the hashes of side images. A second run takes a few milliseconds; a changed image invalidates it. |

When the file had to be rewritten (unpacked or images embedded), the render uses a self-contained copy `*.lottie.json` and the asset keeps `original`.

CLI: `nitaaq lottie inspect <file>` · `nitaaq lottie prepare <file> --project <dir> [--id] [--kind lottie|logo|icon] [--marker name] [--loop] [--rate x]`.

## Clip model (`src/media/lottie.ts`)

The same clip model as video (asset `clip` < scene `content.clip` < component prop), measured in the animation's own frame rate:

| Field | Meaning |
|---|---|
| `marker` | Play one named marker (overrides `startFrom` / `endAt`). Unknown names play the whole animation. |
| `startFrom` / `endAt` | Trim, in seconds from the first frame. |
| `playbackRate` | 0.25–4. |
| `loop` | Wraps the window. Without it the last frame holds. |
| `delay` | Shows the first frame until it starts. |

`lottieFrameAt(sceneSeconds, clip, timing)` is pure and sub-frame accurate: a 60 fps Lottie in a 30 fps film plays at its true speed.

**Logos:** a Lottie logo plays its own animation in the logo-moment families (`lottie-moment`, `logo-reveal`, `brand-intro`, `cta-logo`). Everywhere else (a small logo inside another scene) it shows its finished pose. Media and seek share this rule (`LOTTIE_LOGO_PLAYS_IN`).

## Scene family `lottie-moment`

| Variant | Use |
|---|---|
| `logo` | The Lottie logo plays, then the line under it. |
| `icon` | The Lottie on a soft tile, title beside or under it. |
| `hero` | The Lottie large, title above. |

Old media scenes (`image-reveal` and the others) accept a Lottie in their image field with no change.

## Seek, QC and budget

- **Seek:** `seek(t)` reports each Lottie's `frame`, `phase` (`before` / `playing` / `held`) and `loopIndex`.
- **QC:** the probe waits for players to draw. A Lottie that failed to load, or a missing player package, is a critical `MEDIA_BROKEN` issue that names the cause.
- **Effect budget:** each Lottie on screen counts 0.1 plus its measured complexity (capped at 0.6), weighted by duration.

## Determinism

lottie-web puts `translate3d(0,0,0)` on its `<svg>`. Chrome then rasters it as its own layer at a scale that depends on which frames that tab drew before, so pixels varied between runs. LottieMedia draws the SVG flat, and two full renders are now byte-identical.

## Verified

A test Lottie whose bar sits at x = 4 × frame was decoded from rendered MP4 frames in both 16:9 and 9:16. 284 of 284 frames matched the frame `seek` predicted, within 0.22 Lottie frame, covering play, rate ×2 with delay, loop and hold. The 16 frames not measured are the scenes' fade-ins. Two full renders of each aspect were byte-identical.
