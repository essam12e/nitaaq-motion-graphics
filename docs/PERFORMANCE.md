# Performance

Speed is a feature: a normal request takes the fast path, every expensive step is cached by content, and every run writes `performance_report.json` with measured stage times (nothing estimated).

## Fast path

1. **Task classifier** (`src/director/classify.ts`) → `SIMPLE` / `STANDARD` / `ADVANCED` / `LONG_FORM` from duration, content blocks and signals (voice, reference, extra formats, chapters). The class sets the budget: QC samples per scene (2–3), repair passes (2, a 3rd only while critical issues remain), whether the reference and beat engines run, whether an animatic is rendered first (ADVANCED / LONG_FORM), and the **effect budget**.
2. **Lazy heavy features**: the reference engine, beat engine, website capture, TTS and recompose only run when the brief asks for them. Reference analysis and beat analysis run in parallel.
2b. **Lazy modules** (`src/director/modules.ts`): the genre classifier selects modules per film; `map` (GeoJSON + projection), `soundtrack` (synthesiser), `gsap` (bundle chunk), `logo` (structure analysis with sharp) and `variants` are `import()`-ed only when selected — a simple typography film never loads them. The selection is logged and recorded as the `modules` stage.
2c. **SFX bank** is synthesised once (~4 s) and reused until the generator version changes; the procedural soundtrack is cached by its parameters (same seed → same WAV, not re-synthesised).
3. **Shared browser**: one headless Chrome per process for all stills, probes and renders.
4. **Render concurrency** = number of cores (measured; override `NITAAQ_CONCURRENCY`).

## Cache (`.cache/nitaaq-motion/`, override `NITAAQ_CACHE_DIR`, disable `NITAAQ_NO_CACHE=1`)

Content-addressed (SHA-256 of a stable JSON of the inputs + `CACHE_VERSION`). Namespaces:

| Namespace | Key | Saves |
|---|---|---|
| `bundle` | source tree hash | Remotion webpack bundle |
| `preflight` | node version, lockfile, ffmpeg, browser, fonts, voice providers | preflight (≈25 ms when unchanged) |
| `brand` | logo file hash | logo analysis + palette |
| `reference` | reference file hash (ref-v2) | reference analysis |
| `beats` | audio file hash | beat/onset/energy analysis |
| `probe` | spec slice + frame + bundle | QC DOM probes per frame |
| `pattern` | still hash + masks | dot/grid detector |
| `fonts` | font file hash | Arabic coverage check |
| `probe` (shared) | spec + transition frames | shared-element rect measurement |
| `renders` | spec (minus metadata) + profile + bundle + referenced file hashes | the MP4 itself |

`npx tsx cli/nitaaq.ts cache summary` · `cache clear [namespace]`.

## Render profiles

| Profile | Scale | fps | x264 | Use |
|---|---|---|---|---|
| preview | 0.5 | spec | ultrafast, crf 30 | quick look |
| animatic | 0.5 | 15 | veryfast, crf 30 | timing / story check before the final |
| draft | 0.75 | spec | faster, crf 23 | review copy |
| production | 1 | spec | medium, crf 18 | delivery |

## Effect budget (`src/perf/effect-budget.ts`)

Every scene family declares a cost class (LOW / MEDIUM / HIGH, see SCENE_LIBRARY.md) and every style declares its expensive effects (backdrop blur, glow, grain). The estimate is duration-weighted: LOW = 1, MEDIUM = 2, HIGH = 3 per second, + camera moves, + style effects. Levels: ≤ 1.6 LOW, ≤ 2.5 MEDIUM, ≤ 3.6 HIGH. The Director sets `design.effectBudget` from the task class (SIMPLE → LOW, or MEDIUM for heavy styles; LONG_FORM → MEDIUM; otherwise HIGH); validation warns `EFFECT_BUDGET` when a film exceeds it, and `performance_report.json → meta.effects` records score, level and contributors.

## Preflight

`npm run preflight` (fast, cached) / `--full`. `npm run setup` runs `npm ci` only when `node_modules` is missing or older than `package-lock.json`.

## performance_report.json

`totalMs`, `intakeMs`, `directorMs`, `assetsMs`, `audioMs`, `referenceMs`, `validationMs`, `qcMs`, `contactSheetMs`, `animaticMs`, `productionRenderMs`, `cache {hits, misses, byNs}`, `stages[]` (every stage with ms — includes `modules`, `sound`, `shared-elements`, `logo-structure`), `meta` (task class, profile, concurrency, canvas, effects, renderCached, repairPasses).

## Benchmark

`npx tsx cli/benchmark.ts --label after` runs cases A–D (10 s typography, 20 s product ad, 30 s SaaS/launch, 30 s audio-driven), each run in a fresh Node process: **cold** (cache cleared), **warm** (cache kept, new project), **repeat** (same project, nothing changed). Stage groups: planning, preprocessing, sound, validation, qc, animatic, render. Output: `workspace/performance-report.<label>.json`.

## Measured results

<!-- MEASURED -->
