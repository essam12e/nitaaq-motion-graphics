# Performance

Speed is a feature: a normal request takes the fast path, every expensive step is cached by content, and every run writes `performance_report.json` with measured stage times (nothing estimated).

## Fast path

1. **Task classifier** (`src/director/classify.ts`) → `SIMPLE` / `STANDARD` / `ADVANCED` / `LONG_FORM` from duration, content blocks and signals (voice, reference, extra formats, chapters). The class sets the budget: QC samples per scene (2–3), repair passes (2, a 3rd only while critical issues remain), whether the reference and beat engines run, whether an animatic is rendered first (ADVANCED / LONG_FORM), and the **effect budget**.
2. **Lazy heavy features**: the reference engine, beat engine, website capture, TTS and recompose only run when the brief asks for them. Reference analysis and beat analysis run in parallel.
3. **Shared browser**: one headless Chrome per process for all stills, probes and renders.
4. **Render concurrency** = number of cores (measured; override `NITAAQ_CONCURRENCY`).

## Cache (`.cache/nitaaq-motion/`, override `NITAAQ_CACHE_DIR`, disable `NITAAQ_NO_CACHE=1`)

Content-addressed (SHA-256 of a stable JSON of the inputs + `CACHE_VERSION`). Namespaces:

| Namespace | Key | Saves |
|---|---|---|
| `bundle` | source tree hash | Remotion webpack bundle |
| `preflight` | node version, lockfile, ffmpeg, browser, fonts, voice providers | preflight (≈25 ms when unchanged) |
| `brand` | logo file hash | logo analysis + palette |
| `ref-v1` | reference file hash | reference analysis |
| `beats` | audio file hash | beat/onset/energy analysis |
| `probe` | spec slice + frame + bundle | QC DOM probes per frame |
| `pattern` | still hash + masks | dot/grid detector |
| `fonts` | font file hash | Arabic coverage check |
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

`totalMs`, `intakeMs`, `directorMs`, `assetsMs`, `audioMs`, `referenceMs`, `validationMs`, `qcMs`, `contactSheetMs`, `animaticMs`, `productionRenderMs`, `cache {hits, misses, byNs}`, `stages[]` (every stage with ms), `meta` (task class, profile, concurrency, canvas, effects, renderCached, repairPasses).

## Measured results

See `docs/TEST_RESULTS.md` (benchmarks A–D before/after on the same machine).
