/**
 * SceneRegistry — plugin-like registration of scene families.
 * The engine only knows this registry: adding a scene = one new module that
 * calls SceneRegistry.register(). No core change required.
 */
import type React from 'react';
import type { z } from 'zod';
import type { Aspect } from '../layout/canvas';
import type { Beat } from '../schema/plan';
import type { ElementKind } from '../motion/physics';
import type { MotionEventDecl } from '../audio/events';

export type PerformanceCost = 'LOW' | 'MEDIUM' | 'HIGH';
export interface MotionRecommendation {
  /** Element kinds this family animates (physics comes from the film's personality per element). */
  elements: ElementKind[];
  /** Motion jobs this family is good at. */
  jobs: string[];
}

export type SceneCategory = 'typography' | 'brand' | 'ui' | 'mobile' | 'commerce' | 'data' | 'media' | 'infographic' | 'cinematic' | 'social' | 'cta' | 'illustration' | 'map';

export interface SfxSuggestion {
  /** Seconds after scene start (scaled by motion speed). */
  at: number;
  category: string;
  /** 0..1 — importance; the audio planner drops low-weight cues at low sfx intensity. */
  weight: number;
  volume?: number;
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface SceneFitContext {
  aspect: Aspect;
  hasAssets: Record<string, boolean>;
}

export interface SceneManifest<P = Record<string, unknown>> {
  id: string;
  version: string;
  category: SceneCategory;
  title: string;
  description: string;
  variants: string[];
  defaultVariant: string;
  /** Zod schema for `content` (required + optional props). */
  content: z.ZodType<P, z.ZodTypeDef, unknown>;
  defaultDuration: number;
  minDuration: number;
  maxDuration: number;
  aspectRatios: Aspect[];
  preferredTransitions: string[];
  sfx: SfxSuggestion[];
  safeArea: 'strict' | 'normal' | 'fullbleed';
  /** Narrative beats this family serves (Director uses it). */
  beats: Beat[];
  /** 0..1 visual energy. */
  energy: number;
  /** Asset kinds that must be present in content for the scene to work. */
  requiresAssets?: string[];
  /** Approx characters of main copy each variant handles comfortably. */
  textCapacity?: Record<string, number>;
  /** Variants that suit an aspect best (Director preference). */
  aspectVariants?: Partial<Record<'portrait' | 'landscape' | 'square', string[]>>;
  /** Extra semantic validation beyond the zod schema. */
  validate?: (content: P) => ValidationIssue[];
  /** Representative content — used by Studio templates and visual regression tests. */
  example: P;
  /** Fields the Studio inspector exposes as text inputs (dot paths). */
  editable?: string[];
  /** Render cost (DOM complexity, media, blur). Defaults by category when omitted. */
  cost?: PerformanceCost;
  /** Motion recommendation. Defaults by category when omitted. */
  motion?: MotionRecommendation;
  /**
   * Semantic motion events (product lands, button pressed, counter final…) for the
   * Sound Director. Omitted → derived from `sfx` suggestions by category.
   */
  events?: (content: P, variant: string, durationSec: number) => MotionEventDecl[];
  /** Module this family belongs to (lazy modules: map, gsap, whiteboard…). Core families omit it. */
  module?: string;
}

const DEFAULT_COST: Record<SceneCategory, PerformanceCost> = { typography: 'LOW', brand: 'LOW', cta: 'LOW', social: 'LOW', infographic: 'LOW', data: 'MEDIUM', ui: 'MEDIUM', mobile: 'MEDIUM', commerce: 'MEDIUM', media: 'HIGH', cinematic: 'HIGH', illustration: 'MEDIUM', map: 'MEDIUM' };
const DEFAULT_MOTION: Record<SceneCategory, MotionRecommendation> = {
  typography: { elements: ['hero-title', 'text'], jobs: ['establish-hierarchy', 'stop-the-scroll'] },
  brand: { elements: ['logo', 'hero-title'], jobs: ['brand-recall'] },
  ui: { elements: ['dashboard', 'panel', 'cursor', 'card'], jobs: ['show-how-it-works'] },
  mobile: { elements: ['device', 'notification', 'button'], jobs: ['show-how-it-works'] },
  commerce: { elements: ['product', 'card', 'button'], jobs: ['show-the-product'] },
  data: { elements: ['chart', 'number'], jobs: ['make-the-number-land'] },
  media: { elements: ['panel', 'camera'], jobs: ['show-the-product'] },
  infographic: { elements: ['card', 'icon'], jobs: ['sequence-benefits'] },
  cinematic: { elements: ['hero-title', 'camera'], jobs: ['create-tension', 'hero-moment'] },
  social: { elements: ['card', 'notification'], jobs: ['build-trust'] },
  cta: { elements: ['button', 'logo'], jobs: ['direct-action', 'resolve'] },
  illustration: { elements: ['icon', 'card', 'chart'], jobs: ['explain-the-idea', 'show-how-it-works'] },
  map: { elements: ['chart', 'icon', 'camera'], jobs: ['locate-the-story', 'connect-places'] },
};

/** Family cost, defaulted by category. */
export function costOf(m: SceneManifest<any>): PerformanceCost {
  return m.cost ?? DEFAULT_COST[m.category];
}
export function motionOf(m: SceneManifest<any>): MotionRecommendation {
  return m.motion ?? DEFAULT_MOTION[m.category];
}

export interface SceneComponentProps<P = Record<string, unknown>> {
  content: P;
  variant: string;
}

export interface SceneModule<P = any> {
  manifest: SceneManifest<P>;
  Component: React.FC<SceneComponentProps<P>>;
}

class Registry {
  private map = new Map<string, SceneModule>();
  private aliases = new Map<string, string>();

  register<P>(mod: SceneModule<P>, aliases: string[] = []): void {
    const id = mod.manifest.id;
    if (this.map.has(id)) throw new Error(`Scene "${id}" is already registered`);
    if (!mod.manifest.variants.includes(mod.manifest.defaultVariant)) throw new Error(`Scene "${id}": defaultVariant not in variants`);
    this.map.set(id, mod as SceneModule);
    for (const a of aliases) this.aliases.set(a, id);
  }
  alias(alias: string, id: string): void {
    if (!this.map.has(id)) throw new Error(`Cannot alias "${alias}" to unknown scene "${id}"`);
    if (!this.map.has(alias)) this.aliases.set(alias, id);
  }
  aliasList(): [string, string][] {
    return [...this.aliases.entries()];
  }
  resolveId(id: string): string | undefined {
    if (this.map.has(id)) return id;
    return this.aliases.get(id);
  }
  get(id: string): SceneModule | undefined {
    const r = this.resolveId(id);
    return r ? this.map.get(r) : undefined;
  }
  has(id: string): boolean {
    return this.resolveId(id) !== undefined;
  }
  list(): SceneModule[] {
    return [...this.map.values()];
  }
  ids(): string[] {
    return [...this.map.keys()];
  }
  byCategory(c: SceneCategory): SceneModule[] {
    return this.list().filter((m) => m.manifest.category === c);
  }
  byBeat(b: Beat): SceneModule[] {
    return this.list().filter((m) => m.manifest.beats.includes(b));
  }
}

export const SceneRegistry = new Registry();

/** Helper to declare a scene module with full type inference. */
export function defineScene<P>(manifest: SceneManifest<P>, Component: React.FC<SceneComponentProps<P>>): SceneModule<P> {
  return { manifest, Component };
}

export const ALL_ASPECTS: Aspect[] = ['9:16', '16:9', '1:1', '4:5'];
