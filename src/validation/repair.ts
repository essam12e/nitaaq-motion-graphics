/**
 * Deterministic auto-repair. Every change is recorded in metadata.repairLog.
 * Repairs never alter the user's words, media or data; anything that would
 * require that (invalid content, unknown scene/style, missing files, fake data)
 * is left for a clear failure instead of a silent guess.
 */
import type { VideoSpec } from '../schema/video';
import { SceneRegistry } from '../scenes';
import { findStyleId } from '../styles/presets';
import { isKnownTransition } from '../transitions/presentations';
import { isKnownSfx } from '../audio/sfx-library';
import { ASPECTS } from '../layout/canvas';
import { validateSpec, totalDuration, type Issue, type ValidateOptions } from './validate';

export interface RepairEntry {
  path: string;
  issue: string;
  fix: string;
  stage: 'validation' | 'quality';
  pass?: number;
}

export interface RepairResult {
  spec: VideoSpec;
  repairs: RepairEntry[];
  remaining: Issue[];
  /** True when no error/critical issue remains. */
  ok: boolean;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function repairSpec(input: VideoSpec, opts: ValidateOptions = {}): RepairResult {
  const spec = clone(input);
  const repairs: RepairEntry[] = [];
  const log = (path: string, issue: string, fix: string) => repairs.push({ path, issue, fix, stage: 'validation' });

  // canvas
  const want = ASPECTS[spec.canvas.aspect];
  if (Math.abs(spec.canvas.width / spec.canvas.height - want.width / want.height) > 0.01 || spec.canvas.width % 2 || spec.canvas.height % 2) {
    log('canvas', `${spec.canvas.width}×${spec.canvas.height} vs ${spec.canvas.aspect}`, `set to ${want.width}×${want.height}`);
    spec.canvas.width = want.width;
    spec.canvas.height = want.height;
  }
  // style alias
  const sid = findStyleId(spec.style.preset);
  if (sid && sid !== spec.style.preset) {
    log('style.preset', `alias "${spec.style.preset}"`, `→ "${sid}"`);
    spec.style.preset = sid;
  }

  const seen = new Set<string>();
  spec.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (seen.has(s.id)) {
      const nid = `${s.id}-${i}`;
      log(`${p}.id`, `duplicate id "${s.id}"`, `renamed to "${nid}"`);
      s.id = nid;
    }
    seen.add(s.id);
    const mod = SceneRegistry.get(s.type);
    if (!mod) return;
    const m = mod.manifest;
    if (m.id !== s.type) {
      log(`${p}.type`, `alias "${s.type}"`, `→ "${m.id}"`);
      s.type = m.id;
    }
    if (s.variant && !m.variants.includes(s.variant)) {
      log(`${p}.variant`, `unknown variant "${s.variant}"`, `→ default "${m.defaultVariant}"`);
      s.variant = m.defaultVariant;
    }
    // Voice-synced scenes keep their timing (cuts sit in the speaker's pauses).
    if (s.voice) {
      /* timing owned by the voiceover */
    } else if (s.duration < m.minDuration) {
      log(`${p}.duration`, `${s.duration}s below minimum`, `→ ${m.minDuration}s`);
      s.duration = m.minDuration;
    } else if (s.duration > m.maxDuration) {
      log(`${p}.duration`, `${s.duration}s above maximum`, `→ ${m.maxDuration}s`);
      s.duration = m.maxDuration;
    }
    if (s.transition && !isKnownTransition(s.transition.type)) {
      log(`${p}.transition.type`, `unknown "${s.transition.type}"`, '→ "crossfade"');
      s.transition.type = 'crossfade';
    }
    if (Array.isArray(s.sfx)) {
      const before = s.sfx.length;
      s.sfx = s.sfx.filter((e) => isKnownSfx(e.sound) || spec.audio.sfx.overrides[e.sound]);
      if (s.sfx.length !== before) log(`${p}.sfx`, `${before - s.sfx.length} unknown sound(s)`, 'removed');
    }
    if (s.voice?.segment !== undefined && !spec.audio.voice?.segments[s.voice.segment]) {
      log(`${p}.voice.segment`, `segment ${s.voice.segment} missing`, 'unlinked');
      delete s.voice.segment;
    }
  });
  // transitions after durations settled
  spec.scenes.forEach((s, i) => {
    const p = `scenes[${i}]`;
    if (!s.transition) return;
    if (i === spec.scenes.length - 1) {
      if (s.transition.type !== 'cut' && s.transition.type !== 'none') {
        log(`${p}.transition`, 'outgoing transition on the last scene', 'removed');
        delete s.transition;
      }
      return;
    }
    const cap = Math.floor(Math.min(s.duration, spec.scenes[i + 1].duration) * 0.4 * 100) / 100;
    if (s.transition.duration > cap) {
      log(`${p}.transition.duration`, `${s.transition.duration}s too long`, `→ ${cap}s`);
      s.transition.duration = cap;
    }
  });
  // audio
  if (spec.audio.mode === 'none' && spec.audio.voice) {
    log('audio.mode', 'voice present but mode none', '→ "user-voice"');
    spec.audio.mode = spec.audio.voice.provider === 'tts' ? 'tts' : 'user-voice';
  }
  if (spec.audio.voice?.duration) {
    const end = spec.audio.voice.offset + spec.audio.voice.duration;
    const total = totalDuration(spec);
    if (end > total + 0.05) {
      // extend the last scene so the voice is never cut off (content unchanged)
      const last = spec.scenes[spec.scenes.length - 1];
      const extra = Math.ceil((end - total + 0.35) * 100) / 100;
      const max = SceneRegistry.get(last.type)?.manifest.maxDuration ?? 120;
      if (last.duration + extra <= max) {
        log(`scenes[${spec.scenes.length - 1}].duration`, `voice ends at ${end.toFixed(2)}s after video end ${total.toFixed(2)}s`, `extended last scene by ${extra}s`);
        last.duration = Math.round((last.duration + extra) * 100) / 100;
      }
    }
  }
  if (!spec.metadata) (spec as { metadata: VideoSpec['metadata'] }).metadata = { generator: 'manual', repairLog: [] };
  spec.metadata.repairLog = [...(spec.metadata.repairLog ?? []), ...repairs];
  const remaining = validateSpec(spec, opts);
  return { spec, repairs, remaining, ok: !remaining.some((i) => i.severity === 'error' || i.severity === 'critical') };
}
