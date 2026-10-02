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

`npx tsx cli/benchmark.ts --label after` runs cases A–D (10 s typography, 20 s product ad, 30 s SaaS/launch, 30 s audio-driven), each run in a fresh Node process: **cold** (cache cleared), **warm** (cache kept, new project), **repeat** (same project, nothing changed). Stage groups: planning, preprocessing, sound, validation, qc, animatic, render. Output: `workspace/performance-report.<label>.json` (or `--out`); the v3 measurement with the v2 comparison is committed as `docs/performance-report.json`. `--runs edit` adds the one-copy-change run.

## Measured results

| Case | Run | v2 before (s) | v3 after (s) | Change |
|---|---|---|---|---|
| A 10 s typography | cold | 71.6 | 40.2 | -44% |
| A 10 s typography | warm | 2.1 | 2.5 | 16% |
| A 10 s typography | repeat | 2.2 | 1.5 | -30% |
| A 10 s typography | edit | 40.7 | 40.0 | -2% |
| B 20 s product ad | cold | 112.6 | 78.4 | -30% |
| B 20 s product ad | warm | 5.0 | 3.2 | -36% |
| B 20 s product ad | repeat | 4.1 | 3.2 | -21% |
| B 20 s product ad | edit | 107.7 | 77.0 | -29% |
| C 30 s SaaS/launch | cold | 112.0 | 84.3 | -25% |
| C 30 s SaaS/launch | warm | 5.7 | 5.4 | -5% |
| C 30 s SaaS/launch | repeat | 5.3 | 3.1 | -42% |
| C 30 s SaaS/launch | edit | 114.1 | 87.7 | -23% |
| D 30 s audio-driven | cold | 235.0 | 73.1 | -69% |
| D 30 s audio-driven | warm | 11.6 | 3.2 | -72% |
| D 30 s audio-driven | repeat | 11.8 | 3.1 | -74% |
| D 30 s audio-driven | edit | 221.3 | 66.8 | -70% |

Cold-run stage groups (seconds, v3):

| Case | planning | preprocessing | sound | QC | animatic | render |
|---|---|---|---|---|---|---|
| A | 0.02 | 0.00 | 1.09 | 4.7 | 8.0 | 26.4 |
| B | 0.02 | 0.02 | 0.06 | 16.0 | 17.9 | 44.7 |
| C | 0.03 | 0.02 | 2.42 | 12.5 | 18.3 | 51.3 |
| D | 0.02 | 0.51 | 0.05 | 12.1 | 14.6 | 46.1 |

Measured on the same 4-core container as the v2 baseline (`docs/performance-report.json`, generated by `cli/benchmark.ts`; times are `direct()` + `produce()` wall-clock inside the run, Node start-up excluded). Notes, honestly:
- Cold and edit runs are dominated by the real render (Remotion, 4 workers) and the animatic; v3 is faster mainly because QC and repair converge in fewer passes, not because rendering itself got faster (inferred from stage totals: v2 D spent 145 s in render and 54 s in structural QC, about three times one pass; v3 D renders once).
- A warm is 0.4 s slower than v2: case A now gets a procedural soundtrack (≈1 s of synthesis, cached afterwards — the repeat run is faster than v2).
- The sound stage (Sound Director + audio QC) costs 0.05–0.1 s per film; soundtrack synthesis 1–2.5 s on first use.
- No speed claim beyond these measurements is made.
