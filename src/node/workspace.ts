/**
 * Portable path resolution. Nothing is hardcoded to a machine: every location can be
 * overridden with MOTION_WORKSPACE / MOTION_UPLOADS / MOTION_OUTPUT / MOTION_CACHE.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (where package.json lives). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Workspace {
  root: string;
  uploads: string;
  output: string;
  cache: string;
  projects: string;
}

export function workspace(env: NodeJS.ProcessEnv = process.env): Workspace {
  const root = resolve(env.MOTION_WORKSPACE || join(ROOT, 'workspace'));
  const ws: Workspace = {
    root,
    uploads: resolve(env.MOTION_UPLOADS || join(root, 'uploads')),
    output: resolve(env.MOTION_OUTPUT || join(root, 'output')),
    cache: resolve(env.MOTION_CACHE || join(root, '.cache')),
    projects: join(root, 'projects'),
  };
  return ws;
}

export function ensureWorkspace(ws = workspace()): Workspace {
  for (const d of [ws.root, ws.uploads, ws.output, ws.cache, ws.projects]) mkdirSync(d, { recursive: true });
  return ws;
}

export function projectDir(id: string, ws = workspace()): string {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id)) throw new Error(`Invalid project id "${id}"`);
  return join(ws.projects, id);
}
