# Test results

Last full run: 2026-10-02, Linux container (4 cores, Node 22, system ffmpeg, Chromium headless shell). Everything below was executed on the committed code of branch `v3-upgrade`; numbers are copied from the run output (`workspace/output/v3-final/test-results.json`, `workspace/performance-report.json`, the dot-regression JSON) and from ffprobe / ffmpeg ebur128 on the delivered MP4s.

## Automated suites

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (0 errors) |
| Unit tests | `npm test` | **215 / 215 passed** (v2: 164). New: the 20 v3 regression items in `test/unit/v3-modules.test.ts` (genre/module selection, lazy modules, Arabic never per glyph, text-motion variety, meaning-driven transitions, logo reveal choice, brand-motion persistence, data checks, map lookup without fabrication, seeded illustrations, soundtrack determinism, motion events and anchors, sound director intents / repetition / density / sync / voice ducking / cross-film history, variants planning), mixed Arabic + Latin direction, and procedural-soundtrack reuse on a re-run. |
| Visual regression | `npm run test:visual` | **176 / 176 passed**: 88 families at 9:16 and 16:9. 34 baselines are new (the 17 new families); no existing baseline changed beyond the threshold. |
| Dot / grid regression | `npx tsx cli/dot-regression.ts` | **passed** on 11 styles (the 8 of v2 + illustration, whiteboard, launch-hype): 0 pattern findings; dots the user explicitly allowed are still detected, dots nobody asked for are replaced. |

## The 18 acceptance videos

Command: `npx tsx cli/test-videos.ts --profile production`. Each video ran the whole pipeline (brief → classify → genre + modules → plan → storyboard → creative director → text motion + transitions → video.json → sound stage → validation → structural QC → repair → shared-element measurement → audio QC → animatic → production render → final technical QC → delivery). All 18 delivered with **zero critical issues and zero errors**.

| # | What | Style · motion | Output | QC | Repairs | SFX cues (back-to-back repeats, max sync error) | Music | Loudness |
|---|---|---|---|---|---|---|---|---|
| 1 | Saudi tech ad, 9:16, no voice, clean background (no dots) | saudi-modern · tech | 1080×1920, 24.4 s, 2.6 MB | 100 | 1 | 18 (0, 19 ms) | none | -30.3 LUFS |
| 2 | E-commerce product ad: product image, music (beat-synced), SFX | ecommerce · energetic | 1080×1920, 17.5 s, 2.9 MB | 100 | 0 | 12 (0, 0 ms) | user music | -21.6 LUFS |
| 3 | SaaS explainer 16:9: browser + dashboard, integrations, state transitions | clean-corporate · tech | 1920×1080, 39.1 s, 5.1 MB | 100 | 2 | 25 (0, 0 ms) | none | -31.1 LUFS |
| 4 | User voiceover, 9:16, scenes synced to phrases, ducked music | minimal · corporate | 1080×1920, 18.8 s, 1.0 MB | 99 | 0 | 4 (0, 0 ms) | none | -17.9 LUFS |
| 5 | User logo; palette derived from the logo, logo unchanged | luxury · premium | 1080×1920, 15.0 s, 4.7 MB | 100 | 1 | 11 (0, 0 ms) | none | -29.6 LUFS |
| 6 | Reference-driven style (principles extracted, not copied) | minimal · premium | 1080×1920, 19.0 s, 1.8 MB | 100 | 0 | — (no audio by design) | — | — |
| 7 | Long Arabic text stress test, 4:5 | minimal · premium | 1080×1350, 34.5 s, 1.7 MB | 100 | 2 | — (no audio by design) | — | — |
| 8 | Multi-format: 9:16 recomposed to 16:9 and 1:1 (re-laid-out, not cropped) | saudi-modern · tech | 1080×1920, 24.4 s, 2.6 MB; 16:9 1920×1080 (100), 1:1 1080×1080 (100) | 100 | 1 | 18 (0, 19 ms) | none | -29.8 LUFS |
| 9 | Logo animation: structure-aware reveal of the user logo (single scene, logo unchanged) | luxury · premium | 1920×1080, 6.1 s, 1.6 MB | 100 | 0 | 3 (0, 0 ms) | none | -28.3 LUFS |
| 10 | Launch / hype film 9:16 with code-generated soundtrack (no user music) | launch-hype · energetic | 1080×1920, 20.9 s, 4.4 MB | 100 | 0 | 12 (0, 0 ms) | procedural sport 129 BPM | -17.1 LUFS |
| 11 | Data story 4:5: sourced series → line, KPI counters (no fabricated numbers) | minimal · premium | 1080×1350, 18.3 s, 1.0 MB | 100 | 3 | 10 (0, 0 ms) | none | -31.2 LUFS |
| 12 | Map animation 16:9: Saudi regions, real cities, routes (Natural Earth data) | saudi-modern · premium | 1920×1080, 18.4 s, 2.2 MB | 99 | 0 | 11 (0, 0 ms) | none | -32.3 LUFS |
| 13 | Illustration mode 9:16: procedural flat illustrations + diagram | illustration · tech | 1080×1920, 20.9 s, 1.4 MB | 99 | 1 | 15 (0, 0 ms) | none | -31.9 LUFS |
| 14 | Whiteboard 16:9: progressive drawing / writing on a clean board | whiteboard · tech | 1920×1080, 19.9 s, 1.1 MB | 100 | 0 | 8 (0, 0 ms) | none | -32.0 LUFS |
| 15 | English web/UI film with an optional GSAP sequence (deterministic seek) | minimal · tech | 1920×1080, 18.9 s, 1.4 MB | 100 | 1 | 10 (0, 19 ms) | none | -29.6 LUFS |
| 16 | English kinetic typography 1:1 + zero-asset JavaScript sequences | sports · energetic | 1080×1080, 12.4 s, 0.8 MB | 100 | 0 | 6 (0, 0 ms) | none | -29.7 LUFS |
| 17 | Mixed Arabic/English SaaS launch 16:9 with real screenshot + soundtrack | saas · tech | 1920×1080, 30.9 s, 3.0 MB | 100 | 0 | 13 (0, 0 ms) | procedural tech 116 BPM | -19.1 LUFS |
| 18 | User music 9:16: beat engine + Sound Director coordination (no soundtrack synthesis) | sports · energetic | 1080×1920, 30.8 s, 2.0 MB | 100 | 0 | 12 (0, 0 ms) | user music | -21.5 LUFS |

