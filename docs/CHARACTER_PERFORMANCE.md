# Character Performance

Measured, not claimed. Numbers below come from `npx tsx cli/test-characters.ts` (writes `benchmark.json`) on the 4-CPU build container, 2026-10-04.

## Character preparation: cold vs warm

Fresh cache folder, the same art prepared twice (`prepareCharacter`):

| input | poses | cold | warm | warm result |
|---|---|---|---|---|
| single PNG | 1 | 199 ms | 1 ms | cache hit |
| character sheet (12 figures) | 12 | 1449 ms | 1 ms | cache hit |
| 12 PNG poses | 12 | 1148 ms | 1 ms | cache hit |
| layered SVG (rig) | 17 rig poses | 1542 ms | 2 ms | cache hit |

Cold stages (ms): sheet = detection 860 + pose analysis 323 + thumbnails 249; poses = intake / matte 500 + analysis 333 + thumbnails 297; SVG = rig 610 + pose analysis 398 + thumbnails 514.

A warm run loads `character.json`, `pose-library.json`, `bible.json` and `rig.json` and nothing else: no re-cropping, no silhouette analysis, no SVG rasterisation. The cache key covers the engine version and the bytes of every source file, so changed art is re-analysed and unchanged art never is. `npx tsx cli/nitaaq.ts character bench <art>` measures any character the same way.

## In the film pipeline

The `character` stage in `performance_report.json` (prepare + direct + copy the package into the project): 0.005–0.13 s on a cache hit, 1.5–1.9 s on a miss. Rendering dominates. Acceptance films (10–29 s, production profile): animatic 6.5–16.9 s, production render 18.7–44 s for 10–20 s films and 70 s for the 29 s social ad (`character-results.json`).

## What keeps it fast

- **Lazy module:** `src/node/character/*` and the character scenes' heavy work load only when the brief has `character`.
- **Cache + library:** `.cache/nitaaq-motion/characters/<hash>/`; `saveAs` / `use` for a named, portable package.
- **Rig mode renders vector:** the rig solve is a few matrix multiplications per part per frame (pure; target poses memoised per shot); no per-frame rasterisation.
- **Pose mode renders images:** each pose is a byte-identical PNG asset, decoded once by the browser.
- **Planning is pure and deterministic:** the Director and Actor are closed-form (springs, curves) — no simulation state, so any frame can be rendered alone (parallel workers, cached QC probes).
- **Complexity class:** the lowest sufficient class is used (STATIC → POSE_BASED → PARTIAL_RIG → FULL_VECTOR_RIG); a single image never pays for rigging.
- **Fast preview:** `animatic` (half size, 15 fps) + `qc/character-acting.png` before the production render.
