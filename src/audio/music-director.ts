/**
 * Music Director (Audio Engine 2.0): decides WHERE the film's music comes from
 * and how it sits in the mix, and writes the decision as music_plan.json.
 *
 *   source priority:  user's file  >  licensed library match  >  procedural soundtrack  >  none
 *   mood/energy/BPM:  from the motion personality and pace (and the film's energy curve)
 *   hierarchy:        Voice > SFX > Music > Ambient — ducking under voice, a sidechain
 *                     dip under hero impacts, and silence when the film is better without
 *
 * Pure and deterministic; the node side resolves library candidates.
 */
import type { MotionPersonalityId } from '../motion/personality';
import type { AudioHit } from './registry';

export interface MusicTarget {
  mood: string[];
  energy: number;
  bpm: [number, number];
  style: string;
  query: string;
}

const TARGET: Record<MotionPersonalityId, MusicTarget> = {
  premium: { mood: ['luxury', 'elegant', 'calm'], energy: 0.4, bpm: [76, 92], style: 'premium', query: 'luxury elegant calm music' },
  cinematic: { mood: ['cinematic', 'epic', 'dramatic'], energy: 0.6, bpm: [80, 100], style: 'cinematic', query: 'cinematic epic music' },
  corporate: { mood: ['corporate', 'positive', 'clean'], energy: 0.5, bpm: [94, 108], style: 'corporate', query: 'corporate positive music' },
  tech: { mood: ['tech', 'modern', 'driving'], energy: 0.7, bpm: [110, 126], style: 'tech', query: 'tech modern driving music' },
  energetic: { mood: ['energetic', 'hype'], energy: 0.85, bpm: [120, 132], style: 'sport', query: 'energetic hype music' },
  sport: { mood: ['energetic', 'sport', 'hype'], energy: 0.9, bpm: [122, 134], style: 'sport', query: 'sport energetic music' },
  playful: { mood: ['playful', 'fun', 'bright'], energy: 0.65, bpm: [104, 120], style: 'playful', query: 'playful fun music' },
};

export function musicTarget(personality: MotionPersonalityId | undefined, pace?: string): MusicTarget {
  const t = { ...TARGET[personality ?? 'corporate'] };
  if (pace === 'fast') t.energy = Math.min(1, t.energy + 0.1);
  if (pace === 'slow') t.energy = Math.max(0.2, t.energy - 0.1);
  return t;
}

export interface MusicPlan {
  version: 1;
  source: 'user' | 'library' | 'procedural' | 'none';
  reason: string;
  target: MusicTarget;
  track?: { id?: string; file?: string; license?: string; attribution?: string; bpm?: number; duration?: number };
  hierarchy: { order: string[]; voiceDuck: number | null; sidechainDb: number; musicVolume: number; ambient: boolean };
  beat: { sync: boolean; bpm?: number; note: string };
  candidates: { id: string; score: number; license: string }[];
}

export function planMusic(input: {
  personality?: MotionPersonalityId;
  pace?: string;
  durationSec: number;
  voiceLed: boolean;
  userMusic?: { file: string; license?: string; duration?: number };
  wantLibrary: boolean;
  library: AudioHit[];
  proceduralAllowed: boolean;
  beats?: { bpm: number; confidence: number } | null;
  sfx: boolean;
}): MusicPlan {
  const target = musicTarget(input.personality, input.pace);
  const voiceDuck = input.voiceLed ? 0.3 : null;
  // a hero impact reads better with the music stepping aside; smaller dip under a voice (it is already ducked)
  const sidechainDb = input.sfx ? (input.voiceLed ? 1.5 : 2.5) : 0;
  const musicVolume = input.voiceLed ? 0.32 : 0.55;
  const hierarchy = { order: ['voice', 'sfx', 'music', 'ambient'], voiceDuck, sidechainDb, musicVolume, ambient: false };
  const candidates = input.library.slice(0, 5).map((h) => ({ id: h.entry.id, score: h.score, license: h.entry.license }));
  const beat = (bpm?: number) => ({ sync: !input.voiceLed && Boolean(bpm), bpm, note: input.voiceLed ? 'voice leads: cuts follow phrases, not beats' : bpm ? 'music leads: cuts and camera accents snap to downbeats' : 'no beat grid' });
  if (input.userMusic) return { version: 1, source: 'user', reason: 'the user supplied music: it is never replaced', target, track: { file: input.userMusic.file, license: input.userMusic.license, duration: input.userMusic.duration, bpm: input.beats?.bpm }, hierarchy, beat: beat(input.beats && input.beats.confidence > 0.15 ? input.beats.bpm : undefined), candidates };
  if (input.wantLibrary) {
    const fit = input.library.find((h) => h.entry.kind === 'music' && h.entry.local_available && !h.entry.path.startsWith('procedural:') && (h.entry.duration >= input.durationSec * 0.6 || h.entry.duration === 0));
    if (fit) {
      const e = fit.entry;
      return { version: 1, source: 'library', reason: `library track "${e.id}" matches ${target.mood.join('/')} (score ${fit.score}, ${e.license})`, target, track: { id: e.id, file: e.path, license: e.license, attribution: e.attribution, bpm: e.bpm, duration: e.duration }, hierarchy, beat: beat(e.bpm), candidates };
    }
  }
  if (input.proceduralAllowed) return { version: 1, source: 'procedural', reason: `${input.wantLibrary ? 'no licensed library track fits; ' : ''}procedural ${target.style} soundtrack composed to the cut (drop on the hero)`, target, hierarchy, beat: beat(undefined), candidates };
  return { version: 1, source: 'none', reason: input.voiceLed ? 'voice-led film without music: silence under the voice is cleaner than a generic bed' : 'no music requested — SFX and silence carry the rhythm', target, hierarchy: { ...hierarchy, sidechainDb: 0 }, beat: beat(undefined), candidates };
}
