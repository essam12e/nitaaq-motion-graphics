# AGENTS.md — نطاق | موشن جرافيك (NITAAQ | Motion Graphics) (Codex and other coding agents)

This repository is a skill/tool that turns a natural-language request into a quality-checked motion-graphics MP4. Claude Code reads `SKILL.md`; Codex reads this file. Both drive the **same engine** through the same CLI.

## Trigger

Use this tool when the user asks for: «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Motion graphics video", "Create a motion video", or any animated ad / explainer / promo / reel.

## Workflow

1. `npm run setup` once (`npm ci` only when the lockfile changed, fonts, preflight). `npm run preflight` must say `ready` (cached; `--full` to force). Never `npm install` per video.
2. Ask what is missing (objective, platform/aspect, copy, CTA, files). If the brand is unknown ask exactly once:
   «هل عندك شعار أو هوية بصرية تبغى نعتمدها في الفيديو؟ إذا عندك أرسل الشعار، وإذا ما عندك أكمل لك بهوية مناسبة للمحتوى.»
3. Write `brief.json` (schema `schemas/brief.schema.json`, examples in `examples/`). Copy in the user's language/dialect (default MSA). Only real numbers/quotes with a real `source`.
4. `npm run create -- brief.json --out <folder> --name <file>`
   - exit 2 → print/ask the JSON `questions`, update the brief, rerun
   - add `--animatic true` for a fast low-res timing check before the final render (automatic for ADVANCED/LONG_FORM briefs)
   - exit 0 → deliver `<folder>/<file>.mp4` + `<file>.quality-report.json` (+ one MP4 per extra `formats` entry)
   - exit 1 → show the readable error; fix; never hide it
5. Ad variants: `npx tsx cli/nitaaq.ts variants brief.json --strategies problem-first,offer-first --aspects 9:16,1:1 [--plan-only true]` (one recomposed film per strategy × aspect; unsupported strategies listed in `<base>.variants-report.json`).
6. Report honestly: QC scores, warnings, repairs applied, time taken (`performance_report.json`).

Optional brief fields: `genre` / `visualMode` (otherwise auto-classified; modules load lazily), `content.products|tease|lines|map|illustration`, `audio.music` > `audio.musicLicense` > `audio.soundtrack` (procedural) > none, `audio.sfxIntensity`, `audio.soundPersonality`, `preferences.gsap`, `preferences.logoReveal`, `reference` (style principles from an image/video/site, never copied), `formats` (recomposed, not cropped), `loop`, `motion` personality, `content.flow|form|table|integrations`, `capture` + `content.ui.url`, `chapters`. Per-project memory files (`project_brief.md`, `brand.json`, `motion_spec.json`, `shotlist.json`, `beats.json`, …) record every decision: read them before editing a video.

## Hard rules

- No developer/tool identity, @handles, watermarks or "made with" text in any output.
- Never invent a logo, statistics, testimonials, reviews or claims.
- Never alter or distort the user's logo, product photos or screenshots.
- Never fabricate data, map locations or geo data.
- Rendering is deterministic: no `Math.random` / `Date.now` in render code (seeded RNG only).
- No dot/grid/particle/halftone backgrounds unless the user asks (`design/banned-patterns.json`, enforced in generation and QC).
- No robotic TTS fallback; voice cloning is not enabled.
- Never download copyrighted music.
- API keys only from environment variables; never write them to files or logs; never commit `.env`.
- A video is delivered only when QC reports zero critical issues. Do not claim tests you did not run.
- Do not push or publish anything without explicit authorization.

## Developer commands

```
npm run typecheck        # tsc
npm test                 # vitest unit tests
npm run test:visual      # visual regression (renders stills, compares to test/visual/baseline)
npm run gallery -- --aspect 9:16 --style saudi-modern --variants all
npx tsx cli/test-videos.ts --profile production   # the 18 acceptance videos (+ animatic, recompose)
npx tsx cli/benchmark.ts --label after           # benchmark A–D → workspace/performance-report.after.json
npx tsx cli/nitaaq.ts cache summary              # content-addressed cache in .cache/nitaaq-motion/
npm run studio           # local editor on http://127.0.0.1:4455
npx tsx cli/gen-docs.ts  # regenerate docs/SCENE_LIBRARY.md and STYLE_LIBRARY.md
```

Code map: `docs/ARCHITECTURE.md`. Adding scenes/styles/voice providers: same file, "Extending".
