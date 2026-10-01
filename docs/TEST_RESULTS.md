# Test results

Last full run: 2026-10-01, Linux container (4 cores, Node 22.22, system ffmpeg, Chromium headless shell 1194). Everything below was actually executed on the committed code; numbers are copied from the run output (`test-results.json`, `performance_report.json`, `dot-regression.json`).

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (0 errors) |
| Unit tests | `npm test` | **164 / 164 passed**. New since v1: motion physics, personalities, the background engine, the pattern detector (dot lattice, grid, clean gradient, masks), beat tracking (90/120/128 BPM within 3 %), the task classifier, the creative director (determinism, one hero, camera budget, no transition used 3× in a row, beat snapping), banned patterns, the effect budget, brand.json contrast-safe colours, multi-aspect recompose, and seamless loop. |
| Visual regression | `npm run test:visual` | **142 / 142 passed**: 71 families at 9:16 and 16:9. 9 baselines that changed beyond the threshold were re-accepted after review (feature-set: bigger portrait cards; phone-mockup, product-showcase, testimonial and cta-qr: small timing shifts from the new physics). 16 baselines are new (the new families). |
| Dot / grid regression | `npx tsx cli/dot-regression.ts` | **passed**. 8 styles (saudi-modern, tech, saas, ai-futuristic, neon, ecommerce, luxury, minimal) through real structural QC show 0 pattern findings. Two controls: dots the user explicitly allowed **are detected** (reported as info), and dots nobody asked for are replaced by a clean form. Snapshots are in `test/visual/dots/`. |

## The 8 acceptance videos

Command: `npx tsx cli/test-videos.ts --profile production`. Each video ran the whole pipeline: brief → intake → classify → brand / reference / beats → plan → storyboard → creative director → video.json → validation → structural QC + contact sheet → repair → animatic → production render → final technical QC → delivery.

| # | What | Class | Style · motion | Output | QC score | Auto-repairs |
|---|---|---|---|---|---|---|
| 1 | Saudi tech ad, 9:16, logo, no voice, no dots | STANDARD | saudi-modern · tech, hero = solution, camera 2/2 | 1080×1920, 19.6 s, 2.4 MB | 100 | none |
| 2 | E-commerce: product photo, music, SFX | STANDARD | ecommerce · energetic, hero = product, **3 cuts snapped to the beat (99.6 BPM)** | 1080×1920, 16.9 s, 3.0 MB | 100 | none |
| 3 | SaaS 16:9: browser + real dashboard screenshot, form state transitions, steps, chart | ADVANCED | clean-corporate · corporate | 1920×1080, 35.8 s, 4.8 MB | 100 | layout ×1.09 (underfilled), chart hold 2.84 → 5.54 s (too short to read) |
| 4 | User voiceover (simulated), 9:16, scenes cut on its phrases | STANDARD | minimal · corporate | 1080×1920, 18.2 s, 1.2 MB | 99 | none (1 warning: heading → cards → CTA arc) |
| 5 | User logo: palette derived from the logo, logo unchanged | SIMPLE | luxury · premium, primary #E8590C from the logo | 1080×1920, 15.1 s, 6.3 MB | 100 | none |
| 6 | Reference-driven style (poster: cream canvas, one large navy form) | STANDARD | minimal (from the reference) · premium; canvas tone #F4EFE6 and accent #1F3A5F from the reference | 1080×1920, 18.2 s, 2.0 MB | 99 | none (1 warning: template arc) |
| 7 | Long Arabic text stress test, 4:5 | STANDARD | minimal · premium | 1080×1350, 30.1 s, 1.4 MB | 100 | none |
| 8 | Multi-format: 9:16, recomposed to 16:9 and 1:1 | STANDARD | saudi-modern · tech | 9:16 2.4 MB, 16:9 2.6 MB, 1:1 2.0 MB (19.6 s each) | 100 / 100 / 100 | 16:9 changed the feature variant stack → grid (designed for landscape) |

Every video ends with zero critical issues, zero errors, and all acceptance rules passing. Loudness was measured on the MP4s with ffmpeg ebur128:

| Video | Integrated loudness | Note |
|---|---|---|
| 1 | −23.5 LUFS | SFX only |
| 2 | −21.3 LUFS | |
| 3 | −22.9 LUFS | |
| 4 | −17.9 LUFS | voice-led, music ducked |
| 5 | −23.2 LUFS | |

True peak is ≤ −8.7 dBTP throughout. Videos 6 and 7 have no audio by design.

Test 3 asked for 30 s and came out 35.8 s. The user supplied a lot of material (screenshot, form, steps, 4 features, a chart), and QC extended the chart scene so it can be read. The Director keeps every piece of user material instead of dropping some to hit the duration.

## Benchmarks (before = commit c1003d5, after = current)

Same machine, same briefs (the c1003d5 fixtures), run one after another with nothing else running. Times are wall-clock for `nitaaq create` from brief to the delivered MP4.

- **cold**: no caches at all.
- **warm**: the bundle is cached, nothing else (a realistic new video).
- **repeat**: the same brief again with all caches.

