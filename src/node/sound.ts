/**
 * Node side of the Sound Director and the code-generated soundtrack.
 *
 *  planSound(spec)       — events (scene declarations + transitions) → anchors →
 *                          Sound Director → spec.audio.sfx.cues, sound-plan.json,
 *                          workspace/.sound/sfx-history.json (cross-film memory)
 *  ensureSoundtrack(spec) — composes/re-composes the procedural soundtrack when
 *                          the film has no user/licensed music and the module
 *                          is on; re-run after repairs so the drop stays on the hero.
 * Both are re-run by produce right before rendering, on the final timeline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoSpec, SfxCue } from '../schema/video';
import { buildTimeline } from '../core/timeline';
import { SceneRegistry } from '../scenes';
import { detectEvents, legacyEvent, type MotionEvent, type MotionEventDecl, type SceneEventSource } from '../audio/events';
import { directSound, SOUND_FOR_MOTION, type SoundReport } from '../audio/sound-director';
import { SOUND_PERSONALITIES, type SoundPersonality } from '../audio/sfx-families';
import { ensureSfxBank } from '../audio/synth/sfx-gen';
import { voiceIntervals } from '../audio/mix';
import { getSfx } from '../audio/sfx-library';
import { TransitionRegistry, TRANSITIONS } from '../transitions/presentations';
import { workspace } from './workspace';
import type { BeatAnalysis } from '../audio/beats';

const HISTORY_FILE = () => join(workspace().root, '.sound', 'sfx-history.json');
interface History {
  version: 1;
  films: { project: string; variants: string[] }[];
}
export function readSfxHistory(): History {
  try {
    const h = JSON.parse(readFileSync(HISTORY_FILE(), 'utf8'));
    if (h?.version === 1 && Array.isArray(h.films)) return h;
  } catch {
    /* none yet */
  }
  return { version: 1, films: [] };
}
function writeSfxHistory(project: string, variants: string[]): void {
  const h = readSfxHistory();
  const films = h.films.filter((f) => f.project !== project);
  films.push({ project, variants: [...new Set(variants)] });
  mkdirSync(join(workspace().root, '.sound'), { recursive: true });
  writeFileSync(HISTORY_FILE(), JSON.stringify({ version: 1, films: films.slice(-12) }, null, 1));
}

export function soundPersonalityOf(spec: VideoSpec): SoundPersonality {
  const explicit = spec.audio.sfx.personality ?? spec.brandMotion?.soundPersonality;
  if (explicit && (SOUND_PERSONALITIES as readonly string[]).includes(explicit)) return explicit as SoundPersonality;
  return SOUND_FOR_MOTION[spec.motion.personality ?? 'corporate'] ?? 'corporate';
}

/** All motion events of the film on the final timeline (scene declarations + transitions). */
export function filmEvents(spec: VideoSpec): MotionEvent[] {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const sources: SceneEventSource[] = spec.scenes.map((s, i) => {
    const m = SceneRegistry.get(s.type)?.manifest;
    const e = tl.entries[i];
    let decls: MotionEventDecl[] = [];
    if (s.sfx !== 'none' && m) {
      try {
        decls = m.events?.(s.content as never, s.variant ?? m.defaultVariant, s.duration) ?? [];
      } catch {
        decls = [];
      }
      // families that predate events: their SFX suggestions become semantic events
      if (!m.events) decls = m.sfx.map((sug) => ({ type: legacyEvent(sug.category, m.category), at: sug.at, importance: Math.min(0.9, 0.3 + sug.weight * 0.6) }));
    }
    return { id: s.id, index: i, startSec: e.startSec, durationSec: e.endSec - e.startSec, speed: s.motion?.speed ?? 1, energy: s.motion?.intensity ?? 0.6, category: m?.category ?? 'typography', decls };
  });
  const events = detectEvents(sources, spec.motion.personality, spec.canvas.fps);
  // transitions: a sound at the transition's visual peak (silent ones are filtered by the director)
  spec.scenes.forEach((s, i) => {
    if (i >= spec.scenes.length - 1 || !s.transition || s.transition.type === 'cut' || s.transition.type === 'none') return;
    const next = tl.entries[i + 1];
    const overlap = tl.entries[i].transitionOut / spec.canvas.fps;
    const def = TransitionRegistry.get(s.transition.type) ?? TRANSITIONS[s.transition.type];
    const t = next.startSec + overlap * (def?.peak ?? 0.5);
    events.push({ type: 'scene_transition', at: 0, importance: 0.5 * (def?.energy ?? 0.5) + 0.2, sceneId: s.id, sceneIndex: i, element: 'transition', startSec: t, anchors: { start: next.startSec, peak: t, contact: t, settle: t, completion: next.startSec + overlap }, anchor: 'peak', syncSec: Math.round(t * 1000) / 1000, mass: 'medium', speed: 1, distance: 0.5, direction: 'none', impact: def?.energy ?? 0.5, sceneEnergy: 0.6, transition: s.transition.type });
  });
  return events.sort((a, b) => a.syncSec - b.syncSec);
}

