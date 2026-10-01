# Troubleshooting

Every error prints **what** failed, **where**, **why**, whether it was **repaired**, and the **action** to take. Stage logs look like `[RENDER] …`, `[QUALITY] …`.

| Symptom / code | Cause | Fix |
|---|---|---|
| `preflight` ✗ dependencies | `node_modules` missing | `npm run setup` |
| ✗ fonts | font files not synced | `npm run fonts:sync` |
| ✗ ffmpeg | no system ffmpeg and Remotion binaries missing | `npm install` (Remotion ships ffmpeg) or install ffmpeg |
| First render slow | Remotion bundle is built once and cached | Normal; later renders reuse it (see PERFORMANCE.md) |
| Exit code 2 with `questions` | brief is missing a decision (logo, voice file, TTS provider) | Ask the user, update `brief.json`, run again (`--no-logo` if they have none) |
| `INPUT_INVALID … brief.json is incomplete` | required brief fields missing | Add `request`, `content.hook`, `content.cta.text` |
| `SCENE_CONTENT_INVALID` (critical) | a scene's content does not match its schema | Fix the field named in the path (see `docs/SCENE_LIBRARY.md`); content is never guessed |
| `PLACEHOLDER_DATA` | a data/testimonial `source` says example/sample/tbd | Provide the real source or remove the scene |
| `DEVELOPER_SIGNATURE` | "made with …", a handle or a watermark in the copy | Remove it — videos are delivered without any tool/developer identity |
| `ASSET_MISSING` / `MEDIA_BROKEN` | file path wrong or unreadable image | Check the path is inside the project; re-export as PNG/JPG/WEBP/SVG |
| `MEDIA_UPSCALED` (warning) | a small user image shown large | Provide a larger original (it is never AI-upscaled or altered) |
| `FONT_NOT_ARABIC` | user font lacks Arabic glyphs/shaping | Use an Arabic-capable font or a bundled one |
| `FONT_LOAD_FAILED` (critical) | a font did not load in the renderer | `npm run fonts:sync`; check the user font file |
| `TEXT_FIT_FAIL` / `TEXT_OVERFLOW` | copy too long for the scene | Auto-repair shrinks text/layout; if it persists, shorten the copy or pick a variant with more capacity |
| `HOLD_TOO_SHORT` | not enough time to read | Auto-repair extends the scene (not in voice-synced videos — shorten the copy there) |
| `TEXT_CONTRAST_LOW` | text over a busy/low-contrast area | Auto-repair adds a scrim; or change style/brand colours |
| `LAYOUT_UNDERFILLED` (warning) | content fills little of the frame | Auto-repair scales the composition up within the safe area |
| `VOICE_DRIFT` | a voice-synced scene starts > 0.25 s away from its phrase | Provide a transcript (one line per phrase) or let the Director re-plan |
| `TTS_UNAVAILABLE` | no premium voice provider | Produce without voice, upload a recording, or set `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` |
| `AUDIO_CLIPPING` / `AUDIO_QUIET` | levels | Auto-repair lowers music/SFX; check the source recording |
| `MP4_BITRATE_HIGH` (warning) | the file is unusually heavy (> 30 Mbit/s) | Lower texture/grain in the style or use the `draft` profile |
| `ENCODER_STRING` (warning) | an encoder name (x264/Lavf) survived in the MP4 | The cleanup remux failed; check the `[RENDER]` warning and that ffmpeg supports `filter_units` |
| `MP4_SIGNATURE` | encoder tag found | Should not happen (tags are stripped); report it |
| `QC_FAILED` (not delivered) | a critical issue without a safe automatic fix | Read `qc/final/quality-report.json` and the contact sheet; fix the named asset/copy |
| `PATTERN_IN_FRAME` / `BANNED_DOTTED-BACKGROUND` | a dot/grid/particle background nobody asked for | Auto-repair switches to a clean background; if the user wants the pattern, set `design.allowPatterns` and `design.justification` |
| `PHONE_UNREADABLE` | text too small at phone size | Cut words or raise `textScale`; the repair loop tries first |
| `EFFECT_BUDGET` (warning) | heavy families/blur/glow over the task's budget | Use lighter families or a flatter style; render will be slower |
| `CAMERA_OVERUSE` / `TRANSITION_MONOTONY` | motion without restraint/variety | Let the Creative Director re-plan (`direct` again) or edit `motion_spec.json` choices in video.json |
| `TRANSITION_REPEAT` / `TEXT_MOTION_REPEAT` / `TEXT_MOTION_OVERUSED` | the same transition or headline text motion twice in a row / too often | The engines avoid this by design; if it appears after manual edits, change `scenes[i].transition` or `motion.text` |
| `SFX_REPEAT_CONSECUTIVE` / `SFX_REPEAT_OVERUSED` | the same sound file back-to-back / too often | The sound stage re-plans with another variation (up to 3); if it persists, lower `audio.sfxIntensity` in the brief or remove explicit per-scene `sfx` arrays |
| `SFX_DENSITY` | too many sound cues per 10 s | Auto-repair lowers the intensity; or set `audio.sfxIntensity` lower in the brief |
| `SFX_SYNC` | a cue is > 80 ms off its motion anchor | Re-run `direct` (re-plans on the measured peaks); report it if it repeats |
| `SFX_VOICE_CLASH` | an SFX sits on top of a voice phrase | Auto-repair lowers SFX; or a lower `audio.sfxVolume` / `audio.sfxIntensity` for voice-led films |
| `SFX_KEY_SILENT` (warning) | a key moment (logo / hero / price / CTA) has no sound | Usually the density budget; raise `audio.sfxIntensity` slightly |
| `AUDIO_EMPTY` | no voice, no music and no SFX | Intended only when the user asked for silence; otherwise allow the procedural soundtrack or SFX |
| Shared transition falls back to a normal one | `shared-rects` could not see the asset at one edge of the transition (listed in the produce log) | Expected — nothing is guessed; keep the asset visible at the end of the outgoing scene |
| `gsap` cards render static (`data-qc-gsap="missing"`) | the optional `gsap` package is not installed | `npm i gsap` or let the director use a non-GSAP family |
| A map place or route end is missing (validation warning, `warnings` in the map content) | the place is not in the bundled data and the brief gave no `lat`/`lon` | Provide real coordinates or a GeoJSON file; locations are never invented |
| `variants` makes fewer files than expected | a strategy needs material the brief does not have (e.g. product-first without a product image) | Read `<base>.variants-report.json` → `unsupported` |
| `LOOP_SEAM` | last frame differs from the first in a loop | End on the opening composition |
| `REFERENCE_UNREADABLE` | reference file missing or not an image/video | Check the path or send a screenshot |
| `CAPTURE_FAILED` | website could not be captured (blocked network, blank page) | Ask the user for a screenshot of the page; nothing is fabricated |
| Same video renders instantly | the render cache matched (same spec, assets, profile) | Expected; `NITAAQ_NO_CACHE=1` or `cache clear renders` to force |
| Stale results after changing engine code | cache key misses a dependency | `npx tsx cli/nitaaq.ts cache clear` and report it |
| Studio: port in use | another process on 4455 | `STUDIO_PORT=4466 npm run studio` |
