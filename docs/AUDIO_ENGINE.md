# Intelligent Audio Engine (Audio 2.0)

Everything works offline. The internet is an optional fallback, off by default, and only for CC0 sounds.

## 1. Registry (`src/audio/registry.ts`, `src/node/audio-library.ts`)

One searchable index of every sound the engine may use, written to `workspace/.audio/registry.json`:

| Source | id prefix | Licence |
|---|---|---|
| bundled library `public/sfx/` (AtomCut / Kenney) | `lib:` | CC0-1.0 |
| synthesised SFX bank (`src/audio/synth`) | `gen:` | generated |
| procedural soundtrack styles | `music:procedural-<style>` | procedural |
| your own library `workspace/audio-library/` (optional sidecar `.json` per file) | `user:` | user |
| online cache `workspace/.audio/cache/` | `ogsi:` / `atomcut:` | CC0 (verified) |

Each entry: id, filename, path, category, subcategory, tags, mood, energy, duration, bpm, intensity, recommended_use, license, attribution, source, local_available, measured features (peak/RMS dB, attack ms, spectral centroid, peak position), sha256, kind. Features are measured once with ffmpeg and cached (`workspace/.audio/features.json`): first build ≈12 s for ~200 sounds, then ≈20 ms.

**Licences are data.** `usable()` returns only allow-listed licences (CC0, Public Domain, generated, procedural, user, CC-BY-3.0/4.0, OGA-BY-3.0 — BY licences only with an attribution). Nothing with an unknown licence is ever returned.

## 2. Search

Deterministic metadata search: bilingual query expansion through a small sound ontology (whoosh, impact, riser, click, pop, notification, success, error, glitch, tick, typing, cash, camera, magic, reveal, logo, luxury, cinematic, playful, energetic, calm, water, paper, mechanical, music — each with Arabic and English synonyms), light Arabic stemming (clitics و ف ب ل ك ال, ة/ات/ين/ون), weighted fields (category 3, tags 2, use 1.5, mood 1.2, name 1), energy/duration fit, a penalty for recently used ids. Ties break on id.

Semantic search is **optional and experimental**: `setSemanticBackend()` accepts a CLAP-style embedder (query + candidates → 0..1 scores) that is blended in. Nothing in the core depends on it, no model is bundled.

```
nitaaq audio index
nitaaq audio search "ضربة فاخرة ناعمة" --kind sfx
nitaaq audio search "luxury calm" --kind music
NITAAQ_AUDIO_ONLINE=1 nitaaq audio fetch "glass ding" --provider ogsi
```

## 3. Online fallback (`src/node/audio-online.ts`)

Only when `NITAAQ_AUDIO_ONLINE=1` (and never with `NITAAQ_OFFLINE=1`), only when the local search has no good match:

**Download → Validate → Cache → Register.** Providers: Open Game SFX Index (CC0 index cached 7 days), AtomCut Library (CC0). Validation: licence in the allow-list, attribution present when required, size ≤ 8 MB, sha256 recorded, ffprobe finds an audio stream, duration in bounds. The file and a `.json` provenance sidecar go to the cache and the registry picks them up. A failed network never fails a film — the engine falls back to the bundled/generated sounds.

## 4. Music Director (`src/audio/music-director.ts` → `music_plan.json`)

Source priority: **your music** (never replaced) > a licensed library track (`brief.audio.music: "library"` or `"library:<query>"`) > the procedural soundtrack > none. Target mood / energy / BPM come from the motion personality and pace.

**Sound hierarchy:** Voice > SFX > Music > Ambient. Voice ducks music (0.3); a hero impact dips the music by a sidechain (2.5 dB, 1.5 dB under a voice) — `audio.sidechainDb`; music-led films snap cuts and camera accents to downbeats, voice-led films follow phrases.

## 5. Motion → sound sync and beat-aware motion

The Sound Director (docs/SOUND_DIRECTOR.md) places each sound on the motion's real anchor (start / peak / contact / settle / completion). Motion 2.0 additions: continuity transitions are silent or soft (shape/colour matches are silent, liquid = air, camera/motion matches = fast whoosh, zoom-through = heavy/fast); beat accents from the music's downbeats are written into `scene.motion.accents` and the camera plan.

## 6. Mastering (`src/node/audio.ts → masterAudio`)

After every non-animatic render: two-pass EBU R128 `loudnorm` (target −14 LUFS, true peak −1 dBTP, linear; a sparse SFX-only mix is lifted by at most +12 LU), then `alimiter`; the video stream is copied untouched. The report (input/output LUFS, true peak, clipped samples) is logged; `NITAAQ_NO_MASTER=1` skips it. `audio.master` in video.json overrides the targets.