/** Explicit per-scene SFX arrays (user's own choice) are kept verbatim. */
function explicitCues(spec: VideoSpec): SfxCue[] {
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const out: SfxCue[] = [];
  spec.scenes.forEach((s, i) => {
    if (!Array.isArray(s.sfx)) return;
    for (const ev of s.sfx) {
      const lib = getSfx(ev.sound);
      const file = spec.audio.sfx.overrides[ev.sound] ?? lib?.file;
      if (!file) continue;
      out.push({ sceneId: s.id, sound: ev.sound, family: 'explicit', file, atSec: Math.round((tl.entries[i].startSec + ev.at) * 1000) / 1000, volume: Math.min(1, ev.volume * spec.audio.sfx.volume * (lib?.gain ?? 1)), duration: lib?.duration ?? 1, layer: 'single', pan: 0 });
    }
  });
  return out;
}

export async function planSound(spec: VideoSpec, projectDir: string, opts: { beats?: BeatAnalysis | null; write?: boolean; salt?: number } = {}): Promise<{ cues: SfxCue[]; report: SoundReport | null; peaks: Map<string, number>; keyMoments: { type: string; t: number; scene: string }[] }> {
  if (!spec.audio.sfx.enabled) {
    spec.audio.sfx.cues = [];
    return { cues: [], report: null, peaks: new Map(), keyMoments: [] };
  }
  const bank = await ensureSfxBank();
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const events = filmEvents(spec).filter((e) => !Array.isArray(spec.scenes[e.sceneIndex]?.sfx));
  const history = readSfxHistory()
    .films.filter((f) => f.project !== spec.project.id)
    .slice(-6)
    .flatMap((f) => f.variants);
  const musicHits = [...(spec.audio.soundtrack?.hits ?? []), ...(opts.beats?.downbeats ?? [])];
  const personality = soundPersonalityOf(spec);
  const { cues, report } = directSound({
    events,
    personality,
    intensity: spec.audio.sfx.intensity,
    volume: spec.audio.sfx.volume,
    durationSec: tl.totalSec,
    bank,
    history,
    voice: voiceIntervals(spec),
    musicHits,
    hasMusic: Boolean(spec.audio.music),
    seed: `${spec.motion.seed ?? spec.project.id}${opts.salt ? `:v${opts.salt}` : ''}`,
    overrides: spec.audio.sfx.overrides,
  });
  const all = [...cues, ...explicitCues(spec)].sort((a, b) => a.atSec - b.atSec);
  spec.audio.sfx.cues = all;
  spec.audio.sfx.personality = personality;
  if (opts.write !== false) {
    writeFileSync(join(projectDir, 'sound-plan.json'), JSON.stringify({ personality, variation: opts.salt ?? 0, report, cues: all, events: events.map((e) => ({ type: e.type, scene: e.sceneId, syncSec: e.syncSec, anchor: e.anchor, importance: e.importance, element: e.element, mass: e.mass, transition: e.transition })) }, null, 2));
    writeSfxHistory(spec.project.id, cues.map((c) => c.sound));
  }
  const peaks = new Map(bank.variants.map((v) => [v.id, v.peakAt] as [string, number]));
  const keyMoments = events.filter((e) => KEY_EVENTS.has(e.type) && e.importance >= 0.7).map((e) => ({ type: e.type, t: e.syncSec, scene: e.sceneId }));
  return { cues: all, report, peaks, keyMoments };
}
/** Moments a film with SFX must not leave silent. */
const KEY_EVENTS = new Set(['logo_reveal', 'hero_reveal', 'price_reveal', 'cta_reveal', 'counter_final']);

