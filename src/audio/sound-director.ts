/**
 * NITAAQ Sound Director — sound follows MEANING and MOTION, not scene starts.
 *
 *   motion events (with anchors) → semantic intent → sound family (filtered by
 *   the sound personality) → variant (scored against this film AND recent
 *   films) → layering (movement + impact + detail on key moments) → sync (the
 *   file's measured peak lands on the motion anchor) → mix (importance, voice
 *   competition, music hits, loudness matching) → density budget →
 *   repetition check.
 *
 * Pure and deterministic (seeded). The node wrapper (src/node/sound.ts) feeds
 * it the bank index, history and timeline, and writes the cues into video.json.
 */
import { createRng } from '../core/rng';
import type { MotionEvent } from './events';
import { SfxFamilyRegistry, familiesFor, type Intent, type SfxBankIndex, type SfxFamily, type SfxVariant, type SoundPersonality } from './sfx-families';
import type { SfxCue } from '../schema/video';

export interface SoundDirectorInput {
  events: MotionEvent[];
  personality: SoundPersonality;
  /** 0..1 SFX intensity (density). */
  intensity: number;
  /** 0..1 master SFX volume. */
  volume: number;
  durationSec: number;
  bank: SfxBankIndex;
  /** Variant ids used by recent films (most recent last). */
  history?: string[];
  voice?: { start: number; end: number }[];
  /** Strong accents of the music (downbeats / soundtrack hits), absolute seconds. */
  musicHits?: number[];
  hasMusic?: boolean;
  seed: string | number;
  /** User override: family or variant id → project file. */
  overrides?: Record<string, string>;
}

export interface SoundReport {
  events: number;
  considered: number;
  cues: number;
  dropped: { type: string; at: number; why: string }[];
  uniqueVariants: number;
  maxSameVariant: number;
  consecutiveSameVariant: number;
  consecutiveSameFamily: number;
  families: Record<string, number>;
  maxPer10s: number;
  budget: number;
  syncErrorMaxMs: number;
  voiceOverlapCues: number;
  historyReuse: number;
}

/** Semantic intent of a motion event (what the moment MEANS for sound). */
export function intentOf(e: MotionEvent, p: SoundPersonality): Intent | null {
  const soft = p === 'luxury' || p === 'corporate' || p === 'cinematic';
  const heavy = e.mass === 'heavy' || e.mass === 'massive';
  switch (e.type) {
    case 'scene_start':
      return null;
    case 'headline_reveal':
      return p === 'sport' ? 'motion-fast' : 'motion-air';
    case 'word_impact':
      return soft ? 'contact-soft' : 'contact-punch';
    case 'text_reveal':
      return 'motion-air';
    case 'product_entry':
      return heavy ? 'motion-heavy' : 'motion-air';
    case 'product_peak_velocity':
      return 'motion-fast';
    case 'product_land':
      return heavy || e.impact > 0.6 ? 'contact-heavy' : 'contact-soft';
    case 'button_press':
    case 'cta_reveal':
      return 'ui-confirm';
    case 'success_state':
      return 'state-success';
    case 'error_state':
      return 'state-error';
    case 'warning_state':
      return 'state-warning';
    case 'notification':
      return 'notify';
    case 'ui_appear':
    case 'card_entry':
      return e.direction === 'left' || e.direction === 'right' ? 'ui-swipe' : 'ui-appear';
    case 'swipe':
      return 'ui-swipe';
    case 'typing':
      return 'ui-type';
    case 'chart_grow':
      return 'motion-air';
    case 'chart_peak':
      return 'contact-soft';
    case 'counter_tick':
      return 'count-tick';
    case 'counter_final':
      return 'count-final';
    case 'price_reveal':
      return 'price';
    case 'logo_reveal':
      return 'signature';
    case 'scene_transition': {
      const t = e.transition ?? '';
      if (['cut', 'none', 'crossfade', 'match-cut', 'shared', 'morph'].includes(t)) return null; // continuity transitions stay silent
      if (['whip', 'speed-ramp', 'object-sweep', 'text-sweep', 'glitch'].includes(t)) return 'motion-fast';
      if (['camera-push', 'zoom-in', 'depth', 'camera-pull', 'zoom-out'].includes(t)) return heavy ? 'motion-heavy' : 'motion-air';
      if (t === 'page' || t === 'push' || t === 'slide') return 'ui-swipe';
      return 'motion-air';
    }
    case 'draw_stroke':
      return 'draw';
    case 'map_route':
      return 'map-route';
    case 'map_pin':
      return 'map-pin';
    case 'camera_move':
      return 'motion-air';
    case 'hero_reveal':
      return 'reveal-hit';
    case 'tease':
      return 'tease';
    default:
      return null;
  }
}

