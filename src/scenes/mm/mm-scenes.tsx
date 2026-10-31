/**
 * MotionMaxxing scene families (module `motionmaxxing`): NITAAQ scenes whose picture is made by the
 * original MotionMaxxing runtime (see MMFrame.tsx). They take part in the normal production path
 * (shot script / recipes → compile → QC → Sound Director → render → master) like every other family.
 *
 *   mm-kinetic   words | count            M.words, M.count, M.snap, M.dive, M.whip, M.exit+smear, M.drift
 *   mm-hero3d    coin | logo | glass-slab | phone   M.hero3d (three.js r186: light, depth, material, camera)
 *   mm-phone     lock-screen | screenshot NativeUI.phone/lockScreen/arrive/macro, M.cursor, M.press
 */
import React, { useMemo } from 'react';
import { z } from 'zod';
import { AbsoluteFill } from 'remotion';
import { defineScene, ALL_ASPECTS } from '../registry';
import { MMFrame, useMMAsset, useMMEnv } from './MMFrame';

const Colors = z.object({ ground: z.string().optional(), ground2: z.string().optional(), ink: z.string().optional(), accent: z.string().optional(), metal: z.string().optional(), primary: z.string().optional() }).optional();
import { countShot, hero3dShot, kineticWords, phoneShot, type MMEnv } from '../../mm/programs';

/** Event planning needs only timing: a canonical env (the real one only changes pixels). */
const EV_ENV = (duration: number): MMEnv => ({ width: 1080, height: 1920, fps: 30, duration, palette: { ground: '#ffffff', ground2: '#000000', ink: '#000000', inkSoft: '#555555', accent: '#ff0000', primary: '#0000ff', metal: '#cccccc' }, font: 'x', fontWeight: 500, dir: 'rtl' });

// ── mm-kinetic ────────────────────────────────────────────────────────────────────────────
const KineticC = z.object({
  /** Brand colours for this shot (material, accent, grounds) — from the brand, never a preset. */
  colors: Colors,
  lines: z.array(z.string().min(1).max(48)).min(1).max(3).optional(),
  accent: z.string().max(24).optional(),
  mech: z.enum(['rise', 'pop', 'shrink', 'slide', 'focus']).optional(),
  enter: z.enum(['snap', 'cut']).optional(),
  exit: z.enum(['drop', 'lift', 'dive', 'whip', 'rest']).optional(),
  ground: z.enum(['light', 'dark']).optional(),
  onsets: z.array(z.array(z.number().int().min(0))).optional(),
  // count variant
  value: z.number().optional(),
  from: z.number().optional(),
  suffix: z.string().max(12).optional(),
  label: z.string().max(60).optional(),
  numerals: z.enum(['arab', 'latn']).optional(),
  lockup: z.object({ logo: z.string().optional(), name: z.string().max(30).optional(), line: z.string().max(60).optional() }).optional(),
});
type KC = z.infer<typeof KineticC>;

function program(c: KC, variant: string, env: MMEnv, asset?: (s?: string) => string | undefined) {
  if (variant === 'count') {
    if (c.value === undefined) throw new Error('mm-kinetic count needs `value` (a real number from the brief)');
    return countShot({ value: c.value, from: c.from, suffix: c.suffix, label: c.label, numerals: c.numerals, ground: c.ground, lockup: c.lockup ? { ...c.lockup, logo: asset ? asset(c.lockup.logo) : c.lockup.logo } : undefined }, env);
  }
  return kineticWords({ lines: c.lines ?? [], accent: c.accent, mech: c.mech, enter: c.enter, exit: c.exit, ground: c.ground, onsets: c.onsets }, env);
}

function MMKinetic({ content, variant }: { content: KC; variant: string }) {
  const env = useMMEnv(content.colors);
  const asset = useMMAsset();
  const prog = useMemo(() => program(content, variant, env, asset), [content, variant, env]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AbsoluteFill>
      <MMFrame program={prog} env={env} label={`mm-kinetic:${variant}`} />
    </AbsoluteFill>
  );
}

export const mmKinetic = defineScene<KC>(
  {
    id: 'mm-kinetic',
    version: '1.0.0',
    category: 'typography',
    title: 'MotionMaxxing kinetic type / count',
    description: 'Arabic kinetic typography on the MotionMaxxing runtime: whole words at speech rhythm (M.words, accent word enters bigger), arrival from oversize (M.snap), exit on motion with smear / dive / whip; count variant: M.count per-frame steps landing on a real value, logo lockup crashing in from 3.5×.',
    variants: ['words', 'count'],
    defaultVariant: 'words',
    content: KineticC,
    defaultDuration: 3.2,
    minDuration: 1.6,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut'],
    sfx: [],
    safeArea: 'fullbleed',
    beats: ['hook', 'problem', 'proof', 'cta', 'brand'],
    energy: 0.75,
    cost: 'MEDIUM',
    validate: (c) => (c.lines?.length || c.value !== undefined ? [] : [{ path: 'lines', message: 'words variant needs lines; count variant needs value', severity: 'error' }]),
    example: { lines: ['كل ريال', 'له مكان'], accent: 'مكان' },
    editable: ['lines', 'accent', 'label'],
    events: (c, v, d) => program(c, v, EV_ENV(d)).events,
    module: 'motionmaxxing',
  },
  MMKinetic,
);

