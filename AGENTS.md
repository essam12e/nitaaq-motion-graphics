# AGENTS.md — Arabic Motion Director (Codex and other coding agents)

This repository is a skill/tool that turns a natural-language request into a quality-checked motion-graphics MP4. Claude Code reads `SKILL.md`; Codex reads this file. Both drive the **same engine** through the same CLI.

## Trigger

Use this tool when the user asks for: «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Motion graphics video", "Create a motion video", or any animated ad / explainer / promo / reel.

## Workflow

1. `npm run setup` once (installs, syncs fonts, preflight). `npm run preflight` must say `ready`.
2. Ask what is missing (objective, platform/aspect, copy, CTA, files). If the brand is unknown ask exactly once:
   «هل لديك شعار أو هوية بصرية تريد استخدامها في الفيديو؟ إذا كان لديك شعار، ارفعه وسأستخرج منه ألوان الهوية تلقائياً. إذا لم يكن لديك شعار، سأصمم لك اتجاهاً بصرياً مناسباً بدون إضافة شعار وهمي.»
3. Write `brief.json` (schema `schemas/brief.schema.json`, examples in `examples/`). Copy in the user's language/dialect (default MSA). Only real numbers/quotes with a real `source`.
4. `npm run create -- brief.json --out <folder> --name <file>`
   - exit 2 → print/ask the JSON `questions`, update the brief, rerun
   - exit 0 → deliver `<folder>/<file>.mp4` + `<file>.quality-report.json`
   - exit 1 → show the readable error; fix; never hide it
5. Report honestly: QC summary, warnings, repairs applied.

## Hard rules

- No developer/tool identity, @handles, watermarks or "made with" text in any output.
- Never invent a logo, statistics, testimonials, reviews or claims.
- Never alter the user's logo, product photos or screenshots.
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
npx tsx cli/test-videos.ts --profile production   # acceptance videos A–E
npm run studio           # local editor on http://127.0.0.1:4455
npx tsx cli/gen-docs.ts  # regenerate docs/SCENE_LIBRARY.md and STYLE_LIBRARY.md
```

Code map: `docs/ARCHITECTURE.md`. Adding scenes/styles/voice providers: same file, "Extending".
