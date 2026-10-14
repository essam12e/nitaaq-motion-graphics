# Micro FX (Premium Phase 7)

Small, deterministic accents that land a moment: nine light effects drawn as a handful of SVG primitives (`src/fx/micro.ts`, layer `src/fx/MicroFx.tsx`, planner `src/fx/plan.ts`). They never replace motion; they punctuate it.

| Kind | Moment it serves | Duration |
|---|---|---|
| `burst` | a press / hit (energetic, playful) | short |
| `ripple` | a tap on glass / UI | short |
| `ring` | a premium press, a logo landing | short |
| `sparks` | a celebration, a counter final | short |
| `trails` | an element travelling (direction) | medium |
| `impact-lines` | a product landing (sport) | short |
| `energy-pulse` | a tech / hero reveal | medium |
| `glow-pulse` | a premium / brand reveal | medium |
| `directional-streaks` | a fast lateral move (direction) | short |

`scene.fx: [{ kind, at, x, y, size?, color?, intensity?, direction?, duration?, seed?, importance? }]` places one by hand (scene-local seconds, position in fractions). Every particle comes from `createRng(seed:kind:at)` — the same film always draws the same sparks.

**Auto accents** (`design.microFx: "auto"`, default `off`): the planner reads the film's motion events (Choreography Engine events carry their position), picks the accent by moment, Motion Intent and personality (`fxForMoment`; quiet intents such as continuity get none), and places it on the event. Centred reveals (hero / logo / CTA) sit on the frame centre.

**FX Budget** (`design.fxBudget`, else `design.effectBudget`, default MEDIUM): at most 3 / 6 / 10 accents per 10 s and a concurrent cost of 1.2 / 2.2 / 3.5 on screen for LOW / MEDIUM / HIGH; the most important accents are kept first, then the earliest. Their render cost joins the **Performance Budget** (`perf/effect-budget.ts`, contributor "micro FX accents"). Spatial QC reports `FX_BUDGET` when hand-placed accents go over it.
