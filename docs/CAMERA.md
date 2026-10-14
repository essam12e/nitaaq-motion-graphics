# Cinematic Camera 2.0 (2.5D, depth, parallax)

A real 2.5D camera over depth planes, with the same maths as CSS 3D, so what the QA measures is what renders.

| File | Role |
|---|---|
| `src/camera/rig.ts` | camera state (x, y, dolly, zoom, tilt, yaw, roll, focus, aperture), `project` / `projectRect`, `unproject` (Newton) / `unprojectRect`, clearance (a plane must never reach the lens), depth of field |
| `src/camera/moves.ts` | 22 named moves (`push-in`, `pull-out`, `dolly-*`, `truck-*`, `pan-*`, `tilt-*`, `pedestal-*`, `orbit-*`, `arc`, `crane-up`, `zoom-*`, `rack-focus`, `track`, `drift`, `static`) → `cameraAt(plan, t)`; waypoints; beat accents; `peakSpeed` |
| `src/camera/CameraRig.tsx` | `<CameraRig plan>` (perspective + world transform) and `<DepthLayer plane>`; outside an active rig a DepthLayer is a plain fill, so old films render exactly as before |
| `src/camera/director.ts` | `planCamera()` — which move serves this subject (see below) |
| `src/camera/framing.ts` | `auditFraming` / `solveFraming` — protected elements (text, product, logo, CTA) must stay inside the safe area for the whole move |

## Depth planes

Perspective `D = hypot(W, H) × 1.25`. Planes (fraction of D): foreground −0.32, midground −0.12, **hero 0** (authored layout is exact), background 0.7, atmosphere 1.6. Each layer keeps its rest size (`translateZ(−dD) scale(1 + d)`), so only the camera moves things: near planes move more (true parallax).

The scene background sits on the background plane, overscanned 12.5% a side about the centre (orbits/arcs move the far plane by up to ~11%; measured, see `test/unit/motion2b.test.ts`).

## Which move (camera director)

| Subject | Move |
|---|---|
| hero product | orbit-left / arc / push-in (+ depth of field for premium/cinematic) |
| logo / brand | crane-up (push-in when restrained) |
| CTA | pull-out |
| UI | truck-left in RTL films, truck-right in LTR |
| data | pedestal-up |
| headline | push-in or drift |

Corporate never orbits, arcs or cranes. Amplitude per personality: premium .8, cinematic 1, corporate .6, tech .85, playful .9, energetic 1.05, sport 1.1 (×0.85 off the hero). Music-led films (not premium/corporate) add up to 3 downbeat accents per scene.

`scene.motion.cameraPlan` is plain JSON (move, amplitude, ease, focus, accents, waypoints, dof, reason) — editable by hand; the legacy `scene.motion.camera` name still works.

## QA

Visual QA 2.0 unprojects every measured element back to its rest position and audits the whole move (30 samples). A violation becomes `CAMERA_FRAMING` with the repair `camera-solve`: apply the solved plan (smaller amplitude / moved focus), else halve the amplitude.

## Camera Solver, presets and pass-through (Premium Phase 6)

The rig and the move library stay as they are; the solver (`src/camera/solver.ts`) adds targets on top of them. `cameraAt(plan, t)` resolves a preset, frames the target(s), plays the move around that framing, then applies the bounds. A plan without the new fields gives exactly the old numbers.

| Field of `cameraPlan` | What it does |
|---|---|
| `preset` | `hero-reveal`, `product-orbit`, `brand-crane`, `ui-tour`, `impact-push`, `calm-drift`, `flythrough`, `focus-pull`, `resolve-pull` — fills only the fields the plan leaves unset (`move: "static"` takes the preset's move) |
| `target: { rect, depth?, fill? }` | auto framing of one element or a group (`rect` may be a list → union): dolly first, then lens zoom where the dolly would come too close (protected planes keep NEAR + 0.12) |
| `targets: [{ t, rect, depth?, fill? }]`, `lag` | smooth look-at: the camera follows each new target with an eased lag (velocity 0 at both ends, no jump) |
| `bounds: { world?, depth?, minDolly?, maxDolly?, maxZoom? }` | the visible window never leaves the world rect, the dolly stays in its limits |
| `passThrough` | the `fly-through` move may travel through the hero plane: each `DepthLayer` fades over the pass band (clearance NEAR+0.07 → NEAR+0.4) and is hidden before it reaches the lens |
| `motionBlur` | velocity-aware directional blur from `blurHint` (shutter 180°, threshold 0.35 u per frame, cap 3 u) as an SVG `feGaussianBlur` — only while the camera is fast, full effects only |

`focusHandoff(a, b, u)` blends two framings with a rack of the focus plane (depth of field peaks mid-way). Probes: `data-qc-camera` (preset or move), `data-qc-pass` (pass-through opacity), `data-qc-motion-blur`.
