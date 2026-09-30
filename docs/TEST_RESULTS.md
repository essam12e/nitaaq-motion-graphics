# Test results

Last full run: 2026-09-30, Linux container (4 cores, Node 22.22, system ffmpeg, Chromium headless shell 1194). Everything below was actually executed; numbers are copied from the run output.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (0 errors) |
| Unit tests | `npm test` | **131 / 131 passed** (schemas, registry, Arabic shaping/bidi/numerals, text fitting, director, voice sync, audio planning, brand, validation + repair, security/secret scrubbing, workspace I/O, MP4 encoder-string removal) |
| Visual regression | `npm run test:visual` | **126 / 126 passed** — every scene family rendered at 9:16 and 16:9 and compared with `test/visual/baseline` (≤ 1 % differing pixels); run three times, including after the last engine changes |
| Studio end-to-end | `node test/e2e/studio.e2e.mjs` (Playwright + Chromium) | pass — scene clips mount, edit, undo/redo, validate, save, API-key scrubbing on save |
| Preflight | `npm run preflight` | `ready` (TTS reported as optional/not configured) |

## Acceptance videos (production profile: full resolution, CRF 18, x264 medium)

All six videos come from one final run (`npx tsx cli/test-videos.ts --profile production`) on the committed code. Each ran the whole pipeline: brief → intake → brand → plan → storyboard → video.json → validation → render → QC → auto-repair (≤ 3 passes) → re-render → final QC.

| Test | What | Output | Scenes chosen by the Director | Auto-repairs | Final QC |
|---|---|---|---|---|---|
| A | GCC tech ad, 9:16, test logo, no voice (SFX) | 1080×1920, 19.6 s, 15 MB | kinetic-title/stack → problem-solution/strike → logo-reveal/scale-glow → feature-set/stack → browser-scene/navigate → cta-logo/lockup | none needed | 0 critical · 0 error · 0 warning |
| B | E-commerce, 9:16, product photo, music + SFX | 1080×1920, 16.9 s, 3.3 MB | kinetic-title/stack → product-showcase/hero → feature-set/stack → price-offer/badge → cta-contact/card | offer scene scaled 1 → 0.92 (TEXT_OUTSIDE_SAFE) | 0 · 0 · 0 |
| C | SaaS explainer, 16:9, dashboard screenshot + browser, mixed Arabic/English | 1920×1080, 32.1 s, 3.7 MB | kinetic-title → problem-solution/flip → brand-intro/wordmark → browser-scene/zoom → process-steps/path → feature-set/grid → bar-chart/vertical → cta-qr/side | layout grown ×1.09 (LAYOUT_UNDERFILLED); chart scene extended 3.38 → 5.48 s (HOLD_TOO_SHORT) | 0 · 0 · 0 |
| D | User voiceover (simulated recording), 9:16, scenes cut to its phrases | 1080×1920, 18.2 s, 1.3 MB | kinetic-title/impact → problem-solution/strike → feature-set/staggered → cta-button/pulse | layout grown ×1.25 | 0 · 0 · 0 |
| E | Long Arabic text stress test, 4:5 | 1080×1350, 30.1 s, 1.4 MB, no audio (brief has no music/voice) | line-reveal/mask → icon-list/checklist → process-steps/path → comparison-table/versus → cta-clean/stacked | none needed | 0 · 0 · 0 |
| F | Brief A re-targeted to 1:1 (Instagram feed) | 1080×1080, 19.1 s, 8.1 MB | same story, square layouts (feature grid instead of stack) | none needed | 0 · 0 · 0 |

Audio loudness measured on the final MP4s (ffmpeg ebur128): A −23.5 LUFS (SFX only), B −21.3, C −22.2, D −17.9 (voice-led, music ducked under the voice). No clipping (true peak ≤ −9 dBTP).

Every MP4 was checked for leftover encoder strings (`x264 - core`, `Lavf`): none found.

MP4s, QC reports and contact sheets are in `renders/` (not committed to git).

### Problems the runs found, and what was changed

- **False TEXT_OVERFLOW during entrance animations** — the probe measured transformed (animating) words. It now measures laid-out widths (`offsetWidth`), which ignore transforms.
- **A was 195 MB for 19 s** — the film-grain layer moved every frame, which H.264 cannot compress. Grain is now static (A: 15 MB), and QC warns (`MP4_BITRATE_HIGH`) above 30 Mbit/s.
- **D reported VOICE_DRIFT of up to 4.4 s although scenes were in sync** — QC compared the scene with the wrong phrase (group index used as phrase index). It now uses the phrase's absolute time and accepts a phrase that starts while its scene is entering.
- **E had a 24-word paragraph squeezed into a list heading** (TEXT_FIT_FAIL that shrinking could not fix). A list heading now only takes a short line; a long problem paragraph is carried by its points. Regression test added.
- **x264/Lavf strings inside the MP4** — the files carried the encoder's name and settings. A lossless remux after every render now removes all tags and the x264 SEI; QC warns (`ENCODER_STRING`) if any survive.
- **B's "عرض خاص" badge measured 3.4:1 contrast** — a mid-tone accent passes 4.5:1 with neither white nor black text; the badge background is now shifted just enough in lightness.

## Limitations

- **Premium TTS** (ElevenLabs / OpenAI adapters) is implemented behind the `VoiceProvider` interface but was **not exercised against the live APIs** — no keys were configured here. Without a provider the pipeline refuses TTS and offers: no voice, upload a recording, or configure a provider. There is no robotic fallback. Voice cloning is not implemented.
- **Test D uses a synthesized tonal "voice"** (`cli/make-test-audio.ts`) with known phrase timing, not human speech. Phrase detection matched the ground truth; a real recording with breaths/background noise may need `--clean-voice` or a transcript for best grouping.
- **Visual QC is automated heuristics** (DOM geometry, text fitting, contrast sampling, coverage, blank-frame and asset checks, MP4 and loudness checks). It catches clipping, overflow, safe-area, contrast, blank scenes, broken assets and timing; it does not judge taste. Some portrait scenes still read slightly sparse (a warning-level signal, not an error).
- **Browsers:** rendering and the Studio were tested only in Chromium (headless shell 1194 and Chromium via Playwright). Other browsers are not claimed.
- **Music:** only the synthesized CC0 test bed ships; no licensed library is bundled or downloaded. Use your own track or configure a licensed library folder.
- **Video clips as assets** are accepted by the schema/asset manager but were not part of the acceptance videos.
- **Files copied into a shared storage that adds provenance data:** in this project's shared folder the storage layer itself embeds a C2PA "content credentials" manifest into media files it stores (the PNG/MP4/MP3 copies there are a few KB larger than the originals). That is added by the platform, not by the skill; files rendered locally by the skill contain no such data.
- Visual regression covers 9:16 and 16:9; 1:1 and 4:5 are covered by acceptance videos F and E.
