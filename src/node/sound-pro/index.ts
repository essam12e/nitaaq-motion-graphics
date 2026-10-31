/**
 * Sound Production (node): the production pass after the Sound Director.
 *
 *   Director cues + motion events
 *     → designPro (role, profile, source, aim)              src/audio/pro/design.ts
 *     → takes: cleared library recording | uisfx | earshot render (cached in the shared library)
 *     → place: the take's onset / peak / end on the moment (+ the role's offset)
 *     → level: loudest 50 ms against the music bed (earshot bed rule), profile, importance, voice
 *     → unmask: a 3rd overlapping sound, or a detail on top of an accent, steps down
 *     → one SFX bus (audio/sfx-stem.wav), takes copied into the project (audio/sfx/)
 *     → sound-pro.json, SOUND_CREDITS.md, sfx-cues.realsfx.json (Real SFX handoff)
 *
 * Off switches (each gives the original Sound Director, bit for bit):
 * `audio.sfx.pro.enabled: false`, NITAAQ_NO_SOUND_PRO=1. Without earshot and
 * without library sounds the pass keeps the Director's own files for those cues.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SfxCue, VideoSpec } from '../../schema/video';
import type { MotionEvent } from '../../audio/events';
import { designPro, type ProPlanItem } from '../../audio/pro/design';
import { MINIMAL_STYLES, PROFILES, PROFILE_FOR_PERSONALITY, type SoundProfileId } from '../../audio/pro/profiles';
import { ROLE_RULES } from '../../audio/pro/roles';
import { creditLine } from '../../audio/pro/license';
import type { SoundPersonality } from '../../audio/sfx-families';
import { musicVolumeAt, voiceIntervals } from '../../audio/mix';
import { ROOT } from '../workspace';
import { earshotAvailable, earshotBank, renderTakes, type EarshotJob } from './earshot';
import { libraryCandidates, uisfxPack } from './library';
import { bedLevelAt, decodeStereo, measureTake, mixStem, rms50, writeWav24, type StemCue } from './mixer';

export const proEnabled = (spec: VideoSpec, env: NodeJS.ProcessEnv = process.env) => env.NITAAQ_NO_SOUND_PRO !== '1' && spec.audio.sfx.enabled && spec.audio.sfx.pro?.enabled !== false;

export function profileFor(spec: VideoSpec, personality: SoundPersonality): SoundProfileId {
  const p = spec.audio.sfx.pro?.profile;
  if (p && p in PROFILES) return p as SoundProfileId;
  if (MINIMAL_STYLES.has(String(spec.style?.look?.style ?? '')) || MINIMAL_STYLES.has(String(spec.style?.preset ?? ''))) return 'minimal';
  return PROFILE_FOR_PERSONALITY[personality] ?? 'tech';
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiOf = (note: string): number | null => {
  const m = /^([A-G])([#b]?)(-?\d)\s*([+-]\d+)c?/.exec(note.trim()) ?? /^([A-G])([#b]?)(-?\d)/.exec(note.trim());
  if (!m) return null;
  let k = NOTE.indexOf(m[1]) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  k = (k + 12) % 12;
  const cents = m[4] ? Number(m[4]) / 100 : 0;
  return 12 * (Number(m[3]) + 1) + k + cents;
};
/** Nearest chord tone (root, third, fifth) of the score's key to a sound's native pitch, within ±5 semitones. */
export function tuneNote(native: string | undefined, key: string | undefined, register = 0): string | undefined {
  if (!native || !key) return undefined;
  const n = midiOf(native);
  const km = /^([A-G]#?)\s*(major|minor)/i.exec(key);
  if (n === null || !km) return undefined;
  const root = NOTE.indexOf(km[1]);
  const tones = [0, /minor/i.test(km[2]) ? 3 : 4, 7].map((x) => (root + x) % 12);
  let best: number | null = null;
  for (let m = Math.round(n) - 6; m <= Math.round(n) + 6; m++) {
    if (!tones.includes(((m % 12) + 12) % 12)) continue;
    if (best === null || Math.abs(m - n) < Math.abs(best - n)) best = m;
  }
  if (best === null || Math.abs(best - n) > 5) return undefined;
  best += register;
  return `${NOTE[((best % 12) + 12) % 12]}${Math.floor(best / 12) - 1}`;
}

export interface ProResult {
  cues: SfxCue[];
  /** sound id → seconds from file start to the point aligned with the moment (for audio QC's sync check). */
  align: Map<string, number>;
  report: Record<string, unknown>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export async function producePro(spec: VideoSpec, projectDir: string, ctx: { cues: SfxCue[]; events: MotionEvent[]; personality: SoundPersonality; totalSec: number; seed: string; write?: boolean }): Promise<ProResult | null> {
  if (!proEnabled(spec)) {
    delete spec.audio.sfx.stem;
    return null;
  }
  const profileId = profileFor(spec, ctx.personality);
  const profile = PROFILES[profileId];
  const commercial = spec.audio.sfx.pro?.commercial !== false;
  const lib = libraryCandidates({ commercial });
  const ui = uisfxPack(profile.uiPack);
  const voice = voiceIntervals(spec);
  const design = designPro({ cues: ctx.cues, events: ctx.events, profile, totalSec: ctx.totalSec, voice, seed: ctx.seed, library: lib.cands, uisfx: Object.keys(ui).length ? ui : undefined });

  // earshot: one batch; unavailable → those cues keep the Director's own bank file
  const es = earshotAvailable();
  const bank = es.ok ? new Map(earshotBank().map((b) => [b.id, b])) : new Map();
  let key: string | undefined;
  try {
    key = (JSON.parse(readFileSync(join(projectDir, 'audio', 'soundtrack.json'), 'utf8')) as { key?: string }).key;
  } catch {
    key = undefined;
  }
  const jobs: { item: ProPlanItem; job: EarshotJob }[] = [];
  for (const it of design.items) {
    if (it.source.kind !== 'earshot' || !es.ok) continue;
    const s = it.source;
    const b = bank.get(s.id) as { dur_s?: number; knobs?: { pitch?: { note?: string } | false } } | undefined;
    if (!b) continue;
    const job: EarshotJob = { id: s.id, seed: s.seed };
    if (s.dur !== undefined) job.dur = s.dur;
    if (s.apex !== undefined) job.apex = s.apex;
    if (s.maxDur !== undefined && (b.dur_s ?? 0) > s.maxDur) job.dur = Math.round(s.maxDur * 1000) / 1000;
    const nat = b.knobs?.pitch && typeof b.knobs.pitch === 'object' ? b.knobs.pitch.note : undefined;
    if (s.tune) {
      const p = tuneNote(nat, key, profile.register);
      if (p) job.pitch = p;
    }
    jobs.push({ item: it, job });
  }
  let takes = new Map<ProPlanItem, { file: string; job: EarshotJob; clean: boolean }>();
  let earshotNote = es.why;
  if (jobs.length) {
    try {
      const res = renderTakes(jobs.map((j) => j.job));
      takes = new Map(jobs.map((j, i) => [j.item, { file: res[i].file, job: j.job, clean: res[i].clean }]));
    } catch (e) {
      earshotNote = `earshot failed, Director files kept: ${(e as Error).message.slice(0, 160)}`;
    }
  }

  // music bed: the rendered music at its own envelope (fades, ducking, automation)
  let bed: number[] | null = null;
  const m = spec.audio.music;
  if (m) {
    const src = spec.assets[m.src]?.src ?? m.src;
    const f = resolve(projectDir, src);
    if (existsSync(f)) {
      try {
        bed = rms50(decodeStereo(f), (t) => musicVolumeAt(t, spec, ctx.totalSec));
      } catch {
        bed = null;
      }
    }
  }

  // the film's typical bed: where the music thins out (pre-entry, ring-out), effects keep the level they have
  // over the typical bed instead of vanishing with it (the local bed is floored 6 dB under the film's median)
  const filmBed = bed ? (() => {
    const v = bed.filter((x) => x > -60).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  })() : null;
  const sfxDir = join(projectDir, 'audio', 'sfx');
  if (ctx.write !== false) {
    rmSync(sfxDir, { recursive: true, force: true });
    mkdirSync(sfxDir, { recursive: true });
  }
  type Placed = { it: ProPlanItem; file: string; start: number; alignAt: number; on: number; end: number; gainDb: number; bedDb: number | null; label: string; license: string; source: string };
  const placed: Placed[] = [];
  const fallback: SfxCue[] = [];
  for (const it of design.items) {
    let file: string | undefined;
    let label = '';
    let license = '';
    let source = '';
    if (it.source.kind === 'earshot') {
      const t = takes.get(it);
      if (!t) {
        fallback.push(it.base); // no earshot: the Director's own bank sound for this moment
        continue;
      }
      file = t.file;
      label = `${t.job.id}#${t.job.seed}${t.job.pitch ? `@${t.job.pitch}` : ''}`;
      license = 'earshot bank (MIT code, generated; no recorded audio)';
      source = 'earshot';
    } else {
      file = it.source.file;
      label = it.source.id;
      const e = lib.entries.find((x) => x.id === it.source.id);
      license = e ? creditLine(e.license) : 'uisfx (CC0 audio, MIT code)';
      source = it.source.kind;
    }
    const mt = measureTake(file);
    const rule = ROLE_RULES[it.role];
    const alignAt = rule.align === 'onset' ? mt.onset : rule.align === 'peak' ? mt.peak : mt.end;
    const start = it.anchorSec - alignAt;
    const b = bed ? bedLevelAt(bed, it.base.anchorSec ?? it.anchorSec) : null;
    const hasBed = filmBed !== null;
    const target = hasBed ? Math.max(b ?? -100, filmBed! - 6) + rule.bedDb + it.relDb : -20 + rule.levelDb + it.relDb;
    const gainDb = Math.min(12, target - mt.loud50) + 20 * Math.log10(Math.max(0.05, spec.audio.sfx.volume / 0.6));
    placed.push({ it, file, start, alignAt, on: start + mt.onset, end: start + mt.end, gainDb, bedDb: hasBed ? Math.max(b ?? -100, filmBed! - 6) : null, label, license, source });
  }

  // unmask: never more than maxLayers+1 at once; a non-accent on top of an accent's attack steps down 4 dB
  const unmask: string[] = [];
  for (const p of placed) {
    const over = placed.filter((q) => q !== p && q.on < p.end && p.on < q.end);
    const accentHit = over.find((q) => ROLE_RULES[q.it.role].accent && Math.abs(q.on - p.on) < 0.15 && q.it.importance >= p.it.importance);
    if (!ROLE_RULES[p.it.role].accent && accentHit) {
      p.gainDb -= 4;
      unmask.push(`${p.label} −4 dB under ${accentHit.label}`);
    } else if (over.length > profile.maxLayers && !ROLE_RULES[p.it.role].accent) {
      p.gainDb -= 3;
      unmask.push(`${p.label} −3 dB (${over.length + 1} sounds at once)`);
    }
  }

  // explicit (user) cues ride the same bus at their written level
  const stemCues: StemCue[] = placed.map((p) => ({ file: p.file, startSec: p.start, gain: 10 ** (p.gainDb / 20), pan: p.it.base.pan ?? 0 }));
  const busExtra = [...design.kept, ...fallback];
  for (const c of busExtra) {
    const f = c.file.startsWith('sfx/') ? join(ROOT, 'public', c.file) : resolve(projectDir, c.file);
    if (existsSync(f)) stemCues.push({ file: f, startSec: c.atSec, gain: c.volume, pan: c.pan ?? 0 });
  }
  const stem = mixStem(stemCues, ctx.totalSec);

  const cues: SfxCue[] = [];
  const align = new Map<string, number>();
  placed.forEach((p, i) => {
    const name = `${String(i + 1).padStart(2, '0')}-${p.it.role.replace('.', '-')}.wav`;
    const rel = `audio/sfx/${name}`;
    if (ctx.write !== false) copyFileSync(p.file, join(projectDir, rel));
    const sound = `${p.label}`;
    align.set(sound, p.alignAt);
    cues.push({ ...p.it.base, sound, file: rel, atSec: r3(Math.max(0, p.start)), volume: Math.min(1.5, r3(10 ** (p.gainDb / 20))), duration: r3(p.end - p.start), anchorSec: p.it.base.anchorSec, role: p.it.role, source: p.source, gainDb: Math.round(p.gainDb * 10) / 10 });
  });
  cues.push(...busExtra);
  cues.sort((a, b) => a.atSec - b.atSec);

  const report = {
    profile: profileId,
    profileLabel: profile.label,
    commercial,
    earshot: earshotNote,
    key: key ?? null,
    filmBedDb: filmBed === null ? null : Math.round(filmBed * 10) / 10,
    library: { cleared: lib.cands.length, skipped: lib.skipped },
    uisfxPack: Object.keys(ui).length ? profile.uiPack : null,
    directorCues: ctx.cues.length,
    cues: placed.map((p) => ({ at: r3(p.it.base.anchorSec ?? p.it.anchorSec), event: p.it.base.event, scene: p.it.base.sceneId, role: p.it.role, sound: p.label, source: p.source, align: ROLE_RULES[p.it.role].align, offsetMs: ROLE_RULES[p.it.role].offsetMs, fileStart: r3(p.start), gainDb: Math.round(p.gainDb * 10) / 10, bedDb: p.bedDb === null ? null : Math.round(p.bedDb * 10) / 10, why: p.it.why, license: p.license })),
    fallbackDirectorCues: fallback.length,
    explicitCues: design.kept.length,
    dropped: design.dropped,
    unmask,
    bus: { peakDb: Math.round(stem.peakDb * 10) / 10, trimDb: Math.round(stem.trimDb * 10) / 10 },
  };
  if (ctx.write !== false) {
    writeWav24(join(projectDir, 'audio', 'sfx-stem.wav'), stem.samples);
    spec.audio.sfx.stem = 'audio/sfx-stem.wav';
    writeFileSync(join(projectDir, 'sound-pro.json'), JSON.stringify(report, null, 2));
    const credits = [...new Set(placed.map((p) => p.license))];
    writeFileSync(join(projectDir, 'SOUND_CREDITS.md'), `# Sound credits\n\nProfile: ${profile.label}\n\n${credits.map((c) => `- ${c}`).join('\n')}\n`);
    // Real SFX handoff: the same moments as a typed cue list (from_cues.py reads it, for a pass with your own recorded library)
    const typed = placed.map((p) => ({ t: r3(p.it.base.anchorSec ?? p.it.anchorSec), type: REAL_SFX_KIND[p.it.role] ?? 'whoosh', ...(ROLE_RULES[p.it.role].aim === 'move' ? { len: r3(p.end - p.on) } : {}), g: r3(10 ** ((p.it.relDb - profile.levelDb) / 20)) }));
    writeFileSync(join(projectDir, 'sfx-cues.realsfx.json'), JSON.stringify(typed, null, 1));
  } else spec.audio.sfx.stem = 'audio/sfx-stem.wav';
  return { cues, align, report };
}

/** Production role → Real SFX event kind (references/typed-cues.md). */
const REAL_SFX_KIND: Record<string, string> = { 'whoosh.short': 'whoosh', 'whoosh.long': 'whoosh', land: 'thump', 'land.light': 'thump', hit: 'hit', drop: 'hit', click: 'click', pop: 'pop', tick: 'tick', key: 'key', riser: 'riser', swell: 'riser', shimmer: 'chime', bell: 'chime', coin: 'coin', sting: 'hit', notify: 'chime', confirm: 'chime', error: 'error', warning: 'error', snap: 'click', glitch: 'glitch' };
