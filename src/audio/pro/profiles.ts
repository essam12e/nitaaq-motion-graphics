/**
 * Sound Profiles: how a production type is voiced. These are selection and
 * placement settings for the Sound Production layer, not new analysis: which
 * sounds play each role, how dense the film is, how loud the effects sit and
 * how many layers a key moment may carry.
 */
import type { ProRole } from './roles';
import type { SoundPersonality } from '../sfx-families';

export const SOUND_PROFILES = ['premium', 'tech', 'sport', 'minimal'] as const;
export type SoundProfileId = (typeof SOUND_PROFILES)[number];

export interface SoundProfile {
  id: SoundProfileId;
  label: string;
  /** Multiplies the Director's cue count (silence is part of the design). */
  density: number;
  /** Cues below this importance are left silent (0..1). */
  minImportance: number;
  /** dB on every effect (the balance against music and voice). */
  levelDb: number;
  /** Most effects sounding together on one moment. */
  maxLayers: number;
  /** Roles this profile never voices (the moment stays quiet). */
  silent: ProRole[];
  /** Movement layers (whooshes before a contact) only on moments at least this important. */
  movementMinImportance: number;
  /** earshot bank ids per role, in preference order (a film rotates through them). */
  earshot: Partial<Record<ProRole, string[]>>;
  /** uisfx pack for interface moments. */
  uiPack: string;
  /** Extra semitones on tonal sounds after tuning to the score (bright = up). */
  register: number;
  /** A role this profile voices differently (e.g. minimal: a sub drop becomes a dry landing). */
  substitute?: Partial<Record<ProRole, ProRole>>;
}

