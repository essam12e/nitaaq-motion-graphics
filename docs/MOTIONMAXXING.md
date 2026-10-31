# MotionMaxxing production tools in NITAAQ

NITAAQ uses the **original** MotionMaxxing runtime (Tejas Makwana, Apache-2.0) as an optional module
(`motionmaxxing`). Nothing was rebuilt: `public/mm/runtime/` is upstream `runtime/` byte for byte
(`motion.js`, `hero3d/` with three.js r186 + opentype.js, `native-ui/`, Inter), except GSAP, which is
NITAAQ's own optional dependency copied there by `npm run mm:sync` (not a second vendored copy).

## How it runs inside NITAAQ

A MotionMaxxing shot is a NITAAQ scene family. Its picture is an iframe document (`src/mm/doc.ts`) that loads the
runtime and runs a shot program (`src/mm/programs.ts`). Remotion stays the only clock: every frame calls the runtime's
own seek contract `__seek(frame / fps)` and waits until the iframe painted it (`src/scenes/mm/MMFrame.tsx`). So the
shot is frame-accurate, deterministic and seek-safe in every parallel render worker; a failed runtime cancels the
render (never a blank shot). Everything else is the normal pipeline: shot script → compiler → structural QC →
Sound Director → render → −14 LUFS master → final QC → delivery.

| Family | Variants | MotionMaxxing tools actually called |
|---|---|---|
| `mm-kinetic` | `words`, `count` | `M.words` (whole words, speech rhythm, accent word enters bigger), `M.snap` (arrival from oversize), `M.exit` + smear / `M.dive` / `M.whip` (leave on motion, cut mid-move), `M.drift`, `M.count` (one value per frame, lands on the real value), lockup `M.enter` from 3.5× (`snapSettle`) |
| `mm-hero3d` | `coin`, `logo`, `glass-slab`, `phone` | `M.hero3d` (studio env, key/rim, shadow ground, travelling softbox `sweep`, `pulse` on the landing, motivated dolly, exit toward the camera); the brand mark (SVG paths) is extruded on the coin face. Materials: `satin`, `brandPlastic`, `chrome`, `glass`, `iridescent`. |
| `mm-phone` | `lock-screen`, `screenshot` | `NativeUI.phone / lockScreen / appIcon`, `NativeUI.arrive` (notification rolls up), `NativeUI.macro` (camera push until the notification is the frame), `M.cursor` + `M.press` (squash, target answers 1 f later, cut before release); `carrier: "coin"` = object-driven entry (the coin from the previous shot shrinks into the app icon). `screenshot` shows a real capture, never rebuilt. A built UI must be marked `illustrative: true`. |

Every family declares its beats as NITAAQ motion events with **exact frame anchors** (word impact, counter final,
product land, notification, phone tap, logo reveal), so the Sound Director places SFX on the same frames the runtime
animates. Optional per-shot `colors` (`ground`, `ground2`, `ink`, `accent`, `metal`, `primary`) carry the brand's own
material and accent.

## The 12 measured eases

`src/mm/eases.ts` is the runtime's math verbatim (unit-tested against `motion.js`). They are registered in
`CURVES` as `mm:crashIn`, `mm:popOver`, `mm:bounceHard`, `mm:snapSettle`, `mm:softLand`, `mm:whip`, `mm:glide`,
`mm:cruise`, `mm:softInOut`, `mm:gentleIn`, `mm:accelExit`, `mm:crashOut`, so Stage choreography and camera moves can
use them by name too.

## Sound & sync

- `src/mm/sync.ts` is `scripts/sync.mjs` ported: words → frames, on-screen word lands **2 frames before** it is heard.
  The shot compiler fills `mm-kinetic` onsets from NITAAQ's own voice map (user audio + local Whisper / silences),
  so no ElevenLabs key is needed. Decision recorded in `shot_compile_report.json`.
