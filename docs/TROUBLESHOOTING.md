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
| `LOOP_SEAM` | last frame differs from the first in a loop | End on the opening composition |
| `REFERENCE_UNREADABLE` | reference file missing or not an image/video | Check the path or send a screenshot |
| `CAPTURE_FAILED` | website could not be captured (blocked network, blank page) | Ask the user for a screenshot of the page; nothing is fabricated |
| Same video renders instantly | the render cache matched (same spec, assets, profile) | Expected; `NITAAQ_NO_CACHE=1` or `cache clear renders` to force |
| Stale results after changing engine code | cache key misses a dependency | `npx tsx cli/nitaaq.ts cache clear` and report it |
| Studio: port in use | another process on 4455 | `STUDIO_PORT=4466 npm run studio` |