export const PROFILES: Record<SoundProfileId, SoundProfile> = {
  premium: {
    id: 'premium',
    label: 'Premium / Luxury: few deep effects, soft transitions, a refined logo sting',
    density: 0.7,
    minImportance: 0.4,
    levelDb: -2,
    maxLayers: 2,
    silent: ['glitch', 'tick', 'key', 'snap'],
    movementMinImportance: 0.5,
    earshot: {
      'whoosh.short': ['swipe/velvet', 'swish/soft', 'swipe/glide'],
      'whoosh.long': ['pro_whoosh_big/swell', 'whoosh_big/thump_airy', 'pro_whoosh_big/windy'],
      land: ['pro_pop_in/deep', 'knock/wood', 'pro_impact/air'],
      'land.light': ['pro_tap/soft', 'fit/land.light/finger_wood'],
      hit: ['pro_impact/air', 'cut_hit/air'],
      drop: ['pro_sub_drop/quick'], // short: long sub drops read as trailer, not luxury (Real SFX taste tests)
      click: ['fit/click/floss_lid', 'pro_click/soft'],
      pop: ['ui_pop/soft', 'ui_pop/step'],
      riser: ['riser/dark'],
      swell: ['reverse_swell/breath', 'reverse_swell/dark'],
      shimmer: ['pro_shimmer/m3', 'pro_shimmer/m1'],
      bell: ['mallet/celesta'],
      coin: ['mallet/celesta', 'mallet/glock'],
      sting: ['logo_sting/soft_bloom', 'logo_sting/whoosh_glass'],
      notify: ['notify/mid_tine'],
      confirm: ['notify/mid_wood'],
    },
    uiPack: 'glass',
    register: 0,
  },
  tech: {
    id: 'tech',
    label: 'Technology / SaaS: precise UI sounds, digital transitions, light synced accents',
    density: 1,
    minImportance: 0.3,
    levelDb: -1,
    maxLayers: 2,
    silent: [],
    movementMinImportance: 0.6,
    earshot: {
      'whoosh.short': ['swish/bright', 'whoosh_fast/tight', 'swish/flick'],
      'whoosh.long': ['pro_whoosh_big/tonal', 'whoosh_big/thump_airy'],
      land: ['pro_pop_in/round', 'pro_pop_in/knock'],
      'land.light': ['pro_tap/glass', 'pro_tap/finger'],
      hit: ['cut_hit/punch', 'pro_impact/short'],
      drop: ['cut_hit/sub'],
      click: ['pro_click/mouse', 'fit/click/floss_lid', 'pro_click/glass'],
      pop: ['ui_pop/blip', 'pro_pop/boop'],
      tick: ['pro_hover_tick/ping', 'hover_tick/air'],
      key: ['typing_key/laptop', 'pro_typing_key/soft'],
      riser: ['pro_riser/nblips', 'riser/dark'],
      swell: ['reverse_swell/short'],
      shimmer: ['pro_shimmer/m3'],
      bell: ['mallet/glock'],
      coin: ['mallet/glock'],
      sting: ['pro_logo_sting/taps_tone', 'pro_logo_sting/zap_bloom'],
      notify: ['pro_notify/ding_1930', 'notify/mid_tine'],
      confirm: ['notify/mid_tine'],
      snap: ['shutter/quick'],
      glitch: ['pro_glitch/sparse', 'glitch/mid'],
    },
    uiPack: 'studio',
    register: 0,
  },
  sport: {
    id: 'sport',
    label: 'Sport / Energy: strong impacts, fast whooshes, a clear motion rhythm',
    density: 1.2,
    minImportance: 0.25,
    levelDb: 0,
    maxLayers: 3,
    silent: ['shimmer'],
    movementMinImportance: 0.45,
    earshot: {
      'whoosh.short': ['whoosh_fast/whip', 'whoosh_fast/heavy', 'swish/blade'],
      'whoosh.long': ['pro_whoosh_big/gritty', 'whoosh_big/thump_deep', 'whoosh_big/thump'],
      land: ['cut_hit/kick', 'pro_pop_in/deep'],
      'land.light': ['pro_tap/knock'],
      hit: ['cut_hit/punch', 'pro_impact/short', 'pro_impact/deep'],
      drop: ['pro_sub_drop/quick', 'cut_hit/sub'],
      click: ['pro_click/snap', 'toggle/rocker'],
      pop: ['pro_pop/thup'],
      tick: ['hover_tick/mid'],
      key: ['typing_key/crisp'],
      riser: ['riser/snatch', 'riser/dark'],
      swell: ['reverse_swell/cymbal'],
      bell: ['mallet/marimba'],
      coin: ['mallet/glock'],
      sting: ['pro_logo_sting/sweep_hit', 'pro_logo_sting/swell_sting'],
      notify: ['pro_notify/ding_2045'],
      confirm: ['notify/mid_wood'],
      snap: ['shutter/snap'],
      glitch: ['glitch/hit'],
    },
    uiPack: 'mechanical',
    register: 0,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal / Editorial: very few sounds, deliberate silence, the voice first',
    density: 0.4,
    minImportance: 0.7,
    levelDb: -4,
    maxLayers: 1,
    silent: ['glitch', 'tick', 'key', 'snap', 'riser', 'swell', 'shimmer', 'drop', 'whoosh.long'],
    movementMinImportance: 1.1, // never: a minimal film has no movement layers
    earshot: {
      'whoosh.short': ['swish/soft', 'swipe/paper'],
      land: ['knock/wood', 'pro_tap/soft'],
      'land.light': ['pro_tap/soft'],
      hit: ['knock/desk'],
      click: ['fit/click/floss_lid'],
      pop: ['ui_pop/soft'],
      bell: ['mallet/celesta'],
      coin: ['mallet/celesta'],
      sting: ['mallet/celesta'],
      notify: ['notify/mid_wood'],
      confirm: ['notify/mid_wood'],
    },
    uiPack: 'minimal',
    register: 0,
    substitute: { drop: 'land', hit: 'land' },
  },
};

/** Default profile from the Director's sound personality (brief `audio.soundProfile` wins). */
export const PROFILE_FOR_PERSONALITY: Record<SoundPersonality, SoundProfileId> = {
  luxury: 'premium',
  cinematic: 'premium',
  tech: 'tech',
  corporate: 'tech',
  sport: 'sport',
  playful: 'tech',
};

/** Editorial styles read as minimal even when the motion personality is not. */
export const MINIMAL_STYLES = new Set(['editorial', 'swiss-motion', 'minimal', 'swiss', 'editorial-serif', 'monochrome']);
