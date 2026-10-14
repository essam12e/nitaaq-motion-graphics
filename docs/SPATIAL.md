# Glass + Spatial

This phase adds three things:

- Glass 2.0, an opt-in model of how a glass pane looks;
- the GlassPortfolioFolder, a folder built from glass layers with six states;
- the Spatial Video Gallery, where several videos play at once on cards placed in depth while the camera tours them.

All three build on what already exists:

- the Surface component;
- the Choreography Engine (`docs/CHOREOGRAPHY.md`);
- the camera model of the rig (`src/camera/rig.ts`);
- `VideoMedia`.

Nothing old changes:

- A `Surface` without `glass` draws exactly as before, in every kind.
- The Cursor and the Camera keep their defaults.

| File | Role |
|---|---|
| `src/components/glass.ts` | Glass 2.0 as pure style data (`glassLook`) |
| `src/components/Surface.tsx` | new optional `glass` prop |
| `src/components/glass-folder-state.ts` | the six folder states and the pose they read from (pure) |
| `src/components/GlassPortfolioFolder.tsx` | the folder component |
| `src/camera/spatial.ts` | cards in depth, the camera that tours them, pass-through, plane maps |
| `src/scenes/spatial/program.ts` | the timelines of the two families (pure) |
| `src/scenes/spatial/spatial-scenes.tsx` | the `glass-folder` and `spatial-gallery` families |

## Glass 2.0

```tsx
<Surface glass={{ frost: 0.7, thickness: 0.6, edgeLight: 0.7, specular: sweep, refraction: 0.4, chroma: 0.4, light: { x, y }, grain: 0.5 }} />
```

| Option | Effect |
|---|---|
| `frost` | Blurs what is behind the pane (backdrop blur, capped at 24px). In simulated frost it makes the pane milkier. |
| `tint`, `opacity` | The colour and strength of the pane. They default to the style's surface. |
| `thickness` | A bevel: the edge toward the light is lit and the opposite edge is shaded. |
| `edgeLight` | A rim of light around the edge, brightest toward the light. |
| `specular` | The position of a light band that sweeps across the pane: −0.3 is before it, 1.3 is past it. Scenes animate this value on their timeline. |
| `refraction` | Simulated: light bent through the thickness gathers as a caustic along the far edge, and it shifts against the light. |
| `chroma` | A chromatic fringe: warm on one side, cool on the other. |
| `light` | The light direction (−1..1). The spatial scenes pass the camera here, so reflections move as the camera moves. |
| `grain` | A fixed frost texture, the same seed every frame. |
| `backdrop` | `auto` (the default), `live` or `simulated`. |

**Live or simulated.** In Chromium, a backdrop blur inside a 3D (`preserve-3d`) camera has bad rendering paths. So `auto` picks between the two modes:

- **live blur:** used only in full-effects renders outside an active 3D camera;
- **simulated frost:** used everywhere else. It is more opaque and milkier, so it still hides what is behind it, and it costs nothing.

`data-qc-glass` on the surface says which mode was used. `glassLook` is a pure function of its inputs.

## GlassPortfolioFolder

The folder has five layers, from back to front:

1. **Back pane and tab:** tinted frosted glass.
2. **Two inner sheets:** they rise as the folder opens.
3. **What it holds:** the cards.
4. **Front pane:** frosted, with a lit rim, a specular sweep, refraction, a chromatic edge and grain. It frosts the cards behind it.
5. **Glow ring:** the click pulse.

It has six states, all read from one continuous pose (`reveal`, `hover`, `press`, `open`, `explode`, `glow`, `dim`, `sweep`). Each state blends into the next on the scene's timeline; there is no switch between drawings.

| State | Reads as |
|---|---|
| `closed` | at rest |
| `hover` | lifted, rim brighter, shadow softer |
| `pressed` | compressed, shadow tighter |
| `opening` | the front pane tips back |
| `open` | the cards are out |
| `exploded` | the glass layers separate (back up, sheets fan, front down) and the cards fan out around it |

- `folderState(pose)` names the state, and `folderPose(state)` gives the pose of a named state.
- The folder sets `data-qc-folder-state`.

Everything is 2D. In Phase 4, text inside a 3D-transformed layer did not rasterise identically run to run, so the front pane tips back with a scale and a trapezoid clip instead of a `rotateX`.

## Spatial camera (`src/camera/spatial.ts`)

This is the same camera model as the rig.

**Where a card lands.** Take a card on plane `d`, at physical offset `(X, Y)` from the canvas centre, with physical width `w`. Under camera `(x, y, dolly, zoom)`, with no tilt or yaw, it shows at:

```
k = zoom / (1 + d − dolly)      screen = centre + (X − x, Y − y)·k      size = w·k
```

This is exactly what `project()` and CSS 3D give for that plane; the unit tests check it.

**Drawn in 2D.** Every plane that faces the camera maps to a translate plus a scale. So the spatial scenes draw their planes in 2D with these numbers instead of nesting them in a `preserve-3d` world:

- the picture is the same;
- frosted glass keeps its live blur;
- text and video rasterise identically run to run.

**Main functions:**

