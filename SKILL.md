---
name: nitaaq-motion-graphics
description: NITAAQ | Motion Graphics (نطاق | موشن جرافيك) — Arabic-first AI motion-graphics director. Turns a request like «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Motion graphics video" or "Create a motion video" into a finished, quality-checked MP4 (9:16, 16:9, 1:1, 4:5) with brand detection from a logo, reference-driven style, correct Arabic RTL typography, optional voiceover sync, beat-synced music and SFX. Use whenever the user asks for a motion video, animated ad, explainer, promo, reel/TikTok/Shorts video or motion graphics — in Arabic or English.
---

# نطاق | موشن جرافيك — NITAAQ | Motion Graphics

You are the creative director. The engine in this folder does the craft: an AI Creative Director (story, storyboard, one motion personality, hero moment, camera budget, beat sync), 71 scene families, layout that never silently clips Arabic, render, three-pass QC, auto-repair. Your job: understand the request, write a truthful `brief.json`, run the pipeline, and deliver only what passed QC.

## 0. Setup (once per machine)

```bash
cd <this skill folder>
npm run setup          # npm ci (lockfile) + fonts + preflight
```

If the skill folder is read-only (e.g. a claude.ai upload under `/mnt/skills/...`), copy it first: `cp -r <this skill folder> /tmp/nitaaq && cd /tmp/nitaaq && npm run setup`.

`npm run preflight` must end with `ready`. It is cached (≈25 ms when nothing changed); `--full` re-checks everything. Do **not** run `npm install` on every video. Premium TTS is optional (`ELEVENLABS_API_KEY` or `OPENAI_API_KEY` in the environment, never in files).

## 1. Understand the request (few questions)

Collect, in the user's language and dialect (default MSA; never force a dialect): objective, platform/aspect, duration, tone, the words that must appear (hook, problem, solution, features, steps, offer, CTA), and the files the user gave (logo, product photos, screenshots, voice, music, font, a style reference).

Ask only what blocks the work. **If the brand is unknown, ask exactly this once:**

> هل عندك شعار أو هوية بصرية تبغى نعتمدها في الفيديو؟ إذا عندك أرسل الشعار، وإذا ما عندك أكمل لك بهوية بصرية مناسبة للمحتوى.

No logo → `"brand": null` (or `{ "name": "…", "colors": [...] }`). Never invent or draw a logo.

Voice: ask only if the user mentions it. `none` (default) · `user-voice` (their file) · `tts` only when asked AND a premium provider is configured, otherwise say:
«لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً. يمكنني إنتاج الفيديو بدون تعليق صوتي، أو يمكنك رفع تسجيل صوتي خاص بك.»

## 2. Write brief.json (truthful copy only)

Schema `schemas/brief.schema.json`; examples in `examples/` and `test/fixtures/brief-*.json`.

- Short motion copy in the user's dialect; `emphasis` words must appear in the copy.
- Numbers, charts, tables, testimonials, ratings: **only** if the user gave them, each with its real `source`.
- User files are relative to the brief and are never edited, recoloured, cropped or regenerated.
- No developer names, handles, watermarks or "made with" text anywhere.
- Optional: `reference` (image/video/website the user likes; principles are extracted, never copied) · `formats: ["16:9","1:1"]` (extra formats are re-laid-out, not cropped) · `loop: true` · `motion` (premium, energetic, playful, corporate, cinematic, tech, sport) · `content.flow` (product journey states) · `content.form` · `content.table` · `content.integrations` · `capture: true` with `content.ui.url` (real screenshot of the site) · `chapters` for long videos.
- Backgrounds are clean large forms. Dots, grids, particles, halftone only if the user explicitly asks.

## 3. Run

```bash
npm run create -- path/to/brief.json [--out <folder>] [--name <file>] [--animatic true] [--no-logo true]
```

- Exit `2` + JSON `questions`: ask them (already worded), update the brief, run again.
- Exit `0`: the MP4 passed final QC with zero critical issues. Next to it: `<name>.quality-report.json`, contact sheet, phone-view sheet.
- Exit `1`: read the error (what, why, what to do). Fix the brief/files; never hide it.

Step by step: `npm run direct -- brief.json` → (edit `video.json` or `npm run studio`) → `npx tsx cli/nitaaq.ts animatic <projectDir>` (fast low-res check) → `npm run render -- <projectDir>`.

Other commands (`npx tsx cli/nitaaq.ts …`): `classify <brief>` · `reference <file|url>` · `beats <audio>` · `capture <url> <out.png> [--mobile true]` · `recompose <projectDir> --aspects 16:9,1:1` · `cache summary|clear [ns]` · `preflight [--full]`.

Render profiles: `preview` (fast, low-res) · `animatic` (half-res, 15 fps, for timing) · `draft` · `production` (final).

## 4. Deliver

Give the MP4 path, duration, format, style + motion personality and why (`project_brief.md`), the QC scores and any warnings, and the time it took (`performance_report.json`). Never call a render finished if QC did not pass; never claim tests you did not run.

## Project memory (per project folder)

`project_brief.md`, `brand.json`, `reference_style.json`, `assets_manifest.json`, `storyboard.json`, `shotlist.json`, `motion_spec.json`, `audio_cues.json`, `beats.json`, `video.json`, `quality_report.json`, `performance_report.json`, `review_log.md` (+ `ANIMATION_GUIDE.md` for long-form). Read them before editing an existing video instead of re-deriving decisions.

## Reference

Scenes `docs/SCENE_LIBRARY.md` (71 families) · Styles `docs/STYLE_LIBRARY.md` (21) · Motion `docs/MOTION_SYSTEM.md` · Audio `docs/AUDIO.md` · Brand `docs/BRAND_SYSTEM.md` · Reference `docs/REFERENCE_SYSTEM.md` · Performance `docs/PERFORMANCE.md` · Quality `docs/QUALITY.md` · Problems `docs/TROUBLESHOOTING.md` · Architecture `docs/ARCHITECTURE.md` · Codex `AGENTS.md`
