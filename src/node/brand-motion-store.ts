/** brand-motion.json persistence: workspace/brands/<key>/brand-motion.json (shared by every project of the brand). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspace } from './workspace';
import type { BrandMotion } from '../brand/brand-motion';

export function brandMotionPath(key: string, ws = workspace()): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) throw new Error(`Invalid brand key "${key}"`);
  return join(ws.root, 'brands', key, 'brand-motion.json');
}

export function loadBrandMotion(key: string, ws = workspace()): BrandMotion | null {
  const p = brandMotionPath(key, ws);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return j?.version === 1 ? (j as BrandMotion) : null;
  } catch {
    return null;
  }
}

export function saveBrandMotion(bm: BrandMotion, ws = workspace()): string {
  const p = brandMotionPath(bm.key, ws);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(bm, null, 2));
  return p;
}
