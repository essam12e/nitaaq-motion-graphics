/**
 * SFX family registry (browser-safe data). A FAMILY is a kind of sound with a
 * meaning; each family has several VARIANTS (code-generated at setup into
 * public/sfx/gen, deterministic, plus the CC0 library files that fit it), so
 * the Sound Director can say the same thing without repeating the same file.
 *
 * Intents are what a moment means for sound (contact-heavy, ui-confirm,
 * signature…); the Sound Director maps motion events → intents → families,
 * filtered by the film's sound personality.
 */
import { CapabilityRegistry } from '../core/registry';

export const SOUND_PERSONALITIES = ['luxury', 'tech', 'sport', 'playful', 'cinematic', 'corporate'] as const;
export type SoundPersonality = (typeof SOUND_PERSONALITIES)[number];

export const INTENTS = [
  'motion-air',
  'motion-heavy',
  'motion-fast',
  'contact-soft',
  'contact-heavy',
  'contact-punch',
  'ui-tap',
  'ui-confirm',
  'ui-appear',
  'ui-swipe',
  'ui-type',
  'state-success',
  'state-error',
  'state-warning',
  'notify',
  'count-tick',
  'count-final',
  'price',
  'signature',
  'sparkle',
  'reveal-build',
  'reveal-hit',
  'tease',
  'draw',
  'map-pin',
  'map-route',
] as const;
export type Intent = (typeof INTENTS)[number];

export type Layer = 'movement' | 'impact' | 'detail' | 'single';

export interface SfxFamily {
  id: string;
  intents: Intent[];
  /** Personalities this family suits (others may still use it with a penalty). */
  personalities: SoundPersonality[];
  layer: Layer;
  /** Base playback gain (before importance / mix). */
  gain: number;
  /** Generated variants (public/sfx/gen/<id>-<n>.wav). */
  variants: number;
  /** CC0 library files (public/sfx) that also belong to this family. */
  library?: string[];
  /** Ducked hard under voice (detail sounds) vs kept (impacts at reduced gain). */
  duckClass: 'detail' | 'accent';
}