/**
 * Procedural soundtrack: only when there is no user/licensed music and the
 * soundtrack module is selected (spec.modules). Re-composes when the timeline
 * moved the hero/CTA (after repairs), otherwise reuses the file.
 */
export async function ensureSoundtrack(spec: VideoSpec, projectDir: string, opts: { style?: string; heroSceneId?: string } = {}): Promise<{ composed: boolean; reason: string }> {
  const userMusic = spec.audio.music && spec.audio.music.src !== 'soundtrack';
  if (userMusic) return { composed: false, reason: 'user / licensed music present — the synthesiser never runs' };
  if (!spec.modules.includes('soundtrack')) return { composed: false, reason: 'soundtrack module not selected' };
  const { writeSoundtrack, SOUNDTRACK_FOR_MOTION, SOUNDTRACK_STYLES } = await import('../audio/soundtrack/compose');
  const tl = buildTimeline(spec.scenes, spec.canvas.fps);
  const heroIdx = Math.max(0, spec.scenes.findIndex((s) => s.id === opts.heroSceneId || s.beat === 'reveal' || s.beat === 'product' || s.beat === 'brand' || s.beat === 'solution'));
  const heroSec = heroIdx > 0 ? tl.entries[heroIdx].startSec + (tl.entries[heroIdx].transitionIn / spec.canvas.fps) * 0.5 : tl.totalSec * 0.55;
  const ctaIdx = spec.scenes.findIndex((s) => s.beat === 'cta');
  const ctaSec = ctaIdx > 0 ? tl.entries[ctaIdx].startSec : undefined;
  const style = (opts.style && (SOUNDTRACK_STYLES as readonly string[]).includes(opts.style) ? opts.style : spec.audio.soundtrack?.style ?? SOUNDTRACK_FOR_MOTION[spec.motion.personality ?? 'corporate'] ?? 'corporate') as (typeof SOUNDTRACK_STYLES)[number];
  const seed = spec.motion.seed ?? spec.project.id;
  const want = { style, durationSec: Math.round(tl.totalSec * 100) / 100, heroSec: Math.round(heroSec * 1000) / 1000, ctaSec, seed };
  const stamp = JSON.stringify(want);
  const file = join(projectDir, 'audio', 'soundtrack.wav');
  const metaFile = join(projectDir, 'audio', 'soundtrack.json');
  if (existsSync(file) && existsSync(metaFile) && JSON.parse(readFileSync(metaFile, 'utf8')).stamp === stamp) return { composed: false, reason: 'soundtrack up to date' };
  const cuts = tl.entries.slice(1).map((e) => e.startSec + (e.transitionIn / spec.canvas.fps) * 0.5);
  const energy = spec.scenes.map((s, i) => ({ start: tl.entries[i].startSec, value: s.motion?.intensity ?? 0.6 }));
  const res = writeSoundtrack(file, { ...want, cuts, energy });
  writeFileSync(metaFile, JSON.stringify({ stamp, ...res, file: 'audio/soundtrack.wav' }, null, 2));
  spec.assets.soundtrack = { kind: 'audio', src: 'audio/soundtrack.wav', userSupplied: false, preserve: false, duration: res.duration };
  spec.audio.music = { src: 'soundtrack', volume: 0.55, fadeIn: 0, fadeOut: 0.6, loop: false, trimStart: 0, duration: res.duration, ducking: spec.audio.music?.ducking ?? { enabled: true, level: 0.25, attack: 0.25, release: 0.5 }, license: 'procedural — generated by NITAAQ from code (royalty-free, no samples)' };
  spec.audio.soundtrack = { style: res.style, bpm: res.bpm, seed, hits: res.hits, sections: res.sections.map((s) => ({ ...s, energy: Math.min(1, s.energy) })) };
  return { composed: true, reason: `${res.style} ${res.bpm} BPM ${res.key}; drop on the hero at ${want.heroSec}s; ${res.cutsOnBeat}/${cuts.length} cuts on beat` };
}
