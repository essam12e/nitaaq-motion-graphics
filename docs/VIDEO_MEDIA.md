# Video media

User video clips play inside the film the same way images do: `<Media src=…>` detects the kind and a video goes to `<VideoMedia>`. Remotion stays the only clock. A clip never plays on its own; every frame shows the source frame computed from the scene frame. Renders, stills, `nitaaq seek` and QC therefore always agree.

## Giving the director a video

```json
"assets": [
  { "path": "demo.mov", "kind": "video" },
  { "path": "screen.mp4", "kind": "video", "clip": { "startFrom": 2, "endAt": 6, "loop": true, "playbackRate": 1.5 } }
]
```

- **Accepted formats:** MP4, MOV, WebM and M4V.
- **Wrong kind:** a video listed as `"kind": "image"` is detected from its extension and handled as a video.
- **Where it plays:** when the brief has a video, the `video-media` module is loaded. The storyboard then shows the user's footage once, ahead of other choices, as it already does for the user's real screenshot.

## Video Asset Pipeline (`src/node/video-assets.ts`)

`Source → Cache → Probe → Normalize → Proxy → Segment → Trim`. Every step is cached by file hash: a second run on the same file takes a few milliseconds.

| Step | What happens |
|---|---|
| Source | The original is copied **byte-identical** to `assets/<hash>-<name>` and verified. |
| Probe | ffprobe reads size (rotation-aware), fps, VFR, codec, pixel format, audio and bitrate. |
| Normalize | Only when needed: codec other than H.264/VP8/VP9, QuickTime container, variable frame rate, rotation metadata, odd dimensions, non-4:2:0 H.264, or > 60 fps. The result is H.264 yuv420p at a constant frame rate, written to `*.norm.mp4`. The asset keeps `original`. |
| Proxy | Triggered by a long edge > 1920 px, > 20 Mbit/s or > 80 MB. Produces a 960 px `*.proxy.mp4` (never upscaled). Only `preview` / `animatic` renders use it; `draft` / `production` use the full file. |
| Segment | When the user gives no trim, the best window is **measured**, not assumed to start at 0. The score is motion + contrast, with penalties for black/flat frames and for hard cuts. The reason is recorded in `segmentReason`. |
| Trim | The chosen window becomes the asset's `clip`. |

CLI: `nitaaq video probe <file>` · `nitaaq video prepare <file> --project <dir> [--id] [--segment N] [--proxy] [--loop] [--rate]`.

## Clip model (`src/media/video.ts`)

Clip settings are merged in this order, later winning: asset `clip` < scene `content.clip` / `content.clips[i]` < component prop.

| Field | Meaning |
|---|---|
| `startFrom` / `endAt` | Trim, in source seconds (clamped to the source). |
| `playbackRate` | 0.25–4. |
| `loop` | Wraps the trimmed window. Without it the last source frame holds. |
| `delay` | Shows the first frame until the clip starts. |
| `muted` / `volume` | Off by default; the Sound Director owns the mix. When enabled, the sound uses the same trim, rate and loop. |

`videoTimeAt(sceneSeconds, clip, sourceFps)` is a pure function: the same frame always maps to the same source time, in any order and on any worker.

## VideoMedia props

`src`, `width`, `height`, `fit` (`cover` by default; product and screenshot roles are always `contain`), `objectPosition`, `radius`, `frame`, `shadow`, `mask` (a morph-library shape name such as `squircle`, `circle`, `phone` or `blob`, or any CSS clip-path), `clip`, and `style` for opacity and transforms. It works inside cards, Surfaces and masks, and several can play in one scene.

The rounding and the mask are applied to the video picture itself rather than to a clipping box around it. Chrome's anti-aliasing of a clipped box around a changing frame varied between render runs; on the picture it is identical every time.

## Scene family `video-showcase`

| Variant | Use |
|---|---|
| `card` | One clip on a Surface card with a soft 3D entrance. |
| `split` | Up to 4 clips playing together, each with its own trim and rate. Each clip keeps its own shape (9:16 next to 16:9), and the grid is chosen so the smallest clip is as large as possible. |
| `mask` | A clip inside a shape (squircle by default). |
| `full` | Full-bleed clip under the title. |

Old media scenes (`image-reveal` and the others) accept a video in their image field with no change.

## Seek, QC and budget

- **Seek:** `seek(t)` reports each clip's source `time`, `phase` (`before` / `playing` / `held`) and `loopIndex`.
- **QC:** the probe waits for video frames to decode before measuring, and a broken clip is reported as a broken *video frame*.
- **Effect budget:** each simultaneous clip counts as a decode (more above 1080p).

## Verified

A test clip that draws its own frame number was decoded from rendered MP4 frames. In 16:9, 48 of 48 frames showed exactly the source frame `seek` predicted, covering trim, rate ×2, loop wrap and hold. In 9:16 the cover crop hides most of the number, so only a consistency check is possible there; it also gave 48 of 48. The clip's sound was checked by frequency analysis for trim, loop, rate and volume.