- `voice.py` (ElevenLabs VO/SFX/music) and `mix.py` (ducking + −14 LUFS) are **not** integrated: NITAAQ already has
  user-voice ingest, Whisper voice maps, synthesised SFX, procedural soundtrack, ducking automation and mastering,
  and the brief forbids a required paid API.

## Rendering

- Remotion stays the renderer (it already gives frame-accurate, deterministic, seek-safe MP4 output).
- Motion blur: MotionMaxxing's per-element **smear** runs inside the shots (one blur grammar). `render.mjs --shutter`
  (sub-frame averaging) is not ported: Remotion renders whole frames.
- Grain: `brief.preferences.grain` (0.03–0.06) → `video.json design.grain` → the exact `render.mjs` filter
  `noise=c0s=…:c0f=t+u:c0_seed=7` on the final MP4 (seeded, same bytes every run).
- WebGL: hero3d runs on the headless browser's GL (SwiftShader without a GPU); QC probes use ≤3 tabs and a 180 s load
  budget for MM films.

## Brand capture

`npm run brand:capture -- <url> --out <dir> [--name "<brand>"]` runs the vendored `brand.mjs` (site colour roles,
fonts actually used, logo, screenshots, media, `board.png`) and, with a name, `fetch_logo.mjs` (official mark from
SVGL / Simple Icons / the site). It writes `<dir>/nitaaq-brand.json` with the brief fields (`brand.name`,
`brand.colors` = accent, ink, ground; `brand.logo`; screenshots as `screenshot` assets). Nothing is invented.

## Style Library v2

`src/style-system/mm-tools.ts` maps each of the 21 styles to the tools that fit what it is (e.g. `kinetic-type` →
words / count / camera; `cinematic` → camera + Hero3D; `product-commercial` → Hero3D only for brand objects, never a
product photo; `premium-saas` → native UI + press; `isometric` → camera depth only, no Hero3D). A shot that uses a
tool its style does not suit gets `MM_STYLE_FIT` in `shot_compile_report.json`.

## Craft (from MotionMaxxing SKILL.md, applied in the existing pipeline)

Write these into `shots.json` (no new director, no new critic):

1. **The idea belongs to the brand**: from its logo, control, material, verb; cover the logo and the film must stop working for a competitor.
2. **One world**: one ground/light/material logic; a ground is a lit surface, not a swatch.
3. **Build the hardest shot first**: render its stills (`cli/stills.ts`) before the rest.
4. **Shots hand off**: the last frame of N is the first frame of N+1 (carried object in the same pose: `exit:"to-camera"` → `carrier:"coin"`); a cut means something.
5. **Cut on motion**: `exit: drop/lift/whip/dive`, cut before a press releases; scenes start already moving (`enter:"snap"`).
6. **Real keyframe timing**: land decelerates (`softLand`, `snapSettle`), leave accelerates (`accelExit`, `crashOut`); median move ≈ 10 f; words 4–6 f apart.
7. **No slides**: no held left-aligned headline block, no kicker, no stat slide, no web-footer ending; the end hold ≤ 1.4 s and gets smaller.
8. **Show, then say**: the product / interface performs the claim (a notification arriving, a number counting) instead of a caption.

Full references (unchanged, Apache-2.0): `docs/motionmaxxing/`.

## Not integrated, and why

| Upstream piece | Reason |
|---|---|
| `render.mjs` as the renderer | Remotion already renders frame-accurately; its grain filter is used, shutter blur is not (whole frames only). |
| `voice.py`, `mix.py`, ElevenLabs | paid API; NITAAQ's own voice/SFX/music/master chain covers it. |
| `look.py`, `lint.mjs`, `blind_review.py`, `precedent.py`, `imagegen.py` | they are a second critic / analysis system or need paid image generation; NITAAQ keeps its own QC. |
| 3D Arabic text (`extrudedText`) | opentype.js does not shape Arabic; Arabic stays HTML type over the 3D canvas. |
| Hero3D isometric worlds | hero3d is one hero object, not a world builder. |
