# Audio

## Voice modes (`brief.audio.mode`)

| Mode | What happens |
|---|---|
| `none` (default) | No narration. Music/SFX optional. |
| `user-voice` | The user's recording is copied unchanged into `audio/`, probed with ffprobe, and split into speech phrases with ffmpeg `silencedetect` (−35 dB, ≥0.35 s pauses; gaps < 0.18 s merged). Scene cuts are placed inside pauses, never mid-word. With a `transcript` (one line per phrase) each line is matched to the scene that shows those words. Optional conservative cleanup (`--clean-voice`: 70 Hz high-pass, light de-noise, loudness to −16 LUFS) writes a **new** file; the original stays untouched. |
| `tts` | Only when the user asks **and** a premium provider is configured. Providers: ElevenLabs (`ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`) and OpenAI (`OPENAI_API_KEY`, `gpt-4o-mini-tts` with dialect instructions). If none is available the pipeline stops with `TTS_UNAVAILABLE` and the Arabic message: «لا يتوفر حالياً مزود صوت احترافي، لذلك لن أستخدم صوتاً آلياً ضعيفاً…». There is **no robotic fallback**. |

Voice cloning is **not** implemented and is off by default. If ever added it must be a separate, opt-in provider that requires explicit consent from the voice owner and is never needed for core operation.

`VoiceProvider` interface (`src/node/tts.ts`): `available()`, `listVoices()`, `synthesize(req)`, `validate(req)`. Register extra providers with `registerVoiceProvider()`.

API keys are read from the environment only, never logged (logger redaction), never written into brief/video JSON (the Studio scrubs credential-like fields on save), and never committed (`.env` is git-ignored; see `.env.example`).

## Music (`brief.audio.music`)

- `none`, a **user-supplied** file, or a licensed library file you add yourself. The system never downloads music.
- Controls in `video.json → audio.music`: `volume`, `fadeIn`, `fadeOut`, `loop`, `trimStart`, `trimEnd`, `ducking { enabled, level, attack, release }`, `license`.
- With a voice, music ducks smoothly under speech (default to 30 % of its volume).
- `test/fixtures/music-bed.mp3` is an original synthesized bed made by `cli/make-test-audio.ts` (CC0).

## Beat engine (`src/audio/beats.ts`, `beats.json`)

Runs only when there is music (and `audio.beatSync` is not `false`). The track is decoded once to mono 22.05 kHz; then:

- onset envelope: spectral flux (window 1024, hop 512), half-wave rectified, normalised;
- tempo: autocorrelation of the envelope weighted by a log-normal prior around 120 BPM (range 60–200);
- beats: dynamic-programming beat tracking (Ellis) on the envelope; downbeats: 4/4 phase with the most low-band energy;
- onsets (peak picking), an RMS energy curve (0.25 s hop) and energy peaks.

Measured on synthetic click tracks: 90 → 89.3, 120 → 119.5, 128 → 129, 150 → 151.5 BPM; `test/fixtures/music-bed.mp3` → 99.6 BPM in 477 ms (1 ms when cached by audio hash). CLI: `npx tsx cli/nitaaq.ts beats <audio>`.

The Creative Director snaps cut points to beats/downbeats within ±0.18 s **only when there is no voice** (a voice-led film follows the voice).

## Audio master timeline (`audio_cues.json`)

Every project writes one file with the whole sound plan: settings (music/SFX volume and intensity), per-scene start/end, the voice phrases, the music envelope (fade in/out, ducking windows under speech with attack/release), every SFX cue with its category, and the beat grid. Ducking is smooth (attack/release ramps, never a hard cut) and defaults to 30 % of the music volume under speech.

## SFX

26 CC0 sounds in `public/sfx` (credits in `public/sfx/CREDITS.md`), categories: whoosh, impact, click, pop, tick, success, notification, glitch, riser, sweep, shutter, transition, ui, typing, digital, cinematic.

Scenes suggest cues (category, time, weight); the planner keeps cues by `sfx.intensity`, avoids pile-ups, and picks concrete sounds deterministically. With a voice the intensity drops (0.35) so SFX never compete with speech. Brief controls: `audio.sfxIntensity`, `audio.sfxVolume`, `audio.musicVolume`, `audio.beatSync`. Controls: `audio.sfx.enabled`, `audio.sfx.intensity` (0–1, how many cues), `audio.sfx.volume` (0–1), `audio.sfx.overrides` (map a sound id to a user file). Per scene: `"sfx": "auto" | "none" | [{ "sound", "at", "volume" }]`.

## QC audio checks

`AUDIO_MISSING` (expected audio track absent), `AUDIO_SILENT`, `AUDIO_CLIPPING` (true peak), `AUDIO_QUIET` (integrated loudness), `VOICE_DRIFT` (a voice-synced scene starts more than 0.25 s away from its phrase). Loudness is measured with ffmpeg `ebur128` on the final MP4.
