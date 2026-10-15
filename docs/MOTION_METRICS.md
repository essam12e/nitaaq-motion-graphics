# Motion Metrics

How a film **moves**, measured from its frames, with what the spec says each shot intended.
Written as `motion_metrics.json` next to `quality_report.json` after every final render, and as
`motion_metrics.animatic.json` + `motion_review.json` after the mandatory animatic in Full Director
Mode. P0 rule: **measure → baseline → compare.** Nothing here blocks a render yet.

```bash
npx tsx cli/nitaaq.ts metrics film.mp4 [--project <dir>] [--compare before.json]
```

## Method

The video is decoded at 10 fps to a grey thumbnail 64 px on the short side (114×64 landscape,
64×114 portrait) — the architecture review's method, so numbers are comparable. Two analysis
frames are "the same picture" when their mean absolute grey difference is below 0.15.

## Metrics

| metric | source | meaning |
|---|---|---|
| `stillFrameRatio` | pixels | share of analysis steps with no visible change |
| `longestStaticHold` | pixels + spec | longest frozen run, its scene and its class |
| `averageHoldDuration`, `holds` | pixels | frozen runs longer than 1 s |
| `deadHoldSec` / `intentionalHoldSec` | pixels + spec | frozen time by class (below) |
| `motionEnergy` | pixels | mean / p50 / p90 and a 0.5 s curve |
| `frameOccupancy` | pixels (approx.) | share of pixels that differ from the border colour |
| `motionDensity` | pixels | share of pixels that change per step |
| `cutRhythm` | spec + pixels | shot lengths, variation, detected hard cuts |
| `repeatedEntrance` | pixels + spec | consecutive shots with the same "entrance then nothing" envelope; front-loaded shots |
| `cameraActivity` | spec + pixel proxy | planned share of film time with a camera move; proxy = whole-frame change outside transitions |
| `typographyActivity` | **spec (inferred)** | seconds in which text enters, is emphasised or leaves |
| `wordSync` | pixels + voice | distance from each emphasised spoken word to the nearest visual onset (±100 ms resolution) |
| per scene | | still ratio, longest hold, energy, front-load, occupancy, density, planned vs measured camera, exit motion |

## Holds are classified, not just counted

- **intentional** — the shot declared `lifecycle.hold` (shot script `hold`) and the hold is within its `maxSec`
- **resolve** — the closing logo / CTA settles for ≤ 1.5 s without a declaration
- **beat** — a pause ≤ 1 s (rhythm)
- **dead** — anything else: nothing moves and nothing said it should be still. A declared hold
  that runs longer than its `maxSec` is dead too.

The motion score (0–100) penalises still frames above the film's motion profile (logo sting,
kinetic, explainer, calm, ad), dead hold seconds, a long dead hold, repeated entrance envelopes and
front-loaded shots. It is a baseline, not a gate.

## Known limits

- A very slow camera move over a mostly empty frame can measure as still at this resolution —
  check the contact sheet before believing either number.
- The animatic is half size, 15 fps and low bitrate: compression noise reads as motion, so animatic
  numbers under-report stillness compared with the final render.
- The camera pixel proxy only fires on whole-frame change; on flat backgrounds it reads near zero.
- Typography activity is inferred from the spec, not measured.
- Word sync only measures that *something* moves near the word; unrelated motion can match.
