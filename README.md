# Arabic Motion Director

Arabic-first AI motion-graphics director. A natural-language request becomes a finished, quality-checked MP4:

```
request → brief.json → intake (questions) → brand (logo → palette, or generated direction)
        → creative plan → storyboard → video.json → validation + repair
        → Remotion render (H.264) → automated QC (DOM + pixels + audio + MP4) → auto-repair (≤3 passes) → MP4
```

- **63 scene families / 185 variants** (typography, brand, UI, mobile, commerce, data, media, infographic, cinematic, social, CTA) as plugins in a `SceneRegistry` — see [docs/SCENE_LIBRARY.md](docs/SCENE_LIBRARY.md).
- **18 style presets** + brand overrides — [docs/STYLE_LIBRARY.md](docs/STYLE_LIBRARY.md).
- **9:16, 16:9, 1:1, 4:5** with platform safe areas (TikTok, Reels, Feed, Shorts, YouTube, generic).
- **Arabic done right:** RTL, contextual shaping preserved (no letter-spacing, no split glyphs), Arabic punctuation, numeral system per project, mixed Arabic/English, a text fitter that never silently overflows.
- **Brand:** logo (png/jpg/webp/svg) → contrast-safe palette; without a logo → a generated direction and **no fake logo** — [docs/BRAND_SYSTEM.md](docs/BRAND_SYSTEM.md).
- **Audio:** no voice / your recording synced to its phrases / premium TTS only (no robotic fallback); music with fades, loop, trim and ducking; 26 CC0 SFX with enable/intensity/volume — [docs/AUDIO.md](docs/AUDIO.md).
- **Zero watermark.** No tool or developer identity anywhere, including MP4 metadata.
- **Motion Studio** editor: Player preview, timeline, inspector, undo/redo, save/validate/render.

## Install

Requirements: Node ≥ 18.18. ffmpeg is used from the system if present, otherwise Remotion's bundled binaries. A headless Chrome is found automatically (or downloaded by Remotion on first render).

```bash
npm run setup        # npm install + font sync + preflight
npm run preflight    # must end with "ready"
```

## Use

```bash
# one command: brief → MP4 (render + QC + repair). Exit 2 = questions for the user.
npm run create -- examples/brief-tech-ad.json --out ./out --name my-ad

# step by step
npm run direct   -- brief.json                  # → workspace/projects/<id>/{plan,storyboard,video}.json
npm run validate -- workspace/projects/<id> --fix
npm run preview  -- workspace/projects/<id>     # fast preview MP4 (not QC'd)
npm run render   -- workspace/projects/<id>     # production render + QC + auto-repair → renders/final/
npm run quality  -- workspace/projects/<id> --video file.mp4
npm run studio                                   # http://127.0.0.1:4455

npx tsx cli/amd.ts scenes | styles | voices | brand logo.png | schema-export | workspace
```

Render profiles: `preview` (½ scale, CRF 28), `draft` (¾, CRF 23), `production` (full, CRF 18, x264 medium). All outputs: H.264, yuv420p, BT.709, AAC audio; encoder "made with" tags are stripped.

### From Claude Code

The folder is a skill: `SKILL.md` (triggers: «أنشئ فيديو موشن», «سوي لي فيديو موشن», «موشن جرافيك», "Motion graphics video", "Create a motion video"). Install it as a skill (copy or symlink the folder into `~/.claude/skills/arabic-motion-director`, or `.claude/skills/` in a project), run `npm run setup` once, then ask Claude for a motion video. See `adapters/claude-code/`.

### From Codex

Codex reads `AGENTS.md` in the repository root. Open this folder (or add it to your workspace) and ask for a motion video; Codex runs the same `npm run create` pipeline. See `adapters/codex/`.

## Environment

Copy `.env.example`. Paths: `MOTION_WORKSPACE`, `MOTION_UPLOADS`, `MOTION_OUTPUT`, `MOTION_CACHE`. Optional TTS keys: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` — read from the environment only, never stored in projects or logs, never committed.

## Repository layout

```
SKILL.md, AGENTS.md          agent entry points (Claude Code / Codex)
cli/amd.ts                   CLI (create, direct, produce, validate, render, quality, brand, preflight, scenes, styles, schema-export)
cli/test-videos.ts           acceptance videos A–E
cli/gallery.ts               scene gallery / contact sheets
cli/make-test-audio.ts       synthesizes the original test music bed + simulated voice
cli/gen-docs.ts              regenerates SCENE_LIBRARY / STYLE_LIBRARY
src/schema/                  Zod schemas (brief, video.json, plan/storyboard); JSON Schema in schemas/
src/director/                intake, direction, recipes, plan, storyboard, compile
src/node/                    direct, produce, render, preflight, audio, tts, fonts, assets, bundle, workspace
src/engine/                  VideoComposition, audio layer, QC probe
src/scenes/                  scene families (plugins) + registry
src/styles, typography, layout, motion, components, brand, audio, transitions
src/qc/                      quality agent + repair loop
src/validation/              validation + deterministic repair
studio/                      Motion Studio (server + editor)
test/unit, test/visual, test/e2e, test/fixtures
docs/                        ARCHITECTURE, SCENE_LIBRARY, STYLE_LIBRARY, AUDIO, BRAND_SYSTEM, TROUBLESHOOTING, TEST_RESULTS
```

## Tests

```bash
npm run typecheck
npm test                                  # unit tests (schemas, registry, Arabic, fitting, director, voice sync, audio, brand, repair, security)
npm run test:visual                       # visual regression of every scene family at 9:16 and 16:9
node test/e2e/studio.e2e.mjs              # Studio end-to-end (needs `npm run studio` + Playwright)
npx tsx cli/test-videos.ts --profile production   # acceptance videos A–E
```

Real results of the last run: [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md).

## Limitations

See [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md#limitations).

## Licenses

Fonts: SIL Open Font License (see `public/fonts/*/LICENSE`). SFX: CC0 (`public/sfx/CREDITS.md`). Test music and simulated voice: synthesized by `cli/make-test-audio.ts` (CC0). No third-party music is included or downloaded.