"After" runs include an **animatic** render (`--animatic true`); the old code had none.

| Case | Before cold | Before warm | After cold | After warm | After repeat | After animatic | Final render before → after | QC before → after |
|---|---|---|---|---|---|---|---|---|
| A · 15–20 s typography/tech | 161.6 s | 142.9 s | 76.8 s | 69.8 s | 4.6 s | 15.9 s | 74.6 → 41.4 s | 47.1 s (final QC) → 17.6 s (all QC) |
| B · product + music | 121.5 s | 101.6 s | 75.7 s | 67.3 s | 4.5 s | 15.1 s | 43.4 → 42.2 s | 75.8 → 16.1 s |
| C · 30 s SaaS 16:9 | 160.7 s | 156.8 s | 110.7 s | 109.3 s | 7.1 s | 19.1 s | 71.6 → 55.1 s | 87.6 → 34.9 s |
| D · uploaded voice | 67.3 s | 63.3 s | 43.5 s | 40.3 s | 3.8 s | 7.3 s | 24.3 → 22.6 s | 41.1 → 11.3 s |

Read honestly:

- **Warm runs are 30–53 % faster** (A −51 %, B −34 %, C −30 %, D −36 %), even though the "after" runs also render an animatic.
- Without the animatic, warm runs would be about A 54 s, B 52 s, C 90 s and D 32 s.
- The gain comes mostly from QC: staged and parallel probes, one-decode frame extraction, and cached probe/pattern results.
- A's render also got faster (74.6 → 41.4 s); static grain is no longer part of the saudi-modern style, so frames encode faster.
- Render speed for B and D is unchanged (the encoder dominates).
- **Repeat runs take 4–7 s**: the render cache returns the identical MP4 and every QC probe is cached.
- The A "before" numbers come from an earlier measurement at the same commit. The B–D "before" numbers were measured in this run.
- Logs and `performance_report.json` files for every run are in the session's bench folder. They are not committed.

## Problems the runs found, and what was changed

- **Concurrent processes broke the bundle cache.** A gallery run rebuilt the shared Remotion bundle while the test runner was rendering from it, and 5 tests failed with "index.html does not exist". Bundles are now built into a private folder and renamed atomically. The few newest are kept and only stale ones are pruned.
- **Film grain was read as a "particle field".** The luxury style's allowed 0.12 grain plus H.264 noise tripped the detector on the MP4 (test 5 was blocked). The detector now measures the frame's noise floor (median absolute residual) and uses max(7, 4.5 σ) as its threshold. Clean frames have σ ≈ 0.1 and grain frames σ ≈ 3. Requested dots are still caught (dot-regression control).
- **Patterns the user explicitly asked for were removed.** QC flagged them as critical and the repair replaced them. They are now reported as info when `design.allowPatterns` covers them.
- **"lavc4" encoder warning** was a false positive: random bytes in the compressed stream matched a case-insensitive pattern. The check now matches exact encoder banners only.
- **The form's "done" button had white text on light green** (1.4–1.7:1 contrast). Text and checkmark now use the readable colour for the actual button colour. Contrast and phone-size errors now block delivery (new acceptance rule).
- **Underfill repair pushed text to the frame edge** (16:9 recompose). It measured one frame before the solution card appeared. It now measures the union of all sampled frames, and the scale growth is capped.
- **The reference was only half applied.** Its canvas tone and background mapping were computed but not used. Both are applied now when the user has no brand and chose no style.
- **User material was silently dropped.** For example, a promote brief dropped its `steps`, and integrations could push the real screenshot out. Supplied content now always gets its beat, and the storyboard prefers material that has not been shown yet, with the user's real screenshot first.
- **Small cards in portrait** (feature stack/staggered, step cards): few rows on a tall canvas now get taller rows and bigger type.

## Not tested, and why

- **Premium TTS** (ElevenLabs / OpenAI): the adapters exist, but no API key is configured here. Without a provider the pipeline refuses TTS and offers no voice or the user's own recording. There is no robotic fallback.
- **Capturing outside websites**: this container's network policy blocks outside sites. Capture was verified on a local HTTP server only. In a blocked environment the pipeline fails with `CAPTURE_FAILED` and asks for a screenshot.
- **Real human voice**: test 4 uses a synthesized tonal "voice" with known phrase timing. A real recording with breaths or noise may need `--clean-voice` or a transcript.
- **Video references**: the reference engine's video path (frame sampling, motion energy, cut rate) is implemented and was exercised during development on a rendered MP4, but none of the 8 acceptance videos uses a video reference. Test 6 uses an image.
- **Long-form chapters with ANIMATION_GUIDE.md**: the code path exists (LONG_FORM class, chapter boards, the guide file), but it was not rendered in this run. Test 7 is long text, not a > 75 s chaptered film.
- **Taste**: QC is automated heuristics (geometry, contrast, phone size, patterns, timing, MP4 and loudness checks). It does not judge taste. Every contact sheet above was also looked at by eye.
- **Browsers**: rendering was tested in Chromium only.