// ── mm-hero3d ─────────────────────────────────────────────────────────────────────────────
const HeroC = z.object({
  /** Brand colours for this shot (material, accent, grounds) — from the brand, never a preset. */
  colors: Colors,
  mark: z.array(z.string().min(1)).max(12).optional(),
  material: z.enum(['satin', 'brandPlastic', 'chrome', 'glass', 'iridescent']).optional(),
  line: z.string().max(48).optional(),
  accent: z.string().max(24).optional(),
  ground: z.enum(['light', 'dark']).optional(),
  screen: z.string().optional(),
  exit: z.enum(['to-camera', 'rest']).optional(),
});
type HC = z.infer<typeof HeroC>;
const OBJ: Record<string, 'coin' | 'logo' | 'glass-slab' | 'phone'> = { coin: 'coin', logo: 'logo', 'glass-slab': 'glass-slab', phone: 'phone' };

function MMHero({ content, variant }: { content: HC; variant: string }) {
  const env = useMMEnv(content.colors);
  const asset = useMMAsset();
  const prog = useMemo(() => hero3dShot({ ...content, object: OBJ[variant] ?? 'coin', screen: asset(content.screen) }, env), [content, variant, env]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <AbsoluteFill>
      <MMFrame program={prog} env={env} label={`mm-hero3d:${variant}`} />
    </AbsoluteFill>
  );
}

export const mmHero3d = defineScene<HC>(
  {
    id: 'mm-hero3d',
    version: '1.0.0',
    category: 'cinematic',
    title: 'MotionMaxxing Hero3D object',
    description: 'One physical hero object with real light, depth and material (three.js r186 via MotionMaxxing hero3d): coin with the embossed brand mark, extruded logo, glass slab or phone. Falls in and lands with a light pulse, a travelling softbox sweep and a justified dolly; optional exit toward the camera (object-driven cut).',
    variants: ['coin', 'logo', 'glass-slab', 'phone'],
    defaultVariant: 'coin',
    content: HeroC,
    defaultDuration: 4.4,
    minDuration: 2.4,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut'],
    sfx: [],
    safeArea: 'fullbleed',
    beats: ['hook', 'product', 'solution', 'brand'],
    energy: 0.7,
    cost: 'HIGH',
    validate: (c) => [],
    example: { mark: ['M 0 0 L 100 0 L 100 100 L 0 100 Z'], line: 'حتى الفكّة', material: 'satin' },
    editable: ['line'],
    events: (c, v, d) => hero3dShot({ ...c, object: OBJ[v] ?? 'coin', mark: c.mark?.length ? c.mark : ['M0 0H1V1H0Z'] }, EV_ENV(d)).events,
    module: 'motionmaxxing',
  },
  MMHero,
);

// ── mm-phone ──────────────────────────────────────────────────────────────────────────────
const PhoneC = z.object({
  /** Brand colours for this shot (material, accent, grounds) — from the brand, never a preset. */
  colors: Colors,
  app: z.string().min(1).max(24),
  title: z.string().min(1).max(40),
  body: z.string().min(1).max(140),
  time: z.string().max(16).optional(),
  clock: z.string().max(8).optional(),
  date: z.string().max(40).optional(),
  icon: z.string().optional(),
  older: z.object({ app: z.string().optional(), title: z.string(), body: z.string(), time: z.string().optional() }).optional(),
  screenshot: z.string().optional(),
  carrier: z.enum(['coin', 'none']).optional(),
  press: z.boolean().optional(),
  ground: z.enum(['light', 'dark']).optional(),
  /** Required honesty flag: a built (not captured) UI is illustrative. */
  illustrative: z.boolean().optional(),
});
type PC = z.infer<typeof PhoneC>;

function MMPhone({ content, variant }: { content: PC; variant: string }) {
  const env = useMMEnv(content.colors);
  const asset = useMMAsset();
  const prog = useMemo(
    () => phoneShot({ ...content, icon: asset(content.icon), screenshot: variant === 'screenshot' ? asset(content.screenshot) : undefined }, env),
    [content, variant, env], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <AbsoluteFill>
      <MMFrame program={prog} env={env} label={`mm-phone:${variant}`} />
    </AbsoluteFill>
  );
}

export const mmPhone = defineScene<PC>(
  {
    id: 'mm-phone',
    version: '1.0.0',
    category: 'mobile',
    title: 'MotionMaxxing native phone UI',
    description: 'True-proportion iOS furniture from MotionMaxxing native-ui: lock screen + notification that rolls up (NativeUI.arrive), camera push-in until the notification is the frame (NativeUI.macro), touch press with 1-frame target lag (M.press). With a real screenshot (variant screenshot) the screen is shown as captured, never rebuilt.',
    variants: ['lock-screen', 'screenshot'],
    defaultVariant: 'lock-screen',
    content: PhoneC,
    defaultDuration: 4,
    minDuration: 2.4,
    maxDuration: 7,
    aspectRatios: ALL_ASPECTS,
    preferredTransitions: ['cut'],
    sfx: [],
    safeArea: 'fullbleed',
    beats: ['demo', 'feature', 'proof', 'solution'],
    energy: 0.6,
    cost: 'HIGH',
    validate: (c) => [
      ...(c.screenshot || c.illustrative ? [] : [{ path: 'illustrative', message: 'a built phone UI is illustrative: set illustrative:true or give a real screenshot', severity: 'warning' as const }]),
    ],
    example: { app: 'فكّة', title: 'فكّة', time: 'الآن', body: 'أضفنا ٥٠ ر.س إلى حصّالة السفر من فكّة مشترياتك.', illustrative: true },
    editable: ['title', 'body'],
    events: (c, v, d) => phoneShot({ ...c, screenshot: v === 'screenshot' ? c.screenshot ?? 'x' : undefined }, EV_ENV(d)).events,
    module: 'motionmaxxing',
  },
  MMPhone,
);