| Function | What it does |
|---|---|
| `cardOnScreen(card, cam)` | Returns the screen rect, the clearance and the pass-through opacity. |
| `planeMap` / `planeTransform` | Give the 2D map, or the CSS, of a plane under the camera. The glass folder uses it for its camera push. |
| `frameCard` | Frames one card at a target width. |
| `fitCards` | Gives the tightest camera that shows a whole set inside the stage. |
| `galleryLayout(variant, n, …)` | Places the cards and computes their framings and the overview. |
| `galleryCamera(layout, travel, push, back)` | Gives the camera at a point of the tour. `travel` −1 is the overview and `i` is card `i`. Values in between blend the neighbours, with a pull-back arc and a depth-of-field ramp. `back` returns to the overview directly. |

**Pass-through.** A card the camera flies past fades out while its clearance is between `PASS_FADE` = [NEAR + 0.07, NEAR + 0.4]. It is gone before it reaches the lens, so the camera never collides with it.

## Scene family `glass-folder`

| Variant | Timeline |
|---|---|
| `open` | The folder reveals. The cursor approaches and hovers: the folder lifts, its rim brightens and light sweeps across the front pane. A press compresses it. The click brings the sound and a pulse. On release the folder opens and the video cards rise out. The camera pushes in, and focus hands off to the cards. |
| `explode` | The same, then the folder explodes: its glass layers separate, the cards fan out around it, and the camera eases back. |

Content fields:

- `eyebrow`, `title`, `subtitle` and `caption`;
- `folder`;
- `items` (1–6), each with a `title`, an image or video `media`, and a `clip` (trim, loop, rate);
- `from`;
- `choreography`, an edited timeline. It uses the element names `folder`, `cardN`, `cards`, `cursor` and `camera`. The folder's properties are `reveal`, `open`, `explode`, `glow` and `sweep`; a card's properties are `out` and `fan`.

## Scene family `spatial-gallery`

Several videos play at once, each on a Glass 2.0 card in depth. Each video is frame-driven with its own clip.

| Variant | Tour |
|---|---|
| `corridor` | The opening view is a cascade that alternates sides and climbs into depth. The camera flies to each card in turn and passes the ones it leaves behind. |
| `wall` | The camera starts on the whole wall, visits each card (pulling back between them) and returns to the whole wall. |

What follows the camera:

- **Focus:** the framed card gets a ring, and the others dim.
- **Depth of field:** cards off the focus plane blur, in full renders.
- **Glass reflections:** they shift with the camera.
- **Light sweep:** light runs across a card's glass as the camera arrives on it.
- **Title and dots:** the focused card's title shows under the cards, with a row of position dots.

Content fields:

- `eyebrow`, `title` and `subtitle`;
- `items` (2–6), each with a `title`, a `media` and a `clip`;
- `cardAspect`, which defaults to 4:5 on portrait canvases and 16:9 on landscape ones;
- `choreography`. Its targets are `gallery.travel`, `gallery.back`, `gallery.push`, `cardN.reveal` and `cardN.sheen`.

**Sound** comes from the same timeline:

- `card_entry` when the cards reveal;
- `camera_move` for each move of the tour.

## Never two cameras

Both families run their own timeline camera only when the scene shell has no `cameraPlan`. When the shell has one, the folder is drawn at rest and the gallery holds its overview, and the shell's camera moves the whole scene.

## Seek

`nitaaq seek` reports, for these families:

- `choreography.folder`: the state, `open` and `explode`;
- `choreography.gallery`: `travel`, `back` and the focused card;
- under `videos`, every card video at the source time it shows.

The gallery's camera itself depends on the layout, which depends on the canvas, so seek reports the tour rather than the camera.

## Determinism

Structure, timing, the folder states, the camera and the sound are identical run to run. Production renders were checked frame by frame. A few choices make the glass and the card edges identical too:

- **The folder's front pane uses simulated frost.** The live backdrop blur over the moving pointer and the emerging video cards differed by a few colour levels between runs. The live blur is still available (`backdrop: 'live'` or `'auto'`) for panes over still content.
- **Video thumbnails have square corners and sit in a window with a keyline.**
  - The picture overhangs its window a little, so its own edge is never on screen.
  - One solid keyline border straddles the window's edge. When a video is shown much smaller than its source, the anti-aliased edge pixel varied slightly run to run, and the keyline covers that pixel.
  - Rounding the video's corners (a clipped box, or a radius on the picture) varied the same way.
- **A card that plays a video does not rotate.** The fan then reads from position and scale; cards without a video still tilt.
- **The lit rim is drawn with inset box shadows,** not with a mask-composite ring.

**What is left.** The pixels inside a video picture, and in the frosted strip drawn over it, can still differ slightly between runs. This happens only while that picture moves or changes size. In the test film, measured on lossless frames:

- the difference is usually 1–5 levels of 255;
- it reaches 26 in a few dozen pixels while the folder explodes.

- **Cause:** each video frame reaches Chromium as a new image (`OffthreadVideo`), and Chromium does not always resample a new image the same way when it draws it scaled.
- **What was ruled out:**
  - The same scene with still images instead of videos renders identically.
  - Snapping the source time to the middle of a frame, PNG frames (`transparent`), one render worker, and a software GL backend did not remove the difference. The software backend only reduced it.
- **Effect:** the difference is invisible. It never touches text, edges, glass or timing.

## Limits (honest)

- **Simulated refraction:** there is no real light bending through the pane.
- **Spatial camera:** it has no tilt or yaw, by design, so the cards always face the lens. Orbiting the gallery is a later camera phase.
- **The Director:** it does not pick these families on its own yet; they are used when a film or edit names them.
- **Performance:** six simultaneous videos, each with its own glass frame, is the heaviest scene in the library. The live blur is kept for the folder's front pane, and the gallery's card frames use simulated frost.