Remaining warnings (non-blocking): #4 `VOICE_DRIFT` (one phrase starts 0.47 s before its scene; the simulated voice), #12 and #13 `PERSONALITY_MISMATCH` (the brief asked for a motion personality that differs from the style's default — kept, because the user asked for it).

SFX-only films sit around −30 LUFS on purpose (sparse cues, no music bed); films with music land between −17 and −22 LUFS. No sound file plays twice in a row in any film; the Sound Director's maximum sync error is 19 ms.

## Ad variants and shared elements

`npx tsx cli/nitaaq.ts variants test/fixtures/brief-b-ecommerce.json --strategies offer-first,product-first --aspects 9:16,1:1` → 4 films, all delivered with QC 100, 2 min 57 s for all four. Offer-first opens on the price, product-first has the product on screen in the first second; 1:1 re-lays out the feature scene (stack → grid) instead of cropping. In offer-first the product travels from the price scene into the product scene as one shared element (rects measured on the real frames, uniform scale); frames across the transition were inspected — one product copy glides and grows while the cards cross-fade, nothing pops.

## Visual review (contact sheets) — bugs QC did not catch, now fixed

Reading every contact sheet found problems that scored 100 in QC; each was fixed and the affected films re-rendered:
- Whiteboard steps overlapped each other in 16:9 (text sized for the safe width inside a narrow column).
- An English kinetic script was repeated in full in four consecutive scenes; the script is now split across scenes, and a family with the same content (or the same steps/features) is never shown twice.
- The last word of an English headline was clipped: LTR text was measured with the Latin fallback font while rendered in the display font, and line masks clipped instead of reporting overflow. Fit now measures with the rendered font; masks hug the line, so overflow is measured.
- «مع Insightly» was laid out LTR (Arabic sentence with a long brand name): the first strong character now decides.
- False `PATTERN_IN_FRAME` on maps (coastline islands) and on a dashed orbit ring (now a solid drawn line — no dotted look).
- The benchmark exposed a real bug: re-directing the same project kept the soundtrack WAV but dropped it from video.json (music lost, render cache missed). Fixed with a regression test.

## Performance

See `docs/PERFORMANCE.md` → Measured results (cases A–D, cold / warm / repeat / edit, v2 vs v3 on the same machine).

## Not tested here (honest limits)

- Premium TTS (ElevenLabs / OpenAI): no API key in this environment; the no-voice and user-voice paths are tested.
- A real human voice recording: the voiceover film uses a generated test voice.
- Website capture of external sites: the proxy only allows localhost, so `capture` was not exercised in these runs (the SaaS film uses a supplied screenshot).
- Shared-element continuity is measured for identity media (logo / product / screenshot); text and shape continuity happens inside state-driven scenes only.
- GSAP is exercised through the `gsap-sequence` family in film #15 (gsap installed); the static fallback for a machine without gsap was not exercised.
