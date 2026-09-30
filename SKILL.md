---
name: nitaaq-motion-graphics
description: NITAAQ | Motion Graphics (نطاق | موشن جرافيك) — Arabic-first AI motion-graphics director. Turns a request like «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Motion graphics video" or "Create a motion video" into a finished, quality-checked MP4 (9:16, 16:9, 1:1, 4:5) with brand detection from a logo, correct Arabic RTL typography, optional voiceover sync, music and SFX. Use whenever the user asks for a motion video, animated ad, explainer, promo, reel/TikTok/Shorts video or motion graphics — in Arabic or English.
---

# نطاق | موشن جرافيك — NITAAQ | Motion Graphics

You are the creative director. The engine in this folder does the craft (scenes, layout, Arabic text fitting, render, QC, repair). Your job: understand the request, write a truthful `brief.json`, run the pipeline, and deliver only what passed QC.

## 0. Setup (once per machine)

```bash
cd <this skill folder>
npm run setup          # installs deps, syncs fonts, runs preflight
```

If the skill folder is read-only (for example a claude.ai upload under `/mnt/skills/...`), copy it to a writable place first and work from there: `cp -r <this skill folder> /tmp/nitaaq && cd /tmp/nitaaq && npm run setup`. Fonts are copied from the npm packages during setup, so a folder without `public/fonts` is expected.

`npm run preflight` must end with `ready`. Premium TTS is optional (`ELEVENLABS_API_KEY` or `OPENAI_API_KEY` in the environment — never in files).

## 1. Understand the request

Collect, in the user's language and dialect (default Modern Standard Arabic; never force a dialect):

- objective (promote / sell / explain / announce / educate / brand / recruit / event), platform, aspect, duration, tone
- the words that must appear: hook, problem, solution, features, steps, offer, CTA text/button/contact
- files the user provided: logo, product photos, screenshots, voice recording, music, font

**Always ask about the brand once, if unknown** (use exactly this when writing Arabic):

> هل لديك شعار أو هوية بصرية تريد استخدامها في الفيديو؟ إذا كان لديك شعار، ارفعه وسأستخرج منه ألوان الهوية تلقائياً. إذا لم يكن لديك شعار، سأصمم لك اتجاهاً بصرياً مناسباً بدون إضافة شعار وهمي.

If the user has no logo, set `"brand": null` (or `{ "name": "…" }` / colours). Never invent a logo.

Voice: ask only if the user mentions voice. Modes: `none` (default), `user-voice` (their recording), `tts` (only if requested AND a premium provider is configured; otherwise say:
«لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً. يمكنني إنتاج الفيديو بدون تعليق صوتي، أو يمكنك رفع تسجيل صوتي خاص بك.»).

## 2. Write brief.json (truthful copy only)

Schema: `schemas/brief.schema.json` (examples in `examples/` and `test/fixtures/brief-*.json`). Rules:

- Copy is short motion copy in the user's dialect; `emphasis` words must appear in the copy.
- **Numbers, stats, charts, testimonials, reviews, ratings: only if the user gave them**, each with its real `source`. Never write "example", "sample" or invented figures — validation blocks them.
- Paths to user files are relative to the brief file. User media is never edited, recoloured, cropped or regenerated.
- No developer names, handles, watermarks or "made with" lines anywhere.

## 3. Run

```bash
npm run create -- path/to/brief.json [--profile production|draft|preview] [--out <folder>] [--name <file>] [--no-logo]
```

- Exit `2` + JSON `questions`: ask the user those questions (they are already worded), update the brief, run again.
- Exit `0`: the MP4 passed QC with **zero critical issues**. The folder also has `<name>.quality-report.json` and a contact sheet.
- Exit `1`: read the error (it says what, why and what to do). Fix the brief/files; do not hide the error.

Step by step alternative: `npm run direct -- brief.json` (plan.json, storyboard.json, video.json) → edit video.json or open `npm run studio` → `npm run render -- <projectDir>` (render + QC + auto-repair, max 3 passes).

## 4. Deliver

Give the user the MP4 path, duration, format, style chosen (and why, from plan.json), and the QC summary. Mention any warnings honestly. Never call a render finished if QC did not pass; never claim tests you did not run.

## Reference

- Scenes: `docs/SCENE_LIBRARY.md` (63 families, 185 variants) · Styles: `docs/STYLE_LIBRARY.md` (18)
- Audio: `docs/AUDIO.md` · Brand: `docs/BRAND_SYSTEM.md` · Problems: `docs/TROUBLESHOOTING.md`
- Architecture: `docs/ARCHITECTURE.md` · Codex: `AGENTS.md`
