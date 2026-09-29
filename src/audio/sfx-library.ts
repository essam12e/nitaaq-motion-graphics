/**
 * Categorised SFX library (CC0 — see public/sfx/CREDITS.md). Scenes suggest
 * categories; the audio planner decides whether to use them and picks a
 * concrete sound deterministically.
 */
export interface SfxSound {
  id: string;
  file: string; // relative to public/
  duration: number;
  categories: string[];
  /** Relative loudness trim applied on playback. */
  gain: number;
}

export const SFX: SfxSound[] = [
  { id: 'whoosh', file: 'sfx/whoosh.mp3', duration: 0.34, categories: ['whoosh', 'transition'], gain: 0.8 },
  { id: 'whoosh-slow', file: 'sfx/whoosh-slow.mp3', duration: 0.97, categories: ['whoosh', 'transition', 'cinematic'], gain: 0.75 },
  { id: 'swoosh', file: 'sfx/swoosh.mp3', duration: 0.24, categories: ['whoosh', 'transition', 'ui'], gain: 0.7 },
  { id: 'whoosh-low', file: 'sfx/whoosh-low.mp3', duration: 0.68, categories: ['whoosh', 'transition', 'cinematic'], gain: 0.8 },
  { id: 'whoosh-reverse', file: 'sfx/whoosh-reverse.mp3', duration: 0.76, categories: ['whoosh', 'riser', 'transition'], gain: 0.7 },
  { id: 'sweep', file: 'sfx/sweep.mp3', duration: 0.68, categories: ['sweep', 'transition'], gain: 0.7 },
  { id: 'impact', file: 'sfx/impact.mp3', duration: 0.78, categories: ['impact', 'cinematic'], gain: 0.75 },
  { id: 'impact-soft', file: 'sfx/impact-soft.mp3', duration: 0.6, categories: ['impact'], gain: 0.8 },
  { id: 'sub', file: 'sfx/sub.mp3', duration: 0.76, categories: ['impact', 'cinematic'], gain: 0.8 },
  { id: 'sub-drop', file: 'sfx/sub-drop.mp3', duration: 0.97, categories: ['impact', 'cinematic'], gain: 0.8 },
  { id: 'click', file: 'sfx/click.mp3', duration: 0.08, categories: ['click', 'ui'], gain: 0.9 },
  { id: 'tap', file: 'sfx/tap.mp3', duration: 0.16, categories: ['click', 'ui', 'pop'], gain: 0.85 },
  { id: 'snap', file: 'sfx/snap.mp3', duration: 0.13, categories: ['click', 'pop', 'ui'], gain: 0.8 },
  { id: 'pop', file: 'sfx/pop.mp3', duration: 0.21, categories: ['pop'], gain: 0.75 },
  { id: 'pop-soft', file: 'sfx/pop-soft.mp3', duration: 0.18, categories: ['pop', 'ui'], gain: 0.8 },
  { id: 'tick', file: 'sfx/tick.mp3', duration: 0.1, categories: ['tick', 'digital', 'ui'], gain: 0.7 },
  { id: 'type', file: 'sfx/type.mp3', duration: 0.1, categories: ['typing', 'ui'], gain: 0.6 },
  { id: 'ding', file: 'sfx/ding.mp3', duration: 0.6, categories: ['notification', 'success'], gain: 0.65 },
  { id: 'glass', file: 'sfx/glass.mp3', duration: 0.31, categories: ['notification', 'ui', 'digital'], gain: 0.7 },
  { id: 'success', file: 'sfx/success.mp3', duration: 0.97, categories: ['success'], gain: 0.6 },
  { id: 'reveal', file: 'sfx/reveal.mp3', duration: 1.18, categories: ['cinematic', 'riser', 'sweep'], gain: 0.6 },
  { id: 'glitch', file: 'sfx/glitch.mp3', duration: 0.18, categories: ['glitch', 'digital'], gain: 0.55 },
  { id: 'riser', file: 'sfx/riser.mp3', duration: 0.6, categories: ['riser'], gain: 0.6 },
  { id: 'riser-long', file: 'sfx/riser-long.mp3', duration: 3.06, categories: ['riser', 'cinematic'], gain: 0.5 },
  { id: 'swell', file: 'sfx/swell.mp3', duration: 1.67, categories: ['riser', 'cinematic', 'sweep'], gain: 0.55 },
  { id: 'shutter', file: 'sfx/shutter.mp3', duration: 0.16, categories: ['shutter', 'ui'], gain: 0.7 },
];

export const SFX_CATEGORIES = [
  'whoosh',
  'impact',
  'click',
  'pop',
  'tick',
  'success',
  'notification',
  'glitch',
  'riser',
  'sweep',
  'shutter',
  'transition',
  'ui',
  'typing',
  'digital',
  'cinematic',
] as const;

export function getSfx(idOrCategory: string, seed = 0): SfxSound | undefined {
  const byId = SFX.find((s) => s.id === idOrCategory);
  if (byId) return byId;
  const pool = SFX.filter((s) => s.categories.includes(idOrCategory));
  if (!pool.length) return undefined;
  return pool[Math.abs(seed) % pool.length];
}

export function isKnownSfx(idOrCategory: string): boolean {
  return Boolean(getSfx(idOrCategory));
}
