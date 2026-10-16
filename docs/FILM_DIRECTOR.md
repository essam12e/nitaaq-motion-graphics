# Film Director (P3): Film → Sequence → Shot → Element

P3 adds a layer above the Stage director (P1) and the Visual Director (P2). It directs the film as a whole:
how sequences hand over to each other, what every cut does to the eye, where energy rises, what returns at
the end. It is on by default for stage films and can be switched off entirely (`NITAAQ_NO_FILM_DIRECTOR=1`),
in which case the film is exactly P2.

## The Film Question

Before `shots.json`, write `film_plan.json`: *what should the viewer feel, understand and look at, from the
first frame to the last?* Pass it with `--film`:

```
npx tsx cli/nitaaq.ts create brief.json --shots shots.json --direction direction.json --film film_plan.json
```

Schema: `src/film/film-plan.ts` (`FilmPlanSchema`, strict). Main parts:

| Part | What it changes |
|---|---|
| `arcs.energy.curve` | the planned energy per shot (`expectedEnergy`); the critic compares it with the measured energy |
| `arcs.camera.stages` | the framing at the end of each moving shot; moves against the arc are reported |
| `motifs` (1–3) | the motif element is cast where it returns: `persist`, `become` (the transition turns it into `into`), `halo` (behind `into`, height ≤ 42% of the frame), `accent` |
| `phrases` | a motion phrase across shots (start / build / peak / release / resolution); the peak gets an impact if it has none, the release hands its energy on |
| `sequences[].contract` | what a sequence receives and delivers; a contract is kept, turned into a shared element, or reported broken |
| `ending.payoff` + `ending.why` | the CTA payoff; an empty `why` is a warning |
| `transitionStrategy` | repeats that are a language (`intentionalRepeats`) and boundaries allowed to reset the world |

Every change is listed in `film_plan_report.json`. Without a film plan, a conservative plan is derived from
the script (`film_plan.derived.json`) for the critics only. It is never applied, and it invents no motif and
no payoff.

## What runs, in order (hierarchical: technical → shot → boundary → sequence → film)

1. **direct**: the film plan is applied to the script before compile.
2. **produce, after the style-frame gate** (`film_prepass.json`):
   - **Neighbourhood repair** of every boundary at risk (Transition Re-Director). Moves: `cross-hold`, `early-entry`, `full-head`, `carrier-swap`, `hold`, `shared-bridge`, a hard cut `{ "type": "cut", "hard": true }`. Only existing transition types are used. Each candidate is predicted on the neighbourhood A→B, B→C, A's previous cut. A good cut beats a bad morph.
   - **Multiple small subjects** (all at once, progressive emphasis, focus-sequence) for a cut no boundary move fixes.
   - **Film Critic**, then the limited **Global Re-Director** (at most 3 shots) for film-level problems only: `WEAK_PAYOFF`, `REPETITIVE_FILM`, energy, camera addiction.
3. **critic loop**:
   - A repaired shot marks its boundaries dirty (`dirtyOf`), and the neighbourhood is re-directed before render (`neighborhood_repair.passN.json`).
   - Measured failing cuts get Transition Re-Director moves instead of the P2 hold / overlap patches.
   - The best version is chosen by the version score (shots + sequences + cuts + weakest cut + film).
   - The global pass runs only when nothing lower is left.

## Files written

`boundary_plan.json`, `film_critic.json`, `film_memory.json`, `rhythm_report.json`, `film_plan_report.json`,
`film_prepass.json`, `local_sequence.passN.json`, `neighborhood_repair.passN.json`, and `repair_log.json`
(`film` section).

## The predictor

`src/film/sampler.ts` reconstructs every element's box and opacity analytically at any instant. Its ink
weights per kind were fitted to pixel occupancy (r = 0.78). A boundary is judged on the cut window, and
also from A's settle to B's settle: a side left empty for long is a `BOUNDARY_VOID` even when the cut
frames themselves look calm.

The predictor is optimistic on white-card worlds. Measured (pixel) quality replaces it as soon as the
animatic exists.

## Switches

| Variable | Effect |
|---|---|
| `NITAAQ_NO_FILM_DIRECTOR=1` | P3 off (P2 exactly) |
| `NITAAQ_NO_SEQUENCE=1` | no contracts, no neighbourhood check after shot repairs |
| `NITAAQ_NO_TRANSITION_REDIRECTOR=1` | no boundary moves |
| `NITAAQ_NO_FILM_CRITIC=1` | no film critic, no global re-director |
| `NITAAQ_NO_MOTIFS=1` | no motifs, no phrases |
| `NITAAQ_NO_CAMERA=1` | every shot static |

## Film review

`film_review.py <project> <out>` (in the P3 deliverables, `scripts/`) writes:
- overview and per-sequence sheets
- a strip per cut
- energy curve and camera arc
- eye-flow map and motif timeline
- transition quality and scores
- `repair_history.md`
