# NITAAQ Sound Production

The production pass that runs right after the Sound Director (`docs/SOUND_DIRECTOR.md`). The Director still decides **what** each moment means (events → anchors → intent → family → layering, density, voice). Sound Production decides **how a professional cut voices it**: which real or generated sound, aimed at the move, placed on the frame, levelled against the music, mixed on one bus. No new Director, no new critic, no paid API.

Code: `src/audio/pro/` (roles, profiles, licence gate, planner — pure), `src/node/sound-pro/` (earshot bridge, shared library, Openverse, SFX bus), `tools/earshot_render.py`, `cli/sound.ts`.

```
Director cues + motion events
  → ROLE        family + the element's mass / span / impact          (roles.ts, Real SFX event map)
  → PROFILE     silent roles, importance bar, density, layers/moment, role gaps   (profiles.ts)
  → SOURCE      cleared library recording → uisfx UI pack → earshot take rendered for the moment
  → AIM         whoosh dur + apex = the move's lead into the moment; stings ring out before the end;
                tonal sounds tuned to a chord tone of the score's key
  → PLACE       the take's measured onset / peak / end on the moment (+ role offset: taps lead, whoosh peaks land after)
  → LEVEL       loudest 50 ms = music bed (median, second before) + role bed_db + profile + importance; voice −4 dB
  → UNMASK      a detail on an accent's attack −4 dB; more than maxLayers+1 at once −3 dB
  → BUS         audio/sfx-stem.wav (sample exact, fades, ≤ −3 dBFS) — the renderer plays it instead of single cues
```

Outputs per project: `sound-pro.json` (every cue: role, sound, source, align, offset, gain, bed, why, licence; every dropped moment with its reason), `audio/sfx-stem.wav` (the SFX-only track), `audio/sfx/*.wav` (the takes), `SOUND_CREDITS.md`, `sfx-cues.realsfx.json` (Real SFX handoff, below). The master stage is unchanged (−14 LUFS, −1 dBTP).

## Sources

| Source | What | Licence | Network |
|---|---|---|---|
| **earshot bank** (Leonxlnx/earshot @ 591fa3e) | 252 sound effects stored as code (whooshes, swishes, impacts, sub drops, clicks, taps, pops, mallets, dings, risers, swells, shimmers, logo stings, shutters, glitches). `bank.render(id, seed, dur, apex, pitch)` — pure DSP, no models | MIT code, no recorded audio | none after `npm run sound:setup` |
| **uisfx** (npm `uisfx@0.4.0`, the pack Real SFX ships) | 78 UI cues × 12 packs: notification, success, error, warning, press, purchase … | MIT code, CC0 audio | none after install |
| **Openverse** (`api.openverse.org/v1/audio/`) | real recordings, searched and downloaded selectively per role | per sound, gated | search time only |
| **user library** | `workspace/.sound/library/user/<role>/*.wav` + sidecar `{ "code": "cc0", "author": … }` | the user's | none |
| Director bank | the original generated + CC0 bank | — | none (fallback) |

Every take lives in the **shared library** `workspace/.sound/library` (`NITAAQ_SOUND_LIBRARY`): earshot takes keyed by id + seed + knobs, Openverse files with a `.json` licence record, one `index.json`. A second film reuses them.

## Licence gate (`src/audio/pro/license.ts`)

`cleared` CC0 · PDM · CC BY (attribution written to `SOUND_CREDITS.md`) — picked automatically.
`review` CC BY-SA · Sampling+ — kept, never picked automatically.
`blocked` NonCommercial in a commercial project (`audio.sfx.pro.commercial`, default true) · NoDerivatives (syncing and mixing is an adaptation) · no clear licence — not downloaded / not used.
Each Openverse entry stores provider, author (+ URL), licence code, version and URL, file URL and landing page. A commercial search asks Openverse itself for `license_type=commercial&license=cc0,pdm,by`.

## Roles (`src/audio/pro/roles.ts`)

