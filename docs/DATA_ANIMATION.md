# Data Animation & Data Storytelling

Code: `src/data/visualize.ts` (choice + honesty checks), `src/scenes/data/data-story.tsx`, existing data families (`kpi-counter`, `stat-highlight`, `bar-chart`, `line-chart`, `donut-chart`, `progress-bars`, `ranking`, `comparison-table`, `data-table`, `timeline`, `before-after`). Module `data` loads only when the brief has `stats`, `series` or `table`.

## Never fabricate

- Every number comes from the brief; data families require a `source`, which is shown on screen. `example`/`placeholder` sources are critical in validation.
- `checkDataStory()` (validation + director) rejects or warns on: missing source, label/value length mismatch, a part-to-whole that does not sum to ~100, and an **insight that the data does not support** (a percentage that does not match the computed change, or a growth/decline claim the series contradicts).
- Changes are **computed** (`changePct`), never typed in.
- Charts start at zero for bars; line charts never imply a trend the data lacks; the final value holds long enough to read.

## Choosing the visualization by meaning

`chooseVisualization()`:

| Data | Visualization |
|---|---|
| one value | big-number (counter) |
| two values | change (before → after with the computed %) |
| ordered labels (years, quarters, months, Hijri months) | line |
| categories | bar (ranked) |
| parts summing to ~100 | share (donut only when it is part-to-whole) |

## Story structure

`data-story` plays **context → build → insight**: the question/context line, the chart builds in order (escalation, e.g. 120 → 180 → 240 → 340), then the computed insight lands (+183 %) with an annotation and a hold. Numbers use the project's numeral system (Arabic-Indic or Latin) and stay readable on a phone.

Acceptance video 11 (4:5 data film).
