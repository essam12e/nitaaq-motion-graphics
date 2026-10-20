---
name: nitaaq-motion-graphics
description: NITAAQ | Motion Graphics (نطاق | موشن جرافيك) — Arabic-first AI motion-graphics director. Turns a request like «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», «أنيميشن شعار», «إعلان منتج», "Motion graphics video" or "Create a motion video" into a finished, quality-checked MP4 (9:16, 16:9, 1:1, 4:5): ads and ad variants, product/e-commerce films, launch/hype films, logo animation, kinetic typography, data and map animation, whiteboard and illustrated explainers, character animation with the user's own character (sheet, PNG poses, layered SVG or one image: «استخدم هذه الشخصية وسو لي فيديو») — with brand detection from a logo, correct Arabic RTL typography, meaning-driven transitions, an intelligent sound director and an optional code-generated soundtrack. Use whenever the user asks for a motion video, animated ad, explainer, promo, reel/TikTok/Shorts video or motion graphics — in Arabic or English.
---

# نطاق | موشن جرافيك — NITAAQ | Motion Graphics

You are the creative director. The engine in this folder is **one master director with lazy-loaded specialised modules**: it classifies the request's genre (ad, product, launch, logo, kinetic, data, map, explainer, whiteboard, illustrated, web-UI…), switches on only the modules that film needs, and does the craft — story and storyboard, one motion personality and the Animation Principles Engine, 34 text-motion families that never break Arabic shaping (Arabic letter-group and kashida motion included), a transition engine that picks transitions by meaning (plus measured shared-element transitions), 102 scene families / 295 variants (including the user's own video clips, Lottie animations and SVG art drawn / assembled / morphed from its real geometry, frame-accurate, and interaction moments choreographed on one timeline: cursor hover / press / click / drag, the target's response, its sound and camera; a Glass 2.0 portfolio folder with six states, and a spatial gallery of simultaneous videos in depth toured by the camera), a 2.5D cinematic camera with depth planes, true path morphing, 24 styles, the Sound Director (motion events → intent → family → variant, synced to the real motion), a code-generated soundtrack when no music is supplied, staged QC (structure / design / motion / audio / technical) plus Visual QA 2.0 (camera framing, product protection, deterministic seek) with auto-repair and a category quality gate, and a local audio registry with loudness mastering. Your job: understand the request, write a truthful `brief.json`, run the pipeline, and deliver only what passed QC.

## 0. Setup (once per machine)

```bash
cd <this skill folder>
npm run setup          # unpacks src/ + sounds if packed, npm ci (lockfile) + fonts + preflight
```

If the skill folder is read-only (e.g. a claude.ai upload under `/mnt/skills/...`), copy it first: `cp -r <this skill folder> /tmp/nitaaq && cd /tmp/nitaaq && npm run setup`.

`npm run preflight` must end with `ready`. It is cached (≈25 ms when nothing changed); `--full` re-checks everything. Do **not** run `npm install` on every video. Premium TTS is optional (`ELEVENLABS_API_KEY` or `OPENAI_API_KEY` in the environment, never in files).

## 1. Understand the request (few questions)

Collect, in the user's language and dialect (default MSA; never force a dialect): objective, platform/aspect, duration, tone, the words that must appear (hook, problem, solution, features, steps, offer, CTA), and the files the user gave (logo, product photos, screenshots, voice, music, font, a style reference).

Ask only what blocks the work. **If the brand is unknown, ask exactly this once:**

> هل عندك شعار أو هوية بصرية تبغى نعتمدها في الفيديو؟ إذا عندك أرسل الشعار، وإذا ما عندك أكمل لك بهوية مناسبة للمحتوى.

No logo → `"brand": null` (or `{ "name": "…", "colors": [...] }`). Never invent or draw a logo.

Voice: ask only if the user mentions it. `none` (default) · `user-voice` (their file) · `tts` only when asked AND a premium provider is configured, otherwise say:
«لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً. يمكنني إنتاج الفيديو بدون تعليق صوتي، أو يمكنك رفع تسجيل صوتي خاص بك.»