whoosh.short, whoosh.long, land, land.light, hit, drop, click, pop, tick, key, riser, swell, shimmer, bell, coin, sting, notify, confirm, error, warning, snap, glitch. Placement (`align`, `offsetMs`), bed level (`bedDb`), level without music (`levelDb`) and run spacing (`minGapMs`) are earshot's `launch` preset medians; the rest are set next to the nearest measured role. Every Director family maps to a role; the element can change it (a heavy object's whoosh becomes `whoosh.long`, a light premium hit becomes `land`, a sport landing with impact > 0.75 becomes `hit`).

## Sound Profiles (`src/audio/pro/profiles.ts`)

| Profile | Density | Level | Layers / moment | Silent roles | Character |
|---|---|---|---|---|---|
| premium | ×0.7 | −2 dB | 2 | glitch, tick, key, snap | velvet swipes, deep pop-in thumps, a short sub, soft-bloom logo sting, glass UI pack |
| tech | ×1.0 | −1 dB | 2 | — | bright swishes, mouse clicks, pings, digital glitches, taps-tone sting, studio UI pack |
| sport | ×1.2 (capped by the Director's count) | 0 dB | 3 | shimmer | whips, punchy cut hits, gritty big whooshes, sweep-hit sting, mechanical UI pack |
| minimal | ×0.4, importance ≥ 0.7 | −4 dB | 1 | risers, swells, drops, long whooshes, ticks, keys… | a single celesta note for the logo, deliberate silence |

Choice: `brief.audio.soundProfile` → `video.audio.sfx.pro.profile` → editorial / swiss / minimal styles → the sound personality (luxury, cinematic → premium; tech, corporate, playful → tech; sport → sport).

## Switches

- `brief.audio.soundPro: false`, `video.audio.sfx.pro.enabled: false` or `NITAAQ_NO_SOUND_PRO=1`: the Sound Director alone, exactly as before (no stem, the original cues).
- No earshot (no `.venv-sound`, `NITAAQ_NO_EARSHOT=1`) and nothing in the library: those cues keep the Director's own files, still placed on the same bus.
- Openverse unreachable / `NITAAQ_OFFLINE=1`: search returns `offline`, films use the local library.

## Commands

```bash
npm run sound:setup                     # .venv-sound: numpy, scipy, soundfile, soxr + earshot (pinned, --no-deps: no torch)
npm run sound:sync                      # uisfx packs → public/sfx/uisfx (part of npm run setup)
npm run sound -- doctor                 # earshot / uisfx / library / Openverse status
npm run sound -- search "whoosh"        # Openverse results with their licence status
npm run sound -- stock whoosh.short     # selective download (3 cleared sounds) into the shared library
npm run sound -- library                # what the library holds, with licence status
npm run sound -- profiles
```

## What is used from each upstream, and what is not

- **earshot** — used: the bank (`sfx render` as `bank.render`, with `dur` / `apex` / `pitch`, the audit and re-roll), the `launch` kit's role numbers (bed level, offsets, gaps), the stop-down idea (NITAAQ's existing sidechain dips the music under impact-layer cues). Not used: `describe / match / critique / timeline` (CLAP + AST models, ~1.1 GB, torch) — a listening critic is out of scope; `forge` (needs the same critic and licensed reference sets); `fit` works offline but needs a recording whose licence allows a derivative — available to the user by hand (`earshot fit`), not run automatically.
- **Real SFX** — used: its event map (what plays a landing, a title, a UI moment, a transition), its rules (no fitting sound → stay quiet; a product film's title gets a light bright accent, not a long sub drop; interface moments from uisfx; no doubling), its uisfx pack, and its cue format: `sfx-cues.realsfx.json` is a typed cue list `[{t, type, len, g}]` that `scripts/from_cues.py` reads, so a person with a recorded library can run Real SFX's own mixer on a NITAAQ film. Not used: `find_moments` / `look` / frame analysis (NITAAQ already knows its events), YAMNet indexing and the listening page (they need the user's own sorted library and a venv).
- **Openverse** — search + selective download + licence records; never a bulk download.
