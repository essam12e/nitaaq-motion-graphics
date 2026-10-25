/**
 * Product preservation: a style may change the environment, the composition, the motion and the
 * light AROUND a product, never the product. Identity assets (the product photo, the logo, a UI
 * screenshot) keep their shape, colours, text, proportions and design: no material, no tint, no
 * morph, no rotation, no tilt, no squash; entrance by fade / rise / scale only. Pure.
 */
import type { MotionStyle } from './schema';

export const PRESERVATION_RULES = [
  'the product, logo and screenshots are drawn as supplied: no material, tint, filter, outline or texture on their pixels',
  'no morph, no shape-transform, no rotation, no tilt, no squash or stretch on an identity asset',
  'uniform scale only (proportions locked); entrance by fade, rise or scale',
  'style light (spotlight, floor, rim) sits behind or around the product, never on it',
  'supporting graphics never overlap the product',
];

const SAFE_ENTER = new Set(['fade', 'rise', 'scale', 'none']);

export interface CastLike { id: string; role?: string; enter?: string; rotation?: number; [k: string]: unknown }

/** True for cast that is a user identity asset (product, logo, screenshot). */
export function isIdentityAsset(c: { id: string; role?: string }, identityIds: Set<string>): boolean {
  if (identityIds.has(c.id)) return true;
  return /^(image|product|logo)\b|^image\./.test(c.id) || /^(product|logo|screenshot)$/.test(c.role ?? '');
}

/** Clamp a cast entry so a style cannot alter an identity asset. Returns the notes of what was kept. */
export function protectCast<T extends CastLike>(c: T, style: MotionStyle): { cast: T; notes: string[] } {
  const notes: string[] = [];
  const out = { ...c };
  if (out.enter && !SAFE_ENTER.has(out.enter)) {
    notes.push(`${c.id}: ${style.id} wanted "${out.enter}" for an identity asset → rise`);
    out.enter = 'rise';
  }
  if (out.rotation) {
    notes.push(`${c.id}: rotation removed (identity asset)`);
    out.rotation = 0;
  }
  return { cast: out, notes };
}

/** Motion actions a style may never apply to an identity asset. */
export const FORBIDDEN_ON_IDENTITY = new Set(['morph', 'transform', 'become']);
export const FORBIDDEN_TRANSITIONS_ON_IDENTITY = new Set(['morph', 'shape-transform', 'text-mask']);
