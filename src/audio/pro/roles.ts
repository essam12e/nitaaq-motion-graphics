/**
 * Sound Production roles (browser-safe data).
 *
 * The Sound Director decides WHAT a moment means (intent → family). This table
 * decides HOW a professional cut would voice it: a ROLE (a kind of effect with
 * its own placement and level rules) and the sounds that can play it.
 *
 * Placement and level numbers come from earshot's `launch` kit preset
 * (earshot/forge/kits/launch.json, MIT, measured medians of professional launch
 * films): `align` (which point of the take lands on the moment), `offsetMs`
 * (taps and clicks lead the cut, whoosh and swell peaks land just after),
 * `bedDb` (loudest 50 ms of the effect over the music's median level in the
 * second before), `levelDb` (the same balance without a music bed) and
 * `minGapMs` (how close a run may go). The event → role choices follow Real
 * SFX's event map (Clipwing/skills, references/event-map.md, MIT): a whoosh
 * peaks in the middle of the move, a landing is a short low thump, a product /
 * UI film gets a light bright accent on its title rather than a long sub drop,
 * interface moments come from the uisfx UI pack.
 */

export const PRO_ROLES = [
  'whoosh.short',
  'whoosh.long',
  'land',
  'land.light',
  'hit',
  'drop',
  'click',
  'pop',
  'tick',
  'key',
  'riser',
  'swell',
  'shimmer',
  'bell',
  'coin',
  'sting',
  'notify',
  'confirm',
  'error',
  'warning',
  'snap',
  'glitch',
] as const;
export type ProRole = (typeof PRO_ROLES)[number];

export type Align = 'onset' | 'peak' | 'end';

export interface RoleRule {
  align: Align;
  /** Where the aligned point sits against the visual moment (ms; negative = leads it). */
  offsetMs: number;
  /** Loudest 50 ms of the effect over the music bed's median level (dB). */
  bedDb: number;
  /** Balance without music (dB; the loudest role at 0). */
  levelDb: number;
  /** Two takes of this role never closer than this (ms). */
  minGapMs: number;
  /** A tonal role whose pitch can be tuned to the score's key. */
  tonal?: boolean;
  /** Earshot knob the role is aimed with: `dur` (+ `apex`) follows the move's length. */
  aim?: 'move' | 'ring';
  /** An accent that matters: it keeps its level under the voice (others step down / drop). */
  accent?: boolean;
}

/** Per-role placement and level (earshot launch medians, with the roles NITAAQ adds marked). */
export const ROLE_RULES: Record<ProRole, RoleRule> = {
  'whoosh.short': { align: 'peak', offsetMs: 37, bedDb: 9, levelDb: -5.5, minGapMs: 250, aim: 'move' },
  'whoosh.long': { align: 'peak', offsetMs: 3, bedDb: 8.5, levelDb: -6.5, minGapMs: 600, aim: 'move' },
  land: { align: 'onset', offsetMs: 30, bedDb: 8, levelDb: -5.5, minGapMs: 159, accent: true },
  'land.light': { align: 'onset', offsetMs: -60, bedDb: 3, levelDb: -10, minGapMs: 115 },
  hit: { align: 'onset', offsetMs: 0, bedDb: 7.5, levelDb: -9, minGapMs: 400, accent: true },
  drop: { align: 'onset', offsetMs: 0, bedDb: 7, levelDb: -8.5, minGapMs: 800, accent: true, tonal: true },
  click: { align: 'onset', offsetMs: -11, bedDb: 6.5, levelDb: 0, minGapMs: 85, accent: true },
  pop: { align: 'onset', offsetMs: 4, bedDb: 8.5, levelDb: -8, minGapMs: 114 },
  tick: { align: 'onset', offsetMs: 0, bedDb: 3, levelDb: 0, minGapMs: 66 },
  key: { align: 'onset', offsetMs: 8, bedDb: 6.5, levelDb: -1, minGapMs: 87 },
  riser: { align: 'peak', offsetMs: -23, bedDb: 8, levelDb: -3.5, minGapMs: 2000, aim: 'move' },
  swell: { align: 'peak', offsetMs: 42, bedDb: 9.5, levelDb: -5.5, minGapMs: 2000, aim: 'move' },
  // NITAAQ additions (no launch-preset median: set from the nearest measured role)
  shimmer: { align: 'peak', offsetMs: 40, bedDb: 2, levelDb: -14, minGapMs: 1500, tonal: true, aim: 'ring' },
  bell: { align: 'onset', offsetMs: -20, bedDb: 7.5, levelDb: -8.5, minGapMs: 110, tonal: true },
  coin: { align: 'onset', offsetMs: -10, bedDb: 7.5, levelDb: -8.5, minGapMs: 200, tonal: true, accent: true },
  sting: { align: 'peak', offsetMs: 0, bedDb: 8, levelDb: -4, minGapMs: 3000, tonal: true, aim: 'ring', accent: true },
  notify: { align: 'onset', offsetMs: 0, bedDb: 8.5, levelDb: -6, minGapMs: 400, accent: true },
  confirm: { align: 'onset', offsetMs: 0, bedDb: 8.5, levelDb: -8.5, minGapMs: 300, tonal: true, accent: true },
  error: { align: 'onset', offsetMs: 0, bedDb: 8, levelDb: -7, minGapMs: 400, accent: true },
  warning: { align: 'onset', offsetMs: 0, bedDb: 8, levelDb: -7, minGapMs: 400, accent: true },
  snap: { align: 'onset', offsetMs: 9, bedDb: 4, levelDb: -7, minGapMs: 66 },
  glitch: { align: 'peak', offsetMs: 0, bedDb: 5, levelDb: -10, minGapMs: 400 },
};

/** Sound Director family → production role (the event's motion can still change it, see roleFor). */
export const FAMILY_ROLE: Record<string, ProRole> = {
  'whoosh-air': 'whoosh.short',
  'light-sweep': 'whoosh.short',
  'paper-slide': 'whoosh.short',
  'route-glide': 'whoosh.short',
  'marker-stroke': 'whoosh.short',
  'whoosh-deep': 'whoosh.long',
  'swoosh-fast': 'whoosh.short',
  'swipe-ui': 'whoosh.short',
  'impact-soft': 'land',
  'impact-punch': 'hit',
  'thud-heavy': 'hit',
  'boom-sub': 'drop',
  'click-ui': 'click',
  'button-press': 'click',
  'tap-soft': 'land.light',
  'pop-bubble': 'pop',
  'blip-digital': 'tick',
  'tick-soft': 'tick',
  'chime-success': 'confirm',
  'ding-notify': 'notify',
  'buzz-error': 'error',
  'tone-warning': 'warning',
  'key-type': 'key',
  'riser-tension': 'riser',
  'swell-reverse': 'swell',
  shimmer: 'shimmer',
  'glass-ting': 'bell',
  'coin-chime': 'coin',
  'logo-stinger': 'sting',
  'pluck-pin': 'bell',
  'shutter-camera': 'snap',
  'glitch-digital': 'glitch',
};

/**
 * uisfx (CC0 audio, MIT code; bundled with Real SFX and published on npm) cue names
 * per role: Real SFX routes interface moments there and physical ones to a library.
 */
export const UISFX_CUES: Partial<Record<ProRole, string[]>> = {
  notify: ['notification', 'receive', 'mention'],
  confirm: ['success', 'complete', 'check'],
  error: ['error', 'blocked'],
  warning: ['warning'],
  click: ['press', 'select', 'toggle-on'],
  coin: ['purchase', 'reward'],
  key: ['typing'],
};