/** Which layer an intent sits in (movement before the contact, impact on it, detail after). */
const IMPACT_INTENTS: Intent[] = ['contact-heavy', 'contact-punch', 'reveal-hit', 'signature', 'contact-soft'];
const SPARKLE_PERSONALITIES: SoundPersonality[] = ['luxury', 'cinematic', 'playful'];

/** Families that build toward a moment (aligned by their end, not a peak). */
const BUILD_FAMILIES = new Set(['riser-tension', 'swell-reverse']);

export function directSound(input: SoundDirectorInput): { cues: SfxCue[]; report: SoundReport } {
  const rng = createRng(`${input.seed}:sound`).next;
  const P = input.personality;
  const voice = input.voice ?? [];
  const inVoice = (t: number) => voice.some((v) => t >= v.start - 0.05 && t <= v.end + 0.05);
  const hits = input.musicHits ?? [];
  const nearHit = (t: number) => hits.some((h) => Math.abs(h - t) < 0.08);
  const history = input.history ?? [];
  const recentHist = new Set(history.slice(-60));
  const byFamily = new Map<string, SfxVariant[]>();
  for (const v of input.bank.variants) byFamily.set(v.family, [...(byFamily.get(v.family) ?? []), v]);

  // ── density budget: cues per film from duration × intensity; essential moments first
  const budget = Math.max(2, Math.round(input.durationSec * (0.3 + 0.7 * input.intensity)));
  const dropped: SoundReport['dropped'] = [];
  const cands = input.events
    .map((e) => ({ e, intent: intentOf(e, P) }))
    .filter((x): x is { e: MotionEvent; intent: Intent } => {
      if (!x.intent) {
        dropped.push({ type: x.e.type, at: x.e.syncSec, why: 'no sound for this moment (continuity / silence is the right choice)' });
        return false;
      }
      return true;
    });
  // importance threshold scales with intensity: quiet films keep only what matters
  const minImp = 0.42 - input.intensity * 0.32;
  const ranked = [...cands].sort((a, b) => b.e.importance - a.e.importance || a.e.syncSec - b.e.syncSec);
  const accepted: { e: MotionEvent; intent: Intent }[] = [];
  for (const c of ranked) {
    const t = c.e.syncSec;
    if (c.e.importance < minImp) {
      dropped.push({ type: c.e.type, at: t, why: `below the importance threshold for intensity ${input.intensity}` });
      continue;
    }
    if (t > input.durationSec - 0.05) {
      dropped.push({ type: c.e.type, at: t, why: 'after the end of the film' });
      continue;
    }
    const isKey = c.e.importance >= 0.85;
    if (!isKey && accepted.length >= budget) {
      dropped.push({ type: c.e.type, at: t, why: 'density budget reached' });
      continue;
    }
    const clash = accepted.find((a) => Math.abs(a.e.syncSec - t) < (isKey ? 0.09 : 0.16));
    if (clash) {
      dropped.push({ type: c.e.type, at: t, why: `too close to ${clash.e.type}` });
      continue;
    }
    if (accepted.filter((a) => Math.abs(a.e.syncSec - t) < 0.5).length >= (input.intensity > 0.7 ? 3 : 2) && !isKey) {
      dropped.push({ type: c.e.type, at: t, why: 'local density (half-second window full)' });
      continue;
    }
    // voice competition: detail sounds under speech are dropped unless they matter
    const fam0 = familiesFor(c.intent)[0];
    if (inVoice(t) && fam0?.duckClass === 'detail' && c.e.importance < 0.6) {
      dropped.push({ type: c.e.type, at: t, why: 'would compete with the voice' });
      continue;
    }
    accepted.push(c);
  }
  accepted.sort((a, b) => a.e.syncSec - b.e.syncSec);

  // ── variant selection with film + history memory
  const usedVar = new Map<string, number>();
  const usedFam = new Map<string, number>();
  const cues: SfxCue[] = [];
  let lastFile = '';
  let lastFamily = '';
  const totalPlanned = accepted.length * 1.4;
  const varCap = Math.max(2, Math.ceil(totalPlanned / 6));

  const chooseFamily = (intent: Intent, avoidFamily?: string): SfxFamily | undefined => {
    const fams = familiesFor(intent).filter((f) => (byFamily.get(f.id)?.length ?? 0) > 0);
    if (!fams.length) return undefined;
    const scored = fams.map((f) => {
      let s = f.personalities.includes(P) ? 1 : 0.35;
      s -= (usedFam.get(f.id) ?? 0) * 0.12;
      if (f.id === avoidFamily) s -= 0.5;
      s += rng() * 0.08;
      return { f, s };
    });
    return scored.sort((a, b) => b.s - a.s)[0].f;
  };
  const chooseVariant = (fam: SfxFamily, atSec: number, maxDur = Infinity): SfxVariant | undefined => {
    const vs = byFamily.get(fam.id) ?? [];
    const scored = vs
      .filter((v) => v.file !== lastFile && v.duration <= maxDur)
      .map((v) => {
        const n = usedVar.get(v.id) ?? 0;
        let s = 1 - n * 0.6;
        if (n >= varCap) s -= 2;
        // same file within 3 s anywhere in the film reads as a loop
        if (cues.some((c) => c.file === v.file && Math.abs(c.atSec - atSec) < 3)) s -= 1.2;
        if (recentHist.has(v.id)) s -= 0.35;
        if (v.source === 'library') s -= 0.05; // generated variants are tuned to the bank's loudness
        s += rng() * 0.1;
        return { v, s };
      })
      .sort((a, b) => b.s - a.s);
    return scored[0]?.v;
  };
  const peakUsed: number[] = [];
  const built = new Set<MotionEvent>(); // reveals a tease build already leads into
  const loud = (v: SfxVariant) => Math.max(0.5, Math.min(1.6, 0.1 / Math.max(0.02, v.rms)));
  const push = (e: MotionEvent, fam: SfxFamily, v: SfxVariant, anchorSec: number, layer: SfxCue['layer'], gainK: number, anchorName: string) => {
    let atSec = anchorSec - v.peakAt;
    if (atSec < 0) atSec = 0;
    let vol = fam.gain * (0.55 + 0.45 * e.importance) * loud(v) * input.volume * gainK;
    if (layer === 'impact') vol *= 0.75 + 0.25 * e.impact;
    if (inVoice(anchorSec)) vol *= fam.duckClass === 'accent' ? 0.6 : 0.4;
    if (input.hasMusic && nearHit(anchorSec) && (layer === 'impact' || layer === 'single')) vol *= 0.7; // the music already accents this moment
    const file = input.overrides?.[v.id] ?? input.overrides?.[fam.id] ?? v.file;
    peakUsed.push(v.peakAt);
    cues.push({ sceneId: e.sceneId, sound: v.id, family: fam.id, file, atSec: Math.round(atSec * 1000) / 1000, volume: Math.round(Math.min(1, vol) * 1000) / 1000, duration: v.duration, event: e.type, anchor: anchorName, anchorSec: Math.round(anchorSec * 1000) / 1000, layer, pan: 0 });
    usedVar.set(v.id, (usedVar.get(v.id) ?? 0) + 1);
    usedFam.set(fam.id, (usedFam.get(fam.id) ?? 0) + 1);
    lastFile = file;
    lastFamily = fam.id;
  };

  for (const { e, intent } of accepted) {
    const key = e.importance >= 0.85 && IMPACT_INTENTS.includes(intent);
    const room = input.intensity >= 0.35;
    // movement layer: arrives with the motion (its peak on the velocity peak), ends into the contact
    if ((key && room && intent !== 'signature') || (intent === 'signature' && e.importance >= 0.9 && room)) {
      const mi: Intent = intent === 'contact-heavy' || intent === 'reveal-hit' ? 'motion-heavy' : intent === 'signature' ? (P === 'luxury' || P === 'cinematic' ? 'motion-air' : 'motion-fast') : 'motion-fast';
      const peak = e.anchors.peak < e.syncSec - 0.06 ? e.anchors.peak : e.syncSec - 0.12;
      const fam = chooseFamily(mi);
      const v = fam && chooseVariant(fam, peak);
      if (fam && v && peak - v.peakAt >= 0) push(e, fam, v, peak, 'movement', 0.7, 'peak');
    }
    // the tension build before a hero reveal (only with room, no voice)
    if (intent === 'reveal-hit' && room && !inVoice(e.syncSec - 0.6) && !built.has(e)) {
      const fam = chooseFamily('reveal-build');
      const v = fam && chooseVariant(fam, e.syncSec, e.syncSec - 0.1);
      if (fam && v) {
        // risers end AT the hit: align the file end (not its peak) to the anchor
        const fake = { ...v, peakAt: v.duration - 0.02 };
        push(e, fam, fake, e.syncSec, 'movement', 0.6, 'start');
      }
    }
    // the main sound (impact / single)
    const fam = chooseFamily(intent, intent === 'motion-air' || intent === 'ui-appear' ? lastFamily : undefined);
    if (fam && BUILD_FAMILIES.has(fam.id)) {
      // a build (tease) has no hit of its own: it ends exactly on the reveal it leads to
      const next = accepted.find((o) => o.e !== e && o.e.sceneId === e.sceneId && o.e.syncSec > e.syncSec + 0.3 && o.e.syncSec - e.syncSec < 4 && o.e.importance >= 0.85);
      const target = next ? next.e.syncSec : e.anchors.completion > e.syncSec + 0.6 ? e.anchors.completion : e.syncSec + 1.6;
      const bv = chooseVariant(fam, target, target - Math.max(0, e.syncSec - 0.05));
      if (!bv) {
        dropped.push({ type: e.type, at: e.syncSec, why: 'no build short enough to end on the reveal' });
        continue;
      }
      if (next) built.add(next.e);
      push(e, fam, { ...bv, peakAt: bv.duration - 0.02 }, target, 'movement', 0.9, next ? `end→${next.e.type}` : 'completion');
      continue;
    }
    const v = fam && chooseVariant(fam, e.syncSec);
    if (!fam || !v) {
      dropped.push({ type: e.type, at: e.syncSec, why: `no variant for ${intent}` });
      continue;
    }
    push(e, fam, v, e.syncSec, key ? 'impact' : fam.layer === 'movement' ? 'movement' : 'single', 1, e.anchor);
    // detail layer: a sparkle on key brand/product moments for personalities that suit it
    if (key && room && SPARKLE_PERSONALITIES.includes(P) && (intent === 'signature' || intent === 'reveal-hit' || e.type === 'product_land')) {
      const df = chooseFamily('sparkle');
      const dv = df && chooseVariant(df, e.syncSec + 0.05);
      if (df && dv) push(e, df, dv, e.syncSec + 0.05, 'detail', 0.55, 'settle');
    }
  }
  // sync error per cue (file peak vs. the visual anchor), measured before sorting
  const syncErr = cues.map((c, i) => (c.anchorSec === undefined ? 0 : Math.abs(c.atSec + peakUsed[i] - c.anchorSec) * 1000));
  cues.sort((a, b) => a.atSec - b.atSec);

  // ── repetition check (report)
  const counts: Record<string, number> = {};
  const fams: Record<string, number> = {};
  let consecutive = 0;
  let consecutiveFam = 0;
  cues.forEach((c, i) => {
    counts[c.sound] = (counts[c.sound] ?? 0) + 1;
    fams[c.family] = (fams[c.family] ?? 0) + 1;
    if (i > 0 && cues[i - 1].file === c.file) consecutive++;
    if (i > 0 && cues[i - 1].family === c.family && c.layer === cues[i - 1].layer) consecutiveFam++;
  });
  let maxPer10 = 0;
  for (const c of cues) maxPer10 = Math.max(maxPer10, cues.filter((d) => d.atSec >= c.atSec && d.atSec < c.atSec + 10).length);
  return {
    cues,
    report: {
      events: input.events.length,
      considered: cands.length,
      cues: cues.length,
      dropped,
      uniqueVariants: Object.keys(counts).length,
      maxSameVariant: Math.max(0, ...Object.values(counts)),
      consecutiveSameVariant: consecutive,
      consecutiveSameFamily: consecutiveFam,
      families: fams,
      maxPer10s: maxPer10,
      budget,
      syncErrorMaxMs: Math.round(Math.max(0, ...syncErr)),
      voiceOverlapCues: cues.filter((c) => inVoice(c.anchorSec ?? c.atSec)).length,
      historyReuse: cues.filter((c) => recentHist.has(c.sound)).length,
    },
  };
}

/** Motion personality → sound personality (brand-motion / brief can override). */
export const SOUND_FOR_MOTION: Record<string, SoundPersonality> = { premium: 'luxury', cinematic: 'cinematic', corporate: 'corporate', tech: 'tech', energetic: 'sport', sport: 'sport', playful: 'playful' };

export const familyOf = (id: string) => SfxFamilyRegistry.get(id);