const ALL: SoundPersonality[] = [...SOUND_PERSONALITIES];
const FAMILIES: SfxFamily[] = [
  { id: 'whoosh-air', intents: ['motion-air'], personalities: ['luxury', 'corporate', 'cinematic', 'tech'], layer: 'movement', gain: 0.55, variants: 5, library: ['whoosh', 'whoosh-slow'], duckClass: 'detail' },
  { id: 'whoosh-deep', intents: ['motion-heavy'], personalities: ['cinematic', 'luxury', 'sport'], layer: 'movement', gain: 0.6, variants: 5, library: ['whoosh-low'], duckClass: 'detail' },
  { id: 'swoosh-fast', intents: ['motion-fast', 'ui-swipe'], personalities: ['sport', 'tech', 'playful', 'corporate'], layer: 'movement', gain: 0.55, variants: 5, library: ['swoosh'], duckClass: 'detail' },
  { id: 'swipe-ui', intents: ['ui-swipe'], personalities: ['tech', 'corporate', 'playful', 'luxury'], layer: 'single', gain: 0.45, variants: 5, duckClass: 'detail' },
  { id: 'impact-soft', intents: ['contact-soft'], personalities: ['luxury', 'corporate', 'cinematic', 'tech'], layer: 'impact', gain: 0.6, variants: 5, library: ['impact-soft'], duckClass: 'accent' },
  { id: 'impact-punch', intents: ['contact-punch', 'contact-heavy'], personalities: ['sport', 'tech', 'playful'], layer: 'impact', gain: 0.62, variants: 5, library: ['impact'], duckClass: 'accent' },
  { id: 'thud-heavy', intents: ['contact-heavy'], personalities: ['sport', 'cinematic', 'luxury', 'corporate'], layer: 'impact', gain: 0.7, variants: 5, library: ['sub'], duckClass: 'accent' },
  { id: 'boom-sub', intents: ['reveal-hit', 'contact-heavy'], personalities: ['cinematic', 'sport', 'luxury', 'tech'], layer: 'impact', gain: 0.7, variants: 5, library: ['sub-drop'], duckClass: 'accent' },
  { id: 'click-ui', intents: ['ui-tap', 'ui-confirm'], personalities: ['tech', 'corporate'], layer: 'single', gain: 0.5, variants: 5, library: ['click'], duckClass: 'detail' },
  { id: 'tap-soft', intents: ['ui-tap', 'ui-appear'], personalities: ['luxury', 'playful', 'corporate', 'cinematic'], layer: 'single', gain: 0.45, variants: 5, library: ['tap'], duckClass: 'detail' },
  { id: 'button-press', intents: ['ui-confirm', 'ui-tap'], personalities: ['tech', 'corporate', 'playful', 'sport'], layer: 'impact', gain: 0.55, variants: 5, library: ['snap'], duckClass: 'accent' },
  { id: 'pop-bubble', intents: ['ui-appear'], personalities: ['playful'], layer: 'single', gain: 0.45, variants: 5, library: ['pop', 'pop-soft'], duckClass: 'detail' },
  { id: 'blip-digital', intents: ['ui-appear', 'count-tick'], personalities: ['tech', 'corporate', 'sport'], layer: 'single', gain: 0.38, variants: 5, library: ['tick'], duckClass: 'detail' },
  { id: 'tick-soft', intents: ['count-tick', 'ui-appear'], personalities: ['luxury', 'corporate', 'cinematic'], layer: 'single', gain: 0.35, variants: 5, duckClass: 'detail' },
  { id: 'chime-success', intents: ['state-success', 'count-final'], personalities: ALL, layer: 'single', gain: 0.5, variants: 5, library: ['success'], duckClass: 'accent' },
  { id: 'buzz-error', intents: ['state-error'], personalities: ALL, layer: 'single', gain: 0.45, variants: 5, duckClass: 'accent' },
  { id: 'tone-warning', intents: ['state-warning'], personalities: ALL, layer: 'single', gain: 0.45, variants: 5, duckClass: 'accent' },
  { id: 'ding-notify', intents: ['notify'], personalities: ALL, layer: 'single', gain: 0.45, variants: 5, library: ['ding', 'glass'], duckClass: 'accent' },
  { id: 'key-type', intents: ['ui-type'], personalities: ['tech', 'corporate', 'playful'], layer: 'detail', gain: 0.3, variants: 5, library: ['type'], duckClass: 'detail' },
  { id: 'riser-tension', intents: ['reveal-build', 'tease'], personalities: ['sport', 'tech', 'cinematic', 'playful'], layer: 'movement', gain: 0.45, variants: 5, library: ['riser'], duckClass: 'detail' },
  { id: 'swell-reverse', intents: ['tease', 'reveal-build'], personalities: ['cinematic', 'luxury', 'corporate'], layer: 'movement', gain: 0.45, variants: 5, library: ['whoosh-reverse', 'swell'], duckClass: 'detail' },
  { id: 'shimmer', intents: ['sparkle', 'signature'], personalities: ['luxury', 'cinematic', 'playful'], layer: 'detail', gain: 0.32, variants: 5, library: ['reveal'], duckClass: 'detail' },
  { id: 'glass-ting', intents: ['sparkle', 'price', 'signature'], personalities: ['luxury', 'corporate', 'tech'], layer: 'detail', gain: 0.32, variants: 5, duckClass: 'detail' },
  { id: 'light-sweep', intents: ['motion-air', 'signature'], personalities: ['luxury', 'cinematic', 'corporate'], layer: 'movement', gain: 0.4, variants: 5, library: ['sweep'], duckClass: 'detail' },
  { id: 'coin-chime', intents: ['price', 'count-final'], personalities: ['playful', 'sport', 'corporate', 'tech'], layer: 'single', gain: 0.42, variants: 5, duckClass: 'accent' },
  { id: 'logo-stinger', intents: ['signature'], personalities: ALL, layer: 'impact', gain: 0.55, variants: 5, duckClass: 'accent' },
  { id: 'marker-stroke', intents: ['draw'], personalities: ALL, layer: 'single', gain: 0.35, variants: 5, duckClass: 'detail' },
  { id: 'pluck-pin', intents: ['map-pin', 'ui-appear'], personalities: ['corporate', 'tech', 'playful', 'luxury', 'cinematic'], layer: 'single', gain: 0.42, variants: 5, duckClass: 'detail' },
  { id: 'route-glide', intents: ['map-route'], personalities: ALL, layer: 'movement', gain: 0.38, variants: 5, duckClass: 'detail' },
  { id: 'shutter-camera', intents: ['ui-appear'], personalities: ['tech', 'corporate'], layer: 'single', gain: 0.38, variants: 3, library: ['shutter'], duckClass: 'detail' },
  { id: 'glitch-digital', intents: ['motion-fast'], personalities: ['tech'], layer: 'single', gain: 0.32, variants: 3, library: ['glitch'], duckClass: 'detail' },
  { id: 'paper-slide', intents: ['ui-swipe', 'motion-air'], personalities: ['corporate', 'playful', 'luxury'], layer: 'movement', gain: 0.38, variants: 4, duckClass: 'detail' },
];

export const SfxFamilyRegistry = new CapabilityRegistry<SfxFamily>('sfx-family');
for (const f of FAMILIES) if (!SfxFamilyRegistry.has(f.id)) SfxFamilyRegistry.register(f);

/** A concrete playable sound (one variant) with measured metadata. */
export interface SfxVariant {
  id: string;
  family: string;
  file: string; // relative to public/
  duration: number;
  /** Seconds from file start to the perceived hit (envelope peak). */
  peakAt: number;
  /** RMS level (0..1), used to even out loudness between variants. */
  rms: number;
  source: 'generated' | 'library';
}

/** Index of all variants (generated + library), built node-side (src/audio/synth/sfx-gen.ts). */
export interface SfxBankIndex {
  version: number;
  variants: SfxVariant[];
}

export function familiesFor(intent: Intent): SfxFamily[] {
  return SfxFamilyRegistry.list().filter((f) => f.intents.includes(intent));
}
