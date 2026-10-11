/**
 * Workspace film history for the Anti-Template System: the fingerprints of the
 * last films directed in this workspace (workspace/.history/films.json). Local,
 * small (last 40 films), never uploaded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspace } from './workspace';
import type { FilmFingerprint } from '../director/anti-template';

const MAX = 40;
const file = () => join(workspace().root, '.history', 'films.json');

export function loadHistory(excludeId?: string): FilmFingerprint[] {
  try {
    if (!existsSync(file())) return [];
    const all = JSON.parse(readFileSync(file(), 'utf8')) as FilmFingerprint[];
    return all.filter((h) => h && h.id !== excludeId && Array.isArray(h.features));
  } catch {
    return [];
  }
}

export function recordHistory(fp: FilmFingerprint): void {
  const rest = loadHistory(fp.id);
  mkdirSync(join(workspace().root, '.history'), { recursive: true });
  writeFileSync(file(), JSON.stringify([...rest, fp].slice(-MAX), null, 1));
}
