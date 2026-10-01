/**
 * Compiler: CreativePlan + Storyboard (+ brand, assets, audio plan) → video.json.
 * The output is a plain VideoSpec: every decision is visible and editable, and
 * the render engine never needs the Director.
 */
import type { Brief } from '../schema/brief';
import type { CreativePlan } from '../schema/plan';
import { VideoSchema, SCHEMA_VERSION, type AssetSpec, type BrandProfile, type VideoSpec } from '../schema/video';
import { ASPECTS } from '../layout/canvas';
import { hashString } from '../core/rng';
import type { PlannedStoryboard } from './storyboard';
import type { MotionSpec } from './creative';

type Aspect = '9:16' | '16:9' | '1:1' | '4:5';

export interface AudioPlan {
  mode: 'none' | 'user-voice' | 'tts';
  voice?: { src: string; duration: number; segments: { start: number; end: number; text?: string }[]; offset: number; provider: 'user' | 'tts'; processed: boolean };
  music?: { src: string; duration?: number; license?: string };
  sfx: boolean;
}

export function slug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `video-${hashString(s).toString(36).slice(0, 6)}`;
}

const sharedKind = (k?: string): 'logo' | 'product' | 'screenshot' => (k === 'logo' ? 'logo' : k === 'screenshot' ? 'screenshot' : 'product');

export function compileSpec(input: {
  brief: Brief;
  plan: CreativePlan;
  storyboard: PlannedStoryboard;
  brand: BrandProfile | null;
  assets: Record<string, AssetSpec>;
  audio: AudioPlan;
  projectId: string;
  seed: string | number;
  motion?: MotionSpec;
  design?: { allowPatterns: ('dots' | 'grid' | 'halftone' | 'bokeh' | 'stripes' | 'lines' | 'particles')[]; decorations?: boolean; justification?: string };
  loop?: boolean;
  beatSync?: { bpm: number; offset: number; aligned: number } | null;
  reference?: { source: string; kind: 'image' | 'video' | 'website'; motionEnergy?: number; visualDensity?: 'sparse' | 'balanced' | 'dense'; appliedTo: string[] };
  effects?: 'LOW' | 'MEDIUM' | 'HIGH';
  genre?: string;
  modules?: string[];
}): VideoSpec {
  const { brief, plan, storyboard, audio } = input;
  const aspect = plan.aspect as Aspect;
  const size = ASPECTS[aspect];
  const avgEnergy = plan.energyCurve.reduce((s, x) => s + x, 0) / Math.max(1, plan.energyCurve.length);
  const paceIntensity = plan.pace === 'fast' ? 0.72 : plan.pace === 'slow' ? 0.45 : 0.6;
  const voiceLed = Boolean(audio.voice);

  const scenes = storyboard.scenes.map((s, i) => ({
    id: s.id,
    type: s.family,
    variant: s.variant,
    duration: s.duration,
    content: s.content,
    layout: {},
    motion: { intensity: s.intensity, camera: s.camera, ...(input.motion ? { jobs: input.motion.scenes[i]?.jobs, text: input.motion.scenes[i]?.text } : {}) },
    transition: s.transition === 'none' ? undefined : { type: s.transition, duration: s.transitionDuration, ...(input.motion?.scenes[i]?.transitionReason ? { reason: input.motion.scenes[i].transitionReason } : {}) },
    sfx: 'auto' as const,
    purpose: s.purpose,
    beat: s.beat,
    ...(voiceLed ? { voice: { segment: i, start: s.narration?.start, end: s.narration?.end } } : {}),
  }));

  const sfxIntensity = brief.audio.sfx ? (voiceLed ? 0.35 : plan.pace === 'fast' ? 0.65 : 0.5) : 0;
  const spec = {
    version: SCHEMA_VERSION,
    project: {
      id: input.projectId,
      title: brief.title ?? brief.content.hook.slice(0, 120),
      language: brief.language,
      dialect: brief.dialect,
      numerals: 'latin' as const,
    },
    canvas: { aspect, width: size.width, height: size.height, fps: 30 },
    platform: brief.platform,
    safeArea: { preset: brief.platform, margin: 0, debug: false },
    brand: input.brand,
    style: { preset: plan.visualStyle, overrides: {} },
    direction: {
      intensity: paceIntensity,
      pace: plan.pace,
      energy: Math.round(avgEnergy * 100) / 100,
      cameraActivity: plan.pace === 'slow' ? 0.6 : 0.45,
      textActivity: 0.6,
      transitionDensity: plan.pace === 'fast' ? 0.75 : 0.55,
    },
    assets: input.assets,
    audio: {
      mode: audio.mode,
      voice: audio.voice
        ? { src: audio.voice.src, offset: audio.voice.offset, volume: 1, duration: audio.voice.duration, segments: audio.voice.segments, provider: audio.voice.provider, processed: audio.voice.processed }
        : undefined,
      music: audio.music
        ? {
            src: audio.music.src,
            volume: brief.audio.musicVolume ?? (voiceLed ? 0.32 : 0.55),
            fadeIn: 0.8,
            fadeOut: 1.5,
            loop: true,
            trimStart: 0,
            duration: audio.music.duration,
            ducking: { enabled: voiceLed, level: 0.3, attack: 0.25, release: 0.6 },
            license: audio.music.license,
          }
        : undefined,
      sfx: { enabled: audio.sfx, intensity: brief.audio.sfxIntensity ?? sfxIntensity, volume: brief.audio.sfxVolume ?? (voiceLed ? 0.45 : 0.6), overrides: {} },
    },
    scenes,
    design: { allowPatterns: input.design?.allowPatterns ?? [], decorations: input.design?.decorations ?? false, justification: input.design?.justification, effectBudget: input.effects },
    motion: { personality: input.motion?.personality, seed: input.seed, ...(input.motion?.heroScene ? { heroScene: input.motion.heroScene } : {}) },
    timeline: {
      seamlessLoop: Boolean(input.loop),
      chapters: [],
      beatSync: input.beatSync ?? undefined,
      shared: (input.motion?.shared ?? []).map((sh, k) => ({ id: `shared-${k + 1}`, asset: sh.asset, kind: sharedKind(input.assets[sh.asset]?.kind), fromScene: sh.fromScene, toScene: sh.toScene })),
    },
    genre: input.genre,
    modules: input.modules ?? [],
    ...(input.reference ? { reference: input.reference } : {}),
    captions: { enabled: false, position: 'bottom' as const, cues: [] },
    metadata: {
      generator: 'director' as const,
      seed: input.seed,
      createdAt: new Date().toISOString(),
      briefHash: hashString(JSON.stringify(brief)).toString(16),
      repairLog: [],
      notes: `${plan.objective} · ${plan.visualStyle} (${plan.styleReason}) · ${plan.pace}`,
    },
  };
  return VideoSchema.parse(spec);
}