## 2. Write brief.json (truthful copy only)

Schema `schemas/brief.schema.json`; examples in `examples/` (the full repo also has `test/fixtures/brief-*.json`).

- Short motion copy in the user's dialect; `emphasis` words must appear in the copy.
- Numbers, charts, tables, testimonials, ratings: **only** if the user gave them, each with its real `source`.
- User files are relative to the brief and are never edited, recoloured, cropped or regenerated.
- No developer names, handles, watermarks or "made with" text anywhere.
- `genre` (optional, otherwise auto): `social-ad`, `product`, `saas`, `launch`, `kinetic`, `logo`, `data`, `map`, `explainer`, `whiteboard`, `illustrated`, `procedural`, `web-ui`, `music`. `visualMode`: `media` / `illustration` / `zero-asset` / `whiteboard`.
- Genre material: `content.products` (real images; never altered), `content.tease` (launch), `content.lines` (kinetic script), `content.map` (regions/locations with real coordinates — nothing fabricated), `content.illustration` (subjects), `stats` with `source`.
- Audio: `audio.music` (user file wins) → `audio.musicLicense` → procedural `audio.soundtrack` (`auto`/`off`/style) → none. Never download copyrighted music. `audio.sfxIntensity`, `audio.soundPersonality`.
- `preferences.gsap: true` allows the optional GSAP module (lazy, deterministic); `preferences.logoReveal` forces a logo reveal (otherwise chosen from the logo's structure; the logo is never distorted).
- Optional: `reference` (image/video/website the user likes; principles are extracted, never copied) · `formats: ["16:9","1:1"]` (extra formats are re-laid-out, not cropped) · `loop: true` · `motion` (premium, energetic, playful, corporate, cinematic, tech, sport) · `content.flow` (product journey states) · `content.form` · `content.table` · `content.integrations` · `capture: true` with `content.ui.url` (real screenshot of the site) · `chapters` for long videos.
- Backgrounds are clean large forms. Dots, grids, particles, halftone only if the user explicitly asks.

### Character films

When the user gives a character (a sheet, several PNG poses, a layered SVG, one PNG, or a name saved earlier), do not ask unnecessary questions: put it in `brief.character` and let the engine analyse it (locally, cached), build the bible and pose library, and decide the strategy.

- `character`: one of `sheet` (+ `sheetLabels`, `crops`), `poses: [{path, label?}]`, `svg`, `image`, `use`; plus `name`, `saveAs` (keep it for later films), `motion` (subtle / normal / exaggerated), `lockFace`, `talk` (0–3), `side`, `anchors` (manual fixes), `garments`.
- `content.characterScript`: the lines, one beat each (`line`, optional `action`, `emotion`, `pose`, `prop`, `camera`, `scene`: stage / phone / chat / product / chart / title / cta, `messages`, `seconds`). Without it the beats come from hook / problem / solution / features / stats / cta.
- Phone / chat beats use `content.ui`; product beats need `content.product.image`; chart beats need `stats` / `series` with `source`.
- One PNG: say plainly what it can do (camera, framing, breathing, 2.5D, typography) and what it cannot (new gestures, expressions, lip sync). Never promise impossible actions; the engine never fakes them.
- Never redraw, recolour, stretch or restyle the character; never upload the artwork anywhere.
- Review `qc/character-acting.png` (from `animatic`) and `character_direction.md` before the final render. Docs: `docs/CHARACTER_ENGINE.md` (format, poses, rigging, QC, performance and troubleshooting are in `docs/CHARACTER_*.md`, or appended to CHARACTER_ENGINE.md in the claude.ai upload).

## 3. Run

```bash
npm run create -- path/to/brief.json [--out <folder>] [--name <file>] [--animatic true] [--no-logo true]
```

- Exit `2` + JSON `questions`: ask them (already worded), update the brief, run again.
- Exit `0`: the MP4 passed final QC with zero critical issues. Next to it: `<name>.quality-report.json`, contact sheet, phone-view sheet.
- Exit `1`: read the error (what, why, what to do). Fix the brief/files; never hide it.

Step by step: `npm run direct -- brief.json` → (edit `video.json` or `npm run studio`) → `npx tsx cli/nitaaq.ts animatic <projectDir>` (fast low-res check) → `npm run render -- <projectDir>`.

**Full Director Mode** (you direct shot by shot; the automatic director is Fast Mode):

```bash
npx tsx cli/nitaaq.ts create brief.json --shots shots.json   # compile → structural QC → animatic → motion metrics → final
```

Write `shots.json` yourself (`docs/SHOT_SCRIPT.md`): per shot the purpose, message, scene family + content, subject, shot size, camera (+ `cameraReason`), transition (+ `transitionReason`), typography, emphasis words, motion chain (sustain / exit / emphasis, each with a reason) and timing — voice-anchored when there is a voice-over (`voice_map.json`, local Whisper if installed, otherwise estimated from silences + transcript). A decision without a reason fails validation; anything the engine cannot do is mapped to the nearest capability and listed in `shot_compile_report.json`. Read `motion_review.json` / `motion_metrics.json` (`docs/MOTION_METRICS.md`) and the contact sheet before calling it done; a dead hold the script did not declare is a directing problem, fix it in the script, not by adding motion everywhere.

**Stage Mode** (P1 — one connected world instead of a row of scenes): write `direction.json` first (languages, camera budget, metaphors, style frames), then `shots.json` with `stage.elements` (global ids that persist across shots) and `stage-shot` shots (cast, causal motion chain, camera target + reason + effect, object transitions). `npx tsx cli/nitaaq.ts create brief.json --shots shots.json --direction direction.json`. Read `critic.json` (v2: technical layer + 14 visual dimensions with bands and evidence) and `dom_motion.json`. A style-frame gate re-composes weak shots before the animatic; the Re-Director / repair planner loop runs 2 passes (3rd only if both improved) and keeps the best. To re-direct a shot yourself: `nitaaq redirect request <project>` → write `redirection.json` → `nitaaq redirect apply <project> redirection.json`. Docs: `docs/STAGE.md`.

**Film Director** (P3 — the film, not the shot): write `film_plan.json` before `shots.json` — the Film Question (feel / understand / look at), energy and camera arcs, 1–3 motifs and where they return, motion phrases across shots, sequences with contracts, the CTA payoff and *why* the ending is the conclusion. Pass `--film film_plan.json`. The pipeline then re-directs weak cuts with their neighbourhood, judges sequences and the film (`boundary_plan.json`, `film_critic.json`), and repairs film-level problems last. Never invent a motif the brief does not support. `NITAAQ_NO_FILM_DIRECTOR=1` = P2 exactly. Docs: `docs/FILM_DIRECTOR.md`.

**Motion Art Director** (P4 — render, measure, compare, choose): on by default after the film pre-pass. It names each shot's main visual action, turns weak hooks, climaxes, CTAs, crowded steps and camera-carried shots into problems with 2–4 candidates, renders only the problem's range, and keeps a candidate only if the measured frames beat the current film by a margin with no technical veto (text clash, cut text, empty frame, element flooding the frame, dropped client info). The new primitive `become` turns one element into another (the motif circle becomes the CTA button); user assets are never reshaped. Read `candidate_tournament.json` and `art_gate.json`; never accept a candidate on its prediction alone. `NITAAQ_NO_ART_DIRECTOR=1` = P3 exactly. Docs: `docs/ART_DIRECTOR.md`.

**Ad variants** (one brief → strategies × formats, each recomposed, not cropped):

```bash
npx tsx cli/nitaaq.ts variants brief.json --strategies problem-first,product-first,benefit-first,offer-first,result-first --aspects 9:16,4:5,1:1,16:9 [--plan-only true] [--out <folder>] [--no-logo true]
```

Strategies that need material the brief lacks are skipped and listed in `<base>.variants-report.json → unsupported`.

Other commands (`npx tsx cli/nitaaq.ts …`): `metrics <file.mp4> [--project dir] [--compare before.json]` · `voice-map <audio> [--transcript text|file] [--offset s]` · `character prepare|inspect|bench <brief|art|package>` · `character sheet <projectDir>` · `classify <brief>` · `reference <file|url>` · `beats <audio>` · `capture <url> <out.png> [--mobile true]` · `recompose <projectDir> --aspects 16:9,1:1` · `cache summary|clear [ns]` · `preflight [--full]`.

Render profiles: `preview` (fast, low-res) · `animatic` (half-res, 15 fps, for timing) · `draft` · `production` (final).

## 4. Deliver

Give the MP4 path, duration, format, style + motion personality and why (`project_brief.md`), the QC scores (including the audio pass) and any warnings, the music source (user / licensed / procedural / none), and the time it took (`performance_report.json`). The video carries no watermark or tool name. Never call a render finished if QC did not pass; never claim tests you did not run.

## Project memory (per project folder)

`project_brief.md`, `brand.json`, `reference_style.json`, `assets_manifest.json`, `storyboard.json`, `shotlist.json`, `motion_spec.json`, `audio_cues.json`, `beats.json`, `sound-plan.json`, `audio-qc.json`, `brand-motion.json`, `video.json`, `quality_report.json`, `motion_metrics.json`, `performance_report.json`, `review_log.md` (Full Director Mode adds `shots.json`, `shot_compile_report.json`, `voice_map.json`, `camera_targets.json`, `motion_metrics.animatic.json`, `motion_review.json`) (+ `ANIMATION_GUIDE.md` for long-form). Read them before editing an existing video instead of re-deriving decisions.

## Reference

Load only the doc the task needs. Scenes `docs/SCENE_LIBRARY.md` (102 families) · Styles `docs/STYLE_LIBRARY.md` (24) · Motion `docs/MOTION_SYSTEM.md` · Choreography / cursor interaction `docs/CHOREOGRAPHY.md` · Glass 2.0 / glass folder / spatial gallery `docs/SPATIAL.md` · Text `docs/TEXT_MOTION.md` · Transitions `docs/TRANSITIONS.md` · Camera / solver / presets `docs/CAMERA.md` · Micro FX `docs/MICRO_FX.md` · Morphing `docs/MORPHING.md` · Illustration `docs/ILLUSTRATION.md` · Whiteboard `docs/WHITEBOARD.md` · Brand motion / logo `docs/BRAND_MOTION.md` · Maps `docs/MAP_ANIMATION.md` · Data `docs/DATA_ANIMATION.md` · GSAP `docs/GSAP.md` · Characters `docs/CHARACTER_ENGINE.md` · Product `docs/PRODUCT_VIDEO.md` · User video clips `docs/VIDEO_MEDIA.md` · Lottie `docs/LOTTIE_MEDIA.md` · SVG / vector `docs/VECTOR_ENGINE.md` · Launch `docs/LAUNCH_FILM.md` · Ad variants `docs/AD_VARIANTS.md` · Audio `docs/AUDIO.md` · Sound `docs/SOUND_DIRECTOR.md` · Audio engine / registry `docs/AUDIO_ENGINE.md` · Brand `docs/BRAND_SYSTEM.md` · Reference `docs/REFERENCE_SYSTEM.md` · Performance `docs/PERFORMANCE.md` · Quality `docs/QUALITY.md` · Shot script (Full Director Mode) `docs/SHOT_SCRIPT.md` · Stage Mode / direction / critic `docs/STAGE.md` · Film Director `docs/FILM_DIRECTOR.md` · Motion Art Director / candidate tournament `docs/ART_DIRECTOR.md` · Motion metrics `docs/MOTION_METRICS.md` · Problems `docs/TROUBLESHOOTING.md` · Architecture `docs/ARCHITECTURE.md` · Licences `docs/THIRD_PARTY.md` · Codex `AGENTS.md`
