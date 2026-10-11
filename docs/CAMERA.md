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
